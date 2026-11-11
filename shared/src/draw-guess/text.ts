// 文字長度與合法性：spec/architecture.md §4「文字長度與合法性」

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
