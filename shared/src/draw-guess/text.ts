// 文字長度與合法性：spec/architecture.md §4「文字長度與合法性」

/** Unicode code point 數：[...s].length；emoji 算 1，不做字形叢集 */
export function countChars(s: string): number {
  return [...s].length;
}

/** 是否含控制字元（\p{Cc}，含換行、tab） */
export function hasControlChars(s: string): boolean {
  return /\p{Cc}/u.test(s);
}
