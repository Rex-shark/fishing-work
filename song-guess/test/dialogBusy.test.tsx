// 出題對話框「送出中」（DialogProps.busy；spec/song-guess/design.md §1「出題（選題庫）」；plan/notes.md 2026-10-12 的作法）：
//   輸入框在 busy 時是 readOnly＋aria-busy、不是原生 disabled（被停用的元素會失去焦點，Esc／Enter 掛在對話框上就收不到）；
//   四選一與「只抽熱門歌」在送出中只設 aria-disabled（Epic 18；Epic 19 加「動漫熱門」，窄時換兩列）；
//   主要按鈕文字改「搜尋中…」（榜單「取得排行榜…」、動漫熱門「搜尋中…」）；找不到歌手或搜尋失敗後焦點留在輸入框，可以直接改字再送；
//   busy 結束時若焦點已不在對話框內，放回輸入框（shells/dialogFocus 的純邏輯）。
// 沒有 DOM 環境：以靜態渲染的屬性與原始碼掃描驗證（瀏覽器只會讓 disabled 的元素失焦，readOnly 不會）。
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SourceDialog } from '../src/features/round/SourceDialog'
import {
  ARTIST_CANCEL_LABEL,
  ARTIST_FIELD_LABEL,
  ARTIST_PLACEHOLDER,
  ARTIST_SUBMIT_LABEL,
  HOT_TOGGLE_LABEL,
  PRESET_NOTES,
  SEARCHING_LABEL,
  SOURCE_GROUP_LABEL,
  SOURCE_OPTIONS,
  submitLabel,
  type PresetSource,
} from '../src/features/round/roundDisplay'
import { DIALOG_OPTION_ATTR, DIALOG_REFOCUS_SELECTORS, busyEnded, restoreDialogFocus, type DialogFocusRoot } from '../src/shells/dialogFocus'
import { MeetDialog } from '../src/shells/meet/MeetDialog'
import { MEET_DIALOG_REFOCUS_SELECTORS, SEGMENTED_SINGLE_ROW_MAX, segmentedGroupClass } from '../src/shells/meet/meetLayout'
import { MEET_VIEWS } from '../src/shells/meet/meetViews'
import { ShellViewsContext, type DialogField, type DialogProps } from '../src/shells/views'
import { initialGameState, useGameStore } from '../src/store/game'
import { mount, unmountAll } from './fakeDom'
import { round } from './fixtures'

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

/** 與 features/round/SourceDialog 交給殼層的 props 相同的形狀（歌手模式） */
function artistProps(searching: boolean, error: string | null = null, hot = true): DialogProps {
  return {
    purpose: 'source',
    label: '出題',
    busy: searching,
    choices: { label: SOURCE_GROUP_LABEL, options: SOURCE_OPTIONS, value: 'artist', onChange: noop, locked: searching },
    input: { ...field, invalid: error !== null },
    toggle: { label: HOT_TOGGLE_LABEL, checked: hot, onChange: noop, locked: searching },
    items: [
      { id: 'submit', label: searching ? SEARCHING_LABEL : ARTIST_SUBMIT_LABEL, detail: '3/30 · 00:52', onSelect: noop, disabled: searching, pending: searching },
      { id: 'cancel', label: ARTIST_CANCEL_LABEL, detail: 'Esc', onSelect: noop },
    ],
    onEscape: noop,
    error,
  }
}

/** 現成題庫（榜單、動漫熱門）：沒有欄位與勾選，一行說明；倒數擺在說明右側 */
function chartProps(source: PresetSource, loading: boolean, error: string | null = null): DialogProps {
  return {
    purpose: 'source',
    label: '出題',
    busy: loading,
    choices: { label: SOURCE_GROUP_LABEL, options: SOURCE_OPTIONS, value: source, onChange: noop, locked: loading },
    description: PRESET_NOTES[source],
    items: [
      { id: 'submit', label: submitLabel(source, loading), detail: '00:52', onSelect: noop, disabled: loading, pending: loading },
      { id: 'cancel', label: ARTIST_CANCEL_LABEL, detail: 'Esc', onSelect: noop },
    ],
    onEscape: noop,
    error,
  }
}

