import { describe, expect, it } from 'vitest'
import {
  CANVAS_TAB,
  PANEL_EDITOR_RESERVE,
  PANEL_MIN,
  SIDEBAR_MIN,
  clampPanelHeight,
  clampSidebarWidth,
  clampSize,
  gutterLineCount,
  isCanvasDirty,
  playerFileName,
  windowTitle,
} from '../src/shells/vscode/ideLayout'

describe('windowTitle / isCanvasDirty：作畫中加 ●（DESIGN §5 視窗標題）', () => {
  it('非作畫階段為 `canvas.ts - fishing-work`', () => {
    for (const phase of ['idle', 'choosing', 'ended'] as const) {
      expect(windowTitle(phase)).toBe('canvas.ts - fishing-work')
      expect(isCanvasDirty(phase)).toBe(false)
    }
  })

  it('作畫中前綴 `● `', () => {
    expect(windowTitle('drawing')).toBe('● canvas.ts - fishing-work')
    expect(isCanvasDirty('drawing')).toBe(true)
  })

  it('分頁名與 index.html 初始標題一致', () => {
    expect(CANVAS_TAB).toBe('canvas.ts')
  })
})

describe('playerFileName：玩家偽裝成 `<暱稱>.ts`', () => {
  it('附加 .ts，保留原暱稱（含中文、空白）', () => {
    expect(playerFileName('rex')).toBe('rex.ts')
    expect(playerFileName('小明')).toBe('小明.ts')
    expect(playerFileName('a b')).toBe('a b.ts')
  })
})

describe('gutterLineCount：假行號行數 = 高度 / 18px', () => {
  it('無條件捨去', () => {
    expect(gutterLineCount(180)).toBe(10)
    expect(gutterLineCount(197)).toBe(10)
    expect(gutterLineCount(198)).toBe(11)
  })

  it('至少 1 行；0、負值、NaN 視為 1', () => {
    expect(gutterLineCount(0)).toBe(1)
    expect(gutterLineCount(5)).toBe(1)
    expect(gutterLineCount(-100)).toBe(1)
    expect(gutterLineCount(Number.NaN)).toBe(1)
    expect(gutterLineCount(Number.POSITIVE_INFINITY)).toBe(1)
  })

  it('可指定行高；行高非正值時回 1', () => {
    expect(gutterLineCount(100, 20)).toBe(5)
    expect(gutterLineCount(100, 0)).toBe(1)
  })
})

describe('clampSize / 側欄與面板尺寸（DESIGN §5：側欄 min 180、面板 min 120）', () => {
  it('夾在 min..max 並取整', () => {
    expect(clampSize(50, 100, 200)).toBe(100)
    expect(clampSize(150.6, 100, 200)).toBe(151)
    expect(clampSize(999, 100, 200)).toBe(200)
  })

  it('max < min 時以 min 為準；非有限數回 min', () => {
    expect(clampSize(500, 100, 50)).toBe(100)
    expect(clampSize(Number.NaN, 100, 200)).toBe(100)
  })

  it('側欄：最小 180，最大視窗寬一半', () => {
    expect(clampSidebarWidth(100, 1280)).toBe(SIDEBAR_MIN)
    expect(clampSidebarWidth(300, 1280)).toBe(300)
    expect(clampSidebarWidth(900, 1280)).toBe(640)
  })

  it('面板：最小 120，編輯區至少保留 160', () => {
    expect(clampPanelHeight(50, 800)).toBe(PANEL_MIN)
    expect(clampPanelHeight(300, 800)).toBe(300)
    expect(clampPanelHeight(790, 800)).toBe(800 - PANEL_EDITOR_RESERVE)
    // 視窗很矮時仍保證面板最小高度
    expect(clampPanelHeight(200, 200)).toBe(PANEL_MIN)
  })
})
