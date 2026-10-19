// 猜歌 iTunes 客戶端：spec/song-guess/architecture.md §3（端點、排行榜、環境變數）、§6（search、chart、快取）
// 全部以注入的 fetch、user/mock/itunes.mjs 或連不上的位址測，不打真 iTunes。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHART_SIZE, PREVIEW_CAP_MS } from '@fishing-work/shared/song-guess';
import {
  DEFAULT_ITUNES_CONFIG,
  ItunesChartError,
  ItunesSearchError,
  SEARCH_LIMIT,
  artistKey,
  buildChartUrl,
  buildLookupUrl,
  buildSearchUrl,
  chart,
  createItunesClient,
  parseChartIds,
  parseLookupBody,
  parseSearchBody,
  readSongGuessConfig,
  search,
  type ChartLogInfo,
  type FetchLike,
  type SearchLogInfo,
} from '../src/games/song-guess/itunes';
import { chartFixtureBodies, fixtureBody } from './helpers/songGuess';

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

const BASE = { url: 'https://itunes.example', country: 'TW', rssUrl: 'https://rss.example', timeoutMs: 1000, rssTimeoutMs: 1000 };

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
      rssUrl: 'https://rss.marketingtools.apple.com',
      timeoutMs: 8000,
      rssTimeoutMs: 12_000,
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
        {
          ITUNES_URL: ' http://127.0.0.1:11535/ ',
          ITUNES_COUNTRY: 'jp',
          ITUNES_RSS_URL: 'http://127.0.0.1:11535//',
          ITUNES_TIMEOUT_MS: '500',
          ITUNES_RSS_TIMEOUT_MS: '15000',
          ITUNES_CACHE_MS: '0',
          SONG_PREVIEW_CAP_MS: '2000',
        },
        warn,
      ),
    ).toEqual({ url: 'http://127.0.0.1:11535', country: 'JP', rssUrl: 'http://127.0.0.1:11535', timeoutMs: 500, rssTimeoutMs: 15000, cacheMs: 0, previewCapMs: 2000 });
    expect(warn).not.toHaveBeenCalled();
  });

  it('不合法 → 預設值並 warn', () => {
    const warn = vi.fn();
    const config = readSongGuessConfig(
      {
        ITUNES_URL: 'itunes.apple.com',
        ITUNES_COUNTRY: 'Taiwan',
        ITUNES_RSS_URL: 'rss.marketingtools.apple.com',
        ITUNES_TIMEOUT_MS: '0',
        ITUNES_RSS_TIMEOUT_MS: '1.5',
        ITUNES_CACHE_MS: '-1',
        SONG_PREVIEW_CAP_MS: 'abc',
      },
      warn,
    );
    expect(config).toEqual({
      url: 'https://itunes.apple.com',
      country: 'TW',
      rssUrl: 'https://rss.marketingtools.apple.com',
      timeoutMs: 8000,
      rssTimeoutMs: 12_000,
      cacheMs: 600_000,
      previewCapMs: 30000,
    });
    expect(warn.mock.calls.map((c) => (c[1] as { name: string }).name)).toEqual([
      'ITUNES_URL',
      'ITUNES_RSS_URL',
      'ITUNES_COUNTRY',
      'ITUNES_TIMEOUT_MS',
      'ITUNES_RSS_TIMEOUT_MS',
      'ITUNES_CACHE_MS',
      'SONG_PREVIEW_CAP_MS',
    ]);
  });

  it('空字串視為未設', () => {
    const warn = vi.fn();
    const config = readSongGuessConfig({ ITUNES_URL: '', ITUNES_COUNTRY: ' ', ITUNES_RSS_URL: ' ', ITUNES_TIMEOUT_MS: '' }, warn);
    expect(config.url).toBe('https://itunes.apple.com');
    expect(config.rssUrl).toBe('https://rss.marketingtools.apple.com');
    expect(readSongGuessConfig({ ITUNES_RSS_TIMEOUT_MS: ' ' }, warn).rssTimeoutMs).toBe(12_000);
    expect(warn).not.toHaveBeenCalled();
  });
});

