// 我畫你猜協定符合性測試（Epic 2：聊天室圖片中繼）
// 只依 spec/architecture.md §4/§5 打 Socket，不看實作。
// 用法（專案根目錄，需先 npm run build；隔離埠且只綁本機）：
//   HOST=127.0.0.1 PORT=3184 node server/dist/index.js &
//   TEST_PORT=3184 node --input-type=module < user/protocol/draw-guess-image.mjs
// 總時長約 40 秒（含 3 秒間隔限制、10 MB 傳輸與慢連線案例）；全部 PASS 時 exit 0。舵手（Helm）2026-09-25。
import { io } from 'socket.io-client';
import { createHash } from 'node:crypto';
const PORT = process.env.TEST_PORT ?? '3184';
const URL = `http://127.0.0.1:${PORT}/draw-guess`;
const R = [];
const check = (name, cond, extra = '') => R.push([cond ? 'PASS' : 'FAIL', name, extra]);
const connect = () => io(URL, { path: '/socket.io', transports: ['websocket'], forceNew: true, reconnection: false });
const call = (s, ev, ...args) => new Promise((res) => s.emit(ev, ...args, res));
const once = (s, ev, ms = 8000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), ms); s.once(ev, (...a) => { clearTimeout(t); res(a); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const collect = (s, ev) => { const arr = []; s.on(ev, (p) => arr.push(p)); return arr; };
const joinAs = async (nick) => { const s = connect(); await once(s, 'connect'); const r = await call(s, 'player:join', { nickname: nick }); if (!r.ok) throw new Error('join failed ' + JSON.stringify(r)); return { s, id: r.data.snapshot.you, snap: r.data.snapshot }; };
const ab = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const len = (d) => (d instanceof ArrayBuffer ? d.byteLength : d?.byteLength ?? -1);
const sha = (d) => createHash('sha256').update(Buffer.from(d instanceof ArrayBuffer ? new Uint8Array(d) : d)).digest('hex').slice(0, 12);

// 1×1 PNG（70 bytes）、最小 JPEG 標頭、GIF89a、WebP RIFF 標頭
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 1)]);
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(30, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(24, 3)]);
const MAX = 10 * 1024 * 1024;
const img = (s, mime, buf, extra = {}) => call(s, 'chat:image', { mime, width: 1, height: 1, data: ab(buf), ...extra });

const A = await joinAs('Alice'), B = await joinAs('Bob');
const aMsgs = collect(A.s, 'chat:message'), bMsgs = collect(B.s, 'chat:message');
const aImgs = collect(A.s, 'chat:image'), bImgs = collect(B.s, 'chat:image');

// ── 合法 PNG：兩端收到 meta 與 bytes ──
const r1 = await img(A.s, 'image/png', PNG);
await sleep(300);
check('PNG 上傳 ack ok 並回 id', r1.ok === true && typeof r1.data?.id === 'string', JSON.stringify(r1));
const mA = aMsgs.find((m) => m.kind === 'image'), mB = bMsgs.find((m) => m.kind === 'image');
check('雙方收到 chat:message kind image，含 image meta（server 填 bytes=實際長度）、text 空、fromId 為傳圖者', mA && mB && mA.id === r1.data.id && mA.image?.mime === 'image/png' && mA.image.bytes === PNG.length && mA.image.width === 1 && mA.text === '' && mA.fromId === A.id && mA.nickname === 'Alice', JSON.stringify(mA));
const iA = aImgs.find((p) => p.id === r1.data.id), iB = bImgs.find((p) => p.id === r1.data.id);
check('雙方（含本人）收到 chat:image，長度等於原檔且 SHA 一致（非整個 frame）', iA && iB && len(iA.data) === PNG.length && len(iB.data) === PNG.length && sha(iA.data) === sha(PNG) && sha(iB.data) === sha(PNG), `A=${len(iA?.data)} B=${len(iB?.data)} 原檔=${PNG.length}`);
check('chat:image 在同 id 的 chat:message 之後抵達', bMsgs.findIndex((m) => m.id === r1.data.id) !== -1 && bImgs.length >= 1);

// ── 間隔限制（3 秒）──
const r2 = await img(A.s, 'image/png', PNG);
check('3 秒內第二張 → RATE_LIMITED', r2.ok === false && r2.error === 'RATE_LIMITED', JSON.stringify(r2));

// ── 非法案例（用 B，避開間隔）──
const bad = [
  ['image/bmp', PNG, {}, 'mime 不支援'],
  ['image/png', JPEG, {}, 'magic bytes 與 mime 不符'],
  ['image/png', Buffer.alloc(0), {}, '大小 0'],
  ['image/png', PNG, { width: 0 }, '寬 0'],
  ['image/png', PNG, { height: 5000 }, '高 5000'],
  ['image/png', PNG, { width: 1.5 }, '寬非整數'],
];
for (const [mime, buf, extra, name] of bad) {
  const r = await img(B.s, mime, buf, extra);
  check(`${name} → IMAGE_INVALID`, r.ok === false && r.error === 'IMAGE_INVALID', JSON.stringify(r));
}
const rShape = await new Promise((res) => B.s.emit('chat:image', { mime: 'image/png', width: 1, height: 1, data: 'not-binary' }, res));
check('data 非二進位 → IMAGE_INVALID', rShape?.ok === false && rShape.error === 'IMAGE_INVALID', JSON.stringify(rShape));
B.s.emit('chat:image', { mime: 'image/png', width: 1, height: 1, data: ab(PNG) });   // 無 ack → 忽略
await sleep(200);
check('無 ack 的上傳被忽略、連線仍在', B.s.connected && bImgs.length === 1);

