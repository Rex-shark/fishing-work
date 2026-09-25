import { describe, expect, it } from 'vitest'
import { CHAT_HISTORY, CHAT_MAX, type ChatMessage } from '@fishing-work/shared'
import {
  CHAT_INPUT_MAX_UNITS,
  CHAT_LOCAL_LIMIT,
  appendChatMessage,
  chatErrorText,
  chatLineData,
  chatPlaceholder,
  formatTime,
  isNearBottom,
  parseReveal,
  shouldSend,
  thumbSize,
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
      reveal: null,
      image: null,
    })
  })

  it('isMine：fromId 等於自己的 id；system（fromId null）一律 false', () => {
    expect(chatLineData(msg('1'), { meId: 'p1' }).isMine).toBe(true)
    expect(chatLineData(msg('1'), { meId: 'p2' }).isMine).toBe(false)
    expect(chatLineData(msg('1'), {}).isMine).toBe(false)
    expect(chatLineData(msg('1', { kind: 'system', fromId: null, nickname: null }), { meId: null }).isMine).toBe(false)
  })

  it('system 揭曉：拆出題目與原因；一般 system 與其他 kind 為 null', () => {
    const m = msg('1', { kind: 'system', fromId: null, nickname: null, text: '題目是 狗（全員猜對）' })
    expect(chatLineData(m).reveal).toEqual({ topic: '狗', reason: '全員猜對' })
    expect(chatLineData(msg('1', { kind: 'system', fromId: null, nickname: null, text: 'amy 加入了' })).reveal).toBeNull()
    // chat 的原文剛好長得像揭曉也不拆（只有 server 的 system 訊息才是揭曉）
    expect(chatLineData(msg('1', { text: '題目是 狗（全員猜對）' })).reveal).toBeNull()
  })

  it('correct：原文由 server 決定（只會是「X 猜對了」），不加任何前綴', () => {
    const line = chatLineData(msg('1', { kind: 'correct', text: 'ben 猜對了' }))
    expect([line.kind, line.text]).toEqual(['correct', 'ben 猜對了'])
  })
})

describe('parseReveal', () => {
  it('題目本身含全形括號或空白也能拆出', () => {
    expect(parseReveal('題目是 hot dog（大）（時間到）')).toEqual({ topic: 'hot dog（大）', reason: '時間到' })
  })

  it('不是揭曉格式 → null', () => {
    expect(parseReveal('amy 加入了')).toBeNull()
    expect(parseReveal('題目是 狗')).toBeNull()
  })
})

describe('chatErrorText：ack 錯誤提示', () => {
  it('優先使用 server 的 message（SPOILER_BLOCKED 不寫死，畫師與猜題者的擋下原因不同）', () => {
    expect(chatErrorText('SPOILER_BLOCKED', '猜答案請只輸入答案本身')).toBe('猜答案請只輸入答案本身')
    expect(chatErrorText('SPOILER_BLOCKED', '不可洩題')).toBe('不可洩題')
    expect(chatErrorText('RATE_LIMITED', '訊息太頻繁')).toBe('訊息太頻繁')
  })

  it('message 空白時退回備用文字', () => {
    expect(chatErrorText('SPOILER_BLOCKED', '')).toBe('訊息已被擋下，未送出')
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

describe('chatPlaceholder', () => {
  it('drawing 的猜題者（未猜對）：輸入答案或聊天', () => {
    expect(chatPlaceholder('drawing', false, false)).toBe('輸入答案或聊天')
  })

  it('drawing 的畫師或已猜對者：聊天（不可說出答案）', () => {
    expect(chatPlaceholder('drawing', true, false)).toBe('聊天（不可說出答案）')
    expect(chatPlaceholder('drawing', false, true)).toBe('聊天（不可說出答案）')
  })

  it('其他階段：一般聊天', () => {
    for (const phase of ['idle', 'choosing', 'ended'] as const) {
      expect(chatPlaceholder(phase, false, false)).toBe('輸入訊息後按 Enter')
    }
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

describe('chatLineData：image 訊息（DESIGN §5；決策 2、8）', () => {
  const meta = { mime: 'image/jpeg', width: 1280, height: 853, bytes: 100_000 } as const
  const img = (patch: Partial<ChatMessage> = {}) => msg('i1', { kind: 'image', text: '', nickname: 'bob', image: meta, ...patch })

  it('ready：帶 Blob URL，沒有佔位', () => {
    expect(chatLineData(img(), { imageStatus: 'ready', imageUrl: 'blob:1' }).image).toEqual({
      meta,
      status: 'ready',
      url: 'blob:1',
      placeholder: null,
    })
  })

  it.each([
    ['pending', '[圖片]（載入中…）'],
    ['skipped', '[圖片]（連線較慢，已略過）'],
    ['revoked', '[圖片]（已清除）'],
    ['snapshot', '[圖片]（中途加入看不到）'],
  ] as const)('%s：佔位 %s、沒有 URL', (status, placeholder) => {
    expect(chatLineData(img(), { imageStatus: status }).image).toEqual({ meta, status, url: null, placeholder })
  })

  it('未指定狀態時視為快照帶來', () => {
    expect(chatLineData(img()).image?.placeholder).toBe('[圖片]（中途加入看不到）')
  })

  it('其他 kind 沒有 image（即使傳入圖片狀態）', () => {
    expect(chatLineData(msg('1'), { imageStatus: 'ready', imageUrl: 'blob:1' }).image).toBeNull()
  })
})

describe('thumbSize：縮圖最大 240×160、等比、不放大', () => {
  it.each([
    [1280, 853, { width: 240, height: 160 }],
    [3000, 1000, { width: 240, height: 80 }],
    [400, 1600, { width: 40, height: 160 }],
    [100, 50, { width: 100, height: 50 }],
    [240, 160, { width: 240, height: 160 }],
    [5000, 1, { width: 240, height: 1 }],
  ])('%s×%s', (w, h, expected) => {
    expect(thumbSize(w, h)).toEqual(expected)
  })

  it('寬高不合理時退回最大框', () => {
    expect(thumbSize(0, 100)).toEqual({ width: 240, height: 160 })
    expect(thumbSize(Number.NaN, 100)).toEqual({ width: 240, height: 160 })
  })
})

describe('chatErrorText：圖片錯誤', () => {
  it('server message 優先（RATE_LIMITED、SPOILER_BLOCKED、IMAGE_INVALID）', () => {
    expect(chatErrorText('SPOILER_BLOCKED', '作畫中畫師不能傳圖片')).toBe('作畫中畫師不能傳圖片')
    expect(chatErrorText('IMAGE_INVALID', '圖片格式不符')).toBe('圖片格式不符')
  })

  it('IMAGE_INVALID 沒有 message 時的備用文字', () => {
    expect(chatErrorText('IMAGE_INVALID', '')).toBe('圖片格式或大小不符，未送出')
  })
})
