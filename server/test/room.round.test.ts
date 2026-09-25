// Room 回合狀態機：spec/architecture.md §5 轉移表、draw:op 驗證、筆跡歷史正規化逐列測試（Phase 2）
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BRUSH_MAX,
  BRUSH_MIN,
  CHOOSING_SECONDS,
  ENDED_SECONDS,
  MAX_OPS_PER_ROUND,
  MAX_POINTS_PER_MOVE,
  MIN_PLAYERS,
  PALETTE,
  ROUND_SECONDS,
  STROKE_ID_MAX,
  TOPIC_MAX,
  type ChatMessage,
  type DrawOp,
  type PlayerPublic,
  type RoundPublic,
} from '@fishing-work/shared';
import { GRACE_MS, NO_GUESSERS_MESSAGE, ROUND_ERROR_MESSAGES, Room, type EmitEffect, type Effect, type RoomOptions } from '../src/games/draw-guess/room';
import { TOPIC_INVALID_MESSAGE } from '../src/games/draw-guess/topic';
import { FakeClock } from './helpers/fakeClock';

// ─── 測試工具 ─────────────────────────────────────────────────────

/** 測試用：Phase 3 才有猜題；此處直接把玩家標成已猜對以測 allGuessed 與畫師結算 */
class TestRoom extends Room {
  forceGuessed(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p) throw new Error(`no player ${playerId}`);
    p.hasGuessed = true;
    this.round.correctIds.push(playerId);
  }
  /** 測試用：繞過 leave 直接移除玩家（製造「choosing 中沒有猜題者」這種正常流程到不了的狀態） */
  dropSilently(playerId: string): void {
    this.players.delete(playerId);
  }
}

const CHOOSING_MS = CHOOSING_SECONDS * 1000;
const ROUND_MS = ROUND_SECONDS * 1000;
const ENDED_MS = ENDED_SECONDS * 1000;

let clock: FakeClock;
let asyncEffects: Effect[][];
let room: TestRoom;

function makeRoom(opts: Partial<RoomOptions> = {}): TestRoom {
  let n = 0;
  return new TestRoom({ clock, newId: () => `id${++n}`, onAsyncEffects: (e) => asyncEffects.push(e), ...opts });
}

beforeEach(() => {
  clock = new FakeClock();
  asyncEffects = [];
  room = makeRoom();
});

afterEach(() => room.dispose());

// 固定的 id：A = id1（token id2，socket s1）、B = id3（token id4，s2）、C = id5（token id6，s3）
const A = 'id1';
const B = 'id3';
const C = 'id5';

function join(socketId: string, nickname: string, token?: string) {
  const r = room.join(socketId, nickname, token);
  if (!r.ack.ok) throw new Error(`join 失敗：${r.ack.error}`);
  return r.ack.data;
}

function joinPlayers(n = 2): void {
  const names = ['Alice', 'Bob', 'Carol', 'Dave'];
  for (let i = 0; i < n; i++) join(`s${i + 1}`, names[i]);
}

function ok(outcome: { ack: { ok: boolean } }): void {
  expect(outcome.ack).toEqual({ ok: true, data: undefined });
}

/** A 當畫師、進入 choosing */
function toChoosing(n = 2): void {
  joinPlayers(n);
  ok(room.volunteer('s1'));
}

/** A 當畫師、出題「蘋果」、進入 drawing */
function toDrawing(n = 2, topic = '蘋果'): void {
  toChoosing(n);
  ok(room.setTopic('s1', topic));
}

function emits(effects: Effect[]): EmitEffect[] {
  return effects.filter((e): e is EmitEffect => e.kind === 'emit');
}

function eventsOf(effects: Effect[]): string[] {
  return emits(effects).map((e) => e.event);
}

/** 取第 index 個 round:update，依收件者展開 payload */
function roundFor(effects: Effect[], playerId: string, index = 0): RoundPublic {
  const e = emits(effects).filter((x) => x.event === 'round:update')[index];
  if (!e) throw new Error('沒有 round:update');
  const p = e.payload as RoundPublic | ((id: string) => RoundPublic);
  return typeof p === 'function' ? p(playerId) : p;
}

function playersPayload(effects: Effect[]): PlayerPublic[] {
  const e = emits(effects).find((x) => x.event === 'players:update');
  if (!e || typeof e.payload === 'function') throw new Error('沒有 players:update');
  return e.payload as PlayerPublic[];
}

function chatTexts(effects: Effect[]): string[] {
  return emits(effects)
    .filter((x) => x.event === 'chat:message')
    .map((x) => (x.payload as ChatMessage).text);
}

function player(id: string): PlayerPublic {
  const p = room.playerList().find((x) => x.id === id);
  if (!p) throw new Error(`no player ${id}`);
  return p;
}

function round(forId = A): RoundPublic {
  return room.projectRound(forId);
}

function ops(): DrawOp[] {
  return room.snapshot(B).ops;
}

const IDLE: RoundPublic = {
  phase: 'idle',
  drawerId: null,
  topic: null,
  topicLength: null,
  startedAt: null,
  endsAt: null,
  correctIds: [],
  endReason: null,
};

const begin = (strokeId: string, extra: Partial<Extract<DrawOp, { type: 'begin' }>> = {}): DrawOp => ({
  type: 'begin',
  strokeId,
  tool: 'pen',
  color: PALETTE[0],
  size: 4,
  point: { x: 0.1, y: 0.2 },
  ...extra,
});
const move = (strokeId: string, points = [{ x: 0.3, y: 0.4 }]): DrawOp => ({ type: 'move', strokeId, points });
const end = (strokeId: string): DrawOp => ({ type: 'end', strokeId });
const undo = (strokeId: string): DrawOp => ({ type: 'undo', strokeId });
const CLEAR: DrawOp = { type: 'clear' };

function drawOk(op: unknown, socketId = 's1'): Effect[] {
  const r = room.draw(socketId, op);
  expect(r.dropped).toBeNull();
  return r.effects;
}

function drawDropped(op: unknown, socketId = 's1'): string {
  const r = room.draw(socketId, op);
  expect(r.effects).toEqual([]);
  expect(r.dropped).not.toBeNull();
  return r.dropped as string;
}

/** 完整一筆：begin / move / end */
function stroke(id: string): DrawOp[] {
  const list = [begin(id), move(id), end(id)];
  for (const op of list) drawOk(op);
  return list;
}

// ─── volunteer ────────────────────────────────────────────────────

