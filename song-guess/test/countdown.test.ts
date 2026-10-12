// 倒數（features/round/countdown）：以 endsAt − 校正後的現在計算，clamp 到該階段長度。
import { describe, expect, it } from 'vitest'
import { CHOOSING_SECONDS, PREVIEW_CAP_MS, REVEAL_SECONDS, START_DELAY_MS } from '@fishing-work/shared/song-guess'
import { estimateClockOffset, toServerTime } from '../src/features/player/clock'
import { formatClock, phaseMaxSeconds, remainingSeconds, roundRemainingSeconds } from '../src/features/round/countdown'
import { playingRound, reveal, round, song } from './fixtures'

describe('remainingSeconds', () => {
  it('無條件進位到整秒、下限 0', () => {
    expect(remainingSeconds(10_000, 0)).toBe(10)
    expect(remainingSeconds(10_000, 1)).toBe(10)
    expect(remainingSeconds(10_000, 9_001)).toBe(1)
    expect(remainingSeconds(10_000, 10_000)).toBe(0)
    expect(remainingSeconds(10_000, 99_999)).toBe(0)
  })

  it('endsAt 為 null 或不是有限數字 → null', () => {
    expect(remainingSeconds(null, 0)).toBeNull()
    expect(remainingSeconds(Number.NaN, 0)).toBeNull()
  })

  it('clamp 到 maxSeconds', () => {
    expect(remainingSeconds(65_000, 0, 60)).toBe(60)
    expect(remainingSeconds(30_000, 0, 60)).toBe(30)
  })
})

describe('phaseMaxSeconds', () => {
  it('choosing＝出題期限、playing＝這首的長度（進位）、reveal＝揭曉停留；idle、ended 沒有倒數', () => {
    expect(phaseMaxSeconds(round({ phase: 'choosing' }))).toBe(CHOOSING_SECONDS)
    expect(phaseMaxSeconds(playingRound({}, { durationMs: 30_000 }))).toBe(30)
    expect(phaseMaxSeconds(playingRound({}, { durationMs: 2500 }))).toBe(3)
    expect(phaseMaxSeconds(round({ phase: 'playing', song: null }))).toBe(PREVIEW_CAP_MS / 1000)
    expect(phaseMaxSeconds(round({ phase: 'reveal', song: song(), reveal: reveal() }))).toBe(REVEAL_SECONDS)
    expect(phaseMaxSeconds(round({ phase: 'idle' }))).toBeNull()
    expect(phaseMaxSeconds(round({ phase: 'ended' }))).toBeNull()
  })
})

describe('roundRemainingSeconds', () => {
  it('playing：試聽剩餘秒數；起播緩衝期間停在整首長度（不出現 00:32）', () => {
    const r = playingRound({}, { startedAt: 100_000, durationMs: 30_000 })
    expect(roundRemainingSeconds(r, 100_000 - START_DELAY_MS)).toBe(30)
    expect(roundRemainingSeconds(r, 100_000)).toBe(30)
    expect(roundRemainingSeconds(r, 109_000)).toBe(21)
    expect(roundRemainingSeconds(r, 130_000)).toBe(0)
  })

  it('choosing：出題期限；reveal：下一首開始前的秒數', () => {
    expect(roundRemainingSeconds(round({ phase: 'choosing', endsAt: 60_000 }), 8_000)).toBe(52)
    expect(roundRemainingSeconds(round({ phase: 'reveal', song: song(), reveal: reveal(), endsAt: 205_000 }), 201_000)).toBe(4)
  })

  it('idle、ended 或 endsAt 為 null → null', () => {
    expect(roundRemainingSeconds(round({ phase: 'idle', endsAt: 5 }), 0)).toBeNull()
    expect(roundRemainingSeconds(round({ phase: 'ended' }), 0)).toBeNull()
    expect(roundRemainingSeconds(round({ phase: 'choosing', endsAt: null }), 0)).toBeNull()
  })

  it('以校正後的時間計算：本機時鐘快 5 分鐘，倒數仍是 21 秒', () => {
    const r = playingRound({ serverNow: 109_000 }, { startedAt: 100_000, durationMs: 30_000 })
    const localNow = 109_000 + 300_000
    const offset = estimateClockOffset(r.serverNow, localNow)
    expect(roundRemainingSeconds(r, toServerTime(localNow, offset))).toBe(21)
    // 不校正的話會是 0
    expect(roundRemainingSeconds(r, localNow)).toBe(0)
  })
})

describe('formatClock', () => {
  it('mm:ss 補零', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(4)).toBe('00:04')
    expect(formatClock(21)).toBe('00:21')
    expect(formatClock(52)).toBe('00:52')
    expect(formatClock(60)).toBe('01:00')
  })
})
