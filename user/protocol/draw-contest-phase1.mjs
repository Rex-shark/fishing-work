// 繪圖比賽協定符合性測試（Epic 14 Phase 1 範圍）：只依 spec/draw-contest/architecture.md §4／§5 打 Socket，不看實作、不 import server 內部程式。
// 涵蓋 §8 清單：加入／我出題／出題／取消／作畫／交卷（含 PNG 驗證）／評分／揭曉／排名／總分／中途加入補收畫廊／重連／聊天／ack 文案（§5.4）；
// RoundPublic.lastTopic 生命週期（§4／§5：初始 null、drawing 為 null、ended＝本回合題目、下一回合 choosing 保留、drawing 清空；2026-10-07 補）。
//
// 用法（專案根目錄，需先 npm run build；隔離埠且只綁本機；**每次都要全新的 server 程序**，房間狀態在記憶體）：
//   HOST=127.0.0.1 PORT=3196 JUDGE=random JUDGE_FAKE_DELAY_MS=0 node server/dist/index.js &
//   TEST_PORT=3196 node --input-type=module < user/protocol/draw-contest-phase1.mjs
// 快速段總時長約 5 秒；全部 PASS 時 exit 0。
//
// 慢速段（選用，TEST_SLOW=1）：逾時交卷、SUBMIT_GRACE_SECONDS 寬限內補交、寬限過後才揭曉、未交卷者 0 分／null／排名接在後面。
// 協定測試連的是外部已啟動的 server（node server/dist/index.js），目前沒有縮短回合時間的環境變數
// （server 的 AppOptions.durations 只給 Vitest e2e 用）→ **待 Phase 0 決定縮時方式**；在那之前慢速段等真實的
// DRAW_SECONDS（120 秒）＋ 寬限 5 秒，總時長約 2 分 15 秒：
//   TEST_SLOW=1 TEST_PORT=3196 node --input-type=module < user/protocol/draw-contest-phase1.mjs
// 未涵蓋（同樣待縮時方式或另案）：CHOOSING_SECONDS 逾時回 idle、出題者寬限期滿離開、參賽者寬限期滿離開（佇列丟棄、results=[]）、ROOM_FULL。
//
// 草稿：帆（Sail）派出的子代理 2026-10-07 依 spec 撰寫；server 端接線（Phase 0）前跑不起來屬預期。
import { io } from 'socket.io-client';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const PORT = process.env.TEST_PORT ?? '3196';
const SLOW = process.env.TEST_SLOW === '1';
const URL = `http://127.0.0.1:${PORT}/draw-contest`;

// ── 常數：.mjs 不能 import .ts，照既有協定測試慣例寫死；出處 shared/src/draw-contest/constants.ts（spec §4 常數表）──
const DRAW_SECONDS = 120;
const CHOOSING_SECONDS = 60;
const SUBMIT_GRACE_SECONDS = 5;
const CHAT_MAX = 200;
const CHAT_MIN_INTERVAL_MS = 300;
const NICKNAME_MAX = 12;
const TOPIC_MAX = 20;
const SCORE_MAX = 100;
const CANVAS_LOGICAL = { width: 1280, height: 720 };
const MAX_SUBMISSION_BYTES = 2_097_152;

// ── ack.message 文案：§5.4 表；「其餘與我畫你猜同文案」者出處標在右側 ──
const MSG = {
  ROUND_BUSY: '目前已有回合進行中',
  NOT_SETTER: '只有本回合的出題者可以這麼做',
  NOT_ENOUGH_PLAYERS: '至少要 2 位在線玩家才能開始',
  NOT_DRAWING: '現在不是作畫時間',
  NOT_PARTICIPANT: '你不是本回合的參賽者',
  ALREADY_SUBMITTED: '你已經交卷了',
  SUBMISSION_INVALID: '圖片格式不正確或太大',
  NICKNAME_INVALID: `暱稱需為 1～${NICKNAME_MAX} 個字，且不可含控制字元`, // shared/src/draw-contest/nickname.ts（同 draw-guess）
  NICKNAME_TAKEN: '這個暱稱已經有人使用', // 同上
  TOPIC_INVALID: `題目需為 1～${TOPIC_MAX} 個字，不可含控制字元，也不能只有空白`, // shared/src/draw-contest/text.ts（同 draw-guess topic.ts）
  MESSAGE_INVALID: `訊息需為 1～${CHAT_MAX} 個字，不可含換行等控制字元，也不能只有空白`, // server/src/games/draw-guess/chat.ts
  RATE_LIMITED: `發言太快了，請稍候再送（間隔至少 ${CHAT_MIN_INTERVAL_MS / 1000} 秒）`, // 同上
  NOT_IN_ROOM: '請先加入房間', // server/src/games/draw-guess/room.ts ROUND_ERROR_MESSAGES
};