describe('§5 volunteer', () => {
  it('成功：drawer = 自己、phase = choosing、endsAt = now + CHOOSING；round:update（依收件者）＋ players:update（isDrawer）', () => {
    joinPlayers(2);
    const r = room.volunteer('s1');
    ok(r);
    expect(eventsOf(r.effects)).toEqual(['round:update', 'players:update']);
    expect(emits(r.effects).every((e) => e.to === 'all')).toBe(true);
    const expected: RoundPublic = { ...IDLE, phase: 'choosing', drawerId: A, endsAt: clock.t + CHOOSING_MS };
    expect(roundFor(r.effects, A)).toEqual(expected);
    expect(roundFor(r.effects, B)).toEqual(expected);
    expect(playersPayload(r.effects).map((p) => [p.id, p.isDrawer])).toEqual([
      [A, true],
      [B, false],
    ]);
    expect(round()).toEqual(expected);
  });

  it('非 idle（choosing / drawing / ended）一律 ROUND_BUSY，無效果、狀態不變', () => {
    toChoosing(3);
    expect(room.volunteer('s2')).toEqual({
      ack: { ok: false, error: 'ROUND_BUSY', message: ROUND_ERROR_MESSAGES.ROUND_BUSY },
      effects: [],
    });
    ok(room.setTopic('s1', '蘋果'));
    expect(room.volunteer('s2').ack).toMatchObject({ ok: false, error: 'ROUND_BUSY' });
    ok(room.cancel('s1'));
    expect(round().phase).toBe('ended');
    expect(room.volunteer('s2').ack).toMatchObject({ ok: false, error: 'ROUND_BUSY' });
    expect(round().drawerId).toBe(A);
  });

  it(`在線人數 < MIN_PLAYERS（${MIN_PLAYERS}）→ NOT_ENOUGH_PLAYERS`, () => {
    joinPlayers(1);
    expect(room.volunteer('s1')).toEqual({
      ack: { ok: false, error: 'NOT_ENOUGH_PLAYERS', message: ROUND_ERROR_MESSAGES.NOT_ENOUGH_PLAYERS },
      effects: [],
    });
    expect(round().phase).toBe('idle');
  });

  it('寬限期中（connected=false）的玩家不計入在線人數；接管回來後可開始', () => {
    joinPlayers(2);
    room.disconnect('s2');
    expect(room.volunteer('s1').ack).toMatchObject({ ok: false, error: 'NOT_ENOUGH_PLAYERS' });
    join('s2b', 'x', 'id4');
    ok(room.volunteer('s1'));
  });

  it('未加入的 socket → NOT_IN_ROOM', () => {
    joinPlayers(2);
    expect(room.volunteer('nope')).toEqual({
      ack: { ok: false, error: 'NOT_IN_ROOM', message: ROUND_ERROR_MESSAGES.NOT_IN_ROOM },
      effects: [],
    });
  });

  it('volunteer 清掉上一回合保留的 endReason', () => {
    toChoosing(2);
    ok(room.cancel('s1'));
    expect(round().endReason).toBe('cancelled');
    ok(room.volunteer('s2'));
    expect(round().endReason).toBeNull();
  });
});

// ─── setTopic ────────────────────────────────────────────────────

describe('§5 setTopic', () => {
  it('成功：phase = drawing、startedAt / endsAt、topic 去頭尾空白、topicLength（code point）', () => {
    toChoosing(2);
    clock.advance(3000);
    ok(room.setTopic('s1', '  蘋果🍎 '));
    expect(round(A)).toEqual({
      ...IDLE,
      phase: 'drawing',
      drawerId: A,
      topic: '蘋果🍎',
      topicLength: 3,
      startedAt: clock.t,
      endsAt: clock.t + ROUND_MS,
    });
  });

  it('round:update 依收件者遮罩：畫師含 topic；其他人 topic = null、只有 topicLength', () => {
    toChoosing(3);
    const r = room.setTopic('s1', '蘋果');
    expect(roundFor(r.effects, A)).toMatchObject({ topic: '蘋果', topicLength: 2 });
    expect(roundFor(r.effects, B)).toMatchObject({ phase: 'drawing', topic: null, topicLength: 2 });
    expect(roundFor(r.effects, C)).toMatchObject({ topic: null, topicLength: 2 });
    expect(room.snapshot(B).round.topic).toBeNull();
    expect(room.snapshot(A).round.topic).toBe('蘋果');
  });

  it('效果：round:update 給所有人、draw:op {clear} 給畫師以外的人、system「X 開始作畫」給所有人', () => {
    toChoosing(2);
    const r = room.setTopic('s1', '蘋果');
    expect(eventsOf(r.effects)).toEqual(['round:update', 'draw:op', 'chat:message']);
    expect(emits(r.effects)[1]).toEqual({ kind: 'emit', to: { except: A }, event: 'draw:op', payload: CLEAR });
    expect(emits(r.effects)[2].to).toBe('all');
    expect(chatTexts(r.effects)).toEqual(['Alice 開始作畫']);
  });

  it('清空 ops、open stroke、用過的 strokeId、correctIds；hasGuessed 已在回 idle 時清除，setTopic 不再發 players:update', () => {
    toDrawing(3);
    drawOk(begin('k1')); // 留一個 open stroke
    room.forceGuessed(B);
    ok(room.cancel('s1'));
    clock.advance(ENDED_MS);
    expect(ops()).toHaveLength(1); // idle 時 ops 保留
    ok(room.volunteer('s2'));
    expect(ops()).toHaveLength(1); // choosing 時仍保留
    expect(room.playerList().every((p) => !p.hasGuessed)).toBe(true); // idle 時已清
    const r = room.setTopic('s2', '香蕉');
    expect(ops()).toEqual([]);
    expect(round().correctIds).toEqual([]);
    expect(room.playerList().every((p) => !p.hasGuessed)).toBe(true);
    expect(eventsOf(r.effects)).toEqual(['round:update', 'draw:op', 'chat:message']);
    // 新回合：strokeId k1 可重用；舊的 open stroke 不再存在
    expect(drawDropped(move('k1'), 's2')).toBe('notOpenStroke');
    drawOk(begin('k1'), 's2');
  });

  it('清掉 choosing 計時器：出題後原本的 60 秒期限不會觸發', () => {
    toChoosing(2);
    clock.advance(10_000);
    ok(room.setTopic('s1', '蘋果'));
    clock.advance(CHOOSING_MS);
    expect(asyncEffects).toEqual([]);
    expect(round().phase).toBe('drawing');
  });

  it(`剛好 ${TOPIC_MAX} 字、${TOPIC_MAX} 個 emoji 皆合法`, () => {
    toChoosing(2);
    ok(room.setTopic('s1', '字'.repeat(TOPIC_MAX)));
    expect(round().topicLength).toBe(TOPIC_MAX);
    room.dispose();
    room = makeRoom();
    toChoosing(2);
    ok(room.setTopic('s1', '🍎'.repeat(TOPIC_MAX)));
    expect(round().topicLength).toBe(TOPIC_MAX);
  });

  it.each([
    ['空字串', ''],
    ['全空白（含全形空白）', '  　 '],
    [`${TOPIC_MAX + 1} 字`, '字'.repeat(TOPIC_MAX + 1)],
    [`${TOPIC_MAX + 1} 個 emoji`, '🍎'.repeat(TOPIC_MAX + 1)],
    ['含換行', '蘋\n果'],
    ['含 tab', '蘋\t果'],
    ['含 NUL', '蘋\u0000果'],
    ['超長字串', 'x'.repeat(100_000)],
  ])('不合法（%s）→ TOPIC_INVALID，無效果、仍在 choosing', (_label, topic) => {
    toChoosing(2);
    expect(room.setTopic('s1', topic)).toEqual({
      ack: { ok: false, error: 'TOPIC_INVALID', message: TOPIC_INVALID_MESSAGE },
      effects: [],
    });
    expect(round().phase).toBe('choosing');
  });

  it('沒有猜題者（在房非畫師為 0）→ NOT_ENOUGH_PLAYERS，無效果、仍在 choosing（§5 Phase 2 驗收定案）', () => {
    toChoosing(2);
    room.dropSilently(B);
    expect(room.setTopic('s1', '蘋果')).toEqual({
      ack: { ok: false, error: 'NOT_ENOUGH_PLAYERS', message: NO_GUESSERS_MESSAGE },
      effects: [],
    });
    expect(round().phase).toBe('choosing');
  });

  it('猜題者範圍含寬限期中：唯一的猜題者斷線（未逾期）仍可出題', () => {
    toChoosing(2);
    room.disconnect('s2');
    ok(room.setTopic('s1', '蘋果'));
    expect(round().phase).toBe('drawing');
  });

  it('無猜題者的判斷排在題目驗證之前（不合法題目也回 NOT_ENOUGH_PLAYERS）', () => {
    toChoosing(3);
    room.dropSilently(B);
    room.dropSilently(C);
    expect(room.setTopic('s1', '').ack).toMatchObject({ ok: false, error: 'NOT_ENOUGH_PLAYERS' });
  });

  it('非畫師 → NOT_DRAWER', () => {
    toChoosing(2);
    expect(room.setTopic('s2', '蘋果')).toEqual({
      ack: { ok: false, error: 'NOT_DRAWER', message: ROUND_ERROR_MESSAGES.NOT_DRAWER },
      effects: [],
    });
  });

  it('idle 時 → NOT_DRAWER；畫師在 drawing 再出題 → ROUND_BUSY；未加入 → NOT_IN_ROOM', () => {
    joinPlayers(2);
    expect(room.setTopic('s1', '蘋果').ack).toMatchObject({ ok: false, error: 'NOT_DRAWER' });
    ok(room.volunteer('s1'));
    ok(room.setTopic('s1', '蘋果'));
    expect(room.setTopic('s1', '香蕉').ack).toMatchObject({ ok: false, error: 'ROUND_BUSY' });
    expect(round().topic).toBe('蘋果');
    expect(room.setTopic('nope', '蘋果').ack).toMatchObject({ ok: false, error: 'NOT_IN_ROOM' });
  });
});

