// 我畫你猜聊天圖片壓測（Epic 2 Phase 3）：30 客戶端 × 每位傳送者 5 張接近 MAX_IMAGE_BYTES 的圖，同一個 server 連跑 ROUNDS 輪
// 驗：所有人收到的位元組完全一致、chat:image 緊接同 id 的 chat:message、傳送者本人也收到、
//     慢連線保護（spec §5，2026-09-25）：慢客戶端收到 data: null（略過）視為合法、不得被斷線、收到的非 null 圖位元組一致；
//     正常客戶端 0 張被略過（門檻 IMAGE_SKIP_BUFFER_BYTES = 2 × MAX_IMAGE_BYTES + 2 MiB，允許兩張在途，三人同時送也不該略過）；
//     慢客戶端略過張數只記錄（可能為 0：2 MiB/s 下積壓未必超過約 22 MiB 的門檻）；
//     記憶體（plan/chat-image.md 驗收標準，2026-09-25 定案）：所有情境每輪結束後強制 GC 的 process.memoryUsage().arrayBuffers < 5 MB；
//     單傳送者（SENDERS=1）另判最後一輪 RSS 峰值 ≤ 第 1 輪峰值 × 1.1；多傳送者 RSS 比值只印出不判定（malloc 波動）。
//     macOS malloc 不歸還大區塊，ps RSS 不回落不算洩漏。
// 只依 spec/architecture.md §3/§4/§5「圖片訊息」/§9 打 Socket，不 import 實作；server 記憶體以 inspector（CDP）讀，不改 server 程式。
// 用法（專案根目錄，需先 npm run build；請用隔離埠加 HOST=127.0.0.1，桌面 app 的瀏覽器窗格會自動重連 7180）：
//   PORT=3195 HOST=127.0.0.1 node --expose-gc --inspect=127.0.0.1:9295 server/dist/index.js > <scratchpad>/server.log 2>&1 &
//   # 記下 $!（node 本身的 pid）
//   TEST_PORT=3195 SERVER_PID=<pid> INSPECT_PORT=9295 ROUNDS=3 SENDERS=1 SLOW=1 node user/protocol/draw-guess-image-load.mjs
// 環境變數：TEST_PORT（預設 3195）、HOST（預設 127.0.0.1）、CLIENTS（預設 30）、IMAGES（每位傳送者每輪張數，預設 5）、
//          SENDERS（傳送者人數，預設 1；多位時同時開始、各自遵守 IMAGE_MIN_INTERVAL_MS）、ROUNDS（輪數，預設 1；同一批連線連跑）、
//          SLOW（慢客戶端數，預設 1）、SLOW_KBPS（慢客戶端讀取速率 KiB/s，預設 2048 ≈ 16 Mbps）、
//          SERVER_PID（選填；有給就以 ps 量 server RSS：每 200 ms 取樣，逐輪記峰值）、
//          INSPECT_PORT（選填；server 以 --expose-gc --inspect=127.0.0.1:<port> 啟動時，每輪結束後經 CDP 呼叫 gc() 並讀 process.memoryUsage()）、
//          RSS_TRACE（選填，設 1 時另印 RSS 時間序列，約每秒一點）。
// 圖片：依 spec，server 只驗 mime 清單、大小 1..MAX_IMAGE_BYTES、magic bytes、宣告寬高 1..4096，不解碼。
//   因此以「合法檔頭（PNG 簽章＋IHDR／GIF89a＋邏輯螢幕尺寸／RIFF…WEBP VP8X／JPEG SOI＋APP0）＋亂數填充」產生，
//   四種格式輪替；offset 64 起寫入 ASCII 標記（tag｜輪次｜傳送者｜序號，每輪重寫）讓收件者辨識是哪一張；
//   長度 = MAX_IMAGE_BYTES − 1024 − 序號×13（每張長度不同、都接近上限）。檔頭之後不是可解碼的影像。
// 流程：CLIENTS 人加入（房間 idle、無回合，避開「作畫中畫師不能傳圖」）→ 前 SENDERS 人為傳送者、最後 SLOW 人為慢客戶端
//   → 每輪：各傳送者送 IMAGES 張（下一張在上一張 ack 收到後再等 IMAGE_MIN_INTERVAL_MS + 150 ms）
//     → 等所有人收齊（慢客戶端含 data: null 的略過通知；或被斷線）→ 等 5 秒 → 強制 GC 量 arrayBuffers → 下一輪
//   → 全部斷線。
// 慢客戶端：以 ws 公開 API `pause()`／`resume()` 做令牌桶節流（每 50 ms 補額度，底層 net.Socket 的 data 事件扣額度，
//   超額就 pause）。暫停期間 TCP 接收視窗塞滿，server 端的待送資料留在 server 的 socket 寫入佇列 —— 等同真實的慢網路。
//   不用「事件處理中同步忙等」：30 個客戶端共用本程序的事件迴圈，忙等會連正常客戶端一起卡住，量不出 server 端的影響。
//   略過通知 { id, data: null } 沒有 bytes 可讀標記，以 id 對照傳送者 ack 回的 id 辨識。
// 延遲：同一台機器同一個 Node 程序，以 performance.now() 對照「傳送者 emit 前」與「收件者 chat:image 事件」（只計帶 bytes 的）。
//   含上傳 10 MB、server 轉發、30 個收件者在本程序依序解碼的排隊時間，偏保守。
// 上一次執行的玩家會在 15 秒寬限期內占名額，腳本開頭會等房間清空（最多 25 秒）。
// 全部 PASS 時 exit 0，否則 exit 1（INFO 列不計入）。
// 龍骨（Keel）子代理 2026-09-25 Epic 2 Phase 3 圖片壓測用；同日加慢連線保護判定與 ROUNDS／CDP 記憶體量測。
import { io } from 'socket.io-client';
import { execFile } from 'node:child_process';
import { randomFillSync } from 'node:crypto';
import { crc32 } from 'node:zlib';

