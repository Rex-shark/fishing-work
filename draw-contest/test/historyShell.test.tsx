// 比賽歷史在 ppt 殼層的入口與檢視（Epic 17；spec/draw-contest/design.md §2「歷史檢視」列、§3.1）：
//   「檔案」選單的「開啟最近的簡報 ›」與子清單（有紀錄／沒有紀錄／灰化）、開啟選單會呼叫 refresh、選單鍵盤的純邏輯、
//   檢視時投影片區／備忘稿列／狀態列中央的切換（ShellProps.history.openId）、「關閉簡報」、殼層的字樣常數。
// 測試環境的限制（同 dialogBusy.test.tsx、busyFocus.test.tsx）：沒有 DOM，元件只能靜態渲染，狀態轉移（子清單展開／收起）與焦點測不到。這裡驗：
//   (1) 靜態渲染的結構與屬性；(2) 把元件當函式呼叫取得元素樹，直接呼叫 onClick；(3) 按鍵規則的純函式；(4) 原始碼守門。
//   子清單實際的展開、鍵盤操作與焦點要靠瀏覽器實測。
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { FileMenuList, FileRecentList, FileTab, type FileMenuRecent } from '../src/shells/office/FileMenu'
import { fileMenuKeyAction } from '../src/shells/office/officeLayout'
import { CloseRecent, PptShell, Ribbon, SlideArea } from '../src/shells/ppt/PptShell'
import { PPT_RECENT_CLOSE, PPT_RECENT_EMPTY, PPT_RECENT_HINT, PPT_RECENT_LABEL, PPT_TERMS } from '../src/shells/ppt/pptLayout'
import { PPT_VIEWS } from '../src/shells/ppt/pptViews'
import type { ShellHistory, ShellProps, ShellRoundState } from '../src/shells/types'

const sources = import.meta.glob<string>(['../src/shells/ppt/PptShell.tsx', '../src/shells/office/FileMenu.tsx', '../src/App.tsx', '../src/socket/client.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
})
const sourceOf = (name: string) => Object.entries(sources).find(([f]) => f.endsWith(name))?.[1] ?? ''

type AnyElement = ReactElement<Record<string, unknown>>

/** 走訪元素樹（不渲染子元件）找出所有符合條件的元素 */
function findElements(node: ReactNode, pred: (el: AnyElement) => boolean): AnyElement[] {
  const out: AnyElement[] = []
  const walk = (n: ReactNode) => {
    if (Array.isArray(n)) n.forEach(walk)
    else if (isValidElement<Record<string, unknown>>(n)) {
      if (pred(n)) out.push(n)
      walk(n.props.children as ReactNode)
    }
  }
  walk(node)
  return out
}

/** 在一次 render 裡把元件當函式呼叫，回傳它產生的元素樹（hooks 照常執行；不渲染結果） */
function elementsOf(component: () => ReactNode): ReactNode {
  let tree: ReactNode = null
  const Probe = () => {
    tree = component()
    return null
  }
  renderToStaticMarkup(<Probe />)
  return tree
}

const noop = () => {}
const ENTRIES = [
  { id: 3000, label: '香蕉 — 10/13 09:30 — 第一名 Bob（91 分）' },
  { id: 2000, label: '蘋果 — 10/12 14:03 — 第一名 Alice（87 分）' },
]
const recent = (patch: Partial<FileMenuRecent> = {}): FileMenuRecent => ({
  label: PPT_RECENT_LABEL,
  emptyLabel: PPT_RECENT_EMPTY,
  entries: ENTRIES,
  enabled: true,
  onOpen: noop,
  onRefresh: noop,
  ...patch,
})
const menuProps = { position: { left: 0, top: 0 }, anchor: { current: null }, onClose: noop, onSwitchTheme: noop, onHelp: noop }

// ─── 字樣（都在殼層） ─────────────────────────────────────────────────

