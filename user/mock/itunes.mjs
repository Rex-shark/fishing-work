#!/usr/bin/env node
// 假的 iTunes Search API ＋ 排行榜 RSS（猜歌協定測試與離線開發用）：spec/song-guess/architecture.md §6「假 iTunes」
//
// 實作四個端點，回應形狀與真 iTunes 相同（2026-10-12 以 https://itunes.apple.com/search 台灣區實測；只留本專案用到的欄位；
// 排行榜與 lookup 為 2026-10-16 Epic 18 加入，形狀照 rss.marketingtools.apple.com 與 itunes.apple.com/lookup 實測）：
//   GET /search?term=<歌手>&attribute=artistTerm&country=TW&media=music&entity=song&limit=200
//       → 200 text/javascript; charset=utf-8 { resultCount, results: [{ wrapperType, kind, trackId, artistName, collectionName,
//         trackName, trackViewUrl, previewUrl, artworkUrl100, trackTimeMillis }] }
//       只看 term（其餘參數照收不驗）；比對方式：NFKC、小寫、去空白後完全相同。查無 → 200 { resultCount: 0, results: [] }（真 iTunes 也是）。
//   GET /api/v2/<國家>/music/most-played/<n>/songs.json（Epic 18；server 的 ITUNES_RSS_URL 指到本服務）
//       → 200 application/json { feed: { title, id, author, links, copyright, country, icon, updated, results: [{ artistName, id（字串）,
//         name, releaseDate, kind: 'songs', artistId, artistUrl, artworkUrl100, genres, url }] } }（同真 RSS：沒有 previewUrl、trackTimeMillis）
//       國家只有 tw（12 首中英混合）與 us（12 首西洋）；其他國家 404。<n> 取前 n 首。
//   GET /lookup?id=<逗號分隔>&country=TW（Epic 18）→ 200 text/javascript { resultCount, results }：依 id 回與 /search 同形的資料
//       （榜單歌與所有歌手的歌都查得到；查不到的 id 略過，同真 lookup）；previewUrl 指回本服務。
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
//   熱門歌手       60 筆，歌名「熱門第n首」依 n 排列（trackId＝1700＋n，n 即 iTunes 回傳的名次）→ 測「只抽熱門歌」（Epic 18）：
//                  hot 時只會抽到第 1～30 首，不勾可抽到第 31 首之後
//   anime／アニメ／動漫（Epic 19，動漫熱門的三個關鍵字；MOCK_ANIME）：各回一份固定清單（10／9／9 筆，三份有交集），
//                  共 18 首（trackId 2301～2318，依 MOCK_ANIME.tracks 的順序）。合併去重、排除後**可抽 14 首（2301～2314）**；
//                  不可抽的 4 首：2315 Call of Silence（專輯「…オリジナルサウンドトラック」，原聲帶）、
//                  2316 紅蓮華 (Cover)（翻唱）、2317 Departure!（專輯「… Original Soundtrack」，原聲帶）、
//                  2318 紅蓮華（LiSA 另一張專輯的同名歌：與 2301 同歌手同歌名，合併排名較後 → 去重掉）。
//                  2314「LOST IN PARADISE (feat. AKLO)」標題含 LOST：OST 以單字邊界比對，不可誤殺（可抽）。
//   其他任何 term  查無（resultCount 0）
// 排行榜（MOCK_CHARTS，Epic 18）：tw 12 首（中文、韓團、英文混合；trackId 2101～2112）、us 12 首西洋（trackId 2201～2212），
//   依名次排列；歌名、歌手、歌手＋歌名皆不重複（去重後 12 首都可抽）。
// trackTimeMillis 一律是 MOCK_ITUNES_TRACK_MS（預設 2000）：server 的 durationMs = min(trackTimeMillis, 上限)，協定測試靠這個縮時，
// 不必替 server 加縮時用的環境變數。previewUrl 指回本服務的 /preview/<trackId>.m4a（網址不含歌名）。
//
// 用法（專案根目錄）：
//   node user/mock/itunes.mjs                                   # 預設 127.0.0.1:11535
//   MOCK_ITUNES_PORT=11535 MOCK_ITUNES_DELAY_MS=300 node user/mock/itunes.mjs
//   MOCK_ITUNES_FAIL=1 node user/mock/itunes.mjs                # /search 一律回 500
//   MOCK_ITUNES_CHART_FAIL=1 node user/mock/itunes.mjs          # 排行榜 RSS 一律回 500（→ CHART_FAILED）
//   MOCK_ITUNES_LOOKUP_FAIL=1 node user/mock/itunes.mjs         # /lookup 一律回 500（→ CHART_FAILED）
//   MOCK_ITUNES_FAIL_TERM=アニメ node user/mock/itunes.mjs       # 只有 term＝アニメ 的 /search 回 500（動漫熱門 → CHART_FAILED；Epic 19）
//   ITUNES_URL=http://127.0.0.1:11535 ITUNES_RSS_URL=http://127.0.0.1:11535 HOST=127.0.0.1 PORT=3411 node server/dist/index.js
//                                                               # server 的搜尋、lookup 與排行榜都指向假 iTunes
// 環境變數：MOCK_ITUNES_PORT（預設 11535）、MOCK_ITUNES_HOST（預設 127.0.0.1）、
//           MOCK_ITUNES_DELAY_MS（每次 /search、排行榜、/lookup 回應前的延遲，預設 0）、MOCK_ITUNES_FAIL=1（/search 一律回 500）、
//           MOCK_ITUNES_CHART_FAIL=1（排行榜 RSS 一律回 500）、MOCK_ITUNES_LOOKUP_FAIL=1（/lookup 一律回 500）、
//           MOCK_ITUNES_FAIL_TERM=<關鍵字>（只有該 term 的 /search 回 500，比對方式同 term；Epic 19）、
//           MOCK_ITUNES_TRACK_MS（每首的 trackTimeMillis，預設 2000；想在瀏覽器聽久一點可設 30000 以上，server 會夾在 30 秒）、
//           MOCK_ITUNES_SLOW_MS（「慢慢來樂團」額外的延遲，預設 1500）、
//           MOCK_ITUNES_PUBLIC_URL（previewUrl 的根網址；預設用請求的 Host 標頭。要讓區網另一台電腦的瀏覽器也播得到時設成 http://<本機 IP>:<埠>，並把 MOCK_ITUNES_HOST 設 0.0.0.0）。
// 也可在程式內 import { startMockItunes } 啟動（測試用，回傳 { url, port, close, requests }）；
// 選項 chartFail、lookupFail、failTerm 對應上面三個環境變數。
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
  {
    name: '熱門歌手',
    aliases: ['熱門歌手'],
    idBase: 1700,
    // 60 首、歌名帶名次：熱門第1首…熱門第60首（iTunes 回傳順序＝熱門度；Epic 18 的「只抽熱門歌」取前 30）
    tracks: Array.from({ length: 60 }, (_, i) => [`熱門第${i + 1}首`, '熱門歌手', `熱門精選${Math.floor(i / 10) + 1}`]),
  },
];

