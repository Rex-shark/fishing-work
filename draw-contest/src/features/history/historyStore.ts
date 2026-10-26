// 比賽歷史的時序與狀態（Epic 17；plan/contest-history.md 決策 3、4、5、7、8、9；spec/draw-contest/architecture.md §7）。
// 一、紀錄（createHistoryRecorder）：把客戶端本來就收到的揭曉資料寫進 historyDb，不經 server。
//   建檔：round.phase 為 ended、results 非 null、至少一人交卷、startedAt 有值 → 以 id = startedAt 建檔（已有同 id 就合併），並把 { id, roundNo } 記在記憶體。
//         加入或重新整理時 phase 不是 ended 就不建檔（此時 startedAt 已被 server 清成 null，results 雖然還在也不存）。
//   更新：記著的那一回合（以 roundNo 對應）之後每收到一張圖（contest:gallery）或評語有變（round.results，含 contest:comment 補進 store 的）就更新該筆，
//         phase 已變成 idle／choosing 也照樣更新；savedAt 維持首次建檔時間。
//   停止：下一回合 drawing 開始（roundNo 變了，或 phase 進到 drawing／judging）或離開遊戲（me 變 null）就放掉，不再更新；沒等到的評語留 null。
//   合併：同 id 的舊內容與新快照合併——評語以非 null 優先（不被較舊的快照蓋掉）、圖片逐張補上、savedAt 與 me 保留先寫的。
//   修剪：每次有寫入就修剪到 HISTORY_MAX 筆（刪 savedAt 最舊的）。
//   寫入排成一列依序做（同一筆的更新不交錯）；等待中的變更先併成一筆再寫（一口氣到的多張圖只寫一兩次）。
// 二、檢視（useHistoryStore）：清單 entries（savedAt 降冪）與開著的那一筆 open（存檔＋圖片的 object URL）。
//   object URL 在開啟時從 Blob 建立，關閉、換開另一筆、自動關閉、停止（startHistory 的停止函式）時全部 revoke；
//   開著的那一筆被更新（圖片陸續補上）時只替新的圖片建 URL。
// 三、銜接點（都在本檔與兩處呼叫）：startHistory() 訂閱遊戲 store 的 round／me（App 掛載時啟動一次，同自動交卷）；
//   socket/client 收到 contest:gallery 時多呼叫一次 recordGalleryImage（store 只留 object URL，原始 PNG 要從事件拿）。
// 參考圖（Epic 20 像不像比賽；plan/contest-mimic.md 決策 7）：contest:reference 在 drawing 開始時就到（比建檔早），
//   所以紀錄器先記著最近一張（roundNo＋Blob）；建檔時該回合是 mimic（lastMode）且 roundNo 相符就一起存，建檔後才到的（中途加入補送）補進那一筆。
//   檢視時參考圖同樣建 object URL（HistoryOpen.referenceUrl），關閉時一起 revoke。
// IndexedDB 不可用、被封鎖、配額滿（決策 9）：所有存取都在這裡接住，只 console.warn；清單維持空的，遊戲不受影響。
import { create } from 'zustand'
import type { GalleryImage, ReferenceImage, ResultEntry, RoundPublic } from '@fishing-work/shared/draw-contest'
import { galleryBytes, selectIsSetter, useGameStore, type GameState } from '../../store/game'
import { HISTORY_MAX, createIndexedDbHistory, trimHistory, type HistoryDb, type HistoryRecord } from './historyDb'
import { canViewHistory } from './historyDisplay'

// ─── 存檔內容：建立與合併（純函式） ─────────────────────────────────────

/** 存檔裡沒有「產生中」的評語：commentPending 一律存 false */
const withoutPending = (r: ResultEntry): ResultEntry => (r.commentPending ? { ...r, commentPending: false } : r)

