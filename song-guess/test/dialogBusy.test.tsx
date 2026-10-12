// 出題對話框「搜尋中」（DialogProps.busy；spec/song-guess/design.md §1「出題」；plan/notes.md 2026-10-12 的作法）：
//   輸入框在 busy 時是 readOnly＋aria-busy、不是原生 disabled（被停用的元素會失去焦點，Esc／Enter 掛在對話框上就收不到）；
//   主要按鈕文字改「搜尋中…」；找不到歌手或搜尋失敗後焦點留在輸入框，可以直接改字再送；
//   busy 結束時若焦點已不在對話框內，放回輸入框（shells/dialogFocus 的純邏輯）。
// 沒有 DOM 環境：以靜態渲染的屬性與原始碼掃描驗證（瀏覽器只會讓 disabled 的元素失焦，readOnly 不會）。
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArtistDialog } from '../src/features/round/ArtistDialog'
import {
  ARTIST_CANCEL_LABEL,
  ARTIST_FIELD_LABEL,
  ARTIST_PLACEHOLDER,
  ARTIST_SEARCHING_LABEL,
  ARTIST_SUBMIT_LABEL,
} from '../src/features/round/roundDisplay'
import { DIALOG_OPTION_ATTR, DIALOG_REFOCUS_SELECTORS, busyEnded, restoreDialogFocus, type DialogFocusRoot } from '../src/shells/dialogFocus'
import { MeetDialog } from '../src/shells/meet/MeetDialog'
import { MEET_DIALOG_REFOCUS_SELECTORS } from '../src/shells/meet/meetLayout'
import { MEET_VIEWS } from '../src/shells/meet/meetViews'
import { ShellViewsContext, type DialogField, type DialogProps } from '../src/shells/views'

const fs = (await import('node:fs' as string)) as { readFileSync(path: URL, encoding: 'utf8'): string }
const read = (f: string) => fs.readFileSync(new URL(f, import.meta.url), 'utf8')
const noop = () => {}

const field: DialogField = {
  value: '孫燕姿',
  onChange: noop,
  placeholder: ARTIST_PLACEHOLDER,
  ariaLabel: ARTIST_FIELD_LABEL,
  maxLength: 120,
  invalid: false,
  enterKeyHint: 'search',
}

/** 與 features/round/ArtistDialog 交給殼層的 props 相同的形狀 */
function artistProps(searching: boolean, error: string | null = null): DialogProps {
  return {
    purpose: 'artist',
    label: '出題',
    busy: searching,
    input: { ...field, invalid: error !== null },
    items: [
      { id: 'submit', label: searching ? ARTIST_SEARCHING_LABEL : ARTIST_SUBMIT_LABEL, detail: '3/30 · 00:52', onSelect: noop, disabled: searching, pending: searching },
      { id: 'cancel', label: ARTIST_CANCEL_LABEL, detail: 'Esc', onSelect: noop },
    ],
    onEscape: noop,
    error,
  }
}

const render = (props: DialogProps) => renderToStaticMarkup(<MeetDialog {...props} />)
const inputTag = (html: string) => /<input\b[^>]*>/.exec(html)?.[0] ?? ''
const NATIVE_DISABLED = /\sdisabled(?:=|\s|\/?>)/

describe('「分享音訊」對話框（design §1：欄位「歌手」、placeholder、按鈕「取消／分享」）', () => {
  const html = render(artistProps(false))

  it('標題「分享音訊」、欄位標籤「歌手」、placeholder「輸入歌手名稱（例如：孫燕姿）」', () => {
    expect(html).toMatch(/<h2[^>]*>分享音訊<\/h2>/)
    expect(html).toMatch(/<label for="[^"]+"[^>]*>歌手<\/label>/)
    expect(inputTag(html)).toContain('placeholder="輸入歌手名稱（例如：孫燕姿）"')
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-label="出題"')
  })

  it('按鈕由左而右「取消」「分享」；主要（分享）是 submit（Enter 走 form 的隱式送出）', () => {
    expect(html.indexOf('>取消</button>')).toBeLessThan(html.indexOf('>分享</button>'))
    expect(html).toMatch(/<button type="submit"[^>]*aria-label="分享：搜尋並開始"[^>]*>分享<\/button>/)
    expect(html).toMatch(/<button type="button"[^>]*aria-label="取消：取消出題"[^>]*>取消<\/button>/)
    expect(html).toMatch(/^<form /)
  })

  it('字數與出題倒數顯示在欄位標籤右側', () => {
    expect(html).toContain('3/30 · 00:52')
  })
})

