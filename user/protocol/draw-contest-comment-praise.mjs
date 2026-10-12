// 繪圖比賽「第一名重做稱讚版」協定符合性測試（Epic 15 Phase 4）：只依 spec/draw-contest/architecture.md §5「評語」第一名重做、§6.1 稱讚版 user 文案與假 Ollama 規則打 Socket，
// 不看實作、不 import server 內部程式。補 draw-contest-comment.mjs／-fallback.mjs 未涵蓋的三個情境：
//   甲、單人回合（§5「單人回合的第一名也稱讚」）＋「正在產生中則直接中止、稱讚版立即接著跑」：唯一參賽者交卷即揭曉，他的批評版此時正在產生 →
//       揭曉當下 comment null／commentPending true；之後只收到一則 contest:comment（批評版被中止不發事件）、內容是稱讚句；
//       到達時間約一次假 Ollama 延遲（沒有中止的話會是兩次）。
//   乙、五人回合「插隊」：前兩位的評語早已完成、第三位正在產生、後兩位排隊中時揭曉 → 第一名不論原狀態一律重設 pending；
//       揭曉後的 contest:comment 順序：第一名的稱讚版在所有「排隊中」的人之前（在途那張是別人的才等它跑完；是第一名自己的就中止、稱讚版第一個到）；
//       第一名只有一則事件、其他人都是批評句、不 pending 的早完成者沒有事件；中途加入者快照同步。
//   丙、只有稱讚版失敗（假 Ollama MOCK_PRAISE_CONTENT= 空字串）：其他人的評語照常；第一名揭曉當下 pending，之後依規則 (b) 收到 contest:comment { comment: null }
//       並有 round:update commentMode 'off'；第一名即使原本已有批評版也不退回（最終 null）；中途加入者快照第一名 null／false、其他人為字串；
//       下一回合 commentMode 重新從 'ai' 開始、第一名再次 pending。
// 作者：驗收子代理（代架構師海圖），2026-10-12。
//
// 需要兩個 server 程序與兩個假 Ollama；**不碰真模型**。用法（專案根目錄，需先 npm run build；隔離埠且只綁本機；**每次都要全新的 server 程序**；
// **避免用瀏覽器開過的埠**）：
//   MOCK_PORT=11457 MOCK_CHAT_DELAY_MS=1500 node user/mock/systemone.mjs &                       # 甲、乙用：延遲夠長才看得出插隊與中止
//   MOCK_PORT=11458 MOCK_CHAT_DELAY_MS=300 MOCK_PRAISE_CONTENT= node user/mock/systemone.mjs &    # 丙用：只有稱讚版回空字串
//   HOST=127.0.0.1 PORT=3227 JUDGE=random JUDGE_FAKE_DELAY_MS=0 COMMENT=ollama OLLAMA_URL=http://127.0.0.1:11457 node server/dist/index.js &
//   HOST=127.0.0.1 PORT=3228 JUDGE=random JUDGE_FAKE_DELAY_MS=0 COMMENT=ollama OLLAMA_URL=http://127.0.0.1:11458 node server/dist/index.js &
//   TEST_PORT=3227 TEST_PORT_PRAISE_FAIL=3228 node --input-type=module < user/protocol/draw-contest-comment-praise.mjs
// 甲乙的假 Ollama 延遲不是 1500 時請同步設 TEST_CHAT_DELAY_MS（等待與時間斷言由它推算）。總時長約 20 秒；全部 PASS 時 exit 0。
// 未涵蓋：COMMENT=off 與「本回合已失敗跳過」時第一名不重設（draw-contest-comment.mjs 乙段、-fallback.mjs 甲丙段已驗）；稱讚版逾時起算（vitest）。

import { io } from 'socket.io-client';
import { deflateSync } from 'node:zlib';

const PORT_AI = process.env.TEST_PORT ?? '3227';
const PORT_PF = process.env.TEST_PORT_PRAISE_FAIL ?? '3228';
/** 甲乙假 Ollama 的 MOCK_CHAT_DELAY_MS（推算等待與「到達時間約一次延遲」） */
const CHAT_DELAY_MS = Number(process.env.TEST_CHAT_DELAY_MS ?? 1500);
/** 丙假 Ollama 的 MOCK_CHAT_DELAY_MS */
const PF_DELAY_MS = Number(process.env.TEST_PF_DELAY_MS ?? 300);

