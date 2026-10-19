// 抽歌（純函式）：spec/song-guess/architecture.md §4「答案判定」的歌名去重、§5 choosing、§6 picker
// 1. 過濾：有試聽、artistName 正規化後包含輸入的歌手名；排除沒辦法猜的歌名——normalizeTitle 為空（純符號）
//    與去副標後為空（括號開頭，如 `(......醉鬼阿Q) [feat. 孫燕姿]`：整串當答案幾乎猜不到）。
// 2. 去重：normalizeTitle 相同者只留一首（同一首歌的 Live、Remastered、伴奏、電影版…），優先留非 Live、其次全長最長者。
// 3. 不足 n 首：改以「原始結果中出現最多次的 artistName」為過濾條件再做一次（輸入英文名或別名：Jay Chou → 周杰倫）。
//    **該名須佔原始結果過半**（出現次數 × 2 > 原始結果總筆數；分母含沒試聽的，剛好一半不算），否則不退回——
//    避免輸入的歌手自己不足 n 首、卻出了結果裡別人的歌。仍不足回 null。
// 4. 熱門（Epic 18，{ hot: true }）：去重後**保持 iTunes 回傳順序**（＝Apple 的熱門度）只取前 HOT_POOL 首（不足就全部）；
//    退回那一輪同樣套用。
// 5. topic＝過濾後（去重前）出現最多次的 artistName（合唱曲的「A & B」不影響）；熱門時只計前 HOT_POOL 首的候選。
// 6. 隨機抽 n 首（random 可注入，測試才有確定的結果）。
// pickChart（Epic 18，台灣熱門／西洋熱門）：有試聽、歌名猜得到、以「artistName ＋ normalizeTitle」去重，隨機抽 n 首；不套 HOT_POOL。
import { HOT_POOL, mainTitle, normalizeTitle } from '@fishing-work/shared/song-guess';
import { artistKey, type ItunesTrack } from './itunes';

/** 抽中的一首歌（room 內部保存；答案欄位到揭曉才對外） */
export interface PickedSong {
  trackId: number;
  /** 顯示用原始歌名（含副標）；答案判定以此為準 */
  title: string;
  artist: string;
  album: string | null;
  artworkUrl: string | null;
  itunesUrl: string | null;
  previewUrl: string;
  /** 全長毫秒；iTunes 沒給為 null（room 以播放上限代替） */
  trackTimeMillis: number | null;
}

export interface Picked {
  songs: PickedSong[];
  /** iTunes 的歌手正式名稱（題庫標題，RoundPublic.topic；Epic 18 前叫 artistDisplay） */
  topic: string;
}

export interface PickOptions {
  /** 只從去重後的前 HOT_POOL 首抽（保持 iTunes 回傳順序；Epic 18）；預設 false */
  hot?: boolean;
}

/** 副標裡標示現場版的字樣（只看被 stripSubtitle 去掉的那段，歌名本身含 Live 不算，例：`Live My Life`） */
const LIVE = /live|演唱會|現場/iu;

/** 是否為現場版：副標（括號、` - `、feat. 之後）含 Live／演唱會／現場 */
export function isLiveVersion(trackName: string): boolean {
  const trimmed = trackName.trim();
  // main 是 trimmed 的開頭（歌名本身）；括號開頭的歌 main 為空，不視為現場版（這類歌 picker 本來就排除）
  const main = mainTitle(trimmed);
  return main !== '' && LIVE.test(trimmed.slice(main.length));
}

/** 出現最多次的 artistName 與次數（同次數取先出現者）；沒有任何一筆回 null */
export function topArtist(tracks: readonly ItunesTrack[]): { name: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const t of tracks) counts.set(t.artistName, (counts.get(t.artistName) ?? 0) + 1);
  let best: { name: string; count: number } | null = null;
  // Map 依插入順序走訪，只有「更多」才取代，所以同次數時留先出現的
  for (const [name, count] of counts) {
    if (best === null || count > best.count) best = { name, count };
  }
  return best;
}

/** 出現最多次的 artistName（同次數取先出現者）；沒有任何一筆回 null */
export function mostFrequentArtist(tracks: readonly ItunesTrack[]): string | null {
  return topArtist(tracks)?.name ?? null;
}

/**
 * 退回用的歌手名：原始結果中出現最多次的 artistName，且**佔原始結果過半**（次數 × 2 > 總筆數）才回；否則 null。
 * 分母是全部原始結果（含沒試聽、之後會被濾掉的），剛好一半不算過半。
 */
export function majorityArtist(tracks: readonly ItunesTrack[]): string | null {
  const top = topArtist(tracks);
  return top !== null && top.count * 2 > tracks.length ? top.name : null;
}

type Playable = ItunesTrack & { previewUrl: string };

/** 有試聽且歌名猜得到（正規化後非空、去副標後非空） */
function playable(t: ItunesTrack): t is Playable {
  return t.previewUrl !== null && mainTitle(t.trackName) !== '' && normalizeTitle(t.trackName) !== '';
}

/** 過濾：有試聽、artistName 正規化後包含 key、歌名猜得到；保持原順序 */
function filterTracks(tracks: readonly ItunesTrack[], key: string): Playable[] {
  const out: Playable[] = [];
  for (const t of tracks) {
    if (!playable(t)) continue;
    if (!artistKey(t.artistName).includes(key)) continue;
    out.push({ ...t, previewUrl: t.previewUrl });
  }
  return out;
}

