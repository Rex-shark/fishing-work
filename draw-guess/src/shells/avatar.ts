// 暱稱頭像的純邏輯（跨殼層共用；Epic 5 起由 ppt/commentFormat 搬到 shells/ 根層，ppt 註解卡片與 meet 參加者 tile 共用）：
// 頭像首字、頭像底色編號與對應的 Tailwind class。本檔不屬於任一主題資料夾，兩殼層都可 import（殼層之間不互相 import）。
// 底色為跨主題 token --avatar-1..6（theme.css，各主題不覆寫）；本檔不含色碼。

/** 頭像底色數（DESIGN §13.2「底色依暱稱雜湊取 6 色之一」；theme.css --avatar-1..6） */
export const AVATAR_COLOR_COUNT = 6

/** 頭像底色 class（theme.css --avatar-1..6；Tailwind 需要完整 class 字面值才會產生） */
export const AVATAR_BG = ['bg-avatar-1', 'bg-avatar-2', 'bg-avatar-3', 'bg-avatar-4', 'bg-avatar-5', 'bg-avatar-6'] as const

/** 取不到字時的頭像文字 */
export const AVATAR_FALLBACK = '?'

/** 切出第一個「使用者看到的字」；null 表示環境不支援，改以 code point 切 */
export type FirstGrapheme = ((text: string) => string | undefined) | null

/** 瀏覽器（與 Node）有 Intl.Segmenter 時以字素切：👍🏽、🇹🇼、👨‍👩‍👧 這類多 code point 的 emoji 不會被切半 */
function defaultFirstGrapheme(): FirstGrapheme {
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return null
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  return (text) => segmenter.segment(text)[Symbol.iterator]().next().value?.segment
}

const FIRST_GRAPHEME = defaultFirstGrapheme()

/**
 * 頭像文字：暱稱去頭尾空白後的第一個字（至少以 code point 取，不會切出半個代理對；支援時以字素取），英文字母轉大寫。
 * 暱稱為 null 或空白時為「?」。
 */
export function avatarInitial(nickname: string | null, firstGrapheme: FirstGrapheme = FIRST_GRAPHEME): string {
  const text = (nickname ?? '').trim()
  if (text === '') return AVATAR_FALLBACK
  const first = (firstGrapheme !== null ? firstGrapheme(text) : undefined) ?? Array.from(text)[0] ?? AVATAR_FALLBACK
  return first.toUpperCase()
}

/**
 * 頭像底色編號 0..AVATAR_COLOR_COUNT-1：暱稱逐 code point 的 FNV-1a 32-bit 雜湊取餘數。
 * 同一暱稱在每台電腦、每次重新整理都得到同一色（不依賴 id 或加入順序）。
 */
export function avatarColorIndex(nickname: string | null): number {
  let hash = 0x811c9dc5
  for (const ch of nickname ?? '') {
    hash ^= ch.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash % AVATAR_COLOR_COUNT
}

/** 頭像底色 class（avatarColorIndex → AVATAR_BG） */
export function avatarBgClass(nickname: string | null): (typeof AVATAR_BG)[number] {
  return AVATAR_BG[avatarColorIndex(nickname)] ?? AVATAR_BG[0]
}
