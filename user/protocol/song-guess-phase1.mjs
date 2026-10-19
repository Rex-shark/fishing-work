// 猜歌協定符合性測試（Epic 16 Phase 1 範圍）：只依 spec/song-guess/architecture.md §4／§5 打 Socket，不看實作、不 import server 內部程式。
// 涵蓋 §8 清單：加入／出題／搜尋失敗與不足 5 首／第 1 首 playing／猜對計分／防洩題／揭曉／5 首走完 ended 排名／中途加入快照／重連；
// 另含階段不符的錯誤碼（§5）、搜尋中 SEARCH_BUSY 與取消後結果丟棄（Q9）、英文名退回（Q2）與退回須過半、results／lastTopic（正式名）生命週期（§4）、
// titleLength 不含空白標點（§4 答案判定）、ack 文案（§5.3）。
//
// 題庫用假 iTunes（user/mock/itunes.mjs，§6）：trackTimeMillis 是 2000 ms 的短值，server 的 durationMs = min(trackTimeMillis, 上限) 因此也是 2 秒，
// 一首 = 起播緩衝 1.5 秒 + 播放 2 秒 + 揭曉 5 秒，不必替 server 加縮時用的環境變數。
// 答案怎麼知道：本檔直接向假 iTunes 查同一位歌手的歌單，用 round.song.previewUrl 裡的 trackId 對出歌名（當裁判；玩家端拿不到）。
//
// 用法（專案根目錄，需先 npm run build；隔離埠且只綁本機；**每次都要全新的 server 程序**，房間狀態在記憶體）：
//   node user/mock/itunes.mjs &                                                              # 假 iTunes，預設 127.0.0.1:11535
//   ITUNES_URL=http://127.0.0.1:11535 HOST=127.0.0.1 PORT=3411 node server/dist/index.js &   # server 指向假 iTunes
//   TEST_PORT=3411 node --input-type=module < user/protocol/song-guess-phase1.mjs
// 假 iTunes 換埠時兩邊都要改：MOCK_ITUNES_PORT=11541 node user/mock/itunes.mjs、ITUNES_URL=http://127.0.0.1:11541 …、
//   TEST_PORT=3411 MOCK_ITUNES_URL=http://127.0.0.1:11541 node --input-type=module < user/protocol/song-guess-phase1.mjs
// **假 iTunes 請用預設的 MOCK_ITUNES_TRACK_MS（2000）與 MOCK_ITUNES_SLOW_MS（1500）**，本檔的時間斷言以此為準。
// 總時長約 60 秒（一局 5 首 42.5 秒＋搜尋與取消）；全部 PASS 時 exit 0。
// 未涵蓋（要等真實的 60 秒／15 秒，另由 Vitest 假時鐘涵蓋）：CHOOSING_SECONDS 逾時回 idle、寬限期滿離開（出題者／參賽者）、ROOM_FULL、快取時效。
//
// 水手長（Bosun）派出的子代理 2026-10-12 依 spec 撰寫。
// 2026-10-16 Epic 18 改寫：事件 round:setArtist → round:setSource（payload { source: 'artist', artist, hot: true }，舊名不保留）、
//   ack { artistDisplay } → { topic }、RoundPublic 的 artistDisplay → topic、lastArtist → lastTopic（另驗 source／artistHot／lastSource／song.artist）。
//   題庫來源（台灣熱門、西洋熱門、只抽熱門歌）另見 song-guess-sources.mjs。
import { io } from 'socket.io-client';

const PORT = process.env.TEST_PORT ?? '3411';
const URL = `http://127.0.0.1:${PORT}/song-guess`;
const MOCK = (process.env.MOCK_ITUNES_URL ?? 'http://127.0.0.1:11535').replace(/\/+$/, '');

// ── 常數：.mjs 不能 import .ts，照既有協定測試慣例寫死；出處 shared/src/song-guess/constants.ts（spec §4 常數表）──
const SONGS_PER_GAME = 5;
const CHOOSING_SECONDS = 60;
const REVEAL_SECONDS = 5;
const START_DELAY_MS = 1500;
const ARTIST_MAX = 30;
const NICKNAME_MAX = 12;
const CHAT_MAX = 200;
const CHAT_MIN_INTERVAL_MS = 300;
const SCORE_MAX = 100;
const SCORE_MIN = 50;
/** 假 iTunes 預設的 trackTimeMillis（＝本測試每首的 durationMs） */
const TRACK_MS = 2000;

// ── ack.message 文案：§5.3 表；「其餘同繪圖比賽 §5.4」者出處標在右側 ──
const MSG = {
  ARTIST_INVALID: `歌手名稱需為 1～${ARTIST_MAX} 個字，不可含控制字元，也不能只有空白`,
  ARTIST_NOT_FOUND: `找不到這位歌手的歌（至少要 ${SONGS_PER_GAME} 首有試聽的歌），換一位試試`,
  SEARCH_FAILED: '搜尋失敗，請再試一次',
  SEARCH_BUSY: '搜尋中，請稍候',
  SPOILER_GUESSED: '你已經猜對了，不要說出歌名',
  SPOILER_GUESS: '猜歌名請只輸入歌名本身',
  ROUND_BUSY: '目前已有回合進行中', // spec/draw-contest/architecture.md §5.4
  NOT_SETTER: '只有本回合的出題者可以這麼做', // 同上
  NOT_ENOUGH_PLAYERS: '至少要 2 位在線玩家才能開始', // 同上
  NICKNAME_INVALID: `暱稱需為 1～${NICKNAME_MAX} 個字，且不可含控制字元`, // 與我畫你猜同文案
  NICKNAME_TAKEN: '這個暱稱已經有人使用',
  MESSAGE_INVALID: `訊息需為 1～${CHAT_MAX} 個字，不可含換行等控制字元，也不能只有空白`,
  RATE_LIMITED: `發言太快了，請稍候再送（間隔至少 ${CHAT_MIN_INTERVAL_MS / 1000} 秒）`,
  NOT_IN_ROOM: '請先加入房間',
};

