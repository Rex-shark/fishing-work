// 繪圖比賽評語「失敗退回」協定符合性測試（Epic 15）：只依 spec/draw-contest/architecture.md §3（JUDGE 退回）、§5「評語」、§6.1「佇列」失敗規則 (a)(b)(c) 打 Socket，
// 不看實作、不 import server 內部程式。補 draw-contest-comment.mjs 未涵蓋的三個情境（它只測成功路徑）：
//   甲、Ollama 連不上（OLLAMA_URL 指到沒有東西在聽的位址）：評分退回 random、評語沒有、揭曉仍在有界時間內出現、沒有卡片永遠 pending、沒有 contest:comment；下一回合重新嘗試後結果相同。
//   乙、評語逾時且失敗發生在 ended 之後（規則 (b)）：揭曉時各張 commentPending true → **連續兩次逾時**後每張各一則 contest:comment { comment: null } 加一則 round:update（commentMode 'off'）；
//       第一次逾時不收尾（round:update 'off' 要到第二次逾時才出現）；中途加入者快照所有 comment null、commentPending false；下一回合 commentMode 重新從 'ai' 開始。
//   丙、評語輸出空白且失敗發生在 drawing（規則 (c)／(a)）：drawing 期間 commentMode 仍為 null、不發事件；drawing 中**連續兩次**失敗 → 進 judging 直接 'off'；
//       ended 的 results 全部 comment null、commentPending false、沒有 contest:comment。第二回合：drawing 中**只失敗一次** → 進 judging 仍是 'ai'。
// 作者：驗收子代理（代架構師海圖），2026-10-12。
// Epic 15 Phase 4（2026-10-12 補，§5 評語「第一名重做稱讚版」）：三個情境各加一項第一名的斷言——
//   甲、丙：commentMode 'off'（本回合已連續兩次失敗）→ 第一名不重做，rank 1 維持 comment null／commentPending false、沒有事件；
//   乙：ended 時 commentMode 'ai' → 第一名 commentPending true（重做稱讚版）；之後逾時，第一名照規則 (b) 收到 contest:comment { comment: null }，最終沒有評語。
// Epic 15 Phase 5（2026-10-13 改，Rex 定案：單張失敗只影響該張、同一回合連續兩次失敗才跳過剩餘並 commentMode 'off'）：
//   乙：收尾時間由一次逾時改為兩次（「有界」上限改為 2 × COMMENT_TIMEOUT_MS ＋ 2 s），並加「第一次逾時不收尾」的時間斷言；
//   丙：第一回合改成前兩張都在 drawing 失敗後第三張才交卷；新增第二回合（兩人）驗「drawing 中只失敗一次 → judging 仍 ai」。
//   改寫的斷言處標「2026-10-13 Phase 5」；甲的斷言不變（三張依序評分，前兩張的評語都在第三張評完前失敗）。
//
// 需要三個 server 程序與兩個假 Ollama；**不碰真模型**。用法（專案根目錄，需先 npm run build；隔離埠且只綁本機；**每次都要全新的 server 程序**）：
//   MOCK_PORT=11447 MOCK_CHAT_DELAY_MS=5000 node user/mock/systemone.mjs &                     # 乙用：評語回得比 COMMENT_TIMEOUT_MS 慢 → 逾時
//   MOCK_PORT=11448 MOCK_CHAT_CONTENT= node user/mock/systemone.mjs &                          # 丙用：評語輸出空白（立即回）
//   HOST=127.0.0.1 PORT=3217 JUDGE=ollama COMMENT=ollama OLLAMA_URL=http://127.0.0.1:1 node server/dist/index.js &                                    # 甲：連不上
//   HOST=127.0.0.1 PORT=3218 JUDGE=random JUDGE_FAKE_DELAY_MS=0 COMMENT=ollama COMMENT_TIMEOUT_MS=600 OLLAMA_URL=http://127.0.0.1:11447 node server/dist/index.js &   # 乙：逾時
//   HOST=127.0.0.1 PORT=3219 JUDGE=random JUDGE_FAKE_DELAY_MS=0 COMMENT=ollama OLLAMA_URL=http://127.0.0.1:11448 node server/dist/index.js &         # 丙：空輸出
//   TEST_PORT_DOWN=3217 TEST_PORT_TIMEOUT=3218 TEST_PORT_EMPTY=3219 node --input-type=module < user/protocol/draw-contest-comment-fallback.mjs
// 總時長約 15 秒；全部 PASS 時 exit 0。
// 未涵蓋（放 server 的 vitest）：規則 (b) 的例外（失敗時已進下一回合 choosing → 不發 round:update）、參賽者寬限期滿離開的丟棄、ended 後離開者照常收到評語。
import { io } from 'socket.io-client';
import { deflateSync } from 'node:zlib';

