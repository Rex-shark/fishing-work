// 我畫你猜協定符合性測試（Phase 3 範圍：聊天判定表、防洩題、計分、全員猜對結束、揭曉、間隔與長度限制）
// 只依 spec/architecture.md §4/§5 打 Socket，不看實作。
// 用法（專案根目錄，需先 npm run build；請用隔離埠，桌面 app 的瀏覽器窗格會自動重連 7180）：
//   PORT=3180 node server/dist/index.js &
//   TEST_PORT=3180 node --input-type=module < user/protocol/draw-guess-phase3.mjs
// 會等真實的 5 秒揭曉停留，總時長約 8 秒；全部 PASS 時 exit 0。
// 舵手（Helm）2026-09-24 Phase 3 驗收用。
import { io } from 'socket.io-client';
const PORT = process.env.TEST_PORT ?? '3180';
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
const chat = (x, text) => call(x.s, 'chat:send', { text });
const texts = (arr) => arr.map((m) => `${m.kind}:${m.text}`);

const A = await joinAs('Alice'), B = await joinAs('Bob'), C = await joinAs('Carol');
const aChat = collect(A.s, 'chat:message'), bChat = collect(B.s, 'chat:message'), cChat = collect(C.s, 'chat:message');
const aPlayers = collect(A.s, 'players:update'), aRounds = collect(A.s, 'round:update');

// ── idle 階段：一般聊天與限制 ──
const r0 = await chat(B, '  hello  ');
await sleep(200);
check('idle 聊天 ok，廣播給所有人（含本人），文字去頭尾空白', r0.ok === true && [aChat, bChat, cChat].every((c) => c.some((m) => m.kind === 'chat' && m.text === 'hello' && m.fromId === B.id && m.nickname === 'Bob')), JSON.stringify(texts(bChat)));
const rr = await chat(B, 'again');
check('300ms 內連發 → RATE_LIMITED', rr.ok === false && rr.error === 'RATE_LIMITED', JSON.stringify(rr));
await sleep(350);
const re1 = await chat(B, '   ');
check('全空白 → MESSAGE_INVALID', re1.ok === false && re1.error === 'MESSAGE_INVALID');
const re2 = await chat(B, 'x'.repeat(201));
check('201 字 → MESSAGE_INVALID', re2.ok === false && re2.error === 'MESSAGE_INVALID');
const re3 = await chat(B, 'a\nb');
check('含換行 → MESSAGE_INVALID', re3.ok === false && re3.error === 'MESSAGE_INVALID');
const re4 = await new Promise((res) => B.s.emit('chat:send', { text: 123 }, res));
check('payload 形狀錯 → MESSAGE_INVALID', re4?.ok === false && re4.error === 'MESSAGE_INVALID', JSON.stringify(re4));

// ── 進入 drawing ──
await call(A.s, 'round:volunteer');
const rt = await call(A.s, 'round:setTopic', { topic: 'Apple' });
check('setTopic ok', rt.ok === true);
await sleep(200);
const startedAt = aRounds.at(-1)?.startedAt;
for (const c of [aChat, bChat, cChat]) c.length = 0;
aPlayers.length = 0;

// ── 判定表 ──
const g1 = await chat(B, 'banana');
await sleep(200);
check('猜錯 → 一般廣播', g1.ok === true && cChat.some((m) => m.kind === 'chat' && m.text === 'banana'));
await sleep(350);
const g2 = await chat(B, 'is apple?');
await sleep(200);
check('猜題者部分命中 → SPOILER_BLOCKED，無人收到', g2.ok === false && g2.error === 'SPOILER_BLOCKED' && !cChat.some((m) => m.text.includes('apple')) && !aChat.some((m) => m.text.includes('apple')), JSON.stringify(g2));
const g3 = await chat(A, 'apple pie');
await sleep(200);
check('畫師含題目 → SPOILER_BLOCKED，無人收到', g3.ok === false && g3.error === 'SPOILER_BLOCKED' && !bChat.some((m) => m.text.includes('apple')), JSON.stringify(g3));
await sleep(350);
const g4 = await chat(A, 'hint: fruit');
await sleep(200);
check('畫師不含題目 → 一般廣播', g4.ok === true && bChat.some((m) => m.kind === 'chat' && m.text === 'hint: fruit'));