const PORT = process.env.TEST_PORT ?? '3195';
const HOST = process.env.HOST ?? '127.0.0.1';
const CLIENTS = Number(process.env.CLIENTS ?? 30);
const IMAGES = Number(process.env.IMAGES ?? 5);
const SENDERS = Number(process.env.SENDERS ?? 1);
const ROUNDS = Number(process.env.ROUNDS ?? 1);
const SLOW = Number(process.env.SLOW ?? 1);
const SLOW_KBPS = Number(process.env.SLOW_KBPS ?? 2048);
const SERVER_PID = process.env.SERVER_PID ?? '';
const INSPECT_PORT = process.env.INSPECT_PORT ?? '';
const RSS_TRACE = process.env.RSS_TRACE === '1';
const SERVER_URL = `http://${HOST}:${PORT}/draw-guess`;

// spec §4 常數（只依 spec，不 import 實作）
const MAX_PLAYERS = 50;
const MAX_IMAGE_BYTES = 10_485_760;
const IMAGE_MIN_INTERVAL_MS = 3000;
const IMAGE_SKIP_BUFFER_BYTES = 2 * MAX_IMAGE_BYTES + 2 * 1024 * 1024; // 僅供輸出說明
const IMAGE_GAP_MS = IMAGE_MIN_INTERVAL_MS + 150; // 從上一張 ack 起算，多留 150 ms
const IMG_W = 1280, IMG_H = 720;
const MIMES = ['image/png', 'image/gif', 'image/webp', 'image/jpeg'];
const TAG_OFF = 64, TAG_LEN = 64;
const RSS_STEP_MS = 200;
const RSS_GROWTH_LIMIT = 1.1;             // 最後一輪峰值 ≤ 第 1 輪峰值 × 1.1
const ARRAY_BUFFERS_LIMIT = 5 * 1024 * 1024; // 強制 GC 後 arrayBuffers < 5 MB
const SETTLE_MS = 5000;                   // 每輪收齊後等待再量 GC
const THROTTLE_TICK_MS = 50;

const R = [];
const check = (name, cond, extra = '') => { R.push([cond ? 'PASS' : 'FAIL', name, extra]); return cond; };
const info = (name, extra = '') => R.push(['INFO', name, extra]);
const now = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (pred, ms, step = 50) => { const end = now() + ms; while (now() < end) { if (pred()) return true; await sleep(step); } return pred(); };
const pct = (arr, q) => { if (!arr.length) return NaN; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]; };
const fmt = (v) => (Number.isFinite(v) ? v.toFixed(1) : '-');
const maxOf = (a) => (a.length ? a.reduce((m, v) => (v > m ? v : m), -Infinity) : NaN);
const rssKB = () => new Promise((res) => {
  if (!SERVER_PID) { res(null); return; }
  execFile('ps', ['-o', 'rss=', '-p', SERVER_PID], (err, out) => res(err ? null : Number(String(out).trim()) || null));
});
const fmtRss = (kb) => (kb == null ? '-' : `${(kb / 1024).toFixed(1)} MB`);
const fmtMB = (b) => (b == null ? '-' : `${(b / 1048576).toFixed(2)} MB`);

if (!(CLIENTS >= 2 && CLIENTS <= MAX_PLAYERS && SENDERS >= 1 && SLOW >= 0 && SENDERS + SLOW <= CLIENTS && IMAGES >= 1 && ROUNDS >= 1)) {
  console.log(`參數不合法：CLIENTS=${CLIENTS}（2..${MAX_PLAYERS}）SENDERS=${SENDERS}（≥1）SLOW=${SLOW}，SENDERS+SLOW 須 ≤ CLIENTS，IMAGES ≥ 1，ROUNDS ≥ 1`);
  process.exit(1);
}

