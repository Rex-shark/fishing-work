// 自動交卷與交卷流程（features/round/autoSubmit、submit；spec/draw-contest/architecture.md §5、§7；決策 6）：
// 判斷純函式、可注入時鐘的排程（不靠真時間）、submitMyCanvas 的防重複與失敗處理。
// Epic 21 決策 6（plan/hardening.md、§5.5）：送出成功才記已交卷；失敗每 1 秒重試，直到成功、不可重試的錯誤或離開可交卷期間。
import { describe, expect, it, vi } from 'vitest'
import { SUBMIT_GRACE_SECONDS, type RoundPublic } from '@fishing-work/shared/draw-contest'
import {
  AUTO_SUBMIT_RETRY_MS,
  autoExportDue,
  autoSubmitDelay,
  autoSubmitDue,
  nextStatus,
  startAutoSubmit,
  type AutoSubmitRecord,
  type AutoSubmitView,
} from '../src/features/round/autoSubmit'
import { exportMyCanvas, submitMyCanvas, submitPreparedPng, type SubmitDeps } from '../src/features/round/submit'
import type { ActionOutcome } from '../src/socket/client'

const ENDS = 100_000
const GRACE_MS = SUBMIT_GRACE_SECONDS * 1000
const view = (patch: Partial<AutoSubmitView> = {}, round: Partial<AutoSubmitView['round']> = {}): AutoSubmitView => ({
  me: 'me',
  submitted: false,
  submitting: false,
  connection: 'connected',
  autoJoining: false,
  ...patch,
  round: { roundNo: 1, phase: 'drawing', endsAt: ENDS, participantIds: ['me', 'p2'], ...round } as Pick<
    RoundPublic,
    'roundNo' | 'phase' | 'endsAt' | 'participantIds'
  >,
})
const rec = (patch: Partial<AutoSubmitRecord> = {}): AutoSubmitRecord => ({
  roundNo: 1,
  status: 'none',
  failedAt: 0,
  deadline: ENDS + GRACE_MS,
  ...patch,
})
const fail = (error: string): ActionOutcome => ({ ok: false, error, message: error }) as ActionOutcome

describe('autoSubmitDue：此刻該自動交卷嗎', () => {
  it('drawing：endsAt 之前不交、到了就交', () => {
    expect(autoSubmitDue(view(), ENDS - 1, null)).toBe(false)
    expect(autoSubmitDue(view(), ENDS, null)).toBe(true)
    expect(autoSubmitDue(view(), ENDS + 3_000, null)).toBe(true)
  })

  it('judging（server 已截止作畫）：第一次不看本機時鐘，立刻補交', () => {
    expect(autoSubmitDue(view({}, { phase: 'judging', endsAt: null }), ENDS - 10_000, null)).toBe(true)
    expect(autoSubmitDue(view({}, { phase: 'judging', endsAt: null }), ENDS + 60_000, rec())).toBe(true)
  })

  it('已交卷、交卷中、旁觀者、未加入一律不交', () => {
    expect(autoSubmitDue(view({ submitted: true }), ENDS, null)).toBe(false)
    expect(autoSubmitDue(view({ submitting: true }), ENDS, null)).toBe(false)
    expect(autoSubmitDue(view({}, { participantIds: ['p2'] }), ENDS, null)).toBe(false)
    expect(autoSubmitDue(view({ me: null }), ENDS, null)).toBe(false)
  })

  it('未連線、自動重新加入中：先不交（等狀態變動再判斷）', () => {
    expect(autoSubmitDue(view({ connection: 'connecting' }), ENDS, null)).toBe(false)
    expect(autoSubmitDue(view({ connection: 'disconnected' }), ENDS, null)).toBe(false)
    expect(autoSubmitDue(view({ autoJoining: true }), ENDS, null)).toBe(false)
  })

  it('已交到（done）或放棄（gaveUp）的回合不再交；下一回合可以再交', () => {
    expect(autoSubmitDue(view(), ENDS, rec({ status: 'done' }))).toBe(false)
    expect(autoSubmitDue(view(), ENDS, rec({ status: 'gaveUp' }))).toBe(false)
    expect(autoSubmitDue(view({}, { roundNo: 2 }), ENDS, rec({ status: 'done' }))).toBe(true)
  })

  it('失敗過（retrying）：距上次失敗滿 AUTO_SUBMIT_RETRY_MS 才再交', () => {
    const r = rec({ status: 'retrying', failedAt: ENDS })
    expect(autoSubmitDue(view(), ENDS + AUTO_SUBMIT_RETRY_MS - 1, r)).toBe(false)
    expect(autoSubmitDue(view(), ENDS + AUTO_SUBMIT_RETRY_MS, r)).toBe(true)
  })

  it('重試超過本機的 endsAt＋寬限：離開可交卷期間，不再交', () => {
    const r = rec({ status: 'retrying', failedAt: ENDS })
    expect(autoSubmitDue(view({}, { phase: 'judging', endsAt: null }), ENDS + GRACE_MS, r)).toBe(true)
    expect(autoSubmitDue(view({}, { phase: 'judging', endsAt: null }), ENDS + GRACE_MS + 1, r)).toBe(false)
    expect(autoSubmitDue(view(), ENDS + GRACE_MS + 1, r)).toBe(false)
    // 沒看過 drawing（重新整理時已是 judging）：沒有本機期限，由 server 的 NOT_DRAWING 或 phase 結束來停
    expect(autoSubmitDue(view({}, { phase: 'judging', endsAt: null }), ENDS + 60_000, rec({ status: 'retrying', deadline: null }))).toBe(true)
  })

  it('其他階段不交', () => {
    for (const phase of ['idle', 'choosing', 'ended'] as const) expect(autoSubmitDue(view({}, { phase }), ENDS, null)).toBe(false)
    expect(autoSubmitDue(view({}, { phase: 'ended' }), ENDS, rec({ status: 'retrying' }))).toBe(false)
  })
})

