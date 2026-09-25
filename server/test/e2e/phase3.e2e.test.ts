// Phase 3 協定測試：聊天、猜題判定、防洩題、間隔限制、計分、全員猜對（spec §4/§5）
// 時鐘以「真實時間 + 可調偏移」注入：計時器照真實時間跑，但可把 now() 往前撥 CHAT_MIN_INTERVAL_MS，免得每則訊息都要 sleep。
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  CHAT_MAX,
  CHAT_MIN_INTERVAL_MS,
  normalizeAnswer,
  type ChatMessage,
  type PlayerPublic,
  type RoundPublic,
} from '@fishing-work/shared';
import type { AppOptions } from '../../src/app';
import type { Clock } from '../../src/games/draw-guess/room';
import { guesserScore } from '../../src/games/draw-guess/scoring';
import {
  collect,
  joinOk,
  rawEmit,
  request,
  silenceLogs,
  sleep,
  startServer,
  waitFor,
  type ClientSocket,
  type TestServer,
} from './helpers';

const ENDED_MS = 300;
const GRACE_MS = 500;
const TOPIC = 'Apple';
const GUESS_ONLY = '猜答案請只輸入答案本身';

/** now() = Date.now() + offset；setTimeout 用真實計時 */
class SkewClock implements Clock {
  offset = 0;
  now(): number {
    return Date.now() + this.offset;
  }
  setTimeout(fn: () => void, ms: number): unknown {
    return setTimeout(fn, ms);
  }
  clearTimeout(handle: unknown): void {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  }
  /** 把時鐘往前撥一個聊天間隔，下一則訊息不會被 RATE_LIMITED */
  gap(): void {
    this.offset += CHAT_MIN_INTERVAL_MS;
  }
}

let srv: TestServer | undefined;
let clock: SkewClock;

beforeAll(() => silenceLogs());
afterEach(async () => {
  await srv?.stop();
  srv = undefined;
});

async function start(options: AppOptions = {}): Promise<TestServer> {
  clock = new SkewClock();
  srv = await startServer({ clock, ...options, durations: { endedMs: ENDED_MS, graceMs: GRACE_MS, ...options.durations } });
  return srv;
}

interface Client {
  s: ClientSocket;
  id: string;
  nickname: string;
  rounds: RoundPublic[];
  players: PlayerPublic[][];
  chat: ChatMessage[];
}

/** 連線、先掛好收集器再 join（避免漏掉 ack 之後緊接的廣播） */
async function client(server: TestServer, nickname: string): Promise<Client> {
  const s = await server.connect();
  const rounds = collect<RoundPublic>(s, 'round:update');
  const players = collect<PlayerPublic[]>(s, 'players:update');
  const chat = collect<ChatMessage>(s, 'chat:message');
  const r = await joinOk(s, nickname);
  return { s, id: r.snapshot.you, nickname, rounds, players, chat };
}

/** 送 chat:send 並等 ack；送之前把時鐘撥過聊天間隔 */
function say(c: Client, text: unknown) {
  clock.gap();
  return request(c.s, 'chat:send', { text });
}

let markerSeq = 0;
/** 由 from 送一則標記訊息，等所有人都收到；之後可斷言「在它之前沒人收到某則訊息」（同一連線的事件依序到達） */
async function barrier(from: Client, all: Client[]): Promise<void> {
  const text = `marker-${++markerSeq}`;
  expect(await say(from, text)).toEqual({ ok: true });
  await waitFor(() => all.every((c) => c.chat.some((m) => m.text === text)), 3000, `所有人收到 ${text}`);
}

function lastPlayers(c: Client): PlayerPublic[] {
  const p = c.players.at(-1);
  if (!p) throw new Error('沒有 players:update');
  return p;
}

/** A（畫師）、B、C 加入 → A 出題 TOPIC → 三人都收到 drawing */
async function drawingABC() {
  const server = await start();
  const a = await client(server, 'Alice');
  const b = await client(server, 'Bob');
  const c = await client(server, 'Carol');
  expect(await request(a.s, 'round:volunteer')).toEqual({ ok: true });
  expect(await request(a.s, 'round:setTopic', { topic: TOPIC })).toEqual({ ok: true });
  const all = [a, b, c];
  await waitFor(() => all.every((x) => x.rounds.at(-1)?.phase === 'drawing'), 3000, 'drawing');
  return { server, a, b, c, all };
}

