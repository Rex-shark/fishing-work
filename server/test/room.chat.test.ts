// Room 聊天與猜題：spec/architecture.md §5 chat 列、「聊天訊息判定」表、「計分」（Phase 3）
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CHAT_HISTORY,
  CHAT_MAX,
  CHAT_MIN_INTERVAL_MS,
  ENDED_SECONDS,
  ROUND_SECONDS,
  type ChatMessage,
  type PlayerPublic,
  type RoundPublic,
} from '@fishing-work/shared';
import { CHAT_ERROR_MESSAGES } from '../src/games/draw-guess/chat';
import { GRACE_MS, ROUND_ERROR_MESSAGES, Room, type EmitEffect, type Effect } from '../src/games/draw-guess/room';
import { FakeClock } from './helpers/fakeClock';

const ROUND_MS = ROUND_SECONDS * 1000;
const ENDED_MS = ENDED_SECONDS * 1000;
/** 猜對者得分（spec §5）：100 − floor(50 × 已用 ms / ROUND_MS)；由常數推導，不寫死 */
const guessScore = (elapsedMs: number) => 100 - Math.floor((50 * elapsedMs) / ROUND_MS);
const GAP = CHAT_MIN_INTERVAL_MS;

let clock: FakeClock;
let asyncEffects: Effect[][];
let room: Room;

beforeEach(() => {
  clock = new FakeClock();
  asyncEffects = [];
  let n = 0;
  room = new Room({ clock, newId: () => `id${++n}`, onAsyncEffects: (e) => asyncEffects.push(e) });
});

afterEach(() => room.dispose());

// A = id1（s1）、B = id3（s2）、C = id5（s3）、D = id7（s4）
const A = 'id1';
const B = 'id3';
const C = 'id5';

function joinPlayers(n: number): void {
  const names = ['Alice', 'Bob', 'Carol', 'Dave'];
  for (let i = 0; i < n; i++) {
    const r = room.join(`s${i + 1}`, names[i]);
    if (!r.ack.ok) throw new Error(`join 失敗：${r.ack.error}`);
  }
}

function ok(outcome: { ack: { ok: boolean } }): void {
  expect(outcome.ack).toEqual({ ok: true, data: undefined });
}

/** A 當畫師、出題、進入 drawing */
function toDrawing(n = 3, topic = '蘋果'): void {
  joinPlayers(n);
  ok(room.volunteer('s1'));
  ok(room.setTopic('s1', topic));
}

function emits(effects: Effect[]): EmitEffect[] {
  return effects.filter((e): e is EmitEffect => e.kind === 'emit');
}
function eventsOf(effects: Effect[]): string[] {
  return emits(effects).map((e) => e.event);
}
function messages(effects: Effect[]): ChatMessage[] {
  return emits(effects)
    .filter((x) => x.event === 'chat:message')
    .map((x) => x.payload as ChatMessage);
}
function playersPayload(effects: Effect[]): PlayerPublic[] {
  const e = emits(effects).find((x) => x.event === 'players:update');
  if (!e || typeof e.payload === 'function') throw new Error('沒有 players:update');
  return e.payload as PlayerPublic[];
}
function roundFor(effects: Effect[], playerId: string): RoundPublic {
  const e = emits(effects).find((x) => x.event === 'round:update');
  if (!e) throw new Error('沒有 round:update');
  const p = e.payload as RoundPublic | ((id: string) => RoundPublic);
  return typeof p === 'function' ? p(playerId) : p;
}
function player(id: string): PlayerPublic {
  const p = room.playerList().find((x) => x.id === id);
  if (!p) throw new Error(`no player ${id}`);
  return p;
}
function bufferTexts(): string[] {
  return room.snapshot(A).chat.map((m) => m.text);
}
/** 斷言被擋：ack 錯誤碼與訊息、沒有任何效果 */
function blocked(r: { ack: unknown; effects: Effect[] }, error: string, message: string): void {
  expect(r).toEqual({ ack: { ok: false, error, message }, effects: [] });
}

// ─── 驗證：NOT_IN_ROOM／MESSAGE_INVALID／RATE_LIMITED ─────────────

