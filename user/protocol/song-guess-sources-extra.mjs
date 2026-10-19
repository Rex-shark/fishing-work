// 猜歌「題庫來源」補驗（Epic 18 驗收）：只依 spec/song-guess/architecture.md §4／§5／§5.3／§7 打 Socket，不看實作、不 import server 內部程式。
// 補 song-guess-sources.mjs 檔頭列為「未涵蓋」的情境，以及驗收範圍點名的檢查順序：
//   - **榜單取歌進行中**（假 iTunes 以 MOCK_ITUNES_DELAY_MS 讓 RSS／lookup 都慢）同一出題者再送歌手模式／另一個榜單 → SEARCH_BUSY；取歌回來仍開局成功
//   - 檢查順序 SOURCE_INVALID → ARTIST_INVALID → SEARCH_BUSY（§5）：取歌進行中送壞 payload 仍是 SOURCE_INVALID、歌手名不合法仍是 ARTIST_INVALID、
//     artist 非字串 → ARTIST_INVALID（§7）；壞 payload 先於 NOT_SETTER（非出題者）與 NOT_IN_ROOM（未加入）（決策 14）
//   - RSS 回 500（乙）與 lookup 回 500（丙）都 → CHART_FAILED、仍在 choosing、期限不變；丙在 lookup 失敗前（RSS 慢）再送歌手 → SEARCH_BUSY；失敗後換歌手模式可開局
//   - 台灣熱門一局：topic／source／artist／artistHot、逐首 song.artist ＝ lookup 的 artistName 且 5 首歌手各不同、揭曉 artist 一致、
//     系統訊息「A 出題「台灣熱門」，共 5 首」、ended 的 lastTopic／lastSource、「本局第一名：B（n 分）」
//   - 西洋熱門一局（沒有人猜）：choosing 時 lastTopic／lastSource 保留上一局、進第 1 首清空、ended 系統訊息恰為「本局結束：沒有人猜對」（§7 三處一致）
//
// 需要三個 server 程序與兩個假 iTunes（**每次都要全新的 server 程序**，房間狀態與榜單快取都在記憶體）：
//   慢的假 iTunes：MOCK_ITUNES_DELAY_MS=1500（RSS、lookup、search 各慢 1.5 秒）、MOCK_ITUNES_TRACK_MS=300（縮短每首）
//   壞的假 iTunes：MOCK_ITUNES_CHART_FAIL=1 MOCK_ITUNES_LOOKUP_FAIL=1（/search 照常）
//   甲（主）：ITUNES_URL、ITUNES_RSS_URL 都指慢的
//   乙（RSS 壞）：ITUNES_RSS_URL 指壞的、ITUNES_URL 指慢的
//   丙（lookup 壞）：ITUNES_URL 指壞的（search 照常）、ITUNES_RSS_URL 指慢的
// 用法（專案根目錄，需先 npm run build；隔離埠且只綁本機）：
//   MOCK_ITUNES_PORT=11581 MOCK_ITUNES_DELAY_MS=1500 MOCK_ITUNES_TRACK_MS=300 node user/mock/itunes.mjs &
//   MOCK_ITUNES_PORT=11582 MOCK_ITUNES_CHART_FAIL=1 MOCK_ITUNES_LOOKUP_FAIL=1 node user/mock/itunes.mjs &
//   COMMENT=off JUDGE=random HOST=127.0.0.1 PORT=3481 ITUNES_URL=http://127.0.0.1:11581 ITUNES_RSS_URL=http://127.0.0.1:11581 node server/dist/index.js &   # 甲
//   COMMENT=off JUDGE=random HOST=127.0.0.1 PORT=3482 ITUNES_URL=http://127.0.0.1:11581 ITUNES_RSS_URL=http://127.0.0.1:11582 node server/dist/index.js &   # 乙
//   COMMENT=off JUDGE=random HOST=127.0.0.1 PORT=3483 ITUNES_URL=http://127.0.0.1:11582 ITUNES_RSS_URL=http://127.0.0.1:11581 node server/dist/index.js &   # 丙
//   TEST_PORT=3481 TEST_PORT_RSS_FAIL=3482 TEST_PORT_LOOKUP_FAIL=3483 MOCK_ITUNES_URL=http://127.0.0.1:11581 node --input-type=module < user/protocol/song-guess-sources-extra.mjs
// 總時長約 90 秒（兩局各 5 首 × (1.5 + 0.3 + 5) 秒＋取歌延遲）；全部 PASS 時 exit 0。
//
// 驗收子代理（代架構師海圖）2026-10-16 依 spec 撰寫。
import { io } from 'socket.io-client';