/** 由目前的回合狀態組出一筆存檔（還沒有圖片；題目用 results 對應的 lastTopic） */
export function recordFromRound(
  round: Pick<RoundPublic, 'roundNo' | 'topic' | 'lastTopic' | 'judgeMode' | 'commentMode' | 'results'>,
  me: string | null,
  id: number,
  savedAt: number,
  reference: Blob | null = null,
): HistoryRecord {
  return {
    id,
    savedAt,
    roundNo: round.roundNo,
    topic: round.lastTopic ?? round.topic ?? '',
    judgeMode: round.judgeMode,
    commentMode: round.commentMode,
    me,
    results: (round.results ?? []).map(withoutPending),
    images: {},
    reference,
  }
}

/**
 * 把新快照併進已有的存檔（同一回合）。沒有變化時回傳 existing 本身（呼叫端以此判斷不必寫入）。
 * - id、savedAt、roundNo、me、題目：保留先寫的（me、題目原本是空的才補）；
 * - 評分器與評語器：新快照有值就用新的（揭曉後評語失敗會從 ai 變 off），新快照是 null（idle／choosing 已清掉）就保留舊的；
 * - results：以新快照為準（名次與分數由 server 決定），但評語以非 null 優先——新快照是 null 而舊的有字就保留舊的；
 * - 圖片：已有的不動，只補上沒有的；參考圖同理（已有的不動，沒有才用新的）
 */
export function mergeRecord(existing: HistoryRecord | undefined, incoming: HistoryRecord): HistoryRecord {
  if (existing === undefined) return incoming
  const old = new Map(existing.results.map((r) => [r.playerId, r]))
  const results = incoming.results.map((r) => {
    const kept = old.get(r.playerId)?.comment ?? null
    return withoutPending(r.comment === null && kept !== null ? { ...r, comment: kept } : r)
  })
  const next: HistoryRecord = {
    ...existing,
    topic: existing.topic !== '' ? existing.topic : incoming.topic,
    judgeMode: incoming.judgeMode ?? existing.judgeMode,
    commentMode: incoming.commentMode ?? existing.commentMode,
    me: existing.me ?? incoming.me,
    results,
    images: existing.images,
    reference: existing.reference ?? incoming.reference,
  }
  const withImages = addImages(next, incoming.images)
  const unchanged =
    withImages.images === existing.images &&
    next.reference === existing.reference &&
    next.topic === existing.topic &&
    next.judgeMode === existing.judgeMode &&
    next.commentMode === existing.commentMode &&
    next.me === existing.me &&
    JSON.stringify(results) === JSON.stringify(existing.results)
  return unchanged ? existing : withImages
}

/** 補上還沒有的圖片（同一位玩家一回合只有一張，已有的不重寫）；沒有新的就回傳 record 本身 */
export function addImages(record: HistoryRecord, images: Readonly<Record<string, Blob>>): HistoryRecord {
  const missing = Object.entries(images).filter(([playerId]) => !Object.hasOwn(record.images, playerId))
  return missing.length === 0 ? record : { ...record, images: { ...record.images, ...Object.fromEntries(missing) } }
}

// ─── 紀錄：建檔／更新／停止的時序 ────────────────────────────────────────

export interface HistoryRecorderDeps {
  db: HistoryDb
  now(): number
  /** 有寫入（含修剪）之後呼叫：清單該重讀了 */
  onSaved(): void
  /** 存取失敗時呼叫（預設 console.warn）；不可丟例外 */
  warn(message: string, error: unknown): void
}

export interface HistoryRecorder {
  /** 回合狀態或自己的 id 有變（round:update、快照、contest:comment 補進 store、離開遊戲）時呼叫 */
  round(round: RoundPublic, me: string | null): void
  /** 收到 contest:gallery 時呼叫 */
  gallery(image: GalleryImage): void
  /** 收到 contest:reference 時呼叫（Epic 20）：先記著；記著的那一回合已建檔就補進去 */
  reference(image: ReferenceImage): void
  /** 記著的那一回合（還會被更新的那一筆）；沒有為 null */
  active(): { id: number; roundNo: number } | null
  /** 排隊中的寫入都做完時 resolve（測試用；不會 reject） */
  settled(): Promise<void>
}

