// 繪圖比賽 Room：spec/draw-contest/architecture.md §5（狀態機、交卷、評分、揭曉、離開、重連）
// 假時鐘＋手動評分器，決定性地跑；評分結果經 promise 回報，以 flush() 讓 microtask 跑完。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CHAT_MIN_INTERVAL_MS,
  CHOOSING_SECONDS,
  DRAW_SECONDS,
  MAX_PLAYERS,
  NICKNAME_TAKEN_MESSAGE,
  RECONNECT_GRACE_SECONDS,
  SUBMIT_GRACE_SECONDS,
  TOPIC_INVALID_MESSAGE,
  type ChatMessage,
  type GalleryImage,
  type PlayerPublic,
  type RoundPublic,
} from '@fishing-work/shared/draw-contest';
import { CHAT_ERROR_MESSAGES } from '../src/games/draw-contest/chat';
import { ROUND_ERROR_MESSAGES, Room, type EmitEffect, type Effect, type RoomOptions } from '../src/games/draw-contest/room';
import { FakeClock } from './helpers/fakeClock';
import { FnJudge, ManualJudge, flush, makePng } from './helpers/drawContest';

const GRACE_MS = RECONNECT_GRACE_SECONDS * 1000;
const CHOOSING_MS = CHOOSING_SECONDS * 1000;
const DRAW_MS = DRAW_SECONDS * 1000;
const SUBMIT_GRACE_MS = SUBMIT_GRACE_SECONDS * 1000;
const TIMEOUT_MS = 30_000;

let clock: FakeClock;
let asyncEffects: Effect[][];
let judge: ManualJudge;
let fallback: FnJudge;
let room: Room;

function makeRoom(opts: Partial<RoomOptions> = {}): Room {
  let n = 0;
  return new Room({
    clock,
    newId: () => `id${++n}`,
    onAsyncEffects: (e) => asyncEffects.push(e),
    judge: { judge, fallback, timeoutMs: TIMEOUT_MS },
    ...opts,
  });
}

beforeEach(() => {
  clock = new FakeClock();
  asyncEffects = [];
  judge = new ManualJudge('ai');
  fallback = new FnJudge(() => ({ score: 10, confidence: 0.4 }), 'random');
  room = makeRoom();
});

afterEach(() => room.dispose());

// 固定的 id：A = id1（socket s1）、B = id3（s2）、C = id5（s3）、D = id7（s4）
const A = 'id1';
const B = 'id3';
const C = 'id5';
const D = 'id7';
const NAMES = ['Alice', 'Bob', 'Carol', 'Dave'];

// ─── 測試工具 ─────────────────────────────────────────────────────

function joinOk(socketId: string, nickname: string, token?: string) {
  const r = room.join(socketId, nickname, token);
  if (!r.ack.ok) throw new Error(`join 失敗：${r.ack.error}`);
  return { data: r.ack.data, effects: r.effects };
}

function joinPlayers(n = 2): void {
  for (let i = 0; i < n; i++) joinOk(`s${i + 1}`, NAMES[i]);
}

function ok(outcome: { ack: { ok: boolean } }): void {
  expect(outcome.ack).toEqual({ ok: true, data: undefined });
}

function toChoosing(n = 2): void {
  joinPlayers(n);
  ok(room.volunteer('s1'));
}

function toDrawing(n = 2, topic = '蘋果'): void {
  toChoosing(n);
  ok(room.setTopic('s1', topic));
}

function submitOk(socketId: string, seed = 0) {
  const r = room.submit(socketId, { png: makePng(seed) });
  if (!r.ack.ok) throw new Error(`submit 失敗：${r.ack.error}`);
  return r;
}

function emits(effects: Effect[]): EmitEffect[] {
  return effects.filter((e): e is EmitEffect => e.kind === 'emit');
}

function eventsOf(effects: Effect[]): string[] {
  return emits(effects).map((e) => e.event);
}

function rounds(effects: Effect[]): RoundPublic[] {
  return emits(effects)
    .filter((e) => e.event === 'round:update')
    .map((e) => e.payload as RoundPublic);
}

function players(effects: Effect[]): PlayerPublic[] {
  const list = emits(effects).filter((e) => e.event === 'players:update');
  const last = list.at(-1);
  if (!last) throw new Error('沒有 players:update');
  return last.payload as PlayerPublic[];
}

function galleries(effects: Effect[]): EmitEffect[] {
  return emits(effects).filter((e) => e.event === 'contest:gallery');
}

function chatTexts(effects: Effect[]): string[] {
  return emits(effects)
    .filter((e) => e.event === 'chat:message')
    .map((e) => (e.payload as ChatMessage).text);
}

function allAsync(): Effect[] {
  return asyncEffects.flat();
}

function round(): RoundPublic {
  return room.currentRound();
}

function player(id: string): PlayerPublic {
  const p = room.playerList().find((x) => x.id === id);
  if (!p) throw new Error(`no player ${id}`);
  return p;
}

