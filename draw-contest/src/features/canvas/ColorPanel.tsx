// 顏色面板（Epic 11；DESIGN.md §6「顏色面板」、spec §6「顏色」；plan/color-picker.md 決策 2、4）：
// 由工具列「目前顏色」按鈕開啟。由上而下：飽和度／明度方塊 216×132、色相條 216×12、底列（目前色預覽 22×22＋色碼）。
// 外觀同「⋯」面板（--bg-quickinput、1px --border、圓角 3px、--quickinput-shadow），portal 到 body、position: fixed、
// placeFloating 定位在按鈕下方；點面板外、Esc（focus 回按鈕）、視窗縮放時關閉（useFloatingPanel）。
// 每次變動立即 setBrush（color＝hsvToHex(hue, sat, val)）並切回畫筆，不需要「確定」。
// 方塊底色、漸層、把手與預覽的顏色是遊戲資料（畫筆色），以 style 帶入（DESIGN §10 例外）；其餘一律用 token。
import { useRef, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { tip } from '../../layout/tooltipPlacement'
import { useGameStore } from '../../store/game'
import { HUE_MAX, hsvToHex, hueToHex, svFromPointer, svKeyValue, svLabel } from './brush'
import { HueSlider } from './Slider'
import { useFloatingPanel } from './useFloatingPanel'

/** 方塊與色相條寬 216px（面板 232px 扣左右內距 8px）、方塊高 132px（DESIGN §6） */
const COLOR_PANEL_INNER_PX = 216
const SV_SQUARE_HEIGHT_PX = 132

/** 方塊的兩層漸層：白→透明（向右，飽和度）疊在黑→透明（向上，明度）之下；底色另以目前色相純色帶入 */
const SV_GRADIENT = 'linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)'

export function ColorPanel({
  open,
  close,
  buttonRef,
}: {
  open: boolean
  close: () => void
  buttonRef: RefObject<HTMLButtonElement | null>
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const { onKeyDown } = useFloatingPanel(open, close, buttonRef, panelRef)
  const hue = useGameStore((s) => s.brush.hue)
  const sat = useGameStore((s) => s.brush.sat)
  const val = useGameStore((s) => s.brush.val)
  const color = useGameStore((s) => s.brush.color)
  const setBrush = useGameStore((s) => s.setBrush)

  if (!open) return null

  function applySv(next: { sat: number; val: number }) {
    setBrush({ ...next, color: hsvToHex(hue, next.sat, next.val), tool: 'pen' })
  }

  function applyHue(h: number) {
    setBrush({ hue: h, color: hsvToHex(h, sat, val), tool: 'pen' })
  }

  // 點色塊反推的色相可能帶小數，色相條顯示與鍵盤步進用整數
  const hueShown = Math.min(HUE_MAX, Math.round(hue))

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="顏色面板"
      onKeyDown={onKeyDown}
      className="fixed top-0 left-0 z-50 flex flex-col gap-[8px] rounded-[3px] border border-border bg-quickinput p-[8px] font-mono text-[13px] text-fg shadow-quickinput"
    >
      <SvSquare hue={hue} sat={sat} val={val} color={color} onChange={applySv} />
      <HueSlider hue={hueShown} onChange={applyHue} width={COLOR_PANEL_INNER_PX} />
      <div className="flex items-center gap-[8px]">
        <span aria-hidden="true" className="block h-[22px] w-[22px] shrink-0 rounded-[3px] border border-border" style={{ backgroundColor: color }} />
        <span className="leading-[22px] tabular-nums">{color}</span>
      </div>
    </div>,
    document.body,
  )
}

/**
 * 飽和度／明度方塊（決策 2、4）：x＝飽和度 0→100、y＝明度 100→0；指標按下／拖曳即選（setPointerCapture，拖出 clamp）。
 * ARIA 沒有二維滑桿：role="slider"，aria-valuenow 給飽和度、aria-valuetext 兩者都唸；←/→ 飽和度、↑/↓ 明度
 */
function SvSquare({
  hue,
  sat,
  val,
  color,
  onChange,
}: {
  hue: number
  sat: number
  val: number
  color: string
  onChange: (next: { sat: number; val: number }) => void
}) {
  const dragging = useRef<number | null>(null)
  const label = svLabel(sat, val)

  /** force：按下一律回報（即使數值沒變），讓「點目前位置」也切回畫筆 */
  function update(e: PointerEvent<HTMLDivElement>, force: boolean) {
    const r = e.currentTarget.getBoundingClientRect()
    const next = svFromPointer(e.clientX, e.clientY, { left: r.left, top: r.top, width: r.width, height: r.height })
    if (force || next.sat !== sat || next.val !== val) onChange(next)
  }

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    const el = e.currentTarget
    el.focus({ preventScroll: true })
    el.setPointerCapture(e.pointerId)
    dragging.current = e.pointerId
    update(e, true)
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    if (dragging.current !== e.pointerId) return
    update(e, false)
  }

  function handlePointerEnd(e: PointerEvent<HTMLDivElement>) {
    if (dragging.current === e.pointerId) dragging.current = null
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const next = svKeyValue(e.key, e.shiftKey, sat, val)
    if (next === null) return
    e.preventDefault()
    onChange(next)
  }

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="飽和度與明度"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(sat)}
      aria-valuetext={label}
      {...tip(label)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onKeyDown={handleKeyDown}
      className="relative shrink-0 cursor-crosshair touch-none rounded-[3px] outline-none select-none focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
      style={{
        width: COLOR_PANEL_INNER_PX,
        height: SV_SQUARE_HEIGHT_PX,
        backgroundColor: hueToHex(hue),
        backgroundImage: SV_GRADIENT,
      }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute h-[12px] w-[12px] rounded-full border-2 border-fg-statusbar"
        style={{ left: `calc(${sat}% - 6px)`, top: `calc(${100 - val}% - 6px)`, backgroundColor: color }}
      />
    </div>
  )
}
