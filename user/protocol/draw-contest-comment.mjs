// 繪圖比賽評語協定符合性測試（Epic 15）：只依 spec/draw-contest/architecture.md §4／§5「評語」／§6.1 打 Socket，不看實作、不 import server 內部程式。
// 涵蓋 §8 清單：交卷 → 揭曉（不等評語）→ 收到 contest:comment；COMMENT=off 時 commentMode 'off' 且沒有 contest:comment；中途加入者快照的 results 帶 comment。
// 另含：commentMode 生命週期（idle／choosing／drawing 為 null、judging 起有值、下一回合回 null）、ResultEntry.comment／commentPending 的一致性、
// 事件順序（contest:comment 只在 ended 之後）、評語還在產生時加入者之後補收事件、第二回合 roundNo 配對。
// Epic 15 Phase 4（2026-10-12 補）：第一名重做稱讚版（§5 評語、§6.1）——揭曉時第一名一律 comment null／commentPending true（即使他的評語早就完成、其他人已有評語），
// 之後收到的第一名評語是稱讚句且與其他人不同；COMMENT=off 時第一名不重做（null／false、無事件）。
//
// 需要兩個 server 程序（評語開／關各一）與一個假 Ollama；**不碰真模型**。用法（專案根目錄，需先 npm run build；隔離埠且只綁本機；
// **每次都要全新的 server 程序**，房間狀態在記憶體）：
//   MOCK_PORT=11436 MOCK_CHAT_DELAY_MS=300 node user/mock/systemone.mjs &          # 假 Ollama：/api/chat 每則延遲 300 ms（揭曉後才陸續收到評語）
//   HOST=127.0.0.1 PORT=3197 JUDGE=random JUDGE_FAKE_DELAY_MS=0 COMMENT=ollama OLLAMA_URL=http://127.0.0.1:11436 node server/dist/index.js &
//   HOST=127.0.0.1 PORT=3198 JUDGE=random JUDGE_FAKE_DELAY_MS=0 COMMENT=off node server/dist/index.js &
//   TEST_PORT=3197 TEST_PORT_OFF=3198 node --input-type=module < user/protocol/draw-contest-comment.mjs
// - 評語開的那個 server：COMMENT 可省略（預設 ollama）、COMMENT_MODEL 用預設（假 Ollama 的 MOCK_COMMENT_MODEL 預設同名）；
//   JUDGE=random 讓評分不經 Ollama，只有評語走假 Ollama 的 /api/chat。OLLAMA_URL 一定要指向假 Ollama，否則會打到本機真模型。
// - MOCK_CHAT_DELAY_MS 建議 ≥ 300：太小時評語可能在揭曉前就完成（直接寫進 results、不發事件，仍符合 spec，但「揭曉後補收」那幾項會變成空測）。
//   不是 300 時請同步設 TEST_CHAT_DELAY_MS（第三回合要等前五張的評語都完成才交最後一張，等待時間由它推算）。
// - 假 Ollama 不要設 MOCK_CHAT_CONTENT／MOCK_PRAISE_CONTENT（固定內容會讓第一名的稱讚句與批評句分不出來）。
// - **避免用瀏覽器開過的埠**（桌面 app 的分頁會自動重連、佔住房間，「需要全新的 server 程序」那項會失敗）。
// 快速段總時長約 10 秒；全部 PASS 時 exit 0。
//
// 慢速段（選用，TEST_SLOW=1）：未交卷者 comment null／commentPending false（要等真實的 DRAW_SECONDS 120 秒＋寬限 5 秒，約 2 分 10 秒）。
// 未涵蓋（需要縮時或可控的失敗，放 server 的 vitest：draw-contest.room.comment.test.ts、draw-contest.comment.e2e.test.ts）：
// 評語失敗在 ended 前／後的事件規則 (a)(b)、逾時、參賽者寬限期滿離開的丟棄、ended 後離開者照常收到評語、換回合丟棄上回合未完成的評語。
import { io } from 'socket.io-client';
import { deflateSync } from 'node:zlib';

