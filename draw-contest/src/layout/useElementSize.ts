// 版面量測的小 hook：媒體查詢、元素高度（ResizeObserver）。
import { useCallback, useEffect, useState, useSyncExternalStore, type RefObject } from 'react'

/** CSS 媒體查詢是否成立（視窗尺寸改變時更新） */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches)
}

/** 元素的內容高度（px）；尚未掛載為 0 */
export function useElementHeight(ref: RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (el === null) return
    const observer = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height
      if (h !== undefined) setHeight(h)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return height
}
