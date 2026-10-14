// 比賽歷史的時序與狀態（features/history/historyStore；Epic 17；plan/contest-history.md 決策 3、4、5、7、8、9）。
//   一、存檔內容的建立與合併（純函式）。
//   二、紀錄器（createHistoryRecorder；注入記憶體假 DB 與假時鐘）：ended 建檔 → gallery → comment（含 phase 已變 choosing 之後才到的）
//       → 下一回合 drawing 停止更新；沒人交卷不建檔；加入時非 ended 不建檔；重新整理後 ended 的合併（評語非 null 優先）；
//       第 6 場後最舊的被刪；me 的紀錄；DB 每個方法失敗時不拋出、只 warn。
//   三、接上遊戲 store（startHistory）：照 server 的事件順序驅動 store，清單在自己寫入後更新；開啟／關閉／換開另一筆的 object URL；
//       自動關閉（下一回合 drawing 開始、自己成為出題者、離開遊戲）；另一個分頁寫的紀錄在 refresh 後看得到。
// 沒有 DOM 與 IndexedDB：DB 用記憶體假實作（同一份介面，historyDb.test.ts 驗兩種實作行為一致），URL.createObjectURL／revokeObjectURL 以 spy 取代。
// 未處理的 rejection 會讓 Vitest 整個失敗，所以「失敗時不拋出」的案例同時也驗了沒有漏接的 promise。
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import type { GalleryImage, ResultEntry, RoomSnapshot, RoundPublic } from '@fishing-work/shared/draw-contest'
import { HISTORY_MAX, createMemoryHistoryDb, type HistoryDb, type HistoryRecord } from '../src/features/history/historyDb'
import {
  addImages,
  closeHistory,
  createHistoryRecorder,
  historySettled,
  mergeRecord,
  openHistory,
  recordFromRound,
  recordGalleryImage,
  refreshHistory,
  startHistory,
  useHistoryStore,
} from '../src/features/history/historyStore'
import { initialGameState, initialRound, useGameStore } from '../src/store/game'

const round = (patch: Partial<RoundPublic>): RoundPublic => ({ ...initialRound, ...patch })
const result = (playerId: string, rank: number, patch: Partial<ResultEntry> = {}): ResultEntry => ({
  playerId,
  nickname: playerId,
  rank,
  score: 100 - rank,
  confidence: 0.5,
  judgedBy: 'ai',
  submitted: true,
  submittedAt: rank,
  comment: null,
  commentPending: false,
  ...patch,
})
const png = (n = 8) => new Uint8Array(n).fill(1).buffer
const blob = (n = 8) => new Blob([new Uint8Array(n).fill(1)], { type: 'image/png' })
const image = (roundNo: number, playerId: string, n = 8): GalleryImage => ({ roundNo, playerId, png: png(n) })

/** 第 n 回合揭曉（startedAt = n × 1000）：a 第一名（評語產生中）、b 第二名、c 未交卷 */
const ended = (n: number, patch: Partial<RoundPublic> = {}): RoundPublic =>
  round({
    roundNo: n,
    phase: 'ended',
    setterId: 'a',
    startedAt: n * 1000,
    participantIds: ['a', 'b', 'c'],
    submittedCount: 2,
    judgedCount: 2,
    judgeMode: 'ai',
    commentMode: 'ai',
    lastTopic: `題目${n}`,
    results: [result('a', 1, { commentPending: true }), result('b', 2, { commentPending: true }), result('c', 3, { submitted: false, score: 0, judgedBy: null })],
    ...patch,
  })

/** 記憶體 DB 加上呼叫紀錄與「讓某個方法失敗」的開關 */
function spiedDb(initial: HistoryRecord[] = []) {
  const inner = createMemoryHistoryDb(initial)
  const calls = { getAll: 0, put: 0, update: 0, delete: 0 }
  const fail: Partial<Record<keyof HistoryDb, Error>> = {}
  const guard = <T>(name: keyof HistoryDb, work: () => Promise<T>): Promise<T> => {
    calls[name]++
    const error = fail[name]
    return error !== undefined ? Promise.reject(error) : work()
  }
  const db: HistoryDb = {
    getAll: () => guard('getAll', () => inner.getAll()),
    put: (record) => guard('put', () => inner.put(record)),
    update: (id, change) => guard('update', () => inner.update(id, change)),
    delete: (id) => guard('delete', () => inner.delete(id)),
  }
  return { db, calls, fail, rows: () => inner.getAll() }
}

function setup(initial: HistoryRecord[] = []) {
  const store = spiedDb(initial)
  const clock = { now: 5000 }
  const warn = vi.fn<(message: string, error: unknown) => void>()
  const onSaved = vi.fn<() => void>()
  const recorder = createHistoryRecorder({ db: store.db, now: () => clock.now, onSaved, warn })
  return { ...store, clock, warn, onSaved, recorder }
}

// ─── 一、存檔內容 ────────────────────────────────────────────────────