/** 收到的訊息中，有沒有「原文」（含題目且不是 system 揭曉訊息） */
function leaked(c: Client): ChatMessage[] {
  const t = normalizeAnswer(TOPIC);
  return c.chat.filter((m) => m.kind !== 'system' && normalizeAnswer(m.text).includes(t));
}

describe('e2e Phase 3：猜題與防洩題（A 畫師、B／C 猜題）', () => {
  it('完整流程：猜錯廣播 → 猜對只廣播「X 猜對了」→ 已猜對者／畫師洩題被擋 → 畫師一般聊天 → 猜題者含題目被擋 → 全員猜對 → ended → idle', async () => {
    const { server, a, b, c, all } = await drawingABC();
    const startedAt = b.rounds.at(-1)?.startedAt;
    expect(typeof startedAt).toBe('number');

    // B 猜錯 → 所有人收到 kind chat
    expect(await say(b, '香蕉？')).toEqual({ ok: true });
    await waitFor(() => all.every((x) => x.chat.some((m) => m.kind === 'chat' && m.text === '香蕉？')), 3000, '猜錯廣播');
    expect(a.chat.find((m) => m.text === '香蕉？')).toMatchObject({ kind: 'chat', fromId: b.id, nickname: 'Bob' });

    // B 猜對（全形＋大小寫＋空白變體）→ 所有人收到 correct「Bob 猜對了」、沒有人收到原文
    clock.gap();
    const before = clock.now();
    const r = await request(b.s, 'chat:send', { text: ' ａＰｐ ＬＥ　' });
    const after = clock.now();
    expect(r).toEqual({ ok: true });
    await waitFor(() => all.every((x) => x.chat.some((m) => m.kind === 'correct')), 3000, 'correct 廣播');
    for (const x of all) {
      expect(x.chat.filter((m) => m.kind === 'correct')).toMatchObject([{ kind: 'correct', text: 'Bob 猜對了', fromId: b.id }]);
      expect(x.chat.some((m) => m.text.includes('ａＰｐ'))).toBe(false);
      expect(leaked(x)).toEqual([]);
    }
    // 分數符合公式：介於送出前與 ack 後的時間點所算的分數之間
    await waitFor(() => lastPlayers(a).find((p) => p.id === b.id)?.hasGuessed === true, 3000, 'B hasGuessed');
    const bScore = lastPlayers(a).find((p) => p.id === b.id)?.score ?? -1;
    expect(bScore).toBeLessThanOrEqual(guesserScore(startedAt as number, before));
    expect(bScore).toBeGreaterThanOrEqual(guesserScore(startedAt as number, after));
    expect(bScore).toBeGreaterThanOrEqual(50);
    expect(bScore).toBeLessThanOrEqual(100);

    // 猜對時加發 round:update（§5「猜對時的廣播」）：correctIds 含 B、仍是 drawing；A（畫師）看得到 topic、其他人 null
    await waitFor(() => all.every((x) => x.rounds.at(-1)?.correctIds.includes(b.id) === true), 3000, 'round:update correctIds 含 B');
    expect(a.rounds.at(-1)).toMatchObject({ phase: 'drawing', topic: TOPIC, correctIds: [b.id] });
    expect(b.rounds.at(-1)).toMatchObject({ phase: 'drawing', topic: null, correctIds: [b.id] });
    expect(c.rounds.at(-1)).toMatchObject({ phase: 'drawing', topic: null, correctIds: [b.id] });

    // B（已猜對）送含題目的訊息 → SPOILER_BLOCKED，沒人收到
    const rb = await say(b, '就是 apple 啦');
    expect(rb).toMatchObject({ ok: false, error: 'SPOILER_BLOCKED' });
    expect(!rb.ok && rb.message.length > 0).toBe(true);
    // A（畫師）送含題目 → SPOILER_BLOCKED
    expect(await say(a, 'APPLE')).toMatchObject({ ok: false, error: 'SPOILER_BLOCKED' });
    // C（未猜對的猜題者）送含題目但不相符 → SPOILER_BLOCKED「猜答案請只輸入答案本身」
    expect(await say(c, '是 apple 嗎')).toEqual({ ok: false, error: 'SPOILER_BLOCKED', message: GUESS_ONLY });
    // A 送不含題目 → 廣播
    expect(await say(a, '是水果')).toEqual({ ok: true });
    await barrier(a, all);
    for (const x of all) {
      expect(x.chat.some((m) => m.text === '是水果' && m.kind === 'chat' && m.fromId === a.id)).toBe(true);
      expect(leaked(x)).toEqual([]);
    }

    // 中途加入者 D：快照含最近聊天（猜錯、correct、畫師聊天），不含原文與被擋的訊息
    const dSock = await server.connect();
    const d = await joinOk(dSock, 'Dave');
    const texts = d.snapshot.chat.map((m) => m.text);
    expect(texts).toEqual(expect.arrayContaining(['香蕉？', 'Bob 猜對了', '是水果', 'Dave 加入']));
    expect(d.snapshot.chat.filter((m) => m.kind !== 'system' && normalizeAnswer(m.text).includes('apple'))).toEqual([]);
    dSock.disconnect(); // D 寬限期中仍算猜題者 → 等 D 寬限逾期離開，才不會卡住全員猜對
    await waitFor(() => lastPlayers(a).length === 3, 3000, 'D 寬限逾期離開');

    // C 猜對 → 全員猜對 → ended（allGuessed、揭曉 topic、A +40）
    expect(await say(c, 'apple')).toEqual({ ok: true });
    await waitFor(() => all.every((x) => x.rounds.at(-1)?.phase === 'ended'), 3000, 'ended');
    for (const x of all) {
      expect(x.rounds.at(-1)).toMatchObject({ phase: 'ended', endReason: 'allGuessed', topic: TOPIC });
      expect(x.rounds.at(-1)?.correctIds).toEqual([b.id, c.id]);
    }
    await waitFor(() => all.every((x) => x.chat.some((m) => m.text === `題目是 ${TOPIC}（全員猜對）`)), 3000, '揭曉訊息');
    await waitFor(() => lastPlayers(b).find((p) => p.id === a.id)?.score === 40, 3000, 'A +40');

    // ENDED 後 idle：hasGuessed 全清
    await waitFor(() => all.every((x) => x.rounds.at(-1)?.phase === 'idle'), 3000, 'idle');
    await waitFor(() => all.every((x) => lastPlayers(x).every((p) => !p.hasGuessed && !p.isDrawer)), 3000, 'hasGuessed 全清');
    expect(lastPlayers(a).find((p) => p.id === a.id)?.score).toBe(40);
  });

  it.each([
    ['全形', 'ＡＰＰＬＥ'],
    ['大小寫', 'aPpLe'],
    ['空白', ' a p p l e '],
  ])('猜對變體（%s）→ 所有人收到「Bob 猜對了」、沒有人收到原文', async (_label, guess) => {
    const { b, all } = await drawingABC();
    expect(await say(b, guess)).toEqual({ ok: true });
    await waitFor(() => all.every((x) => x.chat.some((m) => m.kind === 'correct')), 3000, 'correct');
    await barrier(all[0], all);
    for (const x of all) {
      expect(x.chat.filter((m) => m.kind === 'correct').map((m) => m.text)).toEqual(['Bob 猜對了']);
      expect(x.chat.some((m) => m.text === guess || m.text === guess.trim())).toBe(false);
      expect(leaked(x)).toEqual([]);
    }
  });

  it('被擋的訊息沒有任何人收到（包括本人），也不進快照', async () => {
    const { server, a, b, c, all } = await drawingABC();
    expect(await say(c, '蘋果還是 Apple')).toMatchObject({ ok: false, error: 'SPOILER_BLOCKED' });
    expect(await say(a, '提示 apple')).toMatchObject({ ok: false, error: 'SPOILER_BLOCKED' });
    await barrier(b, all);
    for (const x of all) expect(leaked(x)).toEqual([]);
    const late = await joinOk(await server.connect(), 'Late');
    expect(late.snapshot.chat.some((m) => m.text.includes('Apple') || m.text.includes('apple'))).toBe(false);
  });
});

