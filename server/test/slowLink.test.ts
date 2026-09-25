// 聊天圖片慢連線保護：spec/architecture.md §5「圖片訊息」（2026-09-25 壓測定案）、§4 IMAGE_SKIP_BUFFER_BYTES
// 單元：待送量讀法（engine.io writeBuffer ＋ ws bufferedAmount）、分組門檻邊界、applyEffects 的兩組廣播。
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IMAGE_SKIP_BUFFER_BYTES, type ImagePayload } from '@fishing-work/shared';
import { applyEffects, defaultPendingBytesOf, type DrawGuessNamespace } from '../src/games/draw-guess/register';
import { Room } from '../src/games/draw-guess/room';
import { packetBytes, partitionRecipients, pendingBytes } from '../src/games/draw-guess/slowLink';
import { silenceLogs } from './e2e/helpers';
import { FakeClock } from './helpers/fakeClock';

beforeAll(() => silenceLogs());

describe('packetBytes：單一封包資料的位元組數', () => {
  it('字串以 UTF-8 計、二進位以 byteLength 計、其他為 0', () => {
    expect(packetBytes('abc')).toBe(3);
    expect(packetBytes('圖片')).toBe(6);
    expect(packetBytes(new ArrayBuffer(10))).toBe(10);
    expect(packetBytes(Buffer.alloc(7))).toBe(7);
    expect(packetBytes(new Uint8Array(new ArrayBuffer(100), 10, 5))).toBe(5);
    expect(packetBytes(undefined)).toBe(0);
    expect(packetBytes(null)).toBe(0);
    expect(packetBytes(42)).toBe(0);
  });
});

describe('pendingBytes：engine.io 連線的待送量', () => {
  it('WebSocket transport：writeBuffer 各封包資料 ＋ ws.bufferedAmount', () => {
    const conn = {
      writeBuffer: [
        { type: 'message', data: '451-["chat:image",{"id":"x","data":{"_placeholder":true,"num":0}}]' },
        { type: 'message', data: Buffer.alloc(3_000_000) },
        { type: 'ping' }, // ping 沒有資料
      ],
      transport: { name: 'websocket', socket: { bufferedAmount: 1_500_000 } },
    };
    expect(pendingBytes(conn)).toBe(Buffer.byteLength(conn.writeBuffer[0].data as string) + 3_000_000 + 1_500_000);
  });

  it('polling transport（沒有底層 ws）只計 writeBuffer', () => {
    expect(pendingBytes({ writeBuffer: [{ type: 'message', data: new ArrayBuffer(64) }], transport: { name: 'polling' } })).toBe(64);
  });

  it('空佇列為 0', () => {
    expect(pendingBytes({ writeBuffer: [], transport: { socket: { bufferedAmount: 0 } } })).toBe(0);
  });

  it('形狀不符（內部結構改版）的部分視為 0：不會誤擋', () => {
    expect(pendingBytes(undefined)).toBe(0);
    expect(pendingBytes(null)).toBe(0);
    expect(pendingBytes('conn')).toBe(0);
    expect(pendingBytes({})).toBe(0);
    expect(pendingBytes({ writeBuffer: 'x', transport: null })).toBe(0);
    expect(pendingBytes({ writeBuffer: [null, 1, { data: Buffer.alloc(5) }], transport: { socket: { bufferedAmount: '9' } } })).toBe(5);
    expect(pendingBytes({ transport: { socket: { bufferedAmount: Number.NaN } } })).toBe(0);
    expect(pendingBytes({ transport: { socket: { bufferedAmount: -1 } } })).toBe(0);
  });
});

describe('partitionRecipients：依待送量分組', () => {
  const T = IMAGE_SKIP_BUFFER_BYTES;

  it('門檻邊界：恰好等於門檻照送、超過 1 byte 才略過（spec：「超過」）', () => {
    const pending: Record<string, number> = { a: 0, b: T - 1, c: T, d: T + 1, e: 10 * T };
    const r = partitionRecipients(Object.keys(pending), (id) => pending[id], T);
    expect(r).toEqual({ normal: ['a', 'b', 'c'], skipped: ['d', 'e'] });
  });

  it('保持原順序；全部正常或全部略過', () => {
    expect(partitionRecipients(['x', 'y', 'z'], () => 0, T)).toEqual({ normal: ['x', 'y', 'z'], skipped: [] });
    expect(partitionRecipients(['x', 'y', 'z'], () => T + 1, T)).toEqual({ normal: [], skipped: ['x', 'y', 'z'] });
    expect(partitionRecipients([], () => T + 1, T)).toEqual({ normal: [], skipped: [] });
  });

  it('量測丟例外或回傳非有限數 → 視為 0 照送', () => {
    const r = partitionRecipients(
      ['throws', 'nan', 'inf', 'ok'],
      (id) => {
        if (id === 'throws') throw new Error('boom');
        if (id === 'nan') return Number.NaN;
        if (id === 'inf') return Number.POSITIVE_INFINITY;
        return 0;
      },
      T,
    );
    expect(r).toEqual({ normal: ['throws', 'nan', 'inf', 'ok'], skipped: [] });
  });
});

// ── applyEffects：假 namespace 記下每次 nsp.to(...).emit ──

interface EmitCall {
  to: string[];
  event: string;
  payload: unknown;
}

function fakeNsp(conns: Record<string, unknown> = {}): { nsp: DrawGuessNamespace; calls: EmitCall[] } {
  const calls: EmitCall[] = [];
  const sockets = new Map(Object.entries(conns).map(([id, conn]) => [id, { conn, disconnect: () => {} }]));
  const nsp = {
    sockets,
    to: (ids: string | string[]) => ({
      emit: (event: string, payload: unknown) => {
        calls.push({ to: Array.isArray(ids) ? [...ids] : [ids], event, payload });
        return true;
      },
    }),
  };
  return { nsp: nsp as unknown as DrawGuessNamespace, calls };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);

