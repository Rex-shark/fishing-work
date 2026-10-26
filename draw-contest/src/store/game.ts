// 繪圖比賽的遊戲狀態（Zustand；spec/draw-contest/architecture.md §4、§7）。
// 以 server 為準的部分：me、players、round（RoundPublic）、chat；本機才有的部分：
//   myCanvas（自己的筆跡，只在記憶體，交卷時 exportPng 重繪成 PNG；決策 3）、brush、submitted／submitting（本回合交卷）、
//   gallery（揭曉畫廊：playerId → PNG 的 object URL；收到 contest:gallery 且 roundNo 相符才建，新回合開始時全部 revoke）。
// 評語（Epic 15；architecture §4、§5）：round.results 每筆的 comment／commentPending 以 server 為準（快照與 round:update 直接採用），
//   揭曉後才完成的評語由 contest:comment 補進 results（applyComment）。
// 參考圖（Epic 20 像不像比賽；architecture §4、§5.1b、§7）：收到 contest:reference 建 JPEG 的 object URL（reference），以 roundNo 配對；
//   廣播與 round:update 的先後不定，所以 roundNo ≥ 目前回合就收下，顯示時才比對回合（selectReferenceUrl）；新回合、換了回合的快照、reset 時 revoke。
import { create } from 'zustand'
import {
  BRUSH_DEFAULT,
  PALETTE,
  type ChatMessage,
  type CommentUpdate,
  type GalleryImage,
  type PlayerPublic,
  type ReferenceImage,
  type RoomSnapshot,
  type RoundPublic,
} from '@fishing-work/shared/draw-contest'
import { replaceBackground } from '../features/canvas/render'
import type { DrawOp, Tool } from '../features/canvas/ops'
import { appendChatMessage, trimChat } from '../features/chat/chatFormat'

export type ConnectionState = 'disconnected' | 'connecting' | 'connected'

/**
 * 作畫工具列狀態（只影響本機產生的 begin op）。
 * 跨回合保留（reset 回首頁也不清）：下次作畫沿用上次的顏色與粗細
 */
export interface Brush {
  tool: Tool
  /** 目前顏色，大寫 #RRGGBB；永遠＝hsvToHex(hue, sat, val)（預設色塊或顏色面板） */
  color: string
  /** 粗細，整數 BRUSH_MIN..BRUSH_MAX（邏輯像素） */
  size: number
  /** 色相 0..359°（顏色面板色相條；點灰階色塊時保留原值） */
  hue: number
  /** 飽和度 0..100%（顏色面板方塊 x） */
  sat: number
  /** 明度 0..100%（顏色面板方塊 y） */
  val: number
}

/** 自己的本機畫布（決策 3：不中繼、不存 server；重新整理會失去未交卷的畫） */
export interface MyCanvas {
  /** 筆跡歷史（已化簡：不含 undo／clear，被撤銷的筆畫已移除；background 只留最後一個） */
  ops: DrawOp[]
  /**
   * ops 被「非追加」地改變（undo、clear、新回合）時遞增。
   * Canvas 以此判斷要全量重繪；版本不變時只增量繪製新追加的 op
   */
  version: number
}

/** 參考圖（Epic 20）：哪一回合的、JPEG 的 object URL */
export interface ReferenceState {
  roundNo: number
  url: string
}

export interface GameState {
  /** 自己的 player id（server 產生的穩定 id，不是 socket.id）；未加入為 null */
  me: string | null
  players: PlayerPublic[]
  round: RoundPublic
  /** 聊天訊息（以 id 去重，本地最多 CHAT_LOCAL_LIMIT 則） */
  chat: ChatMessage[]
  myCanvas: MyCanvas
  brush: Brush
  /** 本回合自己已交卷（contest:submit 成功，或 players:update 的 submitted）；新回合 drawing 開始時歸零 */
  submitted: boolean
  /** 交卷進行中（匯出 PNG＋等 ack）：避免手動與自動交卷重複送出 */
  submitting: boolean
  /**
   * 揭曉畫廊：playerId → PNG 的 object URL（features/reveal 用）。
   * 只收 roundNo 等於目前 round.roundNo 的圖；新回合 drawing 開始（roundNo 變大）、換了回合的快照、reset 時全部 revoke 並清空
   */
  gallery: Map<string, string>
  /**
   * 像不像比賽的參考圖（Epic 20）：收到 contest:reference 時建 object URL；同時只留一張（後到的換掉前一張並 revoke）。
   * 新回合開始時，比新回合舊的那張 revoke；換了回合的快照、reset 時 revoke
   */
  reference: ReferenceState | null
  connection: ConnectionState
  /** 首頁要顯示的錯誤（加入失敗、自動重加入失敗、被其他連線接手） */
  joinError: string | null
  /** 以 sessionStorage 的 token 自動重加入中（首頁此時停用輸入） */
  autoJoining: boolean
  /**
   * 有重連憑證、正在（或等待連線後）自動重新加入：App 顯示殼層的 resume 畫面而不是首頁。
   * 啟動時＝有 sessionStorage 憑證（socket/client 載入時設定）；自動重加入失敗、清掉憑證、被其他分頁接管（reset）→ false
   */
  resuming: boolean
}

