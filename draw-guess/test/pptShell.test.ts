// ppt 主題（Epic 3 Phase 3 A）：註冊、titleFor／favicon、catalog 可選、重新整理保留、theme.css 覆寫、殼層分界、版面純邏輯
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SHELL_STORAGE_KEY, loadShellId, useUiStore, type ShellStorage } from '../src/layout/uiStore'
import { SHELLS, getShell, isRegisteredShellId, resolveShellId } from '../src/shells'
import { THEME_CATALOG } from '../src/shells/catalog'
import { applyDocumentTheme, type ShellDocument } from '../src/shells/document'
import { pptShell } from '../src/shells/ppt/definition'
import {
  PPT_APP_TITLE,
  RIBBON_TABS,
  activeRibbonTab,
  defaultRibbonTab,
  dialogButtonLabel,
  dialogButtonText,
  dialogKeyAction,
  pptWindowTitle,
  slideCounter,
  waitingForPlayers,
} from '../src/shells/ppt/pptLayout'
import { SlidesIcon } from '../src/shells/themeIcons'

const fs = (await import('node:fs' as string)) as {
  readFileSync(path: URL, encoding: 'utf8'): string
  existsSync(path: URL): boolean
}
const themeCss = fs.readFileSync(new URL('../src/styles/theme.css', import.meta.url), 'utf8')
const pptSources = import.meta.glob<string>('../src/shells/ppt/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })

afterEach(() => {
  vi.unstubAllGlobals()
  useUiStore.setState({ shellId: 'vscode', nicknameDraft: null })
})

describe('註冊表：ppt', () => {
  it('SHELLS 為 vscode、ppt、meet、excel（首頁卡片順序；Epic 5 起 meet、Epic 13 起 excel 接在後面）；ppt 可解析', () => {
    expect(SHELLS.map((s) => s.id)).toEqual(['vscode', 'ppt', 'meet', 'excel'])
    expect(isRegisteredShellId('ppt')).toBe(true)
    expect(resolveShellId('ppt')).toBe('ppt')
    expect(getShell('ppt')).toBe(pptShell)
  })

  it('定義只有 { id, name, description, icon, Shell, titleFor, faviconHref }；名稱、描述與圖示同 catalog 規劃（簡報、SlidesIcon）', () => {
    expect(Object.keys(pptShell).sort()).toEqual(['Shell', 'description', 'faviconHref', 'icon', 'id', 'name', 'titleFor'])
    expect(pptShell.name).toBe('簡報')
    expect(pptShell.description).toBe('白底簡報軟體，像在做投影片')
    expect(pptShell.icon).toBe(SlidesIcon)
    expect(typeof pptShell.Shell).toBe('function')
  })

  it('catalog：簡報已可選（available），不再有即將推出項目', () => {
    const ppt = THEME_CATALOG.find((o) => o.id === 'ppt')
    expect(ppt).toMatchObject({ id: 'ppt', name: '簡報', description: '白底簡報軟體，像在做投影片', available: true })
    expect(ppt?.icon).toBe(SlidesIcon)
    expect(THEME_CATALOG.every((o) => o.available)).toBe(true)
  })
})

describe('titleFor 與 favicon（DESIGN §13.2）', () => {
  it('非作畫階段：簡報1 - PowerPoint', () => {
    for (const phase of ['idle', 'choosing', 'ended'] as const) {
      expect(pptShell.titleFor({ phase })).toBe('簡報1 - PowerPoint')
    }
    expect(PPT_APP_TITLE).toBe('簡報1 - PowerPoint')
  })

  it('作畫中前綴「● 」（與 vscode 一致）', () => {
    expect(pptShell.titleFor({ phase: 'drawing' })).toBe('● 簡報1 - PowerPoint')
    expect(pptWindowTitle('drawing')).toBe('● 簡報1 - PowerPoint')
  })

  it('favicon：public/favicon-ppt.svg（依 Vite base），檔案存在、自繪（無商標字樣）', () => {
    expect(pptShell.faviconHref).toBe(`${import.meta.env.BASE_URL}favicon-ppt.svg`)
    const url = new URL('../public/favicon-ppt.svg', import.meta.url)
    expect(fs.existsSync(url)).toBe(true)
    const svg = fs.readFileSync(url, 'utf8')
    expect(svg).toMatch(/^<svg /)
    expect(svg).not.toMatch(/microsoft|powerpoint/i)
  })

  it('applyDocumentTheme：data-theme=ppt、標題、favicon', () => {
    const attrs = new Map<string, string>()
    const icon = new Map<string, string>([['href', '/draw-guess/favicon.svg']])
    const doc: ShellDocument = {
      title: '',
      documentElement: { getAttribute: (n) => attrs.get(n) ?? null, setAttribute: (n, v) => void attrs.set(n, v) },
      querySelector: () => ({ getAttribute: (n) => icon.get(n) ?? null, setAttribute: (n, v) => void icon.set(n, v) }),
    }
    applyDocumentTheme(doc, pptShell, { phase: 'drawing' })
    expect(attrs.get('data-theme')).toBe('ppt')
    expect(doc.title).toBe('● 簡報1 - PowerPoint')
    expect(icon.get('href')).toBe(pptShell.faviconHref)
  })
})

describe('本機偏好：選 ppt 後重新整理仍是 ppt（決策 3）', () => {
  it('loadShellId 讀到 ppt → ppt', () => {
    const storage: ShellStorage = { getItem: (k) => (k === SHELL_STORAGE_KEY ? 'ppt' : null), setItem: () => {} }
    expect(loadShellId(storage)).toBe('ppt')
  })

  it('setShellId(ppt) 寫入 localStorage', () => {
    const data = new Map<string, string>()
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) } })
    useUiStore.getState().setShellId('ppt')
    expect(useUiStore.getState().shellId).toBe('ppt')
    expect(data.get(SHELL_STORAGE_KEY)).toBe('ppt')
  })
})