/** 同一筆還沒寫出去的變更 */
interface Patch {
  /** 可以新建（來自 ended 的建檔）；false＝只更新已存在的那一筆 */
  create: boolean
  /** 最新的回合快照（null＝這次只有圖片） */
  record: HistoryRecord | null
  images: Record<string, Blob>
  /** 參考圖（null＝這次沒有） */
  reference: Blob | null
}

function applyPatch(existing: HistoryRecord | undefined, patch: Patch): HistoryRecord | null {
  // 沒建過檔（建檔那次失敗），或已被修剪掉：不為了一張圖或一則評語把它建回來
  if (existing === undefined && !patch.create) return null
  const merged = patch.record !== null ? mergeRecord(existing, patch.record) : existing
  if (merged === undefined) return null
  const withImages = addImages(merged, patch.images)
  const next = patch.reference !== null && withImages.reference === null ? { ...withImages, reference: patch.reference } : withImages
  return next === existing ? null : next
}

export function createHistoryRecorder(deps: HistoryRecorderDeps): HistoryRecorder {
  let active: { id: number; roundNo: number } | null = null
  /** 最近收到的參考圖（drawing 開始就到，比建檔早） */
  let latestReference: { roundNo: number; blob: Blob } | null = null
  const pending = new Map<number, Patch>()
  let scheduled = false
  let queue: Promise<void> = Promise.resolve()

  function patchFor(id: number): Patch {
    let patch = pending.get(id)
    if (patch === undefined) {
      patch = { create: false, record: null, images: {}, reference: null }
      pending.set(id, patch)
    }
    return patch
  }

  /** 把等待中的變更寫出去；每一筆各自接住失敗（一筆失敗不影響下一筆），本函式不會 reject */
  async function flush(): Promise<void> {
    scheduled = false
    const batch = [...pending]
    pending.clear()
    for (const [id, patch] of batch) {
      try {
        if (!(await deps.db.update(id, (existing) => applyPatch(existing, patch)))) continue
      } catch (error) {
        deps.warn('比賽歷史寫入失敗', error)
        continue
      }
      try {
        await trimHistory(deps.db, HISTORY_MAX)
      } catch (error) {
        deps.warn('比賽歷史修剪失敗', error)
      }
      try {
        deps.onSaved()
      } catch (error) {
        deps.warn('比賽歷史清單更新失敗', error)
      }
    }
  }

  function schedule(): void {
    if (scheduled) return
    scheduled = true
    queue = queue.then(flush).catch((error: unknown) => deps.warn('比賽歷史寫入失敗', error))
  }

  /** 回合快照併進等待中的變更（先前排的快照也合併：非 null 的評語與先到的欄位不會被後到的 null 蓋掉） */
  function queueRound(id: number, round: RoundPublic, me: string, create: boolean): void {
    const patch = patchFor(id)
    // 只有 mimic 回合才帶參考圖（roundNo 相符；server 重啟後 roundNo 會重複，所以也看 lastMode）
    const reference = round.lastMode === 'mimic' && latestReference?.roundNo === round.roundNo ? latestReference.blob : null
    const incoming = recordFromRound(round, me, id, deps.now(), reference)
    patch.record = patch.record !== null ? mergeRecord(patch.record, incoming) : incoming
    patch.create ||= create
    schedule()
  }

  return {
    round(round, me) {
      if (me === null) {
        active = null
        return
      }
      // 下一回合開始（roundNo 只在進入 drawing 時遞增；漏收 drawing 直接看到 judging 也算）→ 放掉
      if (active !== null && (round.roundNo !== active.roundNo || round.phase === 'drawing' || round.phase === 'judging')) active = null
      const { results } = round
      if (results === null) return
      if (round.phase === 'ended') {
        // 沒人交卷不存（免得佔名額）；ended 一定有 startedAt，沒有就無從建檔
        if (round.startedAt === null || !results.some((r) => r.submitted)) return
        active = { id: round.startedAt, roundNo: round.roundNo }
        queueRound(active.id, round, me, true)
      } else if (active !== null) {
        // idle／choosing：startedAt 已是 null，以記著的 id 更新（揭曉後才到的評語）
        queueRound(active.id, round, me, false)
      }
    },

    gallery(image) {
      if (active === null || image.roundNo !== active.roundNo) return
      const bytes = galleryBytes(image.png)
      if (bytes === null) return
      patchFor(active.id).images[image.playerId] = new Blob([bytes], { type: 'image/png' })
      schedule()
    },

    reference(image) {
      const bytes = galleryBytes(image.jpeg)
      if (bytes === null) return
      const blob = new Blob([bytes], { type: 'image/jpeg' })
      latestReference = { roundNo: image.roundNo, blob }
      if (active === null || image.roundNo !== active.roundNo) return
      patchFor(active.id).reference = blob
      schedule()
    },

    active: () => active,

    settled: async () => {
      // 寫入途中可能又排了新的：等到沒有為止
      let seen: Promise<void> | null = null
      while (seen !== queue) {
        seen = queue
        await seen
      }
    },
  }
}

