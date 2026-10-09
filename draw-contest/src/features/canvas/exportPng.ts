// 交卷 PNG 匯出（spec/draw-contest/architecture.md §5.1、§7；plan/draw-contest-mvp.md 決策 3）：
// 以 CANVAS_LOGICAL（1280×720）的離屏 canvas，依本機筆跡與背景重繪後輸出 PNG bytes。
// 不直接拿畫面上的 <canvas>：畫面上的底色是 CSS 背景（橡皮擦以 destination-out 挖透），畫布像素本身不含底色。
// 因此分兩層：筆跡層（透明底，與畫面同一套 redrawAll，橡皮擦照樣挖透）→ 輸出層先填底色、再疊上筆跡層。
// canvas 由 createCanvas 注入（預設 document.createElement('canvas')），測試以假 canvas 驗證尺寸與呼叫。
import { CANVAS_LOGICAL } from '@fishing-work/shared/draw-contest'
import { canvasBackground } from './canvasBackground'
import type { DrawOp } from './ops'
import { redrawAll, type RenderContext } from './render'

/** 輸出層用到的 Canvas 2D 成員（筆跡層另需 RenderContext） */
export type ExportContext = RenderContext & Pick<CanvasRenderingContext2D, 'fillRect' | 'drawImage'>

/** 匯出用的最小 canvas 介面（HTMLCanvasElement 可直接傳入） */
export interface ExportCanvas {
  width: number
  height: number
  getContext(contextId: '2d'): ExportContext | null
  toBlob(callback: (blob: Blob | null) => void, type?: string): void
}

export type CanvasFactory = () => ExportCanvas

/** 預設：瀏覽器的 <canvas>（不掛進 DOM） */
export const browserCanvas: CanvasFactory = () => document.createElement('canvas')

/** 匯出失敗（拿不到 2D context、toBlob 回 null） */
export class ExportPngError extends Error {}

function makeCanvas(createCanvas: CanvasFactory): { canvas: ExportCanvas; ctx: ExportContext } {
  const canvas = createCanvas()
  canvas.width = CANVAS_LOGICAL.width
  canvas.height = CANVAS_LOGICAL.height
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new ExportPngError('無法建立畫布')
  return { canvas, ctx }
}

/**
 * 依 ops 畫出一張 1280×720 的完整畫（底色＋筆跡），回傳輸出層 canvas。
 * 底色＝canvasBackground(ops)（最後一個 background op，否則 CANVAS_BACKGROUND）；空白畫布也照樣輸出（自動交卷含空白）
 */
export function paintExport(ops: readonly DrawOp[], createCanvas: CanvasFactory = browserCanvas): ExportCanvas {
  const strokes = makeCanvas(createCanvas)
  redrawAll(strokes.ctx, ops)
  const out = makeCanvas(createCanvas)
  out.ctx.fillStyle = canvasBackground(ops)
  out.ctx.fillRect(0, 0, CANVAS_LOGICAL.width, CANVAS_LOGICAL.height)
  out.ctx.drawImage(strokes.canvas as unknown as CanvasImageSource, 0, 0)
  return out.canvas
}

/** canvas → PNG bytes */
export function canvasToPng(canvas: ExportCanvas): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new ExportPngError('無法輸出圖片'))
        return
      }
      blob.arrayBuffer().then(resolve, reject)
    }, 'image/png')
  })
}

/** 本機筆跡 → 1280×720 PNG（ArrayBuffer，直接當 contest:submit 的 png） */
export function exportPng(ops: readonly DrawOp[], createCanvas: CanvasFactory = browserCanvas): Promise<ArrayBuffer> {
  try {
    return canvasToPng(paintExport(ops, createCanvas))
  } catch (e) {
    return Promise.reject(e)
  }
}
