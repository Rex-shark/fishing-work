// 我畫你猜協定符合性測試（Epic 7：畫布背景色 background op）
// 只依 spec/architecture.md §4／§5／§6 打 Socket，不看實作。
// 用法（專案根目錄，需先 npm run build；隔離埠且只綁本機）：
//   HOST=127.0.0.1 PORT=3190 node server/dist/index.js &
//   TEST_PORT=3190 node --input-type=module < user/protocol/draw-guess-background.mjs
// 含一次真實的 5 秒揭曉停留，總時長約 8 秒；全部 PASS 時 exit 0。舵手（Helm）2026-09-28。
import { io } from 'socket.io-client';
const PORT = process.env.TEST_PORT ?? '3190';
const URL = `http://127.0.0.1:${PORT}/draw-guess`;
const R = [];
const check = (name, cond, extra = '') => R.push([cond ? 'PASS' : 'FAIL', name, extra]);
const connect = () => io(URL, { path: '/socket.io', transports: ['websocket'], forceNew: true, reconnection: false });
const call = (s, ev, ...args) => new Promise((res) => s.emit(ev, ...args, res));
const once = (s, ev, ms = 4000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), ms); s.once(ev, (...a) => { clearTimeout(t); res(a); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const collect = (s, ev) => { const arr = []; s.on(ev, (p) => arr.push(p)); return arr; };
const joinAs = async (nick) => { const s = connect(); await once(s, 'connect'); const r = await call(s, 'player:join', { nickname: nick }); if (!r.ok) throw new Error('join failed ' + JSON.stringify(r)); return { s, id: r.data.snapshot.you, snap: r.data.snapshot }; };
const bgOf = (ops) => ops.filter((o) => o.type === 'background');
const stroke = (s, id, color = '#000000') => {
  s.emit('draw:op', { type: 'begin', strokeId: id, tool: 'pen', color, size: 4, point: { x: 0.1, y: 0.1 } });
  s.emit('draw:op', { type: 'move', strokeId: id, points: [{ x: 0.2, y: 0.2 }, { x: 0.3, y: 0.25 }] });
  s.emit('draw:op', { type: 'end', strokeId: id });
};
const all = [];

const A = await joinAs('Alice'), B = await joinAs('Bob');
all.push(A, B);
const aOps = collect(A.s, 'draw:op'), bOps = collect(B.s, 'draw:op');

// ── choosing 階段不受理 ──
await call(A.s, 'round:volunteer');
A.s.emit('draw:op', { type: 'background', color: '#FFECEA' });
await sleep(200);
check('choosing 階段的 background 被丟棄（不轉發）', bOps.length === 0, String(bOps.length));

// ── drawing：合法 background 轉發、多餘欄位丟棄、不回傳畫師 ──
await call(A.s, 'round:setTopic', { topic: '貓' });
A.s.emit('draw:op', { type: 'background', color: '#FFECEA', extra: 1 });
await sleep(200);
// 進入 drawing 時 server 會對非畫師送 draw:op {clear}（spec §6），因此只計 background op
const bBg = () => bgOf(bOps);
check('畫師 background 轉發給他人且色碼原樣', bBg().length === 1 && bBg()[0].color === '#FFECEA', JSON.stringify(bOps));
check('轉發的 op 不含多餘欄位', bBg().length === 1 && !('extra' in bBg()[0]), JSON.stringify(bBg()[0]));
check('不回傳給畫師本人', aOps.length === 0, String(aOps.length));

// ── 非畫師、不合法色碼 ──
B.s.emit('draw:op', { type: 'background', color: '#000000' });
for (const bad of ['red', '#FFF', '#GGGGGG', 'FFECEA', 123, null, undefined]) A.s.emit('draw:op', { type: 'background', color: bad });
A.s.emit('draw:op', { type: 'background' });
await sleep(250);
check('非畫師的 background 被丟棄', aOps.length === 0, String(aOps.length));
check('不合法或缺少的色碼被丟棄', bBg().length === 1, JSON.stringify(bBg()));

// ── 歷史只留最後一個 background，筆跡保留 ──
stroke(A.s, 's1');
A.s.emit('draw:op', { type: 'background', color: '#000000' });
A.s.emit('draw:op', { type: 'background', color: '#6A9955' });
await sleep(250);
const C = await joinAs('Carol'); all.push(C);
check('中途加入快照只有一個 background 且為最後的色', bgOf(C.snap.ops).length === 1 && bgOf(C.snap.ops)[0].color === '#6A9955', JSON.stringify(bgOf(C.snap.ops)));
check('中途加入快照仍含筆跡 s1', C.snap.ops.some((o) => o.type === 'begin' && o.strokeId === 's1'));

// ── undo 不影響背景 ──
A.s.emit('draw:op', { type: 'undo', strokeId: 's1' });
await sleep(200);
const D = await joinAs('Dave'); all.push(D);
check('undo 最後一筆（其後有 background）被受理：s1 消失', !D.snap.ops.some((o) => o.strokeId === 's1'), JSON.stringify(D.snap.ops));
check('undo 後背景仍在', bgOf(D.snap.ops).length === 1 && bgOf(D.snap.ops)[0].color === '#6A9955');

// ── clear 只清筆跡、保留背景 ──
stroke(A.s, 's2');
await sleep(150);
A.s.emit('draw:op', { type: 'clear' });
await sleep(200);
const E = await joinAs('Eve'); all.push(E);
check('clear 後快照只剩一個 background（筆跡清空）', E.snap.ops.length === 1 && E.snap.ops[0].type === 'background' && E.snap.ops[0].color === '#6A9955', JSON.stringify(E.snap.ops));
const cGot = collect(C.s, 'draw:op');
A.s.emit('draw:op', { type: 'background', color: '#FFFFFF' });
await sleep(200);
check('clear 之後仍可再換背景並轉發給中途加入者', cGot.some((o) => o.type === 'background' && o.color === '#FFFFFF'), JSON.stringify(cGot));

// ── 新回合回預設（ops 清空） ──
await call(A.s, 'round:cancel');
await sleep(5600);
const rv = await call(B.s, 'round:volunteer');
const rt = await call(B.s, 'round:setTopic', { topic: '狗' });
await sleep(150);
const F = await joinAs('Frank'); all.push(F);
check('新回合開始（B 畫師）', rv.ok === true && rt.ok === true, JSON.stringify([rv, rt]));
check('新回合快照 ops 為空（背景回到 CANVAS_BACKGROUND）', F.snap.ops.length === 0, JSON.stringify(F.snap.ops));

for (const x of all) x.s.disconnect();
console.log(R.map((r) => r.join('  ')).join('\n'));
const fails = R.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${R.length - fails}/${R.length} passed`);
process.exit(fails ? 1 : 0);