describe('theme.css：[data-theme="ppt"] 覆寫（DESIGN §13.1）', () => {
  const block = /\[data-theme='ppt'\]\s*\{([^}]*)\}/.exec(themeCss)?.[1] ?? ''
  const value = (token: string) => new RegExp(`${token}:\\s*([^;]+);`).exec(block)?.[1]?.trim().toLowerCase()

  it('有 ppt 區塊且為淺色', () => {
    expect(block).not.toBe('')
    expect(block).toContain('color-scheme: light')
  })

  it.each([
    ['--bg-titlebar', '#b7472a'],
    ['--fg-statusbar', '#ffffff'],
    ['--bg-activity', '#ffffff'],
    ['--bg-sidebar', '#f3f2f1'],
    ['--bg-editor', '#e6e6e6'],
    ['--bg-tab-active', '#ffffff'],
    ['--bg-tab-inactive', '#f3f2f1'],
    ['--bg-input', '#ffffff'],
    ['--bg-quickinput', '#ffffff'],
    ['--bg-statusbar', '#f3f2f1'],
    ['--bg-statusbar-drawer', '#f3f2f1'],
    ['--bg-hover', '#edebe9'],
    ['--bg-active', '#fde7e9'],
    ['--bg-selection', '#fce4d6'],
    ['--border', '#d2d0ce'],
    ['--border-focus', '#b7472a'],
    ['--fg', '#252525'],
    ['--fg-editor', '#252525'],
    ['--fg-muted', '#605e5c'],
    ['--fg-dim', '#8a8886'],
    ['--fg-link', '#0078d4'],
    ['--accent', '#b7472a'],
    ['--accent-hover', '#9e3b23'],
    ['--bg-button-secondary', '#ffffff'],
    ['--bg-button-secondary-hover', '#f3f2f1'],
    ['--sem-comment', '#605e5c'],
    ['--sem-variable', '#252525'],
    ['--sem-function', '#b7472a'],
    ['--sem-type', '#107c10'],
    ['--sem-number', '#605e5c'],
    ['--sem-string', '#b7472a'],
    ['--sem-keyword', '#0078d4'],
    ['--sem-error', '#a4262c'],
    ['--sem-warning', '#8a6d00'],
    ['--statusbar-hover', 'rgba(0, 0, 0, 0.06)'],
    ['--focus-on-color', '#ffffff'],
  ])('%s = %s', (token, expected) => {
    expect(value(token)).toBe(expected)
  })

  it('字型改無襯線（§13 字型堆疊）', () => {
    expect(value('--font-code')).toBe(`system-ui, 'segoe ui', 'microsoft jhenghei', 'pingfang tc', sans-serif`)
  })

  it('不覆寫畫布底色與卡片圖示色（決策 6、§13.4）', () => {
    expect(block).not.toMatch(/--bg-canvas\s*:/)
    expect(block).not.toMatch(/--brand-editor\s*:/)
    expect(block).not.toMatch(/--brand-slides\s*:/)
  })

  it('新增 token：--bg-slide、--slide-shadow（:root 給 vscode 值、ppt 覆寫）並映射 Tailwind', () => {
    const root = /:root\s*\{([^}]*)\}/.exec(themeCss)?.[1] ?? ''
    expect(root).toMatch(/--bg-slide:\s*#1e1e1e;/)
    expect(root).toMatch(/--slide-shadow:\s*none;/)
    expect(value('--bg-slide')).toBe('#ffffff')
    expect(value('--slide-shadow')).toBe('0 1px 3px rgba(0, 0, 0, 0.15)')
    expect(themeCss).toContain('--color-slide: var(--bg-slide);')
    expect(themeCss).toContain('--shadow-slide: var(--slide-shadow);')
  })
})