const PORT = process.env.TEST_PORT ?? '3481';
const PORT_RSS_FAIL = process.env.TEST_PORT_RSS_FAIL ?? '3482';
const PORT_LOOKUP_FAIL = process.env.TEST_PORT_LOOKUP_FAIL ?? '3483';
const MOCK = (process.env.MOCK_ITUNES_URL ?? 'http://127.0.0.1:11581').replace(/\/+$/, '');
const urlOf = (port) => `http://127.0.0.1:${port}/song-guess`;

// ── 常數：.mjs 不能 import .ts，照既有協定測試慣例寫死；出處 spec §4 常數表 ──
const SONGS_PER_GAME = 5;
const REVEAL_SECONDS = 5;
const START_DELAY_MS = 1500;
const ARTIST_MAX = 30;

// ── ack.message 文案：§5.3（其餘同繪圖比賽 §5.4）──
const MSG = {
  SOURCE_INVALID: '題庫來源不正確，請重新選擇',
  CHART_FAILED: '取得排行榜失敗，請再試一次',
  SEARCH_BUSY: '搜尋中，請稍候',
  ARTIST_INVALID: '歌手名稱需為 1～30 個字，不可含控制字元，也不能只有空白',
  NOT_SETTER: '只有本回合的出題者可以這麼做',
  NOT_IN_ROOM: '請先加入房間',
};

// ── 測試框架（同 song-guess-sources.mjs）──
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
  const rounds = collect(s, 'round:update'), players = collect(s, 'players:update'), chat = collect(s, 'chat:message');
  const r = await call(s, 'player:join', { nickname: nick });
  if (!r?.ok) throw new Error('join failed ' + j(r));
  return { s, id: r.data.snapshot.you, snap: r.data.snapshot, rounds, players, chat };
};
const lastRound = (p) => p.rounds.at(-1);
const say = (p, text) => call(p.s, 'chat:send', { text });
const sysTexts = (p, from = 0) => p.chat.slice(from).filter((m) => m.kind === 'system').map((m) => m.text);