describe('ppt 的字樣（design §2、§3.1）', () => {
  it('入口「開啟最近的簡報」、沒有紀錄「沒有最近的簡報」、關閉「關閉簡報」、備忘稿列的叫法「最近的簡報」、說明的路徑', () => {
    expect(PPT_RECENT_LABEL).toBe('開啟最近的簡報')
    expect(PPT_RECENT_EMPTY).toBe('沒有最近的簡報')
    expect(PPT_RECENT_CLOSE).toBe('關閉簡報')
    expect(PPT_TERMS.recent).toBe('最近的簡報')
    expect(PPT_VIEWS.terms.recent).toBe('最近的簡報')
    expect(PPT_RECENT_HINT).toBe('檔案 › 開啟最近的簡報')
    expect(PPT_VIEWS.help.recentHint).toBe(PPT_RECENT_HINT)
  })
})

// ─── 「檔案」選單 ────────────────────────────────────────────────────

describe('「檔案」選單的子清單（FileRecentList）', () => {
  it('有紀錄：一列一筆、照傳入順序（最新在上），每列是 menuitem 按鈕、文字＝清單列文字', () => {
    const html = renderToStaticMarkup(<FileRecentList label={PPT_RECENT_LABEL} emptyLabel={PPT_RECENT_EMPTY} entries={ENTRIES} onOpen={noop} />)
    expect(html).toMatch(/^<div role="menu" aria-label="開啟最近的簡報" data-file-recent-list=""/)
    const rows = [...html.matchAll(/<button type="button" role="menuitem" tabindex="-1" data-file-recent-entry="(\d+)"[^>]*>([^<]+)<\/button>/g)]
    expect(rows.map((m) => [m[1], m[2]])).toEqual([
      ['3000', '香蕉 — 10/13 09:30 — 第一名 Bob（91 分）'],
      ['2000', '蘋果 — 10/12 14:03 — 第一名 Alice（87 分）'],
    ])
    expect(html).not.toContain(PPT_RECENT_EMPTY)
    expect(html).not.toContain('aria-disabled')
  })

  it('最多 5 列（殼層照 entries 顯示；上限由 App 注入的清單決定）', () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, label: `第 ${i + 1} 筆` }))
    const html = renderToStaticMarkup(<FileRecentList label="L" emptyLabel="E" entries={five} onOpen={noop} />)
    expect(html.match(/data-file-recent-entry=/g)).toHaveLength(5)
  })

  it('沒有紀錄：一列灰字「沒有最近的簡報」（aria-disabled、不是按鈕、仍可聚焦讓鍵盤展開後有落點）', () => {
    const html = renderToStaticMarkup(<FileRecentList label={PPT_RECENT_LABEL} emptyLabel={PPT_RECENT_EMPTY} entries={[]} onOpen={noop} />)
    expect(html).toMatch(/<div role="menuitem" aria-disabled="true" tabindex="-1" data-file-recent-empty="" class="[^"]*text-fg-muted[^"]*">沒有最近的簡報<\/div>/)
    expect(html).not.toContain('<button')
    expect(html.match(/role="menuitem"/g)).toHaveLength(1)
  })

  it('點一列 → onOpen(那一筆的 id)', () => {
    const onOpen = vi.fn()
    const tree = FileRecentList({ label: 'L', emptyLabel: 'E', entries: ENTRIES, onOpen })
    const buttons = findElements(tree, (el) => el.type === 'button')
    expect(buttons).toHaveLength(2)
    for (const b of buttons) (b.props.onClick as () => void)()
    expect(onOpen.mock.calls).toEqual([[3000], [2000]])
  })

  it('不含色碼與寫死的偽裝字樣（字樣由殼層傳入）', () => {
    const html = renderToStaticMarkup(<FileRecentList label="甲" emptyLabel="乙" entries={[]} onOpen={noop} />)
    expect(html).toContain('aria-label="甲"')
    expect(html).toContain('>乙</div>')
    expect(html).not.toMatch(/簡報/)
  })
})