/** 排行榜（Epic 18）：國家 → { idBase, title, tracks: [歌名, artistName, 專輯] }（依名次） */
export const MOCK_CHARTS = {
  tw: {
    idBase: 2100,
    title: 'Top Songs',
    tracks: [
      ['擱淺', '周杰倫', '七里香'],
      ['NEON', 'A2O & A2O LITE', 'NEON - Single'],
      ['我不難過', '孫燕姿', '未完成'],
      ['Supernova', 'aespa', 'Armageddon - The 1st Album'],
      ['要去什麼地方', '田馥甄', '要去什麼地方 - Single'],
      ['APT.', 'ROSÉ & Bruno Mars', 'APT. - Single'],
      ['太陽與地球', '盧廣仲', '太陽與地球 - Single'],
      ['Whiplash', 'aespa', 'Whiplash - The 5th Mini Album'],
      ['自由的你', '鄧紫棋', '自由的你 - Single'],
      ['Drowning', 'WOODZ', 'OO-LI'],
      ['海嶼你', '馬也_Crabbit & Cole先生', '海嶼你 - Single'],
      ['Dynamite', 'BTS', 'Dynamite (DayTime Version) - EP'],
    ],
  },
  us: {
    idBase: 2200,
    title: 'Top Songs',
    tracks: [
      ["Choosin' Texas", 'Ella Langley', "Choosin' Texas - Single"],
      ['Quebec', 'Drake', 'ICEMAN'],
      ['Patient Zero', 'Taylor Swift', 'The Life of a Showgirl'],
      ['stupid song', 'Olivia Rodrigo', 'OR3'],
      ['Wicked Games', 'The Weeknd', 'House Of Balloons'],
      ['Been By Now', 'Morgan Wallen', 'Been By Now - Single'],
      ['Espresso', 'Sabrina Carpenter', "Short n' Sweet"],
      ['BIRDS OF A FEATHER', 'Billie Eilish', 'HIT ME HARD AND SOFT'],
      ['Die With A Smile', 'Lady Gaga & Bruno Mars', 'Die With A Smile - Single'],
      ['luther', 'Kendrick Lamar & SZA', 'GNX'],
      ['A Bar Song (Tipsy)', 'Shaboozey', 'Where I\'ve Been, Isn\'t Where I\'m Going'],
      ['Good Luck, Babe!', 'Chappell Roan', 'Good Luck, Babe! - Single'],
    ],
  },
};

