// 殼層與功能元件的分界（plan/camouflage-themes.md 決策 1；plan/home-page.md 決策 7、8）：原始碼掃描。
// 功能元件（src/features/**）、App 與首頁（src/home/**）不得出現 VS Code 偽裝字樣或引用特定殼層；偽裝都在 src/shells/<主題>/。
import { describe, expect, it } from 'vitest'
import { CANVAS_BACKGROUND } from '@fishing-work/shared'
import { applyCanvasBackground } from '../src/features/canvas/canvasBackground'
import { CHAT_DROP_ZONE_ATTR } from '../src/features/chat/dropZone'
import { SHELLS } from '../src/shells'
import { PLANNED_THEMES } from '../src/shells/catalog'
import { EXCEL_VIEWS } from '../src/shells/excel/excelViews'
import { MEET_VIEWS } from '../src/shells/meet/meetViews'
import { PPT_VIEWS } from '../src/shells/ppt/pptViews'
import { resolveHelpView, resolveVolunteerView } from '../src/shells/views'

const featureSources = import.meta.glob<string>('../src/features/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
// 遊戲說明（Epic 6）：內容與對話框共用，殼層名稱一律來自 ShellViews
const helpSources = import.meta.glob<string>('../src/features/help/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
const appSources = import.meta.glob<string>('../src/App.tsx', { query: '?raw', import: 'default', eager: true })
// .css 即使加 ?raw 在 Vitest 也會被 CSS 處理成空字串，改以 node:fs 讀原始文字（app 的 tsconfig 不含 Node 型別，動態 import 後自行標型別）
const fs = (await import('node:fs' as string)) as { readFileSync(path: URL, encoding: 'utf8'): string }
const themeCss = fs.readFileSync(new URL('../src/styles/theme.css', import.meta.url), 'utf8')
const vscodeSources = import.meta.glob<string>('../src/shells/vscode/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
const meetSources = import.meta.glob<string>('../src/shells/meet/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
const excelFolderSources = import.meta.glob<string>('../src/shells/excel/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
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
  ['工具列收合斷點寫死', /min-width: ?11[02]0px|\b11[02]0\b/],
  // Epic 5：視訊會議偽裝字樣（Meet、會議代碼、通話／分享畫面用語、參加者 tile）只在 shells/meet
  ['Meet 字樣', /\bmeet\b|Google Meet/i],
  ['會議代碼', /kqw-mzdv-ptj/],
  ['視訊會議用語', /視訊會議|通話中|正在分享畫面|分享畫面|尚無人分享|參加者|會議控制項|字幕列/],
  // Epic 6：各殼層切換偽裝的操作路徑（齒輪、⋮、「→ 切換偽裝」）只在殼層的 ShellViews.help.switchHint
  ['殼層的切換偽裝路徑（改由 ShellViews.help 提供）', /齒輪|⋮|→ 切換偽裝/],
]

/** 視訊會議字樣的正向對照（Epic 5）：這些字樣只在 meet 殼層，掃描規則必須抓得到 */
const MEET_PATTERNS = FORBIDDEN.filter(([name]) => /Meet 字樣|會議代碼|視訊會議用語/.test(name))

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

  it('視訊會議字樣的掃描規則抓得到 meet 殼層（正向對照；Epic 5）', () => {
    expect(MEET_PATTERNS).toHaveLength(3)
    const meet = Object.values(meetSources).join('\n')
    expect(meet).not.toBe('')
    for (const [name, pattern] of MEET_PATTERNS) expect(pattern.test(meet), name).toBe(true)
    // 功能元件若寫進這些字樣必須被抓到
    for (const bad of ["// 放進 Meet 的影片條", "<span>{name} 正在分享畫面</span>", "const code = 'kqw-mzdv-ptj'", '<h2>通話中的訊息</h2>']) {
      expect(MEET_PATTERNS.some(([, pattern]) => pattern.test(bad)), bad).toBe(true)
    }
    // 不誤判一般用語
    expect(MEET_PATTERNS.some(([, pattern]) => pattern.test('meeting 與 meetup 不是偽裝字樣；分享圖片也不是'))).toBe(false)
  })

  it('切換偽裝路徑的掃描規則抓得到三殼層的 switchHint（正向對照；Epic 6）', () => {
    const [, pattern] = FORBIDDEN.find(([name]) => name.startsWith('殼層的切換偽裝路徑')) ?? ['', /$^/]
    for (const hint of ['左下角齒輪 → 切換偽裝', '檔案 → 切換偽裝', '更多 ⋮ → 切換偽裝']) expect(pattern.test(hint), hint).toBe(true)
    // 不誤判一般的箭頭說明與主題標題
    expect(pattern.test('// 聊天室圖片：檔案 → 送出前的縮圖')).toBe(false)
    expect(pattern.test("title: '如何切換偽裝'")).toBe(false)
  })

  it('features/help 不寫死任何殼層的名稱（切換路徑、我來畫按鈕文字都由 ShellViews 代入）', () => {
    const files = Object.keys(helpSources)
    expect(files.some((f) => f.endsWith('/help/helpTopics.ts'))).toBe(true)
    expect(files.some((f) => f.endsWith('/help/HelpDialog.tsx'))).toBe(true)
    for (const f of files) expect(entries.some(([file]) => file === f), f).toBe(true)
    const names = [null, PPT_VIEWS, MEET_VIEWS, EXCEL_VIEWS].flatMap((v) => [resolveHelpView(v).switchHint, resolveVolunteerView(v).label])
    // excel 與 ppt 的切換路徑相同（「檔案 → 切換偽裝」，Epic 13）：8 個名稱、7 種
    expect(new Set(names).size).toBe(7)
    for (const [file, src] of Object.entries(helpSources)) {
      expect(names.filter((n) => src.includes(n)), file).toEqual([])
      expect(importPaths(src).filter((p) => /\/shells\//.test(p) && !p.endsWith('/shells/views')), file).toEqual([])
    }
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

  it('shells/**（含 types、views）不 import uiStore 與說明的開關／對話框（Epic 6：只可用 features/help/helpTopics 的資料與型別；開啟經 ShellProps.help）', () => {
    const bad = (src: string) => importPaths(src).filter((p) => /uiStore$|\/help\/(?:helpOpen|HelpDialog)$/.test(p))
    for (const [file, src] of Object.entries(allShellSources)) expect(bad(src), file).toEqual([])
    // 正向對照
    expect(bad("import { openHelp } from '../../features/help/helpOpen'")).toHaveLength(1)
    expect(bad("import { HelpDialog } from '../features/help/HelpDialog'")).toHaveLength(1)
    expect(bad("import { useUiStore } from '../../layout/uiStore'")).toHaveLength(1)
    expect(bad("import { HELP_TOPICS } from '../../features/help/helpTopics'")).toEqual([])
  })
})

/** 主題資料夾（shells/<主題>/）；office 是 ppt 與 excel 共用的 Office 元件（Epic 13 決策 4），不是主題 */
const THEME_FOLDERS = ['vscode', 'ppt', 'meet', 'excel'] as const
/** 原始碼路徑 → 所在資料夾（shells/<資料夾>/…） */
const folderOf = (file: string) => /\/shells\/([^/]+)\//.exec(file)?.[1] ?? ''
/** 引用了別的主題資料夾（../<主題>/…）的 import 路徑；shells/office/ 一律不得引用任何主題資料夾 */
function crossShellImports(file: string, src: string): string[] {
  const own = folderOf(file)
  return importPaths(src).filter((p) => {
    const m = /^\.\.\/([^/]+)\//.exec(p)
    return m !== null && (THEME_FOLDERS as readonly string[]).includes(m[1] ?? '') && m[1] !== own
  })
}

describe('shells/office/ 與殼層之間的相依（Epic 13 決策 4：ppt、excel 共用 Office 元件，殼層之間不互相 import）', () => {
  it('shells/office/** 掃描得到，且納入殼層規則（不 import uiStore／catalog／首頁／store，見上下各組）', () => {
    const office = Object.keys(shellFolderSources).filter((f) => folderOf(f) === 'office')
    expect(office.length).toBeGreaterThanOrEqual(5)
    for (const f of office) expect(Object.keys(allShellSources)).toContain(f)
  })

  it('主題資料夾之間不互相 import；office 不 import 任何主題資料夾', () => {
    for (const [file, src] of Object.entries(shellFolderSources)) expect(crossShellImports(file, src), file).toEqual([])
  })

  it('規則抓得到違規寫法（正向對照）', () => {
    expect(crossShellImports('../src/shells/excel/ExcelShell.tsx', "import { PptDialog } from '../ppt/PptDialog'")).toHaveLength(1)
    expect(crossShellImports('../src/shells/office/FileMenu.tsx', "import { PPT_DIALOG_TITLE } from '../ppt/pptLayout'")).toHaveLength(1)
    expect(crossShellImports('../src/shells/excel/ExcelShell.tsx', "import { OfficeDialog } from '../office/OfficeDialog'")).toEqual([])
    expect(crossShellImports('../src/shells/ppt/PptShell.tsx', "import { tip } from '../../layout/tooltipPlacement'")).toEqual([])
  })

  it('功能元件不出現試算表偽裝字樣（Epic 13：活頁簿、工作表、替代文字、刪除／插入圖片只在殼層；「圖片格式或大小不符」是聊天錯誤訊息，不算）', () => {
    const pattern = /活頁簿|工作表\d|替代文字|刪除圖片|插入圖片|- Excel/
    for (const [file, src] of entries) expect(src, file).not.toMatch(pattern)
    // 正向對照：excel 殼層抓得到
    expect(pattern.test(Object.values(excelFolderSources).join('\n'))).toBe(true)
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