describe('「檔案」選單的入口（FileMenuList）', () => {
  const menuItems = (html: string) => [...html.matchAll(/role="menuitem"[^>]*>(?:<span>)?([^<]+)</g)].map((m) => m[1])
  const recentItem = (html: string) => /<button type="button" role="menuitem"[^>]*data-file-recent=""[^>]*>.*?<\/button>/.exec(html)?.[0] ?? ''

  it('第三項「開啟最近的簡報 ›」：menuitem、aria-haspopup="menu"、一開始收合（aria-expanded="false"、沒有子清單）', () => {
    const html = renderToStaticMarkup(<FileMenuList {...menuProps} recent={recent()} />)
    expect(menuItems(html)).toEqual(['切換偽裝…', '說明…', '開啟最近的簡報'])
    const item = recentItem(html)
    expect(item).toContain(' aria-haspopup="menu"')
    expect(item).toContain(' aria-expanded="false"')
    expect(item).toContain(' tabindex="-1"')
    expect(item).toContain('<span>開啟最近的簡報</span><span aria-hidden="true">›</span>')
    expect(item).not.toContain(' aria-disabled=')
    expect(html).not.toContain('data-file-recent-list')
  })

  it('可開（idle／ended／choosing 非出題者）與不可開（drawing／judging／自己出題）只差 aria-disabled：整項灰化、仍可聚焦', () => {
    const on = recentItem(renderToStaticMarkup(<FileMenuList {...menuProps} recent={recent({ enabled: true })} />))
    const off = recentItem(renderToStaticMarkup(<FileMenuList {...menuProps} recent={recent({ enabled: false })} />))
    expect(off).toContain(' aria-disabled="true"')
    expect(off.replace(' aria-disabled="true"', '')).toBe(on)
    // 灰化的樣式掛在 aria-disabled（不是原生 disabled：焦點不會掉）
    const cls = /class="([^"]*)"/.exec(off)?.[1]?.split(' ') ?? []
    for (const c of ['aria-disabled:cursor-default', 'aria-disabled:text-fg-muted', 'aria-disabled:opacity-60', 'aria-disabled:hover:bg-transparent']) {
      expect(cls, c).toContain(c)
    }
    expect(off).not.toMatch(/\sdisabled(?:=""|\s|\/?>)/)
  })

  it('灰化時點了不會展開；可開時點了才切換（展開狀態在元件裡，這裡驗 onClick 是否動到狀態）', () => {
    const source = sourceOf('FileMenu.tsx')
    expect(source).toContain('if (recent.enabled) setSubOpen((open) => !open)')
    expect(source).toContain('const showSub = subOpen && recent?.enabled === true')
    expect(source).toContain('{showSub && <FileRecentList listRef={subRef}')
    // 元素樹：收合時沒有子清單元件；按鈕的 onClick 可呼叫（靜態渲染下狀態不會變，不丟例外即可）
    for (const enabled of [true, false]) {
      const tree = elementsOf(() => FileMenuList({ ...menuProps, recent: recent({ enabled }) }))
      expect(findElements(tree, (el) => el.type === FileRecentList)).toHaveLength(0)
      const [button] = findElements(tree, (el) => el.props['data-file-recent'] === '')
      expect(button).toBeDefined()
      expect(() => (button?.props.onClick as () => void)()).not.toThrow()
    }
  })

  it('入口的外觀與另外兩項同一組基本 class（高度、內距、hover、focus）', () => {
    const html = renderToStaticMarkup(<FileMenuList {...menuProps} recent={recent()} />)
    const plain = /role="menuitem" tabindex="-1" class="([^"]+)"/.exec(html)?.[1]?.split(' ') ?? []
    const cls = /class="([^"]*)"/.exec(recentItem(html))?.[1]?.split(' ') ?? []
    expect(plain.length).toBeGreaterThan(5)
    for (const c of plain) expect(cls, c).toContain(c)
  })

  it('沒有 recent（別的 Office 殼層還沒接、或舊呼叫）：輸出與加入口之前完全相同——有 recent 的輸出去掉入口那一塊就是它', () => {
    const without = renderToStaticMarkup(<FileMenuList {...menuProps} />)
    const withRecent = renderToStaticMarkup(<FileMenuList {...menuProps} recent={recent()} />)
    expect(without).not.toContain('data-file-recent')
    const block = /<div role="none" class="relative">.*?<\/button><\/div>/.exec(withRecent)?.[0] ?? ''
    expect(block).toContain('data-file-recent=""')
    expect(withRecent.replace(block, '')).toBe(without)
    // 裝飾項目與原本兩項不變
    expect(menuItems(without)).toEqual(['切換偽裝…', '說明…'])
    expect(without.match(/aria-hidden="true"/g)).toHaveLength(7)
  })
})

