import { create } from 'zustand'
import {
  BRUSH_DEFAULT,
  PALETTE,
  type ChatMessage,
  type DrawOp,
  type PlayerPublic,
  type RoomSnapshot,
  type RoundPublic,
  type Tool,
} from '@fishing-work/shared'
import { compactOps, replaceBackground } from '../features/canvas/render'
import { appendChatMessage, trimChat } from '../features/chat/chatFormat'
import {
  addImageUrl,
  statusFromSnapshot,
  statusOnImageSkipped,
  statusOnImageUrl,
  statusOnLiveMessage,
  type ImageStatus,
} from '../features/chat/imageUrls'
import { baselineFromSnapshot, captureBaseline, scoreGain, type ScoreBaseline } from '../features/players/scoreDelta'

export type ConnectionState = 'disconnected' | 'connecting' | 'connected'

/**
 * 畫師工具列狀態（只影響本機產生的 begin op）。
 * 跨回合保留（reset 回首頁也不清）：同一位畫師下次作畫沿用上次的顏色與粗細
 */
export interface Brush {
  tool: Tool
  /** 目前顏色，大寫 #RRGGBB；永遠＝hsvToHex(hue, sat, val)（預設色塊或顏色面板；spec §4 COLOR_PATTERN、§6「顏色」） */
  color: string
  /** 粗細，整數 BRUSH_MIN..BRUSH_MAX（邏輯像素） */
  size: number
  /** 色相 0..359°（顏色面板色相條；點灰階色塊時保留原值） */
  hue: number
  /** 飽和度 0..100%（顏色面板方塊 x；面板操作為整數，點色塊反推可能帶小數，見 brush.hexToHsv） */
  sat: number
  /** 明度 0..100%（顏色面板方塊 y；同 sat） */
  val: number
}

export interface GameState {
  /** 自己的 player id（server 產生的穩定 id，不是 socket.id）；未加入為 null */
  me: string | null
  players: PlayerPublic[]
  round: RoundPublic
  /** 本回合筆跡歷史（已化簡：不含 undo / clear，被撤銷的筆畫已移除） */
  ops: DrawOp[]
  /**
   * ops 被「非追加」地改變（快照、undo、clear、新回合）時遞增。
   * Canvas 以此判斷要全量重繪；版本不變時只增量繪製新追加的 op。
   */
  opsVersion: number
  brush: Brush
  /** 聊天訊息（以 id 去重，本地最多 CHAT_LOCAL_LIMIT 則） */
  chat: ChatMessage[]
  /**
   * 聊天圖片的 Blob URL（聊天訊息 id → URL；插入順序即新舊）。只留最近 IMAGE_URL_LIMIT 張，
   * 被擠掉與 reset 時 revoke（plan/chat-image.md 決策 7）。沒有 URL 的 image 訊息顯示佔位
   */
  imageUrls: Map<string, string>
  /**
   * 聊天圖片的顯示狀態（訊息 id → pending／ready／skipped／revoked／snapshot，見 imageUrls.ImageStatus）：
   * 決定沒有 URL 時顯示「載入中…」「連線較慢，已略過」「已清除」或「中途加入看不到」。只記仍在 chat 裡的 image 訊息
   */
  imageStatus: Map<string, ImageStatus>
  /** 本回合開始時各玩家的分數（進入 drawing 時記下），用來顯示「你猜對了 +N」與回合結束的得分變化；未知為 null */
  scoreBaseline: ScoreBaseline | null
  connection: ConnectionState
  /** 首頁要顯示的錯誤（加入失敗、自動重加入失敗、被其他連線接手） */
  joinError: string | null
  /** 以 sessionStorage 的 token 自動重加入中（首頁此時停用輸入） */
  autoJoining: boolean
  /**
   * 有重連憑證、正在（或等待連線後）自動重新加入（plan/home-page.md 決策 4）：App 顯示殼層的 resume 畫面而不是首頁。
   * 啟動時＝有 sessionStorage 憑證（socket/client 載入時設定）；自動重加入失敗、清掉憑證、被其他分頁接管（reset）→ false；
   * 加入成功不改動（已加入時 App 一律顯示遊戲畫面）。自動重加入途中斷線維持 true（下次 connect 再試）
   */
  resuming: boolean
}

