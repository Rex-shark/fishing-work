// 遊戲說明對話框（Epic 6 決策 2、3、4；DESIGN §16）：HelpDialog 兩步流程、三殼層 Dialog 的 body 呈現與「未提供 body 時輸出不變」、
// 各殼層入口呼叫 help.open 的參數、ppt「說明」分頁。
import { describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { HelpDialog, HelpDialogView } from '../src/features/help/HelpDialog'
import { closeHelp, openHelp } from '../src/features/help/helpOpen'
import { HELP_TOPICS, type HelpTopicId } from '../src/features/help/helpTopics'
import { useUiStore } from '../src/layout/uiStore'
import { THEME_CATALOG } from '../src/shells/catalog'
import { MeetDialog } from '../src/shells/meet/MeetDialog'
import { HelpButton, MeetShell } from '../src/shells/meet/MeetShell'
import { MoreMenuList } from '../src/shells/meet/MeetMoreMenu'
import { stepMenuItem as meetStepMenuItem } from '../src/shells/meet/meetLayout'
import { FileMenuList } from '../src/shells/ppt/FileMenu'
import { MEET_VIEWS } from '../src/shells/meet/meetViews'
import { PptDialog } from '../src/shells/ppt/PptDialog'
import { HelpRibbon, Ribbon, RibbonContent } from '../src/shells/ppt/PptShell'
import { RIBBON_CONTENT_TABS, RIBBON_TABS_HIDDEN_WHEN_NARROW, activeRibbonTab, stepMenuItem as pptStepMenuItem } from '../src/shells/ppt/pptLayout'
import { PPT_VIEWS } from '../src/shells/ppt/pptViews'
import type { ShellProps } from '../src/shells/types'
import { ShellViewsContext, type DialogProps, type ShellViews } from '../src/shells/views'
import { VscodeDialog } from '../src/shells/vscode/QuickInput'
import { manageMenuEntries, selectManageEntry } from '../src/shells/vscode/themePick'

// ─── HelpDialog 兩步流程 ─────────────────────────────────────────────

/** 以假 Dialog 記錄 HelpDialogView 交給殼層的 props；views 其餘欄位（volunteer、help）用各殼層的真值 */
function captureWith(base: ShellViews | null) {
  let last: DialogProps | null = null
  const Dialog = (p: DialogProps) => {
    last = p
    return null
  }
  const views: ShellViews = { ...(base ?? { PlayerList: () => null }), Dialog }
  return {
    render(node: ReactNode): DialogProps | null {
      last = null
      renderToStaticMarkup(<ShellViewsContext.Provider value={views}>{node}</ShellViewsContext.Provider>)
      return last
    },
  }
}

const bodyText = (p: DialogProps | null) => renderToStaticMarkup(<>{p?.body}</>)

describe('HelpDialog：清單 → 內文 → 返回 → 清單 → 關閉（決策 2）', () => {
  /** 狀態由測試持有，callback 更新後重繪（同 HelpDialog 以 uiStore 持有） */
  function flow(base: ShellViews | null) {
    const cap = captureWith(base)
    let topic: 'list' | HelpTopicId | null = 'list'
    const onClose = vi.fn(() => {
      topic = null
    })
    const draw = () => (topic === null ? null : cap.render(<HelpDialogView topicId={topic} onNavigate={(t) => (topic = t)} onClose={onClose} />))
    return { draw, onClose, get topic() { return topic } }
  }

  it('第一步：purpose help、標題「說明」、items＝六個主題標題、沒有 body；Esc 關閉', () => {
    const f = flow(null)
    const list = f.draw()
    expect(list?.purpose).toBe('help')
    expect(list?.title).toBe('說明')
    expect(list?.label).toBe('說明')
    expect(list?.body).toBeUndefined()
    expect(list?.input).toBeUndefined()
    expect(list?.items.map((i) => i.label)).toEqual(HELP_TOPICS.map((t) => t.title))
    list?.onEscape?.()
    expect(f.onClose).toHaveBeenCalledTimes(1)
    expect(f.topic).toBeNull()
  })

  it('選主題 → 第二步（標題＝主題、body＝段落、「返回」「關閉」）→ 返回 → 清單 → 關閉', () => {
    const f = flow(null)
    f.draw()?.items[0]?.onSelect()
    expect(f.topic).toBe('be-drawer')
    const detail = f.draw()
    expect(detail?.purpose).toBe('help')
    expect(detail?.title).toBe('如何當畫師')
    expect(detail?.label).toBe('說明：如何當畫師')
    expect(detail?.items.map((i) => i.label)).toEqual(['返回', '關閉'])
    expect(bodyText(detail)).toBe(
      '<p>房間至少 2 人在線時，畫面上會出現「我來畫」，按下去你就是本回合的畫師。</p><p>接著在 60 秒內輸入題目（1–20 字）並按 Enter，就開始作畫，時間 90 秒。</p><p>作畫中不能在聊天室說出答案，也不能傳圖片。</p>',
    )
    detail?.items[0]?.onSelect()
    expect(f.topic).toBe('list')
    const again = f.draw()
    expect(again?.body).toBeUndefined()
    again?.items[2]?.onSelect()
    expect(f.topic).toBe('switch-theme')
    f.draw()?.items[1]?.onSelect()
    expect(f.topic).toBeNull()
    expect(f.draw()).toBeNull()
  })

  it('第二步按 Esc 也關閉', () => {
    const f = flow(null)
    f.draw()?.items[4]?.onSelect()
    f.draw()?.onEscape?.()
    expect(f.onClose).toHaveBeenCalledTimes(1)
    expect(f.topic).toBeNull()
  })

  it('佔位符取自目前殼層：{volunteer}＝volunteer.label、{switch}＝help.switchHint', () => {
    const detail = (base: ShellViews | null, id: HelpTopicId) =>
      bodyText(captureWith(base).render(<HelpDialogView topicId={id} onNavigate={() => {}} onClose={() => {}} />))
    expect(detail(PPT_VIEWS, 'be-drawer')).toContain('「從目前投影片開始」')
    expect(detail(MEET_VIEWS, 'be-drawer')).toContain('「分享畫面」')
    expect(detail(null, 'switch-theme')).toContain('<p>左下角齒輪 → 切換偽裝，選一個想要的介面風格；下次進入時首頁會預選它。</p>')
    expect(detail(PPT_VIEWS, 'switch-theme')).toContain('<p>檔案 → 切換偽裝，')
    expect(detail(MEET_VIEWS, 'switch-theme')).toContain('<p>更多 ⋮ → 切換偽裝，')
    for (const t of HELP_TOPICS) expect(detail(MEET_VIEWS, t.id), t.id).not.toContain('{')
  })

  it('HelpDialog 接 uiStore：helpTopic 為 null（初始）時不渲染；openHelp／closeHelp 切換 helpTopic', () => {
    expect(captureWith(null).render(<HelpDialog />)).toBeNull()
    openHelp()
    expect(useUiStore.getState().helpTopic).toBe('list')
    openHelp('image')
    expect(useUiStore.getState().helpTopic).toBe('image')
    closeHelp()
    expect(useUiStore.getState().helpTopic).toBeNull()
  })
})

// ─── 三個殼層 Dialog 的 body ─────────────────────────────────────────

const noop = () => {}
const paragraphs = [<p key="1">第一段</p>, <p key="2">第二段</p>]
const listProps: DialogProps = {
  purpose: 'help',
  label: '說明',
  title: '說明',
  items: HELP_TOPICS.map((t) => ({ id: t.id, label: t.title, onSelect: noop })),
  onEscape: noop,
}
const topicProps: DialogProps = {
  purpose: 'help',
  label: '說明：如何當畫師',
  title: '如何當畫師',
  body: paragraphs,
  items: [
    { id: 'back', label: '返回', detail: 'Enter', onSelect: noop },
    { id: 'close', label: '關閉', detail: 'Esc', onSelect: noop },
  ],
  onEscape: noop,
}

describe('Dialog 的 body（DESIGN §16 段落排版）', () => {
  it('vscode：快速輸入框的標題列下方 13px／行高 18px、段距 6px；選項「› 返回」「› 關閉」', () => {
    const html = renderToStaticMarkup(<VscodeDialog {...topicProps} />)
    expect(html).toContain('<div class="flex flex-col gap-[6px] px-1 pb-[6px] text-[13px] leading-[18px] text-fg"><p>第一段</p><p>第二段</p></div>')
    expect(html.indexOf('如何當畫師')).toBeLessThan(html.indexOf('第一段'))
    expect(html.indexOf('第二段')).toBeLessThan(html.indexOf('role="listbox"'))
    expect(html).toContain('› 返回')
    expect(html).toContain('› 關閉')
    // 位置同其他對話框（分頁列下方置中）
    expect(html).toContain('absolute top-[35px] left-1/2 -translate-x-1/2')
    // 清單步驟：沒有 body 元素，六個主題
    const list = renderToStaticMarkup(<VscodeDialog {...listProps} />)
    expect(list).not.toContain('gap-[6px] px-1 pb-[6px]')
    expect(list.match(/role="option"/g)).toHaveLength(6)
  })

  it('ppt：標題列＝title、內文 14px／行高 20px、段距 8px；按鈕顯示「返回」（主要）「關閉」，不換成確定／取消', () => {
    const html = renderToStaticMarkup(<PptDialog {...topicProps} />)
    expect(html).toMatch(/<span id="[^"]+" class="truncate text-fg">如何當畫師<\/span>/)
    expect(html).toContain('<div class="flex flex-col gap-[8px] text-[14px] leading-[20px] text-fg"><p>第一段</p><p>第二段</p></div>')
    expect(html).not.toContain('mb-3 leading-[20px]')
    expect(html).toMatch(/<button type="submit" autofocus="" aria-label="返回"[^>]*bg-accent[^>]*>返回<\/button>/)
    expect(html).toMatch(/<button type="button" aria-label="關閉"[^>]*bg-button-secondary[^>]*>關閉<\/button>/)
    expect(html).not.toMatch(/>確定<|>取消</)
  })

  it('ppt 清單步驟：標題列「說明」、一列一個主題按鈕（第一列預設焦點）＋右下「關閉」', () => {
    const html = renderToStaticMarkup(<PptDialog {...listProps} />)
    expect(html).toMatch(/class="truncate text-fg">說明<\/span>/)
    const rows = html.match(/<li><button type="button"[^>]*>[^<]+<\/button><\/li>/g) ?? []
    expect(rows.map((r) => r.replace(/<[^>]+>/g, ''))).toEqual(HELP_TOPICS.map((t) => t.title))
    expect(rows[0]).toContain('autofocus=""')
    expect(rows[1]).not.toContain('autofocus')
    expect(html).toContain('focus:bg-active focus:text-fg-on-active')
    expect(html).toMatch(/bg-button-secondary[^>]*>關閉<\/button>/)
    expect(html).not.toMatch(/>確定<|type="submit"/)
  })

  it('meet：標題 20px＝title、內文 14px／段距 8px（白卡片用 --fg-on-panel）；按鈕「關閉」「返回」（主要在最右）', () => {
    const html = renderToStaticMarkup(<MeetDialog {...topicProps} />)
    expect(html).toMatch(/<h2 id="[^"]+" class="mb-\[16px\] truncate text-\[20px\][^"]*">如何當畫師<\/h2>/)
    expect(html).toContain('<div class="flex flex-col gap-[8px] text-[14px] leading-[20px] text-fg-on-panel"><p>第一段</p><p>第二段</p></div>')
    const buttons = [...html.matchAll(/<button type="(\w+)"[^>]*>([^<]+)<\/button>/g)].map((m) => [m[1], m[2]])
    expect(buttons).toEqual([
      ['button', '關閉'],
      ['submit', '返回'],
    ])
    expect(html).not.toContain('text-sem-error')
  })

  it('meet 清單步驟：一列一個主題按鈕＋右下「關閉」（藍字文字按鈕）', () => {
    const html = renderToStaticMarkup(<MeetDialog {...listProps} />)
    expect(html).toMatch(/<h2[^>]*>說明<\/h2>/)
    const rows = html.match(/<li><button type="button"[^>]*>[^<]+<\/button><\/li>/g) ?? []
    expect(rows).toHaveLength(6)
    expect(rows[0]).toContain('autofocus=""')
    expect(html).toMatch(/text-accent-panel[^>]*>關閉<\/button>/)
  })
})

describe('未提供 body 時三個 Dialog 的輸出與 Epic 6 前完全相同（舊截圖位元組不變）', () => {
  // 期望值＝Epic 5 版 VscodeDialog／PptDialog／MeetDialog 以相同 props 渲染的 sha256 前 16 碼（Epic 6 實作時以舊版原始碼並排比對逐字相同後記錄）
  const cases: Record<string, DialogProps> = {
    topic: {
      purpose: 'topic',
      label: '出題',
      input: { value: '貓', onChange: noop, placeholder: '輸入題目（1–20 字）後按 Enter', ariaLabel: '題目', maxLength: 20, enterKeyHint: 'go' },
      items: [
        { id: 'ok', label: '出題並開始作畫', detail: '1/20', onSelect: noop },
        { id: 'cancel', label: '放棄本回合', detail: 'Esc', onSelect: noop },
      ],
      onEscape: noop,
      note: '剩 00:45',
      error: null,
    },
    topicErr: {
      purpose: 'topic',
      label: '出題',
      input: { value: '', onChange: noop, placeholder: 'p', ariaLabel: '題目', invalid: true, disabled: true },
      items: [
        { id: 'ok', label: '送出中…', onSelect: noop, disabled: true },
        { id: 'cancel', label: '放棄本回合', onSelect: noop },
      ],
      error: '題目不可空白',
    },
    cancel: {
      purpose: 'cancelRound',
      label: '放棄本回合',
      title: '放棄這一回合？題目會直接揭曉。',
      items: [
        { id: 'confirm', label: '放棄本回合', detail: 'Enter', onSelect: noop },
        { id: 'keep', label: '繼續作畫', detail: 'Esc', onSelect: noop },
      ],
      onEscape: noop,
      error: '回合已結束',
    },
    cancelNoEsc: {
      purpose: 'cancelRound',
      label: '放棄本回合',
      title: 'x',
      items: [
        { id: 'confirm', label: '放棄中…', onSelect: noop, disabled: true },
        { id: 'keep', label: '繼續作畫', onSelect: noop },
        { id: 'third', label: '其他', onSelect: noop },
      ],
    },
  }
  const expected: Record<string, Record<string, string>> = {
    vscode: { topic: '976ce44b8f072031', topicErr: '0dc64c143878fe77', cancel: '5f979b482a423f57', cancelNoEsc: '3fd8bb41ca549923' },
    ppt: { topic: '258b965115a22720', topicErr: '59a0e1b2035d999e', cancel: '775926323f891dd4', cancelNoEsc: '0ed35c518b15ac87' },
    meet: { topic: 'cdb86d5bcaa1a06d', topicErr: 'ce1f2f8ca8f44847', cancel: '7de9cb50224a0278', cancelNoEsc: 'e105e598dd8b0237' },
  }
  const dialogs = { vscode: VscodeDialog, ppt: PptDialog, meet: MeetDialog }

  it.each(Object.keys(cases))('%s', async (name) => {
    const crypto = (await import('node:crypto' as string)) as { createHash(a: string): { update(s: string): { digest(e: string): string } } }
    const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16)
    for (const [shell, Dialog] of Object.entries(dialogs)) {
      const props = cases[name]!
      const html = renderToStaticMarkup(<Dialog {...props} />)
      expect(hash(html), `${shell} ${name}`).toBe(expected[shell]![name])
      // body 明確給 undefined 也一樣
      expect(renderToStaticMarkup(<Dialog {...props} body={undefined} />), `${shell} ${name}`).toBe(html)
    }
  })
})