// ── server 記憶體：經 inspector（CDP，Node 內建 WebSocket）強制 GC 後讀 process.memoryUsage() ──
// server 需以 --expose-gc --inspect=127.0.0.1:<INSPECT_PORT> 啟動；不需要改 server 程式或加 debug 端點。
const GC_EXPR = `(async () => { gc(); await new Promise((r) => setTimeout(r, 200)); gc(); return JSON.stringify(process.memoryUsage()); })()`;
const cdpGcMemory = async () => {
  if (!INSPECT_PORT) return null;
  try {
    const list = await (await fetch(`http://127.0.0.1:${INSPECT_PORT}/json/list`)).json();
    const target = list.find((t) => t.webSocketDebuggerUrl);
    if (!target) return { error: '找不到 inspector target' };
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP 連線失敗')); });
    const reply = await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('CDP 逾時')), 10_000);
      ws.onmessage = (ev) => { const m = JSON.parse(String(ev.data)); if (m.id === 1) { clearTimeout(t); res(m); } };
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: GC_EXPR, awaitPromise: true, returnByValue: true } }));
    });
    ws.close();
    const r = reply.result?.result;
    if (reply.result?.exceptionDetails || r?.type !== 'string') {
      return { error: `evaluate 失敗（server 是否以 --expose-gc 啟動？）：${JSON.stringify(reply.result?.exceptionDetails?.exception?.description ?? r).slice(0, 160)}` };
    }
    return JSON.parse(r.value);
  } catch (e) {
    return { error: String(e) };
  }
};

// ── 產生測試圖片：合法檔頭 + 亂數填充 + 標記（標記每輪重寫） ──
const tag = Math.random().toString(36).slice(2, 6);
const u32be = (b, off, v) => b.writeUInt32BE(v >>> 0, off);
const writeHeader = (buf, mime, len) => {
  if (mime === 'image/png') {
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
    u32be(buf, 8, 13); buf.write('IHDR', 12, 'latin1');
    u32be(buf, 16, IMG_W); u32be(buf, 20, IMG_H);
    buf[24] = 8; buf[25] = 6; buf[26] = 0; buf[27] = 0; buf[28] = 0; // 8-bit RGBA
    u32be(buf, 29, crc32(buf.subarray(12, 29)));
  } else if (mime === 'image/gif') {
    buf.write('GIF89a', 0, 'latin1'); buf.writeUInt16LE(IMG_W, 6); buf.writeUInt16LE(IMG_H, 8);
  } else if (mime === 'image/webp') {
    buf.write('RIFF', 0, 'latin1'); buf.writeUInt32LE(len - 8, 4); buf.write('WEBP', 8, 'latin1');
    buf.write('VP8X', 12, 'latin1'); buf.writeUInt32LE(10, 16);
    buf.writeUIntLE(IMG_W - 1, 24, 3); buf.writeUIntLE(IMG_H - 1, 27, 3);
  } else {
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).copy(buf, 0); buf.write('JFIF\0', 6, 'latin1');
  }
};
const imageList = []; // { si, k, mime, len, ab, buf, key, sentT, ackAt, ack, id }（每輪重設 key 與送出紀錄）
for (let si = 0; si < SENDERS; si++) {
  for (let k = 0; k < IMAGES; k++) {
    const n = si * IMAGES + k;
    const mime = MIMES[n % MIMES.length];
    const len = MAX_IMAGE_BYTES - 1024 - n * 13;
    const ab = new ArrayBuffer(len);
    const buf = Buffer.from(ab);
    randomFillSync(buf);
    writeHeader(buf, mime, len);
    imageList.push({ si, k, mime, len, ab, buf, key: '', sentT: null, ackAt: null, ack: null, id: null });
  }
}
const NIMG = imageList.length;
let images = new Map(); // 本輪 key → image
let imageById = new Map(); // 本輪 ack id → image
const readKey = (buf) => (buf.length >= TAG_OFF + TAG_LEN ? buf.toString('latin1', TAG_OFF, TAG_OFF + TAG_LEN).trimEnd() : '');
const asBuffer = (d) => {
  if (Buffer.isBuffer(d)) return d;
  if (d instanceof ArrayBuffer) return Buffer.from(d);
  if (ArrayBuffer.isView(d)) return Buffer.from(d.buffer, d.byteOffset, d.byteLength);
  return null;
};
const prepareRound = (round) => {
  images = new Map(); imageById = new Map();
  for (const img of imageList) {
    img.key = `${tag}|r${round}|s${img.si}|i${img.k}`;
    img.buf.write(img.key.padEnd(TAG_LEN, ' '), TAG_OFF, 'latin1');
    img.sentT = null; img.ackAt = null; img.ack = null; img.id = null;
    images.set(img.key, img);
  }
};

