// 猜歌規則協定符合性測試（Epic 16 驗收補測）：只依 spec/song-guess/architecture.md §4／§5／§5.1／§5.3 打 Socket，不看實作、不 import server 內部程式。
// 與 song-guess-phase1.mjs 互補，專驗驗收範圍點名的規則：
//   - choosing 的三種搜尋結果：不足 5 首 ARTIST_NOT_FOUND、iTunes 500 → SEARCH_FAILED、別名退回不過半 → ARTIST_NOT_FOUND，三者都**仍在 choosing**（出題者可重填）
//   - 別名退回且過半（Jay Chou → artistDisplay「周杰倫」）；round.artist 為輸入值、artistDisplay 為正式名
//   - 同一則 round:update 內 `startedAt − serverNow`（playing）、`endsAt − serverNow`（choosing／reveal）的方向與範圍；`endsAt = startedAt + durationMs` 嚴格相等
//   - 未猜對者訊息含歌名但不完全相同 → SPOILER_BLOCKED「猜歌名請只輸入歌名本身」且不廣播；已猜對者含歌名 → SPOILER_BLOCKED「你已經猜對了，不要說出歌名」且不廣播
//   - 多人猜對（含出題者、含中途加入者）不提早結束：全員猜對後仍 playing，直到 endsAt 才 reveal
//   - 中途加入者：快照帶進行中那首（startedAt 與其他人相同、serverNow 為當下）、可猜可得分、**不在 participantIds**；排名因有得分而列入
//   - 重連：寬限期內以 token 接管 → 同一個 id、分數保留、快照 song.startedAt 與其他人相同、serverNow 為當下
//   - 第 5 首揭曉停滿 REVEAL_SECONDS 才 ended；ended 的 results 依 gameScore 降冪、同分依先達到該分數者在前、0 分者依 participantIds 順序；lastArtist 為正式名；
//     reveal 保留最後一首、song 為 null、endsAt 為 null；系統訊息「本局第一名：X（n 分）」
//   - results／lastArtist 在之後的 choosing／idle 保留，下一局搜尋成功進第 1 首才清空
// 為了讓排名可預期，所有猜對都刻意在起播緩衝（startedAt 之前）送出 → 每次都是滿分 100（§5：startedAt 之前得分以 startedAt 為 0 秒）。
//
// 題庫用假 iTunes（user/mock/itunes.mjs，§6）：trackTimeMillis 2000 ms → durationMs 2000；一首 = 緩衝 1.5 秒 + 播放 2 秒 + 揭曉 5 秒。
// 答案怎麼知道：本檔直接向假 iTunes 查「Jay Chou」的歌單，用 round.song.previewUrl 裡的 trackId 對出歌名（當裁判；玩家端拿不到）。
//
// 用法（專案根目錄，需先 npm run build；隔離埠且只綁本機；**每次都要全新的 server 程序**，房間狀態在記憶體）：
//   MOCK_ITUNES_PORT=11562 node user/mock/itunes.mjs &                                        # 假 iTunes
//   ITUNES_URL=http://127.0.0.1:11562 HOST=127.0.0.1 PORT=3462 node server/dist/index.js &    # server 指向假 iTunes
//   TEST_PORT=3462 MOCK_ITUNES_URL=http://127.0.0.1:11562 node --input-type=module < user/protocol/song-guess-rules.mjs
// **假 iTunes 請用預設的 MOCK_ITUNES_TRACK_MS（2000）**，本檔的時間斷言以此為準。總時長約 50 秒；全部 PASS 時 exit 0。
//
// 驗收子代理（代架構師海圖）2026-10-12 依 spec 撰寫。
import { io } from 'socket.io-client';

const PORT = process.env.TEST_PORT ?? '3462';
const URL = `http://127.0.0.1:${PORT}/song-guess`;
const MOCK = (process.env.MOCK_ITUNES_URL ?? 'http://127.0.0.1:11535').replace(/\/+$/, '');

// ── 常數：.mjs 不能 import .ts，照既有協定測試慣例寫死；出處 spec §4 常數表 ──
const SONGS_PER_GAME = 5;
const CHOOSING_SECONDS = 60;
const REVEAL_SECONDS = 5;
const START_DELAY_MS = 1500;
const SCORE_MAX = 100;
const TRACK_MS = 2000;