describe('§5 chat 前置條件：驗證與間隔', () => {
  it('未加入的 socket → NOT_IN_ROOM', () => {
    joinPlayers(1);
    expect(room.chat('nope', 'hi')).toEqual({
      ack: { ok: false, error: 'NOT_IN_ROOM', message: ROUND_ERROR_MESSAGES.NOT_IN_ROOM },
      effects: [],
    });
  });

  it.each([
    ['空字串', ''],
    ['全空白（含全形空白）', '  　 '],
    [`${CHAT_MAX + 1} 字`, '字'.repeat(CHAT_MAX + 1)],
    [`${CHAT_MAX + 1} 個 emoji`, '🍎'.repeat(CHAT_MAX + 1)],
    ['含換行', '你\n好'],
    ['含 tab', '你\t好'],
    ['含 NUL', '你\u0000好'],
    ['含 DEL', '你\u007f好'],
    ['超長字串', 'x'.repeat(100_000)],
  ])('不合法（%s）→ MESSAGE_INVALID，無效果、不入緩衝', (_label, text) => {
    joinPlayers(2);
    const before = bufferTexts();
    blocked(room.chat('s1', text), 'MESSAGE_INVALID', CHAT_ERROR_MESSAGES.MESSAGE_INVALID);
    expect(bufferTexts()).toEqual(before);
  });

  it(`邊界合法：剛好 ${CHAT_MAX} 字、${CHAT_MAX} 個 emoji；頭尾空白去掉後廣播`, () => {
    joinPlayers(2);
    ok(room.chat('s1', '字'.repeat(CHAT_MAX)));
    clock.advance(GAP);
    ok(room.chat('s1', '🍎'.repeat(CHAT_MAX)));
    clock.advance(GAP);
    const r = room.chat('s1', `  ${'字'.repeat(CHAT_MAX)}　 `);
    ok(r);
    expect(messages(r.effects)[0].text).toBe('字'.repeat(CHAT_MAX));
  });

  it('一般聊天：廣播給所有人（含本人）、kind chat、fromId = player id、nickname、at = now；入緩衝', () => {
    joinPlayers(2);
    const r = room.chat('s2', '  大家好  ');
    ok(r);
    expect(eventsOf(r.effects)).toEqual(['chat:message']);
    expect(emits(r.effects)[0].to).toBe('all');
    expect(messages(r.effects)[0]).toEqual({
      id: expect.any(String),
      kind: 'chat',
      fromId: B,
      nickname: 'Bob',
      text: '大家好',
      at: clock.now(),
    });
    expect(room.snapshot(A).chat.at(-1)).toEqual(messages(r.effects)[0]);
  });

  it(`間隔 < ${GAP} ms → RATE_LIMITED；剛好 ${GAP} ms → 可送`, () => {
    joinPlayers(2);
    ok(room.chat('s1', '一'));
    clock.advance(GAP - 1);
    blocked(room.chat('s1', '二'), 'RATE_LIMITED', CHAT_ERROR_MESSAGES.RATE_LIMITED);
    clock.advance(1);
    ok(room.chat('s1', '三'));
    expect(bufferTexts().slice(-2)).toEqual(['一', '三']);
  });

  it('被 RATE_LIMITED 拒絕的訊息不更新時間戳（以最後一則被接受的訊息起算）', () => {
    joinPlayers(2);
    ok(room.chat('s1', '一'));
    clock.advance(200);
    expect(room.chat('s1', '二').ack).toMatchObject({ error: 'RATE_LIMITED' });
    clock.advance(100); // 距「一」300 ms、距被拒的「二」只有 100 ms
    ok(room.chat('s1', '三'));
  });

  it('被擋的洩題訊息（SPOILER_BLOCKED）與不合法訊息也不更新時間戳', () => {
    toDrawing(3);
    ok(room.chat('s1', '畫好了'));
    clock.advance(GAP);
    expect(room.chat('s1', '是蘋果').ack).toMatchObject({ error: 'SPOILER_BLOCKED' });
    expect(room.chat('s1', '\n').ack).toMatchObject({ error: 'MESSAGE_INVALID' });
    ok(room.chat('s1', '快猜')); // 同一時刻，若被擋的訊息有更新時間戳就會 RATE_LIMITED
  });

  it('間隔以玩家計算：不同玩家同一時刻各自可送；接管（換 socket）後仍沿用同一玩家的時間戳', () => {
    joinPlayers(2);
    ok(room.chat('s1', 'A1'));
    ok(room.chat('s2', 'B1'));
    const token = room.join('s1', 'Alice').ack;
    if (!token.ok) throw new Error('join');
    expect(room.join('s1b', 'Alice', token.data.token).ack.ok).toBe(true);
    expect(room.chat('s1b', 'A2').ack).toMatchObject({ error: 'RATE_LIMITED' });
    clock.advance(GAP);
    ok(room.chat('s1b', 'A2'));
  });
});

