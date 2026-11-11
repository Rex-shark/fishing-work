import { io, type Socket } from 'socket.io-client'
import {
  DRAW_GUESS_NAMESPACE,
  MAX_OPS_PER_ROUND,
  sniffImageMime,
  type Ack,
  type ClientToServerEvents,
  type DrawOp,
  type ErrorCode,
  type ImagePayload,
  type JoinResult,
  type ServerToClientEvents,
} from '@fishing-work/shared'
import type { PreparedImage } from '../features/chat/imageUpload'
import { useGameStore } from '../store/game'
import { AUTO_JOIN_TIMEOUT_MESSAGE, createAutoJoiner, type AutoJoinAttempt } from './autoJoin'

export type DrawGuessSocket = Socket<ServerToClientEvents, ClientToServerEvents>

// 連同源的 /draw-guess namespace；path 固定為預設 /socket.io，不受 Vite base 影響
export const socket: DrawGuessSocket = io(DRAW_GUESS_NAMESPACE, {
  path: '/socket.io',
  autoConnect: false,
})

const store = () => useGameStore.getState()

// ─── 重連憑證（sessionStorage：每個分頁各自一份） ─────────────────────

/** sessionStorage 鍵（index.html 的防閃爍內嵌腳本以字面值讀同一個鍵；test/homeTheme.test.ts 守門） */
export const SESSION_KEY = 'fishing-work:draw-guess:session'
const JOIN_TIMEOUT_MS = 5000
const ACK_TIMEOUT_MS = 5000
/**
 * 傳圖要上傳最多 MAX_IMAGE_BYTES（10 MB），逾時放寬：慢速 Wi-Fi／tunnel 以 2 Mbps 估約 40 秒，留一些餘裕。
 * 逾時只代表沒等到 ack，server 可能仍已廣播；使用者看到錯誤後可自行判斷是否重傳。
 */
const IMAGE_ACK_TIMEOUT_MS = 60_000

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
 * 是否有重連憑證（plan/home-page.md 決策 4、5）：有 → 啟動時直接進所選殼層的 resume 畫面自動重新加入、不經首頁；
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

/** 需要 ack 的請求結果：server 的 Ack 失敗，加上本機的逾時與未連線 */
export type ActionOutcome =
  | { ok: true }
  | { ok: false; error: ErrorCode | 'TIMEOUT' | 'DISCONNECTED'; message: string }

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

/**
 * 連線（含重連）後以憑證自動重加入（spec/architecture.md §9.1；plan/hardening.md 決策 5，狀態機在 ./autoJoin）：
 * server 明確回 ok: false → 清憑證、回首頁顯示錯誤；沒收到 ack → 保留憑證，已斷線等下次 connect、仍連線則 2 秒後重試（最多 3 次），
 * 仍失敗回首頁顯示「自動重新加入失敗：連線逾時」但不清憑證（重新整理可再試）
 */
const autoJoiner = createAutoJoiner({
  isConnected: () => socket.connected,
  attempt: () => {
    const session = loadSession()
    if (session === null) return null
    return sendJoin({ nickname: session.nickname, token: session.token }).then((r): AutoJoinAttempt => {
      if (r.ok) return { kind: 'ok' }
      if (r.error === 'TIMEOUT' || r.error === 'DISCONNECTED') return { kind: 'noAck' }
      return { kind: 'rejected', message: r.message }
    })
  },
  setBusy: (busy) => store().setAutoJoining(busy),
  onRejected: (message) => {
    clearSession()
    store().reset(`自動重新加入失敗：${message}`)
  },
  // 不清憑證：reset 只回首頁（resuming → false）；憑證留在 sessionStorage，重新整理或下次 connect 會再自動加入
  onGiveUp: () => store().reset(AUTO_JOIN_TIMEOUT_MESSAGE),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
})

// ─── 連線生命週期 ─────────────────────────────────────────────────

socket.on('connect', () => {
  // 先開始自動加入（autoJoining → true）再標記已連線：訂閱 connection 的邏輯
  // 看到「已連線」時就知道還在重新加入，不會搶在 player:join 之前送出
  const hasSession = loadSession() !== null
  if (hasSession) autoJoiner.onConnect()
  store().setConnection('connected')
  if (!hasSession && store().me !== null) {
    // 沒有憑證可接管（理論上不會發生）：回首頁，避免停在過期的遊戲畫面
    store().reset('連線已中斷，請重新加入')
  }
})

