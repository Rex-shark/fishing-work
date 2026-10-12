// 聊天室純邏輯（features/chat/chatFormat）：去重與截斷、顯示資料、錯誤文字、功能提示、連續訊息分組、捲動判斷
import { describe, expect, it } from 'vitest'
import { CHAT_HISTORY, CHAT_MAX, type ChatMessage } from '@fishing-work/shared/song-guess'
import {
  CHAT_HINT,
  CHAT_HINT_GUESSED,
  CHAT_INPUT_MAX_UNITS,
  CHAT_LOCAL_LIMIT,
  appendChatMessage,
  chatErrorText,
  chatHint,
  chatLineData,
  formatTime,
  groupsWithPrevious,
  isNearBottom,
  shouldSend,
  trimChat,
} from '../src/features/chat/chatFormat'

const msg = (id: string, over: Partial<ChatMessage> = {}): ChatMessage => ({ id, kind: 'chat', fromId: 'p2', nickname: 'amy', text: id, at: 0, ...over })

describe('列表', () => {
  it('上限＝快照則數的兩倍；輸入框 maxLength 放寬一倍（emoji 佔 2 單位）', () => {
    expect(CHAT_LOCAL_LIMIT).toBe(CHAT_HISTORY * 2)
    expect(CHAT_INPUT_MAX_UNITS).toBe(CHAT_MAX * 2)
  })

  it('appendChatMessage：以 id 去重（回原陣列）、超過上限丟最舊的', () => {
    const chat = [msg('a'), msg('b')]
    expect(appendChatMessage(chat, msg('a'))).toBe(chat)
    expect(appendChatMessage(chat, msg('c')).map((m) => m.id)).toEqual(['a', 'b', 'c'])
    expect(appendChatMessage(chat, msg('c'), 2).map((m) => m.id)).toEqual(['b', 'c'])
  })

  it('trimChat：保留最新的 limit 則，回新陣列', () => {
    const chat = [msg('a'), msg('b'), msg('c')]
    expect(trimChat(chat, 2).map((m) => m.id)).toEqual(['b', 'c'])
    expect(trimChat(chat, 5)).toEqual(chat)
    expect(trimChat(chat, 5)).not.toBe(chat)
  })
})

describe('chatLineData', () => {
  it('帶出原欄位與 HH:mm；isMine＝fromId 是自己', () => {
    const at = new Date(2026, 9, 12, 9, 5).getTime()
    const line = chatLineData(msg('m1', { at, text: '這首我聽過' }), 'p2')
    expect(line).toEqual({ id: 'm1', kind: 'chat', fromId: 'p2', nickname: 'amy', text: '這首我聽過', at, time: '09:05', isMine: true })
    expect(chatLineData(msg('m1'), 'p1').isMine).toBe(false)
    expect(formatTime(at)).toBe('09:05')
  })

  it('system（fromId null）不是自己的；correct 的 fromId 是猜對者', () => {
    expect(chatLineData(msg('s', { kind: 'system', fromId: null, nickname: null, text: '第 2 首：《遇見》' }), null).isMine).toBe(false)
    const correct = chatLineData(msg('c', { kind: 'correct', fromId: 'p1', nickname: 'rex', text: 'rex 猜對了' }), 'p1')
    expect(correct).toMatchObject({ kind: 'correct', text: 'rex 猜對了', isMine: true })
  })
})

describe('錯誤文字', () => {
  it('server 有給 message 一律用它（SPOILER_BLOCKED 的兩種文案由 server 決定）', () => {
    expect(chatErrorText('SPOILER_BLOCKED', '你已經猜對了，不要說出歌名')).toBe('你已經猜對了，不要說出歌名')
    expect(chatErrorText('SPOILER_BLOCKED', '猜歌名請只輸入歌名本身')).toBe('猜歌名請只輸入歌名本身')
    expect(chatErrorText('RATE_LIMITED', ' 太快了 ')).toBe('太快了')
  })

  it('沒有 message 時的備用文字', () => {
    expect(chatErrorText('SPOILER_BLOCKED', '')).toBe('訊息含有歌名，沒有送出')
    expect(chatErrorText('RATE_LIMITED', '')).toBe('訊息送太快了，請稍候再送')
    expect(chatErrorText('MESSAGE_INVALID', '')).toBe(`訊息需為 1–${CHAT_MAX} 字的單行文字`)
    expect(chatErrorText('TIMEOUT', '')).toBe('伺服器沒有回應，請再試一次')
    expect(chatErrorText('DISCONNECTED', '')).toBe('尚未連線到伺服器，請稍候再試')
    expect(chatErrorText('ROUND_BUSY', '')).toBe('訊息未送出')
  })
})

describe('功能提示（design §1「猜題」：輸入歌名或聊天）', () => {
  it('一般為「輸入歌名或聊天」；播放中自己已猜對改提醒不可說出歌名', () => {
    expect(CHAT_HINT).toBe('輸入歌名或聊天')
    expect(chatHint('playing', false)).toBe(CHAT_HINT)
    expect(chatHint('playing', true)).toBe(CHAT_HINT_GUESSED)
    expect(CHAT_HINT_GUESSED).toContain('不可說出歌名')
    for (const phase of ['idle', 'choosing', 'reveal', 'ended'] as const) {
      expect(chatHint(phase, false)).toBe(CHAT_HINT)
      expect(chatHint(phase, true)).toBe(CHAT_HINT)
    }
  })

  it('shouldSend：空白不送', () => {
    expect(shouldSend('  ')).toBe(false)
    expect(shouldSend(' 遇見 ')).toBe(true)
  })
})

describe('groupsWithPrevious：同一人連續的一般訊息才合併', () => {
  it('同 fromId 且兩則都是 chat → true', () => {
    expect(groupsWithPrevious(msg('a'), msg('b'))).toBe(true)
  })

  it('不同人、第一則、system、correct 都不合併', () => {
    expect(groupsWithPrevious(msg('a'), msg('b', { fromId: 'p3' }))).toBe(false)
    expect(groupsWithPrevious(undefined, msg('b'))).toBe(false)
    expect(groupsWithPrevious(msg('a', { kind: 'correct' }), msg('b'))).toBe(false)
    expect(groupsWithPrevious(msg('a'), msg('b', { kind: 'correct' }))).toBe(false)
    expect(groupsWithPrevious(msg('a', { kind: 'system', fromId: null }), msg('b', { kind: 'system', fromId: null }))).toBe(false)
  })
})

describe('isNearBottom', () => {
  it('距底部 24px 內才跟隨新訊息', () => {
    expect(isNearBottom(476, 1000, 500)).toBe(true)
    expect(isNearBottom(475, 1000, 500)).toBe(false)
    expect(isNearBottom(0, 300, 500)).toBe(true)
  })
})
