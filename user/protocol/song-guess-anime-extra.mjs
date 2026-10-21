// 猜歌「動漫熱門」補充協定測試（Epic 19 驗收補驗）：只依 spec/song-guess/architecture.md §3／§5／§5.3／§6 打 Socket，
// 不 import server 內部程式。**假 iTunes 由本檔在程序內啟動**（import user/mock/itunes.mjs 的 startMockItunes），
// 才能讀它收到的請求（requests），驗「三次搜尋並行、不帶 attribute」「快取」「歌手模式填 anime 不命中動漫快取」。
// 涵蓋（與 song-guess-anime.mjs 互補）：
//   (a) MOCK_ITUNES_FAIL_TERM=アニメ 的假 iTunes：只有動漫熱門 CHART_FAILED（文案「取得題庫失敗，請再試一次」）、仍在 choosing、
//       同一出題者改選台灣熱門仍可開局；三個關鍵字的搜尋**並行**送出（回應延遲 0.8 秒時，三個請求都在 0.8 秒內到達）、不帶 attribute
//   (b) 動漫熱門取歌進行中再送歌手模式 → SEARCH_BUSY（文案）
//   (c) 五個全新 server 各開一局動漫熱門（並行）：25 首沒有一首是原聲帶（2315、2317）、Cover（2316）或重複版本（2318）；
//       甲再開第二局：三個關鍵字不再打假 iTunes（以 'anime' 為鍵快取、ITUNES_CACHE_MS 內）
//   (d) 每局 ack { topic: 動漫熱門 }、第 1 首 topic／source、逐首 song.artist ＝ 該首 artistName、ended 的 lastTopic／lastSource
//   (e) 甲動漫快取已暖後，歌手模式填「anime」：走歌手搜尋（假 iTunes 多收到一次 attribute=artistTerm&term=anime 的請求）、
//       結果依假資料無此歌手 → ARTIST_NOT_FOUND；之後再選動漫熱門仍是快取（沒有新的三關鍵字請求）
//
// 用法（專案根目錄，需先 npm run build；隔離埠且只綁本機；**每次都要全新的 server 程序**）。
// 假 iTunes 不必先啟動（本檔會在 127.0.0.1:11593（正常，trackTimeMillis 300）與 11594（アニメ 回 500、延遲 800 ms）啟動；
// server 啟動時不探測 iTunes，先起 server 沒關係）：
//   for p in 3496 3497 3498 3499 3500; do COMMENT=off JUDGE=random HOST=127.0.0.1 PORT=$p ITUNES_URL=http://127.0.0.1:11593 ITUNES_RSS_URL=http://127.0.0.1:11593 node server/dist/index.js & done
//   COMMENT=off JUDGE=random HOST=127.0.0.1 PORT=3490 ITUNES_URL=http://127.0.0.1:11594 ITUNES_RSS_URL=http://127.0.0.1:11593 node server/dist/index.js &
//   TEST_PORTS=3496,3497,3498,3499,3500 TEST_PORT_FAIL=3490 node --input-type=module < user/protocol/song-guess-anime-extra.mjs
// 可用 MOCK_PORT／MOCK_FAIL_PORT 改假 iTunes 的埠（server 的 ITUNES_URL 要跟著改）。一局約 35 秒，甲第二局再 35 秒，總長約 80 秒。
// 全部 PASS 時 exit 0。
//
// 驗收子代理（代架構師）2026-10-20 Epic 19 依 spec 撰寫。
import { io } from 'socket.io-client';
import { startMockItunes } from './user/mock/itunes.mjs';

const PORTS = (process.env.TEST_PORTS ?? '3496,3497,3498,3499,3500').split(',').map((p) => p.trim()).filter(Boolean);
const PORT_FAIL = process.env.TEST_PORT_FAIL ?? '3490';
const MOCK_PORT = Number(process.env.MOCK_PORT ?? 11593);
const MOCK_FAIL_PORT = Number(process.env.MOCK_FAIL_PORT ?? 11594);
const urlOf = (port) => `http://127.0.0.1:${port}/song-guess`;

// ── 常數（spec §4 常數表）──
const SONGS_PER_GAME = 5;
const REVEAL_SECONDS = 5;
const START_DELAY_MS = 1500;
const ANIME_TERMS = ['anime', 'アニメ', '動漫'];
const TOPIC = '動漫熱門';
const TRACK_MS = 300;
const FAIL_DELAY_MS = 800;
/** 假 iTunes 檔頭宣告的不可抽 trackId */
const MOCK_EXCLUDED = ['2315', '2316', '2317', '2318'];

