// 風格卡片（plan/camouflage-themes.md 決策 2、7、8；plan/home-page.md 決策 2、7、8）：catalog 推導（含 description）、卡片鍵盤純邏輯、
// 首頁卡片（home/HomeThemeCards，Epic 4 起取代 layout/ThemeCards）的無障礙語意（靜態渲染）
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { HomeThemeCards } from '../src/home/HomeThemeCards'
import { UPCOMING_LABEL, cardKeyTarget, stepAvailable, tabStopIndex } from '../src/layout/themeCardNav'
import { PLANNED_THEMES, THEME_CATALOG, buildThemeCatalog } from '../src/shells/catalog'
import { pptShell } from '../src/shells/ppt/definition'
import { CodeEditorIcon, SlidesIcon } from '../src/shells/themeIcons'
import type { ShellThemeOption } from '../src/shells/types'
import { vscodeShell } from '../src/shells/vscode/definition'

/** ppt 尚未註冊時的清單（Phase 2 狀態）：「即將推出」卡片的渲染測試用 */
const WITH_UPCOMING: readonly ShellThemeOption[] = THEME_CATALOG.map((o) => (o.id === 'ppt' ? { ...o, available: false } : o))

const fs = (await import('node:fs' as string)) as { readFileSync(path: URL, encoding: 'utf8'): string }
const themeCss = fs.readFileSync(new URL('../src/styles/theme.css', import.meta.url), 'utf8')

describe('THEME_CATALOG：已註冊可選、規劃中為「即將推出」', () => {
  it('目前：程式編輯器、簡報皆已註冊（可選；Epic 3 Phase 3 註冊 ppt）', () => {
    expect(THEME_CATALOG.map(({ id, name, available }) => ({ id, name, available }))).toEqual([
      { id: 'vscode', name: '程式編輯器', available: true },
      { id: 'ppt', name: '簡報', available: true },
    ])
  })

  it('已註冊項目的名稱、描述與圖示取自註冊表', () => {
    expect(THEME_CATALOG[0]?.icon).toBe(vscodeShell.icon)
    expect(THEME_CATALOG[1]?.icon).toBe(SlidesIcon)
    expect(THEME_CATALOG.map((o) => o.description)).toEqual([vscodeShell.description, pptShell.description])
    expect(THEME_CATALOG.map((o) => o.description)).toEqual(['深色程式編輯器，像在改程式碼', '白底簡報軟體，像在做投影片'])
  })

  it('規劃中項目也要有 description（Epic 4 決策 7），與註冊後的值一致', () => {
    for (const p of PLANNED_THEMES) expect(p.description).not.toBe('')
    expect(PLANNED_THEMES.find((p) => p.id === 'ppt')?.description).toBe(pptShell.description)
  })

  it('available 由是否已註冊推導：註冊 ppt 後自動變可選，且以註冊表的資料為準（Phase 3 不必改卡片）', () => {
    const PptIcon = () => null
    const catalog = buildThemeCatalog([vscodeShell, { id: 'ppt', name: '簡報（註冊）', description: '註冊後的描述', icon: PptIcon }], PLANNED_THEMES)
    expect(catalog.map((o) => [o.id, o.name, o.description, o.available])).toEqual([
      ['vscode', '程式編輯器', '深色程式編輯器，像在改程式碼', true],
      ['ppt', '簡報（註冊）', '註冊後的描述', true],
    ])
    expect(catalog[1]?.icon).toBe(PptIcon)
  })

  it('已註冊在前（依註冊表順序），規劃中接在後面；id 不重複', () => {
    const catalog = buildThemeCatalog([], PLANNED_THEMES)
    expect(catalog.every((o) => !o.available)).toBe(true)
    expect(catalog.map((o) => o.description)).toEqual(PLANNED_THEMES.map((p) => p.description))
    expect(new Set(THEME_CATALOG.map((o) => o.id)).size).toBe(THEME_CATALOG.length)
  })
})

