// 繪圖比賽「強化」協定符合性測試（Epic 21，plan/hardening.md 決策 2、4、10）：只依 spec 打 Socket，不看實作、不 import server 內部程式。
// 依據：spec/architecture.md §9.1（重複 join 節流）、spec/draw-contest/architecture.md §5（重複 join）、§5.5（PNG 結構、JPEG 結尾、評分器／評語器錯誤分類）。
// 涵蓋：
//   甲、交卷 PNG 結構（code review #5 情境）：33 bytes 假 PNG、缺 IEND、缺 IDAT、IEND 後多 bytes、chunk 長度越界、IHDR 不在第一 → SUBMISSION_INVALID（文案逐字）；
//       合法 PNG 帶 tEXt 輔助 chunk 照常受理。
//   乙、評分器／評語器錯誤分類：假 Ollama 對帶標記的圖回 HTTP 400 → 只有那幾張 judgedBy 'random'、其他張仍 'ai'、round.judgeMode 全程 'ai'；
//       評語兩張連續 400 不算「連續兩次失敗」：第三張照常有評語、commentMode 全程 'ai'（原本兩張壞圖就整回合降級＋關評語）。
//   丙、重複 join 節流（code review #3 放大器）：已加入 socket 連送 player:join → RATE_LIMITED「操作太頻繁，請稍候再試」、沒有 contest:gallery 重送；
//       1 秒後再送受理（同 token、快照帶 results）但仍不重送；未綁定 socket 不受限（暱稱錯可立即重試）；token 接管照常補送畫廊。
//   丁、參考圖 JPEG 結尾：缺 FF D9 → REFERENCE_INVALID；mimic 回合中已加入 socket 的重複 join 受理後不重送 contest:reference（新加入者照常補送）。
//   戊、白名單（決策 11，2026-11-10）：假 Ollama 對標記圖改回 HTTP 404（模型不存在那一類）＝上游不可用 → 照舊整回合降級
//       （round.judgeMode 'random'、之後不再打 systemone）；評語連兩張 404 算連續兩次失敗 → 第三張跳過、commentMode 'off'。
//
// 需要兩個 server 程序（甲～丁一個、戊一個）；兩個假 Ollama 由本檔在同一程序內啟動（import user/mock/systemone.mjs 的 startMockOllama，
// rejectMarker／chatRejectMarker 模式；戊的那個 rejectStatus 404）；**不碰真模型**。
// 用法（專案根目錄，需先 npm run build；隔離埠且只綁本機；**每次都要全新的 server 程序**；避免用瀏覽器開過的埠）：
//   HOST=127.0.0.1 PORT=3257 JUDGE=ollama COMMENT=ollama OLLAMA_URL=http://127.0.0.1:11487 node server/dist/index.js &
//   HOST=127.0.0.1 PORT=3258 JUDGE=ollama COMMENT=ollama OLLAMA_URL=http://127.0.0.1:11488 node server/dist/index.js &
//   TEST_PORT=3257 TEST_MOCK_PORT=11487 TEST_PORT_404=3258 TEST_MOCK_PORT_404=11488 node --input-type=module < user/protocol/draw-contest-hardening.mjs
// - server 先起時假 Ollama 還沒開，啟動探測會 warn ollamaUnavailable／commentUnavailable、不暖機（§6、§6.1：每回合仍先試 ollama，不影響）。
// - 一定要在專案根目錄執行（以 process.cwd() 找 user/mock/systemone.mjs）。
// 總時長約 10 秒；全部 PASS 時 exit 0。
import { io } from 'socket.io-client';
import { crc32, deflateSync } from 'node:zlib';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PORT = process.env.TEST_PORT ?? '3257';
const MOCK_PORT = Number(process.env.TEST_MOCK_PORT ?? 11487);
const PORT_404 = process.env.TEST_PORT_404 ?? '3258';
const MOCK_PORT_404 = Number(process.env.TEST_MOCK_PORT_404 ?? 11488);
// ── 常數：.mjs 不能 import .ts，照既有協定測試慣例寫死；出處 shared/src/draw-contest/constants.ts（spec §4 常數表）──
const CANVAS_LOGICAL = { width: 1280, height: 720 };
const JOIN_MIN_INTERVAL_MS = 1000;
// ── spec 文案（逐字）──
const SUBMISSION_INVALID_MESSAGE = '圖片格式不正確或太大';   // §5.4（與我畫你猜同文案）
const REFERENCE_INVALID_MESSAGE = '參考圖格式不正確或太大（請選圖片檔）';   // §5.4
const JOIN_RATE_LIMITED_MESSAGE = '操作太頻繁，請稍候再試';   // 平台 §9.1
/** 假 Ollama 拒收的標記：放在 PNG 的 tEXt chunk 裡（結構合法） */
const REJECT_MARKER = 'EPIC21-REJECT-ME';

