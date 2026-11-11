// 自動交卷（spec/draw-contest/architecture.md §5、§5.5、§7；plan/draw-contest-mvp.md 決策 6、plan/hardening.md 決策 6）：
// drawing 中 round.endsAt 到時，若自己是參賽者且還沒交卷，匯出 PNG 送 contest:submit（含空白畫布）；
// server 在 endsAt 後 SUBMIT_GRACE_SECONDS 內仍收卷。送出成功（ack ok 或 ALREADY_SUBMITTED）才記該回合已自動交卷；
// 失敗（未連線、逾時、其他錯誤）不記，之後每次狀態變動（含重連快照）與每 AUTO_SUBMIT_RETRY_MS 重新判斷，
// 直到成功、收到不可重試的錯誤（NOT_DRAWING／NOT_PARTICIPANT／SUBMISSION_INVALID，記為放棄），或離開可交卷期間。
// 匯出與送出分開（決策 12、§5.5）：到時若未交卷，不論連線與否先把 PNG 匯出留在記憶體（每回合一次），之後的送出與重試都送這份；
// 換回合就丟掉。匯出失敗比照送出失敗（記 retrying，1 秒後、期限內可再匯出）。
// 判斷是純函式（autoSubmitDue／autoSubmitDelay），排程（startAutoSubmit）的時鐘、計時器、store 與送出都可注入，測試不靠真時間。
import { SUBMIT_GRACE_SECONDS, type RoundPublic } from '@fishing-work/shared/draw-contest'
import type { ActionOutcome } from '../../socket/client'
import { useGameStore, type ConnectionState } from '../../store/game'
import { exportMyCanvas, submitPreparedPng } from './submit'

/** 自動交卷失敗後，最快多久再試一次（也是可交卷期間內重新判斷的間隔） */
export const AUTO_SUBMIT_RETRY_MS = 1000

/** 收到就不再重試的錯誤（記為放棄）；其餘失敗（逾時、未連線、NOT_IN_ROOM、匯出失敗…）都會重試 */
const GIVE_UP_ERRORS: ReadonlySet<string> = new Set(['NOT_DRAWING', 'NOT_PARTICIPANT', 'SUBMISSION_INVALID'])

/** 判斷需要的狀態（store 的子集） */
export interface AutoSubmitView {
  me: string | null
  round: Pick<RoundPublic, 'roundNo' | 'phase' | 'endsAt' | 'participantIds'>
  submitted: boolean
  submitting: boolean
  /** 未連線不送（等重連快照再判斷，免得每秒匯出一次 PNG 再立刻失敗） */
  connection: ConnectionState
  /** 自動重新加入進行中不送（新連線尚未加入，server 會回 NOT_IN_ROOM） */
  autoJoining: boolean
}

/**
 * 某一回合的自動交卷紀錄（排程器保存；roundNo 不同即視為沒有紀錄）。
 * - none：還沒自動送過；retrying：送過但失敗、待重試；done：已交到（ok 或 ALREADY_SUBMITTED）；gaveUp：不可重試的錯誤
 */
export interface AutoSubmitRecord {
  roundNo: number
  status: 'none' | 'retrying' | 'done' | 'gaveUp'
  /** 最近一次失敗的本機時間（retrying 時有意義） */
  failedAt: number
  /** 本回合在 drawing 時看到的 endsAt＋SUBMIT_GRACE_SECONDS（本機時鐘）；沒看過 drawing（例如重新整理時已是 judging）為 null */
  deadline: number | null
}

/** 自己是否還欠一張卷：已加入、本回合參賽者、未交卷也不在交卷途中 */
function owesSubmission(v: AutoSubmitView): boolean {
  return v.me !== null && v.round.participantIds.includes(v.me) && !v.submitted && !v.submitting
}

/** 屬於目前回合的紀錄；沒有就是全新的 none */
function recordFor(v: AutoSubmitView, rec: AutoSubmitRecord | null): AutoSubmitRecord {
  return rec !== null && rec.roundNo === v.round.roundNo ? rec : { roundNo: v.round.roundNo, status: 'none', failedAt: 0, deadline: null }
}

/**
 * 是否在可交卷期間（不看連線）：
 * - drawing：本機時間到 endsAt 才算；
 * - judging：server 已截止作畫（可能本機時鐘較慢、或剛重新整理），第一次送不看本機時鐘（server 以自己的時鐘判斷寬限）；
 * - 重試（送過且失敗）另以本機的 deadline（endsAt＋寬限）為界，過了就不再試；server 回 NOT_DRAWING 也會停；
 * - 其餘階段不在期間內。
 */
function inSubmitWindow(v: AutoSubmitView, now: number, r: AutoSubmitRecord): boolean {
  const { phase, endsAt } = v.round
  const started = phase === 'judging' || (phase === 'drawing' && endsAt !== null && now >= endsAt)
  if (!started) return false
  if (r.status === 'retrying' && r.deadline !== null && now > r.deadline) return false
  return true
}

/** 不看連線：還欠卷、本回合未定案、在可交卷期間內、失敗過則已等滿 AUTO_SUBMIT_RETRY_MS */
function attemptDue(v: AutoSubmitView, now: number, r: AutoSubmitRecord): boolean {
  if (!owesSubmission(v) || r.status === 'done' || r.status === 'gaveUp') return false
  if (!inSubmitWindow(v, now, r)) return false
  return r.status === 'none' || now >= r.failedAt + AUTO_SUBMIT_RETRY_MS
}

/**
 * 此刻該把 PNG 匯出留存嗎（決策 12）：到時且本回合未交卷就匯出，**不論連線與否**；
 * 已留存或匯出中由排程器把關（每回合只匯出一次）
 */