// ─── Epic 18：排行榜（chart） ───────────────────────────────────────

/** 依網址路由的假 fetch：RSS（/api/v2/…）與 lookup（/lookup?）分別回指定的狀態與本文；記錄每次呼叫的網址 */
function routedFetch(routes: {
  rss?: { status?: number; body: string } | (() => Promise<never>);
  lookup?: { status?: number; body: string } | (() => Promise<never>);
}): { fetch: FetchLike; urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    fetch: (url) => {
      urls.push(url);
      const route = url.includes('/api/v2/') ? routes.rss : routes.lookup;
      if (route === undefined) return Promise.reject(new Error(`沒有路由：${url}`));
      if (typeof route === 'function') return route();
      const status = route.status ?? 200;
      return Promise.resolve({ ok: status >= 200 && status < 300, status, text: () => Promise.resolve(route.body) });
    },
  };
}

const fixtureRoutes = (country: 'tw' | 'us') => {
  const bodies = chartFixtureBodies(country);
  return { rss: { body: bodies.rss }, lookup: { body: bodies.lookup } };
};

describe('chart：網址（§3 排行榜、§6）', () => {
  it('RSS：`${ITUNES_RSS_URL}/api/v2/<國家>/music/most-played/100/songs.json`（根網址去結尾斜線）', () => {
    expect(CHART_SIZE).toBe(100);
    expect(buildChartUrl('tw', 'https://rss.marketingtools.apple.com')).toBe(
      'https://rss.marketingtools.apple.com/api/v2/tw/music/most-played/100/songs.json',
    );
    expect(buildChartUrl('us', 'http://127.0.0.1:9/')).toBe('http://127.0.0.1:9/api/v2/us/music/most-played/100/songs.json');
  });

  it('lookup：`${ITUNES_URL}/lookup?id=<逗號分隔>&country=${ITUNES_COUNTRY}`（逗號不編碼）', () => {
    expect(buildLookupUrl(['1', '22', '333'], { url: 'https://itunes.apple.com/', country: 'TW' })).toBe(
      'https://itunes.apple.com/lookup?id=1,22,333&country=TW',
    );
  });

  it('兩段依序打：先 RSS、再一次 lookup 帶榜上全部 id；lookup 用 ITUNES_COUNTRY 不用榜單國家', async () => {
    const { fetch, urls } = routedFetch(fixtureRoutes('us'));
    await chart('us', { ...BASE, fetch });
    expect(urls).toHaveLength(2);
    expect(urls[0]).toBe('https://rss.example/api/v2/us/music/most-played/100/songs.json');
    const ids = (JSON.parse(chartFixtureBodies('us').rss) as { feed: { results: { id: string }[] } }).feed.results.map((r) => r.id);
    expect(ids).toHaveLength(23);
    expect(urls[1]).toBe(`https://itunes.example/lookup?id=${ids.join(',')}&country=TW`);
  });
});

