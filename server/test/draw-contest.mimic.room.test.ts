// 像不像比賽（Epic 20）：reference.ts 驗證與 Room 的 mimic 流程
// spec/draw-contest/architecture.md §4（mode／lastMode、ReferenceImage、contest:reference、REFERENCE_INVALID）、§5 drawing／ended、§5.1b、§5.4
// 假時鐘＋手動評分器＋手動評語器，決定性地跑；不碰任何模型。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_REFERENCE_BYTES,
  TOPIC_INVALID_MESSAGE,
  type ChatMessage,
  type ReferenceImage,
  type RoundPublic,
} from '@fishing-work/shared/draw-contest';
import { JPEG_SIGNATURE, checkReference, isValidReferenceJpeg } from '../src/games/draw-contest/reference';
import { ROUND_ERROR_MESSAGES, Room, type EmitEffect, type Effect, type RoomOptions } from '../src/games/draw-contest/room';
import { FakeClock } from './helpers/fakeClock';
import { FnJudge, ManualCommentator, ManualJudge, flush, makePng } from './helpers/drawContest';

/** 合法參考圖 JPEG（server 只驗 magic 與長度）；seed 改變內容，size 為總長度 */
function makeJpeg(seed = 0, size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0].slice(0, size));
  for (let i = 4; i < size; i++) bytes[i] = (seed * 37 + i * 11) & 0xff;
  return bytes;
}

const toArrayBuffer = (u: Uint8Array): ArrayBuffer => new Uint8Array(u).buffer;
const same = (a: ArrayBuffer | Uint8Array, b: ArrayBuffer | Uint8Array): boolean =>
  Buffer.from(a instanceof ArrayBuffer ? new Uint8Array(a) : a).equals(Buffer.from(b instanceof ArrayBuffer ? new Uint8Array(b) : b));

// ─── reference.ts（§5.1b）───────────────────────────────────────────

describe('§5.1b checkReference', () => {
  it('省略或 undefined → 沒有參考圖（topic 模式）', () => {
    expect(checkReference(undefined)).toEqual({ ok: true, jpeg: null });
  });

  it('ArrayBuffer／Uint8Array／Buffer 的合法 JPEG → 回獨立複本', () => {
    const src = makeJpeg(1);
    for (const value of [toArrayBuffer(src), src, Buffer.from(src)]) {
      const r = checkReference(value);
      if (!r.ok || r.jpeg === null) throw new Error('應為合法參考圖');
      expect(same(r.jpeg, src)).toBe(true);
      expect(r.jpeg).not.toBe(value);
    }
  });

  it('frame 切片（byteOffset ≠ 0 的 Buffer）只取自己那段、不帶出其他 bytes', () => {
    const frame = Buffer.concat([Buffer.from('header-junk'), Buffer.from(makeJpeg(2, 40)), Buffer.from('tail')]);
    const view = frame.subarray(11, 51);
    const r = checkReference(view);
    if (!r.ok || r.jpeg === null) throw new Error('應為合法參考圖');
    expect(r.jpeg.byteLength).toBe(40);
    expect(same(r.jpeg, makeJpeg(2, 40))).toBe(true);
  });

  it('長度邊界：恰好 MAX_REFERENCE_BYTES 合法；多 1 byte、空、短於 magic 不合法', () => {
    expect(checkReference(makeJpeg(0, MAX_REFERENCE_BYTES)).ok).toBe(true);
    expect(checkReference(makeJpeg(0, MAX_REFERENCE_BYTES + 1))).toEqual({ ok: false });
    expect(checkReference(new ArrayBuffer(0))).toEqual({ ok: false });
    expect(checkReference(Uint8Array.from([0xff, 0xd8]))).toEqual({ ok: false });
    expect(checkReference(Uint8Array.from(JPEG_SIGNATURE)).ok).toBe(true);
  });

  it('非 JPEG（PNG、GIF、magic 差一個 byte）不合法', () => {
    expect(checkReference(makePng(0))).toEqual({ ok: false });
    expect(checkReference(Buffer.from('GIF89a......'))).toEqual({ ok: false });
    expect(checkReference(Uint8Array.from([0xff, 0xd8, 0xfe, 0xe0, 0, 0]))).toEqual({ ok: false });
    expect(isValidReferenceJpeg(Uint8Array.from([0xfe, 0xd8, 0xff]))).toBe(false);
  });

  it('型別不對（null、字串、數字、陣列、物件、其他 TypedArray、DataView）不合法', () => {
    const jpeg = makeJpeg(3);
    for (const v of [null, 'ffd8ff', 42, [0xff, 0xd8, 0xff], { 0: 0xff }, new Uint16Array(jpeg.buffer), new DataView(jpeg.buffer)]) {
      expect(checkReference(v)).toEqual({ ok: false });
    }
  });
});

