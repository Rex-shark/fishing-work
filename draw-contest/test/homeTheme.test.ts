// 首頁（Epic 4 Phase 2；plan/home-page.md 決策 1、5、6、10；DESIGN §14；Epic 10 試做 plan/home-paper.md 決策 1–7：紙張質感）：
// theme.css 的 --home-* 與 DESIGN §14.2 一致、承載資訊的文字對比 ≥ 4.5:1（頁面底以「最暗紙面」--home-bg-shade 計）、
// 紙紋與暗角的規則（內嵌 SVG、靜態、prefers-contrast: more 時拿掉）、首頁元件只用 home-* class、index.html 防閃爍內嵌腳本的規則與鍵名。
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
vi.stubGlobal('location', { protocol: 'http:', host: 'localhost', hostname: 'localhost', port: '', href: 'http://localhost/draw-contest/' })
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

/** theme.css 裡以 start 開頭的規則內容（到 end 為止；預設第一個 `}`） */
function block(start: string, end = '}'): string {
  const from = themeCss.indexOf(start)
  if (from < 0) return ''
  return themeCss.slice(from, themeCss.indexOf(end, from))
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
    expect(design.get('--home-bg')).toBe('#f8f4eb')
    // Epic 10：藍綠柔光（--home-tint-1/2）已由紙面暗角取代
    expect([...design.keys()].filter((k) => k.includes('tint'))).toEqual([])
    expect(design.has('--home-bg-shade')).toBe(true)
    expect(design.has('--home-vignette')).toBe(true)
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
    // --home-bg-shade（最暗紙面，只供對比計算）與 --home-vignette（只給 body 的暗角）不映射成 class：元件不得直接拿來上色
    expect(themeCss).not.toContain('--color-home-bg-shade')
    expect(themeCss).not.toContain('--color-home-vignette')
  })

  it('home 下 html／body：解除 overflow hidden、底色 --home-bg（第一次繪製不是深色）、字型 --font-home、根字級 16px', () => {
    const html = themeCss.slice(themeCss.indexOf("html[data-theme='home'] {"))
    const htmlBlock = html.slice(0, html.indexOf('}'))
    expect(htmlBlock).toContain('overflow: auto;')
    expect(htmlBlock).toContain('background: var(--home-bg);')
    expect(htmlBlock).toContain('font-size: 16px;')
    const body = themeCss.slice(themeCss.indexOf("html[data-theme='home'] body {"))
    const bodyBlock = body.slice(0, body.indexOf('}'))
    expect(bodyBlock).toContain('overflow: visible;')
    expect(bodyBlock).toContain('var(--home-bg);')
    expect(bodyBlock).toContain('font-family: var(--font-home);')
  })
})

