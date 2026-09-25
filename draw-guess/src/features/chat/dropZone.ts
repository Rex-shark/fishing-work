// 聊天室圖片投放的純邏輯（可單元測試；DESIGN.md §5「投放覆蓋層」、architecture §5「圖片訊息」）。
import type { RoundPhase } from '@fishing-work/shared'

/**
 * 殼層標記聊天容器的屬性：聊天室以最近的這個祖先為圖片投放區，並把拖曳覆蓋層 portal 進去蓋滿它，
 * 因此該容器必須是定位元素（position: relative）。沒有標記時退回聊天室自己的根節點。
 */
export const CHAT_DROP_ZONE_ATTR = 'data-chat-drop-zone'

/**
 * 拖曳深度計數：dragenter／dragleave 會在每個子元素上成對觸發，只看最後一個事件會閃爍。
 * enter +1、leave −1（不低於 0）、drop／end 歸零；深度 > 0 時顯示覆蓋層。
 */
export type DragEventKind = 'enter' | 'leave' | 'drop' | 'end'
export function nextDragDepth(depth: number, kind: DragEventKind): number {
  switch (kind) {
    case 'enter':
      return depth + 1
    case 'leave':
      return Math.max(0, depth - 1)
    case 'drop':
    case 'end':
      return 0
  }
}

/** 拖曳內容是否含檔案（拖聊天文字、連結時不顯示覆蓋層） */
export function dragHasFiles(types: readonly string[] | DOMStringList | null | undefined): boolean {
  if (types == null) return false
  return Array.from(types as ArrayLike<string>).includes('Files')
}

/** 與 server SPOILER_BLOCKED 相同的文字（architecture §5「圖片訊息」） */
export const DRAWER_IMAGE_BLOCKED = '作畫中畫師不能傳圖片'

/**
 * 本機預檢：作畫中（choosing／drawing）的畫師不能傳圖（決策 4），擋在本機省下上傳；
 * 判定仍以 server 為準（例如 ack 回 SPOILER_BLOCKED 時照 ack.message 顯示）。
 */
export function imageBlockedReason(phase: RoundPhase, isDrawer: boolean): string | null {
  return isDrawer && (phase === 'choosing' || phase === 'drawing') ? DRAWER_IMAGE_BLOCKED : null
}
