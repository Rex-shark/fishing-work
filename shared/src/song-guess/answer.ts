// 答案判定（純函式）：spec/song-guess/architecture.md §4「答案判定」
// iTunes 的歌名常帶副標（電影主題曲、Live、feat.、Taylor's Version…），玩家只會打歌名本身，所以先去副標再比對；
// 打完整歌名（含副標）也算對。
import { stripInvisible } from './text';

/** 副標起點之一：第一個全形或半形括號（（…）、(…)、【…】、[…]） */
const BRACKET = /[（(【\[]/u;
/** 副標起點之二：` - `（例：`夜に駆ける - From THE FIRST TAKE`） */
const DASH = ' - ';
/**
 * 副標起點之三：feat.／ft.／featuring（不分大小寫）。
 * 前一個字不可是英文字母（`Left.`、`Gift.` 不算；`溫柔feat.孫燕姿`、`Free Free Free feat. 幾田りら` 算）；
 * featuring 後面也不可接英文字母。不用 lookbehind（舊版 Safari 不支援，本檔客戶端也會載入），改以第 1 組吃掉前一個字。
 */
const FEAT = /(^|[^a-z])(?:feat\.|ft\.|featuring(?![a-z]))/iu;

/**
 * 歌名本身：去掉副標（第一個括號起的內容、` - ` 之後、feat.／ft.／featuring 之後，三者取最前面的那個）再去頭尾空白。
 * **不退回**：副標在開頭（括號開頭，如 `(......醉鬼阿Q) [feat. 孫燕姿]`、`(I Can't Get No) Satisfaction`）時回空字串。
 * picker 以此判斷「去副標後為空」並把這類歌排除（整串當答案幾乎猜不到）；判定用的是會退回的 stripSubtitle。
 */
export function mainTitle(title: string): string {
  let cut = title.length;
  const bracket = title.search(BRACKET);
  if (bracket >= 0) cut = Math.min(cut, bracket);
  const dash = title.indexOf(DASH);
  if (dash >= 0) cut = Math.min(cut, dash);
  const feat = FEAT.exec(title);
  if (feat !== null) cut = Math.min(cut, feat.index + (feat[1] ?? '').length);

  return title.slice(0, cut).trim();
}

/**
 * 去掉副標（判定用）：同 mainTitle，但去副標後為空字串時退回原歌名去頭尾空白。
 * 例：`如果可以 (電影"月老"主題曲)` → `如果可以`；`I'm gonna TOESA (feat. Kian84)` → `I'm gonna TOESA`；`愛 (Live)` → `愛`；
 * `(......醉鬼阿Q) [feat. 孫燕姿]` → 原樣。
 */
export function stripSubtitle(title: string): string {
  const main = mainTitle(title);
  return main === '' ? title.trim() : main;
}

/** NFKC（全形→半形）→ 移除所有空白與標點符號（\p{P}、\p{S}）→ 英文小寫 */
function fold(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .toLowerCase();
}

/** 去副標後正規化（第一步先移除不可見字元，Epic 21）。例：`I'm gonna TOESA (feat. Kian84)` → `imgonnatoesa` */
export function normalizeTitle(s: string): string {
  return fold(stripSubtitle(stripInvisible(s)));
}

/** 不去副標、其餘與 normalizeTitle 相同（第一步先移除不可見字元，Epic 21）。例：`愛 (Live)` → `愛live` */
export function normalizeFull(s: string): string {
  return fold(stripInvisible(s));
}

/**
 * 猜對：猜的字串去副標正規化後，等於歌名的 normalizeTitle（只打歌名本身）或 normalizeFull（打完整歌名、省略括號等）。
 * 正規化後為空字串者一律不算。
 */
export function isCorrect(guess: string, title: string): boolean {
  const g = normalizeTitle(guess);
  if (g === '') return false;
  const t = normalizeTitle(title);
  if (t === '') return false;
  return g === t || g === normalizeFull(title);
}

/** 洩題：text 正規化後（不去副標）包含歌名的 normalizeTitle。歌名正規化後為空字串時不視為洩題。 */
export function containsSpoiler(text: string, title: string): boolean {
  const t = normalizeTitle(title);
  if (t === '') return false;
  return normalizeFull(text).includes(t);
}

/**
 * 歌名字數提示：normalizeTitle 的 code point 數（去副標、**不含空白與標點**）——玩家實際要打對的字數。
 * 例：`My story, your song` → 15；`如果可以 (電影"月老"主題曲)` → 4。
 */
export function titleLength(title: string): number {
  return [...normalizeTitle(title)].length;
}