/** resolve 第 i 次評分並讓佇列回報 */
async function judgeCall(i: number, score: number, confidence = 0.5): Promise<void> {
  judge.resolveCall(i, score, confidence);
  await flush();
}

// ─── 加入／接管／寬限 ─────────────────────────────────────────────

describe('join', () => {
  it('新玩家：快照含 you、players（isSetter／participating／submitted 皆 false）、round idle roundNo 0、chat 含加入訊息', () => {
    const { data } = joinOk('s1', '  Alice ');
    expect(data.snapshot.you).toBe(A);
    expect(data.snapshot.players).toEqual([
      { id: A, nickname: 'Alice', score: 0, connected: true, joinedAt: clock.t, isSetter: false, participating: false, submitted: false },
    ]);
    expect(data.snapshot.round).toEqual({
      roundNo: 0,
      phase: 'idle',
      setterId: null,
      topic: null,
      mode: null,
      startedAt: null,
      endsAt: null,
      participantIds: [],
      submittedCount: 0,
      judgedCount: 0,
      judgeMode: null,
      commentMode: null,
      results: null,
      lastTopic: null,
      lastMode: null,
    });
    expect(data.snapshot.chat.map((m) => m.text)).toEqual(['Alice 加入']);
    expect(Object.keys(data.snapshot).sort()).toEqual(['chat', 'players', 'round', 'you']);
  });

  it('效果：players:update 給所有人、加入訊息排除本人；results 為 null 時不送畫廊', () => {
    joinOk('s1', 'Alice');
    const { effects } = joinOk('s2', 'Bob');
    expect(eventsOf(effects)).toEqual(['players:update', 'chat:message']);
    expect(emits(effects)[1].to).toEqual({ except: B });
  });

  it('同 socket 重複 join 冪等；全形＋大小寫同名 → NICKNAME_TAKEN', () => {
    const first = joinOk('s1', 'Alice');
    const again = joinOk('s1', 'Other');
    expect(again.data.token).toBe(first.data.token);
    expect(room.playerList().map((p) => p.nickname)).toEqual(['Alice']);
    expect(room.join('s2', 'ＡＬＩＣＥ').ack).toEqual({ ok: false, error: 'NICKNAME_TAKEN', message: NICKNAME_TAKEN_MESSAGE });
    expect(room.join('s2', '  ').ack).toMatchObject({ ok: false, error: 'NICKNAME_INVALID' });
  });

  it(`人數達 MAX_PLAYERS（${MAX_PLAYERS}，含寬限期中）→ ROOM_FULL；接管不受限`, () => {
    const tokens: string[] = [];
    for (let i = 0; i < MAX_PLAYERS; i++) tokens.push(joinOk(`s${i}`, `p${i}`).data.token);
    room.disconnect('s0');
    expect(room.join('sx', 'late').ack).toEqual({ ok: false, error: 'ROOM_FULL', message: ROUND_ERROR_MESSAGES.ROOM_FULL });
    expect(room.join('sy', 'whatever', tokens[0]).ack.ok).toBe(true);
  });
});

describe('disconnect、寬限、接管', () => {
  it('斷線 → connected=false；寬限內以 token 接管：同一 id、只廣播 players:update', () => {
    const { data } = joinOk('s1', 'Alice');
    joinOk('s2', 'Bob');
    expect(eventsOf(room.disconnect('s1'))).toEqual(['players:update']);
    expect(player(A).connected).toBe(false);
    const r = room.join('s9', 'ignored', data.token);
    expect(r.ack.ok && r.ack.data.snapshot.you).toBe(A);
    expect(eventsOf(r.effects)).toEqual(['players:update']);
    expect(player(A)).toMatchObject({ connected: true, nickname: 'Alice' });
    clock.advance(GRACE_MS * 2);
    expect(asyncEffects).toEqual([]);
  });

  it('舊 socket 仍在時接管：踢掉舊 socket，舊 socket 之後 disconnect 不影響', () => {
    const { data } = joinOk('s1', 'Alice');
    const r = room.join('s9', 'x', data.token);
    expect(r.effects).toEqual([{ kind: 'disconnect', socketId: 's1' }]);
    expect(room.disconnect('s1')).toEqual([]);
    expect(player(A).connected).toBe(true);
  });

  it(`寬限 ${RECONNECT_GRACE_SECONDS} 秒逾期 → 離開：players:update＋「X 離開」`, () => {
    joinOk('s1', 'Alice');
    joinOk('s2', 'Bob');
    room.disconnect('s2');
    clock.advance(GRACE_MS - 1);
    expect(asyncEffects).toEqual([]);
    clock.advance(1);
    expect(eventsOf(allAsync())).toEqual(['players:update', 'chat:message']);
    expect(chatTexts(allAsync())).toEqual(['Bob 離開']);
    expect(room.playerList().map((p) => p.id)).toEqual([A]);
  });

  it('作畫中重連接管：id 不變、仍是參賽者，可繼續交卷', () => {
    toDrawing(2);
    const tokenB = joinOk('s2', 'x').data.token; // 同 socket 重複 join 取回 token
    room.disconnect('s2');
    clock.advance(GRACE_MS - 1);
    const r = room.join('s7', 'whatever', tokenB);
    expect(r.ack.ok && r.ack.data.snapshot.you).toBe(B);
    expect(r.ack.ok && r.ack.data.snapshot.round.participantIds).toEqual([A, B]);
    expect(room.submit('s7', { png: makePng(1) }).ack).toEqual({ ok: true, data: { bytes: makePng(1).byteLength } });
  });
});

