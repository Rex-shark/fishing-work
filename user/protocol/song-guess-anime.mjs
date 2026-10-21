// 猜歌「動漫熱門」協定符合性測試（Epic 19）：只依 spec/song-guess/architecture.md §4／§5／§5.3／§6／§8 打 Socket，
// 不看實作、不 import server 內部程式；合法候選由本檔依 spec 向假 iTunes 自己查、自己算（裁判）。
// 涵蓋 §8 的 Epic 19 清單：
//   - 動漫熱門一局走完（四個 server 並行各一局）：ack { topic: 動漫熱門 }（多帶的欄位忽略）、source anime-hot／artist null／artistHot false／
//     topic 動漫熱門、系統訊息「X 出題「動漫熱門」，共 5 首」、逐首 song.artist ＝該首歌手、揭曉歌名／歌手／封面與裁判一致、猜對計分、
//     ended 的 lastTopic／lastSource
//   - 抽到的 5 首都在合法候選內（＝合併排名、排除原聲帶／翻唱、去重後的前 60；假資料只有 14 首，全在前 60）
//   - 原聲帶／Cover／重複版本多局都不會被抽到（推算見下）
//   - lastTopic／lastSource 生命週期：ended 保留 → 下一局 choosing 保留 → 換來源開局才清
//   - 任一關鍵字搜尋失敗（MOCK_ITUNES_FAIL_TERM=アニメ）→ CHART_FAILED「取得題庫失敗，請再試一次」、仍在 choosing、期限不變；
//     重試仍失敗（不快取）；取歌中再送其他來源 → SEARCH_BUSY（四種來源共用旗標）；失敗後換台灣熱門可開局
//
// 假 iTunes（user/mock/itunes.mjs 檔頭）：anime／アニメ／動漫 共 18 首（trackId 2301～2318），可抽 2301～2314（14 首）；
//   不可抽 2315（原聲帶）、2316（Cover）、2317（Original Soundtrack）、2318（與 2301 同歌手同歌名、排名較後 → 去重掉）。
// 多局推算：四局共 20 首。若 server 沒排除原聲帶／翻唱，候選會是 17 首，一局 5 首完全避開那 3 首的機率
//   C(14,5)/C(17,5) = 2002/6188 ≈ 0.324，四局都避開 ≈ 0.011（約 1.1% 漏抓）。若只是沒去重（多了 2318），一局避開的機率
//   C(14,5)/C(15,5) ≈ 0.667，四局 ≈ 0.198——去重的確定性驗證放 server 的 vitest（pickAnime）。
//
// 需要五個 server 程序與兩個假 iTunes（**每次都要全新的 server 程序**，房間狀態與題庫快取都在記憶體）：
//   甲（主）、乙、丙、丁：ITUNES_URL、ITUNES_RSS_URL 都指正常的假 iTunes（四局並行，省時間）
//   戊（關鍵字壞）：ITUNES_URL 指「壞的」假 iTunes（MOCK_ITUNES_FAIL_TERM=アニメ、延遲 800 ms 讓取歌中可再送），ITUNES_RSS_URL 指正常的
// 用法（專案根目錄，需先 npm run build；隔離埠且只綁本機）：
//   MOCK_ITUNES_PORT=11591 MOCK_ITUNES_TRACK_MS=300 node user/mock/itunes.mjs &                                 # 正常；縮短每首播放
//   MOCK_ITUNES_PORT=11592 MOCK_ITUNES_FAIL_TERM=アニメ MOCK_ITUNES_DELAY_MS=800 node user/mock/itunes.mjs &     # アニメ 回 500；每次回應延遲 0.8 秒
//   for p in 3491 3492 3493 3494; do COMMENT=off JUDGE=random HOST=127.0.0.1 PORT=$p ITUNES_URL=http://127.0.0.1:11591 ITUNES_RSS_URL=http://127.0.0.1:11591 node server/dist/index.js & done   # 甲乙丙丁
//   COMMENT=off JUDGE=random HOST=127.0.0.1 PORT=3495 ITUNES_URL=http://127.0.0.1:11592 ITUNES_RSS_URL=http://127.0.0.1:11591 node server/dist/index.js &   # 戊
//   TEST_PORTS=3491,3492,3493,3494 TEST_PORT_FAIL=3495 MOCK_ITUNES_URL=http://127.0.0.1:11591 node --input-type=module < user/protocol/song-guess-anime.mjs
// 每首播放長度由假 iTunes 的 trackTimeMillis 決定（本檔向假 iTunes 查回來，不寫死）；MOCK_ITUNES_TRACK_MS=300 時一首 ≈ 1.5 + 0.3 + 5 秒，
// 四局並行約 40 秒。全部 PASS 時 exit 0。
// 未涵蓋（放 server 的 vitest）：真 Apple 樣本的排除（server/test/fixtures/song-guess.anime.json）、前 60 截斷（假資料不到 60 首）、
// 合併排名的細節、三次搜尋的並行與逾時、快取時效。
//
// 水手長（Bosun）派出的子代理 2026-10-20 Epic 19 依 spec 撰寫。
import { io } from 'socket.io-client';

