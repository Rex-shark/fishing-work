// Room 圖片訊息：spec/architecture.md §5「圖片訊息」檢查表（Epic 2）
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CHAT_MIN_INTERVAL_MS,
  IMAGE_MIN_INTERVAL_MS,
  MAX_IMAGE_BYTES,
  ROUND_SECONDS,
  type ChatMessage,
  type ImagePayload,
} from '@fishing-work/shared';
import { IMAGE_ERROR_MESSAGES, type ImageMetaInput, readImagePayload, toArrayBuffer } from '../src/games/draw-guess/image';
import { ROUND_ERROR_MESSAGES, Room, type EmitEffect, type Effect, type ImageOutcome } from '../src/games/draw-guess/room';
import { FakeClock } from './helpers/fakeClock';

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

/** 各格式的最小檔頭（後面補幾個 byte 充當內容） */
const SAMPLES = {
  'image/png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]),
  'image/jpeg': new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]),
  'image/gif': new Uint8Array([...ascii('GIF89a'), 1, 0, 1, 0]),
  'image/webp': new Uint8Array([...ascii('RIFF'), 0x1a, 0, 0, 0, ...ascii('WEBP'), ...ascii('VP8 ')]),
} as const;
type Mime = keyof typeof SAMPLES;
const PNG = SAMPLES['image/png'];

let clock: FakeClock;
let room: Room;

beforeEach(() => {
  clock = new FakeClock();
  let n = 0;
  room = new Room({ clock, newId: () => `id${++n}`, onAsyncEffects: () => {} });
});

afterEach(() => room.dispose());

// A = id1（s1）、B = id3（s2）、C = id5（s3）
const A = 'id1';
const B = 'id3';

function joinPlayers(n: number): void {
  const names = ['Alice', 'Bob', 'Carol'];
  for (let i = 0; i < n; i++) {
    const r = room.join(`s${i + 1}`, names[i]);
    if (!r.ack.ok) throw new Error(`join 失敗：${r.ack.error}`);
  }
}

function meta(mime: string, over: Partial<ImageMetaInput> = {}): ImageMetaInput {
  return { mime, width: 1, height: 1, ...over };
}

function send(socketId: string, mime: Mime | string = 'image/png', data: Uint8Array = PNG, over: Partial<ImageMetaInput> = {}): ImageOutcome {
  return room.image(socketId, meta(mime, over), data);
}

function expectOk(o: ImageOutcome): string {
  if (!o.ack.ok) throw new Error(`預期成功，得到 ${o.ack.error}：${o.ack.message}`);
  return o.ack.data.id;
}

function expectError(o: ImageOutcome, error: string, message?: string): void {
  expect(o.ack.ok).toBe(false);
  if (o.ack.ok) return;
  expect(o.ack.error).toBe(error);
  if (message !== undefined) expect(o.ack.message).toBe(message);
  expect(o.effects).toEqual([]);
}

function emits(effects: Effect[]): EmitEffect[] {
  return effects.filter((e): e is EmitEffect => e.kind === 'emit');
}

/** 下一張圖不會被間隔擋 */
function gap(): void {
  clock.advance(IMAGE_MIN_INTERVAL_MS);
}

/** 深度走訪物件，找出任何 ArrayBuffer／TypedArray（Room 不得保存 bytes） */
function findBinary(root: unknown): string[] {
  const seen = new Set<unknown>();
  const hits: string[] = [];
  const walk = (v: unknown, path: string): void => {
    if (v === null || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) {
      hits.push(path);
      return;
    }
    if (v instanceof Map) {
      for (const [k, x] of v) walk(x, `${path}.get(${String(k)})`);
      return;
    }
    if (v instanceof Set) {
      for (const x of v) walk(x, `${path}.set`);
      return;
    }
    for (const k of Object.keys(v)) walk((v as Record<string, unknown>)[k], `${path}.${k}`);
  };
  walk(root, 'room');
  return hits;
}

