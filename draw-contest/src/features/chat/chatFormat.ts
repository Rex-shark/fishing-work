// 聊天室純邏輯（可單元測試）：訊息顯示資料、錯誤提示、功能提示、列表截斷、捲動判斷。
// 每則訊息長什麼樣（卡片、時間戳格式）由殼層的 ChatView 決定（shells/views）；這裡只產生不含偽裝的資料。
// 繪圖比賽的聊天是純文字（spec/draw-contest/architecture.md §5.3）：沒有猜題、防洩題、圖片。
import { CHAT_HISTORY, CHAT_MAX, type ChatMessage, type ErrorCode } from '@fishing-work/shared/draw-contest'
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

/** 本機錯誤（逾時、未連線）與 server ErrorCode 的備用文字；server 有給 message 時一律用 server 的 */
const FALLBACK_MESSAGE: Partial<Record<ErrorCode | 'TIMEOUT' | 'DISCONNECTED' | 'EXPORT_FAILED', string>> = {
  RATE_LIMITED: '訊息送太快了，請稍候再送',
  MESSAGE_INVALID: `訊息需為 1–${CHAT_MAX} 字的單行文字`,
  NOT_IN_ROOM: '尚未加入房間',
  TIMEOUT: '伺服器沒有回應，請再試一次',
  DISCONNECTED: '尚未連線到伺服器，請稍候再試',
}

/** 送出失敗時輸入框旁的提示文字：優先用 ack.message（繁中、可直接顯示，architecture §5.4） */
export function chatErrorText(error: ErrorCode | 'TIMEOUT' | 'DISCONNECTED' | 'EXPORT_FAILED', message: string): string {
  const m = message.trim()
  if (m !== '') return m
  return FALLBACK_MESSAGE[error] ?? '訊息未送出'
}

/** 空白（去頭尾後為空）不送 */
export function shouldSend(text: string): boolean {
  return text.trim() !== ''
}

/** 輸入列上方的功能提示（design §2：固定「聊天」，沒有猜題提示）；殼層的輸入框 placeholder 另有偽裝文字 */
export const CHAT_HINT = '聊天'

/** 捲動位置是否在底部附近（新訊息進來時才自動跟隨；使用者往上捲時不強制拉回） */
export function isNearBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold: number = STICK_THRESHOLD_PX,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold
}
