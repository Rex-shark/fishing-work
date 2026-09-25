import { describe, expect, it } from 'vitest'
import type { PlayerPublic } from '@fishing-work/shared'
import { baselineFromSnapshot, captureBaseline, scoreGain } from '../src/features/players/scoreDelta'

const player = (id: string, score: number, patch: Partial<PlayerPublic> = {}): PlayerPublic => ({
  id,
  nickname: id,
  score,
  isDrawer: false,
  hasGuessed: false,
  connected: true,
  joinedAt: 0,
  ...patch,
})

describe('scoreDelta：本回合得分（顯示用）', () => {
  it('captureBaseline 記下每位玩家分數', () => {
    expect(captureBaseline([player('a', 10), player('b', 0)])).toEqual({ a: 10, b: 0 })
  })

  it('scoreGain = 目前分數 − 基準；沒加分或基準不明回 null', () => {
    const base = captureBaseline([player('a', 10), player('b', 0)])
    expect(scoreGain(base, player('a', 97))).toBe(87)
    expect(scoreGain(base, player('b', 0))).toBeNull()
    expect(scoreGain(base, player('c', 50))).toBeNull()
    expect(scoreGain(null, player('a', 97))).toBeNull()
  })

  it('快照：只有 drawing 能推基準，且排除已猜對者（分數已含本回合所得）', () => {
    const players = [player('d', 40, { isDrawer: true }), player('a', 187, { hasGuessed: true }), player('b', 5)]
    expect(baselineFromSnapshot('drawing', players)).toEqual({ d: 40, b: 5 })
    expect(baselineFromSnapshot('ended', players)).toBeNull()
    expect(baselineFromSnapshot('idle', players)).toBeNull()
    expect(baselineFromSnapshot('choosing', players)).toBeNull()
  })
})