// ─── 檢視：清單與開著的那一筆 ──────────────────────────────────────────

/** 開著的那一筆：存檔內容＋每張圖的 object URL（playerId → URL）＋參考圖的 object URL（Epic 20；沒有為 null） */
export interface HistoryOpen {
  record: HistoryRecord
  urls: ReadonlyMap<string, string>
  referenceUrl: string | null
}

export interface HistoryState {
  /** 全部存檔，savedAt 降冪（最多 HISTORY_MAX 筆；讀不到時維持空的） */
  entries: HistoryRecord[]
  open: HistoryOpen | null
}

export const useHistoryStore = create<HistoryState>()(() => ({ entries: [], open: null }))

/** 替還沒有 URL 的圖片建 object URL（已有的沿用，畫面上的圖不會閃）；建不出來的那張略過 */
function urlsFor(images: Readonly<Record<string, Blob>>, keep: ReadonlyMap<string, string> = new Map()): Map<string, string> {
  const urls = new Map(keep)
  for (const [playerId, blob] of Object.entries(images)) {
    if (urls.has(playerId)) continue
    try {
      urls.set(playerId, URL.createObjectURL(blob))
    } catch (error) {
      env.warn('比賽歷史的圖片無法顯示', error)
    }
  }
  return urls
}

/** 參考圖的 object URL（已有就沿用）；沒有參考圖或建不出來為 null */
function referenceUrlFor(reference: Blob | null, keep: string | null = null): string | null {
  if (reference === null) {
    if (keep !== null) URL.revokeObjectURL(keep)
    return null
  }
  if (keep !== null) return keep
  try {
    return URL.createObjectURL(reference)
  } catch (error) {
    env.warn('比賽歷史的參考圖無法顯示', error)
    return null
  }
}

function revokeUrls(urls: ReadonlyMap<string, string>): void {
  for (const url of urls.values()) URL.revokeObjectURL(url)
}

/** 釋放開著的那一筆的所有 object URL（畫與參考圖） */
function revokeOpen(open: HistoryOpen): void {
  revokeUrls(open.urls)
  if (open.referenceUrl !== null) URL.revokeObjectURL(open.referenceUrl)
}

/** 換上重讀的清單；開著的那一筆若還在就跟著更新（新補上的圖片建 URL），已不在清單裡（被修剪）就維持記憶體裡的內容 */
function setEntries(entries: HistoryRecord[]): void {
  useHistoryStore.setState((state) => {
    const record = state.open !== null ? entries.find((r) => r.id === state.open?.record.id) : undefined
    if (state.open === null || record === undefined) return { entries }
    return {
      entries,
      open: { record, urls: urlsFor(record.images, state.open.urls), referenceUrl: referenceUrlFor(record.reference, state.open.referenceUrl) },
    }
  })
}

/** 自己現在能不能看歷史（遊戲 store 的狀態 → historyDisplay.canViewHistory） */
function allowed(state: Pick<GameState, 'me' | 'round'>): boolean {
  return canViewHistory({ joined: state.me !== null, phase: state.round.phase, isSetter: selectIsSetter(state) })
}

