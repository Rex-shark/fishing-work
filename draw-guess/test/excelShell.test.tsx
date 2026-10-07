// excel 主題（Epic 13 Phase 1／2；plan/excel-theme.md；DESIGN §17）：註冊、titleFor／favicon、版面純邏輯、ShellViews、
// 人員表格（SheetPlayers）、Office 對話框文字、ExcelShell 插槽擺放（靜態渲染）、殼層分界（不含色碼、投放區、不讀 uiStore／store）
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PlayerPublic } from '@fishing-work/shared'
import { SHELL_STORAGE_KEY, loadShellId, useUiStore, type ShellStorage } from '../src/layout/uiStore'
import { SHELLS, getShell, isRegisteredShellId, resolveShellId } from '../src/shells'
import { THEME_CATALOG } from '../src/shells/catalog'
import { applyDocumentTheme, type ShellDocument } from '../src/shells/document'
import { excelShell } from '../src/shells/excel/definition'
import { ExcelDialog, ExcelResumeDialog } from '../src/shells/excel/ExcelDialog'
import { ExcelShell } from '../src/shells/excel/ExcelShell'
import { InsertPictureIcon } from '../src/shells/excel/excelIcons'
import {
  EXCEL_APP_TITLE,
  RIBBON_TABS,
  activeRibbonTab,
  columnName,
  columnsToFill,
  countText,
  defaultRibbonTab,
  excelDialogButtonText,
  excelWindowTitle,
  formulaText,
  nameBoxText,
  rowsToFill,
  sheetNameText,
  sheetStatus,
} from '../src/shells/excel/excelLayout'
import { findHelpTopic, renderTopic } from '../src/features/help/helpTopics'
import { EXCEL_CHAT_VIEW, EXCEL_STATUS_VIEW, EXCEL_TOOLBAR_VIEW, EXCEL_VIEWS, EXCEL_VOLUNTEER_VIEW } from '../src/shells/excel/excelViews'
import { SheetPlayers } from '../src/shells/excel/SheetPlayers'
import { OfficeCommentLine } from '../src/shells/office/CommentChat'
import { PPT_STATUS_VIEW } from '../src/shells/ppt/pptViews'
import { SheetsIcon } from '../src/shells/themeIcons'
import type { ShellProps } from '../src/shells/types'
import type { ChatInputProps, DialogProps, PlayerRowData } from '../src/shells/views'

const fs = (await import('node:fs' as string)) as {
  readFileSync(path: URL, encoding: 'utf8'): string
  existsSync(path: URL): boolean
}
const excelSources = import.meta.glob<string>('../src/shells/excel/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
const officeSources = import.meta.glob<string>('../src/shells/office/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })

afterEach(() => {
  vi.unstubAllGlobals()
  useUiStore.setState({ shellId: 'vscode', nicknameDraft: null })
})

// ─── 註冊 ───────────────────────────────────────────────────────

describe('註冊表：excel（決策 8、11）', () => {
  it('SHELLS 順序 vscode、ppt、meet、excel；excel 可解析', () => {
    expect(SHELLS.map((s) => s.id)).toEqual(['vscode', 'ppt', 'meet', 'excel'])
    expect(isRegisteredShellId('excel')).toBe(true)
    expect(resolveShellId('excel')).toBe('excel')
    expect(getShell('excel')).toBe(excelShell)
    expect(resolveShellId('EXCEL')).toBe('vscode')
  })

  it('定義只有 { id, name, description, icon, Shell, titleFor, faviconHref }；「試算表」、描述照規格（≤ 20 字）、綠色表格圖示', () => {
    expect(Object.keys(excelShell).sort()).toEqual(['Shell', 'description', 'faviconHref', 'icon', 'id', 'name', 'titleFor'])
    expect(excelShell.name).toBe('試算表')
    expect(excelShell.description).toBe('白底試算表，像在整理資料')
    expect([...excelShell.description].length).toBeLessThanOrEqual(20)
    expect(excelShell.icon).toBe(SheetsIcon)
    expect(excelShell.Shell).toBe(ExcelShell)
  })

  it('catalog：第四張卡片「試算表」可選', () => {
    expect(THEME_CATALOG[3]).toMatchObject({ id: 'excel', name: '試算表', description: '白底試算表，像在整理資料', available: true })
  })

  it('卡片圖示：40px、text-brand-sheets、不含色碼', () => {
    const svg = renderToStaticMarkup(<SheetsIcon />)
    expect(svg).toContain('width="40"')
    expect(svg).toContain('text-brand-sheets')
    expect(svg).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })

  it('本機偏好：localStorage 存 excel → 重新整理仍是 excel；setShellId(excel) 寫入', () => {
    const storage: ShellStorage = { getItem: (k) => (k === SHELL_STORAGE_KEY ? 'excel' : null), setItem: () => {} }
    expect(loadShellId(storage)).toBe('excel')
    const data = new Map<string, string>()
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) } })
    useUiStore.getState().setShellId('excel')
    expect(data.get(SHELL_STORAGE_KEY)).toBe('excel')
  })
})

