// 繪圖比賽「像不像比賽」協定符合性測試（Epic 20，plan/contest-mimic.md Phase 1）：只依 spec/draw-contest/architecture.md §4／§5／§5.1b／§5.4／§6／§6.1 打 Socket，
// 不看實作、不 import server 內部程式。涵蓋 plan Phase 1 最後一列：
//   有參考圖 → mode 'mimic'；contest:reference 在 drawing 開始時廣播（bytes、roundNo 相符）與中途加入補送（drawing／ended／下一回合 choosing）；
//   JPEG 驗證三種失敗（非 JPEG、超過 2 MiB、空）→ REFERENCE_INVALID（文案逐字）且仍在 choosing；檢查順序（NOT_SETTER → TOPIC_INVALID → REFERENCE_INVALID）；
//   評分走雙圖（假 Ollama 收到的 /v1/systemone：images [參考圖, 作品]、similarity＋effort、不問 is_topic）與評語雙圖（/api/chat：images 兩張、mimic 文案）；
//   揭曉 lastMode 'mimic'；下一回合 topic 模式不帶參考圖（不廣播、不補送、評分與評語回到單圖三題版、lastMode 生命週期）；mimic 系統訊息逐字。
//
// 需要一個 server 程序；假 Ollama 由本檔在同一程序內啟動（import user/mock/systemone.mjs 的 startMockOllama，才看得到 server 送了什麼）；**不碰真模型**。
// 用法（專案根目錄，需先 npm run build；隔離埠且只綁本機；**每次都要全新的 server 程序**；避免用瀏覽器開過的埠）：
//   HOST=127.0.0.1 PORT=3247 JUDGE=ollama COMMENT=ollama OLLAMA_URL=http://127.0.0.1:11477 node server/dist/index.js &
//   TEST_PORT=3247 TEST_MOCK_PORT=11477 node --input-type=module < user/protocol/draw-contest-mimic.mjs
// - server 先起時假 Ollama 還沒開，啟動探測會 warn ollamaUnavailable／commentUnavailable、不暖機（§6、§6.1：每回合仍先試 ollama，不影響）。
// - 一定要在專案根目錄執行（以 process.cwd() 找 user/mock/systemone.mjs）。
// 總時長約 3 秒；全部 PASS 時 exit 0。
import { io } from 'socket.io-client';
import { deflateSync } from 'node:zlib';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PORT = process.env.TEST_PORT ?? '3247';
const MOCK_PORT = Number(process.env.TEST_MOCK_PORT ?? 11477);
// ── 常數：.mjs 不能 import .ts，照既有協定測試慣例寫死；出處 shared/src/draw-contest/constants.ts（spec §4 常數表）──
const CANVAS_LOGICAL = { width: 1280, height: 720 };
const MAX_REFERENCE_BYTES = 2_097_152;
// ── spec 文案（逐字）──
const REFERENCE_INVALID_MESSAGE = '參考圖格式不正確或太大（請選圖片檔）';   // §5.4
const MIMIC_TASK = 'A player tried to copy the first image (the reference) by drawing the second image in a drawing contest.';   // §6
const SIMILARITY_INSTRUCTIONS = "The first image is the reference and the second is the player's drawing. How closely does the drawing reproduce the reference in shapes, composition and main subject, ignoring colour and line thickness?";
const SIMILARITY_CRITERIA = ['Completely different', 'Slightly similar', 'Roughly similar', 'Very similar', 'Nearly identical'];

const { startMockOllama } = await import(pathToFileURL(resolve(process.cwd(), 'user/mock/systemone.mjs')).href);

