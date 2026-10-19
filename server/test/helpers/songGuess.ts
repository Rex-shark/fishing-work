// 猜歌測試用：真 iTunes 回應裁出的 fixture（搜尋、排行榜）、合成歌單、手動搜尋器與手動排行榜取得器
import { readFileSync } from 'node:fs';
import {
  parseChartIds,
  parseLookupBody,
  parseSearchBody,
  type ChartCountry,
  type ChartFetcher,
  type ItunesTrack,
  type SongSearcher,
} from '../../src/games/song-guess/itunes';

const FIXTURE = new URL('../fixtures/song-guess.itunes.json', import.meta.url);
const CHART_FIXTURE = new URL('../fixtures/song-guess.chart.json', import.meta.url);

/** fixture 裡有的搜尋詞（2026-10-12 台灣區 artistTerm 搜尋的真回應，各裁到二、三十首，只留用到的欄位） */
export type FixtureTerm = '孫燕姿' | 'Jay Chou' | '周杰倫' | '告五人' | 'Taylor Swift' | 'YOASOBI' | '五月天';

let fixtureCache: Record<string, unknown> | null = null;

/** 某個搜尋詞的原始回應本文（iTunes 的 JSON 字串） */
export function fixtureBody(term: FixtureTerm): string {
  fixtureCache ??= JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;
  return JSON.stringify(fixtureCache[term]);
}

/** 某個搜尋詞的搜尋結果（經 itunes.ts 解析） */
export function fixtureTracks(term: FixtureTerm): ItunesTrack[] {
  return parseSearchBody(fixtureBody(term));
}

let chartCache: Record<string, { rss: unknown; lookup: unknown }> | null = null;

/**
 * 排行榜樣本（Epic 18；2026-10-16 真 Apple 回應：RSS most-played/100 與 lookup?id=…&country=TW，裁到每國前 20 名；
 * us 另附第 80、84、91 名——台灣商店 lookup 查不到的三首）。回傳兩段的原始本文。
 */
export function chartFixtureBodies(country: ChartCountry): { rss: string; lookup: string } {
  chartCache ??= JSON.parse(readFileSync(CHART_FIXTURE, 'utf8')) as Record<string, { rss: unknown; lookup: unknown }>;
  const entry = chartCache[country];
  if (entry === undefined) throw new Error(`排行榜樣本沒有 ${country}`);
  return { rss: JSON.stringify(entry.rss), lookup: JSON.stringify(entry.lookup) };
}

/** 排行榜樣本經 itunes.ts 解析後的結果（依榜單名次、只留有試聽的 track） */
export function chartFixtureTracks(country: ChartCountry): ItunesTrack[] {
  const { rss, lookup } = chartFixtureBodies(country);
  return parseLookupBody(lookup, parseChartIds(rss));
}

/** 合成一首歌（room 測試用；欄位形狀同 itunes.ts 解析後的結果） */
export function track(id: number, trackName: string, overrides: Partial<ItunesTrack> = {}): ItunesTrack {
  return {
    trackId: id,
    trackName,
    artistName: '孫燕姿',
    collectionName: `專輯${id}`,
    artworkUrl100: `https://img.example/${id}/100x100bb.jpg`,
    previewUrl: `https://audio.example/preview/${id}.m4a`,
    trackTimeMillis: 240_000,
    trackViewUrl: `https://music.example/track/${id}`,
    ...overrides,
  };
}

/** 可預期的亂數（mulberry32），回 [0, 1) */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 讓所有已排定的 microtask／promise 鏈跑完 */
export function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export interface ManualSearchCall {
  artist: string;
  resolve(tracks: ItunesTrack[]): void;
  reject(err: unknown): void;
}

export interface ManualChartCall {
  country: ChartCountry;
  resolve(tracks: ItunesTrack[]): void;
  reject(err: unknown): void;
}

/** 手動排行榜取得器（Epic 18）：每次呼叫記一筆，由測試決定何時以什麼結果 resolve／reject */
export class ManualChart {
  readonly calls: ManualChartCall[] = [];
  readonly chart: ChartFetcher = (country) =>
    new Promise<ItunesTrack[]>((resolve, reject) => {
      this.calls.push({ country, resolve, reject });
    });
}

/** 手動搜尋器：每次搜尋記一筆，由測試決定何時以什麼結果 resolve／reject（模擬搜尋進行中） */
export class ManualSearch {
  readonly calls: ManualSearchCall[] = [];
  readonly search: SongSearcher = (artist) =>
    new Promise<ItunesTrack[]>((resolve, reject) => {
      this.calls.push({ artist, resolve, reject });
    });
}
