// 首頁（Epic 4 Phase 2；plan/home-page.md 決策 1、5、6、10；DESIGN §14）：
// theme.css 的 --home-* 與 DESIGN §14.2 一致、承載資訊的文字對比 ≥ 4.5:1、首頁元件只用 home-* class、index.html 防閃爍內嵌腳本的規則與鍵名。
import { describe, expect, it, vi } from 'vitest'
import { SHELL_STORAGE_KEY } from '../src/layout/uiStore'
import { SHELLS, getShell } from '../src/shells'
import { initialDocumentTheme } from '../src/shells/document'

const fs = (await import('node:fs' as string)) as { readFileSync(path: URL, encoding: 'utf8'): string }
const read = (f: string) => fs.readFileSync(new URL(f, import.meta.url), 'utf8')
const themeCss = read('../src/styles/theme.css')
const design = read('../../DESIGN.md')
const indexHtml = read('../index.html')
const homeSources = import.meta.glob<string>('../src/home/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })

// socket/client 需要 location 才能載入（io 的相對網址）；只為了取匯出的 SESSION_KEY
vi.stubGlobal('location', { protocol: 'http:', host: 'localhost', hostname: 'localhost', port: '', href: 'http://localhost/draw-guess/' })
const { SESSION_KEY } = await import('../src/socket/client')
vi.unstubAllGlobals()

const norm = (v: string) => v.trim().replace(/\s+/g, ' ').toLowerCase()

/** DESIGN §14.2 表格：| `--home-x` | `值` | */
function designTokens(): Map<string, string> {
  const section = design.slice(design.indexOf('### 14.2'), design.indexOf('### 14.3'))
  const map = new Map<string, string>()
  for (const m of section.matchAll(/^\| `(--(?:home-[\w-]+|font-home))` \| `([^`]+)` \|/gm)) map.set(m[1] ?? '', norm(m[2] ?? ''))
  return map
}

/** theme.css 的 [data-theme='home'] { … } 區塊 */
function cssTokens(): Map<string, string> {
  const start = themeCss.indexOf("[data-theme='home'] {")
  const block = themeCss.slice(start, themeCss.indexOf('}', start))
  const map = new Map<string, string>()
  for (const m of block.matchAll(/(--(?:home-[\w-]+|font-home)):\s*([^;]+);/g)) map.set(m[1] ?? '', norm(m[2] ?? ''))
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

describe('theme.css 首頁 token（DESIGN §14.2）', () => {
  const design = designTokens()
  const css = cssTokens()

  it('讀到 DESIGN §14.2 的 19 個 token', () => {
    expect(design.size).toBe(19)
    expect(design.get('--home-bg')).toBe('#f4f5fa')
  })

  it('[data-theme=home] 的值與 DESIGN §14.2 完全一致（不自訂值、不多不少）', () => {
    expect(Object.fromEntries(css)).toEqual(Object.fromEntries(design))
  })

  it('color-scheme: light；不重用殼層 token（區塊內只有 --home-* 與 --font-home）', () => {
    const start = themeCss.indexOf("[data-theme='home'] {")
    const block = themeCss.slice(start, themeCss.indexOf('}', start))
    expect(block).toContain('color-scheme: light;')
    const names = [...block.matchAll(/(--[\w-]+):/g)].map((m) => m[1])
    expect(names.every((n) => /^--(?:home-|font-home$)/.test(n ?? ''))).toBe(true)
    expect(block).not.toMatch(/var\(--(?!home-)/)
  })

  it('@theme inline 映射成 home-* class（色、陰影、圓角）', () => {
    for (const t of ['bg', 'surface', 'surface-hover', 'fg', 'fg-muted', 'fg-dim', 'border', 'accent', 'accent-hover', 'accent-soft', 'on-accent', 'error', 'ok']) {
      expect(themeCss).toContain(`--color-home-${t}: var(--home-${t});`)
    }
    expect(themeCss).toContain('--shadow-home: var(--home-shadow);')
    expect(themeCss).toContain('--shadow-home-hover: var(--home-shadow-hover);')
    expect(themeCss).toContain('--radius-home: var(--home-radius);')
    expect(themeCss).toMatch(/@utility home-icon-disc \{\s*background-color: color-mix\(in srgb, currentColor 12%, var\(--home-surface\)\);/)
  })

  it('home 下 html／body：解除 overflow hidden、底色 --home-bg（第一次繪製不是深色）、兩處柔光、字型 --font-home、根字級 16px', () => {
    const html = themeCss.slice(themeCss.indexOf("html[data-theme='home'] {"))
    const htmlBlock = html.slice(0, html.indexOf('}'))
    expect(htmlBlock).toContain('overflow: auto;')
    expect(htmlBlock).toContain('background: var(--home-bg);')
    expect(htmlBlock).toContain('font-size: 16px;')
    const body = themeCss.slice(themeCss.indexOf("html[data-theme='home'] body {"))
    const bodyBlock = body.slice(0, body.indexOf('}'))
    expect(bodyBlock).toContain('overflow: visible;')
    expect(bodyBlock).toMatch(/radial-gradient\([^)]*at 0 0, var\(--home-tint-1\), transparent\)/)
    expect(bodyBlock).toMatch(/radial-gradient\([^)]*at 100% 100%, var\(--home-tint-2\), transparent\)/)
    expect(bodyBlock).toContain('var(--home-bg);')
    expect(bodyBlock).toContain('font-family: var(--font-home);')
  })
})

describe('首頁對比（DESIGN §14.4：承載資訊的文字 ≥ 4.5:1，值讀 theme.css）', () => {
  const t = cssTokens()
  const v = (name: string) => t.get(`--home-${name}`) ?? ''

  it.each([
    ['fg', 'surface'],
    ['fg', 'bg'],
    ['fg', 'surface-hover'],
    ['fg', 'accent-soft'],
    ['fg', 'tint-1'],
    ['fg', 'tint-2'],
    ['fg-muted', 'bg'],
    ['fg-muted', 'surface'],
    ['fg-muted', 'surface-hover'],
    ['fg-muted', 'accent-soft'],
    ['fg-muted', 'tint-1'],
    ['fg-muted', 'tint-2'],
    ['on-accent', 'accent'],
    ['on-accent', 'accent-hover'],
    ['error', 'surface'],
    ['error', 'bg'],
  ])('%s 在 %s 上 ≥ 4.5:1', (fg, bg) => {
    expect(contrast(v(fg), v(bg))).toBeGreaterThanOrEqual(4.5)
  })

  it('已連線圓點（圖形）--home-ok 在頁面底 ≥ 3:1', () => {
    expect(contrast(v('ok'), v('bg'))).toBeGreaterThanOrEqual(3)
  })

  it('錯誤字在 --home-tint-1 上不足 4.5:1 → 左上柔光的垂直半徑必須小於錯誤列的最小位置（約 222px），錯誤字只落在純 --home-bg 上', () => {
    expect(contrast(v('error'), v('tint-1'))).toBeLessThan(4.5)
    const m = themeCss.match(/radial-gradient\(ellipse (\d+)px (\d+)px at 0 0, var\(--home-tint-1\)/)
    expect(m).not.toBeNull()
    expect(Number(m?.[2])).toBeLessThanOrEqual(200)
  })
})

describe('首頁元件只用 home-* class（不重用殼層 token）', () => {
  /** 色彩／外框相關的 utility：值必須是 home-* 或非色彩值（尺寸、inset、offset、方向） */
  const COLORISH = /(?:^|[\s:'"`])(bg|text|border|ring|outline|shadow|fill|stroke|divide|caret|accent|decoration|from|to|via)-([a-z[][\w\-[\].%#()]*)/g
  const ALLOWED = /^(home(?:-|$)|\[\d|\d|inset$|offset-|none$|left$|center$|right$|current$)/

  it('掃描到首頁原始碼', () => {
    expect(Object.keys(homeSources).length).toBeGreaterThanOrEqual(3)
  })

  it('色彩 class 皆為 home-*（例如 text-home-fg、bg-home-accent）', () => {
    for (const [file, src] of Object.entries(homeSources)) {
      const code = src.replace(/^\s*\/\/.*$/gm, '')
      const bad = [...code.matchAll(COLORISH)].map((m) => `${m[1]}-${m[2]}`).filter((c) => !ALLOWED.test(c.slice(c.indexOf('-') + 1)))
      expect(bad, file).toEqual([])
    }
  })

  it('規則抓得到殼層 token（正向對照）', () => {
    const sample = 'className="bg-accent text-fg border-border ring-border-focus text-home-fg"'
    const bad = [...sample.matchAll(COLORISH)].map((m) => `${m[1]}-${m[2]}`).filter((c) => !ALLOWED.test(c.slice(c.indexOf('-') + 1)))
    expect(bad).toEqual(['bg-accent', 'text-fg', 'border-border', 'ring-border-focus'])
  })
})

describe('index.html 防閃爍內嵌腳本（舵手定案：只設 data-theme）', () => {
  const head = indexHtml.slice(indexHtml.indexOf('<head>'), indexHtml.indexOf('</head>'))
  const script = head.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? ''

  it('靜態 title 為「fishing-work」（首頁訪客分頁標題從不出現偽裝字樣）', () => {
    expect(head).toContain('<title>fishing-work</title>')
    expect(indexHtml).not.toMatch(/canvas\.ts|PowerPoint/)
  })

  it('在 <head> 最前面（僅次於 meta charset）、CSS 與其他資源之前；不超過十行、不 import 模組', () => {
    expect(script).not.toBe('')
    const firstTags = [...head.matchAll(/<(meta|script|link|title)\b/g)].map((m) => m[1])
    expect(firstTags.slice(0, 2)).toEqual(['meta', 'script'])
    expect(head.indexOf('<script>')).toBeLessThan(head.indexOf('<link'))
    expect(script.split('\n').filter((l) => l.trim() !== '').length).toBeLessThanOrEqual(10)
    expect(script).not.toMatch(/\bimport\b|type="module"/)
    expect(head).toMatch(/<script>\s/) // 不是 module、不是外部檔
  })

  it('鍵名與 socket/client 的 SESSION_KEY、uiStore 的 SHELL_STORAGE_KEY 一致（鍵名改了這裡就失敗）', () => {
    expect(SESSION_KEY).toBe('fishing-work:draw-guess:session')
    expect(script).toContain(`'${SESSION_KEY}'`)
    expect(script).toContain(`'${SHELL_STORAGE_KEY}'`)
  })

  type Store = Record<string, string>
  /** 以假的 storage／document 執行內嵌腳本，回傳設定的 data-theme */
  function run(session: Store | 'throw', local: Store | 'throw' = {}): string | undefined {
    const storage = (s: Store | 'throw') => ({
      getItem: (k: string) => {
        if (s === 'throw') throw new Error('blocked')
        return s[k] ?? null
      },
    })
    let theme: string | undefined
    const doc = { documentElement: { setAttribute: (n: string, v: string) => void (n === 'data-theme' && (theme = v)) } }
    new Function('sessionStorage', 'localStorage', 'document', script)(storage(session), storage(local), doc)
    return theme
  }
  const SAVED = { [SESSION_KEY]: JSON.stringify({ nickname: 'rex', token: 't' }) }

  it('沒有憑證 → home', () => {
    expect(run({})).toBe('home')
    expect(run({}, { [SHELL_STORAGE_KEY]: 'ppt' })).toBe('home')
  })

  it('有憑證 → localStorage 主題 id 原字串（沒有存過 → vscode）；未知值原樣（落回 :root，main.tsx 隨後修正）', () => {
    expect(run(SAVED, { [SHELL_STORAGE_KEY]: 'ppt' })).toBe('ppt')
    expect(run(SAVED, { [SHELL_STORAGE_KEY]: 'vscode' })).toBe('vscode')
    expect(run(SAVED)).toBe('vscode')
    expect(run(SAVED, { [SHELL_STORAGE_KEY]: 'keynote' })).toBe('keynote')
  })

  it('任何例外 → home', () => {
    expect(run('throw')).toBe('home')
    expect(run(SAVED, 'throw')).toBe('home')
  })

  it('已註冊主題與有效憑證下，結果與 main.tsx 的 initialDocumentTheme 一致', () => {
    for (const has of [false, true]) {
      for (const s of SHELLS) {
        expect(run(has ? SAVED : {}, { [SHELL_STORAGE_KEY]: s.id })).toBe(initialDocumentTheme(has, getShell(s.id)).id)
      }
    }
  })
})
