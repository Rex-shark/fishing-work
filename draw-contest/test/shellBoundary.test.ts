// 殼層與功能元件的分界（複製自我畫你猜；spec/draw-contest/architecture.md §7「shellBoundary 測試沿用」）：原始碼掃描。
// 功能元件（src/features/**）、App 與首頁（src/home/**）不得出現偽裝字樣或引用特定殼層；偽裝都在 src/shells/<主題>/。
// 繪圖比賽只有 ppt 殼層：沿用我畫你猜的禁用字樣（日後加主題時規則已就位），正向對照改以字串樣本驗證規則本身；
// 另加：整個 src 不得殘留我畫你猜專屬的事件與玩法（draw:op、chat:image、猜題、畫師…）。
// Epic 17（比賽歷史）：features/history 不含偽裝字樣（「簡報」「檔案」等由殼層或 ShellViews.terms 給），殼層不碰歷史的 store 與 IndexedDB。
import { describe, expect, it } from 'vitest'
import { CANVAS_BACKGROUND, COMMENT_PERSONA_NAME } from '@fishing-work/shared/draw-contest'
import { applyCanvasBackground } from '../src/features/canvas/canvasBackground'
import { SHELLS } from '../src/shells'
import { PLANNED_THEMES } from '../src/shells/catalog'
import { PPT_RECENT_CLOSE, PPT_RECENT_EMPTY, PPT_RECENT_HINT, PPT_RECENT_LABEL } from '../src/shells/ppt/pptLayout'
import { PPT_VIEWS } from '../src/shells/ppt/pptViews'