const { startMockOllama } = await import(pathToFileURL(resolve(process.cwd(), 'user/mock/systemone.mjs')).href);

// ── 測試框架（同 draw-contest-mimic.mjs）──
const R = [];
const check = (name, cond, extra = '') => R.push([cond ? 'PASS' : 'FAIL', name, extra]);
const connect = (port = PORT) => io(`http://127.0.0.1:${port}/draw-contest`, { path: '/socket.io', transports: ['websocket'], forceNew: true, reconnection: false });
const call = (s, ev, ...args) => new Promise((res) => s.emit(ev, ...args, res));
const once = (s, ev, ms = 4000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), ms); s.once(ev, (...a) => { clearTimeout(t); res(a); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (pred, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(20); } return pred(); };
const j = (x) => JSON.stringify(x)?.slice(0, 400);
const ab = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const isErr = (r, code, message) => r?.ok === false && r.error === code && (message === undefined || r.message === message);
/** 先掛好收集器再 join（nickname 或 token） */
const joinAs = async (nick, token, port = PORT) => {
  const s = connect(port); await once(s, 'connect');
  const rounds = [], refs = [], gallery = [], comments = [];
  s.on('round:update', (r) => rounds.push(r));
  s.on('contest:reference', (x) => refs.push(x));
  s.on('contest:gallery', (g) => gallery.push(g));
  s.on('contest:comment', (c) => comments.push(c));
  const r = await call(s, 'player:join', token === undefined ? { nickname: nick } : { nickname: nick, token });
  if (!r?.ok) throw new Error('join failed ' + j(r));
  return { s, nick, id: r.data.snapshot.you, token: r.data.token, snap: r.data.snapshot, rounds, refs, gallery, comments };
};
const lastRound = (p) => p.rounds.at(-1);
const waitPhase = (p, phase, roundNo, ms = 6000) => until(() => lastRound(p)?.phase === phase && (roundNo === undefined || lastRound(p).roundNo === roundNo), ms);

// ── PNG 產生器（zlib 壓 IDAT；結構與 CRC 都正確，真解碼器讀得了）──
const chunk = (type, data = Buffer.alloc(0)) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihdrChunk = () => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(CANVAS_LOGICAL.width, 0); ihdr.writeUInt32BE(CANVAS_LOGICAL.height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return chunk('IHDR', ihdr);
};
const idatChunk = (() => {
  const stride = 1 + CANVAS_LOGICAL.width * 3;
  const raw = Buffer.alloc(stride * CANVAS_LOGICAL.height, 0x1e);
  for (let y = 0; y < CANVAS_LOGICAL.height; y++) raw[y * stride] = 0;
  const c = chunk('IDAT', deflateSync(raw));
  return () => c;
})();
const textChunk = (text) => chunk('tEXt', Buffer.from(`Comment\0${text}`, 'latin1'));
const iendChunk = () => chunk('IEND');
const pngOf = (...chunks) => Buffer.concat([PNG_MAGIC, ...chunks]);
/** 合法 1280×720 PNG；seed 讓 bytes 不同（tEXt），marked 時 tEXt 帶 REJECT_MARKER（假 Ollama 回 400） */
const makePng = (seed, marked = false) => pngOf(ihdrChunk(), textChunk(`${marked ? REJECT_MARKER : 'seed'}#${seed}`), idatChunk(), iendChunk());

/** 合法 JPEG（libjpeg 產生的 1×1，288 bytes）插 COM 補到 size bytes（同 draw-contest-mimic.mjs） */
const BASE_JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABwn/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdAAYqm//Z', 'base64');
const makeJpeg = (seed, size) => {
  const n = size - BASE_JPEG.length;
  if (n < 4) throw new Error('makeJpeg：size 太小');
  const seg = Buffer.alloc(n);
  seg[0] = 0xff; seg[1] = 0xfe; seg.writeUInt16BE(n - 2, 2);
  for (let i = 4; i < n; i++) seg[i] = 0x21 + ((seed * 37 + i * 11) % 90);
  return Buffer.concat([BASE_JPEG.subarray(0, 20), seg, BASE_JPEG.subarray(20)]);
};

/** 假 Ollama 收到的請求（排除暖機） */
const judgeReqs = (mock) => mock.requests.filter((r) => r.path === '/v1/systemone' && r.body?.state?.topic !== 'warmup');
const hasMarker = (req, images) => (images ?? []).some((img) => Buffer.from(img, 'base64').includes(Buffer.from(REJECT_MARKER, 'latin1')));

const sockets = [];
let mock, mock404;
try {
  mock = await startMockOllama({ port: MOCK_PORT, rejectMarker: REJECT_MARKER, chatRejectMarker: REJECT_MARKER, chatDelayMs: 150 });

  const A = await joinAs('Alice'); sockets.push(A.s);
  if (A.snap.players.length !== 1) throw new Error(`需要全新的 server 程序（埠 ${PORT} 的房間已有其他玩家）`);
  const B = await joinAs('Bob'); sockets.push(B.s);
  const C = await joinAs('Carol'); sockets.push(C.s);

  // ════════ 甲、交卷 PNG 結構（§5.5）════════
  check('volunteer ok', (await call(C.s, 'round:volunteer'))?.ok === true);
  await waitPhase(A, 'choosing');
  check('setTopic ok', (await call(C.s, 'round:setTopic', { topic: '蘋果' }))?.ok === true);
  await waitPhase(A, 'drawing', 1);
  const good = makePng(1);
  const idatAt = 8 + 25 + textChunk('seed#1').length;   // 簽章＋IHDR＋tEXt 之後
  const overLen = Buffer.from(good); overLen.writeUInt32BE(overLen.readUInt32BE(idatAt) + 100, idatAt);
  const badPngs = [
    [pngOf(ihdrChunk()), '33 bytes（簽章＋IHDR，code review #5 重現）'],
    [pngOf(ihdrChunk(), idatChunk()), '缺 IEND'],
    [pngOf(ihdrChunk(), textChunk('x'), iendChunk()), '缺 IDAT'],
    [Buffer.concat([good, Buffer.from([0])]), 'IEND 後多 1 byte'],
    [overLen, 'IDAT 長度越界'],
    [pngOf(textChunk('x'), ihdrChunk(), idatChunk(), iendChunk()), 'IHDR 不在第一'],
  ];
  check('甲：33 bytes 假 PNG 確實是 33 bytes', badPngs[0][0].length === 33, String(badPngs[0][0].length));
  for (const [png, name] of badPngs) {
    const r = await call(A.s, 'contest:submit', { png: ab(png) });
    check(`甲：交卷 ${name} → SUBMISSION_INVALID（文案逐字）`, isErr(r, 'SUBMISSION_INVALID', SUBMISSION_INVALID_MESSAGE), j(r));
  }
  check('甲：被拒後仍未交卷（submittedCount 0）', lastRound(B)?.submittedCount === 0, j(lastRound(B)));

  // ════════ 乙、某幾張被假 Ollama 400：其他張仍 ai、不降級；評語不計連續 ════════
  // 交卷順序＝評分與評語順序：Alice（標記）、Bob（標記）、Carol（正常）→ 評語連兩張 400 後 Carol 照常有評語
  const rA = await call(A.s, 'contest:submit', { png: ab(makePng(11, true)) });
  check('乙：帶標記的合法 PNG（tEXt 輔助 chunk）結構合法、受理', rA?.ok === true, j(rA));
  await until(() => judgeReqs(mock).length >= 1 && lastRound(B)?.judgedCount >= 1, 3000);
  const rB = await call(B.s, 'contest:submit', { png: ab(makePng(12, true)) });
  check('乙：Bob 交卷受理', rB?.ok === true, j(rB));
  await until(() => lastRound(B)?.judgedCount >= 2, 3000);
  const rC = await call(C.s, 'contest:submit', { png: ab(makePng(13)) });
  check('乙：Carol 交卷受理', rC?.ok === true, j(rC));
  check('乙：全員交卷 → ended', await waitPhase(A, 'ended', 1), j(lastRound(A)));
  const ended = lastRound(A);
  const by = Object.fromEntries((ended.results ?? []).map((r) => [r.playerId, r.judgedBy]));
  check("乙：被拒的兩張 judgedBy 'random'、正常那張 'ai'", by[A.id] === 'random' && by[B.id] === 'random' && by[C.id] === 'ai', j(ended.results));
  check("乙：round.judgeMode 揭曉時仍 'ai'（不降級）", ended.judgeMode === 'ai', j(ended));
  check("乙：本回合所有 round:update 的 judgeMode 都不是 'random'", A.rounds.filter((r) => r.roundNo === 1).every((r) => r.judgeMode !== 'random'), j(A.rounds.map((r) => r.judgeMode)));
  const jr = judgeReqs(mock);
  check('乙：假 Ollama 收到三張評分請求（被拒的兩張各一次，之後沒有整回合改走 random）', jr.length === 3 && jr.filter((r) => hasMarker(r, r.body.images)).length === 2, `${jr.length}`);
  // 評語：等 Carol 的評語（批評版或第一名稱讚版）落定
  const finalComment = (pid) => {
    const fromEvent = [...A.comments].reverse().find((c) => c.roundNo === 1 && c.playerId === pid);
    if (fromEvent) return { done: true, comment: fromEvent.comment };
    const e = ended.results.find((r) => r.playerId === pid);
    return e && !e.commentPending ? { done: true, comment: e.comment } : { done: false };
  };
  await until(() => [A.id, B.id, C.id].every((pid) => finalComment(pid).done), 4000);
  check("乙：評語連兩張 400 後第三張（Carol）照常有評語（不計入連續失敗）", typeof finalComment(C.id).comment === 'string' && finalComment(C.id).comment.length > 0, j(finalComment(C.id)));
  check('乙：被拒的兩張沒有評語（null）', finalComment(A.id).comment === null && finalComment(B.id).comment === null, j([finalComment(A.id), finalComment(B.id)]));
  check("乙：commentMode 全程不是 'off'（沒有因被拒而關評語）", A.rounds.filter((r) => r.roundNo === 1).every((r) => r.commentMode !== 'off') && ended.commentMode === 'ai', j(A.rounds.map((r) => r.commentMode)));

  // ════════ 丙、重複 join 節流（§9.1、§5）════════
  await sleep(200);
  const D = await joinAs('Dave'); sockets.push(D.s);
  await until(() => D.gallery.length >= 3, 2000);
  check('丙：新加入者（results 非 null）照常補收 3 則 contest:gallery', D.gallery.length === 3, String(D.gallery.length));
  // 連送：距首次加入 < 1 秒 → 全部 RATE_LIMITED
  const burst = await Promise.all(Array.from({ length: 30 }, () => call(D.s, 'player:join', { nickname: 'Dave' })));
  check(`丙：已加入 socket 1 秒內連送 30 次 player:join → 全部 RATE_LIMITED「${JOIN_RATE_LIMITED_MESSAGE}」`, burst.every((r) => isErr(r, 'RATE_LIMITED', JOIN_RATE_LIMITED_MESSAGE)), j(burst.find((r) => !isErr(r, 'RATE_LIMITED', JOIN_RATE_LIMITED_MESSAGE))));
  await sleep(300);
  check('丙：連送之後沒有任何 contest:gallery 重送（仍是 3 則）', D.gallery.length === 3, String(D.gallery.length));
  await sleep(JOIN_MIN_INTERVAL_MS + 100);
  const again = await call(D.s, 'player:join', { nickname: 'whatever' });
  check('丙：1 秒後再送 → 受理：同 token、快照帶本回合 results', again?.ok === true && again.data.token === D.token && again.data.snapshot.round.results?.length === 3, j(again));
  await sleep(300);
  check('丙：受理的重複 join 仍不重送 contest:gallery／contest:reference', D.gallery.length === 3 && D.refs.length === 0, `${D.gallery.length}/${D.refs.length}`);
  const tooSoon = await call(D.s, 'player:join', { nickname: 'Dave' });
  check('丙：受理後重新起算：立刻再送 → RATE_LIMITED', isErr(tooSoon, 'RATE_LIMITED'), j(tooSoon));
  // 未綁定 socket 不受限
  const E = connect(); sockets.push(E); await once(E, 'connect');
  const e1 = await call(E, 'player:join', { nickname: '   ' });
  const e2 = await call(E, 'player:join', { nickname: 'ＡＬＩＣＥ' });
  const e3 = await call(E, 'player:join', { nickname: 'Eve' });
  check('丙：未綁定 socket 不受限：暱稱錯 → NICKNAME_INVALID、重名 → NICKNAME_TAKEN、立刻改對 → 受理', isErr(e1, 'NICKNAME_INVALID') && isErr(e2, 'NICKNAME_TAKEN') && e3?.ok === true, j([e1, e2, e3]));
  // token 接管：照常補送畫廊（不受節流，舊 socket 剛受理也一樣）
  const D2 = await joinAs('ignored', D.token); sockets.push(D2.s);
  await until(() => D2.gallery.length >= 3, 2000);
  check('丙：token 接管（新 socket）受理、同一玩家、照常補收 3 則畫廊', D2.id === D.id && D2.gallery.length === 3, `${D2.id}/${D.id} ${D2.gallery.length}`);

  // ════════ 丁、參考圖 JPEG 結尾 ＋ mimic 回合重複 join 不重送 contest:reference ════════
  check('丁：volunteer ok', (await call(A.s, 'round:volunteer'))?.ok === true);
  await waitPhase(B, 'choosing', 2);
  const jpeg = makeJpeg(5, 4096);
  const noEoi = jpeg.subarray(0, jpeg.length - 2);
  const tailJunk = Buffer.concat([jpeg, Buffer.from([0x00])]);
  for (const [buf, name] of [[noEoi, '缺 FF D9 結尾'], [tailJunk, 'FF D9 後多 1 byte']]) {
    const r = await call(A.s, 'round:setTopic', { topic: '皮卡丘', reference: ab(buf) });
    check(`丁：參考圖 ${name} → REFERENCE_INVALID（文案逐字）`, isErr(r, 'REFERENCE_INVALID', REFERENCE_INVALID_MESSAGE), j(r));
  }
  check('丁：仍在 choosing', lastRound(B)?.phase === 'choosing', j(lastRound(B)));
  const okRef = await call(A.s, 'round:setTopic', { topic: '皮卡丘', reference: ab(jpeg) });
  check('丁：合法 JPEG（FF D8 FF … FF D9）受理', okRef?.ok === true, j(okRef));
  await waitPhase(B, 'drawing', 2);
  await until(() => B.refs.length >= 1, 2000);
  check("丁：drawing 開始廣播 contest:reference、mode 'mimic'", B.refs.length === 1 && lastRound(B)?.mode === 'mimic', `${B.refs.length} ${lastRound(B)?.mode}`);
  const bRefsBefore = B.refs.length;
  const bGalleryBefore = B.gallery.length;
  const bAgain = await call(B.s, 'player:join', { nickname: 'Bob' });   // Bob 上次受理在很久以前
  await sleep(300);
  check("丁：已加入 socket 的重複 join 受理（快照 mode 'mimic'）但不重送 contest:reference／contest:gallery", bAgain?.ok === true && bAgain.data.snapshot.round.mode === 'mimic' && B.refs.length === bRefsBefore && B.gallery.length === bGalleryBefore, `${j(bAgain?.data?.snapshot?.round?.mode)} refs ${B.refs.length} gallery ${B.gallery.length}`);
  const F = await joinAs('Frank'); sockets.push(F.s);
  await until(() => F.refs.length >= 1, 2000);
  check('丁：mimic 回合中新加入者照常補收 contest:reference', F.refs.length === 1 && F.refs[0].roundNo === 2, j(F.refs.map((r) => r.roundNo)));

  // ════════ 不崩潰 ════════
  const alive = await call(C.s, 'chat:send', { text: 'still alive' });
  check('server 仍存活', C.s.connected && alive?.ok === true, j(alive));

  // ════════ 戊、404 不在白名單：照舊整回合降級（另一個 server、另一個假 Ollama）════════
  mock404 = await startMockOllama({ port: MOCK_PORT_404, rejectMarker: REJECT_MARKER, chatRejectMarker: REJECT_MARKER, rejectStatus: 404, chatDelayMs: 150 });
  const P = await joinAs('Pam', undefined, PORT_404); sockets.push(P.s);
  if (P.snap.players.length !== 1) throw new Error(`需要全新的 server 程序（埠 ${PORT_404} 的房間已有其他玩家）`);
  const Q = await joinAs('Quinn', undefined, PORT_404); sockets.push(Q.s);
  const W = await joinAs('Walt', undefined, PORT_404); sockets.push(W.s);
  check('戊：volunteer／setTopic ok', (await call(W.s, 'round:volunteer'))?.ok === true && (await call(W.s, 'round:setTopic', { topic: '香蕉' }))?.ok === true);
  await waitPhase(P, 'drawing', 1);
  // 交卷順序＝評分與評語順序：Pam（標記 → 404）、Quinn（標記）、Walt（正常）
  check('戊：Pam 交卷受理', (await call(P.s, 'contest:submit', { png: ab(makePng(21, true)) }))?.ok === true);
  await until(() => lastRound(Q)?.judgedCount >= 1, 4000);
  check('戊：Quinn 交卷受理', (await call(Q.s, 'contest:submit', { png: ab(makePng(22, true)) }))?.ok === true);
  await until(() => lastRound(Q)?.judgedCount >= 2, 4000);
  check('戊：Walt 交卷受理', (await call(W.s, 'contest:submit', { png: ab(makePng(23)) }))?.ok === true);
  check('戊：全員交卷 → ended', await waitPhase(P, 'ended', 1, 8000), j(lastRound(P)));
  const e404 = lastRound(P);
  check("戊：404 ＝ 上游不可用 → round.judgeMode 'random'、三張都 judgedBy 'random'（正常那張也是）", e404.judgeMode === 'random' && e404.results?.length === 3 && e404.results.every((r) => r.judgedBy === 'random'), j(e404.results));
  check('戊：降級後不再打 systemone（只有第一張那一次）', judgeReqs(mock404).length === 1, String(judgeReqs(mock404).length));
  const chat404 = mock404.requests.filter((r) => r.path === '/api/chat' && r.body?.messages?.some((m) => Array.isArray(m.images) && m.images.length > 0));
  check("戊：評語連兩張 404 算連續兩次失敗 → commentMode 'off'、第三張（Walt）不呼叫模型、沒有評語", e404.commentMode === 'off' && chat404.length === 2 && e404.results.every((r) => r.comment === null && r.commentPending === false), `${e404.commentMode} chat ${chat404.length} ${j(e404.results.map((r) => [r.comment, r.commentPending]))}`);
} catch (err) {
  check('測試流程未預期中斷', false, String(err?.stack ?? err).slice(0, 400));
} finally {
  for (const s of sockets) s.disconnect();
  await mock?.close();
  await mock404?.close();
}

let failed = 0;
for (const [status, name, extra] of R) {
  if (status === 'FAIL') failed++;
  console.log(`${status}  ${name}${status === 'FAIL' && extra ? `\n      ${extra}` : ''}`);
}
console.log(`\n${R.length - failed}/${R.length} PASS`);
process.exit(failed === 0 ? 0 : 1);
