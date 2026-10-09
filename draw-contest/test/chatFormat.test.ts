// 聊天室純邏輯（features/chat/chatFormat；繪圖比賽為純文字聊天，spec/draw-contest/architecture.md §5.3）
import { describe, expect, it } from 'vitest'
import { CHAT_HISTORY, CHAT_MAX, type ChatMessage } from '@fishing-work/shared/draw-contest'
import {
  CHAT_HINT,
  CHAT_INPUT_MAX_UNITS,
  CHAT_LOCAL_LIMIT,
  appendChatMessage,
  chatErrorText,
  chatLineData,
  formatTime,
  isNearBottom,
  shouldSend,
  trimChat,
} from '../src/features/chat/chatFormat'

const msg = (id: string, patch: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  kind: 'chat',
  fromId: 'p1',
  nickname: 'amy',
  text: '是狗嗎',
  at: 0,
  ...patch,
})

describe('chatLineData：不含偽裝的訊息顯示資料（外觀由殼層 ChatView.Line 決定）', () => {
  it('chat：原文、暱稱、發話者、時間原樣帶出，time 為本機 HH:mm', () => {
    const at = new Date(2026, 8, 24, 14, 32).getTime()
    expect(chatLineData(msg('1', { at }))).toEqual({
      id: '1',
      kind: 'chat',
      fromId: 'p1',
      nickname: 'amy',
      text: '是狗嗎',
      at,
      time: '14:32',
      isMine: false,
    })
  })

  it('isMine：fromId 等於自己的 id；system（fromId null）一律 false', () => {
    expect(chatLineData(msg('1'), 'p1').isMine).toBe(true)
    expect(chatLineData(msg('1'), 'p2').isMine).toBe(false)
    expect(chatLineData(msg('1')).isMine).toBe(false)
    expect(chatLineData(msg('1', { kind: 'system', fromId: null, nickname: null }), null).isMine).toBe(false)
  })

  it('system：原文照帶（系統訊息由 server 決定）', () => {
    const line = chatLineData(msg('1', { kind: 'system', fromId: null, nickname: null, text: '回合開始：蘋果' }))
    expect([line.kind, line.text, line.nickname]).toEqual(['system', '回合開始：蘋果', null])
  })
})

describe('chatErrorText：ack 錯誤提示', () => {
  it('優先使用 server 的 message', () => {
    expect(chatErrorText('RATE_LIMITED', '訊息太頻繁')).toBe('訊息太頻繁')
    expect(chatErrorText('MESSAGE_INVALID', '訊息格式不正確')).toBe('訊息格式不正確')
  })

  it('message 空白時退回備用文字', () => {
    expect(chatErrorText('RATE_LIMITED', ' ')).toBe('訊息送太快了，請稍候再送')
    expect(chatErrorText('MESSAGE_INVALID', '')).toBe(`訊息需為 1–${CHAT_MAX} 字的單行文字`)
    expect(chatErrorText('NOT_IN_ROOM', '')).toBe('尚未加入房間')
    expect(chatErrorText('TIMEOUT', '')).toBe('伺服器沒有回應，請再試一次')
    expect(chatErrorText('DISCONNECTED', '')).toBe('尚未連線到伺服器，請稍候再試')
    expect(chatErrorText('ROUND_BUSY', '')).toBe('訊息未送出')
  })
})

describe('shouldSend：空白不送', () => {
  it.each([
    ['', false],
    ['   ', false],
    ['　', false],
    ['a', true],
    [' 狗 ', true],
  ])('%j → %s', (text, expected) => {
    expect(shouldSend(text)).toBe(expected)
  })
})

describe('CHAT_HINT：輸入列上方的功能提示', () => {
  it('固定「聊天」（沒有猜題提示；design §2）', () => {
    expect(CHAT_HINT).toBe('聊天')
  })
})

describe('appendChatMessage / trimChat：去重與截斷', () => {
  it('本地上限為 CHAT_HISTORY 的兩倍；輸入框長度放寬為 CHAT_MAX 兩倍（emoji 佔 2 個 UTF-16 單位）', () => {
    expect(CHAT_LOCAL_LIMIT).toBe(CHAT_HISTORY * 2)
    expect(CHAT_INPUT_MAX_UNITS).toBe(CHAT_MAX * 2)
  })

  it('相同 id 不重複追加，回傳原陣列', () => {
    const chat = [msg('a')]
    expect(appendChatMessage(chat, msg('a', { text: '別的' }))).toBe(chat)
  })

  it('追加新訊息不改動原陣列', () => {
    const chat = [msg('a')]
    const next = appendChatMessage(chat, msg('b'))
    expect(next.map((m) => m.id)).toEqual(['a', 'b'])
    expect(chat).toHaveLength(1)
  })

  it('超過上限時捨棄最舊的', () => {
    let chat: ChatMessage[] = []
    for (let i = 0; i < 5; i++) chat = appendChatMessage(chat, msg(String(i)), 3)
    expect(chat.map((m) => m.id)).toEqual(['2', '3', '4'])
  })

  it('trimChat 保留最新 limit 則', () => {
    const chat = ['1', '2', '3', '4'].map((id) => msg(id))
    expect(trimChat(chat, 2).map((m) => m.id)).toEqual(['3', '4'])
    expect(trimChat(chat, 10)).toHaveLength(4)
  })
})

describe('formatTime', () => {
  it('HH:mm（本機時區、補零）', () => {
    const at = new Date(2026, 8, 24, 9, 5).getTime()
    expect(formatTime(at)).toBe('09:05')
  })
})

describe('isNearBottom：自動捲動只在底部附近跟隨', () => {
  it('在底部或距底部 24px 內 → true', () => {
    expect(isNearBottom(800, 1000, 200)).toBe(true)
    expect(isNearBottom(776, 1000, 200)).toBe(true)
  })

  it('往上捲超過門檻 → false', () => {
    expect(isNearBottom(700, 1000, 200)).toBe(false)
  })

  it('內容不足一屏 → true', () => {
    expect(isNearBottom(0, 100, 200)).toBe(true)
  })
})