describe('e2e Phase 3：非 drawing 階段', () => {
  it('idle、choosing、ended 送題目文字 → 一般聊天廣播', async () => {
    const server = await start();
    const a = await client(server, 'Alice');
    const b = await client(server, 'Bob');
    // idle
    expect(await say(b, TOPIC)).toEqual({ ok: true });
    // choosing
    expect(await request(a.s, 'round:volunteer')).toEqual({ ok: true });
    expect(await say(b, `畫 ${TOPIC}`)).toEqual({ ok: true });
    // ended（drawing 後畫師放棄）
    expect(await request(a.s, 'round:setTopic', { topic: TOPIC })).toEqual({ ok: true });
    expect(await request(a.s, 'round:cancel')).toEqual({ ok: true });
    await waitFor(() => b.rounds.at(-1)?.phase === 'ended', 3000, 'ended');
    expect(await say(a, `答案是 ${TOPIC}`)).toEqual({ ok: true });
    await waitFor(() => b.chat.some((m) => m.text === `答案是 ${TOPIC}`), 3000, 'ended 聊天');
    const kinds = b.chat.filter((m) => m.kind !== 'system').map((m) => [m.kind, m.text]);
    expect(kinds).toEqual([
      ['chat', TOPIC],
      ['chat', `畫 ${TOPIC}`],
      ['chat', `答案是 ${TOPIC}`],
    ]);
    expect(b.players.at(-1)?.every((p) => !p.hasGuessed)).toBe(true);
  });
});

