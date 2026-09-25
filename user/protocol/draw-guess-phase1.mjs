// 我畫你猜協定符合性測試（Phase 1 範圍）：只依 spec/architecture.md §4/§5/§9 打 Socket，不看實作。
// 用法（專案根目錄，需先 npm run build）：
//   PORT=3178 node server/dist/index.js &   # 另開終端或背景
//   TEST_PORT=3178 node --input-type=module < user/protocol/draw-guess-phase1.mjs
// 會等真實的 15 秒寬限期，總時長約 20 秒；全部 PASS 時 exit 0。
// 舵手（Helm）2026-09-24 Phase 1 驗收用；Phase 2 起可擴充回合／畫布／聊天案例，或改寫成 server/test/e2e 的 Vitest。
import { io } from 'socket.io-client';
const PORT = process.env.TEST_PORT ?? '3178';
const URL = `http://127.0.0.1:${PORT}/draw-guess`;
const R = [];
const check = (name, cond, extra = '') => R.push([cond ? 'PASS' : 'FAIL', name, extra]);
const connect = () => io(URL, { path: '/socket.io', transports: ['websocket'], forceNew: true, reconnection: false });
const join = (s, p) => new Promise((res) => s.emit('player:join', p, res));
const once = (s, ev, ms = 4000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), ms); s.once(ev, (...a) => { clearTimeout(t); res(a); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const collect = (s, ev) => { const arr = []; s.on(ev, (p) => arr.push(p)); return arr; };

const A = connect(); await once(A, 'connect');
const rA = await join(A, { nickname: '  Alice ' });
check('join ok 回 JoinResult{token,snapshot}', rA.ok === true && typeof rA.data?.token === 'string' && typeof rA.data?.snapshot?.you === 'string', JSON.stringify(rA).slice(0, 100));
const aliceId = rA.data.snapshot.you, tokenA = rA.data.token;
const me = rA.data.snapshot.players.find((p) => p.id === aliceId);
check('player id 不是 socket.id', aliceId !== A.id);
check('暱稱去頭尾空白', me?.nickname === 'Alice', me?.nickname);
check('connected=true 且欄位齊全', me?.connected === true && typeof me.score === 'number' && me.isDrawer === false && me.hasGuessed === false && typeof me.joinedAt === 'number');
check('快照含自己的「加入」system 訊息', rA.data.snapshot.chat.some((m) => m.kind === 'system' && m.text.includes('Alice')));
const rA2 = await join(A, { nickname: 'Other' });
check('同 socket 重複 join 冪等（同 token、不改名、不重建）', rA2.ok && rA2.data.token === tokenA && rA2.data.snapshot.players.length === 1 && rA2.data.snapshot.players[0].nickname === 'Alice');

const B = connect(); await once(B, 'connect');
const rB1 = await join(B, { nickname: 'ＡＬＩＣＥ' });
check('全形＋大小寫視為同名 → NICKNAME_TAKEN', rB1.ok === false && rB1.error === 'NICKNAME_TAKEN', JSON.stringify(rB1));
const rB2 = await join(B, { nickname: 'Bo\tb' });
check('控制字元 → NICKNAME_INVALID', rB2.ok === false && rB2.error === 'NICKNAME_INVALID');
const rB3 = await join(B, { nickname: 'x'.repeat(13) });
check('13 code points → NICKNAME_INVALID', rB3.ok === false && rB3.error === 'NICKNAME_INVALID');
const rB3b = await join(B, { nickname: '   ' });
check('全空白 → NICKNAME_INVALID', rB3b.ok === false && rB3b.error === 'NICKNAME_INVALID');
const aUpdates = collect(A, 'players:update');
const rB4 = await join(B, { nickname: '👨‍👩‍👧👨‍👩‍👧' }); // 10 code points ≤ 12
check('emoji 以 code point 計 → ok', rB4.ok === true, JSON.stringify(rB4).slice(0, 80));
const bId = rB4.data.snapshot.you, tokenB = rB4.data.token;
await sleep(300);
check('B 加入後 A 收到 players:update（2 人）', aUpdates.at(-1)?.length === 2, String(aUpdates.at(-1)?.length));

// 接管：A2 帶 tokenA，舊 socket A 應被踢
const A2 = connect(); await once(A2, 'connect');
const aDisc = once(A, 'disconnect');
const rT = await join(A2, { nickname: 'IGNORED', token: tokenA });
check('接管 ok：同 id、同 token、暱稱不變', rT.ok && rT.data.snapshot.you === aliceId && rT.data.token === tokenA && rT.data.snapshot.players.find((p) => p.id === aliceId)?.nickname === 'Alice', JSON.stringify(rT).slice(0, 120));
const [reason] = await aDisc;
check('舊 socket 被伺服器踢掉', reason === 'io server disconnect', String(reason));
await sleep(300);
check('接管後仍 2 人', rT.data.snapshot.players.length === 2);

// B 斷線 → 寬限期 → 逾期移除
const a2Updates = collect(A2, 'players:update');
const upd = once(A2, 'players:update');
B.disconnect();
const [pl1] = await upd;
check('B 斷線後標 connected=false（寬限期）', pl1.find((p) => p.id === bId)?.connected === false, JSON.stringify(pl1.map((p) => [p.nickname, p.connected])));
const C = connect(); await once(C, 'connect');
const rC = await join(C, { nickname: '👨‍👩‍👧👨‍👩‍👧' });
check('寬限期中暱稱仍占用', rC.ok === false && rC.error === 'NICKNAME_TAKEN');
const t0 = Date.now();
let removed = false;
while (Date.now() - t0 < 20000) {
  try { const [pl] = await once(A2, 'players:update', 20000); if (!pl.find((p) => p.id === bId)) { removed = true; break; } } catch { break; }
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);
check('寬限逾期 B 被移除（約 15 秒）', removed && Number(secs) >= 14 && Number(secs) <= 17, `${secs}s`);
const D = connect(); await once(D, 'connect');
const rD = await join(D, { nickname: 'Bob', token: tokenB });
check('逾期 token → 視為新玩家（新 id、新 token）', rD.ok && rD.data.token !== tokenB && rD.data.snapshot.you !== bId);

// 寬限期內接回（同一玩家、分數保留、不重複）
const rE = await join(C, { nickname: 'Eve' }); const eveId = rE.data.snapshot.you, tokenE = rE.data.token;
C.disconnect(); await sleep(300);
const C2 = connect(); await once(C2, 'connect');
const rE2 = await join(C2, { nickname: 'whatever', token: tokenE });
check('寬限期內帶 token 接回：同 id、connected=true、人數不變', rE2.ok && rE2.data.snapshot.you === eveId && rE2.data.snapshot.players.find((p) => p.id === eveId)?.connected === true && rE2.data.snapshot.players.length === 3, JSON.stringify(rE2.data?.snapshot?.players?.map((p) => [p.nickname, p.connected])));

// 惡意 payload 不崩潰
A2.emit('player:join', null, (r) => check('payload null → 錯誤 ack 不崩潰', r?.ok === false, JSON.stringify(r)));
A2.emit('player:join', { nickname: 123, token: 'x'.repeat(100) }, (r) => check('已加入的 socket 送壞 payload → 仍冪等回 ok（§5 重複 join）', r?.ok === true && r.data?.snapshot?.you === aliceId));
const F = connect(); await once(F, 'connect');
F.emit('player:join', { nickname: 123, token: 'x'.repeat(100) }, (r) => check('新 socket 暱稱非字串、token 過長 → NICKNAME_INVALID', r?.ok === false && r.error === 'NICKNAME_INVALID', JSON.stringify(r)));
A2.emit('player:join', { nickname: 'NoAck' });
await sleep(400);
check('伺服器仍存活', A2.connected && (await join(D, { nickname: 'again' })).ok === true);
for (const s of [A, A2, B, C, C2, D, F]) s.disconnect();
console.log(R.map((r) => r.join('  ')).join('\n'));
const fails = R.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${R.length - fails}/${R.length} passed`);
process.exit(fails ? 1 : 0);