// ── 連線與客戶端 ──
const connect = () => new Promise((res, rej) => {
  const s = io(SERVER_URL, { path: '/socket.io', transports: ['websocket'], forceNew: true, reconnection: false });
  const t = setTimeout(() => { s.close(); rej(new Error('connect timeout')); }, 5000);
  s.once('connect', () => { clearTimeout(t); res(s); });
  s.once('connect_error', (e) => { clearTimeout(t); s.close(); rej(e); });
});
const call = (s, ev, payload, ms = 5000) => new Promise((res) => s.timeout(ms).emit(ev, payload, (err, r) => res(err ? { ok: false, error: 'TIMEOUT', message: String(err) } : r)));

const makeClient = (nick, i) => ({
  nick, i, id: null, s: null, snap: null, slow: false,
  log: [],          // 本輪收到的事件（依序）：{ ev, id?, kind?, bytes? }
  got: new Map(),   // 本輪 key → { t, id, len, metaBytes, orderOk, bytesOk }（帶 bytes 的）
  nulls: new Map(), // 本輪 id → { t, orderOk }（data: null 的略過通知）
  badNull: 0,       // data 既非二進位也非 null
  unknown: 0,       // 標記辨識不到的 chat:image
  disc: null,       // { t, reason }
  rawBytes: 0,      // 慢客戶端：底層實際讀到的位元組（累計）
});
const received = (c) => c.got.size + c.nulls.size;
const attach = (c, s) => {
  c.s = s;
  s.onAny((ev, p) => {
    if (ev === 'chat:image') {
      const t = now();
      const prev = c.log.at(-1);
      const orderOk = !!prev && prev.ev === 'chat:message' && prev.kind === 'image' && prev.id === p?.id;
      c.log.push({ ev, id: p?.id });
      if (p?.data === null) { c.nulls.set(p.id, { t, orderOk }); return; }
      const buf = asBuffer(p?.data);
      if (!buf) { c.badNull++; return; }
      const img = images.get(readKey(buf));
      if (!img) { c.unknown++; return; }
      const metaBytes = prev?.ev === 'chat:message' ? prev.bytes : undefined;
      c.got.set(img.key, { t, id: p.id, len: buf.length, metaBytes, orderOk, bytesOk: buf.length === img.len && buf.equals(img.buf) });
      return; // 不保留 buf：驗完即釋放
    }
    if (ev === 'chat:message') c.log.push({ ev, id: p?.id, kind: p?.kind, bytes: p?.image?.bytes });
    else c.log.push({ ev });
  });
  s.on('disconnect', (reason) => { if (!c.disc) c.disc = { t: now(), reason }; });
};
const join = async (c) => {
  let s;
  try { s = await connect(); } catch (e) { return { ok: false, error: 'CONNECT', message: String(e) }; }
  attach(c, s);
  const r = await call(s, 'player:join', { nickname: c.nick });
  if (r.ok) { c.id = r.data.snapshot.you; c.snap = r.data.snapshot; } else { s.disconnect(); c.disc = null; }
  return r;
};
// 2026-11-10 Epic 21（spec §9.1）：已綁定 socket 的重複 join 有 1 秒節流 → RATE_LIMITED 時等滿 1 秒重試（最多 3 次）
const freshSnapshot = async (c) => {
  for (let i = 0; i < 3; i++) {
    const r = await call(c.s, 'player:join', { nickname: c.nick });
    if (r.ok) return r.data.snapshot;
    if (r.error !== 'RATE_LIMITED') return null;
    await sleep(1050);
  }
  return null;
};

// 慢客戶端：ws 的 pause()/resume() 令牌桶節流（見檔頭說明）
const throttle = (c, kbps) => {
  const ws = c.s.io.engine.transport.ws;
  const sock = ws?._socket;
  if (!ws || !sock || typeof ws.pause !== 'function') return false;
  const perTick = (kbps * 1024 * THROTTLE_TICK_MS) / 1000;
  let budget = perTick;
  sock.prependListener('data', (chunk) => {
    c.rawBytes += chunk.length;
    budget -= chunk.length;
    if (budget <= 0 && !ws.isPaused) ws.pause();
  });
  c.throttleTimer = setInterval(() => {
    budget = Math.min(budget + perTick, perTick);
    if (budget > 0 && ws.isPaused && ws.readyState === 1) ws.resume();
  }, THROTTLE_TICK_MS);
  c.slow = true;
  return true;
};

// ── 開始 ──
const t0 = now();
const rssPre = await rssKB();
console.log(`圖片壓測 ${SERVER_URL}  CLIENTS=${CLIENTS} IMAGES=${IMAGES} SENDERS=${SENDERS} ROUNDS=${ROUNDS} SLOW=${SLOW}${SLOW ? `（${SLOW_KBPS} KiB/s）` : ''} tag=${tag}${SERVER_PID ? ` SERVER_PID=${SERVER_PID}` : ''}${INSPECT_PORT ? ` INSPECT_PORT=${INSPECT_PORT}` : ''}`);
console.log(`測試圖片每輪 ${NIMG} 張，長度 ${Math.min(...imageList.map((m) => m.len))}..${Math.max(...imageList.map((m) => m.len))} bytes（MAX_IMAGE_BYTES=${MAX_IMAGE_BYTES}）`);

