// 文字長度與合法性：spec/song-guess/architecture.md §4（常數）、§5（歌手名驗證）、§5.2（聊天）、§5.3（文案）
// 純函式複製自繪圖比賽 shared/src/draw-contest/text.ts，不從另兩款匯入。
import { ARTIST_MAX, CHAT_MAX } from './constants';

/** Unicode code point 數：[...s].length；emoji 算 1，不做字形叢集 */
export function countChars(s: string): number {
  return [...s].length;
}

/** 是否含控制字元（\p{Cc}，含換行、tab） */
export function hasControlChars(s: string): boolean {
  return /\p{Cc}/u.test(s);
}

/** 去掉所有空白後是否為空：NFKC（全形空白等轉半形）後移除所有空白 */
function isBlankAfterNormalize(s: string): boolean {
  return s.normalize('NFKC').replace(/\s+/gu, '') === '';
}

export const ARTIST_INVALID_MESSAGE = `歌手名稱需為 1～${ARTIST_MAX} 個字，不可含控制字元，也不能只有空白`;

export type ArtistCheck = { ok: true; artist: string } | { ok: false };

/** 去頭尾空白後 1..ARTIST_MAX code points、無控制字元、去掉所有空白後非空；合法時回傳去頭尾空白後的歌手名 */
export function validateArtist(raw: string): ArtistCheck {
  const artist = raw.trim();
  // 快速排除：ARTIST_MAX 個 code point 最多佔 2 × ARTIST_MAX 個 UTF-16 單位，避免對超長字串展開陣列
  if (artist.length === 0 || artist.length > ARTIST_MAX * 2) return { ok: false };
  if (countChars(artist) > ARTIST_MAX || hasControlChars(artist)) return { ok: false };
  if (isBlankAfterNormalize(artist)) return { ok: false };
  return { ok: true, artist };
}

export type ChatTextCheck = { ok: true; text: string } | { ok: false };

/** 去頭尾空白後 1..CHAT_MAX code points、無控制字元（單行）；合法時回傳去頭尾空白後的文字 */
export function validateChatText(raw: string): ChatTextCheck {
  const text = raw.trim();
  // 快速排除：CHAT_MAX 個 code point 最多佔 2 × CHAT_MAX 個 UTF-16 單位，避免對超長字串展開陣列
  if (text.length === 0 || text.length > CHAT_MAX * 2) return { ok: false };
  if (countChars(text) > CHAT_MAX || hasControlChars(text)) return { ok: false };
  return { ok: true, text };
}