// ─── Room ─────────────────────────────────────────────────────────

const TIMEOUT_MS = 30_000;

let clock: FakeClock;
let asyncEffects: Effect[][];
let judge: ManualJudge;
let fallback: FnJudge;
let commentator: ManualCommentator;
let room: Room;

function makeRoom(opts: Partial<RoomOptions> = {}): Room {
  let n = 0;
  return new Room({
    clock,
    newId: () => `id${++n}`,
    onAsyncEffects: (e) => asyncEffects.push(e),
    judge: { judge, fallback, timeoutMs: TIMEOUT_MS },
    comment: { commentator, timeoutMs: TIMEOUT_MS },
    ...opts,
  });
}

beforeEach(() => {
  clock = new FakeClock();
  asyncEffects = [];
  judge = new ManualJudge('ai');
  fallback = new FnJudge(() => ({ score: 10, confidence: 0.4 }), 'random');
  commentator = new ManualCommentator();
  room = makeRoom();
});

afterEach(() => room.dispose());

// 固定的 id：A = id1（socket s1）、C = id5（s3）
const A = 'id1';
const C = 'id5';
const NAMES = ['Alice', 'Bob', 'Carol', 'Dave'];

function joinOk(socketId: string, nickname: string, token?: string) {
  const r = room.join(socketId, nickname, token);
  if (!r.ack.ok) throw new Error(`join 失敗：${r.ack.error}`);
  return { data: r.ack.data, effects: r.effects };
}

function ok(outcome: { ack: { ok: boolean } }): void {
  expect(outcome.ack).toEqual({ ok: true, data: undefined });
}

function emits(effects: Effect[]): EmitEffect[] {
  return effects.filter((e): e is EmitEffect => e.kind === 'emit');
}

function eventsOf(effects: Effect[]): string[] {
  return emits(effects).map((e) => e.event);
}

function rounds(effects: Effect[]): RoundPublic[] {
  return emits(effects).filter((e) => e.event === 'round:update').map((e) => e.payload as RoundPublic);
}

function references(effects: Effect[]): EmitEffect[] {
  return emits(effects).filter((e) => e.event === 'contest:reference');
}

function chatTexts(effects: Effect[]): string[] {
  return emits(effects).filter((e) => e.event === 'chat:message').map((e) => (e.payload as ChatMessage).text);
}

const round = (): RoundPublic => room.currentRound();

function joinPlayers(n = 2): void {
  for (let i = 0; i < n; i++) joinOk(`s${i + 1}`, NAMES[i]);
}

/** 出題（s1 當出題者）；reference 省略 = topic 模式 */
function toDrawing(topic: string, reference?: unknown) {
  ok(room.volunteer('s1'));
  const r = room.setTopic('s1', topic, reference);
  ok(r);
  return r;
}

/** 兩人交卷、評完（A 80 分、B 60 分）→ ended；回傳 ended 的 round */
async function finishRound(): Promise<RoundPublic> {
  const base = judge.calls.length;
  room.submit('s1', { png: makePng(1) });
  room.submit('s2', { png: makePng(2) });
  await flush();
  judge.resolveCall(base, 80);
  await flush();
  judge.resolveCall(base + 1, 60);
  await flush();
  expect(round().phase).toBe('ended');
  return round();
}