describe('recordFromRound／mergeRecord／addImages（純函式）', () => {
  it('recordFromRound：欄位照決策 3；題目用 lastTopic；commentPending 一律存 false（comment 留 null）；沒有圖片', () => {
    const record = recordFromRound(ended(3), 'b', 3000, 5000)
    expect(record).toEqual({
      id: 3000,
      savedAt: 5000,
      roundNo: 3,
      topic: '題目3',
      judgeMode: 'ai',
      commentMode: 'ai',
      me: 'b',
      results: [result('a', 1), result('b', 2), result('c', 3, { submitted: false, score: 0, judgedBy: null })],
      images: {},
    })
    expect(record.results.every((r) => r.commentPending === false)).toBe(true)
  })

  it('mergeRecord：沒有舊的 → 就是新的', () => {
    const incoming = recordFromRound(ended(1), 'a', 1000, 5000)
    expect(mergeRecord(undefined, incoming)).toBe(incoming)
  })

  it('mergeRecord：評語以非 null 優先——舊的有字、新快照是 null 就保留舊的；新快照有字就用新的', () => {
    const existing = recordFromRound(ended(1, { results: [result('a', 1, { comment: '早到的' }), result('b', 2)] }), 'a', 1000, 5000)
    const incoming = recordFromRound(ended(1, { results: [result('a', 1, { commentPending: true }), result('b', 2, { comment: '晚到的' })] }), 'a', 1000, 9000)
    const merged = mergeRecord(existing, incoming)
    expect(merged.results.map((r) => [r.playerId, r.comment, r.commentPending])).toEqual([
      ['a', '早到的', false],
      ['b', '晚到的', false],
    ])
  })

  it('mergeRecord：id、savedAt、roundNo、me、題目保留先寫的；評分器與評語器新的有值才換（idle／choosing 的 null 不蓋掉）', () => {
    const existing = recordFromRound(ended(1), 'a', 1000, 5000)
    const later = recordFromRound(ended(1, { phase: 'choosing', startedAt: null, judgeMode: null, commentMode: null, lastTopic: '別的' }), 'z', 1000, 9000)
    expect(mergeRecord(existing, later)).toBe(existing)
    const off = recordFromRound(ended(1, { commentMode: 'off', judgeMode: 'random' }), 'z', 1000, 9000)
    expect(mergeRecord(existing, off)).toMatchObject({ id: 1000, savedAt: 5000, roundNo: 1, me: 'a', topic: '題目1', commentMode: 'off', judgeMode: 'random' })
    // me、題目原本是空的才補
    expect(mergeRecord({ ...existing, me: null, topic: '' }, later)).toMatchObject({ me: 'z', topic: '別的' })
  })

  it('mergeRecord：沒有任何變化時回傳舊的那一個（呼叫端以此判斷不必寫入）', () => {
    const existing = { ...recordFromRound(ended(1), 'a', 1000, 5000), images: { a: blob() } }
    expect(mergeRecord(existing, recordFromRound(ended(1), 'a', 1000, 9000))).toBe(existing)
    expect(mergeRecord(existing, { ...recordFromRound(ended(1), 'a', 1000, 9000), images: { a: blob(16) } })).toBe(existing)
  })

  it('addImages：只補上沒有的，已有的不重寫；沒有新的回傳原物件', () => {
    const first = blob(8)
    const record = { ...recordFromRound(ended(1), 'a', 1000, 5000), images: { a: first } }
    expect(addImages(record, { a: blob(99) })).toBe(record)
    const more = addImages(record, { a: blob(99), b: blob(16) })
    expect(more.images.a).toBe(first)
    expect(more.images.b?.size).toBe(16)
    expect(record.images).toEqual({ a: first })
  })
})

// ─── 二、紀錄器的時序 ─────────────────────────────────────────────────

