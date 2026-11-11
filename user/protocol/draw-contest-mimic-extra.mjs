// 繪圖比賽「像不像比賽」補驗（Epic 20；驗收子代理（代架構師）2026-10-26 新寫）：只依 spec/draw-contest/architecture.md §4／§5／§5.1b／§5.4 打 Socket，不看實作。
// 補 draw-contest-mimic.mjs 沒涵蓋的條文：
//   (a) §5.1b「`null` 或其他型別照字面 → REFERENCE_INVALID」：reference 為 null／字串／數字／物件 → REFERENCE_INVALID（文案逐字 §5.4）且仍在 choosing；
//       另複驗非 JPEG（PNG magic）、> MAX_REFERENCE_BYTES、空 ArrayBuffer；TOPIC_INVALID 先於 REFERENCE_INVALID。
//   (b) §5.1b 事件順序：drawing 開始 round:update（mode mimic）→ contest:reference → players:update → chat:message（同一 socket 收到的先後）。
//   (c) §4 ReferenceImage 註解／§5.1b join 補送：judging 階段加入也收到 contest:reference（roundNo 正確、bytes 相同）；drawing 中以 token 重連（＝瀏覽器重新整理）
//       在 ack 之後補收；ended 加入時 contest:reference 在 contest:gallery 之前；下一回合 topic 模式 drawing 中加入不再收到。
//   (e) §4 RoundPublic：lastMode 與 results 同生命週期（ended 設、下一回合 drawing 清、idle／choosing 保留）；mode 在 idle／choosing 為 null。
// 不需要假 Ollama：JUDGE=random（種子含參考圖的部分由 vitest 單元測試驗）、COMMENT=off；JUDGE_FAKE_DELAY_MS=1500 讓 judging 撐住約 3 秒好讓人在 judging 加入。
// 用法（專案根目錄，需先 npm run build；隔離埠且只綁本機；**每次都要全新的 server 程序**；避免用瀏覽器開過的埠）：
//   HOST=127.0.0.1 PORT=3157 JUDGE=random JUDGE_FAKE_DELAY_MS=1500 COMMENT=off node server/dist/index.js &
//   TEST_PORT=3157 node --input-type=module < user/protocol/draw-contest-mimic-extra.mjs
// 總時長約 8 秒；全部 PASS 時 exit 0。
import { io } from 'socket.io-client';
import { deflateSync } from 'node:zlib';

const PORT = process.env.TEST_PORT ?? '3157';
const CANVAS_LOGICAL = { width: 1280, height: 720 };
const MAX_REFERENCE_BYTES = 2_097_152;
const REFERENCE_INVALID_MESSAGE = '參考圖格式不正確或太大（請選圖片檔）';   // §5.4

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

/** 掛收集器（seq 記所有事件到達順序）；join 可帶 token（重連） */
const attach = (s) => {
  const seq = [], rounds = [], refs = [], gallery = [], chat = [], players = [];
  s.on('round:update', (r) => { rounds.push(r); seq.push(`round:${r.roundNo}:${r.phase}`); });
  s.on('contest:reference', (x) => { refs.push(x); seq.push(`reference:${x.roundNo}`); });
  s.on('contest:gallery', (g) => { gallery.push(g); seq.push(`gallery:${g.roundNo}`); });
  s.on('players:update', (p) => { players.push(p); seq.push('players'); });
  s.on('chat:message', (m) => { chat.push(m); seq.push(`chat:${m.kind}`); });
  return { s, seq, rounds, refs, gallery, chat, players };
};
const joinAs = async (nick, token) => {
  const s = connect(); await once(s, 'connect');
  const p = attach(s);
  p.seq.push('join:sent');
  const r = await call(s, 'player:join', token === undefined ? { nickname: nick } : { nickname: nick, token });
  p.seq.push('join:ack');
  if (!r?.ok) throw new Error('join failed ' + j(r));
  return { ...p, nick, id: r.data.snapshot.you, token: r.data.token, snap: r.data.snapshot };
};
const lastRound = (p) => p.rounds.at(-1);
const waitPhase = (p, phase, roundNo, ms = 8000) => until(() => lastRound(p)?.phase === phase && (roundNo === undefined || lastRound(p).roundNo === roundNo), ms);