/** 開啟一筆：不在可開的時機、清單裡沒有這個 id、或已經開著同一筆都不動作；換開另一筆時先 revoke 前一筆的 URL */
export function openHistory(id: number): void {
  const { entries, open } = useHistoryStore.getState()
  if (!allowed(useGameStore.getState()) || open?.record.id === id) return
  const record = entries.find((r) => r.id === id)
  if (record === undefined) return
  if (open !== null) revokeOpen(open)
  useHistoryStore.setState({ open: { record, urls: urlsFor(record.images), referenceUrl: referenceUrlFor(record.reference) } })
}

/** 關閉（回到目前的畫面）並 revoke 所有圖片的 URL；沒有開著時不動作 */
export function closeHistory(): void {
  const { open } = useHistoryStore.getState()
  if (open === null) return
  revokeOpen(open)
  useHistoryStore.setState({ open: null })
}

let refreshSeq = 0

/**
 * 重讀清單（入口開啟時、自己寫入後）：別的分頁可能寫了新紀錄。讀取失敗只 warn、清單維持原樣；不會 reject。
 * 連續呼叫時只採用最後一次的結果（較早的讀取晚回來不會蓋掉較新的）
 */
export function refreshHistory(): Promise<void> {
  const seq = ++refreshSeq
  return Promise.resolve()
    .then(() => env.db.getAll())
    .then(
      (entries) => {
        if (seq === refreshSeq) setEntries(entries)
      },
      (error: unknown) => env.warn('比賽歷史讀取失敗', error),
    )
}

// ─── 銜接：遊戲 store 與 socket ────────────────────────────────────────

/** 可注入的環境（測試以記憶體假實作與假時鐘代入） */
export interface HistoryEnv {
  db: HistoryDb
  now(): number
  warn(message: string, error: unknown): void
}

const defaultEnv: HistoryEnv = {
  db: createIndexedDbHistory(),
  now: () => Date.now(),
  warn: (message, error) => console.warn(`[draw-contest] ${message}`, error),
}

let env: HistoryEnv = defaultEnv

const newRecorder = (): HistoryRecorder => createHistoryRecorder({ ...env, onSaved: () => void refreshHistory() })

let recorder: HistoryRecorder = newRecorder()

/** socket/client 收到 contest:gallery 時呼叫（已加入才會被呼叫）：圖片補進記著的那一回合；沒有記著的回合時不動作 */
export function recordGalleryImage(image: GalleryImage): void {
  recorder.gallery(image)
}

/** socket/client 收到 contest:reference 時呼叫（Epic 20；已加入才會被呼叫）：先記著，建檔時一起存；已建檔的那一回合直接補上 */
export function recordReferenceImage(image: ReferenceImage): void {
  recorder.reference(image)
}

/** 排隊中的歷史寫入都做完時 resolve（測試用） */
export function historySettled(): Promise<void> {
  return recorder.settled()
}

/**
 * 啟動：訂閱遊戲 store，round 或 me 一變就 (1) 交給紀錄器判斷建檔／更新／停止、(2) 不在可看的時機時把開著的歷史關掉
 * （下一回合 drawing 開始、自己成為出題者、離開遊戲）；並讀一次清單。回傳停止函式（取消訂閱、關閉開著的歷史並 revoke URL）。
 * App 掛載時啟動一次（React StrictMode 會啟動兩次，第一次的停止函式會先被呼叫）
 */
export function startHistory(options: Partial<HistoryEnv> = {}): () => void {
  env = { ...defaultEnv, ...options }
  recorder = newRecorder()

  function sync(state: GameState): void {
    recorder.round(state.round, state.me)
    if (useHistoryStore.getState().open !== null && !allowed(state)) closeHistory()
  }

  const unsubscribe = useGameStore.subscribe((state, prev) => {
    if (state.round !== prev.round || state.me !== prev.me) sync(state)
  })
  sync(useGameStore.getState())
  void refreshHistory()
  return () => {
    unsubscribe()
    closeHistory()
  }
}