describe('紀錄器：ended 建檔 → gallery → comment → 下一回合 drawing 停止', () => {
  it('進入 ended（results 非 null、至少一人交卷）就建檔：id = startedAt、savedAt = 當下、me = 自己、pending 存成 false', async () => {
    const t = setup()
    t.recorder.round(round({ roundNo: 1, phase: 'drawing', startedAt: 1000, participantIds: ['a', 'b', 'c'] }), 'b')
    t.recorder.round(round({ roundNo: 1, phase: 'judging', startedAt: 1000, participantIds: ['a', 'b', 'c'] }), 'b')
    await t.recorder.settled()
    expect(await t.rows()).toEqual([])
    expect(t.recorder.active()).toBeNull()

    t.recorder.round(ended(1), 'b')
    expect(t.recorder.active()).toEqual({ id: 1000, roundNo: 1 })
    await t.recorder.settled()
    expect(await t.rows()).toEqual([
      {
        id: 1000,
        savedAt: 5000,
        roundNo: 1,
        topic: '題目1',
        judgeMode: 'ai',
        commentMode: 'ai',
        me: 'b',
        results: [result('a', 1), result('b', 2), result('c', 3, { submitted: false, score: 0, judgedBy: null })],
        images: {},
      },
    ])
    expect(t.onSaved).toHaveBeenCalledTimes(1)
    expect(t.warn).not.toHaveBeenCalled()
  })

  it('之後每收到一張圖就補進那一筆（image/png 的 Blob）；roundNo 不符、空的 png 不收；同一人重送不重寫', async () => {
    const t = setup()
    t.recorder.round(ended(1), 'b')
    await t.recorder.settled()
    t.recorder.gallery(image(1, 'a', 8))
    await t.recorder.settled()
    t.recorder.gallery(image(1, 'b', 16))
    t.recorder.gallery(image(2, 'x'))
    t.recorder.gallery(image(0, 'y'))
    t.recorder.gallery({ roundNo: 1, playerId: 'z', png: new ArrayBuffer(0) })
    await t.recorder.settled()
    const [saved] = await t.rows()
    expect(Object.keys(saved?.images ?? {}).sort()).toEqual(['a', 'b'])
    expect(saved?.images.a).toBeInstanceOf(Blob)
    expect([saved?.images.a?.type, saved?.images.a?.size, saved?.images.b?.size]).toEqual(['image/png', 8, 16])
    expect(t.onSaved).toHaveBeenCalledTimes(3)

    // 重新送同一個人的圖：內容不變，不算寫入（清單不必重讀）
    const before = saved?.images.a
    t.recorder.gallery(image(1, 'a', 99))
    await t.recorder.settled()
    expect((await t.rows())[0]?.images.a).toBe(before)
    expect(t.onSaved).toHaveBeenCalledTimes(3)
  })

  it('評語晚到（contest:comment 補進 store 的 results）：更新那一筆；savedAt 維持首次建檔時間', async () => {
    const t = setup()
    t.recorder.round(ended(1), 'b')
    await t.recorder.settled()
    t.clock.now = 9000
    t.recorder.round(ended(1, { results: [result('a', 1, { commentPending: true }), result('b', 2, { comment: '雜魚～' }), result('c', 3, { submitted: false })] }), 'b')
    await t.recorder.settled()
    const [saved] = await t.rows()
    expect(saved?.savedAt).toBe(5000)
    expect(saved?.results.map((r) => [r.playerId, r.comment, r.commentPending])).toEqual([
      ['a', null, false],
      ['b', '雜魚～', false],
      ['c', null, false],
    ])
  })

  it('phase 已變成 idle／choosing（startedAt 被清成 null、judgeMode／commentMode 回 null）之後才到的評語與圖照樣更新同一筆', async () => {
    const t = setup()
    t.recorder.round(ended(1), 'b')
    await t.recorder.settled()
    const choosing = (results: ResultEntry[]) =>
      ended(1, { phase: 'choosing', setterId: 'a', startedAt: null, endsAt: 99, judgeMode: null, commentMode: null, results })
    t.recorder.round(choosing([result('a', 1, { commentPending: true }), result('b', 2, { commentPending: true })]), 'b')
    expect(t.recorder.active()).toEqual({ id: 1000, roundNo: 1 })
    // 第一名的稱讚版在別人按了「我出題」之後才寫好
    t.recorder.round(choosing([result('a', 1, { comment: '還算可以啦' }), result('b', 2, { commentPending: true })]), 'b')
    t.recorder.gallery(image(1, 'a'))
    await t.recorder.settled()
    // 取消出題回到 idle：另一則評語也到了
    t.recorder.round(ended(1, { phase: 'idle', setterId: null, startedAt: null, results: [result('a', 1, { comment: '還算可以啦' }), result('b', 2, { comment: '雜魚～' })] }), 'b')
    await t.recorder.settled()
    const rows = await t.rows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 1000, savedAt: 5000, topic: '題目1', judgeMode: 'ai', commentMode: 'ai', me: 'b' })
    expect(rows[0]?.results.map((r) => r.comment)).toEqual(['還算可以啦', '雜魚～'])
    expect(Object.keys(rows[0]?.images ?? {})).toEqual(['a'])
  })

  it('下一回合 drawing 開始就放掉：之後上一回合遲到的圖、同 roundNo 的更新都不再寫', async () => {
    const t = setup()
    t.recorder.round(ended(1), 'b')
    t.recorder.gallery(image(1, 'a'))
    await t.recorder.settled()
    const snapshot = await t.rows()
    const writes = t.calls.update

    t.recorder.round(round({ roundNo: 2, phase: 'drawing', startedAt: 2000, topic: '新題目', participantIds: ['a', 'b'] }), 'b')
    expect(t.recorder.active()).toBeNull()
    t.recorder.gallery(image(1, 'b'))
    t.recorder.gallery(image(2, 'b'))
    t.recorder.round(round({ roundNo: 2, phase: 'judging', startedAt: 2000, participantIds: ['a', 'b'] }), 'b')
    await t.recorder.settled()
    expect(await t.rows()).toEqual(snapshot)
    expect(t.calls.update).toBe(writes)
  })

  it('漏收 drawing、直接看到下一回合的 judging 或 ended：一樣放掉上一筆；新的 ended 另建一筆', async () => {
    const t = setup()
    t.recorder.round(ended(1), 'b')
    await t.recorder.settled()
    t.recorder.round(round({ roundNo: 2, phase: 'judging', startedAt: 2000 }), 'b')
    expect(t.recorder.active()).toBeNull()
    t.clock.now = 6000
    t.recorder.round(ended(2), 'b')
    expect(t.recorder.active()).toEqual({ id: 2000, roundNo: 2 })
    t.recorder.gallery(image(1, 'a'))
    t.recorder.gallery(image(2, 'a'))
    await t.recorder.settled()
    const rows = await t.rows()
    expect(rows.map((r) => [r.id, r.savedAt, Object.keys(r.images)])).toEqual([
      [2000, 6000, ['a']],
      [1000, 5000, []],
    ])
  })

  it('離開遊戲（me 變 null）就放掉；重新加入時 phase 不是 ended 不會接回去', async () => {
    const t = setup()
    t.recorder.round(ended(1), 'b')
    await t.recorder.settled()
    t.recorder.round(initialRound, null)
    expect(t.recorder.active()).toBeNull()
    // 重新加入：同一回合但已經 idle（startedAt 是 null）
    t.recorder.round(ended(1, { phase: 'idle', startedAt: null }), 'b2')
    expect(t.recorder.active()).toBeNull()
    t.recorder.gallery(image(1, 'a'))
    await t.recorder.settled()
    expect((await t.rows())[0]?.images).toEqual({})
  })
})

