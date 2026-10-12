#!/usr/bin/env node
// 假的 iTunes Search API（猜歌協定測試與離線開發用）：spec/song-guess/architecture.md §6「假 iTunes」
//
// 實作兩個端點，回應形狀與真 iTunes 相同（2026-10-12 以 https://itunes.apple.com/search 台灣區實測；只留本專案用到的欄位）：
//   GET /search?term=<歌手>&attribute=artistTerm&country=TW&media=music&entity=song&limit=200
//       → 200 text/javascript; charset=utf-8 { resultCount, results: [{ wrapperType, kind, trackId, artistName, collectionName,
//         trackName, trackViewUrl, previewUrl, artworkUrl100, trackTimeMillis }] }
//       只看 term（其餘參數照收不驗）；比對方式：NFKC、小寫、去空白後完全相同。查無 → 200 { resultCount: 0, results: [] }（真 iTunes 也是）。
//   GET /preview/<trackId>.m4a → 200 audio/mp4（2 秒 440 Hz 單音，約 4 KB，支援瀏覽器 <audio> 直接播；CORS *）。協定測試不驗播放。
//
// 固定的歌手資料（MOCK_ARTISTS；歌名取自真 iTunes 回應，含副標、Live、Remastered、合唱曲，讓去重與答案判定有東西可驗）：
//   孫燕姿        12 筆（去重後 9 首可抽；含別人 feat. 孫燕姿的一筆，會被濾掉）
//   Taylor Swift  11 筆（去重後 9 首可抽）
//   周杰倫／Jay Chou  10 筆（去重後 8 首可抽）；term 打 Jay Chou 回同一份，artistName 仍是「周杰倫」（9／10 過半）→ 測「最多次 artistName 退回」
//   三首樂團       3 筆 → 不足 5 首（ARTIST_NOT_FOUND）
//   客串歌手       12 筆：本人只有 2 首，其餘由「大團甲」「大團乙」各 5 首瓜分（最多的佔 5／12，不過半）
//                  → 不退回、ARTIST_NOT_FOUND（不會出別人的歌）；term 直接打 大團甲 或 大團乙 回同一份，各有 5 首可出題
//   慢慢來樂團     8 筆，但回應前固定多等 MOCK_ITUNES_SLOW_MS（預設 1500 ms）→ 測 SEARCH_BUSY、搜尋中取消
//   壞掉樂團       一律回 500 → 測 SEARCH_FAILED（不必重啟成 MOCK_ITUNES_FAIL=1）
//   其他任何 term  查無（resultCount 0）
// trackTimeMillis 一律是 MOCK_ITUNES_TRACK_MS（預設 2000）：server 的 durationMs = min(trackTimeMillis, 上限)，協定測試靠這個縮時，
// 不必替 server 加縮時用的環境變數。previewUrl 指回本服務的 /preview/<trackId>.m4a（網址不含歌名）。
//
// 用法（專案根目錄）：
//   node user/mock/itunes.mjs                                   # 預設 127.0.0.1:11535
//   MOCK_ITUNES_PORT=11535 MOCK_ITUNES_DELAY_MS=300 node user/mock/itunes.mjs
//   MOCK_ITUNES_FAIL=1 node user/mock/itunes.mjs                # /search 一律回 500
//   ITUNES_URL=http://127.0.0.1:11535 HOST=127.0.0.1 PORT=3411 node server/dist/index.js   # server 指向假 iTunes
// 環境變數：MOCK_ITUNES_PORT（預設 11535）、MOCK_ITUNES_HOST（預設 127.0.0.1）、
//           MOCK_ITUNES_DELAY_MS（每次 /search 回應前的延遲，預設 0）、MOCK_ITUNES_FAIL=1（/search 一律回 500）、
//           MOCK_ITUNES_TRACK_MS（每首的 trackTimeMillis，預設 2000；想在瀏覽器聽久一點可設 30000 以上，server 會夾在 30 秒）、
//           MOCK_ITUNES_SLOW_MS（「慢慢來樂團」額外的延遲，預設 1500）、
//           MOCK_ITUNES_PUBLIC_URL（previewUrl 的根網址；預設用請求的 Host 標頭。要讓區網另一台電腦的瀏覽器也播得到時設成 http://<本機 IP>:<埠>，並把 MOCK_ITUNES_HOST 設 0.0.0.0）。
// 也可在程式內 import { startMockItunes } 啟動（測試用，回傳 { url, port, close, requests }）。
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