// ── ack.message 文案：§5.3 ──
const MSG = {
  CHART_FAILED: '取得題庫失敗，請再試一次',
  SEARCH_BUSY: '搜尋中，請稍候',
  ARTIST_NOT_FOUND: '找不到這位歌手的歌（至少要 5 首有試聽的歌），換一位試試',
};

const R = [];
const check = (name, cond, extra = '') => R.push([cond ? 'PASS' : 'FAIL', name, cond ? '' : extra]);
const connect = (port) => io(urlOf(port), { path: '/socket.io', transports: ['websocket'], forceNew: true, reconnection: false });
const call = (s, ev, ...args) => new Promise((res) => s.emit(ev, ...args, res));
const once = (s, ev, ms = 4000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), ms); s.once(ev, (...a) => { clearTimeout(t); res(a); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const collect = (s, ev) => { const arr = []; s.on(ev, (p) => arr.push(p)); return arr; };
const until = async (pred, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(15); } return pred(); };
const isErr = (r, code) => r?.ok === false && r.error === code && r.message === MSG[code];
const j = (x) => JSON.stringify(x)?.slice(0, 400);
const sockets = [];
const joinAs = async (port, nick) => {
  const s = connect(port); sockets.push(s); await once(s, 'connect');
  const rounds = collect(s, 'round:update'), chat = collect(s, 'chat:message');
  const r = await call(s, 'player:join', { nickname: nick });
  if (!r?.ok) throw new Error('join failed ' + j(r));
  return { s, id: r.data.snapshot.you, snap: r.data.snapshot, rounds, chat };
};
const lastRound = (p) => p.rounds.at(-1);
const idOf = (round) => /\/preview\/(\d+)\.m4a$/.exec(round?.song?.previewUrl ?? '')?.[1];
const termKey = (s) => String(s).normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
const isAnimeSearch = (q) => q.path === '/search' && ANIME_TERMS.some((t) => termKey(t) === termKey(q.term ?? '')) && q.query?.attribute === undefined;
const animeSearches = (mock) => mock.requests.filter(isAnimeSearch);

/** 等一局走完（已在 playing 第 1 首）：逐首記錄 playing 的 round；回 ended 的 round */
const playGame = async (watcher) => {
  const songs = [];
  for (let i = 1; i <= SONGS_PER_GAME; i++) {
    const per = START_DELAY_MS + TRACK_MS + REVEAL_SECONDS * 1000 + 4000;
    if (!(await until(() => lastRound(watcher)?.phase === 'playing' && lastRound(watcher)?.song?.index === i, per))) throw new Error(`等不到第 ${i} 首 playing：${j(lastRound(watcher))}`);
    songs.push(lastRound(watcher));
    if (!(await until(() => lastRound(watcher)?.phase === 'reveal' && lastRound(watcher)?.reveal?.index === i, per))) throw new Error(`等不到第 ${i} 首 reveal`);
    songs[i - 1].revealed = lastRound(watcher).reveal;
  }
  if (!(await until(() => lastRound(watcher)?.phase === 'ended', REVEAL_SECONDS * 1000 + 4000))) throw new Error('等不到 ended');
  return { songs, ended: lastRound(watcher) };
};

let mock, mockFail;
try {
  mock = await startMockItunes({ port: MOCK_PORT, trackMs: TRACK_MS });
  mockFail = await startMockItunes({ port: MOCK_FAIL_PORT, failTerm: 'アニメ', delayMs: FAIL_DELAY_MS });
  /** 裁判：trackId → 假 iTunes 的 track（向正常假 iTunes 查三關鍵字） */
  const catalog = new Map();
  for (const term of ANIME_TERMS) {
    const res = await fetch(`${mock.url}/search?term=${encodeURIComponent(term)}&entity=song&country=TW&media=music&limit=200`);
    for (const t of (await res.json()).results) catalog.set(String(t.trackId), t);
  }
  mock.requests.length = 0; // 以上是裁判自己打的，清掉

  // ════════ (a)(b) 關鍵字壞的 server ════════
  {
    const X = await joinAs(PORT_FAIL, '出題者');
    const Y = await joinAs(PORT_FAIL, '旁觀者');
    if (X.snap.round.gameNo !== 0 || X.snap.players.length !== 1) throw new Error('壞 server 需要全新的程序');
    await call(X.s, 'round:volunteer');
    await until(() => lastRound(Y)?.phase === 'choosing');
    const endsAt = lastRound(Y).endsAt;
    const t0 = Date.now();
    const pending = call(X.s, 'round:setSource', { source: 'anime-hot' });
    // 並行：延遲 0.8 秒回應，三個關鍵字的請求應在第一個回應前就全部到達
    const allArrived = await until(() => mockFail.requests.filter((q) => q.path === '/search').length >= 3, FAIL_DELAY_MS - 100);
    const arrivedMs = Date.now() - t0;
    const searches = mockFail.requests.filter((q) => q.path === '/search');
    check(`(a) 三個關鍵字並行送出：${searches.length} 個 /search 都在 ${arrivedMs} ms 內到達（< 回應延遲 ${FAIL_DELAY_MS} ms）`, allArrived && searches.length === 3, j(searches.map((q) => q.term)));
    check('(a) 三個關鍵字＝anime／アニメ／動漫、不帶 attribute、entity=song、limit=200、country=TW', j(searches.map((q) => q.term).sort()) === j([...ANIME_TERMS].sort()) && searches.every((q) => q.query.attribute === undefined && q.query.entity === 'song' && q.query.limit === '200' && q.query.country === 'TW' && q.query.media === 'music'), j(searches.map((q) => q.query)));
    const busyArtist = await call(X.s, 'round:setSource', { source: 'artist', artist: '孫燕姿', hot: true });
    check('(b) 動漫熱門取歌中送歌手模式 → SEARCH_BUSY「搜尋中，請稍候」', isErr(busyArtist, 'SEARCH_BUSY'), j(busyArtist));
    const f1 = await pending;
    check('(a) アニメ 回 500 → CHART_FAILED「取得題庫失敗，請再試一次」', isErr(f1, 'CHART_FAILED'), j(f1));
    await sleep(100);
    const ch = lastRound(Y);
    check('(a) 失敗後仍在 choosing、setterId 不變、期限不變', ch?.phase === 'choosing' && ch.setterId === X.id && ch.endsAt === endsAt && ch.source === null && ch.topic === null, j(ch));
    const ok = await call(X.s, 'round:setSource', { source: 'tw-hot' });
    check('(a) 同一出題者改選台灣熱門 → ack { topic: 台灣熱門 }（只有動漫熱門失敗）', ok?.ok === true && ok.data?.topic === '台灣熱門', j(ok));
    await until(() => lastRound(Y)?.phase === 'playing');
    check('(a) 台灣熱門開局：source tw-hot、topic 台灣熱門、gameNo 1', lastRound(Y)?.phase === 'playing' && lastRound(Y).source === 'tw-hot' && lastRound(Y).topic === '台灣熱門' && lastRound(Y).gameNo === 1, j(lastRound(Y)));
  }

  // ════════ (c)(d) 五個 server 各一局（並行）════════
  const games = await Promise.all(PORTS.map(async (port, k) => {
    const A = await joinAs(port, `甲${k + 1}`);
    if (A.snap.round.gameNo !== 0 || A.snap.players.length !== 1) throw new Error(`server ${port} 需要全新的程序`);
    const B = await joinAs(port, `乙${k + 1}`);
    const rv = await call(A.s, 'round:volunteer');
    if (rv?.ok !== true) throw new Error('volunteer 失敗 ' + j(rv));
    const ack = await call(A.s, 'round:setSource', { source: 'anime-hot' });
    await until(() => lastRound(B)?.phase === 'playing');
    const first = lastRound(B);
    const { songs, ended } = await playGame(B);
    return { port, A, B, ack, first, songs, ended };
  }));
  const allIds = [];
  for (const [k, g] of games.entries()) {
    const tag = `(d) 第 ${k + 1} 局（:${g.port}）`;
    check(`${tag}：ack { topic: 動漫熱門 }`, g.ack?.ok === true && g.ack.data?.topic === TOPIC, j(g.ack));
    check(`${tag}：第 1 首 source anime-hot、topic 動漫熱門、artist null、artistHot false`, g.first.source === 'anime-hot' && g.first.topic === TOPIC && g.first.artist === null && g.first.artistHot === false, j(g.first));
    const ids = g.songs.map(idOf);
    allIds.push(...ids);
    check(`${tag}：逐首 song.artist ＝ 該首 artistName、揭曉歌名與裁判一致`, g.songs.every((r) => r.song.artist === catalog.get(idOf(r))?.artistName && r.revealed.title === catalog.get(idOf(r))?.trackName), j(g.songs.map((r) => [idOf(r), r.song.artist])));
    check(`${tag}：系統訊息「甲${k + 1} 出題「動漫熱門」，共 5 首」`, g.B.chat.some((m) => m.kind === 'system' && m.text === `甲${k + 1} 出題「${TOPIC}」，共 ${SONGS_PER_GAME} 首`), j(g.B.chat.filter((m) => m.kind === 'system').map((m) => m.text)));
    check(`${tag}：ended lastTopic 動漫熱門、lastSource anime-hot`, g.ended.phase === 'ended' && g.ended.lastTopic === TOPIC && g.ended.lastSource === 'anime-hot', j([g.ended.lastTopic, g.ended.lastSource]));
  }
  check(`(c) 五局 ${allIds.length} 首：原聲帶（2315、2317）、Cover（2316）、重複版本（2318）一首都沒抽到`, allIds.length === PORTS.length * SONGS_PER_GAME && allIds.every((id) => !MOCK_EXCLUDED.includes(id)), j(allIds));
  check('(c) 五局抽到的歌名／專輯皆不含原聲帶／翻唱關鍵字', allIds.every((id) => { const t = catalog.get(id); return !/soundtrack|サウンドトラック|原聲|cover|カバー/i.test(`${t?.trackName} ${t?.collectionName}`); }), j(allIds.map((id) => catalog.get(id)?.trackName)));
  const perServer = animeSearches(mock).length;
  check(`(c) 五個全新 server 各打三關鍵字一次：假 iTunes 共收到 ${perServer} 次（= ${PORTS.length} × 3）`, perServer === PORTS.length * 3, j(animeSearches(mock).map((q) => q.term)));

  // ════════ (c) 甲第二局：快取 ════════
  {
    const { A, B } = games[0];
    const before = animeSearches(mock).length;
    await call(B.s, 'round:volunteer');
    await until(() => lastRound(A)?.phase === 'choosing');
    const ack = await call(B.s, 'round:setSource', { source: 'anime-hot' });
    await until(() => lastRound(A)?.phase === 'playing');
    check('(c) 甲第二局動漫熱門：ack 成功、gameNo 2', ack?.ok === true && ack.data?.topic === TOPIC && lastRound(A).gameNo === 2, j([ack, lastRound(A)?.gameNo]));
    check('(c) 甲第二局沒有再打三關鍵字（以 anime 為鍵快取）', animeSearches(mock).length === before, j(animeSearches(mock).slice(before).map((q) => q.term)));
    const { songs, ended } = await playGame(A);
    const ids = songs.map(idOf);
    check('(c) 甲第二局 5 首仍無排除項', ids.every((id) => !MOCK_EXCLUDED.includes(id)) && ended.lastSource === 'anime-hot', j(ids));
  }

  // ════════ (e) 歌手模式填 anime 不命中動漫快取 ════════
  {
    const { A, B } = games[0];
    const before = mock.requests.length;
    const beforeAnime = animeSearches(mock).length;
    await call(A.s, 'round:volunteer');
    await until(() => lastRound(B)?.phase === 'choosing');
    const r = await call(A.s, 'round:setSource', { source: 'artist', artist: 'anime', hot: true });
    check('(e) 歌手模式填「anime」→ ARTIST_NOT_FOUND（假資料沒有這位歌手）', isErr(r, 'ARTIST_NOT_FOUND'), j(r));
    const newReqs = mock.requests.slice(before);
    check('(e) 走歌手搜尋：假 iTunes 新收到一次 /search?term=anime&attribute=artistTerm（沒命中動漫快取）', newReqs.length === 1 && newReqs[0].path === '/search' && termKey(newReqs[0].term) === 'anime' && newReqs[0].query.attribute === 'artistTerm', j(newReqs));
    check('(e) 仍在 choosing', lastRound(B)?.phase === 'choosing', j(lastRound(B)?.phase));
    const r2 = await call(A.s, 'round:setSource', { source: 'anime-hot' });
    await until(() => lastRound(B)?.phase === 'playing');
    check('(e) 之後選動漫熱門仍走快取（沒有新的三關鍵字請求）且開局成功', r2?.ok === true && animeSearches(mock).length === beforeAnime && lastRound(B).gameNo === 3, j([r2, animeSearches(mock).length - beforeAnime]));
  }
} catch (err) {
  check('測試流程未預期中斷', false, String(err?.stack ?? err).slice(0, 600));
} finally {
  for (const s of sockets) s.disconnect();
  await mock?.close();
  await mockFail?.close();
}

console.log(R.map((r) => r.join('  ')).join('\n'));
const fails = R.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${R.length - fails}/${R.length} passed`);
process.exit(fails ? 1 : 0);