// ─── volunteer ────────────────────────────────────────────────────

describe('§5 round:volunteer', () => {
  it('未加入 → NOT_IN_ROOM；在線不足 → NOT_ENOUGH_PLAYERS（斷線中不算）', () => {
    expect(room.volunteer('s1').ack).toMatchObject({ ok: false, error: 'NOT_IN_ROOM' });
    joinOk('s1', 'Alice');
    expect(room.volunteer('s1').ack).toEqual({
      ok: false,
      error: 'NOT_ENOUGH_PLAYERS',
      message: '至少要 2 位在線玩家才能開始',
    });
    joinOk('s2', 'Bob');
    room.disconnect('s2');
    expect(room.volunteer('s1').ack).toMatchObject({ ok: false, error: 'NOT_ENOUGH_PLAYERS' });
  });

  it('成功 → choosing：setterId、endsAt = now + CHOOSING；round:update ＋ players:update（isSetter）', () => {
    joinPlayers(2);
    const r = room.volunteer('s2');
    ok(r);
    expect(eventsOf(r.effects)).toEqual(['round:update', 'players:update']);
    expect(rounds(r.effects)[0]).toMatchObject({ phase: 'choosing', setterId: B, endsAt: clock.t + CHOOSING_MS, topic: null, roundNo: 0 });
    expect(players(r.effects).map((p) => [p.id, p.isSetter])).toEqual([[A, false], [B, true]]);
  });

  it('choosing／drawing／judging → ROUND_BUSY（文案依 §5.4）', () => {
    toChoosing(3);
    expect(room.volunteer('s2').ack).toEqual({ ok: false, error: 'ROUND_BUSY', message: '目前已有回合進行中' });
    ok(room.setTopic('s1', '蘋果'));
    expect(room.volunteer('s2').ack).toMatchObject({ error: 'ROUND_BUSY' });
    clock.advance(DRAW_MS);
    expect(round().phase).toBe('judging');
    expect(room.volunteer('s2').ack).toMatchObject({ error: 'ROUND_BUSY' });
  });
});

// ─── setTopic／cancel ─────────────────────────────────────────────

describe('§5 round:setTopic／round:cancel', () => {
  it('idle 時 setTopic／cancel → NOT_SETTER（文案依 §5.4）', () => {
    joinPlayers(2);
    const notSetter = { ok: false, error: 'NOT_SETTER', message: '只有本回合的出題者可以這麼做' };
    expect(room.setTopic('s1', '蘋果').ack).toEqual(notSetter);
    expect(room.cancel('s1').ack).toEqual(notSetter);
  });

  it('choosing 時非出題者 → NOT_SETTER；題目不合法 → TOPIC_INVALID', () => {
    toChoosing(2);
    expect(room.setTopic('s2', '蘋果').ack).toMatchObject({ error: 'NOT_SETTER' });
    expect(room.cancel('s2').ack).toMatchObject({ error: 'NOT_SETTER' });
    expect(room.setTopic('s1', '   ').ack).toEqual({ ok: false, error: 'TOPIC_INVALID', message: TOPIC_INVALID_MESSAGE });
    expect(room.setTopic('s1', 'x'.repeat(21)).ack).toMatchObject({ error: 'TOPIC_INVALID' });
    expect(round().phase).toBe('choosing');
  });

  it('成功 → drawing：roundNo 1、題目去頭尾空白、參賽者＝此刻在線者（依加入順序，含出題者、不含斷線中）', () => {
    joinPlayers(4);
    room.disconnect('s3');
    ok(room.volunteer('s2'));
    const now = clock.t;
    const r = room.setTopic('s2', '  蘋果 ');
    ok(r);
    expect(eventsOf(r.effects)).toEqual(['round:update', 'players:update', 'chat:message']);
    expect(rounds(r.effects)[0]).toEqual({
      roundNo: 1,
      phase: 'drawing',
      setterId: B,
      topic: '蘋果',
      mode: 'topic',
      startedAt: now,
      endsAt: now + DRAW_MS,
      participantIds: [A, B, D],
      submittedCount: 0,
      judgedCount: 0,
      judgeMode: null,
      commentMode: null,
      results: null,
      lastTopic: null,
      lastMode: null,
    });
    expect(players(r.effects).map((p) => [p.id, p.isSetter, p.participating, p.submitted])).toEqual([
      [A, false, true, false],
      [B, true, true, false],
      [C, false, false, false],
      [D, false, true, false],
    ]);
    expect(chatTexts(r.effects)[0]).toContain('蘋果');
  });

  it('drawing／judging 時出題者 setTopic／cancel → ROUND_BUSY；ended 時 → NOT_SETTER', async () => {
    toDrawing(2);
    expect(room.setTopic('s1', '香蕉').ack).toMatchObject({ error: 'ROUND_BUSY' });
    expect(room.cancel('s1').ack).toMatchObject({ error: 'ROUND_BUSY' });
    clock.advance(DRAW_MS);
    expect(room.cancel('s1').ack).toMatchObject({ error: 'ROUND_BUSY' });
    clock.advance(SUBMIT_GRACE_MS + 1);
    expect(round().phase).toBe('ended');
    expect(room.setTopic('s1', '香蕉').ack).toMatchObject({ error: 'NOT_SETTER' });
    expect(room.cancel('s1').ack).toMatchObject({ error: 'NOT_SETTER' });
  });

  it('cancel（choosing）→ idle：setter 清除、system 訊息', () => {
    toChoosing(2);
    const r = room.cancel('s1');
    ok(r);
    expect(eventsOf(r.effects)).toEqual(['round:update', 'players:update', 'chat:message']);
    expect(rounds(r.effects)[0]).toMatchObject({ phase: 'idle', setterId: null, endsAt: null, roundNo: 0 });
    expect(player(A).isSetter).toBe(false);
  });

  it('出題逾時 → idle（非同步）', () => {
    toChoosing(2);
    clock.advance(CHOOSING_MS - 1);
    expect(asyncEffects).toEqual([]);
    clock.advance(1);
    expect(rounds(allAsync())[0]).toMatchObject({ phase: 'idle', setterId: null });
    expect(chatTexts(allAsync())).toEqual(['Alice 出題逾時']);
  });

  it('出題者寬限期滿離開（choosing）→ idle；出題計時器取消', () => {
    toChoosing(3);
    room.disconnect('s1');
    clock.advance(GRACE_MS);
    const fx = allAsync();
    expect(rounds(fx).at(-1)).toMatchObject({ phase: 'idle', setterId: null });
    asyncEffects = [];
    clock.advance(CHOOSING_MS);
    expect(asyncEffects).toEqual([]);
  });

  it('出題者在 drawing 離開不影響回合（題目已公開）', () => {
    toDrawing(3);
    room.disconnect('s1');
    clock.advance(GRACE_MS);
    expect(round()).toMatchObject({ phase: 'drawing', setterId: A, topic: '蘋果', participantIds: [B, C] });
  });
});