describe('§5 setTopic 帶參考圖 → mimic 回合', () => {
  it('drawing：mode mimic、round:update 之後廣播 contest:reference（roundNo 與 bytes 相同、給所有在線者）、mimic 系統訊息逐字', () => {
    joinPlayers(3);
    const jpeg = makeJpeg(5);
    const r = toDrawing('  皮卡丘 ', toArrayBuffer(jpeg));
    expect(eventsOf(r.effects)).toEqual(['round:update', 'contest:reference', 'players:update', 'chat:message']);
    expect(rounds(r.effects)[0]).toMatchObject({ roundNo: 1, phase: 'drawing', topic: '皮卡丘', mode: 'mimic', lastMode: null, results: null });
    const [ref] = references(r.effects);
    expect(ref.to).toBe('all');
    const payload = ref.payload as ReferenceImage;
    expect(Object.keys(payload).sort()).toEqual(['jpeg', 'roundNo']);
    expect(payload.roundNo).toBe(1);
    expect(payload.jpeg).toBeInstanceOf(ArrayBuffer);
    expect(same(payload.jpeg, jpeg)).toBe(true);
    expect(chatTexts(r.effects)).toEqual(['Alice 出題「皮卡丘」（像不像比賽：照著參考圖畫）']);
  });

  it('不帶參考圖 → mode topic、沒有 contest:reference、系統訊息照舊', () => {
    joinPlayers(2);
    const r = toDrawing('蘋果');
    expect(eventsOf(r.effects)).toEqual(['round:update', 'players:update', 'chat:message']);
    expect(round()).toMatchObject({ mode: 'topic', lastMode: null });
    expect(chatTexts(r.effects)).toEqual(['Alice 出題「蘋果」，開始作畫']);
  });

  it('idle／choosing 的 mode 為 null', () => {
    joinPlayers(2);
    expect(round().mode).toBeNull();
    ok(room.volunteer('s1'));
    expect(round()).toMatchObject({ phase: 'choosing', mode: null, lastMode: null });
  });
});

describe('§5.1b 檢查順序：phase／身分 → TOPIC_INVALID → REFERENCE_INVALID（失敗仍在 choosing）', () => {
  const REFERENCE_INVALID = { ok: false, error: 'REFERENCE_INVALID', message: '參考圖格式不正確或太大（請選圖片檔）' };

  it('文案逐字（§5.4）', () => {
    expect(ROUND_ERROR_MESSAGES.REFERENCE_INVALID).toBe('參考圖格式不正確或太大（請選圖片檔）');
  });

  it('非 JPEG、超過 2 MiB、空 → REFERENCE_INVALID，沒有效果、仍在 choosing、計時器照走', () => {
    joinPlayers(2);
    ok(room.volunteer('s1'));
    const before = round();
    for (const bad of [makePng(0), makeJpeg(0, MAX_REFERENCE_BYTES + 1), new ArrayBuffer(0), null, 'abc']) {
      const r = room.setTopic('s1', '蘋果', bad);
      expect(r.ack).toEqual(REFERENCE_INVALID);
      expect(r.effects).toEqual([]);
      expect(round()).toEqual(before);
    }
    // 修正後同一個出題者可以再送
    ok(room.setTopic('s1', '蘋果', makeJpeg(1)));
    expect(round()).toMatchObject({ phase: 'drawing', mode: 'mimic' });
  });

  it('題目與參考圖都不合法 → 先報 TOPIC_INVALID', () => {
    joinPlayers(2);
    ok(room.volunteer('s1'));
    expect(room.setTopic('s1', '   ', makePng(0)).ack).toEqual({ ok: false, error: 'TOPIC_INVALID', message: TOPIC_INVALID_MESSAGE });
  });

  it('非出題者／idle → NOT_SETTER、drawing 中 → ROUND_BUSY，皆先於參考圖檢查', () => {
    joinPlayers(2);
    expect(room.setTopic('s1', '蘋果', makePng(0)).ack).toMatchObject({ error: 'NOT_SETTER' });
    ok(room.volunteer('s1'));
    expect(room.setTopic('s2', '蘋果', makePng(0)).ack).toMatchObject({ error: 'NOT_SETTER' });
    ok(room.setTopic('s1', '蘋果', makeJpeg(0)));
    expect(room.setTopic('s1', '蘋果', makePng(0)).ack).toMatchObject({ error: 'ROUND_BUSY' });
  });
});