// ── PNG／JPEG 產生器（同 draw-contest-mimic.mjs）──
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const makePng = (seed) => {
  const { width, height } = CANVAS_LOGICAL;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const stride = 1 + width * 3; const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const o = y * stride + 1 + x * 3; const on = (x + y * (seed + 1)) % (17 + seed) < 3; raw[o] = on ? 200 : 30; raw[o + 1] = on ? (seed * 50) & 255 : 30; raw[o + 2] = 30; }
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

const sockets = [];
try {
  const A = await joinAs('Alice'); sockets.push(A.s);
  if (A.snap.players.length !== 1) throw new Error(`需要全新的 server 程序（埠 ${PORT} 的房間已有其他玩家）`);
  const B = await joinAs('Bob'); sockets.push(B.s);
  check('(e) idle：mode null、lastMode null、results null', A.snap.round.mode === null && A.snap.round.lastMode === null && A.snap.round.results === null, j(A.snap.round));

  check('A volunteer ok', (await call(A.s, 'round:volunteer'))?.ok === true);
  await waitPhase(B, 'choosing');
  const roundsBefore = B.rounds.length;
  const good = makeJpeg(7, 120_000);

  // (a) 型別照字面 → REFERENCE_INVALID
  for (const [label, value] of [['null', null], ['字串', 'data:image/jpeg;base64,/9j/'], ['數字', 123], ['物件', { jpeg: 1 }], ['布林 true', true]]) {
    const r = await call(A.s, 'round:setTopic', { topic: '皮卡丘', reference: value });
    check(`(a) reference 為 ${label} → REFERENCE_INVALID、文案逐字（§5.1b、§5.4）`, r?.ok === false && r.error === 'REFERENCE_INVALID' && r.message === REFERENCE_INVALID_MESSAGE, j(r));
  }
  const notJpeg = await call(A.s, 'round:setTopic', { topic: '皮卡丘', reference: ab(makePng(0)) });
  check('(a) 非 JPEG bytes（PNG magic）→ REFERENCE_INVALID', notJpeg?.ok === false && notJpeg.error === 'REFERENCE_INVALID' && notJpeg.message === REFERENCE_INVALID_MESSAGE, j(notJpeg));
  const tooBig = await call(A.s, 'round:setTopic', { topic: '皮卡丘', reference: ab(makeJpeg(2, MAX_REFERENCE_BYTES + 1)) });
  check('(a) > MAX_REFERENCE_BYTES → REFERENCE_INVALID', tooBig?.ok === false && tooBig.error === 'REFERENCE_INVALID' && tooBig.message === REFERENCE_INVALID_MESSAGE, j(tooBig));
  const exact = await call(A.s, 'round:setTopic', { topic: '皮卡丘', reference: ab(makeJpeg(2, MAX_REFERENCE_BYTES)) });
  check('(a) 剛好 MAX_REFERENCE_BYTES 不是錯（會成功進 drawing，先用取消測邊界）', exact?.ok === true, j(exact));
  // 剛好上限的那次已成功開局：等 drawing，再讓它走完（兩人都交卷），接著開下一回合重新測空 ArrayBuffer 與順序
  await waitPhase(B, 'drawing', 1);
  await until(() => A.refs.length === 1 && B.refs.length === 1);
  check('(a) 上限大小的參考圖：bytes 逐位元相同', toBuf(B.refs[0].jpeg).length === MAX_REFERENCE_BYTES && toBuf(B.refs[0].jpeg)[0] === 0xff, j({ len: toBuf(B.refs[0].jpeg).length }));
  await call(A.s, 'contest:submit', { png: ab(makePng(1)) });
  await call(B.s, 'contest:submit', { png: ab(makePng(2)) });
  await waitPhase(B, 'ended', 1);
  check('(e) 第 1 回合 ended：lastMode mimic、results 兩筆', lastRound(B)?.lastMode === 'mimic' && lastRound(B)?.results?.length === 2, j(lastRound(B)));

  // ── 第 2 回合（mimic）：驗順序、judging 加入、重連 ──
  check('B volunteer ok', (await call(B.s, 'round:volunteer'))?.ok === true);
  await waitPhase(A, 'choosing');
  check('(e) choosing：mode null、lastMode 保留 mimic、results 保留', lastRound(A)?.mode === null && lastRound(A)?.lastMode === 'mimic' && lastRound(A)?.results?.length === 2, j(lastRound(A)));
  const roundsBefore2 = A.rounds.length;
  const empty = await call(B.s, 'round:setTopic', { topic: '皮卡丘', reference: new ArrayBuffer(0) });
  check('(a) 空 ArrayBuffer → REFERENCE_INVALID', empty?.ok === false && empty.error === 'REFERENCE_INVALID' && empty.message === REFERENCE_INVALID_MESSAGE, j(empty));
  const both = await call(B.s, 'round:setTopic', { topic: '', reference: null });
  check('(a) 題目空且 reference null → TOPIC_INVALID（題目先於參考圖）', both?.ok === false && both.error === 'TOPIC_INVALID', j(both));
  const longTopic = await call(B.s, 'round:setTopic', { topic: '一'.repeat(21), reference: ab(good) });
  check('(a) 題目 21 字且參考圖合法 → TOPIC_INVALID', longTopic?.ok === false && longTopic.error === 'TOPIC_INVALID', j(longTopic));
  await sleep(150);
  check('(a) 各種失敗後仍在 choosing、沒有 round:update、沒有 contest:reference', A.rounds.length === roundsBefore2 && lastRound(A)?.phase === 'choosing' && A.refs.length === 1, j(A.rounds.slice(roundsBefore2).map((r) => r.phase)));

  const markA = A.seq.length, markB = B.seq.length;
  check('B 出題附參考圖 ok', (await call(B.s, 'round:setTopic', { topic: '照著畫', reference: ab(good) }))?.ok === true);
  await waitPhase(A, 'drawing', 2);
  await until(() => A.seq.slice(markA).includes('chat:system') && B.seq.slice(markB).includes('chat:system'));
  for (const [p, mark] of [[A, markA], [B, markB]]) {
    const seq = p.seq.slice(mark);
    check(`(b) ${p.nick}：drawing 開始事件順序 round:update → contest:reference → players:update → chat:message`, j(seq) === j(['round:2:drawing', 'reference:2', 'players', 'chat:system']), j(seq));
  }
  check('(b) round:update 的 mode mimic、roundNo 2；contest:reference roundNo 2、bytes 相同', lastRound(A)?.mode === 'mimic' && lastRound(A)?.roundNo === 2 && A.refs.at(-1)?.roundNo === 2 && toBuf(A.refs.at(-1).jpeg).equals(good), j({ mode: lastRound(A)?.mode, ref: A.refs.at(-1)?.roundNo }));
  check('(b) 系統訊息逐字「Bob 出題「照著畫」（像不像比賽：照著參考圖畫）」', A.chat.at(-1)?.kind === 'system' && A.chat.at(-1)?.text === 'Bob 出題「照著畫」（像不像比賽：照著參考圖畫）', j(A.chat.at(-1)));
  check('(e) 第 2 回合 drawing：results null、lastMode null、lastTopic null', lastRound(A)?.results === null && lastRound(A)?.lastMode === null && lastRound(A)?.lastTopic === null, j(lastRound(A)));

  // (c) drawing 中以 token 重連（＝重新整理）
  A.s.close();
  const A2 = await joinAs('Alice', A.token); sockets.push(A2.s);
  await until(() => A2.refs.length === 1);
  check('(c) drawing 中重連（token）：同一 id、快照 mode mimic、ack 之後補收 contest:reference（roundNo 2、bytes 相同）',
    A2.id === A.id && A2.snap.round.mode === 'mimic' && A2.refs[0]?.roundNo === 2 && toBuf(A2.refs[0].jpeg).equals(good) && A2.seq.indexOf('reference:2') > A2.seq.indexOf('join:ack'), j({ id: A2.id === A.id, seq: A2.seq }));

  // (c) judging 加入
  await call(A2.s, 'contest:submit', { png: ab(makePng(3)) });
  await call(B.s, 'contest:submit', { png: ab(makePng(4)) });
  await waitPhase(B, 'judging', 2);
  const C = await joinAs('Carol'); sockets.push(C.s);
  await until(() => C.refs.length === 1, 2000);
  check('(c) judging 中加入：快照 phase judging、mode mimic；ack 之後補收 contest:reference（roundNo 2、bytes 相同）、此時沒有畫廊',
    C.snap.round.phase === 'judging' && C.snap.round.mode === 'mimic' && C.refs[0]?.roundNo === 2 && toBuf(C.refs[0].jpeg).equals(good) && C.gallery.length === 0 && C.seq.indexOf('reference:2') > C.seq.indexOf('join:ack'), j({ phase: C.snap.round.phase, seq: C.seq }));
  check('(c) judging 中加入者不是參賽者（participating false）', C.snap.players.find((p) => p.id === C.id)?.participating === false, j(C.snap.players));

  await waitPhase(B, 'ended', 2);
  check('(e) 第 2 回合 ended：mode mimic、lastMode mimic、lastTopic 照著畫', lastRound(B)?.mode === 'mimic' && lastRound(B)?.lastMode === 'mimic' && lastRound(B)?.lastTopic === '照著畫', j(lastRound(B)));
  const D = await joinAs('Dave'); sockets.push(D.s);
  await until(() => D.refs.length === 1 && D.gallery.length === 2);
  check('(c) ended 加入：contest:reference（roundNo 2）在兩張 contest:gallery 之前、都在 ack 之後', D.refs[0]?.roundNo === 2 && D.gallery.length === 2 && D.seq.indexOf('reference:2') > D.seq.indexOf('join:ack') && D.seq.indexOf('reference:2') < D.seq.indexOf('gallery:2'), j(D.seq));
  check('(c) judging 時加入的 Carol 在 ended 收到畫廊、沒有再收一次參考圖', await until(() => C.gallery.length === 2) && C.refs.length === 1, j({ gallery: C.gallery.length, refs: C.refs.length }));

  // ── 第 3 回合（topic）：drawing 加入不再收到 ──
  check('C volunteer ok', (await call(C.s, 'round:volunteer'))?.ok === true);
  await waitPhase(B, 'choosing');
  const E = await joinAs('Eve'); sockets.push(E.s);
  await until(() => E.refs.length === 1);
  check('(c) 下一回合 choosing 加入（lastMode mimic、results 非 null）：補收上回合參考圖 roundNo 2', E.refs[0]?.roundNo === 2 && E.snap.round.lastMode === 'mimic' && E.snap.round.roundNo === 2, j({ refs: E.refs.map((r) => r.roundNo), snap: E.snap.round.lastMode }));
  const markB3 = B.seq.length;
  check('C 出題不附圖 ok', (await call(C.s, 'round:setTopic', { topic: '貓' }))?.ok === true);
  await waitPhase(B, 'drawing', 3);
  await until(() => B.seq.slice(markB3).includes('chat:system'));
  check('(b) topic 回合 drawing 開始事件順序 round:update → players:update → chat:message（沒有 contest:reference）', j(B.seq.slice(markB3)) === j(['round:3:drawing', 'players', 'chat:system']), j(B.seq.slice(markB3)));
  check('(e) 第 3 回合 drawing：mode topic、lastMode null、results null', lastRound(B)?.mode === 'topic' && lastRound(B)?.lastMode === null && lastRound(B)?.results === null, j(lastRound(B)));
  const F = await joinAs('Frank'); sockets.push(F.s);
  await sleep(300);
  check('(c) topic 回合 drawing 中加入：不收 contest:reference', F.refs.length === 0 && F.snap.round.mode === 'topic', j({ refs: F.refs.length, mode: F.snap.round.mode }));
  const refCounts = [A2, B, C, D, E].map((p) => p.refs.length);
  check('(c) topic 回合開始沒有人收到新的 contest:reference', j(refCounts) === j([1, 2, 1, 1, 1]), j(refCounts));
} catch (err) {
  check('未預期的例外', false, String(err?.stack ?? err));
} finally {
  for (const s of sockets) s.close();
}

let failed = 0;
for (const [status, name, extra] of R) {
  if (status === 'FAIL') failed++;
  console.log(`${status}  ${name}${status === 'FAIL' && extra ? `\n      ${extra}` : ''}`);
}
console.log(`\n${R.length - failed}/${R.length} passed`);
process.exit(failed === 0 ? 0 : 1);