describe('applyEffects：chat:image 慢連線保護', () => {
  let room: Room;

  beforeEach(() => {
    let n = 0;
    room = new Room({ clock: new FakeClock(), newId: () => `id${++n}`, onAsyncEffects: () => {} });
    for (const [i, name] of ['Alice', 'Bob', 'Carol', 'Dave'].entries()) {
      if (!room.join(`s${i + 1}`, name).ack.ok) throw new Error('join 失敗');
    }
  });
  afterEach(() => room.dispose());

  function imageEffects() {
    const o = room.image('s1', { mime: 'image/png', width: 1, height: 1 }, PNG);
    if (!o.ack.ok) throw new Error(o.ack.error);
    return { id: o.ack.data.id, effects: o.effects };
  }

  it('沒有人超過門檻：chat:image 只 emit 一次、收件者為全部在線者、payload 帶 bytes', () => {
    const { nsp, calls } = fakeNsp();
    const { id, effects } = imageEffects();
    applyEffects(nsp, room, effects, { pendingBytesOf: () => 0 });
    const img = calls.filter((c) => c.event === 'chat:image');
    expect(img).toHaveLength(1);
    expect(img[0].to).toEqual(['s1', 's2', 's3', 's4']);
    expect((img[0].payload as ImagePayload).id).toBe(id);
    expect((img[0].payload as ImagePayload).data).toBeInstanceOf(ArrayBuffer);
  });

  it('部分超過門檻：正常群組一次（帶 bytes、同一個 payload 物件）、略過群組一次（data: null）', () => {
    const { nsp, calls } = fakeNsp();
    const { id, effects } = imageEffects();
    const original = effects.find((e) => e.kind === 'emit' && e.event === 'chat:image');
    const pending: Record<string, number> = { s1: 0, s2: IMAGE_SKIP_BUFFER_BYTES + 1, s3: IMAGE_SKIP_BUFFER_BYTES, s4: 50_000_000 };
    applyEffects(nsp, room, effects, { pendingBytesOf: (sid) => pending[sid] });

    // chat:message 不受待送量影響：照常一次給全部
    const msg = calls.filter((c) => c.event === 'chat:message');
    expect(msg).toHaveLength(1);
    expect(msg[0].to).toEqual(['s1', 's2', 's3', 's4']);

    const img = calls.filter((c) => c.event === 'chat:image');
    expect(img).toHaveLength(2);
    expect(img[0].to).toEqual(['s1', 's3']);
    expect(img[0].payload).toBe(original?.kind === 'emit' ? original.payload : undefined);
    expect(img[1]).toEqual({ to: ['s2', 's4'], event: 'chat:image', payload: { id, data: null } });
    // 順序：chat:message 先於兩則 chat:image
    expect(calls.map((c) => c.event)).toEqual(['chat:message', 'chat:image', 'chat:image']);
  });

  it('全部超過門檻：只送一次 data: null，不送 bytes', () => {
    const { nsp, calls } = fakeNsp();
    const { id, effects } = imageEffects();
    applyEffects(nsp, room, effects, { pendingBytesOf: () => IMAGE_SKIP_BUFFER_BYTES + 1 });
    const img = calls.filter((c) => c.event === 'chat:image');
    expect(img).toEqual([{ to: ['s1', 's2', 's3', 's4'], event: 'chat:image', payload: { id, data: null } }]);
  });

  it('斷線中的玩家不在任一組（只送在線者）', () => {
    room.disconnect('s3');
    const { nsp, calls } = fakeNsp();
    const { effects } = imageEffects();
    applyEffects(nsp, room, effects, { pendingBytesOf: (sid) => (sid === 's2' ? IMAGE_SKIP_BUFFER_BYTES + 1 : 0) });
    const img = calls.filter((c) => c.event === 'chat:image');
    expect(img.map((c) => c.to)).toEqual([['s1', 's4'], ['s2']]);
  });

  it('預設量測（未注入）：讀 nsp.sockets 裡各 socket 的 engine.io 連線', () => {
    const slowConn = { writeBuffer: [{ type: 'message', data: Buffer.alloc(IMAGE_SKIP_BUFFER_BYTES + 1) }], transport: {} };
    const idleConn = { writeBuffer: [], transport: { socket: { bufferedAmount: 0 } } };
    const { nsp, calls } = fakeNsp({ s1: idleConn, s2: slowConn, s3: idleConn }); // s4 不在 sockets（視為 0）
    expect(defaultPendingBytesOf(nsp)('s2')).toBe(IMAGE_SKIP_BUFFER_BYTES + 1);
    expect(defaultPendingBytesOf(nsp)('s4')).toBe(0);
    const { id, effects } = imageEffects();
    applyEffects(nsp, room, effects);
    const img = calls.filter((c) => c.event === 'chat:image');
    expect(img.map((c) => c.to)).toEqual([['s1', 's3', 's4'], ['s2']]);
    expect(img[1].payload).toEqual({ id, data: null });
  });

  it('其他事件不查待送量（例如 chat:message、players:update 照常送給全部）', () => {
    const { nsp, calls } = fakeNsp();
    const o = room.chat('s2', 'hello');
    applyEffects(nsp, room, o.effects, {
      pendingBytesOf: () => {
        throw new Error('不該被呼叫');
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ event: 'chat:message', to: ['s1', 's2', 's3', 's4'] });
  });
});