export interface GameActions {
  applySnapshot(s: RoomSnapshot): void
  setPlayers(players: PlayerPublic[]): void
  /** 套用 round:update；進入 drawing 時清空 ops（新回合開始）並記下分數基準 */
  setRound(round: RoundPublic): void
  /** 套用一個 op（他人轉發或自己產生）：clear 清空、undo 移除該筆畫、其餘追加 */
  appendOp(op: DrawOp): void
  /** 整批替換 ops（全量重繪） */
  applyOps(ops: readonly DrawOp[]): void
  setBrush(patch: Partial<Brush>): void
  /** 追加一則聊天：以 id 去重、超過 CHAT_LOCAL_LIMIT 捨棄最舊的 */
  appendChat(m: ChatMessage): void
  /** 收到 chat:image 的 bytes 並建好 Blob URL 後登記；超過上限 revoke 最舊的 */
  addImageUrl(id: string, url: string): void
  /** 收到 chat:image 的 data 為 null（server 因本連線待送量過大略過這張）：標記 skipped，不建立 Blob URL */
  markImageSkipped(id: string): void
  setConnection(connection: ConnectionState): void
  setJoinError(message: string | null): void
  setAutoJoining(value: boolean): void
  setResuming(value: boolean): void
  /** 回到未加入狀態（保留 connection；resuming 一併轉 false＝回首頁）；可順便設定首頁錯誤 */
  reset(joinError?: string | null): void
}

export const initialRound: RoundPublic = {
  phase: 'idle',
  drawerId: null,
  topic: null,
  topicLength: null,
  startedAt: null,
  endsAt: null,
  correctIds: [],
  endReason: null,
}

/** 自己是否為本回合畫師（choosing / drawing 皆算） */
export const selectIsDrawer = (s: GameState): boolean => s.me !== null && s.round.drawerId === s.me

/** 自己此刻可以作畫：是畫師且 phase = drawing */
export const selectCanDraw = (s: GameState): boolean => selectIsDrawer(s) && s.round.phase === 'drawing'

/** 自己本回合已猜對：players:update 的 hasGuessed 或 round 的 correctIds，任一先到即算 */
export const selectHasGuessed = (s: GameState): boolean =>
  s.me !== null && (s.round.correctIds.includes(s.me) || s.players.some((p) => p.id === s.me && p.hasGuessed))

/** 自己本回合得分（猜對者的得分、或回合結束時畫師的結算）；基準不明或未加分為 null */
export const selectMyGain = (s: GameState): number | null => {
  const me = s.players.find((p) => p.id === s.me)
  return me === undefined ? null : scoreGain(s.scoreBaseline, me)
}

/** 預設白筆（PALETTE[0]＝hsvToHex(0, 0, 100)；Epic 11 決策 3） */
export const initialBrush: Brush = { tool: 'pen', color: PALETTE[0], size: BRUSH_DEFAULT, hue: 0, sat: 0, val: 100 }

export const initialGameState: GameState = {
  me: null,
  players: [],
  round: initialRound,
  ops: [],
  opsVersion: 0,
  brush: initialBrush,
  chat: [],
  imageUrls: new Map(),
  imageStatus: new Map(),
  scoreBaseline: null,
  connection: 'disconnected',
  joinError: null,
  autoJoining: false,
  resuming: false,
}

