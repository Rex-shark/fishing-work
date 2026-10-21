// iTunes Search API 客戶端：spec/song-guess/architecture.md §3「iTunes Search API」「環境變數」、§6
// - search()：組網址 → fetch（AbortSignal.timeout）→ 非 2xx、逾時、連不上、JSON 解析失敗一律拋 ItunesSearchError（對外即 SEARCH_FAILED）。
// - createItunesClient()：包一層快取（鍵＝NFKC 小寫去空白的歌手名，時效 ITUNES_CACHE_MS）。每 IP 約 20 次／分鐘，
//   所以 server 統一呼叫、同一歌手再出題不重打；失敗不快取（出題者可立刻重試）。
// - chart()（Epic 18）：排行榜兩段呼叫——RSS（${ITUNES_RSS_URL}/api/v2/<國家>/music/most-played/100/songs.json）取 id →
//   一次 lookup（${ITUNES_URL}/lookup?id=<逗號分隔>&country=${ITUNES_COUNTRY}）補 previewUrl／trackTimeMillis；
//   RSS 段逾時 ITUNES_RSS_TIMEOUT_MS（12 秒；Apple RSS 偶發 8～15 秒才回，決策 14）、lookup 段 ITUNES_TIMEOUT_MS（8 秒）；
//   任一段失敗或 RSS 沒有歌一律拋 ItunesChartError（對外即 CHART_FAILED）。快取鍵＝國家。
// - animePool()（Epic 19，動漫熱門）：ANIME_TERMS（anime／アニメ／動漫）各打一次 Search（不帶 attribute），三次**並行**、
//   各自 ITUNES_TIMEOUT_MS 逾時；任一失敗（逾時、連不上、非 2xx、解析失敗）整體拋 ItunesChartError（對外即 CHART_FAILED）。
//   合併：同一首（trackId）只留一筆，排名＝它在三份結果中的最小索引，依排名升冪（同排名依關鍵字順序）。
//   快取鍵 'anime'，存的是合併後、**尚未排除**原聲帶／翻唱的結果（排除與去重在 picker.pickAnime）。
// - 環境變數在本檔讀取（比照 draw-contest/judge/index.ts）：ITUNES_URL、ITUNES_COUNTRY、ITUNES_RSS_URL、ITUNES_TIMEOUT_MS、ITUNES_RSS_TIMEOUT_MS、
//   ITUNES_CACHE_MS、SONG_PREVIEW_CAP_MS。
// 啟動時**不**探測 iTunes（省限流額度；連不上時出題者會收到 SEARCH_FAILED 並可重試）。
import { ANIME_TERMS, CHART_SIZE, PREVIEW_CAP_MS } from '@fishing-work/shared/song-guess';
import { log } from '../../lib/log';

