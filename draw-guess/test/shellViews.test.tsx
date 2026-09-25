// ShellViews 的選填外觀（Epic 3 Phase 3）：殼層沒提供 chat／toolbar／status 時沿用 vscode 外觀；有提供時功能元件照殼層的走。
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'

vi.mock('../src/socket/client', () => ({
  sendChat: vi.fn(),
  sendImage: vi.fn(),
  volunteer: vi.fn(),
}))

const { ChatPanel } = await import('../src/features/chat/ChatPanel')
const { fullToolbarQuery } = await import('../src/features/canvas/toolbarLayout')
const { StatusButton, StatusItem } = await import('../src/layout/StatusItem')
const views = await import('../src/shells/views')
const { VSCODE_CHAT_VIEW, VSCODE_STATUS_VIEW, VSCODE_TOOLBAR_VIEW } = await import('../src/shells/vscode/viewDefaults')
const {
  DEFAULT_CHAT_VIEW,
  DEFAULT_STATUS_VIEW,
  DEFAULT_TOOLBAR_VIEW,
  ShellViewsContext,
  resolveChatView,
  resolveStatusView,
  resolveToolbarView,
} = views
type ShellViews = import('../src/shells/views').ShellViews
type ChatView = import('../src/shells/views').ChatView

/** 只有必填欄位的殼層（例如尚未提供 renderer 的新主題） */
const minimal: ShellViews = { Dialog: () => null, PlayerList: () => null }

const withViews = (v: ShellViews | null, node: ReactNode) => renderToStaticMarkup(<ShellViewsContext.Provider value={v}>{node}</ShellViewsContext.Provider>)

describe('預設值＝vscode 外觀', () => {
  it('DEFAULT_* 就是 vscode 殼層提供的那組', () => {
    expect(DEFAULT_CHAT_VIEW).toBe(VSCODE_CHAT_VIEW)
    expect(DEFAULT_TOOLBAR_VIEW).toBe(VSCODE_TOOLBAR_VIEW)
    expect(DEFAULT_STATUS_VIEW).toBe(VSCODE_STATUS_VIEW)
  })

  it('殼層之外或殼層未提供時回預設', () => {
    for (const v of [null, minimal]) {
      expect(resolveChatView(v)).toBe(DEFAULT_CHAT_VIEW)
      expect(resolveToolbarView(v)).toBe(DEFAULT_TOOLBAR_VIEW)
      expect(resolveStatusView(v)).toBe(DEFAULT_STATUS_VIEW)
    }
  })

  it('殼層有提供時用殼層的', () => {
    const toolbar = { compactBelowPx: 900 }
    const status = { buttonClassName: 'text-fg' }
    const v: ShellViews = { ...minimal, toolbar, status }
    expect(resolveToolbarView(v)).toBe(toolbar)
    expect(resolveStatusView(v)).toBe(status)
    expect(resolveChatView(v)).toBe(DEFAULT_CHAT_VIEW)
  })
})

describe('畫師工具列收合斷點（ShellViews.toolbar.compactBelowPx）', () => {
  it('預設 1100px（DESIGN §5 vscode 分頁列）', () => {
    expect(DEFAULT_TOOLBAR_VIEW.compactBelowPx).toBe(1100)
    expect(fullToolbarQuery(DEFAULT_TOOLBAR_VIEW.compactBelowPx)).toBe('(min-width: 1100px)')
  })

  it('斷點由殼層決定', () => {
    expect(fullToolbarQuery(900)).toBe('(min-width: 900px)')
    expect(fullToolbarQuery(1280.4)).toBe('(min-width: 1280px)')
  })

  it('0、負數、非有限數 = 永不收合（查詢恆成立）', () => {
    for (const px of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(fullToolbarQuery(px)).toBe('(min-width: 0px)')
  })
})

describe('StatusItem／StatusButton', () => {
  const button = <StatusButton label="我來畫：自願當畫師" onClick={() => {}}>我來畫</StatusButton>

  it('StatusButton 預設：彩色狀態列上的白字、白色 hover 疊底與 focus 外框（殼層之外也可用）', () => {
    for (const html of [renderToStaticMarkup(button), withViews(minimal, button)]) {
      expect(html).toContain('text-fg-statusbar')
      expect(html).toContain('hover:bg-statusbar-hover')
      expect(html).toContain('focus-visible:outline-focus-on-color')
      expect(html).toContain('focus-visible:outline-1')
    }
  })

  it('StatusButton：殼層指定的色彩取代預設', () => {
    const html = withViews({ ...minimal, status: { buttonClassName: 'text-fg hover:bg-hover focus-visible:outline-border-focus' } }, button)
    expect(html).toContain('text-fg hover:bg-hover focus-visible:outline-border-focus')
    expect(html).not.toContain('statusbar')
    expect(html).not.toContain('focus-on-color')
    expect(html).toContain('focus-visible:outline-1')
  })

  it('StatusItem 不帶色彩，文字色沿用外層狀態列', () => {
    expect(renderToStaticMarkup(<StatusItem>Ln 12, Col 4</StatusItem>)).toBe(
      '<span class="flex h-full min-w-0 items-center gap-1 px-[5px]  ">Ln 12, Col 4</span>',
    )
  })
})

// SSR 下 Zustand 取初始狀態（聊天列表為空），訊息內容的推導由 chatFormat／terminalChat 測試涵蓋；這裡驗外觀的來源
describe('ChatPanel 依殼層的 ChatView 呈現', () => {
  it('殼層未提供 chat：終端機樣式（編輯區底色、❯ 提示符）', () => {
    const html = withViews(minimal, <ChatPanel />)
    expect(html).toContain('<div class="flex h-full min-h-0 flex-col bg-editor leading-[18px]">')
    expect(html).toContain('class="min-h-0 flex-1 overflow-y-auto px-3 py-1"')
    expect(html).toContain('<span aria-hidden="true" class="text-sem-type">❯</span>')
    expect(html).toContain('aria-label="聊天輸入"')
    expect(html).toBe(withViews({ ...minimal, chat: VSCODE_CHAT_VIEW }, <ChatPanel />))
  })

  it('殼層提供 chat：面板、列表、輸入列都用殼層的；輸入列拿到 placeholder、可否送出與錯誤', () => {
    const custom: ChatView = {
      panelClassName: 'bg-sidebar',
      listClassName: 'p-2',
      Line: ({ line }) => <li data-kind={line.kind}>{line.text}</li>,
      Composer: ({ onSubmit, input, error, canSend }) => (
        <form onSubmit={onSubmit} data-can-send={String(canSend)} data-error={error ?? ''}>
          <input {...input} />
        </form>
      ),
    }
    const html = withViews({ ...minimal, chat: custom }, <ChatPanel />)
    expect(html).toContain('<div class="flex h-full min-h-0 flex-col bg-sidebar">')
    expect(html).toContain('class="min-h-0 flex-1 overflow-y-auto p-2"')
    expect(html).toContain('<form data-can-send="false" data-error="">')
    expect(html).toContain('placeholder="輸入訊息後按 Enter"')
    expect(html).toContain('aria-label="聊天輸入"')
    expect(html).not.toContain('❯')
  })
})
