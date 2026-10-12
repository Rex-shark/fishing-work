// 猜歌 iTunes 客戶端：spec/song-guess/architecture.md §3（端點、環境變數）、§6（search、快取）
// 全部以注入的 fetch、user/mock/itunes.mjs 或連不上的位址測，不打真 iTunes。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PREVIEW_CAP_MS } from '@fishing-work/shared/song-guess';
import {
  DEFAULT_ITUNES_CONFIG,
  ItunesSearchError,
  SEARCH_LIMIT,
  artistKey,
  buildSearchUrl,
  createItunesClient,
  parseSearchBody,
  readSongGuessConfig,
  search,
  type FetchLike,
  type SearchLogInfo,
} from '../src/games/song-guess/itunes';
import { fixtureBody } from './helpers/songGuess';

const mockPath = new URL('../../user/mock/itunes.mjs', import.meta.url).href;
interface MockItunes {
  url: string;
  port: number;
  close(): Promise<void>;
  requests: { method: string; path: string; term?: string; query?: Record<string, string> }[];
}
type StartMock = (options?: Record<string, unknown>) => Promise<MockItunes>;
async function startMock(options: Record<string, unknown> = {}): Promise<MockItunes> {
  const mod = (await import(mockPath)) as { startMockItunes: StartMock };
  return mod.startMockItunes(options);
}

const BASE = { url: 'https://itunes.example', country: 'TW', timeoutMs: 1000 };

/** 回固定本文的假 fetch；記錄每次呼叫的網址 */
function fakeFetch(body: string, status = 200): { fetch: FetchLike; urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    fetch: (url) => {
      urls.push(url);
      return Promise.resolve({ ok: status >= 200 && status < 300, status, text: () => Promise.resolve(body) });
    },
  };
}

let mock: MockItunes | null = null;
afterEach(async () => {
  await mock?.close();
  mock = null;
});

describe('buildSearchUrl：§3 端點與參數', () => {
  it('參數逐項與順序照 spec', () => {
    expect(buildSearchUrl('孫燕姿', { url: 'https://itunes.apple.com', country: 'TW' })).toBe(
      'https://itunes.apple.com/search?term=%E5%AD%AB%E7%87%95%E5%A7%BF&attribute=artistTerm&country=TW&media=music&entity=song&limit=200',
    );
    expect(SEARCH_LIMIT).toBe(200);
  });

  it('歌手名做 URL 編碼（空白、&、#、? 不會破壞查詢字串）', () => {
    const url = new URL(buildSearchUrl('Simon & Garfunkel #1?', { url: 'http://127.0.0.1:11535', country: 'US' }));
    expect(url.pathname).toBe('/search');
    expect(url.searchParams.get('term')).toBe('Simon & Garfunkel #1?');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      term: 'Simon & Garfunkel #1?',
      attribute: 'artistTerm',
      country: 'US',
      media: 'music',
      entity: 'song',
      limit: '200',
    });
  });

  it('根網址結尾的斜線不會變成 //search', () => {
    expect(buildSearchUrl('a', { url: 'http://127.0.0.1:11535/', country: 'TW' })).toMatch(/^http:\/\/127\.0\.0\.1:11535\/search\?term=a&/);
  });
});

describe('artistKey：快取鍵（NFKC 小寫去空白）', () => {
  it('大小寫、全形、空白視為同一位', () => {
    expect(artistKey('Jay Chou')).toBe('jaychou');
    expect(artistKey('ＪＡＹ　ＣＨＯＵ')).toBe('jaychou');
    expect(artistKey(' jay  chou ')).toBe('jaychou');
    expect(artistKey('孫燕姿')).toBe('孫燕姿');
  });

  it('標點不去掉（S.H.E 與 SHE 是不同的鍵）', () => {
    expect(artistKey('S.H.E')).toBe('s.h.e');
  });
});