/** 測試可注入的 fetch（只用到這個形狀） */
export type FetchLike = (
  url: string,
  init: { signal: AbortSignal; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** 搜尋結果的一首歌：只留本遊戲用到的欄位（§3「回傳欄位用到」） */
export interface ItunesTrack {
  trackId: number;
  trackName: string;
  artistName: string;
  collectionName: string | null;
  artworkUrl100: string | null;
  /** 30 秒試聽網址；沒有試聽或不是 http(s) 網址為 null（picker 會濾掉） */
  previewUrl: string | null;
  /** 全長毫秒；iTunes 沒給為 null */
  trackTimeMillis: number | null;
  trackViewUrl: string | null;
}

/** 搜尋失敗（逾時、連不上、非 2xx、回應不是預期的 JSON）；room 一律回 SEARCH_FAILED */
export class ItunesSearchError extends Error {
  readonly code = 'SEARCH_FAILED';
  constructor(
    readonly reason: string,
    options?: { cause?: unknown },
  ) {
    super(`iTunes 搜尋失敗：${reason}`, options);
    this.name = 'ItunesSearchError';
  }
}

/**
 * 題庫取得失敗（排行榜：RSS 或 lookup 逾時、連不上、非 2xx、回應不是預期的 JSON、RSS 沒有歌；
 * 動漫熱門（Epic 19）：任一關鍵字搜尋失敗）；room 一律回 CHART_FAILED
 */
export class ItunesChartError extends Error {
  readonly code = 'CHART_FAILED';
  constructor(
    readonly reason: string,
    options?: { cause?: unknown },
  ) {
    super(`取得題庫失敗：${reason}`, options);
    this.name = 'ItunesChartError';
  }
}

export interface SearchOptions {
  /** iTunes Search API 根網址（不含 /search） */
  url: string;
  country: string;
  timeoutMs: number;
  /** 預設全域 fetch */
  fetch?: FetchLike;
}

/** 一次搜尋要求的上限（iTunes 的最大值） */
export const SEARCH_LIMIT = 200;

/** 歌手名的正規化鍵：NFKC（全形→半形）→ 小寫 → 去掉所有空白。快取鍵與 picker 的歌手名比對共用 */
export function artistKey(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
}

/** 組搜尋網址：`${url}/search?term=…&attribute=artistTerm&country=…&media=music&entity=song&limit=200`（參數順序照 §3） */
export function buildSearchUrl(artist: string, options: Pick<SearchOptions, 'url' | 'country'>): string {
  const query = new URLSearchParams({
    term: artist,
    attribute: 'artistTerm',
    country: options.country,
    media: 'music',
    entity: 'song',
    limit: String(SEARCH_LIMIT),
  });
  return `${options.url.replace(/\/+$/, '')}/search?${query.toString()}`;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

/** 只接受 http(s) 網址（客戶端會直接拿去載入，不信任外部資料） */
function httpUrl(v: unknown): string | null {
  return typeof v === 'string' && /^https?:\/\//i.test(v) ? v : null;
}

/** 把 results 的一筆轉成 ItunesTrack；不是歌、缺歌名或歌手名者回 null（略過） */
function toTrack(raw: unknown): ItunesTrack | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.kind !== undefined && r.kind !== 'song') return null;
  const trackName = str(r.trackName);
  const artistName = str(r.artistName);
  if (trackName === null || artistName === null) return null;
  const time = r.trackTimeMillis;
  return {
    trackId: typeof r.trackId === 'number' ? r.trackId : 0,
    trackName,
    artistName,
    collectionName: str(r.collectionName),
    artworkUrl100: httpUrl(r.artworkUrl100),
    previewUrl: httpUrl(r.previewUrl),
    trackTimeMillis: typeof time === 'number' && Number.isFinite(time) && time > 0 ? time : null,
    trackViewUrl: httpUrl(r.trackViewUrl),
  };
}

/** 解析回應本文（iTunes 回 text/javascript 但內容是 JSON）；形狀不對拋 ItunesSearchError */
export function parseSearchBody(body: string): ItunesTrack[] {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch (err) {
    throw new ItunesSearchError('回應不是 JSON', { cause: err });
  }
  const results = typeof json === 'object' && json !== null ? (json as Record<string, unknown>).results : undefined;
  if (!Array.isArray(results)) throw new ItunesSearchError('回應沒有 results 陣列');
  const tracks: ItunesTrack[] = [];
  for (const raw of results) {
    const t = toTrack(raw);
    if (t !== null) tracks.push(t);
  }
  return tracks;
}

/**
 * GET 一次並讀回本文：非 2xx、逾時（含讀本文時）、連不上一律以 makeError 包成該模組的錯誤（search／chart 共用）。
 * 逾時以 AbortSignal.timeout 涵蓋整段（連線＋讀本文）。
 */
async function fetchText(
  url: string,
  timeoutMs: number,
  doFetch: FetchLike,
  makeError: (reason: string, cause?: unknown) => Error,
): Promise<string> {
  try {
    const res = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json' } });
    if (!res.ok) throw makeError(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    if (err instanceof ItunesSearchError || err instanceof ItunesChartError) throw err;
    const name = err instanceof Error ? err.name : '';
    const reason = name === 'TimeoutError' || name === 'AbortError' ? `逾時（${timeoutMs} ms）` : `連線失敗：${String(err)}`;
    throw makeError(reason, err);
  }
}

const defaultFetch: FetchLike = (url, init) => fetch(url, init);

/** 搜尋歌手（不快取）。失敗一律拋 ItunesSearchError */
export async function search(artist: string, options: SearchOptions): Promise<ItunesTrack[]> {
  const url = buildSearchUrl(artist, options);
  const body = await fetchText(url, options.timeoutMs, options.fetch ?? defaultFetch, (reason, cause) => new ItunesSearchError(reason, { cause }));
  return parseSearchBody(body);
}

// ─── 排行榜（Epic 18） ─────────────────────────────────────────────

/** 榜單國家：台灣熱門 tw、西洋熱門 us（room 由 source 對應） */
export type ChartCountry = 'tw' | 'us';

export interface ChartOptions {
  /** 排行榜 RSS 根網址（ITUNES_RSS_URL，不含 /api） */
  rssUrl: string;
  /** iTunes 根網址（ITUNES_URL，lookup 用） */
  url: string;
  /** lookup 的商店區域（ITUNES_COUNTRY；與榜單國家無關） */
  country: string;
  /** lookup 段的逾時（ITUNES_TIMEOUT_MS） */
  timeoutMs: number;
  /** RSS 段的逾時（ITUNES_RSS_TIMEOUT_MS；決策 14）；未給時用 timeoutMs */
  rssTimeoutMs?: number;
  fetch?: FetchLike;
}

/** 組 RSS 網址：`${rssUrl}/api/v2/${country}/music/most-played/${CHART_SIZE}/songs.json` */
export function buildChartUrl(country: ChartCountry, rssUrl: string): string {
  return `${rssUrl.replace(/\/+$/, '')}/api/v2/${country}/music/most-played/${CHART_SIZE}/songs.json`;
}

/** 組 lookup 網址：`${url}/lookup?id=<逗號分隔>&country=…`（id 已確認為純數字，逗號不編碼，照 §3 字面） */
export function buildLookupUrl(ids: readonly string[], options: Pick<ChartOptions, 'url' | 'country'>): string {
  return `${options.url.replace(/\/+$/, '')}/lookup?id=${ids.join(',')}&country=${encodeURIComponent(options.country)}`;
}

/**
 * 解析 RSS 本文：取 `feed.results[].id`（依榜單名次；字串或數字皆可，非純數字者略過、重複者只留第一次）。
 * 不是 JSON、沒有 feed.results 陣列、或一個 id 都沒有 → ItunesChartError。
 */
export function parseChartIds(body: string): string[] {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch (err) {
    throw new ItunesChartError('RSS 回應不是 JSON', { cause: err });
  }
  const feed = typeof json === 'object' && json !== null ? (json as Record<string, unknown>).feed : undefined;
  const results = typeof feed === 'object' && feed !== null ? (feed as Record<string, unknown>).results : undefined;
  if (!Array.isArray(results)) throw new ItunesChartError('RSS 回應沒有 feed.results 陣列');
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const raw of results) {
    if (typeof raw !== 'object' || raw === null) continue;
    const id = (raw as Record<string, unknown>).id;
    const text = typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? String(id) : id;
    if (typeof text !== 'string' || !/^\d+$/.test(text) || seen.has(text)) continue;
    seen.add(text);
    ids.push(text);
  }
  if (ids.length === 0) throw new ItunesChartError('RSS 榜單沒有歌');
  return ids;
}

/**
 * 解析 lookup 本文並依榜單名次排序：只留 `wrapperType === 'track'` 且有試聽者；榜單上的 id 在 lookup 找不到
 * （例：該國商店沒上架）就略過。不是 JSON、沒有 results 陣列 → ItunesChartError。
 */
export function parseLookupBody(body: string, ids: readonly string[]): ItunesTrack[] {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch (err) {
    throw new ItunesChartError('lookup 回應不是 JSON', { cause: err });
  }
  const results = typeof json === 'object' && json !== null ? (json as Record<string, unknown>).results : undefined;
  if (!Array.isArray(results)) throw new ItunesChartError('lookup 回應沒有 results 陣列');
  const byId = new Map<string, ItunesTrack>();
  for (const raw of results) {
    if (typeof raw !== 'object' || raw === null) continue;
    if ((raw as Record<string, unknown>).wrapperType !== 'track') continue;
    const t = toTrack(raw);
    if (t === null || t.previewUrl === null || t.trackId <= 0) continue;
    const key = String(t.trackId);
    if (!byId.has(key)) byId.set(key, t);
  }
  const tracks: ItunesTrack[] = [];
  for (const id of ids) {
    const t = byId.get(id);
    if (t !== undefined) tracks.push(t);
  }
  return tracks;
}

/** 取排行榜（不快取）：RSS → lookup 合併，依榜單名次。失敗一律拋 ItunesChartError */
export async function chart(country: ChartCountry, options: ChartOptions): Promise<ItunesTrack[]> {
  const doFetch = options.fetch ?? defaultFetch;
  const makeError =
    (stage: string) =>
    (reason: string, cause?: unknown): Error =>
      new ItunesChartError(`${stage} ${reason}`, { cause });
  const rss = await fetchText(buildChartUrl(country, options.rssUrl), options.rssTimeoutMs ?? options.timeoutMs, doFetch, makeError('RSS'));
  const ids = parseChartIds(rss);
  const lookup = await fetchText(buildLookupUrl(ids, options), options.timeoutMs, doFetch, makeError('lookup'));
  return parseLookupBody(lookup, ids);
}

// ─── 動漫熱門（Epic 19） ───────────────────────────────────────────

/** 組動漫熱門的搜尋網址：`${url}/search?term=<kw>&entity=song&country=…&media=music&limit=200`（**不帶 attribute**；參數順序照 §6） */
export function buildAnimeSearchUrl(term: string, options: Pick<SearchOptions, 'url' | 'country'>): string {
  const query = new URLSearchParams({
    term,
    entity: 'song',
    country: options.country,
    media: 'music',
    limit: String(SEARCH_LIMIT),
  });
  return `${options.url.replace(/\/+$/, '')}/search?${query.toString()}`;
}

/** 同一首歌的合併鍵：有 trackId 用 trackId；沒有（toTrack 給 0）退回歌手＋歌名＋專輯 */
function mergeKey(t: ItunesTrack): string {
  return t.trackId > 0 ? `id:${t.trackId}` : `raw:${t.artistName}\u0000${t.trackName}\u0000${t.collectionName ?? ''}`;
}

/**
 * 合併多份搜尋結果（依關鍵字順序傳入）：同一首（mergeKey）只留一筆、排名＝它在各份結果中的最小索引；
 * 依排名升冪，同排名依關鍵字順序（＝lists 的順序）。留下的那一筆是達到最小索引、關鍵字較前的那份裡的資料。
 */
export function mergeAnimeResults(lists: readonly (readonly ItunesTrack[])[]): ItunesTrack[] {
  const best = new Map<string, { track: ItunesTrack; rank: number; term: number }>();
  lists.forEach((tracks, term) => {
    tracks.forEach((track, rank) => {
      const key = mergeKey(track);
      const prev = best.get(key);
      // lists 依關鍵字順序走訪：只有「索引更小」才取代，同索引留關鍵字較前者
      if (prev === undefined || rank < prev.rank) best.set(key, { track, rank, term });
    });
  });
  return [...best.values()].sort((a, b) => a.rank - b.rank || a.term - b.term).map((x) => x.track);
}

/**
 * 取動漫熱門的題庫（不快取）：ANIME_TERMS 三次 Search **並行**、各自 timeoutMs 逾時；任一失敗拋 ItunesChartError
 * （原因帶關鍵字）。成功回合併後的結果（依合併排名；**尚未**排除原聲帶／翻唱、尚未去重）。
 */
export async function animePool(options: SearchOptions): Promise<ItunesTrack[]> {
  const doFetch = options.fetch ?? defaultFetch;
  const lists = await Promise.all(
    ANIME_TERMS.map(async (term) => {
      const body = await fetchText(buildAnimeSearchUrl(term, options), options.timeoutMs, doFetch, (reason, cause) => new ItunesChartError(`search ${term} ${reason}`, { cause }));
      try {
        return parseSearchBody(body);
      } catch (err) {
        throw new ItunesChartError(`search ${term} ${err instanceof ItunesSearchError ? err.reason : String(err)}`, { cause: err });
      }
    }),
  );
  return mergeAnimeResults(lists);
}

// ─── 快取 ─────────────────────────────────────────────────────────

/** room 使用的搜尋器：給歌手名（已驗證、去頭尾空白），回原始搜尋結果；失敗 reject */
export type SongSearcher = (artist: string) => Promise<ItunesTrack[]>;

/** room 使用的排行榜取得器（Epic 18）：給國家，回依名次排序、有試聽的歌；失敗 reject */
export type ChartFetcher = (country: ChartCountry) => Promise<ItunesTrack[]>;

/** room 使用的動漫熱門題庫取得器（Epic 19）：回三關鍵字合併後的結果（依合併排名、尚未排除）；失敗 reject */
export type AnimePoolFetcher = () => Promise<ItunesTrack[]>;

/** 動漫熱門的快取鍵（Epic 19 決策 4） */
export const ANIME_CACHE_KEY = 'anime';

export interface ItunesConfig {
  url: string;
  country: string;
  /** 排行榜 RSS 根網址（ITUNES_RSS_URL；Epic 18） */
  rssUrl: string;
  /** 搜尋（含動漫熱門的三次搜尋）與 lookup 的逾時（ITUNES_TIMEOUT_MS） */
  timeoutMs: number;
  /** 排行榜 RSS 段的逾時（ITUNES_RSS_TIMEOUT_MS；決策 14） */
  rssTimeoutMs: number;
  cacheMs: number;
}

export interface SearchLogInfo {
  artist: string;
  /** 回傳筆數（失敗時無） */
  count?: number;
  ms: number;
  cached: boolean;
  /** 失敗原因（成功時無） */
  reason?: string;
}

export interface ChartLogInfo {
  country: ChartCountry;
  /** 合併後的筆數（失敗時無） */
  count?: number;
  ms: number;
  cached: boolean;
  /** 失敗原因（成功時無） */
  reason?: string;
}

export interface AnimeLogInfo {
  /** 合併後的筆數（失敗時無） */
  count?: number;
  ms: number;
  cached: boolean;
  /** 失敗原因（成功時無） */
  reason?: string;
}

export interface ItunesClientOptions {
  fetch?: FetchLike;
  /** 快取時效用的時鐘（預設 Date.now；測試注入） */
  now?: () => number;
  /** 每次搜尋（含快取命中、失敗）回報一次，register 記 log */
  onSearch?: (info: SearchLogInfo) => void;
  /** 每次取排行榜（含快取命中、失敗）回報一次（Epic 18） */
  onChart?: (info: ChartLogInfo) => void;
  /** 每次取動漫熱門題庫（含快取命中、失敗）回報一次（Epic 19） */
  onAnime?: (info: AnimeLogInfo) => void;
}

export interface ItunesClient {
  search: SongSearcher;
  /** 排行榜（Epic 18）：快取鍵＝國家，規則同 search（只快取成功、同鍵進行中共用請求） */
  chart: ChartFetcher;
  /** 動漫熱門（Epic 19）：快取鍵 'anime'，規則同 search（只快取成功、進行中共用請求） */
  animePool: AnimePoolFetcher;
  /** 目前快取的歌手數（測試與 log 用） */
  cacheSize(): number;
  /** 目前快取的榜單數（測試用） */
  chartCacheSize(): number;
  /** 目前快取的動漫熱門題庫數（0 或 1；測試用） */
  animeCacheSize(): number;
}

/**
 * 帶時效的快取＋同鍵進行中共用請求（search 與 chart 共用的骨架）。
 * 命中且未過期直接回；同鍵進行中回同一個 promise；只快取成功的結果；每次寫入時順手清掉過期項目。
 */
function createCache<T>(cacheMs: number, now: () => number) {
  const cache = new Map<string, { at: number; value: T }>();
  const pending = new Map<string, Promise<T>>();
  return {
    size: () => cache.size,
    get(key: string): { value: T } | undefined {
      const hit = cache.get(key);
      return hit !== undefined && now() - hit.at < cacheMs ? { value: hit.value } : undefined;
    },
    pending: (key: string) => pending.get(key),
    track(key: string, run: Promise<T>): Promise<T> {
      const shared = run
        .then((value) => {
          const t = now();
          for (const [k, entry] of cache) if (t - entry.at >= cacheMs) cache.delete(k);
          if (cacheMs > 0) cache.set(key, { at: t, value });
          return value;
        })
        .finally(() => {
          pending.delete(key);
        });
      pending.set(key, shared);
      return shared;
    },
  };
}

/**
 * 建立帶快取的 iTunes 客戶端。
 * - 快取鍵＝artistKey(歌手名)；命中且未過期直接回（不打 iTunes）。只快取成功的結果（含 0 筆）。
 * - 同一鍵的搜尋進行中又來一次（上一次出題取消後馬上重填同一位）→ 共用同一個 promise，不重打。
 * - 每次寫入時順手清掉過期項目，快取不會無限成長。
 */
export function createItunesClient(config: ItunesConfig, options: ItunesClientOptions = {}): ItunesClient {
  const now = options.now ?? (() => Date.now());
  const searches = createCache<ItunesTrack[]>(config.cacheMs, now);
  const charts = createCache<ItunesTrack[]>(config.cacheMs, now);
  const animes = createCache<ItunesTrack[]>(config.cacheMs, now);

  return {
    cacheSize: searches.size,
    chartCacheSize: charts.size,
    animeCacheSize: animes.size,
    search: (artist) => {
      const key = artistKey(artist);
      const hit = searches.get(key);
      if (hit !== undefined) {
        options.onSearch?.({ artist, count: hit.value.length, ms: 0, cached: true });
        return Promise.resolve(hit.value);
      }
      const inFlight = searches.pending(key);
      if (inFlight !== undefined) return inFlight;

      const startedAt = Date.now();
      const run = search(artist, { url: config.url, country: config.country, timeoutMs: config.timeoutMs, fetch: options.fetch }).then(
        (tracks) => {
          options.onSearch?.({ artist, count: tracks.length, ms: Date.now() - startedAt, cached: false });
          return tracks;
        },
        (err: unknown) => {
          const reason = err instanceof ItunesSearchError ? err.reason : String(err);
          options.onSearch?.({ artist, ms: Date.now() - startedAt, cached: false, reason });
          throw err;
        },
      );
      return searches.track(key, run);
    },
    chart: (country) => {
      const hit = charts.get(country);
      if (hit !== undefined) {
        options.onChart?.({ country, count: hit.value.length, ms: 0, cached: true });
        return Promise.resolve(hit.value);
      }
      const inFlight = charts.pending(country);
      if (inFlight !== undefined) return inFlight;

      const startedAt = Date.now();
      const run = chart(country, {
        rssUrl: config.rssUrl,
        url: config.url,
        country: config.country,
        timeoutMs: config.timeoutMs,
        rssTimeoutMs: config.rssTimeoutMs,
        fetch: options.fetch,
      }).then(
        (tracks) => {
          options.onChart?.({ country, count: tracks.length, ms: Date.now() - startedAt, cached: false });
          return tracks;
        },
        (err: unknown) => {
          const reason = err instanceof ItunesChartError ? err.reason : String(err);
          options.onChart?.({ country, ms: Date.now() - startedAt, cached: false, reason });
          throw err;
        },
      );
      return charts.track(country, run);
    },
    animePool: () => {
      const hit = animes.get(ANIME_CACHE_KEY);
      if (hit !== undefined) {
        options.onAnime?.({ count: hit.value.length, ms: 0, cached: true });
        return Promise.resolve(hit.value);
      }
      const inFlight = animes.pending(ANIME_CACHE_KEY);
      if (inFlight !== undefined) return inFlight;

      const startedAt = Date.now();
      const run = animePool({ url: config.url, country: config.country, timeoutMs: config.timeoutMs, fetch: options.fetch }).then(
        (tracks) => {
          options.onAnime?.({ count: tracks.length, ms: Date.now() - startedAt, cached: false });
          return tracks;
        },
        (err: unknown) => {
          const reason = err instanceof ItunesChartError ? err.reason : String(err);
          options.onAnime?.({ ms: Date.now() - startedAt, cached: false, reason });
          throw err;
        },
      );
      return animes.track(ANIME_CACHE_KEY, run);
    },
  };
}

// ─── 環境變數 ─────────────────────────────────────────────────────

export const DEFAULT_ITUNES_CONFIG = {
  url: 'https://itunes.apple.com',
  country: 'TW',
  rssUrl: 'https://rss.marketingtools.apple.com',
  timeoutMs: 8000,
  rssTimeoutMs: 12_000,
  cacheMs: 600_000,
  previewCapMs: PREVIEW_CAP_MS,
} as const;

export interface SongGuessConfig extends ItunesConfig {
  /** 單首最長播放毫秒（SONG_PREVIEW_CAP_MS；未設用 shared 的 PREVIEW_CAP_MS） */
  previewCapMs: number;
}

type Logger = (event: string, fields?: Record<string, unknown>) => void;

/** 整數環境變數（≥ min）；空字串、非整數、小於 min → 預設值並 warn */
function readInt(env: NodeJS.ProcessEnv, name: string, fallback: number, warn: Logger, min: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) {
    warn('song-guess.envInvalid', { name, value: raw, using: fallback });
    return fallback;
  }
  return n;
}