const render = (props: DialogProps) => renderToStaticMarkup(<MeetDialog {...props} />)
const radios = (html: string) => [...html.matchAll(/<button type="button" role="radio"([^>]*)>([^<]*)<\/button>/g)].map((m) => ({ attrs: m[1] ?? '', text: m[2] ?? '' }))
const checkboxTag = (html: string) => /<input type="checkbox"[^>]*>/.exec(html)?.[0] ?? ''
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

  it('頂部四選一（role="radiogroup"「題庫來源」）：歌手／台灣熱門／西洋熱門／動漫熱門，預設選中歌手；只有選中的在 Tab 順序裡', () => {
    expect(html).toMatch(/<div role="radiogroup" aria-label="題庫來源"/)
    const r = radios(html)
    expect(r.map((x) => x.text)).toEqual(['歌手', '台灣熱門', '西洋熱門', '動漫熱門'])
    expect(r.map((x) => /aria-checked="true"/.test(x.attrs))).toEqual([true, false, false, false])
    expect(r.map((x) => /tabindex="(-?\d)"/i.exec(x.attrs)?.[1])).toEqual(['0', '-1', '-1', '-1'])
    // 選中者：--accent-panel 字＋ --bg-panel-hover 底（白卡片只用面板 token）
    expect(r[0]?.attrs).toMatch(/bg-panel-hover font-medium text-accent-panel/)
    // 四選一在欄位之前
    expect(html.indexOf('role="radiogroup"')).toBeLessThan(html.indexOf('<input'))
  })

  it('欄位下方勾選「只抽熱門歌」（原生 checkbox）：依 toggle.checked 呈現', () => {
    expect(checkboxTag(html)).toContain('checked=""')
    expect(html).toMatch(/<input type="checkbox"[^>]*\/>只抽熱門歌<\/label>/)
    expect(checkboxTag(render(artistProps(false, null, false)))).not.toContain('checked')
    expect(html.indexOf('placeholder=')).toBeLessThan(html.indexOf('type="checkbox"'))
    expect(html).not.toContain('Apple Music')
  })
})

describe('榜單模式（台灣熱門／西洋熱門）：沒有欄位，一行說明', () => {
  const tw = render(chartProps('tw-hot', false))
  const us = render(chartProps('western-hot', false))

  it('沒有輸入框與勾選；說明一行（--fg-on-panel-muted）＋右側倒數', () => {
    for (const html of [tw, us]) {
      expect(html).not.toMatch(/<input\b/)
      expect(html).not.toContain('只抽熱門歌')
    }
    expect(tw).toMatch(/<p class="[^"]*text-fg-on-panel-muted">從今天的 Apple Music 台灣熱門 100 首隨機抽 5 首<\/p><span[^>]*>00:52<\/span>/)
    expect(us).toContain('>從今天的 Apple Music 美國熱門 100 首隨機抽 5 首</p>')
  })

  it('四選一選中的是榜單那一個；按鈕仍是「取消」「分享」（無障礙名稱帶「抽歌並開始」）', () => {
    expect(radios(tw).map((x) => /aria-checked="true"/.test(x.attrs))).toEqual([false, true, false, false])
    expect(radios(us).map((x) => /aria-checked="true"/.test(x.attrs))).toEqual([false, false, true, false])
    expect(tw).toMatch(/<button type="submit"[^>]*aria-label="分享：抽歌並開始"[^>]*>分享<\/button>/)
    expect(tw).toMatch(/<button type="button"[^>]*aria-label="取消：取消出題"[^>]*>取消<\/button>/)
  })

  it('送出中：主要按鈕「取得排行榜…」（aria-busy、aria-disabled），四選一 aria-disabled；沒有原生 disabled；取消仍可按', () => {
    const busy = render(chartProps('tw-hot', true))
    expect(busy).toMatch(/<button type="submit"[^>]*aria-label="取得排行榜…"[^>]*aria-disabled="true"[^>]*aria-busy="true"[^>]*>取得排行榜…<\/button>/)
    expect(busy).toMatch(/<div role="radiogroup" aria-label="題庫來源" aria-disabled="true"/)
    expect(radios(busy).every((x) => /aria-disabled="true"/.test(x.attrs))).toBe(true)
    expect(busy).not.toMatch(NATIVE_DISABLED)
    expect(busy).toMatch(/<button type="button"[^>]*aria-label="取消：取消出題"[^>]*>取消<\/button>/)
  })

  it('失敗：顯示 server 的訊息（CHART_FAILED）、按鈕回到「分享」', () => {
    const failed = render(chartProps('western-hot', false, '取得題庫失敗，請再試一次'))
    expect(failed).toMatch(/role="alert">取得題庫失敗，請再試一次<\/p>/)
    expect(failed).toContain('>分享</button>')
  })
})