// ── 測試框架（同 draw-contest-phase1.mjs）──
const R = [];
const check = (name, cond, extra = '') => R.push([cond ? 'PASS' : 'FAIL', name, extra]);
const connect = () => io(`http://127.0.0.1:${PORT}/draw-contest`, { path: '/socket.io', transports: ['websocket'], forceNew: true, reconnection: false });
const call = (s, ev, ...args) => new Promise((res) => s.emit(ev, ...args, res));
const once = (s, ev, ms = 4000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), ms); s.once(ev, (...a) => { clearTimeout(t); res(a); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (pred, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(20); } return pred(); };
const j = (x) => JSON.stringify(x)?.slice(0, 400);
const ab = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const toBuf = (x) => Buffer.from(x instanceof ArrayBuffer ? new Uint8Array(x) : x);
/** 每個 socket 先掛好收集器再 join；seq 依到達順序記事件 */
const joinAs = async (nick) => {
  const s = connect(); await once(s, 'connect');
  const seq = [], rounds = [], refs = [], gallery = [], chat = [], comments = [];
  s.on('round:update', (r) => { rounds.push(r); seq.push(`round:${r.roundNo}:${r.phase}`); });
  s.on('contest:reference', (x) => { refs.push(x); seq.push(`reference:${x.roundNo}`); });
  s.on('contest:gallery', (g) => { gallery.push(g); seq.push(`gallery:${g.roundNo}`); });
  s.on('contest:comment', (c) => comments.push(c));
  s.on('chat:message', (m) => chat.push(m));
  const r = await call(s, 'player:join', { nickname: nick });
  if (!r?.ok) throw new Error('join failed ' + j(r));
  return { s, nick, id: r.data.snapshot.you, snap: r.data.snapshot, seq, rounds, refs, gallery, chat, comments };
};
const lastRound = (p) => p.rounds.at(-1);
const waitPhase = (p, phase, roundNo, ms = 6000) => until(() => lastRound(p)?.phase === phase && (roundNo === undefined || lastRound(p).roundNo === roundNo), ms);

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
/**
 * 合法 JPEG（Epic 21 起 server 另驗結尾 FF D9，§5.5）：libjpeg 產生的 1×1 JPEG（288 bytes）在 APP0 之後插 COM segment，
 * 以 seed 填內容、補到剛好 size bytes；FF D8 FF 開頭、FF D9 結尾、segment 結構正確（真解碼器讀得了）。
 */
const BASE_JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABwn/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdAAYqm//Z', 'base64');
const makeJpeg = (seed, size) => {
  let extra = size - BASE_JPEG.length;
  if (extra < 0 || (extra > 0 && extra < 4)) throw new Error(`makeJpeg：size ${size} 無法組成`);
  const segs = [];
  let x = (seed * 2654435761) >>> 0;
  while (extra > 0) {
    let n = Math.min(extra, 65537);
    if (extra - n > 0 && extra - n < 4) n -= 4;
    const seg = Buffer.alloc(n);
    seg[0] = 0xff; seg[1] = 0xfe; seg.writeUInt16BE(n - 2, 2);
    for (let i = 4; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; seg[i] = 0x21 + ((x >>> 24) % 90); }
    segs.push(seg);
    extra -= n;
  }
  return Buffer.concat([BASE_JPEG.subarray(0, 20), ...segs, BASE_JPEG.subarray(20)]);
};

/** 假 Ollama 收到的請求（排除暖機：topic 'warmup'、沒有圖的 chat） */
const judgeReqs = (mock) => mock.requests.filter((r) => r.path === '/v1/systemone' && r.body?.state?.topic !== 'warmup');
const chatReqs = (mock) => mock.requests.filter((r) => r.path === '/api/chat' && r.body?.messages?.some((m) => Array.isArray(m.images) && m.images.length > 0));
const userMsg = (req) => req.body.messages.find((m) => m.role === 'user');

const sockets = [];
let mock;
try {
  mock = await startMockOllama({ port: MOCK_PORT });

  const A = await joinAs('Alice'); sockets.push(A.s);
  if (A.snap.players.length !== 1) throw new Error(`需要全新的 server 程序（埠 ${PORT} 的房間已有其他玩家）`);
  const B = await joinAs('Bob'); sockets.push(B.s);
  check('idle：RoundPublic 有 mode 與 lastMode 欄位且皆為 null', 'mode' in A.snap.round && 'lastMode' in A.snap.round && A.snap.round.mode === null && A.snap.round.lastMode === null, j(A.snap.round));
  check('從未有 mimic 回合：加入不收 contest:reference', A.refs.length === 0 && B.refs.length === 0);

  // ── 出題：驗證失敗仍在 choosing ──
  check('volunteer ok', (await call(A.s, 'round:volunteer'))?.ok === true);
  await waitPhase(B, 'choosing');
  check('choosing：mode null、lastMode null', lastRound(B)?.mode === null && lastRound(B)?.lastMode === null, j(lastRound(B)));
  const roundsBefore = B.rounds.length;
  const good = makeJpeg(1, 300_000);

  const notSetter = await call(B.s, 'round:setTopic', { topic: '皮卡丘', reference: ab(makePng(0)) });
  check('檢查順序：非出題者帶壞參考圖 → NOT_SETTER（身分先於參考圖）', notSetter?.ok === false && notSetter.error === 'NOT_SETTER', j(notSetter));
  const badTopic = await call(A.s, 'round:setTopic', { topic: '   ', reference: ab(makePng(0)) });
  check('檢查順序：題目與參考圖都不合法 → TOPIC_INVALID（題目先於參考圖）', badTopic?.ok === false && badTopic.error === 'TOPIC_INVALID', j(badTopic));
  const notJpeg = await call(A.s, 'round:setTopic', { topic: '皮卡丘', reference: ab(makePng(0)) });
  check('非 JPEG（PNG bytes）→ REFERENCE_INVALID、文案逐字（§5.4）', notJpeg?.ok === false && notJpeg.error === 'REFERENCE_INVALID' && notJpeg.message === REFERENCE_INVALID_MESSAGE, j(notJpeg));
  const tooBig = await call(A.s, 'round:setTopic', { topic: '皮卡丘', reference: ab(makeJpeg(2, MAX_REFERENCE_BYTES + 1)) });
  check('超過 MAX_REFERENCE_BYTES（2 MiB + 1）→ REFERENCE_INVALID', tooBig?.ok === false && tooBig.error === 'REFERENCE_INVALID' && tooBig.message === REFERENCE_INVALID_MESSAGE, j(tooBig));
  const empty = await call(A.s, 'round:setTopic', { topic: '皮卡丘', reference: new ArrayBuffer(0) });
  check('空的參考圖（0 bytes）→ REFERENCE_INVALID', empty?.ok === false && empty.error === 'REFERENCE_INVALID', j(empty));
  await sleep(150);
  check('三種失敗後仍在 choosing：沒有任何 round:update、沒有 contest:reference', B.rounds.length === roundsBefore && lastRound(B)?.phase === 'choosing' && A.refs.length === 0 && B.refs.length === 0, j(B.rounds.slice(roundsBefore)));

  // ── 有參考圖 → mimic ──
  const okSet = await call(A.s, 'round:setTopic', { topic: ' 皮卡丘 ', reference: ab(good) });
  check('合法 JPEG（約 300 KB）→ setTopic ok', okSet?.ok === true, j(okSet));
  await waitPhase(B, 'drawing', 1);
  await until(() => A.refs.length === 1 && B.refs.length === 1);
  const d1 = lastRound(B);
  check('drawing：mode mimic、topic 去空白、lastMode null、results null', d1?.mode === 'mimic' && d1.topic === '皮卡丘' && d1.lastMode === null && d1.results === null, j(d1));
  for (const p of [A, B]) {
    const ref = p.refs[0];
    check(`${p.nick}：drawing 開始收到 contest:reference（roundNo 1、鍵只有 roundNo／jpeg、bytes 與送出的相同）`,
      ref?.roundNo === 1 && Object.keys(ref).sort().join() === 'jpeg,roundNo' && toBuf(ref.jpeg).equals(good), j({ roundNo: ref?.roundNo, keys: ref && Object.keys(ref), len: ref && toBuf(ref.jpeg).length }));
    check(`${p.nick}：contest:reference 排在 round:update drawing 之後`, p.seq.indexOf('reference:1') > p.seq.indexOf('round:1:drawing') && p.seq.indexOf('round:1:drawing') >= 0, j(p.seq));
  }
  await until(() => B.chat.some((m) => m.kind === 'system' && m.text.includes('皮卡丘')));
  check('mimic 系統訊息逐字：「Alice 出題「皮卡丘」（像不像比賽：照著參考圖畫）」', B.chat.some((m) => m.kind === 'system' && m.text === 'Alice 出題「皮卡丘」（像不像比賽：照著參考圖畫）'), j(B.chat.map((m) => m.text)));

  const C = await joinAs('Carol'); sockets.push(C.s);
  await until(() => C.refs.length === 1);
  check('drawing 中途加入：快照 mode mimic，ack 之後補收本回合參考圖（roundNo 1、bytes 相同）', C.snap.round.mode === 'mimic' && C.refs[0]?.roundNo === 1 && toBuf(C.refs[0].jpeg).equals(good), j({ mode: C.snap.round.mode, refs: C.refs.length }));

  // ── 交卷 → 評分走雙圖 → 揭曉 ──
  const pngA = makePng(1), pngB = makePng(2);
  const sa = await call(A.s, 'contest:submit', { png: ab(pngA) });
  const sb = await call(B.s, 'contest:submit', { png: ab(pngB) });
  check('A、B 交卷 ok', sa?.ok === true && sb?.ok === true, j([sa, sb]));
  await waitPhase(B, 'ended', 1);
  const e1 = lastRound(B);
  check('ended：mode mimic、lastMode mimic、lastTopic 皮卡丘、judgeMode ai（假 Ollama 評分）、results 兩筆', e1?.mode === 'mimic' && e1.lastMode === 'mimic' && e1.lastTopic === '皮卡丘' && e1.judgeMode === 'ai' && e1.results?.length === 2, j(e1));
  const jr1 = judgeReqs(mock);
  check('評分請求兩則（每張一則）', jr1.length === 2, `got ${jr1.length}`);
  check('評分走雙圖：images 兩張，第一張是參考圖、第二張是交卷 PNG（bytes 逐位元相同）',
    jr1.length === 2 && jr1.every((r) => r.body.images.length === 2 && Buffer.from(r.body.images[0], 'base64').equals(good))
      && sameSetBufs(jr1.map((r) => Buffer.from(r.body.images[1], 'base64')), [pngA, pngB]), j(jr1.map((r) => r.body.images.length)));
  check('評分 mimic 版：state.task 逐字、題目 similarity（instructions 與 5 級 criteria 逐字）＋ effort，不問 is_topic',
    jr1.every((r) => r.body.state.task === MIMIC_TASK && r.body.state.topic === '皮卡丘' && Object.keys(r.body.questions).sort().join() === 'effort,similarity'
      && r.body.questions.similarity.type === 'score' && r.body.questions.similarity.instructions === SIMILARITY_INSTRUCTIONS
      && j(r.body.questions.similarity.criteria) === j(SIMILARITY_CRITERIA) && r.body.questions.effort.instructions === 'How complete is the drawing?'), j(jr1[0]?.body.questions));
  check('分數在 0..100、judgedBy ai', e1.results.every((e) => e.submitted && e.judgedBy === 'ai' && Number.isInteger(e.score) && e.score >= 0 && e.score <= 100), j(e1.results));

  const D = await joinAs('Dave'); sockets.push(D.s);
  await until(() => D.refs.length === 1 && D.gallery.length === 2);
  check('ended 後加入：補收本回合參考圖（roundNo 1）與兩張畫廊，參考圖在畫廊之前', D.refs[0]?.roundNo === 1 && toBuf(D.refs[0].jpeg).equals(good) && D.gallery.length === 2 && D.seq.indexOf('reference:1') < D.seq.indexOf('gallery:1'), j(D.seq));

  // 評語也看兩張圖（§6.1）：等評語都完成
  await until(() => chatReqs(mock).length >= 3, 4000);
  await sleep(100);
  const cr1 = chatReqs(mock);
  check('評語走雙圖：每則 /api/chat 的 user 訊息 images 兩張（參考圖在前）', cr1.length >= 2 && cr1.every((r) => userMsg(r).images.length === 2 && Buffer.from(userMsg(r).images[0], 'base64').equals(good)), j(cr1.map((r) => userMsg(r).images?.length)));
  check('評語 mimic 文案：批評版含「第一張是參考圖，第二張是參賽者「…」照著畫的」；第一名稱讚版含「第一張是參考圖，第二張是它照著畫的」',
    cr1.some((r) => /^題目「皮卡丘」，評分 \d+ 分。第一張是參考圖，第二張是參賽者「(Alice|Bob)」照著畫的，給一句評語。$/.test(userMsg(r).content))
      && cr1.some((r) => /^題目「皮卡丘」，評分 \d+ 分，這張是本回合第一名，參賽者「(Alice|Bob)」。第一張是參考圖，第二張是它照著畫的。妳不甘心，但還是得承認它畫得像，用雌小鬼的口氣誇它，一句評語。$/.test(userMsg(r).content)), j(cr1.map((r) => userMsg(r).content)));

  // ── 下一回合：choosing 仍可補收上回合參考圖；topic 模式不帶參考圖 ──
  check('B volunteer（ended 視同 idle）ok', (await call(B.s, 'round:volunteer'))?.ok === true);
  await waitPhase(A, 'choosing');
  check('下一回合 choosing：mode null、lastMode 仍 mimic、results 保留', lastRound(A)?.mode === null && lastRound(A)?.lastMode === 'mimic' && lastRound(A)?.results?.length === 2, j(lastRound(A)));
  const E = await joinAs('Eve'); sockets.push(E.s);
  await until(() => E.refs.length === 1);
  check('choosing 中加入：補收上回合參考圖（roundNo 1）', E.refs[0]?.roundNo === 1 && toBuf(E.refs[0].jpeg).equals(good), j(E.refs.map((r) => r.roundNo)));

  const refsBefore = [A, B, C, D, E].map((p) => p.refs.length);
  const jBefore = judgeReqs(mock).length;
  const cBefore = chatReqs(mock).length;
  check('B 出題不帶參考圖 → ok', (await call(B.s, 'round:setTopic', { topic: '貓' }))?.ok === true);
  await waitPhase(A, 'drawing', 2);
  const d2 = lastRound(A);
  check('第二回合 drawing：mode topic、lastMode null（與 results 同時清空）、lastTopic null', d2?.mode === 'topic' && d2.lastMode === null && d2.results === null && d2.lastTopic === null, j(d2));
  await until(() => A.chat.some((m) => m.text.includes('「貓」')));
  check('topic 回合系統訊息照舊：「Bob 出題「貓」，開始作畫」', A.chat.some((m) => m.kind === 'system' && m.text === 'Bob 出題「貓」，開始作畫'), j(A.chat.map((m) => m.text).slice(-3)));
  const F = await joinAs('Frank'); sockets.push(F.s);
  await sleep(200);
  check('topic 回合：沒有人收到新的 contest:reference；drawing 中途加入者也不補送', [A, B, C, D, E].every((p, i) => p.refs.length === refsBefore[i]) && F.refs.length === 0, j([A, B, C, D, E, F].map((p) => p.refs.length)));

  const players2 = [A, B, C, D, E];
  const subs = await Promise.all(players2.map((p, i) => call(p.s, 'contest:submit', { png: ab(makePng(10 + i)) })));
  check('第二回合五位參賽者交卷 ok', subs.every((r) => r?.ok === true), j(subs));
  await waitPhase(A, 'ended', 2);
  const e2 = lastRound(A);
  check('第二回合 ended：mode topic、lastMode topic', e2?.mode === 'topic' && e2.lastMode === 'topic' && e2.results?.length === 5, j(e2 && { mode: e2.mode, lastMode: e2.lastMode }));
  const jr2 = judgeReqs(mock).slice(jBefore);
  check('第二回合評分回到單圖三題版（likeness／is_topic／effort），沒有 similarity',
    jr2.length === 5 && jr2.every((r) => r.body.images.length === 1 && Object.keys(r.body.questions).sort().join() === 'effort,is_topic,likeness' && r.body.state.task !== MIMIC_TASK), j(jr2.map((r) => [r.body.images.length, Object.keys(r.body.questions)])));
  await until(() => chatReqs(mock).length - cBefore >= 6, 4000);
  const cr2 = chatReqs(mock).slice(cBefore);
  check('第二回合評語單圖、文案不提參考圖', cr2.length >= 5 && cr2.every((r) => userMsg(r).images.length === 1 && !userMsg(r).content.includes('參考圖')), j(cr2.map((r) => userMsg(r).images?.length)));
  const G = await joinAs('Grace'); sockets.push(G.s);
  await until(() => G.gallery.length === 5);
  await sleep(100);
  check('第二回合 ended 後加入：收畫廊、不收 contest:reference（lastMode topic）', G.gallery.length === 5 && G.refs.length === 0, j({ gallery: G.gallery.length, refs: G.refs.length }));
  check('整場：每位收到的 contest:reference 都是 roundNo 1', [A, B, C, D, E, F, G].every((p) => p.refs.every((r) => r.roundNo === 1)));
} catch (err) {
  check('未預期的例外', false, String(err?.stack ?? err));
} finally {
  for (const s of sockets) s.close();
  await mock?.close();
}

function sameSetBufs(got, want) {
  if (got.length !== want.length) return false;
  const rest = [...want];
  for (const g of got) {
    const i = rest.findIndex((w) => w.equals(g));
    if (i < 0) return false;
    rest.splice(i, 1);
  }
  return true;
}

let failed = 0;
for (const [status, name, extra] of R) {
  if (status === 'FAIL') failed++;
  console.log(`${status}  ${name}${status === 'FAIL' && extra ? `\n      ${extra}` : ''}`);
}
console.log(`\n${R.length - failed}/${R.length} PASS`);
process.exit(failed === 0 ? 0 : 1);
