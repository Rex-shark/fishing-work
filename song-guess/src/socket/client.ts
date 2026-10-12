// 猜歌的 Socket 連線（spec/song-guess/architecture.md §4）：namespace /song-guess、加入與重連接管、出題動作、聊天（兼猜歌）。
// 重連憑證的寫法複製自我畫你猜（sessionStorage，每個分頁各自一份），鍵改為 fishing-work:song-guess:session（不與另兩款撞鍵）。
// 客戶端不呼叫 iTunes：歌手名交給 server 搜尋（round:setArtist），試聽與封面網址由 round:update 帶來。
import { io, type Socket } from 'socket.io-client'
import {
  SONG_GUESS_NAMESPACE,
  type Ack,
  type ClientToServerEvents,
  type ErrorCode,
  type JoinResult,
  type ServerToClientEvents,
} from '@fishing-work/shared/song-guess'
import { useGameStore } from '../store/game'

export type SongGuessSocket = Socket<ServerToClientEvents, ClientToServerEvents>

// 連同源的 /song-guess namespace；path 固定為預設 /socket.io，不受 Vite base 影響
export const socket: SongGuessSocket = io(SONG_GUESS_NAMESPACE, {
  path: '/socket.io',
  autoConnect: false,
})

const store = () => useGameStore.getState()

// ─── 重連憑證（sessionStorage：每個分頁各自一份） ─────────────────────

/** sessionStorage 鍵（index.html 的防閃爍內嵌腳本以字面值讀同一個鍵；test/homeTheme.test.ts 守門） */
export const SESSION_KEY = 'fishing-work:song-guess:session'
const JOIN_TIMEOUT_MS = 5000
const ACK_TIMEOUT_MS = 5000
/**
 * 送歌手名要等 server 搜尋 iTunes（逾時 ITUNES_TIMEOUT_MS 預設 8 秒，architecture §3）才回 ack，逾時放寬到 15 秒。
 * 逾時只代表沒等到 ack：搜尋可能仍在進行（再送會得到 SEARCH_BUSY）或已成功（round:update 會把畫面帶進第 1 首）
 */
export const SET_ARTIST_ACK_TIMEOUT_MS = 15_000

export interface SavedSession {
  nickname: string
  token: string
}

/** sessionStorage 不可用時（隱私模式、被封鎖）退回記憶體，至少同一頁面內的重連仍可接管 */
let memorySession: SavedSession | null = null
/** 最近一次使用的暱稱：清掉憑證後仍用來預填首頁的暱稱 */
let lastNickname: string | null = null

function readStoredSession(): SavedSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (raw === null) return null
    const v: unknown = JSON.parse(raw)
    if (typeof v !== 'object' || v === null) return null
    const { nickname, token } = v as Record<string, unknown>
    return typeof nickname === 'string' && typeof token === 'string' ? { nickname, token } : null
  } catch {
    return null
  }
}

export function loadSession(): SavedSession | null {
  return memorySession ?? readStoredSession()
}

/**
 * 是否有重連憑證：有 → 啟動時直接進所選殼層的 resume 畫面自動重新加入、不經首頁；
 * main.tsx 也以它決定第一次繪製前的 data-theme
 */
export function hasSavedSession(): boolean {
  return loadSession() !== null
}

function saveSession(s: SavedSession): void {
  memorySession = s
  lastNickname = s.nickname
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s))
  } catch {
    // 忽略：已有記憶體備援
  }
}

/** 清掉憑證：之後不再自動重新加入（resuming → false，App 回首頁） */
function clearSession(): void {
  memorySession = null
  try {
    sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // 忽略
  }
  store().setResuming(false)
}

// 啟動時＝有憑證（在 App 第一次渲染前設定，遊戲中重新整理不閃首頁）
store().setResuming(hasSavedSession())

/** 首頁暱稱預填值 */
export function rememberedNickname(): string {
  return lastNickname ?? loadSession()?.nickname ?? ''
}

// ─── join ─────────────────────────────────────────────────────────

/** 本機才有的失敗：逾時、未連線 */
export type LocalErrorCode = 'TIMEOUT' | 'DISCONNECTED'

/** 需要 ack 的請求結果：server 的 Ack 失敗，加上本機的失敗 */
export type ActionOutcome = { ok: true } | { ok: false; error: ErrorCode | LocalErrorCode; message: string }

export type JoinOutcome = ActionOutcome

const NOT_CONNECTED: ActionOutcome = { ok: false, error: 'DISCONNECTED', message: '尚未連線到伺服器，請稍候再試' }
const TIMED_OUT: ActionOutcome = { ok: false, error: 'TIMEOUT', message: '伺服器沒有回應，請再試一次' }

function toOutcome(err: Error | null, res: Ack<unknown>): ActionOutcome {
  if (err) return TIMED_OUT
  return res.ok ? { ok: true } : { ok: false, error: res.error, message: res.message }
}

function sendJoin(payload: { nickname: string; token?: string }): Promise<JoinOutcome> {
  return new Promise((resolve) => {
    if (!socket.connected) {
      resolve(NOT_CONNECTED)
      return
    }
    socket.timeout(JOIN_TIMEOUT_MS).emit('player:join', payload, (err, res) => {
      if (err) {
        resolve(TIMED_OUT)
        return
      }
      if (!res.ok) {
        resolve({ ok: false, error: res.error, message: res.message })
        return
      }
      // 在 ack callback 內同步套用快照：確保早於其後抵達的 players:update / chat:message
      applyJoin(res.data)
      resolve({ ok: true })
    })
  })
}

