// 我畫你猜壓測（Phase 5）：30 客戶端同時在線不掉訊息、筆跡／聊天延遲、中途加入、F5 重連、人數上限
// 只依 spec/architecture.md §4/§5 打 Socket，不看實作。
// 用法（專案根目錄，需先 npm run build；請用隔離埠加 HOST=127.0.0.1，桌面 app 的瀏覽器窗格會自動重連 7180）：
//   PORT=3180 HOST=127.0.0.1 node server/dist/index.js > /tmp/…/server.log 2>&1 &   # 記下 $!（node 本身的 pid）
//   TEST_PORT=3180 SERVER_PID=<pid> node user/protocol/draw-guess-load.mjs
// 環境變數：TEST_PORT（預設 3180）、HOST（目標主機，預設 127.0.0.1）、CLIENTS（預設 30）、ROUNDS（預設 1）、
//          SERVER_PID（選填；有給就在壓測前／作畫後／結束時印 server 的 RSS）。
// 流程（每回合）：畫師以約 60 次/秒送 move（每則 4–8 點）連畫 10 秒，含多筆 begin/end、一次 undo、一次 clear；
//   猜題者途中聊天（每人間隔 ≥ 450 ms，遵守 CHAT_MIN_INTERVAL_MS）、約三分之一提早猜對；
//   第 1 回合另測：第 CLIENTS+1 人作畫中加入（快照重播＋增量）、一名已猜對者斷線 1 秒後帶 token 重連（F5）；
//   作畫結束後以「同 socket 重複 join」取 server 快照比對所有人的筆跡；其餘人同時猜對 → 全員猜對 → 揭曉 → 5 秒後 idle。
// 延遲：同一台機器同一個 Node 程序，以 performance.now() 對照「畫師送出」與「各收件者收到」；
//   op 無時間戳欄位，以「收到的第 i 則 = 送出的第 i 則」對齊（先驗證順序與內容完全一致）。
//   30 個客戶端共用本程序的事件迴圈，量到的數字含客戶端解碼排隊，偏保守（實機各自一台會更低）。
// 每回合約 17 秒（含真實 5 秒揭曉停留）。上一輪的玩家會在 15 秒寬限期內占名額，腳本開頭會等房間清空（最多 25 秒）。
// 全部 PASS 時 exit 0，否則 exit 1。
// 龍骨（Keel）子代理 2026-09-24 Phase 5 壓測用。
import { io } from 'socket.io-client';
import { execFileSync } from 'node:child_process';

const PORT = process.env.TEST_PORT ?? '3180';
const HOST = process.env.HOST ?? '127.0.0.1';
const CLIENTS = Number(process.env.CLIENTS ?? 30);
const ROUNDS = Number(process.env.ROUNDS ?? 1);
const SERVER_PID = process.env.SERVER_PID ?? '';
const URL = `http://${HOST}:${PORT}/draw-guess`;

// spec §4 常數（只依 spec，不 import 實作）
const MAX_PLAYERS = 50;
// 筆跡固定 color '#FFFFFF'、size 4：同時符合 Phase 6 前（PALETTE 白名單、BRUSH_SIZES 四段）與 Phase 6 後（任意 #RRGGBB、整數 1..64）的驗證
const COLOR = '#FFFFFF';
const SIZE = 4;
const CHAT_GAP_MS = 450; // CHAT_MIN_INTERVAL_MS = 300，多留 150 ms 餘裕吸收傳輸抖動
const LATENCY_TARGET_MS = 100; // overview 非功能需求：區網筆跡同步 < 100 ms

const DRAW_MS = 10_000;
const MIDJOIN_AT = 2500, UNDO_AFTER = 4000, F5_OFF_AT = 5000, F5_ON_AT = 6000, CLEAR_AFTER = 6500;
const TOPICS = ['長頸鹿', '熱氣球', '仙人掌', '潛水艇'];

const R = [];
const check = (name, cond, extra = '') => { R.push([cond ? 'PASS' : 'FAIL', name, extra]); return cond; };
const skip = (name, why) => R.push(['SKIP', name, why]);
const now = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (n) => Math.floor(Math.random() * n);
const r4 = (v) => Math.round(v * 10000) / 10000;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const canon = (v) => JSON.stringify(v, (_k, val) => (val && typeof val === 'object' && !Array.isArray(val)
  ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  : val));
