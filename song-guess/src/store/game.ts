// 猜歌的遊戲狀態（Zustand；spec/song-guess/architecture.md §4、§7）。
// 以 server 為準的部分：me、players、round（RoundPublic）、chat；本機才有的部分：
//   clockOffset（server 時鐘 − 本機時鐘；每次 round:update／快照以 round.serverNow 重估，倒數與播放定位都用校正後的時間）、
//   gainBase（本首開始時自己的本局得分，用來顯示「你猜對了 +N」；features/players/scoreDelta）。
// 音量是本機偏好，不在這裡（features/player/volume）。
import { create } from 'zustand'
import type { ChatMessage, PlayerPublic, RoomSnapshot, RoundPublic } from '@fishing-work/shared/song-guess'
import { appendChatMessage, trimChat } from '../features/chat/chatFormat'
import { estimateClockOffset } from '../features/player/clock'
import { gainBaseFromSnapshot, gainBaseOnRound, revealScoreOf, songGain, songId, type GainBase } from '../features/players/scoreDelta'

export type ConnectionState = 'disconnected' | 'connecting' | 'connected'

export interface GameState {
  /** 自己的 player id（server 產生的穩定 id，不是 socket.id）；未加入為 null */
  me: string | null
  players: PlayerPublic[]
  round: RoundPublic
  /** 聊天訊息（以 id 去重，本地最多 CHAT_LOCAL_LIMIT 則） */
  chat: ChatMessage[]
  /** server 時鐘 − 本機時鐘（毫秒）；還沒收過 round 為 0。校正後的現在＝Date.now() + clockOffset */
  clockOffset: number
  /** 本首開始時自己的本局得分（顯示「你猜對了 +N」用）；基準不明為 null */
  gainBase: GainBase | null
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
  /** 套用加入／重連接管的快照；localNow 為收到當下的本機時間（預設 Date.now()，測試可注入） */
  applySnapshot(s: RoomSnapshot, localNow?: number): void
  setPlayers(players: PlayerPublic[]): void
  /** 套用 round:update：重估時鐘偏移；換了一首時重記本首得分的基準 */
  setRound(round: RoundPublic, localNow?: number): void
  /** 追加一則聊天：以 id 去重、超過 CHAT_LOCAL_LIMIT 捨棄最舊的 */
  appendChat(m: ChatMessage): void
  setConnection(connection: ConnectionState): void
  setJoinError(message: string | null): void
  setAutoJoining(value: boolean): void
  setResuming(value: boolean): void
  /** 回到未加入狀態（保留 connection 與 clockOffset；resuming 一併轉 false＝回首頁）；可順便設定首頁錯誤 */
  reset(joinError?: string | null): void
}

export const initialRound: RoundPublic = {
  gameNo: 0,
  phase: 'idle',
  setterId: null,
  source: null,
  artist: null,
  artistHot: false,
  topic: null,
  songCount: 0,
  endsAt: null,
  song: null,
  reveal: null,
  results: null,
  lastTopic: null,
  lastSource: null,
  serverNow: 0,
  participantIds: [],
}

/** 自己是否為本局出題者（choosing 起；ended 仍算） */
export const selectIsSetter = (s: Pick<GameState, 'me' | 'round'>): boolean => s.me !== null && s.round.setterId === s.me

/** 自己本首已猜對：players:update 的 hasGuessed 或 round.song.correctIds，任一先到即算（只在 playing／reveal 有意義） */
export const selectHasGuessed = (s: Pick<GameState, 'me' | 'round' | 'players'>): boolean =>
  s.me !== null &&
  s.round.song !== null &&
  (s.round.song.correctIds.includes(s.me) || s.players.some((p) => p.id === s.me && p.hasGuessed))

/**
 * 自己本首得分：揭曉時以 reveal.scores 為準（同一首才算）；播放中由本局得分的差值推得（scoreDelta.songGain）；
 * 沒猜對、基準不明為 null
 */
export const selectMyGain = (s: Pick<GameState, 'me' | 'round' | 'players' | 'gainBase'>): number | null => {
  const { round, me } = s
  if (round.phase === 'reveal' && round.reveal !== null && round.song !== null && round.reveal.index === round.song.index) {
    return revealScoreOf(round.reveal, me)
  }
  if (round.phase !== 'playing') return null
  return songGain(s.gainBase, round, s.players.find((p) => p.id === me))
}

export const initialGameState: GameState = {
  me: null,
  players: [],
  round: initialRound,
  chat: [],
  clockOffset: 0,
  gainBase: null,
  connection: 'disconnected',
  joinError: null,
  autoJoining: false,
  resuming: false,
}

export const useGameStore = create<GameState & GameActions>()((set) => ({
  ...initialGameState,

  // 加入或重連接管：同一個人回到同一首歌時沿用本首得分的基準（斷線重連不丟「+N」）
  applySnapshot: (s, localNow = Date.now()) =>
    set((state) => ({
      me: s.you,
      players: s.players,
      round: s.round,
      chat: trimChat(s.chat),
      clockOffset: estimateClockOffset(s.round.serverNow, localNow),
      gainBase: gainBaseFromSnapshot(state.gainBase, state.me === s.you, s.round, s.players, s.you),
      joinError: null,
    })),

  setPlayers: (players) => set({ players }),

  // 換了一首（進入新的 playing）：server 的順序是 round:update 先到、清掉 hasGuessed 的 players:update 後到，
  // 這裡先在本機清掉上一首留下的 hasGuessed，畫面才不會有一瞬間以為自己「已猜對」（隨後的 players:update 以 server 為準覆蓋）
  setRound: (round, localNow = Date.now()) =>
    set((state) => {
      const newSong = round.phase === 'playing' && round.song !== null && songId(round) !== songId(state.round)
      return {
        round,
        clockOffset: estimateClockOffset(round.serverNow, localNow),
        gainBase: gainBaseOnRound(state.gainBase, round, state.players, state.me),
        ...(newSong && state.players.some((p) => p.hasGuessed)
          ? { players: state.players.map((p) => (p.hasGuessed ? { ...p, hasGuessed: false } : p)) }
          : {}),
      }
    }),

  // 以 id 去重：快照與廣播可能帶到同一則
  appendChat: (m) =>
    set((state) => {
      const chat = appendChatMessage(state.chat, m)
      return chat === state.chat ? state : { chat }
    }),

  setConnection: (connection) => set({ connection }),

  setJoinError: (joinError) => set({ joinError }),

  setAutoJoining: (autoJoining) => set({ autoJoining }),

  setResuming: (resuming) => set({ resuming }),

  // reset 的呼叫者（自動重加入失敗、被接管、沒有憑證可接管）都已沒有憑證 → resuming false
  reset: (joinError = null) =>
    set({
      me: null,
      players: [],
      round: initialRound,
      chat: [],
      gainBase: null,
      autoJoining: false,
      resuming: false,
      joinError,
    }),
}))