const PORT_DOWN = process.env.TEST_PORT_DOWN ?? '3217';
const PORT_TIMEOUT = process.env.TEST_PORT_TIMEOUT ?? '3218';
const PORT_EMPTY = process.env.TEST_PORT_EMPTY ?? '3219';
/** 乙的 server 以 COMMENT_TIMEOUT_MS=600 啟動（用法見檔頭）；這裡用來算「有界」的上限與「第一次逾時不收尾」的下限 */
const COMMENT_TIMEOUT_MS = Number(process.env.TEST_COMMENT_TIMEOUT_MS ?? 600);

// ── 常數：.mjs 不能 import .ts，照既有協定測試慣例寫死；出處 shared/src/draw-contest/constants.ts（spec §4 常數表）──
const CANVAS_LOGICAL = { width: 1280, height: 720 };
const SCORE_MAX = 100;

// ── 測試框架（同 draw-contest-comment.mjs）──
const R = [];
const check = (name, cond, extra = '') => R.push([cond ? 'PASS' : 'FAIL', name, extra]);
const connect = (port) => io(`http://127.0.0.1:${port}/draw-contest`, { path: '/socket.io', transports: ['websocket'], forceNew: true, reconnection: false });
const call = (s, ev, ...args) => new Promise((res) => s.emit(ev, ...args, res));
const once = (s, ev, ms = 4000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), ms); s.once(ev, (...a) => { clearTimeout(t); res(a); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (pred, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(20); } return pred(); };
const j = (x) => JSON.stringify(x)?.slice(0, 400);
const ab = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
/** 每個 socket 都先掛好收集器再 join；seq 依到達順序記 round:update 的 phase／commentMode 與 contest:comment；每筆附到達時間 */
const joinAs = async (port, nick) => {
  const s = connect(port); await once(s, 'connect');
  const seq = [], rounds = [], comments = [], commentAt = [];
  s.on('round:update', (r) => { rounds.push({ ...r, _at: Date.now() }); seq.push(`round:${r.roundNo}:${r.phase}:${r.commentMode}`); });
  s.on('contest:comment', (c) => { comments.push(c); commentAt.push(Date.now()); seq.push(`comment:${c.roundNo}`); });   // 存原物件（形狀檢查要看鍵）；到達時間另存在 commentAt（同索引）
  const r = await call(s, 'player:join', { nickname: nick });
  if (!r?.ok) throw new Error('join failed ' + j(r));
  return { s, nick, id: r.data.snapshot.you, snap: r.data.snapshot, seq, rounds, comments, commentAt };
};
const lastRound = (p) => p.rounds.at(-1);
const waitPhase = (p, phase, roundNo, ms = 5000) => until(() => lastRound(p)?.phase === phase && (roundNo === undefined || lastRound(p).roundNo === roundNo), ms);
/** 開一回合：setter 自願、送題，等 watcher 看到 drawing */
const startRound = async (setter, watcher, topic, roundNo) => {
  const rv = await call(setter.s, 'round:volunteer');
  if (!rv?.ok) throw new Error('volunteer failed ' + j(rv));
  await waitPhase(watcher, 'choosing');
  const rt = await call(setter.s, 'round:setTopic', { topic });
  if (!rt?.ok) throw new Error('setTopic failed ' + j(rt));
  await waitPhase(watcher, 'drawing', roundNo);
};

// ── PNG 產生器（同 draw-contest-comment.mjs）──
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

// ── §4／§6.1 的斷言 ──
/** 沒有評語（失敗、跳過、關閉、未交卷）：comment null 且不 pending */
const noComment = (e) => 'comment' in e && e.comment === null && e.commentPending === false;
/** 產生中：comment null 且 pending */
const pendingComment = (e) => e.comment === null && e.commentPending === true;
/** 這個 socket 在某個 roundNo、某 phase 收到的 round:update */
const updates = (p, roundNo, phase) => p.rounds.filter((r) => r.roundNo === roundNo && (phase === undefined || r.phase === phase));

const sockets = [];
try {
  // ══════════════════════════════════════════════════════════════════
  // 甲、Ollama 連不上：評分退回 random、評語沒有、揭曉有界
  // ══════════════════════════════════════════════════════════════════
  const A = await joinAs(PORT_DOWN, 'Alice'); sockets.push(A.s);
  if (A.snap.players.length !== 1) throw new Error(`需要全新的 server 程序（埠 ${PORT_DOWN} 的房間已有其他玩家）`);
  const B = await joinAs(PORT_DOWN, 'Bob'); sockets.push(B.s);
  const C = await joinAs(PORT_DOWN, 'Cara'); sockets.push(C.s);
  await startRound(A, C, '蘋果', 1);
  const tSub = Date.now();
  const subs = [await submit(A, 1), await submit(B, 2), await submit(C, 3)];
  check('甲 三人交卷 ok', subs.every((r) => r?.ok === true), j(subs));
  await waitPhase(C, 'ended', 1, 12_000);
  const e1 = lastRound(C);
  const tEnd = Date.now();
  check('甲 揭曉在有界時間內出現（連不上立即失敗，遠小於 JUDGE_TIMEOUT_MS 30 s）', e1?.phase === 'ended' && e1.roundNo === 1 && tEnd - tSub < 10_000, `${tEnd - tSub} ms ${j(e1)}`);
  check('甲 judgeMode random、每張 judgedBy random、分數為整數 0..SCORE_MAX（§3 失敗退回）', e1?.judgeMode === 'random' && e1.results?.length === 3 && e1.results.every((e) => e.judgedBy === 'random' && e.submitted && Number.isInteger(e.score) && e.score >= 0 && e.score <= SCORE_MAX), j(e1?.results));
  check('甲 ended：commentMode off（評語連不上＝本回合連續兩次失敗後跳過）', e1?.commentMode === 'off', j(e1?.commentMode));
  check('甲 judging／ended 的每則 round:update commentMode 只會是 ai 或 off，且最後為 off', updates(C, 1).filter((r) => r.phase === 'judging' || r.phase === 'ended').every((r) => r.commentMode === 'ai' || r.commentMode === 'off') && lastRound(C).commentMode === 'off', j(C.seq));
  check('甲 results 每筆 comment null、commentPending false（沒有卡片永遠 pending）', e1?.results.every(noComment), j(e1?.results.map((e) => [e.comment, e.commentPending])));
  check('甲 第一名不重做（commentMode off）：rank 1 有交卷，comment null、commentPending false', e1?.results[0]?.rank === 1 && e1.results[0].submitted === true && noComment(e1.results[0]), j(e1?.results[0]));
  await sleep(1500);
  check('甲 揭曉後 1.5 秒內沒有任何 contest:comment（規則 (a)／(c)：ended 前失敗不發事件）', [A, B, C].every((p) => p.comments.length === 0), j([A, B, C].map((p) => p.comments)));
  check('甲 排名仍正確：rank 1..3、score 降冪、同分先交卷在前', e1?.results.every((e, i) => e.rank === i + 1 && (i === 0 || e1.results[i - 1].score > e.score || (e1.results[i - 1].score === e.score && e1.results[i - 1].submittedAt <= e.submittedAt))), j(e1?.results.map((e) => [e.rank, e.score, e.submittedAt])));
  const L1 = await joinAs(PORT_DOWN, 'Late'); sockets.push(L1.s);
  check('甲 中途加入者快照：commentMode off、results 全部 comment null／pending false', L1.snap.round.phase === 'ended' && L1.snap.round.commentMode === 'off' && L1.snap.round.results?.length === 3 && L1.snap.round.results.every(noComment), j(L1.snap.round));
  // 下一回合重新嘗試（§6.1「下一回合重新嘗試」）：結果一樣退回，但 drawing 時 commentMode 回 null
  await startRound(B, C, '貓', 2);
  check('甲 第二回合 drawing：commentMode 回 null、results 清空', lastRound(C).roundNo === 2 && lastRound(C).commentMode === null && lastRound(C).results === null, j(lastRound(C)));
  const tSub2 = Date.now();
  const subs2 = [await submit(A, 4), await submit(B, 5), await submit(C, 6), await submit(L1, 7)];
  check('甲 第二回合四人交卷 ok', subs2.every((r) => r?.ok === true), j(subs2));
  await waitPhase(C, 'ended', 2, 12_000);
  const e2 = lastRound(C);
  check('甲 第二回合仍在有界時間內揭曉、judgeMode random、commentMode off、results 4 筆皆無評語', e2?.phase === 'ended' && Date.now() - tSub2 < 10_000 && e2.judgeMode === 'random' && e2.commentMode === 'off' && e2.results?.length === 4 && e2.results.every(noComment), j(e2));
  await sleep(800);
  check('甲 第二回合也沒有 contest:comment', [A, B, C, L1].every((p) => p.comments.length === 0), j(C.comments));

  // ══════════════════════════════════════════════════════════════════
  // 乙、評語逾時，連續兩次失敗在 ended 之後（規則 (b)）
  // ══════════════════════════════════════════════════════════════════
  const D = await joinAs(PORT_TIMEOUT, 'Dan'); sockets.push(D.s);
  if (D.snap.players.length !== 1) throw new Error(`需要全新的 server 程序（埠 ${PORT_TIMEOUT} 的房間已有其他玩家）`);
  const E = await joinAs(PORT_TIMEOUT, 'Eve'); sockets.push(E.s);
  const F = await joinAs(PORT_TIMEOUT, 'Fay'); sockets.push(F.s);
  await startRound(D, F, '蘋果', 1);
  const tSubB = Date.now();
  // 交卷順序 E、F、D：種子 1 那張在題目「蘋果」下分數最高（§6 random 確定性），讓它最後交，第一位交卷者（E）就不是第一名，
  // 下面「第一次逾時只影響該張」才看得到單獨先到的那一則；斷言本身兩種情況都涵蓋，不依賴這個安排。
  const firstB = E;
  const subsB = [await submit(E, 2), await submit(F, 3), await submit(D, 1)];
  check('乙 三人交卷 ok（在 COMMENT_TIMEOUT_MS 內全部交完，讓失敗落在 ended 之後）', subsB.every((r) => r?.ok === true) && Date.now() - tSubB < COMMENT_TIMEOUT_MS, `${Date.now() - tSubB} ms ${j(subsB)}`);
  await waitPhase(F, 'ended', 1, 5000);
  const eB = lastRound(F);
  const tEndB = Date.now();
  check('乙 揭曉不等評語：ended 時 commentMode ai、三張皆 commentPending true、comment null', eB?.phase === 'ended' && eB.commentMode === 'ai' && eB.results?.length === 3 && eB.results.every(pendingComment), j(eB));
  check('乙 第一名重做稱讚版：ended 時 rank 1（有交卷）為 commentPending true', eB?.results[0]?.rank === 1 && eB.results[0].submitted === true && pendingComment(eB.results[0]), j(eB?.results[0]));
  const ids = [D.id, E.id, F.id];
  // 2026-10-13 Phase 5：第一次逾時只影響該張；連續第二次逾時才照規則 (b) 收尾——
  // 第二次失敗那張與當下仍 pending 的每一張各一則 contest:comment { comment: null }，再一則 round:update（commentMode 'off'）
  const gotAllNull = (p) => sameSet(p.comments.filter((c) => c.roundNo === 1).map((c) => c.playerId), ids) && updates(p, 1, 'ended').some((r) => r.commentMode === 'off');
  await until(() => [D, E, F].every(gotAllNull), COMMENT_TIMEOUT_MS * 2 + 4000);
  const tDone = Date.now();
  check('乙 連續兩次逾時後每位收件者對三張各收到一則 contest:comment（規則 (b)）', [D, E, F].every((p) => sameSet(p.comments.filter((c) => c.roundNo === 1).map((c) => c.playerId), ids)), j(F.comments));
  check('乙 CommentUpdate 形狀：roundNo 1、comment 皆為 null（失敗）、鍵只有 roundNo／playerId／comment', F.comments.every((c) => c.roundNo === 1 && c.comment === null && Object.keys(c).sort().join() === 'comment,playerId,roundNo'), j(F.comments));
  check('乙 另有一則 round:update：phase ended、commentMode off、results 三筆 comment null／pending false', updates(F, 1, 'ended').some((r) => r.commentMode === 'off' && r.results?.length === 3 && r.results.every(noComment)), j(updates(F, 1, 'ended').map((r) => [r.commentMode, r.results?.map((e) => [e.comment, e.commentPending])])));
  // 2026-10-13 Phase 5：上限由「COMMENT_TIMEOUT_MS + 2 s（一次逾時）」改為兩次逾時
  check('乙 有界：從 ended 到全部補齊 < 2 × COMMENT_TIMEOUT_MS + 2 s（最壞多等兩次逾時）', tDone - tEndB < COMMENT_TIMEOUT_MS * 2 + 2000, `${tDone - tEndB} ms`);
  // 2026-10-13 Phase 5（新增）：單次逾時不跳過——'off' 的 round:update 要等第二張也逾時才出現（從第一張交卷起算至少兩次逾時；舊規則約一次逾時就到）
  const offB = updates(F, 1, 'ended').find((r) => r.commentMode === 'off');
  const offDelay = offB ? offB._at - tSubB : NaN;
  check(`乙 單次逾時不收尾：commentMode off 在第一張交卷後 ${offDelay} ms 才到（≥ 2 × COMMENT_TIMEOUT_MS − 100）`, offDelay >= COMMENT_TIMEOUT_MS * 2 - 100, `${offDelay} ms`);
  // 第一位交卷者（firstB）的批評版是第一次逾時的那張。他不是第一名時：他的 null 在第一次逾時就單獨送出（比 'off' 早約一次逾時），當時沒有 round:update 'off'；
  // 他是第一名時：那張批評版只是稱讚版的退路、不發事件，他的 null 要等稱讚版（第二次逾時）才與其他人一起到。
  const dIdx = F.comments.findIndex((c) => c.roundNo === 1 && c.playerId === firstB.id);
  const dLead = offB && dIdx >= 0 ? offB._at - F.commentAt[dIdx] : NaN;
  if (eB?.results[0]?.playerId !== firstB.id) {
    check(`乙 第一次逾時只影響該張：第一位交卷者的 contest:comment null 比 commentMode off 早 ${dLead} ms（≥ COMMENT_TIMEOUT_MS − 150），其餘兩張與 off 同批`, dLead >= COMMENT_TIMEOUT_MS - 150 && F.comments.filter((c, k) => c.roundNo === 1 && c.playerId !== firstB.id && offB._at - F.commentAt[k] < 150).length === 2, `${dLead} ms ${j(F.seq)}`);
  } else {
    check(`乙 第一名是第一位交卷者：他在途的批評版逾時不發事件，三張的 null 都在第二次逾時（稱讚版）時同批送出（與 off 相差 ${dLead} ms）`, F.comments.filter((c, k) => c.roundNo === 1 && Math.abs(offB._at - F.commentAt[k]) < 150).length === 3, `${dLead} ms ${j(F.seq)}`);
  }
  check('乙 第一名的稱讚版也照規則 (b)：收到一則 contest:comment { comment: null }，最終 comment null、commentPending false（沒有永遠 pending 的第一名）', F.comments.filter((c) => c.roundNo === 1 && c.playerId === eB.results[0].playerId).length === 1 && F.comments.find((c) => c.playerId === eB.results[0].playerId)?.comment === null && noComment(updates(F, 1, 'ended').at(-1).results[0]) && updates(F, 1, 'ended').at(-1).results[0].playerId === eB.results[0].playerId, j([eB?.results[0].playerId, F.comments, updates(F, 1, 'ended').at(-1)?.results[0]]));
  check('乙 事件順序：contest:comment 都在 ended 的第一則 round:update 之後', [D, E, F].every((p) => { const i = p.seq.findIndex((x) => x.startsWith('round:1:ended')); return i >= 0 && p.seq.every((x, k) => x !== 'comment:1' || k > i); }), j(F.seq));
  check('乙 三位收件者收到的 contest:comment 內容一致', j(D.comments.map((c) => [c.playerId, c.comment])) === j(F.comments.map((c) => [c.playerId, c.comment])) && j(E.comments.map((c) => [c.playerId, c.comment])) === j(F.comments.map((c) => [c.playerId, c.comment])));
  check('乙 commentMode off 的 round:update 恰好一則', updates(F, 1, 'ended').filter((r) => r.commentMode === 'off').length === 1, j(F.seq));
  await sleep(COMMENT_TIMEOUT_MS + 300);
  check('乙 之後不再有多餘的 contest:comment（被跳過的張不呼叫模型，三張各只一則）', [D, E, F].every((p) => p.comments.length === 3), j([D, E, F].map((p) => p.comments.length)));
  const L2 = await joinAs(PORT_TIMEOUT, 'Late'); sockets.push(L2.s);
  check('乙 中途加入者快照：commentMode off、results 全部 comment null／pending false（server 端 results 已同步）', L2.snap.round.phase === 'ended' && L2.snap.round.commentMode === 'off' && L2.snap.round.results?.length === 3 && L2.snap.round.results.every(noComment), j(L2.snap.round));
  // 下一回合重新嘗試：judging 起 commentMode 又是 ai（連續失敗的計數也歸零：仍要兩次逾時才收尾）
  await startRound(E, F, '貓', 2);
  const tSubB2 = Date.now();
  const subsB2 = [await submit(D, 4), await submit(E, 5), await submit(F, 6), await submit(L2, 7)];
  check('乙 第二回合四人交卷 ok', subsB2.every((r) => r?.ok === true), j(subsB2));
  await waitPhase(F, 'ended', 2, 5000);
  const eB2 = updates(F, 2, 'ended')[0];
  check('乙 第二回合重新嘗試：judging／ended 起 commentMode 又是 ai、四張 pending', eB2?.phase === 'ended' && eB2.commentMode === 'ai' && updates(F, 2, 'judging').every((r) => r.commentMode === 'ai') && eB2.results?.length === 4 && eB2.results.every(pendingComment), j(eB2));
  const ids2 = [D.id, E.id, F.id, L2.id];
  await until(() => sameSet(F.comments.filter((c) => c.roundNo === 2).map((c) => c.playerId), ids2) && updates(F, 2, 'ended').some((r) => r.commentMode === 'off'), COMMENT_TIMEOUT_MS * 2 + 4000);
  check('乙 第二回合再次連續兩次逾時：四張各一則 contest:comment（roundNo 2、null）、round:update commentMode off；沒有再收到 roundNo 1 的評語', sameSet(F.comments.filter((c) => c.roundNo === 2).map((c) => c.playerId), ids2) && F.comments.filter((c) => c.roundNo === 2).every((c) => c.comment === null) && updates(F, 2, 'ended').some((r) => r.commentMode === 'off') && F.comments.filter((c) => c.roundNo === 1).length === 3, j(F.seq));
  const offB2 = updates(F, 2, 'ended').find((r) => r.commentMode === 'off');
  check('乙 第二回合計數已歸零：commentMode off 同樣要等兩次逾時（不是延續上回合、第一次逾時就收尾）', offB2 && offB2._at - tSubB2 >= COMMENT_TIMEOUT_MS * 2 - 100, `${offB2 ? offB2._at - tSubB2 : NaN} ms`);

  // ══════════════════════════════════════════════════════════════════
  // 丙、評語輸出空白，失敗在 drawing（規則 (c)）；連續兩次後排進來的各張直接跳過（規則 (a)）
  // ══════════════════════════════════════════════════════════════════
  const G = await joinAs(PORT_EMPTY, 'Gus'); sockets.push(G.s);
  if (G.snap.players.length !== 1) throw new Error(`需要全新的 server 程序（埠 ${PORT_EMPTY} 的房間已有其他玩家）`);
  const H = await joinAs(PORT_EMPTY, 'Hal'); sockets.push(H.s);
  const I = await joinAs(PORT_EMPTY, 'Ivy'); sockets.push(I.s);
  await startRound(G, I, '蘋果', 1);
  const sG = await submit(G, 1);
  await sleep(400);   // 第一張：random 評分（delay 0）→ 評語 → 假 Ollama 立即回空字串 → 失敗（第一次），此時仍在 drawing
  check('丙 第一張交卷 ok；仍在 drawing、submittedCount 1、judgedCount 1', sG?.ok === true && lastRound(I)?.phase === 'drawing' && lastRound(I).submittedCount === 1 && lastRound(I).judgedCount === 1, j(lastRound(I)));
  check('丙 規則 (c)：失敗在 drawing 時 commentMode 仍為 null、不發 contest:comment', updates(I, 1, 'drawing').every((r) => r.commentMode === null) && [G, H, I].every((p) => p.comments.length === 0), j(I.seq));
  // 2026-10-13 Phase 5：要連續兩次失敗才跳過——第二張也先在 drawing 失敗，第三張才交卷（原本第一張失敗後另兩張直接一起交）
  const sH = await submit(H, 2);
  await sleep(400);   // 第二張：同樣失敗（連續第二次），仍在 drawing
  check('丙 第二張交卷 ok；仍在 drawing、commentMode null、沒有 contest:comment', sH?.ok === true && lastRound(I)?.phase === 'drawing' && lastRound(I).judgedCount === 2 && updates(I, 1, 'drawing').every((r) => r.commentMode === null) && [G, H, I].every((p) => p.comments.length === 0), j(I.seq));
  const sI = await submit(I, 3);
  check('丙 第三人交卷 ok', sI?.ok === true, j(sI));
  await waitPhase(I, 'ended', 1, 5000);
  const eC = lastRound(I);
  check('丙 drawing 中已連續兩次失敗 → 進 judging 時直接設 off：judging 與 ended 的每則 round:update commentMode 皆為 off', updates(I, 1, 'judging').length > 0 && updates(I, 1, 'judging').every((r) => r.commentMode === 'off') && eC?.phase === 'ended' && eC.commentMode === 'off', j(I.seq));
  check('丙 results 三筆 comment null、commentPending false（失敗的兩張與被跳過的那張）', eC?.results?.length === 3 && eC.results.every(noComment), j(eC?.results.map((e) => [e.comment, e.commentPending])));
  check('丙 第一名不重做（commentMode off）：rank 1 有交卷，comment null、commentPending false', eC?.results?.[0]?.rank === 1 && eC.results[0].submitted === true && noComment(eC.results[0]), j(eC?.results?.[0]));
  await sleep(1200);
  check('丙 規則 (a)：ended 前失敗，不發任何 contest:comment', [G, H, I].every((p) => p.comments.length === 0), j([G, H, I].map((p) => p.comments)));
  check('丙 分數與排名不受影響：judgeMode random、rank 1..3', eC?.judgeMode === 'random' && eC.results.every((e, i) => e.rank === i + 1 && e.judgedBy === 'random'), j(eC?.results.map((e) => [e.rank, e.score, e.judgedBy])));
  const L3 = await joinAs(PORT_EMPTY, 'Late'); sockets.push(L3.s);
  check('丙 中途加入者快照：commentMode off、results 全部無評語', L3.snap.round.commentMode === 'off' && L3.snap.round.results?.length === 3 && L3.snap.round.results.every(noComment), j(L3.snap.round));

  // ── 丙 第二回合（2026-10-13 Phase 5 新增）：drawing 中只失敗一次 → 進 judging 仍是 ai；第二次失敗落在 ended 之後 → 規則 (b) ──
  // 兩人回合（G、H）：G 先交卷並在 drawing 失敗一次；H 交卷的同一刻全員交卷 → judging（此時只失敗過一次）→ H 評完即 ended → H 的評語才失敗（連續第二次）
  I.s.disconnect(); L3.s.disconnect(); await sleep(300);   // 其他人離線，免得成為未交卷的參賽者
  await startRound(H, G, '貓', 2);
  check('丙 第二回合參賽者只有 G、H', sameSet(lastRound(G).participantIds, [G.id, H.id]), j(lastRound(G).participantIds));
  const sG2 = await submit(G, 4);
  await sleep(400);   // G 的評語在 drawing 失敗（本回合第一次；上回合的計數已歸零）
  check('丙 第二回合第一張交卷 ok；仍在 drawing、commentMode null、沒有 contest:comment', sG2?.ok === true && lastRound(G)?.phase === 'drawing' && lastRound(G).commentMode === null && G.comments.length === 0, j(G.seq));
  const sH2 = await submit(H, 5);
  check('丙 第二回合第二人交卷 ok', sH2?.ok === true, j(sH2));
  await until(() => updates(G, 2, 'ended').some((r) => r.commentMode === 'off'), 5000);
  const judging2 = updates(G, 2, 'judging');
  check('丙 drawing 中只失敗一次 → 進 judging 仍是 ai（不是 off）', judging2.length > 0 && judging2.every((r) => r.commentMode === 'ai'), j(G.seq));
  const eC2 = updates(G, 2, 'ended')[0];
  check('丙 第二回合 ended 當下 commentMode ai；先前失敗的 G 那張沒有評語也不 pending，除非他是第一名（重做稱讚版 → pending）', eC2?.commentMode === 'ai' && eC2.results?.length === 2 && (() => { const g = eC2.results.find((e) => e.playerId === G.id); return eC2.results[0].playerId === G.id ? pendingComment(g) : noComment(g); })(), j(eC2?.results.map((e) => [e.playerId, e.rank, e.comment, e.commentPending])));
  const pending2 = (eC2?.results ?? []).filter((e) => e.commentPending).map((e) => e.playerId);
  await until(() => sameSet(G.comments.filter((c) => c.roundNo === 2).map((c) => c.playerId), pending2), 3000);
  await sleep(500);
  check('丙 連續第二次失敗在 ended 之後（規則 (b)）：揭曉當下 pending 的每一張各恰好一則 contest:comment null（第一名即使批評版與稱讚版同批也只有一則）', sameSet(G.comments.filter((c) => c.roundNo === 2).map((c) => c.playerId), pending2) && G.comments.filter((c) => c.roundNo === 2).every((c) => c.comment === null) && pending2.length >= 1, j([pending2, G.comments]));
  check('丙 再一則 round:update commentMode off（恰好一則）、results 全部無評語', updates(G, 2, 'ended').filter((r) => r.commentMode === 'off').length === 1 && updates(G, 2, 'ended').at(-1).results.every(noComment), j(G.seq));
  check('丙 G、H 收到的事件一致', j(G.comments.map((c) => [c.roundNo, c.playerId, c.comment])) === j(H.comments.map((c) => [c.roundNo, c.playerId, c.comment])), j([G.comments, H.comments]));
} catch (err) {
  check('測試流程未預期中斷', false, String(err?.stack ?? err));
} finally {
  for (const s of sockets) s.disconnect();
}

for (const [st, name, extra] of R) console.log(`${st}  ${name}${st === 'FAIL' && extra ? '  ' + extra : ''}`);
const pass = R.filter((r) => r[0] === 'PASS').length;
console.log(`\n${pass}/${R.length} passed`);
process.exit(pass === R.length ? 0 : 1);
