// 本首得分（features/players/scoreDelta）：server 不單獨告訴本人這首得幾分，播放中由本局得分的差值推得；揭曉時讀 reveal.scores。
import { describe, expect, it } from 'vitest'
import { gainBaseFromSnapshot, gainBaseOnRound, revealScoreOf, songGain, songId } from '../src/features/players/scoreDelta'
import { player, playingRound, reveal, round, song } from './fixtures'

describe('songId', () => {
  it('局號＋第幾首；playing 與它的 reveal 是同一首；沒有 song 為 null', () => {
    expect(songId(playingRound({ gameNo: 3 }, { index: 2 }))).toBe('3:2')
    expect(songId(round({ gameNo: 3, phase: 'reveal', song: song({ index: 2 }) }))).toBe('3:2')
    expect(songId(round({ phase: 'ended' }))).toBeNull()
  })
})

describe('gainBaseOnRound（round:update）', () => {
  const players = [player('p1', { gameScore: 87 }), player('p2', { gameScore: 50 })]

  it('第 1 首固定 0；第 2 首以後讀自己的 gameScore', () => {
    expect(gainBaseOnRound(null, playingRound({}, { index: 1 }), [player('p1', { gameScore: 300 })], 'p1')).toEqual({ key: '1:1', base: 0 })
    expect(gainBaseOnRound(null, playingRound({}, { index: 2 }), players, 'p1')).toEqual({ key: '1:2', base: 87 })
    expect(gainBaseOnRound(null, playingRound({}, { index: 2 }), players, 'p2')).toEqual({ key: '1:2', base: 50 })
  })

  it('同一首沿用原物件（不重記）', () => {
    const base = { key: '1:2', base: 87 }
    expect(gainBaseOnRound(base, playingRound({}, { index: 2, correctIds: ['p1'] }), [player('p1', { gameScore: 160 })], 'p1')).toBe(base)
    expect(gainBaseOnRound(base, round({ phase: 'reveal', song: song({ index: 2 }) }), players, 'p1')).toBe(base)
  })

  it('沒有 song、未加入、找不到自己、自己已在猜對名單、直接收到別首的 reveal → null', () => {
    expect(gainBaseOnRound({ key: '1:2', base: 1 }, round({ phase: 'ended' }), players, 'p1')).toBeNull()
    expect(gainBaseOnRound(null, playingRound({}, { index: 2 }), players, null)).toBeNull()
    expect(gainBaseOnRound(null, playingRound({}, { index: 2 }), players, 'ghost')).toBeNull()
    expect(gainBaseOnRound(null, playingRound({}, { index: 2, correctIds: ['p1'] }), players, 'p1')).toBeNull()
    expect(gainBaseOnRound({ key: '1:1', base: 0 }, round({ phase: 'reveal', song: song({ index: 2 }) }), players, 'p1')).toBeNull()
  })
})

describe('gainBaseFromSnapshot（加入／重連接管）', () => {
  it('播放中、還沒猜對 → 此刻的 gameScore', () => {
    expect(gainBaseFromSnapshot(null, false, playingRound({}, { index: 4 }), [player('p1', { gameScore: 200 })], 'p1')).toEqual({ key: '1:4', base: 200 })
  })

  it('已猜對（hasGuessed 或在 correctIds）→ null', () => {
    expect(gainBaseFromSnapshot(null, false, playingRound({}, { index: 4 }), [player('p1', { gameScore: 280, hasGuessed: true })], 'p1')).toBeNull()
    expect(gainBaseFromSnapshot(null, false, playingRound({}, { index: 4, correctIds: ['p1'] }), [player('p1', { gameScore: 280 })], 'p1')).toBeNull()
  })

  it('同一個人回到同一首 → 沿用；不同人或不同首 → 重算', () => {
    const base = { key: '1:4', base: 200 }
    const r = playingRound({}, { index: 4, correctIds: ['p1'] })
    expect(gainBaseFromSnapshot(base, true, r, [player('p1', { gameScore: 280, hasGuessed: true })], 'p1')).toBe(base)
    expect(gainBaseFromSnapshot(base, false, r, [player('p1', { gameScore: 280, hasGuessed: true })], 'p1')).toBeNull()
    expect(gainBaseFromSnapshot(base, true, playingRound({}, { index: 5 }), [player('p1', { gameScore: 280 })], 'p1')).toEqual({ key: '1:5', base: 280 })
  })

  it('非播放階段（reveal、ended、idle）且沒有可沿用的 → null', () => {
    expect(gainBaseFromSnapshot(null, false, round({ phase: 'reveal', song: song({ index: 2 }) }), [player('p1')], 'p1')).toBeNull()
    expect(gainBaseFromSnapshot(null, false, round({ phase: 'idle' }), [player('p1')], 'p1')).toBeNull()
  })
})

describe('songGain／revealScoreOf', () => {
  it('gameScore − 基準，> 0 才回傳；不同首、基準不明、找不到玩家 → null', () => {
    const r = playingRound({}, { index: 2 })
    expect(songGain({ key: '1:2', base: 87 }, r, { gameScore: 160 })).toBe(73)
    expect(songGain({ key: '1:2', base: 87 }, r, { gameScore: 87 })).toBeNull()
    expect(songGain({ key: '1:1', base: 0 }, r, { gameScore: 160 })).toBeNull()
    expect(songGain(null, r, { gameScore: 160 })).toBeNull()
    expect(songGain({ key: '1:2', base: 87 }, r, undefined)).toBeNull()
  })

  it('revealScoreOf：揭曉資料裡該玩家的得分；沒猜對或沒有揭曉資料 → null', () => {
    const rv = reveal({ scores: [{ playerId: 'p2', score: 96 }, { playerId: 'p1', score: 73 }] })
    expect(revealScoreOf(rv, 'p1')).toBe(73)
    expect(revealScoreOf(rv, 'p3')).toBeNull()
    expect(revealScoreOf(null, 'p1')).toBeNull()
    expect(revealScoreOf(rv, null)).toBeNull()
  })
})