// ─── 判定表（phase = drawing） ────────────────────────────────────

describe('§5 聊天訊息判定：未猜對的猜題者', () => {
  it('與題目相符 → 猜對：hasGuessed、correctIds、加分；廣播 correct「X 猜對了」，原文不廣播、不入緩衝', () => {
    toDrawing(3);
    clock.advance(30_000);
    const r = room.chat('s2', '蘋果');
    ok(r);
    expect(eventsOf(r.effects)).toEqual(['players:update', 'chat:message', 'round:update']);
    const msg = messages(r.effects)[0];
    expect(msg).toEqual({ id: expect.any(String), kind: 'correct', fromId: B, nickname: 'Bob', text: 'Bob 猜對了', at: clock.now() });
    expect(emits(r.effects)[1].to).toBe('all');
    expect(playersPayload(r.effects).find((p) => p.id === B)).toMatchObject({ hasGuessed: true, score: guessScore(30_000) });
    expect(player(B)).toMatchObject({ hasGuessed: true, score: guessScore(30_000) }); // 120 秒制：88
    expect(room.projectRound(B).correctIds).toEqual([B]);
    expect(room.projectRound(B).phase).toBe('drawing'); // C 還沒猜對
    expect(bufferTexts()).toContain('Bob 猜對了');
    expect(bufferTexts()).not.toContain('蘋果');
    expect(room.snapshot(A).chat.some((m) => m.text.includes('蘋果') && m.kind !== 'system')).toBe(false);
  });

  it('猜對（尚未全員猜對）→ 加發 round:update 同步 correctIds：給所有人、仍是 drawing，畫師看得到 topic、其他人 null', () => {
    toDrawing(3);
    const r = room.chat('s2', '蘋果');
    ok(r);
    const ru = emits(r.effects).filter((e) => e.event === 'round:update');
    expect(ru).toHaveLength(1);
    expect(ru[0].to).toBe('all');
    expect(typeof ru[0].payload).toBe('function'); // 依收件者遮罩
    expect(roundFor(r.effects, A)).toMatchObject({ phase: 'drawing', topic: '蘋果', topicLength: 2, correctIds: [B], endReason: null });
    for (const id of [B, C]) {
      expect(roundFor(r.effects, id)).toMatchObject({ phase: 'drawing', topic: null, topicLength: 2, correctIds: [B] });
    }
    expect(roundFor(r.effects, B)).toEqual(room.projectRound(B));
    expect(roundFor(r.effects, A)).toEqual(room.projectRound(A));
  });

  it('round:update payload 在猜對當下定格：之後再有人猜對，先前效果的 correctIds 不變', () => {
    toDrawing(4);
    const r1 = room.chat('s2', '蘋果');
    ok(room.chat('s3', '蘋果'));
    expect(roundFor(r1.effects, C).correctIds).toEqual([B]);
    expect(room.projectRound(C).correctIds).toEqual([B, C]);
  });

  it.each([
    ['全形英文', 'Apple', 'ＡＰＰＬＥ'],
    ['大小寫', 'Apple', 'aPPLE'],
    ['空白（頭尾、中間、全形空白）', 'Apple', '  a p　ple '],
    ['題目本身含空白', 'ice cream', 'IceCream'],
  ])('正規化後相符（%s）→ 猜對', (_label, topic, guess) => {
    toDrawing(3, topic);
    const r = room.chat('s2', guess);
    ok(r);
    expect(messages(r.effects).map((m) => m.kind)).toEqual(['correct']);
    expect(player(B).hasGuessed).toBe(true);
  });

  it('不相符但含題目（題目「蘋果」、打「是蘋果嗎」）→ 不廣播，SPOILER_BLOCKED「猜答案請只輸入答案本身」；不算猜對', () => {
    toDrawing(3);
    const before = bufferTexts();
    blocked(room.chat('s2', '是蘋果嗎'), 'SPOILER_BLOCKED', '猜答案請只輸入答案本身');
    expect(CHAT_ERROR_MESSAGES.SPOILER_BLOCKED_GUESS).toBe('猜答案請只輸入答案本身');
    blocked(room.chat('s2', '不是蘋 果'), 'SPOILER_BLOCKED', '猜答案請只輸入答案本身'); // 正規化後含題目
    expect(bufferTexts()).toEqual(before);
    expect(player(B)).toMatchObject({ hasGuessed: false, score: 0 });
    expect(room.projectRound(B).correctIds).toEqual([]);
  });

  it('不相符且不含題目 → 廣播一般聊天', () => {
    toDrawing(3);
    const r = room.chat('s2', '香蕉？');
    ok(r);
    expect(messages(r.effects)).toMatchObject([{ kind: 'chat', fromId: B, text: '香蕉？' }]);
    expect(player(B).hasGuessed).toBe(false);
  });

  it('只含題目的一部分（「蘋」）→ 一般聊天（不算洩題）', () => {
    toDrawing(3);
    const r = room.chat('s2', '蘋');
    ok(r);
    expect(messages(r.effects)[0].kind).toBe('chat');
  });
});