export function autoExportDue(v: AutoSubmitView, now: number, rec: AutoSubmitRecord | null): boolean {
  return attemptDue(v, now, recordFor(v, rec))
}

/** 此刻該自動送出嗎（另需已有留存的 PNG、沒有送出在途，由排程器把關）：未連線或自動重新加入中不送 */
export function autoSubmitDue(v: AutoSubmitView, now: number, rec: AutoSubmitRecord | null): boolean {
  if (v.connection !== 'connected' || v.autoJoining) return false
  return attemptDue(v, now, recordFor(v, rec))
}

/**
 * 下一次重新判斷要等幾毫秒（排計時器用；一定 > 0）；不需要排程時為 null。
 * drawing 且 endsAt 未到 → 等到 endsAt；已在可交卷期間 → 等到可重試的時間，或每 AUTO_SUBMIT_RETRY_MS 看一次（例如等重連）
 */
export function autoSubmitDelay(v: AutoSubmitView, now: number, rec: AutoSubmitRecord | null): number | null {
  const r = recordFor(v, rec)
  if (!owesSubmission(v) || r.status === 'done' || r.status === 'gaveUp') return null
  const { phase, endsAt } = v.round
  if (phase === 'drawing' && endsAt !== null && now < endsAt) return endsAt - now
  if (!inSubmitWindow(v, now, r)) return null
  const retryAt = r.status === 'retrying' ? r.failedAt + AUTO_SUBMIT_RETRY_MS : 0
  return retryAt > now ? retryAt - now : AUTO_SUBMIT_RETRY_MS
}

/** 送出結果 → 紀錄的新狀態 */
export function nextStatus(outcome: ActionOutcome): AutoSubmitRecord['status'] {
  if (outcome.ok || outcome.error === 'ALREADY_SUBMITTED') return 'done'
  return GIVE_UP_ERRORS.has(outcome.error) ? 'gaveUp' : 'retrying'
}

export interface AutoSubmitDeps {
  getState(): AutoSubmitView
  /** 狀態變動時呼叫 listener；回傳取消訂閱 */
  subscribe(listener: () => void): () => void
  now(): number
  setTimer(fn: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
  /** 匯出自己的畫布為 PNG bytes（到時留存用） */
  exportPng(): Promise<ArrayBuffer>
  /** 送出已匯出的 PNG（不再重新匯出） */
  submit(png: ArrayBuffer): Promise<ActionOutcome>
}

const defaultDeps: AutoSubmitDeps = {
  getState: () => useGameStore.getState(),
  subscribe: (listener) => useGameStore.subscribe(listener),
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  exportPng: () => exportMyCanvas(),
  submit: (png) => submitPreparedPng(png),
}

/**
 * 啟動自動交卷：狀態每次變動就重新判斷並重排計時器；回傳停止函式。
 * 同一時間最多一個匯出、一個送出在途；每回合的 PNG 只匯出一次並留存到該回合定案或換回合。
 * App 掛載時啟動一次（React StrictMode 會啟動兩次，第一次的停止函式會先被呼叫）
 */
export function startAutoSubmit(deps: AutoSubmitDeps = defaultDeps): () => void {
  let timer: unknown = null
  let rec: AutoSubmitRecord | null = null
  /** 本回合已匯出留存的 PNG */
  let prepared: { roundNo: number; png: ArrayBuffer } | null = null
  /** 匯出中的回合（null＝沒有匯出在途） */
  let exportingRound: number | null = null
  let inFlight = false
  let stopped = false

  function clear(): void {
    if (timer !== null) deps.clearTimer(timer)
    timer = null
  }

  function startExport(target: AutoSubmitRecord): void {
    exportingRound = target.roundNo
    void deps.exportPng().then(
      (png) => {
        exportingRound = null
        if (stopped) return
        // 匯出期間換了回合：丟棄（不留到下一回合）
        if (deps.getState().round.roundNo === target.roundNo) prepared = { roundNo: target.roundNo, png }
        check()
      },
      () => {
        exportingRound = null
        if (stopped) return
        // 匯出失敗比照送出失敗：1 秒後（且在期限內）再試匯出
        target.status = 'retrying'
        target.failedAt = deps.now()
        check()
      },
    )
  }

  function check(): void {
    if (stopped) return
    clear()
    if (inFlight || exportingRound !== null) return // 完成時會再判斷
    const v = deps.getState()
    const now = deps.now()
    rec = recordFor(v, rec)
    if (prepared !== null && prepared.roundNo !== v.round.roundNo) prepared = null
    // 記下本回合的交卷期限（judging 時 endsAt 為 null，重試要用 drawing 時看到的那個）
    if (v.round.phase === 'drawing' && v.round.endsAt !== null) rec.deadline = v.round.endsAt + SUBMIT_GRACE_SECONDS * 1000
    if (prepared === null && autoExportDue(v, now, rec)) {
      startExport(rec)
      return
    }
    if (prepared !== null && autoSubmitDue(v, now, rec)) {
      const target = rec
      inFlight = true
      void deps
        .submit(prepared.png)
        .catch((): ActionOutcome => ({ ok: false, error: 'TIMEOUT', message: '交卷失敗' }))
        .then((outcome) => {
          inFlight = false
          target.status = nextStatus(outcome)
          target.failedAt = deps.now()
          // 定案（交到或放棄）就釋放留存的 PNG
          if (target.status !== 'retrying' && prepared?.roundNo === target.roundNo) prepared = null
          check()
        })
      return
    }
    const delay = autoSubmitDelay(v, now, rec)
    if (delay !== null) timer = deps.setTimer(check, delay)
  }

  const unsubscribe = deps.subscribe(check)
  check()
  return () => {
    stopped = true
    prepared = null
    unsubscribe()
    clear()
  }
}