// ── 測試框架（同 draw-guess-*.mjs）──
const R = [];
const check = (name, cond, extra = '') => R.push([cond ? 'PASS' : 'FAIL', name, extra]);
const connect = () => io(URL, { path: '/socket.io', transports: ['websocket'], forceNew: true, reconnection: false });
const call = (s, ev, ...args) => new Promise((res) => s.emit(ev, ...args, res));
const once = (s, ev, ms = 4000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), ms); s.once(ev, (...a) => { clearTimeout(t); res(a); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const collect = (s, ev) => { const arr = []; s.on(ev, (p) => arr.push(p)); return arr; };
/** 輪詢條件直到成立或逾時；回傳是否成立 */
const until = async (pred, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(20); } return pred(); };
/** 錯誤 ack 的錯誤碼與 §5.4 文案一起檢查 */
const isErr = (r, code) => r?.ok === false && r.error === code && r.message === MSG[code];
const j = (x) => JSON.stringify(x)?.slice(0, 300);
const ab = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const bytesOf = (d) => Buffer.from(d instanceof ArrayBuffer ? new Uint8Array(d) : d);
const sha = (d) => createHash('sha256').update(bytesOf(d)).digest('hex').slice(0, 12);
const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
/** 每個 socket 都先掛好收集器再 join（中途加入者的補收畫廊在 join ack 之後抵達） */
const joinAs = async (nick, token) => {
  const s = connect(); await once(s, 'connect');
  const seq = [];
  const rounds = collect(s, 'round:update'), players = collect(s, 'players:update'), chat = collect(s, 'chat:message');
  const gallery = [];
  s.on('contest:gallery', (g) => { gallery.push(g); seq.push('gallery'); });
  const r = await new Promise((res) => s.emit('player:join', token ? { nickname: nick, token } : { nickname: nick }, (x) => { seq.push('ack'); res(x); }));
  if (!r?.ok) throw new Error('join failed ' + j(r));
  return { s, id: r.data.snapshot.you, token: r.data.token, snap: r.data.snapshot, seq, rounds, players, chat, gallery };
};
const lastRound = (p) => p.rounds.at(-1);
const lastPlayers = (p) => p.players.at(-1);
const waitPhase = (p, phase, ms = 4000) => until(() => lastRound(p)?.phase === phase, ms);

// ── PNG 產生器（node:zlib 壓 IDAT，CRC32 自算）──
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/**
 * 產生合法 PNG（8-bit RGB、無交錯）。seed 決定底色與斜紋，不同 seed → 不同 bytes。
 * padTo：插入 tEXt 輔助 chunk 把整檔補到剛好 padTo bytes（結構仍合法），用來測大小上限。
 */
const makePng = (width, height, seed, padTo) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const bg = [0x1e, 0x1e, 0x1e];   // CANVAS_BACKGROUND
  const ink = [(seed * 73) & 0xff, (seed * 151) & 0xff, (seed * 199) & 0xff];
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;   // filter: None
    for (let x = 0; x < width; x++) {
      const on = (x + y * (seed + 1)) % (17 + seed) < 3;   // seed 決定斜紋的斜率與間距
      const c = on ? ink : bg;
      const o = y * stride + 1 + x * 3;
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2];
    }
  }
  const head = Buffer.concat([PNG_MAGIC, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw))]);
  const iend = chunk('IEND', Buffer.alloc(0));
  if (padTo === undefined) return Buffer.concat([head, iend]);
  const keyword = Buffer.from('Comment\0', 'latin1');
  const fill = padTo - head.length - iend.length - 12 - keyword.length;
  if (fill < 0) throw new Error('padTo 太小');
  return Buffer.concat([head, chunk('tEXt', Buffer.concat([keyword, Buffer.alloc(fill, 0x61)])), iend]);
};
const W = CANVAS_LOGICAL.width, H = CANVAS_LOGICAL.height;
const pngA1 = makePng(W, H, 1), pngB1 = makePng(W, H, 2), pngC = makePng(W, H, 3);
const pngA2 = makePng(W, H, 4), pngB2 = makePng(W, H, 5), pngA3 = makePng(W, H, 6), pngC3 = makePng(W, H, 7);
const pngMaxOk = makePng(W, H, 8, MAX_SUBMISSION_BYTES);              // 剛好上限 → 合法
const pngTooBig = makePng(W, H, 9, MAX_SUBMISSION_BYTES + 1);         // 超過上限 1 byte
const pngBadMagic = Buffer.from(pngA1); pngBadMagic[0] = 0x88;        // 錯 magic
const png640 = makePng(640, 480, 10);                                 // 尺寸不符 CANVAS_LOGICAL
const submit = (p, png) => call(p.s, 'contest:submit', { png: ab(png) });

