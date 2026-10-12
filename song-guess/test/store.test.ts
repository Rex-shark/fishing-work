// 遊戲 store（spec/song-guess/architecture.md §4、§7）：快照、round:update、時鐘偏移、本首得分的基準、selector、聊天去重、reset。
import { beforeEach, describe, expect, it } from 'vitest'
import type { ChatMessage, RoomSnapshot } from '@fishing-work/shared/song-guess'
import { CHAT_LOCAL_LIMIT } from '../src/features/chat/chatFormat'
import { initialGameState, initialRound, selectHasGuessed, selectIsSetter, selectMyGain, useGameStore } from '../src/store/game'
import { player, playingRound, reveal, round, song } from './fixtures'

const store = () => useGameStore.getState()

const msg = (id: string, over: Partial<ChatMessage> = {}): ChatMessage => ({ id, kind: 'chat', fromId: 'p2', nickname: 'p2', text: id, at: 1, ...over })

function snapshot(over: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return { you: 'p1', players: [player('p1'), player('p2')], round: round({ serverNow: 1_000_000 }), chat: [], ...over }
}

beforeEach(() => {
  useGameStore.setState({ ...initialGameState })
})

describe('初始狀態', () => {
  it('未加入、idle、沒有偏移', () => {
    expect(store().me).toBeNull()
    expect(store().round).toBe(initialRound)
    expect(initialRound).toMatchObject({ gameNo: 0, phase: 'idle', setterId: null, song: null, reveal: null, results: null, lastArtist: null })
    expect(store().clockOffset).toBe(0)
    expect(store().gainBase).toBeNull()
  })
})

describe('applySnapshot（加入／重連接管）', () => {
  it('套用 you／players／round／chat，清掉首頁錯誤', () => {
    useGameStore.setState({ joinError: '暱稱已被使用' })
    const s = snapshot({ chat: [msg('m1')] })
    store().applySnapshot(s, 1_000_000)
    expect(store().me).toBe('p1')
    expect(store().players).toBe(s.players)
    expect(store().round).toBe(s.round)
    expect(store().chat).toEqual([msg('m1')])
    expect(store().joinError).toBeNull()
  })

  it('以快照的 round.serverNow − 收到當下的本機時間估時鐘偏移', () => {
    store().applySnapshot(snapshot({ round: round({ serverNow: 1_002_500 }) }), 1_000_000)
    expect(store().clockOffset).toBe(2500)
    store().applySnapshot(snapshot({ round: round({ serverNow: 999_000 }) }), 1_000_000)
    expect(store().clockOffset).toBe(-1000)
  })

  it('聊天只留最新的 CHAT_LOCAL_LIMIT 則', () => {
    const chat = Array.from({ length: CHAT_LOCAL_LIMIT + 5 }, (_, i) => msg(`m${i}`))
    store().applySnapshot(snapshot({ chat }), 0)
    expect(store().chat).toHaveLength(CHAT_LOCAL_LIMIT)
    expect(store().chat[0]?.id).toBe('m5')
  })

  it('中途加入播放中的局、還沒猜對：以此刻的 gameScore 當本首基準', () => {
    const r = playingRound({ serverNow: 110_000 }, { index: 3 })
    store().applySnapshot(snapshot({ players: [player('p1', { gameScore: 120 }), player('p2')], round: r }), 110_000)
    expect(store().gainBase).toEqual({ key: '1:3', base: 120 })
  })

  it('接管時已經猜對：基準不明（null），之後只顯示「你猜對了」不帶分數', () => {
    const r = playingRound({}, { index: 3, correctIds: ['p1'] })
    store().applySnapshot(snapshot({ players: [player('p1', { gameScore: 207, hasGuessed: true }), player('p2')], round: r }), 0)
    expect(store().gainBase).toBeNull()
    expect(selectHasGuessed(store())).toBe(true)
    expect(selectMyGain(store())).toBeNull()
  })

  it('斷線重連回到同一首：沿用原本的基準（已猜對也還看得到 +N）', () => {
    const r = playingRound({}, { index: 2 })
    useGameStore.setState({ me: 'p1', players: [player('p1', { gameScore: 87 })], round: r, gainBase: { key: '1:2', base: 87 } })
    const after = playingRound({}, { index: 2, correctIds: ['p1'] })
    store().applySnapshot(snapshot({ players: [player('p1', { gameScore: 160, hasGuessed: true })], round: after }), 0)
    expect(store().gainBase).toEqual({ key: '1:2', base: 87 })
    expect(selectMyGain(store())).toBe(73)
  })

  it('換了人（另一個暱稱加入）或換了一首：不沿用舊基準', () => {
    useGameStore.setState({ me: 'p9', gainBase: { key: '1:2', base: 87 } })
    store().applySnapshot(snapshot({ players: [player('p1', { gameScore: 10 })], round: playingRound({}, { index: 2 }) }), 0)
    expect(store().gainBase).toEqual({ key: '1:2', base: 10 })
  })
})

