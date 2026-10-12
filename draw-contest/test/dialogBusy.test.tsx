// 對話框送出中（DialogProps.busy）不失焦（plan/notes.md 2026-10-12「輸入標題」對話框送出失敗後鍵盤失效）：
//   殼層的輸入框在 busy 時是 readOnly＋aria-busy、不是原生 disabled（被停用的元素會失去焦點，Esc／Enter 掛在對話框上就收不到）；
//   busy 結束後的保險（焦點不在對話框內 → 放回輸入框，沒有輸入框放回第一個可用選項）；出題對話框交給殼層的 props。
// 測試環境的限制：本專案的 Vitest 沒有 DOM 環境（沒有 jsdom／happy-dom，元件一律 renderToStaticMarkup），
//   真正的 document.activeElement、按鍵事件與 busy 的狀態轉移測不到。這裡以最接近的方式驗：
//   (1) 靜態渲染的屬性（瀏覽器只會讓 disabled 的元素失焦，readOnly 不會）；
//   (2) 焦點還原的純邏輯，DOM 以「從靜態渲染結果解析出來的假節點」代入（選擇器真的拿去比對渲染出來的屬性）；
//   (3) 出題對話框交給殼層的 props 與 Esc／Enter 對應的 callback。實際的焦點行為要靠瀏覽器實測。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { HELP_TOPICS } from '../src/features/help/helpTopics'
import { TopicDialog, TopicForm } from '../src/features/round/TopicDialog'
import {
  DIALOG_OPTION_ATTR,
  DIALOG_REFOCUS_SELECTORS,
  busyEnded,
  restoreDialogFocus,
  type DialogFocusRoot,
} from '../src/shells/office/officeLayout'
import { PptDialog } from '../src/shells/ppt/PptDialog'
import { PPT_VIEWS } from '../src/shells/ppt/pptViews'
import { ShellViewsContext, type DialogField, type DialogProps, type ShellViews } from '../src/shells/views'
import { cancelRound, setTopic } from '../src/socket/client'

// 出題對話框只用到這兩個動作；不載入真的 socket（模組載入時會建立連線物件並讀 sessionStorage）
vi.mock('../src/socket/client', () => ({ setTopic: vi.fn(), cancelRound: vi.fn() }))
// 倒數的 hook 用 useSyncExternalStore 訂閱時鐘、沒有 server snapshot，靜態渲染不了；這裡給固定值（倒數本身在 countdown.test.ts 驗）
vi.mock('../src/features/round/countdown', () => ({ usePhaseRemainingSeconds: () => 45, formatClock: (s: number) => `00:${s}` }))

const officeSource =
  Object.values(import.meta.glob<string>('../src/shells/office/OfficeDialog.tsx', { query: '?raw', import: 'default', eager: true }))[0] ?? ''

const noop = () => {}

/** 出題對話框交給殼層的 props（同 TopicDialog 的形狀）；busy 時兩個選項都停用 */
const topicProps = (busy: boolean): DialogProps => ({
  purpose: 'topic',
  label: '出題',
  busy,
  input: { value: '', onChange: noop, placeholder: '輸入題目（1–20 字）後按 Enter', ariaLabel: '題目', maxLength: 80, invalid: !busy, enterKeyHint: 'go' },
  items: [
    { id: 'submit', label: busy ? '送出中…' : '出題並開始比賽', detail: '0/20', onSelect: noop, disabled: busy },
    { id: 'cancel', label: '放棄出題', detail: 'Esc', onSelect: noop, disabled: busy },
  ],
  onEscape: noop,
  error: busy ? null : '題目不可空白',
})

/** 交卷確認的形狀（沒有輸入框） */
const confirmProps = (patch: Partial<DialogProps> = {}): DialogProps => ({
  purpose: 'submit',
  label: '儲存確認',
  items: [
    { id: 'submit', label: '儲存', detail: 'Enter', onSelect: noop },
    { id: 'cancel', label: '取消', detail: 'Esc', onSelect: noop },
  ],
  onEscape: noop,
  trapFocus: true,
  ...patch,
})

const inputTag = (html: string) => /<input [^>]*>/.exec(html)?.[0] ?? ''

// ─── 靜態渲染：busy 的呈現 ───────────────────────────────────────────