describe('紀錄器：不建檔的情況', () => {
  it('沒人交卷的回合不存（免得佔名額）；results 是空陣列也不存', async () => {
    const t = setup()
    t.recorder.round(ended(1, { results: [result('a', 1, { submitted: false }), result('b', 2, { submitted: false })] }), 'a')
    t.recorder.round(ended(2, { results: [] }), 'a')
    t.recorder.gallery(image(1, 'a'))
    await t.recorder.settled()
    expect(await t.rows()).toEqual([])
    expect(t.recorder.active()).toBeNull()
    expect(t.calls.update).toBe(0)
  })

  it.each(['idle', 'choosing'] as const)('加入或重新整理時 phase 是 %s（results 還在、startedAt 已是 null）：不建檔，補收的圖也不存', async (phase) => {
    const t = setup()
    t.recorder.round(ended(4, { phase, startedAt: null }), 'late')
    t.recorder.gallery(image(4, 'a'))
    t.recorder.gallery(image(4, 'b'))
    t.recorder.round(ended(4, { phase, startedAt: null, results: [result('a', 1, { comment: '晚到' }), result('b', 2)] }), 'late')
    await t.recorder.settled()
    expect(await t.rows()).toEqual([])
    expect(t.calls.update).toBe(0)
  })

  it('還沒加入（me 為 null）、results 是 null、ended 卻沒有 startedAt：都不建檔', async () => {
    const t = setup()
    t.recorder.round(ended(1), null)
    t.recorder.round(ended(1, { results: null }), 'a')
    t.recorder.round(ended(1, { startedAt: null }), 'a')
    await t.recorder.settled()
    expect(await t.rows()).toEqual([])
  })

  it('中途加入、旁觀到 ended：照樣建檔（自己不在 results 裡，me 仍記下來）', async () => {
    const t = setup()
    t.recorder.round(ended(1), 'spectator')
    await t.recorder.settled()
    expect((await t.rows())[0]).toMatchObject({ id: 1000, me: 'spectator' })
  })
})

describe('紀錄器：重新整理後在 ended 補收的資料以相同 id 合併（決策 4、Q7）', () => {
  it('已有的評語不被較舊的快照蓋掉（非 null 優先）、沒有的補上；圖片逐張補上、已有的不重寫；savedAt 與 me 不變', async () => {
    const kept = blob(8)
    const saved: HistoryRecord = {
      ...recordFromRound(ended(1, { results: [result('a', 1, { comment: '早到的' }), result('b', 2), result('c', 3, { submitted: false })] }), 'b', 1000, 5000),
      images: { a: kept },
    }
    // 重新整理＝新的紀錄器（記憶體裡什麼都不記得），DB 裡已有那一筆
    const t = setup([saved])
    t.clock.now = 9000
    // 重新加入拿到的快照：a 的評語這邊是 null／產生中（較舊或被重設），b 的已經寫好
    t.recorder.round(ended(1, { results: [result('a', 1, { commentPending: true }), result('b', 2, { comment: '晚到的' }), result('c', 3, { submitted: false })] }), 'b2')
    // join ack 之後補送的畫廊
    t.recorder.gallery(image(1, 'a', 99))
    t.recorder.gallery(image(1, 'b', 16))
    await t.recorder.settled()
    const rows = await t.rows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 1000, savedAt: 5000, me: 'b', topic: '題目1' })
    expect(rows[0]?.results.map((r) => [r.playerId, r.comment, r.commentPending])).toEqual([
      ['a', '早到的', false],
      ['b', '晚到的', false],
      ['c', null, false],
    ])
    expect(rows[0]?.images.a).toBe(kept)
    expect(rows[0]?.images.b?.size).toBe(16)
  })

  it('重新整理後拿到的內容與存檔完全相同：不寫入、不重讀清單', async () => {
    const saved = recordFromRound(ended(1), 'b', 1000, 5000)
    const t = setup([saved])
    t.recorder.round(ended(1), 'b')
    await t.recorder.settled()
    expect((await t.rows())[0]).toBe(saved)
    expect(t.onSaved).not.toHaveBeenCalled()
    expect(t.calls.delete).toBe(0)
  })
})

describe(`紀錄器：只留最近 ${HISTORY_MAX} 場（決策 5）`, () => {
  it('第 6 場建檔後最舊的那一筆被刪；之後每多一場再刪一筆', async () => {
    const t = setup()
    for (let n = 1; n <= 5; n++) {
      t.clock.now = n * 10
      t.recorder.round(round({ roundNo: n, phase: 'drawing', startedAt: n * 1000 }), 'a')
      t.recorder.round(ended(n), 'a')
      t.recorder.gallery(image(n, 'a'))
      await t.recorder.settled()
    }
    expect((await t.rows()).map((r) => r.id)).toEqual([5000, 4000, 3000, 2000, 1000])
    expect(t.calls.delete).toBe(0)

    t.clock.now = 60
    t.recorder.round(round({ roundNo: 6, phase: 'drawing', startedAt: 6000 }), 'a')
    t.recorder.round(ended(6), 'a')
    await t.recorder.settled()
    expect((await t.rows()).map((r) => r.id)).toEqual([6000, 5000, 4000, 3000, 2000])
    expect(t.calls.delete).toBe(1)

    t.clock.now = 70
    t.recorder.round(ended(7), 'a')
    await t.recorder.settled()
    expect((await t.rows()).map((r) => [r.id, r.savedAt])).toEqual([
      [7000, 70],
      [6000, 60],
      [5000, 50],
      [4000, 40],
      [3000, 30],
    ])
  })

  it('已被修剪掉（或建檔那次失敗）的那一筆：之後到的圖與評語不會把它建回來', async () => {
    const t = setup()
    t.recorder.round(ended(1), 'a')
    await t.recorder.settled()
    await t.db.delete(1000)
    t.recorder.gallery(image(1, 'a'))
    t.recorder.round(ended(1, { phase: 'idle', startedAt: null, results: [result('a', 1, { comment: '晚到' })] }), 'a')
    await t.recorder.settled()
    expect(await t.rows()).toEqual([])
    expect(t.onSaved).toHaveBeenCalledTimes(1)
  })
})