export interface GameActions {
  applySnapshot(s: RoomSnapshot): void
  setPlayers(players: PlayerPublic[]): void
  /** 套用 round:update；新回合開始（roundNo 變大＝drawing 開始）時清空本機畫布、交卷狀態與畫廊 */
  setRound(round: RoundPublic): void
  /** 套用一個本機畫布操作：clear 清筆跡、undo 移除該筆畫、background 換底色、其餘追加 */
  applyCanvasOp(op: DrawOp): void
  setBrush(patch: Partial<Brush>): void
  /** 追加一則聊天：以 id 去重、超過 CHAT_LOCAL_LIMIT 捨棄最舊的 */
  appendChat(m: ChatMessage): void
  /** 收到 contest:gallery：roundNo 與目前回合相符才建 object URL（同一人重送時 revoke 舊的） */
  addGalleryImage(image: GalleryImage): void
  /**
   * 收到 contest:comment（Epic 15：揭曉後評語陸續完成）：roundNo 與目前回合相符且已有 results 時，
   * 把該玩家那筆的 comment 填入（失敗為 null）、commentPending 設 false；回合不符、尚無 results、找不到該玩家都忽略
   */
  applyComment(update: CommentUpdate): void
  /**
   * 收到 contest:reference（Epic 20）：roundNo 不小於目前回合才收（廣播可能比 round:update 早到），建 JPEG 的 object URL；
   * 舊的那張 revoke。bytes 空或型別不對忽略
   */
  setReference(image: ReferenceImage): void
  setSubmitting(value: boolean): void
  /** 交卷成功（ack ok） */
  markSubmitted(): void
  setConnection(connection: ConnectionState): void
  setJoinError(message: string | null): void
  setAutoJoining(value: boolean): void
  setResuming(value: boolean): void
  /** 回到未加入狀態（保留 connection；resuming 一併轉 false＝回首頁）；可順便設定首頁錯誤 */
  reset(joinError?: string | null): void
}

export const initialRound: RoundPublic = {
  roundNo: 0,
  phase: 'idle',
  setterId: null,
  topic: null,
  mode: null,
  startedAt: null,
  endsAt: null,
  participantIds: [],
  submittedCount: 0,
  judgedCount: 0,
  judgeMode: null,
  commentMode: null,
  results: null,
  lastTopic: null,
  lastMode: null,
}

/** 自己是否為本回合出題者 */
export const selectIsSetter = (s: Pick<GameState, 'me' | 'round'>): boolean => s.me !== null && s.round.setterId === s.me

/** 自己是否為本回合參賽者（drawing 開始時在線者；中途加入者 false） */
export const selectIsParticipant = (s: Pick<GameState, 'me' | 'round'>): boolean =>
  s.me !== null && s.round.participantIds.includes(s.me)

/** 自己此刻可以作畫：參賽者、phase = drawing、尚未交卷也不在交卷途中 */
export const selectCanDraw = (s: Pick<GameState, 'me' | 'round' | 'submitted' | 'submitting'>): boolean =>
  selectIsParticipant(s) && s.round.phase === 'drawing' && !s.submitted && !s.submitting

/** 投影片區顯示自己的畫布：參賽者且 drawing／judging（交卷後鎖定）；旁觀者與其他階段為空白投影片 */
export const selectShowCanvas = (s: Pick<GameState, 'me' | 'round'>): boolean =>
  selectIsParticipant(s) && (s.round.phase === 'drawing' || s.round.phase === 'judging')

/**
 * 投影片區顯示揭曉畫廊：idle／ended 且有結果（results 保留到下一回合 drawing 開始；design §2「idle／ended（有結果）」）。
 * choosing 時 results 仍在，但投影片區照 design §2 為空白投影片（出題者的「輸入標題」對話框疊在上面）
 */
