// ppt 主題收尾（Epic 3 Phase 3 C）：註解卡片聊天（CommentChat／commentFormat）、PPT 的 status／toolbar／volunteer 外觀、
// 「我來畫」文字可換（ShellViews.volunteer）、--fg-on-active token、PptShell 不再就地改寫 CSS 變數
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import type { ChatMessage } from '@fishing-work/shared'

// VolunteerStatus 讀 store：SSR 下 Zustand 只給初始狀態，這裡以假 store 提供 idle＋2 人在線
const fakeState = {
  round: { phase: 'idle', drawerId: null, topic: null, topicLength: null, endsAt: null, endReason: null },
  players: [
    { id: 'a', nickname: 'rex', connected: true },
    { id: 'b', nickname: 'amy', connected: true },
  ],
}
vi.mock('../src/store/game', () => ({
  useGameStore: (selector: (s: typeof fakeState) => unknown) => selector(fakeState),
  selectHasGuessed: () => false,
  selectIsDrawer: () => false,
  selectMyGain: () => null,
}))
vi.mock('../src/socket/client', () => ({ volunteer: vi.fn(), sendChat: vi.fn(), sendImage: vi.fn() }))

const { chatLineData } = await import('../src/features/chat/chatFormat')
const { VolunteerStatus } = await import('../src/features/round/RoundStatus')
const { volunteerAriaLabel } = await import('../src/features/round/roundDisplay')
const { StatusButton } = await import('../src/layout/StatusItem')
const { PlayIcon } = await import('../src/layout/icons')
const { CommentComposer, CommentLine } = await import('../src/shells/ppt/CommentChat')
const { AVATAR_COLOR_COUNT, COMMENT_PLACEHOLDER, avatarColorIndex, avatarInitial } = await import('../src/shells/ppt/commentFormat')
const { SlideshowIcon } = await import('../src/shells/ppt/pptIcons')
const { START_SLIDESHOW_LABEL } = await import('../src/shells/ppt/pptLayout')
const { PPT_CHAT_VIEW, PPT_STATUS_VIEW, PPT_TOOLBAR_VIEW, PPT_VIEWS, PPT_VOLUNTEER_VIEW } = await import('../src/shells/ppt/pptViews')
const { DEFAULT_VOLUNTEER_VIEW, ShellViewsContext, resolveVolunteerView } = await import('../src/shells/views')
const { VSCODE_VOLUNTEER_VIEW } = await import('../src/shells/vscode/viewDefaults')
type ShellViews = import('../src/shells/views').ShellViews
type ChatInputProps = import('../src/shells/views').ChatInputProps

const fs = (await import('node:fs' as string)) as { readFileSync(path: URL, encoding: 'utf8'): string }
const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
const themeCss = read('../src/styles/theme.css')

const minimal: ShellViews = { Dialog: () => null, PlayerList: () => null }
const withViews = (v: ShellViews | null, node: ReactNode) => renderToStaticMarkup(<ShellViewsContext.Provider value={v}>{node}</ShellViewsContext.Provider>)
/** SSR 輸出去掉 React 在相鄰文字節點間插入的 <!-- --> 與所有標籤，只留文字 */
const textOf = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, '')

const msg = (patch: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1',
  kind: 'chat',
  fromId: 'p1',
  nickname: 'amy',
  text: '是狗嗎',
  at: Date.UTC(2026, 8, 25, 6, 32),
  ...patch,
})
const line = (m: ChatMessage, local: Parameters<typeof chatLineData>[1] = {}) =>
  renderToStaticMarkup(<CommentLine line={chatLineData(m, local)} />)

// ─── 頭像 ───────────────────────────────────────────────────────

describe('avatarInitial：暱稱首字（DESIGN §13.2）', () => {
  it('中文取第一個字、英文轉大寫、去頭尾空白', () => {
    expect(avatarInitial('小明')).toBe('小')
    expect(avatarInitial('amy')).toBe('A')
    expect(avatarInitial('  ben ')).toBe('B')
  })

  it('emoji 與罕用字不切半（字素：膚色、國旗、ZWJ 家庭）', () => {
    expect(avatarInitial('😀abc')).toBe('😀')
    expect(avatarInitial('𠮷野家')).toBe('𠮷')
    expect(avatarInitial('👍🏽讚')).toBe('👍🏽')
    expect(avatarInitial('🇹🇼台灣')).toBe('🇹🇼')
    expect(avatarInitial('👨‍👩‍👧家')).toBe('👨‍👩‍👧')
  })

  it('沒有 Intl.Segmenter 時退回以 code point 取（不會出現半個代理對）', () => {
    expect(avatarInitial('😀abc', null)).toBe('😀')
    expect(avatarInitial('𠮷野家', null)).toBe('𠮷')
    expect(avatarInitial('amy', null)).toBe('A')
    const first = avatarInitial('👍🏽讚', null)
    expect(first).toBe('👍')
    expect(first.length).toBe(2)
  })

  it('null 或空白 → ?', () => {
    expect(avatarInitial(null)).toBe('?')
    expect(avatarInitial('   ')).toBe('?')
  })
})

