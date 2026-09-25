// Epic 2 協定測試：聊天室圖片（spec §3 maxHttpBufferSize、§4 chat:image、§5「圖片訊息」）
// 兩個真實 socket.io-client 連線；時鐘以「真實時間 + 可調偏移」注入，免得每張圖都要等 IMAGE_MIN_INTERVAL_MS。
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DRAW_GUESS_NAMESPACE,
  IMAGE_MIN_INTERVAL_MS,
  IMAGE_SKIP_BUFFER_BYTES,
  MAX_IMAGE_BYTES,
  type ChatMessage,
  type ImagePayload,
} from '@fishing-work/shared';
import { PING_INTERVAL_MS, PING_TIMEOUT_MS, type AppOptions } from '../../src/app';
import type { Clock } from '../../src/games/draw-guess/room';
import { pendingBytes } from '../../src/games/draw-guess/slowLink';
import {
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

/** 最小合法 1×1 PNG（69 bytes，RGB 單一像素） */
const PNG_1X1 = hex(
  '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63f8cfc0000003010100c9fe92ef0000000049454e44ae426082',
);
/** 最小合法 1×1 JPEG（641 bytes，baseline JFIF；由 macOS sips 產生後去掉 Exif／Photoshop 段） */
const JPEG_1X1 = hex(
  'ffd8ffe000104a46494600010100004800480000ffc00011080001000103012200021101031101ffc4001f0000010501010101010100000000000000' +
    '000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1' +
    'c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778' +
    '797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5' +
    'e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffc4001f0100030101010101010101010000000000000102030405060708090a0bffc400b51100020102040403' +
    '040705040400010277000102031104052131061241510761711322328108144291a1b1c109233352f0156272d10a162434e125f11718191a26272829' +
    '2a35363738393a434445464748494a535455565758595a636465666768696a737475767778797a82838485868788898a92939495969798999aa2a3a4' +
    'a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae2e3e4e5e6e7e8e9eaf2f3f4f5f6f7f8f9faffdb00430002020202' +
    '0202030202030503030305060505050506080606060606080a0808080808080a0a0a0a0a0a0a0a0c0c0c0c0c0c0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f' +
    'ffdb00430102020204040407040407100b090b1010101010101010101010101010101010101010101010101010101010101010101010101010101010' +
    '101010101010101010ffdd00040001ffda000c03010002110311003f00f8be8a28afe533fdfc3fffd9',
);

function hex(s: string): Uint8Array {
  return new Uint8Array(s.match(/../g)!.map((b) => parseInt(b, 16)));
}

/** 客戶端依 §4 以 ArrayBuffer 送出（複製一份，避免共用底層 buffer） */
function ab(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

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
  /** 把時鐘往前撥一個傳圖間隔，下一張圖不會被 RATE_LIMITED */
  gap(): void {
    this.offset += IMAGE_MIN_INTERVAL_MS;
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
  srv = await startServer({ clock, ...options });
  return srv;
}

interface Client {
  s: ClientSocket;
  id: string;
  /** 依到達順序記下所有事件（驗 chat:message → chat:image 的先後） */
  events: { event: string; payload: unknown }[];
  disconnects: string[];
}

/** 連線、先掛好收集器再 join（避免漏掉 ack 之後緊接的廣播） */
async function client(server: TestServer, nickname: string): Promise<Client> {
  const s = await server.connect();
  const events: Client['events'] = [];
  const disconnects: string[] = [];
  s.onAny((event: string, payload: unknown) => events.push({ event, payload }));
  s.on('disconnect', (reason) => disconnects.push(reason));
  const r = await joinOk(s, nickname);
  return { s, id: r.snapshot.you, events, disconnects };
}

function sendImage(c: Client, p: Record<string, unknown>) {
  return request<{ id: string }>(c.s, 'chat:image', p);
}

function imagePayload(mime: string, bytes: Uint8Array, over: Record<string, unknown> = {}) {
  return { mime, width: 1, height: 1, data: ab(bytes), ...over };
}

/** 兩則成對事件：同 id 的 chat:message(kind image) 與其後緊接的 chat:image */
function pairOf(c: Client, id: string): { msg: ChatMessage; img: ImagePayload; msgIdx: number; imgIdx: number } | null {
  const msgIdx = c.events.findIndex((e) => e.event === 'chat:message' && (e.payload as ChatMessage).id === id);
  const imgIdx = c.events.findIndex((e) => e.event === 'chat:image' && (e.payload as ImagePayload).id === id);
  if (msgIdx < 0 || imgIdx < 0) return null;
  return {
    msg: c.events[msgIdx].payload as ChatMessage,
    img: c.events[imgIdx].payload as ImagePayload,
    msgIdx,
    imgIdx,
  };
}

/** Node 端 socket.io-client 收到的二進位為 Buffer；統一轉成 Uint8Array 比對（data: null 為略過，呼叫前先排除） */
function bytesOf(data: unknown): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data instanceof Uint8Array) return data;
  throw new Error(`chat:image data 不是二進位：${Object.prototype.toString.call(data)}`);
}