/** 歌手資料：aliases 為可查到這位歌手的 term（比對前先正規化）；tracks 為 [歌名, artistName, 專輯] */
export const MOCK_ARTISTS = [
  {
    name: '孫燕姿',
    aliases: ['孫燕姿'],
    idBase: 1100,
    tracks: [
      ['我不難過', '孫燕姿', '未完成'],
      ['開始懂了', '孫燕姿', '風箏'],
      ['我懷念的', '孫燕姿', '逆光'],
      ['遇見', '孫燕姿', 'The Moment'],
      ['綠光', '孫燕姿', '風箏'],
      ['天黑黑', '孫燕姿', '孫燕姿同名專輯'],
      ['天黑黑 (Remastered)', '孫燕姿', '孫燕姿同名專輯 (Remastered)'],
      ['綠光 (Live)', '孫燕姿', 'Start 世界巡迴演唱會'],
      ['逆光', '孫燕姿', '逆光'],
      ['第一天', '孫燕姿', '完美的一天'],
      ['原點', '孫燕姿 & 蔡健雅', '原點 - Single'],
      ['溫柔 #MaydayBlue20th (feat.孫燕姿)', '五月天', '溫柔 #MaydayBlue20th - Single'],
    ],
  },
  {
    name: 'Taylor Swift',
    aliases: ['Taylor Swift'],
    idBase: 1200,
    tracks: [
      ['Cruel Summer', 'Taylor Swift', 'Lover'],
      ['Love Story', 'Taylor Swift', 'Fearless'],
      ['Love Story (Taylor’s Version)', 'Taylor Swift', "Fearless (Taylor's Version)"],
      ['Blank Space', 'Taylor Swift', '1989'],
      ["Blank Space (Taylor's Version)", 'Taylor Swift', "1989 (Taylor's Version)"],
      ['Lover', 'Taylor Swift', 'Lover'],
      ['You Need To Calm Down', 'Taylor Swift', 'Lover'],
      ['Red', 'Taylor Swift', 'Red'],
      ['Look What You Made Me Do', 'Taylor Swift', 'reputation'],
      ['ME! (feat. Brendon Urie of Panic! At The Disco)', 'Taylor Swift', 'Lover'],
      ['I Don’t Wanna Live Forever (Fifty Shades Darker)', 'ZAYN & Taylor Swift', 'Fifty Shades Darker'],
    ],
  },
  {
    name: '周杰倫',
    aliases: ['周杰倫', 'Jay Chou'],
    idBase: 1300,
    tracks: [
      ['擱淺', '周杰倫', '七里香'],
      ['晴天', '周杰倫', '葉惠美'],
      ['晴天 (Live)', '周杰倫', '周杰倫 2004 無與倫比演唱會'],
      ['七里香', '周杰倫', '七里香'],
      ['告白氣球', '周杰倫', '周杰倫的床邊故事'],
      ['簡單愛', '周杰倫', '范特西'],
      ['稻香', '周杰倫', '魔杰座'],
      ['我是如此相信(電影《天火》主題曲)', '周杰倫', '我是如此相信 - Single'],
      ['我是如此相信', '周杰倫', '最偉大的作品'],
      ['說好不哭', '周杰倫 & 五月天 阿信', '說好不哭 - Single'],
    ],
  },
  {
    name: '三首樂團',
    aliases: ['三首樂團'],
    idBase: 1400,
    tracks: [
      ['第一首', '三首樂團', '只有三首'],
      ['第二首', '三首樂團', '只有三首'],
      ['第三首', '三首樂團', '只有三首'],
    ],
  },
  {
    name: '客串歌手',
    aliases: ['客串歌手', '大團甲', '大團乙'],
    idBase: 1600,
    tracks: [
      ['合唱一 (feat. 大團甲)', '客串歌手', '客串精選'],
      ['合唱二 (feat. 大團乙)', '客串歌手', '客串精選'],
      ['甲一', '大團甲', '甲的專輯'],
      ['甲二', '大團甲', '甲的專輯'],
      ['甲三', '大團甲', '甲的專輯'],
      ['甲四', '大團甲', '甲的專輯'],
      ['甲五', '大團甲', '甲的專輯'],
      ['乙一', '大團乙', '乙的專輯'],
      ['乙二', '大團乙', '乙的專輯'],
      ['乙三', '大團乙', '乙的專輯'],
      ['乙四', '大團乙', '乙的專輯'],
      ['乙五', '大團乙', '乙的專輯'],
    ],
  },
  {
    name: '慢慢來樂團',
    aliases: ['慢慢來樂團'],
    idBase: 1500,
    slow: true,
    tracks: [
      ['慢一拍', '慢慢來樂團', '不急'],
      ['等一下', '慢慢來樂團', '不急'],
      ['再五分鐘', '慢慢來樂團', '不急'],
      ['明天再說', '慢慢來樂團', '不急'],
      ['午睡', '慢慢來樂團', '不急'],
      ['散步', '慢慢來樂團', '不急'],
      ['塞車', '慢慢來樂團', '不急'],
      ['排隊', '慢慢來樂團', '不急'],
    ],
  },
];
/** 一律回 500 的歌手（term 正規化後相同） */
export const MOCK_FAILING_ARTIST = '壞掉樂團';