// ─── 各殼層入口 ─────────────────────────────────────────────────────

/** 走訪 React 元素樹（不渲染元件）找出符合條件的元素 */
function findElements(node: ReactNode, pred: (el: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>>[] {
  const out: ReactElement<Record<string, unknown>>[] = []
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

describe('vscode：齒輪選單「說明…」（DESIGN §5）', () => {
  it('遊戲中（有說明）：「切換偽裝…」「說明…」；沒有說明時只有「切換偽裝…」', () => {
    expect(manageMenuEntries(false).map((i) => i.label)).toEqual(['切換偽裝…'])
    expect(manageMenuEntries(true).map((i) => [i.id, i.label])).toEqual([
      ['switch-theme', '切換偽裝…'],
      ['help', '說明…'],
    ])
  })

  it('「說明…」：先關選單並把焦點還給齒輪，再呼叫 help.open()（不帶主題＝清單）；「切換偽裝…」不還焦點', () => {
    const calls: string[] = []
    const handlers = {
      close: (r: boolean) => void calls.push(`close(${r})`),
      onSwitchTheme: () => void calls.push('switch'),
      onHelp: (...args: unknown[]) => void calls.push(`help(${args.length})`),
    }
    const [sw, help] = manageMenuEntries(true)
    selectManageEntry(help!, handlers)
    expect(calls).toEqual(['close(true)', 'help(0)'])
    calls.length = 0
    selectManageEntry(sw!, handlers)
    expect(calls).toEqual(['close(false)', 'switch'])
  })
})

describe('ppt：「說明」分頁（DESIGN §13.2）', () => {
  it('「說明」是可作用分頁；窄螢幕仍先藏（RIBBON_TABS_HIDDEN_WHEN_NARROW 不變）', () => {
    expect(RIBBON_CONTENT_TABS).toEqual(['常用', '繪圖', '說明'])
    expect(RIBBON_TABS_HIDDEN_WHEN_NARROW).toEqual(['轉場', '動畫', '校閱', '檢視', '說明'])
    expect(activeRibbonTab({ tab: '說明', base: '常用' }, '常用')).toBe('說明')
    // 回合狀態讓預設分頁改變（輪到自己作畫）→ 回到預設
    expect(activeRibbonTab({ tab: '說明', base: '常用' }, '繪圖')).toBe('繪圖')
  })

  it('遊戲中（有 onHelp）：「說明」為 role=tab 按鈕（未選取、窄螢幕隱藏）；自動重連畫面（沒有 onHelp）為裝飾文字', () => {
    const game = renderToStaticMarkup(<Ribbon fallback="常用" fileRef={{ current: null }} onSwitchTheme={noop} onHelp={noop} />)
    expect(game).toMatch(/<button type="button" role="tab" aria-selected="false" aria-controls="ppt-ribbon-panel" class="[^"]*border-transparent text-fg hover:bg-hover max-lg:hidden">說明<\/button>/)
    // 預設作用分頁仍是「常用」，功能區內容與改動前相同（裝飾按鈕群）
    expect(game).toMatch(/role="tabpanel" aria-label="常用"/)
    const resume = renderToStaticMarkup(<Ribbon fallback="常用" fileRef={{ current: null }} />)
    expect(resume).toContain('<span aria-hidden="true" class="flex shrink-0 items-center border-t-2 border-transparent px-3 text-fg max-lg:hidden">說明</span>')
    expect(resume).not.toContain('role="tab" aria-selected="false" aria-controls="ppt-ribbon-panel" class="flex shrink-0 cursor-pointer items-center border-t-2 px-3 transition-colors duration-100 focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-border-focus border-transparent text-fg hover:bg-hover max-lg:hidden')
  })

  it('「常用」「繪圖」分頁的 class 與改動前相同（不附加窄螢幕 class）', () => {
    const game = renderToStaticMarkup(<Ribbon fallback="常用" fileRef={{ current: null }} onSwitchTheme={noop} onHelp={noop} />)
    expect(game).toContain('class="flex shrink-0 cursor-pointer items-center border-t-2 px-3 transition-colors duration-100 focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-border-focus border-accent bg-tab-active text-accent">常用</button>')
    expect(game).toContain('class="flex shrink-0 cursor-pointer items-center border-t-2 px-3 transition-colors duration-100 focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-border-focus border-transparent text-fg hover:bg-hover">繪圖</button>')
  })

  it('作用中：功能區為一排主題按鈕（16px 圖示＋標籤，一顆一主題），群組名稱「說明」', () => {
    const html = renderToStaticMarkup(<RibbonContent active="說明" onHelp={noop} />)
    const buttons = html.match(/<button type="button"[^>]*>.*?<\/button>/g) ?? []
    expect(buttons.map((b) => b.replace(/<[^>]+>/g, ''))).toEqual(HELP_TOPICS.map((t) => t.title))
    for (const b of buttons) expect(b).toMatch(/<svg width="16" height="16"/)
    expect(html).toMatch(/text-\[11px\] leading-\[14px\] text-fg-muted">說明<\/div>/)
    // 沒有 onHelp（不會發生於遊戲中）時退回「常用」
    expect(renderToStaticMarkup(<RibbonContent active="說明" />)).toBe(renderToStaticMarkup(<RibbonContent active="常用" />))
  })

  it('主題按鈕呼叫 help.open(主題 id)：直接跳第二步', () => {
    const onOpen = vi.fn()
    const buttons = findElements(HelpRibbon({ onOpen }), (el) => el.type === 'button')
    expect(buttons).toHaveLength(6)
    for (const b of buttons) (b.props.onClick as () => void)()
    expect(onOpen.mock.calls).toEqual(HELP_TOPICS.map((t) => [t.id]))
  })
})

describe('meet：底部「資訊」＝說明（DESIGN §15.2）', () => {
  const game: ShellProps = {
    screen: 'game',
    round: { phase: 'idle', isDrawer: false, canDraw: false, drawerName: null },
    counts: { online: 2, total: 2 },
    themes: { current: 'meet', options: THEME_CATALOG, select: noop },
    help: { open: noop },
    players: null,
    canvas: null,
    toolbar: null,
    chat: null,
    roundStatus: null,
    volunteer: null,
    connection: null,
    dialogs: null,
  }

  it('遊戲中：真按鈕、無障礙名稱與工具提示「說明」；自動重連畫面維持裝飾（會議詳細資料）', () => {
    const html = renderToStaticMarkup(<MeetShell {...game} />)
    expect(html).toMatch(/<button type="button" aria-label="說明" data-tooltip="說明" data-tooltip-placement="top" class="[^"]*hover:bg-hover[^"]*max-md:hidden">/)
    expect(html).not.toContain('會議詳細資料')
    const resume = renderToStaticMarkup(<MeetShell screen="resume" notice="正在重新加入…" connection={null} />)
    expect(resume).toContain('data-tooltip="會議詳細資料"')
    expect(resume).not.toContain('aria-label="說明"')
  })

  it('點「資訊」呼叫 help.open()（不帶主題＝清單）', () => {
    const onOpen = vi.fn()
    const el = HelpButton({ onOpen })
    ;(el.props as { onClick: () => void }).onClick()
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith()
  })
})

describe('窄螢幕入口（決策 8）：ppt「檔案」與 meet「更多 ⋮」選單的第二項「說明…」', () => {
  const menuItems = (html: string) => [...html.matchAll(/role="menuitem"[^>]*>([^<]+)</g)].map((m) => m[1])
  const menuProps = { position: { left: 0, top: 0, bottom: 0 }, anchor: { current: null }, onClose: noop, onSwitchTheme: noop }

  it('ppt「檔案」：遊戲說明時「切換偽裝…」「說明…」；沒有時只有「切換偽裝…」（裝飾項目不變）', () => {
    const withHelp = renderToStaticMarkup(<FileMenuList {...menuProps} onHelp={noop} />)
    expect(menuItems(withHelp)).toEqual(['切換偽裝…', '說明…'])
    expect(menuItems(renderToStaticMarkup(<FileMenuList {...menuProps} />))).toEqual(['切換偽裝…'])
    expect(withHelp.match(/aria-hidden="true"/g)).toHaveLength(7)
    // 兩項外觀相同（同一組 class）
    const classes = [...withHelp.matchAll(/role="menuitem" tabindex="-1" class="([^"]+)"/g)].map((m) => m[1])
    expect(new Set(classes).size).toBe(1)
  })

  it('meet「更多 ⋮」：遊戲說明時「切換偽裝…」「說明…」；沒有時只有「切換偽裝…」', () => {
    const withHelp = renderToStaticMarkup(<MoreMenuList {...menuProps} onHelp={noop} />)
    expect(menuItems(withHelp)).toEqual(['切換偽裝…', '說明…'])
    expect(menuItems(renderToStaticMarkup(<MoreMenuList {...menuProps} />))).toEqual(['切換偽裝…'])
    const classes = [...withHelp.matchAll(/role="menuitem" tabindex="-1" class="([^"]+)"/g)].map((m) => m[1])
    expect(new Set(classes).size).toBe(1)
  })

  it.each([
    ['ppt', pptStepMenuItem],
    ['meet', meetStepMenuItem],
  ] as const)('%s 選單鍵盤：↑↓ 循環、Home／End；一項時停在原地；其他鍵 null', (_name, step) => {
    expect(step(2, 0, 'ArrowDown')).toBe(1)
    expect(step(2, 1, 'ArrowDown')).toBe(0)
    expect(step(2, 0, 'ArrowUp')).toBe(1)
    expect(step(2, 1, 'Home')).toBe(0)
    expect(step(2, 0, 'End')).toBe(1)
    expect(step(2, -1, 'ArrowDown')).toBe(0)
    expect(step(1, 0, 'ArrowDown')).toBe(0)
    expect(step(1, 0, 'ArrowUp')).toBe(0)
    expect(step(2, 0, 'Enter')).toBeNull()
    expect(step(0, -1, 'ArrowDown')).toBeNull()
  })
})