describe('NOT_IN_ROOM', () => {
  it('未加入的 socket 傳圖 → NOT_IN_ROOM（排在內容驗證之前）', () => {
    expectError(send('ghost'), 'NOT_IN_ROOM', ROUND_ERROR_MESSAGES.NOT_IN_ROOM);
    expectError(send('ghost', 'image/bmp', new Uint8Array(0)), 'NOT_IN_ROOM');
  });
});

describe('IMAGE_INVALID', () => {
  beforeEach(() => joinPlayers(2));

  it.each(Object.keys(SAMPLES) as Mime[])('合法 magic bytes：%s', (mime) => {
    const o = send('s1', mime, SAMPLES[mime]);
    expectOk(o);
    gap();
  });

  it('宣告 mime 與 magic bytes 不符（PNG bytes 宣告成 JPEG）', () => {
    expectError(send('s1', 'image/jpeg', PNG), 'IMAGE_INVALID', IMAGE_ERROR_MESSAGES.MAGIC);
  });

  it('非圖片內容（純文字）宣告成 PNG', () => {
    expectError(send('s1', 'image/png', new Uint8Array(ascii('hello world!'))), 'IMAGE_INVALID', IMAGE_ERROR_MESSAGES.MAGIC);
  });

  it.each(['image/bmp', 'image/svg+xml', 'IMAGE/PNG', 'text/plain', ''])('宣告 mime 不在清單：%j', (mime) => {
    expectError(send('s1', mime, PNG), 'IMAGE_INVALID', IMAGE_ERROR_MESSAGES.MIME);
  });

  it('大小 0', () => {
    expectError(send('s1', 'image/png', new Uint8Array(0)), 'IMAGE_INVALID', IMAGE_ERROR_MESSAGES.SIZE);
  });

  it('大小剛好 MAX_IMAGE_BYTES 可過；MAX_IMAGE_BYTES + 1 被拒', () => {
    const max = new Uint8Array(MAX_IMAGE_BYTES);
    max.set(PNG);
    expectOk(send('s1', 'image/png', max));
    gap();
    const over = new Uint8Array(MAX_IMAGE_BYTES + 1);
    over.set(PNG);
    expectError(send('s1', 'image/png', over), 'IMAGE_INVALID', IMAGE_ERROR_MESSAGES.SIZE);
  });

  it('檢查順序 mime → 大小 → magic → 寬高：同時違反多項時回報最前面的原因', () => {
    const empty = new Uint8Array(0);
    expectError(send('s1', 'image/bmp', empty, { width: 0 }), 'IMAGE_INVALID', IMAGE_ERROR_MESSAGES.MIME);
    expectError(send('s1', 'image/png', empty, { width: 0 }), 'IMAGE_INVALID', IMAGE_ERROR_MESSAGES.SIZE);
    expectError(send('s1', 'image/jpeg', PNG, { width: 0 }), 'IMAGE_INVALID', IMAGE_ERROR_MESSAGES.MAGIC);
    expectError(send('s1', 'image/png', PNG, { width: 0 }), 'IMAGE_INVALID', IMAGE_ERROR_MESSAGES.DIMENSION);
  });

  it.each([
    ['寬 0', { width: 0 }],
    ['高 0', { height: 0 }],
    ['寬 4097', { width: 4097 }],
    ['高 4097', { height: 4097 }],
    ['寬非整數', { width: 1.5 }],
    ['高非整數', { height: 99.9 }],
    ['寬負數', { width: -10 }],
    ['寬 NaN', { width: Number.NaN }],
    ['高 Infinity', { height: Number.POSITIVE_INFINITY }],
  ])('寬高不合法：%s', (_name, over) => {
    expectError(send('s1', 'image/png', PNG, over), 'IMAGE_INVALID', IMAGE_ERROR_MESSAGES.DIMENSION);
  });

  it.each([0, -1, 1, 99, 1.5, Number.NaN, '12'])('帶錯的 bytes 被忽略，廣播的 meta.bytes = 實際長度：%j', (bytes) => {
    const o = room.image('s1', { ...meta('image/png'), bytes } as ImageMetaInput, PNG);
    expectOk(o);
    const msg = emits(o.effects)[0].payload as ChatMessage;
    expect(msg.image).toEqual({ mime: 'image/png', width: 1, height: 1, bytes: PNG.byteLength });
    expect(room.snapshot(B).chat.at(-1)?.image?.bytes).toBe(PNG.byteLength);
    gap();
  });

  it('寬高邊界 1 與 4096 可過', () => {
    expectOk(send('s1', 'image/png', PNG, { width: 1, height: 4096 }));
    gap();
    expectOk(send('s1', 'image/png', PNG, { width: 4096, height: 1 }));
  });

  it('IMAGE_INVALID 被拒不更新間隔時間戳', () => {
    expectError(send('s1', 'image/jpeg', PNG), 'IMAGE_INVALID');
    expectOk(send('s1'));
  });
});