describe('autoExportDue：此刻該匯出留存嗎（決策 12）', () => {
  it('到時就匯出，不論連線與否、是否在自動重新加入中', () => {
    expect(autoExportDue(view(), ENDS - 1, null)).toBe(false)
    expect(autoExportDue(view(), ENDS, null)).toBe(true)
    expect(autoExportDue(view({ connection: 'disconnected' }), ENDS, null)).toBe(true)
    expect(autoExportDue(view({ autoJoining: true }), ENDS, null)).toBe(true)
    expect(autoExportDue(view({}, { phase: 'judging', endsAt: null }), 0, null)).toBe(true)
  })
  it('已交卷、旁觀、定案、離開可交卷期間不匯出', () => {
    expect(autoExportDue(view({ submitted: true }), ENDS, null)).toBe(false)
    expect(autoExportDue(view({}, { participantIds: ['p2'] }), ENDS, null)).toBe(false)
    expect(autoExportDue(view(), ENDS, rec({ status: 'done' }))).toBe(false)
    expect(autoExportDue(view({}, { phase: 'ended' }), ENDS, null)).toBe(false)
    expect(autoExportDue(view(), ENDS + GRACE_MS + 1, rec({ status: 'retrying', failedAt: ENDS }))).toBe(false)
  })
})