/**
 * 動漫熱門（Epic 19）：三個關鍵字的固定清單。tracks 為 [歌名, artistName, 專輯]（trackId＝idBase＋索引＋1）；
 * lists 為各關鍵字回傳的 tracks 索引（依回傳順序＝熱門度）。可抽／不可抽的推算見檔頭。
 */
export const MOCK_ANIME = {
  idBase: 2300,
  tracks: [
    ['紅蓮華', 'LiSA', '紅蓮華 - EP'], //                                           0 → 2301
    ['残響散歌', 'Aimer', '残響散歌 / 朝が来る - EP'], //                            1 → 2302
    ['怪物', 'YOASOBI', '怪物 - Single'], //                                         2 → 2303
    ['祝福', 'YOASOBI', '祝福 - Single'], //                                         3 → 2304
    ['SPECIALZ', 'King Gnu', 'SPECIALZ - Single'], //                                4 → 2305
    ['One Last Kiss', '宇多田光', 'One Last Kiss'], //                               5 → 2306
    ['打上花火', 'DAOKO × 米津玄師', '打上花火 - Single'], //                       6 → 2307
    ['Cry Baby', 'Official髭男dism', 'Cry Baby - Single'], //                       7 → 2308
    ['アイドル', 'YOASOBI', 'アイドル - Single'], //                                 8 → 2309
    ['青のすみか', 'キタニタツヤ', '青のすみか - Single'], //                       9 → 2310
    ['KICK BACK', '米津玄師', 'KICK BACK - Single'], //                             10 → 2311
    ['Mixed Nuts', 'Official髭男dism', 'Mixed Nuts - EP'], //                       11 → 2312
    ['炎', 'LiSA', '炎 - Single'], //                                               12 → 2313
    ['LOST IN PARADISE (feat. AKLO)', 'ALI', 'LOST IN PARADISE - EP'], //           13 → 2314（OST 不可誤殺）
    ['Call of Silence', '澤野弘之', 'TVアニメ「進撃の巨人」Season 2 オリジナルサウンドトラック'], // 14 → 2315（原聲帶）
    ['紅蓮華 (Cover)', '歌ってみた太郎', 'アニソン歌ってみた Vol.1'], //             15 → 2316（翻唱）
    ['Departure!', '平野義久', 'HUNTER×HUNTER Original Soundtrack'], //             16 → 2317（原聲帶）
    ['紅蓮華', 'LiSA', 'LEO-NiNE'], //                                              17 → 2318（與 2301 重複 → 去重）
  ],
  lists: {
    anime: [1, 5, 2, 0, 4, 14, 6, 13, 10, 7],
    アニメ: [14, 0, 3, 15, 8, 1, 9, 16, 12],
    動漫: [0, 3, 2, 17, 11, 5, 9, 15, 4],
  },
};

