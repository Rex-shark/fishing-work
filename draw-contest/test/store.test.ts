// 繪圖比賽的 store（store/game；spec/draw-contest/architecture.md §7）：本機畫布、交卷狀態、揭曉畫廊的 object URL 生命週期、
// 新回合清空、快照（加入／重連接管）、聊天去重、畫筆、resuming、評語（Epic 15：contest:comment 補進 results）。
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import {
  BRUSH_DEFAULT,
  PALETTE,
  type ChatMessage,
  type PlayerPublic,
  type ResultEntry,
  type RoomSnapshot,
  type RoundPublic,
} from '@fishing-work/shared/draw-contest'
import { hsvToHex } from '../src/features/canvas/brush'
import type { DrawOp } from '../src/features/canvas/ops'
import { CHAT_LOCAL_LIMIT } from '../src/features/chat/chatFormat'
import {
  galleryBytes,
  initialBrush,
  initialGameState,
  initialRound,
  isNewRound,
  selectCanDraw,
  selectIsParticipant,
  selectIsSetter,
  selectShowCanvas,
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
  connected: true,
  joinedAt: 0,
  isSetter: false,
  participating: false,
  submitted: false,
  ...patch,
})
const snapshot = (patch: Partial<RoomSnapshot>): RoomSnapshot => ({
  you: 'me',
  players: [],
  round: initialRound,
  chat: [],
  ...patch,
})
const png = (n = 8) => new Uint8Array(n).fill(1).buffer
/** 一筆已交卷的揭曉結果（預設：沒有評語、也不在產生中） */
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

const get = () => useGameStore.getState()

let created: MockInstance<typeof URL.createObjectURL>
let revoked: MockInstance<typeof URL.revokeObjectURL>
let seq = 0