const waitFor = async (pred, ms, step = 50) => { const end = now() + ms; while (now() < end) { if (pred()) return true; await sleep(step); } return pred(); };
const pct = (arr, q) => { if (!arr.length) return NaN; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]; };
const fmt = (v) => (Number.isFinite(v) ? v.toFixed(1) : '-');
const rssKB = () => { if (!SERVER_PID) return null; try { return Number(execFileSync('ps', ['-o', 'rss=', '-p', SERVER_PID]).toString().trim()); } catch { return null; } };
const fmtRss = (kb) => (kb == null ? '-' : `${(kb / 1024).toFixed(1)} MB`);

// 筆跡歷史正規化（spec §5）：ops 只留 begin/move/end；undo 移除該 strokeId 所有 op；clear 清空
const normalize = (list) => {
  let out = [];
  for (const op of list) {
    if (op.type === 'clear') out = [];
    else if (op.type === 'undo') out = out.filter((o) => o.strokeId !== op.strokeId);
    else out.push(op);
  }
  return out;
};

const connect = () => new Promise((res, rej) => {
  const s = io(URL, { path: '/socket.io', transports: ['websocket'], forceNew: true, reconnection: false });
  const t = setTimeout(() => { s.close(); rej(new Error('connect timeout')); }, 5000);
  s.once('connect', () => { clearTimeout(t); res(s); });
  s.once('connect_error', (e) => { clearTimeout(t); s.close(); rej(e); });
});
const call = (s, ev, ...args) => new Promise((res) => s.timeout(5000).emit(ev, ...args, (err, r) => res(err ? { ok: false, error: 'TIMEOUT', message: String(err) } : r)));