/** 一律回 500 的歌手（term 正規化後相同） */
export const MOCK_FAILING_ARTIST = '壞掉樂團';

const TONE_M4A_BASE64 =
  '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';

/** term 的比對鍵：NFKC、小寫、去空白（與 server 的快取鍵相同的正規化） */
function termKey(s) {
  return String(s).normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
}

/** 一首歌的 search／lookup 結果（iTunes 的欄位形狀） */
function trackResult(trackId, [trackName, artistName, collectionName], publicUrl, trackMs) {
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
}

/** 組出某位歌手的 results（iTunes 的欄位形狀） */
function resultsFor(artist, publicUrl, trackMs) {
  return artist.tracks.map((t, i) => trackResult(artist.idBase + i + 1, t, publicUrl, trackMs));
}

/** trackId → [歌名, artistName, 專輯]：所有歌手的歌、兩個榜單與動漫熱門（lookup 用） */
const TRACK_BY_ID = new Map();
for (const group of [...MOCK_ARTISTS, ...Object.values(MOCK_CHARTS), MOCK_ANIME]) {
  group.tracks.forEach((t, i) => TRACK_BY_ID.set(group.idBase + i + 1, t));
}

/** 動漫熱門某個關鍵字的 results（term 正規化後比對；不是三個關鍵字之一回 null） */
function animeResultsFor(key, publicUrl, trackMs) {
  const entry = Object.entries(MOCK_ANIME.lists).find(([term]) => termKey(term) === key);
  if (entry === undefined) return null;
  return entry[1].map((i) => trackResult(MOCK_ANIME.idBase + i + 1, MOCK_ANIME.tracks[i], publicUrl, trackMs));
}

/** 排行榜 RSS 的 feed（形狀同 rss.marketingtools.apple.com；沒有 previewUrl、trackTimeMillis） */
function chartFeed(country, n, publicUrl) {
  const chart = MOCK_CHARTS[country];
  const results = chart.tracks.slice(0, n).map(([name, artistName], i) => {
    const id = String(chart.idBase + i + 1);
    return {
      artistName,
      id,
      name,
      releaseDate: '2026-10-16',
      kind: 'songs',
      artistId: String(9000 + chart.idBase + i + 1),
      artistUrl: `${publicUrl}/artist/${id}`,
      artworkUrl100: `${publicUrl}/artwork/${id}/100x100bb.jpg`,
      genres: [{ genreId: '14', name: 'Pop', url: `${publicUrl}/genre/id14` }],
      url: `${publicUrl}/track/${id}`,
    };
  });
  return {
    feed: {
      title: chart.title,
      id: `${publicUrl}/api/v2/${country}/music/most-played/${n}/songs.json`,
      author: { name: 'Apple', url: 'https://www.apple.com/' },
      links: [{ self: `${publicUrl}/api/v2/${country}/music/most-played/${n}/songs.json` }],
      copyright: 'mock',
      country,
      icon: `${publicUrl}/favicon.ico`,
      updated: '2026-10-16T00:00:00Z',
      results,
    },
  };
}

const CHART_PATH = /^\/api\/v2\/([a-z]{2})\/music\/most-played\/(\d+)\/songs\.json$/;

function sendJson(res, status, obj, contentType = 'text/javascript; charset=utf-8') {
  const text = JSON.stringify(obj);
  // 真 iTunes 回 text/javascript 但內容是 JSON（RSS 回 application/json）
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(text),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(text);
}

