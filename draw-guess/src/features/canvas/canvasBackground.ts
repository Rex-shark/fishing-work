// 畫布底色（architecture §4 CANVAS_BACKGROUND、§6；DESIGN.md §3 --bg-canvas）：
// 不是主題 token，所有偽裝主題與所有玩家一致（畫布是共享畫面）。啟動時把 shared 常數注入根節點的 --bg-canvas，
// 以 inline style 設定，任何主題的樣式表（[data-theme] 覆寫）都蓋不過它；殼層裝飾以 bg-canvas class 使用。
// Epic 7 起畫師可在回合中換底色（background op，同步所有人）：Canvas 以 canvasBackground(ops) 推導，
// 以 inline style 設在畫布元素上；--bg-canvas 常數注入維持不變（殼層不動）。
import { CANVAS_BACKGROUND, type DrawOp } from '@fishing-work/shared'

export const CANVAS_BACKGROUND_VAR = '--bg-canvas'

export function applyCanvasBackground(root: { style: Pick<CSSStyleDeclaration, 'setProperty'> }): void {
  root.style.setProperty(CANVAS_BACKGROUND_VAR, CANVAS_BACKGROUND)
}

/**
 * 目前畫布底色：ops 中最後一個 background op 的色，沒有則為 CANVAS_BACKGROUND（Epic 7 決策 3）。
 * 回合開始 ops 清空即回到預設；clear 保留 background、undo 不影響，因此只看 ops 即可。
 */
export function canvasBackground(ops: readonly DrawOp[]): string {
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i]
    if (op.type === 'background') return op.color
  }
  return CANVAS_BACKGROUND
}