const PORT_AI = process.env.TEST_PORT ?? '3197';
const PORT_OFF = process.env.TEST_PORT_OFF ?? '3198';
const SLOW = process.env.TEST_SLOW === '1';
/** 假 Ollama 的 MOCK_CHAT_DELAY_MS（只用來推算「等前面幾張評語都完成」要多久） */
const CHAT_DELAY_MS = Number(process.env.TEST_CHAT_DELAY_MS ?? 300);

// ── 常數：.mjs 不能 import .ts，照既有協定測試慣例寫死；出處 shared/src/draw-contest/constants.ts（spec §4 常數表）──
const DRAW_SECONDS = 120;
const SUBMIT_GRACE_SECONDS = 5;
const CANVAS_LOGICAL = { width: 1280, height: 720 };

// ── 假 Ollama 的稱讚句：照既有慣例寫死；出處 user/mock/systemone.mjs 的 MOCK_PRAISES（spec §6.1：user 文案含「這張是本回合第一名」（2026-10-21 Phase 7 起比對此片段）時回稱讚句，與批評句區分）──
const MOCK_PRAISES = [
  '哼，這張居然還不錯嘛，第一名就勉強給你啦～',
  '欸？畫得這麼好是想怎樣，才、才沒有在誇你喔！',
  '嘛，這次算你厲害，下次也要這樣讓我驚訝才行喔～',
  '居然真的被你拿到第一，好啦好啦，這張是真的很可以啦！',
];

