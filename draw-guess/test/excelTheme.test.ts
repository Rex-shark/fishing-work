// 試算表主題 token（Epic 13 Phase 1／2；plan/excel-theme.md 決策 3；DESIGN §17.1）：
// theme.css 的 [data-theme='excel'] 上段＝DESIGN §17.1 表逐字一致、下段＝[data-theme='ppt'] 的值逐字一致（§17.1「未列者與 ppt 相同」）；
// --grid-line 在 :root／ppt／meet 等於各自的 --border；--brand-sheets 在 :root；@theme inline 映射；對比（承載資訊的文字 ≥ 4.5:1）。
import { describe, expect, it } from 'vitest'

const fs = (await import('node:fs' as string)) as { readFileSync(path: URL, encoding: 'utf8'): string }
const read = (f: string) => fs.readFileSync(new URL(f, import.meta.url), 'utf8')
const themeCss = read('../src/styles/theme.css')
const design = read('../../DESIGN.md')

const ws = (v: string) => v.trim().replace(/\s+/g, ' ')

/**
 * DESIGN §17.1 的 token 表：| `--a` / `--b` | `v1` / `v2` | 用途 |（分隔可為「 / 」或「／」）。
 * 值的個數與 token 相同時逐一對應，否則同一個值套用到全部 token。值保留原文大小寫（逐字比對）
 */
function designTable(from: string, to: string): Map<string, string> {
  const section = design.slice(design.indexOf(from), design.indexOf(to))
  const map = new Map<string, string>()
  for (const m of section.matchAll(/^\| ((?:`--[\w-]+`(?: ?[/／] ?)?)+) \| ((?:`[^`]+`(?: ?[/／] ?)?)+) \|/gm)) {
    const names = [...(m[1] ?? '').matchAll(/`(--[\w-]+)`/g)].map((x) => x[1] ?? '')
    const values = [...(m[2] ?? '').matchAll(/`([^`]+)`/g)].map((x) => ws(x[1] ?? ''))
    names.forEach((n, i) => map.set(n, values.length === names.length ? (values[i] ?? '') : (values[0] ?? '')))
  }
  return map
}

/** theme.css 某個選擇器區塊內的變數（值保留原文，只整理空白） */
function cssBlock(selector: string): Map<string, string> {
  const start = themeCss.indexOf(`${selector} {`)
  expect(start, selector).toBeGreaterThan(-1)
  const block = themeCss.slice(start, themeCss.indexOf('\n}', start))
  const map = new Map<string, string>()
  for (const m of block.matchAll(/(--[\w-]+):\s*([^;]+);/g)) map.set(m[1] ?? '', ws(m[2] ?? ''))
  return map
}

function blockText(selector: string): string {
  const start = themeCss.indexOf(`${selector} {`)
  return themeCss.slice(start, themeCss.indexOf('\n}', start))
}

function luminance(hex: string): number {
  const n = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return ((x ?? 0) + 0.05) / ((y ?? 0) + 0.05)
}

const table = designTable('### 17.1', '### 17.2')
const excel = cssBlock("[data-theme='excel']")
const ppt = cssBlock("[data-theme='ppt']")
const meet = cssBlock("[data-theme='meet']")
const root = cssBlock(':root')
/** --brand-sheets 是跨主題 token（:root），其餘 §17.1 列是 excel 區塊的覆寫 */
const overrides = new Map([...table].filter(([k]) => k !== '--brand-sheets'))

describe("theme.css [data-theme='excel']（DESIGN §17.1）", () => {
  it('讀到 DESIGN §17.1 表（11 個 token，含「 / 」合併列展開）', () => {
    expect(table.size).toBe(11)
    expect(table.get('--bg-titlebar')).toBe('#217346')
    expect(table.get('--accent')).toBe('#217346')
    expect(table.get('--accent-hover')).toBe('#185C37')
    expect(table.get('--grid-line')).toBe('#E1E1E1')
    expect(table.get('--brand-sheets')).toBe('#217346')
  })

  it('上段：§17.1 覆寫的值與 DESIGN 表逐字一致', () => {
    for (const [token, value] of overrides) expect(excel.get(token), token).toBe(value)
  })

  it('下段：其餘變數＝ppt 區塊的值逐字一致（§17.1「未列者與 ppt 相同」），不多不少', () => {
    const expected = new Map([...ppt].filter(([k]) => !overrides.has(k)))
    const rest = new Map([...excel].filter(([k]) => !overrides.has(k)))
    expect(Object.fromEntries(rest)).toEqual(Object.fromEntries(expected))
    // excel 的變數集合＝ppt 的變數集合（--grid-line 兩邊都有）
    expect([...excel.keys()].sort()).toEqual([...ppt.keys()].sort())
  })

  it('淺色（color-scheme: light）；不覆寫畫布底色、卡片圖示色與頭像色', () => {
    const block = blockText("[data-theme='excel']")
    expect(block).toContain('color-scheme: light;')
    expect(block).not.toMatch(/--bg-canvas\s*:/)
    expect(block).not.toMatch(/--brand-[\w-]+\s*:/)
    expect(block).not.toMatch(/--avatar-\d\s*:|--fg-on-avatar\s*:/)
  })
})

describe('新增 token：--grid-line、--brand-sheets（DESIGN §17.1）', () => {
  it('--grid-line：:root／ppt／meet＝各自的 --border（未使用、外觀不變）', () => {
    for (const [name, block] of [
      [':root', root],
      ['ppt', ppt],
      ['meet', meet],
    ] as const) {
      expect(block.get('--grid-line'), name).toBe(block.get('--border'))
    }
  })

  it('--brand-sheets 在 :root（= DESIGN 值），各主題不覆寫', () => {
    expect(root.get('--brand-sheets')?.toLowerCase()).toBe(table.get('--brand-sheets')?.toLowerCase())
    for (const block of [ppt, meet, excel]) expect(block.has('--brand-sheets')).toBe(false)
  })

  it('@theme inline 映射成 Tailwind class（border-grid-line、text-brand-sheets）', () => {
    expect(themeCss).toContain('--color-grid-line: var(--grid-line);')
    expect(themeCss).toContain('--color-brand-sheets: var(--brand-sheets);')
  })

  it('格線 utility（sheet-grid／sheet-grid-rows）只用 --grid-line，列高 20px、欄寬 64px', () => {
    const grid = /@utility sheet-grid \{([^}]*)\}/.exec(themeCss)?.[1] ?? ''
    const rows = /@utility sheet-grid-rows \{([^}]*)\}/.exec(themeCss)?.[1] ?? ''
    expect(grid).toContain('transparent 19px, var(--grid-line) 19px')
    expect(grid).toContain('transparent 63px, var(--grid-line) 63px')
    expect(grid).toContain('background-size: 64px 20px;')
    expect(rows).toContain('background-size: 100% 20px;')
    expect(grid + rows).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })
})