describe('titleFor 與 favicon（DESIGN §17.2、決策 8）', () => {
  it('非作畫階段「活頁簿1 - Excel」；作畫中前綴「● 」', () => {
    for (const phase of ['idle', 'choosing', 'ended'] as const) expect(excelShell.titleFor({ phase })).toBe('活頁簿1 - Excel')
    expect(excelShell.titleFor({ phase: 'drawing' })).toBe('● 活頁簿1 - Excel')
    expect(excelWindowTitle('drawing')).toBe(`● ${EXCEL_APP_TITLE}`)
  })

  it('favicon：public/favicon-excel.svg（依 Vite base），檔案存在、自繪（無商標字樣）', () => {
    expect(excelShell.faviconHref).toBe(`${import.meta.env.BASE_URL}favicon-excel.svg`)
    const url = new URL('../public/favicon-excel.svg', import.meta.url)
    expect(fs.existsSync(url)).toBe(true)
    const svg = fs.readFileSync(url, 'utf8')
    expect(svg).toMatch(/^<svg /)
    expect(svg).not.toMatch(/microsoft|excel|office/i)
  })

  it('applyDocumentTheme：data-theme=excel、標題、favicon', () => {
    const attrs = new Map<string, string>()
    const icon = new Map<string, string>([['href', '/draw-guess/favicon.svg']])
    const doc: ShellDocument = {
      title: '',
      documentElement: { getAttribute: (n) => attrs.get(n) ?? null, setAttribute: (n, v) => void attrs.set(n, v) },
      querySelector: () => ({ getAttribute: (n) => icon.get(n) ?? null, setAttribute: (n, v) => void icon.set(n, v) }),
    }
    applyDocumentTheme(doc, excelShell, { phase: 'drawing' })
    expect(attrs.get('data-theme')).toBe('excel')
    expect(doc.title).toBe('● 活頁簿1 - Excel')
    expect(icon.get('href')).toBe(excelShell.faviconHref)
  })
})

// ─── 版面純邏輯 ───────────────────────────────────────────────────

