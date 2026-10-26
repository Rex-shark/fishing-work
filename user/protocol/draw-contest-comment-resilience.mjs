// 繪圖比賽評語「韌性」協定符合性測試（Epic 15 Phase 5，決策 16）：只依 spec/draw-contest/architecture.md §5「評語」、§6.1「佇列」失敗規則打 Socket，不看實作。
// 既有 -fallback.mjs／-praise.mjs 用環境變數固定的假 Ollama，無法讓「同一回合裡某幾張逾時、其他張正常」；本檔**自帶一個可逐張控制的假 Ollama**
// （同一程序內，依圖片 base64 與「是否稱讚版」決定延遲與內容），精準排出 §6.1 的連續失敗計數情境：
//   回合 0（前置）：四張圖全部正常 → 得知 §6 random 評分下哪張最高分（之後安排它當第一名）、記下每張圖的批評句（假 Ollama 依圖決定，同圖永遠同句）。
//   回合 1（單次逾時不跳過）：揭曉時在途的 A 批評版逾時、其餘正常 → A 一則 { comment: null }；第一名稱讚句、其他人批評句照常；
//       **沒有** round:update 'off'、commentMode 維持 'ai'；之後加入者快照一致。
//   回合 2（失敗、成功、失敗 → 不跳過）：A 逾時（1）→ 第一名稱讚版成功（歸零）→ B 成功 → C 逾時（1）：兩張 null、沒有 'off'。
//   回合 3（連續兩次 → 跳過剩餘；稱讚版自己失敗 → 退回批評版）：第一名 T 的批評版在揭曉前已完成；揭曉時在途的 A 逾時（1）、接著 T 的稱讚版逾時（2）
//       → T 的 contest:comment 是**批評版**（與回合 0 同圖的那句）、排隊中的 B、C 各一則 null、恰一則 round:update 'off'；快照 commentMode 'off'。
//   回合 4（稱讚版被跳過 → 帶批評版）：T 批評版先完成；A 在 drawing 逾時（1，不發事件、judging 仍 'ai'）；揭曉時在途的 B 逾時（2）→ 跳過排隊中的
//       T 稱讚版與 C：T 的 contest:comment 帶批評版、C null、一則 round:update 'off'。
//   回合 5（換回合歸零）：全部正常 → judging／ended commentMode 'ai'，四張都有評語。
// server log 的 comment.failed（consecutive／fallback 欄位）本檔不讀，請另 grep server 的 stdout。
//
// 用法（專案根目錄，需先 npm run build；隔離埠且只綁本機；**每次都要全新的 server 程序**；避免用瀏覽器開過的埠）：
//   HOST=127.0.0.1 PORT=3237 JUDGE=random JUDGE_FAKE_DELAY_MS=0 COMMENT=ollama COMMENT_TIMEOUT_MS=600 OLLAMA_URL=http://127.0.0.1:11467 node server/dist/index.js &
//   TEST_PORT=3237 TEST_MOCK_PORT=11467 node --input-type=module < user/protocol/draw-contest-comment-resilience.mjs
// - 假 Ollama 由本檔啟動（server 先起時啟動探測會 warn commentUnavailable，§6.1：每回合仍嘗試，不影響）；server 的 COMMENT_TIMEOUT_MS 要與 TEST_COMMENT_TIMEOUT_MS（預設 600）一致。
// - 假 Ollama 正常回應延遲 TEST_OK_DELAY_MS（預設 250）、逾時用的延遲為 COMMENT_TIMEOUT_MS × 3。
// 作者：驗收子代理（代架構師海圖），2026-10-13。
import { io } from 'socket.io-client';
import { deflateSync } from 'node:zlib';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = process.env.TEST_PORT ?? '3237';
const MOCK_PORT = Number(process.env.TEST_MOCK_PORT ?? 11467);
const TIMEOUT_MS = Number(process.env.TEST_COMMENT_TIMEOUT_MS ?? 600);
const OK_DELAY_MS = Number(process.env.TEST_OK_DELAY_MS ?? 250);
const SLOW_MS = TIMEOUT_MS * 3;
// ── 常數：.mjs 不能 import .ts，照既有協定測試慣例寫死；出處 shared/src/draw-contest/constants.ts ──
const CANVAS_LOGICAL = { width: 1280, height: 720 };
const COMMENT_MODEL = 'gemma4:26b-mlx-bf16';

