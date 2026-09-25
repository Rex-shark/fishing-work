// 工具提示（DESIGN.md §6「工具提示」）的純邏輯：標記屬性與浮層定位。元件在 Tooltip.tsx（檔名不可只差大小寫：macOS 不分大小寫，TS 會報 TS1261）。
//
// 用法：在任何元素上展開 `tip('橡皮擦')`（= data-tooltip 屬性），頂層的 <TooltipLayer/> 以事件委派統一處理，
// 元件不必各自包一層。浮層以 portal 掛在 body、position: fixed，不會被 overflow 容器裁掉。

export type TooltipPlacement = 'bottom' | 'top' | 'right'

export const TOOLTIP_ATTR = 'data-tooltip'
export const TOOLTIP_PLACEMENT_ATTR = 'data-tooltip-placement'

/** hover 多久後顯示（DESIGN §6：300ms；focus 立即） */
export const TOOLTIP_DELAY_MS = 300

/** 展開到元素上的屬性。placement 預設 bottom（放不下時自動翻到另一側） */
export function tip(text: string, placement?: TooltipPlacement): Record<string, string> {
  return placement === undefined
    ? { [TOOLTIP_ATTR]: text }
    : { [TOOLTIP_ATTR]: text, [TOOLTIP_PLACEMENT_ATTR]: placement }
}

export function readPlacement(value: string | null): TooltipPlacement {
  return value === 'top' || value === 'right' ? value : 'bottom'
}

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

/** 浮層與錨點的間距、與視窗邊緣的最小距離（px） */
const GAP = 4
const MARGIN = 4

function clampAxis(start: number, size: number, viewport: number): number {
  return Math.max(MARGIN, Math.min(start, viewport - MARGIN - size))
}

/**
 * 計算浮層左上角（fixed 座標）。
 * - bottom／top：水平置中於錨點，放不下時翻到另一側（狀態列在最底，會自動改到上方）
 * - right：垂直置中於錨點右側（活動列），右側放不下時退回 bottom
 * 兩側都放不下時維持原偏好側；水平與垂直都 clamp 在視窗內
 */
export function placeFloating(anchor: Rect, size: Size, viewport: Size, placement: TooltipPlacement): { left: number; top: number; placement: TooltipPlacement } {
  if (placement === 'right') {
    const left = anchor.left + anchor.width + GAP
    if (left + size.width <= viewport.width - MARGIN) {
      const top = clampAxis(anchor.top + anchor.height / 2 - size.height / 2, size.height, viewport.height)
      return { left, top, placement: 'right' }
    }
    placement = 'bottom'
  }
  const below = anchor.top + anchor.height + GAP
  const above = anchor.top - GAP - size.height
  const fitsBelow = below + size.height <= viewport.height - MARGIN
  const fitsAbove = above >= MARGIN
  let side: 'bottom' | 'top' = placement
  if (side === 'bottom' && !fitsBelow && fitsAbove) side = 'top'
  else if (side === 'top' && !fitsAbove && fitsBelow) side = 'bottom'
  const left = clampAxis(anchor.left + anchor.width / 2 - size.width / 2, size.width, viewport.width)
  return { left, top: side === 'bottom' ? below : above, placement: side }
}
