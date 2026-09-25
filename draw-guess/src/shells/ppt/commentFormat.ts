// ppt 主題註解卡片的純邏輯（可單元測試；DESIGN.md §13.2「右註解窗格」）：頭像首字、頭像底色、輸入框文字。
// 樣式在 CommentChat.tsx；本檔不含 class 與色碼。檔名刻意與 CommentChat.tsx 取不同字根（macOS 檔名不分大小寫）。

/** 頭像底色數（DESIGN §13.2「底色依暱稱雜湊取 6 色之一」；theme.css --avatar-1..6） */
export const AVATAR_COLOR_COUNT = 6

/** 底部輸入框的 placeholder（DESIGN §13.2「新增註解…」）；取代功能元件依角色給的提示文字 */
export const COMMENT_PLACEHOLDER = '新增註解…'

/** 送出鈕的名稱與提示 */
export const COMMENT_SEND_LABEL = '送出註解'

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