describe('excel 對比（DESIGN §17.1 實算值；承載資訊的文字 ≥ 4.5:1，值讀 theme.css）', () => {
  const v = (name: string) => excel.get(name) ?? root.get(name) ?? ''

  it.each([
    // 標題列白字、主要按鈕
    ['--fg-statusbar', '--bg-titlebar'],
    ['--fg-statusbar', '--accent'],
    ['--fg-statusbar', '--accent-hover'],
    // 工作表、人員表格
    ['--fg', '--bg-editor'],
    ['--fg-muted', '--bg-editor'],
    ['--fg', '--bg-active'],
    ['--fg-on-active', '--bg-active'],
    ['--sem-function', '--bg-active'],
    ['--sem-function', '--bg-editor'],
    ['--sem-type', '--bg-editor'],
    // 欄名列、列號欄、狀態列、功能區群組名稱
    ['--fg-muted', '--bg-sidebar'],
    ['--fg', '--bg-sidebar'],
    ['--fg', '--bg-statusbar'],
    // 作用分頁、「工作表1」、關聯式分頁
    ['--accent', '--bg-tab-active'],
    ['--accent', '--bg-active'],
    // 註解窗格（揭曉題目）與卡片
    ['--sem-string', '--bg-sidebar'],
    ['--sem-string', '--bg-card'],
    ['--fg', '--bg-selection'],
  ])('%s 在 %s 上 ≥ 4.5:1', (fg, bg) => {
    expect(contrast(v(fg), v(bg))).toBeGreaterThanOrEqual(4.5)
  })

  it('DESIGN §17.1 寫的實算值與計算一致（標題列白字 5.8:1、畫師標記在畫師列 4.7:1）', () => {
    const section = design.slice(design.indexOf('### 17.1'), design.indexOf('### 17.2'))
    expect(section).toContain(`白字 ${contrast(v('--fg-statusbar'), v('--bg-titlebar')).toFixed(1)}:1`)
    expect(section).toContain(`畫師列 \`--bg-active\` 底 ${contrast(v('--sem-function'), v('--bg-active')).toFixed(1)}:1`)
  })

  it('斷線字（名稱、「離線」）用 --fg-muted：白底 6.5:1、畫師列 --bg-active 底 5.2:1（DESIGN §17.3，2026-10-06 定案；--fg-dim 只有 3.5:1 不採用）', () => {
    expect(contrast(v('--fg-muted'), v('--bg-editor')).toFixed(1)).toBe('6.5')
    expect(contrast(v('--fg-muted'), v('--bg-active')).toFixed(1)).toBe('5.2')
    expect(contrast(v('--fg-dim'), v('--bg-editor'))).toBeLessThan(4.5)
    expect(design.slice(design.indexOf('### 17.3'), design.indexOf('### 17.4'))).toContain('斷線「離線」`--fg-muted`')
  })

  it('--brand-sheets 圖示在白底、首頁底與最暗紙面上 ≥ 3:1（圖形）', () => {
    const home = cssBlock("[data-theme='home']")
    for (const bg of ['#ffffff', home.get('--home-bg') ?? '', home.get('--home-bg-shade') ?? '']) {
      expect(contrast(v('--brand-sheets'), bg), bg).toBeGreaterThanOrEqual(3)
    }
  })
})
