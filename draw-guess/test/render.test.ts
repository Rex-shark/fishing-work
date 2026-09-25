import { beforeEach, describe, expect, it } from 'vitest'
import { BRUSH_MAX, BRUSH_MIN, PALETTE, type DrawOp } from '@fishing-work/shared'
import { compactOps, drawOp, redrawAll, toLogical, type RenderContext, type StrokeState } from '../src/features/canvas/render'

interface Style {
  composite: GlobalCompositeOperation
  lineWidth: number
  strokeStyle: RenderContext['strokeStyle']
  fillStyle: RenderContext['fillStyle']
  lineCap: CanvasLineCap
  lineJoin: CanvasLineJoin
}

type Call =
  | { fn: 'save' | 'restore' | 'beginPath' }
  | { fn: 'moveTo' | 'lineTo'; x: number; y: number }
  | { fn: 'arc'; x: number; y: number; r: number }
  | { fn: 'clearRect'; x: number; y: number; w: number; h: number }
  | { fn: 'stroke' | 'fill'; style: Style }

/** 假 context：記錄呼叫序列，stroke / fill 時一併記下當下樣式；save / restore 以堆疊模擬 */
class FakeCtx implements RenderContext {
  calls: Call[] = []
  private style: Style = {
    composite: 'source-over',
    lineWidth: 1,
    strokeStyle: 'initial',
    fillStyle: 'initial',
    lineCap: 'butt',
    lineJoin: 'miter',
  }
  private stack: Style[] = []

  get globalCompositeOperation() { return this.style.composite }
  set globalCompositeOperation(v) { this.style.composite = v }
  get lineWidth() { return this.style.lineWidth }
  set lineWidth(v) { this.style.lineWidth = v }
  get strokeStyle() { return this.style.strokeStyle }
  set strokeStyle(v) { this.style.strokeStyle = v }
  get fillStyle() { return this.style.fillStyle }
  set fillStyle(v) { this.style.fillStyle = v }
  get lineCap() { return this.style.lineCap }
  set lineCap(v) { this.style.lineCap = v }
  get lineJoin() { return this.style.lineJoin }
  set lineJoin(v) { this.style.lineJoin = v }

  save() { this.stack.push({ ...this.style }); this.calls.push({ fn: 'save' }) }
  restore() { const s = this.stack.pop(); if (s) this.style = s; this.calls.push({ fn: 'restore' }) }
  beginPath() { this.calls.push({ fn: 'beginPath' }) }
  moveTo(x: number, y: number) { this.calls.push({ fn: 'moveTo', x, y }) }
  lineTo(x: number, y: number) { this.calls.push({ fn: 'lineTo', x, y }) }
  arc(x: number, y: number, r: number) { this.calls.push({ fn: 'arc', x, y, r }) }
  stroke() { this.calls.push({ fn: 'stroke', style: { ...this.style } }) }
  fill() { this.calls.push({ fn: 'fill', style: { ...this.style } }) }
  clearRect(x: number, y: number, w: number, h: number) { this.calls.push({ fn: 'clearRect', x, y, w, h }) }

  get depth() { return this.stack.length }
  /** 只看繪圖相關呼叫（去掉 save / restore / beginPath） */
  drawing() { return this.calls.filter((c) => c.fn !== 'save' && c.fn !== 'restore' && c.fn !== 'beginPath') }
  reset() { this.calls = [] }
}

const WHITE = PALETTE[0]
const RED = PALETTE[2]

const begin = (strokeId: string, x: number, y: number, extra: Partial<Extract<DrawOp, { type: 'begin' }>> = {}): DrawOp => ({
  type: 'begin', strokeId, tool: 'pen', color: WHITE, size: 4, point: { x, y }, ...extra,
})
const move = (strokeId: string, ...pts: [number, number][]): DrawOp => ({
  type: 'move', strokeId, points: pts.map(([x, y]) => ({ x, y })),
})
const end = (strokeId: string): DrawOp => ({ type: 'end', strokeId })

let ctx: FakeCtx
let state: StrokeState

beforeEach(() => {
  ctx = new FakeCtx()
  state = new Map()
})