describe('版面純邏輯（excelLayout）', () => {
  it('功能區 9 個固定分頁；關聯式「圖片格式」只在畫師作畫中預設作用', () => {
    expect(RIBBON_TABS).toEqual(['檔案', '常用', '插入', '頁面配置', '公式', '資料', '校閱', '檢視', '說明'])
    expect(defaultRibbonTab(true)).toBe('圖片格式')
    expect(defaultRibbonTab(false)).toBe('常用')
    expect(activeRibbonTab({ tab: '說明', base: '常用' }, '常用')).toBe('說明')
    expect(activeRibbonTab({ tab: '說明', base: '常用' }, '圖片格式')).toBe('圖片格式')
  })

  it('名稱方塊與資料編輯列：選到圖片「圖片 1」＋空白；否則「A1」＋「名稱」', () => {
    expect(nameBoxText(true)).toBe('圖片 1')
    expect(nameBoxText(false)).toBe('A1')
    expect(formulaText(true)).toBe('')
    expect(formulaText(false)).toBe('名稱')
  })

  it('欄名 26 進位、欄列數填滿（至少 A–E；列數容得下表頭＋玩家＋一列空白）', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA'])
    expect(columnsToFill(0)).toBe(5)
    // 1020px：32＋128＋64×14＝1056 ≥ 1020 → A＋14 欄
    expect(columnsToFill(1020)).toBe(15)
    expect(rowsToFill(600, 3)).toBe(30)
    expect(rowsToFill(0, 3)).toBe(5)
    expect(rowsToFill(100, 40)).toBe(42)
  })

  it('人員表格文字：自己加「（你）」；狀態欄優先序 畫師 → 已猜對 → 斷線', () => {
    expect(sheetNameText('rex', true)).toBe('rex（你）')
    expect(sheetNameText('amy', false)).toBe('amy')
    const base = { isDrawer: false, hasGuessed: false, connected: true }
    expect(sheetStatus({ ...base, isDrawer: true }, 40)).toEqual({ text: '✎ 繪圖中', tone: 'drawer' })
    expect(sheetStatus({ ...base, hasGuessed: true }, 50)).toEqual({ text: '✓ +50', tone: 'guessed' })
    expect(sheetStatus({ ...base, hasGuessed: true }, null)).toEqual({ text: '✓', tone: 'guessed' })
    expect(sheetStatus({ ...base, connected: false }, null)).toEqual({ text: '離線', tone: 'offline' })
    expect(sheetStatus({ ...base, hasGuessed: true, connected: false }, 30)).toEqual({ text: '✓ +30', tone: 'guessed' })
    expect(sheetStatus(base, null)).toBeNull()
  })

  it('狀態列「計數: N」；放棄確認的主要按鈕「刪除」', () => {
    expect(countText(3)).toBe('計數: 3')
    expect(countText(-1)).toBe('計數: 0')
    expect(excelDialogButtonText('cancelRound', 0)).toBe('刪除')
    expect(excelDialogButtonText('cancelRound', 1)).toBeUndefined()
    expect(excelDialogButtonText('topic', 0)).toBeUndefined()
  })
})

// ─── ShellViews ──────────────────────────────────────────────────

describe('EXCEL_VIEWS（DESIGN §17.2）', () => {
  it('Dialog＝ExcelDialog、PlayerList＝SheetPlayers、註解卡片同 Office（ppt）、狀態列項目同 ppt 深色字', () => {
    expect(EXCEL_VIEWS.Dialog).toBe(ExcelDialog)
    expect(EXCEL_VIEWS.PlayerList).toBe(SheetPlayers)
    expect(EXCEL_CHAT_VIEW.Line).toBe(OfficeCommentLine)
    expect(EXCEL_STATUS_VIEW).toEqual(PPT_STATUS_VIEW)
  })

  it('「插入圖片」＝我來畫；說明的切換路徑「檔案 → 切換偽裝」；工具列收合斷點 500px（實測，DESIGN §17.4）', () => {
    expect(EXCEL_VOLUNTEER_VIEW).toEqual({ label: '插入圖片', icon: InsertPictureIcon })
    expect(EXCEL_VIEWS.help).toEqual({ switchHint: '檔案 → 切換偽裝' })
    expect(EXCEL_TOOLBAR_VIEW.compactBelowPx).toBe(500)
    expect(fs.readFileSync(new URL('../../DESIGN.md', import.meta.url), 'utf8')).toContain('工具列收合斷點 **500px**（2026-10-06 Phase 2 實測')
  })

  it('遊戲說明代入 excel 的名稱：「如何當畫師」提「插入圖片」、「如何切換偽裝」為「檔案 → 切換偽裝」（DESIGN §16）', () => {
    const names = { volunteer: EXCEL_VOLUNTEER_VIEW.label, switch: EXCEL_VIEWS.help?.switchHint ?? '' }
    expect(renderTopic(findHelpTopic('be-drawer')!, names)[0]).toContain('「插入圖片」')
    expect(renderTopic(findHelpTopic('switch-theme')!, names)[0]).toBe('檔案 → 切換偽裝，選一個想要的介面風格；下次進入時首頁會預選它。')
  })

  it('註解輸入列：placeholder「開始對話」，功能提示在上方一行（aria-describedby）', () => {
    const input: ChatInputProps = {
      value: '',
      onChange: () => {},
      onPaste: () => {},
      maxLength: 100,
      placeholder: '輸入答案或聊天',
      'aria-label': '聊天',
      'aria-invalid': false,
      autoComplete: 'off',
      enterKeyHint: 'send',
    }
    const Composer = EXCEL_CHAT_VIEW.Composer
    const html = renderToStaticMarkup(<Composer onSubmit={() => {}} input={input} error={null} canSend={false} />)
    expect(html).toContain('placeholder="開始對話"')
    expect(html).toMatch(/<p id="([^"]+)"[^>]*>輸入答案或聊天<\/p>[\s\S]*aria-describedby="\1"/)
  })
})