describe('e2e Phase 3：驗證與間隔限制', () => {
  it(`間隔 < ${CHAT_MIN_INTERVAL_MS} ms → RATE_LIMITED（真實時鐘連送兩則）`, async () => {
    const server = await start();
    const a = await client(server, 'Alice');
    expect(await request(a.s, 'chat:send', { text: '一' })).toEqual({ ok: true });
    const r = await request(a.s, 'chat:send', { text: '二' });
    expect(r).toMatchObject({ ok: false, error: 'RATE_LIMITED' });
    expect(!r.ok && r.message.length > 0).toBe(true);
    await sleep(CHAT_MIN_INTERVAL_MS + 20);
    expect(await request(a.s, 'chat:send', { text: '三' })).toEqual({ ok: true });
  });

  it.each([
    ['空字串', { text: '' }],
    ['全空白', { text: '   ' }],
    [`${CHAT_MAX + 1} 字`, { text: '字'.repeat(CHAT_MAX + 1) }],
    ['含換行', { text: '你\n好' }],
    ['含控制字元', { text: '你\u0007好' }],
    ['text 不是字串', { text: 123 }],
    ['payload 不是物件', 'hello'],
    ['payload 為 null', null],
  ])('不合法（%s）→ MESSAGE_INVALID', async (_label, payload) => {
    const server = await start();
    const a = await client(server, 'Alice');
    const r = await request(a.s, 'chat:send', payload);
    expect(r).toMatchObject({ ok: false, error: 'MESSAGE_INVALID' });
    expect(!r.ok && r.message.length > 0).toBe(true);
  });

  it(`剛好 ${CHAT_MAX} 字 → 可送；未加入 → NOT_IN_ROOM`, async () => {
    const server = await start();
    const a = await client(server, 'Alice');
    expect(await request(a.s, 'chat:send', { text: '字'.repeat(CHAT_MAX) })).toEqual({ ok: true });
    const stranger = await server.connect();
    expect(await request(stranger, 'chat:send', { text: 'hi' })).toMatchObject({ ok: false, error: 'NOT_IN_ROOM' });
  });

  it('不帶 ack 的 chat:send 照常執行（§9），伺服器不出錯', async () => {
    const server = await start();
    const a = await client(server, 'Alice');
    const b = await client(server, 'Bob');
    rawEmit(a.s, 'chat:send', { text: 'no ack' });
    await waitFor(() => b.chat.some((m) => m.text === 'no ack'), 3000, '無 ack 訊息廣播');
    expect(await say(a, 'still alive')).toEqual({ ok: true });
  });
});
