// 繪圖比賽「第一名重做稱讚版」協定符合性測試（Epic 15 Phase 4；Phase 5 改）：只依 spec/draw-contest/architecture.md §5「評語」第一名重做、§6.1 稱讚版 user 文案、
// 佇列失敗規則與假 Ollama 規則打 Socket，不看實作、不 import server 內部程式。補 draw-contest-comment.mjs／-fallback.mjs 未涵蓋的三個情境：
//   甲、單人回合（§5「單人回合的第一名也稱讚」）＋「正在產生中則讓它跑完，稱讚版緊接著跑」：唯一參賽者交卷即揭曉，他的批評版此時正在產生 →
//       揭曉當下 comment null／commentPending true；之後只收到一則 contest:comment（跑完的批評版不顯示、不發事件）、內容是稱讚句；
//       到達時間約兩次假 Ollama 延遲（批評版跑完才輪到稱讚版）。
//   乙、五人回合「插隊」：前兩位的評語早已完成、第三位正在產生、後兩位排隊中時揭曉 → 第一名不論原狀態一律重設 pending；
//       揭曉後的 contest:comment 順序：第一名的稱讚版在所有「排隊中」的人之前（在途那張是別人的就等它跑完、它的事件先到；是第一名自己的也等它跑完但不發事件，稱讚版第一個到）；
//       第一名只有一則事件、其他人都是批評句、不 pending 的早完成者沒有事件；中途加入者快照同步。
//   丙、只有稱讚版失敗（假 Ollama MOCK_PRAISE_CONTENT= 空字串）→ **退回批評版**：其他人的評語照常；第一名揭曉當下 pending，之後收到的 contest:comment 是他原本的批評句
//       （揭曉前已產生、或揭曉時在途跑完的那句）；原工作還在排隊就被稱讚版取代的才是 null、不補跑。單次失敗不發 round:update、commentMode 維持 'ai'。
//       四個回合（同題目、同三張圖：§6 random 評分確定性，第一回合得知哪張圖最高分後，安排它由第幾位交卷）：
//         一、依序錯開交卷（不指定第一名）：通用斷言。
//         二、最高分的圖最先交、等他的批評版完成才換別人 → 「揭曉前已產生批評版」→ 退回那句。
//         三、最高分的圖最後交、且第一位的批評版還在產生 → 第一名的批評版仍在排隊、被取代 → null。
//         四、最高分的圖最先交、三人緊接著交完 → 揭曉時第一名的批評版正在產生 → 跑完當退路 → 退回那句（約兩次延遲後到）。
// 作者：驗收子代理（代架構師海圖），2026-10-12。
// Epic 15 Phase 5（2026-10-13 改，Rex 定案）：稱讚版失敗或被跳過退回批評版（原「不退回、最終 null、round:update off」）；單張失敗只影響該張、
//   同一回合連續兩次失敗才跳過剩餘；揭曉時第一名在途的批評版不中止（原「直接中止、稱讚版立即接著跑」）。改寫的斷言處標「2026-10-13 Phase 5」。
//
// 需要兩個 server 程序與兩個假 Ollama；**不碰真模型**。用法（專案根目錄，需先 npm run build；隔離埠且只綁本機；**每次都要全新的 server 程序**；
// **避免用瀏覽器開過的埠**）：
//   MOCK_PORT=11457 MOCK_CHAT_DELAY_MS=1500 node user/mock/systemone.mjs &                       # 甲、乙用：延遲夠長才看得出插隊與先後
//   MOCK_PORT=11458 MOCK_CHAT_DELAY_MS=300 MOCK_PRAISE_CONTENT= node user/mock/systemone.mjs &    # 丙用：只有稱讚版回空字串
//   HOST=127.0.0.1 PORT=3227 JUDGE=random JUDGE_FAKE_DELAY_MS=0 COMMENT=ollama OLLAMA_URL=http://127.0.0.1:11457 node server/dist/index.js &
//   HOST=127.0.0.1 PORT=3228 JUDGE=random JUDGE_FAKE_DELAY_MS=0 COMMENT=ollama OLLAMA_URL=http://127.0.0.1:11458 node server/dist/index.js &
//   TEST_PORT=3227 TEST_PORT_PRAISE_FAIL=3228 node --input-type=module < user/protocol/draw-contest-comment-praise.mjs
// 甲乙的假 Ollama 延遲不是 1500 時請同步設 TEST_CHAT_DELAY_MS、丙的不是 300 時設 TEST_PF_DELAY_MS（等待與時間斷言由它們推算）。總時長約 35 秒；全部 PASS 時 exit 0。
// 未涵蓋：COMMENT=off 與「本回合已連續兩次失敗」時第一名不重設（draw-contest-comment.mjs 乙段、-fallback.mjs 甲丙段已驗）；稱讚版逾時起算、
// 稱讚版「被跳過」時退回批評版（需要別張先失敗一次再失敗一次的精準時序）放 server 的 vitest。

