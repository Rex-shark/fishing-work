// uiStore.shellId：本機偏好存 localStorage（鍵與我畫你猜分開），讀寫失敗與未知值一律回退預設 ppt
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SHELL_STORAGE_KEY, loadShellId, saveShellId, useUiStore, type ShellStorage } from '../src/layout/uiStore'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  const storage: ShellStorage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  }
  return { storage, data }
}

const throwing: ShellStorage = {
  getItem: () => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
}

afterEach(() => {
  vi.unstubAllGlobals()
  useUiStore.setState({ shellId: 'ppt', nicknameDraft: null })
})

describe('鍵名', () => {
  it('fishing-work:draw-contest:shell（不與我畫你猜撞鍵）', () => {
    expect(SHELL_STORAGE_KEY).toBe('fishing-work:draw-contest:shell')
  })
})

describe('loadShellId', () => {
  it('沒有存過 → ppt', () => {
    expect(loadShellId(memoryStorage().storage)).toBe('ppt')
  })

  it('存的是已註冊主題 → 原樣', () => {
    expect(loadShellId(memoryStorage({ [SHELL_STORAGE_KEY]: 'ppt' }).storage)).toBe('ppt')
  })

  it.each(['vscode', 'meet', 'excel', 'keynote', '', 'PPT'])('未知或未註冊的值 %j → ppt', (v) => {
    expect(loadShellId(memoryStorage({ [SHELL_STORAGE_KEY]: v }).storage)).toBe('ppt')
  })

  it('getItem 丟例外 → ppt', () => {
    expect(loadShellId(throwing)).toBe('ppt')
  })

  it('沒有 storage（非瀏覽器、取用失敗）→ ppt', () => {
    expect(loadShellId(null)).toBe('ppt')
  })
})

describe('saveShellId', () => {
  it('寫入鍵值', () => {
    const { storage, data } = memoryStorage()
    saveShellId('ppt', storage)
    expect(data.get(SHELL_STORAGE_KEY)).toBe('ppt')
  })

  it('setItem 丟例外時不影響呼叫端', () => {
    expect(() => saveShellId('ppt', throwing)).not.toThrow()
    expect(() => saveShellId('ppt', null)).not.toThrow()
  })
})

describe('useUiStore.shellId', () => {
  it('非瀏覽器環境初始為 ppt', () => {
    expect(useUiStore.getState().shellId).toBe('ppt')
  })

  it.each(['vscode', 'keynote', '', 'PPT'])('setShellId(%j)：未註冊值不改狀態、不寫入（不覆寫存檔）', (v) => {
    const { storage, data } = memoryStorage({ [SHELL_STORAGE_KEY]: 'keynote' })
    vi.stubGlobal('window', { localStorage: storage })
    useUiStore.getState().setShellId(v)
    expect(useUiStore.getState().shellId).toBe('ppt')
    expect(data.get(SHELL_STORAGE_KEY)).toBe('keynote')
  })

  it('setShellId 與目前相同時不寫入（預存未註冊值回退顯示 ppt，再點 ppt 也不覆寫）', () => {
    const { storage, data } = memoryStorage({ [SHELL_STORAGE_KEY]: 'keynote' })
    vi.stubGlobal('window', { localStorage: storage })
    expect(loadShellId()).toBe('ppt')
    useUiStore.getState().setShellId('ppt')
    expect(data.get(SHELL_STORAGE_KEY)).toBe('keynote')
  })

  it('loadShellId 讀到未註冊值只回退、不寫回', () => {
    const writes: string[] = []
    const storage: ShellStorage = {
      getItem: () => 'keynote',
      setItem: (k, v) => void writes.push(`${k}=${v}`),
    }
    expect(loadShellId(storage)).toBe('ppt')
    expect(writes).toEqual([])
  })

  it('取用 window.localStorage 本身丟例外（封鎖網站資料）時仍回預設', () => {
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new Error('SecurityError')
      },
    })
    expect(loadShellId()).toBe('ppt')
    expect(() => useUiStore.getState().setShellId('ppt')).not.toThrow()
  })
})

describe('分頁互不影響（DESIGN §13.4）', () => {
  it('uiStore 不監聽 storage 事件：別的分頁寫入 localStorage 不改本分頁狀態', async () => {
    const fs = (await import('node:fs' as string)) as { readFileSync(path: URL, encoding: 'utf8'): string }
    const sources = ['../src/layout/uiStore.ts', '../src/App.tsx', '../src/main.tsx', '../src/home/HomeScreen.tsx', '../src/home/HomeThemeCards.tsx']
    for (const f of sources) {
      const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8')
      expect(src, f).not.toMatch(/['"]storage['"]|onstorage|StorageEvent/)
    }
  })
})

describe('nicknameDraft：首頁輸入到一半的暱稱（首頁重新掛載時沿用）', () => {
  it('預設 null，可設定與清除', () => {
    expect(useUiStore.getState().nicknameDraft).toBeNull()
    useUiStore.getState().setNicknameDraft('rex')
    expect(useUiStore.getState().nicknameDraft).toBe('rex')
    useUiStore.getState().setNicknameDraft(null)
    expect(useUiStore.getState().nicknameDraft).toBeNull()
  })
})