describe('avatarColorIndex：依暱稱雜湊取 6 色之一', () => {
  const names = ['rex', 'amy', 'ben', 'carol', '小明', '阿華', '😀', 'Bob', 'bob', 'x']

  it('範圍 0..5、同一暱稱永遠同色', () => {
    expect(AVATAR_COLOR_COUNT).toBe(6)
    for (const n of names) {
      const i = avatarColorIndex(n)
      expect(Number.isInteger(i) && i >= 0 && i < 6).toBe(true)
      expect(avatarColorIndex(n)).toBe(i)
      expect(avatarColorIndex(`${n}`.slice(0))).toBe(i)
    }
  })

  it('固定值（FNV-1a；改演算法會讓大家的頭像換色，須刻意更新）', () => {
    expect(names.map((n) => avatarColorIndex(n))).toEqual([2, 0, 4, 2, 0, 3, 5, 4, 2, 3])
  })

  it('不同暱稱會分散到多種顏色；null 與空字串同色', () => {
    expect(new Set(names.map((n) => avatarColorIndex(n))).size).toBeGreaterThanOrEqual(4)
    expect(avatarColorIndex(null)).toBe(avatarColorIndex(''))
  })
})

// ─── 各 kind 的呈現 ───────────────────────────────────────────────

describe('CommentLine：註解卡片（DESIGN §13.2 右註解窗格）', () => {
  it('chat：卡片＝圓形頭像（首字、雜湊底色、白字）＋暱稱粗體＋時間＋內文', () => {
    const html = line(msg())
    expect(html).toMatch(/^<li data-kind="chat" class="rounded-\[2px\] border border-border px-2 py-\[6px\] bg-card">/)
    expect(html).toMatch(new RegExp(`<span aria-hidden="true" class="[^"]*rounded-full[^"]*text-fg-on-avatar bg-avatar-${avatarColorIndex('amy') + 1}">A</span>`))
    expect(html).toContain('font-bold text-sem-variable">amy</span>')
    expect(html).toMatch(/<time dateTime="2026-09-25T06:32:00.000Z" class="[^"]*text-fg-dim[^"]*">\d\d:\d\d<\/time>/)
    expect(html).toContain('text-fg-editor">是狗嗎</p>')
    // 沒有終端機外觀
    expect(textOf(html)).not.toMatch(/\/\/ |❯|\[\d\d:\d\d\]|amy: /)
  })

  it('自己的留言：卡片底 bg-active（同縮圖窗格「自己的卡」）', () => {
    const html = line(msg(), { meId: 'p1' })
    expect(html).toContain('py-[6px] bg-active"')
    expect(html).not.toContain('bg-card')
  })

  it('system：灰字單行、無卡片、無 `// ` 前綴', () => {
    const html = line(msg({ kind: 'system', fromId: null, nickname: null, text: 'amy 加入了' }))
    expect(html).toBe('<li data-kind="system" class="px-1 text-[12px] leading-[16px] break-words text-sem-comment">amy 加入了</li>')
  })

  it('system 揭曉：題目以 --sem-string 粗體強調', () => {
    const html = line(msg({ kind: 'system', fromId: null, nickname: null, text: '題目是 hot dog（大）（全員猜對）' }))
    expect(html).toContain('<span class="font-bold text-sem-string">hot dog（大）</span>')
    expect(textOf(html)).toBe('題目是 hot dog（大）（全員猜對）')
    expect(html).not.toContain('border')
  })

  it('correct：綠勾卡片（勾是圖示、文字綠色粗體、有時間）', () => {
    const html = line(msg({ kind: 'correct', text: 'ben 猜對了' }))
    expect(html).toMatch(/^<li data-kind="correct" class="rounded-\[2px\] border border-border px-2 py-\[6px\] flex items-start gap-2 bg-card">/)
    expect(html).toMatch(/<svg[^>]*class="shrink-0 mt-\[1px\] text-sem-type"/)
    expect(html).toContain('font-bold break-words text-sem-type">ben 猜對了</span>')
    expect(html).toContain('<time')
    expect(textOf(html)).not.toContain('✓')
  })

  const img = (patch: Partial<ChatMessage> = {}) =>
    msg({ kind: 'image', nickname: 'bob', fromId: 'p2', text: '', image: { mime: 'image/jpeg', width: 1280, height: 853, bytes: 100_000 }, ...patch })

  it('image（有圖）：卡片內縮圖，最寬 200px（1280×853 → 200×133）；窄窗格以 max-width 收進卡片', () => {
    const html = line(img(), { imageStatus: 'ready', imageUrl: 'blob:x' })
    // React 19 SSR 會在前面加圖片 preload 的 <link>
    expect(html).toMatch(/<li data-kind="image" class="[^"]*bg-card">/)
    expect(html).toContain('bg-avatar-')
    expect(html).toContain('>B</span>')
    expect(html).toContain('<div class="[&amp;_button]:max-w-full [&amp;_img]:h-auto! [&amp;_img]:max-w-full"><button')
    expect(html).toContain('src="blob:x"')
    expect(html).toContain('alt="bob 傳送的圖片"')
    expect(html).toContain('width:200px;height:133px')
    expect(html).not.toContain('[圖片]')
  })

  it.each([
    ['pending', '[圖片]（載入中…）'],
    ['skipped', '[圖片]（連線較慢，已略過）'],
    ['revoked', '[圖片]（已清除）'],
    ['snapshot', '[圖片]（中途加入看不到）'],
  ] as const)('image（%s）：卡片內灰字佔位 %s', (status, text) => {
    const html = line(img(), { imageStatus: status })
    expect(html).toContain(`<p class="mt-1 break-words text-fg-muted">${text}</p>`)
    expect(html).not.toContain('<img')
  })
})

