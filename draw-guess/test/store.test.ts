import { beforeEach, describe, expect, it } from 'vitest'
import { BRUSH_DEFAULT, PALETTE, type ChatMessage, type DrawOp, type PlayerPublic, type RoomSnapshot, type RoundPublic } from '@fishing-work/shared'
import { hsvToHex } from '../src/features/canvas/brush'
import { CHAT_LOCAL_LIMIT } from '../src/features/chat/chatFormat'
import {
  initialBrush,
  initialGameState,
  initialRound,
  selectHasGuessed,
  selectMyGain,
  useGameStore,
} from '../src/store/game'

const begin = (strokeId: string): DrawOp => ({ type: 'begin', strokeId, tool: 'pen', color: PALETTE[0], size: 4, point: { x: 0, y: 0 } })
const end = (strokeId: string): DrawOp => ({ type: 'end', strokeId })
const round = (patch: Partial<RoundPublic>): RoundPublic => ({ ...initialRound, ...patch })
const chatMsg = (id: string): ChatMessage => ({ id, kind: 'chat', fromId: 'p2', nickname: 'amy', text: id, at: 0 })
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
const snapshot = (patch: Partial<RoomSnapshot>): RoomSnapshot => ({
  you: 'me',
  players: [],
  round: initialRound,
  ops: [],
  chat: [],
  ...patch,
})

const get = () => useGameStore.getState()

beforeEach(() => {
  useGameStore.setState(initialGameState)
})

describe('store：ops 正規化與全量重繪版本', () => {
  it('begin / move / end 追加，不遞增 opsVersion', () => {
    get().appendOp(begin('a'))
    get().appendOp(end('a'))
    expect(get().ops).toEqual([begin('a'), end('a')])
    expect(get().opsVersion).toBe(0)
  })

  it('undo 移除該筆畫全部 op（undo 本身不存）並遞增 opsVersion', () => {
    for (const op of [begin('a'), end('a'), begin('b'), end('b')]) get().appendOp(op)
    get().appendOp({ type: 'undo', strokeId: 'b' })
    expect(get().ops).toEqual([begin('a'), end('a')])
    expect(get().opsVersion).toBe(1)
  })

  it('clear 清空 ops（clear 本身不存）並遞增 opsVersion', () => {
    get().appendOp(begin('a'))
    get().appendOp({ type: 'clear' })
    expect(get().ops).toEqual([])
    expect(get().opsVersion).toBe(1)
  })

  it('background（Epic 7）：首次附加、之後原地取代（只留最後一個），不遞增 opsVersion', () => {
    get().appendOp(begin('a'))
    get().appendOp({ type: 'background', color: '#FFECEA' })
    get().appendOp(end('a'))
    get().appendOp({ type: 'background', color: '#000000' })
    expect(get().ops).toEqual([begin('a'), { type: 'background', color: '#000000' }, end('a')])
    expect(get().opsVersion).toBe(0)
  })

  it('clear 只清筆跡、保留背景；undo 不影響背景', () => {
    for (const op of [begin('a'), end('a'), begin('b'), end('b')]) get().appendOp(op)
    get().appendOp({ type: 'background', color: '#FFECEA' })
    get().appendOp({ type: 'undo', strokeId: 'b' })
    expect(get().ops).toEqual([begin('a'), end('a'), { type: 'background', color: '#FFECEA' }])
    get().appendOp({ type: 'clear' })
    expect(get().ops).toEqual([{ type: 'background', color: '#FFECEA' }])
  })

  it('進入 drawing（新回合）清空 ops，背景一併回到預設', () => {
    get().setRound(round({ phase: 'choosing', drawerId: 'p1' }))
    get().applyOps([{ type: 'background', color: '#FFECEA' }])
    get().setRound(round({ phase: 'drawing', drawerId: 'p1' }))
    expect(get().ops).toEqual([])
  })

  it('applyOps 整批替換並正規化', () => {
    get().applyOps([begin('a'), end('a'), { type: 'undo', strokeId: 'a' }, begin('b')])
    expect(get().ops).toEqual([begin('b')])
    expect(get().opsVersion).toBe(1)
  })

  it('進入 drawing 時清空上一回合筆跡；已在 drawing 的更新不清', () => {
    get().setRound(round({ phase: 'choosing', drawerId: 'p1' }))
    get().appendOp(begin('old'))
    get().setRound(round({ phase: 'drawing', drawerId: 'p1' }))
    expect(get().ops).toEqual([])
    const v = get().opsVersion
    get().appendOp(begin('new'))
    get().setRound(round({ phase: 'drawing', drawerId: 'p1', correctIds: ['p2'] }))
    expect(get().ops).toEqual([begin('new')])
    expect(get().opsVersion).toBe(v)
  })

  it('ended / idle 保留筆跡（下一回合開始才清）', () => {
    get().setRound(round({ phase: 'drawing', drawerId: 'p1' }))
    get().appendOp(begin('a'))
    get().setRound(round({ phase: 'ended', drawerId: 'p1', topic: '狗' }))
    get().setRound(round({ phase: 'idle' }))
    expect(get().ops).toEqual([begin('a')])
  })
})