// ── 答案判定（依 spec §4 獨立寫一份）──
const stripSubtitle = (title) => {
  const main = title.replace(/[（(【[].*$/su, '').replace(/ - .*$/su, '').replace(/(^|[^a-z])(feat\.|ft\.|featuring(?![a-z])).*$/isu, '$1').trim();
  return main === '' ? title.trim() : main;
};

// ── 裁判：向假 iTunes 查榜單（RSS → lookup，同 spec §3 的兩段；裁判自己查，不經 server）──
const catalog = new Map();
const learnChart = async (country) => {
  const rss = await (await fetch(`${MOCK}/api/v2/${country}/music/most-played/100/songs.json`)).json();
  const ids = rss.feed.results.map((r) => r.id);
  const lookup = await (await fetch(`${MOCK}/lookup?id=${ids.join(',')}&country=TW`)).json();
  for (const t of lookup.results) catalog.set(String(t.trackId), t);
  return { ids, tracks: lookup.results, trackMs: lookup.results[0]?.trackTimeMillis };
};
const idOf = (round) => /\/preview\/(\d+)\.m4a$/.exec(round?.song?.previewUrl ?? '')?.[1];
const trackOf = (round) => {
  const t = catalog.get(idOf(round) ?? '');
  if (!t) throw new Error('查不到答案：' + round?.song?.previewUrl);
  return t;
};

/** 跑完一局（已在 playing 第 1 首）：逐首記錄 playing 與揭曉；guesser 有給時每首都猜對。回 { songs, ended } */
const playGame = async (watcher, songMs, guesser = null) => {
  const songs = [];
  const per = START_DELAY_MS + songMs + REVEAL_SECONDS * 1000 + 6000;
  for (let i = 1; i <= SONGS_PER_GAME; i++) {
    if (!(await until(() => lastRound(watcher)?.phase === 'playing' && lastRound(watcher)?.song?.index === i, per))) throw new Error(`等不到第 ${i} 首 playing：${j(lastRound(watcher))}`);
    const playing = lastRound(watcher);
    if (guesser) {
      await sleep(320);
      const r = await say(guesser, stripSubtitle(trackOf(playing).trackName));
      if (r?.ok !== true) throw new Error(`猜第 ${i} 首失敗：${j(r)}`);
    }
    if (!(await until(() => lastRound(watcher)?.phase === 'reveal' && lastRound(watcher)?.reveal?.index === i, per))) throw new Error(`等不到第 ${i} 首 reveal`);
    songs.push({ playing, reveal: lastRound(watcher).reveal });
  }
  if (!(await until(() => lastRound(watcher)?.phase === 'ended', REVEAL_SECONDS * 1000 + 6000))) throw new Error('等不到 ended');
  return { songs, ended: lastRound(watcher) };
};

try {
  const tw = await learnChart('tw');
  const us = await learnChart('us');
  const songMs = tw.trackMs;
  const twArtists = new Map(tw.tracks.map((t) => [String(t.trackId), t.artistName]));
  const usArtists = new Map(us.tracks.map((t) => [String(t.trackId), t.artistName]));
  check('前置：慢的假 iTunes 台灣榜、美國榜各 12 首且 lookup 都有試聽', tw.tracks.length === 12 && us.tracks.length === 12 && [...tw.tracks, ...us.tracks].every((t) => typeof t.previewUrl === 'string'), j([tw.tracks.length, us.tracks.length]));

  // ───────── 甲：榜單取歌進行中 ＋ 檢查順序 ─────────
  const A = await joinAs(PORT, 'Alice');
  const B = await joinAs(PORT, 'Bob');
  const sysBefore = A.chat.length;
  check('甲：初始快照 source／topic／lastTopic／lastSource 皆 null', [A.snap.round.source, A.snap.round.topic, A.snap.round.lastTopic, A.snap.round.lastSource].every((v) => v === null), j(A.snap.round));

  const rv = await call(A.s, 'round:volunteer');
  await until(() => lastRound(B)?.phase === 'choosing');
  const choosingEndsAt = lastRound(B).endsAt;
  check('甲：volunteer → choosing、A 為出題者', rv?.ok === true && lastRound(B).setterId === A.id, j([rv, lastRound(B)]));

  // 不等 ack：台灣熱門取歌中（RSS 1.5 秒 ＋ lookup 1.5 秒）
  const pTw = call(A.s, 'round:setSource', { source: 'tw-hot' });
  await sleep(150);
  const busyArtist = await call(A.s, 'round:setSource', { source: 'artist', artist: '孫燕姿', hot: true });
  const busyChart = await call(A.s, 'round:setSource', { source: 'western-hot' });
  check('(a) 榜單取歌進行中再送歌手模式 → SEARCH_BUSY（文案）', isErr(busyArtist, 'SEARCH_BUSY'), j(busyArtist));
  check('(a) 榜單取歌進行中再送另一個榜單 → SEARCH_BUSY', isErr(busyChart, 'SEARCH_BUSY'), j(busyChart));

  // 檢查順序：SOURCE_INVALID → ARTIST_INVALID → SEARCH_BUSY（取歌進行中，忙碌最後才看）
  const badShape = await call(A.s, 'round:setSource', { source: 'nope' });
  const hotMissing = await call(A.s, 'round:setSource', { source: 'artist', artist: '孫燕姿' });
  const hotString = await call(A.s, 'round:setSource', { source: 'artist', artist: '孫燕姿', hot: 'yes' });
  const notObject = await call(A.s, 'round:setSource', 'tw-hot');
  const arr = await call(A.s, 'round:setSource', ['tw-hot']);
  check('順序：取歌中送 source 不合法 → SOURCE_INVALID（不是 SEARCH_BUSY）', isErr(badShape, 'SOURCE_INVALID'), j(badShape));
  check('順序：取歌中送歌手模式缺 hot／hot 非 boolean → SOURCE_INVALID', isErr(hotMissing, 'SOURCE_INVALID') && isErr(hotString, 'SOURCE_INVALID'), j([hotMissing, hotString]));
  check('順序：payload 為字串／陣列 → SOURCE_INVALID', isErr(notObject, 'SOURCE_INVALID') && isErr(arr, 'SOURCE_INVALID'), j([notObject, arr]));
  const blank = await call(A.s, 'round:setSource', { source: 'artist', artist: '   ', hot: true });
  const tooLong = await call(A.s, 'round:setSource', { source: 'artist', artist: 'x'.repeat(ARTIST_MAX + 1), hot: true });
  const ctrl = await call(A.s, 'round:setSource', { source: 'artist', artist: '孫\u0007燕姿', hot: true });
  const notString = await call(A.s, 'round:setSource', { source: 'artist', artist: 123, hot: true });
  check('順序：取歌中送歌手名只有空白／過長／含控制字元 → ARTIST_INVALID（不是 SEARCH_BUSY；文案）', isErr(blank, 'ARTIST_INVALID') && isErr(tooLong, 'ARTIST_INVALID') && isErr(ctrl, 'ARTIST_INVALID'), j([blank, tooLong, ctrl]));
  check('順序：歌手模式 artist 非字串 → ARTIST_INVALID（§7）', isErr(notString, 'ARTIST_INVALID'), j(notString));
  // 壞 payload 先於身分檢查（決策 14）
  const bBad = await call(B.s, 'round:setSource', { source: 'nope' });
  const bGood = await call(B.s, 'round:setSource', { source: 'tw-hot' });
  check('非出題者送壞 payload → SOURCE_INVALID（先於 NOT_SETTER）；送合法 payload → NOT_SETTER', isErr(bBad, 'SOURCE_INVALID') && isErr(bGood, 'NOT_SETTER'), j([bBad, bGood]));
  const ghost = connect(PORT); sockets.push(ghost); await once(ghost, 'connect');
  const gBad = await call(ghost, 'round:setSource', { source: 'artist', artist: 'x' });
  const gGood = await call(ghost, 'round:setSource', { source: 'western-hot' });
  check('未加入者送壞 payload → SOURCE_INVALID（先於 NOT_IN_ROOM）；送合法 payload → NOT_IN_ROOM', isErr(gBad, 'SOURCE_INVALID') && isErr(gGood, 'NOT_IN_ROOM'), j([gBad, gGood]));
  check('取歌進行中：仍在 choosing、期限不變、source／topic 仍 null', lastRound(B)?.phase === 'choosing' && lastRound(B).endsAt === choosingEndsAt && lastRound(B).source === null && lastRound(B).topic === null, j(lastRound(B)));

  const okTw = await pTw;
  check('台灣熱門取歌回來 → ack { topic: 台灣熱門 }（取歌中的錯誤都不影響）', okTw?.ok === true && okTw.data?.topic === '台灣熱門', j(okTw));
  await until(() => lastRound(B)?.phase === 'playing' && lastRound(B)?.song?.index === 1);
  const p1 = lastRound(B);
  check('台灣熱門第 1 首：source tw-hot、artist null、artistHot false、topic 台灣熱門、gameNo 1、lastTopic／lastSource／results null', p1?.phase === 'playing' && p1.source === 'tw-hot' && p1.artist === null && p1.artistHot === false && p1.topic === '台灣熱門' && p1.gameNo === 1 && p1.lastTopic === null && p1.lastSource === null && p1.results === null, j(p1));
  check('系統訊息恰為「Alice 出題「台灣熱門」，共 5 首」', sysTexts(A, sysBefore).includes('Alice 出題「台灣熱門」，共 5 首'), j(sysTexts(A, sysBefore)));

  const g1 = await playGame(B, songMs, B);
  const artists1 = g1.songs.map(({ playing }) => playing.song.artist);
  check('台灣熱門：逐首 song.artist ＝ lookup 的 artistName（playing 起就有）', g1.songs.every(({ playing }) => playing.song.artist === twArtists.get(idOf(playing))), j(artists1));
  check('台灣熱門：5 首歌手各不同（榜單模式每首歌手不同）', new Set(artists1).size === 5, j(artists1));
  check('台灣熱門：每首 topic 都是「台灣熱門」、揭曉 artist 與 song.artist 一致、有封面', g1.songs.every(({ playing, reveal }) => playing.topic === '台灣熱門' && reveal.artist === playing.song.artist && typeof reveal.artworkUrl === 'string'), j(g1.songs.map(({ reveal }) => [reveal.artist, reveal.artworkUrl])));
  check('台灣熱門 ended：lastTopic 台灣熱門、lastSource tw-hot、topic／source 仍為本局值、song null', g1.ended.lastTopic === '台灣熱門' && g1.ended.lastSource === 'tw-hot' && g1.ended.topic === '台灣熱門' && g1.ended.source === 'tw-hot' && g1.ended.song === null, j(g1.ended));
  const bScore = g1.ended.results?.find((r) => r.playerId === B.id)?.gameScore;
  check('台灣熱門 ended：系統訊息「本局第一名：Bob（n 分）」', typeof bScore === 'number' && bScore > 0 && sysTexts(A).includes(`本局第一名：Bob（${bScore} 分）`), j(sysTexts(A).slice(-3)));

  // ───────── 甲：西洋熱門一局、沒有人猜 ─────────
  const rv2 = await call(A.s, 'round:volunteer');
  await until(() => lastRound(B)?.phase === 'choosing');
  const ch2 = lastRound(B);
  check('西洋熱門前的 choosing：lastTopic／lastSource／results 保留上一局，source／topic 清為 null', rv2?.ok === true && ch2.lastTopic === '台灣熱門' && ch2.lastSource === 'tw-hot' && ch2.results?.length === 2 && ch2.source === null && ch2.topic === null, j(ch2));
  const sysBefore2 = A.chat.length;
  const okUs = await call(A.s, 'round:setSource', { source: 'western-hot', extra: 'ignored' });
  check('西洋熱門（多帶欄位忽略）→ ack { topic: 西洋熱門 }', okUs?.ok === true && okUs.data?.topic === '西洋熱門', j(okUs));
  await until(() => lastRound(B)?.phase === 'playing' && lastRound(B)?.song?.index === 1);
  const q1 = lastRound(B);
  check('西洋熱門第 1 首：source western-hot、topic 西洋熱門、gameNo 2、lastTopic／lastSource／results 清空', q1.source === 'western-hot' && q1.topic === '西洋熱門' && q1.gameNo === 2 && q1.lastTopic === null && q1.lastSource === null && q1.results === null, j(q1));
  check('系統訊息恰為「Alice 出題「西洋熱門」，共 5 首」', sysTexts(A, sysBefore2).includes('Alice 出題「西洋熱門」，共 5 首'), j(sysTexts(A, sysBefore2)));
  const g2 = await playGame(B, songMs, null);
  check('西洋熱門：逐首 song.artist ＝ lookup 的 artistName、5 首歌手各不同', g2.songs.every(({ playing }) => playing.song.artist === usArtists.get(idOf(playing))) && new Set(g2.songs.map(({ playing }) => playing.song.artist)).size === 5, j(g2.songs.map(({ playing }) => playing.song.artist)));
  check('西洋熱門 ended（沒有人猜）：results 全 0 分、lastTopic 西洋熱門、lastSource western-hot', g2.ended.results?.length === 2 && g2.ended.results.every((r) => r.gameScore === 0 && r.correctCount === 0) && g2.ended.lastTopic === '西洋熱門' && g2.ended.lastSource === 'western-hot', j(g2.ended.results));
  const sys2 = sysTexts(A, sysBefore2);
  check('西洋熱門 ended（沒有人猜）：系統訊息恰為「本局結束：沒有人猜對」、沒有「本局第一名」字樣', sys2.includes('本局結束：沒有人猜對') && !sys2.some((t) => t.startsWith('本局第一名')), j(sys2.slice(-3)));

  // ───────── 乙（RSS 壞）、丙（lookup 壞）：CHART_FAILED ─────────
  for (const [label, port, slowBeforeFail] of [['RSS 壞', PORT_RSS_FAIL, false], ['lookup 壞', PORT_LOOKUP_FAIL, true]]) {
    const X = await joinAs(port, `${label}甲`);
    const Y = await joinAs(port, `${label}乙`);
    await call(X.s, 'round:volunteer');
    await until(() => lastRound(Y)?.phase === 'choosing');
    const endsAt = lastRound(Y).endsAt;
    const pFail = call(X.s, 'round:setSource', { source: 'tw-hot' });
    if (slowBeforeFail) {
      // 丙：RSS（慢 1.5 秒）成功後 lookup 才回 500；RSS 還在等時再送歌手 → SEARCH_BUSY
      await sleep(150);
      const busy = await call(X.s, 'round:setSource', { source: 'artist', artist: '孫燕姿', hot: false });
      check(`${label}：榜單取歌進行中（RSS 慢）再送歌手模式 → SEARCH_BUSY`, isErr(busy, 'SEARCH_BUSY'), j(busy));
    }
    const f1 = await pFail;
    check(`(b) ${label}：台灣熱門 → CHART_FAILED（文案）`, isErr(f1, 'CHART_FAILED'), j(f1));
    await sleep(50);
    check(`(b) ${label}：失敗後仍在 choosing、setterId 不變、期限不變、source／topic null`, lastRound(Y)?.phase === 'choosing' && lastRound(Y).setterId === X.id && lastRound(Y).endsAt === endsAt && lastRound(Y).source === null && lastRound(Y).topic === null, j(lastRound(Y)));
    const f2 = await call(X.s, 'round:setSource', { source: 'western-hot' });
    check(`(b) ${label}：換西洋熱門 → 仍 CHART_FAILED（失敗不快取、旗標已釋放）`, isErr(f2, 'CHART_FAILED'), j(f2));
    const ok = await call(X.s, 'round:setSource', { source: 'artist', artist: '孫燕姿', hot: false });
    check(`${label}：換歌手模式 → 開局成功、topic 孫燕姿、artistHot false、song.artist 孫燕姿`, ok?.ok === true && ok.data?.topic === '孫燕姿' && (await until(() => lastRound(Y)?.phase === 'playing')) && lastRound(Y).artistHot === false && lastRound(Y).source === 'artist' && lastRound(Y).song?.artist === '孫燕姿', j([ok, lastRound(Y)]));
  }
} catch (err) {
  check('測試流程未預期中斷', false, String(err?.stack ?? err).slice(0, 600));
} finally {
  for (const s of sockets) s.disconnect();
}

console.log(R.map((r) => r.join('  ')).join('\n'));
const fails = R.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${R.length - fails}/${R.length} passed`);
process.exit(fails ? 1 : 0);