// ─── 輸入列 ───────────────────────────────────────────────────────

const input: ChatInputProps = {
  value: '',
  onChange: () => {},
  onPaste: () => {},
  maxLength: 200,
  placeholder: '輸入答案或聊天',
  'aria-label': '聊天輸入',
  'aria-invalid': false,
  autoComplete: 'off',
  enterKeyHint: 'send',
}

describe('CommentComposer：「新增註解…」輸入框＋送出鈕', () => {
  it('form 內有 input（受控屬性原樣展開）、placeholder 為「新增註解…」、沒有 ❯ 提示符', () => {
    const html = renderToStaticMarkup(<CommentComposer onSubmit={() => {}} input={input} error={null} canSend={false} />)
    expect(html).toMatch(/^<form class="shrink-0 border-t border-border p-2">/)
    expect(html).toContain(`placeholder="${COMMENT_PLACEHOLDER}"`)
    expect(COMMENT_PLACEHOLDER).toBe('新增註解…')
    expect(html).toContain('aria-label="聊天輸入"')
    expect(html).toContain('maxLength="200"')
    expect(html).toContain('focus-within:border-border-focus')
    expect(html).not.toContain('❯')
    expect(html).not.toContain('role="alert"')
  })

  it('功能提示（功能元件給的 placeholder）顯示在輸入框上方一行 12px --fg-muted，並以 aria-describedby 關聯；placeholder 仍是「新增註解…」', () => {
    for (const hint of ['輸入答案或聊天', '聊天（不可說出答案）']) {
      const html = renderToStaticMarkup(
        <CommentComposer onSubmit={() => {}} input={{ ...input, placeholder: hint }} error={null} canSend={false} />,
      )
      const m = html.match(/<p id="([^"]+)" class="mb-1 truncate text-\[12px\] leading-\[16px\] text-fg-muted">([^<]*)<\/p>/)
      expect(m).not.toBeNull()
      expect(m![2]).toBe(hint)
      expect(html).toContain(`aria-describedby="${m![1]}"`)
      expect(html).toContain(`placeholder="${COMMENT_PLACEHOLDER}"`)
      expect(html.indexOf(`id="${m![1]}"`)).toBeLessThan(html.indexOf('<input'))
    }
  })

  it('不可送出：送出鈕 aria-disabled＋灰化（不用原生 disabled，保留工具提示）', () => {
    const html = renderToStaticMarkup(<CommentComposer onSubmit={() => {}} input={input} error={null} canSend={false} />)
    expect(html).toMatch(/<button type="submit" aria-label="送出註解" aria-disabled="true" data-tooltip="送出註解"[^>]*opacity-60/)
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""/)
  })

  it('可送出：作用色 text-accent、可點', () => {
    const html = renderToStaticMarkup(<CommentComposer onSubmit={() => {}} input={{ ...input, value: '蘋果' }} error={null} canSend />)
    expect(html).toMatch(/aria-disabled="false"[^>]*cursor-pointer text-accent/)
  })

  it('錯誤：role="alert"、--sem-error，放在輸入框上方', () => {
    const html = renderToStaticMarkup(<CommentComposer onSubmit={() => {}} input={input} error="不可洩題" canSend={false} />)
    expect(html).toMatch(/<p role="alert" class="[^"]*text-sem-error"><svg[^>]*>.*<\/svg><span class="min-w-0">不可洩題<\/span><\/p>/)
    expect(html.indexOf('role="alert"')).toBeLessThan(html.indexOf('<input'))
  })
})