/**
 * 啟動假 iTunes。
 * @param {{ port?: number, host?: string, delayMs?: number, fail?: boolean, chartFail?: boolean, lookupFail?: boolean, failTerm?: string, trackMs?: number, slowMs?: number, publicUrl?: string }} [options]
 *   delayMs：每次 /search、排行榜、/lookup 回應前的延遲；fail：/search 一律回 500；chartFail：排行榜 RSS 一律回 500；
 *   lookupFail：/lookup 一律回 500；failTerm：只有該 term（正規化後相同）的 /search 回 500（Epic 19）；trackMs：每首的 trackTimeMillis；
 *   slowMs：「慢慢來樂團」額外的延遲；publicUrl：previewUrl 的根網址（預設用請求的 Host 標頭）
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void>, requests: Array<{ method: string, path: string, term?: string, query?: Record<string, string>, country?: string, ids?: string[] }> }>}
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
        if (options.fail || key === termKey(MOCK_FAILING_ARTIST) || (options.failTerm !== undefined && key === termKey(options.failTerm))) {
          sendJson(res, 500, { errorMessage: 'mock iTunes: internal error' });
          return;
        }
        const results = artist ? resultsFor(artist, publicUrl, trackMs) : (animeResultsFor(key, publicUrl, trackMs) ?? []);
        sendJson(res, 200, { resultCount: results.length, results });
      };
      const wait = delayMs + (artist?.slow ? slowMs : 0);
      if (wait > 0) setTimeout(reply, wait);
      else reply();
      return;
    }
    const publicUrlOf = () => (options.publicUrl ?? `http://${req.headers.host ?? `${host}:${server.address().port}`}`).replace(/\/+$/, '');
    const later = (reply) => {
      const run = () => {
        if (!res.destroyed) reply();
      };
      if (delayMs > 0) setTimeout(run, delayMs);
      else run();
    };
    const chartMatch = CHART_PATH.exec(path);
    if (chartMatch) {
      const [, country, n] = chartMatch;
      requests.push({ method: req.method, path, country, query: Object.fromEntries(url.searchParams) });
      const publicUrl = publicUrlOf();
      later(() => {
        if (options.chartFail) sendJson(res, 500, { errorMessage: 'mock RSS: internal error' }, 'application/json');
        else if (!(country in MOCK_CHARTS)) sendJson(res, 404, { errors: [{ status: '404', title: 'Not Found' }] }, 'application/json');
        else sendJson(res, 200, chartFeed(country, Number(n), publicUrl), 'application/json');
      });
      return;
    }
    if (path === '/lookup') {
      const ids = (url.searchParams.get('id') ?? '').split(',').filter((x) => x !== '');
      requests.push({ method: req.method, path, ids, query: Object.fromEntries(url.searchParams) });
      const publicUrl = publicUrlOf();
      later(() => {
        if (options.lookupFail) {
          sendJson(res, 500, { errorMessage: 'mock iTunes lookup: internal error' });
          return;
        }
        const results = [];
        for (const id of ids) {
          const t = /^\d+$/.test(id) ? TRACK_BY_ID.get(Number(id)) : undefined;
          if (t !== undefined) results.push(trackResult(Number(id), t, publicUrl, trackMs));
        }
        sendJson(res, 200, { resultCount: results.length, results });
      });
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
  const chartFail = process.env.MOCK_ITUNES_CHART_FAIL === '1';
  const lookupFail = process.env.MOCK_ITUNES_LOOKUP_FAIL === '1';
  const failTerm = process.env.MOCK_ITUNES_FAIL_TERM ? process.env.MOCK_ITUNES_FAIL_TERM : undefined;
  const mock = await startMockItunes({
    port: num('MOCK_ITUNES_PORT', 11535),
    host: process.env.MOCK_ITUNES_HOST ?? '127.0.0.1',
    delayMs,
    fail,
    chartFail,
    lookupFail,
    failTerm,
    trackMs,
    slowMs: num('MOCK_ITUNES_SLOW_MS', 1500),
    ...(process.env.MOCK_ITUNES_PUBLIC_URL ? { publicUrl: process.env.MOCK_ITUNES_PUBLIC_URL } : {}),
  });
  console.log(
    `假 iTunes 已啟動：${mock.url}（delay ${delayMs} ms、trackTimeMillis ${trackMs}${fail ? '、/search 一律回 500' : ''}` +
      `${chartFail ? '、排行榜一律回 500' : ''}${lookupFail ? '、/lookup 一律回 500' : ''}${failTerm ? `、term＝${failTerm} 回 500` : ''}）`,
  );
  const stop = () => mock.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