describe('chart：解析真 Apple 樣本（2026-10-16 擷取）', () => {
  it('tw：20 首、依榜單名次、欄位補齊（previewUrl、trackTimeMillis、專輯、封面、trackViewUrl）', async () => {
    const { fetch } = routedFetch(fixtureRoutes('tw'));
    const tracks = await chart('tw', { ...BASE, fetch });
    const rssIds = (JSON.parse(chartFixtureBodies('tw').rss) as { feed: { results: { id: string }[] } }).feed.results.map((r) => r.id);
    expect(tracks.map((t) => String(t.trackId))).toEqual(rssIds);
    expect(tracks[0]).toMatchObject({
      trackId: 6820428730,
      trackName: 'NEON',
      artistName: 'A2O & A2O LITE',
      collectionName: 'NEON - Single',
      trackTimeMillis: 208000,
    });
    for (const t of tracks) {
      expect(t.previewUrl).toMatch(/^https:\/\/audio-ssl\.itunes\.apple\.com\//);
      expect(t.trackTimeMillis).toBeGreaterThan(0);
      expect(t.trackViewUrl).toMatch(/^https:\/\/music\.apple\.com\/tw\//);
    }
    expect(tracks.map((t) => t.artistName)).toContain('周杰倫');
  });

  it('us：榜上 23 首、台灣商店 lookup 查不到 3 首 → 略過，剩 20 首且順序照榜單', async () => {
    const { fetch } = routedFetch(fixtureRoutes('us'));
    const tracks = await chart('us', { ...BASE, fetch });
    expect(tracks).toHaveLength(20);
    const ids = tracks.map((t) => String(t.trackId));
    for (const missing of ['1440818972', '1244230126', '1471264095']) expect(ids).not.toContain(missing);
    expect(tracks[0]).toMatchObject({ trackName: "Choosin' Texas", artistName: 'Ella Langley' });
  });

  it('lookup 回傳順序被打亂也依榜單名次排；不是 track、沒試聽、id 重複者略過', () => {
    const lookup = JSON.stringify({
      resultCount: 6,
      results: [
        { wrapperType: 'track', kind: 'song', trackId: 3, trackName: '三', artistName: 'C', previewUrl: 'https://p/3.m4a' },
        { wrapperType: 'collection', collectionId: 9, collectionName: '專輯', artistName: 'Z' },
        { wrapperType: 'track', kind: 'song', trackId: 1, trackName: '一', artistName: 'A', previewUrl: 'https://p/1.m4a' },
        { wrapperType: 'track', kind: 'song', trackId: 2, trackName: '二', artistName: 'B' },
        { wrapperType: 'track', kind: 'music-video', trackId: 4, trackName: '四', artistName: 'D', previewUrl: 'https://p/4.m4v' },
        { wrapperType: 'track', kind: 'song', trackId: 1, trackName: '一（重複）', artistName: 'A', previewUrl: 'https://p/1b.m4a' },
      ],
    });
    expect(parseLookupBody(lookup, ['1', '2', '3', '4', '5']).map((t) => t.trackName)).toEqual(['一', '三']);
  });

  it('parseChartIds：字串或數字 id 皆可；非純數字、重複者略過', () => {
    const body = JSON.stringify({ feed: { results: [{ id: '10' }, { id: 20 }, { id: 'abc' }, { id: '10' }, {}, null, { id: '1,2' }] } });
    expect(parseChartIds(body)).toEqual(['10', '20']);
  });
});

describe('chart：失敗一律 CHART_FAILED（ItunesChartError）', () => {
  const cases: [string, Parameters<typeof routedFetch>[0], RegExp][] = [
    ['RSS 非 2xx', { rss: { status: 500, body: '' } }, /^RSS HTTP 500$/],
    ['RSS 不是 JSON', { rss: { body: '<html>' } }, /^RSS 回應不是 JSON$/],
    ['RSS 沒有 feed.results', { rss: { body: '{"feed":{}}' } }, /feed\.results/],
    ['RSS results 為空', { rss: { body: '{"feed":{"results":[]}}' } }, /沒有歌/],
    ['RSS 連不上', { rss: () => Promise.reject(new TypeError('fetch failed')) }, /^RSS 連線失敗/],
    ['lookup 非 2xx', { rss: { body: '{"feed":{"results":[{"id":"1"}]}}' }, lookup: { status: 503, body: '' } }, /^lookup HTTP 503$/],
    ['lookup 不是 JSON', { rss: { body: '{"feed":{"results":[{"id":"1"}]}}' }, lookup: { body: 'oops' } }, /^lookup 回應不是 JSON$/],
    ['lookup 沒有 results', { rss: { body: '{"feed":{"results":[{"id":"1"}]}}' }, lookup: { body: '{}' } }, /results/],
    ['lookup 連不上', { rss: { body: '{"feed":{"results":[{"id":"1"}]}}' }, lookup: () => Promise.reject(new TypeError('fetch failed')) }, /^lookup 連線失敗/],
  ];
  for (const [name, routes, reason] of cases) {
    it(name, async () => {
      const { fetch } = routedFetch(routes);
      const err = await chart('tw', { ...BASE, fetch }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ItunesChartError);
      expect((err as ItunesChartError).code).toBe('CHART_FAILED');
      expect((err as ItunesChartError).reason).toMatch(reason);
    });
  }

  it('RSS 失敗時不打 lookup', async () => {
    const { fetch, urls } = routedFetch({ rss: { status: 500, body: '' }, lookup: { body: '{"results":[]}' } });
    await expect(chart('tw', { ...BASE, fetch })).rejects.toBeInstanceOf(ItunesChartError);
    expect(urls).toHaveLength(1);
  });

  it('兩段各用各的逾時（決策 14）：RSS 用 rssTimeoutMs、lookup 用 timeoutMs；未給 rssTimeoutMs 時 RSS 用 timeoutMs', async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason as Error));
      });
    await expect(chart('tw', { ...BASE, timeoutMs: 20, rssTimeoutMs: 70, fetch: hang })).rejects.toMatchObject({ reason: 'RSS 逾時（70 ms）' });
    const rssOk = fixtureRoutes('tw').rss;
    const lookupHangs: FetchLike = (url, init) =>
      url.includes('/api/v2/') ? Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(rssOk.body) }) : hang(url, init);
    await expect(chart('tw', { ...BASE, timeoutMs: 20, rssTimeoutMs: 70, fetch: lookupHangs })).rejects.toMatchObject({ reason: 'lookup 逾時（20 ms）' });
    const { rssTimeoutMs: _omit, ...noRss } = BASE;
    await expect(chart('tw', { ...noRss, timeoutMs: 25, fetch: hang })).rejects.toMatchObject({ reason: 'RSS 逾時（25 ms）' });
  });

  it('RSS 比 timeoutMs 慢、但在 rssTimeoutMs 內回 → 成功（Apple RSS 偶發 8～15 秒才回）', async () => {
    const ok = fixtureRoutes('tw');
    const slowRss: FetchLike = (url, init) =>
      url.includes('/api/v2/')
        ? new Promise((resolve, reject) => {
            const t = setTimeout(() => resolve({ ok: true, status: 200, text: () => Promise.resolve(ok.rss.body) }), 60);
            init.signal.addEventListener('abort', () => {
              clearTimeout(t);
              reject(init.signal.reason as Error);
            });
          })
        : Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(ok.lookup.body) });
    expect(await chart('tw', { ...BASE, timeoutMs: 30, rssTimeoutMs: 500, fetch: slowRss })).toHaveLength(20);
    // createItunesClient 把 config.rssTimeoutMs 傳到 RSS 段
    const client = createItunesClient({ ...BASE, timeoutMs: 30, rssTimeoutMs: 500, cacheMs: 0 }, { fetch: slowRss, now: () => 0 });
    expect(await client.chart('tw')).toHaveLength(20);
    const strict = createItunesClient({ ...BASE, timeoutMs: 500, rssTimeoutMs: 30, cacheMs: 0 }, { fetch: slowRss, now: () => 0 });
    await expect(strict.chart('tw')).rejects.toMatchObject({ reason: 'RSS 逾時（30 ms）' });
  });

  it('兩段各自逾時（timeoutMs）：RSS 卡住、lookup 卡住都會 CHART_FAILED', async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason as Error));
      });
    await expect(chart('tw', { ...BASE, timeoutMs: 30, rssTimeoutMs: 30, fetch: hang })).rejects.toMatchObject({ reason: 'RSS 逾時（30 ms）' });

    const rssOk = fixtureRoutes('tw').rss;
    const lookupHangs: FetchLike = (url, init) =>
      url.includes('/api/v2/')
        ? Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(rssOk.body) })
        : hang(url, init);
    await expect(chart('tw', { ...BASE, timeoutMs: 30, fetch: lookupHangs })).rejects.toMatchObject({ reason: 'lookup 逾時（30 ms）' });
  });
});