const featureSources = import.meta.glob<string>('../src/features/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
// 比賽歷史（Epic 17）：存放、時序、呈現、檢視元件
const historySources = import.meta.glob<string>('../src/features/history/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
// 遊戲說明（Epic 6）：內容與對話框共用，殼層名稱一律來自 ShellViews
const helpSources = import.meta.glob<string>('../src/features/help/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
const appSources = import.meta.glob<string>('../src/App.tsx', { query: '?raw', import: 'default', eager: true })
// .css 即使加 ?raw 在 Vitest 也會被 CSS 處理成空字串，改以 node:fs 讀原始文字（app 的 tsconfig 不含 Node 型別，動態 import 後自行標型別）
const fs = (await import('node:fs' as string)) as { readFileSync(path: URL, encoding: 'utf8'): string }
const themeCss = fs.readFileSync(new URL('../src/styles/theme.css', import.meta.url), 'utf8')
const pptSources = import.meta.glob<string>('../src/shells/ppt/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
// src 全部（我畫你猜殘留掃描用）
const allSources = import.meta.glob<string>('../src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
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

/** 簡報偽裝字樣：只在 shells/ppt（與 office），功能元件不得出現 */
const PPT_PATTERN = /PowerPoint|簡報1|投影片|備忘稿/

/** ppt 的叫法（題目＝標題、交卷＝儲存）：功能元件的程式碼不得寫死，由殼層經 ShellViews.terms 與對話框 config 提供 */
const PPT_TERMS_PATTERN = /儲存|標題/

/** 去掉註解（區塊註解、JSX 註解、整行 // 註解），只留程式碼與字串 */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** 視訊會議字樣（規則沿用我畫你猜，正向對照用字串樣本） */
const MEET_PATTERNS = FORBIDDEN.filter(([name]) => /Meet 字樣|會議代碼|視訊會議用語/.test(name))

/** 終端機字樣（規則沿用我畫你猜，正向對照用字串樣本，避免規則寫錯而永遠通過） */
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

  it('終端機字樣的掃描規則抓得到違規寫法（正向對照）', () => {
    expect(TERMINAL_PATTERNS).toHaveLength(3)
    expect(TERMINAL_PATTERNS[0][1].test('<span>❯</span>')).toBe(true)
    expect(TERMINAL_PATTERNS[1][1].test("return [{ tone: 'comment', text: `// ${m.text}` }]")).toBe(true)
    expect(TERMINAL_PATTERNS[2][1].test('<span className="text-fg-dim">[{formatTime(message.at)}] </span>')).toBe(true)
  })

  it('視訊會議字樣的掃描規則抓得到違規寫法（正向對照）', () => {
    expect(MEET_PATTERNS).toHaveLength(3)
    for (const bad of ["// 放進 Meet 的影片條", "<span>{name} 正在分享畫面</span>", "const code = 'kqw-mzdv-ptj'", '<h2>通話中的訊息</h2>']) {
      expect(MEET_PATTERNS.some(([, pattern]) => pattern.test(bad)), bad).toBe(true)
    }
    expect(MEET_PATTERNS.some(([, pattern]) => pattern.test('meeting 與 meetup 不是偽裝字樣；分享圖片也不是'))).toBe(false)
  })

  it('功能元件、App、首頁不出現簡報偽裝字樣（PowerPoint、投影片、備忘稿）；規則抓得到 ppt 殼層', () => {
    for (const [file, src] of entries) expect(src, file).not.toMatch(PPT_PATTERN)
    expect(PPT_PATTERN.test(Object.values(pptSources).join('\n'))).toBe(true)
  })

  it('功能元件、App、首頁的程式碼（不含註解）不寫死 ppt 的叫法（標題、儲存）：一律經 ShellViews.terms／對話框 config（Phase 2 第二段）', () => {
    const offenders = entries.filter(([, src]) => PPT_TERMS_PATTERN.test(stripComments(src))).map(([file]) => file)
    expect(offenders).toEqual([])
    // 正向對照：規則抓得到寫死的文案，且 ppt 殼層確實提供了這些叫法
    for (const bad of ["<span>已儲存 {n}/{m}</span>", "label: '未儲存'", '`正在輸入標題…`', "title: '儲存投影片？'"]) {
      expect(PPT_TERMS_PATTERN.test(stripComments(bad)), bad).toBe(true)
    }
    expect(PPT_TERMS_PATTERN.test(stripComments('// 交卷進度「已儲存 n/m」'))).toBe(false)
    expect(PPT_TERMS_PATTERN.test(Object.values(pptSources).map(stripComments).join('\n'))).toBe(true)
  })

  it('切換偽裝路徑的掃描規則抓得到三殼層的 switchHint（正向對照；Epic 6）', () => {
    const [, pattern] = FORBIDDEN.find(([name]) => name.startsWith('殼層的切換偽裝路徑')) ?? ['', /$^/]
    for (const hint of [PPT_VIEWS.help.switchHint, '左下角齒輪 → 切換偽裝', '更多 ⋮ → 切換偽裝']) expect(pattern.test(hint), hint).toBe(true)
    // 不誤判一般的箭頭說明與主題標題
    expect(pattern.test('// 聊天室圖片：檔案 → 送出前的縮圖')).toBe(false)
    expect(pattern.test("title: '如何切換偽裝'")).toBe(false)
  })

  it('features/help 不寫死任何殼層的名稱（切換路徑、我出題按鈕文字都由 ShellViews 代入）', () => {
    const files = Object.keys(helpSources)
    expect(files.some((f) => f.endsWith('/help/helpTopics.ts'))).toBe(true)
    expect(files.some((f) => f.endsWith('/help/HelpDialog.tsx'))).toBe(true)
    for (const f of files) expect(entries.some(([file]) => file === f), f).toBe(true)
    const names = [PPT_VIEWS.help.switchHint, PPT_VIEWS.help.recentHint, PPT_VIEWS.volunteer.label, `「${PPT_VIEWS.terms.save}」`]
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
    expect(texts.length).toBeGreaterThanOrEqual(2)
    for (const [file, src] of Object.entries({ ...homeSources, ...themeCardSources })) {
      expect(texts.filter((t) => src.includes(t)), file).toEqual([])
    }
    // 正向對照
    expect(texts.some((t) => "<span>{'簡報'}</span>".includes(t))).toBe(true)
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

/** 主題資料夾（shells/<主題>/；目前只有 ppt，其餘沿用我畫你猜的名稱以防日後誤引用）；office 是 Office 系殼層共用元件，不是主題 */
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

describe('shells/office/ 與殼層之間的相依（Office 系殼層共用元件，殼層之間不互相 import）', () => {
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

  it('功能元件不出現試算表偽裝字樣（規則沿用我畫你猜）', () => {
    const pattern = /活頁簿|工作表\d|替代文字|刪除圖片|插入圖片|- Excel/
    for (const [file, src] of entries) expect(src, file).not.toMatch(pattern)
    expect(pattern.test('<span>活頁簿1 - Excel</span>')).toBe(true)
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

/** 比賽歷史的偽裝字樣（ppt：歷史＝最近的「簡報」、入口在「檔案」選單）：功能元件、App、首頁連註解都不得出現 */
const HISTORY_DISGUISE_PATTERN = /簡報|檔案/
/** 殼層不得 import 的歷史模組：store（狀態與時序）、db（IndexedDB）、檢視元件；只可用 historyDisplay 的型別 */
const historyInternals = (src: string) => importPaths(src).filter((p) => /\/history\/(?:historyStore|historyDb|HistoryView)$/.test(p))

describe('比賽歷史（Epic 17；plan/contest-history.md 決策 10）：殼層分界', () => {
  it('掃描到 features/history 的四個檔案，且都在功能元件的掃描範圍內', () => {
    const files = Object.keys(historySources).map((f) => f.replace('../src/features/history/', '')).sort()
    expect(files).toEqual(['HistoryView.tsx', 'historyDb.ts', 'historyDisplay.ts', 'historyStore.ts'])
    for (const f of Object.keys(historySources)) expect(entries.some(([file]) => file === f), f).toBe(true)
  })

  it('功能元件、App、首頁（含註解）不出現「簡報」「檔案」：入口與檢視的字樣都由殼層或 ShellViews.terms 給', () => {
    const hits = entries.filter(([, src]) => HISTORY_DISGUISE_PATTERN.test(src)).map(([file]) => file)
    expect(hits).toEqual([])
    // 正向對照：規則抓得到殼層的每一個字樣，且 ppt 殼層確實提供了它們
    for (const text of [PPT_RECENT_LABEL, PPT_RECENT_EMPTY, PPT_RECENT_CLOSE, PPT_RECENT_HINT, PPT_VIEWS.terms.recent, PPT_VIEWS.help.recentHint]) {
      expect(HISTORY_DISGUISE_PATTERN.test(text), text).toBe(true)
    }
    expect(HISTORY_DISGUISE_PATTERN.test(Object.values(pptSources).join('\n'))).toBe(true)
  })

  it('features/history 不寫死殼層的字樣（開啟最近的…、沒有最近的…、關閉…、最近的…）', () => {
    const texts = [PPT_RECENT_LABEL, PPT_RECENT_EMPTY, PPT_RECENT_CLOSE, PPT_RECENT_HINT, PPT_VIEWS.terms.recent]
    for (const [file, src] of Object.entries(historySources)) expect(texts.filter((t) => src.includes(t)), file).toEqual([])
  })

  it('features/history 只經 shells/views 取得殼層的東西（不引用特定殼層）', () => {
    for (const [file, src] of Object.entries(historySources)) {
      expect(importPaths(src).filter((p) => p.includes('/shells/') && !p.endsWith('/shells/views')), file).toEqual([])
    }
  })

  it('殼層不讀歷史的 store、不碰 IndexedDB、不直接放檢視元件：資料與動作經 ShellProps.history、畫面經插槽', () => {
    for (const [file, src] of Object.entries(allShellSources)) {
      expect(historyInternals(src), file).toEqual([])
      expect(src, file).not.toMatch(/indexedDB|IDBFactory|useHistoryStore/)
    }
    // 正向對照
    expect(historyInternals("import { useHistoryStore } from '../../features/history/historyStore'")).toHaveLength(1)
    expect(historyInternals("import { createIndexedDbHistory } from '../../features/history/historyDb'")).toHaveLength(1)
    expect(historyInternals("import { HistoryView } from '../../features/history/HistoryView'")).toHaveLength(1)
    expect(historyInternals("import type { HistoryMenuEntry } from '../features/history/historyDisplay'")).toEqual([])
  })

  it('只有 historyDb 碰 IndexedDB（其餘功能元件經它的介面，測試才能注入記憶體假實作）', () => {
    const users = Object.entries(allSources)
      .filter(([, src]) => /\bindexedDB\b|\bIDB[A-Z]\w+/.test(stripComments(src)))
      .map(([file]) => file.replace('../src/', ''))
    expect(users).toEqual(['features/history/historyDb.ts'])
  })
})

describe('殼層契約', () => {
  it('ppt 的註解窗格不是投放區（v1 不傳圖）', () => {
    for (const [file, src] of Object.entries(allShellSources)) expect(src, file).not.toContain('data-chat-drop-zone')
  })
})

/** 我畫你猜專屬的事件、欄位與玩法（繪圖比賽不得殘留；說明「複製自我畫你猜」的註解不算） */
const DRAW_GUESS_LEFTOVERS = /draw:op|chat:image|SPOILER_BLOCKED|IMAGE_INVALID|hasGuessed|isDrawer|drawerId|drawerName|topicLength|endReason|correctIds|ENDED_SECONDS|ROUND_SECONDS|sendDrawOp|sendImage|\/draw-guess|fishing-work:draw-guess|猜題|猜對|畫師/

describe('我畫你猜的殘留（spec/draw-contest/architecture.md §4：只用繪圖比賽的契約）', () => {
  it('src 全部不含我畫你猜專屬的事件、欄位、玩法與偏好鍵', () => {
    expect(Object.keys(allSources).length).toBeGreaterThan(40)
    for (const [file, src] of Object.entries(allSources)) {
      const code = src.replace(/沒有猜題(?:、防洩題、圖片|提示)/g, '')
      expect(code.match(DRAW_GUESS_LEFTOVERS)?.[0] ?? null, file).toBeNull()
    }
  })

  it('shared 一律經子路徑 @fishing-work/shared/draw-contest 匯入（決策 10）', () => {
    for (const [file, src] of Object.entries(allSources)) {
      expect(importPaths(src).filter((p) => p.startsWith('@fishing-work/shared') && p !== '@fishing-work/shared/draw-contest'), file).toEqual([])
    }
  })

  it('規則抓得到違規寫法（正向對照）', () => {
    for (const bad of ["socket.emit('draw:op', op)", 'round.drawerId', "'fishing-work:draw-guess:session'", '輸入答案或聊天，猜對得分', "from '@fishing-work/shared'"]) {
      const hit = DRAW_GUESS_LEFTOVERS.test(bad) || importPaths(bad).some((p) => p === '@fishing-work/shared')
      expect(hit, bad).toBe(true)
    }
  })
})

describe('評審名稱（Epic 15）：唯一來源是 shared 的 COMMENT_PERSONA_NAME', () => {
  it('src 全部不寫死評審名稱（含註解）；揭曉卡片與說明都從 shared 匯入', () => {
    for (const [file, src] of Object.entries(allSources)) expect(src.includes(COMMENT_PERSONA_NAME), file).toBe(false)
    const users = Object.entries(allSources)
      .filter(([, src]) => /\bCOMMENT_PERSONA_NAME\b/.test(stripComments(src)))
      .map(([file]) => file.replace('../src/', ''))
      .sort()
    expect(users).toEqual(['features/help/helpTopics.ts', 'features/reveal/Reveal.tsx', 'features/reveal/revealView.ts'])
  })

  it('功能元件的評語行不用殼層的偽裝字樣當前綴（design §3：前綴用評審名稱）', () => {
    const reveal = Object.entries(featureSources).filter(([file]) => file.includes('/features/reveal/'))
    expect(reveal).toHaveLength(2)
    for (const [file, src] of reveal) expect(stripComments(src), file).not.toMatch(/註解/)
    // 正向對照
    expect(/註解/.test(stripComments("<span>註解：{comment.text}</span>"))).toBe(true)
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
