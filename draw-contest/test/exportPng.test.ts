// 交卷 PNG 匯出（features/canvas/exportPng；spec/draw-contest/architecture.md §5.1、§7）：
// 以假 canvas 驗證 1280×720、兩層（筆跡層透明、輸出層先填底色再疊筆跡）、toBlob 'image/png' 與錯誤路徑。
import { describe, expect, it } from 'vitest'
import { CANVAS_BACKGROUND, CANVAS_LOGICAL } from '@fishing-work/shared/draw-contest'
import { ExportPngError, exportPng, paintExport, type ExportCanvas, type ExportContext } from '../src/features/canvas/exportPng'
import type { DrawOp } from '../src/features/canvas/ops'

interface FakeCanvas extends ExportCanvas {
  id: number
  calls: string[]
  blobType: string | undefined
}

/** 記錄呼叫的假 canvas；fillStyle 等屬性照存 */
function fakeFactory(opts: { noContext?: boolean; nullBlob?: boolean; bytes?: number[] } = {}) {
  const canvases: FakeCanvas[] = []
  const factory = (): ExportCanvas => {
    const calls: string[] = []
    const ctx = {
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      beginPath: () => calls.push('beginPath'),
      moveTo: () => calls.push('moveTo'),
      lineTo: () => calls.push('lineTo'),
      arc: () => calls.push('arc'),
      stroke: () => calls.push('stroke'),
      fill: () => calls.push('fill'),
      clearRect: (x: number, y: number, w: number, h: number) => calls.push(`clearRect ${x},${y},${w},${h}`),
      fillRect: (x: number, y: number, w: number, h: number) => calls.push(`fillRect ${x},${y},${w},${h} ${String(ctx.fillStyle)}`),
      drawImage: (src: unknown, x: number, y: number) => calls.push(`drawImage #${(src as FakeCanvas).id} ${x},${y}`),
      lineWidth: 1,
      strokeStyle: '#000000',
      fillStyle: '#000000',
      lineCap: 'butt',
      lineJoin: 'miter',
      globalCompositeOperation: 'source-over',
    } as unknown as ExportContext
    const canvas: FakeCanvas = {
      id: canvases.length,
      calls,
      blobType: undefined,
      width: 300,
      height: 150,
      getContext: () => (opts.noContext ? null : ctx),
      toBlob(cb, type) {
        canvas.blobType = type
        cb(opts.nullBlob ? null : new Blob([new Uint8Array(opts.bytes ?? [0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }))
      },
    }
    canvases.push(canvas)
    return canvas
  }
  return { factory, canvases }
}

const begin = (strokeId: string, tool: 'pen' | 'eraser' = 'pen'): DrawOp => ({
  type: 'begin',
  strokeId,
  tool,
  color: '#FFFFFF',
  size: 4,
  point: { x: 0.5, y: 0.5 },
})

describe('paintExport：1280×720 兩層重繪', () => {
  it('兩張 canvas 都設成 CANVAS_LOGICAL；輸出層先填預設底色再疊筆跡層', () => {
    const { factory, canvases } = fakeFactory()
    const out = paintExport([begin('a'), { type: 'end', strokeId: 'a' }], factory)
    expect(canvases).toHaveLength(2)
    for (const c of canvases) expect([c.width, c.height]).toEqual([CANVAS_LOGICAL.width, CANVAS_LOGICAL.height])
    const [strokes, output] = canvases
    expect(out).toBe(output)
    // 筆跡層：清空後重播（begin 畫落點圓）
    expect(strokes.calls[0]).toBe(`clearRect 0,0,${CANVAS_LOGICAL.width},${CANVAS_LOGICAL.height}`)
    expect(strokes.calls).toContain('arc')
    expect(strokes.calls.some((c) => c.startsWith('fillRect'))).toBe(false)
    // 輸出層：底色 → 筆跡層
    expect(output.calls).toEqual([
      `fillRect 0,0,${CANVAS_LOGICAL.width},${CANVAS_LOGICAL.height} ${CANVAS_BACKGROUND}`,
      `drawImage #${strokes.id} 0,0`,
    ])
  })

  it('換過背景色：以最後一個 background op 的色填底（背景不畫進筆跡層）', () => {
    const { factory, canvases } = fakeFactory()
    paintExport([{ type: 'background', color: '#FFECEA' }, begin('a'), { type: 'background', color: '#000000' }], factory)
    expect(canvases[1].calls[0]).toBe(`fillRect 0,0,${CANVAS_LOGICAL.width},${CANVAS_LOGICAL.height} #000000`)
  })

  it('空白畫布也輸出（自動交卷含空白）：只有底色', () => {
    const { factory, canvases } = fakeFactory()
    paintExport([], factory)
    expect(canvases[0].calls).toEqual([`clearRect 0,0,${CANVAS_LOGICAL.width},${CANVAS_LOGICAL.height}`])
    expect(canvases[1].calls).toHaveLength(2)
  })
})

describe('exportPng：輸出 PNG bytes', () => {
  it("toBlob 以 'image/png' 輸出，回傳 ArrayBuffer", async () => {
    const { factory, canvases } = fakeFactory({ bytes: [0x89, 0x50, 0x4e, 0x47, 1, 2] })
    const buf = await exportPng([begin('a')], factory)
    expect(buf).toBeInstanceOf(ArrayBuffer)
    expect(Array.from(new Uint8Array(buf))).toEqual([0x89, 0x50, 0x4e, 0x47, 1, 2])
    expect(canvases[1].blobType).toBe('image/png')
  })

  it('拿不到 2D context → ExportPngError', async () => {
    const { factory } = fakeFactory({ noContext: true })
    await expect(exportPng([], factory)).rejects.toBeInstanceOf(ExportPngError)
  })

  it('toBlob 回 null → ExportPngError', async () => {
    const { factory } = fakeFactory({ nullBlob: true })
    await expect(exportPng([], factory)).rejects.toBeInstanceOf(ExportPngError)
  })
})