// ─── PPT 的 ShellViews ─────────────────────────────────────────────

describe('PPT_VIEWS：註解、狀態列、工具列、我來畫', () => {
  it('提供全部選填欄位', () => {
    expect(PPT_VIEWS.chat).toBe(PPT_CHAT_VIEW)
    expect(PPT_VIEWS.status).toBe(PPT_STATUS_VIEW)
    expect(PPT_VIEWS.toolbar).toBe(PPT_TOOLBAR_VIEW)
    expect(PPT_VIEWS.volunteer).toBe(PPT_VOLUNTEER_VIEW)
    expect(PPT_CHAT_VIEW.Line).toBe(CommentLine)
    expect(PPT_CHAT_VIEW.Composer).toBe(CommentComposer)
    expect(PPT_CHAT_VIEW.panelClassName).toBe('bg-sidebar leading-[18px]')
  })

  it('狀態列按鈕：淺灰底上的深色字、淺灰 hover、橘紅 focus 外框（不用白字／白框）', () => {
    expect(PPT_STATUS_VIEW.buttonClassName).toBe('text-fg hover:bg-statusbar-hover focus-visible:outline-border-focus')
    expect(PPT_STATUS_VIEW.buttonClassName).not.toMatch(/fg-statusbar|focus-on-color/)
  })

  it('工具列收合斷點：功能區整列給工具列，640px 以下才收合（vscode 為 1120）', () => {
    expect(PPT_TOOLBAR_VIEW.compactBelowPx).toBe(640)
  })

  it('我來畫＝「▶ 從目前投影片開始」', () => {
    expect(PPT_VOLUNTEER_VIEW).toEqual({ label: '從目前投影片開始', icon: SlideshowIcon })
    expect(PPT_VOLUNTEER_VIEW.label).toBe(START_SLIDESHOW_LABEL)
  })
})

describe('「我來畫」文字可換（ShellViews.volunteer）', () => {
  it('預設＝vscode 的「▷ 我來畫」', () => {
    expect(DEFAULT_VOLUNTEER_VIEW).toBe(VSCODE_VOLUNTEER_VIEW)
    expect(VSCODE_VOLUNTEER_VIEW).toEqual({ label: '我來畫', icon: PlayIcon })
    expect(resolveVolunteerView(null)).toBe(DEFAULT_VOLUNTEER_VIEW)
    expect(resolveVolunteerView(minimal)).toBe(DEFAULT_VOLUNTEER_VIEW)
    expect(resolveVolunteerView(PPT_VIEWS)).toBe(PPT_VOLUNTEER_VIEW)
  })

  it('無障礙名稱以可見文字開頭', () => {
    expect(volunteerAriaLabel('我來畫')).toBe('我來畫：自願當畫師')
    expect(volunteerAriaLabel('從目前投影片開始')).toBe('從目前投影片開始：自願當畫師')
  })

  it('預設輸出與改版前的寫死版本逐字相同（vscode 外觀不變）', () => {
    const before = renderToStaticMarkup(
      <StatusButton label="我來畫：自願當畫師" onClick={() => {}} disabled={false}>
        <PlayIcon size={14} />
        <span>我來畫</span>
      </StatusButton>,
    )
    expect(renderToStaticMarkup(<VolunteerStatus />)).toBe(before)
    expect(withViews(minimal, <VolunteerStatus />)).toBe(before)
  })

  it('ppt：「從目前投影片開始」＋投影片放映圖示、深色字狀態列樣式', () => {
    const html = withViews(PPT_VIEWS, <VolunteerStatus />)
    expect(html).toContain('aria-label="從目前投影片開始：自願當畫師"')
    expect(html).toContain('<span>從目前投影片開始</span>')
    expect(html).toContain(renderToStaticMarkup(<SlideshowIcon size={14} />))
    expect(html).toContain('text-fg hover:bg-statusbar-hover focus-visible:outline-border-focus')
    expect(html).not.toContain('我來畫')
  })

  it('沒給圖示：只顯示文字', () => {
    const html = withViews({ ...minimal, volunteer: { label: '開始' } }, <VolunteerStatus />)
    expect(html).toContain('<span>開始</span>')
    expect(html).not.toContain('<svg')
  })
})

