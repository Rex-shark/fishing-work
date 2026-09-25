// 我畫你猜協定符合性測試（Phase 6 範圍：任意 #RRGGBB 色碼與 1..64 整數粗細的 draw:op 驗證）
// 只依 spec/architecture.md §4/§5 打 Socket，不看實作。
// 用法（專案根目錄，需先 npm run build；隔離埠且只綁本機）：
//   HOST=127.0.0.1 PORT=3182 node server/dist/index.js &
//   TEST_PORT=3182 node --input-type=module < user/protocol/draw-guess-phase6.mjs
// 總時長約 3 秒；全部 PASS 時 exit 0。舵手（Helm）2026-09-24 Phase 6 驗收用。
import { io } from 'socket.io-client';
const PORT = process.env.TEST_PORT ?? '3182';
const URL = `http://127.0.0.1:${PORT}/draw-guess`;
const R = [];
const check = (name, cond, extra = '') => R.push([cond ? 'PASS' : 'FAIL', name, extra]);
const connect = () => io(URL, { path: '/socket.io', transports: ['websocket'], forceNew: true, reconnection: false });
const call = (s, ev, ...args) => new Promise((res) => s.emit(ev, ...args, res));
const once = (s, ev, ms = 4000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), ms); s.once(ev, (...a) => { clearTimeout(t); res(a); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const collect = (s, ev) => { const arr = []; s.on(ev, (p) => arr.push(p)); return arr; };
const joinAs = async (nick) => { const s = connect(); await once(s, 'connect'); const r = await call(s, 'player:join', { nickname: nick }); if (!r.ok) throw new Error('join failed ' + JSON.stringify(r)); return { s, id: r.data.snapshot.you, snap: r.data.snapshot }; };

const A = await joinAs('Alice'), B = await joinAs('Bob');
await call(A.s, 'round:volunteer');
await call(A.s, 'round:setTopic', { topic: '彩虹' });
await sleep(200);
const bOps = collect(B.s, 'draw:op');
bOps.length = 0;
let n = 0;
const begin = (extra) => A.s.emit('draw:op', { type: 'begin', strokeId: `s${++n}`, tool: 'pen', color: '#FFFFFF', size: 4, point: { x: 0.5, y: 0.5 }, ...extra });
const legal = [
  ['#00FF00', 4], ['#00ff00', 4], ['#123ABC', 1], ['#E100FF', 64], ['#000000', 32],
];
const illegal = [
  ['#fff', 4], ['00FF00', 4], ['#00FF0000', 4], ['#GGGGGG', 4], ['rgb(0,255,0)', 4],
  ['#FFFFFF', 0], ['#FFFFFF', 65], ['#FFFFFF', 0.5], ['#FFFFFF', -1], ['#FFFFFF', '8'], ['#FFFFFF', NaN],
];
for (const [color, size] of legal) begin({ color, size });
for (const [color, size] of illegal) begin({ color, size });
begin({ tool: 'eraser', color: '#ABCDEF', size: 64 });   // 橡皮擦帶任意合法色，size 上限
begin({ tool: 'eraser', color: 'white', size: 8 });      // 橡皮擦帶非法色 → 丟棄
await sleep(500);
const got = bOps.filter((o) => o.type === 'begin');
check('合法色碼與粗細（含小寫、1、64）全部轉發', legal.every(([c, s]) => got.some((o) => o.color === c && o.size === s)), JSON.stringify(got.map((o) => [o.color, o.size])));
check('小寫色碼原樣轉發（server 不改寫）', got.some((o) => o.color === '#00ff00'));
check('非法色碼／粗細全部丟棄', !got.some((o) => illegal.some(([c, s]) => o.color === c && o.size === s)) && got.length === legal.length + 1, `轉發 ${got.length} 筆，預期 ${legal.length + 1}`);
check('橡皮擦帶合法色與 64 通過、帶非法色丟棄', got.some((o) => o.tool === 'eraser' && o.color === '#ABCDEF' && o.size === 64) && !got.some((o) => o.color === 'white'));
const C = await joinAs('Carol');
check('中途加入者快照的 begin 保留原色碼與粗細', C.snap.ops.filter((o) => o.type === 'begin').length === legal.length + 1 && C.snap.ops.some((o) => o.type === 'begin' && o.color === '#E100FF' && o.size === 64));
for (const x of [A, B, C]) x.s.disconnect();
console.log(R.map((r) => r.join('  ')).join('\n'));
const fails = R.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${R.length - fails}/${R.length} passed`);
process.exit(fails ? 1 : 0);
