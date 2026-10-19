// 猜歌「題庫來源」協定符合性測試（Epic 18）：只依 spec/song-guess/architecture.md §4／§5／§5.3／§6／§8 打 Socket，不看實作、不 import server 內部程式。
// 涵蓋 §8 的 Epic 18 清單：
//   - 只抽熱門歌：熱門歌手（假 iTunes 60 首、歌名帶名次）hot: true 打兩局，10 首全落在前 30（多局統計）；hot: false 可抽到第 31 首之後（最多三局）
//   - 台灣熱門、西洋熱門各一局走完：ack { topic }、source／artist null／artistHot false／topic、逐首 song.artist ＝該首歌手、揭曉有封面且歌手一致、
//     猜對計分、系統訊息「X 出題「台灣熱門」，共 5 首」、ended 的 lastTopic／lastSource
//   - topic／lastTopic／lastSource 生命週期：ended 保留 → 下一局 choosing 保留 → 換來源開局才清
//   - SOURCE_INVALID（payload 不是物件、source 不合法、歌手模式 hot 缺漏或非 boolean；文案 §5.3）、榜單模式多帶的欄位忽略
//   - 取歌進行中（歌手搜尋）再送榜單 → SEARCH_BUSY（兩種來源共用旗標）；取消後回來 NOT_SETTER
//   - CHART_FAILED：RSS 壞、lookup 壞（各一個 server）→ 仍在 choosing、期限不變；可重試、可換另一個榜單、可換歌手模式出題
//
// 需要三個 server 程序與兩個假 iTunes（**每次都要全新的 server 程序**，房間狀態與榜單快取都在記憶體）：
//   甲（主）：ITUNES_URL、ITUNES_RSS_URL 都指正常的假 iTunes
//   乙（RSS 壞）：ITUNES_RSS_URL 指「壞的」假 iTunes（MOCK_ITUNES_CHART_FAIL=1），ITUNES_URL 指正常的
//   丙（lookup 壞）：ITUNES_URL 指「壞的」假 iTunes（MOCK_ITUNES_LOOKUP_FAIL=1；搜尋照常），ITUNES_RSS_URL 指正常的
// 用法（專案根目錄，需先 npm run build；隔離埠且只綁本機）：
//   MOCK_ITUNES_PORT=11571 MOCK_ITUNES_TRACK_MS=300 node user/mock/itunes.mjs &                                  # 正常；縮短每首播放（只影響本檔）
//   MOCK_ITUNES_PORT=11572 MOCK_ITUNES_CHART_FAIL=1 MOCK_ITUNES_LOOKUP_FAIL=1 node user/mock/itunes.mjs &          # 壞的：RSS 與 lookup 都回 500
//   COMMENT=off JUDGE=random HOST=127.0.0.1 PORT=3471 ITUNES_URL=http://127.0.0.1:11571 ITUNES_RSS_URL=http://127.0.0.1:11571 node server/dist/index.js &   # 甲
//   COMMENT=off JUDGE=random HOST=127.0.0.1 PORT=3472 ITUNES_URL=http://127.0.0.1:11571 ITUNES_RSS_URL=http://127.0.0.1:11572 node server/dist/index.js &   # 乙
//   COMMENT=off JUDGE=random HOST=127.0.0.1 PORT=3473 ITUNES_URL=http://127.0.0.1:11572 ITUNES_RSS_URL=http://127.0.0.1:11571 node server/dist/index.js &   # 丙
//   TEST_PORT=3471 TEST_PORT_RSS_FAIL=3472 TEST_PORT_LOOKUP_FAIL=3473 MOCK_ITUNES_URL=http://127.0.0.1:11571 node --input-type=module < user/protocol/song-guess-sources.mjs
// 每首播放長度由假 iTunes 的 trackTimeMillis 決定（本檔向假 iTunes 查回來，不寫死）；MOCK_ITUNES_TRACK_MS=300 時一首 ≈ 1.5 + 0.3 + 5 秒，
// 五局約 3 分鐘；用預設 2000 也可以，約 4 分鐘。全部 PASS 時 exit 0。
// 未涵蓋（放 server 的 vitest）：榜單取歌中再送歌手 → SEARCH_BUSY（假 iTunes 沒有只讓榜單變慢的開關）、榜單快取時效、
// lookup 查不到的 id 略過（真 Apple 樣本 server/test/fixtures/song-guess.chart.json）、逾時。
//
// 水手長（Bosun）派出的子代理 2026-10-16 Epic 18 依 spec 撰寫。
import { io } from 'socket.io-client';

