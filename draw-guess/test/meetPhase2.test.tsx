// meet 主題 Phase 2（plan/meet-theme.md 決策 9、13）：拖圖覆蓋層（ChatView.overlayClassName）與同人合併（ChatLineProps.groupWithPrevious）
// 的預設不影響 vscode／ppt、ChatPanel 分組純函式、「更多 ⋮」選單與切換偽裝、響應式純邏輯、首頁卡片描述兩行平衡。
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRef } from 'react'
import { groupsWithPrevious } from '../src/features/chat/chatFormat'
import { HomeThemeCards } from '../src/home/HomeThemeCards'
import { THEME_CATALOG } from '../src/shells/catalog'
import { MeetChatLine } from '../src/shells/meet/MeetChat'
import { MeetThemeDialog, MoreButton } from '../src/shells/meet/MeetMoreMenu'
import { MeetShell } from '../src/shells/meet/MeetShell'
import {
  MEET_BREAKPOINTS,
  MORE_MENU_DECOR,
  PANEL_OVERLAY_QUERY,
  THEME_CURRENT_NOTE,
  THEME_UPCOMING_NOTE,
  chooseMeetTheme,
  meetLayoutFor,
  meetThemeInitialIndex,
  meetThemeItems,
  stepEnabledIndex,
} from '../src/shells/meet/meetLayout'
import { MEET_CHAT_VIEW, MEET_VIEWS } from '../src/shells/meet/meetViews'
import { CommentLine } from '../src/shells/ppt/CommentChat'
import { PPT_CHAT_VIEW } from '../src/shells/ppt/pptViews'
import type { ShellId, ShellProps, ShellThemeSwitch } from '../src/shells/types'
import { DEFAULT_CHAT_OVERLAY_CLASS, resolveChatOverlayClass, type ChatLineData } from '../src/shells/views'
import { TerminalChatLine } from '../src/shells/vscode/TerminalChat'
import { VSCODE_CHAT_VIEW } from '../src/shells/vscode/viewDefaults'

const fs = (await import('node:fs' as string)) as { readFileSync(path: URL, encoding: 'utf8'): string }
const read = (f: string) => fs.readFileSync(new URL(f, import.meta.url), 'utf8')
const chatPanelSrc = read('../src/features/chat/ChatPanel.tsx')
const meetShellSrc = read('../src/shells/meet/MeetShell.tsx')
const tilesSrc = read('../src/shells/meet/ParticipantTiles.tsx')

function line(p: Partial<ChatLineData> & Pick<ChatLineData, 'kind'>): ChatLineData {
  return { id: 'm1', fromId: 'b', nickname: 'amy', text: '是狗嗎', at: 0, time: '14:32', isMine: false, reveal: null, image: null, ...p }
}

// ─── 拖圖覆蓋層 ─────────────────────────────────────────────────

describe('ChatView.overlayClassName（決策 13(2)）', () => {
  it('預設＝ Epic 5 前寫死的值（DESIGN §5）；vscode／ppt 不提供 → 用預設（位元組不變）', () => {
    expect(DEFAULT_CHAT_OVERLAY_CLASS).toBe('border-2 border-dashed border-border-focus bg-selection/35 text-fg')
    expect(VSCODE_CHAT_VIEW.overlayClassName).toBeUndefined()
    expect(PPT_CHAT_VIEW.overlayClassName).toBeUndefined()
    expect(resolveChatOverlayClass(VSCODE_CHAT_VIEW)).toBe(DEFAULT_CHAT_OVERLAY_CLASS)
    expect(resolveChatOverlayClass(PPT_CHAT_VIEW)).toBe(DEFAULT_CHAT_OVERLAY_CLASS)
  })

  it('ChatPanel 的覆蓋層 class ＝固定排版＋外觀：預設時與舊字串完全相同', () => {
    expect(chatPanelSrc).toContain(
      'className={`pointer-events-none absolute inset-0 z-20 flex items-center justify-center ${resolveChatOverlayClass(view)}`}',
    )
    const composed = `pointer-events-none absolute inset-0 z-20 flex items-center justify-center ${DEFAULT_CHAT_OVERLAY_CLASS}`
    expect(composed).toBe(
      'pointer-events-none absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-border-focus bg-selection/35 text-fg',
    )
    expect(chatPanelSrc).toContain('放開以傳送圖片')
  })

  it('meet：白底 --bg-panel 90%、2px 虛線與文字 --accent-panel', () => {
    expect(MEET_VIEWS.chat).toBe(MEET_CHAT_VIEW)
    expect(resolveChatOverlayClass(MEET_CHAT_VIEW)).toBe('border-2 border-dashed border-accent-panel bg-panel/90 text-accent-panel')
  })
})