// 1. 先加入第一人，等房間清空（上一次執行的玩家可能仍在 15 秒寬限期）
const all = Array.from({ length: CLIENTS }, (_, i) => makeClient(`${tag}-${i}`, i));
const first = all[0];
let r0 = await join(first);
for (let tries = 0; !r0.ok && r0.error === 'ROOM_FULL' && tries < 25; tries++) {
  if (tries === 0) console.log('房間已滿（上一次的玩家仍在寬限期），每秒重試…');
  await sleep(1000); r0 = await join(first);
}
if (!r0.ok) { console.log(`第一位玩家加入失敗：${JSON.stringify(r0)}`); process.exit(1); }
let clean = false;
for (let i = 0; i < 25 && !clean; i++) {
  const snap = await freshSnapshot(first);
  clean = snap && snap.players.length === 1 && snap.round.phase === 'idle';
  if (!clean) { if (i === 0) console.log(`等待房間清空：目前 ${snap?.players.length} 人、phase=${snap?.round.phase}…`); await sleep(1000); }
}
if (!check('房間乾淨（只有本腳本、phase idle）', clean)) { console.log(R.map((r) => r.join('  ')).join('\n')); process.exit(1); }

// 2. 其餘玩家並行加入
const tj = now();
const rest = all.slice(1);
const joinRes = await Promise.all(rest.map((c) => join(c)));
const joinMs = now() - tj;
if (!check(`${CLIENTS} 人並行加入全部成功`, joinRes.every((r) => r.ok), `${joinMs.toFixed(0)} ms；失敗：${JSON.stringify(joinRes.filter((r) => !r.ok).slice(0, 2))}`)) {
  console.log(R.map((r) => r.join('  ')).join('\n')); for (const c of all) c.s?.disconnect(); setTimeout(() => process.exit(1), 100);
} else {
  await run();
}