// ─── draw：共同條件與形狀驗證 ─────────────────────────────────────

describe('§5 draw（共同條件）', () => {
  it('畫師在 drawing：begin / move / end 追加 ops，原樣轉發給畫師以外的人', () => {
    toDrawing(3);
    const list = [begin('k1'), move('k1', [{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.6 }]), end('k1')];
    for (const op of list) {
      expect(drawOk(op)).toEqual([{ kind: 'emit', to: { except: A }, event: 'draw:op', payload: op }]);
    }
    expect(room.snapshot(C).ops).toEqual(list);
  });

  it('非畫師送 draw:op → 丟棄（不追加、不轉發）', () => {
    toDrawing(2);
    expect(drawDropped(begin('k1'), 's2')).toBe('notDrawer');
    expect(ops()).toEqual([]);
  });

  it('非 drawing 階段（idle / choosing / ended）→ 丟棄', () => {
    joinPlayers(2);
    expect(drawDropped(begin('k1'))).toBe('phase');
    ok(room.volunteer('s1'));
    expect(drawDropped(begin('k1'))).toBe('phase');
    ok(room.setTopic('s1', '蘋果'));
    ok(room.cancel('s1'));
    expect(drawDropped(CLEAR)).toBe('phase');
    expect(ops()).toEqual([]);
  });

  it('未加入的 socket → 丟棄', () => {
    toDrawing(2);
    expect(drawDropped(begin('k1'), 'nope')).toBe('notInRoom');
  });

  it.each<[string, unknown]>([
    ['不是物件', 'begin'],
    ['null', null],
    ['陣列', [begin('k1')]],
    ['未知 type', { type: 'fill', strokeId: 'k1' }],
    ['color 短碼 #fff', { ...begin('k1'), color: '#fff' }],
    ['color 沒有 #', { ...begin('k1'), color: 'FFFFFF' }],
    ['color 8 碼（含 alpha）', { ...begin('k1'), color: '#FFFFFF80' }],
    ['color 非十六進位字元', { ...begin('k1'), color: '#GGGGGG' }],
    ['color 前後帶空白', { ...begin('k1'), color: ' #FFFFFF' }],
    ['color 結尾換行', { ...begin('k1'), color: '#FFFFFF\n' }],
    ['color 色名', { ...begin('k1'), color: 'red' }],
    ['color 為數字', { ...begin('k1'), color: 0xffffff }],
    ['橡皮擦沒帶 color', { ...begin('k1', { tool: 'eraser' }), color: undefined }],
    ['橡皮擦 color 不合法', { ...begin('k1', { tool: 'eraser' }), color: '#fff' }],
    [`size 0（< BRUSH_MIN ${BRUSH_MIN}）`, { ...begin('k1'), size: BRUSH_MIN - 1 }],
    [`size 65（> BRUSH_MAX ${BRUSH_MAX}）`, { ...begin('k1'), size: BRUSH_MAX + 1 }],
    ['size 負數', { ...begin('k1'), size: -4 }],
    ['size 非整數 0.5', { ...begin('k1'), size: 0.5 }],
    ['size 非整數 4.5', { ...begin('k1'), size: 4.5 }],
    ['size NaN', { ...begin('k1'), size: Number.NaN }],
    ['size Infinity', { ...begin('k1'), size: Number.POSITIVE_INFINITY }],
    ['size 為字串', { ...begin('k1'), size: '4' }],
    ['size 缺', { ...begin('k1'), size: undefined }],
    ['tool 不合法', { ...begin('k1'), tool: 'bucket' }],
    ['strokeId 非字串', { ...begin('k1'), strokeId: 1 }],
    ['strokeId 空字串', { ...begin('k1'), strokeId: '' }],
    [`strokeId 超過 ${STROKE_ID_MAX} 字`, { ...begin('k1'), strokeId: 'x'.repeat(STROKE_ID_MAX + 1) }],
    ['point 為 NaN', { ...begin('k1'), point: { x: Number.NaN, y: 0 } }],
    ['point 為 Infinity', { ...begin('k1'), point: { x: 0, y: Number.POSITIVE_INFINITY } }],
    ['point x < 0', { ...begin('k1'), point: { x: -0.01, y: 0 } }],
    ['point y > 1', { ...begin('k1'), point: { x: 0, y: 1.01 } }],
    ['point 缺欄位', { ...begin('k1'), point: { x: 0 } }],
    ['point 為字串數字', { ...begin('k1'), point: { x: '0.1', y: 0.1 } }],
  ])('begin 形狀不合法（%s）→ 丟棄', (_label, op) => {
    toDrawing(2);
    drawDropped(op);
    expect(ops()).toEqual([]);
  });

  it.each<[string, unknown]>([
    ['points 非陣列', { type: 'move', strokeId: 'k1', points: { x: 0, y: 0 } }],
    ['points 空陣列', { type: 'move', strokeId: 'k1', points: [] }],
    [`points 超過 ${MAX_POINTS_PER_MOVE} 點`, { type: 'move', strokeId: 'k1', points: Array.from({ length: MAX_POINTS_PER_MOVE + 1 }, () => ({ x: 0, y: 0 })) }],
    ['points 含 NaN', { type: 'move', strokeId: 'k1', points: [{ x: 0, y: 0 }, { x: Number.NaN, y: 0 }] }],
    ['points 含超出範圍的點', { type: 'move', strokeId: 'k1', points: [{ x: 0.5, y: 0.5 }, { x: 1.5, y: 0 }] }],
    ['strokeId 缺', { type: 'move', points: [{ x: 0, y: 0 }] }],
  ])('move 形狀不合法（%s）→ 整則丟棄', (_label, op) => {
    toDrawing(2);
    drawOk(begin('k1'));
    drawDropped(op);
    expect(ops()).toHaveLength(1);
  });

  it(`邊界值合法：座標 0 與 1、剛好 ${MAX_POINTS_PER_MOVE} 點、${STROKE_ID_MAX} 字 strokeId、橡皮擦帶合法色`, () => {
    toDrawing(2);
    const id = 'x'.repeat(STROKE_ID_MAX);
    drawOk(begin(id, { tool: 'eraser', color: PALETTE[3], size: 16, point: { x: 0, y: 1 } }));
    drawOk(move(id, Array.from({ length: MAX_POINTS_PER_MOVE }, () => ({ x: 1, y: 0 }))));
  });

  it.each<[string, Partial<Extract<DrawOp, { type: 'begin' }>>]>([
    ['PALETTE 以外的任意色', { color: '#123ABC' }],
    ['黑色（原本不在 PALETTE）', { color: '#000000' }],
    ['小寫色碼（原樣保存）', { color: '#ff8c00' }],
    ['大小寫混合', { color: '#aBcDeF' }],
    [`size = BRUSH_MIN（${BRUSH_MIN}）`, { size: BRUSH_MIN }],
    [`size = BRUSH_MAX（${BRUSH_MAX}）`, { size: BRUSH_MAX }],
    ['size 原固定四段以外的整數 5', { size: 5 }],
    ['size 以整數表示的浮點 12.0', { size: 12.0 }],
    ['橡皮擦帶任意色、最大粗細', { tool: 'eraser', color: '#0A0B0C', size: BRUSH_MAX }],
  ])('begin 合法（%s）→ 存入歷史並原樣轉發', (_label, extra) => {
    toDrawing(2);
    const op = begin('k1', extra);
    const fx = drawOk(op);
    expect(emits(fx)[0].payload).toEqual(op);
    expect(ops()).toEqual([op]);
  });

  it('客戶端多塞的欄位不存、不外流（重建乾淨物件）', () => {
    toDrawing(2);
    const fx = drawOk({ ...begin('k1'), evil: 'x', point: { x: 0.1, y: 0.2, z: 9 } });
    expect(emits(fx)[0].payload).toEqual(begin('k1'));
    const m = drawOk({ ...move('k1'), extra: true });
    expect(emits(m)[0].payload).toEqual(move('k1'));
    expect(emits(drawOk({ type: 'clear', junk: 1 }))[0].payload).toEqual(CLEAR);
  });
});