// ── 測試框架（同 draw-contest-comment-praise.mjs）──
const R = [];
const check = (name, cond, extra = '') => R.push([cond ? 'PASS' : 'FAIL', name, extra]);
const connect = () => io(`http://127.0.0.1:${PORT}/draw-contest`, { path: '/socket.io', transports: ['websocket'], forceNew: true, reconnection: false });
const call = (s, ev, ...args) => new Promise((res) => s.emit(ev, ...args, res));
const once = (s, ev, ms = 4000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), ms); s.once(ev, (...a) => { clearTimeout(t); res(a); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (pred, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(20); } return pred(); };
const j = (x) => JSON.stringify(x)?.slice(0, 600);
const ab = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
const joinAs = async (nick) => {
  const s = connect(); await once(s, 'connect');
  const seq = [], rounds = [], comments = [];
  s.on('round:update', (r) => { rounds.push({ ...r, at: Date.now() }); seq.push(`round:${r.roundNo}:${r.phase}:${r.commentMode}`); });
  s.on('contest:comment', (c) => { comments.push({ ...c, at: Date.now() }); seq.push(`comment:${c.roundNo}:${c.playerId}`); });
  const r = await call(s, 'player:join', { nickname: nick });
  if (!r?.ok) throw new Error('join failed ' + j(r));
  return { s, nick, id: r.data.snapshot.you, snap: r.data.snapshot, seq, rounds, comments };
};
const lastRound = (p) => p.rounds.at(-1);
const waitPhase = (p, phase, roundNo, ms = 6000) => until(() => lastRound(p)?.phase === phase && (roundNo === undefined || lastRound(p).roundNo === roundNo), ms);
const endedOf = (p, roundNo) => p.rounds.find((r) => r.roundNo === roundNo && r.phase === 'ended');
const commentsOf = (p, roundNo) => p.comments.filter((c) => c.roundNo === roundNo);
const offUpdates = (p, roundNo) => p.rounds.filter((r) => r.roundNo === roundNo && r.commentMode === 'off');
const endedCount = (p, roundNo) => p.rounds.filter((r) => r.roundNo === roundNo && r.phase === 'ended').length;
const sentenceOk = (c) => typeof c === 'string' && c.length > 0 && c === c.trim() && !/[\r\n]/.test(c);

// ── PNG 產生器（同 draw-contest-phase1.mjs）──
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const makePng = (seed) => {
  const { width, height } = CANVAS_LOGICAL;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const bg = [0x1e, 0x1e, 0x1e];
  const ink = [(seed * 73) & 0xff, (seed * 151) & 0xff, (seed * 199) & 0xff];
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < width; x++) {
      const c = (x + y * (seed + 1)) % (17 + seed) < 3 ? ink : bg;
      const o = y * stride + 1 + x * 3;
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2];
    }
  }
  return Buffer.concat([PNG_MAGIC, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};

// ── 四張固定圖：seed → PNG、base64（假 Ollama 用它認圖）──
const SEEDS = [1, 2, 3, 4];
const PNG = new Map(SEEDS.map((s) => [s, makePng(s)]));
const seedOfB64 = new Map(SEEDS.map((s) => [PNG.get(s).toString('base64'), s]));
const critOf = (seed) => `哼，這張第 ${seed} 號圖也敢拿出來？雜魚程度剛剛好啦～`;
const praiseOf = (seed) => `欸…第 ${seed} 號圖居然這麼可以，好啦好啦，這次算你贏～`;

// ── 自帶的假 Ollama：plan 以 `crit:<seed>`／`praise:<seed>` 為鍵，值 'slow'（回得比 COMMENT_TIMEOUT_MS 慢 → 逾時）；沒設就正常 ──
const plan = new Map();
const mockLog = [];
// 2026-10-21 Phase 7：user 文案帶暱稱後改比對稱讚版特有片段（同 user/mock/systemone.mjs 的 PRAISE_MARKER）
const isPraiseChat = (messages) => { for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') return typeof messages[i].content === 'string' && messages[i].content.includes('這張是本回合第一名'); return false; };
const imageOf = (messages) => { for (let i = messages.length - 1; i >= 0; i--) { const im = messages[i].images; if (Array.isArray(im) && im.length > 0) return im[0]; } return null; };
const send = (res, code, body) => { const s = JSON.stringify(body); res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s) }); res.end(s); };
const mock = createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const path = (req.url ?? '/').split('?')[0];
    if (req.method === 'GET' && path === '/api/tags') {
      send(res, 200, { models: [{ name: COMMENT_MODEL, model: COMMENT_MODEL, modified_at: new Date(0).toISOString(), size: 0, digest: 'mock', details: {}, capabilities: ['completion', 'vision'] }] });
      return;
    }
    if (req.method === 'POST' && path === '/api/chat') {
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { send(res, 400, { error: 'bad json' }); return; }
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const img = imageOf(messages);
      const seed = img === null ? null : seedOfB64.get(img);
      const praise = isPraiseChat(messages);
      const key = seed === null ? 'warmup' : `${praise ? 'praise' : 'crit'}:${seed}`;
      const slow = plan.get(key) === 'slow';
      mockLog.push({ key, slow, at: Date.now() });
      const content = seed === null ? '嗨' : (seed === undefined ? '不認得這張圖' : (praise ? praiseOf(seed) : critOf(seed)));
      await delay(slow ? SLOW_MS : (seed === null ? 0 : OK_DELAY_MS));
      if (res.destroyed || res.writableEnded) return; // server 逾時已中止（AbortSignal）就不用回了
      send(res, 200, { model: body.model, created_at: new Date().toISOString(), message: { role: 'assistant', content }, done: true, done_reason: 'stop' });
      return;
    }
    send(res, 404, { error: 'not found' });
  });
});
await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));