// ─── 同人合併 ───────────────────────────────────────────────────

describe('groupsWithPrevious（ChatPanel 分組純函式；決策 13(5)）', () => {
  const m = (kind: 'chat' | 'image' | 'system' | 'correct', fromId: string | null) => ({ kind, fromId })

  it('同 fromId 且兩則皆為 chat／image → true', () => {
    expect(groupsWithPrevious(m('chat', 'a'), m('chat', 'a'))).toBe(true)
    expect(groupsWithPrevious(m('chat', 'a'), m('image', 'a'))).toBe(true)
    expect(groupsWithPrevious(m('image', 'a'), m('chat', 'a'))).toBe(true)
  })

  it('第一則、不同人、system／correct（打斷分組）、fromId 為 null → false', () => {
    expect(groupsWithPrevious(undefined, m('chat', 'a'))).toBe(false)
    expect(groupsWithPrevious(m('chat', 'b'), m('chat', 'a'))).toBe(false)
    expect(groupsWithPrevious(m('correct', 'a'), m('chat', 'a'))).toBe(false)
    expect(groupsWithPrevious(m('chat', 'a'), m('correct', 'a'))).toBe(false)
    expect(groupsWithPrevious(m('system', null), m('system', null))).toBe(false)
  })

  it('ChatPanel 以前一則計算並傳給 Line', () => {
    expect(chatPanelSrc).toContain('groupWithPrevious={groupsWithPrevious(chat[i - 1], m)}')
  })

  it('vscode／ppt 忽略 groupWithPrevious（輸出完全相同）', () => {
    const l = line({ kind: 'chat' })
    expect(renderToStaticMarkup(<TerminalChatLine line={l} groupWithPrevious />)).toBe(renderToStaticMarkup(<TerminalChatLine line={l} />))
    expect(renderToStaticMarkup(<CommentLine line={l} groupWithPrevious />)).toBe(renderToStaticMarkup(<CommentLine line={l} />))
  })

  it('meet：合併時不再顯示「暱稱 HH:mm」行（名字與時間只給報讀器），內文照常', () => {
    const first = renderToStaticMarkup(<MeetChatLine line={line({ kind: 'chat' })} />)
    const grouped = renderToStaticMarkup(<MeetChatLine line={line({ kind: 'chat', text: '還是貓' })} groupWithPrevious />)
    expect(first).toContain('<time')
    expect(first).not.toContain('data-grouped')
    expect(grouped).toContain('data-grouped=""')
    expect(grouped).not.toContain('<time')
    expect(grouped).toContain('<span class="sr-only">amy 14:32</span>')
    expect(grouped).toContain('還是貓')
    // system／correct 不受影響
    const sys = line({ kind: 'system', fromId: null, nickname: null, text: 'amy 加入了' })
    expect(renderToStaticMarkup(<MeetChatLine line={sys} groupWithPrevious />)).toBe(renderToStaticMarkup(<MeetChatLine line={sys} />))
  })
})

// ─── 「更多 ⋮」選單與切換偽裝 ─────────────────────────────────────

function switcher(current: ShellId, options = THEME_CATALOG) {
  const calls: ShellId[] = []
  const themes: ShellThemeSwitch = { current, options, select: (id) => void calls.push(id) }
  return { themes, calls }
}
const withUpcoming = THEME_CATALOG.map((o) => (o.id === 'ppt' ? { ...o, available: false } : o))