// ── 測試框架（同 draw-contest-phase1.mjs）──
const R = [];
const check = (name, cond, extra = '') => R.push([cond ? 'PASS' : 'FAIL', name, extra]);
const connect = (port) => io(`http://127.0.0.1:${port}/draw-contest`, { path: '/socket.io', transports: ['websocket'], forceNew: true, reconnection: false });
const call = (s, ev, ...args) => new Promise((res) => s.emit(ev, ...args, res));
const once = (s, ev, ms = 4000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), ms); s.once(ev, (...a) => { clearTimeout(t); res(a); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 輪詢條件直到成立或逾時；回傳是否成立 */
const until = async (pred, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(20); } return pred(); };
const j = (x) => JSON.stringify(x)?.slice(0, 400);
const ab = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
/** 每個 socket 都先掛好收集器再 join；seq 依到達順序記 round:update 的 phase 與 contest:comment */
const joinAs = async (port, nick) => {
  const s = connect(port); await once(s, 'connect');
  const seq = [], rounds = [], comments = [], gallery = [];
  s.on('round:update', (r) => { rounds.push(r); seq.push(`round:${r.roundNo}:${r.phase}`); });
  s.on('contest:comment', (c) => { comments.push(c); seq.push(`comment:${c.roundNo}`); });
  s.on('contest:gallery', (g) => gallery.push(g));
  const r = await call(s, 'player:join', { nickname: nick });
  if (!r?.ok) throw new Error('join failed ' + j(r));
  return { s, nick, id: r.data.snapshot.you, snap: r.data.snapshot, seq, rounds, comments, gallery };
};
const lastRound = (p) => p.rounds.at(-1);
const waitPhase = (p, phase, roundNo, ms = 5000) => until(() => lastRound(p)?.phase === phase && (roundNo === undefined || lastRound(p).roundNo === roundNo), ms);

// ── PNG 產生器（同 draw-contest-phase1.mjs：node:zlib 壓 IDAT，CRC32 自算）──
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** 產生合法 PNG（8-bit RGB、無交錯、1280×720）。seed 決定斜紋，不同 seed → 不同 bytes */
const makePng = (seed) => {
  const { width, height } = CANVAS_LOGICAL;
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
      const c = (x + y * (seed + 1)) % (17 + seed) < 3 ? ink : bg;
      const o = y * stride + 1 + x * 3;
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2];
    }
  }
  return Buffer.concat([PNG_MAGIC, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};
const submit = (p, seed) => call(p.s, 'contest:submit', { png: ab(makePng(seed)) });

// ── §4 ResultEntry 的評語欄位 ──
/** 兩個欄位都存在且型別正確；有評語就不會還在 pending */
const commentFieldsOk = (e) => 'comment' in e && 'commentPending' in e && (e.comment === null || typeof e.comment === 'string')
  && typeof e.commentPending === 'boolean' && !(e.comment !== null && e.commentPending);
/** 一句評語：非空字串、已去頭尾空白、只有一行（§6.1 後處理） */
const sentenceOk = (c) => typeof c === 'string' && c.length > 0 && c === c.trim() && !/[\r\n]/.test(c);
/** 評語開且沒有失敗時，交卷者只有兩種狀態：已產生（字串、不 pending）或產生中（null、pending） */
const submittedCommentOk = (e) => commentFieldsOk(e) && (e.commentPending ? e.comment === null : sentenceOk(e.comment));
const commentOffOk = (e) => 'comment' in e && e.comment === null && e.commentPending === false;
/** 揭曉後每個收件者：對 ended 當下 pending 的每一張各收到一則 contest:comment（roundNo 相符），不 pending 的沒有事件 */
const commentsMatchPending = (p, ended) => {
  const pending = ended.results.filter((e) => e.commentPending).map((e) => e.playerId);
  const got = p.comments.filter((c) => c.roundNo === ended.roundNo).map((c) => c.playerId);
  return sameSet(got, pending);
};
/** 揭曉時的值＋之後的事件 → 每位交卷者最終的評語 */
const finalComments = (p, ended) => new Map(ended.results.filter((e) => e.submitted).map((e) => [e.playerId, e.commentPending ? p.comments.find((c) => c.roundNo === ended.roundNo && c.playerId === e.playerId)?.comment : e.comment]));

// ── 第一名重做稱讚版（§5 評語，Phase 4）──
/** 揭曉當下：rank 1 且有交卷者一律 comment null、commentPending true */
const winnerPendingOk = (ended) => { const w = ended.results[0]; return w?.rank === 1 && w.submitted === true && w.comment === null && w.commentPending === true; };
/** 最終：第一名的評語是稱讚句；其他交卷者都不是稱讚句，也都與第一名的不同 */
const praiseOnlyForWinner = (ended, final) => {
  const winnerId = ended.results[0].playerId;
  const praise = final.get(winnerId);
  return MOCK_PRAISES.includes(praise) && [...final].every(([id, c]) => id === winnerId || (!MOCK_PRAISES.includes(c) && c !== praise));
};

const sockets = [];
try {
  // ══════════════════════════════════════════════════════════════════
  // 甲、評語開（COMMENT=ollama → 假 Ollama 的 /api/chat）
  // ══════════════════════════════════════════════════════════════════
  const A = await joinAs(PORT_AI, 'Alice'); sockets.push(A.s);
  if (A.snap.players.length !== 1) throw new Error(`需要全新的 server 程序（埠 ${PORT_AI} 的房間已有其他玩家）`);
  check('idle：RoundPublic.commentMode 欄位存在且為 null、results null', 'commentMode' in A.snap.round && A.snap.round.commentMode === null && A.snap.round.results === null, j(A.snap.round));
  const B = await joinAs(PORT_AI, 'Bob'); sockets.push(B.s);

  // ════════ 1. choosing／drawing：commentMode 為 null ════════
  await call(A.s, 'round:volunteer');
  await waitPhase(B, 'choosing');
  check('choosing：commentMode null', lastRound(B)?.phase === 'choosing' && lastRound(B).commentMode === null, j(lastRound(B)));
  const rt = await call(A.s, 'round:setTopic', { topic: '蘋果' });
  await waitPhase(B, 'drawing', 1);
  check('drawing：commentMode null（judging 起才有值，生命週期同 judgeMode）', rt?.ok === true && lastRound(B)?.phase === 'drawing' && lastRound(B).commentMode === null && lastRound(B).judgeMode === null, j(lastRound(B)));
  const W = await joinAs(PORT_AI, 'Watcher'); sockets.push(W.s);   // 旁觀者（中途加入，不參賽）
  check('旁觀者快照：drawing、commentMode null', W.snap.round.phase === 'drawing' && W.snap.round.commentMode === null, j(W.snap.round));

  // ════════ 2. 交卷 → judging（commentMode ai）→ ended 不等評語 ════════
  const tSubmit = Date.now();
  const rA = await submit(A, 1);
  const rB = await submit(B, 2);
  check('A、B 交卷 ok', rA?.ok === true && rB?.ok === true, j([rA, rB]));
  await waitPhase(W, 'ended', 1);
  const tEnded = Date.now();
  const e1 = lastRound(W);
  check('全員交卷 → ended（揭曉時機與沒有評語時相同：不等評語）', e1?.phase === 'ended' && e1.roundNo === 1 && tEnded - tSubmit < 3000, `${tEnded - tSubmit} ms ${j(e1)}`);
  const judgingRounds = W.rounds.filter((r) => r.roundNo === 1 && r.phase === 'judging');
  check('judging 起 commentMode ai（每一則 judging 的 round:update）', judgingRounds.length > 0 && judgingRounds.every((r) => r.commentMode === 'ai'), j(W.rounds.map((r) => [r.phase, r.commentMode])));
  check('ended：commentMode ai、results 2 筆', e1.commentMode === 'ai' && e1.results?.length === 2, j(e1));
  check('ended 的 results：comment／commentPending 欄位齊全且一致（已產生＝字串且不 pending；產生中＝null 且 pending）', e1.results.every(submittedCommentOk), j(e1.results));
  check('ended 當下至少一張 commentPending true（評語在評分完成後才開始產生，揭曉不等它）', e1.results.some((e) => e.commentPending === true), j(e1.results.map((e) => [e.comment, e.commentPending])));
  check('分數與排名不受評語影響：rank 1..n、score 降冪', e1.results.every((e, i) => e.rank === i + 1 && (i === 0 || e1.results[i - 1].score >= e.score)), j(e1.results.map((e) => [e.rank, e.score])));
  check('第一名重做：ended 當下 rank 1 為 comment null、commentPending true', winnerPendingOk(e1), j(e1.results[0]));

  // ════════ 3. 評語還在產生時加入：快照 pending，之後補收事件 ════════
  const E = await joinAs(PORT_AI, 'Eve'); sockets.push(E.s);
  const eSnap = E.snap.round;
  check('產生中加入：快照 ended、commentMode ai、results 欄位一致', eSnap.phase === 'ended' && eSnap.commentMode === 'ai' && eSnap.results?.length === 2 && eSnap.results.every(submittedCommentOk), j(eSnap));
  const ePending = eSnap.results.filter((e) => e.commentPending).map((e) => e.playerId);

  // ════════ 4. contest:comment：ended 之後陸續廣播給所有人 ════════
  const got1 = (p) => commentsMatchPending(p, e1);
  await until(() => [A, B, W].every(got1), 6000);
  check('ended 當下 pending 的每一張各一則 contest:comment（A、B 與旁觀者都收到；不 pending 的沒有事件）', [A, B, W].every(got1), j([A, B, W].map((p) => p.comments)));
  check('CommentUpdate 形狀：roundNo 1、playerId 為交卷者、comment 為一句非空字串（去頭尾空白、單行）', W.comments.length > 0 && W.comments.every((c) => c.roundNo === 1 && [A.id, B.id].includes(c.playerId) && sentenceOk(c.comment) && Object.keys(c).sort().join() === 'comment,playerId,roundNo'), j(W.comments));
  check('事件順序：contest:comment 都在 ended 的 round:update 之後', [A, B, W].every((p) => { const i = p.seq.indexOf('round:1:ended'); return i >= 0 && p.seq.every((x, k) => x !== 'comment:1' || k > i); }), j(W.seq));
  check('A、B、旁觀者收到的評語內容一致', j(A.comments) === j(W.comments) && j(B.comments) === j(W.comments), j([A.comments, B.comments]));
  await until(() => sameSet(E.comments.map((c) => c.playerId), ePending), 3000);
  check('產生中加入者：快照裡 pending 的每一張之後都收到 contest:comment', sameSet(E.comments.map((c) => c.playerId), ePending) && E.comments.every((c) => sentenceOk(c.comment)), j([ePending, E.comments]));
  check('評語成功後 commentMode 仍為 ai（沒有因為成功而多出 off）', W.rounds.filter((r) => r.roundNo === 1 && r.phase === 'ended').every((r) => r.commentMode === 'ai'), j(W.rounds.map((r) => [r.phase, r.commentMode])));
  const final1 = finalComments(W, e1);
  check('第一名的評語是稱讚句；另一位是批評句、與第一名的不同', praiseOnlyForWinner(e1, final1), j([e1.results[0].playerId, [...final1]]));

  // ════════ 5. 評語都完成後加入：快照的 results 帶 comment ════════
  const F = await joinAs(PORT_AI, 'Frank'); sockets.push(F.s);
  const fSnap = F.snap.round;
  check('中途加入者快照：results 每筆 comment 為字串、commentPending false', fSnap.phase === 'ended' && fSnap.results?.length === 2 && fSnap.results.every((e) => sentenceOk(e.comment) && e.commentPending === false), j(fSnap.results));
  check('中途加入者快照的 comment 與廣播的 contest:comment 一致（server 端 results 已同步更新）', fSnap.results.every((e) => e.comment === final1.get(e.playerId)), j([fSnap.results.map((e) => [e.playerId, e.comment]), [...final1]]));
  check('中途加入者快照：commentMode ai、分數與排名同揭曉時', fSnap.commentMode === 'ai' && j(fSnap.results.map((e) => [e.playerId, e.rank, e.score])) === j(e1.results.map((e) => [e.playerId, e.rank, e.score])));
  await until(() => F.gallery.length >= 2, 3000);
  await sleep(300);
  check('中途加入者照常補收畫廊（2 則）；評語已在快照裡，不再補發 contest:comment', F.gallery.length === 2 && F.comments.length === 0, j([F.gallery.length, F.comments]));

  // ════════ 6. 第二回合：results（含評語）保留到 drawing、commentMode 回 null、roundNo 配對 ════════
  const rv2 = await call(B.s, 'round:volunteer');
  await waitPhase(W, 'choosing');
  const c2 = lastRound(W);
  check('下一回合 choosing：commentMode 回 null；保留的 results 仍帶已產生的評語', rv2?.ok === true && c2.commentMode === null && c2.results?.length === 2 && c2.results.every((e) => e.comment === final1.get(e.playerId) && e.commentPending === false), j(c2));
  const rt2 = await call(B.s, 'round:setTopic', { topic: '貓' });
  await waitPhase(W, 'drawing', 2);
  const d2 = lastRound(W);
  check('第二回合 drawing：roundNo 2、results 清空、commentMode null', rt2?.ok === true && d2.roundNo === 2 && d2.results === null && d2.commentMode === null, j(d2));
  const five = [A, B, W, E, F];
  check('第二回合參賽者＝5 位在線者', sameSet(d2.participantIds, five.map((p) => p.id)), j(d2.participantIds));
  const subs2 = [];
  for (const [i, p] of five.entries()) subs2.push(await submit(p, 10 + i));
  check('第二回合 5 人交卷 ok', subs2.every((r) => r?.ok === true), j(subs2));
  await waitPhase(W, 'ended', 2, 8000);
  const e2 = lastRound(W);
  check('第二回合 ended：commentMode 重新從 ai 開始、results 5 筆、欄位一致', e2?.phase === 'ended' && e2.roundNo === 2 && e2.commentMode === 'ai' && e2.results?.length === 5 && e2.results.every(submittedCommentOk), j(e2));
  const got2 = (p) => commentsMatchPending(p, e2);
  await until(() => five.every(got2), 8000);
  check('第二回合：pending 的每一張各一則 contest:comment，roundNo 2（5 位都收到）', five.every(got2) && W.comments.filter((c) => c.roundNo === 2).every((c) => sentenceOk(c.comment)), j(W.comments.filter((c) => c.roundNo === 2)));
  check('第二回合事件順序：contest:comment 都在 ended 之後；沒有再收到 roundNo 1 的評語', five.every((p) => { const i = p.seq.indexOf('round:2:ended'); return i >= 0 && p.seq.every((x, k) => x !== 'comment:2' || k > i) && p.seq.slice(i).every((x) => x !== 'comment:1'); }), j(W.seq));
  const final2 = finalComments(W, e2);
  check('第二回合每位交卷者最終都有一句評語', final2.size === 5 && [...final2.values()].every(sentenceOk), j([...final2]));
  check('第二回合第一名重做：ended 當下 rank 1 pending；最終只有第一名是稱讚句', winnerPendingOk(e2) && praiseOnlyForWinner(e2, final2), j([e2.results[0], [...final2]]));
  const G = await joinAs(PORT_AI, 'Grace'); sockets.push(G.s);
  check('第二回合評語完成後加入：快照 results 5 筆皆帶 comment、與事件一致', G.snap.round.roundNo === 2 && G.snap.round.results?.length === 5 && G.snap.round.results.every((e) => e.comment === final2.get(e.playerId) && e.commentPending === false), j(G.snap.round.results?.map((e) => [e.playerId, e.comment, e.commentPending])));

  // ════════ 7. 第三回合：第一名的評語即使早就完成，揭曉時也重設為 pending 並改成稱讚版 ════════
  // 六人參賽：前五人先交卷並等評語都完成；最後一人交「與第一位交卷者同一張圖」——同圖同題同分（§6 random 確定性）、同分先交卷在前（§5.2），
  // 所以最後交卷的人不可能是第一名，第一名一定是「評語早就完成」的前五人之一。
  await call(A.s, 'round:volunteer');
  await waitPhase(W, 'choosing');
  await call(A.s, 'round:setTopic', { topic: '花' });
  await waitPhase(W, 'drawing', 3);
  const six = [A, B, W, E, F, G];
  check('第三回合參賽者＝6 位在線者', sameSet(lastRound(W).participantIds, six.map((p) => p.id)), j(lastRound(W).participantIds));
  const early = six.slice(0, 5), last = six[5];
  const subs3 = [];
  for (const [i, p] of early.entries()) subs3.push(await submit(p, 20 + i));
  await sleep(early.length * CHAT_DELAY_MS + 1000);   // 前五張的評語（一次一張）都完成；此時仍在 drawing，不會有事件
  check('第三回合前五人交卷 ok；drawing 期間評語完成不發 contest:comment', subs3.every((r) => r?.ok === true) && lastRound(W).phase === 'drawing' && W.comments.every((c) => c.roundNo !== 3), j([subs3, lastRound(W).phase]));
  const rLast = await submit(last, 20);   // 與 early[0] 同一張圖
  await waitPhase(W, 'ended', 3, 8000);
  const e3 = lastRound(W);
  check('第三回合 ended：results 6 筆、commentMode ai、欄位一致', rLast?.ok === true && e3?.phase === 'ended' && e3.roundNo === 3 && e3.commentMode === 'ai' && e3.results?.length === 6 && e3.results.every(submittedCommentOk), j(e3));
  const w3 = e3.results[0];
  const entryOf = (p) => e3.results.find((e) => e.playerId === p.id);
  check('前置：最後交卷者與第一位同分且排在後面，第一名是前五人之一（他的評語在揭曉前就完成了）', entryOf(last).score === entryOf(early[0]).score && entryOf(last).rank > entryOf(early[0]).rank && early.some((p) => p.id === w3.playerId), j(e3.results.map((e) => [e.nickname, e.rank, e.score])));
  check('第一名重做：評語早已完成的第一名在 ended 當下仍是 comment null、commentPending true（不顯示原本那句）', winnerPendingOk(e3), j(w3));
  check('其餘四位先交卷者：揭曉前完成的評語直接寫進 results（字串、不 pending）', early.filter((p) => p.id !== w3.playerId).every((p) => sentenceOk(entryOf(p).comment) && entryOf(p).commentPending === false), j(early.map((p) => [p.nick, entryOf(p).comment, entryOf(p).commentPending])));
  check('最後交卷者：評語才剛開始產生 → pending', entryOf(last).comment === null && entryOf(last).commentPending === true, j(entryOf(last)));
  const got3 = (p) => commentsMatchPending(p, e3);
  await until(() => six.every(got3), 6000);
  check('第三回合：只有 pending 的兩張（第一名與最後交卷者）各一則 contest:comment，roundNo 3（6 位都收到）', six.every(got3) && W.comments.filter((c) => c.roundNo === 3).length === 2, j(W.comments.filter((c) => c.roundNo === 3)));
  const final3 = finalComments(W, e3);
  check('第三回合：第一名收到的是稱讚句；其他五位都是批評句、與第一名的不同', praiseOnlyForWinner(e3, final3), j([w3.playerId, [...final3]]));
  check('同一張圖、不同提示詞 → 不同句：與第一位交卷者同圖的最後交卷者拿到的是批評句（第一名若正是第一位交卷者，兩人同圖卻一稱讚一批評）', !MOCK_PRAISES.includes(final3.get(last.id)) && sentenceOk(final3.get(last.id)), j([final3.get(early[0].id), final3.get(last.id)]));
  const H = await joinAs(PORT_AI, 'Heidi'); sockets.push(H.s);
  check('第三回合評語完成後加入：快照的第一名帶稱讚句、commentPending false；其餘與事件一致', H.snap.round.roundNo === 3 && H.snap.round.results?.[0].playerId === w3.playerId && MOCK_PRAISES.includes(H.snap.round.results[0].comment) && H.snap.round.results.every((e) => e.comment === final3.get(e.playerId) && e.commentPending === false), j(H.snap.round.results?.map((e) => [e.playerId, e.comment, e.commentPending])));

  // ════════ 8. 慢速段（TEST_SLOW=1）：未交卷者沒有評語 ════════
  if (SLOW) {
    await call(A.s, 'round:volunteer');
    await waitPhase(W, 'choosing');
    await call(A.s, 'round:setTopic', { topic: '樹' });
    await waitPhase(W, 'drawing', 4);
    const d4 = lastRound(W);
    const rA3 = await submit(A, 30);
    check('第四回合 A 交卷 ok', rA3?.ok === true, j(rA3));
    console.error(`[慢速段] 等待 endsAt＋寬限（約 ${DRAW_SECONDS + SUBMIT_GRACE_SECONDS} 秒）…`);
    await until(() => Date.now() > d4.endsAt, DRAW_SECONDS * 1000 + 5000);
    await waitPhase(W, 'ended', 4, (SUBMIT_GRACE_SECONDS + 5) * 1000);
    const e4 = lastRound(W);
    const un = e4?.results?.filter((e) => !e.submitted) ?? [];
    check('第四回合 ended：未交卷者 comment null、commentPending false（沒有圖就沒有評語）', e4?.phase === 'ended' && un.length === e4.results.length - 1 && un.length > 0 && un.every(commentOffOk), j(e4?.results));
    const eA = e4.results.find((e) => e.playerId === A.id);
    check('第四回合：唯一交卷者就是第一名 → ended 當下 pending（重做稱讚版）', winnerPendingOk(e4) && e4.results[0].playerId === A.id, j(e4.results[0]));
    await until(() => eA.commentPending ? W.comments.some((c) => c.roundNo === 4 && c.playerId === A.id) : true, 5000);
    await sleep(500);
    const c3 = W.comments.filter((c) => c.roundNo === 4);
    check('第四回合：只有交卷者有評語（事件至多一則、對象是 A；未交卷者沒有事件）', submittedCommentOk(eA) && c3.every((c) => c.playerId === A.id) && c3.length === (eA.commentPending ? 1 : 0) && sentenceOk(eA.commentPending ? c3[0]?.comment : eA.comment), j([eA, c3]));
    check('第四回合：唯一交卷者（第一名）最終收到的是稱讚句', MOCK_PRAISES.includes(c3[0]?.comment), j(c3));
  } else {
    check('慢速段（未交卷者沒有評語）略過：設 TEST_SLOW=1 執行', true, 'skipped');
  }

  // ══════════════════════════════════════════════════════════════════
  // 乙、評語關（COMMENT=off）
  // ══════════════════════════════════════════════════════════════════
  const P = await joinAs(PORT_OFF, 'Pat'); sockets.push(P.s);
  if (P.snap.players.length !== 1) throw new Error(`需要全新的 server 程序（埠 ${PORT_OFF} 的房間已有其他玩家）`);
  check('off：idle commentMode null', P.snap.round.commentMode === null, j(P.snap.round));
  const Q = await joinAs(PORT_OFF, 'Quinn'); sockets.push(Q.s);
  await call(P.s, 'round:volunteer');
  await waitPhase(Q, 'choosing');
  await call(P.s, 'round:setTopic', { topic: '蘋果' });
  await waitPhase(Q, 'drawing', 1);
  check('off：choosing／drawing commentMode 仍為 null', Q.rounds.filter((r) => r.phase === 'choosing' || r.phase === 'drawing').every((r) => r.commentMode === null), j(Q.rounds.map((r) => [r.phase, r.commentMode])));
  const V = await joinAs(PORT_OFF, 'Viewer'); sockets.push(V.s);
  const rP = await submit(P, 1);
  const rQ = await submit(Q, 2);
  await waitPhase(V, 'ended', 1);
  const o1 = lastRound(V);
  check('off：交卷 ok、照常揭曉', rP?.ok === true && rQ?.ok === true && o1?.phase === 'ended' && o1.results?.length === 2, j(o1));
  check("off：judging 起 commentMode 'off'（judging、ended 每一則 round:update）", V.rounds.filter((r) => r.phase === 'judging' || r.phase === 'ended').length >= 2 && V.rounds.filter((r) => r.phase === 'judging' || r.phase === 'ended').every((r) => r.commentMode === 'off'), j(V.rounds.map((r) => [r.phase, r.commentMode])));
  check('off：results 每筆 comment null、commentPending false（欄位存在）', o1.results.every(commentOffOk), j(o1.results));
  check('off：第一名不重做（rank 1 有交卷，comment null、commentPending false，不是 pending）', o1.results[0]?.rank === 1 && o1.results[0].submitted === true && commentOffOk(o1.results[0]), j(o1.results[0]));
  const L = await joinAs(PORT_OFF, 'Late'); sockets.push(L.s);
  check("off：中途加入者快照 commentMode 'off'、results 每筆 comment null／commentPending false", L.snap.round.commentMode === 'off' && L.snap.round.results?.length === 2 && L.snap.round.results.every(commentOffOk), j(L.snap.round));
  await sleep(1500);
  check('off：所有連線（參賽者、旁觀者、中途加入者）都沒收到 contest:comment（第一名也沒有稱讚版）', [P, Q, V, L].every((p) => p.comments.length === 0), j([P, Q, V, L].map((p) => p.comments)));
  check('off：揭曉後沒有多餘的 round:update（results 不會再變）', lastRound(V) === o1 && V.rounds.filter((r) => r.phase === 'ended').length === 1, j(V.rounds.map((r) => r.phase)));
} catch (err) {
  check('測試流程未預期中斷', false, String(err?.stack ?? err).slice(0, 400));
} finally {
  for (const s of sockets) s.disconnect();
}

console.log(R.map((r) => r.join('  ')).join('\n'));
const fails = R.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${R.length - fails}/${R.length} passed`);
process.exit(fails ? 1 : 0);