describe('parseSearchBody', () => {
  it('真回應樣本：只留用到的欄位', () => {
    const tracks = parseSearchBody(fixtureBody('孫燕姿'));
    expect(tracks).toHaveLength(27);
    expect(tracks[0]).toEqual({
      trackId: 255921025,
      trackName: '我不難過',
      artistName: '孫燕姿',
      collectionName: '未完成',
      artworkUrl100: expect.stringMatching(/^https:\/\/.+100x100bb\.jpg$/),
      previewUrl: expect.stringMatching(/^https:\/\/audio-ssl\.itunes\.apple\.com\/.+\.m4a$/),
      trackTimeMillis: 320400,
      trackViewUrl: expect.stringMatching(/^https:\/\/music\.apple\.com\/tw\/album\//),
    });
  });

  it('缺歌名或歌手名、不是歌的項目略過；選用欄位缺少或形狀不對為 null', () => {
    const body = JSON.stringify({
      resultCount: 6,
      results: [
        { kind: 'song', trackId: 1, trackName: 'A', artistName: 'X', previewUrl: 'https://a/1.m4a', trackTimeMillis: 1000 },
        { kind: 'song', trackId: 2, trackName: 'B', artistName: 'X' },
        { kind: 'song', trackId: 3, trackName: 'C', artistName: 'X', previewUrl: 'javascript:alert(1)', artworkUrl100: 5, trackTimeMillis: -1, collectionName: '' },
        { kind: 'song', trackId: 4, artistName: 'X' },
        { kind: 'music-video', trackId: 5, trackName: 'E', artistName: 'X' },
        null,
        'x',
      ],
    });
    expect(parseSearchBody(body)).toEqual([
      { trackId: 1, trackName: 'A', artistName: 'X', collectionName: null, artworkUrl100: null, previewUrl: 'https://a/1.m4a', trackTimeMillis: 1000, trackViewUrl: null },
      { trackId: 2, trackName: 'B', artistName: 'X', collectionName: null, artworkUrl100: null, previewUrl: null, trackTimeMillis: null, trackViewUrl: null },
      { trackId: 3, trackName: 'C', artistName: 'X', collectionName: null, artworkUrl100: null, previewUrl: null, trackTimeMillis: null, trackViewUrl: null },
    ]);
  });

  it('查無：results 為空陣列', () => {
    expect(parseSearchBody('{"resultCount":0,"results":[]}')).toEqual([]);
  });

  it('不是 JSON、沒有 results 陣列 → ItunesSearchError', () => {
    expect(() => parseSearchBody('<html>503</html>')).toThrow(ItunesSearchError);
    expect(() => parseSearchBody('')).toThrow(ItunesSearchError);
    expect(() => parseSearchBody('{"resultCount":0}')).toThrow(ItunesSearchError);
    expect(() => parseSearchBody('{"results":{}}')).toThrow(ItunesSearchError);
    expect(() => parseSearchBody('null')).toThrow(ItunesSearchError);
  });
});

describe('search', () => {
  it('以組好的網址呼叫 fetch、帶 AbortSignal，回解析後的結果', async () => {
    const calls: { url: string; signal: AbortSignal }[] = [];
    const fetch: FetchLike = (url, init) => {
      calls.push({ url, signal: init.signal });
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(fixtureBody('Taylor Swift')) });
    };
    const tracks = await search('Taylor Swift', { ...BASE, fetch });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(buildSearchUrl('Taylor Swift', BASE));
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(tracks).toHaveLength(24);
    expect(tracks.every((t) => t.previewUrl !== null)).toBe(true);
  });

  it('非 2xx → SEARCH_FAILED（不讀本文）', async () => {
    for (const status of [403, 404, 429, 500, 503]) {
      const { fetch } = fakeFetch('{"results":[]}', status);
      const err = await search('x', { ...BASE, fetch }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ItunesSearchError);
      expect((err as ItunesSearchError).code).toBe('SEARCH_FAILED');
      expect((err as ItunesSearchError).reason).toBe(`HTTP ${status}`);
    }
  });

  it('JSON 解析失敗 → SEARCH_FAILED', async () => {
    const { fetch } = fakeFetch('not json');
    await expect(search('x', { ...BASE, fetch })).rejects.toMatchObject({ code: 'SEARCH_FAILED', reason: '回應不是 JSON' });
  });

  it('逾時：timeoutMs 到就中止並回 SEARCH_FAILED', async () => {
    let aborted = false;
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          aborted = true;
          reject(init.signal.reason);
        });
      });
    const startedAt = Date.now();
    const err = await search('x', { ...BASE, timeoutMs: 40, fetch }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ItunesSearchError);
    expect((err as ItunesSearchError).reason).toBe('逾時（40 ms）');
    expect(aborted).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it('連不上（fetch reject）→ SEARCH_FAILED', async () => {
    const fetch: FetchLike = () => Promise.reject(new TypeError('fetch failed'));
    await expect(search('x', { ...BASE, fetch })).rejects.toMatchObject({ code: 'SEARCH_FAILED' });
  });

  it('預設用全域 fetch：連不上的位址（測試環境的 ITUNES_URL）很快失敗', async () => {
    expect(process.env.ITUNES_URL).toBe('http://127.0.0.1:1');
    await expect(search('孫燕姿', { url: 'http://127.0.0.1:1', country: 'TW', timeoutMs: 2000 })).rejects.toBeInstanceOf(ItunesSearchError);
  });
});