describe('toLogical：0..1 → 1280×720 邏輯像素', () => {
  it('中心、原點、右下角', () => {
    expect(toLogical({ x: 0.5, y: 0.5 })).toEqual({ x: 640, y: 360 })
    expect(toLogical({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 })
    expect(toLogical({ x: 1, y: 1 })).toEqual({ x: 1280, y: 720 })
  })
})

describe('drawOp', () => {
  it('begin：在落點畫一個直徑 = size 的實心點（單點點擊也看得到），樣式為畫筆、圓頭', () => {
    drawOp(ctx, begin('a', 0.25, 0.5, { size: 8, color: RED }), state)
    expect(ctx.drawing()).toEqual([
      { fn: 'arc', x: 320, y: 360, r: 4 },
      {
        fn: 'fill',
        style: { composite: 'source-over', lineWidth: 8, strokeStyle: RED, fillStyle: RED, lineCap: 'round', lineJoin: 'round' },
      },
    ])
    expect(state.get('a')).toMatchObject({ tool: 'pen', color: RED, size: 8, last: { x: 0.25, y: 0.5 } })
  })

  it('move：從上一點 moveTo，逐點 lineTo 後 stroke；下一則 move 從上一則的最後一點接續', () => {
    drawOp(ctx, begin('a', 0, 0), state)
    ctx.reset()
    drawOp(ctx, move('a', [0.5, 0], [0.5, 0.5]), state)
    drawOp(ctx, move('a', [1, 1]), state)
    const d = ctx.drawing()
    expect(d.slice(0, 3)).toEqual([
      { fn: 'moveTo', x: 0, y: 0 },
      { fn: 'lineTo', x: 640, y: 0 },
      { fn: 'lineTo', x: 640, y: 360 },
    ])
    expect(d[3]).toMatchObject({ fn: 'stroke', style: { lineWidth: 4, strokeStyle: WHITE, lineCap: 'round', lineJoin: 'round' } })
    expect(d.slice(4, 6)).toEqual([
      { fn: 'moveTo', x: 640, y: 360 },
      { fn: 'lineTo', x: 1280, y: 720 },
    ])
  })

  it('橡皮擦：落點與線段都用 destination-out，畫完還原成 source-over', () => {
    drawOp(ctx, begin('e', 0.1, 0.1, { tool: 'eraser', size: 16 }), state)
    drawOp(ctx, move('e', [0.2, 0.2]), state)
    const draws = ctx.calls.filter((c) => c.fn === 'fill' || c.fn === 'stroke')
    expect(draws).toHaveLength(2)
    for (const c of draws) expect(c).toMatchObject({ style: { composite: 'destination-out', lineWidth: 16 } })
    expect(ctx.globalCompositeOperation).toBe('source-over')
    expect(ctx.depth).toBe(0)
  })

  it(`粗細邊界：size ${BRUSH_MIN} 落點半徑 0.5、線寬 1；size ${BRUSH_MAX} 落點半徑 32、線寬 64`, () => {
    drawOp(ctx, begin('thin', 0.5, 0.5, { size: BRUSH_MIN }), state)
    drawOp(ctx, move('thin', [0.6, 0.5]), state)
    drawOp(ctx, begin('fat', 0.25, 0.25, { size: BRUSH_MAX }), state)
    drawOp(ctx, move('fat', [0.3, 0.3]), state)
    const arcs = ctx.calls.filter((c) => c.fn === 'arc')
    expect(arcs).toEqual([
      { fn: 'arc', x: 640, y: 360, r: 0.5 },
      { fn: 'arc', x: 320, y: 180, r: 32 },
    ])
    const widths = ctx.calls.flatMap((c) => (c.fn === 'fill' || c.fn === 'stroke' ? [c.style.lineWidth] : []))
    expect(widths).toEqual([1, 1, 64, 64])
  })

  it('任意色（PALETTE 以外）照原字串設定 stroke 與 fill 樣式', () => {
    const color = '#12AB9F'
    drawOp(ctx, begin('c', 0.5, 0.5, { color, size: 33 }), state)
    drawOp(ctx, move('c', [0.7, 0.7]), state)
    const draws = ctx.calls.filter((c) => c.fn === 'fill' || c.fn === 'stroke')
    expect(draws).toHaveLength(2)
    for (const c of draws) expect(c).toMatchObject({ style: { composite: 'source-over', strokeStyle: color, fillStyle: color, lineWidth: 33 } })
  })

  it('橡皮擦帶任意色仍用 destination-out，且不套用該色（忽略 color）', () => {
    drawOp(ctx, begin('e', 0.5, 0.5, { tool: 'eraser', color: '#FF0000', size: BRUSH_MAX }), state)
    drawOp(ctx, move('e', [0.6, 0.6]), state)
    const draws = ctx.calls.filter((c) => c.fn === 'fill' || c.fn === 'stroke')
    expect(draws).toHaveLength(2)
    for (const c of draws) {
      expect(c).toMatchObject({ style: { composite: 'destination-out', lineWidth: BRUSH_MAX, strokeStyle: 'initial', fillStyle: 'initial' } })
    }
    expect(ctx.calls.find((c) => c.fn === 'arc')).toEqual({ fn: 'arc', x: 640, y: 360, r: BRUSH_MAX / 2 })
  })

  it('畫筆接在橡皮擦之後不會殘留 destination-out', () => {
    drawOp(ctx, begin('e', 0.1, 0.1, { tool: 'eraser' }), state)
    drawOp(ctx, begin('p', 0.3, 0.3), state)
    const fills = ctx.calls.filter((c) => c.fn === 'fill')
    expect(fills[1]).toMatchObject({ style: { composite: 'source-over' } })
  })

  it('未知 strokeId 的 move 被忽略（不畫、不丟例外）', () => {
    drawOp(ctx, move('ghost', [0.5, 0.5]), state)
    expect(ctx.calls).toEqual([])
  })

  it('end 之後同一 strokeId 的 move 被忽略', () => {
    drawOp(ctx, begin('a', 0, 0), state)
    drawOp(ctx, end('a'), state)
    ctx.reset()
    drawOp(ctx, move('a', [0.5, 0.5]), state)
    expect(ctx.calls).toEqual([])
    expect(state.has('a')).toBe(false)
  })

  it('points 為空的 move 不畫', () => {
    drawOp(ctx, begin('a', 0, 0), state)
    ctx.reset()
    drawOp(ctx, { type: 'move', strokeId: 'a', points: [] }, state)
    expect(ctx.calls).toEqual([])
  })

  it('clear：清整張邏輯畫布並丟掉所有筆畫狀態', () => {
    drawOp(ctx, begin('a', 0, 0), state)
    ctx.reset()
    drawOp(ctx, { type: 'clear' }, state)
    expect(ctx.calls).toEqual([{ fn: 'clearRect', x: 0, y: 0, w: 1280, h: 720 }])
    expect(state.size).toBe(0)
  })

  it('undo：drawOp 不處理（由呼叫端全量重繪）', () => {
    drawOp(ctx, begin('a', 0, 0), state)
    ctx.reset()
    drawOp(ctx, { type: 'undo', strokeId: 'a' }, state)
    expect(ctx.calls).toEqual([])
  })

  it('每次繪製 save / restore 成對', () => {
    drawOp(ctx, begin('a', 0, 0), state)
    drawOp(ctx, move('a', [0.1, 0.1]), state)
    expect(ctx.calls.filter((c) => c.fn === 'save')).toHaveLength(2)
    expect(ctx.calls.filter((c) => c.fn === 'restore')).toHaveLength(2)
    expect(ctx.depth).toBe(0)
  })
})

describe('compactOps：歷史正規化', () => {
  it('undo 移除該 stroke 的 begin/move/end，undo 本身不留', () => {
    const ops = [begin('a', 0, 0), move('a', [0.1, 0.1]), end('a'), begin('b', 0.5, 0.5), end('b'), { type: 'undo', strokeId: 'b' } as DrawOp]
    expect(compactOps(ops)).toEqual([begin('a', 0, 0), move('a', [0.1, 0.1]), end('a')])
  })

  it('可連續 undo', () => {
    const ops: DrawOp[] = [begin('a', 0, 0), end('a'), begin('b', 0, 0), end('b'), { type: 'undo', strokeId: 'b' }, { type: 'undo', strokeId: 'a' }]
    expect(compactOps(ops)).toEqual([])
  })

  it('clear 丟掉之前的全部，clear 本身不留', () => {
    const ops: DrawOp[] = [begin('a', 0, 0), end('a'), { type: 'clear' }, begin('b', 0, 0)]
    expect(compactOps(ops)).toEqual([begin('b', 0, 0)])
  })

  it('已正規化的歷史原樣回傳', () => {
    const ops = [begin('a', 0, 0), move('a', [0.2, 0.2]), end('a')]
    expect(compactOps(ops)).toEqual(ops)
  })
})

describe('redrawAll：全量重繪', () => {
  it('先清畫布再從頭重播', () => {
    redrawAll(ctx, [begin('a', 0.5, 0.5), move('a', [1, 1]), end('a')])
    const d = ctx.drawing()
    expect(d[0]).toEqual({ fn: 'clearRect', x: 0, y: 0, w: 1280, h: 720 })
    expect(d.map((c) => c.fn)).toEqual(['clearRect', 'arc', 'fill', 'moveTo', 'lineTo', 'stroke'])
  })

  it('undo 後重繪的結果不含被撤的筆畫', () => {
    const ops: DrawOp[] = [begin('a', 0.1, 0.1), end('a'), begin('b', 0.9, 0.9), move('b', [0.8, 0.8]), end('b'), { type: 'undo', strokeId: 'b' }]
    redrawAll(ctx, ops)
    const arcs = ctx.calls.filter((c) => c.fn === 'arc')
    expect(arcs).toEqual([{ fn: 'arc', x: 128, y: 72, r: 2 }])
    expect(ctx.calls.some((c) => c.fn === 'lineTo')).toBe(false)
  })

  it('空歷史只清畫布', () => {
    redrawAll(ctx, [])
    expect(ctx.calls).toEqual([{ fn: 'clearRect', x: 0, y: 0, w: 1280, h: 720 }])
  })

  it('回傳進行中筆畫的狀態，之後的增量 move 能接著畫', () => {
    const s = redrawAll(ctx, [begin('a', 0, 0), move('a', [0.5, 0.5])])
    ctx.reset()
    drawOp(ctx, move('a', [1, 0.5]), s)
    expect(ctx.drawing().slice(0, 2)).toEqual([
      { fn: 'moveTo', x: 640, y: 360 },
      { fn: 'lineTo', x: 1280, y: 360 },
    ])
  })

  it('被撤銷的進行中筆畫不在回傳狀態內，其後續 move 被忽略', () => {
    const s = redrawAll(ctx, [begin('a', 0, 0), { type: 'undo', strokeId: 'a' }])
    ctx.reset()
    drawOp(ctx, move('a', [1, 1]), s)
    expect(ctx.calls).toEqual([])
  })
})