describe('搜尋中（busy）：readOnly＋aria-busy，不是原生 disabled', () => {
  const busy = render(artistProps(true))
  const idle = render(artistProps(false))

  it('輸入框：readonly、aria-busy="true"，沒有 disabled 屬性（不會因此失去焦點）', () => {
    const input = inputTag(busy)
    expect(input).toContain(' readOnly=""')
    expect(input).toContain(' aria-busy="true"')
    expect(input).not.toMatch(NATIVE_DISABLED)
  })

  it('主要按鈕文字改「搜尋中…」並帶 aria-busy、aria-disabled；取消仍可按（搜尋中也能取消）', () => {
    expect(busy).toMatch(/<button type="submit"[^>]*aria-label="搜尋中…"[^>]*aria-disabled="true"[^>]*aria-busy="true"[^>]*>搜尋中…<\/button>/)
    expect(busy).not.toContain('>分享</button>')
    expect(busy).toMatch(/<button type="button"[^>]*aria-label="取消：取消出題"[^>]*>取消<\/button>/)
    expect(busy.match(/aria-disabled="true"/g)).toHaveLength(1)
  })

  it('整個對話框沒有任何原生 disabled', () => {
    expect(busy).not.toMatch(NATIVE_DISABLED)
    expect(idle).not.toMatch(NATIVE_DISABLED)
  })

  it('不是 busy：沒有 readonly 與 aria-busy（可編輯）', () => {
    const input = inputTag(idle)
    expect(input).not.toMatch(/readonly/i)
    expect(input).not.toMatch(/\saria-busy=/)
    expect(idle).not.toMatch(/\saria-busy=/)
  })

  it('外觀：搜尋中的透明度掛在 aria-busy（60%）；沒有 disabled: 的樣式', () => {
    const cls = (/class="([^"]*)"/.exec(inputTag(busy))?.[1] ?? '').split(/\s+/)
    expect(cls).toContain('aria-busy:opacity-60')
    expect(cls).toContain('aria-busy:cursor-default')
    expect(cls.filter((c) => c.startsWith('disabled:'))).toEqual([])
  })

  it('搜尋失敗後（busy 結束、帶錯誤）：錯誤訊息 role="alert"、輸入框標為 invalid 且可編輯', () => {
    const message = '找不到這位歌手的歌（至少要 5 首有試聽的歌），換一位試試'
    const failed = render(artistProps(false, message))
    expect(failed).toMatch(new RegExp(`<p class="[^"]*text-sem-error" role="alert">${message}</p>`))
    expect(inputTag(failed)).toContain('aria-invalid="true"')
    expect(inputTag(failed)).not.toMatch(/readonly/i)
    expect(failed).toContain('>分享</button>')
  })

  it('DialogField 沒有 disabled（送出中由 DialogProps.busy 表達）', () => {
    // @ts-expect-error DialogField 不接受 disabled
    const bad: DialogField = { ...field, disabled: true }
    expect(Object.keys(field)).not.toContain('disabled')
    expect(bad).toBeDefined()
  })

  it('原始碼：MeetDialog 的 JSX 沒有原生 disabled 屬性；輸入框用 readOnly 與 aria-busy，並掛上焦點還原', () => {
    const src = read('../src/shells/meet/MeetDialog.tsx')
    expect(src).not.toMatch(/\sdisabled=\{/)
    expect(src).toContain('readOnly={busy}')
    expect(src).toContain('aria-busy={busy || undefined}')
    expect(src).toContain('useRestoreDialogFocus(busy, rootRef, MEET_DIALOG_REFOCUS_SELECTORS)')
    // 規則本身抓得到原生 disabled（正向對照）
    expect(/\sdisabled=\{/.test('<input disabled={input.disabled} />')).toBe(true)
    expect(/\sdisabled=\{/.test('<button aria-disabled={item.disabled || undefined} />')).toBe(false)
  })
})

describe('ArtistDialog（功能元件）：交給殼層的 props', () => {
  /** 以假 Dialog 記錄 props */
  function capture(node: ReactNode): DialogProps | null {
    let last: DialogProps | null = null
    const Dialog = (p: DialogProps) => {
      last = p
      return null
    }
    renderToStaticMarkup(<ShellViewsContext.Provider value={{ ...MEET_VIEWS, Dialog }}>{node}</ShellViewsContext.Provider>)
    return last
  }

  it('不是 choosing 或自己不是出題者（初始狀態）→ 不渲染', () => {
    expect(capture(<ArtistDialog />)).toBeNull()
  })

  it('原始碼：purpose artist、欄位與 placeholder 用常數、busy 交給殼層、失敗顯示 server 的訊息、搜尋中仍可取消', () => {
    const src = read('../src/features/round/ArtistDialog.tsx')
    expect(src).toContain('purpose="artist"')
    expect(src).toContain('busy={searching || cancelling}')
    expect(src).toContain('placeholder: ARTIST_PLACEHOLDER')
    expect(src).toContain('ariaLabel: ARTIST_FIELD_LABEL')
    expect(src).toContain('label: searching ? ARTIST_SEARCHING_LABEL : ARTIST_SUBMIT_LABEL')
    expect(src).toContain('pending: searching')
    // 失敗才解除搜尋中並顯示 server 的訊息；成功時維持搜尋中直到 round:update 把對話框關掉
    expect(src).toMatch(/if \(r\.ok\) return\s+setSearching\(false\)\s+setError\(r\.message\)/)
    // 取消只在取消本身進行中才停用
    expect(src).toMatch(/label: ARTIST_CANCEL_LABEL,[^}]*disabled: cancelling \}/)
    expect(src).not.toMatch(/\sdisabled=\{/)
  })
})

// ─── 焦點還原（純邏輯） ───────────────────────────────────────────

interface FakeNode {
  tag: string
  attrs: Record<string, string>
  focus: ReturnType<typeof vi.fn<() => void>>
}

/** 從靜態渲染的 HTML 取出可聚焦節點（input、button），依文件順序 */
function parseNodes(html: string): FakeNode[] {
  return [...html.matchAll(/<(input|button)\b([^>]*)>/g)].map((m) => ({
    tag: m[1] ?? '',
    attrs: Object.fromEntries([...(m[2] ?? '').matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [(a[1] ?? '').toLowerCase(), a[2] ?? ''])),
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

function fakeRoot(nodes: FakeNode[]): DialogFocusRoot {
  return {
    contains: (node) => nodes.some((n) => n === node),
    querySelector: (selector) => nodes.find((n) => matches(n, selector)) ?? null,
  }
}

const BODY = { tag: 'body' }
const focused = (nodes: FakeNode[]) => nodes.filter((n) => n.focus.mock.calls.length > 0)

describe('busy 結束後的焦點還原（shells/dialogFocus）', () => {
  it('busyEnded：只有 true → false 才算結束', () => {
    expect(busyEnded(true, false)).toBe(true)
    expect(busyEnded(false, false)).toBe(false)
    expect(busyEnded(false, true)).toBe(false)
    expect(busyEnded(true, true)).toBe(false)
  })

  it('落點的順序：輸入框 → 主要按鈕（submit）→ 其餘可用的選項', () => {
    expect(DIALOG_OPTION_ATTR).toBe('data-dialog-option')
    expect(DIALOG_REFOCUS_SELECTORS).toEqual(['input:not([disabled])', '[data-dialog-option]:not([disabled]):not([aria-disabled="true"])'])
    expect(MEET_DIALOG_REFOCUS_SELECTORS).toEqual([
      'input:not([disabled])',
      '[data-dialog-option][type="submit"]:not([disabled]):not([aria-disabled="true"])',
      '[data-dialog-option]:not([disabled]):not([aria-disabled="true"])',
    ])
  })

  it('出題對話框的節點（文件順序）：輸入框、取消、分享（主要在最後）', () => {
    const nodes = parseNodes(render(artistProps(false)))
    expect(nodes.map((n) => [n.tag, n.attrs.type])).toEqual([
      ['input', undefined],
      ['button', 'button'],
      ['button', 'submit'],
    ])
    for (const n of nodes.filter((x) => x.tag === 'button')) expect(DIALOG_OPTION_ATTR in n.attrs).toBe(true)
  })

  it('搜尋失敗、焦點掉到 body：放回輸入框（可以直接改字再按 Enter）', () => {
    const nodes = parseNodes(render(artistProps(false, '搜尋失敗，請再試一次')))
    expect(restoreDialogFocus(fakeRoot(nodes), BODY, MEET_DIALOG_REFOCUS_SELECTORS)).toBe(true)
    expect(focused(nodes).map((n) => n.tag)).toEqual(['input'])
  })

  it('搜尋中的輸入框（readOnly）仍是合法落點：不是 disabled', () => {
    const nodes = parseNodes(render(artistProps(true)))
    expect(restoreDialogFocus(fakeRoot(nodes), null, MEET_DIALOG_REFOCUS_SELECTORS)).toBe(true)
    expect(focused(nodes).map((n) => n.tag)).toEqual(['input'])
  })

  it('焦點還在對話框內（例如使用者已 Tab 到「取消」）：不動', () => {
    const nodes = parseNodes(render(artistProps(false)))
    expect(restoreDialogFocus(fakeRoot(nodes), nodes[1], MEET_DIALOG_REFOCUS_SELECTORS)).toBe(false)
    expect(focused(nodes)).toEqual([])
  })

  it('沒有輸入框的對話框（說明內文）：放回主要按鈕；主要按鈕不可用時放回下一個可用的選項', () => {
    const help: DialogProps = {
      purpose: 'help',
      label: '說明：計分',
      title: '計分',
      body: <p>內文</p>,
      items: [
        { id: 'back', label: '返回', onSelect: noop },
        { id: 'close', label: '關閉', onSelect: noop },
      ],
    }
    const nodes = parseNodes(render(help))
    restoreDialogFocus(fakeRoot(nodes), BODY, MEET_DIALOG_REFOCUS_SELECTORS)
    expect(focused(nodes).map((n) => n.attrs['aria-label'])).toEqual(['返回'])
    const blocked = parseNodes(render({ ...help, items: [{ id: 'back', label: '返回', onSelect: noop, disabled: true }, help.items[1]!] }))
    restoreDialogFocus(fakeRoot(blocked), BODY, MEET_DIALOG_REFOCUS_SELECTORS)
    expect(focused(blocked).map((n) => n.attrs['aria-label'])).toEqual(['關閉'])
  })

  it('對話框裡沒有任何落點：回 false、不丟例外', () => {
    expect(restoreDialogFocus(fakeRoot([]), BODY)).toBe(false)
  })
})