export const selectShowReveal = (s: Pick<GameState, 'round'>): boolean =>
  (s.round.phase === 'idle' || s.round.phase === 'ended') && s.round.results !== null

/**
 * 參考圖要顯示的 object URL（Epic 20）：手上那張正是目前回合的才算（揭曉後 idle／ended 的 roundNo 仍是 results 那一回合）；
 * 沒有或不是這一回合的為 null。是否為像不像比賽看 round.mode／lastMode，不看這裡（圖可能還在路上）
 */
export const selectReferenceUrl = (s: Pick<GameState, 'round' | 'reference'>): string | null =>
  s.reference !== null && s.reference.roundNo === s.round.roundNo ? s.reference.url : null

/** 作畫中的參考圖面板（design §2）：本回合是像不像比賽且 drawing／judging；出題者、參賽者、旁觀者都看得到 */
export const selectShowReferencePanel = (s: Pick<GameState, 'round'>): boolean =>
  s.round.mode === 'mimic' && (s.round.phase === 'drawing' || s.round.phase === 'judging')

/** 預設白筆（PALETTE[0]＝hsvToHex(0, 0, 100)） */
export const initialBrush: Brush = { tool: 'pen', color: PALETTE[0], size: BRUSH_DEFAULT, hue: 0, sat: 0, val: 100 }

export const initialGameState: GameState = {
  me: null,
  players: [],
  round: initialRound,
  chat: [],
  myCanvas: { ops: [], version: 0 },
  brush: initialBrush,
  submitted: false,
  submitting: false,
  gallery: new Map(),
  reference: null,
  connection: 'disconnected',
  joinError: null,
  autoJoining: false,
  resuming: false,
}

/** 釋放畫廊的所有 object URL */
function revokeGallery(gallery: ReadonlyMap<string, string>): void {
  for (const url of gallery.values()) URL.revokeObjectURL(url)
}

/** 釋放參考圖的 object URL */
function revokeReference(reference: ReferenceState | null): void {
  if (reference !== null) URL.revokeObjectURL(reference.url)
}

/** players 裡自己的 submitted（找不到為 false） */
function mySubmitted(players: readonly PlayerPublic[], me: string | null): boolean {
  return me !== null && players.some((p) => p.id === me && p.submitted)
}

/**
 * 新回合開始：roundNo 比目前大。roundNo 只在進入 drawing 時遞增（architecture §5），所以這就是「新回合 drawing 開始」；
 * 只看 roundNo 不看 phase，萬一漏收 drawing 那則 round:update（直接收到 judging）也能清掉上一回合的狀態
 */
export function isNewRound(prev: Pick<RoundPublic, 'roundNo'>, next: Pick<RoundPublic, 'roundNo'>): boolean {
  return next.roundNo > prev.roundNo
}

/** GalleryImage.png → bytes（瀏覽器端 socket.io 收到 ArrayBuffer；保險起見也接受 TypedArray 視圖）；空或型別不對回 null */
export function galleryBytes(png: unknown): Uint8Array<ArrayBuffer> | null {
  const bytes =
    png instanceof ArrayBuffer
      ? new Uint8Array(png)
      : ArrayBuffer.isView(png)
        ? new Uint8Array(png.buffer, png.byteOffset, png.byteLength).slice()
        : null
  return bytes === null || bytes.byteLength === 0 ? null : bytes
}