export const useGameStore = create<GameState & GameActions>()((set) => ({
  ...initialGameState,

  // 快照的 image 訊息：本機仍有 URL → ready；先前已釋放 → revoked；先前被略過 → skipped；其餘（含斷線前仍 pending 的）→ snapshot
  applySnapshot: (s) =>
    set((state) => {
      const chat = trimChat(s.chat)
      return {
        me: s.you,
        players: s.players,
        round: s.round,
        ops: compactOps(s.ops),
        opsVersion: state.opsVersion + 1,
        chat,
        imageStatus: statusFromSnapshot(state.imageStatus, state.imageUrls, chat),
        scoreBaseline: baselineFromSnapshot(s.round.phase, s.players),
        joinError: null,
      }
    }),

  setPlayers: (players) => set({ players }),

  // server 在 setTopic 時會廣播 draw:op {clear}，但契約沒保證畫師本人也收得到；
  // 本機在「進入 drawing」的轉移上自行清空，重複清空無害。
  // 同一時刻記下分數基準（出題到作畫之間分數不變）
  setRound: (round) =>
    set((state) =>
      round.phase === 'drawing' && state.round.phase !== 'drawing'
        ? { round, ops: [], opsVersion: state.opsVersion + 1, scoreBaseline: captureBaseline(state.players) }
        : { round },
    ),

  appendOp: (op) =>
    set((state) => {
      switch (op.type) {
        case 'clear':
          // 只清筆跡，背景保留（architecture §5，Epic 7）
          return { ops: state.ops.filter((o) => o.type === 'background'), opsVersion: state.opsVersion + 1 }
        case 'undo':
          return {
            ops: state.ops.filter((o) => o.type === 'background' || o.type === 'clear' || o.strokeId !== op.strokeId),
            opsVersion: state.opsVersion + 1,
          }
        case 'background':
          // 只留最後一個（原地取代或附加）；背景不畫進畫布，筆跡不必重繪，opsVersion 不變
          return { ops: replaceBackground(state.ops, op) }
        default:
          return { ops: [...state.ops, op] }
      }
    }),

  applyOps: (ops) => set((state) => ({ ops: compactOps(ops), opsVersion: state.opsVersion + 1 })),

  setBrush: (patch) => set((state) => ({ brush: { ...state.brush, ...patch } })),

  // 以 id 去重：快照與廣播可能帶到同一則
  appendChat: (m) =>
    set((state) => {
      const chat = appendChatMessage(state.chat, m)
      if (chat === state.chat) return state
      // 即時收到的 image 訊息：bytes 尚未到 → pending（chat:image 先到則已是 ready）
      return m.kind === 'image'
        ? { chat, imageStatus: statusOnLiveMessage(state.imageStatus, state.imageUrls, m.id, chat) }
        : { chat }
    }),

  addImageUrl: (id, url) =>
    set((state) => {
      const { urls, evicted, evictedIds } = addImageUrl(state.imageUrls, id, url)
      for (const old of evicted) URL.revokeObjectURL(old)
      return { imageUrls: urls, imageStatus: statusOnImageUrl(state.imageStatus, id, evictedIds) }
    }),

  markImageSkipped: (id) =>
    set((state) => ({ imageStatus: statusOnImageSkipped(state.imageStatus, state.imageUrls, id) })),

  setConnection: (connection) => set({ connection }),

  setJoinError: (joinError) => set({ joinError }),

  setAutoJoining: (autoJoining) => set({ autoJoining }),

  setResuming: (resuming) => set({ resuming }),

  // 離開遊戲（回首頁）時釋放所有圖片：不保留（決策 7）。reset 一律回首頁（resuming false）：自動重加入被拒、被接管、沒有憑證可接管時已清憑證；自動重加入逾時用盡（Epic 21 決策 5）則保留憑證，重新整理可再試
  reset: (joinError = null) =>
    set((state) => {
      for (const url of state.imageUrls.values()) URL.revokeObjectURL(url)
      return {
        me: null,
        players: [],
        round: initialRound,
        ops: [],
        opsVersion: state.opsVersion + 1,
        chat: [],
        imageUrls: new Map(),
        imageStatus: new Map(),
        scoreBaseline: null,
        autoJoining: false,
        resuming: false,
        joinError,
      }
    }),
}))