// ─── 人員表格 ────────────────────────────────────────────────────

function player(p: Partial<PlayerPublic> & Pick<PlayerPublic, 'id' | 'nickname'>): PlayerPublic {
  return { score: 0, isDrawer: false, hasGuessed: false, connected: true, joinedAt: 0, ...p }
}

describe('SheetPlayers：A–C 欄人員表格（DESIGN §17.3）', () => {
  const rows: PlayerRowData[] = [
    { player: player({ id: 'a', nickname: '小明', score: 120, isDrawer: true }), isMe: false, gain: 40 },
    { player: player({ id: 'b', nickname: '阿華', score: 80, hasGuessed: true }), isMe: true, gain: 50 },
    { player: player({ id: 'c', nickname: 'Carol', connected: false }), isMe: false, gain: null },
    { player: player({ id: 'd', nickname: 'Dan', score: 7 }), isMe: false, gain: null },
  ]
  const html = renderToStaticMarkup(<SheetPlayers rows={rows} />)

  it('ARIA 表格：表頭「名稱」「分數」「狀態」（粗體、--bg-sidebar、下緣 --border）＋每位玩家一列', () => {
    expect(html).toMatch(/^<div role="table" aria-label="玩家清單" aria-rowcount="5"/)
    const headers = [...html.matchAll(/role="columnheader" class="([^"]*)">([^<]+)</g)]
    expect(headers.map((m) => m[2])).toEqual(['名稱', '分數', '狀態'])
    for (const m of headers) expect(m[1]).toMatch(/border-b-border bg-sidebar font-bold/)
    expect(html.match(/role="row"/g)).toHaveLength(5)
  })

  it('儲存格對齊格距：高 20px、A 欄 128px、B／C 欄 64px、右下 1px --grid-line', () => {
    expect(html.match(/role="cell" class="h-\[20px\] shrink-0 border-r border-b border-grid-line[^"]*w-\[128px\]/g)).toHaveLength(4)
    expect(html.match(/role="cell" class="h-\[20px\][^"]*w-\[64px\]/g)).toHaveLength(8)
  })

  it('畫師列整列 --bg-active、名稱格 2px --border-focus 作用中儲存格框、狀態「✎ 繪圖中」--sem-function', () => {
    const drawerRow = html.slice(html.indexOf('data-player="a"'), html.indexOf('data-player="b"'))
    expect(drawerRow).toContain('class="flex bg-active"')
    expect(drawerRow).toContain('outline-2 -outline-offset-1 outline-border-focus')
    expect(drawerRow).toMatch(/text-sem-function">✎ 繪圖中</)
    expect(html.match(/outline-border-focus/g)).toHaveLength(1)
  })

  it('自己：名稱加「（你）」並粗體；已猜對「✓ +N」--sem-type；分數右對齊 tabular-nums', () => {
    const me = html.slice(html.indexOf('data-player="b"'), html.indexOf('data-player="c"'))
    expect(me).toMatch(/font-bold"><span class="block truncate">阿華（你）<\/span>/)
    expect(me).toMatch(/text-sem-type">✓ \+50</)
    expect(me).toMatch(/text-right tabular-nums">80</)
  })

  it('斷線：名稱與狀態「離線」皆 --fg-muted（白底 6.5:1，2026-10-06 定案）；一般玩家狀態空白', () => {
    const off = html.slice(html.indexOf('data-player="c"'), html.indexOf('data-player="d"'))
    expect(off).toMatch(/text-fg-muted[^"]*"><span class="block truncate">Carol</)
    expect(off).toMatch(/text-fg-muted">離線</)
    const plain = html.slice(html.indexOf('data-player="d"'))
    expect(plain).toMatch(/overflow-visible "><\/div>/)
  })

  it('每列有完整狀態的工具提示（顏色不是唯一載體）', () => {
    expect(html).toContain('data-tooltip="小明：120 分，畫師，本回合 +40"')
    expect(html).toContain('data-tooltip="Carol：0 分，斷線中"')
  })
})

// ─── 對話框 ─────────────────────────────────────────────────────

describe('ExcelDialog：替代文字／刪除圖片？（DESIGN §17.2「對話框」）', () => {
  const noop = () => {}
  it('出題：標題「替代文字」、說明一行「為這張圖片輸入描述」、輸入框、「確定」「取消」', () => {
    const props: DialogProps = {
      purpose: 'topic',
      label: '出題',
      input: { value: '', onChange: noop, placeholder: '輸入題目', ariaLabel: '題目' },
      items: [
        { id: 'ok', label: '出題並開始作畫', onSelect: noop },
        { id: 'cancel', label: '放棄本回合', onSelect: noop },
      ],
    }
    const html = renderToStaticMarkup(<ExcelDialog {...props} />)
    expect(html).toMatch(/<span id="[^"]+" class="truncate text-fg">替代文字<\/span>/)
    expect(html).toContain('<p class="mb-3 leading-[20px] text-fg">為這張圖片輸入描述</p>')
    expect(html).toMatch(/aria-label="確定：出題並開始作畫"[^>]*>確定</)
    expect(html).toMatch(/aria-label="取消：放棄本回合"[^>]*>取消</)
  })

  it('放棄確認：標題「刪除圖片？」、主要按鈕「刪除」、次要「取消」（無障礙名稱以可見文字開頭）', () => {
    const props: DialogProps = {
      purpose: 'cancelRound',
      label: '放棄本回合',
      title: '放棄這一回合？題目會直接揭曉。',
      items: [
        { id: 'confirm', label: '放棄本回合', onSelect: noop },
        { id: 'keep', label: '繼續作畫', onSelect: noop },
      ],
      onEscape: noop,
    }
    const html = renderToStaticMarkup(<ExcelDialog {...props} />)
    expect(html).toContain('>刪除圖片？</span>')
    expect(html).toMatch(/type="submit"[^>]*aria-label="刪除：放棄本回合"[^>]*bg-accent[^>]*>刪除</)
    expect(html).toMatch(/aria-label="取消：繼續作畫"[^>]*>取消</)
    expect(html).not.toContain('為這張圖片輸入描述')
  })

  it('自動重連：「開啟活頁簿」＋一行 notice（role=status）', () => {
    const html = renderToStaticMarkup(<ExcelResumeDialog notice="正在重新加入…" />)
    expect(html).toContain('aria-label="開啟活頁簿"')
    expect(html).toMatch(/role="status"[^>]*>正在重新加入…</)
  })
})

// ─── ExcelShell 插槽擺放 ──────────────────────────────────────────

const themes = { current: 'excel' as const, options: THEME_CATALOG, select: () => {} }
function gameProps(round: Partial<Extract<ShellProps, { screen: 'game' }>['round']> = {}, online = 2, total = online): ShellProps {
  return {
    screen: 'game',
    round: { phase: 'idle', isDrawer: false, canDraw: false, drawerName: null, ...round },
    counts: { online, total },
    themes,
    help: { open: () => {} },
    players: <i data-slot="players" />,
    canvas: <i data-slot="canvas" />,
    toolbar: <i data-slot="toolbar" />,
    chat: <i data-slot="chat" />,
    roundStatus: <i data-slot="roundStatus" />,
    volunteer: <i data-slot="volunteer" />,
    connection: <i data-slot="connection" />,
    dialogs: <i data-slot="dialogs" />,
  }
}

describe('ExcelShell：插槽擺放（DESIGN §17.2）', () => {
  it('遊戲畫面：工作表（players、canvas、dialogs）｜註解窗格（chat，投放區）｜狀態列（就緒＋roundStatus、計數: N）｜標題列 connection｜常用的 volunteer', () => {
    const html = renderToStaticMarkup(<ExcelShell {...gameProps({}, 3)} />)
    for (const slot of ['players', 'canvas', 'chat', 'roundStatus', 'volunteer', 'connection', 'dialogs']) expect(html, slot).toContain(`data-slot="${slot}"`)
    expect(html).toMatch(/<section aria-label="註解" data-chat-drop-zone="" class="relative [^"]*bg-sidebar[^>]*>[\s\S]*data-slot="chat"/)
    expect(html).toMatch(/<main aria-label="工作表"[^>]*>[\s\S]*data-slot="players"[\s\S]*data-slot="canvas"[\s\S]*data-slot="dialogs"/)
    expect(html).toMatch(/<footer aria-label="狀態列"[^>]*>[\s\S]*就緒<\/span><i data-slot="roundStatus">[\s\S]*計數: 3/)
    expect(html).toMatch(/<header[^>]*bg-titlebar[\s\S]*活頁簿1 - Excel[\s\S]*data-slot="connection"/)
    expect(html).toMatch(/role="tabpanel" aria-label="常用"[\s\S]*data-slot="volunteer"/)
  })

  it('非畫師：沒有「圖片格式」分頁、沒有工具列與控點、沒有灰化假工具列；名稱方塊「A1」', () => {
    const html = renderToStaticMarkup(<ExcelShell {...gameProps({ phase: 'drawing', drawerName: 'amy' }, 3)} />)
    expect(html).not.toContain('圖片格式')
    expect(html).not.toContain('data-slot="toolbar"')
    expect(html).not.toContain('data-picture-handles')
    expect(html).not.toContain('opacity-40 select-none')
    expect(html).toMatch(/<span class="truncate">A1<\/span>/)
  })

  it('畫師作畫中：關聯式「圖片格式」分頁作用（--bg-active 底、上緣 --accent）放 toolbar、圖片 8 個控點、名稱方塊「圖片 1」、標題 ●', () => {
    const html = renderToStaticMarkup(<ExcelShell {...gameProps({ phase: 'drawing', isDrawer: true, canDraw: true, drawerName: 'rex' })} />)
    expect(html).toMatch(/role="tab" aria-selected="true"[^>]*border-accent bg-active text-accent[^>]*>圖片格式</)
    expect(html).toMatch(/role="tabpanel" aria-label="圖片格式"[\s\S]*data-slot="toolbar"/)
    expect(html).toMatch(/data-slot="canvas"><\/i><span aria-hidden="true" data-picture-handles=""/)
    expect(html.match(/rounded-full border border-border-focus bg-input/g)).toHaveLength(8)
    expect(html).toMatch(/<span class="truncate">圖片 1<\/span>/)
    expect(html).toContain('● 活頁簿1 - Excel')
  })

  it('出題中的畫師：圖片還沒插入（替代文字對話框），維持「常用」、沒有控點', () => {
    const html = renderToStaticMarkup(<ExcelShell {...gameProps({ phase: 'choosing', isDrawer: true, drawerName: 'rex' })} />)
    expect(html).not.toContain('圖片格式')
    expect(html).not.toContain('data-picture-handles')
  })

  it('「插入圖片」：可開局時是 volunteer 插槽；人數不足灰化＋「等待其他玩家加入（1/2）」；回合中灰化無說明', () => {
    const waiting = renderToStaticMarkup(<ExcelShell {...gameProps({}, 1)} />)
    expect(waiting).not.toContain('data-slot="volunteer"')
    expect(waiting).toMatch(/aria-hidden="true" class="flex h-\[30px\][^"]*opacity-40"><svg[\s\S]*?<\/svg>插入圖片<\/span>/)
    expect(waiting).toContain('等待其他玩家加入（1/2）')
    const inRound = renderToStaticMarkup(<ExcelShell {...gameProps({ phase: 'drawing', drawerName: 'amy' }, 3)} />)
    expect(inRound).not.toContain('data-slot="volunteer"')
    expect(inRound).not.toContain('等待其他玩家加入')
  })

  it('「檔案」選單入口、「說明」分頁可作用（遊戲中）、「校閱」→「顯示註解」（窄螢幕才是真按鈕）', () => {
    const html = renderToStaticMarkup(<ExcelShell {...gameProps()} />)
    expect(html).toMatch(/<button[^>]*aria-label="檔案" aria-haspopup="menu"/)
    expect(html).toMatch(/role="tab" aria-selected="false"[^>]*max-lg:hidden">說明</)
    expect(html).toMatch(/role="tab" aria-selected="false"[^>]*>校閱</)
  })

  it('響應式：註解窗格 260px／< 1024px 220px／< 768px 覆蓋層；圖片 < 1024px 改到人員表格下方', () => {
    const src = excelSources['../src/shells/excel/ExcelShell.tsx'] ?? ''
    expect(src).toMatch(/w-\[260px\][^`]*max-lg:w-\[220px\][^`]*max-md:absolute[^`]*max-md:z-20/)
    expect(src).toContain("commentsOpen ? '' : 'max-md:hidden'")
    expect(src).toContain('const [commentsOpen, setCommentsOpen] = useState(true)')
    expect(src).toContain('top-[40px] left-[352px] h-[calc(100%-60px)] w-[calc(100%-400px)] [container-type:size]')
    expect(src).toContain('max-lg:top-[var(--picture-top)]')
  })

  it('自動重連畫面：空工作表（只有表頭）、空註解窗格、對話框「開啟活頁簿」', () => {
    const html = renderToStaticMarkup(<ExcelShell screen="resume" notice="正在重新加入…" connection={<i data-slot="connection" />} />)
    expect(html).toContain('aria-label="開啟活頁簿"')
    expect(html).toContain('這本活頁簿還沒有任何註解')
    expect(html).toContain('data-slot="connection"')
    expect(html).not.toContain('data-picture-handles')
    expect(html).toContain('計數: 0')
  })
})

// ─── 殼層分界 ────────────────────────────────────────────────────

describe('excel／office 殼層分界', () => {
  it('掃描到 excel 與 office 原始碼', () => {
    expect(Object.keys(excelSources).length).toBeGreaterThanOrEqual(8)
    expect(Object.keys(officeSources).length).toBeGreaterThanOrEqual(5)
  })

  it('不含色碼（DESIGN §10：一律用 token class）', () => {
    for (const [file, src] of Object.entries({ ...excelSources, ...officeSources })) expect(src.match(/#[0-9a-fA-F]{3,8}\b/g), file).toBeNull()
  })

  it('程式碼（不含註解）不出現 Microsoft 商標字樣；「Excel」只出現在視窗標題常數', () => {
    const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    for (const [file, src] of Object.entries({ ...excelSources, ...officeSources })) {
      expect(code(src), file).not.toMatch(/Microsoft|Office 365/)
      expect(code(src).match(/Excel(?![A-Z_a-z])/g) ?? [], file).toEqual(file.endsWith('/excelLayout.ts') ? ['Excel'] : [])
    }
  })

  it('註解窗格帶投放區屬性 data-chat-drop-zone', () => {
    expect(excelSources['../src/shells/excel/ExcelShell.tsx']).toContain('data-chat-drop-zone=""')
  })
})