describe('§5 聊天訊息判定：畫師或已猜對者', () => {
  it('畫師含題目 → 不廣播，SPOILER_BLOCKED（繁中訊息）；不入緩衝', () => {
    toDrawing(3);
    const before = bufferTexts();
    blocked(room.chat('s1', '提示：蘋果'), 'SPOILER_BLOCKED', CHAT_ERROR_MESSAGES.SPOILER_BLOCKED);
    clock.advance(GAP);
    blocked(room.chat('s1', '蘋果'), 'SPOILER_BLOCKED', CHAT_ERROR_MESSAGES.SPOILER_BLOCKED); // 畫師打題目本身也不算猜對
    expect(bufferTexts()).toEqual(before);
    expect(player(A)).toMatchObject({ hasGuessed: false, score: 0 });
  });

  it('畫師不含題目 → 廣播一般聊天', () => {
    toDrawing(3);
    const r = room.chat('s1', '是水果');
    ok(r);
    expect(messages(r.effects)).toMatchObject([{ kind: 'chat', fromId: A, nickname: 'Alice', text: '是水果' }]);
  });

  it('已猜對者含題目（含再打一次答案）→ SPOILER_BLOCKED，不重複加分', () => {
    toDrawing(3);
    ok(room.chat('s2', '蘋果'));
    const score = player(B).score;
    clock.advance(GAP);
    blocked(room.chat('s2', '蘋果'), 'SPOILER_BLOCKED', CHAT_ERROR_MESSAGES.SPOILER_BLOCKED);
    blocked(room.chat('s2', '答案是蘋果喔'), 'SPOILER_BLOCKED', CHAT_ERROR_MESSAGES.SPOILER_BLOCKED);
    expect(player(B).score).toBe(score);
    expect(room.projectRound(B).correctIds).toEqual([B]);
  });

  it('已猜對者不含題目 → 廣播一般聊天', () => {
    toDrawing(3);
    ok(room.chat('s2', '蘋果'));
    clock.advance(GAP);
    const r = room.chat('s2', '好難喔');
    ok(r);
    expect(messages(r.effects)).toMatchObject([{ kind: 'chat', fromId: B, text: '好難喔' }]);
  });
});

describe('§5 全員猜對 → end(allGuessed)', () => {
  it('最後一位猜題者猜對 → 同一次效果內 end：ended、揭曉 topic、畫師 +20 × 猜對人數、「題目是 X（全員猜對）」', () => {
    toDrawing(3);
    ok(room.chat('s2', '蘋果'));
    clock.advance(45_000);
    const r = room.chat('s3', '蘋果');
    ok(r);
    // 全員猜對：只有 end 的 ended round:update，不另發 drawing 的 round:update
    expect(eventsOf(r.effects)).toEqual(['players:update', 'chat:message', 'round:update', 'players:update', 'chat:message']);
    expect(messages(r.effects).map((m) => [m.kind, m.text])).toEqual([
      ['correct', 'Carol 猜對了'],
      ['system', '題目是 蘋果（全員猜對）'],
    ]);
    for (const id of [A, B, C]) {
      expect(roundFor(r.effects, id)).toMatchObject({ phase: 'ended', endReason: 'allGuessed', topic: '蘋果', correctIds: [B, C] });
    }
    expect(player(A).score).toBe(40);
    expect(player(B).score).toBe(100);
    expect(player(C).score).toBe(guessScore(45_000)); // 120 秒制：82
    expect(playersPayload(r.effects.slice(3)).find((p) => p.id === A)?.score).toBe(40);
  });

  it('ENDED 後回 idle：hasGuessed 全清（players:update）、correctIds 清空、endReason 保留', () => {
    toDrawing(3);
    ok(room.chat('s2', '蘋果'));
    ok(room.chat('s3', '蘋果'));
    clock.advance(ENDED_MS);
    expect(asyncEffects).toHaveLength(1);
    const fx = asyncEffects[0];
    expect(eventsOf(fx)).toEqual(['round:update', 'players:update']);
    expect(roundFor(fx, B)).toMatchObject({ phase: 'idle', correctIds: [], endReason: 'allGuessed', topic: null });
    expect(playersPayload(fx).every((p) => !p.hasGuessed && !p.isDrawer)).toBe(true);
  });

  it('猜題者範圍含寬限期中：斷線中的猜題者未猜對 → 不結束；其寬限逾期 leave 後剩餘全猜對 → end(allGuessed)', () => {
    toDrawing(3);
    room.disconnect('s3');
    const r = room.chat('s2', '蘋果');
    expect(eventsOf(r.effects)).toEqual(['players:update', 'chat:message', 'round:update']);
    expect(roundFor(r.effects, C)).toMatchObject({ phase: 'drawing', topic: null, correctIds: [B] });
    expect(room.projectRound(A).phase).toBe('drawing');
    clock.advance(GRACE_MS);
    expect(asyncEffects).toHaveLength(1);
    expect(roundFor(asyncEffects[0], A)).toMatchObject({ phase: 'ended', endReason: 'allGuessed' });
    expect(player(A).score).toBe(20);
  });

  it('全員猜對後回合計時器已清：原本的 ROUND 期限不再觸發 timeout', () => {
    toDrawing(2);
    ok(room.chat('s2', '蘋果'));
    clock.advance(ROUND_MS);
    expect(asyncEffects).toHaveLength(1); // 只有 ended → idle
    expect(room.projectRound(A).endReason).toBe('allGuessed');
  });
});