describe('殼層對話框的輸入框：送出中是 readOnly＋aria-busy，不是原生 disabled', () => {
  const busy = renderToStaticMarkup(<PptDialog {...topicProps(true)} />)
  const idle = renderToStaticMarkup(<PptDialog {...topicProps(false)} />)

  it('busy：readonly、aria-busy="true"，沒有 disabled 屬性（不會因此失去焦點）', () => {
    const input = inputTag(busy)
    expect(input).toContain(' readOnly=""')
    expect(input).toContain(' aria-busy="true"')
    expect(input).not.toMatch(/\sdisabled(?:=|\s|\/?>)/)
    // 開啟時的預設焦點仍在輸入框
    expect(input).toContain(' autofocus=""')
  })

  it('busy：整個對話框沒有任何原生 disabled（選項只設 aria-disabled，仍可聚焦）', () => {
    expect(busy).not.toMatch(/\sdisabled(?:=|\s|\/?>)/)
    expect(busy.match(/aria-disabled="true"/g)).toHaveLength(2)
  })

  it('不是 busy：沒有 readonly 與 aria-busy（可編輯）', () => {
    const input = inputTag(idle)
    expect(input).not.toMatch(/\sreadonly/i)
    expect(input).not.toMatch(/\saria-busy=/)
    expect(input).not.toMatch(/\sdisabled(?:=|\s|\/?>)/)
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
      for (const c of ['bg-input', 'text-fg', 'focus:border-border-focus', 'aria-[invalid=true]:border-sem-error']) expect(cls, c).toContain(c)
    }
  })

  it('省略 busy（說明、交卷確認）等同不是 busy', () => {
    const { busy: _omit, ...rest } = topicProps(false)
    void _omit
    expect(renderToStaticMarkup(<PptDialog {...rest} />)).toBe(idle)
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

  it('OfficeDialog 的 JSX 沒有原生 disabled 屬性；輸入框用 readOnly 與 aria-busy', () => {
    expect(officeSource.length).toBeGreaterThan(0)
    expect(officeSource).not.toMatch(/\sdisabled=\{/)
    expect(officeSource).toContain('readOnly={busy}')
    expect(officeSource).toContain('aria-busy={busy || undefined}')
    // 正向對照：規則抓得到舊寫法
    expect(/\sdisabled=\{/.test('<input disabled={input.disabled} />')).toBe(true)
    expect(/\sdisabled=\{/.test('<button aria-disabled={item.disabled || undefined} />')).toBe(false)
  })
})

// ─── 焦點還原（純邏輯；DOM 以靜態渲染結果解析出的假節點代入） ─────────────────

interface FakeNode {
  tag: string
  attrs: Record<string, string>
  focus: ReturnType<typeof vi.fn<() => void>>
}

/** 從靜態渲染的 HTML 取出所有 input／button（依文件順序） */
function parseNodes(html: string): FakeNode[] {
  return [...html.matchAll(/<(input|button)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*\/?>/g)].map((m) => ({
    tag: m[1] ?? '',
    attrs: Object.fromEntries([...(m[2] ?? '').matchAll(/([^\s=]+)(?:="([^"]*)")?/g)].map((a) => [(a[1] ?? '').toLowerCase(), a[2] ?? ''])),
    focus: vi.fn<() => void>(),
  }))
}

/** 迷你選擇器比對：只支援本檔用到的寫法（tag、[attr]、:not([attr])、:not([attr="值"])） */
function matches(node: FakeNode, selector: string): boolean {
  const tag = /^[a-z]+/.exec(selector)?.[0]
  if (tag !== undefined && tag !== node.tag) return false
  let rest = selector.slice(tag?.length ?? 0)
  while (rest !== '') {
    const not = /^:not\(\[([^\]=]+)(?:="([^"]*)")?\]\)/.exec(rest)
    const has = /^\[([^\]=]+)\]/.exec(rest)
    if (not !== null) {
      const [, name = '', value] = not
      if (value === undefined ? name in node.attrs : node.attrs[name] === value) return false
      rest = rest.slice(not[0].length)
    } else if (has !== null) {
      if (!((has[1] ?? '') in node.attrs)) return false
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

describe('busy 結束後的焦點還原（restoreDialogFocus）', () => {
  it('busyEnded：只有 true → false 才算結束', () => {
    expect(busyEnded(true, false)).toBe(true)
    expect(busyEnded(false, false)).toBe(false)
    expect(busyEnded(false, true)).toBe(false)
    expect(busyEnded(true, true)).toBe(false)
  })

  it('落點的順序：輸入框 → 第一個可用的選項（未停用、未 aria-disabled）', () => {
    expect(DIALOG_OPTION_ATTR).toBe('data-dialog-option')
    expect(DIALOG_REFOCUS_SELECTORS).toEqual(['input:not([disabled])', '[data-dialog-option]:not([disabled]):not([aria-disabled="true"])'])
  })

  it('出題對話框送出失敗後（busy 結束、焦點掉到 body）：放回輸入框', () => {
    const nodes = parseNodes(renderToStaticMarkup(<PptDialog {...topicProps(false)} />))
    expect(nodes.map((n) => n.tag)).toEqual(['button', 'input', 'button', 'button'])
    expect(restoreDialogFocus(fakeRoot(nodes), BODY)).toBe(true)
    expect(focused(nodes).map((n) => n.tag)).toEqual(['input'])
    expect(nodes[1]?.focus).toHaveBeenCalledTimes(1)
  })

  it('焦點是 null（沒有任何元素有焦點）也放回輸入框', () => {
    const nodes = parseNodes(renderToStaticMarkup(<PptDialog {...topicProps(false)} />))
    expect(restoreDialogFocus(fakeRoot(nodes), null)).toBe(true)
    expect(focused(nodes).map((n) => n.tag)).toEqual(['input'])
  })

  it('焦點還在對話框內（留在輸入框、或使用者已 Tab 到別的按鈕）：不動', () => {
    const nodes = parseNodes(renderToStaticMarkup(<PptDialog {...topicProps(false)} />))
    for (const active of nodes) {
      const root = fakeRoot(nodes)
      expect(restoreDialogFocus(root, active)).toBe(false)
      expect(root.queried).toEqual([])
    }
    expect(focused(nodes)).toEqual([])
  })

  it('送出中的輸入框（readOnly）仍是合法落點：不是 disabled', () => {
    const nodes = parseNodes(renderToStaticMarkup(<PptDialog {...topicProps(true)} />))
    expect(nodes[1]?.attrs).toHaveProperty('readonly')
    expect(restoreDialogFocus(fakeRoot(nodes), BODY)).toBe(true)
    expect(focused(nodes).map((n) => n.tag)).toEqual(['input'])
  })

  it('沒有輸入框（交卷確認）：放回第一個選項（主要按鈕），不是標題列的關閉鈕', () => {
    const nodes = parseNodes(renderToStaticMarkup(<PptDialog {...confirmProps()} />))
    expect(nodes.map(nameOf)).toEqual(['關閉', '儲存', '取消'])
    // 標題列的關閉鈕沒有選項標記
    expect(nodes.map((n) => DIALOG_OPTION_ATTR in n.attrs)).toEqual([false, true, true])
    const root = fakeRoot(nodes)
    expect(restoreDialogFocus(root, BODY)).toBe(true)
    expect(focused(nodes).map(nameOf)).toEqual(['儲存'])
    expect(root.queried).toEqual([...DIALOG_REFOCUS_SELECTORS])
  })

  it('沒有輸入框且第一個選項不可用（aria-disabled）：放回下一個可用的選項', () => {
    const props = confirmProps()
    const items = [{ ...props.items[0]!, disabled: true }, props.items[1]!]
    const nodes = parseNodes(renderToStaticMarkup(<PptDialog {...props} items={items} />))
    expect(nodes[1]?.attrs['aria-disabled']).toBe('true')
    expect(restoreDialogFocus(fakeRoot(nodes), BODY)).toBe(true)
    expect(focused(nodes).map(nameOf)).toEqual(['取消'])
  })

  it('說明的主題清單（沒有輸入框）：放回第一列', () => {
    const items = HELP_TOPICS.map((t) => ({ id: t.id, label: t.title, onSelect: noop }))
    const html = renderToStaticMarkup(<PptDialog purpose="help" label="說明" title="說明" items={items} onEscape={noop} />)
    const nodes = parseNodes(html)
    // 每一列都有選項標記；標題列與右下的「關閉」沒有
    expect(nodes.filter((n) => DIALOG_OPTION_ATTR in n.attrs)).toHaveLength(HELP_TOPICS.length)
    expect(restoreDialogFocus(fakeRoot(nodes), BODY)).toBe(true)
    expect(focused(nodes)).toHaveLength(1)
    expect(focused(nodes)[0]).toBe(nodes[1])
  })

  it('沒有任何落點（全部選項都不可用、也沒有輸入框）：不動，回 false', () => {
    const props = confirmProps()
    const nodes = parseNodes(renderToStaticMarkup(<PptDialog {...props} items={props.items.map((i) => ({ ...i, disabled: true }))} />))
    expect(restoreDialogFocus(fakeRoot(nodes), BODY)).toBe(false)
    expect(focused(nodes)).toEqual([])
  })

  it('OfficeDialog 在 busy 變化的 effect 裡呼叫還原（原始碼守門：busyEnded → restoreDialogFocus(…, document.activeElement)）', () => {
    expect(officeSource).toMatch(/useEffect\(\(\) => \{[\s\S]*?busyEnded\(wasBusy\.current, busy\)[\s\S]*?restoreDialogFocus\([\s\S]*?document\.activeElement,?\s*\)[\s\S]*?\}, \[busy\]\)/)
    expect(officeSource).toContain('rootRef={rootRef}')
    expect(officeSource).toContain('ref={rootRef}')
  })
})

// ─── 出題對話框交給殼層的 props ────────────────────────────────────────

/** 以假 Dialog 擷取出題表單交給殼層的 props（靜態渲染讀不到 store 的更新，所以直接渲染 TopicForm，同 submitConfirm.test 的做法） */
function captureTopic(): DialogProps | null {
  let last: DialogProps | null = null
  const Dialog = (p: DialogProps) => {
    last = p
    return null
  }
  const views: ShellViews = { ...PPT_VIEWS, Dialog }
  renderToStaticMarkup(
    <ShellViewsContext.Provider value={views}>
      <TopicForm />
    </ShellViewsContext.Provider>,
  )
  return last
}

describe('出題對話框（TopicDialog）：送出中交給殼層的 busy，輸入框不再帶 disabled', () => {
  const FAIL = { ok: false as const, error: 'TOPIC_INVALID' as const, message: '題目不可空白' }

  beforeEach(() => {
    vi.mocked(setTopic).mockReset().mockResolvedValue(FAIL)
    vi.mocked(cancelRound).mockReset().mockResolvedValue({ ok: true })
  })

  it('TopicDialog 不在出題階段（初始狀態）時不渲染', () => {
    const html = renderToStaticMarkup(
      <ShellViewsContext.Provider value={PPT_VIEWS}>
        <TopicDialog />
      </ShellViewsContext.Provider>,
    )
    expect(html).toBe('')
  })

  it('props：busy 在對話框層級（初始 false）；input 沒有 disabled 欄位；兩個選項初始可用', () => {
    const p = captureTopic()
    expect(p?.purpose).toBe('topic')
    expect(p?.busy).toBe(false)
    expect(p?.input).toBeDefined()
    expect(Object.keys(p?.input ?? {})).not.toContain('disabled')
    expect(p?.items.map((i) => [i.id, i.disabled])).toEqual([
      ['submit', false],
      ['cancel', false],
    ])
    expect(p?.trapFocus).toBeUndefined()
  })

  it('Esc（onEscape）＝放棄出題（round:cancel）；與第二個選項同一個動作', async () => {
    const p = captureTopic()
    p?.onEscape?.()
    await vi.waitFor(() => expect(cancelRound).toHaveBeenCalledTimes(1))
    p?.items[1]?.onSelect()
    await vi.waitFor(() => expect(cancelRound).toHaveBeenCalledTimes(2))
    expect(setTopic).not.toHaveBeenCalled()
  })

  it('Enter（第一個選項）＝送出題目（round:setTopic）；server 拒絕後同一個 callback 可以再送、Esc 仍可放棄', async () => {
    // 限制：靜態渲染沒有狀態更新，這裡的 callback 永遠是「不是 busy」那一版；驗的是 Enter／Esc 接到正確的動作，
    // 「busy 回到 false 後焦點還在、按鍵收得到」要靠上面的屬性與焦點還原測試，加上瀏覽器實測
    const p = captureTopic()
    p?.items[0]?.onSelect()
    await vi.waitFor(() => expect(setTopic).toHaveBeenCalledTimes(1))
    expect(setTopic).toHaveBeenLastCalledWith('')
    await expect(vi.mocked(setTopic).mock.results[0]?.value).resolves.toEqual(FAIL)
    p?.items[0]?.onSelect()
    await vi.waitFor(() => expect(setTopic).toHaveBeenCalledTimes(2))
    p?.onEscape?.()
    await vi.waitFor(() => expect(cancelRound).toHaveBeenCalledTimes(1))
  })

  it('ppt 殼層實際渲染出題對話框：輸入框可編輯、有預設焦點、沒有 disabled', () => {
    const html = renderToStaticMarkup(
      <ShellViewsContext.Provider value={PPT_VIEWS}>
        <TopicForm />
      </ShellViewsContext.Provider>,
    )
    const input = inputTag(html)
    expect(input).toContain(' autofocus=""')
    expect(input).not.toMatch(/\sdisabled(?:=|\s|\/?>)/)
    expect(input).not.toMatch(/\saria-busy=/)
    expect(input).not.toMatch(/\sreadonly/i)
    expect(html).toContain('role="dialog"')
  })
})