// ── 超限：10 MB + 1（在 maxHttpBufferSize 內）→ IMAGE_INVALID 且不斷線 ──
const big = Buffer.concat([PNG, Buffer.alloc(MAX + 1 - PNG.length, 7)]);
const rBig = await new Promise((res) => { const t = setTimeout(() => res({ timeout: true }), 30000); B.s.emit('chat:image', { mime: 'image/png', width: 1, height: 1, data: ab(big) }, (r) => { clearTimeout(t); res(r); }); });
check('10 MB + 1 → IMAGE_INVALID，連線不斷', rBig.ok === false && rBig.error === 'IMAGE_INVALID' && B.s.connected, JSON.stringify(rBig));

// ── 剛好 10 MB 合法 GIF：通過且兩端 SHA 一致 ──
const gifMax = Buffer.concat([GIF, Buffer.alloc(MAX - GIF.length, 9)]);
const t0 = Date.now();
const rMax = await img(B.s, 'image/gif', gifMax, { width: 640, height: 480 });
const [pA] = await once(A.s, 'chat:image', 30000);
const ms = Date.now() - t0;
check('剛好 10 MB GIF 通過，A 收到 SHA 一致', rMax.ok === true && len(pA.data) === MAX && sha(pA.data) === sha(gifMax), `${ms} ms`);

// ── 其他格式 ──
await sleep(3100);
const rJ = await img(A.s, 'image/jpeg', JPEG); await sleep(3100);
const rG = await img(A.s, 'image/gif', GIF); await sleep(3100);
const rW = await img(A.s, 'image/webp', WEBP);
check('JPEG／GIF／WebP magic bytes 皆通過', rJ.ok && rG.ok && rW.ok, JSON.stringify([rJ, rG, rW]));

// ── 作畫中的畫師被擋、猜題者可傳 ──
await call(A.s, 'round:volunteer');
await sleep(3100);
const rDrawerChoosing = await img(A.s, 'image/png', PNG);
check('畫師在 choosing 傳圖 → SPOILER_BLOCKED', rDrawerChoosing.ok === false && rDrawerChoosing.error === 'SPOILER_BLOCKED', JSON.stringify(rDrawerChoosing));
await call(A.s, 'round:setTopic', { topic: '貓' });
await sleep(3100);
const rDrawer = await img(A.s, 'image/png', PNG);
check('畫師在 drawing 傳圖 → SPOILER_BLOCKED', rDrawer.ok === false && rDrawer.error === 'SPOILER_BLOCKED');
const rGuesser = await img(B.s, 'image/png', PNG);
check('猜題者在 drawing 傳圖 → ok', rGuesser.ok === true, JSON.stringify(rGuesser));
await sleep(300);

// ── 中途加入者：快照只有 meta，沒有 bytes ──
const C = await joinAs('Carol');
const imgsInSnap = C.snap.chat.filter((m) => m.kind === 'image');
check('中途加入者快照含 image 訊息 meta、無 data 欄位', imgsInSnap.length >= 5 && imgsInSnap.every((m) => m.image && !('data' in m)), String(imgsInSnap.length));
check('中途加入者沒有收到任何 chat:image', collect(C.s, 'chat:image').length === 0);

// ── 慢連線保護（§5）：暫停 C 的 TCP 讀取模擬慢客戶端，猜題者 B 連送 4 張 10 MB（A 是作畫中的畫師不能傳圖，改當正常觀察者）──
await sleep(3100);
const cImgs = collect(C.s, 'chat:image'), aImgs2 = collect(A.s, 'chat:image');
const cNet = C.s.io.engine.transport.ws?._socket;
check('可取得慢客戶端底層 socket 以暫停讀取', !!cNet && typeof cNet.pause === 'function');
cNet?.pause();
let sent = 0;
for (let i = 0; i < 4; i++) {
  const r = await img(B.s, 'image/gif', gifMax, { width: 640, height: 480 });
  if (r.ok) sent++; else console.log('send failed:', JSON.stringify(r));
  if (i < 3) await sleep(3100);
}
await sleep(500);
cNet?.resume();
await sleep(6000);
const cNull = cImgs.filter((p) => p.data === null).length, cFull = cImgs.filter((p) => p.data !== null && len(p.data) === MAX).length;
const bNull = aImgs2.filter((p) => p.data === null).length, bFull = aImgs2.filter((p) => len(p.data) === MAX).length;
check('4 張皆送出（間隔 3 秒）', sent === 4, String(sent));
check('慢客戶端未被 ping timeout 斷線', C.s.connected);
check('慢客戶端至少 1 張收到 data: null（略過），其餘為完整 10 MB', cNull >= 1 && cFull + cNull === 4, `null=${cNull} full=${cFull}`);
check('正常客戶端（畫師 A）0 張被略過、4 張完整', bNull === 0 && bFull === 4, `null=${bNull} full=${bFull}`);

for (const x of [A, B, C]) x.s.disconnect();
console.log(R.map((r) => r.join('  ')).join('\n'));
const fails = R.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${R.length - fails}/${R.length} passed`);
process.exit(fails ? 1 : 0);