describe('search × 假 iTunes（user/mock/itunes.mjs）', () => {
  it('回固定歌手資料；請求帶齊 §3 的參數；previewUrl 指回假 iTunes', async () => {
    mock = await startMock({ trackMs: 1234 });
    const tracks = await search('孫燕姿', { url: mock.url, country: 'TW', timeoutMs: 2000 });
    expect(tracks).toHaveLength(12);
    expect(tracks[0]).toMatchObject({ trackName: '我不難過', artistName: '孫燕姿', trackTimeMillis: 1234 });
    expect(tracks[0]?.previewUrl).toBe(`${mock.url}/preview/${tracks[0]?.trackId}.m4a`);
    expect(mock.requests).toEqual([
      {
        method: 'GET',
        path: '/search',
        term: '孫燕姿',
        query: { term: '孫燕姿', attribute: 'artistTerm', country: 'TW', media: 'music', entity: 'song', limit: '200' },
      },
    ]);
    const preview = await fetch(tracks[0]?.previewUrl ?? '');
    expect(preview.status).toBe(200);
    expect(preview.headers.get('content-type')).toBe('audio/mp4');
  });

  it('別名回同一份（Jay Chou → artistName 周杰倫）、只有 3 首的歌手、查無', async () => {
    mock = await startMock();
    const opts = { url: mock.url, country: 'TW', timeoutMs: 2000 };
    const jay = await search('Jay Chou', opts);
    expect(jay.length).toBeGreaterThanOrEqual(8);
    expect(jay.every((t) => t.artistName.includes('周杰倫'))).toBe(true);
    expect(await search('三首樂團', opts)).toHaveLength(3);
    expect(await search('沒有這個人', opts)).toEqual([]);
  });

  it('MOCK_ITUNES_FAIL（fail）與「壞掉樂團」回 500 → SEARCH_FAILED', async () => {
    mock = await startMock();
    await expect(search('壞掉樂團', { url: mock.url, country: 'TW', timeoutMs: 2000 })).rejects.toMatchObject({ reason: 'HTTP 500' });
    await mock.close();
    mock = await startMock({ fail: true });
    await expect(search('孫燕姿', { url: mock.url, country: 'TW', timeoutMs: 2000 })).rejects.toMatchObject({ reason: 'HTTP 500' });
  });

  it('MOCK_ITUNES_DELAY_MS（delayMs）超過逾時 → SEARCH_FAILED', async () => {
    mock = await startMock({ delayMs: 400 });
    await expect(search('孫燕姿', { url: mock.url, country: 'TW', timeoutMs: 50 })).rejects.toMatchObject({ reason: '逾時（50 ms）' });
  });
});

describe('createItunesClient：快取', () => {
  const config = { ...BASE, cacheMs: 600_000 };

  it('同一歌手（大小寫、全形、空白不同）在時效內只打一次', async () => {
    const { fetch, urls } = fakeFetch(fixtureBody('Jay Chou'));
    let now = 1_000_000;
    const logs: SearchLogInfo[] = [];
    const client = createItunesClient(config, { fetch, now: () => now, onSearch: (i) => logs.push(i) });
    const first = await client.search('Jay Chou');
    now += 599_999;
    const second = await client.search('ｊａｙ　ＣＨＯＵ');
    const third = await client.search(' jaychou ');
    expect(urls).toHaveLength(1);
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(client.cacheSize()).toBe(1);
    expect(logs.map((l) => l.cached)).toEqual([false, true, true]);
    expect(logs[0]).toMatchObject({ artist: 'Jay Chou', count: 27 });
  });

  it('過期（≥ cacheMs）後重打', async () => {
    const { fetch, urls } = fakeFetch(fixtureBody('孫燕姿'));
    let now = 0;
    const client = createItunesClient(config, { fetch, now: () => now });
    await client.search('孫燕姿');
    now = 600_000;
    await client.search('孫燕姿');
    expect(urls).toHaveLength(2);
    now += 1;
    await client.search('孫燕姿');
    expect(urls).toHaveLength(2);
  });

  it('不同歌手各打一次；寫入時清掉過期項目', async () => {
    const { fetch, urls } = fakeFetch('{"resultCount":0,"results":[]}');
    let now = 0;
    const client = createItunesClient(config, { fetch, now: () => now });
    await client.search('A');
    await client.search('B');
    expect(urls).toHaveLength(2);
    expect(client.cacheSize()).toBe(2);
    now = 700_000;
    await client.search('C');
    expect(client.cacheSize()).toBe(1);
  });

  it('查無（0 筆）也快取', async () => {
    const { fetch, urls } = fakeFetch('{"resultCount":0,"results":[]}');
    const client = createItunesClient(config, { fetch, now: () => 0 });
    expect(await client.search('沒有這個人')).toEqual([]);
    expect(await client.search('沒有這個人')).toEqual([]);
    expect(urls).toHaveLength(1);
  });

  it('失敗不快取：下一次重打', async () => {
    let fail = true;
    let calls = 0;
    const fetch: FetchLike = () => {
      calls++;
      return Promise.resolve({ ok: !fail, status: fail ? 500 : 200, text: () => Promise.resolve(fixtureBody('孫燕姿')) });
    };
    const logs: SearchLogInfo[] = [];
    const client = createItunesClient(config, { fetch, now: () => 0, onSearch: (i) => logs.push(i) });
    await expect(client.search('孫燕姿')).rejects.toBeInstanceOf(ItunesSearchError);
    expect(client.cacheSize()).toBe(0);
    fail = false;
    expect(await client.search('孫燕姿')).toHaveLength(27);
    expect(calls).toBe(2);
    expect(logs[0]).toMatchObject({ artist: '孫燕姿', cached: false, reason: 'HTTP 500' });
    expect(logs[1]).toMatchObject({ cached: false, count: 27 });
  });

  it('同一歌手的搜尋進行中又來一次 → 共用同一次請求', async () => {
    let release: (() => void) | undefined;
    let calls = 0;
    const fetch: FetchLike = () => {
      calls++;
      return new Promise((resolve) => {
        release = () => resolve({ ok: true, status: 200, text: () => Promise.resolve(fixtureBody('孫燕姿')) });
      });
    };
    const client = createItunesClient(config, { fetch, now: () => 0 });
    const a = client.search('孫燕姿');
    const b = client.search('孫 燕 姿');
    expect(calls).toBe(1);
    release?.();
    expect(await a).toBe(await b);
  });

  it('cacheMs 為 0 → 不快取', async () => {
    const { fetch, urls } = fakeFetch(fixtureBody('孫燕姿'));
    const client = createItunesClient({ ...config, cacheMs: 0 }, { fetch, now: () => 0 });
    await client.search('孫燕姿');
    await client.search('孫燕姿');
    expect(urls).toHaveLength(2);
    expect(client.cacheSize()).toBe(0);
  });
});