// ── server 要先起來（任一順序皆可：本檔等 healthz 最多 15 秒）──
const waitHealthy = async () => { const t0 = Date.now(); while (Date.now() - t0 < 15000) { try { const r = await fetch(`http://127.0.0.1:${PORT}/healthz`); if (r.ok) return true; } catch { /* 還沒起來 */ } await sleep(200); } return false; };
const healthy = await waitHealthy();
if (!healthy) { console.error(`server 127.0.0.1:${PORT} 沒有回應 /healthz`); mock.close(); process.exit(2); }

const submitSeed = (p, seed) => call(p.s, 'contest:submit', { png: ab(PNG.get(seed)) });
const startRound = async (proposer, watcher, roundNo, topic) => {
  const v = await call(proposer.s, 'round:volunteer');
  if (!v?.ok) throw new Error('volunteer failed ' + j(v));
  await waitPhase(watcher, 'choosing', roundNo);
  const t = await call(proposer.s, 'round:setTopic', { topic });
  if (!t?.ok) throw new Error('setTopic failed ' + j(t));
  await waitPhase(watcher, 'drawing', roundNo);
};
/** 等該回合所有交卷者都不再 pending（以廣播補齊），上限 ms */
const waitSettled = (p, roundNo, ms) => until(() => { const e = endedOf(p, roundNo); return !!e && e.results.filter((x) => x.submitted && x.commentPending).every((x) => commentsOf(p, roundNo).some((c) => c.playerId === x.playerId)); }, ms);
const finalComments = (p, ended) => new Map(ended.results.filter((e) => e.submitted).map((e) => [e.playerId, e.commentPending ? commentsOf(p, ended.roundNo).find((c) => c.playerId === e.playerId)?.comment : e.comment]));
const TOPIC = '韌性測試';

