import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import type { ChatMessage } from '@fishing-work/shared'
import {
  IMAGE_PLACEHOLDER,
  IMAGE_URL_LIMIT,
  addImageUrl,
  displayStatus,
  statusFromSnapshot,
  statusOnImageSkipped,
  statusOnImageUrl,
  statusOnLiveMessage,
  type ImageStatus,
} from '../src/features/chat/imageUrls'
import { initialGameState, useGameStore } from '../src/store/game'

const get = () => useGameStore.getState()

describe('addImageUrl：最多保留 20 張（決策 7）', () => {
  it('上限為 20', () => {
    expect(IMAGE_URL_LIMIT).toBe(20)
  })

  it('未滿時只追加，不回收；回傳新 Map（不改原本的）', () => {
    const before = new Map([['a', 'blob:a']])
    const { urls, evicted } = addImageUrl(before, 'b', 'blob:b')
    expect([...urls]).toEqual([
      ['a', 'blob:a'],
      ['b', 'blob:b'],
    ])
    expect(evicted).toEqual([])
    expect(urls).not.toBe(before)
    expect(before.size).toBe(1)
  })

  it('超過上限時移除最舊的並回傳其 URL', () => {
    let urls = new Map<string, string>()
    const all: string[] = []
    for (let i = 0; i < IMAGE_URL_LIMIT; i++) {
      const r = addImageUrl(urls, `m${i}`, `blob:${i}`)
      urls = r.urls
      all.push(...r.evicted)
    }
    expect(all).toEqual([])
    const r = addImageUrl(urls, 'm20', 'blob:20')
    expect(r.evicted).toEqual(['blob:0'])
    expect(r.evictedIds).toEqual(['m0'])
    expect(r.urls.size).toBe(IMAGE_URL_LIMIT)
    expect(r.urls.has('m0')).toBe(false)
    expect([...r.urls.keys()].at(-1)).toBe('m20')
  })

  it('同 id 重複：以新的取代、舊 URL 要回收，並移到最新', () => {
    const start = new Map([
      ['a', 'blob:a1'],
      ['b', 'blob:b'],
    ])
    const { urls, evicted } = addImageUrl(start, 'a', 'blob:a2')
    expect(evicted).toEqual(['blob:a1'])
    expect(addImageUrl(start, 'a', 'blob:a2').evictedIds).toEqual([]) // 同 id 取代不算被擠掉
    expect([...urls]).toEqual([
      ['b', 'blob:b'],
      ['a', 'blob:a2'],
    ])
  })

  it('自訂上限 1：每次只留最新一張', () => {
    const r1 = addImageUrl(new Map(), 'a', 'blob:a', 1)
    const r2 = addImageUrl(r1.urls, 'b', 'blob:b', 1)
    expect(r2.evicted).toEqual(['blob:a'])
    expect([...r2.urls.keys()]).toEqual(['b'])
  })
})