socket.on('disconnect', (reason) => {
  // 取消待重試的自動加入並作廢在途的那一次（ack 會以錯誤回呼）；下一次 connect 重新開始
  autoJoiner.onDisconnect()
  if (reason === 'io server disconnect') {
    // server 主動斷開 = 同一玩家已在其他分頁／連線接手（token 接管）。
    // 清掉本分頁憑證再重連，否則兩個分頁會互相搶回同一玩家。
    clearSession()
    store().reset('此暱稱已在其他分頁或連線重新加入，本頁已中斷')
    socket.connect()
  }
  // 斷線期間保留 me 與畫面（顯示重新連線中）；重連後以 token 接管並以新快照覆蓋
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

socket.on('chat:image', (p) => {
  if (store().me !== null) receiveImage(p)
})

socket.on('round:update', (round) => {
  if (store().me !== null) store().setRound(round)
})

// server 不回傳畫師自己的 op（§6），這裡只會收到他人的
socket.on('draw:op', (op) => {
  if (store().me !== null) store().appendOp(op)
})

// ─── 回合與畫布 ───────────────────────────────────────────────────

/** 自願當畫師（phase = idle 時） */
export function volunteer(): Promise<ActionOutcome> {
  return new Promise((resolve) => {
    if (!socket.connected) return resolve(NOT_CONNECTED)
    socket.timeout(ACK_TIMEOUT_MS).emit('round:volunteer', (err, res) => resolve(toOutcome(err, res)))
  })
}

/** 畫師出題（phase = choosing） */
export function setTopic(topic: string): Promise<ActionOutcome> {
  return new Promise((resolve) => {
    if (!socket.connected) return resolve(NOT_CONNECTED)
    socket.timeout(ACK_TIMEOUT_MS).emit('round:setTopic', { topic }, (err, res) => resolve(toOutcome(err, res)))
  })
}

/** 畫師放棄本回合（choosing / drawing） */
export function cancelRound(): Promise<ActionOutcome> {
  return new Promise((resolve) => {
    if (!socket.connected) return resolve(NOT_CONNECTED)
    socket.timeout(ACK_TIMEOUT_MS).emit('round:cancel', (err, res) => resolve(toOutcome(err, res)))
  })
}

// ─── 聊天與猜題 ───────────────────────────────────────────────────

/**
 * 送出聊天（drawing 階段即猜題，判定以 server 為準，architecture §5「聊天訊息判定」）。
 * 不做本地回顯：成功的訊息由 server 廣播 chat:message 回來（猜對時廣播的是「X 猜對了」，原文不出現），
 * 被擋（SPOILER_BLOCKED）、太快（RATE_LIMITED）、不合法（MESSAGE_INVALID）只回 ack 給本人。
 */
export function sendChat(text: string): Promise<ActionOutcome> {
  return new Promise((resolve) => {
    if (!socket.connected) return resolve(NOT_CONNECTED)
    socket.timeout(ACK_TIMEOUT_MS).emit('chat:send', { text }, (err, res) => resolve(toOutcome(err, res)))
  })
}

/**
 * 傳一張圖（已由 prepareImage 縮圖）：成功後 server 廣播 chat:message(kind image) 與 chat:image 給所有在線者，
 * 本人也會收到，因此不做本地預覽（與文字聊天一致）。失敗照 ack.message 顯示（IMAGE_INVALID、RATE_LIMITED、SPOILER_BLOCKED）。
 */
export function sendImage(image: PreparedImage): Promise<ActionOutcome> {
  return new Promise((resolve) => {
    if (!socket.connected) return resolve(NOT_CONNECTED)
    const { mime, width, height, data } = image
    socket
      .timeout(IMAGE_ACK_TIMEOUT_MS)
      .emit('chat:image', { mime, width, height, data }, (err, res) => resolve(toOutcome(err, res)))
  })
}

/**
 * 收到圖片 bytes → Blob URL → store（最多保留 IMAGE_URL_LIMIT 張，超過 revoke 最舊）；data 為 null 則標記略過。
 * mime 優先取同 id 的 chat:message（server 保證它先到）；萬一順序顛倒或訊息已被截掉，改以 magic bytes 判定，
 * 兩種順序都能顯示（ChatLine 以訊息 id 查 URL）。
 */
function receiveImage({ id, data }: ImagePayload): void {
  // data 為 null：server 因本連線待送量過大略過這張（architecture §5 慢連線保護）→ 顯示「連線較慢，已略過」
  if (data === null) {
    store().markImageSkipped(id)
    return
  }
  // 瀏覽器端 socket.io 收到的二進位是 ArrayBuffer；保險起見也接受 TypedArray 視圖，其餘忽略
  const raw: unknown = data
  const bytes =
    raw instanceof ArrayBuffer
      ? new Uint8Array(raw)
      : ArrayBuffer.isView(raw)
        ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength).slice()
        : null
  if (bytes === null || bytes.byteLength === 0) return
  const mime = store().chat.find((m) => m.id === id)?.image?.mime ?? sniffImageMime(bytes)
  if (mime === null) return
  store().addImageUrl(id, URL.createObjectURL(new Blob([bytes], { type: mime })))
}

/** 本回合筆跡歷史（正規化後）已達 MAX_OPS_PER_ROUND：server 會丟棄新的 begin/move/end，只剩 undo / clear / background 可用 */
export function isOpsFull(opsLength: number): boolean {
  return opsLength >= MAX_OPS_PER_ROUND
}

/**
 * 畫師送出畫布操作：先套用到本機 ops（本地立即繪製，不等 server 回音），再送出。
 * 歷史已達上限時不送 begin/move/end（server 也會丟棄），回傳 false 讓呼叫端停止這一筆。
 * 斷線中不送（socket.io 會暫存到重連後補送，但那時新 socket 尚未 join，server 會丟棄）；
 * 重連接管後的快照會覆蓋本機 ops，以 server 為準。
 */
export function sendDrawOp(op: DrawOp): boolean {
  if (op.type !== 'undo' && op.type !== 'clear' && op.type !== 'background' && isOpsFull(store().ops.length)) return false
  store().appendOp(op)
  if (socket.connected) socket.emit('draw:op', op)
  return true
}

/** 建立連線；重複呼叫無副作用（React StrictMode 會執行兩次 effect） */
export function connect(): void {
  if (socket.active) return
  store().setConnection('connecting')
  socket.connect()
}