/** §5.2 排名規則檢查：交卷者在前（score 降冪、同分 submittedAt 升冪），未交卷者依 participantIds 接在後面；rank 1..n 連續 */
const rankingOk = (round) => {
  const rs = round.results ?? [];
  const n = rs.filter((e) => e.submitted).length;
  if (!rs.every((e, i) => e.rank === i + 1)) return 'rank 不連續';
  if (!rs.slice(0, n).every((e) => e.submitted) || rs.slice(n).some((e) => e.submitted)) return '未交卷者沒有排在交卷者之後';
  for (let i = 1; i < n; i++) {
    const a = rs[i - 1], b = rs[i];
    if (!(a.score > b.score || (a.score === b.score && a.submittedAt <= b.submittedAt))) return `交卷者排序錯：${j([a, b])}`;
  }
  const unOrder = rs.slice(n).map((e) => e.playerId);
  const expect = round.participantIds.filter((id) => unOrder.includes(id));
  if (unOrder.join() !== expect.join()) return '未交卷者未依 participantIds 順序';
  return 'ok';
};
const submittedEntryOk = (e) => e.submitted === true && e.judgedBy === 'random' && Number.isInteger(e.score) && e.score >= 0 && e.score <= SCORE_MAX
  && typeof e.confidence === 'number' && e.confidence >= 0 && e.confidence <= 1 && typeof e.submittedAt === 'number' && typeof e.nickname === 'string';
const unsubmittedEntryOk = (e) => e.submitted === false && e.score === 0 && e.confidence === null && e.judgedBy === null && e.submittedAt === null;
/** 總分帳本：每個 ended 依 results 累加，與 players:update 比對（§5.2 每位參賽者 player.score += entry.score） */
const totals = new Map();
const addTotals = (round) => { for (const e of round.results ?? []) totals.set(e.playerId, (totals.get(e.playerId) ?? 0) + e.score); };
const totalsOk = (players) => [...totals].every(([id, sc]) => players?.find((p) => p.id === id)?.score === sc);

