// vscode 主題的聊天 renderer（shells/vscode/TerminalChat、terminalFormat；DESIGN.md §5「聊天室訊息格式」）
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ChatMessage } from '@fishing-work/shared'
import { chatLineData } from '../src/features/chat/chatFormat'
import type { ImageStatus } from '../src/features/chat/imageUrls'
import type { ChatInputProps } from '../src/shells/views'
import { TerminalChatLine, TerminalComposer } from '../src/shells/vscode/TerminalChat'
import {
  TERMINAL_PROMPT,
  terminalLineParts,
  terminalTimestamp,
  type ChatPart,
} from '../src/shells/vscode/terminalFormat'
import { VSCODE_CHAT_VIEW } from '../src/shells/vscode/viewDefaults'

const msg = (id: string, patch: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  kind: 'chat',
  fromId: 'p1',
  nickname: 'amy',
  text: '是狗嗎',
  at: 0,
  ...patch,
})
const parts = (m: ChatMessage, imageStatus?: ImageStatus) => terminalLineParts(chatLineData(m, { imageStatus }))
const sys = (text: string) => msg('1', { kind: 'system', fromId: null, nickname: null, text })

/** SSR 輸出去掉 React 在相鄰文字節點間插入的 <!-- --> 與所有標籤，只留文字 */
const textOf = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, '')

describe('terminalLineParts：DESIGN §5 聊天室訊息格式', () => {
  it('chat：暱稱 + 內容', () => {
    expect(parts(msg('1'))).toEqual([
      { tone: 'name', text: 'amy' },
      { tone: 'text', text: ': 是狗嗎' },
    ])
  })

  it('chat 沒有暱稱時只顯示內容', () => {
    expect(parts(msg('1', { nickname: null }))).toEqual([{ tone: 'text', text: '是狗嗎' }])
  })

  it('system：// 註解', () => {
    expect(parts(sys('amy 加入了'))).toEqual([{ tone: 'comment', text: '// amy 加入了' }])
  })

  it('system 揭曉：題目以 string 色標出', () => {
    expect(parts(sys('題目是 狗（全員猜對）'))).toEqual([
      { tone: 'comment', text: '// 題目是 ' },
      { tone: 'string', text: '狗' },
      { tone: 'comment', text: '（全員猜對）' },
    ])
  })

  it('system 揭曉：題目本身含全形括號或空白也能拆出', () => {
    expect(parts(sys('題目是 hot dog（大）（時間到）'))[1]).toEqual({ tone: 'string', text: 'hot dog（大）' })
  })

  it('correct：✓ 前綴', () => {
    expect(parts(msg('1', { kind: 'correct', text: 'ben 猜對了' }))).toEqual([{ tone: 'correct', text: '✓ ben 猜對了' }])
  })
})

describe('terminalLineParts：image 訊息', () => {
  const img = (patch: Partial<ChatMessage> = {}) =>
    msg('i1', { kind: 'image', text: '', image: { mime: 'image/jpeg', width: 1280, height: 853, bytes: 100_000 }, ...patch })
  const withName = (label: ChatPart) => [{ tone: 'name', text: 'bob' }, { tone: 'text', text: ': ' }, label]

  it('ready：`bob: [圖片]`（縮圖另畫在下一行）', () => {
    expect(parts(img({ nickname: 'bob' }), 'ready')).toEqual(withName({ tone: 'text', text: '[圖片]' }))
  })

  it.each([
    ['pending', '[圖片]（載入中…）'],
    ['skipped', '[圖片]（連線較慢，已略過）'],
    ['revoked', '[圖片]（已清除）'],
    ['snapshot', '[圖片]（中途加入看不到）'],
  ] as const)('%s：與暱稱同行的灰字佔位 %s', (status, text) => {
    expect(parts(img({ nickname: 'bob' }), status)).toEqual(withName({ tone: 'muted', text }))
  })

  it('沒有暱稱時只顯示標記', () => {
    expect(parts(img({ nickname: null }), 'ready')).toEqual([{ tone: 'text', text: '[圖片]' }])
    expect(parts(img({ nickname: null }), 'pending')).toEqual([{ tone: 'muted', text: '[圖片]（載入中…）' }])
  })
})

