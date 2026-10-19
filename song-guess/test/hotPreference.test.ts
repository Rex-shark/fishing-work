// 「只抽熱門歌」的本機偏好（features/round/hotPreference；spec/song-guess/design.md §1「出題（選題庫）」）：
// 預設勾、只認 '1'／'0'、讀寫失敗都不丟例外（讀失敗＝預設勾）
import { describe, expect, it, vi } from 'vitest'
import { HOT_DEFAULT, HOT_STORAGE_KEY, loadHot, saveHot, type HotStorage } from '../src/features/round/hotPreference'

function memory(initial: Record<string, string> = {}): HotStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial))
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
}

const throwing: HotStorage = {
  getItem: () => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
}

describe('hotPreference', () => {
  it('鍵在猜歌的命名空間；預設勾', () => {
    expect(HOT_STORAGE_KEY).toBe('fishing-work:song-guess:hot')
    expect(HOT_DEFAULT).toBe(true)
  })

  it('loadHot：沒有值 → 勾；"0" → 不勾；"1" → 勾；亂值 → 勾', () => {
    expect(loadHot(memory())).toBe(true)
    expect(loadHot(memory({ [HOT_STORAGE_KEY]: '0' }))).toBe(false)
    expect(loadHot(memory({ [HOT_STORAGE_KEY]: '1' }))).toBe(true)
    for (const junk of ['', 'false', 'true', '00', 'null']) expect(loadHot(memory({ [HOT_STORAGE_KEY]: junk })), junk).toBe(true)
  })

  it('loadHot：storage 不可用（null）或讀取丟例外 → 預設勾', () => {
    expect(loadHot(null)).toBe(true)
    expect(loadHot(throwing)).toBe(true)
  })

  it('loadHot 預設參數：沒有 window（非瀏覽器）→ 預設勾；取用 window.localStorage 本身丟例外 → 預設勾', () => {
    expect(loadHot()).toBe(true)
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new Error('SecurityError')
      },
    })
    try {
      expect(loadHot()).toBe(true)
      expect(() => saveHot(false)).not.toThrow()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('saveHot：寫 "1"／"0"；寫入丟例外或 storage 為 null 時忽略', () => {
    const m = memory()
    saveHot(false, m)
    expect(m.data.get(HOT_STORAGE_KEY)).toBe('0')
    expect(loadHot(m)).toBe(false)
    saveHot(true, m)
    expect(m.data.get(HOT_STORAGE_KEY)).toBe('1')
    expect(() => saveHot(true, throwing)).not.toThrow()
    expect(() => saveHot(true, null)).not.toThrow()
  })
})