const sockets = [];
try {
  const P1 = await joinAs('Alice'), P2 = await joinAs('Bob'), P3 = await joinAs('Cara'), P4 = await joinAs('Dan');
  const all = [P1, P2, P3, P4]; sockets.push(...all.map((p) => p.s));
  if (P1.snap.players.length !== 1) throw new Error(`需要全新的 server 程序（埠 ${PORT} 的房間已有其他玩家）`);
  const byId = new Map(all.map((p) => [p.id, p]));

  // ══ 回合 0：前置——全部正常，得知最高分的圖與每張圖的批評句 ══
  await startRound(P1, P4, 1, TOPIC);
  const seedByPlayer0 = new Map([[P1.id, 1], [P2.id, 2], [P3.id, 3], [P4.id, 4]]);
  for (const p of all) { const r = await submitSeed(p, seedByPlayer0.get(p.id)); if (!r?.ok) throw new Error('submit failed ' + j(r)); await sleep(OK_DELAY_MS + 150); }
  await waitPhase(P4, 'ended', 1);
  await waitSettled(P4, 1, 6000);
  const e0 = endedOf(P4, 1);
  const scoreBySeed = new Map(e0.results.map((e) => [seedByPlayer0.get(e.playerId), e.score]));
  const ranked = [...scoreBySeed].sort((a, b) => b[1] - a[1]);
  const T_SEED = ranked[0][0];
  const OTHERS = ranked.slice(1).map(([s]) => s); // [A, B, C] 的 seed（分數遞減，無關緊要）
  check('回合 0 前置：四張圖最高分唯一（之後靠它安排第一名）', ranked[0][1] > ranked[1][1], j(ranked));
  const fin0 = finalComments(P4, e0);
  check('回合 0：全部正常時第一名是稱讚句、其他三張是各自圖的批評句（假 Ollama 依圖回固定句）', [...fin0].every(([id, c]) => { const s = seedByPlayer0.get(id); return c === (s === T_SEED ? praiseOf(s) : critOf(s)); }), j([...fin0]));
  check('回合 0：沒有 round:update off、commentMode ai', offUpdates(P4, 1).length === 0 && e0.commentMode === 'ai', j(P4.seq));

  // 之後各回合固定：T 畫最高分的圖；A、B、C 畫其餘三張
  const [T, A, B, C] = all; // 玩家
  const seedOf = new Map([[T.id, T_SEED], [A.id, OTHERS[0]], [B.id, OTHERS[1]], [C.id, OTHERS[2]]]);
  const submitAs = (p) => submitSeed(p, seedOf.get(p.id));
  const expectCrit = (p) => critOf(seedOf.get(p.id));
  const expectPraise = (p) => praiseOf(seedOf.get(p.id));
  const resetPlan = () => plan.clear();
  const roundOffCount = (p, n) => offUpdates(p, n).length;

  // ══ 回合 1（roundNo 2）：單次逾時不跳過 ══
  resetPlan(); plan.set(`crit:${seedOf.get(A.id)}`, 'slow');
  await startRound(P2, P4, 2, TOPIC);
  for (const p of [A, B, T, C]) { const r = await submitAs(p); if (!r?.ok) throw new Error('submit failed ' + j(r)); }
  await waitPhase(P4, 'ended', 2);
  const e1 = endedOf(P4, 2);
  check('回合 1：揭曉當下 commentMode ai、第一名是 T 且 pending、在途的 A 與排隊的 B、C 皆 pending', e1.commentMode === 'ai' && e1.results[0].playerId === T.id && e1.results.every((x) => x.comment === null && x.commentPending === true), j(e1.results.map((x) => [x.playerId === T.id ? 'T' : byId.get(x.playerId).nick, x.rank, x.comment, x.commentPending])));
  await waitSettled(P4, 2, TIMEOUT_MS + 4 * OK_DELAY_MS + 3000);
  const c1 = commentsOf(P4, 2);
  check('回合 1：四張各恰好一則 contest:comment', sameSet(c1.map((c) => c.playerId), all.map((p) => p.id)), j(c1));
  check('回合 1：逾時的 A → { comment: null }（§6.1 單次失敗只影響該張）', c1.find((c) => c.playerId === A.id)?.comment === null, j(c1));
  check('回合 1：第一名 T 的稱讚版照常成功（單次失敗後下一張仍呼叫模型）', c1.find((c) => c.playerId === T.id)?.comment === expectPraise(T), j(c1.find((c) => c.playerId === T.id)));
  check('回合 1：B、C 照常收到批評句', [B, C].every((p) => c1.find((c) => c.playerId === p.id)?.comment === expectCrit(p)), j(c1));
  check('回合 1：事件順序＝在途的 A、插隊的 T、排隊的 B、C', j(c1.map((c) => c.playerId)) === j([A.id, T.id, B.id, C.id]), j(c1.map((c) => byId.get(c.playerId).nick)));
  check('回合 1：**沒有** round:update off；ended 的 round:update 只有揭曉那一則', roundOffCount(P4, 2) === 0 && endedCount(P4, 2) === 1, j(P4.seq.filter((s) => s.startsWith('round:2'))));
  const J1 = await joinAs('Joiner1'); sockets.push(J1.s);
  check('回合 1：之後加入者快照 commentMode ai、A comment null／pending false、其他三位為廣播的那句', J1.snap.round.commentMode === 'ai' && J1.snap.round.results.every((x) => x.commentPending === false && x.comment === c1.find((c) => c.playerId === x.playerId)?.comment), j(J1.snap.round.results.map((x) => [x.rank, x.comment, x.commentPending])));
  check('回合 1：所有連線收到的事件一致', all.every((p) => j(commentsOf(p, 2).map((c) => [c.playerId, c.comment])) === j(c1.map((c) => [c.playerId, c.comment]))), '');
  J1.s.disconnect();

  // ══ 回合 2（roundNo 3）：失敗、成功、失敗 → 不跳過（成功歸零） ══
  resetPlan(); plan.set(`crit:${seedOf.get(A.id)}`, 'slow'); plan.set(`crit:${seedOf.get(C.id)}`, 'slow');
  await startRound(P3, P4, 3, TOPIC);
  for (const p of [A, B, T, C]) { const r = await submitAs(p); if (!r?.ok) throw new Error('submit failed ' + j(r)); }
  await waitPhase(P4, 'ended', 3);
  const e2 = endedOf(P4, 3);
  check('回合 2：揭曉當下 commentMode ai、四張皆 pending', e2.commentMode === 'ai' && e2.results.every((x) => x.commentPending === true), j(e2.results.map((x) => [x.comment, x.commentPending])));
  await waitSettled(P4, 3, 2 * TIMEOUT_MS + 4 * OK_DELAY_MS + 3000);
  const c2 = commentsOf(P4, 3);
  check('回合 2：四張各恰好一則 contest:comment、順序 A、T、B、C', j(c2.map((c) => c.playerId)) === j([A.id, T.id, B.id, C.id]), j(c2.map((c) => byId.get(c.playerId).nick)));
  check('回合 2：A 逾時 null → T 稱讚成功 → B 成功 → C 逾時 null：兩次失敗中間有成功，不算連續', c2.find((c) => c.playerId === A.id)?.comment === null && c2.find((c) => c.playerId === T.id)?.comment === expectPraise(T) && c2.find((c) => c.playerId === B.id)?.comment === expectCrit(B) && c2.find((c) => c.playerId === C.id)?.comment === null, j(c2));
  check('回合 2：**沒有** round:update off、ended 只一則', roundOffCount(P4, 3) === 0 && endedCount(P4, 3) === 1, j(P4.seq.filter((s) => s.startsWith('round:3'))));
  const J2 = await joinAs('Joiner2'); sockets.push(J2.s);
  check('回合 2：之後加入者快照 commentMode ai、兩張 null、兩張字串、全部 pending false', J2.snap.round.commentMode === 'ai' && J2.snap.round.results.every((x) => x.commentPending === false) && J2.snap.round.results.filter((x) => x.comment === null).length === 2, j(J2.snap.round.results.map((x) => [x.rank, x.comment, x.commentPending])));
  J2.s.disconnect();

  // ══ 回合 3（roundNo 4）：連續兩次 → 跳過剩餘；稱讚版自己失敗 → 退回揭曉前已完成的批評版 ══
  resetPlan(); plan.set(`crit:${seedOf.get(A.id)}`, 'slow'); plan.set(`praise:${seedOf.get(T.id)}`, 'slow');
  await startRound(P4, P1, 4, TOPIC);
  { const r = await submitAs(T); if (!r?.ok) throw new Error('submit failed ' + j(r)); }
  await sleep(OK_DELAY_MS + 400); // T 的批評版在 drawing 期間完成（揭曉前已有退路）
  const tCritDone = mockLog.some((m) => m.key === `crit:${seedOf.get(T.id)}`);
  check('回合 3 前置：T 的批評版請求在揭曉前已送到假 Ollama', tCritDone, j(mockLog.slice(-3)));
  const t3 = Date.now();
  for (const p of [A, B, C]) { const r = await submitAs(p); if (!r?.ok) throw new Error('submit failed ' + j(r)); }
  await waitPhase(P1, 'ended', 4);
  const e3 = endedOf(P1, 4);
  check('回合 3：揭曉當下 commentMode ai；第一名 T 雖已有批評版仍重設 comment null／pending true（§5）；A、B、C pending', e3.commentMode === 'ai' && e3.results[0].playerId === T.id && e3.results.every((x) => x.comment === null && x.commentPending === true), j(e3.results.map((x) => [x.rank, x.comment, x.commentPending])));
  await until(() => roundOffCount(P1, 4) >= 1, 2 * TIMEOUT_MS + 3000);
  await sleep(300);
  const c3 = commentsOf(P1, 4);
  const off3 = offUpdates(P1, 4);
  check('回合 3：A 逾時（連續 1）→ 一則 { comment: null }，此時還沒有 round:update off', c3[0]?.playerId === A.id && c3[0].comment === null && (off3[0]?.at ?? Infinity) > c3[0].at, j(c3));
  check('回合 3：T 稱讚版逾時（連續 2）→ T 的 contest:comment 是**批評版**（§5：退回揭曉前已產生的那句）', c3.find((c) => c.playerId === T.id)?.comment === expectCrit(T), j([c3.find((c) => c.playerId === T.id), expectCrit(T)]));
  check('回合 3：排隊中的 B、C 被跳過（不呼叫模型）→ 各一則 { comment: null }', [B, C].every((p) => c3.filter((c) => c.playerId === p.id).length === 1 && c3.find((c) => c.playerId === p.id).comment === null) && !mockLog.some((m) => m.at > t3 && (m.key === `crit:${seedOf.get(B.id)}` || m.key === `crit:${seedOf.get(C.id)}`)), j([c3, mockLog.filter((m) => m.at > t3).map((m) => m.key)]));
  check('回合 3：恰一則 round:update commentMode off（規則 (b)），四張各恰好一則 contest:comment', off3.length === 1 && off3[0].phase === 'ended' && sameSet(c3.map((c) => c.playerId), all.map((p) => p.id)), j(P1.seq.filter((s) => s.startsWith('round:4') || s.startsWith('comment:4'))));
  const dt3 = off3[0] ? off3[0].at - e3.at : -1;
  check(`回合 3：收尾在約兩次逾時後（${dt3} ms，介於 ${2 * TIMEOUT_MS - 200} 與 ${2 * TIMEOUT_MS + 2500}）`, dt3 >= 2 * TIMEOUT_MS - 200 && dt3 <= 2 * TIMEOUT_MS + 2500, `${dt3} ms`);
  const J3 = await joinAs('Joiner3'); sockets.push(J3.s);
  check('回合 3：之後加入者快照 commentMode off、T 為批評版、其餘 null、全部 pending false', J3.snap.round.commentMode === 'off' && J3.snap.round.results.every((x) => x.commentPending === false) && J3.snap.round.results.find((x) => x.playerId === T.id)?.comment === expectCrit(T) && J3.snap.round.results.filter((x) => x.playerId !== T.id).every((x) => x.comment === null), j(J3.snap.round.results.map((x) => [x.rank, x.comment, x.commentPending])));
  check('回合 3：所有連線收到的事件一致', all.every((p) => j(commentsOf(p, 4).map((c) => [c.playerId, c.comment])) === j(c3.map((c) => [c.playerId, c.comment]))), '');
  J3.s.disconnect();

  // ══ 回合 4（roundNo 5）：稱讚版被跳過 → 帶批評版；drawing 中一次失敗進 judging 仍 ai ══
  resetPlan(); plan.set(`crit:${seedOf.get(A.id)}`, 'slow'); plan.set(`crit:${seedOf.get(B.id)}`, 'slow');
  await startRound(P1, P4, 5, TOPIC);
  check('回合 4：新回合 drawing commentMode 回 null（上回合的 off 不延續）', lastRound(P4).phase === 'drawing' && lastRound(P4).commentMode === null, j(lastRound(P4)));
  { const r = await submitAs(T); if (!r?.ok) throw new Error('submit failed ' + j(r)); }
  await sleep(OK_DELAY_MS + 400); // T 批評版完成
  { const r = await submitAs(A); if (!r?.ok) throw new Error('submit failed ' + j(r)); }
  await sleep(TIMEOUT_MS + 400); // A 在 drawing 逾時（連續 1）
  check('回合 4：drawing 中 A 逾時不發事件、commentMode 仍 null', commentsOf(P4, 5).length === 0 && lastRound(P4).phase === 'drawing' && lastRound(P4).commentMode === null, j(P4.seq.filter((s) => s.includes(':5:'))));
  for (const p of [B, C]) { const r = await submitAs(p); if (!r?.ok) throw new Error('submit failed ' + j(r)); }
  await waitPhase(P4, 'ended', 5);
  const e4 = endedOf(P4, 5);
  check('回合 4：drawing 中只失敗一次 → judging／ended 仍是 ai（規則 (c)）', P4.rounds.filter((r) => r.roundNo === 5 && r.phase === 'judging').every((r) => r.commentMode === 'ai') && e4.commentMode === 'ai', j(P4.seq.filter((s) => s.startsWith('round:5'))));
  check('回合 4：揭曉當下 A comment null／pending false（drawing 中已失敗）、T 重設 pending、B 在途 pending、C 排隊 pending', e4.results.find((x) => x.playerId === A.id)?.comment === null && e4.results.find((x) => x.playerId === A.id)?.commentPending === false && [T, B, C].every((p) => e4.results.find((x) => x.playerId === p.id)?.commentPending === true), j(e4.results.map((x) => [byId.get(x.playerId).nick, x.rank, x.comment, x.commentPending])));
  await until(() => roundOffCount(P4, 5) >= 1, TIMEOUT_MS + 3000);
  await sleep(300);
  const c4 = commentsOf(P4, 5);
  check('回合 4：B 逾時（連續 2）→ B null；被跳過的 T 稱讚版 → contest:comment **帶批評版**；被跳過的 C → null；A 沒有事件', c4.find((c) => c.playerId === B.id)?.comment === null && c4.find((c) => c.playerId === T.id)?.comment === expectCrit(T) && c4.find((c) => c.playerId === C.id)?.comment === null && !c4.some((c) => c.playerId === A.id) && c4.length === 3, j(c4));
  check('回合 4：T 的稱讚版沒有呼叫模型（被跳過）', !mockLog.some((m) => m.key === `praise:${seedOf.get(T.id)}` && m.at > e4.at), j(mockLog.filter((m) => m.at > e4.at).map((m) => m.key)));
  check('回合 4：恰一則 round:update off', roundOffCount(P4, 5) === 1, j(P4.seq.filter((s) => s.startsWith('round:5'))));
  const J4 = await joinAs('Joiner4'); sockets.push(J4.s);
  check('回合 4：之後加入者快照 commentMode off、T 批評版、A／B／C null、全部 pending false', J4.snap.round.commentMode === 'off' && J4.snap.round.results.every((x) => x.commentPending === false) && J4.snap.round.results.find((x) => x.playerId === T.id)?.comment === expectCrit(T) && J4.snap.round.results.filter((x) => x.playerId !== T.id).every((x) => x.comment === null), j(J4.snap.round.results.map((x) => [x.rank, x.comment, x.commentPending])));
  J4.s.disconnect();

  // ══ 回合 5（roundNo 6）：換回合歸零 ══
  resetPlan();
  await startRound(P2, P4, 6, TOPIC);
  for (const p of [A, B, T, C]) { const r = await submitAs(p); if (!r?.ok) throw new Error('submit failed ' + j(r)); }
  await waitPhase(P4, 'ended', 6);
  await waitSettled(P4, 6, 4 * OK_DELAY_MS + 3000);
  const e5 = endedOf(P4, 6);
  const fin5 = finalComments(P4, e5);
  check('回合 5：換回合後 judging／ended commentMode ai、四張都有評語（T 稱讚句、其餘批評句）、沒有 off', e5.commentMode === 'ai' && roundOffCount(P4, 6) === 0 && [...fin5].every(([id, c]) => c === (id === T.id ? expectPraise(T) : critOf(seedOf.get(id)))), j([...fin5]));
} catch (err) {
  check('沒有例外', false, String(err?.stack ?? err));
} finally {
  for (const s of sockets) s.disconnect();
  mock.close();
}

for (const [st, name, extra] of R) console.log(`${st}  ${name}${st === 'FAIL' && extra ? `\n      ${extra}` : ''}`);
const passed = R.filter(([s]) => s === 'PASS').length;
console.log(`\n${passed}/${R.length} passed`);
process.exit(passed === R.length ? 0 : 1);
