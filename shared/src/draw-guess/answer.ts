// 答案判定：spec/architecture.md §4「答案判定」、§9.1（不可見字元）
import { stripInvisible } from './text';

/**
 * 正規化答案字串：
 * 0. 移除不可見字元（Epic 21；「蘋＋ZWJ＋果」等於「蘋果」）  1. Unicode NFKC（全形→半形）  2. 移除所有空白  3. 英文轉小寫
 */
export function normalizeAnswer(s: string): string {
  return stripInvisible(s).normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
}

/** normalize 後全等。正規化後為空字串者一律不算猜對。 */
export function isCorrect(guess: string, topic: string): boolean {
  const t = normalizeAnswer(topic);
  if (t === '') return false;
  return normalizeAnswer(guess) === t;
}

/** normalize 後 text 包含 topic。題目正規化後為空字串時不視為洩題。 */
export function containsSpoiler(text: string, topic: string): boolean {
  const t = normalizeAnswer(topic);
  if (t === '') return false;
  return normalizeAnswer(text).includes(t);
}