import { io } from 'socket.io-client';
import { deflateSync } from 'node:zlib';

const PORT_AI = process.env.TEST_PORT ?? '3227';
const PORT_PF = process.env.TEST_PORT_PRAISE_FAIL ?? '3228';
/** 甲乙假 Ollama 的 MOCK_CHAT_DELAY_MS（推算等待與「到達時間約兩次延遲」） */
const CHAT_DELAY_MS = Number(process.env.TEST_CHAT_DELAY_MS ?? 1500);
/** 丙假 Ollama 的 MOCK_CHAT_DELAY_MS */
const PF_DELAY_MS = Number(process.env.TEST_PF_DELAY_MS ?? 300);

// ── 常數：.mjs 不能 import .ts，照既有協定測試慣例寫死；出處 shared/src/draw-contest/constants.ts（spec §4 常數表）──
const CANVAS_LOGICAL = { width: 1280, height: 720 };

// ── 假 Ollama 的稱讚句：出處 user/mock/systemone.mjs 的 MOCK_PRAISES（spec §6.1：user 文案含「這張是本回合第一名」（2026-10-21 Phase 7 起比對此片段）時回稱讚句，與批評句沒有交集）──
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
/** 先把圖產好再交（丙的第三、四回合要三人在一次假 Ollama 延遲內交完，產圖的時間不能算進去） */
const submitPng = (p, png) => call(p.s, 'contest:submit', { png: ab(png) });
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
  // 甲、單人回合：第一名也稱讚；在途的批評版跑完（不發事件）、稱讚版緊接著跑
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
  await sleep(CHAT_DELAY_MS + 400);   // 在途的批評版此時已跑完
  // 2026-10-13 Phase 5：原本批評版被中止、稱讚句約一次延遲就到；現在批評版跑完（不發事件）才輪到稱讚版
  check('甲：在途的批評版跑完時不發 contest:comment、第一名仍 pending（那句只當退路，不顯示）', commentsOf(W, 1).length === 0 && W.rounds.filter((r) => r.roundNo === 1 && r.phase === 'ended').length === 1, j([commentsOf(W, 1), W.seq]));
  const J0 = await joinAs(PORT_AI, 'Joiner0'); sockets.push(J0.s);
  check('甲：此時加入者的快照：第一名仍是 comment null、commentPending true（看不到那句批評版）', J0.snap.round.phase === 'ended' && J0.snap.round.results?.find((e) => e.playerId === A.id)?.comment === null && J0.snap.round.results.find((e) => e.playerId === A.id).commentPending === true, j(J0.snap.round.results));
  await until(() => commentsOf(W, 1).length >= 1, CHAT_DELAY_MS * 2 + 3000);
  await sleep(CHAT_DELAY_MS + 500);   // 多等一次延遲：確認不會再補發第二則
  const c1 = commentsOf(W, 1);
  check('甲：之後只收到一則 contest:comment（跑完的批評版不發事件）', c1.length === 1 && c1[0].playerId === A.id, j(c1));
  check('甲：單人回合第一名的評語是稱讚句', c1.length === 1 && isPraise(c1[0].comment), j(c1[0]?.comment));
  const dt1 = c1[0] ? c1[0].at - e1.at : NaN;
  check(`甲：稱讚句約兩次假 Ollama 延遲後到達（${dt1} ms，介於 ${CHAT_DELAY_MS * 2 - 300} 與 ${CHAT_DELAY_MS * 3}；在途的批評版跑完才輪到稱讚版）`, dt1 >= CHAT_DELAY_MS * 2 - 300 && dt1 < CHAT_DELAY_MS * 3, `${dt1} ms`);
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
  W.s.close(); J0.s.close(); J1.s.close();   // 上一回合的旁觀者離開，否則會成為本回合未交卷的參賽者
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
  await sleep(CHAT_DELAY_MS + 300);   // 多等一次：確認第一名沒有第二則（被取代的批評版不跑、在途跑完的批評版不發事件）
  const c2 = commentsOf(W2, 2);
  check('乙：揭曉後每位 pending 者各收到恰好一則 contest:comment（第一名只有一則、早完成者沒有事件）', sameSet(c2.map((c) => c.playerId), expectedPending), j(c2.map((c) => [c.playerId, c.comment])));
  const winnerEvt = c2.find((c) => c.playerId === winner.playerId);
  check('乙：第一名的評語是稱讚句', winnerEvt && isPraise(winnerEvt.comment), j(winnerEvt));
  check('乙：其他人的評語都是批評句（不是稱讚句）、且與第一名的不同', c2.filter((c) => c.playerId !== winner.playerId).every((c) => sentenceOk(c.comment) && !isPraise(c.comment)), j(c2));
  const idx = c2.findIndex((c) => c.playerId === winner.playerId);
  const inflightFirst = winner.playerId !== C.id && c2[0]?.playerId === C.id;
  check(`乙：稱讚版插隊——第一名是在途者（C）時他的事件第一個到（在途的批評版跑完不發事件）；否則在途的 C 先到、稱讚版第二個到，排隊中的 D／E 都在它之後（順序 ${j(c2.map((c) => c.playerId === winner.playerId ? 'WINNER' : c.playerId === C.id ? 'C' : c.playerId === D.id ? 'D' : 'E'))}）`,
    winner.playerId === C.id ? idx === 0 : (inflightFirst && idx === 1), '');
  const dt2 = winnerEvt ? winnerEvt.at - e2.at : NaN;
  // 2026-10-13 Phase 5：第一名是在途者（C）時原本一次延遲（批評版被中止）；現在一律兩次（在途那張跑完＋稱讚版）
  const bound2 = 2 * CHAT_DELAY_MS + 1200;
  check(`乙：稱讚句到達時間 ${dt2} ms（上限 ${bound2}：在途那張跑完＋稱讚版＝兩次延遲；沒插隊會是三次以上）`, dt2 >= 0 && dt2 < bound2, `${dt2} ms`);
  check('乙：所有連線收到的事件順序一致', [A, B, C, D, E].every((p) => j(commentsOf(p, 2).map((c) => [c.playerId, c.comment])) === j(c2.map((c) => [c.playerId, c.comment]))), j([A, C].map((p) => commentsOf(p, 2).map((c) => c.playerId))));
  const final2 = finalComments(W2, e2);
  const J2 = await joinAs(PORT_AI, 'Joiner2'); sockets.push(J2.s);
  check('乙：完成後加入者快照：每位交卷者 comment 與廣播一致、commentPending false、第一名為稱讚句', J2.snap.round.results.filter((e) => e.submitted).every((e) => e.comment === final2.get(e.playerId) && e.commentPending === false) && isPraise(J2.snap.round.results[0].comment), j(J2.snap.round.results.map((e) => [e.rank, e.comment])));

  // ══════════════════════════════════════════════════════════════════
  // 丙、只有稱讚版失敗 → 退回批評版（2026-10-13 Phase 5：原本第一名最終 null、不退回，並以規則 (b) 收尾 round:update off）
  // ══════════════════════════════════════════════════════════════════
  const P = await joinAs(PORT_PF, 'Pam'); sockets.push(P.s);
  if (P.snap.players.length !== 1) throw new Error(`需要全新的 server 程序（埠 ${PORT_PF} 的房間已有其他玩家）`);
  const Q = await joinAs(PORT_PF, 'Quinn'); sockets.push(Q.s);
  const S = await joinAs(PORT_PF, 'Sam'); sockets.push(S.s);
  const trio = [P, Q, S];
  const TOPIC = '西瓜';                    // 四個回合同一題：同圖同題同分（§6 random 確定性）
  const SEEDS = [21, 22, 23];
  const PNGS = new Map(SEEDS.map((seed) => [seed, makePng(seed)]));
  /** 某回合所有連線都沒有收到 commentMode off（單次失敗不發 round:update） */
  const neverOff = (roundNo) => trio.every((p) => p.rounds.filter((r) => r.roundNo === roundNo).every((r) => r.commentMode !== 'off'));
  const endedCount = (p, roundNo) => p.rounds.filter((r) => r.roundNo === roundNo && r.phase === 'ended').length;

  // ── 第一回合：依序錯開交卷（不指定第一名），通用斷言 ──
  await startRound(P, P, 1, TOPIC);
  const V = await joinAs(PORT_PF, 'Viewer'); sockets.push(V.s);   // 旁觀者（drawing 後加入）
  await submitPng(P, PNGS.get(21)); await sleep(PF_DELAY_MS + 400);   // P 的批評版完成
  await submitPng(Q, PNGS.get(22)); await sleep(PF_DELAY_MS + 400);   // Q 的批評版完成
  await submitPng(S, PNGS.get(23));                                    // S 在途 → 揭曉
  await waitPhase(V, 'ended', 1);
  const f1 = endedOf(V, 1);
  const fw = f1.results[0];
  check('丙：ended commentMode ai、第一名 pending（重做稱讚版）', f1.commentMode === 'ai' && winnerPendingOk(f1), j(f1.results.map((e) => [e.playerId, e.rank, e.comment, e.commentPending])));
  check('丙：早完成的非第一名（P／Q）揭曉時已有批評句', [P.id, Q.id].filter((id) => id !== fw.playerId).every((id) => { const e = f1.results.find((x) => x.playerId === id); return sentenceOk(e.comment) && e.commentPending === false; }), j(f1.results));
  const fPending = f1.results.filter((e) => e.commentPending).map((e) => e.playerId);
  await until(() => sameSet(commentsOf(V, 1).map((c) => c.playerId), fPending), PF_DELAY_MS * 4 + 3000);
  await sleep(PF_DELAY_MS + 300);
  const fc = commentsOf(V, 1);
  check('丙：揭曉當下 pending 的每一張各恰好一則 contest:comment（第一名與在途的 S）', sameSet(fc.map((c) => c.playerId), fPending), j(fc));
  const fwEvt = fc.find((c) => c.playerId === fw.playerId);
  // 2026-10-13 Phase 5：原本是 { comment: null }
  check('丙：稱讚版失敗 → 第一名的 contest:comment 是他的批評句（非空、不是稱讚句；揭曉前已產生或揭曉時在途跑完的那句）', fwEvt && sentenceOk(fwEvt.comment) && !isPraise(fwEvt.comment), j(fwEvt));
  check('丙：在途的 S（若非第一名）照常收到批評句', fw.playerId === S.id || fc.some((c) => c.playerId === S.id && sentenceOk(c.comment) && !isPraise(c.comment)), j(fc));
  // 2026-10-13 Phase 5：原本有一則 round:update commentMode off
  check('丙：單次失敗不發 round:update：ended 的 round:update 只有揭曉那一則、commentMode 一直是 ai', endedCount(V, 1) === 1 && V.rounds.filter((r) => r.roundNo === 1).every((r) => r.commentMode !== 'off'), j(V.seq));
  const finalF = finalComments(V, f1);
  check('丙：最終三位都有非空批評句（沒有人是稱讚句、沒有人是 null）', [...finalF].length === 3 && [...finalF].every(([, c]) => sentenceOk(c) && !isPraise(c)), j([...finalF]));
  const J3 = await joinAs(PORT_PF, 'Joiner3'); sockets.push(J3.s);
  const j3 = J3.snap.round;
  check('丙：之後加入者快照：commentMode ai、每位交卷者 comment 與廣播一致、commentPending false（server 端 results 已同步寫入退回的批評版）', j3.phase === 'ended' && j3.commentMode === 'ai' && j3.results.filter((e) => e.submitted).every((e) => e.comment === finalF.get(e.playerId) && e.commentPending === false), j(j3.results.map((e) => [e.rank, e.comment, e.commentPending])));
  check('丙：所有連線收到的事件一致', trio.every((p) => j(commentsOf(p, 1).map((c) => [c.playerId, c.comment])) === j(fc.map((c) => [c.playerId, c.comment]))), '');

  // 第一回合得知三張圖的分數與批評句（同圖同題同分、假 Ollama 同圖同一句批評）
  const seedOf1 = new Map([[P.id, 21], [Q.id, 22], [S.id, 23]]);
  const scoreOf = new Map(f1.results.map((e) => [seedOf1.get(e.playerId), e.score]));
  const lineOf = new Map([...finalF].map(([id, c]) => [seedOf1.get(id), c]));
  const ranked = [...SEEDS].sort((x, y) => scoreOf.get(y) - scoreOf.get(x));
  const [top, mid, low] = ranked;
  check('丙 前置：三張圖最高分唯一（後面三個回合靠它安排第一名）', scoreOf.get(top) > scoreOf.get(mid), j([...scoreOf]));
  V.s.close(); J3.s.close(); await sleep(300);   // 旁觀者離開，免得成為未交卷參賽者

  // ── 第二回合：揭曉前已產生批評版 → 稱讚版失敗退回那句 ──
  await startRound(Q, P, 2, TOPIC);
  check('丙二：drawing commentMode 回 null', lastRound(P).commentMode === null, j(lastRound(P)));
  await submitPng(P, PNGS.get(top)); await sleep(PF_DELAY_MS + 400);   // 第一名（P）的批評版在揭曉前就完成
  await submitPng(Q, PNGS.get(mid)); await sleep(PF_DELAY_MS + 400);
  await submitPng(S, PNGS.get(low));                                    // S 在途 → 揭曉
  await waitPhase(P, 'ended', 2);
  const g2 = endedOf(P, 2);
  check('丙二：第一名是最先交卷的 P（最高分的圖）；judging 起 commentMode ai（上回合的失敗不延續）', g2.results[0].playerId === P.id && P.rounds.filter((r) => r.roundNo === 2 && r.phase === 'judging').every((r) => r.commentMode === 'ai') && g2.commentMode === 'ai', j(g2.results.map((e) => [e.playerId, e.rank, e.score])));
  check('丙二：第一名的批評版雖已完成，揭曉當下仍是 comment null、commentPending true', winnerPendingOk(g2), j(g2.results[0]));
  await until(() => sameSet(commentsOf(P, 2).map((c) => c.playerId), [P.id, S.id]), PF_DELAY_MS * 4 + 3000);
  await sleep(PF_DELAY_MS + 300);
  const gc2 = commentsOf(P, 2);
  check('丙二：只有第一名與在途的 S 各一則 contest:comment', sameSet(gc2.map((c) => c.playerId), [P.id, S.id]), j(gc2));
  check('丙二：稱讚版失敗 → 第一名收到揭曉前已產生的那句批評版（與第一回合同一張圖拿到的批評句相同）', gc2.find((c) => c.playerId === P.id)?.comment === lineOf.get(top) && sentenceOk(lineOf.get(top)), j([gc2, lineOf.get(top)]));
  check('丙二：不發 round:update off、commentMode 維持 ai；三位連線事件一致', neverOff(2) && endedCount(P, 2) === 1 && trio.every((p) => j(commentsOf(p, 2).map((c) => [c.playerId, c.comment])) === j(gc2.map((c) => [c.playerId, c.comment]))), j(P.seq));

  // ── 第三回合：第一名的批評版還在排隊（被稱讚版取代）→ 沒有退路 → null，不補跑 ──
  await startRound(S, P, 3, TOPIC);
  // 三人在一次假 Ollama 延遲內交完：P（最低分）的批評版在途、Q 排隊、S（最高分）最後交 → 排隊 → 揭曉
  const t3 = Date.now();
  await submitPng(P, PNGS.get(low));
  await submitPng(Q, PNGS.get(mid));
  await submitPng(S, PNGS.get(top));
  const span3 = Date.now() - t3;
  await waitPhase(P, 'ended', 3);
  const g3 = endedOf(P, 3);
  check(`丙三 前置：三人在一次延遲內交完（${span3} ms < ${PF_DELAY_MS - 50}）、第一名是最後交卷的 S`, span3 < PF_DELAY_MS - 50 && g3.results[0].playerId === S.id, j([span3, g3.results.map((e) => [e.playerId, e.rank, e.score])]));
  check('丙三：揭曉當下三張皆 pending（P 在途、Q 排隊、第一名重做）', g3.commentMode === 'ai' && g3.results.every((e) => e.comment === null && e.commentPending === true), j(g3.results.map((e) => [e.comment, e.commentPending])));
  await until(() => sameSet(commentsOf(P, 3).map((c) => c.playerId), [P.id, Q.id, S.id]), PF_DELAY_MS * 4 + 3000);
  await sleep(PF_DELAY_MS * 2 + 300);   // 多等兩次延遲：確認沒有補跑批評版
  const gc3 = commentsOf(P, 3);
  check('丙三：三張各恰好一則 contest:comment', sameSet(gc3.map((c) => c.playerId), [P.id, Q.id, S.id]), j(gc3));
  check('丙三：沒有批評版可退回 → 第一名的 contest:comment 為 { comment: null }（不補跑批評版）', gc3.find((c) => c.playerId === S.id)?.comment === null, j(gc3));
  check('丙三：稱讚版單次失敗不影響其他人——排在它後面的 Q 照常收到批評句；事件順序＝在途的 P、插隊的第一名、Q', sentenceOk(gc3.find((c) => c.playerId === Q.id)?.comment) && sentenceOk(gc3.find((c) => c.playerId === P.id)?.comment) && j(gc3.map((c) => c.playerId)) === j([P.id, S.id, Q.id]), j(gc3));
  check('丙三：不發 round:update off、commentMode 維持 ai', neverOff(3) && endedCount(P, 3) === 1, j(P.seq));
  const J4 = await joinAs(PORT_PF, 'Joiner4'); sockets.push(J4.s);
  check('丙三：之後加入者快照：commentMode ai、第一名 comment null／commentPending false、其他人為字串', J4.snap.round.phase === 'ended' && J4.snap.round.commentMode === 'ai' && J4.snap.round.results[0].comment === null && J4.snap.round.results[0].commentPending === false && J4.snap.round.results.filter((e) => e.rank !== 1).every((e) => sentenceOk(e.comment) && e.commentPending === false), j(J4.snap.round.results.map((e) => [e.rank, e.comment, e.commentPending])));
  J4.s.close(); await sleep(300);

  // ── 第四回合：揭曉時第一名的批評版正在產生 → 跑完當退路 → 稱讚版失敗退回那句 ──
  await startRound(P, P, 4, TOPIC);
  const t4 = Date.now();
  await submitPng(P, PNGS.get(top));   // 第一名最先交：批評版在途
  await submitPng(Q, PNGS.get(mid));
  await submitPng(S, PNGS.get(low));
  const span4 = Date.now() - t4;
  await waitPhase(P, 'ended', 4);
  const g4 = endedOf(P, 4);
  check(`丙四 前置：三人在一次延遲內交完（${span4} ms < ${PF_DELAY_MS - 50}）、第一名是最先交卷的 P`, span4 < PF_DELAY_MS - 50 && g4.results[0].playerId === P.id, j([span4, g4.results.map((e) => [e.playerId, e.rank, e.score])]));
  check('丙四：揭曉當下三張皆 pending', g4.commentMode === 'ai' && g4.results.every((e) => e.comment === null && e.commentPending === true), j(g4.results.map((e) => [e.comment, e.commentPending])));
  await until(() => sameSet(commentsOf(P, 4).map((c) => c.playerId), [P.id, Q.id, S.id]), PF_DELAY_MS * 5 + 3000);
  await sleep(PF_DELAY_MS + 300);
  const gc4 = commentsOf(P, 4);
  check('丙四：三張各恰好一則 contest:comment（第一名在途的批評版跑完時不發事件）', sameSet(gc4.map((c) => c.playerId), [P.id, Q.id, S.id]), j(gc4));
  const pEvt4 = gc4.find((c) => c.playerId === P.id);
  check('丙四：稱讚版失敗 → 第一名收到揭曉時在途、之後跑完的那句批評版（與同一張圖的批評句相同）', pEvt4?.comment === lineOf.get(top), j([pEvt4, lineOf.get(top)]));
  const dt4 = pEvt4 ? pEvt4.at - g4.at : NaN;
  check(`丙四：第一名的事件在約兩次延遲後到（${dt4} ms ≥ ${PF_DELAY_MS * 2 - 150}：批評版跑完＋稱讚版），且在排隊中的 Q、S 之前`, dt4 >= PF_DELAY_MS * 2 - 150 && gc4[0]?.playerId === P.id, `${dt4} ms ${j(gc4.map((c) => c.playerId))}`);
  check('丙四：其他兩位照常收到批評句；不發 round:update off、commentMode 維持 ai', [Q.id, S.id].every((id) => sentenceOk(gc4.find((c) => c.playerId === id)?.comment)) && neverOff(4) && endedCount(P, 4) === 1, j(P.seq));
} catch (err) {
  check('沒有例外', false, String(err?.stack ?? err));
} finally {
  for (const s of sockets) s.close();
}

for (const [st, name, extra] of R) console.log(`${st}  ${name}${extra ? '  ' + extra : ''}`);
const pass = R.filter((r) => r[0] === 'PASS').length;
console.log(`\n${pass}/${R.length} passed`);
process.exit(pass === R.length ? 0 : 1);
