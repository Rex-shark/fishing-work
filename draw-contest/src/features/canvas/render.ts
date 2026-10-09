// 畫布渲染純函式：本機 ops → Canvas 2D（複製自我畫你猜；畫面與交卷 PNG 的 exportPng 共用）
// 不依賴 React / store，context 以最小介面注入，方便 Vitest 用假 context 驗證呼叫序列。
import { CANVAS_LOGICAL } from '@fishing-work/shared/draw-contest'
import type { DrawOp, Point, Tool } from './ops'

/** 渲染用到的 Canvas 2D 成員（真實的 CanvasRenderingContext2D 可直接傳入） */
export type RenderContext = Pick<
  CanvasRenderingContext2D,
  | 'save'
  | 'restore'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'arc'
  | 'stroke'
  | 'fill'
  | 'clearRect'
  | 'lineWidth'
  | 'strokeStyle'
  | 'fillStyle'
  | 'lineCap'
  | 'lineJoin'
  | 'globalCompositeOperation'
>

/** 進行中筆畫的樣式與最後一點（move 不帶樣式，要靠 begin 記下來） */
export interface StrokeInfo {
  tool: Tool
  color: string
  size: number
  last: Point
}

export type StrokeState = Map<string, StrokeInfo>

/** 0..1 正規化座標 → 邏輯像素 */
export function toLogical(p: Point): { x: number; y: number } {
  return { x: p.x * CANVAS_LOGICAL.width, y: p.y * CANVAS_LOGICAL.height }
}

function withStyle(ctx: RenderContext, s: Pick<StrokeInfo, 'tool' | 'color' | 'size'>, draw: () => void): void {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // 粗細為 BRUSH_MIN..BRUSH_MAX 的整數（server 已驗證），直接當邏輯像素線寬
  ctx.lineWidth = s.size
  if (s.tool === 'eraser') {
    // 橡皮擦挖掉像素讓 CSS 背景透出，換主題背景色不影響既有筆跡（§6）。
    // 忽略 op 帶的 color：destination-out 只看來源 alpha，沿用 context 的不透明預設樣式即可
    ctx.globalCompositeOperation = 'destination-out'
  } else {
    ctx.globalCompositeOperation = 'source-over'
    // 任意 #RRGGBB（spec §4 COLOR_PATTERN）
    ctx.strokeStyle = s.color
    ctx.fillStyle = s.color
  }
  draw()
  ctx.restore()
}

/** 清空整張邏輯畫布 */
export function clearCanvas(ctx: RenderContext): void {
  ctx.clearRect(0, 0, CANVAS_LOGICAL.width, CANVAS_LOGICAL.height)
}

/**
 * 增量繪製一個 op。
 * - begin：記錄樣式並畫出落點（半徑 size / 2 的實心圓，單點點擊也看得到；零長度線段在部分瀏覽器不會描出筆帽）
 * - move：從上一點逐點 lineTo；未知 strokeId（例如已被撤銷、或 begin 早於本機紀錄）直接忽略
 * - end：丟掉該筆畫的追蹤狀態
 * - clear：清畫布與所有追蹤狀態
 * - undo：本函式不處理，呼叫端應移除該筆畫後以 redrawAll 全量重繪
 */
export function drawOp(ctx: RenderContext, op: DrawOp, state: StrokeState): void {
  switch (op.type) {
    case 'begin': {
      const info: StrokeInfo = { tool: op.tool, color: op.color, size: op.size, last: op.point }
      state.set(op.strokeId, info)
      const p = toLogical(op.point)
      withStyle(ctx, info, () => {
        ctx.beginPath()
        ctx.arc(p.x, p.y, op.size / 2, 0, Math.PI * 2)
        ctx.fill()
      })
      return
    }
    case 'move': {
      const info = state.get(op.strokeId)
      if (!info || op.points.length === 0) return
      withStyle(ctx, info, () => {
        const from = toLogical(info.last)
        ctx.beginPath()
        ctx.moveTo(from.x, from.y)
        for (const pt of op.points) {
          const p = toLogical(pt)
          ctx.lineTo(p.x, p.y)
        }
        ctx.stroke()
      })
      info.last = op.points[op.points.length - 1]
      return
    }
    case 'end':
      state.delete(op.strokeId)
      return
    case 'clear':
      clearCanvas(ctx)
      state.clear()
      return
    case 'undo':
      return
    case 'background':
      // 背景色不畫進畫布：由 Canvas 依 canvasBackground(ops) 設成畫布元素的 CSS 背景（§6，Epic 7）
      return
  }
}

/**
 * 把 op 歷史化簡成「目前畫面上實際存在」的 op（architecture §5「筆跡歷史正規化」）：
 * clear 丟掉之前的筆跡（background 保留），undo 移除該 strokeId 的 begin/move/end（不影響 background），
 * background 只留最後一個（原地取代舊的）。結果不含 undo / clear。
 * server 快照裡是否保留 undo / clear 都能正確處理。
 */
export function compactOps(ops: readonly DrawOp[]): DrawOp[] {
  let result: DrawOp[] = []
  for (const op of ops) {
    if (op.type === 'clear') {
      result = result.filter((o) => o.type === 'background')
    } else if (op.type === 'undo') {
      result = result.filter((o) => o.type === 'background' || o.type === 'clear' || o.strokeId !== op.strokeId)
    } else if (op.type === 'background') {
      result = replaceBackground(result, op)
    } else {
      result.push(op)
    }
  }
  return result
}

/**
 * background 歷史只留最後一個：已有就原地取代（長度不變），否則附加到尾端。
 * 渲染時背景永遠在筆跡之下，與它在 ops 裡的位置無關（Epic 7 決策 2）
 */
export function replaceBackground(ops: readonly DrawOp[], op: Extract<DrawOp, { type: 'background' }>): DrawOp[] {
  const i = ops.findIndex((o) => o.type === 'background')
  if (i < 0) return [...ops, op]
  const next = [...ops]
  next[i] = op
  return next
}

/**
 * 全量重繪：清畫布後從頭重播（先化簡，被撤銷的筆畫不會畫出）。
 * 回傳重播後的筆畫狀態，讓之後的增量 op（例如進行中筆畫的 move）能接著畫。
 */
export function redrawAll(ctx: RenderContext, ops: readonly DrawOp[]): StrokeState {
  const state: StrokeState = new Map()
  clearCanvas(ctx)
  for (const op of compactOps(ops)) drawOp(ctx, op, state)
  return state
}