const PORT = process.env.TEST_PORT ?? '3471';
const PORT_RSS_FAIL = process.env.TEST_PORT_RSS_FAIL ?? '3472';
const PORT_LOOKUP_FAIL = process.env.TEST_PORT_LOOKUP_FAIL ?? '3473';
const MOCK = (process.env.MOCK_ITUNES_URL ?? 'http://127.0.0.1:11571').replace(/\/+$/, '');
const urlOf = (port) => `http://127.0.0.1:${port}/song-guess`;

// ── 常數：.mjs 不能 import .ts，照既有協定測試慣例寫死；出處 spec §4 常數表 ──
const SONGS_PER_GAME = 5;
const REVEAL_SECONDS = 5;
const START_DELAY_MS = 1500;
const HOT_POOL = 30;
const SOURCE_TITLE = { 'tw-hot': '台灣熱門', 'western-hot': '西洋熱門' };
/** 假 iTunes「熱門歌手」的 trackId 起點：trackId − 1700 ＝ iTunes 回傳的名次（user/mock/itunes.mjs 檔頭） */
const HOT_ID_BASE = 1700;
const HOT_ARTIST = '熱門歌手';

// ── ack.message 文案：§5.3 ──
const MSG = {
  SOURCE_INVALID: '題庫來源不正確，請重新選擇',
  CHART_FAILED: '取得排行榜失敗，請再試一次',
  SEARCH_BUSY: '搜尋中，請稍候',
  NOT_SETTER: '只有本回合的出題者可以這麼做', // spec/draw-contest/architecture.md §5.4（§5.3「其餘同繪圖比賽」）
};

// ── 測試框架（同 song-guess-phase1.mjs）──
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