// ─── 交卷 ─────────────────────────────────────────────────────────

describe('§5 contest:submit', () => {
  it('idle／choosing → NOT_DRAWING（即使 payload 也不合法：phase 先檢查）', () => {
    joinPlayers(2);
    const notDrawing = { ok: false, error: 'NOT_DRAWING', message: '現在不是作畫時間' };
    expect(room.submit('s1', { png: makePng() }).ack).toEqual(notDrawing);
    expect(room.submit('s1', 'garbage').ack).toEqual(notDrawing);
    ok(room.volunteer('s1'));
    expect(room.submit('s1', { png: makePng() }).ack).toEqual(notDrawing);
  });

  it('未加入 → NOT_IN_ROOM；中途加入者 → NOT_PARTICIPANT（先於 PNG 檢查）', () => {
    toDrawing(2);
    expect(room.submit('sx', { png: makePng() }).ack).toMatchObject({ error: 'NOT_IN_ROOM' });
    joinOk('s3', 'Carol');
    expect(room.submit('s3', { png: makePng() }).ack).toEqual({
      ok: false,
      error: 'NOT_PARTICIPANT',
      message: '你不是本回合的參賽者',
    });
    expect(room.submit('s3', null).ack).toMatchObject({ error: 'NOT_PARTICIPANT' });
    expect(player(C)).toMatchObject({ participating: false, submitted: false });
  });

  it('PNG 不合法 → SUBMISSION_INVALID（文案依 §5.4）；不影響之後正常交卷', () => {
    toDrawing(2);
    const invalid = { ok: false, error: 'SUBMISSION_INVALID', message: '圖片格式不正確或太大' };
    expect(room.submit('s1', null).ack).toEqual(invalid);
    expect(room.submit('s1', { png: 'abc' }).ack).toEqual(invalid);
    expect(room.submit('s1', { png: makePng(0, 640, 360) }).ack).toEqual(invalid);
    expect(room.submit('s1', { png: new Uint8Array(0) }).ack).toEqual(invalid);
    expect(round().submittedCount).toBe(0);
    expect(room.submit('s1', { png: makePng() }).ack.ok).toBe(true);
  });

  it('成功：ack bytes、players:update（submitted）＋ round:update（submittedCount）；排進佇列；再交 → ALREADY_SUBMITTED', () => {
    toDrawing(2);
    const png = makePng(3);
    const r = room.submit('s1', { png: png.buffer });
    expect(r.ack).toEqual({ ok: true, data: { bytes: png.byteLength } });
    expect(eventsOf(r.effects)).toEqual(['players:update', 'round:update']);
    expect(players(r.effects).find((p) => p.id === A)?.submitted).toBe(true);
    expect(rounds(r.effects)[0]).toMatchObject({ phase: 'drawing', submittedCount: 1, judgedCount: 0 });
    expect(judge.calls).toHaveLength(1);
    expect(judge.calls[0].input.topic).toBe('蘋果');
    expect([...judge.calls[0].input.png]).toEqual([...png]);
    expect(room.submit('s1', { png: makePng() }).ack).toEqual({ ok: false, error: 'ALREADY_SUBMITTED', message: '你已經交卷了' });
  });

  it('交卷即評：drawing 中評完 judgedCount++（judgeMode 仍為 null，judging 起才設）', async () => {
    toDrawing(2);
    submitOk('s1');
    await judgeCall(0, 80);
    const r = rounds(allAsync());
    expect(r.at(-1)).toMatchObject({ phase: 'drawing', submittedCount: 1, judgedCount: 1, judgeMode: null });
  });

  it('存的是 bytes 複本：送出後改原陣列不影響評分與畫廊', async () => {
    toDrawing(2);
    const png = makePng(5);
    const expected = [...png];
    room.submit('s1', { png });
    png.fill(0);
    expect([...judge.calls[0].input.png]).toEqual(expected);
  });
});

