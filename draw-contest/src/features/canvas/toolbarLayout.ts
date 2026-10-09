// 作畫工具列的版面判斷（純函式）：收合斷點由殼層提供（ShellViews.toolbar.compactBelowPx），各主題工具列所在的空間不同。

/**
 * 「完整工具列」的媒體查詢：視窗寬度 ≥ compactBelowPx 時粗細滑桿直接顯示，否則收進「⋯」。
 * compactBelowPx ≤ 0（或非有限數）= 永不收合（查詢恆成立）。
 */
export function fullToolbarQuery(compactBelowPx: number): string {
  const px = Number.isFinite(compactBelowPx) && compactBelowPx > 0 ? Math.round(compactBelowPx) : 0
  return `(min-width: ${px}px)`
}
