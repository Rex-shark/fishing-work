// Phase 2 協定測試：回合狀態機、topic 遮罩、筆跡中繼與正規化、人數上限（spec §4/§5）
// 計時注入較短的值（ENDED、GRACE、部分案例的 CHOOSING）；其餘行為與正式環境相同。
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  MAX_PLAYERS,
  PALETTE,
  type ChatMessage,
  type DrawOp,
  type RoundPublic,
} from '@fishing-work/shared';
import type { AppOptions } from '../../src/app';
import {
  collect,
  join,
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

let srv: TestServer | undefined;

beforeAll(() => silenceLogs());
afterEach(async () => {
  await srv?.stop();
  srv = undefined;
});

async function start(options: AppOptions = {}): Promise<TestServer> {
  srv = await startServer({ ...options, durations: { endedMs: ENDED_MS, graceMs: GRACE_MS, ...options.durations } });
  return srv;
}

interface Client {
  s: ClientSocket;
  id: string;
  token: string;
  rounds: RoundPublic[];
  ops: DrawOp[];
  chat: ChatMessage[];
}

/** 連線、先掛好收集器再 join（避免漏掉 ack 之後緊接的廣播） */
async function client(server: TestServer, nickname: string): Promise<Client> {
  const s = await server.connect();
  const rounds = collect<RoundPublic>(s, 'round:update');
  const ops = collect<DrawOp>(s, 'draw:op');
  const chat = collect<ChatMessage>(s, 'chat:message');
  const r = await joinOk(s, nickname);
  return { s, id: r.snapshot.you, token: r.token, rounds, ops, chat };
}

const begin = (strokeId: string): DrawOp => ({
  type: 'begin',
  strokeId,
  tool: 'pen',
  color: PALETTE[2],
  size: 8,
  point: { x: 0.25, y: 0.5 },
});
const move = (strokeId: string): DrawOp => ({ type: 'move', strokeId, points: [{ x: 0.3, y: 0.5 }, { x: 0.35, y: 0.55 }] });
const end = (strokeId: string): DrawOp => ({ type: 'end', strokeId });

/** A、B 加入 → A 自願 → A 出題「蘋果」 */
async function drawingWithAB(options: AppOptions = {}) {
  const server = await start(options);
  const a = await client(server, 'Alice');
  const b = await client(server, 'Bob');
  expect(await request(a.s, 'round:volunteer')).toEqual({ ok: true });
  expect(await request(a.s, 'round:setTopic', { topic: '蘋果' })).toEqual({ ok: true });
  await waitFor(() => b.rounds.at(-1)?.phase === 'drawing', 3000, 'B 收到 drawing');
  return { server, a, b };
}

describe('e2e Phase 2：volunteer', () => {
  it('A、B 加入 → A volunteer → 雙方收到 round:update（choosing、drawerId = A、有出題期限）', async () => {
    const server = await start();
    const a = await client(server, 'Alice');
    const b = await client(server, 'Bob');
    const before = Date.now();
    expect(await request(a.s, 'round:volunteer')).toEqual({ ok: true });
    await waitFor(() => a.rounds.length === 1 && b.rounds.length === 1);
    for (const r of [a.rounds[0], b.rounds[0]]) {
      expect(r).toMatchObject({ phase: 'choosing', drawerId: a.id, topic: null, topicLength: null, endReason: null });
      expect(r.endsAt).toBeGreaterThanOrEqual(before + 59_000);
    }
  });

  it('人數不足 → NOT_ENOUGH_PLAYERS；回合進行中 → ROUND_BUSY；未加入 → NOT_IN_ROOM', async () => {
    const server = await start();
    const a = await client(server, 'Alice');
    expect(await request(a.s, 'round:volunteer')).toMatchObject({ ok: false, error: 'NOT_ENOUGH_PLAYERS' });
    const b = await client(server, 'Bob');
    expect(await request(a.s, 'round:volunteer')).toEqual({ ok: true });
    expect(await request(b.s, 'round:volunteer')).toMatchObject({ ok: false, error: 'ROUND_BUSY' });
    const stranger = await server.connect();
    const r = await request(stranger, 'round:volunteer');
    expect(r).toMatchObject({ ok: false, error: 'NOT_IN_ROOM' });
    expect(!r.ok && typeof r.message).toBe('string');
  });
});

describe('e2e Phase 2：setTopic 與 topic 遮罩', () => {
  it('A 的 round:update 有 topic；B 的 topic = null 且有 topicLength；B 收到 draw:op clear、A 不收；system「A 開始作畫」', async () => {
    const { a, b } = await drawingWithAB();
    await waitFor(() => a.rounds.at(-1)?.phase === 'drawing');
    expect(a.rounds.at(-1)).toMatchObject({ phase: 'drawing', topic: '蘋果', topicLength: 2, drawerId: a.id });
    expect(b.rounds.at(-1)).toMatchObject({ phase: 'drawing', topic: null, topicLength: 2 });
    await waitFor(() => b.ops.length === 1);
    expect(b.ops).toEqual([{ type: 'clear' }]);
    await waitFor(() => a.chat.some((m) => m.text === 'Alice 開始作畫') && b.chat.some((m) => m.text === 'Alice 開始作畫'));
    await sleep(50);
    expect(a.ops).toEqual([]);
  });

  it('非畫師出題 → NOT_DRAWER；payload 不合法 → TOPIC_INVALID', async () => {
    const server = await start();
    const a = await client(server, 'Alice');
    const b = await client(server, 'Bob');
    await request(a.s, 'round:volunteer');
    expect(await request(b.s, 'round:setTopic', { topic: '蘋果' })).toMatchObject({ ok: false, error: 'NOT_DRAWER' });
    expect(await request(a.s, 'round:setTopic', { topic: 123 })).toMatchObject({ ok: false, error: 'TOPIC_INVALID' });
    expect(await request(a.s, 'round:setTopic')).toMatchObject({ ok: false, error: 'TOPIC_INVALID' });
    expect(await request(a.s, 'round:setTopic', { topic: '   ' })).toMatchObject({ ok: false, error: 'TOPIC_INVALID' });
    expect(await request(a.s, 'round:setTopic', { topic: '字'.repeat(21) })).toMatchObject({ ok: false, error: 'TOPIC_INVALID' });
  });
});

describe('e2e Phase 2：筆跡中繼', () => {
  it('A 送 begin/move/end → B 收到相同 op（順序一致）、A 不收到自己的 op', async () => {
    const { a, b } = await drawingWithAB();
    await waitFor(() => b.ops.length === 1); // setTopic 的 clear
    const list = [begin('k1'), move('k1'), end('k1')];
    for (const op of list) rawEmit(a.s, 'draw:op', op);
    await waitFor(() => b.ops.length === 4);
    expect(b.ops.slice(1)).toEqual(list);
    await sleep(50);
    expect(a.ops).toEqual([]);
  });

  it('B（非畫師）送 draw:op → 丟棄：A、C 都收不到，也不進歷史', async () => {
    const { server, a, b } = await drawingWithAB();
    const c = await client(server, 'Carol');
    rawEmit(b.s, 'draw:op', begin('evil'));
    rawEmit(b.s, 'draw:op', { type: 'clear' });
    // 畫師送一筆當作標記：C 收到標記時，B 的 op（更早送出）若被轉發應已先到
    rawEmit(a.s, 'draw:op', begin('mark'));
    await waitFor(() => c.ops.length === 1);
    await sleep(100);
    expect(c.ops).toEqual([begin('mark')]);
    expect(a.ops).toEqual([]);
    const late = await joinOk(await server.connect(), 'Late');
    expect(late.snapshot.ops).toEqual([begin('mark')]);
  });

  it('畫師送不合法 op（色碼格式不合、座標超出、未知 type）→ 靜默丟棄、不斷線', async () => {
    const { a, b } = await drawingWithAB();
    await waitFor(() => b.ops.length === 1);
    // Phase 6 起任意 #RRGGBB 合法（PALETTE 只是預設色塊）；短碼不合法
    rawEmit(a.s, 'draw:op', { ...begin('k1'), color: '#fff' });
    rawEmit(a.s, 'draw:op', { ...begin('k2'), point: { x: 2, y: 0 } });
    rawEmit(a.s, 'draw:op', { type: 'fill' });
    rawEmit(a.s, 'draw:op', null);
    rawEmit(a.s, 'draw:op', begin('ok'));
    await waitFor(() => b.ops.length === 2);
    expect(b.ops[1]).toEqual(begin('ok'));
    expect(a.s.connected).toBe(true);
  });

  it('C 中途加入：快照含 ops、round.topic = null、有 topicLength', async () => {
    const { server, a, b } = await drawingWithAB();
    const list = [begin('k1'), move('k1'), end('k1')];
    for (const op of list) rawEmit(a.s, 'draw:op', op);
    await waitFor(() => b.ops.length === 4);
    const c = await joinOk(await server.connect(), 'Carol');
    expect(c.snapshot.ops).toEqual(list);
    expect(c.snapshot.round).toMatchObject({ phase: 'drawing', topic: null, topicLength: 2, drawerId: a.id });
  });

  it('A undo → B 收到 undo；之後中途加入者的快照已正規化（不含被撤的筆畫、不含 undo）；clear 同理', async () => {
    const { server, a, b } = await drawingWithAB();
    const s1 = [begin('k1'), move('k1'), end('k1')];
    const s2 = [begin('k2'), move('k2'), end('k2')];
    for (const op of [...s1, ...s2]) rawEmit(a.s, 'draw:op', op);
    rawEmit(a.s, 'draw:op', { type: 'undo', strokeId: 'k2' });
    await waitFor(() => b.ops.length === 8);
    expect(b.ops.at(-1)).toEqual({ type: 'undo', strokeId: 'k2' });
    const c = await joinOk(await server.connect(), 'Carol');
    expect(c.snapshot.ops).toEqual(s1);
    rawEmit(a.s, 'draw:op', { type: 'clear' });
    await waitFor(() => b.ops.length === 9);
    expect(b.ops.at(-1)).toEqual({ type: 'clear' });
    const d = await joinOk(await server.connect(), 'Dave');
    expect(d.snapshot.ops).toEqual([]);
  });
});

describe('e2e Phase 2：cancel／abort／end', () => {
  it('drawing 中 A cancel → 所有人收到 ended（揭曉 topic）與揭曉訊息，ENDED 後收到 idle（endReason 保留、ops 保留）', async () => {
    const { server, a, b } = await drawingWithAB();
    const c = await client(server, 'Carol');
    rawEmit(a.s, 'draw:op', begin('k1'));
    await waitFor(() => c.ops.length === 1);
    expect(await request(a.s, 'round:cancel')).toEqual({ ok: true });
    for (const x of [a, b, c]) {
      await waitFor(() => x.rounds.some((r) => r.phase === 'ended'), 3000, 'ended');
      expect(x.rounds.find((r) => r.phase === 'ended')).toMatchObject({ topic: '蘋果', endReason: 'cancelled', drawerId: a.id });
      await waitFor(() => x.chat.some((m) => m.text === '題目是 蘋果（畫師取消）'));
    }
    for (const x of [a, b, c]) {
      await waitFor(() => x.rounds.at(-1)?.phase === 'idle', ENDED_MS + 2000, 'idle');
      expect(x.rounds.at(-1)).toMatchObject({ phase: 'idle', drawerId: null, topic: null, endReason: 'cancelled' });
    }
    const late = await joinOk(await server.connect(), 'Late');
    expect(late.snapshot.ops).toEqual([begin('k1')]);
    expect(late.snapshot.players.every((p) => !p.isDrawer)).toBe(true);
  });

  it('choosing 中 A cancel → 直接回 idle（不經 ended）、「A 取消出題」', async () => {
    const server = await start();
    const a = await client(server, 'Alice');
    const b = await client(server, 'Bob');
    await request(a.s, 'round:volunteer');
    expect(await request(a.s, 'round:cancel')).toEqual({ ok: true });
    await waitFor(() => b.rounds.length === 2);
    expect(b.rounds.map((r) => r.phase)).toEqual(['choosing', 'idle']);
    expect(b.rounds[1].endReason).toBe('cancelled');
    await waitFor(() => b.chat.some((m) => m.text === 'Alice 取消出題'));
    expect(await request(b.s, 'round:cancel')).toMatchObject({ ok: false, error: 'NOT_DRAWER' });
  });

  it('choosing 逾時（注入 CHOOSING）→ 直接回 idle、「A 出題逾時」', async () => {
    const server = await start({ durations: { choosingMs: 200 } });
    const a = await client(server, 'Alice');
    const b = await client(server, 'Bob');
    await request(a.s, 'round:volunteer');
    await waitFor(() => b.rounds.at(-1)?.phase === 'idle' && b.rounds.length === 2, 2000, 'idle');
    expect(b.rounds[1]).toMatchObject({ endReason: 'cancelled', drawerId: null });
    await waitFor(() => b.chat.some((m) => m.text === 'Alice 出題逾時'));
  });

  it('drawing 逾時（注入 ROUND）→ ended(timeout) → idle', async () => {
    const { b } = await drawingWithAB({ durations: { roundMs: 300 } });
    await waitFor(() => b.rounds.at(-1)?.phase === 'idle', 3000, 'idle');
    expect(b.rounds.map((r) => [r.phase, r.endReason])).toEqual([
      ['choosing', null],
      ['drawing', null],
      ['ended', 'timeout'],
      ['idle', 'timeout'],
    ]);
  });
});

describe('e2e Phase 2：畫師斷線', () => {
  it('畫師寬限期內重連：回合不中止，快照看得到 topic 與 ops，仍可畫', async () => {
    const { server, a, b } = await drawingWithAB();
    rawEmit(a.s, 'draw:op', begin('k1'));
    await waitFor(() => b.ops.length === 2);
    a.s.disconnect();
    await sleep(100);
    const a2 = await server.connect();
    const back = await joinOk(a2, 'x', a.token);
    expect(back.snapshot.you).toBe(a.id);
    expect(back.snapshot.round).toMatchObject({ phase: 'drawing', topic: '蘋果', drawerId: a.id });
    expect(back.snapshot.ops).toEqual([begin('k1')]);
    rawEmit(a2, 'draw:op', move('k1'));
    await waitFor(() => b.ops.length === 3);
    await sleep(GRACE_MS + 200);
    expect(b.rounds.at(-1)?.phase).toBe('drawing');
  });

  it('畫師寬限逾期 → 所有人收到 ended(drawerLeft)', async () => {
    const { a, b } = await drawingWithAB();
    a.s.disconnect();
    await waitFor(() => b.rounds.some((r) => r.phase === 'ended'), GRACE_MS + 2000, 'ended');
    expect(b.rounds.find((r) => r.phase === 'ended')).toMatchObject({ endReason: 'drawerLeft', topic: '蘋果' });
    await waitFor(() => b.chat.some((m) => m.text === '題目是 蘋果（畫師離開）'));
  });
});

describe('e2e Phase 2：人數上限', () => {
  it(`第 ${MAX_PLAYERS + 1} 位新玩家 → ROOM_FULL；接管不受限`, async () => {
    const server = await start();
    const joined = [];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const s = await server.connect();
      joined.push({ s, r: await joinOk(s, `p${i}`) });
    }
    const extra = await server.connect();
    const r = await join(extra, { nickname: 'extra' });
    expect(r).toMatchObject({ ok: false, error: 'ROOM_FULL' });
    expect(!r.ok && r.message.length).toBeGreaterThan(0);
    // 滿房時接管仍可
    const again = await joinOk(await server.connect(), 'x', joined[0].r.token);
    expect(again.snapshot.you).toBe(joined[0].r.snapshot.you);
  });
});