// ─── judging → ended ─────────────────────────────────────────────

describe('§5 judging／ended', () => {
  it('全員交卷 → 立即 judging（endsAt null、judgeMode 為評分器模式）；評完立即 ended，不等寬限', async () => {
    toDrawing(2);
    submitOk('s1', 1);
    const r = submitOk('s2', 2);
    const rs = rounds(r.effects);
    expect(rs.map((x) => x.phase)).toEqual(['drawing', 'judging']);
    expect(rs[1]).toMatchObject({ endsAt: null, judgeMode: 'ai', submittedCount: 2 });

    await judgeCall(0, 70);
    expect(round().phase).toBe('judging');
    expect(round().judgedCount).toBe(1);
    await judgeCall(1, 90);
    expect(round().phase).toBe('ended');
    const fx = asyncEffects.at(-1) ?? [];
    expect(eventsOf(fx)).toEqual([
      'round:update', // judging judgedCount 2
      'round:update', // ended
      'players:update',
      'chat:message',
      'contest:gallery',
      'contest:gallery',
    ]);
    const ended = rounds(fx)[1];
    expect(ended).toMatchObject({ phase: 'ended', endsAt: null, judgedCount: 2, judgeMode: 'ai', topic: '蘋果', lastTopic: '蘋果' });
    expect(ended.results).toEqual([
      { playerId: B, nickname: 'Bob', rank: 1, score: 90, confidence: 0.5, judgedBy: 'ai', submitted: true, submittedAt: clock.t, comment: null, commentPending: false },
      { playerId: A, nickname: 'Alice', rank: 2, score: 70, confidence: 0.5, judgedBy: 'ai', submitted: true, submittedAt: clock.t, comment: null, commentPending: false },
    ]);
    expect(chatTexts(fx)).toEqual(['揭曉：第一名 Bob（90 分）']);
    expect(players(fx).map((p) => [p.id, p.score])).toEqual([[A, 70], [B, 90]]);
    // 畫廊：所有在線者、每位交卷者一則（依 rank）、png 為 ArrayBuffer、roundNo 配對
    const g = galleries(fx);
    expect(g.every((e) => e.to === 'all')).toBe(true);
    const images = g.map((e) => e.payload as GalleryImage);
    expect(images.map((x) => [x.roundNo, x.playerId])).toEqual([[1, B], [1, A]]);
    expect(images[0].png).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(images[1].png)]).toEqual([...makePng(1)]);
    // ended 無計時器
    asyncEffects = [];
    clock.advance(10 * 60_000);
    expect(asyncEffects).toEqual([]);
  });

  it('時間到 → judging；寬限內（now ≤ endsAt + 5 秒）仍可補交，之後 NOT_DRAWING', async () => {
    toDrawing(3);
    clock.advance(DRAW_MS);
    expect(rounds(allAsync()).at(-1)).toMatchObject({ phase: 'judging', endsAt: null, judgeMode: 'ai' });
    clock.advance(SUBMIT_GRACE_MS);
    expect(room.submit('s1', { png: makePng() }).ack.ok).toBe(true);
    clock.advance(1);
    expect(room.submit('s2', { png: makePng() }).ack).toMatchObject({ error: 'NOT_DRAWING' });
    expect(round().phase).toBe('judging');
    await judgeCall(0, 60);
    expect(round().phase).toBe('ended');
    expect(round().results?.map((r) => [r.playerId, r.rank, r.score, r.submitted])).toEqual([
      [A, 1, 60, true],
      [B, 2, 0, false],
      [C, 3, 0, false],
    ]);
  });

  it('佇列已清空但未全員交卷：等寬限過後（非同步）才 ended；未交卷者 0 分', async () => {
    toDrawing(2);
    submitOk('s1');
    await judgeCall(0, 55);
    asyncEffects = [];
    clock.advance(DRAW_MS);
    expect(round().phase).toBe('judging');
    clock.advance(SUBMIT_GRACE_MS);
    expect(round().phase).toBe('judging');
    clock.advance(1);
    expect(round().phase).toBe('ended');
    expect(rounds(allAsync()).map((r) => r.phase)).toEqual(['judging', 'ended']);
    const res = round().results ?? [];
    expect(res[1]).toEqual({
      playerId: B,
      nickname: 'Bob',
      rank: 2,
      score: 0,
      confidence: null,
      judgedBy: null,
      submitted: false,
      submittedAt: null,
      comment: null,
      commentPending: false,
    });
    expect(galleries(allAsync())).toHaveLength(1);
  });

  it('寬限已過但佇列未清空：等最後一張評完才 ended', async () => {
    toDrawing(2);
    clock.advance(DRAW_MS + 100);
    submitOk('s1');
    clock.advance(SUBMIT_GRACE_MS);
    expect(round().phase).toBe('judging');
    await judgeCall(0, 40);
    expect(round().phase).toBe('ended');
  });

  it('全員交卷且佇列已清空（未交卷者離開）：judging 與 ended 各一則 round:update', async () => {
    toDrawing(2);
    submitOk('s1');
    await judgeCall(0, 77);
    room.disconnect('s2');
    asyncEffects = [];
    clock.advance(GRACE_MS);
    const phases = rounds(allAsync()).map((r) => r.phase);
    expect(phases).toEqual(['drawing', 'judging', 'ended']);
    expect(round().results?.map((r) => r.playerId)).toEqual([A]);
  });

  it('同分依 submittedAt（先交卷在前）；未交卷者依 participantIds 順序', async () => {
    toDrawing(4);
    clock.advance(1000);
    submitOk('s3'); // C 先交
    await judgeCall(0, 50);
    clock.advance(1000);
    submitOk('s1'); // A 後交（同分）
    await judgeCall(1, 50);
    clock.advance(DRAW_MS + SUBMIT_GRACE_MS);
    expect(round().results?.map((r) => [r.playerId, r.rank, r.score])).toEqual([
      [C, 1, 50],
      [A, 2, 50],
      [B, 3, 0],
      [D, 4, 0],
    ]);
  });

  it('總分跨回合累加；ended 後可再 volunteer，choosing／idle 期間 results 保留，drawing 開始時清空', async () => {
    toDrawing(2);
    submitOk('s1');
    submitOk('s2');
    await judgeCall(0, 30);
    await judgeCall(1, 20);
    expect([player(A).score, player(B).score]).toEqual([30, 20]);
    const first = round().results;

    ok(room.volunteer('s2'));
    expect(round()).toMatchObject({ phase: 'choosing', roundNo: 1, results: first, setterId: B });
    expect(player(A)).toMatchObject({ participating: false, submitted: false });
    ok(room.cancel('s2'));
    expect(round()).toMatchObject({ phase: 'idle', roundNo: 1, results: first });

    ok(room.volunteer('s2'));
    ok(room.setTopic('s2', '香蕉'));
    expect(round()).toMatchObject({ phase: 'drawing', roundNo: 2, results: null, submittedCount: 0 });
    submitOk('s1');
    submitOk('s2');
    await judgeCall(2, 45);
    await judgeCall(3, 5);
    expect([player(A).score, player(B).score]).toEqual([75, 25]);
    expect(judge.calls[2].input.topic).toBe('香蕉');
  });
});