function applyJoin({ token, snapshot }: JoinResult): void {
  store().applySnapshot(snapshot)
  const nickname = snapshot.players.find((p) => p.id === snapshot.you)?.nickname ?? lastNickname ?? ''
  saveSession({ nickname, token })
}

/** 使用者在首頁手動加入：不帶 token（以輸入的暱稱為準）、失敗不重試 */
export async function join(nickname: string): Promise<JoinOutcome> {
  lastNickname = nickname.trim()
  store().setJoinError(null)
  const r = await sendJoin({ nickname })
  if (!r.ok) store().setJoinError(r.message)
  return r
}

/** 連線（含重連）後以憑證自動重加入；失敗不重試：清憑證、回首頁顯示錯誤 */
async function autoJoin(session: SavedSession): Promise<void> {
  store().setAutoJoining(true)
  const r = await sendJoin({ nickname: session.nickname, token: session.token })
  store().setAutoJoining(false)
  if (r.ok) return
  // 途中又斷線：交給下一次 connect 重試
  if (r.error === 'DISCONNECTED') return
  clearSession()
  store().reset(`自動重新加入失敗：${r.message}`)
}

// ─── 連線生命週期 ─────────────────────────────────────────────────

socket.on('connect', () => {
  store().setConnection('connected')
  const session = loadSession()
  if (session) {
    void autoJoin(session)
  } else if (store().me !== null) {
    // 沒有憑證可接管（理論上不會發生）：回首頁，避免停在過期的遊戲畫面
    store().reset('連線已中斷，請重新加入')
  }
})

socket.on('disconnect', (reason) => {
  if (reason === 'io server disconnect') {
    // server 主動斷開 = 同一玩家已在其他分頁／連線接手（token 接管）。
    // 清掉本分頁憑證再重連，否則兩個分頁會互相搶回同一玩家。
    clearSession()
    store().reset('此暱稱已在其他分頁或連線重新加入，本頁已中斷')
    socket.connect()
  }
  // 斷線期間保留 me 與畫面（顯示重新連線中；正在播的歌照播）；重連後以 token 接管並以新快照覆蓋
  store().setConnection(socket.active ? 'connecting' : 'disconnected')
})

socket.on('connect_error', () => {
  store().setConnection(socket.active ? 'connecting' : 'disconnected')
})

socket.on('players:update', (players) => {
  if (store().me !== null) store().setPlayers(players)
})

socket.on('chat:message', (m) => {
  if (store().me !== null) store().appendChat(m)
})

socket.on('round:update', (round) => {
  if (store().me !== null) store().setRound(round)
})

// ─── 出題 ───────────────────────────────────────────────────────

/** 我出題（phase = idle／ended 且在線 ≥ MIN_PLAYERS）→ choosing */
export function volunteer(): Promise<ActionOutcome> {
  return new Promise((resolve) => {
    if (!socket.connected) return resolve(NOT_CONNECTED)
    socket.timeout(ACK_TIMEOUT_MS).emit('round:volunteer', (err, res) => resolve(toOutcome(err, res)))
  })
}

/**
 * 出題者送歌手名（phase = choosing）：server 搜尋後才回 ack。成功時 round:update 已把階段帶進第 1 首 playing；
 * 失敗（ARTIST_INVALID／ARTIST_NOT_FOUND／SEARCH_FAILED／SEARCH_BUSY）仍在 choosing，可以改名字再送
 */
export function setArtist(artist: string): Promise<ActionOutcome> {
  return new Promise((resolve) => {
    if (!socket.connected) return resolve(NOT_CONNECTED)
    socket.timeout(SET_ARTIST_ACK_TIMEOUT_MS).emit('round:setArtist', { artist }, (err, res) => resolve(toOutcome(err, res)))
  })
}

/** 出題者在 choosing 取消 → idle（搜尋進行中也可以取消，結果會被丟棄） */
export function cancelRound(): Promise<ActionOutcome> {
  return new Promise((resolve) => {
    if (!socket.connected) return resolve(NOT_CONNECTED)
    socket.timeout(ACK_TIMEOUT_MS).emit('round:cancel', (err, res) => resolve(toOutcome(err, res)))
  })
}

// ─── 聊天（兼猜歌） ─────────────────────────────────────────────────

/**
 * 送出聊天或猜歌（architecture §5「猜題」）。不做本地回顯：一般訊息由 server 廣播 chat:message 回來；
 * 猜對時廣播的是「X 猜對了」（不含原文）；含歌名被擋（SPOILER_BLOCKED）、太快（RATE_LIMITED）、不合法（MESSAGE_INVALID）只回 ack 給本人。
 */
export function sendChat(text: string): Promise<ActionOutcome> {
  return new Promise((resolve) => {
    if (!socket.connected) return resolve(NOT_CONNECTED)
    socket.timeout(ACK_TIMEOUT_MS).emit('chat:send', { text }, (err, res) => resolve(toOutcome(err, res)))
  })
}

/** 建立連線；重複呼叫無副作用（React StrictMode 會執行兩次 effect） */
export function connect(): void {
  if (socket.active) return
  store().setConnection('connecting')
  socket.connect()
}
