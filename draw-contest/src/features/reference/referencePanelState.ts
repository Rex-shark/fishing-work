// 參考圖面板的純邏輯（Epic 20；plan/contest-mimic.md 決策 6）：狀態轉移。文字在 referenceText.ts。

/** 展開（預設）／收合成小按鈕／放大檢視 */
export type ReferencePanelState = 'expanded' | 'collapsed' | 'zoomed'

export type ReferencePanelAction = 'zoom' | 'unzoom' | 'collapse' | 'expand'

/**
 * 初始狀態（Phase 2.5）：視窗窄於工具列收合斷點（殼層的 ShellViews.toolbar.compactBelowPx，ppt 540px）時預設收合，
 * 免得面板蓋住大半張畫布；否則展開。只看掛載當下的視窗寬，之後改變寬度不自動切換（本機偏好照舊不記）
 */
export function initialReferencePanelState(narrow: boolean): ReferencePanelState {
  return narrow ? 'collapsed' : 'expanded'
}

/**
 * 狀態轉移：展開 ⇄ 放大（zoom／unzoom）、展開 ⇄ 收合（collapse／expand）。
 * 不合時宜的操作（收合時放大、放大時收合…）維持原狀態
 */
export function referencePanelNext(state: ReferencePanelState, action: ReferencePanelAction): ReferencePanelState {
  switch (action) {
    case 'zoom':
      return state === 'expanded' ? 'zoomed' : state
    case 'unzoom':
      return state === 'zoomed' ? 'expanded' : state
    case 'collapse':
      return state === 'expanded' ? 'collapsed' : state
    case 'expand':
      return state === 'collapsed' ? 'expanded' : state
  }
}