describe('autoSubmitDelay：排計時器的毫秒數', () => {
  it('drawing 中距 endsAt 的毫秒數', () => {
    expect(autoSubmitDelay(view(), ENDS - 2_500, null)).toBe(2_500)
  })

  it('可交卷期間內：失敗過等到可重試的時間，否則每 AUTO_SUBMIT_RETRY_MS 看一次（例如等重連）', () => {
    expect(autoSubmitDelay(view({ connection: 'connecting' }), ENDS + 1, null)).toBe(AUTO_SUBMIT_RETRY_MS)
    expect(autoSubmitDelay(view(), ENDS + 300, rec({ status: 'retrying', failedAt: ENDS }))).toBe(AUTO_SUBMIT_RETRY_MS - 300)
    expect(autoSubmitDelay(view({ connection: 'connecting' }), ENDS + 5_000, rec({ status: 'retrying', failedAt: ENDS }))).toBe(AUTO_SUBMIT_RETRY_MS)
  })

  it('不需要排程：已交卷、旁觀、done／gaveUp、非 drawing/judging、endsAt 為 null 的 drawing、重試已過期限', () => {
    expect(autoSubmitDelay(view({ submitted: true }), 0, null)).toBeNull()
    expect(autoSubmitDelay(view({}, { participantIds: [] }), 0, null)).toBeNull()
    expect(autoSubmitDelay(view(), ENDS, rec({ status: 'done' }))).toBeNull()
    expect(autoSubmitDelay(view(), ENDS, rec({ status: 'gaveUp' }))).toBeNull()
    expect(autoSubmitDelay(view({}, { phase: 'ended' }), 0, null)).toBeNull()
    expect(autoSubmitDelay(view({}, { endsAt: null }), 0, null)).toBeNull()
    expect(autoSubmitDelay(view(), ENDS + GRACE_MS + 1, rec({ status: 'retrying', failedAt: ENDS + GRACE_MS }))).toBeNull()
  })
})

describe('nextStatus：送出結果 → 紀錄', () => {
  it('ack ok 與 ALREADY_SUBMITTED 視為成功', () => {
    expect(nextStatus({ ok: true })).toBe('done')
    expect(nextStatus(fail('ALREADY_SUBMITTED'))).toBe('done')
  })
  it('NOT_DRAWING／NOT_PARTICIPANT／SUBMISSION_INVALID 不可重試', () => {
    for (const e of ['NOT_DRAWING', 'NOT_PARTICIPANT', 'SUBMISSION_INVALID']) expect(nextStatus(fail(e))).toBe('gaveUp')
  })
  it('其餘（逾時、未連線、NOT_IN_ROOM、匯出失敗）重試', () => {
    for (const e of ['TIMEOUT', 'DISCONNECTED', 'NOT_IN_ROOM', 'EXPORT_FAILED', 'RATE_LIMITED']) expect(nextStatus(fail(e))).toBe('retrying')
  })
})

/** 假時鐘＋假計時器＋可手動觸發的訂閱；送出結果由 outcomes 依序決定（用完回 ok），或交給 deferred 手動決定 */
function harness(
  initial: AutoSubmitView,
  opts: { outcomes?: ActionOutcome[]; deferred?: boolean; exportDeferred?: boolean; exportFailures?: number } = {},
) {
  let state = initial
  let now = 0
  const listeners = new Set<() => void>()
  const timers = new Map<number, { at: number; fn: () => void }>()
  let nextId = 0
  const outcomes = [...(opts.outcomes ?? [])]
  const pending: ((r: ActionOutcome) => void)[] = []
  let inFlight = 0
  let maxInFlight = 0
  /** 每次匯出產生一份可辨識的 bytes（第 n 次匯出的第一個 byte 為 n） */
  let exportFailures = opts.exportFailures ?? 0
  const exportPending: { resolve: (png: ArrayBuffer) => void; reject: (e: Error) => void }[] = []
  const exportPng = vi.fn(async (): Promise<ArrayBuffer> => {
    if (opts.exportDeferred) return await new Promise<ArrayBuffer>((resolve, reject) => exportPending.push({ resolve, reject }))
    if (exportFailures > 0) {
      exportFailures -= 1
      throw new Error('no canvas')
    }
    return new Uint8Array([exportPng.mock.calls.length, 0x50]).buffer
  })
  const submit = vi.fn<(png: ArrayBuffer) => Promise<ActionOutcome>>(async () => {
    inFlight += 1
    maxInFlight = Math.max(maxInFlight, inFlight)
    try {
      if (opts.deferred) return await new Promise<ActionOutcome>((r) => pending.push(r))
      return outcomes.shift() ?? { ok: true }
    } finally {
      inFlight -= 1
    }
  })
  const stop = startAutoSubmit({
    getState: () => state,
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    now: () => now,
    setTimer: (fn, ms) => {
      const id = ++nextId
      timers.set(id, { at: now + ms, fn })
      return id
    },
    clearTimer: (id) => void timers.delete(id as number),
    exportPng,
    submit,
  })
  const flush = () => new Promise<void>((r) => setTimeout(r, 0))
  return {
    submit,
    exportPng,
    /** 每次送出的 PNG 第一個 byte（＝第幾次匯出的那份） */
    sentBytes: () => submit.mock.calls.map(([png]) => new Uint8Array(png)[0]),
    async finishExport(png: ArrayBuffer | 'fail') {
      const p = exportPending.shift()
      if (!p) throw new Error('沒有匯出在途')
      if (png === 'fail') p.reject(new Error('no canvas'))
      else p.resolve(png)
      await flush()
    },
    stop,
    timers,
    listeners,
    maxInFlight: () => maxInFlight,
    flush,
    async resolve(r: ActionOutcome) {
      const fn = pending.shift()
      if (!fn) throw new Error('沒有在途的送出')
      fn(r)
      await flush()
    },
    /** 換狀態並通知訂閱者，等匯出等非同步步驟跑完 */
    async setState(patch: AutoSubmitView) {
      state = patch
      for (const l of [...listeners]) l()
      await flush()
    },
    /** 時間前進到 t，依序觸發到期的計時器（觸發中新排的也算） */
    async advanceTo(t: number) {
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= t).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        now = due[1].at
        timers.delete(due[0])
        due[1].fn()
        await flush()
      }
      now = t
    },
  }
}