describe('§6／§6.1 mimic 回合：評分與評語都帶參考圖', () => {
  it('交卷 → 評分輸入帶 reference（bytes 相同）；評完 → 評語輸入帶 reference；第一名稱讚版也帶', async () => {
    joinPlayers(2);
    const jpeg = makeJpeg(9);
    toDrawing('皮卡丘', jpeg);
    await finishRound();
    expect(judge.calls).toHaveLength(2);
    for (const c of judge.calls) {
      expect(c.input.topic).toBe('皮卡丘');
      expect(c.input.reference).toBeInstanceOf(Buffer);
      expect(same(c.input.reference!, jpeg)).toBe(true);
    }
    // 評語：A、B 各一（批評版），揭曉後第一名 A 的稱讚版插隊（A 的批評版在途、跑完才輪到）
    commentator.resolveCall(0, '批評A');
    await flush();
    commentator.resolveCall(1, '稱讚A');
    await flush();
    const inputs = commentator.calls.map((c) => c.input);
    expect(inputs.map((i) => [i.nickname, i.praise === true])).toEqual([
      ['Alice', false],
      ['Alice', true],
      ['Bob', false],
    ]);
    for (const i of inputs) expect(same(i.reference!, jpeg)).toBe(true);
  });

  it('topic 回合：評分與評語輸入都沒有 reference 欄位（與 Epic 20 之前完全相同）', async () => {
    joinPlayers(2);
    toDrawing('蘋果');
    await finishRound();
    for (const c of judge.calls) expect('reference' in c.input).toBe(false);
    for (const c of commentator.calls) expect('reference' in c.input).toBe(false);
  });
});

describe('§5 ended：lastMode 與 results 同生命週期', () => {
  it('mimic：ended 時 mode 仍為 mimic、lastMode mimic；下一回合 choosing 保留 lastMode（mode 回 null）；drawing 清空', async () => {
    joinPlayers(2);
    toDrawing('皮卡丘', makeJpeg(1));
    const ended = await finishRound();
    expect(ended).toMatchObject({ phase: 'ended', mode: 'mimic', lastMode: 'mimic', lastTopic: '皮卡丘' });
    ok(room.volunteer('s2'));
    expect(round()).toMatchObject({ phase: 'choosing', mode: null, lastMode: 'mimic', lastTopic: '皮卡丘' });
    ok(room.cancel('s2'));
    expect(round()).toMatchObject({ phase: 'idle', mode: null, lastMode: 'mimic' });
    ok(room.volunteer('s2'));
    ok(room.setTopic('s2', '貓'));
    expect(round()).toMatchObject({ phase: 'drawing', mode: 'topic', lastMode: null, results: null, lastTopic: null });
  });

  it('topic：ended 的 lastMode 為 topic', async () => {
    joinPlayers(2);
    toDrawing('蘋果');
    expect((await finishRound()).lastMode).toBe('topic');
  });
});