// ─── draw：有狀態的驗證與筆跡歷史正規化 ─────────────────────────────

describe('§5 draw:op 驗證（open stroke、strokeId、undo）與筆跡歷史正規化', () => {
  it('begin：strokeId 本回合用過（含已 undo / clear 的）→ 丟棄', () => {
    toDrawing(2);
    stroke('k1');
    expect(drawDropped(begin('k1'))).toBe('strokeUsed');
    drawOk(undo('k1'));
    expect(drawDropped(begin('k1'))).toBe('strokeUsed');
    stroke('k2');
    drawOk(CLEAR);
    expect(drawDropped(begin('k2'))).toBe('strokeUsed');
  });

  it('move / end：strokeId 必須是目前 open stroke，否則丟棄', () => {
    toDrawing(2);
    expect(drawDropped(move('k1'))).toBe('notOpenStroke'); // 沒有 open stroke
    stroke('k1');
    expect(drawDropped(move('k1'))).toBe('notOpenStroke'); // 已 end
    expect(drawDropped(end('k1'))).toBe('notOpenStroke');
    drawOk(begin('k2'));
    expect(drawDropped(move('k1'))).toBe('notOpenStroke');
    drawOk(move('k2'));
  });

  it('新的 begin 自動關閉舊的 open stroke（漏掉 pointerup）；舊的之後的 move 丟棄', () => {
    toDrawing(2);
    drawOk(begin('k1'));
    drawOk(move('k1'));
    drawOk(begin('k2'));
    expect(drawDropped(move('k1'))).toBe('notOpenStroke');
    expect(drawDropped(end('k1'))).toBe('notOpenStroke');
    drawOk(move('k2'));
    // 歷史不補 end：與客戶端維護的 ops 一致
    expect(ops()).toEqual([begin('k1'), move('k1'), begin('k2'), move('k2')]);
  });

  it('undo：必須是歷史中最後一筆仍存在的 stroke；移除該筆全部 op，undo 本身不入歷史，原樣轉發', () => {
    toDrawing(3);
    const s1 = stroke('k1');
    stroke('k2');
    expect(drawDropped(undo('k1'))).toBe('undoNotLast');
    expect(drawDropped(undo('nope'))).toBe('undoNotLast');
    const fx = drawOk(undo('k2'));
    expect(fx).toEqual([{ kind: 'emit', to: { except: A }, event: 'draw:op', payload: undo('k2') }]);
    expect(ops()).toEqual(s1);
  });

  it('可連續 undo：每次撤剩餘的最後一筆；全部撤完再 undo → 丟棄', () => {
    toDrawing(2);
    stroke('k1');
    stroke('k2');
    stroke('k3');
    drawOk(undo('k3'));
    expect(drawDropped(undo('k3'))).toBe('undoNotLast');
    drawOk(undo('k2'));
    drawOk(undo('k1'));
    expect(ops()).toEqual([]);
    expect(drawDropped(undo('k1'))).toBe('undoNotLast');
    const s4 = stroke('k4');
    expect(ops()).toEqual(s4);
  });

  it('undo 時若有 open stroke 先視為已 end：可撤畫到一半的筆畫，之後該筆的 move 丟棄', () => {
    toDrawing(2);
    const s1 = stroke('k1');
    drawOk(begin('k2'));
    drawOk(move('k2'));
    drawOk(undo('k2'));
    expect(ops()).toEqual(s1);
    expect(drawDropped(move('k2'))).toBe('notOpenStroke');
    drawOk(undo('k1'));
  });

  it('undo 時的 open stroke 若不是被撤的那筆，無效的 undo 不影響 open stroke', () => {
    toDrawing(2);
    stroke('k1');
    drawOk(begin('k2'));
    expect(drawDropped(undo('k1'))).toBe('undoNotLast');
    drawOk(move('k2'));
  });

  it('clear：清空歷史（clear 本身不入歷史）、原樣轉發；之後無筆畫可 undo', () => {
    toDrawing(2);
    stroke('k1');
    drawOk(begin('k2'));
    const fx = drawOk(CLEAR);
    expect(fx).toEqual([{ kind: 'emit', to: { except: A }, event: 'draw:op', payload: CLEAR }]);
    expect(ops()).toEqual([]);
    expect(drawDropped(undo('k1'))).toBe('undoNotLast');
    expect(drawDropped(move('k2'))).toBe('notOpenStroke');
    const s3 = stroke('k3');
    expect(ops()).toEqual(s3);
  });

  it(`歷史上限 ${MAX_OPS_PER_ROUND}：達上限後丟棄 begin / move / end；undo / clear 仍受理`, () => {
    toDrawing(2);
    drawOk(begin('k1'));
    for (let i = 1; i < MAX_OPS_PER_ROUND - 1; i++) {
      const r = room.draw('s1', move('k1'));
      if (r.dropped !== null) throw new Error(`第 ${i} 個 op 被丟棄：${r.dropped}`);
    }
    drawOk(end('k1'));
    expect(ops()).toHaveLength(MAX_OPS_PER_ROUND);
    expect(drawDropped(begin('k2'))).toBe('opsLimit');
    // undo 釋放空間後可再畫
    drawOk(undo('k1'));
    expect(ops()).toEqual([]);
    stroke('k3');
    expect(ops()).toHaveLength(3);
  });

  it('達上限時 open stroke 的 move / end 也丟棄，clear 仍可用', () => {
    toDrawing(2);
    drawOk(begin('k1'));
    for (let i = 1; i < MAX_OPS_PER_ROUND; i++) room.draw('s1', move('k1'));
    expect(ops()).toHaveLength(MAX_OPS_PER_ROUND);
    expect(drawDropped(move('k1'))).toBe('opsLimit');
    expect(drawDropped(end('k1'))).toBe('opsLimit');
    drawOk(CLEAR);
    expect(ops()).toEqual([]);
  });

  it('中途加入者的快照：ops 已正規化可直接重播、round.topic = null、有 topicLength', () => {
    toDrawing(2);
    const s1 = stroke('k1');
    stroke('k2');
    drawOk(undo('k2'));
    const snap = join('s9', 'Late').snapshot;
    expect(snap.ops).toEqual(s1);
    expect(snap.ops.every((o) => o.type === 'begin' || o.type === 'move' || o.type === 'end')).toBe(true);
    expect(snap.round).toMatchObject({ phase: 'drawing', topic: null, topicLength: 2 });
  });

  it('快照的 ops 是深層複本，外部修改不影響 Room', () => {
    toDrawing(2);
    drawOk(begin('k1'));
    const snap = room.snapshot(B);
    (snap.ops[0] as { point: { x: number } }).point.x = 0.99;
    snap.ops.pop();
    expect(ops()).toEqual([begin('k1')]);
  });
});