describe('§5 猜對者計分（Room 內以回合開始時間計）', () => {
  it('0 秒猜對 → 100；ROUND 前 1 ms 猜對 → 51', () => {
    toDrawing(3);
    ok(room.chat('s2', '蘋果'));
    expect(player(B).score).toBe(100);
    clock.advance(ROUND_MS - 1);
    ok(room.chat('s3', '蘋果'));
    expect(player(C).score).toBe(51);
  });

  it('分數跨回合累加', () => {
    toDrawing(2);
    ok(room.chat('s2', '蘋果'));
    clock.advance(ENDED_MS);
    ok(room.volunteer('s1'));
    ok(room.setTopic('s1', '香蕉'));
    clock.advance(9_000);
    ok(room.chat('s2', '香蕉'));
    expect(player(B).score).toBe(100 + guessScore(9_000));
    expect(player(A).score).toBe(40);
  });
});

describe('§5 phase ≠ drawing：所有訊息都是一般聊天', () => {
  it('idle：送出上一回合題目 → 一般聊天', () => {
    toDrawing(2);
    ok(room.cancel('s1'));
    clock.advance(ENDED_MS);
    const r = room.chat('s1', '剛剛是蘋果');
    ok(r);
    expect(messages(r.effects)).toMatchObject([{ kind: 'chat', text: '剛剛是蘋果' }]);
  });

  it('choosing：任何文字 → 一般聊天', () => {
    joinPlayers(2);
    ok(room.volunteer('s1'));
    const r = room.chat('s2', '畫蘋果啦');
    ok(r);
    expect(messages(r.effects)[0].kind).toBe('chat');
  });

  it('ended：畫師與猜題者送題目文字 → 一般聊天，不加分', () => {
    toDrawing(2);
    ok(room.cancel('s1'));
    const r1 = room.chat('s1', '蘋果');
    const r2 = room.chat('s2', '蘋果');
    ok(r1);
    ok(r2);
    expect(messages(r2.effects)).toMatchObject([{ kind: 'chat', fromId: B, text: '蘋果' }]);
    expect(player(B)).toMatchObject({ hasGuessed: false, score: 0 });
  });
});

describe('聊天環狀緩衝（CHAT_HISTORY）與快照', () => {
  it(`一般聊天與 correct 訊息都入緩衝，最多 ${CHAT_HISTORY} 則；中途加入者快照含最近聊天`, () => {
    joinPlayers(2);
    for (let i = 0; i < CHAT_HISTORY + 5; i++) {
      ok(room.chat('s1', `m${i}`));
      clock.advance(GAP);
    }
    const snap = room.join('s9', 'Late');
    if (!snap.ack.ok) throw new Error('join');
    const chat = snap.ack.data.snapshot.chat;
    expect(chat).toHaveLength(CHAT_HISTORY);
    expect(chat.at(-2)).toMatchObject({ kind: 'chat', text: `m${CHAT_HISTORY + 4}` });
    expect(chat.at(-1)).toMatchObject({ kind: 'system', text: 'Late 加入' });
  });
});
