// 工具列彈出面板的共用行為（「⋯」畫筆設定、顏色面板；DESIGN.md §6「顏色面板」、§8 窄版工具列）：
// 面板 portal 到 body、position: fixed，以 placeFloating 定位在按鈕下方；開啟後 focus 第一個滑桿；
// 點面板外（按鈕除外，按鈕自己切換開關）、視窗縮放時關閉；Esc 關閉並把 focus 還給按鈕。
import { useEffect, useLayoutEffect, type KeyboardEvent, type RefObject } from 'react'
import { placeFloating } from '../../layout/tooltipPlacement'

export function useFloatingPanel(
  open: boolean,
  close: () => void,
  buttonRef: RefObject<HTMLButtonElement | null>,
  panelRef: RefObject<HTMLDivElement | null>,
): { onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void } {
  // 定位（paint 前完成）；直接寫 DOM style，不觸發額外 render
  useLayoutEffect(() => {
    const button = buttonRef.current
    const panel = panelRef.current
    if (!open || button === null || panel === null) return
    const r = button.getBoundingClientRect()
    const pos = placeFloating(
      { left: r.left, top: r.top, width: r.width, height: r.height },
      { width: panel.offsetWidth, height: panel.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      'bottom',
    )
    panel.style.left = `${pos.left}px`
    panel.style.top = `${pos.top}px`
    // 開啟後把 focus 移到第一個滑桿，鍵盤可直接調整
    panel.querySelector<HTMLElement>('[role="slider"]')?.focus({ preventScroll: true })
  }, [open, buttonRef, panelRef])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      const t = e.target
      if (!(t instanceof Node)) return
      if (panelRef.current?.contains(t) || buttonRef.current?.contains(t)) return
      close()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('resize', close)
    }
  }, [open, close, buttonRef, panelRef])

  return {
    onKeyDown(e) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      close()
      buttonRef.current?.focus()
    },
  }
}
