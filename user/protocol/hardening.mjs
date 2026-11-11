// Epic 21「code review 修正（第一批）」協定測試（決策 10）：只依 spec 打 Socket，不 import server 內部程式。
// 依據：spec/architecture.md §4 常數表與 §9.1、spec/song-guess/architecture.md §5.4、plan/hardening.md 決策 1、2、3、7。
// 涵蓋（code review 編號）：
//   #2 不可見字元：三款的零寬字元暱稱／題目（我畫你猜、繪圖比賽）／歌手名（猜歌）／聊天被拒（各自既有 INVALID 碼、文案不變）；
//      全不可見暱稱被拒；同暱稱加 VS16 或夾 ZWJ → NICKNAME_TAKEN；emoji 暱稱 👨‍👩‍👧、❤️ 合法；
//      ZWJ 夾答案仍被洩題防護擋下（我畫你猜題目、猜歌歌名）。繪圖比賽只連它的 namespace 驗 shared 規則。
//   #3 記憶體：我畫你猜畫師 begin＋undo 迴圈（預設 100000 對）→ 只轉發前 MAX_STROKES_PER_ROUND（2000）個 begin、其後丟棄；
//      同量再灌第二輪全被丟棄（0 則轉發）；server 存活（/healthz）——以上為主判定，不靠 RSS。RSS 只斷言第二輪增幅 Δ2 < RSS_LIMIT_MB（預設 32，
//      代表不再隨灌入量成長）；第一輪增幅 Δ1 含 V8／配置器的暫時性擴張、受機器狀態影響（實測 34～88 MB），只印出不斷言；
//      之後新玩家照常加入、照常聊天。（Room 本身的保留量以 --expose-gc 單獨量過：80 萬個 op 後 heapUsed 只多 0.2 MB）
//      已加入 socket 連送 player:join → RATE_LIMITED「操作太頻繁，請稍候再試」；滿 1 秒再送 → 冪等成功（同 token）；
//      未綁定的 socket 打錯暱稱可立刻重試（我畫你猜、猜歌）。
//   #4 洩題探測：SPOILER_BLOCKED 後 3 秒內連送（含正確答案）一律 RATE_LIMITED、不算猜對；滿 3 秒才恢復（我畫你猜、猜歌）。
//   #7 歌手快取：假 iTunes 查無（0 筆）的歌手，同鍵再查會再打一次上游（假 iTunes 的 /_mock/requests 計數）。
//
// 用法（專案根目錄，需先 npm run build；隔離埠且只綁本機；**每次都要全新的 server 程序與假 iTunes**，計數與房間狀態都在記憶體）：
//   MOCK_ITUNES_PORT=11601 MOCK_ITUNES_TRACK_MS=9000 node user/mock/itunes.mjs &      # 每首 9 秒：洩題冷卻 3 秒要在同一首內驗完
//   COMMENT=off JUDGE=random HOST=127.0.0.1 PORT=3521 ITUNES_URL=http://127.0.0.1:11601 ITUNES_RSS_URL=http://127.0.0.1:11601 \
//     node server/dist/index.js > <scratchpad>/hardening-server.log 2>&1 &            # 記下 $!（node 本身的 pid）
//   TEST_PORT=3521 MOCK_ITUNES_URL=http://127.0.0.1:11601 SERVER_PID=<pid> node --input-type=module < user/protocol/hardening.mjs
// 環境變數：TEST_PORT（預設 3521）、MOCK_ITUNES_URL（預設 http://127.0.0.1:11601）、SERVER_PID（必填：量 RSS）、
//           FLOOD（每輪 begin＋undo 對數，預設 100000；code review 原重現是 40 萬次）、RSS_LIMIT_MB（預設 32）。總時長約 20～40 秒；全部 PASS 時 exit 0。
//
// 2026-11-10 水手長派出的子代理（A 份）依 spec 撰寫。
import { execFileSync } from 'node:child_process';
import { io } from 'socket.io-client';

