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

// ── 不可見字元（Epic 21 決策 1；spec/architecture.md §9.1）：三款 text.ts 逐字相同，去重留第二批 #22 ──

/**
 * 不可見字元集合：\p{Cf}（格式字元，含零寬空白 U+200B、ZWJ U+200D、BOM U+FEFF、方向標記、tag 字元等）、
 * 變體選擇符（U+FE00–FE0F、U+E0100–E01EF、蒙古文 U+180B–180F、U+034F）、隱形填充（U+115F、U+1160、U+3164、U+FFA0、U+2800）。
 */
const INVISIBLE_ALL = /[\p{Cf}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}\u{180B}-\u{180F}\u{034F}\u{115F}\u{1160}\u{3164}\u{FFA0}\u{2800}]/gu;
/** 禁用的不可見字元：上述集合扣掉 U+200D（ZWJ）與 U+FE0F（VS16）——這兩個是 emoji 組合用（👨‍👩‍👧、❤️），允許出現 */
const INVISIBLE_FORBIDDEN = /(?!\u{200D})[\p{Cf}\u{FE00}-\u{FE0E}\u{E0100}-\u{E01EF}\u{180B}-\u{180F}\u{034F}\u{115F}\u{1160}\u{3164}\u{FFA0}\u{2800}]/u;

/** 移除所有不可見字元（含 ZWJ 與 VS16）；比對函式（答案、暱稱鍵、歌手鍵）的第一步 */
export function stripInvisible(s: string): string {
  return s.replace(INVISIBLE_ALL, '');
}

/** 是否含禁用的不可見字元（不可見字元扣掉 ZWJ 與 VS16）；驗證暱稱、題目、歌手名、聊天文字用 */
export function hasForbiddenInvisible(s: string): boolean {
  return INVISIBLE_FORBIDDEN.test(s);
}

/** 驗證共用：含禁用的不可見字元，或移除不可見字元後為空（只有 ZWJ／VS16 等）→ 不合法。s 應為已去頭尾空白的字串 */
export function isInvisibleOnlyOrForbidden(s: string): boolean {
  return hasForbiddenInvisible(s) || stripInvisible(s).trim() === '';
}

export const TOPIC_INVALID_MESSAGE = `題目需為 1～${TOPIC_MAX} 個字，不可含控制字元，也不能只有空白`;

export type TopicCheck = { ok: true; topic: string } | { ok: false };

/** 去頭尾空白後 1..TOPIC_MAX code points、無控制字元、無禁用的不可見字元且移除不可見字元後非空（Epic 21）；合法時回傳去頭尾空白後的題目 */
export function validateTopic(raw: string): TopicCheck {
  const topic = raw.trim();
  // 快速排除：TOPIC_MAX 個 code point 最多佔 2 × TOPIC_MAX 個 UTF-16 單位，避免對超長字串展開陣列
  if (topic.length === 0 || topic.length > TOPIC_MAX * 2) return { ok: false };
  if (countChars(topic) > TOPIC_MAX || hasControlChars(topic)) return { ok: false };
  if (isInvisibleOnlyOrForbidden(topic)) return { ok: false };
  return { ok: true, topic };
}

export type ChatTextCheck = { ok: true; text: string } | { ok: false };

/** 去頭尾空白後 1..CHAT_MAX code points、無控制字元（單行）、無禁用的不可見字元且移除不可見字元後非空（Epic 21）；合法時回傳去頭尾空白後的文字 */
export function validateChatText(raw: string): ChatTextCheck {
  const text = raw.trim();
  // 快速排除：CHAT_MAX 個 code point 最多佔 2 × CHAT_MAX 個 UTF-16 單位，避免對超長字串展開陣列
  if (text.length === 0 || text.length > CHAT_MAX * 2) return { ok: false };
  if (countChars(text) > CHAT_MAX || hasControlChars(text)) return { ok: false };
  if (isInvisibleOnlyOrForbidden(text)) return { ok: false };
  return { ok: true, text };
}
