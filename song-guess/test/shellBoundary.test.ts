// 殼層與功能元件的分界（複製自我畫你猜；spec/song-guess/architecture.md §7「shellBoundary 測試沿用」）：原始碼掃描。
// 功能元件（src/features/**）、App 與首頁（src/home/**）不得出現偽裝字樣或引用特定殼層；偽裝都在 src/shells/<主題>/。
// 猜歌只有 meet 殼層：沿用我畫你猜的禁用字樣（日後加主題時規則已就位），視訊會議用語補上「分享音訊」；
// 另加：殼層不讀 store、整個 src 不得殘留另兩款遊戲專屬的事件與玩法、shared 只經子路徑匯入、客戶端不呼叫題庫 API。
import { describe, expect, it } from 'vitest'
import { SHELLS } from '../src/shells'
import { PLANNED_THEMES } from '../src/shells/catalog'
import { MEET_VIEWS } from '../src/shells/meet/meetViews'

const featureSources = import.meta.glob<string>('../src/features/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
// 遊戲說明：內容與對話框共用，殼層名稱一律來自 ShellViews
const helpSources = import.meta.glob<string>('../src/features/help/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
const appSources = import.meta.glob<string>('../src/App.tsx', { query: '?raw', import: 'default', eager: true })
const meetSources = import.meta.glob<string>('../src/shells/meet/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
// src 全部（另兩款遊戲的殘留掃描用）
const allSources = import.meta.glob<string>('../src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
// 卡片鍵盤純邏輯（首頁使用）
const themeCardSources = import.meta.glob<string>(['../src/layout/themeCardNav.ts'], { query: '?raw', import: 'default', eager: true })
// 首頁（不偽裝、在殼層之外）
const homeSources = import.meta.glob<string>('../src/home/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
// 各主題殼層（shells/<主題>/**）
const shellFolderSources = import.meta.glob<string>('../src/shells/*/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
// shells/ 底下全部（含 views、types、註冊表）
const allShellSources = import.meta.glob<string>('../src/shells/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })

/** 殼層不得讀遊戲 store（人數、局的狀態由 App 經 ShellProps 注入） */
const STORE_IMPORT = /from '(?:\.\.?\/)+store\/game'/
/** 原始碼裡所有 import 路徑（含 import type、副作用 import） */
const importPaths = (src: string) => [...src.matchAll(/(?:from|import) '([^']+)'/g)].map((m) => m[1] ?? '')

/** 偽裝字樣與版面假設（含註解） */
const FORBIDDEN: [string, RegExp][] = [
  ['EXPLORER', /EXPLORER|Explorer/],
  ['TERMINAL', /TERMINAL|Terminal/],
  ['canvas.ts', /canvas\.ts/],
  ['<暱稱>.ts 檔名格式', /\.ts`/],
  ['裝飾檔名', /README\.md|package\.json|tsconfig|FISHING-WORK/],
  ['VS Code', /VS ?Code|vscode|\bIDE\b/i],
  ['vscode 殼層元件', /IdeShell|ShellFrame|StatusBar\b|QuickInput|EditorTab|Gutter/],
  ['vscode 狀態列裝飾', /Ln 12|TypeScript|UTF-8/],
  ['IDE 用語', /分頁列|編輯區|側欄|終端機|命令面板|快速輸入|快速選單/],
  ['終端機提示符 ❯', /❯/],
  ['system 註解前綴（字串裡的 `// `）', /['"`]\/\/ /],
  ['[HH:mm] 時間戳', /\[\{formatTime|\[\$\{(?:time|formatTime)|\[\{(?:line|message|m)\.(?:time|at)\}\]/],
  ['狀態列按鈕色彩寫死在功能元件（改由 ShellViews.status 提供）', /statusbar-hover|focus-on-color|bg-statusbar/],
  // 視訊會議偽裝字樣（Meet、會議代碼、通話／分享音訊用語、參加者 tile）只在 shells/meet
  ['Meet 字樣', /\bmeet\b|Google Meet/i],
  ['會議代碼', /kqw-mzdv-ptj/],
  ['視訊會議用語', /視訊會議|通話中|分享音訊|分享畫面|尚無人分享|參加者|會議控制項|字幕列/],
  // 簡報、試算表偽裝字樣（另兩款遊戲的殼層）
  ['簡報／試算表用語', /PowerPoint|簡報1|投影片|備忘稿|活頁簿|工作表\d|- Excel/],
  // 各殼層切換偽裝的操作路徑（齒輪、⋮、「→ 切換偽裝」）只在殼層的 ShellViews.help.switchHint
  ['殼層的切換偽裝路徑（改由 ShellViews.help 提供）', /齒輪|⋮|→ 切換偽裝/],
]

/** 視訊會議字樣的正向對照：這些字樣只在 meet 殼層，掃描規則必須抓得到 */
const MEET_PATTERNS = FORBIDDEN.filter(([name]) => /Meet 字樣|會議代碼|視訊會議用語/.test(name))

const entries = Object.entries({ ...featureSources, ...appSources, ...themeCardSources, ...homeSources })

describe('功能元件、App、首頁不含偽裝字樣', () => {
  it('掃描到功能元件原始碼（player、round、reveal、stage、chat、players、help）', () => {
    const files = Object.keys(featureSources)
    expect(files.length).toBeGreaterThan(15)
    for (const folder of ['player', 'round', 'reveal', 'stage', 'chat', 'players', 'help']) {
      expect(files.some((f) => f.includes(`/features/${folder}/`)), folder).toBe(true)
    }
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

  it('視訊會議字樣的掃描規則抓得到 meet 殼層（正向對照）', () => {
    expect(MEET_PATTERNS).toHaveLength(3)
    const meet = Object.values(meetSources).join('\n')
    expect(meet).not.toBe('')
    for (const [name, pattern] of MEET_PATTERNS) expect(pattern.test(meet), name).toBe(true)
    // 功能元件若寫進這些字樣必須被抓到
    for (const bad of [
      '// 放進 Meet 的影片條',
      '<span>{name} 正在分享音訊</span>',
      "const code = 'kqw-mzdv-ptj'",
      '<h2>通話中的訊息</h2>',
      'return `按「分享音訊」出題（需 2 人以上）`',
      "const EMPTY = '尚無人分享音訊'",
    ]) {
      expect(MEET_PATTERNS.some(([, pattern]) => pattern.test(bad)), bad).toBe(true)
    }
    // 不誤判一般用語
    expect(MEET_PATTERNS.some(([, pattern]) => pattern.test('meeting 與 meetup 不是偽裝字樣；音訊、試聽、出題也不是'))).toBe(false)
  })

  it('切換偽裝路徑的掃描規則抓得到殼層的 switchHint（正向對照）', () => {
    const [, pattern] = FORBIDDEN.find(([name]) => name.startsWith('殼層的切換偽裝路徑')) ?? ['', /$^/]
    for (const hint of [MEET_VIEWS.help.switchHint, '左下角齒輪 → 切換偽裝', '檔案 → 切換偽裝']) expect(pattern.test(hint), hint).toBe(true)
    // 不誤判主題標題
    expect(pattern.test("title: '切換偽裝'")).toBe(false)
  })

  it('features/help 不寫死任何殼層的名稱（切換路徑、出題按鈕文字都由 ShellViews 代入）', () => {
    const files = Object.keys(helpSources)
    expect(files.some((f) => f.endsWith('/help/helpTopics.ts'))).toBe(true)
    expect(files.some((f) => f.endsWith('/help/HelpDialog.tsx'))).toBe(true)
    for (const f of files) expect(entries.some(([file]) => file === f), f).toBe(true)
    const names = [MEET_VIEWS.help.switchHint, MEET_VIEWS.volunteer.label]
    for (const [file, src] of Object.entries(helpSources)) {
      expect(names.filter((n) => src.includes(n)), file).toEqual([])
      expect(importPaths(src).filter((p) => /\/shells\//.test(p) && !p.endsWith('/shells/views')), file).toEqual([])
    }
  })

  it('功能元件不引用特定殼層（只可用 shells/views 抽象）', () => {
    for (const [file, src] of Object.entries(featureSources)) {
      const shellImports = importPaths(src).filter((p) => p.includes('/shells/'))
      expect(shellImports.every((p) => p.endsWith('/shells/views')), `${file}: ${shellImports.join(', ')}`).toBe(true)
    }
    // 正向對照
    expect("import { MeetStage } from '../../shells/meet/MeetStage'".includes('/shells/meet/')).toBe(true)
  })

  it('功能元件不寫死色碼（一律用 token class）', () => {
    for (const [file, src] of Object.entries({ ...featureSources, ...appSources })) expect(src, file).not.toMatch(/#[0-9a-fA-F]{6}\b|rgba?\(/)
  })
})

/**
 * 首頁不得 import 的模組：特定殼層（shells/<主題>/）、shells/views（首頁沒有 ShellViews）、
 * 工具提示（layout/Tooltip、layout/tooltipPlacement；DESIGN §14.4 首頁不用 Tooltip）。shells 底下只允許 catalog、types、themeIcons
 */
const HOME_ALLOWED_SHELL_MODULES = /\/shells\/(?:catalog|types|themeIcons)$/
function homeImportViolations(src: string): string[] {
  return importPaths(src).filter(
    (p) => (/(?:^|\/)shells(?:\/|$)/.test(p) && !HOME_ALLOWED_SHELL_MODULES.test(p)) || /(?:^|\/)layout\/(?:Tooltip|tooltipPlacement)$/.test(p),
  )
}

describe('首頁（src/home/**）與殼層的相依方向', () => {
  it('首頁不 import 特定殼層、shells/views、工具提示（只可用 shells/catalog、shells/types）', () => {
    for (const [file, src] of Object.entries(homeSources)) expect(homeImportViolations(src), file).toEqual([])
  })

  it('規則抓得到違規寫法（正向對照）', () => {
    expect(homeImportViolations("import { MeetShell } from '../shells/meet/MeetShell'")).toHaveLength(1)
    expect(homeImportViolations("import { useShellViews } from '../shells/views'")).toHaveLength(1)
    expect(homeImportViolations("import { getShell } from '../shells'")).toHaveLength(1)
    expect(homeImportViolations("import { TooltipLayer } from '../layout/Tooltip'")).toHaveLength(1)
    expect(homeImportViolations("import { tip } from '../layout/tooltipPlacement'")).toHaveLength(1)
    // 允許的寫法
    expect(homeImportViolations("import { THEME_CATALOG } from '../shells/catalog'\nimport type { ShellThemeOption } from '../shells/types'")).toEqual([])
    expect(homeImportViolations("import { useUiStore } from '../layout/uiStore'\nimport { cardKeyTarget } from '../layout/themeCardNav'")).toEqual([])
  })

  it('卡片名稱與描述只能來自註冊表：首頁原始碼不得寫死各主題的名稱與描述', () => {
    const texts = [...SHELLS, ...PLANNED_THEMES].flatMap((t) => [t.name, t.description])
    expect(texts.length).toBeGreaterThanOrEqual(2)
    for (const [file, src] of Object.entries({ ...homeSources, ...themeCardSources })) {
      expect(texts.filter((t) => src.includes(t)), file).toEqual([])
    }
    // 正向對照
    expect(texts.some((t) => "<span>{'視訊會議'}</span>".includes(t))).toBe(true)
  })

  it('首頁標題「猜歌」；不用工具提示（沒有 data-tooltip）', () => {
    const home = Object.entries(homeSources).find(([f]) => f.endsWith('/home/HomeScreen.tsx'))?.[1] ?? ''
    expect(home).toMatch(/<h1[^>]*>\s*猜歌\s*<\/h1>/)
    for (const [file, src] of Object.entries(homeSources)) expect(src, file).not.toMatch(/data-tooltip|\btip\(/)
  })
})

describe('殼層的相依方向', () => {
  it('卡片鍵盤純邏輯（layout/themeCardNav）不引用 shells', () => {
    for (const [file, src] of Object.entries(themeCardSources)) {
      expect(importPaths(src).filter((p) => p.includes('/shells')), file).toEqual([])
    }
  })

  it('只有 meet 一個主題資料夾（其他偽裝殼層不複製）', () => {
    const folders = new Set(Object.keys(shellFolderSources).map((f) => /\/shells\/([^/]+)\//.exec(f)?.[1] ?? ''))
    expect([...folders]).toEqual(['meet'])
    expect(Object.keys(shellFolderSources).length).toBeGreaterThan(5)
  })

  it('殼層不 import uiStore、catalog 與首頁（避免 uiStore／catalog → 註冊表 → 殼層 → uiStore 的循環；資料經 ShellProps.themes）', () => {
    for (const [file, src] of Object.entries(shellFolderSources)) {
      expect(importPaths(src).filter((p) => /uiStore$|\/catalog$|ThemeCards$|\/home\//.test(p)), file).toEqual([])
    }
  })

  it('shells/**（含 types、views）不 import uiStore 與說明的開關／對話框（只可用 features/help/helpTopics 的型別；開啟經 ShellProps.help）', () => {
    const bad = (src: string) => importPaths(src).filter((p) => /uiStore$|\/help\/(?:helpOpen|HelpDialog)$/.test(p))
    for (const [file, src] of Object.entries(allShellSources)) expect(bad(src), file).toEqual([])
    // 正向對照
    expect(bad("import { openHelp } from '../../features/help/helpOpen'")).toHaveLength(1)
    expect(bad("import { useUiStore } from '../../layout/uiStore'")).toHaveLength(1)
    expect(bad("import { HELP_TOPICS } from '../../features/help/helpTopics'")).toEqual([])
  })

  it('殼層不直接碰播放器與音量的狀態（features/player 的 store）：值與動作一律經 ShellViews 的 props', () => {
    const bad = (src: string) => importPaths(src).filter((p) => /\/features\/player\/(?:audioState|volume|AudioPlayer|VolumeControl)$/.test(p))
    for (const [file, src] of Object.entries(allShellSources)) expect(bad(src), file).toEqual([])
    expect(bad("import { useVolumeStore } from '../../features/player/volume'")).toHaveLength(1)
  })
})

describe('殼層不讀遊戲 store（資料一律經 ShellProps）', () => {
  it('掃描到 shells/** 全部原始碼', () => {
    expect(Object.keys(allShellSources).length).toBeGreaterThan(Object.keys(shellFolderSources).length)
    expect(Object.keys(allShellSources).some((f) => f.endsWith('/shells/views.ts'))).toBe(true)
  })

  it('shells/** 不得 import store/game 與 socket/client', () => {
    const hits = Object.entries(allShellSources)
      .filter(([, src]) => STORE_IMPORT.test(src) || importPaths(src).some((p) => /(?:^|\/)(?:store\/game|socket\/client)$/.test(p)))
      .map(([file]) => file)
    expect(hits).toEqual([])
  })

  it('規則抓得到違規寫法（正向對照）', () => {
    const bad = "import { useGameStore } from '../../store/game'\nconst online = useGameStore((s) => countConnected(s.players))"
    expect(STORE_IMPORT.test(bad)).toBe(true)
    expect(importPaths(bad)).toContain('../../store/game')
    expect(STORE_IMPORT.test("import type { ConnectionState } from '../store/game'")).toBe(true)
    // 不誤判其他 store 名稱
    expect(STORE_IMPORT.test("import { x } from '../../store/gameExtra'")).toBe(false)
  })
})

/** 另兩款遊戲專屬的事件、欄位、玩法與偏好鍵（猜歌不得殘留；說明「複製自我畫你猜」的註解不算） */
const OTHER_GAME_LEFTOVERS =
  /draw:op|chat:image|contest:|IMAGE_INVALID|isDrawer|drawerId|drawerName|topicLength|endReason|ENDED_SECONDS|ROUND_SECONDS|DRAW_SECONDS|sendDrawOp|sendImage|round:setTopic|\/draw-guess|\/draw-contest|fishing-work:draw-|畫師|畫布|交卷|canvas|data-chat-drop-zone/

describe('另兩款遊戲的殘留（spec/song-guess/architecture.md §4：只用猜歌的契約）', () => {
  it('src 全部不含另兩款遊戲專屬的事件、欄位、玩法與偏好鍵', () => {
    expect(Object.keys(allSources).length).toBeGreaterThan(40)
    for (const [file, src] of Object.entries(allSources)) expect(src.match(OTHER_GAME_LEFTOVERS)?.[0] ?? null, file).toBeNull()
  })

  it('shared 一律經子路徑 @fishing-work/shared/song-guess 匯入', () => {
    for (const [file, src] of Object.entries(allSources)) {
      expect(importPaths(src).filter((p) => p.startsWith('@fishing-work/shared') && p !== '@fishing-work/shared/song-guess'), file).toEqual([])
    }
  })

  it('本機偏好鍵都在 fishing-work:song-guess: 命名空間（shell、session、volume、hot）', () => {
    const keys = new Set(Object.values(allSources).flatMap((src) => [...src.matchAll(/'(fishing-work:[\w:-]+)'/g)].map((m) => m[1])))
    expect([...keys].sort()).toEqual(['fishing-work:song-guess:hot', 'fishing-work:song-guess:session', 'fishing-work:song-guess:shell', 'fishing-work:song-guess:volume'])
  })

  it('規則抓得到違規寫法（正向對照）', () => {
    for (const bad of ["socket.emit('draw:op', op)", 'round.drawerId', "'fishing-work:draw-guess:session'", "socket.on('contest:gallery', f)", "from '@fishing-work/shared'"]) {
      const hit = OTHER_GAME_LEFTOVERS.test(bad) || importPaths(bad).some((p) => p === '@fishing-work/shared')
      expect(hit, bad).toBe(true)
    }
  })
})
