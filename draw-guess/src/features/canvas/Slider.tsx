// 畫師工具列的兩個滑桿（DESIGN.md §6「滑桿」「色相條」；spec §6「粗細」「顏色」）。
// 自製、不用元件庫：role="slider"＋aria-valuemin/max/now/text；指標拖曳或點擊軌道、鍵盤（←→↑↓、Shift、PageUp/Down、Home/End）。
// 共同的指標與鍵盤行為在 SliderBase；外觀由各自的 children 依比例（0..1）繪製。
import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { tip } from '../../layout/tooltipPlacement'
import {
  HUE_GRADIENT,
  HUE_KEYS,
  hueToHex,
  previewDiameter,
  SIZE_KEYS,
  sliderKeyValue,
  valueFromPointer,
  valueRatio,
  type SliderKeyConfig,
} from './brush'

interface SliderBaseProps {
  label: string
  valueText: string
  tooltip: string
  value: number
  keys: SliderKeyConfig
  onChange: (value: number) => void
  className: string
  children: (ratio: number) => ReactNode
}

function SliderBase({ label, valueText, tooltip, value, keys, onChange, className, children }: SliderBaseProps) {
  const dragging = useRef<number | null>(null)
  const { min, max } = keys

  /** force：按下與鍵盤一律回報（即使數值沒變），讓「點色相條目前位置」也能把顏色切成該色相、切回畫筆 */
  function update(clientX: number, el: HTMLElement, force: boolean) {
    const r = el.getBoundingClientRect()
    const next = valueFromPointer(clientX, r.left, r.width, min, max)
    if (force || next !== value) onChange(next)
  }

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    const el = e.currentTarget
    el.focus({ preventScroll: true })
    // 捕捉指標：拖出軌道外仍持續更新（clamp 到兩端）
    el.setPointerCapture(e.pointerId)
    dragging.current = e.pointerId
    update(e.clientX, el, true)
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    if (dragging.current !== e.pointerId) return
    update(e.clientX, e.currentTarget, false)
  }

  function handlePointerEnd(e: PointerEvent<HTMLDivElement>) {
    if (dragging.current === e.pointerId) dragging.current = null
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const next = sliderKeyValue(e.key, e.shiftKey, value, keys)
    if (next === null) return
    e.preventDefault()
    onChange(next)
  }

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      aria-orientation="horizontal"
      {...tip(tooltip)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onKeyDown={handleKeyDown}
      className={`relative flex shrink-0 cursor-pointer touch-none items-center rounded-[2px] outline-none select-none focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-border-focus ${className}`}
    >
      {children(valueRatio(value, min, max))}
    </div>
  )
}

/**
 * 粗細滑桿：寬 80px 細軌道（高 2px 底 --border、已選段 --accent）、10px 圓把手 --fg；
 * 右側顯示數值與預覽圓點（直徑隨粗細 2–16px，不撐高工具列）
 */
export function SizeSlider({ value, onChange }: { value: number; onChange: (size: number) => void }) {
  const d = previewDiameter(value)
  return (
    <div className="flex shrink-0 items-center gap-[6px]">
      <SliderBase
        label="粗細"
        valueText={`粗細 ${value}`}
        tooltip={`粗細 ${value}`}
        value={value}
        keys={SIZE_KEYS}
        onChange={onChange}
        className="mx-[5px] h-[22px] w-[80px]"
      >
        {(ratio) => (
          <>
            <span aria-hidden="true" className="absolute right-0 left-0 h-[2px] bg-border" />
            <span aria-hidden="true" className="absolute left-0 h-[2px] bg-accent" style={{ width: `${ratio * 100}%` }} />
            <span
              aria-hidden="true"
              className="absolute h-[10px] w-[10px] rounded-full bg-fg"
              style={{ left: `calc(${ratio * 100}% - 5px)` }}
            />
          </>
        )}
      </SliderBase>
      <span aria-hidden="true" className="w-[2ch] text-right text-fg tabular-nums">
        {value}
      </span>
      <span aria-hidden="true" className="flex h-4 w-4 shrink-0 items-center justify-center">
        <span className="block rounded-full bg-fg" style={{ width: d, height: d }} />
      </span>
    </div>
  )
}

/**
 * 色相條：96×10px 彩虹漸層、圓角 5px、12px 圓形白框把手（填目前色相）；←/→ 每次 5°。
 * 漸層與把手填色是資料（色相本身），以執行期 style 產生，不是主題色
 */
export function HueSlider({ hue, onChange }: { hue: number; onChange: (hue: number) => void }) {
  const hex = hueToHex(hue)
  return (
    <SliderBase
      label="色相"
      valueText={`色相 ${hue}°，${hex}`}
      tooltip={`色相 ${hue}° ${hex}`}
      value={hue}
      keys={HUE_KEYS}
      onChange={onChange}
      className="mx-[6px] h-[22px] w-[96px]"
    >
      {(ratio) => (
        <>
          <span aria-hidden="true" className="absolute right-0 left-0 h-[10px] rounded-[5px]" style={{ backgroundImage: HUE_GRADIENT }} />
          <span
            aria-hidden="true"
            className="absolute h-[12px] w-[12px] rounded-full border-2 border-fg-statusbar"
            style={{ left: `calc(${ratio * 100}% - 6px)`, backgroundColor: hex }}
          />
        </>
      )}
    </SliderBase>
  )
}