describe('§5.1b join 補送 contest:reference', () => {
  /** 新玩家加入的效果中，contest:reference 只給本人；回傳 payload（沒有則 undefined） */
  function joinReference(socketId: string, nickname: string): ReferenceImage | undefined {
    const { data, effects } = joinOk(socketId, nickname);
    const refs = references(effects);
    expect(refs.length).toBeLessThanOrEqual(1);
    if (refs.length === 0) return undefined;
    expect(refs[0].to).toEqual({ only: data.snapshot.you });
    // 排在畫廊之前（揭曉畫廊第一格是參考圖）
    const order = eventsOf(effects);
    const g = order.indexOf('contest:gallery');
    if (g >= 0) expect(order.indexOf('contest:reference')).toBeLessThan(g);
    return refs[0].payload as ReferenceImage;
  }

  it('drawing／judging／ended 中途加入 → 補送本回合參考圖；topic 回合不送', async () => {
    joinPlayers(2);
    const jpeg = makeJpeg(4);
    toDrawing('皮卡丘', jpeg);
    const d = joinReference('s3', 'Carol');
    expect(d?.roundNo).toBe(1);
    expect(same(d!.jpeg, jpeg)).toBe(true);

    // Carol 是中途加入的旁觀者；參賽者 A、B 都交卷 → judging
    room.submit('s1', { png: makePng(1) });
    room.submit('s2', { png: makePng(2) });
    expect(round().phase).toBe('judging');
    expect(joinReference('s4', 'Dave')?.roundNo).toBe(1);

    await flush();
    judge.resolveCall(0, 70);
    await flush();
    judge.resolveCall(1, 50);
    await flush();
    expect(round().phase).toBe('ended');
    const e = joinReference('s5', 'Eve');
    expect(e?.roundNo).toBe(1);
    expect(same(e!.jpeg, jpeg)).toBe(true);
  });

  it('上一回合是 mimic：下一回合 choosing、取消後 idle 加入 → 補送上回合參考圖（roundNo 為該回合）', async () => {
    joinPlayers(2);
    const jpeg = makeJpeg(6);
    toDrawing('皮卡丘', jpeg);
    await finishRound();
    ok(room.volunteer('s2'));
    const c = joinReference('s3', 'Carol');
    expect(c?.roundNo).toBe(1);
    expect(same(c!.jpeg, jpeg)).toBe(true);
    ok(room.cancel('s2'));
    expect(joinReference('s4', 'Dave')?.roundNo).toBe(1);
  });

  it('下一回合 topic 的 drawing 開始後 → 不再補送（上回合參考圖已清掉）；topic 回合 ended 也不送', async () => {
    joinPlayers(2);
    toDrawing('皮卡丘', makeJpeg(1));
    await finishRound();
    ok(room.volunteer('s1'));
    const r = room.setTopic('s1', '貓');
    ok(r);
    expect(references(r.effects)).toEqual([]);
    expect(joinReference('s3', 'Carol')).toBeUndefined();
    await finishRound(); // Carol 是旁觀者，A、B 交卷評完
    expect(round()).toMatchObject({ phase: 'ended', mode: 'topic', lastMode: 'topic' });
    expect(joinReference('s4', 'Dave')).toBeUndefined();
  });

  it('下一回合 mimic：換成新的參考圖與 roundNo；評分輸入用新的', async () => {
    joinPlayers(2);
    toDrawing('皮卡丘', makeJpeg(1));
    await finishRound();
    ok(room.volunteer('s1'));
    const second = makeJpeg(2, 80);
    const r = room.setTopic('s1', '妙蛙種子', second);
    ok(r);
    const [ref] = references(r.effects);
    expect((ref.payload as ReferenceImage).roundNo).toBe(2);
    expect(same((ref.payload as ReferenceImage).jpeg, second)).toBe(true);
    const j = joinReference('s3', 'Carol');
    expect(j?.roundNo).toBe(2);
    expect(same(j!.jpeg, second)).toBe(true);
    room.submit('s1', { png: makePng(7) });
    await flush();
    expect(same(judge.calls.at(-1)!.input.reference!, second)).toBe(true);
  });

  it('從未有 mimic 回合：idle 加入不送', () => {
    joinPlayers(1);
    expect(joinReference('s2', 'Bob')).toBeUndefined();
  });

  it('接管（token 重連）與同 socket 重複 join 也補送', () => {
    joinPlayers(2);
    const token = joinOk('s3', 'Carol').data.token;
    toDrawing('皮卡丘', makeJpeg(1));
    room.disconnect('s3');
    const takeover = room.join('s9', 'whatever', token);
    expect(takeover.ack.ok).toBe(true);
    expect(references(takeover.effects).map((e) => e.to)).toEqual([{ only: C }]);
    const again = room.join('s9', 'x');
    expect(references(again.effects).map((e) => e.to)).toEqual([{ only: C }]);
    expect(references(room.join('s1', 'Alice').effects).map((e) => e.to)).toEqual([{ only: A }]);
  });
});