describe('RATE_LIMITED（IMAGE_MIN_INTERVAL_MS）', () => {
  beforeEach(() => joinPlayers(2));

  it('距上一張 < 3 秒 → RATE_LIMITED；滿 3 秒可再傳', () => {
    expectOk(send('s1'));
    clock.advance(IMAGE_MIN_INTERVAL_MS - 1);
    expectError(send('s1'), 'RATE_LIMITED', IMAGE_ERROR_MESSAGES.RATE_LIMITED);
    clock.advance(1);
    expectOk(send('s1'));
  });

  it('被拒不更新時間戳（以第一張為準計時）', () => {
    expectOk(send('s1'));
    clock.advance(2000);
    expectError(send('s1'), 'RATE_LIMITED');
    clock.advance(1000); // 距第一張 3 秒、距被拒那張 1 秒
    expectOk(send('s1'));
  });

  it('每人各自計時', () => {
    expectOk(send('s1'));
    expectOk(send('s2'));
  });

  it('與文字聊天各自計時：剛聊天可立刻傳圖，剛傳圖可立刻聊天', () => {
    expect(room.chat('s1', 'hi').ack.ok).toBe(true);
    expectOk(send('s1'));
    clock.advance(CHAT_MIN_INTERVAL_MS);
    expect(room.chat('s1', '再一則').ack.ok).toBe(true);
    // 圖片間隔仍未滿
    expectError(send('s1'), 'RATE_LIMITED');
  });

  it('文字聊天被 RATE_LIMITED 不影響傳圖', () => {
    expect(room.chat('s1', 'a').ack.ok).toBe(true);
    const r = room.chat('s1', 'b');
    expect(r.ack.ok).toBe(false);
    expectOk(send('s1'));
  });

  it('RATE_LIMITED 排在 SPOILER_BLOCKED 之前', () => {
    expectOk(send('s1'));
    expect(room.volunteer('s1').ack.ok).toBe(true);
    expectError(send('s1'), 'RATE_LIMITED');
  });
});

describe('畫師作畫中不能傳圖（SPOILER_BLOCKED）', () => {
  beforeEach(() => joinPlayers(3));

  it('畫師在 choosing 被擋', () => {
    expect(room.volunteer('s1').ack.ok).toBe(true);
    expectError(send('s1'), 'SPOILER_BLOCKED', '作畫中畫師不能傳圖片');
  });

  it('畫師在 drawing 被擋；SPOILER_BLOCKED 被拒不更新時間戳', () => {
    expect(room.volunteer('s1').ack.ok).toBe(true);
    expect(room.setTopic('s1', '蘋果').ack.ok).toBe(true);
    expectError(send('s1'), 'SPOILER_BLOCKED', IMAGE_ERROR_MESSAGES.SPOILER_BLOCKED);
    // 回合結束（ended）後立刻可傳：前一次被擋沒有更新時間戳
    expect(room.cancel('s1').ack.ok).toBe(true);
    expectOk(send('s1'));
  });

  it('猜題者在 choosing／drawing 可傳', () => {
    expect(room.volunteer('s1').ack.ok).toBe(true);
    expectOk(send('s2'));
    expect(room.setTopic('s1', '蘋果').ack.ok).toBe(true);
    expectOk(send('s3'));
  });

  it('ended 時畫師可傳', () => {
    expect(room.volunteer('s1').ack.ok).toBe(true);
    expect(room.setTopic('s1', '蘋果').ack.ok).toBe(true);
    clock.advance(ROUND_SECONDS * 1000); // 逾時 → ended
    expectOk(send('s1'));
  });

  it('idle 時（回合結束後）前任畫師可傳；未開始回合時任何人可傳', () => {
    expectOk(send('s1'));
    expect(room.volunteer('s1').ack.ok).toBe(true);
    expect(room.cancel('s1').ack.ok).toBe(true); // choosing → idle
    gap();
    expectOk(send('s1'));
  });
});