// ── 猜對 ──
const rateBefore = bChat.length;
const g5 = await chat(C, 'APPLE');
await sleep(300);
check('大小寫不同仍猜對：ack ok，原文不廣播，全員收到 kind correct「Carol 猜對了」', g5.ok === true && !bChat.some((m) => m.text === 'APPLE') && [aChat, bChat, cChat].every((c) => c.some((m) => m.kind === 'correct' && m.text.includes('Carol') && m.text.includes('猜對'))), JSON.stringify(texts(bChat.slice(rateBefore))));
const pl = aPlayers.at(-1);
const carol = pl?.find((p) => p.id === C.id);
check('players:update：Carol hasGuessed=true、分數 50..100', carol?.hasGuessed === true && carol.score >= 50 && carol.score <= 100, JSON.stringify(pl?.map((p) => [p.nickname, p.hasGuessed, p.score])));
const elapsed = (Date.now() - startedAt) / 1000;
const expected = 100 - Math.floor((50 * elapsed) / ROUND_SECONDS);
check('分數符合公式 100−floor(50×elapsed/ROUND_SECONDS)（容許 ±1）', Math.abs(carol.score - expected) <= 1, `score=${carol?.score} expected≈${expected} elapsed=${elapsed.toFixed(1)}s`);
await sleep(350);
const g6 = await chat(C, 'Apple');
await sleep(200);
check('已猜對者再打題目 → SPOILER_BLOCKED', g6.ok === false && g6.error === 'SPOILER_BLOCKED');
await sleep(350);
const g7 = await chat(C, 'gg');
await sleep(200);
check('已猜對者一般訊息 → 廣播', g7.ok === true && bChat.some((m) => m.kind === 'chat' && m.text === 'gg' && m.fromId === C.id));
const D = await joinAs('Dave');
check('中途加入者快照 chat 含 correct 訊息且無原文', D.snap.chat.some((m) => m.kind === 'correct') && !D.snap.chat.some((m) => m.text === 'APPLE'));

// ── 全員猜對 → ended → idle ──
aRounds.length = 0; aPlayers.length = 0; bChat.length = 0;
await sleep(350);
const g8 = await chat(B, 'ａｐｐｌｅ');
await sleep(200);
check('全形也算猜對', g8.ok === true && bChat.some((m) => m.kind === 'correct' && m.text.includes('Bob')));
const Dsock = connect(); await once(Dsock, 'connect');
const rD = await call(Dsock, 'player:join', { nickname: 'Dave' });
check('重複暱稱被拒（Dave 仍在）', rD.ok === false && rD.error === 'NICKNAME_TAKEN');
Dsock.disconnect();
check('Bob 猜對但 Dave 未猜，仍在 drawing', !aRounds.some((r) => r.phase === 'ended'), JSON.stringify(aRounds.map((r) => r.phase)));
const t2 = Date.now();
const g9 = await chat(D, ' apple ');
await sleep(300);
const en = aRounds.find((r) => r.phase === 'ended');
check('最後一人猜對 → 全員猜對 → ended，topic 對所有人可見、endReason allGuessed', g9.ok === true && en?.topic === 'Apple' && en.endReason === 'allGuessed', JSON.stringify(en));
check('揭曉 system 訊息「題目是 Apple（全員猜對）」', bChat.some((m) => m.kind === 'system' && m.text === '題目是 Apple（全員猜對）'), JSON.stringify(texts(bChat)));
const alice = aPlayers.at(-1)?.find((p) => p.id === A.id);
check('畫師結算 +20×3 = 60', alice?.score === 60, JSON.stringify(aPlayers.at(-1)?.map((p) => [p.nickname, p.score, p.hasGuessed])));
let idle = null;
while (Date.now() - t2 < 8000) { try { const [r] = await once(A.s, 'round:update', 8000); if (r.phase === 'idle') { idle = r; break; } } catch { break; } }
await sleep(200);
check('約 5 秒後回 idle，correctIds 清空', idle !== null && idle.correctIds.length === 0 && idle.endReason === 'allGuessed', `${((Date.now() - t2) / 1000).toFixed(1)}s`);
check('回 idle 後所有人 hasGuessed=false', aPlayers.at(-1)?.every((p) => p.hasGuessed === false), JSON.stringify(aPlayers.at(-1)?.map((p) => [p.nickname, p.hasGuessed])));
await sleep(350);
const g10 = await chat(B, 'Apple');
await sleep(200);
check('idle 時打題目是一般聊天', g10.ok === true && cChat.some((m) => m.kind === 'chat' && m.text === 'Apple'));
for (const x of [A, B, C, D]) x.s.disconnect();
console.log(R.map((r) => r.join('  ')).join('\n'));
const fails = R.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${R.length - fails}/${R.length} passed`);
process.exit(fails ? 1 : 0);