describe('store：聊天去重與截斷', () => {
  it('appendChat 以 id 去重：快照與廣播帶到同一則只留一份', () => {
    get().applySnapshot(snapshot({ chat: [chatMsg('a')] }))
    get().appendChat(chatMsg('a'))
    get().appendChat(chatMsg('b'))
    get().appendChat(chatMsg('b'))
    expect(get().chat.map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('重複的訊息不改變 chat 參照（不觸發重繪）', () => {
    get().appendChat(chatMsg('a'))
    const before = get().chat
    get().appendChat(chatMsg('a'))
    expect(get().chat).toBe(before)
  })

  it('本地最多保留 CHAT_LOCAL_LIMIT 則，捨棄最舊的', () => {
    for (let i = 0; i < CHAT_LOCAL_LIMIT + 5; i++) get().appendChat(chatMsg(String(i)))
    expect(get().chat).toHaveLength(CHAT_LOCAL_LIMIT)
    expect(get().chat[0].id).toBe('5')
    expect(get().chat.at(-1)?.id).toBe(String(CHAT_LOCAL_LIMIT + 4))
  })

  it('快照的聊天也套用上限；reset 清空', () => {
    const many = Array.from({ length: CHAT_LOCAL_LIMIT + 1 }, (_, i) => chatMsg(String(i)))
    get().applySnapshot(snapshot({ chat: many }))
    expect(get().chat).toHaveLength(CHAT_LOCAL_LIMIT)
    get().reset()
    expect(get().chat).toEqual([])
  })
})

describe('store：本回合得分基準與猜對選擇器', () => {
  it('進入 drawing 時記下基準；猜對後 selectMyGain = 分數差', () => {
    get().applySnapshot(snapshot({ players: [player('me', 10), player('d', 0)], round: round({ phase: 'choosing', drawerId: 'd' }) }))
    expect(get().scoreBaseline).toBeNull()
    get().setRound(round({ phase: 'drawing', drawerId: 'd' }))
    expect(get().scoreBaseline).toEqual({ me: 10, d: 0 })
    expect(selectMyGain(get())).toBeNull()
    expect(selectHasGuessed(get())).toBe(false)

    get().setPlayers([player('me', 97, { hasGuessed: true }), player('d', 0, { isDrawer: true })])
    expect(selectHasGuessed(get())).toBe(true)
    expect(selectMyGain(get())).toBe(87)
  })

  it('已在 drawing 的 round:update 不重設基準', () => {
    get().applySnapshot(snapshot({ players: [player('me', 0)], round: round({ phase: 'choosing', drawerId: 'd' }) }))
    get().setRound(round({ phase: 'drawing', drawerId: 'd' }))
    get().setPlayers([player('me', 90)])
    get().setRound(round({ phase: 'drawing', drawerId: 'd', correctIds: ['me'] }))
    expect(selectMyGain(get())).toBe(90)
  })

  it('round.correctIds 先到、players:update 還沒到也算已猜對', () => {
    get().applySnapshot(snapshot({ players: [player('me', 0)], round: round({ phase: 'drawing', drawerId: 'd', correctIds: ['me'] }) }))
    expect(selectHasGuessed(get())).toBe(true)
  })

  it('drawing 中途接管：已猜對者基準不明，不顯示分數差', () => {
    get().applySnapshot(
      snapshot({ players: [player('me', 187, { hasGuessed: true })], round: round({ phase: 'drawing', drawerId: 'd' }) }),
    )
    expect(selectHasGuessed(get())).toBe(true)
    expect(selectMyGain(get())).toBeNull()
  })

  it('畫師：揭曉時的結算（+20 × 猜對人數）也算本回合得分', () => {
    get().applySnapshot(snapshot({ you: 'd', players: [player('d', 5), player('a', 0)], round: round({ phase: 'choosing', drawerId: 'd' }) }))
    get().setRound(round({ phase: 'drawing', drawerId: 'd' }))
    get().setRound(round({ phase: 'ended', drawerId: 'd', topic: '狗' }))
    get().setPlayers([player('d', 25, { isDrawer: true }), player('a', 90, { hasGuessed: true })])
    expect(selectMyGain(get())).toBe(20)
  })

  it('reset 清除基準', () => {
    get().applySnapshot(snapshot({ players: [player('me', 0)], round: round({ phase: 'drawing', drawerId: 'd' }) }))
    expect(get().scoreBaseline).toEqual({ me: 0 })
    get().reset()
    expect(get().scoreBaseline).toBeNull()
  })
})

describe('store：畫筆狀態（Phase 6：任意色、1–64 粗細；Epic 11：HSV）', () => {
  it('預設：畫筆、白（PALETTE[0]＝HSV 0/0/100）、粗細 BRUSH_DEFAULT', () => {
    expect(get().brush).toEqual({ tool: 'pen', color: PALETTE[0], size: BRUSH_DEFAULT, hue: 0, sat: 0, val: 100 })
    expect(hsvToHex(initialBrush.hue, initialBrush.sat, initialBrush.val)).toBe(initialBrush.color)
  })

  it('setBrush 只改傳入的欄位', () => {
    get().setBrush({ size: 64 })
    get().setBrush({ hue: 120, sat: 100, val: 100, color: '#00FF00', tool: 'pen' })
    get().setBrush({ tool: 'eraser' })
    expect(get().brush).toEqual({ tool: 'eraser', color: '#00FF00', size: 64, hue: 120, sat: 100, val: 100 })
  })

  it('跨回合保留：新回合進入 drawing、回合結束、reset 都不重設畫筆', () => {
    get().setBrush({ color: '#FF8000', size: 33, hue: 30, sat: 100, val: 100 })
    const brush = get().brush
    get().setRound(round({ phase: 'drawing', drawerId: 'me' }))
    get().setRound(round({ phase: 'ended', drawerId: 'me' }))
    get().setRound(round({ phase: 'idle' }))
    get().reset()
    expect(get().brush).toEqual(brush)
  })
})

describe('store：resuming（有重連憑證、自動重新加入中；Epic 4 決策 4）', () => {
  it('預設 false（啟動時由 socket/client 依憑證設定）；setResuming 切換', () => {
    expect(get().resuming).toBe(false)
    get().setResuming(true)
    expect(get().resuming).toBe(true)
    get().setResuming(false)
    expect(get().resuming).toBe(false)
  })

  it('加入成功（套用快照）不改動 resuming', () => {
    get().setResuming(true)
    get().applySnapshot(snapshot({ players: [player('me', 0)] }))
    expect(get().me).toBe('me')
    expect(get().resuming).toBe(true)
    useGameStore.setState({ resuming: false })
    get().applySnapshot(snapshot({ players: [player('me', 0)] }))
    expect(get().resuming).toBe(false)
  })

  it('reset（自動重加入失敗、被其他分頁接管、沒有憑證可接管）→ false，並帶首頁錯誤', () => {
    get().setResuming(true)
    get().reset('自動重新加入失敗：x')
    expect(get().resuming).toBe(false)
    expect(get().me).toBeNull()
    expect(get().joinError).toBe('自動重新加入失敗：x')
  })

  it('其他狀態變化（連線、自動加入旗標、錯誤）不改動 resuming', () => {
    get().setResuming(true)
    get().setConnection('connecting')
    get().setAutoJoining(true)
    get().setAutoJoining(false)
    get().setJoinError('x')
    get().setConnection('connected')
    expect(get().resuming).toBe(true)
  })
})