describe('成功：訊息與效果', () => {
  beforeEach(() => joinPlayers(2));

  it('ack { id }；推 ChatMessage{kind:image, text:"", image: meta} 入緩衝', () => {
    const id = expectOk(send('s1', 'image/png', PNG, { width: 640, height: 480 }));
    const snap = room.snapshot(B);
    const msg = snap.chat.at(-1);
    expect(msg).toEqual<ChatMessage>({
      id,
      kind: 'image',
      fromId: A,
      nickname: 'Alice',
      text: '',
      at: clock.now(),
      image: { mime: 'image/png', width: 640, height: 480, bytes: PNG.byteLength },
    });
  });

  it('效果順序：chat:message 後緊接 chat:image，收件者皆為 all（所有在線者，含本人）', () => {
    const o = send('s1');
    const id = expectOk(o);
    const e = emits(o.effects);
    expect(o.effects).toHaveLength(2);
    expect(e.map((x) => x.event)).toEqual(['chat:message', 'chat:image']);
    expect(e.every((x) => x.to === 'all')).toBe(true);
    expect((e[0].payload as ChatMessage).id).toBe(id);
    const payload = e[1].payload as ImagePayload;
    expect(payload.id).toBe(id);
    // Room 一律帶 bytes；data: null（略過）只由 register 依收件者待送量產生
    expect(payload.data).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(payload.data!)]).toEqual([...PNG]);
    // 'all' 解析後包含傳送者本人
    expect(room.recipients('all').map((r) => r.playerId)).toEqual([A, B]);
  });

  it('chat:message 的 payload 不含 bytes（只有 meta）', () => {
    const o = send('s1');
    const msg = emits(o.effects)[0].payload as ChatMessage;
    expect(findBinary(msg)).toEqual([]);
    expect(Object.keys(msg.image ?? {}).sort()).toEqual(['bytes', 'height', 'mime', 'width']);
  });

  it('斷線中的玩家不在 chat:image 收件者內（只送在線者）', () => {
    room.disconnect('s2');
    const o = send('s1');
    expectOk(o);
    expect(room.recipients('all').map((r) => r.playerId)).toEqual([A]);
  });

  it('子視圖（byteOffset ≠ 0）的 bytes 也正確轉成 ArrayBuffer', () => {
    const big = new Uint8Array([9, 9, ...PNG, 9]);
    const view = big.subarray(2, 2 + PNG.byteLength);
    const o = send('s1', 'image/png', view);
    expectOk(o);
    const payload = emits(o.effects)[1].payload as ImagePayload;
    expect(payload.data?.byteLength).toBe(PNG.byteLength);
    expect([...new Uint8Array(payload.data!)]).toEqual([...PNG]);
  });
});