beforeEach(() => {
  useGameStore.setState({ ...initialGameState, gallery: new Map() })
  seq = 0
  created = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test/${++seq}`)
  revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** 已加入、正在第 n 回合作畫（自己是參賽者） */
function joinDrawing(roundNo = 1) {
  get().applySnapshot(snapshot({ players: [player('me', 0, { participating: true })], round: round({ roundNo, phase: 'drawing', participantIds: ['me'] }) }))
}

describe('store：本機畫布（myCanvas）正規化與全量重繪版本', () => {
  it('begin / move / end 追加，不遞增 version', () => {
    get().applyCanvasOp(begin('s1'))
    get().applyCanvasOp({ type: 'move', strokeId: 's1', points: [{ x: 0.1, y: 0.1 }] })
    get().applyCanvasOp(end('s1'))
    expect(get().myCanvas.ops).toHaveLength(3)
    expect(get().myCanvas.version).toBe(0)
  })

  it('undo 移除該筆畫全部 op 並遞增 version', () => {
    for (const op of [begin('a'), end('a'), begin('b'), end('b')]) get().applyCanvasOp(op)
    get().applyCanvasOp({ type: 'undo', strokeId: 'b' })
    expect(get().myCanvas.ops).toEqual([begin('a'), end('a')])
    expect(get().myCanvas.version).toBe(1)
  })

  it('background：只留最後一個、不遞增 version；clear 只清筆跡保留背景', () => {
    get().applyCanvasOp({ type: 'background', color: '#000000' })
    get().applyCanvasOp(begin('a'))
    get().applyCanvasOp({ type: 'background', color: '#FFECEA' })
    expect(get().myCanvas.ops).toEqual([{ type: 'background', color: '#FFECEA' }, begin('a')])
    expect(get().myCanvas.version).toBe(0)
    get().applyCanvasOp({ type: 'clear' })
    expect(get().myCanvas.ops).toEqual([{ type: 'background', color: '#FFECEA' }])
    expect(get().myCanvas.version).toBe(1)
  })
})

describe('store：新回合（roundNo 變大）清空本機畫布、交卷狀態與畫廊', () => {
  it('isNewRound：只看 roundNo 變大', () => {
    expect(isNewRound({ roundNo: 1 }, { roundNo: 2 })).toBe(true)
    expect(isNewRound({ roundNo: 2 }, { roundNo: 2 })).toBe(false)
    expect(isNewRound({ roundNo: 2 }, { roundNo: 1 })).toBe(false)
  })

  it('drawing 開始：清畫布（version 遞增）、submitted 歸零；同回合的更新不清', () => {
    joinDrawing(1)
    get().applyCanvasOp(begin('a'))
    get().markSubmitted()
    get().setRound(round({ roundNo: 1, phase: 'judging', participantIds: ['me'] }))
    expect(get().myCanvas.ops).toHaveLength(1)
    expect(get().submitted).toBe(true)
    const v = get().myCanvas.version
    get().setRound(round({ roundNo: 2, phase: 'drawing', participantIds: ['me'] }))
    expect(get().myCanvas.ops).toEqual([])
    expect(get().myCanvas.version).toBe(v + 1)
    expect(get().submitted).toBe(false)
  })

  it('ended → idle → choosing 保留畫布與畫廊（下一回合 drawing 開始才清）', () => {
    joinDrawing(1)
    get().applyCanvasOp(begin('a'))
    get().setRound(round({ roundNo: 1, phase: 'ended', results: [] }))
    get().addGalleryImage({ roundNo: 1, playerId: 'me', png: png() })
    get().setRound(round({ roundNo: 1, phase: 'idle', results: [] }))
    get().setRound(round({ roundNo: 1, phase: 'choosing', setterId: 'p2', results: [] }))
    expect(get().myCanvas.ops).toHaveLength(1)
    expect(get().gallery.size).toBe(1)
    expect(revoked).not.toHaveBeenCalled()
  })
})

describe('store：揭曉畫廊（gallery）的 object URL 生命週期', () => {
  it('roundNo 相符才建 object URL（image/png）；不符的忽略', () => {
    joinDrawing(3)
    get().setRound(round({ roundNo: 3, phase: 'ended', results: [] }))
    get().addGalleryImage({ roundNo: 3, playerId: 'a', png: png() })
    get().addGalleryImage({ roundNo: 2, playerId: 'b', png: png() })
    get().addGalleryImage({ roundNo: 4, playerId: 'c', png: png() })
    expect([...get().gallery]).toEqual([['a', 'blob:test/1']])
    expect(created).toHaveBeenCalledTimes(1)
    const blob = created.mock.calls[0][0] as Blob
    expect(blob.type).toBe('image/png')
    expect(blob.size).toBe(8)
  })

  it('同一人重送：revoke 舊的、換新的', () => {
    joinDrawing(1)
    get().addGalleryImage({ roundNo: 1, playerId: 'a', png: png() })
    get().addGalleryImage({ roundNo: 1, playerId: 'a', png: png(16) })
    expect(get().gallery.get('a')).toBe('blob:test/2')
    expect(revoked).toHaveBeenCalledWith('blob:test/1')
  })

  it('空的或型別不對的 png 不建 URL', () => {
    joinDrawing(1)
    get().addGalleryImage({ roundNo: 1, playerId: 'a', png: new ArrayBuffer(0) })
    get().addGalleryImage({ roundNo: 1, playerId: 'b', png: 'x' as unknown as ArrayBuffer })
    expect(get().gallery.size).toBe(0)
    expect(created).not.toHaveBeenCalled()
  })

  it('galleryBytes 接受 ArrayBuffer 與 TypedArray 視圖', () => {
    expect(galleryBytes(png(4))?.byteLength).toBe(4)
    const view = new Uint8Array([9, 1, 2, 3]).subarray(1)
    expect(Array.from(galleryBytes(view) ?? [])).toEqual([1, 2, 3])
    expect(galleryBytes(new ArrayBuffer(0))).toBeNull()
    expect(galleryBytes(null)).toBeNull()
  })

  it('新回合 drawing 開始：revoke 全部並清空；之後上一回合遲到的圖也不收', () => {
    joinDrawing(1)
    get().setRound(round({ roundNo: 1, phase: 'ended', results: [] }))
    get().addGalleryImage({ roundNo: 1, playerId: 'a', png: png() })
    get().addGalleryImage({ roundNo: 1, playerId: 'b', png: png() })
    get().setRound(round({ roundNo: 2, phase: 'drawing', participantIds: ['me'] }))
    expect(get().gallery.size).toBe(0)
    expect(revoked.mock.calls.map((c) => c[0]).sort()).toEqual(['blob:test/1', 'blob:test/2'])
    get().addGalleryImage({ roundNo: 1, playerId: 'a', png: png() })
    expect(get().gallery.size).toBe(0)
  })

  it('reset（回首頁）revoke 全部', () => {
    joinDrawing(1)
    get().addGalleryImage({ roundNo: 1, playerId: 'a', png: png() })
    get().reset()
    expect(get().gallery.size).toBe(0)
    expect(revoked).toHaveBeenCalledWith('blob:test/1')
  })

  it('中途加入（快照為揭曉中的回合）：join 後補收的圖照收', () => {
    get().applySnapshot(snapshot({ round: round({ roundNo: 5, phase: 'ended', results: [] }) }))
    get().addGalleryImage({ roundNo: 5, playerId: 'a', png: png() })
    expect(get().gallery.get('a')).toBe('blob:test/1')
  })
})

describe('store：評語（contest:comment → round.results；Epic 15、architecture §4／§5）', () => {
  /** 已加入、第 n 回合已揭曉：a、b 的評語還在產生，c 揭曉前就有評語，d 未交卷 */
  function joinEnded(roundNo = 3) {
    joinDrawing(roundNo)
    get().setRound(
      round({
        roundNo,
        phase: 'ended',
        commentMode: 'ai',
        results: [
          result('a', 1, { commentPending: true }),
          result('b', 2, { commentPending: true }),
          result('c', 3, { comment: '早就寫好了' }),
          result('d', 4, { submitted: false, submittedAt: null, judgedBy: null, confidence: null, score: 0 }),
        ],
      }),
    )
  }
  const comments = () => get().round.results?.map((r) => [r.playerId, r.comment, r.commentPending])

  it('initialRound.commentMode 為 null', () => {
    expect(initialRound.commentMode).toBeNull()
  })

  it('正常：填入該玩家的 comment、commentPending 設 false；其他人不動', () => {
    joinEnded()
    const before = get().round.results ?? []
    get().applyComment({ roundNo: 3, playerId: 'a', comment: '雜魚～' })
    expect(comments()).toEqual([
      ['a', '雜魚～', false],
      ['b', null, true],
      ['c', '早就寫好了', false],
      ['d', null, false],
    ])
    const after = get().round.results ?? []
    // 只換被改到的那一筆與陣列本身；其餘欄位與其他筆的物件參照不變
    expect(after).not.toBe(before)
    expect(after[0]).toEqual({ ...before[0], comment: '雜魚～', commentPending: false })
    for (const i of [1, 2, 3]) expect(after[i]).toBe(before[i])
    expect(get().round.phase).toBe('ended')
    expect(get().round.commentMode).toBe('ai')
  })

  it('失敗（comment null）：commentPending 設 false、comment 維持 null（不再顯示「…」）', () => {
    joinEnded()
    get().applyComment({ roundNo: 3, playerId: 'b', comment: null })
    expect(comments()?.[1]).toEqual(['b', null, false])
    expect(comments()?.[0]).toEqual(['a', null, true])
  })

  it('逐張到齊：每張各自更新', () => {
    joinEnded()
    get().applyComment({ roundNo: 3, playerId: 'b', comment: '二號' })
    get().applyComment({ roundNo: 3, playerId: 'a', comment: '一號' })
    expect(comments()?.slice(0, 2)).toEqual([
      ['a', '一號', false],
      ['b', '二號', false],
    ])
  })

  it('回合不符（上一回合遲到的、或未來的）：忽略，狀態參照不變', () => {
    joinEnded(3)
    const before = get().round
    get().applyComment({ roundNo: 2, playerId: 'a', comment: '舊的' })
    get().applyComment({ roundNo: 4, playerId: 'a', comment: '新的' })
    expect(get().round).toBe(before)
  })

  it('找不到該玩家（不在 results 裡）：忽略', () => {
    joinEnded()
    const before = get().round
    get().applyComment({ roundNo: 3, playerId: 'zzz', comment: '誰' })
    expect(get().round).toBe(before)
  })

  it('results 為 null（還沒揭曉、或初始狀態）：忽略', () => {
    joinDrawing(3)
    get().setRound(round({ roundNo: 3, phase: 'judging', participantIds: ['me'], commentMode: 'ai' }))
    const before = get().round
    get().applyComment({ roundNo: 3, playerId: 'a', comment: '太早' })
    expect(get().round).toBe(before)
    expect(get().round.results).toBeNull()
    useGameStore.setState({ ...initialGameState, gallery: new Map() })
    get().applyComment({ roundNo: 0, playerId: 'a', comment: 'x' })
    expect(get().round).toBe(initialRound)
  })

  it('新回合開始後，上一回合遲到的評語不會寫進新回合', () => {
    joinEnded(3)
    get().setRound(round({ roundNo: 4, phase: 'drawing', participantIds: ['me'] }))
    get().applyComment({ roundNo: 3, playerId: 'a', comment: '遲到' })
    expect(get().round.results).toBeNull()
    get().setRound(round({ roundNo: 4, phase: 'ended', results: [result('a', 1, { commentPending: true })] }))
    get().applyComment({ roundNo: 3, playerId: 'a', comment: '遲到' })
    expect(comments()).toEqual([['a', null, true]])
  })

  it('順序一：round:update（pending）→ contest:comment → 之後的 round:update 帶 server 的最新 results（直接採用，評語還在）', () => {
    joinEnded()
    get().applyComment({ roundNo: 3, playerId: 'a', comment: '雜魚～' })
    // server 發 contest:comment 時已同步更新自己的 results；之後的 round:update（例如有人出題 → choosing）帶的就是最新值
    get().setRound(
      round({
        roundNo: 3,
        phase: 'choosing',
        setterId: 'p2',
        commentMode: 'ai',
        results: [result('a', 1, { comment: '雜魚～' }), result('b', 2, { commentPending: true }), result('c', 3, { comment: '早就寫好了' })],
      }),
    )
    expect(comments()).toEqual([
      ['a', '雜魚～', false],
      ['b', null, true],
      ['c', '早就寫好了', false],
    ])
    // 回合狀態換了（choosing）之後，同一回合的評語照樣補得上
    get().applyComment({ roundNo: 3, playerId: 'b', comment: '二號' })
    expect(comments()?.[1]).toEqual(['b', '二號', false])
  })

  it('順序二：帶最新 results 的 round:update 先到、同一則 contest:comment 後到：結果相同（重複套用無害）', () => {
    joinEnded()
    get().setRound(
      round({ roundNo: 3, phase: 'ended', commentMode: 'ai', results: [result('a', 1, { comment: '雜魚～' }), result('b', 2, { commentPending: true })] }),
    )
    get().applyComment({ roundNo: 3, playerId: 'a', comment: '雜魚～' })
    get().applyComment({ roundNo: 3, playerId: 'a', comment: '雜魚～' })
    expect(comments()).toEqual([
      ['a', '雜魚～', false],
      ['b', null, true],
    ])
  })

  it('順序三：contest:comment 比揭曉的 round:update 早到（當下 results 為 null → 忽略），隨後的 results 以 server 為準直接採用', () => {
    joinDrawing(3)
    get().setRound(round({ roundNo: 3, phase: 'judging', participantIds: ['me'], commentMode: 'ai' }))
    get().applyComment({ roundNo: 3, playerId: 'a', comment: '雜魚～' })
    expect(get().round.results).toBeNull()
    get().setRound(round({ roundNo: 3, phase: 'ended', commentMode: 'ai', results: [result('a', 1, { comment: '雜魚～' }), result('b', 2, { commentPending: true })] }))
    expect(comments()).toEqual([
      ['a', '雜魚～', false],
      ['b', null, true],
    ])
  })

  it('第一名稱讚版（Phase 4）：揭曉的 round:update 把第一名重設為 pending（其他人已有評語）→ contest:comment 補上稱讚句', () => {
    joinDrawing(3)
    get().setRound(round({ roundNo: 3, phase: 'judging', participantIds: ['me'], commentMode: 'ai' }))
    // 揭曉：第一名不論原本評語是否完成，一律 comment null、commentPending true（architecture §5）；其他人維持原值
    get().setRound(
      round({
        roundNo: 3,
        phase: 'ended',
        commentMode: 'ai',
        results: [result('a', 1, { commentPending: true }), result('b', 2, { comment: '雜魚～' }), result('c', 3, { comment: '就這？' })],
      }),
    )
    expect(comments()).toEqual([
      ['a', null, true],
      ['b', '雜魚～', false],
      ['c', '就這？', false],
    ])
    const before = get().round.results ?? []
    get().applyComment({ roundNo: 3, playerId: 'a', comment: '哼，勉強算你厲害啦～' })
    expect(comments()).toEqual([
      ['a', '哼，勉強算你厲害啦～', false],
      ['b', '雜魚～', false],
      ['c', '就這？', false],
    ])
    const after = get().round.results ?? []
    for (const i of [1, 2]) expect(after[i]).toBe(before[i])
  })

  it('第一名稱讚版：中途加入的快照裡第一名仍是 pending，之後的 contest:comment 照樣補上；稱讚版失敗（null）就沒有評語', () => {
    get().applySnapshot(
      snapshot({ round: round({ roundNo: 5, phase: 'ended', commentMode: 'ai', results: [result('a', 1, { commentPending: true }), result('b', 2, { comment: '雜魚～' })] }) }),
    )
    get().applyComment({ roundNo: 5, playerId: 'a', comment: '哼，勉強算你厲害啦～' })
    expect(comments()?.[0]).toEqual(['a', '哼，勉強算你厲害啦～', false])
    get().setRound(round({ roundNo: 6, phase: 'drawing', participantIds: ['me'] }))
    get().setRound(round({ roundNo: 6, phase: 'ended', commentMode: 'ai', results: [result('a', 1, { commentPending: true }), result('b', 2, { comment: '雜魚～' })] }))
    get().applyComment({ roundNo: 6, playerId: 'a', comment: null })
    expect(comments()).toEqual([
      ['a', null, false],
      ['b', '雜魚～', false],
    ])
  })

  it('同一人收到第二則 contest:comment（已不是 pending）：以後到的為準', () => {
    joinEnded()
    get().applyComment({ roundNo: 3, playerId: 'a', comment: '第一句' })
    get().applyComment({ roundNo: 3, playerId: 'a', comment: '第二句' })
    expect(comments()?.[0]).toEqual(['a', '第二句', false])
    // 已有評語者（c：揭曉前就寫好）也一樣會被後到的事件覆蓋
    get().applyComment({ roundNo: 3, playerId: 'c', comment: '改寫' })
    expect(comments()?.[2]).toEqual(['c', '改寫', false])
  })

  it('本回合評語失敗（ended 之後）：仍 pending 的各收到一則 null，再收到 commentMode off 的 round:update；已產生的評語保留', () => {
    joinEnded()
    get().applyComment({ roundNo: 3, playerId: 'a', comment: null })
    get().applyComment({ roundNo: 3, playerId: 'b', comment: null })
    get().setRound(
      round({
        roundNo: 3,
        phase: 'ended',
        commentMode: 'off',
        results: [result('a', 1), result('b', 2), result('c', 3, { comment: '早就寫好了' }), result('d', 4, { submitted: false })],
      }),
    )
    expect(get().round.commentMode).toBe('off')
    expect(comments()).toEqual([
      ['a', null, false],
      ['b', null, false],
      ['c', '早就寫好了', false],
      ['d', null, false],
    ])
  })

  it('中途加入（快照為揭曉中的回合）：results 的評語直接採用，之後的 contest:comment 照收', () => {
    get().applySnapshot(
      snapshot({
        round: round({ roundNo: 5, phase: 'ended', commentMode: 'ai', results: [result('a', 1, { comment: '雜魚～' }), result('b', 2, { commentPending: true })] }),
      }),
    )
    expect(comments()).toEqual([
      ['a', '雜魚～', false],
      ['b', null, true],
    ])
    get().applyComment({ roundNo: 5, playerId: 'b', comment: '二號' })
    expect(comments()?.[1]).toEqual(['b', '二號', false])
  })

  it('重連接管同一回合：快照的 results 覆蓋本機的（斷線期間漏收的評語補回來）', () => {
    joinEnded(3)
    get().applySnapshot(
      snapshot({
        players: [player('me', 0)],
        round: round({ roundNo: 3, phase: 'ended', commentMode: 'ai', results: [result('a', 1, { comment: '漏收的' }), result('b', 2, { comment: '也是' })] }),
      }),
    )
    expect(comments()).toEqual([
      ['a', '漏收的', false],
      ['b', '也是', false],
    ])
  })

  it('不動其他狀態：畫廊、本機畫布、交卷狀態', () => {
    joinEnded()
    get().addGalleryImage({ roundNo: 3, playerId: 'a', png: png() })
    const { gallery, myCanvas, submitted, players } = get()
    get().applyComment({ roundNo: 3, playerId: 'a', comment: '雜魚～' })
    expect(get().gallery).toBe(gallery)
    expect(get().myCanvas).toBe(myCanvas)
    expect(get().submitted).toBe(submitted)
    expect(get().players).toBe(players)
    expect(revoked).not.toHaveBeenCalled()
  })
})

describe('store：快照（加入、重連接管）', () => {
  it('重連接管同一回合：保留本機畫布、畫廊與交卷狀態（斷線不丟畫）', () => {
    joinDrawing(2)
    get().applyCanvasOp(begin('a'))
    get().addGalleryImage({ roundNo: 2, playerId: 'x', png: png() })
    get().markSubmitted()
    get().applySnapshot(snapshot({ players: [player('me', 0, { participating: true })], round: round({ roundNo: 2, phase: 'drawing', participantIds: ['me'] }) }))
    expect(get().myCanvas.ops).toHaveLength(1)
    expect(get().gallery.size).toBe(1)
    expect(get().submitted).toBe(true)
  })

  it('快照換了回合：清畫布、revoke 畫廊', () => {
    joinDrawing(2)
    get().applyCanvasOp(begin('a'))
    get().addGalleryImage({ roundNo: 2, playerId: 'x', png: png() })
    get().applySnapshot(snapshot({ round: round({ roundNo: 3, phase: 'drawing' }) }))
    expect(get().myCanvas.ops).toEqual([])
    expect(get().gallery.size).toBe(0)
    expect(revoked).toHaveBeenCalledWith('blob:test/1')
  })

  it('快照裡自己已交卷 → submitted', () => {
    get().applySnapshot(snapshot({ players: [player('me', 0, { participating: true, submitted: true })], round: round({ roundNo: 1, phase: 'drawing', participantIds: ['me'] }) }))
    expect(get().submitted).toBe(true)
  })
})

describe('store：交卷狀態與選擇器', () => {
  it('players:update 的 submitted 只會把它設為 true；新回合才歸零', () => {
    joinDrawing(1)
    get().setPlayers([player('me', 0, { participating: true, submitted: true })])
    expect(get().submitted).toBe(true)
    get().setPlayers([player('me', 0, { participating: true, submitted: false })])
    expect(get().submitted).toBe(true)
    get().setRound(round({ roundNo: 2, phase: 'drawing', participantIds: ['me'] }))
    expect(get().submitted).toBe(false)
  })

  it('selectCanDraw：參賽者、drawing、未交卷、不在交卷途中', () => {
    joinDrawing(1)
    expect(selectCanDraw(get())).toBe(true)
    get().setSubmitting(true)
    expect(selectCanDraw(get())).toBe(false)
    get().setSubmitting(false)
    get().markSubmitted()
    expect(selectCanDraw(get())).toBe(false)
  })

  it('旁觀者（不在 participantIds）不能畫、不顯示畫布', () => {
    get().applySnapshot(snapshot({ round: round({ roundNo: 1, phase: 'drawing', participantIds: ['p2'] }) }))
    expect(selectIsParticipant(get())).toBe(false)
    expect(selectCanDraw(get())).toBe(false)
    expect(selectShowCanvas(get())).toBe(false)
  })

  it('selectShowCanvas：參賽者在 drawing、judging 顯示（交卷後鎖定）；其餘階段不顯示', () => {
    joinDrawing(1)
    expect(selectShowCanvas(get())).toBe(true)
    get().setRound(round({ roundNo: 1, phase: 'judging', participantIds: ['me'] }))
    expect(selectShowCanvas(get())).toBe(true)
    expect(selectCanDraw(get())).toBe(false)
    get().setRound(round({ roundNo: 1, phase: 'ended', participantIds: ['me'], results: [] }))
    expect(selectShowCanvas(get())).toBe(false)
  })

  it('selectIsSetter：setterId 等於自己', () => {
    get().applySnapshot(snapshot({ round: round({ phase: 'choosing', setterId: 'me' }) }))
    expect(selectIsSetter(get())).toBe(true)
    get().setRound(round({ phase: 'choosing', setterId: 'p2' }))
    expect(selectIsSetter(get())).toBe(false)
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
    get().setRound(round({ roundNo: 1, phase: 'drawing', setterId: 'me' }))
    get().setRound(round({ roundNo: 1, phase: 'ended', setterId: 'me' }))
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