// ─── cancel ──────────────────────────────────────────────────────

describe('§5 cancel', () => {
  it('畫師在 choosing 放棄 → abort(cancelled)：直接回 idle、「X 取消出題」、isDrawer 清除', () => {
    toChoosing(2);
    const r = room.cancel('s1');
    ok(r);
    expect(eventsOf(r.effects)).toEqual(['round:update', 'players:update', 'chat:message']);
    expect(roundFor(r.effects, B)).toEqual({ ...IDLE, endReason: 'cancelled' });
    expect(roundFor(r.effects, A)).toEqual({ ...IDLE, endReason: 'cancelled' });
    expect(playersPayload(r.effects).every((p) => !p.isDrawer)).toBe(true);
    expect(chatTexts(r.effects)).toEqual(['Alice 取消出題']);
  });

  it('畫師在 drawing 放棄 → end(cancelled)，揭曉 topic 給所有人', () => {
    toDrawing(2);
    const r = room.cancel('s1');
    ok(r);
    expect(roundFor(r.effects, B)).toMatchObject({ phase: 'ended', endReason: 'cancelled', topic: '蘋果' });
    expect(chatTexts(r.effects)).toEqual(['題目是 蘋果（畫師取消）']);
  });

  it('放棄會清掉 choosing 計時器（abort 後不再觸發逾時）', () => {
    toChoosing(2);
    ok(room.cancel('s1'));
    clock.advance(CHOOSING_MS * 2);
    expect(asyncEffects).toEqual([]);
    expect(clock.timers.size).toBe(0);
  });

  it('放棄會清掉 drawing 計時器（之後只有 ended → idle，不會再 timeout）', () => {
    toDrawing(2);
    ok(room.cancel('s1'));
    clock.advance(ROUND_MS * 2);
    expect(asyncEffects).toHaveLength(1);
    expect(roundFor(asyncEffects[0], B).phase).toBe('idle');
  });

  it('非畫師 → NOT_DRAWER；idle → NOT_DRAWER；ended → NOT_DRAWER；未加入 → NOT_IN_ROOM', () => {
    joinPlayers(2);
    expect(room.cancel('s1')).toEqual({
      ack: { ok: false, error: 'NOT_DRAWER', message: ROUND_ERROR_MESSAGES.NOT_DRAWER },
      effects: [],
    });
    ok(room.volunteer('s1'));
    expect(room.cancel('s2').ack).toMatchObject({ ok: false, error: 'NOT_DRAWER' });
    ok(room.setTopic('s1', '蘋果'));
    ok(room.cancel('s1'));
    expect(round().phase).toBe('ended');
    expect(room.cancel('s1').ack).toMatchObject({ ok: false, error: 'NOT_DRAWER' });
    expect(room.cancel('nope').ack).toMatchObject({ ok: false, error: 'NOT_IN_ROOM' });
  });
});

