// 畫布底色（architecture §4 CANVAS_BACKGROUND、§6；DESIGN.md §3 --bg-canvas）：
// 不是主題 token，所有偽裝主題一致。啟動時把 shared 常數注入根節點的 --bg-canvas，
// 以 inline style 設定，任何主題的樣式表（[data-theme] 覆寫）都蓋不過它；殼層裝飾以 bg-canvas class 使用。
// 繪圖比賽的畫布是每人自己的本機畫布：參賽者可換自己畫布的底色（本機 background op，不送出），
// Canvas 以 canvasBackground(ops) 推導並以 inline style 設在畫布元素上；exportPng 也以同一個值填底。
import { CANVAS_BACKGROUND } from '@fishing-work/shared/draw-contest'
import type { DrawOp } from './ops'

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