// ─── lastTopic 生命週期 ───────────────────────────────────────────

describe('§5 lastTopic（與 results 同生命週期）', () => {
  async function finishRound(setterSocket: string, topic: string, firstCall: number): Promise<void> {
    ok(room.volunteer(setterSocket));
    expect(round().topic).toBeNull();
    ok(room.setTopic(setterSocket, topic));
    submitOk('s1');
    submitOk('s2');
    await judgeCall(firstCall, 50);
    await judgeCall(firstCall + 1, 40);
    expect(round().phase).toBe('ended');
  }

  it('從未開始為 null；drawing／judging 為 null；ended 等於本回合題目（去頭尾空白）', async () => {
    joinPlayers(2);
    expect(round().lastTopic).toBeNull();
    ok(room.volunteer('s1'));
    expect(round().lastTopic).toBeNull();
    ok(room.setTopic('s1', '  蘋果 '));
    expect(round().lastTopic).toBeNull();
    submitOk('s1');
    const r = submitOk('s2');
    expect(rounds(r.effects).map((x) => [x.phase, x.lastTopic])).toEqual([['drawing', null], ['judging', null]]);
    await judgeCall(0, 50);
    await judgeCall(1, 40);
    const ended = rounds(allAsync()).at(-1);
    expect(ended).toMatchObject({ phase: 'ended', topic: '蘋果', lastTopic: '蘋果' });
  });

  it('下一回合 choosing／取消回 idle／出題逾時期間保留（topic 為 null）；drawing 開始時清空；再 ended 換成新題目', async () => {
    joinPlayers(2);
    await finishRound('s1', '蘋果', 0);
    ok(room.volunteer('s2'));
    expect(round()).toMatchObject({ phase: 'choosing', topic: null, lastTopic: '蘋果' });
    ok(room.cancel('s2'));
    expect(round()).toMatchObject({ phase: 'idle', topic: null, lastTopic: '蘋果' });
    ok(room.volunteer('s2'));
    clock.advance(CHOOSING_MS);
    expect(round()).toMatchObject({ phase: 'idle', lastTopic: '蘋果' });
    ok(room.volunteer('s2'));
    ok(room.setTopic('s2', '香蕉'));
    expect(round()).toMatchObject({ phase: 'drawing', topic: '香蕉', lastTopic: null, results: null });
    submitOk('s1');
    submitOk('s2');
    await judgeCall(2, 10);
    await judgeCall(3, 20);
    expect(round()).toMatchObject({ phase: 'ended', lastTopic: '香蕉' });
  });

  it('ended 之後參賽者離開：results、lastTopic、計數與畫廊補送都保留（已揭曉的紀錄）', async () => {
    joinPlayers(2);
    await finishRound('s1', '蘋果', 0);
    joinOk('s3', 'Carol'); // 讓房內仍有人在線
    const before = round();
    room.disconnect('s1');
    clock.advance(GRACE_MS);
    expect(round()).toEqual(before);
    expect(galleries(joinOk('s5', 'Eve').effects)).toHaveLength(2);
  });

  it('results = []（全員離開）時 lastTopic 仍為本回合題目；ended 後有人離開不變動；中途加入者快照帶 lastTopic', () => {
    toDrawing(2, '狗');
    joinOk('s3', 'Carol');
    room.disconnect('s1');
    room.disconnect('s2');
    clock.advance(GRACE_MS);
    expect(round()).toMatchObject({ phase: 'ended', results: [], lastTopic: '狗' });
    expect(joinOk('s4', 'Dave').data.snapshot.round.lastTopic).toBe('狗');
    room.disconnect('s3');
    clock.advance(GRACE_MS);
    expect(round()).toMatchObject({ phase: 'ended', results: [], lastTopic: '狗' });
  });
});

