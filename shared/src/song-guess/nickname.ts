// 暱稱驗證：spec/song-guess/overview.md 規則 1（與前兩款相同；複製自繪圖比賽 shared/src/draw-contest/nickname.ts，不從另兩款匯入）
import { NICKNAME_MAX } from './constants';
import type { ErrorCode } from './events';
import { countChars, hasControlChars, isInvisibleOnlyOrForbidden, stripInvisible } from './text';

export const NICKNAME_INVALID_MESSAGE = `暱稱需為 1～${NICKNAME_MAX} 個字，且不可含控制字元`;
export const NICKNAME_TAKEN_MESSAGE = '這個暱稱已經有人使用';

export type NicknameCheck =
  | { ok: true; nickname: string }
  | { ok: false; error: Extract<ErrorCode, 'NICKNAME_INVALID'>; message: string };

/** 去頭尾空白後 1..NICKNAME_MAX code points、無控制字元、無禁用的不可見字元且移除不可見字元後非空（Epic 21）；合法時回傳去頭尾空白後的暱稱 */
export function validateNickname(raw: string): NicknameCheck {
  const nickname = raw.trim();
  // 快速排除：NICKNAME_MAX 個 code point 最多佔 2 × NICKNAME_MAX 個 UTF-16 單位，避免對超長字串展開陣列
  const tooLong = nickname.length > NICKNAME_MAX * 2 || countChars(nickname) > NICKNAME_MAX;
  if (nickname.length === 0 || tooLong || hasControlChars(nickname) || isInvisibleOnlyOrForbidden(nickname)) {
    return { ok: false, error: 'NICKNAME_INVALID', message: NICKNAME_INVALID_MESSAGE };
  }
  return { ok: true, nickname };
}

/**
 * 重複比對用的鍵：移除不可見字元（Epic 21）→ NFKC（全形→半形）→ 轉小寫，
 * 因此 Alice、alice、Ａｌｉｃｅ 視為同一暱稱，Rex 與 Rex＋U+FE0F 也是
 */
export function nicknameKey(nickname: string): string {
  return stripInvisible(nickname).normalize('NFKC').toLowerCase();
}