/** a 是否比 b 更適合留下：非 Live 優先，其次全長較長；其餘（同條件）留先出現的 b */
function better(a: ItunesTrack, b: ItunesTrack): boolean {
  const liveA = isLiveVersion(a.trackName);
  const liveB = isLiveVersion(b.trackName);
  if (liveA !== liveB) return !liveA;
  return (a.trackTimeMillis ?? 0) > (b.trackTimeMillis ?? 0);
}

/**
 * 去重：鍵相同者只留一首；**保持各鍵第一次出現的位置**（Map 依插入順序，取代不改位置）——
 * 熱門度以該歌第一次出現的名次為準，留下的版本（非 Live、較長）不影響名次。
 */
function dedupe<T extends ItunesTrack>(tracks: readonly T[], keyOf: (t: T) => string = (t) => normalizeTitle(t.trackName)): T[] {
  const kept = new Map<string, T>();
  for (const t of tracks) {
    const key = keyOf(t);
    const prev = kept.get(key);
    if (prev === undefined || better(t, prev)) kept.set(key, t);
  }
  return [...kept.values()];
}

/** 抽中的歌轉成 room 保存的形狀 */
function toPicked(t: Playable): PickedSong {
  return {
    trackId: t.trackId,
    title: t.trackName,
    artist: t.artistName,
    album: t.collectionName,
    artworkUrl: t.artworkUrl100,
    itunesUrl: t.trackViewUrl,
    previewUrl: t.previewUrl,
    trackTimeMillis: t.trackTimeMillis,
  };
}

/**
 * 一輪過濾 → 去重 →（熱門時）取前 HOT_POOL 首。回傳候選與計算 topic 用的過濾結果
 * （熱門時只留歌名落在候選裡的那些，topic 就以前 HOT_POOL 首計）。
 */
function candidates(tracks: readonly ItunesTrack[], key: string, hot: boolean): { pool: Playable[]; counted: Playable[] } {
  const filtered = filterTracks(tracks, key);
  const unique = dedupe(filtered);
  if (!hot || unique.length <= HOT_POOL) return { pool: unique, counted: filtered };
  const pool = unique.slice(0, HOT_POOL);
  const titles = new Set(pool.map((t) => normalizeTitle(t.trackName)));
  return { pool, counted: filtered.filter((t) => titles.has(normalizeTitle(t.trackName))) };
}

/** 從 items 隨機取 n 個（部分 Fisher–Yates；不改動傳入的陣列） */
function sample<T>(items: readonly T[], n: number, random: () => number): T[] {
  const pool = [...items];
  const count = Math.min(n, pool.length);
  for (let i = 0; i < count; i++) {
    // random() 理論上回 [0, 1)；夾住上限以防注入的函式回 1
    const j = i + Math.min(pool.length - i - 1, Math.floor(random() * (pool.length - i)));
    const tmp = pool[i] as T;
    pool[i] = pool[j] as T;
    pool[j] = tmp;
  }
  return pool.slice(0, count);
}

/**
 * 從搜尋結果抽 n 首。
 * @param tracks iTunes 原始搜尋結果（itunes.ts 的 ItunesTrack；順序＝Apple 的熱門度）
 * @param artistInput 出題者輸入的歌手名（已驗證）
 * @param n 要抽幾首（SONGS_PER_GAME）
 * @param random 回 [0, 1) 的亂數（預設 Math.random）
 * @param options hot：只從去重後的前 HOT_POOL 首抽（Epic 18）
 * @returns 抽到的歌與題庫標題（歌手正式名稱）；可抽的歌不足 n 首回 null（ARTIST_NOT_FOUND）
 */
export function pick(
  tracks: readonly ItunesTrack[],
  artistInput: string,
  n: number,
  random: () => number = Math.random,
  options: PickOptions = {},
): Picked | null {
  const hot = options.hot === true;
  const inputKey = artistKey(artistInput);
  let round = inputKey === '' ? { pool: [], counted: [] } : candidates(tracks, inputKey, hot);

  if (round.pool.length < n) {
    // 英文名、別名：iTunes 找得到人，但 artistName 是另一種寫法 → 以結果中最常出現（且過半）的歌手名再濾一次（熱門照套）
    const fallback = majorityArtist(tracks);
    const fallbackKey = fallback === null ? '' : artistKey(fallback);
    if (fallbackKey === '' || fallbackKey === inputKey) return null;
    round = candidates(tracks, fallbackKey, hot);
    if (round.pool.length < n) return null;
  }

  const topic = mostFrequentArtist(round.counted);
  if (topic === null) return null;
  return { songs: sample(round.pool, n, random).map(toPicked), topic };
}

/** 榜單去重鍵：artistName ＋ normalizeTitle（同名歌不同歌手是不同的歌；決策 7） */
function chartKey(t: ItunesTrack): string {
  return `${t.artistName}\u0000${normalizeTitle(t.trackName)}`;
}

/**
 * 從排行榜抽 n 首（Epic 18，台灣熱門／西洋熱門）：有試聽、歌名猜得到（normalizeTitle 與 mainTitle 皆非空）、
 * 以「artistName ＋ normalizeTitle」去重，隨機抽 n 首；不套 HOT_POOL（榜單本身就是熱門）、不過濾語言。
 * @returns 抽到的歌；可抽的歌不足 n 首回 null（CHART_FAILED）
 */
export function pickChart(tracks: readonly ItunesTrack[], n: number, random: () => number = Math.random): PickedSong[] | null {
  const unique = dedupe(tracks.filter(playable), chartKey);
  if (unique.length < n) return null;
  return sample(unique, n, random).map(toPicked);
}
