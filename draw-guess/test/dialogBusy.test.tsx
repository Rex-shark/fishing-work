// 對話框送出中（DialogProps.busy）不失焦（plan/notes.md 2026-10-12「出題對話框送出失敗後鍵盤失靈」）：
//   殼層的輸入框在 busy 時是 readOnly＋aria-busy、不是原生 disabled（被停用的元素會失去焦點，Esc／Enter 掛在對話框上就收不到）；
//   busy 結束後的保險（焦點不在對話框內 → 放回輸入框，沒有輸入框放回第一個可用選項）；出題／放棄確認交給殼層的 props。
//   三個殼層對話框元件都驗：vscode QuickInput（VscodeDialog）、OfficeDialog（PptDialog、ExcelDialog）、MeetDialog。
// 測試環境的限制：本專案的 Vitest 沒有 DOM 環境（沒有 jsdom／happy-dom），真正的 document.activeElement 與按鍵事件測不到
//   （瀏覽器「停用的元素失去焦點」這件事本身也只能靠瀏覽器實測）。這裡以最接近的方式驗：
//   (1) 靜態渲染的屬性（瀏覽器只會讓 disabled 的元素失焦，readOnly 不會）；
//   (2) 焦點還原的純邏輯，DOM 以「從靜態渲染結果解析出來的假節點」代入（選擇器真的拿去比對渲染出來的屬性）；
//   (3) 功能元件的狀態流程：Dialog 換成記錄 props、不輸出 DOM 的假元件，用 client renderer 掛在假容器上，
//       讓 busy 真的由 true 轉回 false，再驗失敗後 Esc（onEscape）觸發放棄、Enter（第一個選項）可以再送出。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, useRef, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { CancelConfirm } from '../src/features/round/CancelConfirm'
import { TopicDialog } from '../src/features/round/TopicDialog'
import { HELP_TOPICS } from '../src/features/help/helpTopics'
import { useUiStore } from '../src/layout/uiStore'
import {
  DIALOG_OPTION_ATTR,
  DIALOG_REFOCUS_SELECTORS,
  busyEnded,
  restoreDialogFocus,
  useRestoreDialogFocus,
  type DialogFocusRoot,
} from '../src/shells/dialogFocus'
import { ExcelDialog } from '../src/shells/excel/ExcelDialog'
import { MeetDialog } from '../src/shells/meet/MeetDialog'
import { MEET_DIALOG_REFOCUS_SELECTORS } from '../src/shells/meet/meetLayout'
import { PptDialog } from '../src/shells/ppt/PptDialog'
import { ShellViewsContext, type DialogField, type DialogProps, type ShellViews } from '../src/shells/views'
import { QuickInput, VscodeDialog } from '../src/shells/vscode/QuickInput'
import { cancelRound, setTopic, type ActionOutcome } from '../src/socket/client'
import { initialGameState, initialRound, useGameStore } from '../src/store/game'

// 出題與放棄確認只用到這兩個動作；不載入真的 socket
vi.mock('../src/socket/client', () => ({ setTopic: vi.fn(), cancelRound: vi.fn() }))

const dialogSources = import.meta.glob<string>(
  ['../src/shells/office/OfficeDialog.tsx', '../src/shells/meet/MeetDialog.tsx', '../src/shells/vscode/QuickInput.tsx'],
  { query: '?raw', import: 'default', eager: true },
)

const noop = () => {}

/** 四套殼層的 Dialog（ppt、excel 共用 OfficeDialog） */
const DIALOGS = { vscode: VscodeDialog, ppt: PptDialog, excel: ExcelDialog, meet: MeetDialog }
const SHELLS = Object.keys(DIALOGS) as (keyof typeof DIALOGS)[]
/** 各殼層 busy 結束後的落點順序（meet 的按鈕 DOM 順序相反，有自己的） */
const SELECTORS: Record<keyof typeof DIALOGS, readonly string[]> = {
  vscode: DIALOG_REFOCUS_SELECTORS,
  ppt: DIALOG_REFOCUS_SELECTORS,
  excel: DIALOG_REFOCUS_SELECTORS,
  meet: MEET_DIALOG_REFOCUS_SELECTORS,
}

