// 視訊會議主題 token（複製自我畫你猜的測試；DESIGN §3、§13.4、§15.1；猜歌只有 meet 一套殼層，theme.css 只留 :root、meet、home）：
// theme.css 的 [data-theme='meet'] 與 DESIGN §15.1 表逐字一致、面板 token 六件組的值、--brand-meet、@theme inline 映射、對比、沒有其他主題的區塊。
import { describe, expect, it } from 'vitest'

const fs = (await import('node:fs' as string)) as { readFileSync(path: URL, encoding: 'utf8'): string }
const read = (f: string) => fs.readFileSync(new URL(f, import.meta.url), 'utf8')
const themeCss = read('../src/styles/theme.css')
const design = read('../../DESIGN.md')

const PANEL_TOKENS = ['--bg-panel', '--bg-panel-hover', '--fg-on-panel', '--fg-on-panel-muted', '--border-panel', '--accent-panel'] as const

const ws = (v: string) => v.trim().replace(/\s+/g, ' ')

/**
 * DESIGN 某一節的 token 表：| `--a`／`--b` | `v1`／`v2` | 用途 |。
 * 值的個數與 token 相同時逐一對應，否則同一個值套用到全部 token。值保留原文大小寫（逐字比對）。
 */
function designTable(from: string, to: string): Map<string, string> {
  const section = design.slice(design.indexOf(from), design.indexOf(to))
  const map = new Map<string, string>()
  for (const m of section.matchAll(/^\| ((?:`--[\w-]+`(?:／)?)+) \| ((?:`[^`]+`(?:／)?)+) \|/gm)) {
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
  const block = themeCss.slice(start, themeCss.indexOf('}', start))
  const map = new Map<string, string>()
  for (const m of block.matchAll(/(--[\w-]+):\s*([^;]+);/g)) map.set(m[1] ?? '', ws(m[2] ?? ''))
  return map
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

describe("theme.css [data-theme='meet']（DESIGN §15.1）", () => {
  const table = designTable('### 15.1', '### 15.2')
  const css = cssBlock("[data-theme='meet']")
  /** §15.1 --bg-active 列的用途欄同時定義 --fg-on-active（「`--fg-on-active` `#202124`（7.6:1）」） */
  const fgOnActive = /`--fg-on-active` `(#[0-9A-Fa-f]{6})`/.exec(design.slice(design.indexOf('### 15.1'), design.indexOf('### 15.2')))?.[1]

  it('讀到 DESIGN §15.1 表（48 個 token，含合併列展開）與 --fg-on-active', () => {
    expect(table.size).toBe(48)
    expect(table.get('--bg-editor')).toBe('#202124')
    expect(table.get('--bg-button-secondary-hover')).toBe('#5F6368')
    expect(table.get('--font-code')).toBe("system-ui, 'Segoe UI', 'Microsoft JhengHei', 'PingFang TC', sans-serif")
    expect(fgOnActive).toBe('#202124')
  })

  it('區塊的變數＝§15.1 表＋ --fg-on-active ＋ --grid-line，值逐字一致（不自訂值、不多不少）', () => {
    // --grid-line（DESIGN §17.1）：meet 不使用，值＝meet 的 --border（沿用我畫你猜的區塊，逐字不改）
    const expected = Object.fromEntries([...table, ['--fg-on-active', fgOnActive ?? ''], ['--grid-line', table.get('--border') ?? '']])
    expect(Object.fromEntries(css)).toEqual(expected)
  })

  it('深色（color-scheme: dark）；不覆寫卡片圖示色與頭像色', () => {
    const start = themeCss.indexOf("[data-theme='meet'] {")
    const block = themeCss.slice(start, themeCss.indexOf('}', start))
    expect(block).toContain('color-scheme: dark;')
    expect(block).not.toMatch(/--brand-[\w-]+\s*:/)
    expect(block).not.toMatch(/--avatar-\d\s*:|--fg-on-avatar\s*:/)
  })
})

describe('面板 token 六件組：:root（基底）與 meet 的值', () => {
  const root = cssBlock(':root')
  const meet = cssBlock("[data-theme='meet']")
  const lower = (m: Map<string, string>) => new Map([...m].map(([k, v]) => [k, v.toLowerCase()]))

  it(':root ＝ DESIGN §3 的值', () => {
    const d = designTable('## 3. 色彩 token', '## 4.')
    for (const t of PANEL_TOKENS) expect(root.get(t), t).toBe(d.get(t)?.toLowerCase())
  })

  it('theme.css 只有 :root、meet、home 三個區塊（其他偽裝主題的 token 不複製）', () => {
    expect([...themeCss.matchAll(/^\[data-theme='([\w-]+)'\] \{/gm)].map((m) => m[1])).toEqual(['meet', 'home'])
    expect(themeCss).not.toMatch(/sheet-grid/)
  })

  it(':root 的值＝側欄系統色：面板底＝側欄、hover＝hover、文字＝--fg、次要＝--fg-muted、邊框＝--border、強調＝--fg-link', () => {
    const pairs: [string, string][] = [
      ['--bg-panel', '--bg-sidebar'],
      ['--bg-panel-hover', '--bg-hover'],
      ['--fg-on-panel', '--fg'],
      ['--fg-on-panel-muted', '--fg-muted'],
      ['--border-panel', '--border'],
      ['--accent-panel', '--fg-link'],
    ]
    for (const theme of [lower(root)]) {
      for (const [panel, base] of pairs) expect(theme.get(panel), panel).toBe(theme.get(base))
    }
  })

  it('meet ＝ DESIGN §15.1 的白色面板值', () => {
    expect(PANEL_TOKENS.map((t) => meet.get(t))).toEqual(['#FFFFFF', '#F1F3F4', '#202124', '#5F6368', '#DADCE0', '#1967D2'])
  })

  it('--brand-meet（DESIGN §13.4）在 :root、各主題不覆寫', () => {
    const d = designTable('### 13.4', '## 14.')
    expect(root.get('--brand-meet')).toBe(d.get('--brand-meet')?.toLowerCase())
    expect(root.get('--brand-meet')).toBe('#1e8e3e')
    expect(meet.has('--brand-meet')).toBe(false)
  })

  it('@theme inline 映射成 Tailwind class（bg-panel、text-fg-on-panel、border-border-panel、text-accent-panel、text-brand-meet…）', () => {
    for (const line of [
      '--color-panel: var(--bg-panel);',
      '--color-panel-hover: var(--bg-panel-hover);',
      '--color-fg-on-panel: var(--fg-on-panel);',
      '--color-fg-on-panel-muted: var(--fg-on-panel-muted);',
      '--color-border-panel: var(--border-panel);',
      '--color-accent-panel: var(--accent-panel);',
      '--color-brand-meet: var(--brand-meet);',
    ]) {
      expect(themeCss).toContain(line)
    }
  })
})

describe('meet 對比（DESIGN §15.1；承載資訊的文字 ≥ 4.5:1，值讀 theme.css）', () => {
  const t = cssBlock("[data-theme='meet']")
  const root = cssBlock(':root')
  const v = (name: string) => t.get(name) ?? root.get(name) ?? ''

  it.each([
    ['--fg', '--bg-editor'],
    ['--fg', '--bg-tab-active'],
    ['--fg-muted', '--bg-editor'],
    ['--fg-on-active', '--bg-active'],
    ['--sem-warning', '--bg-editor'],
    ['--sem-warning', '--bg-tab-active'],
    ['--fg-on-panel', '--bg-panel'],
    ['--fg-on-panel', '--bg-panel-hover'],
    ['--fg-on-panel', '--bg-input'],
    ['--fg-on-panel-muted', '--bg-panel'],
    ['--fg-on-panel-muted', '--bg-input'],
    ['--accent-panel', '--bg-panel'],
    ['--accent-panel', '--bg-panel-hover'],
    ['--sem-type', '--bg-panel'],
    ['--sem-error', '--bg-panel'],
    // 工具提示、音量滑桿的浮層、「更多選項」選單（深灰 --bg-quickinput）與選單 hover
    ['--fg', '--bg-quickinput'],
    ['--fg', '--bg-button-secondary-hover'],
    // 字幕列（--bg-tab-active 90% 疊在 tile 上＝同色）
    ['--fg', '--bg-slide'],
    // 舞台：「開始播放」按鈕（--bg-active 底、--fg-on-active 字）、波形直條與前三名（--accent，圖形與大字 ≥ 3:1 即可，這裡仍要求 4.5:1）
    ['--accent', '--bg-tab-active'],
  ])('%s 在 %s 上 ≥ 4.5:1', (fg, bg) => {
    expect(contrast(v(fg), v(bg))).toBeGreaterThanOrEqual(4.5)
  })

  it('--fg-muted 在 tile（--bg-tab-active）上不到 4.5:1：tile 內承載資訊的文字一律 --fg（DESIGN §15.1 註記）', () => {
    expect(contrast(v('--fg-muted'), v('--bg-tab-active'))).toBeLessThan(4.5)
  })

  it('頭像首字（--fg-on-avatar）在六種頭像底上 ≥ 4.5:1（meet 參加者 tile 沿用）', () => {
    for (let i = 1; i <= 6; i++) expect(contrast(v('--fg-on-avatar'), v(`--avatar-${i}`)), `--avatar-${i}`).toBeGreaterThanOrEqual(4.5)
  })

  it('--brand-meet 圖示在白底與首頁底上 ≥ 3:1（圖形）', () => {
    expect(contrast(v('--brand-meet'), '#ffffff')).toBeGreaterThanOrEqual(3)
    expect(contrast(v('--brand-meet'), cssBlock("[data-theme='home']").get('--home-bg') ?? '')).toBeGreaterThanOrEqual(3)
  })
})