describe('切換偽裝純邏輯（meetLayout）', () => {
  it('清單：目前主題標「目前使用」、未上線標「即將推出」不可選', () => {
    expect(meetThemeItems(switcher('meet').themes).map((i) => [i.id, i.note, i.disabled, i.current])).toEqual([
      ['vscode', undefined, false, false],
      ['ppt', undefined, false, false],
      ['meet', THEME_CURRENT_NOTE, false, true],
    ])
    expect(meetThemeItems(switcher('meet', withUpcoming).themes)[1]).toMatchObject({ id: 'ppt', note: THEME_UPCOMING_NOTE, disabled: true })
    expect(meetThemeInitialIndex(switcher('meet').themes)).toBe(2)
  })

  it('↑↓ 循環並略過不可選、Home／End；其他鍵 null', () => {
    const items = meetThemeItems(switcher('meet', withUpcoming).themes)
    expect(stepEnabledIndex(items, 0, 'ArrowDown')).toBe(2)
    expect(stepEnabledIndex(items, 2, 'ArrowDown')).toBe(0)
    expect(stepEnabledIndex(items, 0, 'ArrowUp')).toBe(2)
    expect(stepEnabledIndex(items, 2, 'Home')).toBe(0)
    expect(stepEnabledIndex(items, 0, 'End')).toBe(2)
    expect(stepEnabledIndex(items, 0, 'a')).toBeNull()
    expect(stepEnabledIndex([{ disabled: true }], 0, 'ArrowDown')).toBeNull()
  })

  it('切到 vscode／ppt 呼叫 select；目前主題或未上線不呼叫（不重寫 localStorage）', () => {
    const s = switcher('meet')
    expect(chooseMeetTheme(s.themes, 'vscode')).toBe(true)
    expect(chooseMeetTheme(s.themes, 'ppt')).toBe(true)
    expect(s.calls).toEqual(['vscode', 'ppt'])
    const same = switcher('meet')
    expect(chooseMeetTheme(same.themes, 'meet')).toBe(false)
    const up = switcher('meet', withUpcoming)
    expect(chooseMeetTheme(up.themes, 'ppt')).toBe(false)
    expect([...same.calls, ...up.calls]).toEqual([])
  })
})

describe('「更多 ⋮」與切換偽裝對話框（靜態渲染）', () => {
  it('更多選項：真按鈕、aria-haspopup=menu、aria-expanded=false、有工具提示', () => {
    const html = renderToStaticMarkup(<MoreButton buttonRef={createRef()} onSwitchTheme={() => {}} />)
    expect(html).toMatch(/^<button type="button" aria-label="更多選項" aria-haspopup="menu" aria-expanded="false" data-tooltip="更多選項"/)
    expect(html).toContain('rounded-full')
  })

  it('裝飾項目 5 個（管理錄影…設定）', () => {
    expect(MORE_MENU_DECOR).toEqual(['管理錄影', '變更版面配置', '全螢幕', '套用視覺效果', '設定'])
  })

  it('對話框：白卡片、listbox 三個主題、目前主題選取並標「目前使用」、取消／切換', () => {
    const html = renderToStaticMarkup(<MeetThemeDialog themes={switcher('meet').themes} onClose={() => {}} />)
    expect(html).toMatch(/role="dialog" aria-label="切換偽裝"/)
    expect(html).toContain('bg-panel')
    expect(html).toContain('role="listbox"')
    expect(html.match(/role="option"/g)).toHaveLength(3)
    expect(html).toMatch(/aria-selected="true"[^>]*>[\s\S]*?視訊會議[\s\S]*?目前使用/)
    expect(html).toContain('>取消<')
    expect(html).toContain('>切換<')
  })

  it('未上線主題：aria-disabled、即將推出、有提示', () => {
    const html = renderToStaticMarkup(<MeetThemeDialog themes={switcher('meet', withUpcoming).themes} onClose={() => {}} />)
    expect(html).toMatch(/aria-selected="false" aria-disabled="true"[^>]*>[\s\S]*?簡報[\s\S]*?即將推出/)
    expect(html).toContain('data-tooltip="「簡報」即將推出，暫不可選"')
  })

  const themes = { current: 'meet' as const, options: THEME_CATALOG, select: () => {} }
  const game: ShellProps = {
    screen: 'game',
    round: { phase: 'idle', isDrawer: false, canDraw: false, drawerName: null },
    counts: { online: 2, total: 2 },
    themes,
    help: { open: () => {} },
    players: null,
    canvas: null,
    toolbar: null,
    chat: null,
    roundStatus: null,
    volunteer: null,
    connection: null,
    dialogs: null,
  }

  it('遊戲畫面控制列有可操作的「更多選項」；自動重連畫面的「更多選項」為裝飾', () => {
    expect(renderToStaticMarkup(<MeetShell {...game} />)).toContain('aria-label="更多選項" aria-haspopup="menu"')
    const resume = renderToStaticMarkup(<MeetShell screen="resume" notice="正在重新加入…" connection={null} />)
    expect(resume).not.toContain('aria-haspopup="menu"')
    expect(resume).toContain('data-tooltip="更多選項"')
  })
})