describe('動漫熱門（Epic 19；design §1）：與榜單同樣沒有欄位，一行說明；送出中是「搜尋中…」', () => {
  const anime = render(chartProps('anime-hot', false))

  it('沒有輸入框與勾選；說明「從 Apple Music 的動漫歌曲裡隨機抽 5 首（熱門前 60）」（--fg-on-panel-muted）＋右側倒數', () => {
    expect(anime).not.toMatch(/<input\b/)
    expect(anime).not.toContain('只抽熱門歌')
    expect(anime).toMatch(/<p class="[^"]*text-fg-on-panel-muted">從 Apple Music 的動漫歌曲裡隨機抽 5 首（熱門前 60）<\/p><span[^>]*>00:52<\/span>/)
  })

  it('四選一選中第四個「動漫熱門」；按鈕「取消」「分享」，無障礙名稱「分享：抽歌並開始」', () => {
    expect(radios(anime).map((x) => /aria-checked="true"/.test(x.attrs))).toEqual([false, false, false, true])
    expect(radios(anime).map((x) => /tabindex="(-?\d)"/i.exec(x.attrs)?.[1])).toEqual(['-1', '-1', '-1', '0'])
    expect(anime).toMatch(/<button type="submit"[^>]*aria-label="分享：抽歌並開始"[^>]*>分享<\/button>/)
    expect(anime).toMatch(/<button type="button"[^>]*aria-label="取消：取消出題"[^>]*>取消<\/button>/)
  })

  it('送出中：主要按鈕「搜尋中…」（不是「取得排行榜…」），aria-busy、aria-disabled；四選一鎖住；沒有原生 disabled', () => {
    const busy = render(chartProps('anime-hot', true))
    expect(busy).toMatch(/<button type="submit"[^>]*aria-label="搜尋中…"[^>]*aria-disabled="true"[^>]*aria-busy="true"[^>]*>搜尋中…<\/button>/)
    expect(busy).not.toContain('取得排行榜')
    expect(busy).toMatch(/<div role="radiogroup" aria-label="題庫來源" aria-disabled="true"/)
    expect(radios(busy).every((x) => /aria-disabled="true"/.test(x.attrs))).toBe(true)
    expect(busy).not.toMatch(NATIVE_DISABLED)
  })

  it('失敗：顯示 server 的訊息（CHART_FAILED「取得題庫失敗，請再試一次」）、按鈕回到「分享」', () => {
    const failed = render(chartProps('anime-hot', false, '取得題庫失敗，請再試一次'))
    expect(failed).toMatch(/role="alert">取得題庫失敗，請再試一次<\/p>/)
    expect(failed).toContain('>分享</button>')
  })
})