describe('startAutoSubmit：排程（注入時鐘與計時器）', () => {
  it('drawing 中排到 endsAt；時間到才送一次，成功後不再送', async () => {
    const h = harness(view())
    expect(h.timers.size).toBe(1)
    await h.advanceTo(ENDS - 1)
    expect(h.submit).not.toHaveBeenCalled()
    await h.advanceTo(ENDS)
    await h.flush()
    expect(h.submit).toHaveBeenCalledTimes(1)
    await h.setState(view())
    await h.advanceTo(ENDS + 3_000)
    expect(h.submit).toHaveBeenCalledTimes(1)
    h.stop()
  })

  it('時間到之前手動交卷：計時器取消，不自動送', async () => {
    const h = harness(view())
    await h.setState(view({ submitted: true }))
    expect(h.timers.size).toBe(0)
    await h.advanceTo(ENDS + 1)
    expect(h.submit).not.toHaveBeenCalled()
    h.stop()
  })

  it('收到 judging（server 先截止）時立刻補交', async () => {
    const h = harness(view())
    await h.advanceTo(ENDS - 500)
    await h.setState(view({}, { phase: 'judging', endsAt: null }))
    expect(h.submit).toHaveBeenCalledTimes(1)
    h.stop()
  })

  it('失敗不記：1 秒後重試，第二次成功即停止', async () => {
    const h = harness(view(), { outcomes: [fail('TIMEOUT')] })
    await h.advanceTo(ENDS)
    await h.flush()
    expect(h.submit).toHaveBeenCalledTimes(1)
    await h.advanceTo(ENDS + AUTO_SUBMIT_RETRY_MS - 1)
    expect(h.submit).toHaveBeenCalledTimes(1)
    await h.advanceTo(ENDS + AUTO_SUBMIT_RETRY_MS)
    expect(h.submit).toHaveBeenCalledTimes(2)
    await h.advanceTo(ENDS + GRACE_MS)
    await h.setState(view({}, { phase: 'judging', endsAt: null }))
    await h.flush()
    expect(h.submit).toHaveBeenCalledTimes(2)
    expect(h.timers.size).toBe(0)
    h.stop()
  })

  it('ALREADY_SUBMITTED 視為成功：不再重試', async () => {
    const h = harness(view(), { outcomes: [fail('ALREADY_SUBMITTED')] })
    await h.advanceTo(ENDS + GRACE_MS)
    expect(h.submit).toHaveBeenCalledTimes(1)
    expect(h.timers.size).toBe(0)
    h.stop()
  })

  it.each(['NOT_DRAWING', 'NOT_PARTICIPANT', 'SUBMISSION_INVALID'])('%s：不可重試，記為放棄', async (error) => {
    const h = harness(view(), { outcomes: [fail(error)] })
    await h.advanceTo(ENDS + GRACE_MS)
    await h.setState(view({}, { phase: 'judging', endsAt: null }))
    await h.flush()
    expect(h.submit).toHaveBeenCalledTimes(1)
    expect(h.timers.size).toBe(0)
    h.stop()
  })

  it('一直失敗：重試到本機 endsAt＋寬限為止（離開可交卷期間就停）', async () => {
    const h = harness(view(), { outcomes: Array.from({ length: 20 }, () => fail('TIMEOUT')) })
    await h.advanceTo(ENDS + 60_000)
    // ENDS、+1s … +5s 共 6 次（+5s 那次的失敗之後已過期限）
    expect(h.submit).toHaveBeenCalledTimes(GRACE_MS / AUTO_SUBMIT_RETRY_MS + 1)
    expect(h.timers.size).toBe(0)
    h.stop()
  })

  it('phase 離開 drawing/judging（ended）：停止重試', async () => {
    const h = harness(view(), { outcomes: [fail('TIMEOUT'), fail('TIMEOUT')] })
    await h.advanceTo(ENDS)
    await h.flush()
    await h.setState(view({}, { phase: 'ended', endsAt: null }))
    await h.advanceTo(ENDS + 60_000)
    expect(h.submit).toHaveBeenCalledTimes(1)
    expect(h.timers.size).toBe(0)
    h.stop()
  })

  it('時間到的瞬間斷線：斷線中不送；重連（autoJoining 結束、judging 快照）後在寬限內補交', async () => {
    const h = harness(view())
    await h.advanceTo(ENDS - 100)
    await h.setState(view({ connection: 'connecting' }))
    await h.advanceTo(ENDS + 2_000)
    expect(h.submit).not.toHaveBeenCalled()
    await h.setState(view({ connection: 'connected', autoJoining: true }))
    expect(h.submit).not.toHaveBeenCalled()
    await h.setState(view({ autoJoining: false }, { phase: 'judging', endsAt: null }))
    expect(h.submit).toHaveBeenCalledTimes(1)
    h.stop()
  })

  it('不重複送出：在途期間狀態變動與計時器都不再送第二個', async () => {
    const h = harness(view(), { deferred: true })
    await h.advanceTo(ENDS)
    expect(h.submit).toHaveBeenCalledTimes(1)
    await h.setState(view())
    await h.setState(view({}, { phase: 'judging', endsAt: null }))
    await h.advanceTo(ENDS + 2_000)
    expect(h.submit).toHaveBeenCalledTimes(1)
    expect(h.maxInFlight()).toBe(1)
    await h.resolve(fail('TIMEOUT'))
    // 失敗回來後（以回來的時間起算）等 1 秒再送下一次，仍只有一個在途
    expect(h.submit).toHaveBeenCalledTimes(1)
    await h.advanceTo(ENDS + 2_000 + AUTO_SUBMIT_RETRY_MS)
    expect(h.submit).toHaveBeenCalledTimes(2)
    await h.resolve({ ok: true })
    expect(h.maxInFlight()).toBe(1)
    h.stop()
  })

  it('下一回合重新排程並可再自動交一次', async () => {
    const h = harness(view())
    await h.advanceTo(ENDS)
    await h.flush()
    expect(h.submit).toHaveBeenCalledTimes(1)
    await h.setState(view({}, { roundNo: 2, endsAt: ENDS * 2 }))
    await h.advanceTo(ENDS * 2)
    expect(h.submit).toHaveBeenCalledTimes(2)
    h.stop()
  })

  it('決策 12：離線時到 endsAt → 先匯出一次；重連後直接送同一份 bytes，匯出次數仍為 1', async () => {
    const h = harness(view(), { outcomes: [fail('NOT_IN_ROOM')] })
    await h.advanceTo(ENDS - 2_500)
    await h.setState(view({ connection: 'connecting' }))
    await h.advanceTo(ENDS)
    expect(h.exportPng).toHaveBeenCalledTimes(1)
    expect(h.submit).not.toHaveBeenCalled()
    await h.advanceTo(ENDS + 2_000)
    expect(h.exportPng).toHaveBeenCalledTimes(1)
    await h.setState(view({ autoJoining: true }, { phase: 'judging', endsAt: null }))
    expect(h.submit).not.toHaveBeenCalled()
    await h.setState(view({}, { phase: 'judging', endsAt: null }))
    expect(h.submit).toHaveBeenCalledTimes(1)
    // 第一次失敗（NOT_IN_ROOM）→ 1 秒後重試，仍送同一份
    await h.advanceTo(ENDS + 3_000)
    expect(h.submit).toHaveBeenCalledTimes(2)
    expect(h.sentBytes()).toEqual([1, 1])
    expect(h.exportPng).toHaveBeenCalledTimes(1)
    h.stop()
  })

  it('決策 12：換回合丟棄留存的 PNG，新回合重新匯出', async () => {
    const h = harness(view({ connection: 'connecting' }))
    await h.advanceTo(ENDS)
    expect(h.exportPng).toHaveBeenCalledTimes(1)
    // 一直沒連上，下一回合開始（roundNo 2）並到時：重新匯出第 2 份，送的是第 2 份
    await h.setState(view({}, { roundNo: 2, endsAt: ENDS * 2 }))
    expect(h.submit).not.toHaveBeenCalled()
    await h.advanceTo(ENDS * 2)
    expect(h.exportPng).toHaveBeenCalledTimes(2)
    expect(h.sentBytes()).toEqual([2])
    h.stop()
  })

  it('決策 12：匯出完成時已換回合 → 丟棄，不拿去送新回合', async () => {
    const h = harness(view(), { exportDeferred: true })
    await h.advanceTo(ENDS)
    expect(h.exportPng).toHaveBeenCalledTimes(1)
    await h.setState(view({}, { roundNo: 2, phase: 'choosing', endsAt: null }))
    await h.finishExport(new Uint8Array([9]).buffer)
    await h.setState(view({}, { roundNo: 2, endsAt: ENDS * 2 }))
    expect(h.submit).not.toHaveBeenCalled()
    await h.advanceTo(ENDS * 2)
    expect(h.exportPng).toHaveBeenCalledTimes(2)
    await h.finishExport(new Uint8Array([7]).buffer)
    expect(h.sentBytes()).toEqual([7])
    h.stop()
  })

  it('決策 12：匯出進行中不重複匯出（狀態變動、計時器都不再觸發匯出）', async () => {
    const h = harness(view(), { exportDeferred: true })
    await h.advanceTo(ENDS)
    await h.setState(view())
    await h.setState(view({}, { phase: 'judging', endsAt: null }))
    await h.advanceTo(ENDS + 3_000)
    expect(h.exportPng).toHaveBeenCalledTimes(1)
    expect(h.submit).not.toHaveBeenCalled()
    await h.finishExport(new Uint8Array([5]).buffer)
    expect(h.sentBytes()).toEqual([5])
    expect(h.exportPng).toHaveBeenCalledTimes(1)
    h.stop()
  })

  it('決策 12：匯出失敗 → 1 秒後（期限內）再試匯出，成功後送出', async () => {
    const h = harness(view(), { exportFailures: 1 })
    await h.advanceTo(ENDS)
    expect(h.exportPng).toHaveBeenCalledTimes(1)
    expect(h.submit).not.toHaveBeenCalled()
    await h.advanceTo(ENDS + AUTO_SUBMIT_RETRY_MS)
    expect(h.exportPng).toHaveBeenCalledTimes(2)
    expect(h.submit).toHaveBeenCalledTimes(1)
    h.stop()
  })

  it('決策 12：成功後不再匯出也不再送', async () => {
    const h = harness(view())
    await h.advanceTo(ENDS + GRACE_MS)
    await h.setState(view({}, { phase: 'judging', endsAt: null }))
    expect(h.exportPng).toHaveBeenCalledTimes(1)
    expect(h.submit).toHaveBeenCalledTimes(1)
    h.stop()
  })

  it('stop：取消訂閱與計時器；在途的結果回來也不再排程', async () => {
    const h = harness(view(), { deferred: true })
    await h.advanceTo(ENDS)
    h.stop()
    expect(h.listeners.size).toBe(0)
    expect(h.timers.size).toBe(0)
    await h.resolve(fail('TIMEOUT'))
    expect(h.timers.size).toBe(0)
  })
})