function imageEvents(c: Client): unknown[] {
  return c.events.filter((e) => e.event === 'chat:image').map((e) => e.payload);
}

describe('e2e Epic 2：聊天室圖片', () => {
  it('未注入 ping 時，server 心跳為 spec §3 的 pingInterval 10 秒、pingTimeout 30 秒（慢連線保護的安全邊際）', async () => {
    const server = await start();
    const opts = server.app.io.engine.opts;
    expect(PING_INTERVAL_MS).toBe(10_000);
    expect(PING_TIMEOUT_MS).toBe(30_000);
    expect(opts.pingInterval).toBe(PING_INTERVAL_MS);
    expect(opts.pingTimeout).toBe(PING_TIMEOUT_MS);
  });

  it('A 送真實 1×1 PNG 與 JPEG → A、B 都收到 chat:message(kind image) 後緊接 chat:image，bytes 完全相同', async () => {
    const server = await start();
    const a = await client(server, 'Alice');
    const b = await client(server, 'Bob');

    for (const [mime, bytes] of [
      ['image/png', PNG_1X1],
      ['image/jpeg', JPEG_1X1],
    ] as const) {
      clock.gap();
      const r = await sendImage(a, imagePayload(mime, bytes));
      if (!r.ok) throw new Error(`${mime} 被拒：${r.error} ${r.message}`);
      const { id } = r.data;
      await waitFor(() => [a, b].every((c) => pairOf(c, id) !== null), 3000, `${mime} 兩人都收到`);

      for (const c of [a, b]) {
        const pair = pairOf(c, id)!;
        // 同 id 的 chat:message 後「緊接」chat:image
        expect(pair.imgIdx).toBe(pair.msgIdx + 1);
        expect(pair.msg).toMatchObject({
          id,
          kind: 'image',
          fromId: a.id,
          nickname: 'Alice',
          text: '',
          image: { mime, width: 1, height: 1, bytes: bytes.byteLength },
        });
        const got = bytesOf(pair.img.data);
        expect(got.byteLength).toBe(bytes.byteLength);
        expect(Buffer.from(got).equals(Buffer.from(bytes))).toBe(true);
      }
    }
  });

  it('剛好 MAX_IMAGE_BYTES 的圖可以送達（maxHttpBufferSize 足夠）', async () => {
    const server = await start();
    const a = await client(server, 'Alice');
    const b = await client(server, 'Bob');
    const big = new Uint8Array(MAX_IMAGE_BYTES);
    big.set(PNG_1X1);
    big[MAX_IMAGE_BYTES - 1] = 0x7f;

    const r = await sendImage(a, imagePayload('image/png', big));
    if (!r.ok) throw new Error(`被拒：${r.error}`);
    await waitFor(() => pairOf(b, r.data.id) !== null, 15_000, 'B 收到 MAX_IMAGE_BYTES（10 MB）的圖');
    const got = bytesOf(pairOf(b, r.data.id)!.img.data);
    expect(got.byteLength).toBe(MAX_IMAGE_BYTES);
    expect(got[MAX_IMAGE_BYTES - 1]).toBe(0x7f);
    expect(a.disconnects).toEqual([]);
    expect(b.disconnects).toEqual([]);
  }, 30_000);

  it('假 mime（PNG bytes 宣告成 JPEG、文字宣告成 PNG）與清單外 mime → IMAGE_INVALID，沒有廣播', async () => {
    const server = await start();
    const a = await client(server, 'Alice');
    const b = await client(server, 'Bob');

    const cases = [
      imagePayload('image/jpeg', PNG_1X1),
      imagePayload('image/png', new TextEncoder().encode('not an image at all')),
      imagePayload('image/bmp', PNG_1X1),
      imagePayload('image/png', PNG_1X1, { width: 4097 }),
    ];
    for (const p of cases) {
      const r = await sendImage(a, p);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe('IMAGE_INVALID');
    }
    // payload 形狀不對（data 為字串）→ register 回 IMAGE_INVALID
    const shape = await sendImage(a, { mime: 'image/png', width: 1, height: 1, data: 'iVBORw0KGgo=' });
    expect(shape).toMatchObject({ ok: false, error: 'IMAGE_INVALID' });

    // 以一張合法圖當柵欄：它之前沒有任何 chat:image／image 訊息
    const ok = await sendImage(a, imagePayload('image/png', PNG_1X1));
    if (!ok.ok) throw new Error('柵欄圖被拒');
    await waitFor(() => pairOf(b, ok.data.id) !== null, 3000, '柵欄');
    for (const c of [a, b]) {
      expect(imageEvents(c)).toHaveLength(1);
      expect(c.events.filter((e) => e.event === 'chat:message' && (e.payload as ChatMessage).kind === 'image')).toHaveLength(1);
    }
  });

  it('chat:image 以單次廣播送給所有在線者（沒有慢連線時 adapter.broadcast 只呼叫一次，Socket.IO 只編碼一次）', async () => {
    const server = await start();
    const a = await client(server, 'Alice');
    const b = await client(server, 'Bob');
    const c = await client(server, 'Carol');
    const adapter = server.app.io.of(DRAW_GUESS_NAMESPACE).adapter;
    const spy = vi.spyOn(adapter, 'broadcast');
    try {
      const r = await sendImage(a, imagePayload('image/png', PNG_1X1));
      if (!r.ok) throw new Error('被拒');
      await waitFor(() => [a, b, c].every((x) => pairOf(x, r.data.id) !== null), 3000, '三人都收到');
      const imageBroadcasts = spy.mock.calls.filter(([packet]) => (packet.data as unknown[])[0] === 'chat:image');
      expect(imageBroadcasts).toHaveLength(1);
      expect([...(imageBroadcasts[0][1].rooms ?? [])].sort()).toEqual([a.s.id, b.s.id, c.s.id].sort());
    } finally {
      spy.mockRestore();
    }
  });

  it('慢連線保護（注入待送量）：正常群組單次廣播帶 bytes、略過群組單次廣播 data: null；略過者不斷線', async () => {
    // Carol 的待送量固定回報超過門檻；其他人為 0
    let slowId = '';
    const server = await start({ pendingBytesOf: (sid) => (sid === slowId ? IMAGE_SKIP_BUFFER_BYTES + 1 : 0) });
    const a = await client(server, 'Alice');
    const b = await client(server, 'Bob');
    const c = await client(server, 'Carol');
    slowId = c.s.id!;
    const adapter = server.app.io.of(DRAW_GUESS_NAMESPACE).adapter;
    const spy = vi.spyOn(adapter, 'broadcast');
    try {
      const ids: string[] = [];
      for (const [mime, bytes] of [
        ['image/png', PNG_1X1],
        ['image/jpeg', JPEG_1X1],
      ] as const) {
        clock.gap();
        const r = await sendImage(a, imagePayload(mime, bytes));
        if (!r.ok) throw new Error(`被拒：${r.error}`);
        ids.push(r.data.id);
        await waitFor(() => [a, b, c].every((x) => pairOf(x, r.data.id) !== null), 3000, '三人都收到');
        for (const x of [a, b]) expect(Buffer.from(bytesOf(pairOf(x, r.data.id)!.img.data)).equals(Buffer.from(bytes))).toBe(true);
        const slow = pairOf(c, r.data.id)!;
        expect(slow.img).toEqual({ id: r.data.id, data: null });
        expect(slow.imgIdx).toBe(slow.msgIdx + 1); // 略過通知仍緊接在 chat:message 之後
        expect(slow.msg.image?.bytes).toBe(bytes.byteLength); // meta 照常
      }
      const imageBroadcasts = spy.mock.calls.filter(([packet]) => (packet.data as unknown[])[0] === 'chat:image');
      // 每張圖：正常群組一次、略過群組一次
      expect(imageBroadcasts).toHaveLength(2 * ids.length);
      for (let i = 0; i < ids.length; i++) {
        const [normal, skipped] = imageBroadcasts.slice(2 * i, 2 * i + 2);
        expect([...(normal[1].rooms ?? [])].sort()).toEqual([a.s.id, b.s.id].sort());
        expect([...(skipped[1].rooms ?? [])]).toEqual([c.s.id]);
        expect((skipped[0].data as unknown[])[1]).toEqual({ id: ids[i], data: null });
      }
      await sleep(100);
      for (const x of [a, b, c]) {
        expect(x.s.connected).toBe(true);
        expect(x.disconnects).toEqual([]);
      }
    } finally {
      spy.mockRestore();
    }
  });

  it('慢連線保護（真實暫停讀取）：慢客戶端連收多張 10 MB 不斷線、待送量超過門檻後收到 data: null；其他人照收且位元組一致', async () => {
    // 門檻 IMAGE_SKIP_BUFFER_BYTES = 2 × MAX_IMAGE_BYTES + 2 MiB（允許兩張在途），而 macOS loopback 核心緩衝會先吃掉數 MiB，
    // 究竟第幾張才會超過門檻不固定。因此送 6 張，每張送出前以真實 engine.io／ws 內部結構量 Carol 的待送量，
    // 只斷言：超過門檻的那幾張收到 null、明顯低於門檻的收到 bytes、至少一張超過門檻（本案例才有意義）；
    // 精確的分組與單次廣播改由上一個注入 pendingBytesOf 的案例驗證。
    const server = await start();
    const a = await client(server, 'Alice');
    const b = await client(server, 'Bob');
    const c = await client(server, 'Carol');
    const serverSocket = server.app.io.of(DRAW_GUESS_NAMESPACE).sockets.get(c.s.id!);
    // Carol 暫停讀取 TCP：server 送給她的資料塞在 server 端（ws 寫入佇列 → engine.io writeBuffer），等同極慢的網路
    const ws = (c.s.io.engine as unknown as { transport: { ws: { pause(): void; resume(): void; isPaused: boolean } } }).transport.ws;
    ws.pause();
    expect(ws.isPaused).toBe(true);

    const N = 6;
    const sent: { id: string; bytes: Uint8Array; pendingBefore: number }[] = [];
    for (let i = 0; i < N; i++) {
      const big = new Uint8Array(MAX_IMAGE_BYTES - i);
      big.set(PNG_1X1);
      big.fill(i + 1, PNG_1X1.byteLength);
      clock.gap();
      // 上一張已寫出（B 已收到），Carol 暫停中佇列只增不減：此刻的量即 server 分組時看到的量（另加一則小 chat:message）
      const pendingBefore = pendingBytes(serverSocket?.conn);
      const r = await sendImage(a, imagePayload('image/png', big));
      if (!r.ok) throw new Error(`第 ${i + 1} 張被拒：${r.error}`);
      sent.push({ id: r.data.id, bytes: big, pendingBefore });
      // 正常收件者照收（B 讀取正常）
      await waitFor(() => pairOf(b, r.data.id) !== null, 15_000, `B 收到第 ${i + 1} 張`);
    }
    // 真實內部結構量得到積壓（驗證 pendingBytes 的讀法對得上 engine.io 6.6／ws 8），且至少一張送出時已超過門檻
    expect(sent.some((x) => x.pendingBefore > IMAGE_SKIP_BUFFER_BYTES)).toBe(true);

    ws.resume();
    await waitFor(() => sent.every(({ id }) => pairOf(c, id) !== null), 30_000, 'Carol 收齊（含略過通知）');

    for (const x of [a, b]) {
      for (const { id, bytes } of sent) {
        const got = bytesOf(pairOf(x, id)!.img.data);
        expect(got.byteLength).toBe(bytes.byteLength);
        expect(Buffer.from(got).equals(Buffer.from(bytes))).toBe(true);
      }
    }
    const MARGIN = 64 * 1024; // 量測到 server 分組之間只多一則 chat:message，留餘裕避免邊界抖動
    for (const { id, bytes, pendingBefore } of sent) {
      const p = pairOf(c, id)!.img;
      if (pendingBefore > IMAGE_SKIP_BUFFER_BYTES) expect(p.data).toBeNull();
      else if (pendingBefore < IMAGE_SKIP_BUFFER_BYTES - MARGIN) {
        expect(p.data).not.toBeNull();
        expect(Buffer.from(bytesOf(p.data)).equals(Buffer.from(bytes))).toBe(true);
      }
    }
    expect(pairOf(c, sent[0].id)!.img.data).not.toBeNull(); // 第一張送出時佇列是空的
    await sleep(100);
    for (const x of [a, b, c]) {
      expect(x.s.connected).toBe(true);
      expect(x.disconnects).toEqual([]);
    }
  }, 90_000);

  it('短 pingTimeout 注入：停止讀取的死連線仍會被 ping timeout 判定斷線，正常連線不受影響', async () => {
    const server = await start({ ping: { interval: 200, timeout: 300 } });
    const a = await client(server, 'Alice');
    const c = await client(server, 'Carol');
    const ws = (c.s.io.engine as unknown as { transport: { ws: { pause(): void; resume(): void } } }).transport.ws;
    const disconnectReasons: string[] = [];
    server.app.io.of(DRAW_GUESS_NAMESPACE).sockets.get(c.s.id!)?.on('disconnect', (reason) => disconnectReasons.push(reason));
    ws.pause(); // 收不到 ping、也就不會回 pong
    try {
      await waitFor(() => disconnectReasons.length > 0, 3000, 'server 判定 Carol 斷線');
      expect(disconnectReasons).toEqual(['ping timeout']);
      // Alice 看到 Carol connected=false（進入寬限期）
      await waitFor(
        () =>
          a.events.some(
            (e) =>
              e.event === 'players:update' &&
              (e.payload as { id: string; connected: boolean }[]).some((p) => p.id === c.id && !p.connected),
          ),
        3000,
        'Alice 收到 Carol 斷線的 players:update',
      );
      // 正常回應心跳的 Alice 撐過多個 ping 週期仍在線
      await sleep(800);
      expect(a.s.connected).toBe(true);
      expect(a.disconnects).toEqual([]);
    } finally {
      // server 端 ws 關閉要等對方回 close frame；恢復讀取讓連線真正關掉，afterEach 的 io.close() 才不會卡住
      ws.resume();
    }
  });

  it('客戶端帶錯的 bytes 被忽略：兩端收到的 meta.bytes 皆為實際長度', async () => {
    const server = await start();
    const a = await client(server, 'Alice');
    const b = await client(server, 'Bob');
    const r = await sendImage(a, imagePayload('image/png', PNG_1X1, { bytes: PNG_1X1.byteLength + 1 }));
    if (!r.ok) throw new Error(`被拒：${r.error} ${r.message}`);
    await waitFor(() => [a, b].every((c) => pairOf(c, r.data.id) !== null), 3000, '兩人都收到');
    for (const c of [a, b]) {
      const pair = pairOf(c, r.data.id)!;
      expect(pair.msg.image?.bytes).toBe(PNG_1X1.byteLength);
      expect(bytesOf(pair.img.data).byteLength).toBe(PNG_1X1.byteLength);
    }
  });

  it('超限 payload（MAX_IMAGE_BYTES + 1）→ IMAGE_INVALID，且連線不會斷（maxHttpBufferSize > 預設 1 MB）', async () => {
    const server = await start();
    const a = await client(server, 'Alice');
    const b = await client(server, 'Bob');
    const over = new Uint8Array(MAX_IMAGE_BYTES + 1);
    over.set(PNG_1X1);

    const r = await sendImage(a, imagePayload('image/png', over));
    expect(r).toMatchObject({ ok: false, error: 'IMAGE_INVALID' });
    await sleep(100);
    expect(a.s.connected).toBe(true);
    expect(a.disconnects).toEqual([]);

    // 連線仍可用：再送一張合法圖（被拒不更新間隔，免撥時鐘）
    const ok = await sendImage(a, imagePayload('image/png', PNG_1X1));
    if (!ok.ok) throw new Error(`被拒：${ok.error}`);
    await waitFor(() => pairOf(b, ok.data.id) !== null, 3000, 'B 收到');
    expect(imageEvents(b)).toHaveLength(1);
  });

  it('間隔：3 秒內第二張 RATE_LIMITED；畫師作畫中被擋、猜題者可傳；不帶 ack 的 chat:image 被忽略', async () => {
    const server = await start();
    const a = await client(server, 'Alice');
    const b = await client(server, 'Bob');

    expect((await sendImage(a, imagePayload('image/png', PNG_1X1))).ok).toBe(true);
    expect(await sendImage(a, imagePayload('image/png', PNG_1X1))).toMatchObject({ ok: false, error: 'RATE_LIMITED' });

    clock.gap();
    expect(await request(a.s, 'round:volunteer')).toEqual({ ok: true });
    expect(await sendImage(a, imagePayload('image/png', PNG_1X1))).toEqual({
      ok: false,
      error: 'SPOILER_BLOCKED',
      message: '作畫中畫師不能傳圖片',
    });
    expect((await sendImage(b, imagePayload('image/jpeg', JPEG_1X1))).ok).toBe(true);

    // 不帶 ack：伺服器忽略（不廣播）
    clock.gap();
    rawEmit(b.s, 'chat:image', imagePayload('image/png', PNG_1X1));
    await sleep(150);
    expect(imageEvents(a)).toHaveLength(2); // A 自己第一張 + B 的 JPEG
    expect(b.s.connected).toBe(true);
  });

  it('中途加入者：快照只有 meta 沒有 bytes，也不會補收 chat:image', async () => {
    const server = await start();
    const a = await client(server, 'Alice');
    const b = await client(server, 'Bob');
    const r = await sendImage(a, imagePayload('image/png', PNG_1X1));
    if (!r.ok) throw new Error('被拒');
    await waitFor(() => pairOf(b, r.data.id) !== null, 3000, 'B 收到');

    const cs = await server.connect();
    const cEvents: string[] = [];
    cs.onAny((event: string) => cEvents.push(event));
    const joined = await joinOk(cs, 'Carol');
    const msg = joined.snapshot.chat.find((m) => m.id === r.data.id);
    expect(msg).toEqual({
      id: r.data.id,
      kind: 'image',
      fromId: a.id,
      nickname: 'Alice',
      text: '',
      at: expect.any(Number),
      image: { mime: 'image/png', width: 1, height: 1, bytes: PNG_1X1.byteLength },
    });
    // 快照整體沒有任何二進位欄位（JSON 往返後內容不變）
    expect(JSON.parse(JSON.stringify(joined.snapshot))).toEqual(joined.snapshot);

    await sleep(100);
    expect(cEvents).not.toContain('chat:image');
  });
});
