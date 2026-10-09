// 工具提示浮層（DESIGN.md §6「工具提示」，仿 VS Code hover）：
//   底 --bg-quickinput、1px --border、字 --fg 12px、內距 2px 8px、圓角 3px、陰影 --quickinput-shadow；
//   hover 300ms 後或鍵盤 focus 立即顯示，離開／失焦／Esc／按下（滑桿除外）即消失，無動畫。
// 以事件委派處理所有帶 data-tooltip 的元素（見 tooltipPlacement.ts 的 tip()），整個 App 只掛一個。
// 內容變動（例：拖曳滑桿時「粗細 12」）以 MutationObserver 即時更新；錨點被移除（例：回合結束工具列消失）即隱藏。
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  placeFloating,
  readPlacement,
  TOOLTIP_ATTR,
  TOOLTIP_DELAY_MS,
  TOOLTIP_PLACEMENT_ATTR,
  type Rect,
  type TooltipPlacement,
} from './tooltipPlacement'

interface Shown {
  text: string
  anchor: Rect
  placement: TooltipPlacement
}

function sameShown(a: Shown | null, b: Shown): boolean {
  return (
    a !== null &&
    a.text === b.text &&
    a.placement === b.placement &&
    a.anchor.left === b.anchor.left &&
    a.anchor.top === b.anchor.top &&
    a.anchor.width === b.anchor.width &&
    a.anchor.height === b.anchor.height
  )
}

function tooltipOwner(node: EventTarget | null): HTMLElement | null {
  return node instanceof Element ? node.closest<HTMLElement>(`[${TOOLTIP_ATTR}]`) : null
}

function isFocusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible')
  } catch {
    return true
  }
}

export function TooltipLayer() {
  const [shown, setShown] = useState<Shown | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    /** 目前顯示中的錨點與觸發方式 */
    let target: HTMLElement | null = null
    let via: 'hover' | 'focus' | null = null
    /** hover 延遲中的元素 */
    let pending: HTMLElement | null = null
    /** 按下後暫停提示的元素（指標離開它之前不再顯示），避免提示蓋住按下後開啟的浮層 */
    let suppressed: HTMLElement | null = null
    let timer: ReturnType<typeof setTimeout> | undefined

    const refresh = () => {
      if (target === null) return
      const text = target.getAttribute(TOOLTIP_ATTR)
      if (!target.isConnected || !text) {
        hide()
        return
      }
      const r = target.getBoundingClientRect()
      const next: Shown = {
        text,
        anchor: { left: r.left, top: r.top, width: r.width, height: r.height },
        placement: readPlacement(target.getAttribute(TOOLTIP_PLACEMENT_ATTR)),
      }
      setShown((prev) => (sameShown(prev, next) ? prev : next))
    }
    const observer = new MutationObserver(refresh)

    function cancelPending() {
      clearTimeout(timer)
      pending = null
    }

    function show(el: HTMLElement, how: 'hover' | 'focus') {
      cancelPending()
      target = el
      via = how
      observer.disconnect()
      observer.observe(el, { attributes: true, attributeFilter: [TOOLTIP_ATTR, TOOLTIP_PLACEMENT_ATTR] })
      // 錨點被移出 DOM（工具列卸載）時要隱藏；只有顯示中才觀察，成本可忽略
      observer.observe(document.body, { childList: true, subtree: true })
      refresh()
    }

    function hide() {
      cancelPending()
      observer.disconnect()
      target = null
      via = null
      setShown(null)
    }

    function onPointerOver(e: PointerEvent) {
      if (e.pointerType === 'touch') return
      const el = tooltipOwner(e.target)
      if (el !== suppressed) suppressed = null
      if (el === null) {
        cancelPending()
        if (via === 'hover') hide()
        return
      }
      if (el === target || el === pending || el === suppressed) return
      cancelPending()
      // 已有提示顯示中（在同一列工具間移動）→ 直接切換，不再等 300ms
      if (target !== null) {
        show(el, 'hover')
        return
      }
      pending = el
      timer = setTimeout(() => {
        pending = null
        if (el.isConnected) show(el, 'hover')
      }, TOOLTIP_DELAY_MS)
    }

    // 仿 VS Code：按下即隱藏（例：按「⋯」開啟的面板不被提示蓋住）。
    // 滑桿例外：拖曳時提示持續顯示目前數值（「粗細 12」）
    function onPointerDown(e: PointerEvent) {
      const el = tooltipOwner(e.target)
      if (el !== null && el.getAttribute('role') === 'slider') return
      suppressed = el
      if (target !== null || pending !== null) hide()
    }

    function onPointerOut(e: PointerEvent) {
      // 指標離開視窗
      if (e.relatedTarget === null) {
        cancelPending()
        if (via === 'hover') hide()
      }
    }

    function onFocusIn(e: FocusEvent) {
      const el = e.target
      if (!(el instanceof HTMLElement) || !el.hasAttribute(TOOLTIP_ATTR)) return
      // 只有鍵盤 focus（:focus-visible）才立即顯示；滑鼠點擊造成的 focus 交給 hover 延遲
      if (isFocusVisible(el)) show(el, 'focus')
    }

    function onFocusOut(e: FocusEvent) {
      if (via === 'focus' && e.target === target) hide()
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && target !== null) hide()
    }

    document.addEventListener('pointerover', onPointerOver)
    document.addEventListener('pointerout', onPointerOut)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', refresh, true)
    window.addEventListener('resize', refresh)
    return () => {
      clearTimeout(timer)
      observer.disconnect()
      document.removeEventListener('pointerover', onPointerOver)
      document.removeEventListener('pointerout', onPointerOut)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', refresh, true)
      window.removeEventListener('resize', refresh)
    }
  }, [])

  // 量測浮層尺寸後定位（paint 前完成，不會閃一下在左上角）；直接寫 DOM style，不再觸發 render
  useLayoutEffect(() => {
    const box = boxRef.current
    if (box === null || shown === null) return
    const pos = placeFloating(
      shown.anchor,
      { width: box.offsetWidth, height: box.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      shown.placement,
    )
    box.style.left = `${pos.left}px`
    box.style.top = `${pos.top}px`
  }, [shown])

  if (shown === null) return null
  return createPortal(
    <div
      ref={boxRef}
      role="tooltip"
      className="pointer-events-none fixed top-0 left-0 z-[100] max-w-[320px] rounded-[3px] border border-border bg-quickinput px-2 py-[2px] font-mono text-[12px] leading-[18px] whitespace-nowrap text-fg shadow-quickinput"
    >
      {shown.text}
    </div>,
    document.body,
  )
}