describe('紀錄器：寫入依序、合併', () => {
  it('建檔還沒寫出去就到的多張圖：與建檔併成一次寫入', async () => {
    const t = setup()
    t.recorder.round(ended(1), 'a')
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) t.recorder.gallery(image(1, id))
    await t.recorder.settled()
    expect(Object.keys((await t.rows())[0]?.images ?? {}).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(t.calls.update).toBe(1)
    expect(t.onSaved).toHaveBeenCalledTimes(1)
  })

  it('前一次寫入還在進行中時陸續到的圖：等它做完後併成一次寫入（不是一張寫一次，也不與前一次交錯）', async () => {
    const inner = createMemoryHistoryDb()
    const order: string[] = []
    let release = () => {}
    let gated = true
    const db: HistoryDb = {
      ...inner,
      update: async (id, change) => {
        order.push('update:start')
        if (gated) await new Promise<void>((resolve) => (release = resolve))
        const written = await inner.update(id, change)
        order.push('update:end')
        return written
      },
    }
    const recorder = createHistoryRecorder({ db, now: () => 5000, onSaved: () => {}, warn: () => {} })
    recorder.round(ended(1), 'a')
    await vi.waitFor(() => expect(order).toEqual(['update:start']))
    // 建檔的寫入卡著的期間，三張圖分三次到
    for (const id of ['a', 'b', 'c']) {
      recorder.gallery(image(1, id))
      await Promise.resolve()
    }
    expect(order).toEqual(['update:start'])
    gated = false
    release()
    await recorder.settled()
    expect(order).toEqual(['update:start', 'update:end', 'update:start', 'update:end'])
    expect(Object.keys((await inner.getAll())[0]?.images ?? {}).sort()).toEqual(['a', 'b', 'c'])
  })

  it('還沒寫出去就接連來了兩個快照（ended 的評語、接著 choosing 把評語器清成 null）：合併後一次建檔，欄位不被後到的 null 蓋掉', async () => {
    const t = setup()
    t.recorder.round(ended(1, { results: [result('a', 1, { comment: '早到的' }), result('b', 2, { commentPending: true })] }), 'a')
    t.recorder.round(ended(1, { phase: 'choosing', startedAt: null, judgeMode: null, commentMode: null, results: [result('a', 1), result('b', 2, { comment: '晚到的' })] }), 'a')
    await t.recorder.settled()
    expect(t.calls.update).toBe(1)
    expect((await t.rows())[0]).toMatchObject({ id: 1000, savedAt: 5000, judgeMode: 'ai', commentMode: 'ai' })
    expect((await t.rows())[0]?.results.map((r) => r.comment)).toEqual(['早到的', '晚到的'])
  })

  it('settled：寫入途中又排了新的也等到全部做完', async () => {
    const t = setup()
    t.recorder.round(ended(1), 'a')
    const done = t.recorder.settled()
    queueMicrotask(() => t.recorder.gallery(image(1, 'a')))
    await done
    await t.recorder.settled()
    expect(Object.keys((await t.rows())[0]?.images ?? {})).toEqual(['a'])
  })
})

describe('紀錄器：DB 不可用時靜默（決策 9）——每個方法失敗都不拋出，只 warn', () => {
  it('update 失敗（建檔寫不進去）：warn 一次、不拋出；之後的事件照常處理、不會卡住', async () => {
    const t = setup()
    t.fail.update = new Error('QuotaExceededError')
    expect(() => t.recorder.round(ended(1), 'a')).not.toThrow()
    expect(() => t.recorder.gallery(image(1, 'a'))).not.toThrow()
    await expect(t.recorder.settled()).resolves.toBeUndefined()
    expect(t.warn).toHaveBeenCalledTimes(1)
    expect(t.warn.mock.calls[0]?.[0]).toBe('比賽歷史寫入失敗')
    expect(t.warn.mock.calls[0]?.[1]).toBe(t.fail.update)
    expect(t.onSaved).not.toHaveBeenCalled()

    // 恢復後下一回合照常建檔（佇列沒有被前一次失敗卡死）
    delete t.fail.update
    t.recorder.round(ended(2), 'a')
    await t.recorder.settled()
    expect((await t.rows()).map((r) => r.id)).toEqual([2000])
  })

  it('getAll 失敗（修剪讀不到）：寫入已完成，warn、清單照樣通知更新', async () => {
    const t = setup()
    t.fail.getAll = new Error('read failed')
    t.recorder.round(ended(1), 'a')
    await expect(t.recorder.settled()).resolves.toBeUndefined()
    expect(t.warn.mock.calls.map((c) => c[0])).toEqual(['比賽歷史修剪失敗'])
    expect(t.onSaved).toHaveBeenCalledTimes(1)
  })

  it('delete 失敗（修剪刪不掉）：warn、不拋出', async () => {
    const t = setup(Array.from({ length: 5 }, (_, i) => recordFromRound(ended(i + 1), 'a', (i + 1) * 1000, i + 1)))
    t.fail.delete = new Error('delete failed')
    t.recorder.round(ended(9), 'a')
    await expect(t.recorder.settled()).resolves.toBeUndefined()
    expect(t.warn.mock.calls.map((c) => c[0])).toEqual(['比賽歷史修剪失敗'])
    expect(await t.rows()).toHaveLength(6)
  })

  it('DB 的方法同步丟例外、onSaved 丟例外：一樣接住', async () => {
    const warn = vi.fn<(message: string, error: unknown) => void>()
    const broken: HistoryDb = {
      getAll: () => {
        throw new Error('sync getAll')
      },
      put: () => {
        throw new Error('sync put')
      },
      update: () => {
        throw new Error('sync update')
      },
      delete: () => {
        throw new Error('sync delete')
      },
    }
    const recorder = createHistoryRecorder({ db: broken, now: () => 1, onSaved: () => {}, warn })
    expect(() => recorder.round(ended(1), 'a')).not.toThrow()
    await expect(recorder.settled()).resolves.toBeUndefined()
    expect(warn.mock.calls.map((c) => c[0])).toEqual(['比賽歷史寫入失敗'])

    const t = setup()
    t.onSaved.mockImplementation(() => {
      throw new Error('listener bug')
    })
    t.recorder.round(ended(1), 'a')
    await expect(t.recorder.settled()).resolves.toBeUndefined()
    expect(t.warn.mock.calls.map((c) => c[0])).toEqual(['比賽歷史清單更新失敗'])
  })
})

