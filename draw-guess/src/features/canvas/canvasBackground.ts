// 畫布底色（architecture §4 CANVAS_BACKGROUND、§6；DESIGN.md §3 --bg-canvas）：
// 不是主題 token，所有偽裝主題與所有玩家一致（畫布是共享畫面）。啟動時把 shared 常數注入根節點的 --bg-canvas，
// 以 inline style 設定，任何主題的樣式表（[data-theme] 覆寫）都蓋不過它；畫布元件以 bg-canvas class 使用。
import { CANVAS_BACKGROUND } from '@fishing-work/shared'

export const CANVAS_BACKGROUND_VAR = '--bg-canvas'

export function applyCanvasBackground(root: { style: Pick<CSSStyleDeclaration, 'setProperty'> }): void {
  root.style.setProperty(CANVAS_BACKGROUND_VAR, CANVAS_BACKGROUND)
}