describe('四選一的換列（375px 不溢出、不水平捲動；design §1「375px 放不下時換兩列」）', () => {
  /** radiogroup 與外層容器的 class */
  const groupClass = (html: string) => /<div role="radiogroup"[^>]*class="([^"]*)"/.exec(html)?.[1] ?? ''
  const html = render(chartProps('anime-hot', false))

  it('外層是 @container（量對話框內文寬，不看視窗寬）；radiogroup 預設兩欄 grid（2×2），容器 ≥ 340px 才一列膠囊', () => {
    expect(html).toMatch(/<div class="@container mb-\[16px\]"><div role="radiogroup"/)
    const cls = groupClass(html).split(' ')
    expect(cls).toEqual(expect.arrayContaining(['grid', 'grid-cols-2', '@min-[340px]:flex', '@min-[340px]:rounded-full']))
    // 沒有會造成水平捲動的設定（固定寬、不換行、overflow-x）
    expect(groupClass(html)).not.toMatch(/\bw-\[|nowrap|overflow-x/)
    // 選項可縮（min-w-0＋truncate），不會撐開容器
    for (const r of radios(html)) expect(r.attrs).toMatch(/min-w-0 flex-1 truncate/)
  })

  it('換列只靠 CSS：DOM 順序（＝方向鍵順序）仍是 歌手→台灣熱門→西洋熱門→動漫熱門', () => {
    expect(radios(html).map((x) => x.text)).toEqual(['歌手', '台灣熱門', '西洋熱門', '動漫熱門'])
  })

  it('segmentedGroupClass：選項 ≤ 3 一律一列膠囊（不換列），4 個起才有 2×2', () => {
    expect(SEGMENTED_SINGLE_ROW_MAX).toBe(3)
    for (const n of [1, 2, 3]) {
      expect(segmentedGroupClass(n)).toMatch(/^flex rounded-full /)
      expect(segmentedGroupClass(n)).not.toContain('grid')
    }
    expect(segmentedGroupClass(4)).toMatch(/^grid grid-cols-2 /)
    expect(segmentedGroupClass(4)).toBe(groupClass(html))
    // 兩種都只用面板 token 的框線
    expect(segmentedGroupClass(3)).toContain('border-border-panel')
    expect(segmentedGroupClass(4)).toContain('border-border-panel')
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
    // aria-disabled 只在：四選一（群組＋四顆）、勾選、主要按鈕；取消沒有
    expect(busy.match(/aria-disabled="true"/g)).toHaveLength(7)
    expect(idle).not.toContain('aria-disabled')
  })

  it('四選一與勾選：送出中只設 aria-disabled（不可切換），不是原生 disabled', () => {
    expect(checkboxTag(busy)).toContain('aria-disabled="true"')
    expect(checkboxTag(busy)).not.toMatch(NATIVE_DISABLED)
    expect(radios(busy).every((x) => /aria-disabled="true"/.test(x.attrs) && !NATIVE_DISABLED.test(x.attrs))).toBe(true)
    expect(checkboxTag(idle)).not.toContain('aria-disabled')
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

describe('SourceDialog（功能元件）：交給殼層的 props', () => {
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
    expect(capture(<SourceDialog />)).toBeNull()
  })

  it('choosing 且自己是出題者：purpose source、四選一預設「歌手」、欄位、勾選預設勾（沒有 localStorage 時）', async () => {
    // 靜態渲染讀的是 store 的初始狀態（server snapshot），這裡掛到假 DOM 上才讀得到設定的狀態
    useGameStore.setState({ me: 'p1', round: round({ phase: 'choosing', setterId: 'p1', endsAt: null }) })
    try {
      const seen: DialogProps[] = []
      const Dialog = (props: DialogProps) => {
        seen.push(props)
        return null
      }
      await mount(<ShellViewsContext.Provider value={{ ...MEET_VIEWS, Dialog }}>{<SourceDialog />}</ShellViewsContext.Provider>)
      const p = seen.at(-1)
      expect(p?.purpose).toBe('source')
      expect(p?.choices).toMatchObject({ label: '題庫來源', value: 'artist', locked: false })
      expect(p?.choices?.options).toBe(SOURCE_OPTIONS)
      expect(p?.input).toMatchObject({ placeholder: ARTIST_PLACEHOLDER, ariaLabel: ARTIST_FIELD_LABEL, autoFocus: true })
      expect(p?.toggle).toMatchObject({ label: '只抽熱門歌', checked: true, locked: false })
      expect(p?.description).toBeUndefined()
      expect(p?.items.map((i) => i.label)).toEqual([ARTIST_SUBMIT_LABEL, ARTIST_CANCEL_LABEL])
    } finally {
      await unmountAll()
      useGameStore.setState({ ...initialGameState })
    }
  })

  it('原始碼：purpose source、欄位與 placeholder 用常數、busy 交給殼層、失敗顯示 server 的訊息、送出中仍可取消', () => {
    const src = read('../src/features/round/SourceDialog.tsx')
    expect(src).toContain('purpose="source"')
    expect(src).toContain('busy={submitting || cancelling}')
    expect(src).toContain('placeholder: ARTIST_PLACEHOLDER')
    expect(src).toContain('ariaLabel: ARTIST_FIELD_LABEL')
    expect(src).toContain('label: submitLabel(source, submitting)')
    expect(src).toContain('pending: submitting')
    // 送出中四選一與勾選鎖住
    expect(src).toContain('locked: submitting')
    // 失敗才解除送出中並顯示 server 的訊息；成功時維持送出中直到 round:update 把對話框關掉
    expect(src).toMatch(/if \(r\.ok\) return\s+setSubmitting\(false\)\s+setError\(r\.message\)/)
    // 取消只在取消本身進行中才停用
    expect(src).toMatch(/label: ARTIST_CANCEL_LABEL,[^}]*disabled: cancelling \}/)
    expect(src).not.toMatch(/\sdisabled=\{/)
    // 每次開對話框都從預設來源開始（不讀偏好）
    expect(src).toContain('useState<SongSource>(DEFAULT_SOURCE)')
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

  it('出題對話框的節點（文件順序）：四選一、輸入框、勾選、取消、分享（主要在最後）；四選一不是對話框選項（不當還原落點）', () => {
    const nodes = parseNodes(render(artistProps(false)))
    expect(nodes.map((n) => [n.tag, n.attrs.type, n.attrs.role])).toEqual([
      ['button', 'button', 'radio'],
      ['button', 'button', 'radio'],
      ['button', 'button', 'radio'],
      ['button', 'button', 'radio'],
      ['input', undefined, undefined],
      ['input', 'checkbox', undefined],
      ['button', 'button', undefined],
      ['button', 'submit', undefined],
    ])
    for (const n of nodes.filter((x) => x.tag === 'button')) expect(DIALOG_OPTION_ATTR in n.attrs).toBe(n.attrs.role !== 'radio')
  })

  it('榜單模式失敗、焦點掉到 body：放回主要按鈕「分享」（沒有輸入框；不落在四選一）', () => {
    const nodes = parseNodes(render(chartProps('tw-hot', false, '取得題庫失敗，請再試一次')))
    expect(restoreDialogFocus(fakeRoot(nodes), BODY, MEET_DIALOG_REFOCUS_SELECTORS)).toBe(true)
    expect(focused(nodes).map((n) => n.attrs['aria-label'])).toEqual(['分享：抽歌並開始'])
  })

  it('動漫熱門失敗、焦點掉到 body：同樣放回「分享」', () => {
    const nodes = parseNodes(render(chartProps('anime-hot', false, '取得題庫失敗，請再試一次')))
    expect(restoreDialogFocus(fakeRoot(nodes), BODY, MEET_DIALOG_REFOCUS_SELECTORS)).toBe(true)
    expect(focused(nodes).map((n) => n.attrs['aria-label'])).toEqual(['分享：抽歌並開始'])
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
    expect(restoreDialogFocus(fakeRoot(nodes), nodes[5], MEET_DIALOG_REFOCUS_SELECTORS)).toBe(false)
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