const PORT = process.env.TEST_PORT ?? '3521';
const BASE = `http://127.0.0.1:${PORT}`;
const MOCK = (process.env.MOCK_ITUNES_URL ?? 'http://127.0.0.1:11601').replace(/\/+$/, '');
const SERVER_PID = process.env.SERVER_PID;
const FLOOD = Number(process.env.FLOOD ?? 100_000);
const RSS_LIMIT_MB = Number(process.env.RSS_LIMIT_MB ?? 32);
if (!SERVER_PID) {
  console.error('需要 SERVER_PID（server 程序的 pid，量 RSS 用）');
  process.exit(2);
}

// ── 常數：.mjs 不能 import .ts，照既有協定測試慣例寫死；出處 spec §4 常數表（我畫你猜、猜歌）──
const NICKNAME_MAX = 12;
const MAX_STROKES_PER_ROUND = 2000;
const SPOILER_COOLDOWN_MS = 3000;
const JOIN_MIN_INTERVAL_MS = 1000;
const CHAT_MIN_INTERVAL_MS = 300;

// ── ack.message 文案（既有文案不變；join 節流為 §9.1 新文案）──
const MSG = {
  NICKNAME_INVALID: `暱稱需為 1～${NICKNAME_MAX} 個字，且不可含控制字元`,
  NICKNAME_TAKEN: '這個暱稱已經有人使用',
  JOIN_RATE_LIMITED: '操作太頻繁，請稍候再試',
  TOPIC_INVALID: '題目需為 1～20 個字，不可含控制字元，也不能只有空白',
  MESSAGE_INVALID: '訊息需為 1～200 個字，不可含換行等控制字元，也不能只有空白',
  CHAT_RATE_LIMITED: `發言太快了，請稍候再送（間隔至少 ${CHAT_MIN_INTERVAL_MS / 1000} 秒）`,
  // 洩題冷卻期間的 RATE_LIMITED 專用文案（spec §9.1，決策 11：秒數由 SPOILER_COOLDOWN_MS 組字）
  SPOILER_COOLDOWN: `剛才的訊息含答案被擋下，請等 ${SPOILER_COOLDOWN_MS / 1000} 秒再發言`,
  ARTIST_INVALID: '歌手名稱需為 1～30 個字，不可含控制字元，也不能只有空白',
  ARTIST_NOT_FOUND: '找不到這位歌手的歌（至少要 5 首有試聽的歌），換一位試試',
  SPOILER_GUESS_DG: '猜答案請只輸入答案本身',
  SPOILER_DRAWER_DG: '訊息含有題目，不會送出（畫師與已猜對者不能透露答案）',
  SPOILER_GUESS_SG: '猜歌名請只輸入歌名本身',
};

const FAMILY = '👨‍👩‍👧';
const HEART = '❤️';
const ZWSP = '​';
const ZWJ = '‍';
const VS16 = '️';

