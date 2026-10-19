// 出題對話框「只抽熱門歌」的本機偏好（spec/song-guess/design.md §1「出題（選題庫）」；plan/song-guess-sources.md 決策 9）：
// 預設勾選；記住這台瀏覽器上次的選擇（localStorage `fishing-work:song-guess:hot`，不進 server）。
// 讀寫都可能丟例外（隱私模式、封鎖網站資料）：讀不到一律當預設（勾），寫不進去就忽略，本次仍以畫面上的值送出。

/** localStorage 鍵（與 shell、session、volume 同一命名空間，不與另兩款撞鍵） */
export const HOT_STORAGE_KEY = 'fishing-work:song-guess:hot'
/** 沒有偏好時的預設：勾選（Rex 2026-10-16） */
export const HOT_DEFAULT = true

export type HotStorage = Pick<Storage, 'getItem' | 'setItem'>

/** 瀏覽器的 localStorage；取用本身可能丟例外，非瀏覽器環境回 null */
function browserStorage(): HotStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** 讀取上次的選擇：只認 '1'（勾）與 '0'（不勾），其餘（沒有、亂值、讀取失敗）回預設 */
export function loadHot(storage: HotStorage | null = browserStorage()): boolean {
  if (storage === null) return HOT_DEFAULT
  try {
    const raw = storage.getItem(HOT_STORAGE_KEY)
    return raw === '0' ? false : raw === '1' ? true : HOT_DEFAULT
  } catch {
    return HOT_DEFAULT
  }
}

/** 記住這次的選擇；寫入失敗時忽略（偏好只是方便，不影響遊戲） */
export function saveHot(hot: boolean, storage: HotStorage | null = browserStorage()): void {
  if (storage === null) return
  try {
    storage.setItem(HOT_STORAGE_KEY, hot ? '1' : '0')
  } catch {
    // 忽略
  }
}