async function run() {
  const snapAll = await freshSnapshot(first);
  check('server 快照：人數 = CLIENTS、phase idle（無回合，傳送者不受畫師限制）', snapAll?.players.length === CLIENTS && snapAll.round.phase === 'idle', `${snapAll?.players.length} 人、phase=${snapAll?.round.phase}`);

  const senders = all.slice(0, SENDERS);
  const slows = all.slice(CLIENTS - SLOW);
  const normals = all.filter((c) => !slows.includes(c));
  const throttled = slows.map((c) => throttle(c, SLOW_KBPS));
  if (SLOW) check(`${SLOW} 位慢客戶端啟用節流（${SLOW_KBPS} KiB/s）`, throttled.every(Boolean));
  await sleep(1000);

  // RSS 取樣（跨所有輪）
  const rssBase = await rssKB();
  const samples = []; // [t, kb]
  let sampling = !!SERVER_PID;
  const sampler = (async () => {
    while (sampling) {
      const t = now();
      const v = await rssKB();
      if (v != null) samples.push([t, v]);
      await sleep(Math.max(0, RSS_STEP_MS - (now() - t)));
    }
  })();
  const memBase = await cdpGcMemory();

  const rounds = []; // 每輪摘要
  const latAll = [];
  for (let round = 1; round <= ROUNDS; round++) {
    prepareRound(round);
    for (const c of all) { c.log.length = 0; c.got = new Map(); c.nulls = new Map(); c.unknown = 0; c.badNull = 0; }
    const rs = { round, tStart: now() };

    // 傳送者各送 IMAGES 張
    await Promise.all(senders.map(async (c, si) => {
      let lastAck = -Infinity;
      for (const img of imageList.filter((m) => m.si === si)) {
        const wait = lastAck + IMAGE_GAP_MS - now();
        if (wait > 0) await sleep(wait);
        if (c.disc) { img.ack = { ok: false, error: 'DISCONNECTED', message: c.disc.reason }; continue; }
        img.sentT = now();
        img.ack = await call(c.s, 'chat:image', { mime: img.mime, width: IMG_W, height: IMG_H, data: img.ab }, 60_000);
        img.ackAt = now();
        lastAck = img.ackAt;
        if (img.ack?.ok) { img.id = img.ack.data?.id; imageById.set(img.id, img); }
      }
    }));
    rs.tSendDone = now();

    // 等收齊：正常客戶端 60 秒；慢客戶端（含略過通知）依速率估算上限（收齊或被斷線）
    const doneOf = (c) => received(c) >= NIMG || !!c.disc;
    rs.normalAll = await waitFor(() => normals.every(doneOf), 60_000, 20);
    const slowBudgetMs = Math.min(300_000, Math.max(60_000, ((NIMG * MAX_IMAGE_BYTES) / (SLOW_KBPS * 1024)) * 1500 + 20_000));
    rs.slowAll = SLOW ? await waitFor(() => slows.every(doneOf), slowBudgetMs, 50) : true;
    rs.tEnd = now();

    // ── 本輪判定 ──
    const L = ROUNDS > 1 ? `第 ${round} 輪：` : '';
    const ackBad = imageList.filter((m) => !m.ack?.ok || typeof m.id !== 'string');
    check(`${L}傳圖 ack 全部 ok（${SENDERS} 人 × ${IMAGES} 張 = ${NIMG}；無 RATE_LIMITED／IMAGE_INVALID）`, ackBad.length === 0, JSON.stringify(ackBad.slice(0, 2).map((m) => [m.key, m.ack])));
    const upMs = imageList.filter((m) => m.ackAt != null).map((m) => m.ackAt - m.sentT);
    info(`${L}傳送者 emit → ack 耗時（上傳 10 MB＋server 驗證）`, `p50=${fmt(pct(upMs, 0.5))} max=${fmt(maxOf(upMs))} ms；傳送階段共 ${((rs.tSendDone - rs.tStart) / 1000).toFixed(1)}s`);

    const cnt = (c, ev) => c.log.filter((e) => e.ev === ev && (ev !== 'chat:message' || e.kind === 'image')).length;
    // 正常客戶端：每張都要收到 bytes（不得被略過）
    const normalSkipped = normals.reduce((n, c) => n + c.nulls.size, 0);
    check(`${L}正常客戶端 0 張被略過（data: null）`, normalSkipped === 0, `被略過 ${normalSkipped} 次、${normals.filter((c) => c.nulls.size > 0).length} 人`);
    const badCount = normals.filter((c) => cnt(c, 'chat:message') !== NIMG || cnt(c, 'chat:image') !== NIMG || c.got.size !== NIMG || c.nulls.size > 0 || c.unknown > 0 || c.badNull > 0);
    check(`${L}正常客戶端 ${normals.length} 人：每人收到 ${NIMG} 則 chat:message(kind image) 與 ${NIMG} 則帶 bytes 的 chat:image、每張恰一次`, badCount.length === 0,
      `${badCount.length} 人不符：` + badCount.slice(0, 6).map((c) => `${c.nick}:msg${cnt(c, 'chat:message')}/img${cnt(c, 'chat:image')}/bytes${c.got.size}/null${c.nulls.size}${c.disc ? `/斷線:${c.disc.reason}` : ''}`).join(' '));
    // 正常客戶端被略過的明細（哪位、哪張）：只有收件者待送量超過 IMAGE_SKIP_BUFFER_BYTES 才會發生，出現即為 FAIL 的診斷資訊
    const normalNulls = normals.flatMap((c) => [...c.nulls.keys()].map((id) => ({ c, img: imageById.get(id) })));
    if (normalNulls.length) {
      const bySender = new Map();
      for (const x of normalNulls) { const k = x.img ? `s${x.img.si}#${x.img.k + 1}` : '?'; bySender.set(k, (bySender.get(k) ?? 0) + 1); }
      const who = new Map();
      for (const x of normalNulls) who.set(x.c.nick, (who.get(x.c.nick) ?? 0) + 1);
      info(`${L}正常客戶端被略過明細`, `共 ${normalNulls.length} 次、${who.size} 人（${[...who].map(([n, v]) => `${n}${senders.some((s) => s.nick === n) ? '[傳送者]' : ''}×${v}`).join(' ')}）；依圖片：${[...bySender].map(([k, v]) => `${k}×${v}`).join(' ')}`);
    }
    const recs = normals.flatMap((c) => [...c.got.entries()].map(([key, g]) => ({ c, key, g })));
    const badOrder = recs.filter((x) => !x.g.orderOk);
    check(`${L}正常客戶端：chat:image 緊接在同 id 的 chat:message(kind image) 之後`, recs.length > 0 && badOrder.length === 0, `${badOrder.length}/${recs.length} 不符`);
    const badId = recs.filter((x) => x.g.id !== images.get(x.key).id);
    const badLen = recs.filter((x) => !(x.g.len === x.g.metaBytes && x.g.len === images.get(x.key).len));
    check(`${L}正常客戶端：id = ack id、data 長度 = meta.bytes = 送出長度`, recs.length > 0 && badId.length === 0 && badLen.length === 0, `id 不符 ${badId.length}、長度不符 ${badLen.length}（共 ${recs.length}）`);
    const badBytes = recs.filter((x) => !x.g.bytesOk);
    check(`${L}正常客戶端：位元組內容與送出完全相同（Buffer.equals 逐位元組）`, recs.length > 0 && badBytes.length === 0, `${recs.length - badBytes.length}/${recs.length} 張一致`);
    check(`${L}正常客戶端 60 秒內全部收齊且無人斷線`, rs.normalAll && normals.every((c) => !c.disc), normals.filter((c) => c.disc).map((c) => `${c.nick}:${c.disc.reason}`).join(' '));
    const selfBad = senders.filter((c, si) => imageList.filter((m) => m.si === si).some((m) => !c.got.get(m.key)?.bytesOk));
    check(`${L}傳送者本人也收到自己的 ${IMAGES} 張（位元組一致）`, selfBad.length === 0, selfBad.map((c) => c.nick).join(' '));
    rs.lat = recs.map((x) => x.g.t - images.get(x.key).sentT);
    latAll.push(...rs.lat);
    rs.normalRecv = recs.length;

    // 慢客戶端：data: null 合法（記略過張數）；不得斷線；收到的非 null 位元組一致；順序正確
    rs.slow = [];
    if (SLOW) {
      for (const c of slows) {
        const nullIds = [...c.nulls.keys()];
        const nullUnknown = nullIds.filter((id) => !imageById.has(id));
        const bytesRecs = [...c.got.entries()].map(([key, g]) => ({ key, g }));
        const coveredKeys = new Set([...bytesRecs.map((x) => x.key), ...nullIds.filter((id) => imageById.has(id)).map((id) => imageById.get(id).key)]);
        const orderBad = bytesRecs.filter((x) => !x.g.orderOk).length + [...c.nulls.values()].filter((n) => !n.orderOk).length;
        const bytesBad = bytesRecs.filter((x) => !(x.g.bytesOk && x.g.len === x.g.metaBytes && x.g.id === images.get(x.key).id)).length;
        rs.slow.push({ nick: c.nick, bytes: bytesRecs.length, skipped: nullIds.length, disc: c.disc, covered: coveredKeys.size,
          lat: bytesRecs.map((x) => x.g.t - images.get(x.key).sentT) });
        check(`${L}慢客戶端 ${c.nick} 未被斷線`, !c.disc, c.disc ? `傳送開始後 ${((c.disc.t - rs.tStart) / 1000).toFixed(1)}s 斷線（${c.disc.reason}）` : '');
        check(`${L}慢客戶端 ${c.nick}：${NIMG} 張每張恰一次（bytes 或 data: null）、順序正確、收到的 bytes 與送出一致`,
          coveredKeys.size === NIMG && received(c) === NIMG && cnt(c, 'chat:image') === NIMG && nullUnknown.length === 0 && c.unknown === 0 && c.badNull === 0 && orderBad === 0 && bytesBad === 0,
          `bytes ${bytesRecs.length} 張（不一致 ${bytesBad}）、略過 ${nullIds.length} 張（id 對不上 ${nullUnknown.length}）、順序不符 ${orderBad}、涵蓋 ${coveredKeys.size}/${NIMG}`);
        info(`${L}慢客戶端 ${c.nick}：略過（data: null）張數`, `${nullIds.length}/${NIMG}（待送量 > ${(IMAGE_SKIP_BUFFER_BYTES / 1048576).toFixed(0)} MiB 才略過；可能為 0）`);
      }
    }

    // 等 SETTLE_MS 後強制 GC 量記憶體
    await sleep(Math.max(0, rs.tEnd + SETTLE_MS - now()));
    rs.mem = await cdpGcMemory();
    rs.tMem = now();
    rounds.push(rs);
    console.log(`第 ${round}/${ROUNDS} 輪完成：正常收 ${rs.normalRecv} 張、慢客戶端略過 ${rs.slow.map((x) => x.skipped).join('/') || '-'}、GC 後 arrayBuffers ${fmtMB(rs.mem?.arrayBuffers)}（${((now() - t0) / 1000).toFixed(0)}s）`);
  }
  for (const c of slows) clearInterval(c.throttleTimer);
  const rssEnd = await rssKB();
  sampling = false; await sampler;

  // ── 記憶體判定 ──
  if (SERVER_PID) {
    for (const rs of rounds) {
      const win = samples.filter(([t]) => t >= rs.tStart && t <= rs.tMem).map(([, kb]) => kb);
      rs.peakKB = win.length ? maxOf(win) : null;
    }
    const p1 = rounds[0].peakKB, pN = rounds.at(-1).peakKB;
    const ratioText = `各輪峰值 ${rounds.map((r) => fmtRss(r.peakKB)).join(' / ')}；比值 ${p1 && pN ? (pN / p1).toFixed(3) : '-'}（門檻 ${RSS_GROWTH_LIMIT}）`;
    if (ROUNDS >= 2 && SENDERS > 1) {
      info(`server RSS：第 ${ROUNDS} 輪峰值／第 1 輪峰值（SENDERS>1 不判定，malloc 波動）`, ratioText);
    } else if (ROUNDS >= 2) {
      check(`server RSS：第 ${ROUNDS} 輪峰值 ≤ 第 1 輪峰值 × ${RSS_GROWTH_LIMIT}`, p1 != null && pN != null && pN <= p1 * RSS_GROWTH_LIMIT, ratioText);
    } else info('server RSS 峰值', `${fmtRss(p1)}（ROUNDS=1，不判定跨輪成長）`);
    info('server RSS', `加入前 ${fmtRss(rssPre)}；${CLIENTS} 人在線、傳送前 ${fmtRss(rssBase)}；結束時 ${fmtRss(rssEnd)}（ps RSS 在 macOS 不回落屬 malloc 行為，不作判定）`);
  } else info('server RSS', '未給 SERVER_PID，略過');
  if (INSPECT_PORT) {
    const bad = rounds.filter((r) => !(r.mem && typeof r.mem.arrayBuffers === 'number' && r.mem.arrayBuffers < ARRAY_BUFFERS_LIMIT));
    check(`server 強制 GC 後 process.memoryUsage().arrayBuffers < 5 MB（每輪收齊 ${SETTLE_MS / 1000} 秒後量）`, bad.length === 0,
      `傳送前 ${fmtMB(memBase?.arrayBuffers)}；各輪 ${rounds.map((r) => (r.mem?.error ? `錯誤:${r.mem.error}` : fmtMB(r.mem?.arrayBuffers))).join(' / ')}`);
    info('server GC 後 heapUsed／external／rss（process.memoryUsage）', rounds.map((r) => `第${r.round}輪 ${fmtMB(r.mem?.heapUsed)}／${fmtMB(r.mem?.external)}／${fmtMB(r.mem?.rss)}`).join('；'));
  } else info('server GC 後 arrayBuffers', '未給 INSPECT_PORT（server 需 --expose-gc --inspect），略過');

  // ── 輸出 ──
  console.log(R.map((r) => r.join('  ')).join('\n'));
  console.log('\n收圖延遲（ms，傳送者 emit 前 → 收件者帶 bytes 的 chat:image 事件；同機同程序）');
  console.log('輪次/對象                收件數    p50      p95      max');
  const row = (label, a) => console.log(`${label.padEnd(22)} ${String(a.length).padStart(6)}  ${fmt(pct(a, 0.5)).padStart(7)}  ${fmt(pct(a, 0.95)).padStart(7)}  ${fmt(maxOf(a)).padStart(7)}`);
  for (const rs of rounds) {
    row(`第 ${rs.round} 輪 正常客戶端`, rs.lat);
    for (const s of rs.slow) row(`第 ${rs.round} 輪 慢 ${s.nick}`, s.lat);
  }
  row('全部輪 正常客戶端', latAll);
  if (SLOW) {
    console.log('\n慢客戶端（每輪）：');
    for (const rs of rounds) for (const s of rs.slow) console.log(`  第 ${rs.round} 輪 ${s.nick}：收 bytes ${s.bytes} 張、略過（data: null）${s.skipped} 張、${s.disc ? `斷線（${s.disc.reason}）` : '未斷線'}`);
    for (const c of slows) {
      const secs = ((c.disc?.t ?? rounds.at(-1).tEnd) - rounds[0].tStart) / 1000;
      console.log(`  ${c.nick} 底層共讀 ${(c.rawBytes / 1048576).toFixed(1)} MiB／${secs.toFixed(1)}s（平均 ${(c.rawBytes / 1024 / Math.max(0.001, secs)).toFixed(0)} KiB/s，含等待時段）`);
    }
  }
  if (SERVER_PID) {
    console.log(`\nserver RSS 峰值（ps，每輪傳送開始 → GC 量測）：${rounds.map((r) => `第${r.round}輪 ${fmtRss(r.peakKB)}`).join('、')}${ROUNDS >= 2 ? `；第 ${ROUNDS}／第 1 輪 = ${(rounds.at(-1).peakKB / rounds[0].peakKB).toFixed(3)}` : ''}`);
    if (RSS_TRACE) console.log(`RSS 時間序列（第 1 輪開始後秒數=MB）：${samples.filter((_, i) => i % 5 === 0).map(([t, kb]) => `${((t - rounds[0].tStart) / 1000).toFixed(1)}s=${(kb / 1024).toFixed(0)}`).join(' ')}`);
  }
  if (INSPECT_PORT) console.log(`server 強制 GC 後 arrayBuffers：傳送前 ${fmtMB(memBase?.arrayBuffers)}；${rounds.map((r) => `第${r.round}輪 ${fmtMB(r.mem?.arrayBuffers)}`).join('、')}`);
  console.log(`\n摘要：${ROUNDS} 輪 × 正常客戶端 ${normals.length} 人、慢客戶端 ${SLOW} 人、傳送者 ${SENDERS} 人 × ${IMAGES} 張；正常收圖 p50 ${fmt(pct(latAll, 0.5))} / p95 ${fmt(pct(latAll, 0.95))} / max ${fmt(maxOf(latAll))} ms；總耗時 ${((now() - t0) / 1000).toFixed(1)}s`);

  for (const c of all) c.s?.disconnect();
  const fails = R.filter((r) => r[0] === 'FAIL').length;
  const passes = R.filter((r) => r[0] === 'PASS').length;
  console.log(`\n${passes}/${passes + fails} passed`);
  setTimeout(() => process.exit(fails ? 1 : 0), 100);
}
