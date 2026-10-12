// 遊戲說明對話框（複製自我畫你猜；DESIGN §16）：HelpDialog 兩步流程、ppt Dialog 的 body 呈現與「未提供 body 時輸出不變」、
// ppt 入口呼叫 help.open 的參數（「說明」分頁、「檔案」選單）。
import { describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { HelpDialog, HelpDialogView } from '../src/features/help/HelpDialog'
import { closeHelp, openHelp } from '../src/features/help/helpOpen'
import { HELP_TOPICS, type HelpTopicId } from '../src/features/help/helpTopics'
import { useUiStore } from '../src/layout/uiStore'
import { FileMenuList } from '../src/shells/office/FileMenu'
import { PptDialog } from '../src/shells/ppt/PptDialog'
import { HelpRibbon, Ribbon, RibbonContent } from '../src/shells/ppt/PptShell'
import { RIBBON_CONTENT_TABS, RIBBON_TABS_HIDDEN_WHEN_NARROW, activeRibbonTab, stepMenuItem as pptStepMenuItem } from '../src/shells/ppt/pptLayout'
import { PPT_VIEWS } from '../src/shells/ppt/pptViews'
import { ShellViewsContext, type DialogProps, type ShellViews } from '../src/shells/views'

// ─── HelpDialog 兩步流程 ─────────────────────────────────────────────

/** 以假 Dialog 記錄 HelpDialogView 交給殼層的 props；views 其餘欄位（volunteer、help）用殼層的真值 */
function captureWith(base: ShellViews) {
  let last: DialogProps | null = null
  const Dialog = (p: DialogProps) => {
    last = p
    return null
  }
  const views: ShellViews = { ...base, Dialog }
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
  function flow(base: ShellViews) {
    const cap = captureWith(base)
    let topic: 'list' | HelpTopicId | null = 'list'
    const onClose = vi.fn(() => {
      topic = null
    })
    const draw = () => (topic === null ? null : cap.render(<HelpDialogView topicId={topic} onNavigate={(t) => (topic = t)} onClose={onClose} />))
    return { draw, onClose, get topic() { return topic } }
  }

  it('第一步：purpose help、標題「說明」、items＝六個主題標題、沒有 body；Esc 關閉', () => {
    const f = flow(PPT_VIEWS)
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
    const f = flow(PPT_VIEWS)
    f.draw()?.items[0]?.onSelect()
    expect(f.topic).toBe('be-setter')
    const detail = f.draw()
    expect(detail?.purpose).toBe('help')
    expect(detail?.title).toBe('如何出題')
    expect(detail?.label).toBe('說明：如何出題')
    expect(detail?.items.map((i) => i.label)).toEqual(['返回', '關閉'])
    expect(bodyText(detail)).toContain('<p>房間至少 2 人在線、沒有回合進行中時，按「從目前投影片開始」，你就是本回合的出題者。</p>')
    detail?.items[0]?.onSelect()
    expect(f.topic).toBe('list')
    const again = f.draw()
    expect(again?.body).toBeUndefined()
    again?.items[5]?.onSelect()
    expect(f.topic).toBe('chat-reconnect')
    f.draw()?.items[1]?.onSelect()
    expect(f.topic).toBeNull()
    expect(f.draw()).toBeNull()
  })

  it('第二步按 Esc 也關閉', () => {
    const f = flow(PPT_VIEWS)
    f.draw()?.items[4]?.onSelect()
    f.draw()?.onEscape?.()
    expect(f.onClose).toHaveBeenCalledTimes(1)
    expect(f.topic).toBeNull()
  })

  it('佔位符取自目前殼層：{volunteer}＝volunteer.label、{switch}＝help.switchHint、{save}＝terms.save', () => {
    const detail = (base: ShellViews, id: HelpTopicId) =>
      bodyText(captureWith(base).render(<HelpDialogView topicId={id} onNavigate={() => {}} onClose={() => {}} />))
    expect(detail(PPT_VIEWS, 'be-setter')).toContain('「從目前投影片開始」')
    expect(detail(PPT_VIEWS, 'chat-reconnect')).toContain('想換介面風格：檔案 → 切換偽裝。</p>')
    expect(detail(PPT_VIEWS, 'submit')).toContain('在確認框按「儲存」就交卷')
    const other = { ...PPT_VIEWS, volunteer: { label: '開始' }, help: { switchHint: 'X' }, terms: { ...PPT_VIEWS.terms, save: 'S' } }
    expect(detail(other, 'chat-reconnect')).toContain('想換介面風格：X。')
    expect(detail(other, 'submit')).toContain('在確認框按「S」')
    expect(detail(other, 'ranking')).toContain('按「開始」開始下一回合')
    // Epic 15：揭曉的評語說明（評審名稱來自 shared 常數，不是殼層名稱，換殼層不變）
    expect(detail(PPT_VIEWS, 'ranking')).toContain('<p>揭曉時評審「メスガキ」會給每張交卷的畫一句評語')
    expect(detail(other, 'ranking')).toContain('揭曉時評審「メスガキ」')
    // Phase 4：第一名的評語是稱讚版
    expect(detail(PPT_VIEWS, 'ranking')).toContain('寫在畫的下面，第一名會被稱讚。')
    expect(detail(PPT_VIEWS, 'scoring')).not.toContain('稱讚')
    for (const t of HELP_TOPICS) expect(detail(PPT_VIEWS, t.id), t.id).not.toContain('{')
  })

  it('HelpDialog 接 uiStore：helpTopic 為 null（初始）時不渲染；openHelp／closeHelp 切換 helpTopic', () => {
    expect(captureWith(PPT_VIEWS).render(<HelpDialog />)).toBeNull()
    openHelp()
    expect(useUiStore.getState().helpTopic).toBe('list')
    openHelp('scoring')
    expect(useUiStore.getState().helpTopic).toBe('scoring')
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
  label: '說明：如何出題',
  title: '如何出題',
  body: paragraphs,
  items: [
    { id: 'back', label: '返回', detail: 'Enter', onSelect: noop },
    { id: 'close', label: '關閉', detail: 'Esc', onSelect: noop },
  ],
  onEscape: noop,
}

describe('Dialog 的 body（DESIGN §16 段落排版）', () => {
  it('ppt：標題列＝title、內文 14px／行高 20px、段距 8px；按鈕顯示「返回」（主要）「關閉」，不換成確定／取消', () => {
    const html = renderToStaticMarkup(<PptDialog {...topicProps} />)
    expect(html).toMatch(/<span id="[^"]+" class="truncate text-fg">如何出題<\/span>/)
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

})

describe('未提供 body 時 PptDialog 的輸出與我畫你猜相同（複製後未改動 Office 對話框）', () => {
  // 期望值＝我畫你猜 PptDialog 以相同 props 渲染的 sha256 前 16 碼（出題的兩個情境；繪圖比賽沒有放棄確認）
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
      // 送出中：原為 input.disabled，2026-10-12 起改為對話框層級的 busy（輸入框 readOnly＋aria-busy，不用原生 disabled）
      busy: true,
      input: { value: '', onChange: noop, placeholder: 'p', ariaLabel: '題目', invalid: true },
      items: [
        { id: 'ok', label: '送出中…', onSelect: noop, disabled: true },
        { id: 'cancel', label: '放棄本回合', onSelect: noop },
      ],
      error: '題目不可空白',
    },
  }
  const expected: Record<string, Record<string, string>> = {
    ppt: { topic: '258b965115a22720', topicErr: '59a0e1b2035d999e' },
  }
  const dialogs = { ppt: PptDialog }

  /**
   * 2026-10-12 焦點修正（plan/notes.md：送出中不再用原生 disabled）之後，輸出與當初複製時只差三處；把這三處還原再比對原本的雜湊，
   * 其餘仍須與複製時逐字相同：
   *   (1) 輸入框送出中的樣式 disabled:opacity-60 → aria-busy:cursor-default aria-busy:opacity-60；
   *   (2) 送出中的輸入框 disabled → readOnly＋aria-busy；
   *   (3) 選項按鈕多了 data-dialog-option（busy 結束後還原焦點用）
   */
  const beforeFocusFix = (html: string) =>
    html
      .replace('aria-busy:cursor-default aria-busy:opacity-60', 'disabled:opacity-60')
      .replace(' readOnly="" aria-busy="true"', ' disabled=""')
      .replaceAll(' data-dialog-option=""', '')

  it('焦點修正後的差異只有上述三處（還原前的輸出確實含這些字樣）', () => {
    const topic = renderToStaticMarkup(<PptDialog {...cases.topic!} />)
    const busy = renderToStaticMarkup(<PptDialog {...cases.topicErr!} />)
    expect(topic).toContain('aria-busy:cursor-default aria-busy:opacity-60')
    expect(topic.match(/ data-dialog-option=""/g)).toHaveLength(2)
    expect(topic).not.toContain(' readOnly=""')
    expect(busy).toContain(' readOnly="" aria-busy="true"')
    expect(busy).not.toMatch(/\sdisabled=""/)
    expect(beforeFocusFix(busy)).toMatch(/<input [^>]*\sdisabled=""/)
  })

  it.each(Object.keys(cases))('%s', async (name) => {
    const crypto = (await import('node:crypto' as string)) as { createHash(a: string): { update(s: string): { digest(e: string): string } } }
    const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16)
    for (const [shell, Dialog] of Object.entries(dialogs)) {
      const props = cases[name]!
      const html = renderToStaticMarkup(<Dialog {...props} />)
      expect(hash(beforeFocusFix(html)), `${shell} ${name}`).toBe(expected[shell]![name])
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
    expect(buttons).toHaveLength(HELP_TOPICS.length)
    for (const b of buttons) (b.props.onClick as () => void)()
    expect(onOpen.mock.calls).toEqual(HELP_TOPICS.map((t) => [t.id]))
  })
})

describe('窄螢幕入口：ppt「檔案」選單的第二項「說明…」', () => {
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

  it.each([['ppt', pptStepMenuItem]] as const)('%s 選單鍵盤：↑↓ 循環、Home／End；一項時停在原地；其他鍵 null', (_name, step) => {
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