const PORTS = (process.env.TEST_PORTS ?? '3491,3492,3493,3494').split(',').map((p) => p.trim()).filter(Boolean);
const PORT_FAIL = process.env.TEST_PORT_FAIL ?? '3495';
const MOCK = (process.env.MOCK_ITUNES_URL ?? 'http://127.0.0.1:11591').replace(/\/+$/, '');
const urlOf = (port) => `http://127.0.0.1:${port}/song-guess`;

// ── 常數：.mjs 不能 import .ts，照既有協定測試慣例寫死；出處 spec §4 常數表 ──
const SONGS_PER_GAME = 5;
const REVEAL_SECONDS = 5;
const START_DELAY_MS = 1500;
const ANIME_TERMS = ['anime', 'アニメ', '動漫'];
const ANIME_HOT_POOL = 60;
const TOPIC = '動漫熱門'; // SOURCE_TITLE['anime-hot']
/** 假 iTunes 檔頭宣告的可抽／不可抽 trackId（與裁判算出來的對照，防假資料被改壞） */
const MOCK_PICKABLE = Array.from({ length: 14 }, (_, i) => String(2301 + i));
const MOCK_EXCLUDED = ['2315', '2316', '2317', '2318'];

// ── ack.message 文案：§5.3 ──
const MSG = {
  CHART_FAILED: '取得題庫失敗，請再試一次', // Epic 19 起通用（榜單與動漫熱門共用）
  SEARCH_BUSY: '搜尋中，請稍候',
  SOURCE_INVALID: '題庫來源不正確，請重新選擇',
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
  const rounds = collect(s, 'round:update'), chat = collect(s, 'chat:message');
  const r = await call(s, 'player:join', { nickname: nick });
  if (!r?.ok) throw new Error('join failed ' + j(r));
  return { s, id: r.data.snapshot.you, snap: r.data.snapshot, rounds, chat };
};
const lastRound = (p) => p.rounds.at(-1);
const say = (p, text) => call(p.s, 'chat:send', { text });

