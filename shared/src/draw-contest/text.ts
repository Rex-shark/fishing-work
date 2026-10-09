// 文字長度與合法性：spec/draw-contest/architecture.md §4（暱稱與題目的純函式複製自我畫你猜，不從 draw-guess 匯入）、§5.3「聊天」
import { CHAT_MAX, TOPIC_MAX } from './constants';

/** Unicode code point 數：[...s].length；emoji 算 1，不做字形叢集 */
export function countChars(s: string): number {
  return [...s].length;
}

/** 是否含控制字元（\p{Cc}，含換行、tab） */
export function hasControlChars(s: string): boolean {
  return /\p{Cc}/u.test(s);
}

/**
 * 去掉所有空白後是否為空：NFKC（全形空白等轉半形）後移除所有空白。
 * 與我畫你猜的 normalizeAnswer(s) === '' 等價（normalizeAnswer 只多了 toLowerCase，不影響是否為空）；本遊戲不判答案，故不複製 answer.ts
 */
function isBlankAfterNormalize(s: string): boolean {
  return s.normalize('NFKC').replace(/\s+/gu, '') === '';
}

export const TOPIC_INVALID_MESSAGE = `題目需為 1～${TOPIC_MAX} 個字，不可含控制字元，也不能只有空白`;

export type TopicCheck = { ok: true; topic: string } | { ok: false };

/** 去頭尾空白後 1..TOPIC_MAX code points、無控制字元、去掉所有空白後非空；合法時回傳去頭尾空白後的題目 */
export function validateTopic(raw: string): TopicCheck {
  const topic = raw.trim();
  // 快速排除：TOPIC_MAX 個 code point 最多佔 2 × TOPIC_MAX 個 UTF-16 單位，避免對超長字串展開陣列
  if (topic.length === 0 || topic.length > TOPIC_MAX * 2) return { ok: false };
  if (countChars(topic) > TOPIC_MAX || hasControlChars(topic)) return { ok: false };
  if (isBlankAfterNormalize(topic)) return { ok: false };
  return { ok: true, topic };
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
