// 沒有 DOM 環境（沒有 jsdom／happy-dom）時驗「狀態流程」用的假 DOM（複製自我畫你猜 test/busyFocus.test.tsx 的做法）：
//   client renderer 掛在只有 React 掛元件會用到的節點方法上，元件是真的、狀態真的更新、effect 真的執行。
//   假 DOM 照瀏覽器的規則模擬焦點：focus() 設 activeElement；**有焦點的元素被設成原生 disabled 時焦點掉到 body**、
//   disabled 的元素 focus() 無效。事件不經瀏覽器，直接呼叫 React 交給節點的 handler（handlersOf）。
//   真正的瀏覽器行為（焦點、自動播放政策、音訊解碼）仍以瀏覽器實測為準。
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'
import type { ActionOutcome } from '../src/socket/client'

const noop = () => {}

// ─── 假 DOM ─────────────────────────────────────────────────────────

export interface FakeNode {
  nodeType: 1
  tagName: string
  parentNode: FakeNode | null
  childNodes: (FakeNode | FakeText)[]
  attrs: Record<string, string>
  textContent?: string
  focus(): void
  appendChild(child: FakeNode | FakeText): FakeNode | FakeText
  insertBefore(child: FakeNode | FakeText, before: FakeNode | FakeText | null): FakeNode | FakeText
  removeChild(child: FakeNode | FakeText): FakeNode | FakeText
  [key: string]: unknown
}
export interface FakeText {
  nodeType: 3
  nodeValue: string
  parentNode: FakeNode | null
}

/** React 交給節點的 props（onClick、onSubmit…）：存在節點的內部欄位上 */
export type Handlers = Record<string, (...args: unknown[]) => void>

/** decorate：每個新建的元素節點都會經過（測試可替特定標籤補上瀏覽器才有的方法，例如 <audio> 的 play／pause／load） */
export function fakeDom(decorate: (node: FakeNode) => void = noop) {
  const doc: Record<string, unknown> = { nodeType: 9, activeElement: null, addEventListener: noop, removeEventListener: noop }
  const make = (tag: string, namespaceURI = 'http://www.w3.org/1999/xhtml'): FakeNode => {
    const node: FakeNode = {
      nodeType: 1,
      nodeName: tag.toUpperCase(),
      tagName: tag.toUpperCase(),
      namespaceURI,
      ownerDocument: doc,
      parentNode: null,
      childNodes: [],
      attrs: {},
      style: { setProperty: noop },
      get firstChild() {
        return node.childNodes[0] ?? null
      },
      get lastChild() {
        return node.childNodes.at(-1) ?? null
      },
      setAttribute(name: string, value: unknown) {
        node.attrs[name.toLowerCase()] = String(value)
        // 瀏覽器的規則：有焦點的元素被停用就失去焦點（activeElement 變成 body）
        if (name.toLowerCase() === 'disabled' && doc.activeElement === node) doc.activeElement = doc.body
      },
      removeAttribute(name: string) {
        delete node.attrs[name.toLowerCase()]
      },
      getAttribute: (name: string) => node.attrs[name.toLowerCase()] ?? null,
      hasAttribute: (name: string) => name.toLowerCase() in node.attrs,
      addEventListener: noop,
      removeEventListener: noop,
      appendChild(child: FakeNode | FakeText) {
        return node.insertBefore(child, null)
      },
      insertBefore(child: FakeNode | FakeText, before: FakeNode | FakeText | null) {
        child.parentNode?.removeChild(child)
        child.parentNode = node
        const at = before === null ? -1 : node.childNodes.indexOf(before)
        if (at < 0) node.childNodes.push(child)
        else node.childNodes.splice(at, 0, child)
        return child
      },
      removeChild(child: FakeNode | FakeText) {
        node.childNodes = node.childNodes.filter((c) => c !== child)
        child.parentNode = null
        // 有焦點的元素離開文件：焦點掉到 body
        if (child.nodeType === 1 && contains(child, doc.activeElement as FakeNode | null)) doc.activeElement = doc.body
        return child
      },
      contains: (other: FakeNode | null) => contains(node, other),
      focus() {
        if (!('disabled' in node.attrs)) doc.activeElement = node
      },
    } as FakeNode
    decorate(node)
    return node
  }
  const contains = (root: FakeNode, other: FakeNode | null) => {
    for (let n = other; n !== null; n = n.parentNode) if (n === root) return true
    return false
  }
  doc.createElement = (tag: string) => make(tag)
  doc.createElementNS = (ns: string, tag: string) => make(tag, ns)
  doc.createTextNode = (text: string): FakeText => ({ nodeType: 3, nodeValue: text, parentNode: null })
  const body = make('body')
  const container = make('div')
  body.appendChild(container)
  doc.body = body
  doc.documentElement = body
  const win = { document: doc, event: undefined, HTMLIFrameElement: class {}, localStorage: { getItem: () => null, setItem: noop } }
  doc.defaultView = win
  return { doc, win, body, container }
}

export const elements = (node: FakeNode): FakeNode[] => [node, ...node.childNodes.flatMap((c) => (c.nodeType === 1 ? elements(c) : []))]
/** 節點的文字（React 對單一字串子節點直接設 textContent，其餘建文字節點） */
export const textOf = (node: FakeNode): string =>
  node.childNodes.length === 0
    ? (node.textContent ?? '')
    : node.childNodes.map((c) => (c.nodeType === 3 ? c.nodeValue : textOf(c))).join('')
export const handlersOf = (node: FakeNode): Handlers => {
  const key = Object.keys(node).find((k) => k.startsWith('__reactProps$'))
  if (key === undefined) throw new Error('節點不是 React 掛上的')
  return node[key] as Handlers
}

const mounted: Root[] = []

/** 把元件掛到假 DOM 上；回傳查節點、讀焦點的工具 */
export async function mount(node: ReactNode, decorate?: (node: FakeNode) => void) {
  const { doc, win, body, container } = fakeDom(decorate)
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', doc)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const root = createRoot(container as unknown as Element)
  mounted.push(root)
  await act(async () => root.render(node))
  const all = () => elements(container)
  return {
    body,
    get active() {
      return doc.activeElement as FakeNode | null
    },
    all,
    one(pred: (n: FakeNode) => boolean): FakeNode {
      const hits = all().filter(pred)
      if (hits.length !== 1) throw new Error(`預期找到 1 個節點，實際 ${hits.length} 個`)
      return hits[0]!
    },
    maybe: (pred: (n: FakeNode) => boolean) => all().find(pred) ?? null,
  }
}

/** 卸載本檔掛上的所有元件並還原全域（各測試檔在 afterEach 呼叫） */
export async function unmountAll() {
  for (const root of mounted.splice(0)) await act(async () => root.unmount())
  vi.unstubAllGlobals()
}

/** 由測試決定何時回覆的請求（模擬等 server ack 的期間）；settle 的 before 在回覆前同步執行（模擬 server 回覆時一併更新 store） */
export function deferred() {
  let resolve: (r: ActionOutcome) => void = noop
  const promise = new Promise<ActionOutcome>((r) => {
    resolve = r
  })
  const settle = (r: ActionOutcome, before: () => void = noop) =>
    act(async () => {
      before()
      resolve(r)
      await promise
    })
  return { promise, settle }
}

