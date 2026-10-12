// 聊天室純邏輯（可單元測試）：訊息顯示資料、錯誤提示、功能提示、列表截斷、連續訊息分組、捲動判斷。
// 每則訊息長什麼樣（卡片、時間戳格式）由殼層的 ChatView 決定（shells/views）；這裡只產生不含偽裝的資料。
// 猜歌的聊天是純文字，兼猜歌輸入（spec/song-guess/architecture.md §5「猜題」、§5.2）：猜對與防洩題都由 server 判定。
import { CHAT_HISTORY, CHAT_MAX, type ChatMessage, type ErrorCode, type SongPhase } from '@fishing-work/shared/song-guess'
import type { ChatLineData } from '../../shells/views'

/** 本地最多保留的聊天則數：快照只帶 CHAT_HISTORY 則，本地多留一倍供往上捲 */
export const CHAT_LOCAL_LIMIT = CHAT_HISTORY * 2

/** 輸入框 maxLength（UTF-16 單位）：CHAT_MAX 以 code point 計，emoji 佔 2 單位，因此放寬一倍，實際以 server 為準 */
export const CHAT_INPUT_MAX_UNITS = CHAT_MAX * 2

/** 錯誤提示停留時間（毫秒）；下次輸入時也會清除 */
export const CHAT_ERROR_MS = 4000

/** 距底部多少 px 內視為「在底部」：新訊息進來時才自動跟隨 */
export const STICK_THRESHOLD_PX = 24

/** 以 id 去重後追加，超過上限時保留最新的 limit 則；重複時回傳原陣列（不觸發重繪） */
export function appendChatMessage(chat: ChatMessage[], m: ChatMessage, limit: number = CHAT_LOCAL_LIMIT): ChatMessage[] {
  if (chat.some((c) => c.id === m.id)) return chat
  const next = [...chat, m]
  return next.length > limit ? next.slice(next.length - limit) : next
}

/** 保留最新的 limit 則 */
export function trimChat(chat: readonly ChatMessage[], limit: number = CHAT_LOCAL_LIMIT): ChatMessage[] {
  return chat.length > limit ? chat.slice(chat.length - limit) : [...chat]
}

/** HH:mm（本機時區、補零） */
export function formatTime(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * 一則訊息的顯示資料（各主題的外觀由殼層的 ChatView.Line 決定）：
 * isMine＝fromId 等於自己的 id（system 的 fromId 為 null，一律 false）
 */
export function chatLineData(m: ChatMessage, meId: string | null = null): ChatLineData {
  return {
    id: m.id,
    kind: m.kind,
    fromId: m.fromId,
    nickname: m.nickname,
    text: m.text,
    at: m.at,
    time: formatTime(m.at),
    isMine: m.fromId !== null && m.fromId === meId,
  }
}

type ChatFailure = ErrorCode | 'TIMEOUT' | 'DISCONNECTED'

/** 本機錯誤（逾時、未連線）與 server ErrorCode 的備用文字；server 有給 message 時一律用 server 的 */
const FALLBACK_MESSAGE: Partial<Record<ChatFailure, string>> = {
  SPOILER_BLOCKED: '訊息含有歌名，沒有送出',
  RATE_LIMITED: '訊息送太快了，請稍候再送',
  MESSAGE_INVALID: `訊息需為 1–${CHAT_MAX} 字的單行文字`,
  NOT_IN_ROOM: '尚未加入房間',
  TIMEOUT: '伺服器沒有回應，請再試一次',
  DISCONNECTED: '尚未連線到伺服器，請稍候再試',
}

/**
 * 送出失敗時輸入框旁的提示文字：優先用 ack.message（繁中、可直接顯示，architecture §5.3；
 * SPOILER_BLOCKED 有兩種文案——已猜對者「你已經猜對了，不要說出歌名」、未猜對者「猜歌名請只輸入歌名本身」——由 server 決定）
 */
export function chatErrorText(error: ChatFailure, message: string): string {
  const m = message.trim()
  if (m !== '') return m
  return FALLBACK_MESSAGE[error] ?? '訊息未送出'
}

/** 空白（去頭尾後為空）不送 */
export function shouldSend(text: string): boolean {
  return text.trim() !== ''
}

/** 輸入列的功能提示（design §1「猜題」）：殼層的輸入框 placeholder 另有偽裝文字，這句顯示在輸入列上方 */
export const CHAT_HINT = '輸入歌名或聊天'
/** 播放中自己已猜對：之後的訊息含歌名會被擋（防洩題） */
export const CHAT_HINT_GUESSED = '聊天（不可說出歌名）'

/** 依階段與自己是否已猜對決定功能提示 */
export function chatHint(phase: SongPhase, hasGuessed: boolean): string {
  return phase === 'playing' && hasGuessed ? CHAT_HINT_GUESSED : CHAT_HINT
}

/**
 * 連續同人訊息（ChatLineProps.groupWithPrevious）：與前一則同一個發話者（fromId 非 null 且相同），
 * 且兩則都是一般聊天（system、correct 會打斷分組）。殼層可據此只顯示一次名字
 */
export function groupsWithPrevious(
  prev: Pick<ChatMessage, 'kind' | 'fromId'> | undefined,
  cur: Pick<ChatMessage, 'kind' | 'fromId'>,
): boolean {
  if (prev === undefined || cur.fromId === null || prev.fromId !== cur.fromId) return false
  return prev.kind === 'chat' && cur.kind === 'chat'
}

/** 捲動位置是否在底部附近（新訊息進來時才自動跟隨；使用者往上捲時不強制拉回） */
export function isNearBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold: number = STICK_THRESHOLD_PX,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold
}