// ─── 響應式 ─────────────────────────────────────────────────────

describe('響應式（DESIGN §15.3；決策 9）', () => {
  it('斷點 1280／1024／768', () => {
    expect(MEET_BREAKPOINTS).toEqual({ stripNarrow: 1280, stripBelow: 1024, panelOverlay: 768 })
  })

  it.each([
    [1440, { strip: 'side', tileWidth: 184, panelOverlay: false }],
    [1280, { strip: 'side', tileWidth: 184, panelOverlay: false }],
    [1279, { strip: 'side', tileWidth: 144, panelOverlay: false }],
    [1024, { strip: 'side', tileWidth: 144, panelOverlay: false }],
    [1023, { strip: 'below', tileWidth: 120, panelOverlay: false }],
    [768, { strip: 'below', tileWidth: 120, panelOverlay: false }],
    [767, { strip: 'below', tileWidth: 120, panelOverlay: true }],
  ])('%i px → %j', (w, expected) => {
    expect(meetLayoutFor(w)).toEqual(expected)
  })

  it('覆蓋層 media query 對應 < 768px', () => {
    expect(PANEL_OVERLAY_QUERY).toBe('(max-width: 767.98px)')
  })

  it('實作的 Tailwind 斷點與 MEET_BREAKPOINTS 一致（max-xl＝1280、max-lg＝1024、max-md＝768）', () => {
    // 影片條：200px → < 1280 160px → < 1024 改到下方橫向（tile 120px）
    expect(meetShellSrc).toMatch(/aria-label="參加者"[\s\S]*?w-\[200px\][^"]*max-xl:w-\[160px\][^"]*max-lg:w-auto/)
    expect(meetShellSrc).toContain('max-lg:flex-col')
    expect(tilesSrc).toContain('max-lg:flex-row')
    expect(tilesSrc).toContain('max-lg:w-[120px]')
    // 面板：< 768 覆蓋層
    expect(meetShellSrc).toMatch(/data-chat-drop-zone=""[\s\S]*?max-md:absolute[^"]*max-md:z-30/)
  })

  it('面板預設開；「訊息」與 × 共用同一個開關（關閉＝hidden，保持掛載）', () => {
    expect(meetShellSrc).toContain('const [chatOpen, setChatOpen] = useState(true)')
    expect(meetShellSrc).toContain("chatOpen ? 'flex' : 'hidden'")
  })
})

// ─── 首頁卡片描述（決策 13(6)） ───────────────────────────────────

describe('首頁卡片描述：兩行平衡換行', () => {
  it('描述 13px／18px、text-wrap: balance', () => {
    const html = renderToStaticMarkup(<HomeThemeCards options={THEME_CATALOG} value="vscode" onSelect={() => {}} />)
    expect(html.match(/text-\[13px\] leading-\[18px\] text-home-fg-muted \[text-wrap:balance\]/g)).toHaveLength(3)
  })
})