/** 讀環境變數（未設或不合法時用預設值；不合法者 log warn） */
export function readSongGuessConfig(env: NodeJS.ProcessEnv = process.env, warn: Logger = log.warn): SongGuessConfig {
  let url: string = DEFAULT_ITUNES_CONFIG.url;
  const rawUrl = env.ITUNES_URL?.trim() ?? '';
  if (/^https?:\/\//i.test(rawUrl)) url = rawUrl.replace(/\/+$/, '');
  else if (rawUrl !== '') warn('song-guess.envInvalid', { name: 'ITUNES_URL', value: env.ITUNES_URL, using: url });

  let rssUrl: string = DEFAULT_ITUNES_CONFIG.rssUrl;
  const rawRss = env.ITUNES_RSS_URL?.trim() ?? '';
  if (/^https?:\/\//i.test(rawRss)) rssUrl = rawRss.replace(/\/+$/, '');
  else if (rawRss !== '') warn('song-guess.envInvalid', { name: 'ITUNES_RSS_URL', value: env.ITUNES_RSS_URL, using: rssUrl });

  let country: string = DEFAULT_ITUNES_CONFIG.country;
  const rawCountry = env.ITUNES_COUNTRY?.trim() ?? '';
  if (/^[a-z]{2}$/i.test(rawCountry)) country = rawCountry.toUpperCase();
  else if (rawCountry !== '') warn('song-guess.envInvalid', { name: 'ITUNES_COUNTRY', value: env.ITUNES_COUNTRY, using: country });

  return {
    url,
    country,
    rssUrl,
    timeoutMs: readInt(env, 'ITUNES_TIMEOUT_MS', DEFAULT_ITUNES_CONFIG.timeoutMs, warn, 1),
    rssTimeoutMs: readInt(env, 'ITUNES_RSS_TIMEOUT_MS', DEFAULT_ITUNES_CONFIG.rssTimeoutMs, warn, 1),
    cacheMs: readInt(env, 'ITUNES_CACHE_MS', DEFAULT_ITUNES_CONFIG.cacheMs, warn, 0),
    previewCapMs: readInt(env, 'SONG_PREVIEW_CAP_MS', DEFAULT_ITUNES_CONFIG.previewCapMs, warn, 1),
  };
}

/** register 的預設組合：讀環境變數、建立帶快取的搜尋器，並把每次搜尋記進 log */
export interface SongGuessSetup {
  search: SongSearcher;
  chart: ChartFetcher;
  /** 動漫熱門題庫（Epic 19；與搜尋器共用同一個 iTunes 客戶端） */
  animePool: AnimePoolFetcher;
  previewCapMs: number;
}

export function songGuessSetupFromEnv(env: NodeJS.ProcessEnv = process.env, warn: Logger = log.warn): SongGuessSetup {
  const config = readSongGuessConfig(env, warn);
  log.info('song-guess.itunes.config', { ...config });
  const client = createItunesClient(config, {
    onSearch: (info) => {
      if (info.reason !== undefined) log.warn('song-guess.itunes.failed', { ...info });
      else log.info('song-guess.itunes.search', { ...info });
    },
    onChart: (info) => {
      if (info.reason !== undefined) log.warn('song-guess.itunes.chartFailed', { ...info });
      else log.info('song-guess.itunes.chart', { ...info });
    },
    onAnime: (info) => {
      if (info.reason !== undefined) log.warn('song-guess.itunes.animeFailed', { ...info });
      else log.info('song-guess.itunes.anime', { ...info });
    },
  });
  return { search: client.search, chart: client.chart, animePool: client.animePool, previewCapMs: config.previewCapMs };
}