// ─── 計時器到期 ──────────────────────────────────────────────────

describe('§5 計時器到期', () => {
  it(`choosing ${CHOOSING_SECONDS} 秒未出題 → abort(cancelled)：直接回 idle、「X 出題逾時」`, () => {
    toChoosing(2);
    clock.advance(CHOOSING_MS - 1);
    expect(asyncEffects).toEqual([]);
    clock.advance(1);
    expect(asyncEffects).toHaveLength(1);
    const fx = asyncEffects[0];
    expect(eventsOf(fx)).toEqual(['round:update', 'players:update', 'chat:message']);
    expect(roundFor(fx, B)).toEqual({ ...IDLE, endReason: 'cancelled' });
    expect(chatTexts(fx)).toEqual(['Alice 出題逾時']);
    expect(player(A).isDrawer).toBe(false);
  });

  it(`drawing ${ROUND_SECONDS} 秒到 → end(timeout)，揭曉 topic`, () => {
    toDrawing(2);
    clock.advance(ROUND_MS - 1);
    expect(asyncEffects).toEqual([]);
    clock.advance(1);
    expect(asyncEffects).toHaveLength(1);
    expect(roundFor(asyncEffects[0], B)).toMatchObject({ phase: 'ended', endReason: 'timeout', topic: '蘋果' });
    expect(chatTexts(asyncEffects[0])).toEqual(['題目是 蘋果（時間到）']);
  });
});

// ─── abort(reason) ───────────────────────────────────────────────

describe('§5 abort(reason)（只在 choosing）', () => {
  it('不經 ended、沒有 ENDED 計時器；ops 保留（上一回合畫面留到下次 setTopic）', () => {
    toDrawing(2);
    const s1 = stroke('k1');
    ok(room.cancel('s1'));
    clock.advance(ENDED_MS);
    ok(room.volunteer('s2'));
    const r = room.cancel('s2');
    expect(eventsOf(r.effects).filter((e) => e === 'round:update')).toHaveLength(1);
    expect(round()).toEqual({ ...IDLE, endReason: 'cancelled' });
    expect(clock.timers.size).toBe(0);
    expect(ops()).toEqual(s1);
  });

  it('abort 後分數不變（choosing 沒有結算）', () => {
    toChoosing(2);
    ok(room.cancel('s1'));
    expect(room.playerList().map((p) => p.score)).toEqual([0, 0]);
  });
});

// ─── end(reason) ─────────────────────────────────────────────────

describe('§5 end(reason)（只在 drawing）', () => {
  it('phase = ended、endReason、topic 對所有人可見、endsAt = null；效果 round:update、players:update、system', () => {
    toDrawing(3);
    const r = room.cancel('s1');
    expect(eventsOf(r.effects)).toEqual(['round:update', 'players:update', 'chat:message']);
    for (const id of [A, B, C]) {
      expect(roundFor(r.effects, id)).toMatchObject({ phase: 'ended', endReason: 'cancelled', topic: '蘋果', topicLength: 2, endsAt: null, drawerId: A });
    }
    expect(room.snapshot(C).round.topic).toBe('蘋果');
  });

  it('結算畫師分數：+20 × correctIds.length（players:update 帶分數）', () => {
    toDrawing(3);
    room.forceGuessed(B);
    room.forceGuessed(C);
    const r = room.cancel('s1');
    expect(player(A).score).toBe(40);
    expect(playersPayload(r.effects).find((p) => p.id === A)?.score).toBe(40);
    expect(roundFor(r.effects, B).correctIds).toEqual([B, C]);
  });

  it('無人猜對：畫師分數不變', () => {
    toDrawing(2);
    ok(room.cancel('s1'));
    expect(player(A).score).toBe(0);
  });

  it('關閉 open stroke：ended 之後即使回到 drawing 也不能續畫舊筆畫（新回合重置）', () => {
    toDrawing(2);
    drawOk(begin('k1'));
    ok(room.cancel('s1'));
    expect(drawDropped(move('k1'))).toBe('phase');
  });

  it('system 揭曉訊息入聊天緩衝（中途加入可見）', () => {
    toDrawing(2);
    ok(room.cancel('s1'));
    const snap = join('s9', 'Late').snapshot;
    expect(snap.chat.map((m) => m.text)).toContain('題目是 蘋果（畫師取消）');
  });

  it(`${ENDED_SECONDS} 秒後 → idle：drawer = null、isDrawer 清除、endReason 保留、ops 保留；round:update 與 players:update`, () => {
    toDrawing(3);
    const s1 = stroke('k1');
    room.forceGuessed(B);
    ok(room.cancel('s1'));
    clock.advance(ENDED_MS - 1);
    expect(asyncEffects).toEqual([]);
    clock.advance(1);
    expect(asyncEffects).toHaveLength(1);
    const fx = asyncEffects[0];
    expect(eventsOf(fx)).toEqual(['round:update', 'players:update']);
    expect(roundFor(fx, A)).toEqual({ ...IDLE, endReason: 'cancelled' });
    expect(roundFor(fx, B)).toEqual({ ...IDLE, endReason: 'cancelled' });
    expect(playersPayload(fx).every((p) => !p.isDrawer)).toBe(true);
    expect(playersPayload(fx).every((p) => !p.hasGuessed)).toBe(true); // §5：回 idle 時 hasGuessed 全清
    expect(room.playerList().every((p) => !p.hasGuessed)).toBe(true);
    expect(ops()).toEqual(s1);
    expect(player(A).score).toBe(20);
    expect(clock.timers.size).toBe(0);
  });

  it('round:update 的 payload 在效果建立當下定格（之後狀態改變不影響已產生的效果）', () => {
    toDrawing(2);
    const r = room.cancel('s1');
    clock.advance(ENDED_MS);
    expect(round().phase).toBe('idle');
    expect(roundFor(r.effects, B)).toMatchObject({ phase: 'ended', topic: '蘋果' });
  });

  it('回到 idle 後可再 volunteer', () => {
    toDrawing(2);
    ok(room.cancel('s1'));
    clock.advance(ENDED_MS);
    ok(room.volunteer('s2'));
    expect(round()).toMatchObject({ phase: 'choosing', drawerId: B });
  });
});

