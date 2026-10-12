import { describe, expect, it } from 'vitest'
import { placeFloating, readPlacement, tip, TOOLTIP_ATTR, TOOLTIP_PLACEMENT_ATTR } from '../src/layout/tooltipPlacement'

const viewport = { width: 1280, height: 800 }
const size = { width: 60, height: 20 }

describe('tip：工具提示屬性', () => {
  it('預設只帶文字；指定方向時加 placement', () => {
    expect(tip('橡皮擦')).toEqual({ [TOOLTIP_ATTR]: '橡皮擦' })
    expect(tip('Search', 'right')).toEqual({ [TOOLTIP_ATTR]: 'Search', [TOOLTIP_PLACEMENT_ATTR]: 'right' })
  })

  it('readPlacement：未知值退回 bottom', () => {
    expect(readPlacement('right')).toBe('right')
    expect(readPlacement('top')).toBe('top')
    expect(readPlacement(null)).toBe('bottom')
    expect(readPlacement('left')).toBe('bottom')
  })
})

describe('placeFloating：浮層定位', () => {
  it('bottom：錨點下方 4px、水平置中', () => {
    const p = placeFloating({ left: 500, top: 6, width: 22, height: 22 }, size, viewport, 'bottom')
    expect(p).toEqual({ left: 481, top: 32, placement: 'bottom' })
  })

  it('bottom 放不下（狀態列在最底）→ 翻到上方', () => {
    const p = placeFloating({ left: 500, top: 778, width: 60, height: 22 }, size, viewport, 'bottom')
    expect(p).toEqual({ left: 500, top: 754, placement: 'top' })
  })

  it('top 放不下 → 翻到下方', () => {
    const p = placeFloating({ left: 500, top: 0, width: 60, height: 22 }, size, viewport, 'top')
    expect(p.placement).toBe('bottom')
    expect(p.top).toBe(26)
  })

  it('靠右邊緣時水平 clamp 在視窗內（留 4px）', () => {
    const p = placeFloating({ left: 1270, top: 6, width: 10, height: 22 }, size, viewport, 'bottom')
    expect(p.left).toBe(1280 - 4 - 60)
  })

  it('靠左邊緣時 clamp 到 4px', () => {
    const p = placeFloating({ left: 0, top: 6, width: 10, height: 22 }, size, viewport, 'bottom')
    expect(p.left).toBe(4)
  })

  it('right：錨點右側 4px、垂直置中（活動列）', () => {
    const p = placeFloating({ left: 0, top: 48, width: 48, height: 48 }, size, viewport, 'right')
    expect(p).toEqual({ left: 52, top: 62, placement: 'right' })
  })

  it('right 放不下 → 退回 bottom', () => {
    const p = placeFloating({ left: 1230, top: 100, width: 48, height: 48 }, size, viewport, 'right')
    expect(p.placement).toBe('bottom')
  })
})
