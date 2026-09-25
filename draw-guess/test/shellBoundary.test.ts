// 殼層與功能元件的分界（plan/camouflage-themes.md 決策 1；plan/home-page.md 決策 7、8）：原始碼掃描。
// 功能元件（src/features/**）、App 與首頁（src/home/**）不得出現 VS Code 偽裝字樣或引用特定殼層；偽裝都在 src/shells/<主題>/。
import { describe, expect, it } from 'vitest'
import { CANVAS_BACKGROUND } from '@fishing-work/shared'
import { applyCanvasBackground } from '../src/features/canvas/canvasBackground'
import { CHAT_DROP_ZONE_ATTR } from '../src/features/chat/dropZone'
import { SHELLS } from '../src/shells'
import { PLANNED_THEMES } from '../src/shells/catalog'

const featureSources = import.meta.glob<string>('../src/features/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
const appSources = import.meta.glob<string>('../src/App.tsx', { query: '?raw', import: 'default', eager: true })
// .css 即使加 ?raw 在 Vitest 也會被 CSS 處理成空字串，改以 node:fs 讀原始文字（app 的 tsconfig 不含 Node 型別，動態 import 後自行標型別）
const fs = (await import('node:fs' as string)) as { readFileSync(path: URL, encoding: 'utf8'): string }
const themeCss = fs.readFileSync(new URL('../src/styles/theme.css', import.meta.url), 'utf8')
const vscodeSources = import.meta.glob<string>('../src/shells/vscode/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
// 卡片鍵盤純邏輯（首頁使用；Epic 3 Phase 2 起共用）
const themeCardSources = import.meta.glob<string>(['../src/layout/themeCardNav.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
})
// 首頁（Epic 4：不偽裝、在殼層之外）
const homeSources = import.meta.glob<string>('../src/home/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
// 各主題殼層（shells/<主題>/**）
const shellFolderSources = import.meta.glob<string>('../src/shells/*/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
// shells/ 底下全部（含 views、types、註冊表）
const allShellSources = import.meta.glob<string>('../src/shells/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })

/** 殼層不得讀遊戲 store（Epic 3 Phase 3 C：人數等資料由 App 經 ShellProps 注入，例如 counts） */
const STORE_IMPORT = /from '(?:\.\.?\/)+store\/game'/
/** 原始碼裡所有 import 路徑（含 import type、副作用 import） */
const importPaths = (src: string) => [...src.matchAll(/(?:from|import) '([^']+)'/g)].map((m) => m[1] ?? '')

/** VS Code 偽裝字樣與版面假設（含註解） */
const FORBIDDEN: [string, RegExp][] = [
  ['EXPLORER', /EXPLORER|Explorer/],
  ['TERMINAL', /TERMINAL|Terminal/],
  ['canvas.ts', /canvas\.ts/],
  ['<暱稱>.ts 檔名格式', /\.ts`/],
  ['裝飾檔名', /README\.md|package\.json|tsconfig|FISHING-WORK/],
  ['VS Code', /VS ?Code|vscode|\bIDE\b/i],
  ['vscode 殼層元件', /IdeShell|ShellFrame|StatusBar\b|QuickInput|EditorTab|Gutter/],
  ['vscode 狀態列裝飾', /Ln 12|TypeScript|UTF-8/],
  ['vscode 版面尺寸', /top-\[35px\]|h-\[35px\]/],
  ['IDE 用語', /分頁列|編輯區|側欄|終端機|命令面板|快速輸入|快速選單/],
  ['舊投放區屬性', /data-drop-zone="terminal"/],
  // Epic 3 Phase 3：終端機聊天外觀搬到 shells/vscode（TerminalChat、terminalFormat）
  ['終端機提示符 ❯', /❯/],
  ['system 註解前綴（字串裡的 `// `）', /['"`]\/\/ /],
  ['[HH:mm] 時間戳', /\[\{formatTime|\[\$\{(?:time|formatTime)|\[\{(?:line|message|m)\.(?:time|at)\}\]/],
  ['狀態列按鈕色彩寫死在功能元件（改由 ShellViews.status 提供）', /statusbar-hover|focus-on-color|bg-statusbar/],
  ['工具列收合斷點寫死', /min-width: ?1100px|\b1100\b/],
]

/** 終端機字樣的正向對照：這些字樣現在只在 vscode 殼層，掃描規則必須抓得到（避免規則寫錯而永遠通過） */
const TERMINAL_PATTERNS = FORBIDDEN.filter(([name]) => /❯|註解前綴|HH:mm/.test(name))

const entries = Object.entries({ ...featureSources, ...appSources, ...themeCardSources, ...homeSources })

describe('功能元件不含 VS Code 字樣與版面假設', () => {
  it('掃描到功能元件原始碼', () => {
    expect(Object.keys(featureSources).length).toBeGreaterThan(10)
    expect(Object.keys(appSources)).toHaveLength(1)
    expect(Object.keys(themeCardSources)).toHaveLength(1)
  })

  it('掃描到首頁原始碼（src/home/**：HomeScreen、HomeThemeCards、純函式）', () => {
    const files = Object.keys(homeSources)
    expect(files.some((f) => f.endsWith('/home/HomeScreen.tsx'))).toBe(true)
    expect(files.some((f) => f.endsWith('/home/HomeThemeCards.tsx'))).toBe(true)
    expect(files.length).toBeGreaterThanOrEqual(3)
    for (const f of files) expect(entries.some(([file]) => file === f), f).toBe(true)
  })

  it.each(FORBIDDEN)('不出現：%s', (_name, pattern) => {
    const hits = entries.filter(([, src]) => pattern.test(src)).map(([file]) => file)
    expect(hits).toEqual([])
  })

  it('終端機字樣的掃描規則抓得到 vscode 的聊天 renderer（正向對照）', () => {
    expect(TERMINAL_PATTERNS).toHaveLength(3)
    const terminal = Object.entries(vscodeSources)
      .filter(([f]) => /\/(TerminalChat\.tsx|terminalFormat\.ts)$/.test(f))
      .map(([, src]) => src)
      .join('\n')
    expect(terminal).not.toBe('')
    for (const [name, pattern] of TERMINAL_PATTERNS) expect(pattern.test(terminal), name).toBe(true)
    // 舊版 ChatPanel／chatFormat 的寫法也必須被抓到
    expect(TERMINAL_PATTERNS[1][1].test("return [{ tone: 'comment', text: `// ${m.text}` }]")).toBe(true)
    expect(TERMINAL_PATTERNS[2][1].test('<span className="text-fg-dim">[{formatTime(message.at)}] </span>')).toBe(true)
  })

  it('功能元件不引用特定殼層（只可用 shells/views 抽象）', () => {
    for (const [file, src] of Object.entries(featureSources)) {
      const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1])
      const shellImports = imports.filter((p) => p.includes('/shells/'))
      expect(shellImports.every((p) => p.endsWith('/shells/views')), `${file}: ${shellImports.join(', ')}`).toBe(true)
    }
  })
})

/**
 * 首頁不得 import 的模組（決策 8）：特定殼層（shells/vscode、shells/ppt 與日後的 shells/<主題>/）、shells/views（首頁沒有 ShellViews）、
 * 工具提示（layout/Tooltip、layout/tooltipPlacement；DESIGN §14.4 首頁不用 Tooltip）。shells 底下只允許 catalog、types、themeIcons
 */
const HOME_ALLOWED_SHELL_MODULES = /\/shells\/(?:catalog|types|themeIcons)$/
function homeImportViolations(src: string): string[] {
  return importPaths(src).filter(
    (p) => (/(?:^|\/)shells(?:\/|$)/.test(p) && !HOME_ALLOWED_SHELL_MODULES.test(p)) || /(?:^|\/)layout\/(?:Tooltip|tooltipPlacement)$/.test(p),
  )
}

describe('首頁（src/home/**）與殼層的相依方向（Epic 4 決策 7、8）', () => {
  it('首頁不 import 特定殼層、shells/views、工具提示（只可用 shells/catalog、shells/types）', () => {
    for (const [file, src] of Object.entries(homeSources)) expect(homeImportViolations(src), file).toEqual([])
  })

  it('規則抓得到違規寫法（正向對照）', () => {
    expect(homeImportViolations("import { VscodeShell } from '../shells/vscode/VscodeShell'")).toHaveLength(1)
    expect(homeImportViolations("import { PptDialog } from '../shells/ppt/PptDialog'")).toHaveLength(1)
    expect(homeImportViolations("import { useShellViews } from '../shells/views'")).toHaveLength(1)
    expect(homeImportViolations("import type { DialogProps } from '../shells/views'")).toHaveLength(1)
    expect(homeImportViolations("import { getShell } from '../shells'")).toHaveLength(1)
    expect(homeImportViolations("import { TooltipLayer } from '../layout/Tooltip'")).toHaveLength(1)
    expect(homeImportViolations("import { tip } from '../layout/tooltipPlacement'")).toHaveLength(1)
    // 允許的寫法
    expect(homeImportViolations("import { THEME_CATALOG } from '../shells/catalog'\nimport type { ShellThemeOption } from '../shells/types'")).toEqual([])
    expect(homeImportViolations("import { useUiStore } from '../layout/uiStore'\nimport { cardKeyTarget } from '../layout/themeCardNav'")).toEqual([])
  })

  it('偽裝字樣規則在首頁也抓得到違規寫法（正向對照）', () => {
    const bad = ["// 首頁放一個 VS Code 風格的快速輸入框", "<span>canvas.ts</span>", "const hint = 'EXPLORER'", '<p>終端機</p>']
    for (const line of bad) expect(FORBIDDEN.some(([, pattern]) => pattern.test(line)), line).toBe(true)
  })

  it('卡片名稱與描述只能來自註冊表：首頁原始碼不得寫死各主題的名稱與描述', () => {
    const texts = [...SHELLS, ...PLANNED_THEMES].flatMap((t) => [t.name, t.description])
    expect(texts.length).toBeGreaterThanOrEqual(4)
    for (const [file, src] of Object.entries({ ...homeSources, ...themeCardSources })) {
      expect(texts.filter((t) => src.includes(t)), file).toEqual([])
    }
    // 正向對照
    expect(texts.some((t) => "<span>{'程式編輯器'}</span>".includes(t))).toBe(true)
  })

  it('首頁不用工具提示（沒有 data-tooltip）', () => {
    for (const [file, src] of Object.entries(homeSources)) expect(src, file).not.toMatch(/data-tooltip|\btip\(/)
  })
})

describe('卡片鍵盤純邏輯（layout/themeCardNav）與殼層的相依方向', () => {
  it('不引用 shells（純邏輯）', () => {
    for (const [file, src] of Object.entries(themeCardSources)) {
      expect(importPaths(src).filter((p) => p.includes('/shells')), file).toEqual([])
    }
  })

  it('殼層不 import uiStore、catalog 與首頁（避免 uiStore／catalog → 註冊表 → 殼層 → uiStore 的循環；資料經 ShellProps.themes）', () => {
    expect(Object.keys(shellFolderSources).length).toBeGreaterThan(5)
    for (const [file, src] of Object.entries(shellFolderSources)) {
      const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1] ?? '')
      expect(imports.filter((p) => /uiStore$|\/catalog$|ThemeCards$|\/home\//.test(p)), file).toEqual([])
    }
  })
})

describe('殼層不讀遊戲 store（資料一律經 ShellProps）', () => {
  it('掃描到 shells/** 全部原始碼', () => {
    expect(Object.keys(allShellSources).length).toBeGreaterThan(Object.keys(shellFolderSources).length)
    expect(Object.keys(allShellSources).some((f) => f.endsWith('/shells/views.ts'))).toBe(true)
  })

  it('shells/** 不得 import store/game', () => {
    const hits = Object.entries(allShellSources)
      .filter(([, src]) => STORE_IMPORT.test(src) || importPaths(src).some((p) => /(?:^|\/)store\/game$/.test(p)))
      .map(([file]) => file)
    expect(hits).toEqual([])
  })

  it('規則抓得到舊寫法（PptShell 直接讀 useGameStore 算「投影片 N / M」）', () => {
    const old = "import { useGameStore } from '../../store/game'\nconst online = useGameStore((s) => countConnected(s.players))"
    expect(STORE_IMPORT.test(old)).toBe(true)
    expect(importPaths(old)).toContain('../../store/game')
    expect(STORE_IMPORT.test("import type { ConnectionState } from '../store/game'")).toBe(true)
    // 不誤判其他 store 名稱
    expect(STORE_IMPORT.test("import { x } from '../../store/gameExtra'")).toBe(false)
  })
})

describe('殼層契約', () => {
  it('vscode 的聊天容器帶投放區屬性（ShellProps.chat）', () => {
    expect(CHAT_DROP_ZONE_ATTR).toBe('data-chat-drop-zone')
    const frame = Object.entries(vscodeSources).find(([f]) => f.endsWith('/ShellFrame.tsx'))?.[1] ?? ''
    expect(frame).toContain(`${CHAT_DROP_ZONE_ATTR}=""`)
  })
})

describe('畫布底色（決策 6）：由 shared 常數注入，不是主題 token', () => {
  it('applyCanvasBackground 把 --bg-canvas 設為 CANVAS_BACKGROUND', () => {
    const calls: [string, string][] = []
    applyCanvasBackground({ style: { setProperty: (n: string, v: string | null) => void calls.push([n, v ?? '']) } })
    expect(calls).toEqual([['--bg-canvas', CANVAS_BACKGROUND]])
  })

  it('theme.css 不再以色碼定義 --bg-canvas，但仍映射 bg-canvas class', () => {
    expect(themeCss).not.toMatch(/--bg-canvas\s*:/)
    expect(themeCss).toContain('--color-canvas: var(--bg-canvas);')
  })
})