describe('readSongGuessConfig：§3 環境變數', () => {
  it('未設 → 預設值（SONG_PREVIEW_CAP_MS 未設用 shared 的 PREVIEW_CAP_MS）', () => {
    const warn = vi.fn();
    expect(readSongGuessConfig({}, warn)).toEqual({
      url: 'https://itunes.apple.com',
      country: 'TW',
      timeoutMs: 8000,
      cacheMs: 600_000,
      previewCapMs: PREVIEW_CAP_MS,
    });
    expect(DEFAULT_ITUNES_CONFIG.previewCapMs).toBe(30000);
    expect(warn).not.toHaveBeenCalled();
  });

  it('有設 → 採用（網址去掉結尾斜線、區域轉大寫）', () => {
    const warn = vi.fn();
    expect(
      readSongGuessConfig(
        { ITUNES_URL: ' http://127.0.0.1:11535/ ', ITUNES_COUNTRY: 'jp', ITUNES_TIMEOUT_MS: '500', ITUNES_CACHE_MS: '0', SONG_PREVIEW_CAP_MS: '2000' },
        warn,
      ),
    ).toEqual({ url: 'http://127.0.0.1:11535', country: 'JP', timeoutMs: 500, cacheMs: 0, previewCapMs: 2000 });
    expect(warn).not.toHaveBeenCalled();
  });

  it('不合法 → 預設值並 warn', () => {
    const warn = vi.fn();
    const config = readSongGuessConfig(
      { ITUNES_URL: 'itunes.apple.com', ITUNES_COUNTRY: 'Taiwan', ITUNES_TIMEOUT_MS: '0', ITUNES_CACHE_MS: '-1', SONG_PREVIEW_CAP_MS: 'abc' },
      warn,
    );
    expect(config).toEqual({ url: 'https://itunes.apple.com', country: 'TW', timeoutMs: 8000, cacheMs: 600_000, previewCapMs: 30000 });
    expect(warn.mock.calls.map((c) => (c[1] as { name: string }).name)).toEqual([
      'ITUNES_URL',
      'ITUNES_COUNTRY',
      'ITUNES_TIMEOUT_MS',
      'ITUNES_CACHE_MS',
      'SONG_PREVIEW_CAP_MS',
    ]);
  });

  it('空字串視為未設', () => {
    const warn = vi.fn();
    expect(readSongGuessConfig({ ITUNES_URL: '', ITUNES_COUNTRY: ' ', ITUNES_TIMEOUT_MS: '' }, warn).url).toBe('https://itunes.apple.com');
    expect(warn).not.toHaveBeenCalled();
  });
});
