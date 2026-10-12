// 風格卡片（複製自我畫你猜；spec/song-guess/design.md：只有一張「視訊會議」卡，仍是 radiogroup、預設選取）：
// catalog 推導、卡片鍵盤純邏輯、首頁卡片（home/HomeThemeCards）的無障礙語意（靜態渲染）
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { HomeThemeCards } from '../src/home/HomeThemeCards'
import { UPCOMING_LABEL, cardKeyTarget, stepAvailable, tabStopIndex } from '../src/layout/themeCardNav'
import { useUiStore } from '../src/layout/uiStore'
import { PLANNED_THEMES, THEME_CATALOG, buildThemeCatalog } from '../src/shells/catalog'
import { meetShell } from '../src/shells/meet/definition'
import { VideoCallIcon } from '../src/shells/themeIcons'
import type { ShellId, ShellThemeOption } from '../src/shells/types'

/** 「即將推出」卡片的渲染測試用：視訊會議之後多一張假的未上線主題 */
const WITH_UPCOMING: readonly ShellThemeOption[] = [
  ...THEME_CATALOG,
  { id: 'future' as ShellId, name: '未來主題', description: '尚未推出的介面', icon: VideoCallIcon, available: false },
]

const fs = (await import('node:fs' as string)) as { readFileSync(path: URL, encoding: 'utf8'): string }
const themeCss = fs.readFileSync(new URL('../src/styles/theme.css', import.meta.url), 'utf8')

describe('THEME_CATALOG：只有「視訊會議」一張', () => {
  it('目前只註冊視訊會議（可選），沒有規劃中的主題', () => {
    expect(THEME_CATALOG.map(({ id, name, available }) => ({ id, name, available }))).toEqual([{ id: 'meet', name: '視訊會議', available: true }])
    expect(PLANNED_THEMES).toEqual([])
  })

  it('名稱、描述與圖示取自註冊表', () => {
    expect(THEME_CATALOG[0]?.icon).toBe(VideoCallIcon)
    expect(THEME_CATALOG[0]?.description).toBe(meetShell.description)
  })

  it('預設選取：uiStore 的 shellId 預設就是視訊會議', () => {
    expect(useUiStore.getState().shellId).toBe('meet')
  })

  it('buildThemeCatalog：已註冊在前、規劃中接在後面且不可選；同 id 以註冊表為準', () => {
    const Icon = () => null
    const planned = [
      { id: 'meet' as ShellId, name: '舊名', description: '舊描述', icon: Icon },
      { id: 'future' as ShellId, name: '未來主題', description: '尚未推出', icon: Icon },
    ]
    const catalog = buildThemeCatalog([meetShell], planned)
    expect(catalog.map((o) => [o.id, o.name, o.available])).toEqual([
      ['meet', '視訊會議', true],
      ['future', '未來主題', false],
    ])
  })
})

