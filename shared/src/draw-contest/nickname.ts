// 暱稱驗證：spec/draw-contest/architecture.md §4（複製自我畫你猜 shared/src/draw-guess/nickname.ts，不從 draw-guess 匯入）
import { NICKNAME_MAX } from './constants';
import type { ErrorCode } from './events';
import { countChars, hasControlChars } from './text';

export const NICKNAME_INVALID_MESSAGE = `暱稱需為 1～${NICKNAME_MAX} 個字，且不可含控制字元`;
export const NICKNAME_TAKEN_MESSAGE = '這個暱稱已經有人使用';

export type NicknameCheck =
  | { ok: true; nickname: string }
  | { ok: false; error: Extract<ErrorCode, 'NICKNAME_INVALID'>; message: string };

/** 去頭尾空白後 1..NICKNAME_MAX code points、無控制字元；合法時回傳去頭尾空白後的暱稱 */
export function validateNickname(raw: string): NicknameCheck {
  const nickname = raw.trim();
  // 快速排除：NICKNAME_MAX 個 code point 最多佔 2 × NICKNAME_MAX 個 UTF-16 單位，避免對超長字串展開陣列
  const tooLong = nickname.length > NICKNAME_MAX * 2 || countChars(nickname) > NICKNAME_MAX;
  if (nickname.length === 0 || tooLong || hasControlChars(nickname)) {
    return { ok: false, error: 'NICKNAME_INVALID', message: NICKNAME_INVALID_MESSAGE };
  }
  return { ok: true, nickname };
}

/** 重複比對用的鍵：NFKC（全形→半形）後轉小寫，因此 Alice、alice、Ａｌｉｃｅ 視為同一暱稱 */
export function nicknameKey(nickname: string): string {
  return nickname.normalize('NFKC').toLowerCase();
}
