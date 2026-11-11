// 聊天訊息驗證：spec/architecture.md §4「文字長度與合法性」、§5「聊天訊息判定」、§9.1（不可見字元）
import { CHAT_MAX, CHAT_MIN_INTERVAL_MS, SPOILER_COOLDOWN_MS, countChars, hasControlChars, isInvisibleOnlyOrForbidden } from '@fishing-work/shared';

/** chat:send 的繁中錯誤訊息（ack.message，客戶端直接顯示） */
export const CHAT_ERROR_MESSAGES = {
  MESSAGE_INVALID: `訊息需為 1～${CHAT_MAX} 個字，不可含換行等控制字元，也不能只有空白`,
  RATE_LIMITED: `發言太快了，請稍候再送（間隔至少 ${CHAT_MIN_INTERVAL_MS / 1000} 秒）`,
  /** 洩題冷卻期間的 RATE_LIMITED（spec §9.1，Epic 21 決策 11；秒數由常數組字） */
  RATE_LIMITED_SPOILER: `剛才的訊息含答案被擋下，請等 ${SPOILER_COOLDOWN_MS / 1000} 秒再發言`,
  /** 未猜對的猜題者：含題目但不完全相符（例如題目「蘋果」打「是蘋果嗎」）— 文字照 spec §5 */
  SPOILER_BLOCKED_GUESS: '猜答案請只輸入答案本身',
  /** 畫師或已猜對者：訊息含題目 */
  SPOILER_BLOCKED: '訊息含有題目，不會送出（畫師與已猜對者不能透露答案）',
} as const;

export type ChatTextCheck = { ok: true; text: string } | { ok: false };

/** 去頭尾空白後 1..CHAT_MAX code points、無控制字元（單行）、無禁用的不可見字元且移除後非空（Epic 21）；合法時回傳去頭尾空白後的文字 */
export function validateChatText(raw: string): ChatTextCheck {
  const text = raw.trim();
  // 快速排除：CHAT_MAX 個 code point 最多佔 2 × CHAT_MAX 個 UTF-16 單位，避免對超長字串展開陣列
  if (text.length === 0 || text.length > CHAT_MAX * 2) return { ok: false };
  if (countChars(text) > CHAT_MAX || hasControlChars(text)) return { ok: false };
  if (isInvisibleOnlyOrForbidden(text)) return { ok: false };
  return { ok: true, text };
}