// ── 答案判定（依 spec §4 獨立寫一份）──
const stripSubtitle = (title) => {
  const main = title.replace(/[（(【[].*$/su, '').replace(/ - .*$/su, '').replace(/(^|[^a-z])(feat\.|ft\.|featuring(?![a-z])).*$/isu, '$1').trim();
  return main === '' ? title.trim() : main;
};
/** mainTitle：同 stripSubtitle 但不退回原名 */
const mainTitle = (title) => title.replace(/[（(【[].*$/su, '').replace(/ - .*$/su, '').replace(/(^|[^a-z])(feat\.|ft\.|featuring(?![a-z])).*$/isu, '$1').trim();
const normalizeTitle = (s) => stripSubtitle(s).normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();

// ── 原聲帶／翻唱判定（依 spec §6 獨立寫一份：拉丁字母整字比對、日文／中文子字串）──
const LATIN = ['soundtrack', 'OST', 'BGM', 'instrumental', 'off vocal', 'piano', 'cover', 'remix', '8-bit', 'music box'];
const CJK = ['サウンドトラック', '原聲', '原声', 'カラオケ', '伴奏', '鋼琴', 'カバー', '音樂盒', 'オルゴール'];
const LATIN_RE = new RegExp(`(?<![A-Za-z0-9])(?:${LATIN.map((k) => k.replace(/[-]/g, '\\-')).join('|')})(?![A-Za-z0-9])`, 'i');
const hasKw = (text) => !!text && (LATIN_RE.test(text.normalize('NFKC')) || CJK.some((k) => text.includes(k)));
const isSoundtrackOrCover = (t) => hasKw(t.collectionName) || hasKw(t.trackName);

// ── 裁判：向假 iTunes 查三個關鍵字（trackId → 歌名、歌手、專輯），依 spec §5／§6 算合法候選 ──
const catalog = new Map();
const learnAnime = async () => {
  const lists = [];
  for (const term of ANIME_TERMS) {
    const res = await fetch(`${MOCK}/search?term=${encodeURIComponent(term)}&entity=song&country=TW&media=music&limit=200`);
    if (!res.ok) throw new Error(`假 iTunes 回 ${res.status}（${MOCK}，term=${term}）`);
    const results = (await res.json()).results;
    for (const t of results) catalog.set(String(t.trackId), t);
    lists.push(results);
  }
  // 合併排名：每首（trackId）＝三份中的最小索引；同排名依關鍵字順序
  const best = new Map();
  lists.forEach((results, term) => results.forEach((t, rank) => {
    const prev = best.get(t.trackId);
    if (prev === undefined || rank < prev.rank) best.set(t.trackId, { t, rank, term });
  }));
  const merged = [...best.values()].sort((a, b) => a.rank - b.rank || a.term - b.term).map((x) => x.t);
  // 有試聽 → 排除原聲帶／翻唱 → 歌名猜得到 → artistName＋normalizeTitle 去重（留較前者）→ 前 60
  const kept = new Map();
  for (const t of merged) {
    if (typeof t.previewUrl !== 'string' || isSoundtrackOrCover(t) || mainTitle(t.trackName) === '' || normalizeTitle(t.trackName) === '') continue;
    const key = `${t.artistName}\u0000${normalizeTitle(t.trackName)}`;
    if (!kept.has(key)) kept.set(key, t);
  }
  return { lists, merged, legal: [...kept.values()].slice(0, ANIME_HOT_POOL).map((t) => String(t.trackId)) };
};
const idOf = (round) => /\/preview\/(\d+)\.m4a$/.exec(round?.song?.previewUrl ?? '')?.[1];
const trackOf = (round) => {
  const t = catalog.get(idOf(round) ?? '');
  if (!t) throw new Error('查不到答案：' + round?.song?.previewUrl);
  return t;
};

/** 跑完一局（已在 playing 第 1 首）：逐首記錄 round（playing 時）與揭曉；guesser 有給時每首都猜對 */
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

try {
  // ════════ 前置：裁判資料 ════════
  const { lists, merged, legal } = await learnAnime();
  const songMs = merged[0]?.trackTimeMillis ?? 2000;
  check('前置：假 iTunes 三個關鍵字各有結果、三份有交集', lists.every((l) => l.length > 0) && merged.length < lists.reduce((n, l) => n + l.length, 0), j(lists.map((l) => l.length)));
  check('前置：合併去重後 ≥ 12 首、含原聲帶與 Cover', merged.length >= 12 && merged.some((t) => /soundtrack|サウンドトラック|原聲/i.test(t.collectionName ?? '')) && merged.some((t) => /cover|カバー/i.test(`${t.trackName} ${t.collectionName ?? ''}`)), j(merged.length));
  check('前置：依 spec 算出的合法候選＝假 iTunes 檔頭宣告的 2301～2314（14 首，都在前 60）', j([...legal].sort()) === j(MOCK_PICKABLE) && legal.length <= ANIME_HOT_POOL, j(legal));
  check('前置：不可抽的 2315～2318 確實在假資料裡（不是因為不存在才抽不到）', MOCK_EXCLUDED.every((id) => catalog.has(id)) && MOCK_EXCLUDED.every((id) => !legal.includes(id)), j(MOCK_EXCLUDED.map((id) => catalog.get(id)?.trackName)));
  check('前置：LOST IN PARADISE（標題含 LOST）在合法候選內（OST 整字比對，不誤殺）', legal.some((id) => catalog.get(id)?.trackName.startsWith('LOST IN PARADISE')), j(legal));
  const legalSet = new Set(legal);

  // ════════ 戊：任一關鍵字失敗 → CHART_FAILED；取歌中 SEARCH_BUSY ════════
  {
    const X = await joinAs(PORT_FAIL, '戊甲');
    const Y = await joinAs(PORT_FAIL, '戊乙');
    if (X.snap.round.gameNo !== 0 || X.snap.players.length !== 1) throw new Error('戊 server 需要全新的程序');
    await call(X.s, 'round:volunteer');
    await until(() => lastRound(Y)?.phase === 'choosing');
    const endsAt = lastRound(Y).endsAt;
    const pending = call(X.s, 'round:setSource', { source: 'anime-hot' }); // 壞的假 iTunes 每次回應延遲 0.8 秒
    await sleep(150);
    const busy = await Promise.all([
      call(X.s, 'round:setSource', { source: 'anime-hot' }),
      call(X.s, 'round:setSource', { source: 'tw-hot' }),
      call(X.s, 'round:setSource', { source: 'western-hot' }),
      call(X.s, 'round:setSource', { source: 'artist', artist: '孫燕姿', hot: true }),
    ]);
    check('動漫熱門取歌中再送動漫熱門／台灣熱門／西洋熱門／歌手 → SEARCH_BUSY（四種來源共用旗標；文案）', busy.every((r) => isErr(r, 'SEARCH_BUSY')), j(busy));
    const bad = await call(X.s, 'round:setSource', { source: 'Anime-Hot' });
    check('取歌中送不合法的 source → 仍是 SOURCE_INVALID（先驗輸入再看忙碌）', isErr(bad, 'SOURCE_INVALID'), j(bad));
    const f1 = await pending;
    check('アニメ 回 500 → CHART_FAILED「取得題庫失敗，請再試一次」', isErr(f1, 'CHART_FAILED'), j(f1));
    await sleep(100);
    const ch = lastRound(Y);
    check('失敗後仍在 choosing、setterId 不變、期限不變、source／topic／artist 仍 null', ch?.phase === 'choosing' && ch.setterId === X.id && ch.endsAt === endsAt && ch.source === null && ch.topic === null && ch.artist === null, j(ch));
    const f2 = await call(X.s, 'round:setSource', { source: 'anime-hot' });
    check('重試動漫熱門 → 仍 CHART_FAILED（失敗不快取、旗標已釋放）', isErr(f2, 'CHART_FAILED'), j(f2));
    const ok = await call(X.s, 'round:setSource', { source: 'tw-hot' });
    check('換台灣熱門 → 出題成功 ack { topic: 台灣熱門 }', ok?.ok === true && ok.data?.topic === '台灣熱門', j(ok));
    await until(() => lastRound(Y)?.phase === 'playing');
    check('換來源後進第 1 首，source tw-hot、topic 台灣熱門', lastRound(Y)?.phase === 'playing' && lastRound(Y).source === 'tw-hot' && lastRound(Y).topic === '台灣熱門', j(lastRound(Y)));
  }

  // ════════ 甲乙丙丁：動漫熱門各一局（並行）════════
  const games = await Promise.all(PORTS.map(async (port, k) => {
    const A = await joinAs(port, `Alice${k + 1}`);
    if (A.snap.round.gameNo !== 0 || A.snap.players.length !== 1) throw new Error(`server ${port} 需要全新的程序（房間已有其他玩家或已開過局）`);
    const B = await joinAs(port, `Bob${k + 1}`);
    const sysBefore = B.chat.length;
    const rv = await call(A.s, 'round:volunteer');
    if (rv?.ok !== true) throw new Error('volunteer 失敗 ' + j(rv));
    await until(() => lastRound(B)?.phase === 'choosing');
    const ack = await call(A.s, 'round:setSource', { source: 'anime-hot', artist: '忽略我', hot: 'x' });
    await until(() => lastRound(B)?.phase === 'playing' && lastRound(B)?.song?.index === 1);
    const first = lastRound(B);
    await until(() => B.chat.slice(sysBefore).some((m) => m.kind === 'system' && m.text === `Alice${k + 1} 出題「${TOPIC}」，共 5 首`));
    const sys = B.chat.slice(sysBefore).map((m) => m.text);
    const { songs, ended } = await playGame(B, songMs, B);
    return { port, A, B, ack, first, sys, songs, ended };
  }));

  const allIds = [];
  for (const [k, g] of games.entries()) {
    const tag = `第 ${k + 1} 局（:${g.port}）`;
    check(`${tag}：ack { topic: 動漫熱門 }（多帶的 artist／hot 忽略）`, g.ack?.ok === true && g.ack.data?.topic === TOPIC, j(g.ack));
    check(`${tag}第 1 首：source anime-hot、artist null、artistHot false、topic 動漫熱門、lastTopic／lastSource／results null`, g.first.source === 'anime-hot' && g.first.artist === null && g.first.artistHot === false && g.first.topic === TOPIC && g.first.lastTopic === null && g.first.lastSource === null && g.first.results === null, j(g.first));
    check(`${tag}：系統訊息「Alice${k + 1} 出題「動漫熱門」，共 5 首」`, g.sys.includes(`Alice${k + 1} 出題「${TOPIC}」，共 5 首`), j(g.sys));
    const ids = g.songs.map(({ playing }) => idOf(playing));
    allIds.push(...ids);
    check(`${tag}：5 首都在合法候選內（前 60、非原聲帶／翻唱、非重複版本）且不重複`, ids.every((id) => legalSet.has(id)) && new Set(ids).size === 5, j(ids.map((id) => [id, catalog.get(id)?.trackName])));
    check(`${tag}：逐首 song.artist ＝該首 artistName；每首 source／topic 不變`, g.songs.every(({ playing }) => playing.song.artist === trackOf(playing).artistName && playing.source === 'anime-hot' && playing.topic === TOPIC), j(g.songs.map(({ playing }) => playing.song.artist)));
    check(`${tag}：durationMs ＝ trackTimeMillis`, g.songs.every(({ playing }) => playing.song.durationMs === songMs), j(g.songs.map(({ playing }) => playing.song.durationMs)));
    check(`${tag}：揭曉歌名、歌手、專輯與裁判一致，有封面`, g.songs.every(({ playing, reveal }) => { const t = trackOf(playing); return reveal.title === t.trackName && reveal.artist === t.artistName && reveal.album === t.collectionName && typeof reveal.artworkUrl === 'string'; }), j(g.songs.map(({ reveal }) => [reveal.title, reveal.artist, reveal.album])));
    check(`${tag}：B 每首都猜對且得分`, g.songs.every(({ reveal }) => reveal.scores.length === 1 && reveal.scores[0].playerId === g.B.id && reveal.scores[0].score >= 50), j(g.songs.map(({ reveal }) => reveal.scores)));
    check(`${tag} ended：lastTopic 動漫熱門、lastSource anime-hot、topic／source 保留、B 第一名 5 首全對`, g.ended.lastTopic === TOPIC && g.ended.lastSource === 'anime-hot' && g.ended.topic === TOPIC && g.ended.source === 'anime-hot' && g.ended.results?.[0]?.playerId === g.B.id && g.ended.results[0].correctCount === 5, j(g.ended));
  }
  check(`多局（${games.length} 局 ${allIds.length} 首）：原聲帶／Cover／重複版本（2315～2318）一首都沒抽到`, allIds.length === games.length * SONGS_PER_GAME && allIds.every((id) => !MOCK_EXCLUDED.includes(id)), j(allIds));

  // ════════ 甲：下一局 choosing 保留 lastTopic／lastSource；換來源開局才清 ════════
  {
    const { A, B } = games[0];
    const rv = await call(B.s, 'round:volunteer');
    await until(() => lastRound(A)?.phase === 'choosing');
    const ch = lastRound(A);
    check('下一局 choosing：lastTopic 動漫熱門、lastSource anime-hot、results 保留；source／topic／artist null、artistHot false', rv?.ok === true && ch.lastTopic === TOPIC && ch.lastSource === 'anime-hot' && ch.results?.length === 2 && ch.source === null && ch.topic === null && ch.artist === null && ch.artistHot === false, j(ch));
    const r = await call(B.s, 'round:setSource', { source: 'tw-hot' });
    await until(() => lastRound(A)?.phase === 'playing' && lastRound(A)?.song?.index === 1);
    const p1 = lastRound(A);
    check('換台灣熱門開局：ack { topic: 台灣熱門 }、lastTopic／lastSource／results 清空', r?.ok === true && r.data?.topic === '台灣熱門' && p1.source === 'tw-hot' && p1.topic === '台灣熱門' && p1.lastTopic === null && p1.lastSource === null && p1.results === null && p1.gameNo === 2, j([r, p1]));
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