describe('時間戳與提示符', () => {
  it('行首時間戳為 `[HH:mm] `', () => {
    expect(terminalTimestamp('09:05')).toBe('[09:05] ')
  })

  it('提示符為 ❯', () => {
    expect(TERMINAL_PROMPT).toBe('❯')
  })
})

describe('TerminalChatLine／TerminalComposer（SSR 輸出）', () => {
  it('一則 system 訊息：<li> 根節點、[HH:mm] 時間戳（--fg-dim）＋ // 前綴（--sem-comment）', () => {
    const at = new Date(2026, 8, 24, 9, 5).getTime()
    const html = renderToStaticMarkup(<TerminalChatLine line={chatLineData({ ...sys('amy 加入了'), at })} />)
    expect(html.startsWith('<li class="break-words whitespace-pre-wrap">')).toBe(true)
    expect(html).toContain('<span class="text-fg-dim">[09:05] </span>')
    expect(html).toContain('<span class="text-sem-comment">// amy 加入了</span>')
    expect(textOf(html)).toBe('[09:05] // amy 加入了')
  })

  it('圖片 ready 時在下一行畫縮圖；沒有圖時只有佔位文字', () => {
    const m = msg('i1', { kind: 'image', text: '', nickname: 'bob', image: { mime: 'image/png', width: 480, height: 320, bytes: 10 } })
    const ready = renderToStaticMarkup(<TerminalChatLine line={chatLineData(m, { imageStatus: 'ready', imageUrl: 'blob:x' })} />)
    expect(ready).toContain('src="blob:x"')
    expect(ready).toContain('width:240px;height:160px')
    const pending = renderToStaticMarkup(<TerminalChatLine line={chatLineData(m, { imageStatus: 'pending' })} />)
    expect(pending).not.toContain('<img')
    expect(pending).toContain('<span class="text-fg-muted">[圖片]（載入中…）</span>')
  })

  const input: ChatInputProps = {
    value: '',
    onChange: () => {},
    onPaste: () => {},
    maxLength: 400,
    placeholder: '輸入訊息後按 Enter',
    'aria-label': '聊天輸入',
    'aria-invalid': false,
    autoComplete: 'off',
    enterKeyHint: 'send',
  }

  it('輸入列：<form> 內含 ❯ 提示符與輸入框；沒有錯誤時不渲染提示', () => {
    const html = renderToStaticMarkup(<TerminalComposer onSubmit={() => {}} input={input} error={null} canSend={false} />)
    expect(html.startsWith('<form class="shrink-0 px-3 pb-1">')).toBe(true)
    expect(html).toContain('<span aria-hidden="true" class="text-sem-type">❯</span>')
    expect(html).toContain('aria-label="聊天輸入"')
    expect(html).toContain('placeholder="輸入訊息後按 Enter"')
    expect(html).not.toContain('role="alert"')
  })

  it('錯誤：✗ 前綴、role="alert"、--sem-error', () => {
    const html = renderToStaticMarkup(<TerminalComposer onSubmit={() => {}} input={input} error="不可洩題" canSend />)
    expect(html).toContain('<p class="truncate text-sem-error" role="alert">✗ 不可洩題</p>')
  })

  it('vscode 的 ChatView 使用這組 renderer，面板為編輯區底色、18px 行高', () => {
    expect(VSCODE_CHAT_VIEW.Line).toBe(TerminalChatLine)
    expect(VSCODE_CHAT_VIEW.Composer).toBe(TerminalComposer)
    expect(VSCODE_CHAT_VIEW.panelClassName).toBe('bg-editor leading-[18px]')
    expect(VSCODE_CHAT_VIEW.listClassName).toBe('px-3 py-1')
  })
})