// ─── token ─────────────────────────────────────────────────────────

describe('theme.css：--fg-on-active 與註解卡片 token', () => {
  const root = /:root\s*\{([^}]*)\}/.exec(themeCss)?.[1] ?? ''
  const ppt = /\[data-theme='ppt'\]\s*\{([^}]*)\}/.exec(themeCss)?.[1] ?? ''
  const value = (block: string, token: string) => new RegExp(`${token}:\\s*([^;]+);`).exec(block)?.[1]?.trim().toLowerCase()

  it('--fg-on-active：vscode 與 --fg-statusbar 同白（外觀不變）、ppt 為 §13.1 的 --fg 深色字', () => {
    expect(value(root, '--fg-on-active')).toBe('#ffffff')
    expect(value(root, '--fg-on-active')).toBe(value(root, '--fg-statusbar'))
    expect(value(ppt, '--fg-on-active')).toBe('#252525')
    expect(value(ppt, '--fg-on-active')).toBe(value(ppt, '--fg'))
    expect(themeCss).toContain('--color-fg-on-active: var(--fg-on-active);')
  })

  it('--bg-card：vscode 給側欄底色（不使用）、ppt 白', () => {
    expect(value(root, '--bg-card')).toBe('#252526')
    expect(value(ppt, '--bg-card')).toBe('#ffffff')
    expect(themeCss).toContain('--color-card: var(--bg-card);')
  })

  it('頭像 6 色＋白字：跨主題共用（ppt 不覆寫），皆映射 Tailwind', () => {
    expect(value(root, '--fg-on-avatar')).toBe('#ffffff')
    for (let i = 1; i <= 6; i++) {
      expect(value(root, `--avatar-${i}`)).toMatch(/^#[0-9a-f]{6}$/)
      expect(value(ppt, `--avatar-${i}`)).toBeUndefined()
      expect(themeCss).toContain(`--color-avatar-${i}: var(--avatar-${i});`)
    }
    expect(themeCss).toContain('--color-fg-on-avatar: var(--fg-on-avatar);')
  })

  it('頭像底色與白字對比皆 ≥ 4.5:1（DESIGN §9）', () => {
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    }
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
      return (x + 0.05) / (y + 0.05)
    }
    const fg = value(root, '--fg-on-avatar') ?? ''
    for (let i = 1; i <= 6; i++) expect(ratio(value(root, `--avatar-${i}`) ?? '', fg)).toBeGreaterThanOrEqual(4.5)
  })

  it('畫師工具列的按下狀態與選中色塊外框用 --fg-on-active（不再借用狀態列的 --fg-statusbar）', () => {
    const toolbar = read('../src/features/canvas/ToolBar.tsx')
    expect(toolbar).toContain("'bg-active text-fg-on-active'")
    expect(toolbar).toContain('outline-fg-on-active hover:outline-fg-on-active')
    expect(toolbar).not.toMatch(/(text|outline|border|bg)-fg-statusbar/)
  })

  it('PptShell 不再就地改寫 CSS 變數（--fg-statusbar、--bg-editor、--focus-on-color），也不讀 store', () => {
    const shell = read('../src/shells/ppt/PptShell.tsx')
    expect(shell).not.toMatch(/\[--fg-statusbar:|\[--bg-editor:|\[--focus-on-color:|ON_LIGHT_VARS/)
    expect(shell).not.toContain('useGameStore')
    expect(shell).toContain('counts.online')
  })
})