/** 出題對話框交給殼層的 props（同 TopicDialog 的形狀）；busy 時兩個選項都停用 */
const topicProps = (busy: boolean): DialogProps => ({
  purpose: 'topic',
  label: '出題',
  busy,
  input: { value: '', onChange: noop, placeholder: '輸入題目（1–20 字）後按 Enter', ariaLabel: '題目', maxLength: 80, invalid: !busy, enterKeyHint: 'go' },
  items: [
    { id: 'submit', label: busy ? '送出中…' : '出題並開始作畫', detail: '0/20', onSelect: noop, disabled: busy },
    { id: 'cancel', label: '放棄本回合', detail: 'Esc', onSelect: noop, disabled: busy },
  ],
  onEscape: noop,
  error: busy ? null : '題目不可空白',
})

/** 放棄確認的形狀（沒有輸入框；同 CancelConfirm） */
const confirmProps = (patch: Partial<DialogProps> = {}): DialogProps => ({
  purpose: 'cancelRound',
  label: '放棄本回合',
  title: '放棄這一回合？題目會直接揭曉。',
  items: [
    { id: 'confirm', label: '放棄本回合', detail: 'Enter', onSelect: noop },
    { id: 'keep', label: '繼續作畫', detail: 'Esc', onSelect: noop },
  ],
  onEscape: noop,
  ...patch,
})

const inputTag = (html: string) => /<input [^>]*>/.exec(html)?.[0] ?? ''
const NATIVE_DISABLED = /\sdisabled(?:=|\s|\/?>)/

// ─── (1) 靜態渲染：busy 的呈現 ─────────────────────────────────────────

describe.each(SHELLS)('%s 對話框的輸入框：送出中是 readOnly＋aria-busy，不是原生 disabled', (shell) => {
  const Dialog = DIALOGS[shell]
  const busy = renderToStaticMarkup(<Dialog {...topicProps(true)} />)
  const idle = renderToStaticMarkup(<Dialog {...topicProps(false)} />)

  it('busy：readonly、aria-busy="true"，沒有 disabled 屬性（不會因此失去焦點）', () => {
    const input = inputTag(busy)
    expect(input).toContain(' readOnly=""')
    expect(input).toContain(' aria-busy="true"')
    expect(input).not.toMatch(NATIVE_DISABLED)
    // 開啟時的預設焦點仍在輸入框
    expect(input).toContain(' autofocus=""')
  })

  it('busy：整個對話框沒有任何原生 disabled（選項只設 aria-disabled）', () => {
    expect(busy).not.toMatch(NATIVE_DISABLED)
    expect(busy.match(/aria-disabled="true"/g)).toHaveLength(2)
  })

  it('不是 busy：沒有 readonly 與 aria-busy（可編輯）', () => {
    const input = inputTag(idle)
    expect(input).not.toMatch(/\sreadonly/i)
    expect(input).not.toMatch(/\saria-busy=/)
    expect(input).not.toMatch(NATIVE_DISABLED)
    expect(input).toContain(' autofocus=""')
    expect(input).toContain(' aria-invalid="true"')
  })

  it('外觀：送出中的透明度改掛在 aria-busy（與原本 disabled 時相同的 60%）；不再有 disabled: 的樣式', () => {
    for (const html of [busy, idle]) {
      const cls = /class="([^"]*)"/.exec(inputTag(html))?.[1]?.split(' ') ?? []
      expect(cls).toContain('aria-busy:opacity-60')
      expect(cls).toContain('aria-busy:cursor-default')
      expect(cls.filter((c) => c.startsWith('disabled:'))).toEqual([])
      // 其餘外觀不變
      for (const c of ['bg-input', 'outline-none', 'block', 'w-full']) expect(cls, c).toContain(c)
    }
  })

  it('省略 busy 等同不是 busy', () => {
    const { busy: _omit, ...rest } = topicProps(false)
    void _omit
    expect(renderToStaticMarkup(<Dialog {...rest} />)).toBe(idle)
  })

  it('沒有輸入框的對話框（放棄確認）：busy 不改變輸出，選項本來就只用 aria-disabled', () => {
    const sending = confirmProps()
    sending.items = [{ ...sending.items[0]!, label: '放棄中…', disabled: true }, sending.items[1]!]
    const html = renderToStaticMarkup(<Dialog {...sending} />)
    expect(renderToStaticMarkup(<Dialog {...sending} busy />)).toBe(html)
    expect(html).not.toMatch(NATIVE_DISABLED)
    expect(html).not.toMatch(/readonly|aria-busy/i)
  })
})