// ─── leave（回合處理） ───────────────────────────────────────────

describe('§5 leave 的回合處理', () => {
  it('畫師在 choosing 離開 → abort(drawerLeft)：直接回 idle、「畫師 X 離開」', () => {
    toChoosing(3);
    const fx = room.leave(A);
    expect(eventsOf(fx)).toEqual(['players:update', 'chat:message', 'round:update', 'chat:message']);
    expect(roundFor(fx, B)).toEqual({ ...IDLE, endReason: 'drawerLeft' });
    expect(chatTexts(fx)).toEqual(['Alice 離開', '畫師 Alice 離開']);
    expect(clock.timers.size).toBe(0);
  });

  it('畫師在 drawing 離開 → end(drawerLeft)，揭曉 topic；已離開的畫師不結算、不出錯', () => {
    toDrawing(3);
    room.forceGuessed(B);
    const fx = room.leave(A);
    expect(eventsOf(fx)).toEqual(['players:update', 'chat:message', 'round:update', 'players:update', 'chat:message']);
    expect(roundFor(fx, B)).toMatchObject({ phase: 'ended', endReason: 'drawerLeft', topic: '蘋果' });
    expect(chatTexts(fx)).toEqual(['Alice 離開', '題目是 蘋果（畫師離開）']);
    clock.advance(ENDED_MS);
    expect(round(B)).toEqual({ ...IDLE, endReason: 'drawerLeft' });
  });

  it('drawing 中猜題者離開、剩餘非畫師全猜對 → end(allGuessed)', () => {
    toDrawing(3);
    room.forceGuessed(B);
    const fx = room.leave(C);
    expect(roundFor(fx, B)).toMatchObject({ phase: 'ended', endReason: 'allGuessed' });
    expect(chatTexts(fx)).toEqual(['Carol 離開', '題目是 蘋果（全員猜對）']);
    expect(player(A).score).toBe(20);
  });

  it('drawing 中猜題者離開、仍有人未猜對 → 回合繼續', () => {
    toDrawing(3);
    const fx = room.leave(C);
    expect(eventsOf(fx)).toEqual(['players:update', 'chat:message']);
    expect(round().phase).toBe('drawing');
  });

  it('drawing 中猜題者離開、非畫師人數為 0 → end(cancelled)（不因「全猜對」空泛成立而判 allGuessed）', () => {
    toDrawing(2);
    const fx = room.leave(B);
    expect(roundFor(fx, A)).toMatchObject({ phase: 'ended', endReason: 'cancelled', topic: '蘋果' });
    expect(chatTexts(fx)).toEqual(['Bob 離開', '題目是 蘋果（猜題者都離開了）']);
  });

  it('同時符合多個條件時只 end 一次：畫師離開且剩餘非畫師全猜對 → drawerLeft（§5 順序）', () => {
    toDrawing(2);
    room.forceGuessed(B);
    const fx = room.leave(A);
    expect(eventsOf(fx).filter((e) => e === 'round:update')).toHaveLength(1);
    expect(roundFor(fx, B).endReason).toBe('drawerLeft');
    clock.advance(ENDED_MS);
    expect(asyncEffects).toHaveLength(1); // 只有一次 ended → idle
    expect(clock.timers.size).toBe(0);
  });

  it('同時符合：已猜對者離開後非畫師為 0（同時滿足全猜對與無人）→ 只 end 一次（cancelled）', () => {
    toDrawing(2);
    room.forceGuessed(B);
    const fx = room.leave(B);
    expect(eventsOf(fx).filter((e) => e === 'round:update')).toHaveLength(1);
    expect(roundFor(fx, A).endReason).toBe('cancelled');
  });

  it('ended 階段畫師離開 → 不再 end（已結束）', () => {
    toDrawing(3);
    ok(room.cancel('s1'));
    const fx = room.leave(A);
    expect(eventsOf(fx)).toEqual(['players:update', 'chat:message']);
    clock.advance(ENDED_MS);
    expect(round(B)).toEqual({ ...IDLE, endReason: 'cancelled' });
  });

  it('choosing 中猜題者走光（非畫師為 0）→ abort(cancelled)：直接回 idle、「猜題者都離開了」、isDrawer 清除', () => {
    toChoosing(2);
    const fx = room.leave(B);
    expect(eventsOf(fx)).toEqual(['players:update', 'chat:message', 'round:update', 'players:update', 'chat:message']);
    expect(roundFor(fx, A)).toEqual({ ...IDLE, endReason: 'cancelled' });
    expect(chatTexts(fx)).toEqual(['Bob 離開', '猜題者都離開了']);
    expect(player(A).isDrawer).toBe(false);
    expect(playersPayload(fx.slice(3)).find((p) => p.id === A)?.isDrawer).toBe(false);
    expect(clock.timers.size).toBe(0); // choosing 計時器已清
    clock.advance(CHOOSING_MS);
    expect(asyncEffects).toEqual([]);
    expect(room.snapshot(A).chat.map((m) => m.text)).toContain('猜題者都離開了');
  });

  it('choosing 中猜題者寬限逾期才走光 → 非同步 abort(cancelled)「猜題者都離開了」', () => {
    toChoosing(2);
    room.disconnect('s2');
    expect(round().phase).toBe('choosing'); // 寬限期中仍算猜題者
    clock.advance(GRACE_MS);
    expect(asyncEffects).toHaveLength(1);
    expect(roundFor(asyncEffects[0], A)).toEqual({ ...IDLE, endReason: 'cancelled' });
    expect(chatTexts(asyncEffects[0])).toEqual(['Bob 離開', '猜題者都離開了']);
  });

  it('choosing 中猜題者離開但仍有其他猜題者 → 不中止', () => {
    toChoosing(3);
    const fx = room.leave(B);
    expect(eventsOf(fx)).toEqual(['players:update', 'chat:message']);
    expect(round().phase).toBe('choosing');
  });

  it('idle 時任何人離開 → 不影響回合', () => {
    joinPlayers(2);
    expect(eventsOf(room.leave(B))).toEqual(['players:update', 'chat:message']);
    expect(round()).toEqual(IDLE);
  });
});