// ── 測試框架（同既有協定測試）──
const R = [];
const check = (name, cond, extra = '') => R.push([cond ? 'PASS' : 'FAIL', name, cond ? '' : extra]);
const connect = (ns) => io(`${BASE}/${ns}`, { path: '/socket.io', transports: ['websocket'], forceNew: true, reconnection: false });
// ack 20 秒沒回（連線斷掉等）→ 回 { timeout: true }，讓斷言失敗而不是整檔卡住
const call = (s, ev, ...args) => new Promise((res) => { const t = setTimeout(() => res({ timeout: true, connected: s.connected }), 20_000); s.emit(ev, ...args, (r) => { clearTimeout(t); res(r); }); });
const once = (s, ev, ms = 4000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + ev)), ms); s.once(ev, (...a) => { clearTimeout(t); res(a); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const collect = (s, ev) => { const arr = []; s.on(ev, (p) => arr.push(p)); return arr; };
const until = async (pred, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(15); } return pred(); };
const j = (x) => JSON.stringify(x)?.slice(0, 300);
const isErr = (r, code, msg) => r?.ok === false && r.error === code && (msg === undefined || r.message === msg);
const rssMb = () => Number(execFileSync('ps', ['-o', 'rss=', '-p', SERVER_PID], { encoding: 'utf8' }).trim()) / 1024;
const healthy = async () => { try { const r = await fetch(`${BASE}/healthz`); return r.ok && (await r.json()).ok === true; } catch { return false; } };

const open = async (ns) => { const s = connect(ns); await once(s, 'connect'); return s; };
const joinAs = async (ns, nick) => {
  const s = await open(ns);
  const rounds = collect(s, 'round:update'), players = collect(s, 'players:update'), chat = collect(s, 'chat:message');
  const r = await call(s, 'player:join', { nickname: nick });
  if (!r?.ok) throw new Error(`${ns} join ${nick} failed ${j(r)}`);
  return { s, nick, id: r.data.snapshot.you, token: r.data.token, snap: r.data.snapshot, rounds, players, chat };
};
const say = (p, text) => call(p.s, 'chat:send', { text });

/** 三款共用的暱稱規則（§9.1）：零寬／全不可見 → NICKNAME_INVALID；同暱稱加 VS16、夾 ZWJ → NICKNAME_TAKEN；emoji 合法 */
async function nicknameRules(ns) {
  const x = await open(ns);
  for (const [label, nick] of [['零寬空白（冒充 Rex）', `Re${ZWSP}x`], ['全不可見 U+3164', 'ㅤ'], ['只有 ZWJ＋VS16', ZWJ + VS16], ['點字空白 U+2800', '⠀']]) {
    const r = await call(x, 'player:join', { nickname: nick });
    check(`${ns}：暱稱${label} → NICKNAME_INVALID、文案不變`, isErr(r, 'NICKNAME_INVALID', MSG.NICKNAME_INVALID), j(r));
  }
  const rex = await joinAs(ns, 'Rex');
  for (const [label, nick] of [['Rex＋VS16', `Rex${VS16}`], ['R＋ZWJ＋ex', `R${ZWJ}ex`]]) {
    const r = await call(x, 'player:join', { nickname: nick });
    check(`${ns}：暱稱 ${label} 與 Rex 同鍵 → NICKNAME_TAKEN`, isErr(r, 'NICKNAME_TAKEN', MSG.NICKNAME_TAKEN), j(r));
  }
  const fam = await call(x, 'player:join', { nickname: FAMILY });
  check(`${ns}：emoji 暱稱 ${FAMILY} 合法且原樣保存（未綁定 socket 被拒後可立刻重試）`, fam?.ok === true && fam.data.snapshot.players.some((p) => p.nickname === FAMILY), j(fam));
  const heart = await joinAs(ns, HEART);
  check(`${ns}：emoji 暱稱 ${HEART} 合法且原樣保存`, heart.snap.players.some((p) => p.nickname === HEART && p.id === heart.id));
  return { rex, fam: { s: x, id: fam?.data?.snapshot?.you, token: fam?.data?.token }, heart };
}

/** 已綁定 socket 的重複 join 節流（§9.1） */
async function joinThrottle(ns, p) {
  // 先等滿 1 秒受理一次，馬上連送：連送全部落在「距上次受理 < 1 秒」內
  await sleep(JOIN_MIN_INTERVAL_MS + 100);
  const first = await call(p.s, 'player:join', { nickname: p.nick });
  check(`${ns}：已加入 socket 滿 1 秒再送 player:join → 冪等成功（同 token、同 you）`, first?.ok === true && first.data.token === p.token && first.data.snapshot.you === p.id, j(first));
  const burst = [];
  for (let i = 0; i < 20; i++) burst.push(call(p.s, 'player:join', { nickname: p.nick }));
  const results = await Promise.all(burst);
  check(`${ns}：已加入 socket 連送 20 次 player:join（距上次受理 < 1 秒）→ 全部 RATE_LIMITED「操作太頻繁，請稍候再試」`,
    results.every((r) => isErr(r, 'RATE_LIMITED', MSG.JOIN_RATE_LIMITED)), j(results.find((r) => !isErr(r, 'RATE_LIMITED', MSG.JOIN_RATE_LIMITED))));
  await sleep(JOIN_MIN_INTERVAL_MS + 100);
  const again = await call(p.s, 'player:join', { nickname: 'whatever' });
  check(`${ns}：滿 1 秒再送 → 冪等成功（同 token、同 you）`, again?.ok === true && again.data.token === p.token && again.data.snapshot.you === p.id, j(again));
  const right = await call(p.s, 'player:join', { nickname: p.nick });
  check(`${ns}：受理後重新計時，立刻再送 → RATE_LIMITED`, isErr(right, 'RATE_LIMITED', MSG.JOIN_RATE_LIMITED), j(right));
}

// ═══════════════════════════════════════════════════════════════════
// 一、我畫你猜（/draw-guess）
// ═══════════════════════════════════════════════════════════════════
{
  const ns = 'draw-guess';
  const { rex: A } = await nicknameRules(ns);
  const B = await joinAs(ns, 'Bob');
  const C = await joinAs(ns, 'Carol');
  await joinThrottle(ns, B);

  // 題目
  check('draw-guess：volunteer → ok', (await call(A.s, 'round:volunteer'))?.ok === true);
  for (const [label, topic] of [['只有零寬空白', ZWSP], ['夾零寬空白', `蘋${ZWSP}果`], ['全不可見 U+3164', 'ㅤ'], ['只有 ZWJ', ZWJ]]) {
    const r = await call(A.s, 'round:setTopic', { topic });
    check(`draw-guess：題目${label} → TOPIC_INVALID、文案不變`, isErr(r, 'TOPIC_INVALID', MSG.TOPIC_INVALID), j(r));
  }
  const st = await call(A.s, 'round:setTopic', { topic: '蘋果' });
  check('draw-guess：題目「蘋果」→ ok，進 drawing', st?.ok === true && (await until(() => B.rounds.at(-1)?.phase === 'drawing')), j(st));

  // 聊天：零寬字元被拒、ZWJ 夾答案被擋
  const z = await say(B, `蘋${ZWSP}果`);
  check('draw-guess：聊天夾零寬空白 → MESSAGE_INVALID、文案不變', isErr(z, 'MESSAGE_INVALID', MSG.MESSAGE_INVALID), j(z));
  const zj = await say(A, `提示是蘋${ZWJ}果`);
  check('draw-guess：畫師訊息「蘋＋ZWJ＋果」→ SPOILER_BLOCKED（不被 ZWJ 繞過）', isErr(zj, 'SPOILER_BLOCKED', MSG.SPOILER_DRAWER_DG), j(zj));

  // 洩題冷卻：C 被擋後 3 秒內連送（含正確答案）一律 RATE_LIMITED
  const t0 = Date.now();
  const blocked = await say(C, '是蘋果嗎');
  check('draw-guess：猜題者「是蘋果嗎」→ SPOILER_BLOCKED', isErr(blocked, 'SPOILER_BLOCKED', MSG.SPOILER_GUESS_DG), j(blocked));
  const probes = await Promise.all(['蘋', '果', '是蘋嗎', '蘋果', '蘋果', '是蘋果'].map((t) => say(C, t)));
  check('draw-guess：被擋後立刻連送 6 則探測（含正確答案）→ 全部 RATE_LIMITED，專用文案「剛才的訊息含答案被擋下，請等 3 秒再發言」', probes.every((r) => isErr(r, 'RATE_LIMITED', MSG.SPOILER_COOLDOWN)), j(probes));
  await sleep(Math.max(0, t0 + SPOILER_COOLDOWN_MS - 500 - Date.now()));
  const late = await say(C, '蘋果');
  check('draw-guess：被擋後約 2.5 秒送正確答案 → 仍 RATE_LIMITED（專用文案）、不算猜對', isErr(late, 'RATE_LIMITED', MSG.SPOILER_COOLDOWN) && C.rounds.at(-1)?.correctIds?.includes(C.id) !== true, j(late));
  const other = await say(B, '香蕉？');
  check('draw-guess：冷卻只影響被擋的人（B 照常聊天）', other?.ok === true, j(other));
  const fast = await say(B, '再一則');
  check('draw-guess：一般 0.3 秒間隔的 RATE_LIMITED 仍是舊文案', isErr(fast, 'RATE_LIMITED', MSG.CHAT_RATE_LIMITED), j(fast));
  await sleep(Math.max(0, t0 + SPOILER_COOLDOWN_MS + 150 - Date.now()));
  const right = await say(C, '蘋果');
  check('draw-guess：滿 3 秒後送正確答案 → 猜對', right?.ok === true && (await until(() => C.rounds.at(-1)?.correctIds?.includes(C.id) === true)), j(right));
  check('draw-guess：沒有任何人收到含題目的訊息', [A, B, C].every((p) => !p.chat.some((m) => m.kind !== 'system' && m.text.normalize('NFKC').replace(/[\s​-‍️]/gu, '').includes('蘋果'))));

  // 筆畫上限：begin＋undo 迴圈。灌兩輪：第一輪含 V8／配置器擴張（RSS 不會馬上還給系統），第二輪應持平（不隨灌入量線性成長）
  const opsB = collect(B.s, 'draw:op');
  const flood = async (round) => {
    for (let i = 0; i < FLOOD; i++) {
      const strokeId = `f${round}-${i}`;
      A.s.emit('draw:op', { type: 'begin', strokeId, tool: 'pen', color: '#FFFFFF', size: 4, point: { x: 0.5, y: 0.5 } });
      A.s.emit('draw:op', { type: 'undo', strokeId });
      if (i % 2000 === 1999) await sleep(0); // 讓 socket 寫出，避免客戶端自己的緩衝暴增
    }
    // 同一連線事件依序處理：畫師之後的聊天 ack 回來時，迴圈內的 op 都已處理完
    await sleep(CHAT_MIN_INTERVAL_MS);
    return say(A, `flood-done-${round}`);
  };
  const rss0 = rssMb();
  const tFlood = Date.now();
  const marker = await flood(1);
  const floodMs = Date.now() - tFlood;
  check(`draw-guess：${FLOOD} 對 begin＋undo 送完 server 仍回 ack（${floodMs} ms）`, marker?.ok === true, j(marker));
  await until(() => B.chat.some((m) => m.text === 'flood-done-1'), 10_000);
  const begins = opsB.filter((o) => o.type === 'begin').length;
  const undos = opsB.filter((o) => o.type === 'undo').length;
  check(`draw-guess：只轉發前 ${MAX_STROKES_PER_ROUND} 個 begin（其後丟棄 strokeLimit）`, begins === MAX_STROKES_PER_ROUND, `begins=${begins}`);
  check(`draw-guess：undo 也只有 ${MAX_STROKES_PER_ROUND} 個被轉發（其後的 undo 對不到最後一筆被丟棄）`, undos === MAX_STROKES_PER_ROUND, `undos=${undos}`);
  await sleep(500);
  const rss1 = rssMb();
  const marker2 = await flood(2);
  await until(() => B.chat.some((m) => m.text === 'flood-done-2'), 10_000);
  await sleep(500);
  const rss2 = rssMb();
  check(`draw-guess：第二輪 ${FLOOD} 對全被丟棄、一則都沒轉發`, marker2?.ok === true && opsB.filter((o) => o.type === 'begin').length === MAX_STROKES_PER_ROUND, j(marker2));
  // Δ1（第一輪）只印出：含暫時性堆積擴張，受機器狀態影響，不斷言（水手長複驗 2026-11-10：Δ1 曾達 82.9 MB）
  console.log(`[info] RSS 第一輪 ${rss0.toFixed(1)} → ${rss1.toFixed(1)} MB（Δ1=${(rss1 - rss0).toFixed(1)}，不斷言）`);
  check(`draw-guess：第二輪 RSS 不再隨灌入量成長（${rss1.toFixed(1)} → ${rss2.toFixed(1)} MB，Δ2 < ${RSS_LIMIT_MB} MB）`,
    rss2 - rss1 < RSS_LIMIT_MB, `Δ2=${(rss2 - rss1).toFixed(1)} MB`);
  check('draw-guess：flood 後 /healthz 仍 ok', await healthy());
  A.s.emit('draw:op', { type: 'begin', strokeId: 'after-limit', tool: 'pen', color: '#FFFFFF', size: 4, point: { x: 0.1, y: 0.1 } });
  A.s.emit('draw:op', { type: 'end', strokeId: 'after-limit' });
  const late2 = await joinAs(ns, 'Late');
  check('draw-guess：上限後的新 begin 也被丟棄；新玩家照常加入、快照 ops 為空（全被 undo）', late2.snap.ops.length === 0 && late2.snap.round.phase === 'drawing', j(late2.snap.ops.slice(0, 3)));
  await sleep(CHAT_MIN_INTERVAL_MS);
  const after = await say(B, '還活著');
  check('draw-guess：flood 後照常聊天', after?.ok === true, j(after));
  for (const p of [A, B, C, late2]) p.s.disconnect();
}

// ═══════════════════════════════════════════════════════════════════
// 二、猜歌（/song-guess）
// ═══════════════════════════════════════════════════════════════════
const mockCount = async (term) => (await (await fetch(`${MOCK}/_mock/requests?term=${encodeURIComponent(term)}`)).json()).count;
const lookup = async (term) => {
  const body = await (await fetch(`${MOCK}/search?term=${encodeURIComponent(term)}&attribute=artistTerm&country=TW&media=music&entity=song&limit=200`)).json();
  return new Map(body.results.map((t) => [String(t.trackId), t.trackName]));
};
{
  const ns = 'song-guess';
  const { rex: A } = await nicknameRules(ns);
  const B = await joinAs(ns, 'Bob');
  const C = await joinAs(ns, 'Carol');
  await joinThrottle(ns, B);

  const z = await say(B, `答${ZWSP}案`);
  check('song-guess：聊天夾零寬空白 → MESSAGE_INVALID、文案不變', isErr(z, 'MESSAGE_INVALID', MSG.MESSAGE_INVALID), j(z));

  check('song-guess：volunteer → ok', (await call(A.s, 'round:volunteer'))?.ok === true);
  for (const [label, artist] of [['夾零寬空白', `孫${ZWSP}燕姿`], ['全不可見 U+3164', 'ㅤ'], ['只有 VS16', VS16]]) {
    const r = await call(A.s, 'round:setSource', { source: 'artist', artist, hot: true });
    check(`song-guess：歌手名${label} → ARTIST_INVALID、文案不變`, isErr(r, 'ARTIST_INVALID', MSG.ARTIST_INVALID), j(r));
  }

  // #7：0 筆不快取
  const NOBODY = '沒有這個人';
  const before = await mockCount(NOBODY);
  const nf1 = await call(A.s, 'round:setSource', { source: 'artist', artist: NOBODY, hot: true });
  const c1 = await mockCount(NOBODY);
  const nf2 = await call(A.s, 'round:setSource', { source: 'artist', artist: `${NOBODY} `, hot: true });
  const c2 = await mockCount(NOBODY);
  check('song-guess：查無的歌手 → ARTIST_NOT_FOUND（兩次）', isErr(nf1, 'ARTIST_NOT_FOUND', MSG.ARTIST_NOT_FOUND) && isErr(nf2, 'ARTIST_NOT_FOUND', MSG.ARTIST_NOT_FOUND), j([nf1, nf2]));
  check('song-guess：0 筆不寫快取 → 同鍵再查會再打一次上游（假 iTunes 計數 +1、+1）', c1 === before + 1 && c2 === before + 2, `before=${before} c1=${c1} c2=${c2}`);

  // 開局，洩題冷卻
  const titles = await lookup('孫燕姿');
  const ok = await call(A.s, 'round:setSource', { source: 'artist', artist: '孫燕姿', hot: true });
  check('song-guess：歌手「孫燕姿」→ ok', ok?.ok === true, j(ok));
  check('song-guess：進 playing（第 1 首）', await until(() => B.rounds.at(-1)?.phase === 'playing' && B.rounds.at(-1)?.song?.index === 1, 6000), j(B.rounds.at(-1)));
  const song = B.rounds.at(-1).song;
  const title = titles.get(/\/preview\/(\d+)\.m4a$/.exec(song.previewUrl)?.[1] ?? '') ?? '';
  // 去副標（spec §4 答案判定；同 song-guess-rules.mjs 的獨立實作）
  const stripped = title.replace(/[（(【[].*$/su, '').replace(/ - .*$/su, '').replace(/(^|[^a-z])(feat\.|ft\.|featuring(?![a-z])).*$/isu, '$1').trim();
  const main = stripped === '' ? title.trim() : stripped;
  check('song-guess：裁判查得到這首的歌名', main.length >= 2, `title=${title}`);
  const zwjMain = [...main].join(ZWJ);

  const t0 = Date.now();
  const blk = await say(B, `是${main}嗎`);
  check('song-guess：未猜對者「是<歌名>嗎」→ SPOILER_BLOCKED', isErr(blk, 'SPOILER_BLOCKED', MSG.SPOILER_GUESS_SG), j(blk));
  const probes = await Promise.all([main, `${main}吧`, '別首歌', main].map((t) => say(B, t)));
  check('song-guess：被擋後立刻連送（含正確歌名）→ 全部 RATE_LIMITED（專用文案）、不算猜對',
    probes.every((r) => isErr(r, 'RATE_LIMITED', MSG.SPOILER_COOLDOWN)) && !(B.rounds.at(-1)?.song?.correctIds ?? []).includes(B.id), j(probes));
  const cz = await say(C, `是${zwjMain}嗎`);
  check('song-guess：歌名逐字夾 ZWJ 仍被擋（SPOILER_BLOCKED）', isErr(cz, 'SPOILER_BLOCKED', MSG.SPOILER_GUESS_SG), j(cz));
  await sleep(Math.max(0, t0 + SPOILER_COOLDOWN_MS - 500 - Date.now()));
  const late = await say(B, main);
  check('song-guess：被擋後約 2.5 秒送正確歌名 → 仍 RATE_LIMITED（專用文案）', isErr(late, 'RATE_LIMITED', MSG.SPOILER_COOLDOWN), j(late));
  await sleep(Math.max(0, t0 + SPOILER_COOLDOWN_MS + 150 - Date.now()));
  const still = B.rounds.at(-1);
  const right = await say(B, main);
  check('song-guess：滿 3 秒後送正確歌名 → 猜對（同一首仍在播）',
    still?.phase === 'playing' && still.song?.index === 1 && right?.ok === true && (await until(() => (B.rounds.at(-1)?.song?.correctIds ?? []).includes(B.id))), j([still?.phase, right]));
  check('song-guess：沒有任何人收到含歌名的訊息', [A, B, C].every((p) => !p.chat.some((m) => m.kind === 'chat' && m.text.replace(/[​-‍️]/gu, '').includes(main))));
  for (const p of [A, B, C]) p.s.disconnect();
}

// ═══════════════════════════════════════════════════════════════════
// 三、繪圖比賽（/draw-contest）：只驗 shared 的不可見字元規則（暱稱、題目、聊天）
// ═══════════════════════════════════════════════════════════════════
{
  const ns = 'draw-contest';
  const { rex: A } = await nicknameRules(ns);
  const B = await joinAs(ns, 'Bob');
  const z = await say(B, `答${ZWSP}案`);
  check('draw-contest：聊天夾零寬空白 → MESSAGE_INVALID、文案不變', isErr(z, 'MESSAGE_INVALID', MSG.MESSAGE_INVALID), j(z));
  const emoji = await say(A, `${FAMILY}${HEART}`);
  check('draw-contest：emoji 聊天照常', emoji?.ok === true, j(emoji));
  check('draw-contest：volunteer → ok', (await call(A.s, 'round:volunteer'))?.ok === true);
  for (const [label, topic] of [['只有零寬空白', ZWSP], ['夾零寬空白', `蘋${ZWSP}果`], ['全不可見 U+3164', 'ㅤ']]) {
    const r = await call(A.s, 'round:setTopic', { topic });
    check(`draw-contest：題目${label} → TOPIC_INVALID`, isErr(r, 'TOPIC_INVALID'), j(r));
  }
  check('draw-contest：取消出題 → ok', (await call(A.s, 'round:cancel'))?.ok === true);
  for (const p of [A, B]) p.s.disconnect();
}

check('結束時 /healthz 仍 ok', await healthy());

// ── 結果 ──
for (const [s, n, e] of R) console.log(`${s}  ${n}${e ? `  ← ${e}` : ''}`);
const failed = R.filter(([s]) => s === 'FAIL').length;
console.log(`\n${R.length - failed}/${R.length} PASS`);
process.exit(failed === 0 ? 0 : 1);