describe('ppt 殼層分界', () => {
  it('掃描到 ppt 殼層原始碼', () => {
    expect(Object.keys(pptSources).length).toBeGreaterThanOrEqual(6)
  })

  it('不 import uiStore／catalog／ThemeCards／首頁（主題資料經 ShellProps.themes）', () => {
    for (const [file, src] of Object.entries(pptSources)) {
      const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1] ?? '')
      expect(imports.filter((p) => /uiStore$|\/catalog$|ThemeCards$|\/home\//.test(p)), file).toEqual([])
    }
  })

  it('不含色碼（DESIGN §10：一律用 token class）', () => {
    for (const [file, src] of Object.entries(pptSources)) {
      expect(src.match(/#[0-9a-fA-F]{3,8}\b/g), file).toBeNull()
    }
  })

  it('註解窗格（聊天容器）帶投放區屬性 data-chat-drop-zone', () => {
    const shell = Object.entries(pptSources).find(([f]) => f.endsWith('/PptShell.tsx'))?.[1] ?? ''
    expect(shell).toContain('data-chat-drop-zone=""')
  })
})

describe('版面純邏輯', () => {
  it('功能區 11 個分頁，含「檔案」與「繪圖」', () => {
    expect(RIBBON_TABS).toHaveLength(11)
    expect(RIBBON_TABS[0]).toBe('檔案')
    expect(RIBBON_TABS).toContain('繪圖')
  })

  it('預設作用分頁：畫師出題／作畫中為「繪圖」，其餘「常用」', () => {
    expect(defaultRibbonTab(true, 'choosing')).toBe('繪圖')
    expect(defaultRibbonTab(true, 'drawing')).toBe('繪圖')
    expect(defaultRibbonTab(true, 'ended')).toBe('常用')
    expect(defaultRibbonTab(false, 'drawing')).toBe('常用')
    expect(defaultRibbonTab(false, 'idle')).toBe('常用')
  })

  it('手動點的分頁只在預設分頁不變時有效（輪到自己作畫時自動回「繪圖」）', () => {
    expect(activeRibbonTab(null, '常用')).toBe('常用')
    expect(activeRibbonTab({ tab: '繪圖', base: '常用' }, '常用')).toBe('繪圖')
    expect(activeRibbonTab({ tab: '常用', base: '常用' }, '繪圖')).toBe('繪圖')
  })

  it('狀態列「投影片 N / M」與人數不足說明', () => {
    expect(slideCounter(1, 3)).toBe('投影片 1 / 3')
    expect(slideCounter(3, 3)).toBe('投影片 3 / 3')
    expect(slideCounter(0, 0)).toBe('投影片 1 / 1')
    expect(slideCounter(5, 3)).toBe('投影片 3 / 3')
    expect(waitingForPlayers(1)).toBe('等待其他玩家加入（1/2）')
  })

  it('對話框按鈕：第一個「確定」、第二個「取消」；無障礙名稱以可見文字開頭', () => {
    expect(dialogButtonText(0, '加入房間')).toBe('確定')
    expect(dialogButtonText(1, '繼續作畫')).toBe('取消')
    expect(dialogButtonText(2, '其他')).toBe('其他')
    expect(dialogButtonLabel(0, '加入房間')).toBe('確定：加入房間')
    expect(dialogButtonLabel(1, '放棄本回合')).toBe('取消：放棄本回合')
    expect(dialogButtonLabel(2, '其他')).toBe('其他')
  })

  it('對話框按鍵：Esc＝取消；輸入法組字中不攔截；Enter 交給 form 原生送出', () => {
    expect(dialogKeyAction('Escape', false)).toBe('cancel')
    expect(dialogKeyAction('Escape', true)).toBeNull()
    expect(dialogKeyAction('Enter', false)).toBeNull()
    expect(dialogKeyAction('a', false)).toBeNull()
  })
})