describe('「檔案」按鈕（FileTab）：開啟選單時呼叫 refresh', () => {
  /** 假的按鈕 ref（toggle 只用到 getBoundingClientRect） */
  const buttonRef = { current: { getBoundingClientRect: () => ({ left: 4, bottom: 28 }), focus: noop } as unknown as HTMLButtonElement }

  it('點「檔案」開啟選單 → 呼叫 recent.onRefresh 一次（另一個分頁可能寫了新紀錄）', () => {
    const onRefresh = vi.fn()
    const tree = elementsOf(() => FileTab({ buttonRef, onSwitchTheme: noop, onHelp: noop, recent: recent({ onRefresh }) }))
    const [button] = findElements(tree, (el) => el.type === 'button')
    expect(button?.props['aria-haspopup']).toBe('menu')
    expect(onRefresh).not.toHaveBeenCalled()
    ;(button?.props.onClick as () => void)()
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('選單開不起來（按鈕還沒掛載）就不呼叫；沒有 recent 也照常開', () => {
    const onRefresh = vi.fn()
    const unmounted = elementsOf(() => FileTab({ buttonRef: { current: null }, onSwitchTheme: noop, recent: recent({ onRefresh }) }))
    ;(findElements(unmounted, (el) => el.type === 'button')[0]?.props.onClick as () => void)()
    expect(onRefresh).not.toHaveBeenCalled()
    const plain = elementsOf(() => FileTab({ buttonRef, onSwitchTheme: noop }))
    expect(() => (findElements(plain, (el) => el.type === 'button')[0]?.props.onClick as () => void)()).not.toThrow()
  })

  it('只在「開啟」時重讀（關閉選單那一下不重讀）；選一列 → 先關選單、焦點還給「檔案」，再開啟那一筆', () => {
    const source = sourceOf('FileMenu.tsx')
    expect(source).toMatch(/if \(menu !== null\) \{\s*setMenu\(null\)\s*return\s*\}[\s\S]*?setMenu\(\{ left: r\.left, top: r\.bottom \}\)\s*recent\?\.onRefresh\(\)/)
    expect(source).toMatch(/onOpen: \(id\) => \{\s*close\(true\)\s*recent\.onOpen\(id\)\s*\}/)
  })

  it('自動重連畫面（沒有 onSwitchTheme）：「檔案」是裝飾，沒有入口', () => {
    const html = renderToStaticMarkup(<FileTab buttonRef={{ current: null }} recent={recent()} />)
    expect(html).toMatch(/^<span aria-hidden="true"/)
  })

  it('功能區把 recent 交給「檔案」；自動重連畫面的功能區沒有', () => {
    const tree = elementsOf(() => Ribbon({ fallback: '常用', fileRef: { current: null }, onSwitchTheme: noop, onHelp: noop, recent: recent() }))
    const [tab] = findElements(tree, (el) => el.type === FileTab)
    expect((tab?.props.recent as FileMenuRecent | undefined)?.label).toBe('開啟最近的簡報')
    const resume = elementsOf(() => Ribbon({ fallback: '常用', fileRef: { current: null } }))
    expect(findElements(resume, (el) => el.type === FileTab)[0]?.props.recent).toBeUndefined()
  })
})

describe('選單鍵盤（officeLayout.fileMenuKeyAction；比照原本的 ↑↓／Home／End／Esc／Tab）', () => {
  const key = (k: string, patch: Partial<Parameters<typeof fileMenuKeyAction>[0]> = {}) =>
    fileMenuKeyAction({ key: k, inSub: false, onExpandable: false, count: 3, current: 0, ...patch })

  it('最上層：↑↓ 循環、Home／End（入口算第三項）；Esc／Tab 關閉整個選單', () => {
    expect(key('ArrowDown', { current: 1 })).toEqual({ type: 'focus', index: 2 })
    expect(key('ArrowDown', { current: 2 })).toEqual({ type: 'focus', index: 0 })
    expect(key('ArrowUp', { current: 0 })).toEqual({ type: 'focus', index: 2 })
    expect(key('Home', { current: 2 })).toEqual({ type: 'focus', index: 0 })
    expect(key('End')).toEqual({ type: 'focus', index: 2 })
    expect(key('Escape')).toEqual({ type: 'close' })
    expect(key('Tab')).toEqual({ type: 'close' })
  })

  it('→：焦點在入口且可開才展開；灰化、或焦點在別項不動作', () => {
    expect(key('ArrowRight', { current: 2, onExpandable: true })).toEqual({ type: 'open-sub' })
    expect(key('ArrowRight', { current: 2, onExpandable: false })).toBeNull()
    expect(key('ArrowRight', { current: 0 })).toBeNull()
    expect(key('ArrowLeft', { current: 2, onExpandable: true })).toBeNull()
  })

  it('子清單裡：↑↓／Home／End 在各列間循環；←／Esc 只收起子清單；Tab 關閉整個選單；→ 不動作', () => {
    const sub = { inSub: true, count: 5 }
    expect(key('ArrowDown', { ...sub, current: 4 })).toEqual({ type: 'focus', index: 0 })
    expect(key('ArrowUp', { ...sub, current: 0 })).toEqual({ type: 'focus', index: 4 })
    expect(key('End', { ...sub, current: 1 })).toEqual({ type: 'focus', index: 4 })
    expect(key('ArrowLeft', sub)).toEqual({ type: 'close-sub' })
    expect(key('Escape', sub)).toEqual({ type: 'close-sub' })
    expect(key('Tab', sub)).toEqual({ type: 'close' })
    expect(key('ArrowRight', sub)).toBeNull()
    // 只有一列（沒有紀錄的灰字）：停在原地
    expect(key('ArrowDown', { inSub: true, count: 1, current: 0 })).toEqual({ type: 'focus', index: 0 })
  })

  it('其他按鍵（Enter／Space 走按鈕的原生 click）不攔截', () => {
    for (const k of ['Enter', ' ', 'a']) {
      expect(key(k)).toBeNull()
      expect(key(k, { inSub: true })).toBeNull()
    }
  })

  it('元件照這份規則處理按鍵（原始碼守門）', () => {
    const source = sourceOf('FileMenu.tsx')
    expect(source).toContain('const action = fileMenuKeyAction({')
    expect(source).toContain('onExpandable: focused === recentRef.current && recent?.enabled === true')
    expect(source).toMatch(/case 'close-sub':\s*closeSub\(\)/)
    expect(source).toMatch(/function closeSub\(\) \{\s*setSubOpen\(false\)\s*recentRef\.current\?\.focus\(\)/)
  })
})

// ─── 檢視：投影片區、備忘稿列、狀態列中央 ──────────────────────────────────

const roundState = (patch: Partial<ShellRoundState> = {}): ShellRoundState => ({
  phase: 'idle',
  isSetter: false,
  canDraw: false,
  showCanvas: false,
  submitted: false,
  showReveal: false,
  ...patch,
})

const shellHistory = (patch: Partial<ShellHistory> = {}): ShellHistory => ({
  entries: ENTRIES,
  openId: null,
  canOpen: true,
  open: vi.fn(),
  close: vi.fn(),
  refresh: vi.fn(),
  ...patch,
})

const slot = (name: string) => <span data-slot={name} />

/** PptShell（game）交給外框的 props：PptShell 與 GameScreen 都沒有 hook，可直接當函式呼叫取得元素 */
function frameProps(history: ShellHistory, round: ShellRoundState = roundState()) {
  const props: ShellProps = {
    screen: 'game',
    round,
    counts: { online: 2, total: 2 },
    themes: { current: 'ppt', options: [], select: noop },
    help: { open: noop },
    history,
    players: slot('players'),
    canvas: slot('canvas'),
    toolbar: slot('toolbar'),
    finish: slot('finish'),
    reveal: slot('reveal'),
    reference: slot('reference'),
    historyView: slot('historyView'),
    historyStatus: slot('historyStatus'),
    chat: slot('chat'),
    roundStatus: slot('roundStatus'),
    volunteer: slot('volunteer'),
    connection: slot('connection'),
    dialogs: slot('dialogs'),
  }
  const provider = PptShell(props) as AnyElement
  const game = provider.props.children as AnyElement
  const frame = (game.type as (p: unknown) => AnyElement)(game.props)
  return frame.props as {
    slide: ReactNode
    notes: ReactNode
    recent: FileMenuRecent
    onCloseRecent: (() => void) | undefined
    ribbonDefault: string
  }
}

describe('ppt 殼層：ShellProps.history 的接線', () => {
  it('入口的資料與動作原樣來自 history：entries、canOpen → enabled、open、refresh；字樣是殼層的', () => {
    const history = shellHistory({ canOpen: false })
    const { recent: r } = frameProps(history)
    expect(r.label).toBe('開啟最近的簡報')
    expect(r.emptyLabel).toBe('沒有最近的簡報')
    expect(r.entries).toBe(history.entries)
    expect(r.enabled).toBe(false)
    expect(r.onOpen).toBe(history.open)
    expect(r.onRefresh).toBe(history.refresh)
    expect(frameProps(shellHistory({ canOpen: true })).recent.enabled).toBe(true)
  })

  it('沒有在看歷史（openId 為 null）：投影片區、備忘稿列、狀態列中央照原樣', () => {
    const p = frameProps(shellHistory(), roundState({ phase: 'ended', showReveal: true }))
    expect(renderToStaticMarkup(<>{p.slide}</>)).toBe('<span data-slot="reveal"></span>')
    const notes = renderToStaticMarkup(<>{p.notes}</>)
    expect(notes).toContain('備忘稿：')
    expect(notes).toContain('data-slot="roundStatus"')
    expect(notes).not.toContain('historyStatus')
    expect(p.onCloseRecent).toBeUndefined()
  })

  it.each([
    ['idle（無結果）', roundState({ phase: 'idle' })],
    ['ended（有結果）', roundState({ phase: 'ended', showReveal: true })],
    ['choosing（別人出題）', roundState({ phase: 'choosing' })],
  ])('看歷史中（openId 非 null）%s：投影片區＝historyView、備忘稿列＝historyStatus、功能區「常用」、狀態列中央給關閉', (_name, round) => {
    const history = shellHistory({ openId: 2000 })
    const p = frameProps(history, round)
    expect(renderToStaticMarkup(<>{p.slide}</>)).toBe('<span data-slot="historyView"></span>')
    const notes = renderToStaticMarkup(<>{p.notes}</>)
    expect(notes).toContain('備忘稿：')
    expect(notes).toContain('data-slot="historyStatus"')
    expect(notes).not.toContain('roundStatus')
    expect(p.ribbonDefault).toBe('常用')
    expect(p.onCloseRecent).toBe(history.close)
  })

  it('SlideArea：recent 優先於揭曉畫廊與自己的畫布；沒有 recent（null／省略）時行為不變', () => {
    const area = (round: ShellRoundState, r?: ReactNode) =>
      renderToStaticMarkup(<SlideArea round={round} canvas={slot('canvas')} reveal={slot('reveal')} recent={r} />)
    expect(area(roundState({ showReveal: true }), slot('historyView'))).toBe('<span data-slot="historyView"></span>')
    expect(area(roundState({ showCanvas: true, phase: 'drawing' }), slot('historyView'))).toBe('<span data-slot="historyView"></span>')
    expect(area(roundState(), slot('historyView'))).toBe('<span data-slot="historyView"></span>')
    for (const round of [roundState({ showReveal: true }), roundState({ showCanvas: true, phase: 'drawing' }), roundState()]) {
      expect(area(round, null)).toBe(area(round))
      expect(area(round)).not.toContain('historyView')
    }
  })
})

describe('「關閉簡報」（狀態列中央；design §2「歷史檢視」列）', () => {
  it('一顆按鈕：文字「關閉簡報」、data-history-close、狀態列可點項目的外觀（token class）；沒有停用屬性', () => {
    const html = renderToStaticMarkup(<CloseRecent onClose={noop} />)
    expect(html).toMatch(/^<button type="button" data-history-close="" class="[^"]*">/)
    expect(html.replace(/<svg.*?<\/svg>/, '')).toMatch(/>關閉簡報<\/button>$/)
    const cls = /class="([^"]*)"/.exec(html)?.[1]?.split(' ') ?? []
    for (const c of ['h-full', 'cursor-pointer', 'hover:bg-statusbar-hover', 'focus-visible:outline-border-focus']) expect(cls, c).toContain(c)
    expect(html).not.toMatch(/disabled/)
    expect(html.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull()
  })

  it('按下呼叫 onClose', () => {
    const onClose = vi.fn()
    const [button] = findElements(CloseRecent({ onClose }), (el) => el.type === 'button')
    ;(button?.props.onClick as () => void)()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('外框：有 onCloseRecent 時狀態列中央改放這顆按鈕（取代「我出題」），按下後關閉並把焦點還給「檔案」（原始碼守門）', () => {
    const shell = sourceOf('PptShell.tsx')
    expect(shell).toMatch(/onCloseRecent !== undefined \? \(\s*<CloseRecent\s+onClose=\{\(\) => \{\s*onCloseRecent\(\)[\s\S]*?fileRef\.current\?\.focus\(\)\s*\}\}\s*\/>\s*\) : \(\s*statusCenter\s*\)/)
    expect(shell).toContain('onCloseRecent={viewing ? history.close : undefined}')
    expect(shell).toContain('{viewing ? historyStatus : roundStatus}')
  })
})

// ─── App 與 socket 的銜接（原始碼守門；行為在 historyStore.test.ts 與 sessionResume.test.ts） ───────────

describe('App 與 socket 的銜接', () => {
  it('App：掛載時啟動歷史（同自動交卷），把清單、開著的 id、可否開啟與開關注入殼層；兩個插槽放功能元件', () => {
    const app = sourceOf('App.tsx')
    expect(app).toContain('useEffect(() => startHistory(), [])')
    expect(app).toContain('history={history}')
    expect(app).toContain('historyView={<HistoryView />}')
    expect(app).toContain('historyStatus={<HistoryStatus />}')
    expect(app).toContain('entries: historyMenuEntries(historyRecords)')
    expect(app).toContain('canOpen: canOpenHistory')
    expect(app).toContain('const canOpenHistory = canViewHistory({ joined, phase, isSetter })')
    expect(app).toMatch(/open: openHistory,\s*close: closeHistory,\s*refresh: \(\) => void refreshHistory\(\),/)
  })

  it('socket/client：contest:gallery 多呼叫一次 recordGalleryImage（未加入時兩個都不呼叫）；其餘事件處理不變', () => {
    const client = sourceOf('client.ts')
    expect(client).toMatch(
      /socket\.on\('contest:gallery', \(image\) => \{\s*if \(store\(\)\.me === null\) return\s*store\(\)\.addGalleryImage\(image\)\s*recordGalleryImage\(image\)\s*\}\)/,
    )
    expect(client.match(/recordGalleryImage/g)).toHaveLength(2)
    expect(client).toContain("if (store().me !== null) store().applyComment(update)")
    expect(client).toContain("if (store().me !== null) store().setRound(round)")
  })
})