describe('createItunesClient.chart：快取（鍵＝國家）', () => {
  const config = { ...BASE, cacheMs: 600_000 };

  it('同一國家在時效內只打一次（兩段共 2 次請求）；不同國家各打', async () => {
    const tw = routedFetch(fixtureRoutes('tw'));
    let now = 0;
    const logs: ChartLogInfo[] = [];
    const client = createItunesClient(config, { fetch: tw.fetch, now: () => now, onChart: (i) => logs.push(i) });
    const first = await client.chart('tw');
    now = 599_999;
    expect(await client.chart('tw')).toBe(first);
    expect(tw.urls).toHaveLength(2);
    expect(client.chartCacheSize()).toBe(1);
    expect(client.cacheSize()).toBe(0);
    expect(logs.map((l) => l.cached)).toEqual([false, true]);
    expect(logs[0]).toMatchObject({ country: 'tw', count: 20 });
    now = 600_000;
    await client.chart('tw');
    expect(tw.urls).toHaveLength(4);
  });

  it('tw 與 us 分開快取', async () => {
    const urls: string[] = [];
    const fetch: FetchLike = (url, init) => {
      urls.push(url);
      return routedFetch(fixtureRoutes(url.includes('/us/') || url.includes('1844932150') ? 'us' : 'tw')).fetch(url, init);
    };
    const client = createItunesClient(config, { fetch, now: () => 0 });
    const tw = await client.chart('tw');
    const us = await client.chart('us');
    expect(tw[0]?.trackName).toBe('NEON');
    expect(us[0]?.trackName).toBe("Choosin' Texas");
    expect(urls).toHaveLength(4);
    expect(client.chartCacheSize()).toBe(2);
  });

  it('失敗不快取：下一次重打；log 帶原因', async () => {
    let fail = true;
    const ok = fixtureRoutes('tw');
    const urls: string[] = [];
    const fetch: FetchLike = (url) => {
      urls.push(url);
      const body = url.includes('/api/v2/') ? ok.rss.body : ok.lookup.body;
      const status = fail && !url.includes('/api/v2/') ? 500 : 200;
      return Promise.resolve({ ok: status === 200, status, text: () => Promise.resolve(body) });
    };
    const logs: ChartLogInfo[] = [];
    const client = createItunesClient(config, { fetch, now: () => 0, onChart: (i) => logs.push(i) });
    await expect(client.chart('tw')).rejects.toBeInstanceOf(ItunesChartError);
    expect(client.chartCacheSize()).toBe(0);
    fail = false;
    expect(await client.chart('tw')).toHaveLength(20);
    expect(urls).toHaveLength(4);
    expect(logs[0]).toMatchObject({ country: 'tw', cached: false, reason: 'lookup HTTP 500' });
  });

  it('同一國家進行中又來一次 → 共用同一次請求', async () => {
    const ok = fixtureRoutes('tw');
    let release: (() => void) | undefined;
    const urls: string[] = [];
    const fetch: FetchLike = (url) => {
      urls.push(url);
      if (url.includes('/api/v2/')) {
        return new Promise((resolve) => {
          release = () => resolve({ ok: true, status: 200, text: () => Promise.resolve(ok.rss.body) });
        });
      }
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(ok.lookup.body) });
    };
    const client = createItunesClient(config, { fetch, now: () => 0 });
    const a = client.chart('tw');
    const b = client.chart('tw');
    expect(urls).toHaveLength(1);
    release?.();
    expect(await a).toBe(await b);
    expect(urls).toHaveLength(2);
  });

  it('cacheMs 為 0 → 不快取', async () => {
    const { fetch, urls } = routedFetch(fixtureRoutes('tw'));
    const client = createItunesClient({ ...config, cacheMs: 0 }, { fetch, now: () => 0 });
    await client.chart('tw');
    await client.chart('tw');
    expect(urls).toHaveLength(4);
  });
});