describe('store.imageUrls：revokeObjectURL', () => {
  let revoke: MockInstance<(url: string) => void>

  beforeEach(() => {
    useGameStore.setState(initialGameState)
    revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  afterEach(() => {
    revoke.mockRestore()
  })

  it('第 21 張進來時 revoke 最舊的一張', () => {
    for (let i = 0; i < IMAGE_URL_LIMIT; i++) get().addImageUrl(`m${i}`, `blob:${i}`)
    expect(revoke).not.toHaveBeenCalled()
    get().addImageUrl('m20', 'blob:20')
    expect(revoke).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledWith('blob:0')
    expect(get().imageUrls.size).toBe(IMAGE_URL_LIMIT)
    expect(get().imageUrls.get('m20')).toBe('blob:20')
  })

  it('每次變動都換新的 Map（selector 以參照判斷重繪）', () => {
    const before = get().imageUrls
    get().addImageUrl('a', 'blob:a')
    expect(get().imageUrls).not.toBe(before)
  })

  it('reset（離開遊戲）時全部 revoke 並清空', () => {
    get().addImageUrl('a', 'blob:a')
    get().addImageUrl('b', 'blob:b')
    get().reset()
    expect(revoke.mock.calls.map(([url]) => url)).toEqual(['blob:a', 'blob:b'])
    expect(get().imageUrls.size).toBe(0)
  })

  it('快照（重連接管）不清圖片：同 id 的訊息仍在歷史裡', () => {
    get().addImageUrl('a', 'blob:a')
    get().applySnapshot({ you: 'me', players: [], round: get().round, ops: [], chat: [] })
    expect(get().imageUrls.get('a')).toBe('blob:a')
    expect(revoke).not.toHaveBeenCalled()
  })
})

// ─── 顯示狀態（DESIGN §5：載入中…／已清除／中途加入看不到） ─────────────

const image = (id: string): ChatMessage => ({
  id,
  kind: 'image',
  fromId: 'p2',
  nickname: 'bob',
  text: '',
  at: 0,
  image: { mime: 'image/png', width: 10, height: 10, bytes: 100 },
})
const text = (id: string): ChatMessage => ({ id, kind: 'chat', fromId: 'p2', nickname: 'bob', text: 'hi', at: 0 })

describe('IMAGE_PLACEHOLDER：四種佔位文字', () => {
  it('與 DESIGN §5 一致', () => {
    expect(IMAGE_PLACEHOLDER).toEqual({
      pending: '[圖片]（載入中…）',
      skipped: '[圖片]（連線較慢，已略過）',
      revoked: '[圖片]（已清除）',
      snapshot: '[圖片]（中途加入看不到）',
    })
  })
})

describe('狀態轉移（純函式）', () => {
  it('即時收到 image 訊息、bytes 未到 → pending；chat:image 到 → ready', () => {
    const s1 = statusOnLiveMessage(new Map(), new Map(), 'a', [image('a')])
    expect(s1.get('a')).toBe('pending')
    const s2 = statusOnImageUrl(s1, 'a', [])
    expect(s2.get('a')).toBe('ready')
    expect(s1.get('a')).toBe('pending') // 不改原 Map
  })

  it('順序顛倒：chat:image 先到（已有 URL）再收到訊息 → 直接 ready', () => {
    const s = statusOnLiveMessage(new Map(), new Map([['a', 'blob:a']]), 'a', [image('a')])
    expect(s.get('a')).toBe('ready')
  })

  it('被擠掉的 id → revoked（只標記仍在狀態表裡的）', () => {
    const start = new Map<string, ImageStatus>([
      ['old', 'ready'],
      ['b', 'ready'],
    ])
    const s = statusOnImageUrl(start, 'new', ['old', 'gone'])
    expect(s.get('old')).toBe('revoked')
    expect(s.get('new')).toBe('ready')
    expect(s.has('gone')).toBe(false)
  })

  it('即時訊息進來時清掉已被截出聊天列表的狀態', () => {
    const start = new Map<string, ImageStatus>([['trimmed', 'ready']])
    const s = statusOnLiveMessage(start, new Map(), 'a', [text('x'), image('a')])
    expect([...s.keys()]).toEqual(['a'])
  })

  it('快照：有 URL → ready、先前已釋放 → revoked、斷線前 pending → snapshot、全新 → snapshot；非 image 不記', () => {
    const prev = new Map<string, ImageStatus>([
      ['kept', 'ready'],
      ['cleared', 'revoked'],
      ['loading', 'pending'],
    ])
    const urls = new Map([['kept', 'blob:kept']])
    const s = statusFromSnapshot(prev, urls, [image('kept'), image('cleared'), image('loading'), image('fresh'), text('t')])
    expect([...s]).toEqual([
      ['kept', 'ready'],
      ['cleared', 'revoked'],
      ['loading', 'snapshot'],
      ['fresh', 'snapshot'],
    ])
  })

  it('略過（data: null）：pending → skipped，不需要 URL；不改原 Map', () => {
    const s1 = statusOnLiveMessage(new Map(), new Map(), 'a', [image('a')])
    const s2 = statusOnImageSkipped(s1, new Map(), 'a')
    expect(s2.get('a')).toBe('skipped')
    expect(s1.get('a')).toBe('pending')
  })

  it('略過通知先到（順序顛倒）再收到訊息 → 維持 skipped，不回到 pending', () => {
    const s1 = statusOnImageSkipped(new Map(), new Map(), 'a')
    const s2 = statusOnLiveMessage(s1, new Map(), 'a', [image('a')])
    expect(s2.get('a')).toBe('skipped')
  })

  it('本機已有 URL 的 id 收到略過通知不動（ready 優先）', () => {
    const start = new Map<string, ImageStatus>([['a', 'ready']])
    expect(statusOnImageSkipped(start, new Map([['a', 'blob:a']]), 'a').get('a')).toBe('ready')
  })

  it('快照：先前被略過的維持 skipped（本機在線、只是連線慢），與 revoked 同理', () => {
    const prev = new Map<string, ImageStatus>([
      ['slow', 'skipped'],
      ['cleared', 'revoked'],
    ])
    const s = statusFromSnapshot(prev, new Map(), [image('slow'), image('cleared'), image('fresh')])
    expect([...s]).toEqual([
      ['slow', 'skipped'],
      ['cleared', 'revoked'],
      ['fresh', 'snapshot'],
    ])
  })

  it('快照只保留快照裡的 image 訊息', () => {
    const prev = new Map<string, ImageStatus>([['old', 'pending']])
    expect(statusFromSnapshot(prev, new Map(), []).size).toBe(0)
  })
})

describe('displayStatus：有 URL 一律 ready，否則依狀態', () => {
  it.each([
    [undefined, true, 'ready'],
    ['pending', true, 'ready'],
    ['pending', false, 'pending'],
    ['skipped', false, 'skipped'],
    ['skipped', true, 'ready'],
    ['revoked', false, 'revoked'],
    ['snapshot', false, 'snapshot'],
    ['ready', false, 'revoked'],
    [undefined, false, 'snapshot'],
  ] as const)('%s／有 URL=%s → %s', (status, hasUrl, expected) => {
    expect(displayStatus(status, hasUrl)).toBe(expected)
  })
})

describe('store.imageStatus：與聊天、chat:image、快照整合', () => {
  let revoke: MockInstance<(url: string) => void>

  beforeEach(() => {
    useGameStore.setState(initialGameState)
    revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  afterEach(() => {
    revoke.mockRestore()
  })

  it('即時 image 訊息 → pending → chat:image 後 ready；文字訊息不記狀態', () => {
    get().appendChat(text('t'))
    get().appendChat(image('a'))
    expect(get().imageStatus.get('a')).toBe('pending')
    expect(get().imageStatus.has('t')).toBe(false)
    get().addImageUrl('a', 'blob:a')
    expect(get().imageStatus.get('a')).toBe('ready')
  })

  it('第 21 張圖把最舊的一張擠掉 → 該則 revoked（已清除）', () => {
    for (let i = 0; i <= IMAGE_URL_LIMIT; i++) {
      get().appendChat(image(`m${i}`))
      get().addImageUrl(`m${i}`, `blob:${i}`)
    }
    expect(get().imageStatus.get('m0')).toBe('revoked')
    expect(get().imageStatus.get(`m${IMAGE_URL_LIMIT}`)).toBe('ready')
    expect(displayStatus(get().imageStatus.get('m0'), get().imageUrls.has('m0'))).toBe('revoked')
  })

  it('重連接管的快照：仍有 URL 的維持 ready、pending 轉 snapshot、新的 snapshot', () => {
    get().appendChat(image('a'))
    get().addImageUrl('a', 'blob:a')
    get().appendChat(image('b')) // bytes 還沒到就斷線
    get().applySnapshot({ you: 'me', players: [], round: get().round, ops: [], chat: [image('a'), image('b'), image('c')] })
    expect([...get().imageStatus]).toEqual([
      ['a', 'ready'],
      ['b', 'snapshot'],
      ['c', 'snapshot'],
    ])
    expect(get().imageUrls.get('a')).toBe('blob:a')
  })

  it('每次變動都換新的 Map；重複的訊息不改狀態表', () => {
    get().appendChat(image('a'))
    const before = get().imageStatus
    get().appendChat(image('a'))
    expect(get().imageStatus).toBe(before)
    get().addImageUrl('a', 'blob:a')
    expect(get().imageStatus).not.toBe(before)
  })

  it('chat:image 的 data 為 null → skipped（顯示「連線較慢，已略過」），不建立任何 URL', () => {
    get().appendChat(image('a'))
    get().appendChat(image('b'))
    get().markImageSkipped('a')
    get().addImageUrl('b', 'blob:b')
    expect(get().imageStatus.get('a')).toBe('skipped')
    expect(get().imageUrls.has('a')).toBe(false)
    expect(displayStatus(get().imageStatus.get('a'), get().imageUrls.has('a'))).toBe('skipped')
    expect(IMAGE_PLACEHOLDER.skipped).toBe('[圖片]（連線較慢，已略過）')
    expect(get().imageStatus.get('b')).toBe('ready')
  })

  it('重連接管的快照：被略過的維持 skipped', () => {
    get().appendChat(image('a'))
    get().markImageSkipped('a')
    get().applySnapshot({ you: 'me', players: [], round: get().round, ops: [], chat: [image('a'), image('c')] })
    expect([...get().imageStatus]).toEqual([
      ['a', 'skipped'],
      ['c', 'snapshot'],
    ])
  })

  it('略過標記換新的 Map（selector 以參照判斷重繪）', () => {
    get().appendChat(image('a'))
    const before = get().imageStatus
    get().markImageSkipped('a')
    expect(get().imageStatus).not.toBe(before)
  })

  it('reset 清空狀態表', () => {
    get().appendChat(image('a'))
    get().reset()
    expect(get().imageStatus.size).toBe(0)
  })
})