// ─── 三、接上遊戲 store 與檢視狀態 ────────────────────────────────────────

const game = () => useGameStore.getState()
const history = () => useHistoryStore.getState()
const snapshot = (patch: Partial<RoomSnapshot>): RoomSnapshot => ({ you: 'b', players: [], round: initialRound, chat: [], ...patch })

let created: MockInstance<typeof URL.createObjectURL>
let revoked: MockInstance<typeof URL.revokeObjectURL>
let stop: (() => void) | null = null

/** 啟動歷史（記憶體 DB、假時鐘、warn 收集起來） */
function start(initial: HistoryRecord[] = []) {
  const store = spiedDb(initial)
  const clock = { now: 5000 }
  const warn = vi.fn<(message: string, error: unknown) => void>()
  stop = startHistory({ db: store.db, now: () => clock.now, warn })
  return { ...store, clock, warn }
}

/** 寫入與清單重讀都做完 */
async function flushed(): Promise<void> {
  await historySettled()
  await refreshHistory()
}

/** 照 server 的順序收一張畫廊圖：store 建 object URL、歷史拿原始 PNG（socket/client 的 contest:gallery 處理） */
function receiveGallery(roundNo: number, playerId: string, n = 8) {
  game().addGalleryImage(image(roundNo, playerId, n))
  recordGalleryImage(image(roundNo, playerId, n))
}