describe('submitMyCanvas：匯出 → 送出 → 鎖定', () => {
  function deps(patch: Partial<SubmitDeps> & { state?: { submitted: boolean; submitting: boolean } } = {}) {
    const log: string[] = []
    const d: SubmitDeps = {
      read: () => ({ ...(patch.state ?? { submitted: false, submitting: false }), ops: [] }),
      setSubmitting: (v) => void log.push(`submitting=${v}`),
      markSubmitted: () => void log.push('submitted'),
      exportPng: async () => new Uint8Array([0x89, 0x50]).buffer,
      send: async () => ({ ok: true }) as ActionOutcome,
      ...patch,
    }
    return { d, log }
  }

  it('成功：submitting 包住整段，ack ok 後標記已交卷', async () => {
    const send = vi.fn(async (png: ArrayBuffer): Promise<ActionOutcome> => (png.byteLength === 2 ? { ok: true } : { ok: false, error: 'TIMEOUT', message: 'x' }))
    const { d, log } = deps({ send })
    expect(await submitMyCanvas(d)).toEqual({ ok: true })
    expect(send).toHaveBeenCalledTimes(1)
    expect(log).toEqual(['submitting=true', 'submitted', 'submitting=false'])
  })

  it('submitPreparedPng（決策 12）：不再匯出，直接送留存的 bytes；成功同樣標記已交卷', async () => {
    const exportPng = vi.fn(async () => new ArrayBuffer(1))
    const send = vi.fn<(png: ArrayBuffer) => Promise<ActionOutcome>>(async () => ({ ok: true }))
    const { d, log } = deps({ exportPng, send })
    const png = new Uint8Array([0x89, 0x50, 0x4e]).buffer
    expect(await submitPreparedPng(png, d)).toEqual({ ok: true })
    expect(exportPng).not.toHaveBeenCalled()
    expect(send.mock.calls[0]?.[0]).toBe(png)
    expect(log).toEqual(['submitting=true', 'submitted', 'submitting=false'])
  })

  it('exportMyCanvas：以目前的本機筆跡匯出（失敗時 reject）', async () => {
    const { d } = deps()
    expect(new Uint8Array(await exportMyCanvas(d))).toEqual(new Uint8Array([0x89, 0x50]))
    const broken = deps({ exportPng: async () => Promise.reject(new Error('no canvas')) })
    await expect(exportMyCanvas(broken.d)).rejects.toThrow('no canvas')
  })

  it('已交卷或交卷中：不匯出、不送', async () => {
    const send = vi.fn()
    for (const state of [{ submitted: true, submitting: false }, { submitted: false, submitting: true }]) {
      const { d, log } = deps({ state, send })
      const r = await submitMyCanvas(d)
      expect(r.ok).toBe(false)
      expect(log).toEqual([])
    }
    expect(send).not.toHaveBeenCalled()
  })

  it('server 回 ALREADY_SUBMITTED（逾時後重送）視同已交卷', async () => {
    const { d, log } = deps({ send: async () => ({ ok: false, error: 'ALREADY_SUBMITTED', message: '你已經交卷了' }) })
    await submitMyCanvas(d)
    expect(log).toContain('submitted')
  })

  it('失敗（逾時、匯出失敗）：不標記交卷，解除 submitting（可再按完成）', async () => {
    const timeout = deps({ send: async () => ({ ok: false, error: 'TIMEOUT', message: '伺服器沒有回應' }) })
    expect((await submitMyCanvas(timeout.d)).ok).toBe(false)
    expect(timeout.log).toEqual(['submitting=true', 'submitting=false'])
    const broken = deps({ exportPng: async () => Promise.reject(new Error('no canvas')) })
    expect(await submitMyCanvas(broken.d)).toMatchObject({ ok: false, error: 'EXPORT_FAILED' })
    expect(broken.log).toEqual(['submitting=true', 'submitting=false'])
  })
})