describe('setRound（round:update）', () => {
  beforeEach(() => {
    store().applySnapshot(snapshot(), 1_000_000)
  })

  it('每次都以 serverNow 重估時鐘偏移', () => {
    store().setRound(round({ phase: 'choosing', setterId: 'p2', serverNow: 2_000_400 }), 2_000_000)
    expect(store().clockOffset).toBe(400)
    store().setRound(round({ phase: 'choosing', setterId: 'p2', serverNow: 2_000_900 }), 2_001_000)
    expect(store().clockOffset).toBe(-100)
  })

  it('新局第 1 首：基準固定 0（players:update 可能晚到，不讀上一局殘留的 gameScore）', () => {
    useGameStore.setState({ players: [player('p1', { gameScore: 300 }), player('p2')] })
    store().setRound(playingRound({ gameNo: 2 }, { index: 1 }), 0)
    expect(store().gainBase).toEqual({ key: '2:1', base: 0 })
  })

  it('第 2 首以後：基準＝自己此刻的 gameScore；同一首的後續 round:update（有人猜對）不重記', () => {
    useGameStore.setState({ players: [player('p1', { gameScore: 87 }), player('p2')] })
    store().setRound(playingRound({}, { index: 2 }), 0)
    expect(store().gainBase).toEqual({ key: '1:2', base: 87 })
    // 自己猜對：players:update 先到、round:update 後到
    store().setPlayers([player('p1', { gameScore: 160, score: 160, hasGuessed: true }), player('p2')])
    store().setRound(playingRound({}, { index: 2, correctIds: ['p1'] }), 0)
    expect(store().gainBase).toEqual({ key: '1:2', base: 87 })
    expect(selectMyGain(store())).toBe(73)
  })

  it('換一首：round:update 比清掉 hasGuessed 的 players:update 早到，本機先清掉上一首的 hasGuessed（不閃「你猜對了」）', () => {
    const guessed = [player('p1', { gameScore: 87, hasGuessed: true }), player('p2', { hasGuessed: true }), player('p3')]
    useGameStore.setState({ players: guessed, round: round({ phase: 'reveal', song: song({ index: 1, correctIds: ['p1', 'p2'] }), reveal: reveal() }) })
    expect(selectHasGuessed(store())).toBe(true)
    store().setRound(playingRound({}, { index: 2 }), 0)
    expect(store().players.map((p) => p.hasGuessed)).toEqual([false, false, false])
    expect(selectHasGuessed(store())).toBe(false)
    // 沒猜對的人維持同一個物件；分數不動
    expect(store().players[2]).toBe(guessed[2])
    expect(store().players[0]?.gameScore).toBe(87)
  })

  it('同一首的後續更新、進入 reveal：不動 hasGuessed', () => {
    const r = playingRound({}, { index: 2, correctIds: ['p1'] })
    const players = [player('p1', { hasGuessed: true }), player('p2')]
    useGameStore.setState({ players, round: r })
    store().setRound({ ...r, serverNow: 5 }, 0)
    expect(store().players).toBe(players)
    store().setRound(round({ phase: 'reveal', song: r.song, reveal: reveal({ index: 2 }) }), 0)
    expect(store().players).toBe(players)
  })

  it('進入 reveal（同一首）保留基準；進入 ended／idle（沒有 song）清掉', () => {
    useGameStore.setState({ gainBase: { key: '1:2', base: 87 } })
    store().setRound(round({ phase: 'reveal', song: song({ index: 2 }), reveal: reveal({ index: 2 }) }), 0)
    expect(store().gainBase).toEqual({ key: '1:2', base: 87 })
    store().setRound(round({ phase: 'ended', reveal: reveal({ index: 5 }), results: [] }), 0)
    expect(store().gainBase).toBeNull()
  })
})

