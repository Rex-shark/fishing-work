// 題目驗證：spec/architecture.md §4「文字長度與合法性」、§9.1（不可見字元）
import { TOPIC_MAX, countChars, hasControlChars, isInvisibleOnlyOrForbidden, normalizeAnswer } from '@fishing-work/shared';

export const TOPIC_INVALID_MESSAGE = `題目需為 1～${TOPIC_MAX} 個字，不可含控制字元，也不能只有空白`;

export type TopicCheck = { ok: true; topic: string } | { ok: false };

/** 去頭尾空白後 1..TOPIC_MAX code points、無控制字元、無禁用的不可見字元且移除後非空（Epic 21）、normalizeAnswer 後非空；合法時回傳去頭尾空白後的題目 */
export function validateTopic(raw: string): TopicCheck {
  const topic = raw.trim();
  // 快速排除：TOPIC_MAX 個 code point 最多佔 2 × TOPIC_MAX 個 UTF-16 單位，避免對超長字串展開陣列
  if (topic.length === 0 || topic.length > TOPIC_MAX * 2) return { ok: false };
  if (countChars(topic) > TOPIC_MAX || hasControlChars(topic)) return { ok: false };
  if (isInvisibleOnlyOrForbidden(topic)) return { ok: false };
  if (normalizeAnswer(topic) === '') return { ok: false };
  return { ok: true, topic };
}