const TONE_M4A_BASE64 =
  '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';

/** term 的比對鍵：NFKC、小寫、去空白（與 server 的快取鍵相同的正規化） */
function termKey(s) {
  return String(s).normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
}

/** 組出某位歌手的 results（iTunes 的欄位形狀） */
function resultsFor(artist, publicUrl, trackMs) {
  return artist.tracks.map(([trackName, artistName, collectionName], i) => {
    const trackId = artist.idBase + i + 1;
    return {
      wrapperType: 'track',
      kind: 'song',
      trackId,
      artistName,
      collectionName,
      trackName,
      trackViewUrl: `${publicUrl}/track/${trackId}`,
      previewUrl: `${publicUrl}/preview/${trackId}.m4a`,
      artworkUrl100: `${publicUrl}/artwork/${trackId}/100x100bb.jpg`,
      trackTimeMillis: trackMs,
    };
  });
}

function sendJson(res, status, obj) {
  const text = JSON.stringify(obj);
  // 真 iTunes 回 text/javascript 但內容是 JSON
  res.writeHead(status, {
    'Content-Type': 'text/javascript; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(text);
}

/**
 * 啟動假 iTunes。
 * @param {{ port?: number, host?: string, delayMs?: number, fail?: boolean, trackMs?: number, slowMs?: number, publicUrl?: string }} [options]
 *   delayMs：每次 /search 回應前的延遲；fail：/search 一律回 500；trackMs：每首的 trackTimeMillis；
 *   slowMs：「慢慢來樂團」額外的延遲；publicUrl：previewUrl 的根網址（預設用請求的 Host 標頭）
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void>, requests: Array<{ method: string, path: string, term?: string, query?: Record<string, string> }> }>}
 */
export function startMockItunes(options = {}) {
  const host = options.host ?? '127.0.0.1';
  const delayMs = options.delayMs ?? 0;
  const trackMs = options.trackMs ?? 2000;
  const slowMs = options.slowMs ?? 1500;
  const tone = Buffer.from(TONE_M4A_BASE64, 'base64');
  const requests = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}`}`);
    const path = url.pathname;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('405 method not allowed');
      return;
    }
    if (path === '/search') {
      const term = url.searchParams.get('term') ?? '';
      requests.push({ method: req.method, path, term, query: Object.fromEntries(url.searchParams) });
      const key = termKey(term);
      const artist = MOCK_ARTISTS.find((a) => a.aliases.some((alias) => termKey(alias) === key));
      const publicUrl = (options.publicUrl ?? `http://${req.headers.host ?? `${host}:${server.address().port}`}`).replace(/\/+$/, '');
      const reply = () => {
        if (res.destroyed) return;
        if (options.fail || key === termKey(MOCK_FAILING_ARTIST)) {
          sendJson(res, 500, { errorMessage: 'mock iTunes: internal error' });
          return;
        }
        const results = artist ? resultsFor(artist, publicUrl, trackMs) : [];
        sendJson(res, 200, { resultCount: results.length, results });
      };
      const wait = delayMs + (artist?.slow ? slowMs : 0);
      if (wait > 0) setTimeout(reply, wait);
      else reply();
      return;
    }
    if (/^\/preview\/\d+\.m4a$/.test(path)) {
      requests.push({ method: req.method, path });
      res.writeHead(200, {
        'Content-Type': 'audio/mp4',
        'Content-Length': tone.length,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      });
      res.end(req.method === 'HEAD' ? undefined : tone);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 not found');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => {
      const { port } = server.address();
      resolve({
        url: `http://${host}:${port}`,
        port,
        requests,
        close: () =>
          new Promise((r) => {
            server.closeAllConnections?.();
            server.close(() => r());
          }),
      });
    });
  });
}

// 直接執行：node user/mock/itunes.mjs
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const num = (name, fallback) => (process.env[name] === undefined || process.env[name] === '' ? fallback : Number(process.env[name]));
  const delayMs = num('MOCK_ITUNES_DELAY_MS', 0);
  const trackMs = num('MOCK_ITUNES_TRACK_MS', 2000);
  const fail = process.env.MOCK_ITUNES_FAIL === '1';
  const mock = await startMockItunes({
    port: num('MOCK_ITUNES_PORT', 11535),
    host: process.env.MOCK_ITUNES_HOST ?? '127.0.0.1',
    delayMs,
    fail,
    trackMs,
    slowMs: num('MOCK_ITUNES_SLOW_MS', 1500),
    ...(process.env.MOCK_ITUNES_PUBLIC_URL ? { publicUrl: process.env.MOCK_ITUNES_PUBLIC_URL } : {}),
  });
  console.log(`假 iTunes 已啟動：${mock.url}（search delay ${delayMs} ms、trackTimeMillis ${trackMs}${fail ? '、一律回 500' : ''}）`);
  const stop = () => mock.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