describe('首頁紙張質感（Epic 10 試做；plan/home-paper.md 決策 1–4、7；DESIGN §14.3）', () => {
  const bodyBlock = block("html[data-theme='home'] body {")
  /** body 背景的各層（頂層逗號分隔；data URI 與 rgba() 內的逗號不算） */
  const layers = (bodyBlock.match(/background:\s*([\s\S]*?);\n/)?.[1] ?? '').split(/,\n\s*/)
  const paper = block('@utility home-paper {', '\n}\n')

  it('body 背景五層：暗角（中央透明、邊緣 --home-vignette）＋顆粒＋纖維＋紙漿斑駁（內嵌 SVG）＋紙色 --home-bg', () => {
    expect(layers).toHaveLength(5)
    expect(layers[0]).toMatch(/^radial-gradient\(ellipse farthest-corner at 50% \d+%, transparent \d+%, var\(--home-vignette\)\)$/)
    for (const l of layers.slice(1, 4)) {
      expect(l).toMatch(/^url\("data:image\/svg\+xml,<svg [^"]*<\/svg>"\) 0 0 \/ \d+px$/)
      expect(l).toContain("<feTurbulence type='fractalNoise'")
      expect(l).toContain("stitchTiles='stitch'")
      expect(l).toContain('<feColorMatrix')
    }
    expect(layers[4]).toBe('var(--home-bg)')
  })

  it('三層紋理各司其職：顆粒為高頻等向、纖維為非等向（x、y 頻率差一個量級以上）、斑駁為低頻；圖塊尺寸互異（不同步重複）', () => {
    const freqs = (l: string) => [...l.matchAll(/baseFrequency='([^']+)'/g)].map((m) => (m[1] ?? '').split(' ').map(Number))
    const [grain, fiber, pulp] = layers.slice(1, 4).map(freqs)
    expect(grain?.every((f) => f.length === 1 && (f[0] ?? 0) >= 0.5)).toBe(true)
    const aniso = (fiber ?? []).filter((f) => f.length === 2)
    expect(aniso.length).toBeGreaterThanOrEqual(1)
    for (const f of aniso) expect(Math.max(f[0] ?? 0, f[1] ?? 0) / Math.min(f[0] ?? 1, f[1] ?? 1)).toBeGreaterThanOrEqual(10)
    expect(pulp?.every((f) => f.length === 1 && (f[0] ?? 1) <= 0.01)).toBe(true)
    const sizes = layers.slice(1, 4).map((l) => Number(l.match(/\/ (\d+)px$/)?.[1]))
    expect(new Set(sizes).size).toBe(3)
    // SVG 的 width／height 與 background-size 一致（1:1 繪製，不縮放）
    for (const [i, l] of layers.slice(1, 4).entries()) expect(l).toContain(`width='${sizes[i]}' height='${sizes[i]}'`)
  })

  it('紙紋不下載圖檔（只有 data: URI）、靜態（無動畫、無 fixed、無 mix-blend-mode）', () => {
    // theme.css 裡所有 url(：不是內嵌 SVG（"data:image/svg+xml,…），就是 SVG 內部引用 filter 的片段（%23a）
    const urls = [...themeCss.matchAll(/url\(([^)]{0,19})/g)].map((m) => m[1] ?? '')
    expect(urls.filter((u) => u.startsWith('"data:image/svg+xml')).length).toBe(4)
    expect(urls.every((u) => u.startsWith('"data:image/svg+xml') || /^%23[a-z]$/.test(u))).toBe(true)
    for (const b of [bodyBlock, paper]) {
      expect(b).not.toMatch(/animation|background-attachment|mix-blend-mode/)
    }
  })

  it('紙卡紋理 home-paper：只設 background-image／size（底色仍由 bg-home-* 決定），用同一套顆粒＋纖維', () => {
    expect(paper).toMatch(/background-image: url\("data:image\/svg\+xml,<svg [^"]*<\/svg>"\);/)
    expect(paper).toMatch(/background-size: \d+px;/)
    expect(paper).not.toMatch(/background(-color)?:/)
    expect([...paper.matchAll(/<feTurbulence type='fractalNoise'/g)].length).toBeGreaterThanOrEqual(2)
  })

  it('卡片與暱稱輸入框掛上 home-paper', () => {
    const src = (name: string) => Object.entries(homeSources).find(([f]) => f.endsWith(name))?.[1] ?? ''
    expect(src('HomeThemeCards.tsx')).toMatch(/const CARD_BASE =\s*'home-paper /)
    expect(src('HomeScreen.tsx')).toMatch(/<input[\s\S]*?className="home-paper [^"]*bg-home-surface/)
  })

  it('prefers-contrast: more：body 只留純紙色（無紋理、無暗角），home-paper 無紋理', () => {
    expect(themeCss).toMatch(/@media \(prefers-contrast: more\) \{\s*html\[data-theme='home'\] body \{\s*background: var\(--home-bg\);\s*\}\s*\}/)
    expect(paper).toMatch(/@media \(prefers-contrast: more\) \{\s*background-image: none;\s*\}/)
  })

  it('首頁元件不寫死色碼、不放 data URI（紙紋與 token 值只在 theme.css）', () => {
    for (const [file, src] of Object.entries(homeSources)) {
      expect(src, file).not.toMatch(/#[0-9a-fA-F]{6}\b/)
      expect(src, file).not.toContain('data:')
    }
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
    ['fg', 'bg-shade'],
    ['fg-muted', 'bg'],
    ['fg-muted', 'surface'],
    ['fg-muted', 'surface-hover'],
    ['fg-muted', 'accent-soft'],
    ['fg-muted', 'bg-shade'],
    ['on-accent', 'accent'],
    ['on-accent', 'accent-hover'],
    ['error', 'surface'],
    ['error', 'bg'],
    ['error', 'bg-shade'],
  ])('%s 在 %s 上 ≥ 4.5:1', (fg, bg) => {
    expect(contrast(v(fg), v(bg))).toBeGreaterThanOrEqual(4.5)
  })

  it('已連線圓點、選取邊框與 focus 外框（圖形）在頁面底與最暗紙面皆 ≥ 3:1', () => {
    for (const fg of ['ok', 'accent']) {
      expect(contrast(v(fg), v('bg'))).toBeGreaterThanOrEqual(3)
      expect(contrast(v(fg), v('bg-shade'))).toBeGreaterThanOrEqual(3)
    }
  })

  // --home-bg-shade 是截圖實量值（紙紋最暗的 4×4 CSS px 區塊再疊上滿值暗角；DESIGN §14.3），這裡只守下限：
  // 它至少要和「純紙色疊滿值暗角」一樣暗；調高暗角或紙紋卻沒重量 --home-bg-shade 時會失敗。
  it('--home-bg-shade 不亮於「--home-bg 疊上滿值 --home-vignette」；暗角極淡（alpha ≤ 0.05）', () => {
    const m = v('vignette').match(/^rgba\((\d+), (\d+), (\d+), (0?\.\d+)\)$/)
    expect(m).not.toBeNull()
    const alpha = Number(m?.[4])
    expect(alpha).toBeGreaterThan(0)
    expect(alpha).toBeLessThanOrEqual(0.05)
    const bg = v('bg').replace('#', '')
    const mixed = [0, 2, 4]
      .map((i, c) => Math.round(parseInt(bg.slice(i, i + 2), 16) * (1 - alpha) + Number(m?.[c + 1]) * alpha))
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('')
    expect(luminance(v('bg-shade'))).toBeLessThan(luminance(mixed))
    expect(luminance(v('bg-shade'))).toBeLessThan(luminance(v('bg')))
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
    expect(SESSION_KEY).toBe('fishing-work:draw-contest:session')
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

  it('有憑證 → localStorage 主題 id 原字串（沒有存過 → ppt）；未知值原樣（落回 :root，main.tsx 隨後修正）', () => {
    expect(run(SAVED, { [SHELL_STORAGE_KEY]: 'ppt' })).toBe('ppt')
    expect(run(SAVED, { [SHELL_STORAGE_KEY]: 'vscode' })).toBe('vscode')
    expect(run(SAVED)).toBe('ppt')
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
