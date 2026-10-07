// 我畫你猜協定符合性測試（Phase 2 範圍：回合狀態機、出題遮罩、draw:op 驗證與轉發、筆跡歷史正規化）
// 只依 spec/architecture.md §4/§5/§6 打 Socket，不看實作。
// 用法（專案根目錄，需先 npm run build）：
//   PORT=3179 node server/dist/index.js &
//   TEST_PORT=3179 node --input-type=module < user/protocol/draw-guess-phase2.mjs
// 會等真實的 5 秒揭曉停留，總時長約 8 秒；全部 PASS 時 exit 0。
// 舵手（Helm）2026-09-24 Phase 2 驗收用。
import { io } from 'socket.io-client';
const PORT = process.env.TEST_PORT ?? '3179';
const URL = `http://127.0.0.1:${PORT}/draw-guess`;
/** 作畫時間（秒）＝ shared 的 ROUND_SECONDS（spec §4；Epic 12 改 120） */
const ROUND_SECONDS = 120;
const R = [];
const check = (name, cond, extra = '') => R.push([cond ? 'PASS' : 'FAIL', name, extra]);
const connect = () => io(URL, { path: '/socket.io', transports: ['websocket'], forceNew: true, reconnection: false });
const call = (s, ev, ...args) => new Promise((res) => s.emit(ev, ...args, res));
const once = (s, ev, ms = 4000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), ms); s.once(ev, (...a) => { clearTimeout(t); res(a); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const collect = (s, ev) => { const arr = []; s.on(ev, (p) => arr.push(p)); return arr; };
const joinAs = async (nick) => { const s = connect(); await once(s, 'connect'); const r = await call(s, 'player:join', { nickname: nick }); if (!r.ok) throw new Error('join failed ' + JSON.stringify(r)); return { s, id: r.data.snapshot.you, snap: r.data.snapshot }; };
const WHITE = '#FFFFFF';

// ── 大廳與前置條件 ──
const A = await joinAs('Alice');
const r1 = await call(A.s, 'round:volunteer');
check('單人 volunteer → NOT_ENOUGH_PLAYERS', r1.ok === false && r1.error === 'NOT_ENOUGH_PLAYERS', JSON.stringify(r1));
const B = await joinAs('Bob');
const r2 = await call(B.s, 'round:setTopic', { topic: '狗' });
check('idle 時非畫師 setTopic → NOT_DRAWER', r2.ok === false && r2.error === 'NOT_DRAWER', JSON.stringify(r2));
B.s.emit('draw:op');  // 無 ack 事件（契約），只確認不崩潰，不能 await

// ── volunteer → choosing ──
const aRounds = collect(A.s, 'round:update'), bRounds = collect(B.s, 'round:update');
const bPlayers = collect(B.s, 'players:update');
const t0 = Date.now();
const rv = await call(A.s, 'round:volunteer');
await sleep(200);
check('volunteer ok', rv.ok === true, JSON.stringify(rv));
const ch = bRounds.at(-1);
check('choosing：drawerId=A、topic null、endsAt≈now+60s', ch?.phase === 'choosing' && ch.drawerId === A.id && ch.topic === null && ch.topicLength === null && Math.abs(ch.endsAt - (t0 + 60000)) < 2000, JSON.stringify(ch));
check('players:update 帶 isDrawer=true', bPlayers.at(-1)?.find((p) => p.id === A.id)?.isDrawer === true);
const rv2 = await call(B.s, 'round:volunteer');
check('choosing 時 volunteer → ROUND_BUSY', rv2.ok === false && rv2.error === 'ROUND_BUSY');
const rt1 = await call(B.s, 'round:setTopic', { topic: '狗' });
check('非畫師 setTopic → NOT_DRAWER', rt1.ok === false && rt1.error === 'NOT_DRAWER');
const rt2 = await call(A.s, 'round:setTopic', { topic: '   ' });
check('全空白題目 → TOPIC_INVALID', rt2.ok === false && rt2.error === 'TOPIC_INVALID');
const rt3 = await call(A.s, 'round:setTopic', { topic: 'x'.repeat(21) });
check('21 字題目 → TOPIC_INVALID', rt3.ok === false && rt3.error === 'TOPIC_INVALID');
const rt4 = await call(A.s, 'round:setTopic', { topic: 'ａｂ\tc' });
check('含控制字元題目 → TOPIC_INVALID', rt4.ok === false && rt4.error === 'TOPIC_INVALID');

// ── setTopic → drawing（遮罩）──
const bOps = collect(B.s, 'draw:op'), aOps = collect(A.s, 'draw:op');
const bChat = collect(B.s, 'chat:message');
const t1 = Date.now();
const rt5 = await call(A.s, 'round:setTopic', { topic: ' 蘋果 ' });
await sleep(200);
check('setTopic ok', rt5.ok === true, JSON.stringify(rt5));
const ad = aRounds.at(-1), bd = bRounds.at(-1);
check('畫師的 round:update 含 topic「蘋果」、topicLength 2、endsAt≈now+ROUND_SECONDS', ad?.phase === 'drawing' && ad.topic === '蘋果' && ad.topicLength === 2 && Math.abs(ad.endsAt - (t1 + ROUND_SECONDS * 1000)) < 2000, JSON.stringify(ad));
check('猜題者的 round:update topic=null、topicLength 2', bd?.phase === 'drawing' && bd.topic === null && bd.topicLength === 2, JSON.stringify(bd));
check('猜題者收到 draw:op clear', bOps.some((o) => o.type === 'clear'));
check('system 訊息「Alice 開始作畫」', bChat.some((m) => m.kind === 'system' && m.text.includes('開始作畫')));
const rv3 = await call(B.s, 'round:volunteer');
check('drawing 時 volunteer → ROUND_BUSY', rv3.ok === false && rv3.error === 'ROUND_BUSY');

// ── draw:op 驗證與轉發 ──
bOps.length = 0;
A.s.emit('draw:op', { type: 'begin', strokeId: 's1', tool: 'pen', color: WHITE, size: 4, point: { x: 0.1, y: 0.1 } });
// 2026-09-28 舵手修正：Epic 1 Phase 6 起任意 #RRGGBB 都合法（COLOR_PATTERN），改用格式不符的色碼
A.s.emit('draw:op', { type: 'begin', strokeId: 'bad-color', tool: 'pen', color: '#12345', size: 4, point: { x: 0.1, y: 0.1 } });
A.s.emit('draw:op', { type: 'move', strokeId: 's1', points: [{ x: 1.5, y: 0.2 }] });
A.s.emit('draw:op', { type: 'move', strokeId: 's1', points: [{ x: 0.2, y: 0.2 }, { x: 0.3, y: 0.3 }] });
A.s.emit('draw:op', { type: 'move', strokeId: 'nope', points: [{ x: 0.2, y: 0.2 }] });
A.s.emit('draw:op', { type: 'begin', strokeId: 's1', tool: 'pen', color: WHITE, size: 4, point: { x: 0.5, y: 0.5 } });
A.s.emit('draw:op', { type: 'end', strokeId: 's1' });
A.s.emit('draw:op', { type: 'begin', strokeId: 'x'.repeat(65), tool: 'pen', color: WHITE, size: 4, point: { x: 0.5, y: 0.5 } });
// 2026-09-28 舵手修正：Phase 6 起粗細為 BRUSH_MIN..BRUSH_MAX（1..64）整數，改用超出上限的 65
A.s.emit('draw:op', { type: 'begin', strokeId: 'bad-size', tool: 'eraser', color: WHITE, size: 65, point: { x: 0.5, y: 0.5 } });
A.s.emit('draw:op', { type: 'move', strokeId: 's1', points: Array.from({ length: 65 }, () => ({ x: 0.5, y: 0.5 })) });
B.s.emit('draw:op', { type: 'begin', strokeId: 'from-b', tool: 'pen', color: WHITE, size: 4, point: { x: 0.5, y: 0.5 } });
await sleep(400);
check('合法 op 依序轉發給猜題者（begin, move, end），不合法者全部丟棄', JSON.stringify(bOps.map((o) => o.type + ':' + o.strokeId)) === JSON.stringify(['begin:s1', 'move:s1', 'end:s1']), JSON.stringify(bOps.map((o) => o.type + ':' + o.strokeId)));
check('畫師自己不收到自己的 op', aOps.length === 0, String(aOps.length));
check('猜題者送的 draw:op 不會被轉發（畫師沒收到）', !aOps.some((o) => o.strokeId === 'from-b'));

// ── 中途加入者：正規化歷史 ──
const C = await joinAs('Carol');
check('中途加入：phase drawing、topic 遮罩、ops 只含 begin/move/end 共 3 筆', C.snap.round.phase === 'drawing' && C.snap.round.topic === null && C.snap.round.topicLength === 2 && C.snap.ops.length === 3 && C.snap.ops.every((o) => ['begin', 'move', 'end'].includes(o.type)), JSON.stringify(C.snap.ops.map((o) => o.type)));
check('中途加入者的 players 含畫師標記', C.snap.players.find((p) => p.id === A.id)?.isDrawer === true);

// ── undo / clear 正規化 ──
A.s.emit('draw:op', { type: 'begin', strokeId: 's2', tool: 'pen', color: WHITE, size: 2, point: { x: 0.6, y: 0.6 } });
A.s.emit('draw:op', { type: 'end', strokeId: 's2' });
A.s.emit('draw:op', { type: 'undo', strokeId: 's1' });   // 不是最後一筆 → 丟棄
A.s.emit('draw:op', { type: 'undo', strokeId: 's2' });   // 最後一筆 → 移除
await sleep(300);
const D = await joinAs('Dave');
check('undo 後新加入者的 ops 只剩 s1 的 3 筆（s2 已移除、undo 不存入）', D.snap.ops.length === 3 && D.snap.ops.every((o) => o.strokeId === 's1'), JSON.stringify(D.snap.ops.map((o) => o.type + ':' + o.strokeId)));
const cOps = collect(C.s, 'draw:op');
A.s.emit('draw:op', { type: 'undo', strokeId: 's1' });   // 連續 undo：現在 s1 是最後一筆
await sleep(300);
check('連續 undo 轉發給其他人', cOps.some((o) => o.type === 'undo' && o.strokeId === 's1'));
A.s.emit('draw:op', { type: 'begin', strokeId: 's3', tool: 'eraser', color: WHITE, size: 16, point: { x: 0.6, y: 0.6 } });
A.s.emit('draw:op', { type: 'clear' });
await sleep(300);
const E = await joinAs('Eve');
check('clear 後新加入者 ops 為空', E.snap.ops.length === 0, String(E.snap.ops.length));

// ── cancel（drawing）→ ended → 5 秒 → idle ──
bRounds.length = 0; bChat.length = 0; bPlayers.length = 0;
const t2 = Date.now();
const rc = await call(A.s, 'round:cancel');
await sleep(300);
check('drawing 時 cancel ok', rc.ok === true, JSON.stringify(rc));
const en = bRounds.at(-1);
check('ended：所有人看得到 topic、endReason cancelled、endsAt null', en?.phase === 'ended' && en.topic === '蘋果' && en.endReason === 'cancelled' && en.endsAt === null, JSON.stringify(en));
check('揭曉 system 訊息「題目是 蘋果（…）」', bChat.some((m) => m.kind === 'system' && m.text.startsWith('題目是 蘋果')), JSON.stringify(bChat.map((m) => m.text)));
const rv4 = await call(B.s, 'round:volunteer');
check('ended 時 volunteer → ROUND_BUSY', rv4.ok === false && rv4.error === 'ROUND_BUSY');
let idle = null;
while (Date.now() - t2 < 8000) { try { const [r] = await once(B.s, 'round:update', 8000); if (r.phase === 'idle') { idle = r; break; } } catch { break; } }
const secs = ((Date.now() - t2) / 1000).toFixed(1);
check('約 5 秒後回 idle，endReason 保留、drawerId null', idle !== null && idle.drawerId === null && idle.endReason === 'cancelled' && Number(secs) >= 4.5 && Number(secs) <= 7, `${secs}s ${JSON.stringify(idle)}`);
await sleep(200);
check('回 idle 後 players:update 畫師標記清除', bPlayers.at(-1)?.every((p) => p.isDrawer === false), JSON.stringify(bPlayers.at(-1)?.map((p) => [p.nickname, p.isDrawer])));

// ── choosing 階段 cancel → 直接 idle ──
bRounds.length = 0;
const rv5 = await call(B.s, 'round:volunteer');
check('新回合 volunteer ok（換 Bob 當畫師）', rv5.ok === true);
const rc2 = await call(B.s, 'round:cancel');
await sleep(300);
check('choosing 時 cancel → 直接 idle（不經 ended）、endReason cancelled', rc2.ok === true && bRounds.at(-1)?.phase === 'idle' && bRounds.at(-1)?.endReason === 'cancelled' && !bRounds.some((r) => r.phase === 'ended'), JSON.stringify(bRounds.map((r) => r.phase)));
const rc3 = await call(B.s, 'round:cancel');
check('idle 時 cancel → 錯誤 ack', rc3.ok === false, JSON.stringify(rc3));

for (const x of [A, B, C, D, E]) x.s.disconnect();
console.log(R.map((r) => r.join('  ')).join('\n'));
const fails = R.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${R.length - fails}/${R.length} passed`);
process.exit(fails ? 1 : 0);