describe('圖示（決策 8）：自繪、顏色走跨主題 token', () => {
  it('vscode 註冊表圖示換成自繪程式編輯器圖示', () => {
    expect(vscodeShell.icon).toBe(CodeEditorIcon)
  })

  it('圖示用 text-brand-editor／text-brand-slides，不含色碼', () => {
    const code = renderToStaticMarkup(<CodeEditorIcon />)
    const slides = renderToStaticMarkup(<SlidesIcon />)
    expect(code).toContain('text-brand-editor')
    expect(slides).toContain('text-brand-slides')
    expect(code + slides).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(code).toContain('width="40"')
  })

  it('theme.css：:root 定義 --brand-editor #3b8eea、--brand-slides #b7472a（DESIGN §13.4）並映射成 Tailwind 色', () => {
    expect(themeCss).toMatch(/--brand-editor:\s*#3b8eea;/i)
    expect(themeCss).toMatch(/--brand-slides:\s*#b7472a;/i)
    expect(themeCss).toContain('--color-brand-editor: var(--brand-editor);')
    expect(themeCss).toContain('--color-brand-slides: var(--brand-slides);')
  })
})

const opts = (...available: boolean[]) => available.map((a, i) => ({ id: `t${i}`, available: a }))

describe('卡片鍵盤（radiogroup）：移動即選取、略過不可選', () => {
  it('→／↓ 下一張、←／↑ 上一張，循環', () => {
    const o = opts(true, true, true)
    expect(cardKeyTarget(o, 0, 'ArrowRight')).toBe(1)
    expect(cardKeyTarget(o, 2, 'ArrowDown')).toBe(0)
    expect(cardKeyTarget(o, 0, 'ArrowLeft')).toBe(2)
    expect(cardKeyTarget(o, 1, 'ArrowUp')).toBe(0)
  })

  it('略過即將推出的卡片', () => {
    const o = opts(true, false, true)
    expect(cardKeyTarget(o, 0, 'ArrowRight')).toBe(2)
    expect(cardKeyTarget(o, 2, 'ArrowRight')).toBe(0)
    expect(cardKeyTarget(o, 0, 'ArrowLeft')).toBe(2)
  })

  it('只有一張可選（目前的狀態）：方向鍵停在原地', () => {
    const o = opts(true, false)
    expect(cardKeyTarget(o, 0, 'ArrowRight')).toBe(0)
    expect(cardKeyTarget(o, 0, 'ArrowLeft')).toBe(0)
    expect(stepAvailable(o, 0, 1)).toBe(0)
  })

  it('Home／End 到第一張／最後一張可選的', () => {
    const o = opts(false, true, true, false)
    expect(cardKeyTarget(o, 2, 'Home')).toBe(1)
    expect(cardKeyTarget(o, 1, 'End')).toBe(2)
    expect(cardKeyTarget(opts(false, false), 0, 'End')).toBe(0)
  })

  it('其他按鍵回 null（Enter 交給加入、Space 交給按鈕原生點擊）', () => {
    expect(cardKeyTarget(opts(true, true), 0, 'Enter')).toBeNull()
    expect(cardKeyTarget(opts(true, true), 0, ' ')).toBeNull()
    expect(cardKeyTarget(opts(true, true), 0, 'a')).toBeNull()
  })

  it('roving tabindex：選取中的卡片；選取值不可選或不在清單時為第一張可選的', () => {
    expect(tabStopIndex(opts(true, true), 't1')).toBe(1)
    expect(tabStopIndex(opts(false, true), 't0')).toBe(1)
    expect(tabStopIndex(opts(true, true), 'nope')).toBe(0)
    expect(tabStopIndex(opts(false, false), 'nope')).toBe(0)
  })
})

describe('HomeThemeCards 靜態渲染：無障礙語意（首頁，Epic 4）', () => {
  const render = (options: readonly ShellThemeOption[], value: string) =>
    renderToStaticMarkup(<HomeThemeCards options={options} value={value} onSelect={() => {}} />)

  it('radiogroup「介面風格」＋ radio、aria-checked、roving tabindex', () => {
    const html = render(WITH_UPCOMING, 'vscode')
    expect(html).toContain('role="radiogroup"')
    expect(html).toContain('aria-label="介面風格"')
    expect(html.match(/role="radio"/g)).toHaveLength(2)
    expect(html).toMatch(/aria-checked="true"[^>]*tabindex="0"/)
    expect(html).toMatch(/aria-checked="false" aria-disabled="true" tabindex="-1"/)
  })

  it('卡片顯示註冊表的名稱與描述；不用工具提示（DESIGN §14.4）', () => {
    const html = render(THEME_CATALOG, 'vscode')
    for (const o of THEME_CATALOG) {
      expect(html).toContain(`>${o.name}<`)
      expect(html).toContain(`>${o.description}<`)
    }
    expect(html).not.toContain('data-tooltip')
  })

  it('即將推出的卡片：「即將推出」膠囊、opacity .55、cursor-default、沒有 hover 位移，不是原生 disabled', () => {
    const html = render(WITH_UPCOMING, 'vscode')
    const upcoming = html.slice(html.lastIndexOf('<button'))
    expect(upcoming).toContain(`>${UPCOMING_LABEL}</span>`)
    expect(upcoming).toMatch(/rounded-full border border-home-border[^"]*text-home-fg-dim/)
    expect(upcoming).toContain('opacity-55')
    expect(upcoming).toContain('cursor-default')
    expect(upcoming).not.toMatch(/\bhover:/)
    expect(html).not.toMatch(/\sdisabled=""/)
  })

  it('選取：accent 邊框（border ＋ inset ring，不改尺寸）＋ accent-soft 底＋右上打勾徽章（aria-hidden）；只有一張', () => {
    const html = render(THEME_CATALOG, 'ppt')
    expect(html.match(/type="button"/g)).toHaveLength(THEME_CATALOG.length)
    expect(html.match(/border-home-accent bg-home-accent-soft ring-1 ring-inset ring-home-accent/g)).toHaveLength(1)
    expect(html.match(/data-check-badge=""/g)).toHaveLength(1)
    expect(html).toMatch(/data-check-badge="" aria-hidden="true"[^>]*bg-home-accent text-home-on-accent/)
    const checked = html.slice(html.indexOf('aria-checked="true"'))
    expect(checked.slice(0, checked.indexOf('</button>'))).toContain('data-check-badge')
    expect(html).toMatch(/aria-checked="true"[^>]*tabindex="0"[^>]*>[\s\S]*?簡報/)
  })

  it('卡片樣式：home-* token class；圖示 64px 圓形淡色底（home-icon-disc）；hover 位移只在 motion-safe；200ms 只轉場底色／邊框／陰影', () => {
    const html = render(THEME_CATALOG, 'vscode')
    expect(html).toContain('rounded-home border p-5')
    expect(html).toContain('shadow-home')
    expect(html).toContain('hover:shadow-home-hover motion-safe:hover:-translate-y-0.5')
    expect(html).toContain('transition-[background-color,border-color,box-shadow] duration-200 motion-safe:transition-[background-color,border-color,box-shadow,translate]')
    expect(html).not.toMatch(/(?<!motion-safe:)hover:-translate-y/)
    expect(html.match(/width="64" height="64"[^>]*class="[^"]*home-icon-disc rounded-full p-2"/g)).toHaveLength(THEME_CATALOG.length)
    expect(html).not.toMatch(/ring-border-focus|bg-hover|opacity-50/)
  })

  it('radiogroup 可改由區塊小標標示（aria-labelledby）', () => {
    const html = renderToStaticMarkup(<HomeThemeCards options={THEME_CATALOG} value="vscode" onSelect={() => {}} labelledBy="styles-title" />)
    expect(html).toContain('aria-labelledby="styles-title"')
    expect(html).not.toContain('aria-label="介面風格"')
  })

  it('註冊後（available）不再標即將推出', () => {
    const all = THEME_CATALOG.map((o) => ({ ...o, available: true }))
    const html = render(all, 'ppt')
    expect(html).not.toContain(UPCOMING_LABEL)
    expect(html).not.toContain('aria-disabled')
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1)
  })
})