describe('型別與原始碼守門', () => {
  it('DialogField 沒有 disabled（送出中改由 DialogProps.busy 表達，殼層不會再把它展開成原生 disabled）', () => {
    const field: DialogField = { value: '', onChange: noop, placeholder: '', ariaLabel: '' }
    // @ts-expect-error DialogField 不接受 disabled
    const bad: DialogField = { ...field, disabled: true }
    expect(Object.keys(field)).not.toContain('disabled')
    expect(bad).toBeDefined()
  })

  it('三個殼層對話框元件的 JSX 都沒有原生 disabled 屬性；輸入框用 readOnly 與 aria-busy，並掛上焦點還原', () => {
    const files = Object.keys(dialogSources).map((f) => f.replace('../src/shells/', '')).sort()
    expect(files).toEqual(['meet/MeetDialog.tsx', 'office/OfficeDialog.tsx', 'vscode/QuickInput.tsx'])
    for (const [file, src] of Object.entries(dialogSources)) {
      expect(src, file).not.toMatch(/\sdisabled=\{/)
      expect(src, file).toContain('readOnly={busy}')
      expect(src, file).toContain('aria-busy={busy || undefined}')
      expect(src, file).toMatch(/useRestoreDialogFocus\(busy, rootRef[,)]/)
      expect(src, file).toContain('ref={rootRef}')
      expect(src, file).toContain(`${DIALOG_OPTION_ATTR}=""`)
    }
    // 正向對照：規則抓得到舊寫法
    expect(/\sdisabled=\{/.test('<input disabled={input.disabled} />')).toBe(true)
    expect(/\sdisabled=\{/.test('<button aria-disabled={item.disabled || undefined} />')).toBe(false)
  })

  it('QuickInput 本身（VscodeDialog 的底層，也用於切換偽裝的選單）：busy 同樣是 readOnly＋aria-busy；省略時輸出不變', () => {
    const { input, items } = topicProps(true)
    const props = { label: '出題', input, items }
    const tag = inputTag(renderToStaticMarkup(<QuickInput {...props} busy />))
    expect(tag).toContain(' readOnly=""')
    expect(tag).toContain(' aria-busy="true"')
    expect(tag).not.toMatch(NATIVE_DISABLED)
    expect(renderToStaticMarkup(<QuickInput {...props} busy={false} />)).toBe(renderToStaticMarkup(<QuickInput {...props} />))
  })
})

// ─── (2) 焦點還原（純邏輯；DOM 以靜態渲染結果解析出的假節點代入） ───────────────

interface FakeNode {
  tag: string
  attrs: Record<string, string>
  focus: ReturnType<typeof vi.fn<() => void>>
}

/** 從靜態渲染的 HTML 取出所有 input／button／ul（依文件順序；ul 是 vscode 承接焦點的選單） */
function parseNodes(html: string): FakeNode[] {
  return [...html.matchAll(/<(input|button|ul)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*\/?>/g)].map((m) => ({
    tag: m[1] ?? '',
    attrs: Object.fromEntries([...(m[2] ?? '').matchAll(/([^\s=]+)(?:="([^"]*)")?/g)].map((a) => [(a[1] ?? '').toLowerCase(), a[2] ?? ''])),
    focus: vi.fn<() => void>(),
  }))
}

/** 迷你選擇器比對：只支援本檔用到的寫法（tag、[attr]、[attr="值"]、:not([attr])、:not([attr="值"])） */
function matches(node: FakeNode, selector: string): boolean {
  const tag = /^[a-z]+/.exec(selector)?.[0]
  if (tag !== undefined && tag !== node.tag) return false
  let rest = selector.slice(tag?.length ?? 0)
  while (rest !== '') {
    const not = /^:not\(\[([^\]=]+)(?:="([^"]*)")?\]\)/.exec(rest)
    const has = /^\[([^\]=]+)(?:="([^"]*)")?\]/.exec(rest)
    if (not !== null) {
      const [, name = '', value] = not
      if (value === undefined ? name in node.attrs : node.attrs[name] === value) return false
      rest = rest.slice(not[0].length)
    } else if (has !== null) {
      const [, name = '', value] = has
      if (value === undefined ? !(name in node.attrs) : node.attrs[name] !== value) return false
      rest = rest.slice(has[0].length)
    } else {
      throw new Error(`測試的迷你選擇器不支援：${selector}`)
    }
  }
  return true
}

/** 假的對話框根節點：nodes 都在對話框內 */
function fakeRoot(nodes: FakeNode[]): DialogFocusRoot & { queried: string[] } {
  const queried: string[] = []
  return {
    queried,
    contains: (node) => nodes.some((n) => n === node),
    querySelector: (selector) => {
      queried.push(selector)
      return nodes.find((n) => matches(n, selector)) ?? null
    },
  }
}

const BODY = { tag: 'body' }
const focused = (nodes: FakeNode[]) => nodes.filter((n) => n.focus.mock.calls.length > 0)
const nameOf = (n: FakeNode | undefined) => n?.attrs['aria-label'] ?? n?.tag
const nodesOf = (shell: keyof typeof DIALOGS, props: DialogProps) => {
  const Dialog = DIALOGS[shell]
  return parseNodes(renderToStaticMarkup(<Dialog {...props} />))
}

describe('busy 結束後的焦點還原（restoreDialogFocus）', () => {
  it('busyEnded：只有 true → false 才算結束', () => {
    expect(busyEnded(true, false)).toBe(true)
    expect(busyEnded(false, false)).toBe(false)
    expect(busyEnded(false, true)).toBe(false)
    expect(busyEnded(true, true)).toBe(false)
  })

  it('落點的順序：輸入框 → 第一個可用的選項（未停用、未 aria-disabled）；meet 在兩者之間先找主要按鈕', () => {
    expect(DIALOG_OPTION_ATTR).toBe('data-dialog-option')
    expect(DIALOG_REFOCUS_SELECTORS).toEqual(['input:not([disabled])', '[data-dialog-option]:not([disabled]):not([aria-disabled="true"])'])
    expect(MEET_DIALOG_REFOCUS_SELECTORS).toEqual([
      'input:not([disabled])',
      '[data-dialog-option][type="submit"]:not([disabled]):not([aria-disabled="true"])',
      '[data-dialog-option]:not([disabled]):not([aria-disabled="true"])',
    ])
  })

  it('各殼層出題對話框的節點（文件順序）：ppt／excel 的第一個按鈕是標題列的關閉鈕、meet 的主要按鈕在最後、vscode 是輸入框＋選單', () => {
    expect(nodesOf('ppt', topicProps(false)).map((n) => n.tag)).toEqual(['button', 'input', 'button', 'button'])
    expect(nodesOf('excel', topicProps(false)).map((n) => n.tag)).toEqual(['button', 'input', 'button', 'button'])
    expect(nodesOf('meet', topicProps(false)).map((n) => [n.tag, n.attrs.type])).toEqual([
      ['input', undefined],
      ['button', 'button'],
      ['button', 'submit'],
    ])
    expect(nodesOf('vscode', topicProps(false)).map((n) => n.tag)).toEqual(['input', 'ul'])
  })

  it.each(SHELLS)('%s 出題對話框送出失敗後（busy 結束、焦點掉到 body 或沒有焦點）：放回輸入框', (shell) => {
    for (const active of [BODY, null]) {
      const nodes = nodesOf(shell, topicProps(false))
      expect(restoreDialogFocus(fakeRoot(nodes), active, SELECTORS[shell])).toBe(true)
      expect(focused(nodes).map((n) => n.tag)).toEqual(['input'])
      expect(focused(nodes)[0]?.focus).toHaveBeenCalledTimes(1)
    }
  })

  it.each(SHELLS)('%s：焦點還在對話框內（留在輸入框、或使用者已移到別的按鈕）：不動', (shell) => {
    const nodes = nodesOf(shell, topicProps(false))
    for (const active of nodes) {
      const root = fakeRoot(nodes)
      expect(restoreDialogFocus(root, active, SELECTORS[shell])).toBe(false)
      expect(root.queried).toEqual([])
    }
    expect(focused(nodes)).toEqual([])
  })

  it.each(SHELLS)('%s：送出中的輸入框（readOnly）仍是合法落點：不是 disabled', (shell) => {
    const nodes = nodesOf(shell, topicProps(true))
    expect(nodes.find((n) => n.tag === 'input')?.attrs).toHaveProperty('readonly')
    expect(restoreDialogFocus(fakeRoot(nodes), BODY, SELECTORS[shell])).toBe(true)
    expect(focused(nodes).map((n) => n.tag)).toEqual(['input'])
  })

  it('ppt／excel 沒有輸入框（放棄確認）：放回第一個選項（主要按鈕），不是標題列的關閉鈕', () => {
    for (const [shell, primary, secondary] of [
      ['ppt', '確定：放棄本回合', '取消：繼續作畫'],
      ['excel', '刪除：放棄本回合', '取消：繼續作畫'],
    ] as const) {
      const nodes = nodesOf(shell, confirmProps())
      expect(nodes.map(nameOf)).toEqual(['關閉', primary, secondary])
      // 標題列的關閉鈕沒有選項標記
      expect(nodes.map((n) => DIALOG_OPTION_ATTR in n.attrs)).toEqual([false, true, true])
      const root = fakeRoot(nodes)
      expect(restoreDialogFocus(root, BODY)).toBe(true)
      expect(focused(nodes).map(nameOf)).toEqual([primary])
      expect(root.queried).toEqual([...DIALOG_REFOCUS_SELECTORS])
    }
  })

  it('meet 沒有輸入框：放回主要按鈕（第一個選項，DOM 在最後）；照預設的 DOM 順序會落在次要按鈕，所以 meet 有自己的順序', () => {
    const nodes = nodesOf('meet', confirmProps())
    expect(nodes.map(nameOf)).toEqual(['繼續分享：繼續作畫', '停止分享：放棄本回合'])
    expect(nodes.map((n) => DIALOG_OPTION_ATTR in n.attrs)).toEqual([true, true])
    expect(restoreDialogFocus(fakeRoot(nodes), BODY, MEET_DIALOG_REFOCUS_SELECTORS)).toBe(true)
    expect(focused(nodes).map(nameOf)).toEqual(['停止分享：放棄本回合'])
    // 對照：預設順序
    const byDom = nodesOf('meet', confirmProps())
    restoreDialogFocus(fakeRoot(byDom), BODY)
    expect(focused(byDom).map(nameOf)).toEqual(['繼續分享：繼續作畫'])
  })

  it('vscode 沒有輸入框：選項不可聚焦，放回選單（listbox，tabindex 0）', () => {
    const nodes = nodesOf('vscode', confirmProps())
    expect(nodes.map((n) => [n.tag, n.attrs.role, n.attrs.tabindex, DIALOG_OPTION_ATTR in n.attrs])).toEqual([['ul', 'listbox', '0', true]])
    expect(restoreDialogFocus(fakeRoot(nodes), BODY)).toBe(true)
    expect(focused(nodes)).toEqual(nodes)
  })

  it.each(['ppt', 'excel', 'meet'] as const)('%s 沒有輸入框且第一個選項不可用（aria-disabled）：放回下一個可用的選項', (shell) => {
    const props = confirmProps()
    const nodes = nodesOf(shell, { ...props, items: [{ ...props.items[0]!, disabled: true }, props.items[1]!] })
    expect(restoreDialogFocus(fakeRoot(nodes), BODY, SELECTORS[shell])).toBe(true)
    expect(focused(nodes)).toHaveLength(1)
    expect(nameOf(focused(nodes)[0])).toMatch(/：繼續作畫$/)
  })

  it.each(['ppt', 'excel', 'meet'] as const)('%s 說明的主題清單（沒有輸入框）：每一列都有選項標記，放回第一列', (shell) => {
    const items = HELP_TOPICS.map((t) => ({ id: t.id, label: t.title, onSelect: noop }))
    const nodes = nodesOf(shell, { purpose: 'help', label: '說明', title: '說明', items, onEscape: noop })
    // 標題列與右下的「關閉」沒有標記
    const options = nodes.filter((n) => DIALOG_OPTION_ATTR in n.attrs)
    expect(options).toHaveLength(HELP_TOPICS.length)
    expect(restoreDialogFocus(fakeRoot(nodes), BODY, SELECTORS[shell])).toBe(true)
    expect(focused(nodes)).toEqual([options[0]])
  })

  it.each(['ppt', 'excel', 'meet'] as const)('%s 沒有任何落點（全部選項都不可用、也沒有輸入框）：不動，回 false', (shell) => {
    const props = confirmProps()
    const nodes = nodesOf(shell, { ...props, items: props.items.map((i) => ({ ...i, disabled: true })) })
    expect(restoreDialogFocus(fakeRoot(nodes), BODY, SELECTORS[shell])).toBe(false)
    expect(focused(nodes)).toEqual([])
  })
})

// ─── (3) 狀態流程（client renderer＋假容器；不輸出任何 DOM 元素） ───────────────────

/**
 * 沒有 DOM 環境也能跑 client renderer 的最小容器：只給「不輸出任何 DOM 元素」的樹用（元件一律回傳 null），讓 state 與 effect 真的更新。
 * React 對容器只讀標籤與命名空間、掛事件，commit 前後讀 ownerDocument.activeElement，更新時讀 window.event；`active` 即 document.activeElement
 */
function mountHeadless() {
  const doc = { nodeType: 9, activeElement: null as unknown, body: null, defaultView: null as unknown, addEventListener: noop, removeEventListener: noop }
  const win = { document: doc, event: undefined, HTMLIFrameElement: class {} }
  doc.defaultView = win
  const container = {
    nodeType: 1,
    nodeName: 'DIV',
    tagName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    ownerDocument: doc,
    addEventListener: noop,
    removeEventListener: noop,
  }
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', doc)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const root = createRoot(container as unknown as Element)
  mounted.push(root)
  return {
    render: (node: ReactNode) => act(async () => root.render(node)),
    set active(el: unknown) {
      doc.activeElement = el
    },
  }
}
const mounted: Root[] = []

afterEach(async () => {
  for (const root of mounted.splice(0)) await act(async () => root.unmount())
  vi.unstubAllGlobals()
  vi.mocked(setTopic).mockReset()
  vi.mocked(cancelRound).mockReset()
  useGameStore.setState({ ...initialGameState })
  useUiStore.setState({ cancelConfirmOpen: false })
})

describe('useRestoreDialogFocus：只在 busy 由 true 轉 false 時還原', () => {
  /** 假的對話框根節點放進 ref（元件裡是 role="dialog" 的 <form>） */
  function Probe({ busy, root, selectors }: { busy: boolean; root: DialogFocusRoot | null; selectors?: readonly string[] }) {
    const rootRef = useRef(root as unknown as HTMLElement | null)
    useRestoreDialogFocus(busy, rootRef, selectors)
    return null
  }

  it('送出失敗後焦點在 body：放回輸入框；之後的重繪不再搶焦點', async () => {
    const nodes = nodesOf('ppt', topicProps(false))
    const root = fakeRoot(nodes)
    const view = mountHeadless()
    view.active = BODY
    await view.render(<Probe busy={false} root={root} />)
    await view.render(<Probe busy root={root} />)
    expect(focused(nodes)).toEqual([])
    await view.render(<Probe busy={false} root={root} />)
    expect(focused(nodes).map((n) => n.tag)).toEqual(['input'])
    await view.render(<Probe busy={false} root={root} />)
    expect(focused(nodes)[0]?.focus).toHaveBeenCalledTimes(1)
  })

  it('焦點沒離開對話框（readOnly 的正常情況）：不動', async () => {
    const nodes = nodesOf('ppt', topicProps(false))
    const view = mountHeadless()
    view.active = nodes[1]
    await view.render(<Probe busy root={fakeRoot(nodes)} />)
    await view.render(<Probe busy={false} root={fakeRoot(nodes)} />)
    expect(focused(nodes)).toEqual([])
  })

  it('一開始就不是 busy、或一直 busy：不動', async () => {
    const nodes = nodesOf('ppt', topicProps(false))
    const root = fakeRoot(nodes)
    const view = mountHeadless()
    view.active = BODY
    await view.render(<Probe busy={false} root={root} />)
    await view.render(<Probe busy root={root} />)
    await view.render(<Probe busy root={root} />)
    expect(focused(nodes)).toEqual([])
    expect(root.queried).toEqual([])
  })

  it('落點順序由殼層給（meet：沒有輸入框時是主要按鈕）；根節點還沒掛上時不動', async () => {
    const nodes = nodesOf('meet', confirmProps())
    const view = mountHeadless()
    view.active = BODY
    await view.render(<Probe busy root={fakeRoot(nodes)} selectors={MEET_DIALOG_REFOCUS_SELECTORS} />)
    await view.render(<Probe busy={false} root={fakeRoot(nodes)} selectors={MEET_DIALOG_REFOCUS_SELECTORS} />)
    expect(focused(nodes).map(nameOf)).toEqual(['停止分享：放棄本回合'])

    const empty = mountHeadless()
    await empty.render(<Probe busy root={null} />)
    await empty.render(<Probe busy={false} root={null} />)
  })
})

/** 以假 Dialog 記錄功能元件交給殼層的 props（回傳 null，不輸出 DOM）；元件掛在假容器上，狀態會真的更新 */
async function mountWithCapture(node: ReactNode) {
  const seen: DialogProps[] = []
  const Dialog = (p: DialogProps) => {
    seen.push(p)
    return null
  }
  const views: ShellViews = { Dialog, PlayerList: () => null }
  const view = mountHeadless()
  await view.render(<ShellViewsContext.Provider value={views}>{node}</ShellViewsContext.Provider>)
  return {
    /** 最近一次交給殼層的 props */
    get props(): DialogProps {
      const last = seen.at(-1)
      if (last === undefined) throw new Error('Dialog 尚未渲染')
      return last
    },
    get renders() {
      return seen.length
    },
  }
}

/** 由測試決定何時回覆的請求（模擬等 server ack 的期間） */
function deferred() {
  let resolve: (r: ActionOutcome) => void = noop
  const promise = new Promise<ActionOutcome>((r) => {
    resolve = r
  })
  /** 回覆並等元件處理完（await 之後的 setState） */
  const settle = (r: ActionOutcome) =>
    act(async () => {
      resolve(r)
      await promise
    })
  return { promise, settle }
}

const FAIL: ActionOutcome = { ok: false, error: 'TOPIC_INVALID', message: '題目不可空白' }

describe('出題對話框（TopicDialog）：送出失敗後 Esc 可放棄、Enter 可再送出', () => {
  function asDrawerChoosing() {
    useGameStore.setState({ me: 'p1', round: { ...initialRound, phase: 'choosing', drawerId: 'p1', endsAt: Date.now() + 30_000 } })
  }

  it('不在出題階段時不渲染', async () => {
    const view = await mountWithCapture(<TopicDialog />)
    expect(view.renders).toBe(0)
  })

  it('props：busy 在對話框層級（初始 false）；input 沒有 disabled 欄位；兩個選項初始可用', async () => {
    asDrawerChoosing()
    const { props } = await mountWithCapture(<TopicDialog />)
    expect(props.purpose).toBe('topic')
    expect(props.busy).toBe(false)
    expect(props.input).toBeDefined()
    expect(Object.keys(props.input ?? {})).not.toContain('disabled')
    expect(props.items.map((i) => [i.id, i.disabled])).toEqual([
      ['submit', false],
      ['cancel', false],
    ])
  })

  it('送出中：busy、兩個選項不可按；四套殼層把輸入框渲染成 readOnly（不是 disabled）；再按 Enter／Esc 不重複送出', async () => {
    asDrawerChoosing()
    const pending = deferred()
    vi.mocked(setTopic).mockReturnValue(pending.promise)
    const view = await mountWithCapture(<TopicDialog />)

    await act(async () => view.props.items[0]?.onSelect())
    expect(setTopic).toHaveBeenCalledTimes(1)
    expect(setTopic).toHaveBeenLastCalledWith('')
    const busy = view.props
    expect(busy.busy).toBe(true)
    expect(Object.keys(busy.input ?? {})).not.toContain('disabled')
    expect(busy.items.map((i) => [i.label, i.disabled])).toEqual([
      ['送出中…', true],
      ['放棄本回合', true],
    ])
    for (const shell of SHELLS) {
      const Dialog = DIALOGS[shell]
      const html = renderToStaticMarkup(<Dialog {...busy} />)
      expect(inputTag(html), shell).toContain(' readOnly="" aria-busy="true"')
      expect(html, shell).not.toMatch(NATIVE_DISABLED)
    }

    // 送出中再按 Enter／Esc：維持現狀，不重複送出、不放棄
    await act(async () => {
      busy.items[0]?.onSelect()
      busy.onEscape?.()
    })
    expect(setTopic).toHaveBeenCalledTimes(1)
    expect(cancelRound).not.toHaveBeenCalled()
    await pending.settle(FAIL)
  })

  it('送出失敗後：busy 解除、顯示錯誤、輸入框可編輯；Enter（第一個選項）再送出一次', async () => {
    asDrawerChoosing()
    const first = deferred()
    vi.mocked(setTopic).mockReturnValueOnce(first.promise)
    const view = await mountWithCapture(<TopicDialog />)
    await act(async () => view.props.items[0]?.onSelect())
    await first.settle(FAIL)

    const failed = view.props
    expect(failed.busy).toBe(false)
    expect(failed.error).toBe('題目不可空白')
    expect(failed.input?.invalid).toBe(true)
    expect(failed.items.map((i) => i.disabled)).toEqual([false, false])
    for (const shell of SHELLS) {
      const Dialog = DIALOGS[shell]
      const html = renderToStaticMarkup(<Dialog {...failed} />)
      expect(inputTag(html), shell).not.toMatch(/\sreadonly|\saria-busy=/i)
      expect(html, shell).not.toMatch(NATIVE_DISABLED)
      expect(html, shell).toMatch(/role="alert"[^>]*>(?:✗ )?題目不可空白</)
    }

    const second = deferred()
    vi.mocked(setTopic).mockReturnValueOnce(second.promise)
    await act(async () => failed.items[0]?.onSelect())
    expect(setTopic).toHaveBeenCalledTimes(2)
    expect(view.props.busy).toBe(true)
    expect(view.props.error).toBeNull()
    await second.settle(FAIL)
    expect(view.props.busy).toBe(false)
  })

  it('送出失敗後：Esc（onEscape）觸發放棄（round:cancel），與第二個選項同一個動作', async () => {
    asDrawerChoosing()
    const first = deferred()
    vi.mocked(setTopic).mockReturnValueOnce(first.promise)
    const view = await mountWithCapture(<TopicDialog />)
    await act(async () => view.props.items[0]?.onSelect())
    await first.settle(FAIL)

    const notDrawer: ActionOutcome = { ok: false, error: 'NOT_DRAWER', message: '你不是本回合的畫師' }
    const byEsc = deferred()
    vi.mocked(cancelRound).mockReturnValueOnce(byEsc.promise)
    await act(async () => view.props.onEscape?.())
    expect(cancelRound).toHaveBeenCalledTimes(1)
    expect(view.props.busy).toBe(true)
    await byEsc.settle(notDrawer)
    expect(view.props.busy).toBe(false)
    expect(view.props.error).toBe('你不是本回合的畫師')

    const byItem = deferred()
    vi.mocked(cancelRound).mockReturnValueOnce(byItem.promise)
    await act(async () => view.props.items[1]?.onSelect())
    expect(cancelRound).toHaveBeenCalledTimes(2)
    await byItem.settle(notDrawer)
    expect(setTopic).toHaveBeenCalledTimes(1)
  })
})

describe('放棄確認（CancelConfirm）：沒有輸入框；送出中交給殼層 busy，失敗後仍可操作', () => {
  const TIMEOUT: ActionOutcome = { ok: false, error: 'TIMEOUT', message: '伺服器沒有回應，請再試一次' }

  it('放棄失敗：busy 解除、顯示錯誤；Enter 可再送出、Esc 關閉', async () => {
    useGameStore.setState({ me: 'p1', round: { ...initialRound, phase: 'drawing', drawerId: 'p1', endsAt: Date.now() + 30_000 } })
    useUiStore.setState({ cancelConfirmOpen: true })
    const first = deferred()
    vi.mocked(cancelRound).mockReturnValueOnce(first.promise)
    const view = await mountWithCapture(<CancelConfirm />)
    expect(view.props.input).toBeUndefined()
    expect(view.props.busy).toBe(false)

    await act(async () => view.props.items[0]?.onSelect())
    expect(view.props.busy).toBe(true)
    expect(view.props.items.map((i) => [i.label, i.disabled])).toEqual([
      ['放棄中…', true],
      ['繼續作畫', undefined],
    ])
    // 送出中再按 Enter：不重複送出
    await act(async () => view.props.items[0]?.onSelect())
    expect(cancelRound).toHaveBeenCalledTimes(1)

    await first.settle(TIMEOUT)
    expect(view.props.busy).toBe(false)
    expect(view.props.error).toBe('伺服器沒有回應，請再試一次')

    const second = deferred()
    vi.mocked(cancelRound).mockReturnValueOnce(second.promise)
    await act(async () => view.props.items[0]?.onSelect())
    expect(cancelRound).toHaveBeenCalledTimes(2)
    await second.settle(TIMEOUT)

    const before = view.renders
    await act(async () => view.props.onEscape?.())
    expect(useUiStore.getState().cancelConfirmOpen).toBe(false)
    // 關閉後對話框不再渲染
    expect(view.renders).toBe(before)
  })
})
