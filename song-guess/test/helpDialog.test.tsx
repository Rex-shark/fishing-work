// 遊戲說明對話框（features/help/HelpDialog；DESIGN §16）：兩步流程、佔位符取自殼層、meet 對話框的 body 呈現、說明入口。
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { HelpDialog, HelpDialogView } from '../src/features/help/HelpDialog'
import { closeHelp, openHelp } from '../src/features/help/helpOpen'
import { HELP_TOPICS, type HelpTopicId } from '../src/features/help/helpTopics'
import { useUiStore } from '../src/layout/uiStore'
import { MeetDialog } from '../src/shells/meet/MeetDialog'
import { HELP_BUTTON_LABEL, HELP_MENU_ITEM, MEET_SWITCH_HINT, SHARE_AUDIO_LABEL } from '../src/shells/meet/meetLayout'
import { HelpButton } from '../src/shells/meet/MeetShell'
import { MEET_VIEWS } from '../src/shells/meet/meetViews'
import { ShellViewsContext, type DialogProps, type ShellViews } from '../src/shells/views'

/** 以假 Dialog 記錄 HelpDialogView 交給殼層的 props；views 其餘欄位用 meet 的真值 */
function capture() {
  let last: DialogProps | null = null
  const Dialog = (p: DialogProps) => {
    last = p
    return null
  }
  const views: ShellViews = { ...MEET_VIEWS, Dialog }
  return {
    render(node: ReactNode): DialogProps | null {
      last = null
      renderToStaticMarkup(<ShellViewsContext.Provider value={views}>{node}</ShellViewsContext.Provider>)
      return last
    },
  }
}

const bodyText = (p: DialogProps | null) => renderToStaticMarkup(<>{p?.body}</>)

describe('HelpDialog：清單 → 內文 → 返回 → 清單 → 關閉', () => {
  function flow() {
    const cap = capture()
    let topic: 'list' | HelpTopicId | null = 'list'
    const onClose = vi.fn(() => {
      topic = null
    })
    const draw = () => (topic === null ? null : cap.render(<HelpDialogView topicId={topic} onNavigate={(t) => (topic = t)} onClose={onClose} />))
    return {
      draw,
      onClose,
      get topic() {
        return topic
      },
    }
  }

  it('第一步：purpose help、標題「說明」、items＝六個主題標題、沒有 body；Esc 關閉', () => {
    const f = flow()
    const list = f.draw()
    expect(list?.purpose).toBe('help')
    expect(list?.title).toBe('說明')
    expect(list?.body).toBeUndefined()
    expect(list?.input).toBeUndefined()
    expect(list?.items.map((i) => i.label)).toEqual(['怎麼玩', '出題', '猜歌', '計分', '聲音與耳機', '切換偽裝'])
    list?.onEscape?.()
    expect(f.onClose).toHaveBeenCalledTimes(1)
    expect(f.topic).toBeNull()
  })

  it('選主題 → 第二步（標題＝主題、body＝段落、「返回」「關閉」）→ 返回 → 清單 → 關閉', () => {
    const f = flow()
    f.draw()?.items[1]?.onSelect()
    expect(f.topic).toBe('be-setter')
    const detail = f.draw()
    expect(detail?.title).toBe('出題')
    expect(detail?.label).toBe('說明：出題')
    expect(detail?.items.map((i) => i.label)).toEqual(['返回', '關閉'])
    expect(bodyText(detail).match(/<p>/g)).toHaveLength(HELP_TOPICS[1]?.paragraphs.length ?? 0)
    detail?.items[0]?.onSelect()
    expect(f.topic).toBe('list')
    f.draw()?.items[5]?.onSelect()
    expect(f.topic).toBe('switch-theme')
    f.draw()?.items[1]?.onSelect()
    expect(f.topic).toBeNull()
    expect(f.draw()).toBeNull()
  })

  it('佔位符取自目前殼層：{volunteer}＝「分享音訊」、{switch}＝「更多 ⋮ → 切換偽裝」', () => {
    const detail = (id: HelpTopicId) => bodyText(capture().render(<HelpDialogView topicId={id} onNavigate={() => {}} onClose={() => {}} />))
    expect(detail('be-setter')).toContain(`按「${SHARE_AUDIO_LABEL}」`)
    expect(detail('switch-theme')).toContain(`<p>${MEET_SWITCH_HINT}，`)
    for (const t of HELP_TOPICS) expect(detail(t.id), t.id).not.toMatch(/[{}]/)
  })

  it('未知的主題 id 視為清單', () => {
    const p = capture().render(<HelpDialogView topicId={'nope' as HelpTopicId} onNavigate={() => {}} onClose={() => {}} />)
    expect(p?.body).toBeUndefined()
    expect(p?.items).toHaveLength(HELP_TOPICS.length)
  })

  it('HelpDialog 接 uiStore：helpTopic 為 null（初始）時不渲染；openHelp／closeHelp 切換 helpTopic', () => {
    expect(capture().render(<HelpDialog />)).toBeNull()
    openHelp()
    expect(useUiStore.getState().helpTopic).toBe('list')
    openHelp('sound')
    expect(useUiStore.getState().helpTopic).toBe('sound')
    closeHelp()
    expect(useUiStore.getState().helpTopic).toBeNull()
  })
})