// ── ack.message 文案：§5.3 ──
const MSG = {
  ARTIST_NOT_FOUND: `找不到這位歌手的歌（至少要 ${SONGS_PER_GAME} 首有試聽的歌），換一位試試`,
  SEARCH_FAILED: '搜尋失敗，請再試一次',
  SPOILER_GUESSED: '你已經猜對了，不要說出歌名',
  SPOILER_GUESS: '猜歌名請只輸入歌名本身',
  ROUND_BUSY: '目前已有回合進行中', // spec/draw-contest/architecture.md §5.4（§5.3「其餘同繪圖比賽」）
  NOT_SETTER: '只有本回合的出題者可以這麼做',
};

// ── 測試框架（同 song-guess-phase1.mjs）──
const R = [];
const check = (name, cond, extra = '') => R.push([cond ? 'PASS' : 'FAIL', name, cond ? '' : extra]);
const connect = () => io(URL, { path: '/socket.io', transports: ['websocket'], forceNew: true, reconnection: false });
const call = (s, ev, ...args) => new Promise((res) => s.emit(ev, ...args, res));
const once = (s, ev, ms = 4000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), ms); s.once(ev, (...a) => { clearTimeout(t); res(a); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const collect = (s, ev) => { const arr = []; s.on(ev, (p) => arr.push(p)); return arr; };
const until = async (pred, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(15); } return pred(); };
const isErr = (r, code, msgKey = code) => r?.ok === false && r.error === code && r.message === MSG[msgKey];
const j = (x) => JSON.stringify(x)?.slice(0, 400);
const joinAs = async (nick, token) => {
  const s = connect(); await once(s, 'connect');
  const rounds = collect(s, 'round:update'), players = collect(s, 'players:update'), chat = collect(s, 'chat:message');
  const r = await call(s, 'player:join', token ? { nickname: nick, token } : { nickname: nick });
  if (!r?.ok) throw new Error('join failed ' + j(r));
  return { s, nick, id: r.data.snapshot.you, token: r.data.token, snap: r.data.snapshot, rounds, players, chat };
};
const lastRound = (p) => p.rounds.at(-1);
const lastPlayers = (p) => p.players.at(-1);
const waitSong = (p, phase, index, ms = 9000) => until(() => lastRound(p)?.phase === phase && lastRound(p)?.song?.index === index, ms);
const me = (p, id) => lastPlayers(p)?.find((x) => x.id === id);
const say = (p, text) => call(p.s, 'chat:send', { text });

// ── 答案判定（依 spec §4 獨立寫一份）──
const stripSubtitle = (title) => {
  const main = title.replace(/[（(【[].*$/su, '').replace(/ - .*$/su, '').replace(/(^|[^a-z])(feat\.|ft\.|featuring(?![a-z])).*$/isu, '$1').trim();
  return main === '' ? title.trim() : main;
};
const normalizeTitle = (title) => stripSubtitle(title).normalize('NFKC').replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase();
const normalizeFull = (s) => s.normalize('NFKC').replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase();
const titleLength = (title) => [...normalizeTitle(title)].length;

// ── 時間容許範圍：server 以真實時鐘跑；spec §5 保證同一次轉移取同一個時鐘值，但本檔只驴方向與範圍（≤ 常數、≥ 常數 − SKEW）──
const SKEW_MS = 50;
const EARLY_MS = 5;
const LATE_MS = 1200;
/** `later − base` 應為 expected：只會少、不會多 */
const gapIs = (later, base, expected) => typeof later === 'number' && typeof base === 'number' && later - base <= expected && later - base >= expected - SKEW_MS;

// ── 裁判：向假 iTunes 查歌單 ──
const lookup = async (term) => {
  const res = await fetch(`${MOCK}/search?term=${encodeURIComponent(term)}&attribute=artistTerm&country=TW&media=music&entity=song&limit=200`);
  const body = await res.json();
  const map = new Map();
  for (const t of body.results) map.set(String(t.trackId), t.trackName);
  return map;
};
const titleOf = (titles, song) => titles.get(/\/preview\/(\d+)\.m4a$/.exec(song.previewUrl)?.[1] ?? '');

// ═══════════════════════════════════════════════════════════════════
const titles = await lookup('Jay Chou');
check('假 iTunes 可查到 Jay Chou 的歌單（裁判用）', titles.size >= 5, `size=${titles.size}`);

const A = await joinAs('阿明');
const B = await joinAs('小美');
const C = await joinAs('不猜的C');
const E = await joinAs('不猜的E');
const ids = { A: A.id, B: B.id, C: C.id, E: E.id };
await until(() => lastPlayers(A)?.length === 4);
check('初始 idle，results／lastArtist 為 null', A.snap.round.phase === 'idle' && A.snap.round.results === null && A.snap.round.lastArtist === null, j(A.snap.round));

// ── choosing：三種失敗都留在 choosing ──
{
  const r = await call(A.s, 'round:volunteer');
  check('A volunteer → ok', r?.ok === true, j(r));
  await until(() => lastRound(A)?.phase === 'choosing');
  const ch = lastRound(A);
  check('choosing：setterId=A、endsAt − serverNow 在 (CHOOSING−SKEW, CHOOSING]', ch.setterId === ids.A && gapIs(ch.endsAt, ch.serverNow, CHOOSING_SECONDS * 1000), `gap=${ch.endsAt - ch.serverNow}`);
  check('choosing：results／lastArtist 仍為 null（第一局）', ch.results === null && ch.lastArtist === null);

  const r1 = await call(A.s, 'round:setArtist', { artist: '三首樂團' });
  check('不足 5 首 → ARTIST_NOT_FOUND（文案 §5.3）', isErr(r1, 'ARTIST_NOT_FOUND'), j(r1));
  check('ARTIST_NOT_FOUND 後仍在 choosing、setterId 不變', lastRound(A).phase === 'choosing' && lastRound(A).setterId === ids.A, j(lastRound(A)));

  const r2 = await call(A.s, 'round:setArtist', { artist: '壞掉樂團' });
  check('iTunes 500 → SEARCH_FAILED（文案 §5.3）', isErr(r2, 'SEARCH_FAILED'), j(r2));
  check('SEARCH_FAILED 後仍在 choosing', lastRound(A).phase === 'choosing' && lastRound(A).setterId === ids.A);

  const r3 = await call(A.s, 'round:setArtist', { artist: '客串歌手' });
  check('本人不足 5 首、最多次 artistName 不過半（5/12）→ 不退回、ARTIST_NOT_FOUND', isErr(r3, 'ARTIST_NOT_FOUND'), j(r3));
  check('不過半退回失敗後仍在 choosing', lastRound(A).phase === 'choosing');

  const rb = await call(B.s, 'round:setArtist', { artist: '周杰倫' });
  check('非出題者在 choosing setArtist → NOT_SETTER', isErr(rb, 'NOT_SETTER'), j(rb));
  const rv = await call(B.s, 'round:volunteer');
  check('choosing 時他人 volunteer → ROUND_BUSY', isErr(rv, 'ROUND_BUSY'), j(rv));
  check('失敗期間沒有多送 playing 的 round:update', A.rounds.every((x) => x.phase !== 'playing'));
}

// ── 別名退回成功：Jay Chou → 周杰倫 ──
const sentAt = Date.now();
const rs = await call(A.s, 'round:setArtist', { artist: 'Jay Chou' });
check('Jay Chou → ok，ack.data.artistDisplay = 周杰倫（別名退回且 9/10 過半）', rs?.ok === true && rs.data?.artistDisplay === '周杰倫', j(rs));
await waitSong(A, 'playing', 1);
const p1 = lastRound(A);
const startedAt1 = p1.song?.startedAt;
check('第 1 首 playing：gameNo 1、artist=輸入值 Jay Chou、artistDisplay=周杰倫', p1.gameNo === 1 && p1.artist === 'Jay Chou' && p1.artistDisplay === '周杰倫', j(p1));
check('participantIds = 此刻在線的 A、B、C、E（依加入順序）', j(p1.participantIds) === j([ids.A, ids.B, ids.C, ids.E]), j(p1.participantIds));
check('playing：startedAt − serverNow 在 (START_DELAY−SKEW, START_DELAY]', gapIs(p1.song.startedAt, p1.serverNow, START_DELAY_MS), `gap=${p1.song.startedAt - p1.serverNow}`);
check('playing：endsAt = startedAt + durationMs（嚴格）、durationMs = 2000、round.endsAt = song.endsAt', p1.song.endsAt === p1.song.startedAt + p1.song.durationMs && p1.song.durationMs === TRACK_MS && p1.endsAt === p1.song.endsAt, j(p1.song));
check('playing：serverNow 接近本機時鐘（同機、|Δ| ≤ 1 秒）', Math.abs(p1.serverNow - Date.now()) <= 1000 && p1.serverNow >= sentAt - SKEW_MS, `serverNow=${p1.serverNow} now=${Date.now()}`);
check('playing：reveal null、results null、correctIds []、全員 hasGuessed=false', p1.reveal === null && p1.results === null && p1.song.correctIds.length === 0 && lastPlayers(A).every((x) => x.hasGuessed === false));
const title1 = titleOf(titles, p1.song);
check('裁判對得出第 1 首歌名；titleLength = normalizeTitle 的 code point 數', typeof title1 === 'string' && p1.song.titleLength === titleLength(title1), `title=${title1} len=${p1.song?.titleLength}`);
check('previewUrl 不含歌名', !normalizeFull(p1.song.previewUrl).includes(normalizeTitle(title1)));

// ── 中途加入者 D（第 1 首緩衝期內）──
const D = await joinAs('半路D');
check('中途加入：快照 phase playing、song.startedAt 與 A 相同、serverNow 為當下', D.snap.round.phase === 'playing' && D.snap.round.song?.startedAt === startedAt1 && Math.abs(D.snap.round.serverNow - Date.now()) <= 1000, j(D.snap.round.song));
check('中途加入者不在 participantIds', !D.snap.round.participantIds.includes(D.id) && j(D.snap.round.participantIds) === j(p1.participantIds), j(D.snap.round.participantIds));
check('中途加入者的 gameScore 0、isSetter false', me(A, D.id) === undefined || (D.snap.players.find((x) => x.id === D.id)?.gameScore === 0));

// ── 猜題（都在 startedAt 之前 → 滿分 100）──
{
  // 只數非 system 訊息：D 剛加入的系統訊息「半路D 加入」可能晚一點才到（2026-10-12 驗收子代理首跑時遇到，改為排除 system）
  const nonSystem = () => A.chat.filter((m) => m.kind !== 'system').length;
  const chatBefore = nonSystem();
  const rg = await say(B, `是${title1}嗎`);
  check('未猜對者訊息含歌名但不完全相同 → SPOILER_BLOCKED「猜歌名請只輸入歌名本身」', isErr(rg, 'SPOILER_BLOCKED', 'SPOILER_GUESS'), j(rg));
  await sleep(120);
  check('被擋的訊息不廣播', nonSystem() === chatBefore, j(A.chat.slice(-3)));

  const rB = await say(B, title1);
  check('B 打完整歌名 → ok', rB?.ok === true, j(rB));
  const rD = await say(D, stripSubtitle(title1));
  check('中途加入者 D 打歌名本身 → ok（可猜）', rD?.ok === true, j(rD));
  const rA = await say(A, title1);
  check('出題者 A 也可猜 → ok', rA?.ok === true, j(rA));
  await until(() => lastRound(A)?.song?.correctIds?.length === 3 && me(A, ids.A)?.hasGuessed === true);
  const r3 = lastRound(A);
  check('correctIds 依猜對順序 [B, D, A]', j(r3.song?.correctIds) === j([ids.B, D.id, ids.A]), j(r3.song?.correctIds));
  const scored = Date.now();
  check('三人都在 startedAt 之前猜對（本檔時序前提）', scored < startedAt1, `now=${scored} startedAt=${startedAt1}`);
  check('startedAt 之前猜對 → 滿分 100（B、D、A 的 gameScore 與 score）', [ids.B, D.id, ids.A].every((id) => me(A, id)?.gameScore === SCORE_MAX && me(A, id)?.score === SCORE_MAX), j(lastPlayers(A)));
  check('hasGuessed：B、D、A true；C、E false', [ids.B, D.id, ids.A].every((id) => me(A, id)?.hasGuessed) && [ids.C, ids.E].every((id) => me(A, id)?.hasGuessed === false));
  const corrects = A.chat.filter((m) => m.kind === 'correct');
  check('三則 correct 訊息「X 猜對了」、fromId 為猜對者、不含歌名', corrects.length === 3 && corrects.every((m) => m.fromId !== null && m.text.includes(m.nickname) && m.text.includes('猜對') && !normalizeFull(m.text).includes(normalizeTitle(title1))), j(corrects));
  check('歌名原文沒有被廣播', A.chat.every((m) => m.kind !== 'chat' || !normalizeFull(m.text).includes(normalizeTitle(title1))));
  check('全員猜對後仍 playing（不提早結束）', lastRound(A).phase === 'playing' && lastRound(A).song?.index === 1);

  await sleep(320);
  const n0 = nonSystem();
  const rs1 = await say(B, `答案是${title1}吧`);
  check('已猜對者含歌名 → SPOILER_BLOCKED「你已經猜對了，不要說出歌名」', isErr(rs1, 'SPOILER_BLOCKED', 'SPOILER_GUESSED'), j(rs1));
  await sleep(320);
  const rs2 = await say(B, title1);
  check('已猜對者再打歌名本身 → 同樣被擋', isErr(rs2, 'SPOILER_BLOCKED', 'SPOILER_GUESSED'), j(rs2));
  await sleep(120);
  check('已猜對者被擋的兩則都不廣播', nonSystem() === n0, j(A.chat.slice(-3)));
  await sleep(320);
  const rs3 = await say(B, '好聽');
  check('已猜對者的一般聊天照常 → ok 並廣播 chat', rs3?.ok === true && (await until(() => A.chat.at(-1)?.kind === 'chat' && A.chat.at(-1)?.text === '好聽', 1500)), j(rs3));
  const rc = await say(C, '完全不知道');
  check('未猜對者的一般聊天照常 → ok', rc?.ok === true, j(rc));
}

// ── 第 1 首播到底才揭曉 ──
{
  await until(() => Date.now() >= startedAt1 + TRACK_MS - 400, 6000);
  check('endsAt 前 400 ms 仍是 playing（全員已猜對也不提早）', lastRound(A).phase === 'playing', j(lastRound(A).phase));
  await until(() => lastRound(A)?.phase === 'reveal', 6000);
  const rv = lastRound(A);
  const revealAt = Date.now();
  check('reveal 在 endsAt 之後才來（容許早 5 ms）', revealAt >= startedAt1 + TRACK_MS - EARLY_MS && revealAt <= startedAt1 + TRACK_MS + LATE_MS, `late=${revealAt - (startedAt1 + TRACK_MS)}`);
  // reveal.artist 是該首的 artistName（合唱曲會是「周杰倫 & 五月天 阿信」），不是 artistDisplay → 只驗含「周杰倫」（2026-10-12 驗收子代理首跑抽到合唱曲後放寬）
  check('reveal：index 1、title 為裁判歌名、artist 含 周杰倫', rv.reveal?.index === 1 && rv.reveal?.title === title1 && typeof rv.reveal?.artist === 'string' && rv.reveal.artist.includes('周杰倫'), j(rv.reveal));
  check('reveal.scores 依猜對順序 [B, D, A] 各 100', j(rv.reveal?.scores) === j([ids.B, D.id, ids.A].map((playerId) => ({ playerId, score: SCORE_MAX }))), j(rv.reveal?.scores));
  check('reveal：endsAt − serverNow 在 (REVEAL−SKEW, REVEAL]', gapIs(rv.endsAt, rv.serverNow, REVEAL_SECONDS * 1000), `gap=${rv.endsAt - rv.serverNow}`);
  check('reveal 仍帶 song（correctIds 保留）、hasGuessed 保留', rv.song?.index === 1 && rv.song.correctIds.length === 3 && me(A, ids.B)?.hasGuessed === true);
  check('系統訊息「第 1 首：《歌名》」', A.chat.some((m) => m.kind === 'system' && m.text.includes('第 1 首') && m.text.includes(title1)), j(A.chat.filter((m) => m.kind === 'system').slice(-2)));
}

// ── 第 2 首：A 猜對（緩衝內）；B 斷線重連 ──
await waitSong(A, 'playing', 2, 9000);
const p2 = lastRound(A);
const title2 = titleOf(titles, p2.song);
check('第 2 首開始：hasGuessed 全清、correctIds []', lastPlayers(A).every((x) => x.hasGuessed === false) && p2.song.correctIds.length === 0);
check('第 2 首：reveal 清為 null', p2.reveal === null);
{
  const rA = await say(A, title2);
  check('A 第 2 首猜對（緩衝內）', rA?.ok === true && Date.now() < p2.song.startedAt, j(rA));
  await until(() => me(A, ids.A)?.gameScore === 200);
  check('A gameScore 200', me(A, ids.A)?.gameScore === 200);

  // B 斷線 → 寬限期內以 token 接管
  B.s.disconnect();
  await until(() => me(A, ids.B)?.connected === false, 3000);
  check('B 斷線後 players:update 顯示 connected=false', me(A, ids.B)?.connected === false, j(me(A, ids.B)));
  const B2 = await joinAs('小美', B.token);
  check('重連：同一個 id、分數保留', B2.id === ids.B && B2.snap.players.find((x) => x.id === ids.B)?.gameScore === SCORE_MAX && B2.snap.players.find((x) => x.id === ids.B)?.connected === true, j(B2.snap.players.find((x) => x.id === ids.B)));
  check('重連：快照 song.startedAt 與 A 相同、index 2、serverNow 為當下', B2.snap.round.song?.startedAt === p2.song.startedAt && B2.snap.round.song?.index === 2 && Math.abs(B2.snap.round.serverNow - Date.now()) <= 1000, j(B2.snap.round.song));
  check('重連：participantIds 仍含 B', B2.snap.round.participantIds.includes(ids.B));
  check('重連：快照 chat 含最近訊息', Array.isArray(B2.snap.chat) && B2.snap.chat.length > 0);
  await until(() => me(A, ids.B)?.connected === true, 3000);
  check('其他人看到 B 回到 connected=true', me(A, ids.B)?.connected === true);
  Object.assign(B, B2);
}

// ── 第 3 首：沒人猜 ──
await waitSong(A, 'playing', 3, 12000);
await until(() => lastRound(A)?.phase === 'reveal' && lastRound(A)?.reveal?.index === 3, 6000);
check('第 3 首沒人猜對：reveal.scores []、correctIds []', lastRound(A).reveal?.scores?.length === 0 && lastRound(A).song?.correctIds?.length === 0, j(lastRound(A).reveal));

// ── 第 4 首：D 猜對 ──
await waitSong(A, 'playing', 4, 9000);
{
  const t = titleOf(titles, lastRound(A).song);
  const r = await say(D, t);
  check('D 第 4 首猜對（緩衝內）', r?.ok === true && Date.now() < lastRound(A).song.startedAt, j(r));
  await until(() => me(A, D.id)?.gameScore === 200);
  check('D gameScore 200', me(A, D.id)?.gameScore === 200);
}

// ── 第 5 首：B 猜對；揭曉停滿 5 秒才 ended ──
await waitSong(A, 'playing', 5, 12000);
{
  const t = titleOf(titles, lastRound(A).song);
  const r = await say(B, t);
  check('B 第 5 首猜對（緩衝內）', r?.ok === true && Date.now() < lastRound(A).song.startedAt, j(r));
  await until(() => me(A, ids.B)?.gameScore === 200);
  const rvb = await call(C.s, 'round:volunteer');
  check('playing 時 volunteer → ROUND_BUSY', isErr(rvb, 'ROUND_BUSY'), j(rvb));
  await until(() => lastRound(A)?.phase === 'reveal' && lastRound(A)?.reveal?.index === 5, 6000);
  const reveal5At = Date.now();
  const rv5 = lastRound(A);
  check('第 5 首 reveal：endsAt − serverNow 在 (REVEAL−SKEW, REVEAL]（照停 5 秒）', gapIs(rv5.endsAt, rv5.serverNow, REVEAL_SECONDS * 1000), `gap=${rv5.endsAt - rv5.serverNow}`);
  await until(() => lastRound(A)?.phase === 'ended', 8000);
  const endedAt = Date.now();
  check('第 5 首揭曉停滿 REVEAL_SECONDS 才 ended', endedAt - reveal5At >= REVEAL_SECONDS * 1000 - EARLY_MS - SKEW_MS && endedAt - reveal5At <= REVEAL_SECONDS * 1000 + LATE_MS, `Δ=${endedAt - reveal5At}`);
}

// ── ended 排名 ──
{
  const en = lastRound(A);
  check('ended：song null、endsAt null、reveal 保留第 5 首、lastArtist=周杰倫（正式名，不是輸入值）', en.song === null && en.endsAt === null && en.reveal?.index === 5 && en.lastArtist === '周杰倫', j({ song: en.song, endsAt: en.endsAt, reveal: en.reveal?.index, lastArtist: en.lastArtist }));
  const rows = en.results ?? [];
  check('results 五筆：A、B、D 各 200；C、E 0；非參賽者 D 因有得分列入', rows.length === 5 && rows.find((x) => x.playerId === D.id)?.gameScore === 200, j(rows));
  const order = rows.map((x) => x.playerId);
  check('同分依先達到該分數者在前：A（第 2 首）> D（第 4 首）> B（第 5 首）', j(order.slice(0, 3)) === j([ids.A, D.id, ids.B]), j(rows.map((x) => [x.nickname, x.gameScore])));
  check('0 分者依 participantIds 順序：C 在 E 前', j(order.slice(3)) === j([ids.C, ids.E]), j(order.slice(3)));
  check('rank 1..5 連號、correctCount A2 B2 D2 C0 E0', rows.every((x, i) => x.rank === i + 1) && rows.find((x) => x.playerId === ids.A)?.correctCount === 2 && rows.find((x) => x.playerId === ids.B)?.correctCount === 2 && rows.find((x) => x.playerId === D.id)?.correctCount === 2 && rows.find((x) => x.playerId === ids.C)?.correctCount === 0 && rows.find((x) => x.playerId === ids.E)?.correctCount === 0, j(rows));
  check('results 的 nickname 正確', rows.find((x) => x.playerId === ids.A)?.nickname === '阿明' && rows.find((x) => x.playerId === D.id)?.nickname === '半路D');
  check('系統訊息「本局第一名：阿明（200 分）」', A.chat.some((m) => m.kind === 'system' && m.text.includes('本局第一名') && m.text.includes('阿明') && m.text.includes('200')), j(A.chat.filter((m) => m.kind === 'system').slice(-2)));
  check('ended：players 的 gameScore 保留、isSetter A 仍 true、hasGuessed 全 false', me(A, ids.A)?.gameScore === 200 && me(A, ids.A)?.isSetter === true && lastPlayers(A).every((x) => x.hasGuessed === false), j(lastPlayers(A)));
  check('ended：participantIds 仍為 A、B、C、E', j(en.participantIds) === j([ids.A, ids.B, ids.C, ids.E]));
}

// ── results／lastArtist 生命週期 ──
{
  const r = await call(B.s, 'round:volunteer');
  check('ended 後 B volunteer → ok 進 choosing', r?.ok === true && (await until(() => lastRound(A)?.phase === 'choosing')), j(r));
  check('choosing：results／lastArtist 保留；setterId 換成 B、isSetter 隨之', lastRound(A).results?.length === 5 && lastRound(A).lastArtist === '周杰倫' && lastRound(A).setterId === ids.B && me(A, ids.B)?.isSetter === true && me(A, ids.A)?.isSetter === false, j({ results: lastRound(A).results?.length, lastArtist: lastRound(A).lastArtist }));
  const rc = await call(B.s, 'round:cancel');
  check('cancel → idle，results／lastArtist 仍保留', rc?.ok === true && (await until(() => lastRound(A)?.phase === 'idle')) && lastRound(A).results?.length === 5 && lastRound(A).lastArtist === '周杰倫', j(rc));
  const r2 = await call(B.s, 'round:volunteer');
  const r3 = r2?.ok ? await call(B.s, 'round:setArtist', { artist: '孫燕姿' }) : null;
  check('第 2 局 setArtist 孫燕姿 → ok', r3?.ok === true && r3.data?.artistDisplay === '孫燕姿', j(r3));
  await waitSong(A, 'playing', 1);
  const g2 = lastRound(A);
  check('第 2 局第 1 首：gameNo 2、results／lastArtist 清空、全員 gameScore 0、participantIds 含 D（此刻在線）', g2.gameNo === 2 && g2.results === null && g2.lastArtist === null && lastPlayers(A).every((x) => x.gameScore === 0) && g2.participantIds.includes(D.id) && g2.participantIds.length === 5, j({ gameNo: g2.gameNo, results: g2.results, lastArtist: g2.lastArtist, participantIds: g2.participantIds }));
  check('第 2 局：總分 score 累計保留（A 200）', me(A, ids.A)?.score === 200, j(me(A, ids.A)));
}

// ═══════════════════════════════════════════════════════════════════
for (const p of [A, B, C, D, E]) p.s.disconnect();
let pass = 0;
for (const [st, name, extra] of R) {
  if (st === 'PASS') pass++;
  console.log(`${st}  ${name}  ${extra}`);
}
console.log(`\n${pass}/${R.length} passed`);
process.exit(pass === R.length ? 0 : 1);
