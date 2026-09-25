// Phase 6 協定測試：畫具強化後的 draw:op 驗證（spec §4 COLOR_PATTERN、BRUSH_MIN / BRUSH_MAX；§5「draw:op 驗證」）
// 任意 #RRGGBB（大小寫皆可）與整數粗細 1..64 通過並原樣轉發；短碼、8 碼、無 #、0、65、非整數一律靜默丟棄、不斷線。
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BRUSH_MAX, BRUSH_MIN, type DrawOp, type RoundPublic } from '@fishing-work/shared';
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

let srv: TestServer | undefined;

beforeAll(() => silenceLogs());
afterEach(async () => {
  await srv?.stop();
  srv = undefined;
});

interface Client {
  s: ClientSocket;
  rounds: RoundPublic[];
  ops: DrawOp[];
}

async function client(server: TestServer, nickname: string): Promise<Client> {
  const s = await server.connect();
  const rounds = collect<RoundPublic>(s, 'round:update');
  const ops = collect<DrawOp>(s, 'draw:op');
  await joinOk(s, nickname);
  return { s, rounds, ops };
}

type Begin = Extract<DrawOp, { type: 'begin' }>;
const begin = (strokeId: string, extra: Partial<Begin> = {}): Begin => ({
  type: 'begin',
  strokeId,
  tool: 'pen',
  color: '#FFFFFF',
  size: 4,
  point: { x: 0.5, y: 0.5 },
  ...extra,
});

/** A、B 加入 → A 出題進入 drawing；B 先收到 setTopic 的 clear */
async function drawingWithAB() {
  srv = await startServer();
  const a = await client(srv, 'Alice');
  const b = await client(srv, 'Bob');
  expect(await request(a.s, 'round:volunteer')).toEqual({ ok: true });
  expect(await request(a.s, 'round:setTopic', { topic: '彩虹' })).toEqual({ ok: true });
  await waitFor(() => b.rounds.at(-1)?.phase === 'drawing' && b.ops.length === 1, 3000, 'B 收到 drawing 與 clear');
  return { server: srv, a, b };
}

describe('e2e Phase 6：任意色與 1–64 粗細', () => {
  it('任意 #RRGGBB（含小寫、黑色）與邊界粗細 1、64 → 通過、原樣轉發、進快照', async () => {
    const { server, a, b } = await drawingWithAB();
    const legal: Begin[] = [
      begin('hue', { color: '#FF8000' }),
      begin('black', { color: '#000000' }),
      begin('lower', { color: '#ab12cd' }),
      begin('min', { size: BRUSH_MIN }),
      begin('max', { size: BRUSH_MAX }),
      begin('eraser', { tool: 'eraser', color: '#123456', size: 33 }),
    ];
    // 每筆都 end，避免依賴「新 begin 自動關閉舊 open stroke」
    for (const op of legal) {
      rawEmit(a.s, 'draw:op', op);
      rawEmit(a.s, 'draw:op', { type: 'end', strokeId: op.strokeId });
    }
    await waitFor(() => b.ops.length === 1 + legal.length * 2, 3000, 'B 收到全部合法 op');
    const received = b.ops.filter((o): o is Begin => o.type === 'begin');
    expect(received).toEqual(legal);

    const late = await joinOk(await server.connect(), 'Late');
    expect(late.snapshot.ops.filter((o) => o.type === 'begin')).toEqual(legal);
  });

  it('不合法的色碼與粗細 → 靜默丟棄、不斷線、不進歷史', async () => {
    const { server, a, b } = await drawingWithAB();
    const illegal: unknown[] = [
      begin('short', { color: '#fff' }),
      begin('no-hash', { color: 'FF8000' }),
      begin('rgba', { color: '#FF800080' }),
      begin('name', { color: 'red' }),
      { ...begin('num-color'), color: 0xff8000 },
      begin('zero', { size: 0 }),
      begin('over', { size: BRUSH_MAX + 1 }),
      begin('half', { size: 0.5 }),
      begin('frac', { size: 12.5 }),
      { ...begin('str-size'), size: '8' },
      { ...begin('eraser-bad'), tool: 'eraser', color: '#fff' },
    ];
    for (const op of illegal) rawEmit(a.s, 'draw:op', op);
    rawEmit(a.s, 'draw:op', begin('ok', { color: '#00FF00', size: 64 }));
    await waitFor(() => b.ops.length === 2, 3000, 'B 只收到合法那一筆');
    await sleep(100);
    expect(b.ops).toHaveLength(2);
    expect(b.ops[1]).toEqual(begin('ok', { color: '#00FF00', size: 64 }));
    expect(a.s.connected).toBe(true);

    const late = await joinOk(await server.connect(), 'Late');
    expect(late.snapshot.ops).toEqual([begin('ok', { color: '#00FF00', size: 64 })]);
  });
});
