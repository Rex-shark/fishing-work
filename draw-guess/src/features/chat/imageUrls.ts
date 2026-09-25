// 聊天圖片的 Blob URL 與顯示狀態管理（純函式；plan/chat-image.md 決策 7；DESIGN §5 image 列；architecture §7）。
// 「不保留」也適用於客戶端記憶體：只留最近 IMAGE_URL_LIMIT 張，超過的由呼叫端 URL.revokeObjectURL。
// Map 依插入順序即新舊順序；一律回傳新 Map（Zustand selector 以參照比較，不可就地修改）。
import type { ChatMessage } from '@fishing-work/shared'

/** 客戶端最多保留的圖片張數（決策 7） */
export const IMAGE_URL_LIMIT = 20

/**
 * 每則 image 訊息在本機的狀態：
 * - pending：連線中即時收到 chat:message，bytes（chat:image）尚未到 →「載入中…」
 * - ready：已有 Blob URL → 顯示縮圖
 * - skipped：server 因本連線待送量過大而略過這張（chat:image 的 data 為 null，architecture §5 慢連線保護）→「連線較慢，已略過」
 * - revoked：曾有 bytes，因超過 IMAGE_URL_LIMIT 被釋放 →「已清除」
 * - snapshot：快照（join／重連接管）帶來且本機沒有 bytes →「中途加入看不到」
 */
export type ImageStatus = 'pending' | 'ready' | 'skipped' | 'revoked' | 'snapshot'

/** 沒有圖可顯示時與暱稱同行的灰字佔位（DESIGN §5） */
export const IMAGE_PLACEHOLDER: Record<Exclude<ImageStatus, 'ready'>, string> = {
  pending: '[圖片]（載入中…）',
  skipped: '[圖片]（連線較慢，已略過）',
  revoked: '[圖片]（已清除）',
  snapshot: '[圖片]（中途加入看不到）',
}

/**
 * 加入一張圖的 URL（id 為聊天訊息 id）：同 id 重複時以新的取代（舊 URL 也要 revoke，id 仍在），
 * 超過 limit 時移除最舊的。回傳新 Map、要 revoke 的 URL、以及因此失去圖片的訊息 id。
 */
export function addImageUrl(
  urls: ReadonlyMap<string, string>,
  id: string,
  url: string,
  limit: number = IMAGE_URL_LIMIT,
): { urls: Map<string, string>; evicted: string[]; evictedIds: string[] } {
  const next = new Map(urls)
  const evicted: string[] = []
  const evictedIds: string[] = []
  const prev = next.get(id)
  if (prev !== undefined) {
    next.delete(id)
    if (prev !== url) evicted.push(prev)
  }
  next.set(id, url)
  for (const [oldId, oldUrl] of next) {
    if (next.size <= limit) break
    next.delete(oldId)
    evicted.push(oldUrl)
    evictedIds.push(oldId)
  }
  return { urls: next, evicted, evictedIds }
}

/** 只保留仍在聊天列表裡的 image 訊息狀態（訊息被截掉就不必記，狀態表不會無限長大） */
function pruneToChat(status: Map<string, ImageStatus>, chat: readonly ChatMessage[]): Map<string, ImageStatus> {
  const ids = new Set(chat.map((m) => m.id))
  for (const id of status.keys()) if (!ids.has(id)) status.delete(id)
  return status
}

/**
 * 即時收到一則 chat:message(kind image)：bytes 已先到（有 URL）→ ready；略過通知已先到 → 維持 skipped；否則 pending。
 * （server 保證 chat:message 先到，後兩種只是保險。）chat 為追加後的聊天列表，順便清掉已被截掉的訊息狀態。
 */
export function statusOnLiveMessage(
  status: ReadonlyMap<string, ImageStatus>,
  urls: ReadonlyMap<string, string>,
  id: string,
  chat: readonly ChatMessage[],
): Map<string, ImageStatus> {
  const next = new Map(status)
  next.set(id, urls.has(id) ? 'ready' : status.get(id) === 'skipped' ? 'skipped' : 'pending')
  return pruneToChat(next, chat)
}

/**
 * chat:image 的 data 為 null（server 略過這張）：該 id → skipped，不建立 Blob URL。
 * 本機已有 URL 的（理論上不會發生）不動。
 */
export function statusOnImageSkipped(
  status: ReadonlyMap<string, ImageStatus>,
  urls: ReadonlyMap<string, string>,
  id: string,
): Map<string, ImageStatus> {
  const next = new Map(status)
  if (!urls.has(id)) next.set(id, 'skipped')
  return next
}

/** chat:image 到達並建好 URL：該 id → ready；被擠掉的 id → revoked（訊息還在列表時才記） */
export function statusOnImageUrl(
  status: ReadonlyMap<string, ImageStatus>,
  id: string,
  evictedIds: readonly string[],
): Map<string, ImageStatus> {
  const next = new Map(status)
  next.set(id, 'ready')
  for (const old of evictedIds) if (next.has(old)) next.set(old, 'revoked')
  return next
}

/**
 * 套用快照（join／重連接管）：快照裡的 image 訊息逐則決定狀態——
 * - 本機有 URL（先前即時收到、尚未被擠掉）→ ready
 * - 先前已被釋放 → 維持 revoked（本機確實收過，只是清掉了）
 * - 先前收到略過通知 → 維持 skipped（本機確實在線，只是連線太慢被略過）
 * - 其餘（全新的、或斷線前仍 pending：快照後 chat:image 不會再來）→ snapshot
 */
export function statusFromSnapshot(
  status: ReadonlyMap<string, ImageStatus>,
  urls: ReadonlyMap<string, string>,
  chat: readonly ChatMessage[],
): Map<string, ImageStatus> {
  const next = new Map<string, ImageStatus>()
  for (const m of chat) {
    if (m.kind !== 'image') continue
    const prev = status.get(m.id)
    next.set(m.id, urls.has(m.id) ? 'ready' : prev === 'revoked' || prev === 'skipped' ? prev : 'snapshot')
  }
  return next
}

/**
 * 顯示用：有 URL 一律 ready（不論狀態表）；沒有 URL 時依狀態，ready 卻沒有 URL 表示已被釋放 → revoked；
 * 查不到狀態視為快照帶來。
 */
export function displayStatus(status: ImageStatus | undefined, hasUrl: boolean): ImageStatus {
  if (hasUrl) return 'ready'
  if (status === undefined) return 'snapshot'
  return status === 'ready' ? 'revoked' : status
}