const sockets = [];
try {
  // ════════ 1. 加入 ════════
  const A = await joinAs('Alice'); sockets.push(A.s);
  check('全新 server：快照只有自己、roundNo 0、idle、setterId／topic／results null', A.snap.players.length === 1 && A.snap.round.roundNo === 0 && A.snap.round.phase === 'idle' && A.snap.round.setterId === null && A.snap.round.topic === null && A.snap.round.results === null, j(A.snap.round));
  check('lastTopic：從未開始為 null', A.snap.round.lastTopic === null, j(A.snap.round.lastTopic));
  if (A.snap.players.length !== 1) throw new Error('需要全新的 server 程序（房間已有其他玩家）');
  const meA = A.snap.players.find((p) => p.id === A.id);
  check('join ok：token 為字串、player id 不是 socket.id', typeof A.token === 'string' && A.id !== A.s.id);
  check('PlayerPublic 欄位齊全（score 0、connected、isSetter／participating／submitted false）', meA?.nickname === 'Alice' && meA.score === 0 && meA.connected === true && typeof meA.joinedAt === 'number' && meA.isSetter === false && meA.participating === false && meA.submitted === false, j(meA));
  check('RoundPublic 初始欄位（participantIds []、計數 0、judgeMode null）', Array.isArray(A.snap.round.participantIds) && A.snap.round.participantIds.length === 0 && A.snap.round.submittedCount === 0 && A.snap.round.judgedCount === 0 && A.snap.round.judgeMode === null, j(A.snap.round));
  check('快照含「加入」system 訊息', A.snap.chat.some((m) => m.kind === 'system' && m.fromId === null && m.text.includes('Alice')));

  const X = connect(); await once(X, 'connect'); sockets.push(X);
  for (const [nick, name] of [['   ', '全空白'], ['x'.repeat(NICKNAME_MAX + 1), `${NICKNAME_MAX + 1} 字`], ['Bo\tb', '控制字元'], [123, '非字串']]) {
    const r = await call(X, 'player:join', { nickname: nick });
    check(`暱稱${name} → NICKNAME_INVALID（文案）`, isErr(r, 'NICKNAME_INVALID'), j(r));
  }
  const rDup = await call(X, 'player:join', { nickname: 'ＡＬＩＣＥ' });
  check('暱稱重複（全形＋大小寫）→ NICKNAME_TAKEN（文案）', isErr(rDup, 'NICKNAME_TAKEN'), j(rDup));
  const rNir = await call(X, 'round:volunteer');
  check('未加入就 volunteer → NOT_IN_ROOM（文案）', isErr(rNir, 'NOT_IN_ROOM'), j(rNir));
  const rSub0 = await submit(A, pngA1);
  check('idle 時交卷 → NOT_DRAWING（文案）', isErr(rSub0, 'NOT_DRAWING'), j(rSub0));

  // ════════ 2. 我出題 ════════
  const rv1 = await call(A.s, 'round:volunteer');
  check('單人 volunteer → NOT_ENOUGH_PLAYERS（文案）', isErr(rv1, 'NOT_ENOUGH_PLAYERS'), j(rv1));
  const B = await joinAs('Bob'); sockets.push(B.s);
  await until(() => lastPlayers(A)?.length === 2);
  check('B 加入後 A 收到 players:update（2 人）', lastPlayers(A)?.length === 2);
  const rt0 = await call(B.s, 'round:setTopic', { topic: '狗' });
  check('idle 時 setTopic → NOT_SETTER（文案）【spec 未明列 idle 情境，見檔頭】', isErr(rt0, 'NOT_SETTER'), j(rt0));

  const t0 = Date.now();
  const rv2 = await call(A.s, 'round:volunteer');
  check('volunteer ok', rv2?.ok === true, j(rv2));
  await waitPhase(B, 'choosing');
  const ch = lastRound(B);
  check('choosing：setterId=A、topic null、roundNo 仍 0、endsAt≈now+CHOOSING_SECONDS', ch?.phase === 'choosing' && ch.setterId === A.id && ch.topic === null && ch.roundNo === 0 && Math.abs(ch.endsAt - (t0 + CHOOSING_SECONDS * 1000)) < 2000, j(ch));
  await until(() => lastPlayers(B)?.find((p) => p.id === A.id)?.isSetter === true);
  check('players:update 帶 isSetter=true', lastPlayers(B)?.find((p) => p.id === A.id)?.isSetter === true);
  const rv3 = await call(B.s, 'round:volunteer');
  check('choosing 時 volunteer → ROUND_BUSY（文案）', isErr(rv3, 'ROUND_BUSY'), j(rv3));
  const rSub1 = await submit(A, pngA1);
  check('choosing 時交卷 → NOT_DRAWING', isErr(rSub1, 'NOT_DRAWING'), j(rSub1));

  // ════════ 3. 出題錯誤與取消 ════════
  const rt1 = await call(B.s, 'round:setTopic', { topic: '狗' });
  check('非出題者 setTopic → NOT_SETTER（文案）', isErr(rt1, 'NOT_SETTER'), j(rt1));
  for (const [topic, name] of [['   ', '全空白'], ['x'.repeat(TOPIC_MAX + 1), `${TOPIC_MAX + 1} 字`], ['ａｂ\tc', '控制字元']]) {
    const r = await call(A.s, 'round:setTopic', { topic });
    check(`題目${name} → TOPIC_INVALID（文案）`, isErr(r, 'TOPIC_INVALID'), j(r));
  }
  const rc1 = await call(B.s, 'round:cancel');
  check('非出題者 cancel → NOT_SETTER', isErr(rc1, 'NOT_SETTER'), j(rc1));
  const rc2 = await call(A.s, 'round:cancel');
  await waitPhase(B, 'idle');
  check('出題者 cancel → idle、setterId null、roundNo 仍 0', rc2?.ok === true && lastRound(B)?.phase === 'idle' && lastRound(B).setterId === null && lastRound(B).roundNo === 0, j(lastRound(B)));
  const rc3 = await call(A.s, 'round:cancel');
  check('idle 時 cancel → 錯誤 ack', rc3?.ok === false, j(rc3));

  // ════════ 4. 出題成功 → drawing（題目公開、參賽者＝在線者含出題者）════════
  await call(A.s, 'round:volunteer');
  await waitPhase(B, 'choosing');
  const t1 = Date.now();
  const rt2 = await call(A.s, 'round:setTopic', { topic: ' 蘋果 ' });
  check('setTopic ok', rt2?.ok === true, j(rt2));
  await waitPhase(A, 'drawing'); await waitPhase(B, 'drawing');
  const dA = lastRound(A), dB = lastRound(B);
  check('drawing：題目對所有人公開（含非出題者，去頭尾空白）', dA?.topic === '蘋果' && dB?.topic === '蘋果', j([dA?.topic, dB?.topic]));
  check('drawing：roundNo 0→1、startedAt 有值、endsAt≈now+DRAW_SECONDS', dB?.roundNo === 1 && typeof dB.startedAt === 'number' && Math.abs(dB.endsAt - (t1 + DRAW_SECONDS * 1000)) < 2000, j(dB));
  check('drawing：participantIds＝在線者（含出題者 A）', sameSet(dB?.participantIds ?? [], [A.id, B.id]), j(dB?.participantIds));
  check('drawing：submittedCount／judgedCount 0、results null', dB?.submittedCount === 0 && dB.judgedCount === 0 && dB.results === null, j(dB));
  check('lastTopic：drawing 為 null（第一回合）', dA?.lastTopic === null && dB?.lastTopic === null, j([dA?.lastTopic, dB?.lastTopic]));
  await until(() => lastPlayers(B)?.every((p) => p.participating === true));
  check('players:update：A、B participating true、submitted false', lastPlayers(B)?.every((p) => p.participating === true && p.submitted === false), j(lastPlayers(B)));
  await until(() => B.chat.some((m) => m.kind === 'system' && m.text.includes('蘋果')));
  check('system 訊息「回合開始」含題目', B.chat.some((m) => m.kind === 'system' && m.text.includes('蘋果')), j(B.chat.map((m) => m.text)));
  const rv4 = await call(B.s, 'round:volunteer');
  check('drawing 時 volunteer → ROUND_BUSY', isErr(rv4, 'ROUND_BUSY'), j(rv4));

  // ════════ 5. 中途加入者（旁觀）════════
  const C = await joinAs('Carol'); sockets.push(C.s);
  check('中途加入：快照 phase drawing、題目公開、participantIds 不含自己', C.snap.round.phase === 'drawing' && C.snap.round.topic === '蘋果' && !C.snap.round.participantIds.includes(C.id), j(C.snap.round));
  check('中途加入：自己 participating false', C.snap.players.find((p) => p.id === C.id)?.participating === false);
  const rC1 = await submit(C, pngC);
  check('中途加入者交卷 → NOT_PARTICIPANT（文案）', isErr(rC1, 'NOT_PARTICIPANT'), j(rC1));

  // ════════ 6. 交卷驗證（§5.1）════════
  for (const [png, name] of [[pngBadMagic, '錯 magic'], [png640, '640×480'], [pngTooBig, `超過 MAX_SUBMISSION_BYTES（${pngTooBig.length} bytes）`], [Buffer.alloc(0), '0 bytes']]) {
    const r = await submit(A, png);
    check(`交卷 ${name} → SUBMISSION_INVALID（文案）`, isErr(r, 'SUBMISSION_INVALID'), j(r));
  }
  for (const [payload, name] of [[null, 'payload null'], [{ png: 'iVBORw0KGgo=' }, 'png 為字串'], [{}, '缺 png']]) {
    const r = await call(A.s, 'contest:submit', payload);
    check(`交卷 ${name} → SUBMISSION_INVALID`, r?.ok === false && r.error === 'SUBMISSION_INVALID', j(r));
  }
  check('不合法交卷不計入 submittedCount', lastRound(B)?.submittedCount === 0, j(lastRound(B)));

  // ════════ 7. 交卷成功、重複交卷、全員交卷提前結束 ════════
  const tSubA = Date.now();
  const rA1 = await submit(A, pngA1);
  check('A 交卷 ok，ack bytes＝檔案長度', rA1?.ok === true && rA1.data?.bytes === pngA1.length, j(rA1));
  await until(() => lastRound(B)?.submittedCount === 1);
  check('round:update submittedCount 1，仍在 drawing（B 未交）', lastRound(B)?.submittedCount === 1 && lastRound(B).phase === 'drawing', j(lastRound(B)));
  await until(() => lastPlayers(B)?.find((p) => p.id === A.id)?.submitted === true);
  check('players:update A submitted true', lastPlayers(B)?.find((p) => p.id === A.id)?.submitted === true);
  const rA2 = await submit(A, pngA2);
  check('重複交卷 → ALREADY_SUBMITTED（文案）', isErr(rA2, 'ALREADY_SUBMITTED'), j(rA2));

  const rB1 = await submit(B, pngB1);
  check('B 交卷 ok，ack bytes＝檔案長度', rB1?.ok === true && rB1.data?.bytes === pngB1.length, j(rB1));
  await waitPhase(C, 'ended', 5000);
  const phasesC = C.rounds.map((r) => r.phase);
  check('全員交卷 → 提前進 judging（不等 endsAt）', phasesC.includes('judging') && Date.now() - tSubA < 10_000, j(phasesC));
  check('全員交卷且佇列清空 → ended（不等寬限）', lastRound(C)?.phase === 'ended' && Date.now() - tSubA < 10_000, j(phasesC));
  const jc = C.rounds.filter((r) => r.roundNo === 1).map((r) => r.judgedCount);
  check('judgedCount 單調遞增、最後＝2', jc.every((v, i) => i === 0 || v >= jc[i - 1]) && jc.at(-1) === 2, j(jc));
  check('judging 起 judgeMode random', C.rounds.filter((r) => r.phase === 'judging' || r.phase === 'ended').every((r) => r.judgeMode === 'random'), j(C.rounds.map((r) => [r.phase, r.judgeMode])));

  // ════════ 8. 揭曉（results、排名、總分、畫廊）════════
  const e1 = lastRound(C);
  check('ended：roundNo 1、endsAt null、results 2 筆', e1.roundNo === 1 && e1.endsAt === null && e1.results?.length === 2, j(e1));
  check('lastTopic：judging 期間仍為 null', C.rounds.filter((r) => r.roundNo === 1 && r.phase === 'judging').every((r) => r.lastTopic === null), j(C.rounds.map((r) => [r.phase, r.lastTopic])));
  check('lastTopic：ended 等於本回合題目（去頭尾空白）', e1.lastTopic === '蘋果', j(e1.lastTopic));
  check('results 依 §5.2 排序、rank 1..n', rankingOk(e1) === 'ok', rankingOk(e1));
  check('交卷者欄位：judgedBy random、score 整數 0..100、confidence 0..1、submittedAt 有值', e1.results.every(submittedEntryOk), j(e1.results));
  check('random 評分器範圍：score 20..95、confidence 0.3..0.9（§6）', e1.results.every((e) => e.score >= 20 && e.score <= 95 && e.confidence >= 0.3 && e.confidence <= 0.9), j(e1.results));
  check('results 的 playerId／nickname 對應 A、B', sameSet(e1.results.map((e) => e.playerId), [A.id, B.id]) && e1.results.find((e) => e.playerId === A.id)?.nickname === 'Alice');
  addTotals(e1);
  await until(() => totalsOk(lastPlayers(B)));
  check('總分：players:update 的 score＝本回合得分', totalsOk(lastPlayers(B)), j(lastPlayers(B)?.map((p) => [p.nickname, p.score])));
  const g1ok = (p) => p.gallery.filter((g) => g.roundNo === 1).length === 2
    && sha(p.gallery.find((g) => g.playerId === A.id && g.roundNo === 1)?.png ?? []) === sha(pngA1)
    && sha(p.gallery.find((g) => g.playerId === B.id && g.roundNo === 1)?.png ?? []) === sha(pngB1);
  await until(() => [A, B, C].every(g1ok));
  check('每位交卷者一則 contest:gallery，roundNo 1、bytes 與交卷一致（A、B 與旁觀者 C 都收到）', [A, B, C].every(g1ok), j([A, B, C].map((p) => p.gallery.map((g) => [g.roundNo, g.playerId, bytesOf(g.png).length]))));
  const first = e1.results[0].nickname;
  await until(() => C.chat.some((m) => m.kind === 'system' && m.text.includes(first)));
  check('揭曉 system 訊息含第一名暱稱', C.chat.some((m) => m.kind === 'system' && m.text.includes(first) && m.text !== `${first} 加入`), j(C.chat.map((m) => m.text)));

  // ════════ 9. ended 後中途加入：補收畫廊 ════════
  const D = await joinAs('Dave'); sockets.push(D.s);
  check('ended 後加入：快照帶 results（roundNo 1）', D.snap.round.phase === 'ended' && D.snap.round.results?.length === 2 && D.snap.round.roundNo === 1, j(D.snap.round));
  check('ended 後加入：快照的 players score＝總分', totalsOk(D.snap.players));
  check('lastTopic：ended 後加入者的快照帶上一回合題目', D.snap.round.lastTopic === '蘋果', j(D.snap.round.lastTopic));
  await until(() => D.gallery.length >= 2);
  check('join ack 之後補收 2 則 contest:gallery（roundNo 1、bytes 一致）', g1ok(D) && D.seq[0] === 'ack', j(D.seq));

  // ════════ 10. 第二回合：ended 可 volunteer、roundNo 遞增、results 保留到 drawing、重連、同分排序、總分累加 ════════
  const rv5 = await call(B.s, 'round:volunteer');
  await waitPhase(C, 'choosing');
  check('ended 時 volunteer ok（視同 idle）', rv5?.ok === true, j(rv5));
  check('choosing 期間 results 保留', lastRound(C)?.results?.length === 2 && lastRound(C).roundNo === 1, j(lastRound(C)));
  check('lastTopic：下一回合 choosing 仍保留（topic 回 null）', lastRound(C)?.lastTopic === '蘋果' && lastRound(C).topic === null, j([lastRound(C)?.topic, lastRound(C)?.lastTopic]));
  const rt3 = await call(B.s, 'round:setTopic', { topic: '貓' });
  await waitPhase(C, 'drawing');
  const d2 = lastRound(C);
  check('第二回合 setTopic ok：roundNo 2、results 清空', rt3?.ok === true && d2.roundNo === 2 && d2.results === null && d2.topic === '貓', j(d2));
  check('lastTopic：下一回合 drawing 開始時清空', d2.lastTopic === null, j(d2.lastTopic));
  check('participantIds＝4 位在線者（含出題者 B）', sameSet(d2.participantIds, [A.id, B.id, C.id, D.id]), j(d2.participantIds));
  await until(() => lastPlayers(C)?.every((p) => p.participating && !p.submitted));
  check('players:update 全員 participating、submitted 重置', lastPlayers(C)?.every((p) => p.participating === true && p.submitted === false), j(lastPlayers(C)));

  // 重連：A 斷線 → 寬限期內帶 token 回來（id 不變、仍是參賽者、可交卷）
  A.s.disconnect();
  await until(() => lastPlayers(B)?.find((p) => p.id === A.id)?.connected === false);
  check('A 斷線：connected false（寬限期中仍在房、仍是參賽者）', lastPlayers(B)?.find((p) => p.id === A.id)?.connected === false && lastRound(B)?.participantIds.includes(A.id), j(lastPlayers(B)?.map((p) => [p.nickname, p.connected])));
  const A2 = await joinAs('ignored', A.token); sockets.push(A2.s);
  check('帶 token 接回：同 id、同 token、暱稱不變、connected true', A2.id === A.id && A2.token === A.token && A2.snap.players.find((p) => p.id === A.id)?.nickname === 'Alice' && A2.snap.players.find((p) => p.id === A.id)?.connected === true, j(A2.snap.players));
  check('接回快照：drawing、仍是參賽者、未交卷', A2.snap.round.phase === 'drawing' && A2.snap.round.participantIds.includes(A.id) && A2.snap.players.find((p) => p.id === A.id)?.participating === true && A2.snap.players.find((p) => p.id === A.id)?.submitted === false, j(A2.snap.round));
  // 接管：D 仍連線時 D2 帶 token 加入 → 舊 socket 被踢、id 不變
  const dDisc = once(D.s, 'disconnect');
  const D2 = await joinAs('ignored2', D.token); sockets.push(D2.s);
  const [reason] = await dDisc;
  check('token 接管：舊 socket 被伺服器踢掉、同 id', reason === 'io server disconnect' && D2.id === D.id, String(reason));

  // 交卷：B 與 C 交同一張圖 → random 同分（§6 確定性）→ 先交卷的 B 排前面
  const rB2 = await submit(B, pngB2);
  await sleep(50);
  const rC2 = await submit(C, pngB2);
  const rA3 = await submit(A2, pngA2);
  const rD2 = await submit(D2, pngMaxOk);
  check('第二回合 4 人交卷 ok（含接回的 A2）', [rB2, rC2, rA3].every((r) => r?.ok === true), j([rB2, rC2, rA3]));
  check(`剛好 MAX_SUBMISSION_BYTES（${MAX_SUBMISSION_BYTES}）的 PNG 合法，ack bytes 相符`, rD2?.ok === true && rD2.data?.bytes === MAX_SUBMISSION_BYTES, j(rD2));
  await waitPhase(C, 'ended', 8000);
  const e2 = lastRound(C);
  check('第二回合 ended：roundNo 2、results 4 筆、排序正確', e2?.phase === 'ended' && e2.roundNo === 2 && e2.results?.length === 4 && rankingOk(e2) === 'ok', `${rankingOk(e2 ?? {})} ${j(e2)}`);
  const eB = e2.results?.find((e) => e.playerId === B.id), eC = e2.results?.find((e) => e.playerId === C.id);
  check('lastTopic：第二回合 ended 換成新題目', e2?.lastTopic === '貓', j(e2?.lastTopic));
  check('同一張圖＋同題目 → 同分（random 確定性）；同分先交卷者在前', eB && eC && eB.score === eC.score && eB.rank < eC.rank, j([eB, eC]));
  check('第二回合 judgedCount＝4、全部 judgedBy random', e2.judgedCount === 4 && e2.results.every(submittedEntryOk), j(e2));
  addTotals(e2);
  await until(() => totalsOk(lastPlayers(B)));
  check('總分累加：A、B 為兩回合之和，C、D 為第二回合得分', totalsOk(lastPlayers(B)), j([lastPlayers(B)?.map((p) => [p.nickname, p.score]), [...totals]]));
  const g2ok = (p) => p.gallery.filter((g) => g.roundNo === 2).length === 4
    && sha(p.gallery.find((g) => g.playerId === D.id && g.roundNo === 2)?.png ?? []) === sha(pngMaxOk);
  await until(() => [A2, B, C, D2].every(g2ok), 8000);
  check('第二回合每位交卷者一則 gallery（roundNo 2，含 2 MiB 那張 bytes 一致）', [A2, B, C, D2].every(g2ok), j([A2, B, C, D2].map((p) => p.gallery.filter((g) => g.roundNo === 2).length)));

  // ════════ 11. 聊天（§5.3）════════
  const rm1 = await call(B.s, 'chat:send', { text: '  嗨大家  ' });
  await until(() => C.chat.some((m) => m.kind === 'chat' && m.fromId === B.id));
  const msg = C.chat.find((m) => m.kind === 'chat' && m.fromId === B.id);
  check('chat:send ok，所有人收到 chat:message（kind chat、去頭尾空白、fromId／nickname）', rm1?.ok === true && msg?.text === '嗨大家' && msg.nickname === 'Bob' && typeof msg.id === 'string' && typeof msg.at === 'number', j(msg));
  const rm2 = await call(B.s, 'chat:send', { text: '再一則' });
  check(`${CHAT_MIN_INTERVAL_MS} ms 內再送 → RATE_LIMITED（文案）`, isErr(rm2, 'RATE_LIMITED'), j(rm2));
  await sleep(CHAT_MIN_INTERVAL_MS + 100);
  const rm3 = await call(B.s, 'chat:send', { text: '   ' });
  check('全空白 → MESSAGE_INVALID（文案）', isErr(rm3, 'MESSAGE_INVALID'), j(rm3));
  await sleep(CHAT_MIN_INTERVAL_MS + 100);
  const rm4 = await call(B.s, 'chat:send', { text: 'x'.repeat(CHAT_MAX + 1) });
  check(`${CHAT_MAX + 1} 字 → MESSAGE_INVALID`, isErr(rm4, 'MESSAGE_INVALID'), j(rm4));
  await sleep(CHAT_MIN_INTERVAL_MS + 100);
  const rm5 = await call(B.s, 'chat:send', { text: 'x'.repeat(CHAT_MAX) });
  check(`剛好 ${CHAT_MAX} 字 → ok`, rm5?.ok === true, j(rm5));

  // ════════ 12. 慢速段（TEST_SLOW=1）：逾時、寬限補交、未交卷者 ════════
  if (SLOW) {
    await call(A2.s, 'round:volunteer');
    await waitPhase(C, 'choosing');
    await call(A2.s, 'round:setTopic', { topic: '樹' });
    await waitPhase(C, 'drawing');
    const d3 = lastRound(C);
    const rA4 = await submit(A2, pngA3);
    check('第三回合 A2 交卷 ok', rA4?.ok === true, j(rA4));
    console.error(`[慢速段] 等待 endsAt（約 ${DRAW_SECONDS} 秒）…`);
    await until(() => Date.now() > d3.endsAt + 300, DRAW_SECONDS * 1000 + 5000);
    await waitPhase(C, 'judging', 2000);
    check('endsAt 到 → judging（未全員交卷）', lastRound(C)?.phase === 'judging' && lastRound(C).roundNo === 3, j(lastRound(C)));
    await until(() => Date.now() > d3.endsAt + 1500, 3000);
    const rC4 = await submit(C, pngC3);
    check(`endsAt 後 ${SUBMIT_GRACE_SECONDS} 秒寬限內補交 → ok`, rC4?.ok === true && rC4.data?.bytes === pngC3.length, j(rC4));
    await waitPhase(C, 'ended', (SUBMIT_GRACE_SECONDS + 5) * 1000);
    const tEnded = Date.now();
    check('寬限過後才 ended（未全員交卷時須等 endsAt＋SUBMIT_GRACE_SECONDS）', lastRound(C)?.phase === 'ended' && tEnded >= d3.endsAt + SUBMIT_GRACE_SECONDS * 1000 - 300, `${tEnded - d3.endsAt} ms after endsAt`);
    const rB4 = await submit(B, pngB2);
    check('ended 後交卷（參賽者未交卷）→ NOT_DRAWING', isErr(rB4, 'NOT_DRAWING'), j(rB4));
    const e3 = lastRound(C);
    check('第三回合 results 4 筆、排序（未交卷者依 participantIds 接在後面）', e3.results?.length === 4 && rankingOk(e3) === 'ok', `${rankingOk(e3)} ${j(e3.results)}`);
    const un = e3.results.filter((e) => !e.submitted);
    check('未交卷者 B、D：score 0、confidence null、judgedBy null、submittedAt null、rank 3／4', sameSet(un.map((e) => e.playerId), [B.id, D.id]) && un.every(unsubmittedEntryOk) && un.map((e) => e.rank).join() === '3,4', j(un));
    check('交卷者 A、C 在前且欄位正確', e3.results.slice(0, 2).every(submittedEntryOk) && sameSet(e3.results.slice(0, 2).map((e) => e.playerId), [A.id, C.id]), j(e3.results.slice(0, 2)));
    check('submittedCount 2、judgedCount 2', e3.submittedCount === 2 && e3.judgedCount === 2, j(e3));
    addTotals(e3);
    await until(() => totalsOk(lastPlayers(B)));
    check('第三回合總分累加（未交卷者 +0）', totalsOk(lastPlayers(B)), j(lastPlayers(B)?.map((p) => [p.nickname, p.score])));
    await until(() => C.gallery.filter((g) => g.roundNo === 3).length >= 2);
    await sleep(300);
    check('gallery 只送交卷者（roundNo 3 共 2 則）', C.gallery.filter((g) => g.roundNo === 3).length === 2 && sameSet(C.gallery.filter((g) => g.roundNo === 3).map((g) => g.playerId), [A.id, C.id]));
  } else {
    check('慢速段（逾時交卷／寬限／未交卷者）略過：設 TEST_SLOW=1 執行（待 Phase 0 決定縮時方式）', true, 'skipped');
  }

  // ════════ 13. 不崩潰 ════════
  A2.s.emit('contest:submit', { png: ab(pngA1) });   // 不帶 ack
  B.s.emit('player:join', null, () => {});
  await sleep(300);
  const alive = await call(C.s, 'chat:send', { text: 'still alive' });
  check('壞 payload／不帶 ack 後 server 仍存活', C.s.connected && alive?.ok === true, j(alive));
} catch (err) {
  check('測試流程未預期中斷', false, String(err?.stack ?? err).slice(0, 400));
} finally {
  for (const s of sockets) s.disconnect();
}

console.log(R.map((r) => r.join('  ')).join('\n'));
const fails = R.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${R.length - fails}/${R.length} passed`);
process.exit(fails ? 1 : 0);