// ─── 參賽者離開 ───────────────────────────────────────────────────

describe('§5 參賽者離開（寬限期滿）', () => {
  it('drawing 中：從 participantIds 移除；剩餘全員已交卷 → judging', () => {
    toDrawing(3);
    submitOk('s1');
    submitOk('s2');
    room.disconnect('s3');
    clock.advance(GRACE_MS);
    expect(round()).toMatchObject({ phase: 'judging', participantIds: [A, B] });
  });

  it('judging 中已交卷但仍在佇列：丟棄（中止評分、不計入 judgedCount、不進 results）', async () => {
    toDrawing(3);
    submitOk('s1');
    submitOk('s2');
    submitOk('s3');
    expect(round().phase).toBe('judging');
    room.disconnect('s2');
    room.disconnect('s1');
    clock.advance(GRACE_MS);
    // A（評分中）被中止、B（排隊中）被移除；C 開始評
    expect(judge.calls[0].signal.aborted).toBe(true);
    await flush();
    expect(round()).toMatchObject({ phase: 'judging', participantIds: [C], submittedCount: 1, judgedCount: 0 });
    expect(judge.calls).toHaveLength(2);
    expect(judge.calls[1].input.png[40]).toBe(makePng(0)[40]);
    await judgeCall(1, 66);
    expect(round().phase).toBe('ended');
    expect(round().results?.map((r) => [r.playerId, r.score])).toEqual([[C, 66]]);
    expect(round().judgedCount).toBe(1);
  });

  it('已評分的參賽者離開：從 participantIds 與計數移除', async () => {
    toDrawing(3);
    submitOk('s1');
    await judgeCall(0, 50);
    room.disconnect('s1');
    clock.advance(GRACE_MS);
    expect(round()).toMatchObject({ participantIds: [B, C], submittedCount: 0, judgedCount: 0 });
  });

  it('participantIds 變空（全員寬限期滿離開）→ judging 再 ended，results = []', () => {
    toDrawing(2);
    joinOk('s3', 'Carol'); // 旁觀者留在房內
    room.disconnect('s1');
    room.disconnect('s2');
    clock.advance(GRACE_MS);
    expect(round()).toMatchObject({ phase: 'ended', participantIds: [], results: [] });
    const phases = rounds(allAsync()).map((r) => r.phase);
    expect(phases.slice(-2)).toEqual(['judging', 'ended']);
    expect(chatTexts(allAsync())).toContain('揭曉：沒有人交卷');
    expect(galleries(allAsync())).toEqual([]);
  });

  it('單人參賽也能評分（剩 1 人不中止）', async () => {
    toDrawing(2);
    room.disconnect('s2');
    clock.advance(GRACE_MS);
    expect(round().phase).toBe('drawing');
    submitOk('s1');
    expect(round().phase).toBe('judging');
    await judgeCall(0, 88);
    expect(round().results?.map((r) => r.score)).toEqual([88]);
  });
});