// ── 客戶端包裝：每個 socket 的收件紀錄（F5 換 socket 時沿用同一組陣列） ──
const makeClient = (nick) => ({ nick, id: null, token: null, s: null, snap: null, ops: [], opT: [], chat: [], chatT: [], rounds: [], players: [], lastSent: -Infinity });
const attach = (c, s) => {
  c.s = s;
  s.on('draw:op', (op) => { c.opT.push(now()); c.ops.push(op); });
  s.on('chat:message', (m) => { c.chatT.push(now()); c.chat.push(m); });
  s.on('round:update', (r) => c.rounds.push(r));
  s.on('players:update', (p) => c.players.push(p));
};
const resetLogs = (c) => { for (const k of ['ops', 'opT', 'chat', 'chatT', 'rounds', 'players']) c[k].length = 0; };
const join = async (c, extra = {}) => {
  let s;
  try { s = await connect(); } catch (e) { return { ok: false, error: 'CONNECT', message: String(e) }; }
  attach(c, s);
  const r = await call(s, 'player:join', { nickname: c.nick, ...extra });
  if (r.ok) { c.id = r.data.snapshot.you; c.token = r.data.token; c.snap = r.data.snapshot; } else s.disconnect();
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

// 送聊天：同一人兩則之間至少 CHAT_GAP_MS
const chatSent = new Map(); // text → 送出時間
const chatAcks = [];
const say = async (c, text, kind) => {
  const wait = c.lastSent + CHAT_GAP_MS - now();
  if (wait > 0) await sleep(wait);
  const t = now();
  c.lastSent = t;
  if (kind === 'chat') chatSent.set(text, t);
  const r = await call(c.s, 'chat:send', { text });
  chatAcks.push({ nick: c.nick, text, kind, r });
  return r;
};

// ── 開始 ──
const tag = Math.random().toString(36).slice(2, 6);
const t0 = now();
const rss0 = rssKB();
console.log(`壓測 ${URL}  CLIENTS=${CLIENTS} ROUNDS=${ROUNDS} tag=${tag}${SERVER_PID ? ` SERVER_PID=${SERVER_PID}` : ''}`);

// 1. 先加入第一人，等房間清空（上一輪玩家可能仍在 15 秒寬限期）
const all = Array.from({ length: CLIENTS }, (_, i) => makeClient(`${tag}-${i}`));
const first = all[0];
let r0 = await join(first);
for (let tries = 0; !r0.ok && r0.error === 'ROOM_FULL' && tries < 25; tries++) {
  if (tries === 0) console.log('房間已滿（上一輪玩家仍在寬限期），每秒重試…');
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

// 2. 其餘玩家加入：上限內並行加入，超過上限的依序加入（應 ROOM_FULL）
const tj = now();
const inCap = all.slice(1, MAX_PLAYERS), overCap = all.slice(MAX_PLAYERS);
const capRes = await Promise.all(inCap.map((c) => join(c)));
const joinMs = now() - tj;
const overRes = [];
for (const c of overCap) overRes.push(await join(c));
const active = [first, ...inCap.filter((_, i) => capRes[i].ok)];
check(`${Math.min(CLIENTS, MAX_PLAYERS)} 人並行加入全部成功`, capRes.every((r) => r.ok), `${joinMs.toFixed(0)} ms；失敗：${JSON.stringify(capRes.filter((r) => !r.ok).slice(0, 2))}`);
if (overCap.length) {
  check(`第 ${MAX_PLAYERS + 1} 人起加入 → ROOM_FULL（${overCap.length} 人）`, overRes.every((r) => !r.ok && r.error === 'ROOM_FULL' && typeof r.message === 'string' && r.message.length > 0), JSON.stringify(overRes[0]));
}
await waitFor(() => active.every((c) => Math.max(c.players.at(-1)?.length ?? 0, c.snap.players.length) === active.length), 3000);
const snapAll = await freshSnapshot(first);
check('server 快照人數 = 已加入人數', snapAll?.players.length === active.length && snapAll.players.every((p) => p.connected), `${snapAll?.players.length} vs ${active.length}`);
await sleep(200);

const metrics = [];
const opLatAll = [], chatLatAll = [];
let lateClient = null;
let lateJoinRes = null;
let rssPeak = null;

for (let round = 1; round <= ROUNDS; round++) {
  const drawer = active[(round - 1) % active.length];
  const topic = TOPICS[(round - 1) % TOPICS.length];
  const others = () => active.filter((c) => c !== drawer);
  const P = `R${round} `;
  chatSent.clear();
  chatAcks.length = 0;
  for (const c of active) resetLogs(c);
  const pre = await freshSnapshot(drawer);
  const baseScore = new Map(pre.players.map((p) => [p.id, p.score]));

  // 第 1 回合的特殊角色：F5 = 第一位猜題者（提早猜對）；中途加入者 = 第 CLIENTS+1 人
  const f5 = round === 1 ? others()[0] : null;
  const f5State = {};
  const midJoin = round === 1;

  // 出題
  const rv = await call(drawer.s, 'round:volunteer');
  const rt = await call(drawer.s, 'round:setTopic', { topic });
  if (!check(`${P}volunteer + setTopic ok`, rv.ok && rt.ok, JSON.stringify([rv, rt]))) break;
  await waitFor(() => others().every((c) => c.rounds.some((r) => r.phase === 'drawing')), 3000);

  // 畫師：每 16 ms 一步，begin → 15–40 則 move → end；時間到了把當前這筆畫完才停
  const sent = [], sentT = [];
  const tDraw = now();
  const drawDone = new Promise((resolve) => {
    let n = 0, open = null, movesLeft = 0, x = 0.5, y = 0.5, lastEnded = null, didUndo = false, didClear = false;
    const emit = (op) => { sentT.push(now()); sent.push(op); drawer.s.emit('draw:op', op); };
    const timer = setInterval(() => {
      const el = now() - tDraw;
      if (!open) {
        if (el >= DRAW_MS) { clearInterval(timer); resolve(); return; }
        if (!didUndo && el >= UNDO_AFTER && lastEnded) { emit({ type: 'undo', strokeId: lastEnded }); didUndo = true; return; }
        if (!didClear && el >= CLEAR_AFTER) { emit({ type: 'clear' }); didClear = true; return; }
        open = `${tag}-r${round}-s${++n}`; movesLeft = 15 + rand(26); x = r4(0.1 + Math.random() * 0.8); y = r4(0.1 + Math.random() * 0.8);
        emit({ type: 'begin', strokeId: open, tool: n % 7 === 0 ? 'eraser' : 'pen', color: COLOR, size: SIZE, point: { x, y } });
        return;
      }
      if (movesLeft-- > 0) {
        const points = [];
        for (let k = 4 + rand(5); k > 0; k--) { x = r4(clamp01(x + (Math.random() - 0.5) * 0.02)); y = r4(clamp01(y + (Math.random() - 0.5) * 0.02)); points.push({ x, y }); }
        emit({ type: 'move', strokeId: open, points });
      } else { emit({ type: 'end', strokeId: open }); lastEnded = open; open = null; }
    }, 16);
  });

  // 猜題者：每人 2–3 則一般聊天（F5 者不聊，只提早猜對）；約三分之一提早猜對
  const guessers = others();
  const early = new Set(guessers.slice(0, Math.max(1, Math.floor(guessers.length / 3))));
  const chatJobs = guessers.map(async (c, gi) => {
    const plan = [];
    if (c !== f5) for (let k = 2 + rand(2); k > 0; k--) plan.push({ at: 300 + rand(9000), text: `${c.nick} 第${k}句 ${gi}`, kind: 'chat' });
    if (early.has(c)) plan.push({ at: c === f5 ? 800 : 1000 + rand(4000), text: topic, kind: 'guess' });
    plan.sort((a, b) => a.at - b.at);
    for (const p of plan) { const w = tDraw + p.at - now(); if (w > 0) await sleep(w); await say(c, p.text, p.kind); }
  });

  // 中途加入（第 1 回合，t=2.5s）
  const midJob = midJoin ? (async () => {
    await sleep(Math.max(0, tDraw + MIDJOIN_AT - now()));
    lateClient = makeClient(`${tag}-late`);
    const r = await join(lateClient);
    lateJoinRes = r;
    if (r.ok) active.push(lateClient); else lateClient = null;
  })() : Promise.resolve();

  // F5（第 1 回合，t=5s 斷線、t=6s 帶 token 重連）
  const f5Job = f5 ? (async () => {
    await sleep(Math.max(0, tDraw + F5_OFF_AT - now()));
    f5State.before = (await freshSnapshot(f5))?.players.find((p) => p.id === f5.id);
    f5State.id = f5.id; f5State.token = f5.token;
    f5.s.disconnect();
    await sleep(Math.max(0, tDraw + F5_ON_AT - now()));
    f5State.mark = f5.ops.length;
    f5State.res = await join(f5, { token: f5State.token });
  })() : Promise.resolve();

  await drawDone;
  await Promise.all([...chatJobs, midJob, f5Job]);
  await sleep(500);
  const rssNow = rssKB();
  if (rssNow != null) rssPeak = Math.max(rssPeak ?? 0, rssNow);

  // ── 作畫結束：取 server 快照比對 ──
  const probe = guessers.find((c) => c !== f5 && !early.has(c)) ?? guessers[0];
  const serverSnap = await freshSnapshot(probe);
  const serverOps = serverSnap?.ops ?? null;
  const serverCanon = canon(serverOps);
  const moves = sent.filter((o) => o.type === 'move').length;
  const pts = sent.reduce((a, o) => a + (o.points?.length ?? 0), 0);
  check(`${P}畫師送出 ${sent.length} 則 op（${moves} move／${pts} 點／${sent.filter((o) => o.type === 'begin').length} 筆畫，含 undo 與 clear）`, sent.some((o) => o.type === 'undo') && sent.some((o) => o.type === 'clear') && moves >= 300, `${((now() - tDraw) / 1000).toFixed(1)}s`);
  check(`${P}server 快照 ops = 畫師本地正規化`, serverOps !== null && serverCanon === canon(normalize(sent)), `server ${serverOps?.length} vs local ${normalize(sent).length}`);
  check(`${P}畫師自己收不到 draw:op（server 不回音）`, drawer.ops.length === 0, `收到 ${drawer.ops.length}`);

  // 一般收件者：收到 = [server 的 clear] + 畫師送出，數量、順序、內容完全一致
  const special = new Set([f5, lateClient && midJoin ? lateClient : null].filter(Boolean));
  const regular = guessers.filter((c) => !special.has(c));
  const expected = canon([{ type: 'clear' }, ...sent]);
  const badOps = regular.filter((c) => canon(c.ops) !== expected);
  check(`${P}${regular.length} 位猜題者收到的 draw:op 數量、順序、內容 = 1 (server clear) + ${sent.length}`, badOps.length === 0, badOps.slice(0, 3).map((c) => `${c.nick}:${c.ops.length}`).join(' '));
  const badNorm = regular.filter((c) => canon(normalize(c.ops)) !== serverCanon);
  check(`${P}每位猜題者本地正規化 ops = server 快照`, badNorm.length === 0, badNorm.slice(0, 3).map((c) => c.nick).join(' '));
  const opLat = [];
  for (const c of regular) if (canon(c.ops) === expected) for (let i = 1; i < c.ops.length; i++) opLat.push(c.opT[i] - sentT[i - 1]);
  opLatAll.push(...opLat);

  // 中途加入者：快照 = 正規化(送出前綴)、之後增量 = 送出後綴（含 undo／clear），重播後 = server
  const suffixCheck = (label, c, snapOps, incr) => {
    const k = sent.length - incr.length;
    const okSplit = k >= 0 && canon(incr) === canon(sent.slice(k)) && canon(snapOps) === canon(normalize(sent.slice(0, k)));
    const okFinal = canon(normalize([...snapOps, ...incr])) === serverCanon;
    check(`${label}：快照 ops（${snapOps.length}）= 正規化(送出前 ${k} 則)，之後增量 ${incr.length} 則 = 其餘送出`, okSplit, `k=${k}`);
    check(`${label}：快照重播＋增量正規化 = server 快照`, okFinal);
    return k;
  };
  if (midJoin) {
    if (lateClient) {
      const s = lateClient.snap;
      check(`${P}中途加入（第 ${active.length} 人）ok，快照 phase drawing、topic 遮罩、topicLength=${[...topic].length}`, s.round.phase === 'drawing' && s.round.topic === null && s.round.topicLength === [...topic].length, JSON.stringify(s.round).slice(0, 120));
      const k = suffixCheck(`${P}中途加入`, lateClient, s.ops, lateClient.ops);
      check(`${P}中途加入者收到之後的 undo 與 clear`, lateClient.ops.some((o) => o.type === 'undo') && lateClient.ops.some((o) => o.type === 'clear'), `加入時畫師已送 ${k} 則`);
      check(`${P}中途加入者快照帶最近聊天`, Array.isArray(s.chat) && s.chat.length > 0, `${s.chat.length} 則`);
    } else if (all.length >= MAX_PLAYERS) {
      check(`${P}房間已滿，第 ${MAX_PLAYERS + 1} 人中途加入 → ROOM_FULL`, lateJoinRes?.ok === false && lateJoinRes.error === 'ROOM_FULL', JSON.stringify(lateJoinRes));
      skip(`${P}中途加入快照重播`, `房間已滿 ${MAX_PLAYERS} 人，改驗 ROOM_FULL`);
    } else check(`${P}中途加入 ok`, false, JSON.stringify(lateJoinRes));
  }

  // F5：同 id、同 token、分數與已猜對保留；快照＋增量一致；他人看到 connected false → true
  if (f5) {
    const res = f5State.res;
    const me = res?.ok ? res.data.snapshot.players.find((p) => p.id === f5.id) : null;
    check(`${P}F5 重連（斷線 1 秒後帶 token）：同 id、同 token`, res?.ok && res.data.snapshot.you === f5State.id && res.data.token === f5State.token, JSON.stringify(res).slice(0, 120));
    check(`${P}F5 重連後分數與已猜對保留`, me && f5State.before && me.score === f5State.before.score && me.score > 0 && me.hasGuessed === true && me.connected === true, `before=${JSON.stringify(f5State.before)} after=${JSON.stringify(me)}`);
    const seenOff = drawer.players.some((pl) => pl.some((p) => p.id === f5.id && p.connected === false));
    const seenOn = drawer.players.at(-1)?.find((p) => p.id === f5.id)?.connected === true;
    check(`${P}其他人看到 F5 者 connected false → true`, seenOff && seenOn);
    if (res?.ok) suffixCheck(`${P}F5 重連`, f5, res.data.snapshot.ops, f5.ops.slice(f5State.mark));
  }

  // ── 其餘人同時猜對 → 全員猜對 ──
  const guessedIds = new Set(serverSnap?.round.correctIds ?? []);
  const remaining = active.filter((c) => c !== drawer && !guessedIds.has(c.id));
  check(`${P}作畫中提早猜對 ${guessedIds.size} 人（預期 ${early.size}）`, guessedIds.size === early.size);
  const tGuess = now();
  const finalAcks = await Promise.all(remaining.map((c) => say(c, topic, 'guess')));
  check(`${P}其餘 ${remaining.length} 人同時猜對，ack 全部 ok`, finalAcks.every((r) => r.ok), JSON.stringify(finalAcks.filter((r) => !r.ok).slice(0, 2)));
  const gotEnded = await waitFor(() => active.every((c) => c.rounds.some((r) => r.phase === 'ended')), 3000);
  const endedMs = now() - tGuess;
  const bad = active.filter((c) => { const e = c.rounds.find((r) => r.phase === 'ended'); return !(e && e.topic === topic && e.endReason === 'allGuessed'); });
  check(`${P}所有人（${active.length}）收到 ended：topic 揭曉、endReason allGuessed`, gotEnded && bad.length === 0, `${endedMs.toFixed(0)} ms；缺：${bad.slice(0, 3).map((c) => c.nick).join(' ')}`);
  const reveal = `題目是 ${topic}（全員猜對）`;
  await waitFor(() => active.every((c) => c.chat.some((m) => m.kind === 'system' && m.text === reveal)), 2000);
  const noReveal = active.filter((c) => !c.chat.some((m) => m.kind === 'system' && m.text === reveal));
  check(`${P}所有人收到揭曉「${reveal}」`, noReveal.length === 0, noReveal.slice(0, 3).map((c) => c.nick).join(' '));

  // ── 回 idle，驗證聊天與分數 ──
  const gotIdle = await waitFor(() => active.every((c) => c.rounds.at(-1)?.phase === 'idle'), 8000);
  check(`${P}約 5 秒後所有人回 idle`, gotIdle, `${((now() - tGuess) / 1000).toFixed(1)}s`);
  await sleep(200);

  const chatErr = chatAcks.filter((a) => !a.r.ok);
  check(`${P}聊天 ack 全部 ok（${chatAcks.length} 則，含 ${chatAcks.filter((a) => a.kind === 'chat').length} 則一般聊天；無 RATE_LIMITED／SPOILER_BLOCKED）`, chatErr.length === 0, JSON.stringify(chatErr.slice(0, 2).map((a) => [a.nick, a.r])));
  const chatPeers = [drawer, ...regular];
  const refIds = drawer.chat.map((m) => m.id).join(',');
  const chatBad = chatPeers.filter((c) => c.chat.map((m) => m.id).join(',') !== refIds);
  check(`${P}${chatPeers.length} 人收到的 chat:message 數量與順序一致（${drawer.chat.length} 則）`, chatBad.length === 0, chatBad.slice(0, 3).map((c) => `${c.nick}:${c.chat.length}`).join(' '));
  const sentTexts = [...chatSent.keys()];
  const chatMiss = chatPeers.filter((c) => sentTexts.some((t) => c.chat.filter((m) => m.kind === 'chat' && m.text === t).length !== 1));
  check(`${P}每則一般聊天每人恰好收到一次`, chatMiss.length === 0, chatMiss.slice(0, 3).map((c) => c.nick).join(' '));
  const correctN = drawer.chat.filter((m) => m.kind === 'correct').length;
  check(`${P}「X 猜對了」廣播 ${correctN} 則 = 猜題者人數 ${active.length - 1}`, correctN === active.length - 1);
  const chatLat = [];
  for (const c of active) c.chat.forEach((m, i) => { if (m.kind === 'chat' && chatSent.has(m.text)) chatLat.push(c.chatT[i] - chatSent.get(m.text)); });
  chatLatAll.push(...chatLat);

  const finalPlayers = drawer.players.at(-1) ?? [];
  const plBad = active.filter((c) => canon(c.players.at(-1)) !== canon(finalPlayers));
  check(`${P}所有人最後一次 players:update 一致`, plBad.length === 0 && finalPlayers.length === active.length, plBad.slice(0, 3).map((c) => c.nick).join(' '));
  const delta = (p) => p.score - (baseScore.get(p.id) ?? 0);
  const dp = finalPlayers.find((p) => p.id === drawer.id);
  const gs = finalPlayers.filter((p) => p.id !== drawer.id);
  check(`${P}畫師得分 +20 × ${gs.length} = ${20 * gs.length}`, dp && delta(dp) === 20 * gs.length, `實得 ${dp ? delta(dp) : '-'}`);
  check(`${P}每位猜題者得分 50..100、回 idle 後 hasGuessed 全清`, gs.every((p) => delta(p) >= 50 && delta(p) <= 100) && finalPlayers.every((p) => !p.hasGuessed), `範圍 ${Math.min(...gs.map(delta))}..${Math.max(...gs.map(delta))}`);

  metrics.push({ round, sent: sent.length, receivers: regular.length, opN: opLat.length, op: opLat, chatN: chatLat.length, chat: chatLat, endedMs });
  await sleep(300);
}

// ── 延遲判定與輸出 ──
// 門檻（舵手定案）：p95 < 100 ms 才 PASS；超過照實標 FAIL，不調門檻
const p95op = pct(opLatAll, 0.95), p95chat = pct(chatLatAll, 0.95);
check(`筆跡延遲 p95 < ${LATENCY_TARGET_MS} ms`, p95op < LATENCY_TARGET_MS, `p95=${fmt(p95op)} ms（p99=${fmt(pct(opLatAll, 0.99))}、max=${fmt(Math.max(...opLatAll))}）`);
check(`聊天延遲 p95 < ${LATENCY_TARGET_MS} ms`, p95chat < LATENCY_TARGET_MS, `p95=${fmt(p95chat)} ms（p99=${fmt(pct(chatLatAll, 0.99))}、max=${fmt(Math.max(...chatLatAll))}）`);
const rssEnd = rssKB();

console.log(R.map((r) => r.join('  ')).join('\n'));
console.log('\n延遲（ms，畫師送出 → 收件者收到；同機同程序）');
console.log('回合  類型   樣本數   p50    p95    p99    max');
const row = (label, kind, a) => console.log(`${label.padEnd(5)} ${kind.padEnd(5)} ${String(a.length).padStart(6)}  ${fmt(pct(a, 0.5)).padStart(5)}  ${fmt(pct(a, 0.95)).padStart(5)}  ${fmt(pct(a, 0.99)).padStart(5)}  ${fmt(a.length ? Math.max(...a) : NaN).padStart(5)}`);
for (const m of metrics) { row(`R${m.round}`, 'op', m.op); row(`R${m.round}`, 'chat', m.chat); }
if (metrics.length > 1) { row('全部', 'op', opLatAll); row('全部', 'chat', chatLatAll); }
console.log(`\n在線人數 ${active.length}（CLIENTS=${CLIENTS}${lateClient ? ' + 中途加入 1' : ''}）；並行加入耗時 ${joinMs.toFixed(0)} ms；總耗時 ${((now() - t0) / 1000).toFixed(1)}s`);
if (SERVER_PID) console.log(`server RSS：壓測前 ${fmtRss(rss0)} → 作畫後 ${fmtRss(rssPeak)} → 結束 ${fmtRss(rssEnd)}`);

for (const c of active) c.s.disconnect();
const fails = R.filter((r) => r[0] === 'FAIL').length;
const passes = R.filter((r) => r[0] === 'PASS').length;
console.log(`\n${passes}/${passes + fails} passed${R.some((r) => r[0] === 'SKIP') ? `（${R.filter((r) => r[0] === 'SKIP').length} skipped）` : ''}`);
setTimeout(() => process.exit(fails ? 1 : 0), 100);