describe('Room 不保存 bytes', () => {
  beforeEach(() => joinPlayers(2));

  it('快照的 chat 只有 meta、沒有 bytes', () => {
    expectOk(send('s1'));
    const snap = room.snapshot(B);
    const img = snap.chat.find((m) => m.kind === 'image');
    expect(img?.image).toEqual({ mime: 'image/png', width: 1, height: 1, bytes: PNG.byteLength });
    expect(findBinary(snap)).toEqual([]);
  });

  it('序列化快照大小不隨圖片大小成長（1 MB 與 12 bytes 的快照一樣大）', () => {
    const small = send('s1');
    expectOk(small);
    const sizeSmall = JSON.stringify(room.snapshot(B)).length;
    gap();

    // 另開一間房，傳同樣序號的 1 MB 圖，比較快照長度（meta.bytes 位數不同，允許差幾個字元）
    const room2 = new Room({ clock, newId: (() => { let n = 0; return () => `id${++n}`; })(), onAsyncEffects: () => {} });
    try {
      room2.join('s1', 'Alice');
      room2.join('s2', 'Bob');
      const big = new Uint8Array(1024 * 1024);
      big.set(PNG);
      expect(room2.image('s1', meta('image/png'), big).ack.ok).toBe(true);
      const sizeBig = JSON.stringify(room2.snapshot(B)).length;
      expect(Math.abs(sizeBig - sizeSmall)).toBeLessThan(16);
    } finally {
      room2.dispose();
    }
  });

  it('連傳多張後，Room 物件上找不到任何 ArrayBuffer／TypedArray', () => {
    for (const mime of Object.keys(SAMPLES) as Mime[]) {
      expectOk(send('s1', mime, SAMPLES[mime]));
      gap();
    }
    const big = new Uint8Array(MAX_IMAGE_BYTES);
    big.set(PNG);
    expectOk(send('s2', 'image/png', big));
    expect(findBinary(room)).toEqual([]);
  });
});

describe('readImagePayload（register 的 payload 形狀驗證）', () => {
  const ab = PNG.slice().buffer;

  it('ArrayBuffer、Buffer、Uint8Array 皆可', () => {
    for (const data of [ab, Buffer.from(PNG), new Uint8Array(PNG)]) {
      const r = readImagePayload({ mime: 'image/png', width: 1, height: 1, data });
      expect(r).not.toBeNull();
      expect(r?.data).toBeInstanceOf(Uint8Array);
      expect(r?.data.byteLength).toBe(PNG.byteLength);
      expect(r?.meta).toEqual({ mime: 'image/png', width: 1, height: 1 });
    }
  });

  it.each([99, 0, -1, '12', null, { x: 1 }])('客戶端帶的 bytes 一律忽略（不讀、不驗、不報錯）：%j', (bytes) => {
    const r = readImagePayload({ mime: 'image/png', width: 1, height: 1, bytes, data: ab });
    expect(r?.meta).toEqual({ mime: 'image/png', width: 1, height: 1 });
  });

  it.each([
    ['null', null],
    ['字串', 'x'],
    ['缺 data', { mime: 'image/png', width: 1, height: 1 }],
    ['data 為字串', { mime: 'image/png', width: 1, height: 1, data: 'AAAA' }],
    ['data 為數字陣列', { mime: 'image/png', width: 1, height: 1, data: [...PNG] }],
    ['data 為 Uint16Array', { mime: 'image/png', width: 1, height: 1, data: new Uint16Array(4) }],
    ['缺 mime', { width: 1, height: 1, data: ab }],
    ['mime 非字串', { mime: 1, width: 1, height: 1, data: ab }],
    ['width 為字串', { mime: 'image/png', width: '1', height: 1, data: ab }],
    ['缺 height', { mime: 'image/png', width: 1, data: ab }],
    ['data 為 DataView', { mime: 'image/png', width: 1, height: 1, data: new DataView(ab) }],
  ])('形狀不對 → null：%s', (_name, payload) => {
    expect(readImagePayload(payload)).toBeNull();
  });
});

describe('toArrayBuffer', () => {
  it('完整涵蓋 ArrayBuffer 的 view 直接沿用；子視圖則複製', () => {
    const full = new Uint8Array(PNG);
    expect(toArrayBuffer(full)).toBe(full.buffer);
    const sub = full.subarray(1, 4);
    const out = toArrayBuffer(sub);
    expect(out).not.toBe(full.buffer);
    expect([...new Uint8Array(out)]).toEqual([...sub]);
  });

  it('Buffer 切片（socket.io 在 Node 端還原的二進位）只取自身區段，不帶出整個底層 buffer', () => {
    const frame = Buffer.from([1, 2, 3, ...PNG, 4, 5]);
    const view = frame.subarray(3, 3 + PNG.byteLength);
    const out = toArrayBuffer(view);
    expect(out.byteLength).toBe(PNG.byteLength);
    expect([...new Uint8Array(out)]).toEqual([...PNG]);
  });
});
