// 畫布元件：渲染 store 的 ops，畫師的指標事件轉成 DrawOp（spec/architecture.md §6）
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { CANVAS_LOGICAL, type Point } from '@fishing-work/shared'
import { sendDrawOp } from '../../socket/client'
import { selectCanDraw, useGameStore } from '../../store/game'
import { normalizeBrushSize, normalizeColor } from './brush'
import { drawOp, redrawAll } from './render'
import { chunkPoints, newStrokeId, normalizePoint } from './stroke'

interface ActiveStroke {
  pointerId: number
  strokeId: string
  /** 尚未送出的點（每個動畫影格批次送一個 move） */
  pending: Point[]
  last: Point
  raf: number | null
}

export function Canvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const strokeRef = useRef<ActiveStroke | null>(null)
  const canDraw = useGameStore(selectCanDraw)

  // 渲染：直接訂閱 store（不經 React render）。
  // opsVersion 變了（快照、undo、clear、新回合）→ 全量重繪；否則只增量畫新追加的 op。
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const initial = useGameStore.getState()
    let version = initial.opsVersion
    let strokes = redrawAll(ctx, initial.ops)
    let drawn = initial.ops.length

    return useGameStore.subscribe((state) => {
      if (state.opsVersion !== version) {
        version = state.opsVersion
        strokes = redrawAll(ctx, state.ops)
        drawn = state.ops.length
        return
      }
      if (state.ops.length > drawn) {
        for (let i = drawn; i < state.ops.length; i++) drawOp(ctx, state.ops[i], strokes)
        drawn = state.ops.length
      }
    })
  }, [])

  // 失去作畫權（回合結束、被取消）或卸載時，丟掉進行中的筆畫；server 此時也會丟棄後續 op
  useEffect(() => {
    if (!canDraw) return
    return () => {
      const s = strokeRef.current
      if (s?.raf != null) cancelAnimationFrame(s.raf)
      strokeRef.current = null
    }
  }, [canDraw])

  /** 送出累積的點；一則 move 最多 MAX_POINTS_PER_MOVE 點，超過拆成多則 */
  function flush(s: ActiveStroke): void {
    const pending = s.pending
    s.pending = []
    for (const points of chunkPoints(pending)) {
      if (!sendDrawOp({ type: 'move', strokeId: s.strokeId, points })) return
    }
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLCanvasElement>): void {
    if (!canDraw || strokeRef.current !== null) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    const canvas = e.currentTarget
    const point = normalizePoint(e.clientX, e.clientY, canvas.getBoundingClientRect())
    const { brush } = useGameStore.getState()
    const strokeId = newStrokeId()
    // 色碼正規化為大寫 #RRGGBB、粗細取整數並 clamp（server 對不合法值靜默丟棄）；
    // 橡皮擦也帶合法顏色（spec §5：渲染時 destination-out 只看 alpha）
    const began = sendDrawOp({
      type: 'begin',
      strokeId,
      tool: brush.tool,
      color: normalizeColor(brush.color),
      size: normalizeBrushSize(brush.size),
      point,
    })
    // 筆跡已達上限：不開始這一筆（ToolBar 會顯示提示）
    if (!began) return
    // 捕捉指標：拖出畫布外仍持續收到 move / up（座標 clamp 到邊緣）
    canvas.setPointerCapture(e.pointerId)
    strokeRef.current = { pointerId: e.pointerId, strokeId, pending: [], last: point, raf: null }
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLCanvasElement>): void {
    const s = strokeRef.current
    if (!s || e.pointerId !== s.pointerId) return
    const rect = e.currentTarget.getBoundingClientRect()
    const native = e.nativeEvent
    // 高頻滑鼠在一個影格內的多個取樣（Safari 17 前沒有 getCoalescedEvents）
    const samples = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : []
    for (const ev of samples.length > 0 ? samples : [native]) {
      const p = normalizePoint(ev.clientX, ev.clientY, rect)
      if (p.x === s.last.x && p.y === s.last.y) continue
      s.pending.push(p)
      s.last = p
    }
    if (s.pending.length > 0 && s.raf === null) {
      s.raf = requestAnimationFrame(() => {
        s.raf = null
        // 筆畫已結束或被丟棄就不送
        if (strokeRef.current === s) flush(s)
      })
    }
  }

  function handlePointerEnd(e: ReactPointerEvent<HTMLCanvasElement>): void {
    const s = strokeRef.current
    if (!s || e.pointerId !== s.pointerId) return
    if (s.raf !== null) cancelAnimationFrame(s.raf)
    s.raf = null
    flush(s)
    sendDrawOp({ type: 'end', strokeId: s.strokeId })
    strokeRef.current = null
  }

  // 16:9 等比縮放到容器（父層須為 size container）：寬取「容器寬」與「容器高 × 16/9」的較小者。
  // canvas 本身透明，底色由 CSS 背景 --bg-canvas 提供；其值為 shared 的 CANVAS_BACKGROUND（啟動時注入，見 canvasBackground.ts；§6）
  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_LOGICAL.width}
      height={CANVAS_LOGICAL.height}
      aria-label="畫布"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      className={`block aspect-video w-[min(100cqw,calc(100cqh*16/9))] touch-none bg-canvas outline-1 outline-border ${canDraw ? 'cursor-crosshair' : 'cursor-default'}`}
    />
  )
}