export const useGameStore = create<GameState & GameActions>()((set) => ({
  ...initialGameState,

  // 加入或重連接管：同一回合（roundNo 相同）保留本機畫布與畫廊（斷線重連不丟畫）；換了回合就清掉。
  // 揭曉中的回合，server 會在 join ack 之後補送 contest:gallery（決策 8）
  applySnapshot: (s) =>
    set((state) => {
      const sameRound = s.round.roundNo === state.round.roundNo && state.me !== null
      if (!sameRound) {
        revokeGallery(state.gallery)
        revokeReference(state.reference)
      }
      return {
        me: s.you,
        players: s.players,
        round: s.round,
        chat: trimChat(s.chat),
        myCanvas: sameRound ? state.myCanvas : { ops: [], version: state.myCanvas.version + 1 },
        submitted: (sameRound && state.submitted) || mySubmitted(s.players, s.you),
        submitting: sameRound ? state.submitting : false,
        gallery: sameRound ? state.gallery : new Map(),
        reference: sameRound ? state.reference : null,
        joinError: null,
      }
    }),

  // submitted 只會在新回合歸零（setRound）；players:update 只能把它設為 true（ack 與廣播先後不定）
  setPlayers: (players) => set((state) => ({ players, submitted: state.submitted || mySubmitted(players, state.me) })),

  setRound: (round) =>
    set((state) => {
      if (!isNewRound(state.round, round)) return { round }
      revokeGallery(state.gallery)
      // 參考圖的廣播可能比這則 round:update 早到：已是新回合（或更新）的那張留著
      const keepReference = state.reference !== null && state.reference.roundNo >= round.roundNo
      if (!keepReference) revokeReference(state.reference)
      return {
        round,
        myCanvas: { ops: [], version: state.myCanvas.version + 1 },
        submitted: false,
        submitting: false,
        gallery: new Map(),
        reference: keepReference ? state.reference : null,
      }
    }),

  applyCanvasOp: (op) =>
    set((state) => {
      const { ops, version } = state.myCanvas
      switch (op.type) {
        case 'clear':
          // 只清筆跡，背景保留
          return { myCanvas: { ops: ops.filter((o) => o.type === 'background'), version: version + 1 } }
        case 'undo':
          return {
            myCanvas: {
              ops: ops.filter((o) => o.type === 'background' || o.type === 'clear' || o.strokeId !== op.strokeId),
              version: version + 1,
            },
          }
        case 'background':
          // 只留最後一個；背景不畫進畫布（CSS 背景），筆跡不必重繪，version 不變
          return { myCanvas: { ops: replaceBackground(ops, op), version } }
        default:
          return { myCanvas: { ops: [...ops, op], version } }
      }
    }),

  setBrush: (patch) => set((state) => ({ brush: { ...state.brush, ...patch } })),

  // 以 id 去重：快照與廣播可能帶到同一則
  appendChat: (m) =>
    set((state) => {
      const chat = appendChatMessage(state.chat, m)
      return chat === state.chat ? state : { chat }
    }),

  addGalleryImage: ({ roundNo, playerId, png }) =>
    set((state) => {
      if (roundNo !== state.round.roundNo) return state
      const bytes = galleryBytes(png)
      if (bytes === null) return state
      const gallery = new Map(state.gallery)
      const old = gallery.get(playerId)
      if (old !== undefined) URL.revokeObjectURL(old)
      gallery.set(playerId, URL.createObjectURL(new Blob([bytes], { type: 'image/png' })))
      return { gallery }
    }),

  // 與 round:update 的先後不定，兩種順序結果相同：server 發 contest:comment 時已同步更新自己的 results，
  // 之後才到的 round:update／快照帶的就是最新值（直接採用）；先到的 round:update 還是 pending，由這裡補上。
  // 只換被改到的那一筆與 results 陣列（其他卡片的物件參照不變）
  applyComment: ({ roundNo, playerId, comment }) =>
    set((state) => {
      const { round } = state
      if (roundNo !== round.roundNo || round.results === null) return state
      const at = round.results.findIndex((r) => r.playerId === playerId)
      if (at === -1) return state
      const results = round.results.map((r, i) => (i === at ? { ...r, comment, commentPending: false } : r))
      return { round: { ...round, results } }
    }),

  setReference: ({ roundNo, jpeg }) =>
    set((state) => {
      if (roundNo < state.round.roundNo) return state
      const bytes = galleryBytes(jpeg)
      if (bytes === null) return state
      revokeReference(state.reference)
      return { reference: { roundNo, url: URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })) } }
    }),

  setSubmitting: (submitting) => set({ submitting }),

  markSubmitted: () => set({ submitted: true }),

  setConnection: (connection) => set({ connection }),

  setJoinError: (joinError) => set({ joinError }),

  setAutoJoining: (autoJoining) => set({ autoJoining }),

  setResuming: (resuming) => set({ resuming }),

  // 離開遊戲（回首頁）時釋放畫廊並丟掉本機畫布。reset 的呼叫者（自動重加入失敗、被接管、沒有憑證可接管）都已沒有憑證 → resuming false
  reset: (joinError = null) =>
    set((state) => {
      revokeGallery(state.gallery)
      revokeReference(state.reference)
      return {
        me: null,
        players: [],
        round: initialRound,
        chat: [],
        myCanvas: { ops: [], version: state.myCanvas.version + 1 },
        submitted: false,
        submitting: false,
        gallery: new Map(),
        reference: null,
        autoJoining: false,
        resuming: false,
        joinError,
      }
    }),
}))
