// 自動交卷與交卷流程（features/round/autoSubmit、submit；spec/draw-contest/architecture.md §5、§7；決策 6）：
// 判斷純函式、可注入時鐘的排程（不靠真時間）、submitMyCanvas 的防重複與失敗處理。
import { describe, expect, it, vi } from 'vitest'
import type { RoundPublic } from '@fishing-work/shared/draw-contest'
import { autoSubmitDelay, autoSubmitDue, startAutoSubmit, type AutoSubmitView } from '../src/features/round/autoSubmit'
import { submitMyCanvas, type SubmitDeps } from '../src/features/round/submit'
import type { ActionOutcome } from '../src/socket/client'

const ENDS = 100_000
const view = (patch: Partial<AutoSubmitView> = {}, round: Partial<AutoSubmitView['round']> = {}): AutoSubmitView => ({
  me: 'me',
  submitted: false,
  submitting: false,
  ...patch,
  round: { roundNo: 1, phase: 'drawing', endsAt: ENDS, participantIds: ['me', 'p2'], ...round } as Pick<
    RoundPublic,
    'roundNo' | 'phase' | 'endsAt' | 'participantIds'
  >,
})

describe('autoSubmitDue：此刻該自動交卷嗎', () => {
  it('drawing：endsAt 之前不交、到了就交', () => {
    expect(autoSubmitDue(view(), ENDS - 1, null)).toBe(false)
    expect(autoSubmitDue(view(), ENDS, null)).toBe(true)
    expect(autoSubmitDue(view(), ENDS + 3_000, null)).toBe(true)
  })

  it('judging（server 已截止作畫）：不看本機時鐘，立刻補交', () => {
    expect(autoSubmitDue(view({}, { phase: 'judging' }), ENDS - 10_000, null)).toBe(true)
  })

  it('已交卷、交卷中、旁觀者、未加入一律不交', () => {
    expect(autoSubmitDue(view({ submitted: true }), ENDS, null)).toBe(false)
    expect(autoSubmitDue(view({ submitting: true }), ENDS, null)).toBe(false)
    expect(autoSubmitDue(view({}, { participantIds: ['p2'] }), ENDS, null)).toBe(false)
    expect(autoSubmitDue(view({ me: null }), ENDS, null)).toBe(false)
  })

  it('同一回合只自動一次（attemptedRound）；下一回合可以再交', () => {
    expect(autoSubmitDue(view(), ENDS, 1)).toBe(false)
    expect(autoSubmitDue(view({}, { roundNo: 2 }), ENDS, 1)).toBe(true)
  })

  it('其他階段不交', () => {
    for (const phase of ['idle', 'choosing', 'ended'] as const) expect(autoSubmitDue(view({}, { phase }), ENDS, null)).toBe(false)
  })
})

describe('autoSubmitDelay：排計時器的毫秒數', () => {
  it('drawing 中距 endsAt 的毫秒數；已過為 0', () => {
    expect(autoSubmitDelay(view(), ENDS - 2_500)).toBe(2_500)
    expect(autoSubmitDelay(view(), ENDS + 1)).toBe(0)
  })

  it('不需要排程：已交卷、旁觀、非 drawing、endsAt 為 null', () => {
    expect(autoSubmitDelay(view({ submitted: true }), 0)).toBeNull()
    expect(autoSubmitDelay(view({}, { participantIds: [] }), 0)).toBeNull()
    expect(autoSubmitDelay(view({}, { phase: 'judging' }), 0)).toBeNull()
    expect(autoSubmitDelay(view({}, { endsAt: null }), 0)).toBeNull()
  })
})

/** 假時鐘＋假計時器＋可手動觸發的訂閱 */
function harness(initial: AutoSubmitView) {
  let state = initial
  let now = 0
  const listeners = new Set<() => void>()
  const timers = new Map<number, { at: number; fn: () => void }>()
  let nextId = 0
  const submit = vi.fn(async () => undefined)
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
    submit,
  })
  return {
    submit,
    stop,
    timers,
    listeners,
    setState(patch: AutoSubmitView) {
      state = patch
      for (const l of [...listeners]) l()
    },
    /** 時間前進到 t，觸發到期的計時器 */
    advanceTo(t: number) {
      now = t
      for (const [id, timer] of [...timers]) {
        if (timer.at <= t) {
          timers.delete(id)
          timer.fn()
        }
      }
    },
  }
}

describe('startAutoSubmit：排程（注入時鐘與計時器）', () => {
  it('drawing 中排到 endsAt；時間到才送一次', () => {
    const h = harness(view())
    expect(h.timers.size).toBe(1)
    h.advanceTo(ENDS - 1)
    expect(h.submit).not.toHaveBeenCalled()
    h.advanceTo(ENDS)
    expect(h.submit).toHaveBeenCalledTimes(1)
    // 交卷失敗後狀態變動（submitting 回 false）也不再自動送同一回合
    h.setState(view())
    h.advanceTo(ENDS + 1_000)
    expect(h.submit).toHaveBeenCalledTimes(1)
    h.stop()
  })

  it('時間到之前手動交卷：計時器取消，不自動送', () => {
    const h = harness(view())
    h.setState(view({ submitted: true }))
    expect(h.timers.size).toBe(0)
    h.advanceTo(ENDS + 1)
    expect(h.submit).not.toHaveBeenCalled()
    h.stop()
  })

  it('收到 judging（server 先截止）時立刻補交', () => {
    const h = harness(view())
    h.advanceTo(ENDS - 500)
    h.setState(view({}, { phase: 'judging' }))
    expect(h.submit).toHaveBeenCalledTimes(1)
    h.stop()
  })

  it('下一回合重新排程並可再自動交一次', () => {
    const h = harness(view())
    h.advanceTo(ENDS)
    expect(h.submit).toHaveBeenCalledTimes(1)
    h.setState(view({}, { roundNo: 2, endsAt: ENDS * 2 }))
    h.advanceTo(ENDS * 2)
    expect(h.submit).toHaveBeenCalledTimes(2)
    h.stop()
  })

  it('stop：取消訂閱與計時器', () => {
    const h = harness(view())
    h.stop()
    expect(h.listeners.size).toBe(0)
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
