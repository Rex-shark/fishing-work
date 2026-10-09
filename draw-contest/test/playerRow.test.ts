// 玩家列的無障礙名稱與旁觀判定（features/players/playerRow；spec/draw-contest/design.md §2「左縮圖窗格」）
import { describe, expect, it } from 'vitest'
import { isContestActive, isSpectating, playerRowLabel } from '../src/features/players/playerRow'

const base = { nickname: 'amy', score: 120, isSetter: false, participating: true, submitted: false, connected: true }

describe('playerRowLabel', () => {
  it('一般玩家：名稱與總分', () => {
    expect(playerRowLabel('amy', base, false, false)).toBe('amy：120 分')
  })

  it('依序附上出題者、已交卷、旁觀、斷線中、你', () => {
    expect(playerRowLabel('amy', { ...base, isSetter: true, submitted: true }, true, true)).toBe('amy：120 分，出題者，已交卷，你')
    expect(playerRowLabel('amy', { ...base, participating: false, connected: false }, false, true)).toBe('amy：120 分，旁觀，斷線中')
  })

  it('比賽沒在進行時（idle／choosing／ended）不標旁觀', () => {
    expect(playerRowLabel('amy', { ...base, participating: false }, false, false)).toBe('amy：120 分')
  })
})

describe('isContestActive / isSpectating', () => {
  it('drawing、judging 為比賽進行中', () => {
    expect(isContestActive('drawing')).toBe(true)
    expect(isContestActive('judging')).toBe(true)
    for (const phase of ['idle', 'choosing', 'ended'] as const) expect(isContestActive(phase)).toBe(false)
  })

  it('進行中且非參賽者才是旁觀', () => {
    expect(isSpectating({ participating: false }, true)).toBe(true)
    expect(isSpectating({ participating: true }, true)).toBe(false)
    expect(isSpectating({ participating: false }, false)).toBe(false)
  })
})