describe('圖示：自繪、顏色走跨主題 token', () => {
  it('視訊會議圖示用 text-brand-meet，不含色碼', () => {
    const icon = renderToStaticMarkup(<VideoCallIcon />)
    expect(icon).toContain('text-brand-meet')
    expect(icon).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(icon).toContain('width="40"')
  })

  it('theme.css：:root 定義 --brand-meet #1e8e3e（DESIGN §13.4）並映射成 Tailwind 色', () => {
    expect(themeCss).toMatch(/--brand-meet:\s*#1e8e3e;/i)
    expect(themeCss).toContain('--color-brand-meet: var(--brand-meet);')
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
    const html = render(WITH_UPCOMING, 'meet')
    expect(html).toContain('role="radiogroup"')
    expect(html).toContain('aria-label="介面風格"')
    expect(html.match(/role="radio"/g)).toHaveLength(WITH_UPCOMING.length)
    expect(html).toMatch(/aria-checked="true"[^>]*tabindex="0"/)
    expect(html).toMatch(/aria-checked="false" aria-disabled="true" tabindex="-1"/)
  })

  it('卡片顯示註冊表的名稱與描述；不用工具提示（DESIGN §14.4）', () => {
    const html = render(THEME_CATALOG, 'meet')
    for (const o of THEME_CATALOG) {
      expect(html).toContain(`>${o.name}<`)
      expect(html).toContain(`>${o.description}<`)
    }
    expect(html).not.toContain('data-tooltip')
  })

  it('即將推出的卡片：「即將推出」膠囊、opacity .55、cursor-default、沒有 hover 位移，不是原生 disabled', () => {
    const html = render(WITH_UPCOMING, 'meet')
    // 即將推出的卡片：以 aria-disabled 定位該張卡片
    const at = html.indexOf('aria-disabled="true"')
    const upcoming = html.slice(html.lastIndexOf('<button', at), html.indexOf('</button>', at))
    expect(upcoming).toContain(`>${UPCOMING_LABEL}</span>`)
    expect(upcoming).toMatch(/rounded-full border border-home-border[^"]*text-home-fg-dim/)
    expect(upcoming).toContain('opacity-55')
    expect(upcoming).toContain('cursor-default')
    expect(upcoming).not.toMatch(/\bhover:/)
    expect(html).not.toMatch(/\sdisabled=""/)
  })

  it('選取：accent 邊框（border ＋ inset ring，不改尺寸）＋ accent-soft 底＋右上打勾徽章（aria-hidden）；只有一張', () => {
    const html = render(THEME_CATALOG, 'meet')
    expect(html.match(/type="button"/g)).toHaveLength(THEME_CATALOG.length)
    expect(html.match(/border-home-accent bg-home-accent-soft ring-1 ring-inset ring-home-accent/g)).toHaveLength(1)
    expect(html.match(/data-check-badge=""/g)).toHaveLength(1)
    expect(html).toMatch(/data-check-badge="" aria-hidden="true"[^>]*bg-home-accent text-home-on-accent/)
    const checked = html.slice(html.indexOf('aria-checked="true"'))
    expect(checked.slice(0, checked.indexOf('</button>'))).toContain('data-check-badge')
    expect(html).toMatch(/aria-checked="true"[^>]*tabindex="0"[^>]*>[\s\S]*?視訊會議/)
  })

  it('卡片樣式：home-* token class；圖示 64px 圓形淡色底（home-icon-disc）；hover 位移只在 motion-safe；200ms 只轉場底色／邊框／陰影', () => {
    const html = render(THEME_CATALOG, 'meet')
    expect(html).toContain('rounded-home border p-5')
    expect(html).toContain('shadow-home')
    expect(html).toContain('hover:shadow-home-hover motion-safe:hover:-translate-y-0.5')
    expect(html).toContain('transition-[background-color,border-color,box-shadow] duration-200 motion-safe:transition-[background-color,border-color,box-shadow,translate]')
    expect(html).not.toMatch(/(?<!motion-safe:)hover:-translate-y/)
    expect(html.match(/width="64" height="64"[^>]*class="[^"]*home-icon-disc rounded-full p-2"/g)).toHaveLength(THEME_CATALOG.length)
    expect(html).not.toMatch(/ring-border-focus|bg-hover|opacity-50/)
  })

  it('卡片格 auto-fill minmax(220px, 1fr)、gap 16px（DESIGN §14.3；日後加主題直接多卡）', () => {
    const html = render(THEME_CATALOG, 'meet')
    expect(html).toContain('class="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4"')
    // 640px 欄寬：220×3＋16×2＝692 > 640 → 兩欄；220×2＋16＝456 ≤ 640
    expect(220 * 3 + 16 * 2).toBeGreaterThan(640)
    expect(220 * 2 + 16).toBeLessThanOrEqual(640)
  })

  it('radiogroup 可改由區塊小標標示（aria-labelledby）', () => {
    const html = renderToStaticMarkup(<HomeThemeCards options={THEME_CATALOG} value="meet" onSelect={() => {}} labelledBy="styles-title" />)
    expect(html).toContain('aria-labelledby="styles-title"')
    expect(html).not.toContain('aria-label="介面風格"')
  })

  it('註冊後（available）不再標即將推出', () => {
    const all = WITH_UPCOMING.map((o) => ({ ...o, available: true }))
    const html = render(all, 'meet')
    expect(html).not.toContain(UPCOMING_LABEL)
    expect(html).not.toContain('aria-disabled')
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1)
  })
})
