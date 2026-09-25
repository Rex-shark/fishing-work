// vscode 主題（IDE 偽裝殼層）的純邏輯（可單元測試）：視窗標題、未儲存標記、狀態列色調、假行號、面板尺寸 clamp、玩家檔名。
// 尺寸與文字依 DESIGN.md §5；本檔不含任何樣式。
import type { RoundPhase } from '@fishing-work/shared'

/** 作用中分頁（畫布）的檔名 */
export const CANVAS_TAB = 'canvas.ts'
/** 專案（工作區）名稱：視窗標題與 EXPLORER 根節點 */
export const WORKSPACE_NAME = 'fishing-work'
/** 未儲存標記（VS Code 的 dirty 圓點） */
export const DIRTY_MARK = '●'

/** 作畫中 = 畫布「未儲存」：分頁與視窗標題加 ●（DESIGN §5「分頁列」「視窗標題」） */
export function isCanvasDirty(phase: RoundPhase): boolean {
  return phase === 'drawing'
}

/** document.title：`canvas.ts - fishing-work`；作畫中前綴 `● ` */
export function windowTitle(phase: RoundPhase): string {
  const base = `${CANVAS_TAB} - ${WORKSPACE_NAME}`
  return isCanvasDirty(phase) ? `${DIRTY_MARK} ${base}` : base
}

/** 狀態列是否改橘（仿除錯中）：自己是畫師且回合進行中（出題、作畫）；揭曉起恢復藍色（DESIGN §5 狀態列） */
export function isDrawerStatusBar(isDrawer: boolean, phase: RoundPhase): boolean {
  return isDrawer && (phase === 'choosing' || phase === 'drawing')
}

/** 玩家在 EXPLORER 裡的檔名：`<暱稱>.ts` */
export function playerFileName(nickname: string): string {
  return `${nickname}.ts`
}

/** 假行號的行高（px），與終端機行高一致（DESIGN §4、§5 gutter） */
export const GUTTER_LINE_HEIGHT = 18

/** 假行號行數：編輯區高度 / 行高，無條件捨去，至少 1 行；非有限數或非正值視為 1 */
export function gutterLineCount(height: number, lineHeight: number = GUTTER_LINE_HEIGHT): number {
  if (!Number.isFinite(height) || !(lineHeight > 0)) return 1
  return Math.max(1, Math.floor(height / lineHeight))
}

/** 側欄寬度（DESIGN §5：預設 240、最小 180）；上限取視窗寬的一半 */
export const SIDEBAR_MIN = 180
/** 底部面板高度（DESIGN §5：預設 220、最小 120）；上限保留編輯區至少 PANEL_EDITOR_RESERVE */
export const PANEL_MIN = 120
export const PANEL_EDITOR_RESERVE = 160

/** 把值夾在 min..max；max < min 時以 min 為準 */
export function clampSize(value: number, min: number, max: number): number {
  const hi = Math.max(min, max)
  if (!Number.isFinite(value)) return min
  return Math.min(hi, Math.max(min, Math.round(value)))
}

/** 拖曳側欄分隔線後的寬度 */
export function clampSidebarWidth(width: number, viewportWidth: number): number {
  return clampSize(width, SIDEBAR_MIN, Math.floor(viewportWidth / 2))
}

/** 拖曳面板分隔線後的高度：編輯區（含分頁列）至少保留 PANEL_EDITOR_RESERVE */
export function clampPanelHeight(height: number, columnHeight: number): number {
  return clampSize(height, PANEL_MIN, columnHeight - PANEL_EDITOR_RESERVE)
}