describe('selector', () => {
  it('selectIsSetter：setterId 是自己（ended 仍算）', () => {
    expect(selectIsSetter({ me: 'p1', round: round({ phase: 'choosing', setterId: 'p1' }) })).toBe(true)
    expect(selectIsSetter({ me: 'p1', round: round({ phase: 'ended', setterId: 'p1' }) })).toBe(true)
    expect(selectIsSetter({ me: 'p2', round: round({ phase: 'choosing', setterId: 'p1' }) })).toBe(false)
    expect(selectIsSetter({ me: null, round: round({ setterId: null }) })).toBe(false)
  })

  it('selectHasGuessed：round.song.correctIds 或 players 的 hasGuessed，任一先到即算；沒有 song 一律 false', () => {
    const r = playingRound({}, { correctIds: ['p1'] })
    expect(selectHasGuessed({ me: 'p1', round: r, players: [player('p1')] })).toBe(true)
    expect(selectHasGuessed({ me: 'p1', round: playingRound(), players: [player('p1', { hasGuessed: true })] })).toBe(true)
    expect(selectHasGuessed({ me: 'p2', round: r, players: [player('p1', { hasGuessed: true }), player('p2')] })).toBe(false)
    expect(selectHasGuessed({ me: 'p1', round: round({ phase: 'idle' }), players: [player('p1', { hasGuessed: true })] })).toBe(false)
  })

  it('selectMyGain：揭曉時以 reveal.scores 為準（不管基準）', () => {
    const r = round({ phase: 'reveal', song: song({ index: 2 }), reveal: reveal({ index: 2, scores: [{ playerId: 'p2', score: 96 }, { playerId: 'p1', score: 73 }] }) })
    expect(selectMyGain({ me: 'p1', round: r, players: [player('p1')], gainBase: null })).toBe(73)
    expect(selectMyGain({ me: 'p3', round: r, players: [player('p3')], gainBase: null })).toBeNull()
  })

  it('selectMyGain：播放中由 gameScore 的差值推得；沒加分、基準不明、非播放階段為 null', () => {
    const r = playingRound({}, { index: 2 })
    const base = { key: '1:2', base: 87 }
    expect(selectMyGain({ me: 'p1', round: r, players: [player('p1', { gameScore: 160 })], gainBase: base })).toBe(73)
    expect(selectMyGain({ me: 'p1', round: r, players: [player('p1', { gameScore: 87 })], gainBase: base })).toBeNull()
    expect(selectMyGain({ me: 'p1', round: r, players: [player('p1', { gameScore: 160 })], gainBase: null })).toBeNull()
    expect(selectMyGain({ me: 'p1', round: round({ phase: 'ended' }), players: [player('p1', { gameScore: 160 })], gainBase: base })).toBeNull()
  })
})

describe('聊天與 reset', () => {
  it('appendChat 以 id 去重（重複時 state 不變）', () => {
    store().appendChat(msg('m1'))
    const before = store().chat
    store().appendChat(msg('m1'))
    expect(store().chat).toBe(before)
    store().appendChat(msg('m2', { kind: 'correct', text: 'p2 猜對了' }))
    expect(store().chat.map((m) => m.id)).toEqual(['m1', 'm2'])
  })

  it('reset：回到未加入、resuming false、可帶首頁錯誤；保留連線狀態', () => {
    store().applySnapshot(snapshot({ round: playingRound() }), 0)
    useGameStore.setState({ connection: 'connected', resuming: true, autoJoining: true })
    store().reset('此暱稱已在其他分頁或連線重新加入，本頁已中斷')
    expect(store()).toMatchObject({
      me: null,
      players: [],
      round: initialRound,
      chat: [],
      gainBase: null,
      resuming: false,
      autoJoining: false,
      joinError: '此暱稱已在其他分頁或連線重新加入，本頁已中斷',
      connection: 'connected',
    })
  })
})