// ── 常數：.mjs 不能 import .ts，照既有協定測試慣例寫死；出處 shared/src/draw-contest/constants.ts（spec §4 常數表）──
const CANVAS_LOGICAL = { width: 1280, height: 720 };

// ── 假 Ollama 的稱讚句：出處 user/mock/systemone.mjs 的 MOCK_PRAISES（spec §6.1：user 文案含「第一名」時回稱讚句，與批評句沒有交集）──
const MOCK_PRAISES = [
  '哼，這張居然還不錯嘛，第一名就勉強給你啦～',
  '欸？畫得這麼好是想怎樣，才、才沒有在誇你喔！',
  '嘛，這次算你厲害，下次也要這樣讓我驚訝才行喔～',
  '居然真的被你拿到第一，好啦好啦，這張是真的很可以啦！',
];
const isPraise = (c) => MOCK_PRAISES.includes(c);

// ── 測試框架（同 draw-contest-comment.mjs）──
const R = [];
const check = (name, cond, extra = '') => R.push([cond ? 'PASS' : 'FAIL', name, extra]);
const connect = (port) => io(`http://127.0.0.1:${port}/draw-contest`, { path: '/socket.io', transports: ['websocket'], forceNew: true, reconnection: false });
const call = (s, ev, ...args) => new Promise((res) => s.emit(ev, ...args, res));
const once = (s, ev, ms = 4000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), ms); s.once(ev, (...a) => { clearTimeout(t); res(a); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (pred, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(20); } return pred(); };
const j = (x) => JSON.stringify(x)?.slice(0, 500);
const ab = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
/** 每個 socket 都先掛好收集器再 join；comments 記到達時間，seq 記 round:update 的 phase／commentMode 與 contest:comment */
const joinAs = async (port, nick) => {
  const s = connect(port); await once(s, 'connect');
  const seq = [], rounds = [], comments = [];
  s.on('round:update', (r) => { rounds.push({ ...r, at: Date.now() }); seq.push(`round:${r.roundNo}:${r.phase}:${r.commentMode}`); });
  s.on('contest:comment', (c) => { comments.push({ ...c, at: Date.now() }); seq.push(`comment:${c.roundNo}:${c.playerId}`); });
  const r = await call(s, 'player:join', { nickname: nick });
  if (!r?.ok) throw new Error('join failed ' + j(r));
  return { s, nick, id: r.data.snapshot.you, snap: r.data.snapshot, seq, rounds, comments };
};
const lastRound = (p) => p.rounds.at(-1);
const waitPhase = (p, phase, roundNo, ms = 6000) => until(() => lastRound(p)?.phase === phase && (roundNo === undefined || lastRound(p).roundNo === roundNo), ms);
/** 某回合 ended 的第一則 round:update（含到達時間） */
const endedOf = (p, roundNo) => p.rounds.find((r) => r.roundNo === roundNo && r.phase === 'ended');
const commentsOf = (p, roundNo) => p.comments.filter((c) => c.roundNo === roundNo);

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
const submit = (p, seed) => call(p.s, 'contest:submit', { png: ab(makePng(seed)) });
/** 開一回合：proposer 自願出題並設題目，等 watcher 看到 drawing */
const startRound = async (proposer, watcher, roundNo, topic) => {
  const v = await call(proposer.s, 'round:volunteer');
  if (!v?.ok) throw new Error('volunteer failed ' + j(v));
  await waitPhase(watcher, 'choosing', roundNo);
  const t = await call(proposer.s, 'round:setTopic', { topic });
  if (!t?.ok) throw new Error('setTopic failed ' + j(t));
  await waitPhase(watcher, 'drawing', roundNo);
};

// ── §4／§5 斷言 ──
const sentenceOk = (c) => typeof c === 'string' && c.length > 0 && c === c.trim() && !/[\r\n]/.test(c);
/** 揭曉當下：rank 1 且有交卷者一律 comment null、commentPending true（§5） */
const winnerPendingOk = (ended) => { const w = ended.results[0]; return w?.rank === 1 && w.submitted === true && w.comment === null && w.commentPending === true; };
/** 揭曉時的值＋之後的事件 → 每位交卷者最終的評語（undefined = 沒收到） */
const finalComments = (p, ended) => new Map(ended.results.filter((e) => e.submitted).map((e) => [e.playerId, e.commentPending ? commentsOf(p, ended.roundNo).find((c) => c.playerId === e.playerId)?.comment : e.comment]));

const sockets = [];
try {
  // ══════════════════════════════════════════════════════════════════
  // 甲、單人回合：第一名也稱讚；在途的批評版被中止、稱讚版立即接著跑
  // ══════════════════════════════════════════════════════════════════
  const A = await joinAs(PORT_AI, 'Alice'); sockets.push(A.s);
  if (A.snap.players.length !== 1) throw new Error(`需要全新的 server 程序（埠 ${PORT_AI} 的房間已有其他玩家）`);
  // 單人回合的做法：volunteer 需在線 ≥ MIN_PLAYERS（2），所以先讓輔助玩家 H 在線，A 自願出題後 H 在 choosing 斷線（connected 立即 false），
  // A 再出題 → 參賽者＝此刻在線者＝只有 A（§4 participating、§5 drawing）
  const H = await joinAs(PORT_AI, 'Helper'); sockets.push(H.s);
  const v1 = await call(A.s, 'round:volunteer');
  if (!v1?.ok) throw new Error('volunteer failed ' + j(v1));
  await waitPhase(A, 'choosing', 1);
  H.s.close(); await sleep(300);
  const t1 = await call(A.s, 'round:setTopic', { topic: '蘋果' });
  if (!t1?.ok) throw new Error('setTopic failed ' + j(t1));
  await waitPhase(A, 'drawing', 1);
  // 旁觀者在 drawing 開始後才加入（§4 participating：drawing 開始時在線者才是參賽者；先加入會變成未交卷的參賽者、要等 DRAW_SECONDS 才揭曉）
  const W = await joinAs(PORT_AI, 'Watcher'); sockets.push(W.s);
  check('甲：旁觀者快照 drawing、不是參賽者；參賽者只有 A（單人回合）', W.snap.round.phase === 'drawing' && W.snap.players.find((x) => x.id === W.id)?.participating === false && W.snap.players.filter((x) => x.participating).map((x) => x.id).join() === A.id, j(W.snap.players.map((x) => [x.nickname, x.connected, x.participating])));
  const r1 = await submit(A, 1);
  check('甲：唯一參賽者交卷 ok', r1?.ok === true, j(r1));
  await waitPhase(W, 'ended', 1);
  const e1 = endedOf(W, 1);
  // 旁觀者沒交卷：results 可能含旁觀者（未交卷、排在後面）或不含；只看 submitted 者
  const sub1 = e1.results.filter((e) => e.submitted);
  check('甲：ended 的 results 只有一位交卷者且 rank 1', sub1.length === 1 && sub1[0].playerId === A.id && sub1[0].rank === 1, j(e1.results));
  check('甲：單人回合第一名在揭曉當下 comment null、commentPending true（評語此時正在產生中，仍一律重設）', winnerPendingOk(e1), j(e1.results[0]));
  check('甲：未交卷的旁觀者（若在 results）comment null、commentPending false', e1.results.filter((e) => !e.submitted).every((e) => e.comment === null && e.commentPending === false), j(e1.results));
  await until(() => commentsOf(W, 1).length >= 1, CHAT_DELAY_MS * 2 + 2000);
  await sleep(CHAT_DELAY_MS + 500);   // 多等一次延遲：確認被中止的批評版不會再補發
  const c1 = commentsOf(W, 1);
  check('甲：之後只收到一則 contest:comment（在途的批評版被中止、不發事件）', c1.length === 1 && c1[0].playerId === A.id, j(c1));
  check('甲：單人回合第一名的評語是稱讚句', c1.length === 1 && isPraise(c1[0].comment), j(c1[0]?.comment));
  const dt1 = c1[0] ? c1[0].at - e1.at : NaN;
  check(`甲：稱讚句約一次假 Ollama 延遲後到達（${dt1} ms，< ${CHAT_DELAY_MS * 2 - 200}；沒中止在途那張會是兩次延遲）`, dt1 >= 0 && dt1 < CHAT_DELAY_MS * 2 - 200, `${dt1} ms`);
  check('甲：A（第一名自己）收到同一句稱讚', commentsOf(A, 1).length === 1 && commentsOf(A, 1)[0].comment === c1[0]?.comment, j(commentsOf(A, 1)));
  check('甲：稱讚版成功後 commentMode 仍為 ai、沒有多餘的 round:update', W.rounds.filter((r) => r.roundNo === 1 && r.phase === 'ended').every((r) => r.commentMode === 'ai'), j(W.seq));
  const J1 = await joinAs(PORT_AI, 'Joiner1'); sockets.push(J1.s);
  check('甲：稱讚完成後加入者快照：第一名 comment 為稱讚句、commentPending false', J1.snap.round.phase === 'ended' && J1.snap.round.results?.find((e) => e.playerId === A.id)?.comment === c1[0]?.comment && J1.snap.round.results.find((e) => e.playerId === A.id).commentPending === false, j(J1.snap.round.results));

  // ══════════════════════════════════════════════════════════════════
  // 乙、五人回合：早完成／在途／排隊中 三種狀態下揭曉 → 第一名重設、稱讚版插隊
  // ══════════════════════════════════════════════════════════════════
  const B = await joinAs(PORT_AI, 'Bob'); sockets.push(B.s);
  const C = await joinAs(PORT_AI, 'Cara'); sockets.push(C.s);
  const D = await joinAs(PORT_AI, 'Dan'); sockets.push(D.s);
  const E = await joinAs(PORT_AI, 'Eve'); sockets.push(E.s);
  W.s.close(); J1.s.close();   // 上一回合的旁觀者離開，否則會成為本回合未交卷的參賽者
  await sleep(300);
  await startRound(B, A, 2, '香蕉');
  const W2 = await joinAs(PORT_AI, 'Watcher2'); sockets.push(W2.s);   // 本回合旁觀者（drawing 後加入）
  check('乙：本回合參賽者恰為 A～E 五位', W2.snap.players.filter((x) => x.participating).length === 5 && W2.snap.players.find((x) => x.id === W2.id)?.participating === false, j(W2.snap.players.map((x) => [x.nickname, x.participating])));
  await submit(A, 11);
  await submit(B, 12);
  await sleep(CHAT_DELAY_MS * 2 + 800);   // A、B 的批評版都完成（一次一張：兩次延遲）
  const rC = await submit(C, 13);          // C 的評語立刻開始產生（在途）
  const rD = await submit(D, 14);          // D、E 排隊中
  const rE = await submit(E, 15);
  check('乙：五人全部交卷 ok', [rC, rD, rE].every((r) => r?.ok === true), j([rC, rD, rE]));
  await waitPhase(W2, 'ended', 2);
  const e2 = endedOf(W2, 2);
  check('乙：ended、commentMode ai、results 5 位交卷者', e2?.commentMode === 'ai' && e2.results.filter((e) => e.submitted).length === 5, j(e2?.results?.map((e) => [e.playerId, e.rank, e.comment, e.commentPending])));
  const winner = e2.results[0];
  check('乙：第一名不論原狀態一律 comment null、commentPending true', winnerPendingOk(e2), j(winner));
  const early = [A.id, B.id].filter((id) => id !== winner.playerId);
  check('乙：早完成的非第一名（A／B）揭曉時已有評語（字串、不 pending）；若第一名是其中一位則他被重設（驗「即使已有批評版也不顯示」）', early.every((id) => { const e = e2.results.find((x) => x.playerId === id); return sentenceOk(e.comment) && !isPraise(e.comment) && e.commentPending === false; }), j(e2.results.map((e) => [e.playerId, e.comment, e.commentPending])));
  const lateIds = [C.id, D.id, E.id].filter((id) => id !== winner.playerId);
  check('乙：在途與排隊中的非第一名（C／D／E）揭曉時 pending', lateIds.every((id) => { const e = e2.results.find((x) => x.playerId === id); return e.comment === null && e.commentPending === true; }), j(e2.results.map((e) => [e.playerId, e.comment, e.commentPending])));
  const expectedPending = [...lateIds, winner.playerId];
  await until(() => sameSet(commentsOf(W2, 2).map((c) => c.playerId), expectedPending), CHAT_DELAY_MS * 5 + 3000);
  await sleep(CHAT_DELAY_MS + 300);   // 多等一次：確認第一名沒有第二則（被取代／中止的批評版不發事件）
  const c2 = commentsOf(W2, 2);
  check('乙：揭曉後每位 pending 者各收到恰好一則 contest:comment（第一名只有一則、早完成者沒有事件）', sameSet(c2.map((c) => c.playerId), expectedPending), j(c2.map((c) => [c.playerId, c.comment])));
  const winnerEvt = c2.find((c) => c.playerId === winner.playerId);
  check('乙：第一名的評語是稱讚句', winnerEvt && isPraise(winnerEvt.comment), j(winnerEvt));
  check('乙：其他人的評語都是批評句（不是稱讚句）、且與第一名的不同', c2.filter((c) => c.playerId !== winner.playerId).every((c) => sentenceOk(c.comment) && !isPraise(c.comment)), j(c2));
  const idx = c2.findIndex((c) => c.playerId === winner.playerId);
  const inflightFirst = winner.playerId !== C.id && c2[0]?.playerId === C.id;
  check(`乙：稱讚版插隊——第一名是在途者（C）時第一個到；否則在途的 C 先到、稱讚版第二個到，排隊中的 D／E 都在它之後（順序 ${j(c2.map((c) => c.playerId === winner.playerId ? 'WINNER' : c.playerId === C.id ? 'C' : c.playerId === D.id ? 'D' : 'E'))}）`,
    winner.playerId === C.id ? idx === 0 : (inflightFirst && idx === 1), '');
  const dt2 = winnerEvt ? winnerEvt.at - e2.at : NaN;
  const bound2 = (winner.playerId === C.id ? 1 : 2) * CHAT_DELAY_MS + 1200;
  check(`乙：稱讚句到達時間 ${dt2} ms（上限 ${bound2}：第一名是 C 時一次延遲、否則兩次；沒插隊會是三次以上）`, dt2 >= 0 && dt2 < bound2, `${dt2} ms`);
  check('乙：所有連線收到的事件順序一致', [A, B, C, D, E].every((p) => j(commentsOf(p, 2).map((c) => [c.playerId, c.comment])) === j(c2.map((c) => [c.playerId, c.comment]))), j([A, C].map((p) => commentsOf(p, 2).map((c) => c.playerId))));
  const final2 = finalComments(W2, e2);
  const J2 = await joinAs(PORT_AI, 'Joiner2'); sockets.push(J2.s);
  check('乙：完成後加入者快照：每位交卷者 comment 與廣播一致、commentPending false、第一名為稱讚句', J2.snap.round.results.filter((e) => e.submitted).every((e) => e.comment === final2.get(e.playerId) && e.commentPending === false) && isPraise(J2.snap.round.results[0].comment), j(J2.snap.round.results.map((e) => [e.rank, e.comment])));

  // ══════════════════════════════════════════════════════════════════
  // 丙、只有稱讚版失敗：其他人照常、第一名最終 null（不退回批評版）、規則 (b) 收尾、下一回合重試
  // ══════════════════════════════════════════════════════════════════
  const P = await joinAs(PORT_PF, 'Pam'); sockets.push(P.s);
  if (P.snap.players.length !== 1) throw new Error(`需要全新的 server 程序（埠 ${PORT_PF} 的房間已有其他玩家）`);
  const Q = await joinAs(PORT_PF, 'Quinn'); sockets.push(Q.s);
  const S = await joinAs(PORT_PF, 'Sam'); sockets.push(S.s);
  await startRound(P, P, 1, '西瓜');
  const V = await joinAs(PORT_PF, 'Viewer'); sockets.push(V.s);   // 旁觀者（drawing 後加入）
  await submit(P, 21); await sleep(PF_DELAY_MS + 400);   // P 的批評版完成
  await submit(Q, 22); await sleep(PF_DELAY_MS + 400);   // Q 的批評版完成
  await submit(S, 23);                                    // S 在途 → 揭曉
  await waitPhase(V, 'ended', 1);
  const f1 = endedOf(V, 1);
  const fw = f1.results[0];
  check('丙：ended commentMode ai、第一名 pending（重做稱讚版）', f1.commentMode === 'ai' && winnerPendingOk(f1), j(f1.results.map((e) => [e.playerId, e.rank, e.comment, e.commentPending])));
  check('丙：早完成的非第一名（P／Q）揭曉時已有批評句', [P.id, Q.id].filter((id) => id !== fw.playerId).every((id) => { const e = f1.results.find((x) => x.playerId === id); return sentenceOk(e.comment) && e.commentPending === false; }), j(f1.results));
  const fPending = f1.results.filter((e) => e.commentPending).map((e) => e.playerId);
  await until(() => sameSet(commentsOf(V, 1).map((c) => c.playerId), fPending) && V.rounds.some((r) => r.roundNo === 1 && r.phase === 'ended' && r.commentMode === 'off'), PF_DELAY_MS * 4 + 3000);
  await sleep(PF_DELAY_MS + 300);
  const fc = commentsOf(V, 1);
  check('丙：揭曉當下 pending 的每一張各一則 contest:comment（第一名與在途的 S）', sameSet(fc.map((c) => c.playerId), fPending), j(fc));
  const fwEvt = fc.find((c) => c.playerId === fw.playerId);
  check('丙：第一名的 contest:comment 為 { comment: null }（稱讚版失敗，不退回批評版）', fwEvt && fwEvt.comment === null, j(fwEvt));
  check('丙：在途的 S（若非第一名）照常收到批評句', fw.playerId === S.id || fc.some((c) => c.playerId === S.id && sentenceOk(c.comment)), j(fc));
  const offUpdates = V.rounds.filter((r) => r.roundNo === 1 && r.phase === 'ended' && r.commentMode === 'off');
  check('丙：失敗在 ended 之後 → 一則 round:update commentMode off（規則 (b)）', offUpdates.length === 1, j(V.seq));
  const finalF = finalComments(V, f1);
  check('丙：最終：第一名 null、其他兩位都是非空批評句', finalF.get(fw.playerId) === null && [...finalF].filter(([id]) => id !== fw.playerId).every(([, c]) => sentenceOk(c)), j([...finalF]));
  const J3 = await joinAs(PORT_PF, 'Joiner3'); sockets.push(J3.s);
  const j3 = J3.snap.round;
  check('丙：之後加入者快照：commentMode off、第一名 comment null／commentPending false、其他人為字串', j3.phase === 'ended' && j3.commentMode === 'off' && j3.results[0].comment === null && j3.results[0].commentPending === false && j3.results.filter((e) => e.submitted && e.rank !== 1).every((e) => sentenceOk(e.comment) && e.commentPending === false), j(j3.results.map((e) => [e.rank, e.comment, e.commentPending])));
  check('丙：所有連線收到的事件一致', [P, Q, S].every((p) => j(commentsOf(p, 1).map((c) => [c.playerId, c.comment])) === j(fc.map((c) => [c.playerId, c.comment]))), '');

  // 第二回合：重新從 ai 開始、第一名再 pending、稱讚版再失敗 → 一樣收尾
  V.s.close(); J3.s.close(); await sleep(300);   // 旁觀者離開，免得成為未交卷參賽者
  await startRound(Q, P, 2, '葡萄');
  check('丙：第二回合 drawing commentMode 回 null', lastRound(P).commentMode === null, j(lastRound(P)));
  // 錯開交卷（同第一回合）：前兩位的批評版先完成，否則稱讚版失敗時仍 pending 的人依規則 (b) 也會變 null（那是對的，但本段要驗「其他人照常」）
  await submit(P, 31); await sleep(PF_DELAY_MS + 400);
  await submit(Q, 32); await sleep(PF_DELAY_MS + 400);
  await submit(S, 33);
  await waitPhase(P, 'ended', 2);
  const f2 = endedOf(P, 2);
  check('丙：第二回合重新嘗試：judging 起 commentMode ai、第一名 pending', P.rounds.filter((r) => r.roundNo === 2 && r.phase === 'judging').every((r) => r.commentMode === 'ai') && f2.commentMode === 'ai' && winnerPendingOk(f2), j(f2.results));
  const f2Pending = f2.results.filter((e) => e.commentPending).map((e) => e.playerId);
  await until(() => sameSet(commentsOf(P, 2).map((c) => c.playerId), f2Pending) && P.rounds.some((r) => r.roundNo === 2 && r.phase === 'ended' && r.commentMode === 'off'), PF_DELAY_MS * 4 + 3000);
  const final2f = finalComments(P, f2);
  check('丙：第二回合第一名最終 null、其他兩位有批評句、round:update off', final2f.get(f2.results[0].playerId) === null && [...final2f].filter(([id]) => id !== f2.results[0].playerId).every(([, c]) => sentenceOk(c)) && P.rounds.some((r) => r.roundNo === 2 && r.phase === 'ended' && r.commentMode === 'off'), j([...final2f]));
} catch (err) {
  check('沒有例外', false, String(err?.stack ?? err));
} finally {
  for (const s of sockets) s.close();
}

for (const [st, name, extra] of R) console.log(`${st}  ${name}${extra ? '  ' + extra : ''}`);
const pass = R.filter((r) => r[0] === 'PASS').length;
console.log(`\n${pass}/${R.length} passed`);
process.exit(pass === R.length ? 0 : 1);