// ── 答案判定（依 spec §4 獨立寫一份）──
const stripSubtitle = (title) => {
  const main = title.replace(/[（(【[].*$/su, '').replace(/ - .*$/su, '').replace(/(^|[^a-z])(feat\.|ft\.|featuring(?![a-z])).*$/isu, '$1').trim();
  return main === '' ? title.trim() : main;
};

// ── 裁判：向假 iTunes 查歌（trackId → 歌名、歌手、專輯）──
const catalog = new Map();
const remember = (results) => { for (const t of results) catalog.set(String(t.trackId), t); return results; };
const learnArtist = async (artist) => {
  const res = await fetch(`${MOCK}/search?term=${encodeURIComponent(artist)}&attribute=artistTerm&country=TW&media=music&entity=song&limit=200`);
  if (!res.ok) throw new Error(`假 iTunes 回 ${res.status}（${MOCK}）`);
  return remember((await res.json()).results);
};
/** 榜單：RSS 取 id → lookup 補齊（同 spec §3 的兩段；這裡是裁判自己查，不經 server） */
const learnChart = async (country) => {
  const rss = await (await fetch(`${MOCK}/api/v2/${country}/music/most-played/100/songs.json`)).json();
  const ids = rss.feed.results.map((r) => r.id);
  const lookup = await (await fetch(`${MOCK}/lookup?id=${ids.join(',')}&country=TW`)).json();
  return { ids, tracks: remember(lookup.results) };
};
const idOf = (round) => /\/preview\/(\d+)\.m4a$/.exec(round?.song?.previewUrl ?? '')?.[1];
const trackOf = (round) => {
  const t = catalog.get(idOf(round) ?? '');
  if (!t) throw new Error('查不到答案：' + round?.song?.previewUrl);
  return t;
};

/**
 * 跑完一局（已在 playing 第 1 首）：逐首記錄 round（playing 時）與揭曉；guesser 有給時每首都猜對。
 * 回 { songs: [{ playing, reveal }], ended }
 */
const playGame = async (watcher, songMs, guesser = null) => {
  const songs = [];
  for (let i = 1; i <= SONGS_PER_GAME; i++) {
    const per = START_DELAY_MS + songMs + REVEAL_SECONDS * 1000 + 4000;
    if (!(await until(() => lastRound(watcher)?.phase === 'playing' && lastRound(watcher)?.song?.index === i, per))) throw new Error(`等不到第 ${i} 首 playing：${j(lastRound(watcher))}`);
    const playing = lastRound(watcher);
    if (guesser) {
      await sleep(320); // 發言間隔
      const r = await say(guesser, stripSubtitle(trackOf(playing).trackName));
      if (r?.ok !== true) throw new Error(`猜第 ${i} 首失敗：${j(r)}`);
    }
    if (!(await until(() => lastRound(watcher)?.phase === 'reveal' && lastRound(watcher)?.reveal?.index === i, per))) throw new Error(`等不到第 ${i} 首 reveal`);
    songs.push({ playing, reveal: lastRound(watcher).reveal });
  }
  if (!(await until(() => lastRound(watcher)?.phase === 'ended', REVEAL_SECONDS * 1000 + 4000))) throw new Error('等不到 ended');
  return { songs, ended: lastRound(watcher) };
};

/** 出題（volunteer → setSource）；回 setSource 的 ack */
const startGame = async (setter, watcher, payload) => {
  const rv = await call(setter.s, 'round:volunteer');
  if (rv?.ok !== true) throw new Error('volunteer 失敗 ' + j(rv));
  await until(() => lastRound(watcher)?.phase === 'choosing');
  const r = await call(setter.s, 'round:setSource', payload);
  if (r?.ok === true) await until(() => lastRound(watcher)?.phase === 'playing' && lastRound(watcher)?.song?.index === 1);
  return r;
};

try {
  // ════════ 前置：裁判資料 ════════
  const hotTracks = await learnArtist(HOT_ARTIST);
  const songMs = hotTracks[0]?.trackTimeMillis ?? 2000;
  check('前置：假 iTunes 的熱門歌手有 60 首、依名次排列（trackId − 1700 ＝ 名次）', hotTracks.length === 60 && hotTracks.every((t, i) => Number(t.trackId) - HOT_ID_BASE === i + 1 && t.trackName === `熱門第${i + 1}首`), j(hotTracks.slice(0, 2)));
  const tw = await learnChart('tw');
  const us = await learnChart('us');
  check('前置：假 iTunes 台灣榜、美國榜各 12 首，lookup 全部補得到試聽', tw.ids.length === 12 && tw.tracks.length === 12 && us.ids.length === 12 && us.tracks.length === 12 && [...tw.tracks, ...us.tracks].every((t) => typeof t.previewUrl === 'string'), j([tw.ids.length, tw.tracks.length, us.ids.length, us.tracks.length]));
  const twArtists = new Map(tw.tracks.map((t) => [String(t.trackId), t.artistName]));
  const usArtists = new Map(us.tracks.map((t) => [String(t.trackId), t.artistName]));

  // ════════ 乙／丙：CHART_FAILED（RSS 壞、lookup 壞）→ 仍在 choosing，可重試、換來源 ════════
  for (const [port, label] of [[PORT_RSS_FAIL, 'RSS 壞'], [PORT_LOOKUP_FAIL, 'lookup 壞']]) {
    const X = await joinAs(port, `${label}甲`);
    const Y = await joinAs(port, `${label}乙`);
    if (X.snap.round.gameNo !== 0 || X.snap.players.length !== 1) throw new Error(`${label} 的 server 需要全新的程序`);
    await call(X.s, 'round:volunteer');
    await until(() => lastRound(Y)?.phase === 'choosing');
    const endsAt = lastRound(Y).endsAt;
    const f1 = await call(X.s, 'round:setSource', { source: 'tw-hot' });
    check(`${label}：台灣熱門 → CHART_FAILED（文案）`, isErr(f1, 'CHART_FAILED'), j(f1));
    await sleep(100);
    check(`${label}：失敗後仍在 choosing、setterId 不變、期限不變、source／topic 仍 null`, lastRound(Y)?.phase === 'choosing' && lastRound(Y).setterId === X.id && lastRound(Y).endsAt === endsAt && lastRound(Y).source === null && lastRound(Y).topic === null, j(lastRound(Y)));
    const f2 = await call(X.s, 'round:setSource', { source: 'tw-hot' });
    const f3 = await call(X.s, 'round:setSource', { source: 'western-hot' });
    check(`${label}：重試、換西洋熱門 → 仍 CHART_FAILED（失敗不快取、不卡 SEARCH_BUSY）`, isErr(f2, 'CHART_FAILED') && isErr(f3, 'CHART_FAILED'), j([f2, f3]));
    const ok = await call(X.s, 'round:setSource', { source: 'artist', artist: '孫燕姿', hot: true });
    check(`${label}：換歌手模式 → 出題成功 ack { topic: 孫燕姿 }`, ok?.ok === true && ok.data?.topic === '孫燕姿', j(ok));
    await until(() => lastRound(Y)?.phase === 'playing');
    check(`${label}：換來源後進第 1 首，source artist、topic 孫燕姿`, lastRound(Y)?.phase === 'playing' && lastRound(Y).source === 'artist' && lastRound(Y).topic === '孫燕姿', j(lastRound(Y)));
  }

  // ════════ 甲：SOURCE_INVALID 與 SEARCH_BUSY ════════
  const A = await joinAs(PORT, 'Alice');
  if (A.snap.round.gameNo !== 0 || A.snap.players.length !== 1) throw new Error('主 server 需要全新的程序（房間已有其他玩家或已開過局）');
  const B = await joinAs(PORT, 'Bob');
  check('初始快照：source／topic／lastTopic／lastSource 皆 null、artistHot false', [A.snap.round.source, A.snap.round.topic, A.snap.round.lastTopic, A.snap.round.lastSource].every((v) => v === null) && A.snap.round.artistHot === false, j(A.snap.round));
  await call(A.s, 'round:volunteer');
  await until(() => lastRound(B)?.phase === 'choosing');
  const choosingEndsAt = lastRound(B).endsAt;
  const badPayloads = [
    ['payload 是字串', '熱門歌手'],
    ['payload 是 null', null],
    ['沒有 source（舊 setArtist 形狀）', { artist: '熱門歌手' }],
    ['source 不是三值之一', { source: 'uk-hot' }],
    ['source 大小寫不符', { source: 'TW-HOT' }],
    ['歌手模式缺 hot', { source: 'artist', artist: '熱門歌手' }],
    ['歌手模式 hot 是字串', { source: 'artist', artist: '熱門歌手', hot: 'true' }],
  ];
  for (const [name, payload] of badPayloads) {
    const r = await call(A.s, 'round:setSource', payload);
    check(`${name} → SOURCE_INVALID（文案）`, isErr(r, 'SOURCE_INVALID'), j(r));
  }
  const rNone = await call(A.s, 'round:setSource');
  check('不帶 payload → SOURCE_INVALID', isErr(rNone, 'SOURCE_INVALID'), j(rNone));
  await sleep(100);
  check('SOURCE_INVALID 後仍在 choosing、期限不變', lastRound(B)?.phase === 'choosing' && lastRound(B).endsAt === choosingEndsAt && lastRound(B).setterId === A.id, j(lastRound(B)));

  const slow = call(A.s, 'round:setSource', { source: 'artist', artist: '慢慢來樂團', hot: false }); // 假 iTunes 這位慢 1.5 秒
  await sleep(150);
  const busy1 = await call(A.s, 'round:setSource', { source: 'tw-hot' });
  const busy2 = await call(A.s, 'round:setSource', { source: 'western-hot' });
  check('歌手搜尋中再送台灣熱門／西洋熱門 → SEARCH_BUSY（兩種來源共用旗標；文案）', isErr(busy1, 'SEARCH_BUSY') && isErr(busy2, 'SEARCH_BUSY'), j([busy1, busy2]));
  const bad = await call(A.s, 'round:setSource', { source: 'nope' });
  check('搜尋中送壞 payload → 仍是 SOURCE_INVALID（先驗輸入再看忙碌）', isErr(bad, 'SOURCE_INVALID'), j(bad));
  await call(A.s, 'round:cancel');
  const stale = await slow;
  check('取消後搜尋回來 → NOT_SETTER、不開局', isErr(stale, 'NOT_SETTER') && lastRound(B)?.phase === 'idle' && lastRound(B).gameNo === 0, j([stale, lastRound(B)]));

  // ════════ 甲：只抽熱門歌（兩局 hot: true）════════
  const hotRanks = [];
  for (let g = 1; g <= 2; g++) {
    const r = await startGame(A, B, { source: 'artist', artist: HOT_ARTIST, hot: true });
    check(`熱門第 ${g} 局：ack { topic: 熱門歌手 }`, r?.ok === true && r.data?.topic === HOT_ARTIST, j(r));
    const p1 = lastRound(B);
    check(`熱門第 ${g} 局：source artist、artist 輸入值、artistHot true、topic 正式名、song.artist 熱門歌手`, p1.source === 'artist' && p1.artist === HOT_ARTIST && p1.artistHot === true && p1.topic === HOT_ARTIST && p1.song?.artist === HOT_ARTIST, j(p1));
    if (g === 1) check('熱門第 1 局開局：lastTopic／lastSource 為 null', p1.lastTopic === null && p1.lastSource === null, j(p1));
    else check('熱門第 2 局開局：上一局的 lastTopic／lastSource 已清空', p1.lastTopic === null && p1.lastSource === null && p1.results === null, j(p1));
    const { songs, ended } = await playGame(B, songMs);
    for (const { playing } of songs) hotRanks.push(Number(idOf(playing)) - HOT_ID_BASE);
    check(`熱門第 ${g} 局 ended：lastTopic 熱門歌手、lastSource artist`, ended.lastTopic === HOT_ARTIST && ended.lastSource === 'artist' && ended.topic === HOT_ARTIST, j(ended));
  }
  check(`只抽熱門歌（兩局 10 首）：名次全在 1..${HOT_POOL}`, hotRanks.length === 10 && hotRanks.every((x) => x >= 1 && x <= HOT_POOL), j(hotRanks));
  check('只抽熱門歌：同一局 5 首不重複', new Set(hotRanks.slice(0, 5)).size === 5 && new Set(hotRanks.slice(5)).size === 5, j(hotRanks));

  // ════════ 甲：不勾熱門 → 可抽到第 31 首之後（最多三局）════════
  const coldRanks = [];
  for (let g = 1; g <= 3 && !coldRanks.some((x) => x > HOT_POOL); g++) {
    const r = await startGame(A, B, { source: 'artist', artist: HOT_ARTIST, hot: false });
    check(`不勾熱門第 ${g} 局：出題成功、artistHot false`, r?.ok === true && lastRound(B).artistHot === false && lastRound(B).source === 'artist', j([r, lastRound(B)]));
    const { songs } = await playGame(B, songMs);
    for (const { playing } of songs) coldRanks.push(Number(idOf(playing)) - HOT_ID_BASE);
  }
  check(`不勾熱門：抽得到第 ${HOT_POOL + 1} 首之後（三局內）`, coldRanks.some((x) => x > HOT_POOL), j(coldRanks));
  check('不勾熱門：名次都在 1..60', coldRanks.every((x) => x >= 1 && x <= 60), j(coldRanks));

  // ════════ 甲：台灣熱門一局走完（B 每首都猜對）════════
  {
    const sysBefore = A.chat.length;
    const r = await startGame(A, B, { source: 'tw-hot', artist: '忽略我', hot: 'x' });
    check('台灣熱門：ack { topic: 台灣熱門 }（榜單模式多帶的欄位忽略）', r?.ok === true && r.data?.topic === SOURCE_TITLE['tw-hot'], j(r));
    const p1 = lastRound(B);
    check('台灣熱門第 1 首：source tw-hot、artist null、artistHot false、topic 台灣熱門、lastTopic／lastSource 清空', p1.source === 'tw-hot' && p1.artist === null && p1.artistHot === false && p1.topic === '台灣熱門' && p1.lastTopic === null && p1.lastSource === null && p1.results === null, j(p1));
    await until(() => A.chat.slice(sysBefore).some((m) => m.kind === 'system' && m.text === 'Alice 出題「台灣熱門」，共 5 首'));
    check('系統訊息「Alice 出題「台灣熱門」，共 5 首」（不另加熱門字樣）', A.chat.slice(sysBefore).some((m) => m.kind === 'system' && m.text === 'Alice 出題「台灣熱門」，共 5 首'), j(A.chat.slice(sysBefore).map((m) => m.text)));
    const { songs, ended } = await playGame(A, songMs, B);
    const ids = songs.map(({ playing }) => idOf(playing));
    check('台灣熱門：5 首都來自台灣榜、不重複', ids.every((id) => twArtists.has(id)) && new Set(ids).size === 5, j(ids));
    check('台灣熱門：逐首 song.artist ＝該首歌手（lookup 的 artistName）', songs.every(({ playing }) => playing.song.artist === twArtists.get(idOf(playing))), j(songs.map(({ playing }) => playing.song.artist)));
    check('台灣熱門：每首 previewUrl 都有、durationMs ＝ trackTimeMillis', songs.every(({ playing }) => typeof playing.song.previewUrl === 'string' && playing.song.durationMs === songMs), j(songs.map(({ playing }) => playing.song.durationMs)));
    check('台灣熱門：揭曉有封面、歌名與歌手與裁判一致', songs.every(({ playing, reveal }) => typeof reveal.artworkUrl === 'string' && reveal.artist === playing.song.artist && reveal.title === trackOf(playing).trackName), j(songs.map(({ reveal }) => [reveal.title, reveal.artist, reveal.artworkUrl])));
    check('台灣熱門：B 每首都猜對且得分', songs.every(({ reveal }) => reveal.scores.length === 1 && reveal.scores[0].playerId === B.id && reveal.scores[0].score >= 50), j(songs.map(({ reveal }) => reveal.scores)));
    check('台灣熱門 ended：lastTopic 台灣熱門、lastSource tw-hot、排名第一是 B', ended.lastTopic === '台灣熱門' && ended.lastSource === 'tw-hot' && ended.results?.[0]?.playerId === B.id && ended.results[0].correctCount === 5, j(ended));
  }

  // ════════ 甲：下一局 choosing 保留 lastTopic；西洋熱門一局走完 ════════
  {
    const rv = await call(B.s, 'round:volunteer');
    await until(() => lastRound(A)?.phase === 'choosing');
    const ch = lastRound(A);
    check('西洋熱門前的 choosing：lastTopic 台灣熱門、lastSource tw-hot、results 保留；source／topic null', rv?.ok === true && ch.lastTopic === '台灣熱門' && ch.lastSource === 'tw-hot' && ch.results?.length === 2 && ch.source === null && ch.topic === null && ch.artistHot === false, j(ch));
    const r = await call(B.s, 'round:setSource', { source: 'western-hot' });
    check('西洋熱門：ack { topic: 西洋熱門 }', r?.ok === true && r.data?.topic === SOURCE_TITLE['western-hot'], j(r));
    await until(() => lastRound(A)?.phase === 'playing' && lastRound(A)?.song?.index === 1);
    const p1 = lastRound(A);
    check('西洋熱門第 1 首：source western-hot、artist null、topic 西洋熱門、lastTopic／lastSource 清空', p1.source === 'western-hot' && p1.artist === null && p1.artistHot === false && p1.topic === '西洋熱門' && p1.lastTopic === null && p1.lastSource === null, j(p1));
    const { songs, ended } = await playGame(A, songMs, A);
    const ids = songs.map(({ playing }) => idOf(playing));
    check('西洋熱門：5 首都來自美國榜、不重複、song.artist ＝該首歌手', ids.every((id) => usArtists.has(id)) && new Set(ids).size === 5 && songs.every(({ playing }) => playing.song.artist === usArtists.get(idOf(playing))), j(songs.map(({ playing }) => [idOf(playing), playing.song.artist])));
    check('西洋熱門：揭曉有封面、歌手一致', songs.every(({ playing, reveal }) => typeof reveal.artworkUrl === 'string' && reveal.artist === playing.song.artist), j(songs.map(({ reveal }) => reveal.artworkUrl)));
    check('西洋熱門 ended：lastTopic 西洋熱門、lastSource western-hot、出題者 A 也能猜（排名第一是 A）', ended.lastTopic === '西洋熱門' && ended.lastSource === 'western-hot' && ended.results?.[0]?.playerId === A.id, j(ended));
  }

  // 舊事件名不保留（Epic 18 決策 1）：沒有 handler、不回 ack
  const legacy = await Promise.race([call(A.s, 'round:setArtist', { artist: '孫燕姿' }), sleep(500).then(() => 'no-ack')]);
  check('舊事件 round:setArtist 不再有 handler（不回 ack），server 仍存活', legacy === 'no-ack' && A.s.connected && (await say(A, 'still alive'))?.ok === true, j(legacy));
} catch (err) {
  check('測試流程未預期中斷', false, String(err?.stack ?? err).slice(0, 600));
} finally {
  for (const s of sockets) s.disconnect();
}

console.log(R.map((r) => r.join('  ')).join('\n'));
const fails = R.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${R.length - fails}/${R.length} passed`);
process.exit(fails ? 1 : 0);