// ─── 畫廊補送 ─────────────────────────────────────────────────────

describe('§4 contest:gallery 補送', () => {
  async function playRound(): Promise<void> {
    toDrawing(2);
    submitOk('s1', 1);
    submitOk('s2', 2);
    await judgeCall(0, 10);
    await judgeCall(1, 20);
    expect(round().phase).toBe('ended');
  }

  it('ended 後中途加入：ack 之後只對本人補送每位交卷者一則', async () => {
    await playRound();
    const { data, effects } = joinOk('s3', 'Carol');
    expect(data.snapshot.round.results).toHaveLength(2);
    const g = galleries(effects);
    expect(g.map((e) => e.to)).toEqual([{ only: C }, { only: C }]);
    expect(g.map((e) => (e.payload as GalleryImage).playerId)).toEqual([B, A]);
  });

  it('choosing 期間（results 保留）加入與重連接管也會補送；drawing 開始後不再補送', async () => {
    await playRound();
    ok(room.volunteer('s1'));
    expect(galleries(joinOk('s3', 'Carol').effects)).toHaveLength(2);
    const tokenB = joinOk('s2', 'x').data.token;
    room.disconnect('s2');
    expect(galleries(room.join('s9', '', tokenB).effects)).toHaveLength(2);
    ok(room.setTopic('s1', '香蕉'));
    expect(galleries(joinOk('s4', 'Dave').effects)).toEqual([]);
  });
});

// ─── 評分器退回 ───────────────────────────────────────────────────

describe('§6 評分失敗退回 random', () => {
  it('主評分器失敗：該張改 random、judgeMode 降為 random、本回合剩餘直接走 random；下一回合恢復', async () => {
    toDrawing(3);
    submitOk('s1');
    submitOk('s2');
    submitOk('s3');
    expect(round().judgeMode).toBe('ai');
    judge.calls[0].reject(new Error('boom'));
    await flush();
    expect(round()).toMatchObject({ judgedCount: 3, judgeMode: 'random', phase: 'ended' });
    expect(judge.calls).toHaveLength(1);
    expect(fallback.inputs).toHaveLength(3);
    expect(round().results?.every((r) => r.judgedBy === 'random' && r.score === 10)).toBe(true);

    ok(room.volunteer('s1'));
    ok(room.setTopic('s1', '香蕉'));
    submitOk('s1');
    expect(judge.calls).toHaveLength(2);
  });

  it('逾時（注入時鐘）：該張改 random，剩餘全走 random', async () => {
    toDrawing(2);
    submitOk('s1');
    submitOk('s2');
    clock.advance(TIMEOUT_MS);
    expect(judge.calls[0].signal.aborted).toBe(true);
    await flush();
    expect(round()).toMatchObject({ phase: 'ended', judgeMode: 'random' });
    expect(judge.calls).toHaveLength(1);
  });
});

// ─── 聊天 ─────────────────────────────────────────────────────────

describe('§5.3 聊天', () => {
  it('合法 → 廣播 chat；不合法 → MESSAGE_INVALID；間隔內 → RATE_LIMITED（被拒不更新時間戳）', () => {
    joinPlayers(2);
    expect(room.chat('sx', 'hi').ack).toMatchObject({ error: 'NOT_IN_ROOM' });
    const r = room.chat('s1', '  哈囉 ');
    ok(r);
    expect(emits(r.effects)[0]).toMatchObject({ to: 'all', event: 'chat:message', payload: { kind: 'chat', fromId: A, nickname: 'Alice', text: '哈囉' } });
    expect(room.chat('s2', '   ').ack).toEqual({ ok: false, error: 'MESSAGE_INVALID', message: CHAT_ERROR_MESSAGES.MESSAGE_INVALID });
    expect(room.chat('s2', 'a\nb').ack).toMatchObject({ error: 'MESSAGE_INVALID' });
    expect(room.chat('s2', 'x'.repeat(201)).ack).toMatchObject({ error: 'MESSAGE_INVALID' });
    clock.advance(CHAT_MIN_INTERVAL_MS - 1);
    expect(room.chat('s1', 'again').ack).toEqual({ ok: false, error: 'RATE_LIMITED', message: CHAT_ERROR_MESSAGES.RATE_LIMITED });
    clock.advance(1);
    ok(room.chat('s1', 'again'));
  });

  it('作畫中也是一般聊天（題目公開，沒有防洩題）', () => {
    toDrawing(2);
    ok(room.chat('s2', '蘋果好難畫'));
  });
});

describe('其他', () => {
  it('dispose 清掉寬限、回合計時器與評分佇列', async () => {
    toDrawing(2);
    submitOk('s1');
    room.disconnect('s2');
    room.dispose();
    await flush();
    expect(clock.timers.size).toBe(0);
    expect(judge.calls[0].signal.aborted).toBe(true);
  });

  it('快照與 round:update 是定格複本，外部修改不影響 Room', () => {
    toDrawing(2);
    const snap = room.snapshot(A);
    snap.round.participantIds.push('zzz');
    expect(round().participantIds).toEqual([A, B]);
  });
});