beforeEach(() => {
  useGameStore.setState({ ...initialGameState, gallery: new Map() })
  useHistoryStore.setState({ entries: [], open: null })
  let seq = 0
  created = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test/${++seq}`)
  revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
})

afterEach(() => {
  stop?.()
  stop = null
  vi.restoreAllMocks()
})

describe('startHistory：訂閱遊戲 store（照 server 的事件順序）', () => {
  it('加入 → drawing → judging → ended → 畫廊 → 評語（choosing 之後才到）→ 下一回合：存檔內容與清單一路跟上', async () => {
    const t = start()
    game().applySnapshot(snapshot({ you: 'b' }))
    game().setRound(round({ roundNo: 1, phase: 'choosing', setterId: 'a', endsAt: 1 }))
    game().setRound(round({ roundNo: 1, phase: 'drawing', setterId: 'a', topic: '題目1', startedAt: 1000, participantIds: ['a', 'b', 'c'] }))
    game().setRound(round({ roundNo: 1, phase: 'judging', setterId: 'a', topic: '題目1', startedAt: 1000, participantIds: ['a', 'b', 'c'] }))
    await flushed()
    expect(history().entries).toEqual([])

    game().setRound(ended(1))
    receiveGallery(1, 'a')
    receiveGallery(1, 'b', 16)
    await flushed()
    // 本分頁自己寫入後清單就更新（不必等「檔案」選單重讀）
    expect(history().entries.map((r) => [r.id, r.me, r.topic, Object.keys(r.images).sort()])).toEqual([[1000, 'b', '題目1', ['a', 'b']]])
    expect(history().entries[0]?.results.map((r) => r.commentPending)).toEqual([false, false, false])

    // 揭曉後才到的評語（store 的 applyComment）
    game().applyComment({ roundNo: 1, playerId: 'b', comment: '雜魚～' })
    // 有人按「我出題」：phase 變 choosing、startedAt 清成 null；第一名的稱讚版這時才到
    game().setRound(ended(1, { phase: 'choosing', setterId: 'c', startedAt: null, endsAt: 99, judgeMode: null, commentMode: null, results: game().round.results }))
    game().applyComment({ roundNo: 1, playerId: 'a', comment: '還算可以啦' })
    await flushed()
    expect(history().entries[0]?.results.map((r) => r.comment)).toEqual(['還算可以啦', '雜魚～', null])
    expect(history().entries[0]).toMatchObject({ savedAt: 5000, judgeMode: 'ai', commentMode: 'ai' })

    // 下一回合 drawing 開始：停止更新；上一回合遲到的評語事件不再寫
    const writes = t.calls.update
    game().setRound(round({ roundNo: 2, phase: 'drawing', setterId: 'c', topic: '題目2', startedAt: 2000, participantIds: ['a', 'b', 'c'] }))
    recordGalleryImage(image(1, 'c'))
    game().applyComment({ roundNo: 1, playerId: 'c', comment: '太晚了' })
    await flushed()
    expect(t.calls.update).toBe(writes)
    expect(history().entries).toHaveLength(1)
    expect(t.warn).not.toHaveBeenCalled()
  })

  it('加入時就是 ended（中途加入或重新整理）：建檔並收下補送的畫廊；加入時是 idle 則不建', async () => {
    start()
    game().applySnapshot(snapshot({ you: 'late', round: ended(3) }))
    receiveGallery(3, 'a')
    await flushed()
    expect(history().entries.map((r) => [r.id, r.me, Object.keys(r.images)])).toEqual([[3000, 'late', ['a']]])

    stop?.()
    useGameStore.setState({ ...initialGameState, gallery: new Map() })
    useHistoryStore.setState({ entries: [], open: null })
    start()
    game().applySnapshot(snapshot({ you: 'late', round: ended(4, { phase: 'idle', startedAt: null }) }))
    receiveGallery(4, 'a')
    await flushed()
    expect(history().entries).toEqual([])
  })

  it('啟動時讀一次清單（之前存的看得到）；還沒加入時不寫任何東西', async () => {
    const old = recordFromRound(ended(1), 'x', 1000, 10)
    const t = start([old])
    await flushed()
    expect(history().entries).toEqual([old])
    expect(t.calls.update).toBe(0)
  })

  it('停止後不再紀錄（StrictMode 的第一次啟動會先被停止）', async () => {
    const t = start()
    stop?.()
    stop = null
    game().applySnapshot(snapshot({ you: 'b', round: ended(1) }))
    await flushed()
    expect(t.calls.update).toBe(0)
  })

  it('refreshHistory：另一個分頁寫的新紀錄重讀後看得到；讀取失敗只 warn、清單維持原樣、不拋出', async () => {
    const t = start()
    await flushed()
    expect(history().entries).toEqual([])
    await t.db.put(recordFromRound(ended(2), 'other', 2000, 20))
    await refreshHistory()
    expect(history().entries.map((r) => r.id)).toEqual([2000])

    t.fail.getAll = new Error('blocked')
    await expect(refreshHistory()).resolves.toBeUndefined()
    expect(history().entries.map((r) => r.id)).toEqual([2000])
    expect(t.warn.mock.calls.map((c) => c[0])).toEqual(['比賽歷史讀取失敗'])
  })

  it('refreshHistory 連續呼叫：只採用最後一次的結果（較早的讀取晚回來不會蓋掉較新的）', async () => {
    const releases: (() => void)[] = []
    const lists = [[recordFromRound(ended(1), 'a', 1000, 1)], [recordFromRound(ended(2), 'a', 2000, 2)]]
    const slow: HistoryDb = {
      ...createMemoryHistoryDb(),
      getAll: () => {
        const list = lists.shift() ?? []
        return new Promise((resolve) => releases.push(() => resolve(list)))
      },
    }
    stop = startHistory({ db: slow, warn: () => {} })
    const second = refreshHistory()
    const third = refreshHistory()
    // 讀取的先後：啟動時那一次（拿到第 1 份）、second（第 2 份）、third（空的）；讓最早的最後才回來
    await vi.waitFor(() => expect(releases).toHaveLength(3))
    releases[2]?.()
    releases[1]?.()
    releases[0]?.()
    await Promise.all([second, third])
    expect(history().entries).toEqual([])
  })

  it('IndexedDB 不可用（預設環境，Node 沒有 indexedDB）：遊戲照常、清單是空的、只 console.warn、沒有未處理的錯誤', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    stop = startHistory()
    game().applySnapshot(snapshot({ you: 'b', round: ended(1) }))
    receiveGallery(1, 'a')
    game().applyComment({ roundNo: 1, playerId: 'a', comment: '好' })
    await flushed()
    expect(history().entries).toEqual([])
    expect(game().round.results?.[0]?.comment).toBe('好')
    expect(game().gallery.size).toBe(1)
    expect(warn).toHaveBeenCalled()
    for (const call of warn.mock.calls) {
      expect(call[0]).toMatch(/^\[draw-contest\] 比賽歷史(寫入|讀取)失敗$/)
      expect(String(call[1])).toContain('IndexedDB 不可用')
    }
    // 沒有存檔可開
    openHistory(1000)
    expect(history().open).toBeNull()
  })
})

describe('檢視：開啟、關閉與 object URL（決策 8）', () => {
  const withImages = (n: number, ids: string[]): HistoryRecord => ({
    ...recordFromRound(ended(n), 'b', n * 1000, n),
    images: Object.fromEntries(ids.map((id) => [id, blob()])),
  })

  /** 已加入、idle（可以看歷史）、DB 裡有兩筆 */
  async function ready() {
    const t = start([withImages(1, ['a', 'b']), withImages(2, ['a'])])
    game().applySnapshot(snapshot({ you: 'b' }))
    await flushed()
    created.mockClear()
    return t
  }

  it('開啟一筆：從每張圖的 Blob 建 object URL；清單裡沒有的 id、已經開著的同一筆不動作', async () => {
    await ready()
    openHistory(1000)
    expect(history().open?.record.id).toBe(1000)
    expect([...(history().open?.urls ?? [])]).toEqual([
      ['a', 'blob:test/1'],
      ['b', 'blob:test/2'],
    ])
    expect(created).toHaveBeenCalledTimes(2)
    expect(created.mock.calls.every((c) => c[0] instanceof Blob)).toBe(true)

    openHistory(1000)
    openHistory(4242)
    expect(created).toHaveBeenCalledTimes(2)
    expect(revoked).not.toHaveBeenCalled()
    expect(history().open?.record.id).toBe(1000)
  })

  it('關閉：全部 revoke；沒有開著時再關不動作', async () => {
    await ready()
    openHistory(1000)
    closeHistory()
    expect(history().open).toBeNull()
    expect(revoked.mock.calls.map((c) => c[0]).sort()).toEqual(['blob:test/1', 'blob:test/2'])
    closeHistory()
    expect(revoked).toHaveBeenCalledTimes(2)
  })

  it('換開另一筆：先 revoke 前一筆的，再建新的', async () => {
    await ready()
    openHistory(1000)
    openHistory(2000)
    expect(history().open?.record.id).toBe(2000)
    expect(revoked.mock.calls.map((c) => c[0]).sort()).toEqual(['blob:test/1', 'blob:test/2'])
    expect([...(history().open?.urls ?? [])]).toEqual([['a', 'blob:test/3']])
    closeHistory()
    expect(revoked).toHaveBeenCalledTimes(3)
    expect(revoked).toHaveBeenLastCalledWith('blob:test/3')
  })

  it('停止（startHistory 的停止函式，App 卸載時）：關閉開著的那一筆並 revoke', async () => {
    await ready()
    openHistory(1000)
    stop?.()
    stop = null
    expect(history().open).toBeNull()
    expect(revoked).toHaveBeenCalledTimes(2)
  })

  it('開著的那一筆被更新（圖片陸續補上）：只替新的圖建 URL，原本的 URL 沿用（畫面上的圖不閃）', async () => {
    const t = start()
    game().applySnapshot(snapshot({ you: 'b', round: ended(1) }))
    recordGalleryImage(image(1, 'a'))
    await flushed()
    created.mockClear()
    openHistory(1000)
    expect([...(history().open?.urls ?? [])]).toEqual([['a', 'blob:test/1']])

    recordGalleryImage(image(1, 'b'))
    game().applyComment({ roundNo: 1, playerId: 'a', comment: '好' })
    await flushed()
    expect([...(history().open?.urls ?? [])]).toEqual([
      ['a', 'blob:test/1'],
      ['b', 'blob:test/2'],
    ])
    expect(created).toHaveBeenCalledTimes(2)
    expect(revoked).not.toHaveBeenCalled()
    expect(history().open?.record.results[0]?.comment).toBe('好')

    // 開著的那一筆被別的分頁修剪掉：維持記憶體裡的內容，URL 不動
    await t.db.delete(1000)
    await refreshHistory()
    expect(history().entries).toEqual([])
    expect(history().open?.record.id).toBe(1000)
    expect(revoked).not.toHaveBeenCalled()
    closeHistory()
    expect(revoked).toHaveBeenCalledTimes(2)
  })
})

describe('檢視：可開的時機與自動關閉（決策 7、7a；design §3.1）', () => {
  const saved = (n: number): HistoryRecord => ({ ...recordFromRound(ended(n), 'b', n * 1000, n), images: { a: blob() } })

  async function ready(current: RoundPublic) {
    const t = start([saved(1)])
    game().applySnapshot(snapshot({ you: 'b', round: current }))
    await flushed()
    created.mockClear()
    return t
  }

  it.each([
    ['idle', round({ phase: 'idle' })],
    ['ended', ended(7)],
    ['choosing（別人出題）', round({ roundNo: 7, phase: 'choosing', setterId: 'a' })],
  ])('可開：%s', async (_name, current) => {
    await ready(current)
    openHistory(1000)
    expect(history().open?.record.id).toBe(1000)
  })

  it.each([
    ['drawing', round({ roundNo: 7, phase: 'drawing', startedAt: 7000, participantIds: ['a', 'b'] })],
    ['judging', round({ roundNo: 7, phase: 'judging', startedAt: 7000, participantIds: ['a', 'b'] })],
    ['choosing（自己出題）', round({ roundNo: 7, phase: 'choosing', setterId: 'b' })],
  ])('不可開：%s（openHistory 不動作、不建 URL）', async (_name, current) => {
    await ready(current)
    openHistory(1000)
    expect(history().open).toBeNull()
    expect(created).not.toHaveBeenCalled()
  })

  it('未加入（me 為 null）不可開', async () => {
    start([saved(1)])
    await flushed()
    openHistory(1000)
    expect(history().open).toBeNull()
  })

  it('下一回合 drawing 開始：自動關閉並 revoke', async () => {
    await ready(round({ roundNo: 7, phase: 'choosing', setterId: 'a' }))
    openHistory(1000)
    game().setRound(round({ roundNo: 8, phase: 'drawing', setterId: 'a', startedAt: 8000, participantIds: ['a', 'b'] }))
    expect(history().open).toBeNull()
    expect(revoked).toHaveBeenCalledWith('blob:test/1')
  })

  it('自己成為出題者（choosing、setterId 是自己）：自動關閉；別人成為出題者則不關', async () => {
    await ready(round({ phase: 'idle' }))
    openHistory(1000)
    game().setRound(round({ phase: 'choosing', setterId: 'a', endsAt: 1 }))
    expect(history().open?.record.id).toBe(1000)
    game().setRound(round({ phase: 'idle' }))
    expect(history().open?.record.id).toBe(1000)
    expect(revoked).not.toHaveBeenCalled()
    game().setRound(round({ phase: 'choosing', setterId: 'b', endsAt: 1 }))
    expect(history().open).toBeNull()
    expect(revoked).toHaveBeenCalledWith('blob:test/1')
  })

  it('漏收 drawing、直接變成 judging：也關閉', async () => {
    await ready(ended(7))
    openHistory(1000)
    game().setRound(round({ roundNo: 8, phase: 'judging', startedAt: 8000 }))
    expect(history().open).toBeNull()
  })

  it('離開遊戲（reset：被接管、自動重新加入失敗）：關閉並 revoke', async () => {
    await ready(round({ phase: 'idle' }))
    openHistory(1000)
    game().reset('此暱稱已在其他分頁或連線重新加入，本頁已中斷')
    expect(history().open).toBeNull()
    expect(revoked).toHaveBeenCalledWith('blob:test/1')
  })

  it('與回合無關的 store 變動（聊天、玩家清單、連線狀態）不影響開著的歷史', async () => {
    const t = await ready(round({ phase: 'idle' }))
    openHistory(1000)
    const writes = t.calls.update
    game().appendChat({ id: 'm1', kind: 'chat', fromId: 'a', nickname: 'a', text: 'hi', at: 1 })
    game().setPlayers([])
    game().setConnection('connecting')
    await flushed()
    expect(history().open?.record.id).toBe(1000)
    expect(t.calls.update).toBe(writes)
  })
})