const noop = () => {}

describe('meet 對話框的說明呈現（DESIGN §16：14px 段落、段距 8px）', () => {
  it('第二步：標題＝主題（20px）、段落容器 gap 8px、按鈕顯示選項原文、主要（返回）在最右', () => {
    const html = renderToStaticMarkup(
      <MeetDialog
        purpose="help"
        label="說明：計分"
        title="計分"
        body={[<p key="1">第一段</p>, <p key="2">第二段</p>]}
        items={[
          { id: 'back', label: '返回', detail: 'Enter', onSelect: noop },
          { id: 'close', label: '關閉', detail: 'Esc', onSelect: noop },
        ]}
        onEscape={noop}
      />,
    )
    expect(html).toContain('role="dialog"')
    expect(html).toMatch(/<h2[^>]*text-\[20px\][^>]*>計分<\/h2>/)
    expect(html).toContain('<div class="flex flex-col gap-[8px] text-[14px] leading-[20px] text-fg-on-panel"><p>第一段</p><p>第二段</p></div>')
    expect(html.indexOf('>關閉</button>')).toBeLessThan(html.indexOf('>返回</button>'))
    expect(html).toMatch(/<button type="submit"[^>]*>返回<\/button>/)
  })

  it('第一步：一列一個主題按鈕＋右下「關閉」；不用原生 disabled', () => {
    const html = renderToStaticMarkup(
      <MeetDialog
        purpose="help"
        label="說明"
        title="說明"
        items={HELP_TOPICS.map((t) => ({ id: t.id, label: t.title, onSelect: noop }))}
        onEscape={noop}
      />,
    )
    expect(html.match(/<li>/g)).toHaveLength(HELP_TOPICS.length)
    for (const t of HELP_TOPICS) expect(html).toContain(`>${t.title}</button>`)
    expect(html).toContain('>關閉</button>')
    expect(html).not.toMatch(/\sdisabled=""/)
  })
})

describe('說明入口（meet：控制列「資訊」、更多選單「說明…」）', () => {
  it('「資訊」按鈕：無障礙名稱與工具提示「說明」，點了呼叫 onOpen', () => {
    const html = renderToStaticMarkup(<HelpButton onOpen={noop} />)
    expect(HELP_BUTTON_LABEL).toBe('說明')
    expect(html).toContain('aria-label="說明"')
    expect(html).toContain('data-tooltip="說明"')
    expect(HELP_MENU_ITEM).toBe('說明…')
  })
})
