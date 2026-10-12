// iTunes Search API 客戶端：spec/song-guess/architecture.md §3「iTunes Search API」「環境變數」、§6
// - search()：組網址 → fetch（AbortSignal.timeout）→ 非 2xx、逾時、連不上、JSON 解析失敗一律拋 ItunesSearchError（對外即 SEARCH_FAILED）。
// - createItunesClient()：包一層快取（鍵＝NFKC 小寫去空白的歌手名，時效 ITUNES_CACHE_MS）。每 IP 約 20 次／分鐘，
//   所以 server 統一呼叫、同一歌手再出題不重打；失敗不快取（出題者可立刻重試）。
// - 環境變數在本檔讀取（比照 draw-contest/judge/index.ts）：ITUNES_URL、ITUNES_COUNTRY、ITUNES_TIMEOUT_MS、ITUNES_CACHE_MS、SONG_PREVIEW_CAP_MS。
// 啟動時**不**探測 iTunes（省限流額度；連不上時出題者會收到 SEARCH_FAILED 並可重試）。
import { PREVIEW_CAP_MS } from '@fishing-work/shared/song-guess';
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

/** 搜尋歌手（不快取）。失敗一律拋 ItunesSearchError */
export async function search(artist: string, options: SearchOptions): Promise<ItunesTrack[]> {
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const url = buildSearchUrl(artist, options);
  let body: string;
  try {
    const res = await doFetch(url, { signal: AbortSignal.timeout(options.timeoutMs), headers: { Accept: 'application/json' } });
    if (!res.ok) throw new ItunesSearchError(`HTTP ${res.status}`);
    body = await res.text();
  } catch (err) {
    if (err instanceof ItunesSearchError) throw err;
    const name = err instanceof Error ? err.name : '';
    const reason = name === 'TimeoutError' || name === 'AbortError' ? `逾時（${options.timeoutMs} ms）` : `連線失敗：${String(err)}`;
    throw new ItunesSearchError(reason, { cause: err });
  }
  return parseSearchBody(body);
}

// ─── 快取 ─────────────────────────────────────────────────────────

/** room 使用的搜尋器：給歌手名（已驗證、去頭尾空白），回原始搜尋結果；失敗 reject */
export type SongSearcher = (artist: string) => Promise<ItunesTrack[]>;

export interface ItunesConfig {
  url: string;
  country: string;
  timeoutMs: number;
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

export interface ItunesClientOptions {
  fetch?: FetchLike;
  /** 快取時效用的時鐘（預設 Date.now；測試注入） */
  now?: () => number;
  /** 每次搜尋（含快取命中、失敗）回報一次，register 記 log */
  onSearch?: (info: SearchLogInfo) => void;
}

export interface ItunesClient {
  search: SongSearcher;
  /** 目前快取的歌手數（測試與 log 用） */
  cacheSize(): number;
}

/**
 * 建立帶快取的 iTunes 客戶端。
 * - 快取鍵＝artistKey(歌手名)；命中且未過期直接回（不打 iTunes）。只快取成功的結果（含 0 筆）。
 * - 同一鍵的搜尋進行中又來一次（上一次出題取消後馬上重填同一位）→ 共用同一個 promise，不重打。
 * - 每次寫入時順手清掉過期項目，快取不會無限成長。
 */
export function createItunesClient(config: ItunesConfig, options: ItunesClientOptions = {}): ItunesClient {
  const now = options.now ?? (() => Date.now());
  const cache = new Map<string, { at: number; tracks: ItunesTrack[] }>();
  const pending = new Map<string, Promise<ItunesTrack[]>>();

  const prune = (t: number): void => {
    for (const [key, entry] of cache) if (t - entry.at >= config.cacheMs) cache.delete(key);
  };

  return {
    cacheSize: () => cache.size,
    search: (artist) => {
      const key = artistKey(artist);
      const hit = cache.get(key);
      if (hit !== undefined && now() - hit.at < config.cacheMs) {
        options.onSearch?.({ artist, count: hit.tracks.length, ms: 0, cached: true });
        return Promise.resolve(hit.tracks);
      }
      const inFlight = pending.get(key);
      if (inFlight !== undefined) return inFlight;

      const startedAt = Date.now();
      const run = search(artist, { url: config.url, country: config.country, timeoutMs: config.timeoutMs, fetch: options.fetch })
        .then((tracks) => {
          const t = now();
          prune(t);
          if (config.cacheMs > 0) cache.set(key, { at: t, tracks });
          options.onSearch?.({ artist, count: tracks.length, ms: Date.now() - startedAt, cached: false });
          return tracks;
        })
        .catch((err: unknown) => {
          const reason = err instanceof ItunesSearchError ? err.reason : String(err);
          options.onSearch?.({ artist, ms: Date.now() - startedAt, cached: false, reason });
          throw err;
        })
        .finally(() => {
          pending.delete(key);
        });
      pending.set(key, run);
      return run;
    },
  };
}

// ─── 環境變數 ─────────────────────────────────────────────────────

export const DEFAULT_ITUNES_CONFIG = {
  url: 'https://itunes.apple.com',
  country: 'TW',
  timeoutMs: 8000,
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

  let country: string = DEFAULT_ITUNES_CONFIG.country;
  const rawCountry = env.ITUNES_COUNTRY?.trim() ?? '';
  if (/^[a-z]{2}$/i.test(rawCountry)) country = rawCountry.toUpperCase();
  else if (rawCountry !== '') warn('song-guess.envInvalid', { name: 'ITUNES_COUNTRY', value: env.ITUNES_COUNTRY, using: country });

  return {
    url,
    country,
    timeoutMs: readInt(env, 'ITUNES_TIMEOUT_MS', DEFAULT_ITUNES_CONFIG.timeoutMs, warn, 1),
    cacheMs: readInt(env, 'ITUNES_CACHE_MS', DEFAULT_ITUNES_CONFIG.cacheMs, warn, 0),
    previewCapMs: readInt(env, 'SONG_PREVIEW_CAP_MS', DEFAULT_ITUNES_CONFIG.previewCapMs, warn, 1),
  };
}

/** register 的預設組合：讀環境變數、建立帶快取的搜尋器，並把每次搜尋記進 log */
export interface SongGuessSetup {
  search: SongSearcher;
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
  });
  return { search: client.search, previewCapMs: config.previewCapMs };
}
