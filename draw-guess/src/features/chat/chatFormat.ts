// 聊天室純邏輯（可單元測試）：訊息顯示資料、錯誤提示、placeholder、列表截斷、捲動判斷。
// 每則訊息長什麼樣（前綴符號、時間戳格式、卡片）由殼層的 ChatView 決定（shells/views）；這裡只產生不含偽裝的資料。
// 判定一律以 server 為準（architecture §5「聊天訊息判定」）。
import { CHAT_HISTORY, CHAT_MAX, type ChatMessage, type ErrorCode, type RoundPhase } from '@fishing-work/shared'
import type { ChatLineData, ChatLineImage, ChatReveal } from '../../shells/views'
import { IMAGE_PLACEHOLDER, type ImageStatus } from './imageUrls'

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

/** server 揭曉訊息格式：`題目是 X（原因）`（architecture §5 end） */
const REVEAL_RE = /^題目是 (.+)（([^（）]+)）$/u

/** 圖片訊息的文字標記（有圖時；沒圖時的佔位見 imageUrls.IMAGE_PLACEHOLDER） */
export const IMAGE_LABEL = '[圖片]'

/** system 揭曉訊息拆出題目與原因（題目本身可含全形括號或空白）；不是揭曉訊息回 null */
export function parseReveal(text: string): ChatReveal | null {
  const m = REVEAL_RE.exec(text)
  return m === null ? null : { topic: m[1], reason: m[2] }
}

/**
 * 一則訊息的顯示資料（DESIGN.md §5「聊天室訊息格式」；各主題的外觀由殼層的 ChatView.Line 決定）：
 * - system 若為揭曉訊息，拆出 reveal（殼層可高亮題目）
 * - image 帶本機狀態、Blob URL 與沒有圖時的佔位文字（四種，imageUrls.IMAGE_PLACEHOLDER）
 * - isMine：fromId 等於自己的 id（system 的 fromId 為 null，一律 false）
 */
export function chatLineData(
  m: ChatMessage,
  local: { imageStatus?: ImageStatus; imageUrl?: string | null; meId?: string | null } = {},
): ChatLineData {
  const { imageStatus = 'snapshot', imageUrl = null, meId = null } = local
  const image: ChatLineImage | null =
    m.kind === 'image' && m.image !== undefined
      ? {
          meta: m.image,
          status: imageStatus,
          url: imageUrl,
          placeholder: imageStatus === 'ready' ? null : IMAGE_PLACEHOLDER[imageStatus],
        }
      : null
  return {
    id: m.id,
    kind: m.kind,
    fromId: m.fromId,
    nickname: m.nickname,
    text: m.text,
    at: m.at,
    time: formatTime(m.at),
    isMine: m.fromId !== null && m.fromId === meId,
    reveal: m.kind === 'system' ? parseReveal(m.text) : null,
    image,
  }
}

/** 縮圖顯示尺寸上限（決策 8、DESIGN §5） */
export const THUMB_MAX_WIDTH = 240
export const THUMB_MAX_HEIGHT = 160

/** 縮圖顯示尺寸：等比縮進 maxW×maxH（不放大）；先定好框，圖片載入後版面不跳動、捲到底才準 */
export function thumbSize(
  width: number,
  height: number,
  maxW: number = THUMB_MAX_WIDTH,
  maxH: number = THUMB_MAX_HEIGHT,
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: maxW, height: maxH }
  const scale = Math.min(1, maxW / width, maxH / height)
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** 本機錯誤（逾時、未連線）與 server ErrorCode 的備用文字；server 有給 message 時一律用 server 的 */
const FALLBACK_MESSAGE: Partial<Record<ErrorCode | 'TIMEOUT' | 'DISCONNECTED', string>> = {
  SPOILER_BLOCKED: '訊息已被擋下，未送出',
  RATE_LIMITED: '訊息送太快了，請稍候再送',
  MESSAGE_INVALID: `訊息需為 1–${CHAT_MAX} 字的單行文字`,
  IMAGE_INVALID: '圖片格式或大小不符，未送出',
  NOT_IN_ROOM: '尚未加入房間',
  TIMEOUT: '伺服器沒有回應，請再試一次',
  DISCONNECTED: '尚未連線到伺服器，請稍候再試',
}

/** 送出失敗時輸入框旁的提示文字：優先用 ack.message（繁中、可直接顯示，architecture §9） */
export function chatErrorText(error: ErrorCode | 'TIMEOUT' | 'DISCONNECTED', message: string): string {
  const m = message.trim()
  if (m !== '') return m
  return FALLBACK_MESSAGE[error] ?? '訊息未送出'
}

/** 空白（去頭尾後為空）不送 */
export function shouldSend(text: string): boolean {
  return text.trim() !== ''
}

/**
 * 輸入框 placeholder：
 * - drawing、自己不是畫師、還沒猜對 → 輸入答案或聊天（訊息即猜題）
 * - drawing、自己是畫師或已猜對 → 聊天（不可說出答案）（含題目會被擋）
 * - 其餘階段 → 一般聊天
 */
export function chatPlaceholder(phase: RoundPhase, isDrawer: boolean, hasGuessed: boolean): string {
  if (phase === 'drawing') return isDrawer || hasGuessed ? '聊天（不可說出答案）' : '輸入答案或聊天'
  return '輸入訊息後按 Enter'
}

/**
 * 連續同人訊息（ChatLineProps.groupWithPrevious；Epic 5 決策 13(5)）：與前一則同一個發話者（fromId 非 null 且相同），
 * 且兩則都是一般聊天或圖片（system、correct 會打斷分組）。殼層可據此只顯示一次名字
 */
export function groupsWithPrevious(
  prev: Pick<ChatMessage, 'kind' | 'fromId'> | undefined,
  cur: Pick<ChatMessage, 'kind' | 'fromId'>,
): boolean {
  if (prev === undefined || cur.fromId === null || prev.fromId !== cur.fromId) return false
  const groupable = (k: ChatMessage['kind']) => k === 'chat' || k === 'image'
  return groupable(prev.kind) && groupable(cur.kind)
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