// ── 測試框架（同 draw-contest-phase1.mjs）──
const R = [];
const check = (name, cond, extra = '') => R.push([cond ? 'PASS' : 'FAIL', name, cond ? '' : extra]);
const connect = () => io(URL, { path: '/socket.io', transports: ['websocket'], forceNew: true, reconnection: false });
const call = (s, ev, ...args) => new Promise((res) => s.emit(ev, ...args, res));
const once = (s, ev, ms = 4000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), ms); s.once(ev, (...a) => { clearTimeout(t); res(a); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const collect = (s, ev) => { const arr = []; s.on(ev, (p) => arr.push(p)); return arr; };
/** 輪詢條件直到成立或逾時；回傳是否成立 */
const until = async (pred, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(15); } return pred(); };
/** 錯誤 ack 的錯誤碼與文案一起檢查（msgKey 預設同錯誤碼） */
const isErr = (r, code, msgKey = code) => r?.ok === false && r.error === code && r.message === MSG[msgKey];
const j = (x) => JSON.stringify(x)?.slice(0, 400);
const near = (a, b, tol) => typeof a === 'number' && Math.abs(a - b) <= tol;
/** 每個 socket 都先掛好收集器再 join；rounds／players／chat 依收到的順序累積 */
const joinAs = async (nick, token) => {
  const s = connect(); await once(s, 'connect');
  const rounds = collect(s, 'round:update'), players = collect(s, 'players:update'), chat = collect(s, 'chat:message');
  const r = await call(s, 'player:join', token ? { nickname: nick, token } : { nickname: nick });
  if (!r?.ok) throw new Error('join failed ' + j(r));
  return { s, id: r.data.snapshot.you, token: r.data.token, snap: r.data.snapshot, rounds, players, chat };
};
const lastRound = (p) => p.rounds.at(-1);
const lastPlayers = (p) => p.players.at(-1);
const waitPhase = (p, phase, ms = 4000) => until(() => lastRound(p)?.phase === phase, ms);
const waitSong = (p, phase, index, ms = 9000) => until(() => lastRound(p)?.phase === phase && lastRound(p)?.song?.index === index, ms);
const me = (p, id) => lastPlayers(p)?.find((x) => x.id === id);
const say = (p, text) => call(p.s, 'chat:send', { text });

// ── 答案判定（依 spec §4「答案判定」獨立寫一份，不 import shared）──
/** 去副標：第一個括號起、` - ` 之後、feat.／ft.／featuring 之後；去完為空則退回原歌名 */
const stripSubtitle = (title) => {
  const main = title.replace(/[（(【[].*$/su, '').replace(/ - .*$/su, '').replace(/(^|[^a-z])(feat\.|ft\.|featuring(?![a-z])).*$/isu, '$1').trim();
  return main === '' ? title.trim() : main;
};
/** 正規化：去副標 → NFKC → 去空白與標點（\p{P}、\p{S}）→ 小寫 */
const normalizeTitle = (title) => stripSubtitle(title).normalize('NFKC').replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase();
/** 字數提示：normalizeTitle 的 code point 數（不含空白與標點） */
const titleLength = (title) => [...normalizeTitle(title)].length;
/** §5 猜題的計分式：SCORE_MAX − floor((SCORE_MAX − SCORE_MIN) × 已用 / 播放長度)，已用時間夾在 0..durationMs */
const expectedScore = (at, song) => SCORE_MAX - Math.floor(((SCORE_MAX - SCORE_MIN) * Math.min(Math.max(at - song.startedAt, 0), song.durationMs)) / song.durationMs);

// ── 時間斷言的容許範圍 ──
// server 在真實時鐘下跑。spec 只說 serverNow 是「送出當下的 server 時鐘」、endsAt／startedAt 是「now + 常數」、ChatMessage.at 是訊息時間，
// 沒有保證這些是同一次取樣；分開取樣時機器一忙就會差 1 ms（2026-10-12 三支協定測試同時跑時抓到 endsAt − serverNow = 4999）。
// 所以凡是比較「兩個各自取樣的時間戳」都不做嚴格相等，只驗方向與範圍；同一個欄位的複本、或 spec 定義成算式的（endsAt = startedAt + durationMs）才用嚴格相等。
/** 兩次取樣之間容許的落差（毫秒） */
const SKEW_MS = 50;
/** 計時器容許的提早量：Node 的計時器用單調時鐘，對 Date.now() 而言可能早 1 ms 觸發 */
const EARLY_MS = 5;
/** 計時器容許的延遲（機器忙時事件迴圈會晚） */
const LATE_MS = 1000;
/** `later − serverNow` 應為 expected：serverNow 的取樣不早於算 later 的那個 now，所以只會少、不會多 */
const aheadBy = (later, serverNow, expected) => typeof later === 'number' && later - serverNow <= expected && later - serverNow >= expected - SKEW_MS;
/** 計時器在 due 觸發後才送出的 serverNow：不早於 due（容許 EARLY_MS）、不晚太多 */
const firedAt = (serverNow, due) => typeof serverNow === 'number' && serverNow - due >= -EARLY_MS && serverNow - due < LATE_MS;
/** 得分與計分式相符：計分用的 now 不晚於 correct 訊息的 at（最多早 SKEW_MS），所以得分介於 at 與 at − SKEW_MS 兩個時刻的算式值之間 */
const scoreOk = (score, at, song) => typeof score === 'number' && score >= expectedScore(at, song) && score <= expectedScore(at - SKEW_MS, song);

// ── 裁判：向假 iTunes 查歌單（trackId → 歌名、歌手、專輯）──
const catalog = new Map();
const learn = async (artist) => {
  const res = await fetch(`${MOCK}/search?term=${encodeURIComponent(artist)}&attribute=artistTerm&country=TW&media=music&entity=song&limit=200`);
  if (!res.ok) throw new Error(`假 iTunes 回 ${res.status}（${MOCK}）`);
  const body = await res.json();
  for (const t of body.results) catalog.set(String(t.trackId), t);
  return body.results;
};
const trackOf = (round) => {
  const id = /\/preview\/(\d+)\.m4a$/.exec(round?.song?.previewUrl ?? '')?.[1];
  const t = id === undefined ? undefined : catalog.get(id);
  if (!t) throw new Error('查不到答案：' + round?.song?.previewUrl);
  return t;
};

/** §5.1 排名規則檢查：gameScore 降冪、rank 1..n 連號；回 'ok' 或錯誤描述 */
const rankingOk = (results) => {
  if (!Array.isArray(results)) return 'results 不是陣列';
  if (!results.every((e, i) => e.rank === i + 1)) return 'rank 不連號';
  for (let i = 1; i < results.length; i++) if (results[i - 1].gameScore < results[i].gameScore) return 'gameScore 未降冪';
  return 'ok';
};

const sockets = [];
try {
  // 前置：假 iTunes 要連得到，且回的是預設的短 trackTimeMillis
  const jayTracks = await learn('Jay Chou');
  check('前置：假 iTunes 可連線，Jay Chou 回 ≥ 8 首、artistName 為周杰倫、trackTimeMillis 2000', jayTracks.length >= 8 && jayTracks.every((t) => t.artistName.includes('周杰倫') && t.trackTimeMillis === TRACK_MS), j(jayTracks[0]));
  await learn('Taylor Swift');

  // ════════ 1. 加入 ════════
  const A = await joinAs('  Alice '); sockets.push(A.s);
  if (A.snap.players.length !== 1) throw new Error('需要全新的 server 程序（房間已有其他玩家）');
  const r0 = A.snap.round;
  // 2026-10-16 Epic 18：artistDisplay → topic、lastArtist → lastTopic，另驗 source／lastSource null、artistHot false
  check('全新 server：gameNo 0、idle、setterId／source／artist／topic／endsAt／song／reveal／results／lastTopic／lastSource 皆 null、artistHot false', r0.gameNo === 0 && r0.phase === 'idle' && [r0.setterId, r0.source, r0.artist, r0.topic, r0.endsAt, r0.song, r0.reveal, r0.results, r0.lastTopic, r0.lastSource].every((v) => v === null) && r0.artistHot === false, j(r0));
  check('RoundPublic：songCount = 5、participantIds []、serverNow 為 server 時鐘（與本機差 < 2 秒）', r0.songCount === SONGS_PER_GAME && Array.isArray(r0.participantIds) && r0.participantIds.length === 0 && near(r0.serverNow, Date.now(), 2000), j(r0));
  const meA = A.snap.players.find((p) => p.id === A.id);
  check('join ok：token 為字串、player id 不是 socket.id、暱稱去頭尾空白', typeof A.token === 'string' && A.id !== A.s.id && meA?.nickname === 'Alice', j(meA));
  check('PlayerPublic 欄位齊全（score 0、gameScore 0、isSetter／hasGuessed false、connected、joinedAt）', meA?.score === 0 && meA.gameScore === 0 && meA.isSetter === false && meA.hasGuessed === false && meA.connected === true && typeof meA.joinedAt === 'number', j(meA));
  check('快照含「加入」system 訊息（fromId／nickname null）', A.snap.chat.some((m) => m.kind === 'system' && m.fromId === null && m.nickname === null && m.text.includes('Alice')), j(A.snap.chat));

  const X = connect(); await once(X, 'connect'); sockets.push(X);
  for (const [nick, name] of [['   ', '全空白'], ['x'.repeat(NICKNAME_MAX + 1), `${NICKNAME_MAX + 1} 字`], ['Bo\tb', '控制字元'], [123, '非字串']]) {
    const r = await call(X, 'player:join', { nickname: nick });
    check(`暱稱${name} → NICKNAME_INVALID（文案）`, isErr(r, 'NICKNAME_INVALID'), j(r));
  }
  const rDup = await call(X, 'player:join', { nickname: 'ＡＬＩＣＥ' });
  check('暱稱重複（全形＋大小寫）→ NICKNAME_TAKEN（文案）', isErr(rDup, 'NICKNAME_TAKEN'), j(rDup));
  for (const [ev, payload] of [['round:volunteer'], ['round:setSource', { source: 'artist', artist: '孫燕姿', hot: true }], ['round:cancel'], ['chat:send', { text: 'hi' }]]) {
    const r = payload === undefined ? await call(X, ev) : await call(X, ev, payload);
    check(`未加入就 ${ev} → NOT_IN_ROOM（文案）`, isErr(r, 'NOT_IN_ROOM'), j(r));
  }

  // ════════ 2. 出題（volunteer）與 choosing ════════
  const rv1 = await call(A.s, 'round:volunteer');
  check('單人 volunteer → NOT_ENOUGH_PLAYERS（文案）', isErr(rv1, 'NOT_ENOUGH_PLAYERS'), j(rv1));
  const B = await joinAs('Bob'); sockets.push(B.s);
  await until(() => lastPlayers(A)?.length === 2);
  check('B 加入後 A 收到 players:update（2 人）與「加入」訊息', lastPlayers(A)?.length === 2 && A.chat.some((m) => m.kind === 'system' && m.text.includes('Bob')));
  const ri1 = await call(A.s, 'round:setSource', { source: 'artist', artist: '孫燕姿', hot: true });
  const ri2 = await call(A.s, 'round:cancel');
  check('idle 時 setSource／cancel → NOT_SETTER（文案）', isErr(ri1, 'NOT_SETTER') && isErr(ri2, 'NOT_SETTER'), j([ri1, ri2]));

  const t0 = Date.now();
  const rv2 = await call(A.s, 'round:volunteer');
  check('volunteer ok', rv2?.ok === true, j(rv2));
  await waitPhase(B, 'choosing');
  const ch = lastRound(B);
  check('choosing：setterId=A、artist／topic null、gameNo 仍 0、endsAt≈now+CHOOSING_SECONDS、song／reveal null', ch?.phase === 'choosing' && ch.setterId === A.id && ch.artist === null && ch.topic === null && ch.gameNo === 0 && near(ch.endsAt, t0 + CHOOSING_SECONDS * 1000, 2000) && ch.song === null && ch.reveal === null, j(ch));
  await until(() => me(B, A.id)?.isSetter === true);
  check('players:update 帶 isSetter=true（只有出題者）', me(B, A.id)?.isSetter === true && me(B, B.id)?.isSetter === false, j(lastPlayers(B)));
  const rv3 = await call(B.s, 'round:volunteer');
  const rv4 = await call(A.s, 'round:volunteer');
  check('choosing 時別人或出題者自己再 volunteer → ROUND_BUSY（文案）【spec §5 未明列 choosing 情境，照繪圖比賽】', isErr(rv3, 'ROUND_BUSY') && isErr(rv4, 'ROUND_BUSY'), j([rv3, rv4]));
  const rn1 = await call(B.s, 'round:setSource', { source: 'artist', artist: '孫燕姿', hot: true });
  const rn2 = await call(B.s, 'round:cancel');
  check('choosing 時非出題者 setSource／cancel → NOT_SETTER（文案）', isErr(rn1, 'NOT_SETTER') && isErr(rn2, 'NOT_SETTER'), j([rn1, rn2]));
  for (const [artist, name] of [['   ', '全空白'], ['', '空字串'], ['x'.repeat(ARTIST_MAX + 1), `${ARTIST_MAX + 1} 字`], ['孫\t燕姿', '控制字元'], [42, '非字串']]) {
    const r = await call(A.s, 'round:setSource', { source: 'artist', artist, hot: true });
    check(`歌手名${name} → ARTIST_INVALID（文案）`, isErr(r, 'ARTIST_INVALID'), j(r));
  }
  check('歌手名不合法後仍在 choosing', lastRound(B)?.phase === 'choosing', j(lastRound(B)));

  // ════════ 3. 搜尋失敗、不足 5 首、查無：仍在 choosing、可重試 ════════
  const rf = await call(A.s, 'round:setSource', { source: 'artist', artist: '壞掉樂團', hot: true });
  check('iTunes 回 500 → SEARCH_FAILED（文案）', isErr(rf, 'SEARCH_FAILED'), j(rf));
  const r3 = await call(A.s, 'round:setSource', { source: 'artist', artist: '三首樂團', hot: true });
  check('只有 3 首 → ARTIST_NOT_FOUND（文案）', isErr(r3, 'ARTIST_NOT_FOUND'), j(r3));
  const r404 = await call(A.s, 'round:setSource', { source: 'artist', artist: '查無此人樂團', hot: true });
  check('查無歌手 → ARTIST_NOT_FOUND（文案）', isErr(r404, 'ARTIST_NOT_FOUND'), j(r404));
  const rSplit = await call(A.s, 'round:setSource', { source: 'artist', artist: '客串歌手', hot: true });
  check('退回須過半：本人 2 首、結果被兩個團瓜分（最多 5／12）→ 不退回、ARTIST_NOT_FOUND（文案）', isErr(rSplit, 'ARTIST_NOT_FOUND'), j(rSplit));
  await sleep(100);
  const still = lastRound(B);
  check('四次失敗後仍在 choosing：setterId、endsAt 不變、gameNo 0、artist null', still?.phase === 'choosing' && still.setterId === A.id && still.endsAt === ch.endsAt && still.gameNo === 0 && still.artist === null, j(still));

  // ════════ 4. 搜尋進行中：SEARCH_BUSY；取消 → idle，搜尋回來 ack NOT_SETTER、不開局 ════════
  const slowAck = call(A.s, 'round:setSource', { source: 'artist', artist: '慢慢來樂團', hot: true });   // 假 iTunes 這位會慢 1.5 秒
  await sleep(150);
  const rBusy = await call(A.s, 'round:setSource', { source: 'artist', artist: '孫燕姿', hot: true });
  check('搜尋中再送 → SEARCH_BUSY（文案）', isErr(rBusy, 'SEARCH_BUSY'), j(rBusy));
  check('搜尋中 round 仍是 choosing、artist 尚未公開', lastRound(B)?.phase === 'choosing' && lastRound(B).artist === null, j(lastRound(B)));
  const sysBeforeCancel = B.chat.filter((m) => m.kind === 'system').length;
  const rc1 = await call(A.s, 'round:cancel');
  await waitPhase(B, 'idle');
  check('搜尋中出題者 cancel → idle、setterId null、gameNo 仍 0', rc1?.ok === true && lastRound(B)?.phase === 'idle' && lastRound(B).setterId === null && lastRound(B).gameNo === 0, j(lastRound(B)));
  check('取消後 isSetter 清掉、多一則 system 訊息（取消）', me(B, A.id)?.isSetter === false && B.chat.filter((m) => m.kind === 'system').length > sysBeforeCancel, j(B.chat.at(-1)));
  const rSlow = await slowAck;
  check('搜尋回來時已不是同一次 choosing → 結果丟棄、ack NOT_SETTER（文案）', isErr(rSlow, 'NOT_SETTER'), j(rSlow));
  await sleep(200);
  check('丟棄後沒有開局：仍 idle、gameNo 0', lastRound(B)?.phase === 'idle' && lastRound(B).gameNo === 0, j(lastRound(B)));

  // ════════ 5. 出題成功（英文名退回最多次的 artistName）→ 第 1 首 playing ════════
  await call(A.s, 'round:volunteer');
  await waitPhase(B, 'choosing');
  const sysBeforeSet = B.chat.filter((m) => m.kind === 'system').length;
  const seqA = [];
  A.s.on('round:update', (r) => { if (r.phase === 'playing') seqA.push('playing'); });
  // 2026-10-16 Epic 18：setSource 歌手模式，ack { topic }
  const rSet = await new Promise((res) => A.s.emit('round:setSource', { source: 'artist', artist: ' Jay Chou ', hot: true }, (r) => { seqA.push('ack'); res(r); }));
  check('setSource 成功 ack { topic }：Jay Chou → 周杰倫（最多次 artistName 退回）', rSet?.ok === true && rSet.data?.topic === '周杰倫', j(rSet));
  await waitSong(B, 'playing', 1);
  await until(() => seqA.includes('playing'));
  check('先 ack 再廣播：出題者先收到 ack 才收到第 1 首的 round:update', seqA[0] === 'ack' && seqA[1] === 'playing', j(seqA));
  const p1 = lastRound(B);
  check('playing：gameNo 1、setterId=A、source artist、artistHot true、artist 為輸入（去頭尾空白）、topic 為正式名稱、songCount 5、song.artist 為本首歌手', p1?.gameNo === 1 && p1.setterId === A.id && p1.source === 'artist' && p1.artistHot === true && p1.artist === 'Jay Chou' && p1.topic === '周杰倫' && p1.songCount === SONGS_PER_GAME && typeof p1.song?.artist === 'string' && p1.song.artist.includes('周杰倫'), j(p1));
  check('playing：participantIds＝此刻在線者（A、B，依加入順序）、reveal／results／lastTopic null', j(p1?.participantIds) === j([A.id, B.id]) && p1.reveal === null && p1.results === null && p1.lastTopic === null, j(p1));
  const s1 = p1.song;
  check('song：index 1、correctIds []、durationMs = min(trackTimeMillis, 上限) = 2000', s1?.index === 1 && Array.isArray(s1.correctIds) && s1.correctIds.length === 0 && s1.durationMs === TRACK_MS, j(s1));
  check('song：startedAt − serverNow = START_DELAY_MS（容許取樣落差）、endsAt = startedAt + durationMs、round.endsAt = song.endsAt', aheadBy(s1.startedAt, p1.serverNow, START_DELAY_MS) && s1.endsAt === s1.startedAt + s1.durationMs && p1.endsAt === s1.endsAt, j(p1));
  const track1 = trackOf(p1);
  check('song：previewUrl 是假 iTunes 的試聽網址、titleLength＝normalizeTitle 的字數（不含空白標點）', /^https?:\/\/.+\/preview\/\d+\.m4a$/.test(s1.previewUrl) && s1.titleLength === titleLength(track1.trackName), j([s1, track1.trackName]));
  check('答案不外洩：playing 的 round:update 與 players:update 不含歌名', !j(p1).includes(stripSubtitle(track1.trackName)) && !JSON.stringify(lastPlayers(B)).includes(stripSubtitle(track1.trackName)));
  await until(() => B.chat.filter((m) => m.kind === 'system').length > sysBeforeSet);
  check('出題成功多一則 system 訊息，且不含歌名', B.chat.filter((m) => m.kind === 'system').length > sysBeforeSet && !B.chat.some((m) => m.text.includes(stripSubtitle(track1.trackName))), j(B.chat.at(-1)));
  const [bv, bs, bc] = [await call(B.s, 'round:volunteer'), await call(A.s, 'round:setSource', { source: 'artist', artist: '孫燕姿', hot: true }), await call(A.s, 'round:cancel')];
  check('playing 時 volunteer／setSource／cancel → ROUND_BUSY（文案）', isErr(bv, 'ROUND_BUSY') && isErr(bs, 'ROUND_BUSY') && isErr(bc, 'ROUND_BUSY'), j([bv, bs, bc]));

  // 帳本：各玩家本局得分與猜對首數（依 correct 訊息的 at 以計分式算）
  const ledger = new Map();
  const credit = (id, score, at) => { const e = ledger.get(id) ?? { gameScore: 0, correctCount: 0, at: 0 }; ledger.set(id, { gameScore: e.gameScore + score, correctCount: e.correctCount + 1, at }); };
  const titles = [];

  // ════════ 6. 第 1 首：猜錯、兩種防洩題、猜對計分、播到底 ════════
  const title1 = track1.trackName, main1 = stripSubtitle(title1);
  titles.push(title1);
  const chatBefore = B.chat.length;
  const rWrong = await say(A, '不知道耶');
  await until(() => B.chat.length > chatBefore);
  check('猜錯的訊息照常廣播（kind chat）', rWrong?.ok === true && B.chat.at(-1)?.kind === 'chat' && B.chat.at(-1).text === '不知道耶' && B.chat.at(-1).fromId === A.id, j(B.chat.at(-1)));
  const rSp1 = await say(B, `是${main1}嗎`);
  check('未猜對者訊息含歌名但不完全相同 → SPOILER_BLOCKED「猜歌名請只輸入歌名本身」', isErr(rSp1, 'SPOILER_BLOCKED', 'SPOILER_GUESS'), j(rSp1));
  // B 在起播緩衝內（startedAt 之前）只打歌名本身 → 滿分
  const rG1 = await say(B, main1);
  await until(() => lastRound(A)?.song?.correctIds?.length === 1);
  const cB1 = A.chat.find((m) => m.kind === 'correct' && m.fromId === B.id);
  check('B 猜對（被擋的那則不算發言，不會 RATE_LIMITED）：ack ok、廣播 correct「Bob 猜對了」不含原文', rG1?.ok === true && cB1?.nickname === 'Bob' && cB1.text.includes('Bob') && cB1.text.includes('猜對') && !cB1.text.includes(main1), j([rG1, cB1]));
  // 正常情況這則在起播緩衝（1.5 秒）內送到 → 滿分；機器太忙而晚於 startedAt 時改以計分式驗（測試步調的問題，不是 server 的錯）
  const scoreB1 = me(A, B.id)?.gameScore;
  check('startedAt 之前猜對 → 滿分 100（已用時間以 0 計）', me(A, B.id)?.score === scoreB1 && (cB1?.at <= s1.startedAt ? scoreB1 === SCORE_MAX : scoreOk(scoreB1, cB1?.at, s1)), j([cB1?.at, s1.startedAt, me(A, B.id)]));
  check('猜對後 players:update（hasGuessed=true）與 round:update（correctIds=[B]、仍 playing）', me(A, B.id)?.hasGuessed === true && j(lastRound(A)?.song?.correctIds) === j([B.id]) && lastRound(A).phase === 'playing', j(lastRound(A)?.song));
  credit(B.id, scoreB1, cB1.at);
  check('整個聊天室沒有出現歌名原文', !A.chat.some((m) => m.text.includes(main1)) && !B.chat.some((m) => m.text.includes(main1)));

  await sleep(CHAT_MIN_INTERVAL_MS + 30);
  const rSp2 = await say(B, `${main1}啦`);
  check('已猜對者之後的訊息含歌名 → SPOILER_BLOCKED「你已經猜對了，不要說出歌名」', isErr(rSp2, 'SPOILER_BLOCKED', 'SPOILER_GUESSED'), j(rSp2));
  const rSp3 = await say(B, main1);
  check('已猜對者再打一次歌名 → 同樣擋下、不再得分', isErr(rSp3, 'SPOILER_BLOCKED', 'SPOILER_GUESSED') && me(A, B.id)?.gameScore === scoreB1, j(rSp3));
  const nB = A.chat.length;
  const rFine = await say(B, '這首我會');
  await until(() => A.chat.length > nB);
  check('已猜對者不含歌名的訊息照常廣播', rFine?.ok === true && A.chat.at(-1)?.text === '這首我會', j(A.chat.at(-1)));

  // A（出題者）等歌開始播之後才猜，打完整歌名（含副標）→ 依已用時間計分
  await until(() => Date.now() >= s1.startedAt + 700, 4000);
  const rG1a = await say(A, title1);
  await until(() => lastRound(B)?.song?.correctIds?.length === 2);
  const cA1 = B.chat.find((m) => m.kind === 'correct' && m.fromId === A.id);
  const scoreA1 = me(B, A.id)?.gameScore;
  check('出題者也可以猜；打完整歌名（含副標）也算對', rG1a?.ok === true && cA1 !== undefined && j(lastRound(B)?.song?.correctIds) === j([B.id, A.id]), j([rG1a, lastRound(B)?.song]));
  check('計分式：100 − floor(50 × (now − startedAt) / durationMs)（以 correct 訊息的 at 驗算，容許取樣落差），且 < 100', cA1 !== undefined && scoreOk(scoreA1, cA1.at, s1) && scoreA1 < SCORE_MAX && scoreA1 >= SCORE_MIN, j([scoreA1, cA1?.at, s1]));
  credit(A.id, scoreA1, cA1.at);
  check('全員猜對後歌照播，不提早結束（仍 playing）', lastRound(B)?.phase === 'playing' && Date.now() < s1.endsAt, j(lastRound(B)));

  // ════════ 7. 第 1 首揭曉 ════════
  await waitSong(B, 'reveal', 1);
  const v1 = lastRound(B);
  check('試聽播完才揭曉：reveal 的 serverNow 不早於 song.endsAt（計時器容許早 5 ms、晚 < 1 秒）', v1?.phase === 'reveal' && firedAt(v1.serverNow, s1.endsAt), j([v1?.serverNow, s1.endsAt]));
  check('reveal：index、title（原始歌名含副標）、artist、album、artworkUrl、itunesUrl', v1.reveal?.index === 1 && v1.reveal.title === title1 && v1.reveal.artist === track1.artistName && v1.reveal.album === track1.collectionName && v1.reveal.artworkUrl === track1.artworkUrl100 && v1.reveal.itunesUrl === track1.trackViewUrl, j(v1.reveal));
  check('reveal.scores：本首各猜對者得分，依猜對順序', j(v1.reveal?.scores) === j([{ playerId: B.id, score: scoreB1 }, { playerId: A.id, score: scoreA1 }]), j(v1.reveal?.scores));
  check('reveal：endsAt − serverNow = REVEAL_SECONDS（容許取樣落差）、song 保留（index 1、correctIds 不變）、results null', aheadBy(v1.endsAt, v1.serverNow, REVEAL_SECONDS * 1000) && v1.song?.index === 1 && j(v1.song.correctIds) === j([B.id, A.id]) && v1.results === null, j(v1));
  check('reveal 時 hasGuessed 保留', me(B, A.id)?.hasGuessed === true && me(B, B.id)?.hasGuessed === true, j(lastPlayers(B)));
  await until(() => B.chat.some((m) => m.kind === 'system' && m.text.includes(title1)));
  check('每首揭曉的 system 訊息「第 1 首：《歌名》」', B.chat.some((m) => m.kind === 'system' && m.text === `第 1 首：《${title1}》`), j(B.chat.at(-1)));
  const [vv, vs, vc] = [await call(B.s, 'round:volunteer'), await call(A.s, 'round:setSource', { source: 'artist', artist: '孫燕姿', hot: true }), await call(A.s, 'round:cancel')];
  check('reveal 時 volunteer／setSource／cancel → ROUND_BUSY', isErr(vv, 'ROUND_BUSY') && isErr(vs, 'ROUND_BUSY') && isErr(vc, 'ROUND_BUSY'), j([vv, vs, vc]));
  const nV = A.chat.length;
  const rAfter = await say(B, `原來是${main1}`);
  await until(() => A.chat.length > nV);
  check('reveal 時說出歌名不擋（已公布）', rAfter?.ok === true && A.chat.at(-1)?.kind === 'chat', j(rAfter));

  // ════════ 8. 第 2 首：中途加入快照、可猜可得分、不進 participantIds；重連 ════════
  await waitSong(B, 'playing', 2);
  const p2 = lastRound(B);
  check('揭曉停滿 REVEAL_SECONDS 才進下一首：第 2 首的 serverNow 不早於上一則的 endsAt（計時器容許早 5 ms、晚 < 1 秒）', firedAt(p2?.serverNow, v1.endsAt), j([p2?.serverNow, v1.endsAt]));
  check('第 2 首：index 2、correctIds 清空、reveal null、startedAt − serverNow = START_DELAY_MS（容許取樣落差）、另一首歌', p2.song?.index === 2 && p2.song.correctIds.length === 0 && p2.reveal === null && aheadBy(p2.song.startedAt, p2.serverNow, START_DELAY_MS) && p2.song.previewUrl !== s1.previewUrl, j(p2));
  await until(() => me(B, A.id)?.hasGuessed === false);
  check('下一首開始 hasGuessed 清空、gameScore 保留', me(B, A.id)?.hasGuessed === false && me(B, B.id)?.hasGuessed === false && me(B, B.id)?.gameScore === scoreB1, j(lastPlayers(B)));
  const track2 = trackOf(p2), title2 = track2.trackName, main2 = stripSubtitle(title2);
  titles.push(title2);
  const rG2 = await say(B, main2);
  await until(() => lastRound(A)?.song?.index === 2 && lastRound(A).song.correctIds.length === 1);
  const cB2 = A.chat.filter((m) => m.kind === 'correct' && m.fromId === B.id).at(-1);
  // 帳本記「實際拿到的分數」（players:update 的 gameScore 增量），另以計分式驗它落在容許範圍內
  const gainB2 = me(A, B.id)?.gameScore - ledger.get(B.id).gameScore;
  credit(B.id, gainB2, cB2.at);
  check('B 猜對第 2 首：得分符合計分式、gameScore 與 score 累加', rG2?.ok === true && scoreOk(gainB2, cB2.at, p2.song) && me(A, B.id)?.score === ledger.get(B.id).gameScore, j([gainB2, cB2?.at, p2.song, me(A, B.id)]));

  await until(() => Date.now() >= p2.song.startedAt + 300, 4000);
  const C = await joinAs('Carol'); sockets.push(C.s);
  const cs = C.snap.round;
  check('中途加入快照：playing、進行中的那首（同 previewUrl／startedAt／durationMs）、correctIds 已含 B', cs.phase === 'playing' && cs.song?.index === 2 && cs.song.previewUrl === p2.song.previewUrl && cs.song.startedAt === p2.song.startedAt && cs.song.durationMs === TRACK_MS && j(cs.song.correctIds) === j([B.id]), j(cs));
  check('中途加入快照：serverNow − startedAt 可定位播放位置（0 < 位置 < durationMs）、artist／topic 看得到', cs.serverNow - cs.song.startedAt > 0 && cs.serverNow - cs.song.startedAt < TRACK_MS && cs.artist === 'Jay Chou' && cs.topic === '周杰倫', j(cs));
  check('中途加入者不在 participantIds；快照的玩家清單帶 hasGuessed／gameScore', j(cs.participantIds) === j([A.id, B.id]) && C.snap.players.find((p) => p.id === B.id)?.hasGuessed === true && C.snap.players.find((p) => p.id === C.id)?.gameScore === 0, j(C.snap.players));
  check('中途加入快照不含本首歌名', !JSON.stringify(C.snap).includes(main2));
  const rG2c = await say(C, title2);
  await until(() => lastRound(A)?.song?.correctIds?.length === 2);
  const cC2 = A.chat.find((m) => m.kind === 'correct' && m.fromId === C.id);
  const scoreC2 = me(A, C.id)?.gameScore;
  check('中途加入者可以猜、可以得分（依計分式），仍不在 participantIds', rG2c?.ok === true && cC2 !== undefined && scoreOk(scoreC2, cC2.at, p2.song) && j(lastRound(A).song.correctIds) === j([B.id, C.id]) && j(lastRound(A).participantIds) === j([A.id, B.id]), j([rG2c, scoreC2, lastRound(A)]));
  credit(C.id, scoreC2, cC2.at);

  // 重連：C 斷線後以 token 回來（寬限期內）
  C.s.disconnect();
  await until(() => me(A, C.id)?.connected === false);
  check('斷線 → players:update connected=false（寬限期內仍在名單）', me(A, C.id)?.connected === false, j(me(A, C.id)));
  const C2 = await joinAs('ignored', C.token); sockets.push(C2.s);
  check('token 重連：id 不變、暱稱不變、分數與 hasGuessed 保留', C2.id === C.id && C2.snap.players.find((p) => p.id === C.id)?.nickname === 'Carol' && C2.snap.players.find((p) => p.id === C.id)?.gameScore === scoreC2 && C2.snap.players.find((p) => p.id === C.id)?.connected === true, j(C2.snap.players));
  const rs = C2.snap.round;
  check('重連快照：同一首（index 2 或已揭曉）、serverNow 與 startedAt 可定位', rs.song?.index === 2 && rs.song.startedAt === p2.song.startedAt && typeof rs.serverNow === 'number' && (rs.phase === 'playing' || rs.phase === 'reveal'), j(rs));
  await until(() => me(A, C.id)?.connected === true);
  check('重連後 players:update connected=true', me(A, C.id)?.connected === true);

  await waitSong(A, 'reveal', 2);
  check('第 2 首揭曉：title 正確、scores 依猜對順序（B、C）', lastRound(A).reveal?.title === title2 && j(lastRound(A).reveal.scores.map((e) => e.playerId)) === j([B.id, C.id]), j(lastRound(A).reveal));

  // ════════ 9. 第 3 首沒人猜；第 4 首全形＋空白＋大寫；第 5 首 ════════
  await waitSong(A, 'playing', 3);
  titles.push(trackOf(lastRound(A)).trackName);
  await waitSong(A, 'reveal', 3);
  check('第 3 首沒人猜對：直接揭曉、scores []', lastRound(A).reveal?.index === 3 && lastRound(A).reveal.title === titles[2] && lastRound(A).reveal.scores.length === 0, j(lastRound(A).reveal));

  await waitSong(A, 'playing', 4);
  const p4 = lastRound(A), title4 = trackOf(p4).trackName;
  titles.push(title4);
  // 正規化：字之間加空白、轉大寫、轉全形英數、尾巴加標點，仍算對
  const fancy = [...stripSubtitle(title4)].join(' ').toUpperCase().replace(/[A-Z0-9]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)) + '！';
  const rG4 = await say(A, fancy);
  await until(() => lastRound(B)?.song?.index === 4 && lastRound(B).song.correctIds.length === 1);
  const cA4 = B.chat.filter((m) => m.kind === 'correct' && m.fromId === A.id).at(-1);
  const gainA4 = me(B, A.id)?.gameScore - ledger.get(A.id).gameScore;
  check('正規化：空白、大小寫、全形、標點不同仍算對（得分符合計分式）', rG4?.ok === true && j(lastRound(B)?.song?.correctIds) === j([A.id]) && scoreOk(gainA4, cA4?.at, p4.song), j([fancy, rG4, gainA4]));
  credit(A.id, gainA4, cA4.at);

  await waitSong(A, 'playing', 5);
  const p5 = lastRound(A), title5 = trackOf(p5).trackName;
  titles.push(title5);
  check('五首都不同（去副標後不重複）', new Set(titles.map((t) => stripSubtitle(t))).size === SONGS_PER_GAME, j(titles));
  const rG5 = await say(C2, stripSubtitle(title5));
  await until(() => lastRound(A)?.song?.index === 5 && lastRound(A).song.correctIds.length === 1);
  const cC5 = A.chat.filter((m) => m.kind === 'correct' && m.fromId === C.id).at(-1);
  const gainC5 = me(A, C.id)?.gameScore - ledger.get(C.id).gameScore;
  check('重連後的連線可以猜第 5 首（得分符合計分式）', rG5?.ok === true && cC5 !== undefined && scoreOk(gainC5, cC5?.at, p5.song), j([rG5, gainC5]));
  credit(C.id, gainC5, cC5.at);

  // ════════ 10. 第 5 首揭曉停滿 → ended：本局排名 ════════
  await waitSong(A, 'reveal', 5);
  const v5 = lastRound(A);
  check('第 5 首同樣先揭曉（reveal、endsAt − serverNow = REVEAL_SECONDS（容許取樣落差）、results 尚為 null）', v5.phase === 'reveal' && v5.reveal?.index === 5 && aheadBy(v5.endsAt, v5.serverNow, REVEAL_SECONDS * 1000) && v5.results === null, j(v5));
  await waitPhase(A, 'ended', 9000);
  const en = lastRound(A);
  check('第 5 首揭曉停滿才 ended：ended 的 serverNow 不早於揭曉的 endsAt（計時器容許早 5 ms、晚 < 1 秒）', en?.phase === 'ended' && firedAt(en.serverNow, v5.endsAt), j([en?.serverNow, v5.endsAt]));
  // 2026-10-16 Epic 18：lastArtist → lastTopic，另驗 lastSource
  check('ended：gameNo 1、song null、endsAt null、reveal 保留最後一首、lastTopic＝正式名（topic，不是輸入的 Jay Chou）、lastSource artist、setterId 仍為 A', en.gameNo === 1 && en.song === null && en.endsAt === null && en.reveal?.index === 5 && en.reveal.title === title5 && en.lastTopic === '周杰倫' && en.lastSource === 'artist' && en.setterId === A.id, j(en));
  check('results：對象＝參賽者 ∪ 本局有得分者（A、B、中途加入的 C），rank 連號、gameScore 降冪', en.results?.length === 3 && rankingOk(en.results) === 'ok' && [A.id, B.id, C.id].every((id) => en.results.some((e) => e.playerId === id)), `${rankingOk(en.results)} ${j(en.results)}`);
  check('results：每人的 gameScore、correctCount、nickname 與帳本一致', en.results.every((e) => ledger.get(e.playerId)?.gameScore === e.gameScore && ledger.get(e.playerId)?.correctCount === e.correctCount && e.nickname === { [A.id]: 'Alice', [B.id]: 'Bob', [C.id]: 'Carol' }[e.playerId]), j([en.results, [...ledger]]));
  // 同分者依先達到該分數（最後一次得分時間較早）在前
  const tieOk = en.results.every((e, i) => i === 0 || en.results[i - 1].gameScore > e.gameScore || ledger.get(en.results[i - 1].playerId).at <= ledger.get(e.playerId).at);
  check('results：同分者先達到該分數者在前', tieOk, j(en.results));
  check('participantIds 仍只有 A、B（中途加入者不加入）', j(en.participantIds) === j([A.id, B.id]), j(en.participantIds));
  await until(() => me(A, B.id)?.hasGuessed === false && me(A, C.id)?.hasGuessed === false);
  check('ended：hasGuessed 清空、gameScore 保留、score 累加、isSetter 仍為 true', lastPlayers(A).every((p) => p.hasGuessed === false && p.gameScore === ledger.get(p.id).gameScore && p.score === ledger.get(p.id).gameScore) && me(A, A.id)?.isSetter === true, j(lastPlayers(A)));
  const top = en.results[0];
  await until(() => A.chat.some((m) => m.kind === 'system' && m.text.includes('本局第一名')));
  check('本局結束的 system 訊息「本局第一名：X（n 分）」', A.chat.some((m) => m.kind === 'system' && m.text === `本局第一名：${top.nickname}（${top.gameScore} 分）`), j(A.chat.at(-1)));
  const [es, ec] = [await call(A.s, 'round:setSource', { source: 'artist', artist: '孫燕姿', hot: true }), await call(A.s, 'round:cancel')];
  check('ended 時 setSource／cancel → NOT_SETTER（上一局出題者也一樣）', isErr(es, 'NOT_SETTER') && isErr(ec, 'NOT_SETTER'), j([es, ec]));

  // ════════ 11. results／lastTopic 生命週期：下一局 choosing、取消回 idle 都保留；搜尋成功才清 ════════
  const D = await joinAs('Dave'); sockets.push(D.s);
  check('ended 時加入：快照帶 results、lastTopic、最後一首的揭曉', D.snap.round.phase === 'ended' && j(D.snap.round.results) === j(en.results) && D.snap.round.lastTopic === '周杰倫' && D.snap.round.reveal?.index === 5, j(D.snap.round));
  const rv5 = await call(B.s, 'round:volunteer');
  await waitPhase(A, 'choosing');
  const ch2 = lastRound(A);
  check('ended 可再 volunteer → choosing：setterId=B、gameNo 仍 1、results／lastTopic 保留、reveal／artist null、participantIds []', rv5?.ok === true && ch2.setterId === B.id && ch2.gameNo === 1 && j(ch2.results) === j(en.results) && ch2.lastTopic === '周杰倫' && ch2.reveal === null && ch2.artist === null && ch2.topic === null && ch2.participantIds.length === 0, j(ch2));
  await until(() => me(A, B.id)?.isSetter === true);
  check('下一局 choosing：isSetter 換人、上一局的 gameScore 還在', me(A, B.id)?.isSetter === true && me(A, A.id)?.isSetter === false && me(A, B.id)?.gameScore === ledger.get(B.id).gameScore, j(lastPlayers(A)));
  await call(B.s, 'round:cancel');
  await waitPhase(A, 'idle');
  check('取消回 idle：results／lastTopic 仍保留、setterId null', lastRound(A).phase === 'idle' && j(lastRound(A).results) === j(en.results) && lastRound(A).lastTopic === '周杰倫' && lastRound(A).lastSource === 'artist' && lastRound(A).setterId === null, j(lastRound(A)));

  await call(B.s, 'round:volunteer');
  await waitPhase(A, 'choosing');
  const rSet2 = await call(B.s, 'round:setSource', { source: 'artist', artist: 'taylor swift', hot: true });
  await until(() => lastRound(A)?.phase === 'playing' && lastRound(A).gameNo === 2);
  const g2 = lastRound(A);
  check('第二局搜尋成功（輸入小寫）：ack topic 為正式名 Taylor Swift、gameNo 2、results／lastTopic 清空、reveal null、第 1 首', rSet2?.ok === true && rSet2.data.topic === 'Taylor Swift' && g2.topic === 'Taylor Swift' && g2.gameNo === 2 && g2.results === null && g2.lastTopic === null && g2.lastSource === null && g2.reveal === null && g2.song?.index === 1 && g2.artist === 'taylor swift', j(g2));
  check('第二局參賽者＝此刻在線的四人（依加入順序）', j(g2.participantIds) === j([A.id, B.id, C.id, D.id]), j(g2.participantIds));
  await until(() => lastPlayers(A)?.every((p) => p.gameScore === 0));
  check('新局開始：全員 gameScore 歸零、總分保留、isSetter 只有 B', lastPlayers(A).every((p) => p.gameScore === 0 && p.score === (ledger.get(p.id)?.gameScore ?? 0) && p.isSetter === (p.id === B.id)), j(lastPlayers(A)));
  // 第二局用英文歌手：歌名多半帶空白或標點，驗 titleLength 不含空白標點
  const g2track = trackOf(g2);
  check('第二局的歌來自 Taylor Swift 的歌單（歌手名含 Taylor Swift）', g2track.artistName.includes('Taylor Swift'), j(g2track));
  const g2main = stripSubtitle(g2track.trackName);
  const g2raw = [...g2main].length, g2norm = titleLength(g2track.trackName);
  check('titleLength＝normalizeTitle 的字數：英文歌名的空白與標點不算（有空白標點時小於去副標後的原始字數）', g2.song.titleLength === g2norm && (/[\s\p{P}\p{S}]/u.test(g2main) ? g2norm < g2raw : g2norm === g2raw), j([g2track.trackName, g2.song.titleLength, g2norm, g2raw]));

  // ════════ 12. 聊天驗證與節流 ════════
  const m1 = await say(D, '   ');
  const m2 = await say(D, 'x'.repeat(CHAT_MAX + 1));
  const m3 = await say(D, '第一行\n第二行');
  const m4 = await call(D.s, 'chat:send', { text: 5 });
  check('訊息全空白／超長／含換行／非字串 → MESSAGE_INVALID（文案）', [m1, m2, m3, m4].every((r) => isErr(r, 'MESSAGE_INVALID')), j([m1, m2, m3, m4]));
  const m5 = await say(D, 'x'.repeat(CHAT_MAX));
  const m6 = await say(D, '太快');
  check(`${CHAT_MAX} 字合法；${CHAT_MIN_INTERVAL_MS} ms 內第二則 → RATE_LIMITED（文案）`, m5?.ok === true && isErr(m6, 'RATE_LIMITED'), j([m5, m6]));
  await sleep(CHAT_MIN_INTERVAL_MS + 30);
  const m7 = await say(D, '可以了');
  check('過了間隔可再發言', m7?.ok === true, j(m7));
  const lateSnap = await joinAs('Eve'); sockets.push(lateSnap.s);
  check('快照帶聊天紀錄：猜對的訊息只有「猜對了」、沒有任何未揭曉的歌名', lateSnap.snap.chat.some((m) => m.kind === 'correct') && !JSON.stringify(lateSnap.snap).includes(stripSubtitle(g2track.trackName)), j(lateSnap.snap.chat.slice(-3)));

  // ════════ 13. 不崩潰 ════════
  A.s.emit('round:setSource', { source: 'artist', artist: '孫燕姿', hot: true });   // 不帶 ack
  A.s.emit('round:setSource');
  A.s.emit('round:setArtist', { artist: '孫燕姿' }, () => {});   // 2026-10-16 Epic 18：舊事件名沒有 handler，不回 ack、不崩潰
  A.s.emit('chat:send', null);
  B.s.emit('player:join', null, () => {});
  await sleep(300);
  const alive = await say(C2, 'still alive');
  check('壞 payload／不帶 ack 後 server 仍存活', C2.s.connected && alive?.ok === true, j(alive));
} catch (err) {
  check('測試流程未預期中斷', false, String(err?.stack ?? err).slice(0, 600));
} finally {
  for (const s of sockets) s.disconnect();
}

console.log(R.map((r) => r.join('  ')).join('\n'));
const fails = R.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${R.length - fails}/${R.length} passed`);
process.exit(fails ? 1 : 0);
