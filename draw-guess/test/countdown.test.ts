import { describe, expect, it } from 'vitest'
import { CHOOSING_SECONDS, ENDED_SECONDS, ROUND_SECONDS } from '@fishing-work/shared'
import { PHASE_SECONDS, formatClock, phaseRemainingSeconds, remainingSeconds } from '../src/features/round/countdown'

describe('remainingSeconds', () => {
  it('無條件進位到整秒，最小 0', () => {
    expect(remainingSeconds(10_000, 0)).toBe(10)
    expect(remainingSeconds(10_000, 1)).toBe(10)
    expect(remainingSeconds(10_000, 9_001)).toBe(1)
    expect(remainingSeconds(10_000, 10_000)).toBe(0)
    expect(remainingSeconds(10_000, 20_000)).toBe(0)
  })

  it('endsAt 為 null 或非有限數時回 null', () => {
    expect(remainingSeconds(null, 0)).toBeNull()
    expect(remainingSeconds(Number.NaN, 0)).toBeNull()
  })

  it('有 maxSeconds 時上限 clamp', () => {
    expect(remainingSeconds(61_000, 0, 60)).toBe(60)
    expect(remainingSeconds(60_001, 0, 60)).toBe(60)
    expect(remainingSeconds(59_000, 0, 60)).toBe(59)
    expect(remainingSeconds(-5_000, 0, 60)).toBe(0)
  })
})

describe('phaseRemainingSeconds：顯示值 clamp 到該階段長度（修剛開始顯示 01:01）', () => {
  it('各階段上限對應 shared 常數；idle 無倒數', () => {
    expect(PHASE_SECONDS).toEqual({ idle: null, choosing: CHOOSING_SECONDS, drawing: ROUND_SECONDS, ended: ENDED_SECONDS })
  })

  it('choosing：本機時鐘比 server 慢 1.5 秒也不超過 60（不會出現 01:01）', () => {
    const at = 1_000_000
    const endsAt = at + CHOOSING_SECONDS * 1000 + 1_500
    expect(phaseRemainingSeconds('choosing', endsAt, at)).toBe(CHOOSING_SECONDS)
    expect(formatClock(phaseRemainingSeconds('choosing', endsAt, at) ?? -1)).toBe('01:00')
  })

  it('choosing：剛好 60 秒又多 1 ms（無條件進位）仍為 60', () => {
    expect(phaseRemainingSeconds('choosing', 60_001, 0)).toBe(60)
  })

  it(`drawing：上限 ${ROUND_SECONDS}，正常遞減`, () => {
    const ms = ROUND_SECONDS * 1000
    expect(phaseRemainingSeconds('drawing', ms + 5_000, 0)).toBe(ROUND_SECONDS)
    expect(phaseRemainingSeconds('drawing', ms, 500)).toBe(ROUND_SECONDS)
    expect(phaseRemainingSeconds('drawing', ms, 1_000)).toBe(ROUND_SECONDS - 1)
    expect(phaseRemainingSeconds('drawing', ms, ms - 1)).toBe(1)
  })

  it('ended：上限 5', () => {
    expect(phaseRemainingSeconds('ended', 9_000, 0)).toBe(ENDED_SECONDS)
    expect(phaseRemainingSeconds('ended', 3_000, 0)).toBe(3)
  })

  it('本機時鐘比 server 快、期限已過：下限 0', () => {
    expect(phaseRemainingSeconds('drawing', 1_000, 5_000)).toBe(0)
  })

  it('idle 或 endsAt 為 null 時回 null', () => {
    expect(phaseRemainingSeconds('idle', 10_000, 0)).toBeNull()
    expect(phaseRemainingSeconds('drawing', null, 0)).toBeNull()
  })
})

describe('formatClock', () => {
  it('mm:ss', () => {
    expect(formatClock(90)).toBe('01:30')
    expect(formatClock(60)).toBe('01:00')
    expect(formatClock(5)).toBe('00:05')
    expect(formatClock(0)).toBe('00:00')
  })
})
