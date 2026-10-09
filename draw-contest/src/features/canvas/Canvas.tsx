// 自己的本機畫布（spec/draw-contest/architecture.md §7；plan/draw-contest-mvp.md 決策 3）：渲染 store.myCanvas，
// 能作畫時（參賽者、drawing、未交卷）把指標事件轉成本機 DrawOp。筆跡不送出：交卷時由 exportPng 重繪成 PNG。
// 交卷後（或 judging）畫布鎖定，只顯示。
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { CANVAS_LOGICAL } from '@fishing-work/shared/draw-contest'
import { selectCanDraw, useGameStore } from '../../store/game'
import { normalizeBrushSize, normalizeColor } from './brush'
import { canvasBackground } from './canvasBackground'
import type { DrawOp, Point } from './ops'
import { drawOp, redrawAll } from './render'
import { newStrokeId, normalizePoint } from './stroke'

interface ActiveStroke {
  pointerId: number
  strokeId: string
  /** 尚未加進 store 的點（每個動畫影格批次加一個 move） */
  pending: Point[]
  last: Point
  raf: number | null
}

const apply = (op: DrawOp) => useGameStore.getState().applyCanvasOp(op)

/** 把累積的點加成一個 move（本機不必分批） */
function flush(s: ActiveStroke): void {
  if (s.pending.length === 0) return
  const points = s.pending
  s.pending = []
  apply({ type: 'move', strokeId: s.strokeId, points })
}

export function Canvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const strokeRef = useRef<ActiveStroke | null>(null)
  const canDraw = useGameStore(selectCanDraw)
  // 底色：selector 回傳字串，只有底色變了才重新 render
  const background = useGameStore((s) => canvasBackground(s.myCanvas.ops))

  // 渲染：直接訂閱 store（不經 React render）。
  // version 變了（undo、clear、新回合）→ 全量重繪；否則只增量畫新追加的 op。
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const initial = useGameStore.getState().myCanvas
    let version = initial.version
    let strokes = redrawAll(ctx, initial.ops)
    let drawn = initial.ops.length

    return useGameStore.subscribe((state) => {
      const { ops, version: v } = state.myCanvas
      if (v !== version) {
        version = v
        strokes = redrawAll(ctx, ops)
        drawn = ops.length
        return
      }
      if (ops.length > drawn) {
        for (let i = drawn; i < ops.length; i++) drawOp(ctx, ops[i], strokes)
        drawn = ops.length
      }
    })
  }, [])

  // 失去作畫權（交卷、時間到）或卸載時，收尾進行中的筆畫（已畫的點保留）
  useEffect(() => {
    if (!canDraw) return
    return () => {
      const s = strokeRef.current
      if (s === null) return
      if (s.raf !== null) cancelAnimationFrame(s.raf)
      flush(s)
      apply({ type: 'end', strokeId: s.strokeId })
      strokeRef.current = null
    }
  }, [canDraw])

  function handlePointerDown(e: ReactPointerEvent<HTMLCanvasElement>): void {
    if (!canDraw || strokeRef.current !== null) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    const canvas = e.currentTarget
    const point = normalizePoint(e.clientX, e.clientY, canvas.getBoundingClientRect())
    const { brush } = useGameStore.getState()
    const strokeId = newStrokeId()
    // 色碼正規化為大寫 #RRGGBB、粗細取整數並 clamp；橡皮擦也帶合法顏色（渲染時 destination-out 只看 alpha）
    apply({
      type: 'begin',
      strokeId,
      tool: brush.tool,
      color: normalizeColor(brush.color),
      size: normalizeBrushSize(brush.size),
      point,
    })
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
        // 筆畫已結束或被丟棄就不加
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
    apply({ type: 'end', strokeId: s.strokeId })
    strokeRef.current = null
  }

  // 16:9 等比縮放到容器（父層須為 size container）：寬取「容器寬」與「容器高 × 16/9」的較小者。
  // canvas 本身透明（橡皮擦 destination-out 擦出底色），底色由 CSS 背景提供：canvasBackground(ops) 以 inline style 設定
  // （預設 shared 的 CANVAS_BACKGROUND；工具列「背景色」換自己畫布的底色）。bg-canvas class（--bg-canvas 常數注入）留作後備。
  // 鎖定（不能作畫）時 pointer-events: none（design §2「已交卷」）
  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_LOGICAL.width}
      height={CANVAS_LOGICAL.height}
      aria-label={canDraw ? '畫布' : '畫布（已鎖定）'}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      style={{ backgroundColor: background }}
      className={`block aspect-video w-[min(100cqw,calc(100cqh*16/9))] touch-none bg-canvas outline-1 outline-border ${
        canDraw ? 'cursor-crosshair' : 'pointer-events-none cursor-default'
      }`}
    />
  )
}