// ─── disconnect／寬限期與回合 ──────────────────────────────────

describe('§5 disconnect／接管與回合（畫師斷線不中止回合）', () => {
  it('畫師在 drawing 中斷線：回合不中止（只發 players:update），isDrawer 保留', () => {
    toDrawing(3);
    const fx = room.disconnect('s1');
    expect(eventsOf(fx)).toEqual(['players:update']);
    expect(round(B).phase).toBe('drawing');
    expect(player(A)).toMatchObject({ connected: false, isDrawer: true });
    clock.advance(GRACE_MS - 1);
    expect(asyncEffects).toEqual([]);
    expect(round().phase).toBe('drawing');
  });

  it('畫師寬限期內接管 → 仍是畫師，快照看得到 topic 與 ops，可用新 socket 繼續畫；舊 socket 的 op 丟棄', () => {
    toDrawing(2);
    const s1 = stroke('k1');
    room.disconnect('s1');
    clock.advance(GRACE_MS - 1);
    const back = join('s1b', 'ignored', 'id2');
    expect(back.snapshot.you).toBe(A);
    expect(back.snapshot.round).toMatchObject({ phase: 'drawing', drawerId: A, topic: '蘋果', topicLength: 2 });
    expect(back.snapshot.ops).toEqual(s1);
    expect(back.snapshot.players.find((p) => p.id === A)).toMatchObject({ isDrawer: true, connected: true });
    expect(drawDropped(begin('k2'), 's1')).toBe('notInRoom');
    drawOk(undo('k1'), 's1b');
    ok(room.cancel('s1b'));
    clock.advance(GRACE_MS * 2);
    expect(room.playerList()).toHaveLength(2); // 寬限計時已取消，沒有 leave
  });

  it('畫師在 choosing 斷線後寬限期內接管 → 仍可出題', () => {
    toChoosing(2);
    room.disconnect('s1');
    const back = join('s1b', '', 'id2');
    expect(back.snapshot.round).toMatchObject({ phase: 'choosing', drawerId: A });
    ok(room.setTopic('s1b', '蘋果'));
  });

  it('畫師寬限期中，drawing 計時照走：到期 → end(timeout)，而非 drawerLeft', () => {
    toDrawing(2);
    clock.advance(ROUND_MS - 5000);
    room.disconnect('s1');
    clock.advance(5000);
    expect(asyncEffects).toHaveLength(1);
    expect(roundFor(asyncEffects[0], B)).toMatchObject({ phase: 'ended', endReason: 'timeout' });
    // 之後寬限逾期 → leave：已在 ended／idle，不再 end
    clock.advance(GRACE_MS);
    expect(asyncEffects.flat().filter((e) => e.kind === 'emit' && e.event === 'round:update')).toHaveLength(2);
    expect(round(B)).toEqual({ ...IDLE, endReason: 'timeout' });
  });

  it('畫師在 drawing 寬限逾期 → leave → end(drawerLeft)（非同步效果）；drawing 計時器已清', () => {
    toDrawing(3);
    room.disconnect('s1');
    clock.advance(GRACE_MS - 1);
    expect(asyncEffects).toEqual([]);
    clock.advance(1);
    expect(asyncEffects).toHaveLength(1);
    const fx = asyncEffects[0];
    expect(eventsOf(fx)).toEqual(['players:update', 'chat:message', 'round:update', 'players:update', 'chat:message']);
    expect(roundFor(fx, B)).toMatchObject({ phase: 'ended', endReason: 'drawerLeft', topic: '蘋果' });
    expect(chatTexts(fx)).toEqual(['Alice 離開', '題目是 蘋果（畫師離開）']);
    clock.advance(ROUND_MS);
    const reasons = asyncEffects.flatMap((f) =>
      emits(f)
        .filter((e) => e.event === 'round:update')
        .map((e) => roundFor([e], B).phase),
    );
    expect(reasons).toEqual(['ended', 'idle']);
  });

  it('畫師在 choosing 寬限逾期 → abort(drawerLeft)', () => {
    toChoosing(2);
    room.disconnect('s1');
    clock.advance(GRACE_MS);
    expect(asyncEffects).toHaveLength(1);
    expect(roundFor(asyncEffects[0], B)).toEqual({ ...IDLE, endReason: 'drawerLeft' });
    expect(chatTexts(asyncEffects[0])).toEqual(['Alice 離開', '畫師 Alice 離開']);
  });

  it('choosing 期限與畫師寬限同時到期：只處理先到的一個（出題逾時先 → 之後 leave 不再 abort）', () => {
    toChoosing(2);
    clock.advance(CHOOSING_MS - GRACE_MS);
    room.disconnect('s1');
    clock.advance(GRACE_MS);
    const rounds = asyncEffects.flatMap((f) => emits(f).filter((e) => e.event === 'round:update'));
    expect(rounds).toHaveLength(1);
    expect(chatTexts(asyncEffects.flat())).toEqual(['Alice 出題逾時', 'Alice 離開']);
  });

  it('猜題者斷線不影響回合；寬限逾期後才從 allGuessed／人數計算移除', () => {
    toDrawing(3);
    room.forceGuessed(B);
    room.disconnect('s3');
    expect(round().phase).toBe('drawing');
    clock.advance(GRACE_MS);
    expect(roundFor(asyncEffects[0], A)).toMatchObject({ phase: 'ended', endReason: 'allGuessed' });
  });

  it('dispose 清掉回合計時器與寬限計時器', () => {
    toDrawing(2);
    room.disconnect('s2');
    expect(clock.timers.size).toBe(2);
    room.dispose();
    expect(clock.timers.size).toBe(0);
  });
});

// ─── 注入的時長 ──────────────────────────────────────────────────

describe('RoomOptions.durations', () => {
  it('可覆寫 choosing / round / ended / grace 長度（e2e 測試用）', () => {
    room.dispose();
    room = makeRoom({ durations: { choosingMs: 100, roundMs: 200, endedMs: 50, graceMs: 30 } });
    toChoosing(2);
    expect(round().endsAt).toBe(clock.t + 100);
    ok(room.setTopic('s1', '蘋果'));
    expect(round().endsAt).toBe(clock.t + 200);
    clock.advance(200);
    expect(round().phase).toBe('ended');
    clock.advance(50);
    expect(round().phase).toBe('idle');
    room.disconnect('s2');
    clock.advance(30);
    expect(room.playerList()).toHaveLength(1);
  });
});
