// 繪圖比賽 Room 的評語（Epic 15）：spec/draw-contest/architecture.md §5「評語」、§6.1「佇列」事件規則 (a)(b)(c)
// Phase 5（Rex 2026-10-13）：單張失敗只影響該張、連續兩次失敗才跳過本回合剩餘；第一名稱讚版失敗或被跳過退回批評版；
// 揭曉時第一名在途的批評版不中止（跑完當退路）。依新定案改寫的斷言處標「2026-10-13 Phase 5」。
// 假時鐘＋手動評分器＋手動評語器，決定性地跑；不碰任何模型。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DRAW_SECONDS,
  RECONNECT_GRACE_SECONDS,
  SUBMIT_GRACE_SECONDS,
  type CommentUpdate,
  type RoundPublic,
} from '@fishing-work/shared/draw-contest';
import { Room, type EmitEffect, type Effect, type RoomCommentFailureInfo, type RoomOptions } from '../src/games/draw-contest/room';
import { FakeClock } from './helpers/fakeClock';
import { FnJudge, ManualCommentator, ManualJudge, flush, makePng } from './helpers/drawContest';

const GRACE_MS = RECONNECT_GRACE_SECONDS * 1000;
const DRAW_MS = DRAW_SECONDS * 1000;
const SUBMIT_GRACE_MS = SUBMIT_GRACE_SECONDS * 1000;
const JUDGE_TIMEOUT_MS = 30_000;
const COMMENT_TIMEOUT_MS = 30_000; // 2026-10-13 Phase 5：預設 20 → 30 秒

let clock: FakeClock;
let asyncEffects: Effect[][];
let judge: ManualJudge;
let fallback: FnJudge;
let commentator: ManualCommentator;
let failures: RoomCommentFailureInfo[];
let skips: string[];
let room: Room;

function makeRoom(opts: Partial<RoomOptions> = {}): Room {
  let n = 0;
  return new Room({
    clock,
    newId: () => `id${++n}`,
    onAsyncEffects: (e) => asyncEffects.push(e),
    judge: { judge, fallback, timeoutMs: JUDGE_TIMEOUT_MS },
    comment: { commentator, timeoutMs: COMMENT_TIMEOUT_MS },
    onCommentFailure: (info) => failures.push(info),
    onCommentSkip: (info) => skips.push(info.playerId),
    ...opts,
  });
}

beforeEach(() => {
  clock = new FakeClock();
  asyncEffects = [];
  judge = new ManualJudge('ai');
  fallback = new FnJudge(() => ({ score: 10, confidence: 0.4 }), 'random');
  commentator = new ManualCommentator();
  failures = [];
  skips = [];
  room = makeRoom();
});

afterEach(() => room.dispose());

// 固定的 id：A = id1（socket s1）、B = id3（s2）、C = id5（s3）、D = id7（s4）
const A = 'id1';
const B = 'id3';
const C = 'id5';
const NAMES = ['Alice', 'Bob', 'Carol', 'Dave'];

// ─── 測試工具 ─────────────────────────────────────────────────────

function joinOk(socketId: string, nickname: string, token?: string) {
  const r = room.join(socketId, nickname, token);
  if (!r.ack.ok) throw new Error(`join 失敗：${r.ack.error}`);
  return { data: r.ack.data, effects: r.effects };
}

function ok(outcome: { ack: { ok: boolean } }): void {
  expect(outcome.ack).toEqual({ ok: true, data: undefined });
}

function toDrawing(n = 2, topic = '蘋果'): void {
  for (let i = 0; i < n; i++) joinOk(`s${i + 1}`, NAMES[i]);
  ok(room.volunteer('s1'));
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

function commentEmits(effects: Effect[]): EmitEffect[] {
  return emits(effects).filter((e) => e.event === 'contest:comment');
}

function commentUpdates(effects: Effect[]): CommentUpdate[] {
  return commentEmits(effects).map((e) => e.payload as CommentUpdate);
}

function allAsync(): Effect[] {
  return asyncEffects.flat();
}

function round(): RoundPublic {
  return room.currentRound();
}

/** results 的評語欄位摘要：[playerId, comment, commentPending] */
function commentsOf(r: RoundPublic = round()): [string, string | null, boolean][] {
  return (r.results ?? []).map((e) => [e.playerId, e.comment, e.commentPending]);
}

/** resolve 第 i 次評分並讓佇列回報 */
async function judgeCall(i: number, score: number, confidence = 0.5): Promise<void> {
  judge.resolveCall(i, score, confidence);
  await flush();
}

async function commentCall(i: number, comment: string): Promise<void> {
  commentator.resolveCall(i, comment);
  await flush();
}

async function commentFail(i: number, err: unknown = new Error('boom')): Promise<void> {
  commentator.rejectCall(i, err);
  await flush();
}

/**
 * n 人全員交卷並全部評完 → ended（評語都還沒完成）。分數依交卷順序遞增：最後一位第一名，results 依 …、C、B、A 排。
 * 揭曉後評語器的呼叫順序：calls[0] = A 的批評版（揭曉前就在產生，不是第一名所以照跑）、
 * calls[1] = 第一名的稱讚版（插隊，取代他剛排進去、還在排隊的批評版 → 第一名沒有退路）、之後才是其餘排隊者（依評分順序）。
 */
async function toEndedAllPending(n = 2): Promise<void> {
  toDrawing(n);
  for (let i = 0; i < n; i++) submitOk(`s${i + 1}`, i + 1);
  for (let i = 0; i < n; i++) await judgeCall(i, 70 + i * 10);
  expect(round().phase).toBe('ended');
}

// ─── 排進佇列 ─────────────────────────────────────────────────────

describe('§5 評語：評分完成的瞬間排進評語佇列', () => {
  // 2026-10-21 Phase 7：加送該玩家當下的暱稱（原本「不給暱稱」）
  it('送給評語器的是交卷原圖、題目、該張最終分數與該玩家的暱稱；不給名次', async () => {
    toDrawing(2, ' 蘋果 ');
    submitOk('s1', 1);
    expect(commentator.calls).toHaveLength(0); // 還沒評分就不排
    await judgeCall(0, 80);
    expect(commentator.calls).toHaveLength(1);
    const { input } = commentator.calls[0];
    expect(Object.keys(input).sort()).toEqual(['nickname', 'png', 'score', 'topic']);
    expect(input.nickname).toBe('Alice');
    expect(input.topic).toBe('蘋果');
    expect(input.score).toBe(80);
    expect(Buffer.isBuffer(input.png)).toBe(true);
    expect([...input.png]).toEqual([...makePng(1)]);
  });

  it('Clef 失敗退回 random：送的是 random 的分數', async () => {
    toDrawing(2);
    submitOk('s1', 1);
    judge.calls[0].reject(new Error('連不上'));
    await flush();
    expect(commentator.calls).toHaveLength(1);
    expect(commentator.calls[0].input.score).toBe(10);
  });

  it('一次一張、與評分佇列獨立：評語還在產生時下一張照常評分，評完的依序排隊', async () => {
    toDrawing(3);
    submitOk('s1', 1);
    submitOk('s2', 2);
    submitOk('s3', 3);
    await judgeCall(0, 70);
    await judgeCall(1, 60);
    expect(commentator.calls).toHaveLength(1); // A 產生中、B 排隊
    expect(judge.calls).toHaveLength(3); // 評分不等評語
    await commentCall(0, '甲');
    expect(commentator.calls).toHaveLength(2);
    expect(commentator.calls[1].input.score).toBe(60);
  });

  // 2026-10-21 Phase 7
  it('每張的暱稱是交卷者本人的（交卷與評分順序不同也對得上）', async () => {
    toDrawing(3);
    submitOk('s3', 3);
    submitOk('s1', 1);
    submitOk('s2', 2);
    await judgeCall(0, 70); // C 的那張先評完
    await commentCall(0, '甲');
    await judgeCall(1, 60); // A
    await commentCall(1, '乙');
    expect(commentator.calls.map((c) => [c.input.nickname, [...c.input.png]])).toEqual([
      ['Carol', [...makePng(3)]],
      ['Alice', [...makePng(1)]],
    ]);
  });
});

// ─── commentMode 生命週期 ─────────────────────────────────────────

describe('§4 commentMode（生命週期同 judgeMode）', () => {
  it('idle／choosing／drawing 為 null；judging 起 ai；ended 保留；下一回合 choosing／idle／drawing 回 null', async () => {
    joinOk('s1', 'Alice');
    joinOk('s2', 'Bob');
    expect(round().commentMode).toBeNull();
    ok(room.volunteer('s1'));
    expect(round().commentMode).toBeNull();
    ok(room.setTopic('s1', '蘋果'));
    expect(round().commentMode).toBeNull();
    submitOk('s1', 1);
    await judgeCall(0, 50);
    expect(round()).toMatchObject({ phase: 'drawing', commentMode: null, judgeMode: null }); // 已排評語，但 judging 起才設
    const r = submitOk('s2', 2);
    expect(rounds(r.effects).map((x) => [x.phase, x.judgeMode, x.commentMode])).toEqual([
      ['drawing', null, null],
      ['judging', 'ai', 'ai'],
    ]);
    await judgeCall(1, 40);
    expect(round()).toMatchObject({ phase: 'ended', judgeMode: 'ai', commentMode: 'ai' });

    ok(room.volunteer('s2'));
    expect(round()).toMatchObject({ phase: 'choosing', judgeMode: null, commentMode: null });
    ok(room.cancel('s2'));
    expect(round()).toMatchObject({ phase: 'idle', commentMode: null });
    ok(room.volunteer('s2'));
    ok(room.setTopic('s2', '香蕉'));
    expect(round()).toMatchObject({ phase: 'drawing', commentMode: null });
  });

  it('時間到進 judging（非同步）也帶 commentMode', () => {
    toDrawing(2);
    clock.advance(DRAW_MS);
    expect(rounds(allAsync()).at(-1)).toMatchObject({ phase: 'judging', judgeMode: 'ai', commentMode: 'ai' });
  });

  it('participantIds 變空 → ended、results = []：commentMode 仍照評語器模式', () => {
    toDrawing(2);
    joinOk('s3', 'Carol');
    room.disconnect('s1');
    room.disconnect('s2');
    clock.advance(GRACE_MS);
    expect(round()).toMatchObject({ phase: 'ended', results: [], commentMode: 'ai' });
    expect(commentator.calls).toHaveLength(0);
  });
});

// ─── ended 不等評語 ───────────────────────────────────────────────

describe('§5 評語：ended 不等評語', () => {
  it('揭曉時已完成的寫進 comment、未完成者 commentPending=true、未交卷者 null／false；ended 前完成不發 contest:comment（第一名另依重做規則為 pending）', async () => {
    // 評語逾時設得比作畫時間長：這個案例要一路快轉到交卷期限，不想讓產生中的那張先逾時
    room.dispose();
    room = makeRoom({ comment: { commentator, timeoutMs: 10 * 60_000 } });
    toDrawing(3);
    submitOk('s1', 1);
    await judgeCall(0, 60);
    asyncEffects = [];
    await commentCall(0, '就這也叫蘋果？');
    expect(asyncEffects).toEqual([]); // ended 前完成：只記在交卷上，沒有任何事件
    submitOk('s2', 2);
    await judgeCall(1, 80);
    expect(commentator.calls).toHaveLength(2);
    clock.advance(DRAW_MS + SUBMIT_GRACE_MS + 1);
    expect(round().phase).toBe('ended'); // B 的評語還沒回來就揭曉
    expect(round().results).toEqual([
      // 第一名：重做稱讚版 → pending（他原本的批評版還在產生：讓它跑完當退路，不顯示）
      { playerId: B, nickname: 'Bob', rank: 1, score: 80, confidence: 0.5, judgedBy: 'ai', submitted: true, submittedAt: expect.any(Number), comment: null, commentPending: true },
      // 非第一名：揭曉前已完成的評語直接寫進 results
      { playerId: A, nickname: 'Alice', rank: 2, score: 60, confidence: 0.5, judgedBy: 'ai', submitted: true, submittedAt: expect.any(Number), comment: '就這也叫蘋果？', commentPending: false },
      { playerId: C, nickname: 'Carol', rank: 3, score: 0, confidence: null, judgedBy: null, submitted: false, submittedAt: null, comment: null, commentPending: false },
    ]);
    expect(commentEmits(allAsync())).toEqual([]);
    expect(rounds(allAsync()).at(-1)).toMatchObject({ phase: 'ended', commentMode: 'ai' });
  });

  it('ended 後每完成一張：廣播 contest:comment（to all）並同步更新 results；不另發 round:update；中途加入者快照即為最新', async () => {
    await toEndedAllPending(2);
    expect(commentsOf()).toEqual([[B, null, true], [A, null, true]]);
    expect(commentator.calls).toHaveLength(1); // A 的批評版產生中；第一名 B 的稱讚版排在它後面

    asyncEffects = [];
    await commentCall(0, '勉強及格啦～');
    expect(asyncEffects).toHaveLength(1);
    expect(asyncEffects[0]).toEqual([
      { kind: 'emit', to: 'all', event: 'contest:comment', payload: { roundNo: 1, playerId: A, comment: '勉強及格啦～' } },
    ]);
    expect(commentsOf()).toEqual([[B, null, true], [A, '勉強及格啦～', false]]);
    expect(round().commentMode).toBe('ai');

    // 這時加入的人：快照帶 A 的評語、B 仍 pending
    const late = joinOk('s3', 'Carol').data.snapshot.round;
    expect(commentsOf(late)).toEqual([[B, null, true], [A, '勉強及格啦～', false]]);

    asyncEffects = [];
    await commentCall(1, '哼，算你厲害～');
    expect(commentUpdates(allAsync())).toEqual([{ roundNo: 1, playerId: B, comment: '哼，算你厲害～' }]);
    expect(eventsOf(allAsync())).toEqual(['contest:comment']);
    expect(commentsOf()).toEqual([[B, '哼，算你厲害～', false], [A, '勉強及格啦～', false]]);
    expect(commentsOf(joinOk('s4', 'Dave').data.snapshot.round)).toEqual([[B, '哼，算你厲害～', false], [A, '勉強及格啦～', false]]);
    expect(failures).toEqual([]);
  });

  it('全員交卷、最後一張評完的同一刻揭曉：分數、排名與揭曉效果和沒有評語時相同（評語不擋揭曉）', async () => {
    toDrawing(2);
    submitOk('s1', 1);
    submitOk('s2', 2);
    await judgeCall(0, 70);
    asyncEffects = [];
    await judgeCall(1, 90);
    expect(eventsOf(allAsync())).toEqual(['round:update', 'round:update', 'players:update', 'chat:message', 'contest:gallery', 'contest:gallery']);
    expect(round().results?.map((r) => [r.playerId, r.rank, r.score])).toEqual([[B, 1, 90], [A, 2, 70]]);
    expect(commentsOf()).toEqual([[B, null, true], [A, null, true]]);
  });

  it('results 與 round:update 是定格複本：之後評語補上不會改到已送出的 payload', async () => {
    await toEndedAllPending(2);
    const sent = rounds(allAsync()).at(-1) as RoundPublic;
    await commentCall(0, '甲');
    expect(commentsOf(sent)).toEqual([[B, null, true], [A, null, true]]);
    const snap = room.snapshot(A);
    snap.round.results![1].comment = '被改了';
    expect(commentsOf()[1]).toEqual([A, '甲', false]);
  });

  it('下一回合 choosing／idle 期間（results 保留）完成的評語照樣廣播並更新 results', async () => {
    await toEndedAllPending(2);
    ok(room.volunteer('s2'));
    expect(round()).toMatchObject({ phase: 'choosing', commentMode: null });
    expect(commentator.calls[0].signal.aborted).toBe(false); // choosing 不丟棄，drawing 才丟
    asyncEffects = [];
    await commentCall(0, '甲');
    expect(commentUpdates(allAsync())).toEqual([{ roundNo: 1, playerId: A, comment: '甲' }]);
    ok(room.cancel('s2'));
    await commentCall(1, '乙');
    expect(round()).toMatchObject({ phase: 'idle', roundNo: 1 });
    expect(commentsOf()).toEqual([[B, '乙', false], [A, '甲', false]]);
  });
});

// ─── 失敗 ─────────────────────────────────────────────────────────

describe('§6.1 單次失敗（未達連續兩次）：只影響該張（2026-10-13 Phase 5）', () => {
  it('judging 中失敗一次：該張 comment null／pending false、不發任何事件；commentMode 維持 ai，下一張照常呼叫模型', async () => {
    toDrawing(3);
    submitOk('s1', 1);
    submitOk('s2', 2);
    submitOk('s3', 3);
    await judgeCall(0, 90); // A 的評語產生中
    await judgeCall(1, 80); // B 排隊
    asyncEffects = [];
    await commentFail(0, new Error('連不上'));
    expect(asyncEffects).toEqual([]); // 2026-10-13 Phase 5：原本這裡 B 同批跳過、發 round:update off
    expect(round()).toMatchObject({ phase: 'judging', commentMode: 'ai' });
    expect(failures).toEqual([{ playerId: A, reason: 'error', error: 'Error: 連不上', consecutive: 1, skipped: [] }]);
    expect(commentator.calls).toHaveLength(2); // B 照常開始
    await commentCall(1, '給 B');
    await judgeCall(2, 70); // C 評完 → C 的批評版產生中 → 揭曉
    expect(skips).toEqual([]);
    expect(round()).toMatchObject({ phase: 'ended', commentMode: 'ai' });
    // A 是第一名：批評版失敗過（沒有退路），稱讚版照樣重做
    expect(commentsOf()).toEqual([[A, null, true], [B, '給 B', false], [C, null, true]]);
    expect(commentEmits(allAsync())).toEqual([]);
    expect(round().results?.map((r) => [r.rank, r.score])).toEqual([[1, 90], [2, 80], [3, 70]]);
  });

  it('drawing 中只失敗一次（交卷即評）：不發任何事件；進 judging 時 commentMode 仍是 ai，之後照常呼叫模型', async () => {
    toDrawing(2);
    submitOk('s1', 1);
    await judgeCall(0, 80);
    asyncEffects = [];
    await commentFail(0);
    expect(asyncEffects).toEqual([]);
    expect(round()).toMatchObject({ phase: 'drawing', commentMode: null });
    const r = submitOk('s2', 2);
    expect(rounds(r.effects).at(-1)).toMatchObject({ phase: 'judging', commentMode: 'ai' }); // 2026-10-13 Phase 5：原本直接 off
    await judgeCall(1, 60);
    expect(round()).toMatchObject({ phase: 'ended', commentMode: 'ai' });
    expect(skips).toEqual([]);
    expect(commentator.calls).toHaveLength(2); // B 的批評版照常開始
  });

  it('ended 之後失敗一次：只發該張一則 contest:comment { comment: null }，**不發 round:update**，commentMode 維持 ai；其餘照常', async () => {
    await toEndedAllPending(3);
    expect(commentsOf()).toEqual([[C, null, true], [B, null, true], [A, null, true]]);
    asyncEffects = [];
    await commentFail(0);
    // 2026-10-13 Phase 5：原本 A、C、B 各一則 null 再加 round:update off
    expect(asyncEffects).toEqual([[{ kind: 'emit', to: 'all', event: 'contest:comment', payload: { roundNo: 1, playerId: A, comment: null } }]]);
    expect(round()).toMatchObject({ phase: 'ended', commentMode: 'ai' });
    expect(commentsOf()).toEqual([[C, null, true], [B, null, true], [A, null, false]]);
    expect(failures).toEqual([{ playerId: A, reason: 'error', error: 'Error: boom', consecutive: 1, skipped: [] }]);
    // 中途加入者的快照即為最新
    expect(commentsOf(joinOk('s4', 'Dave').data.snapshot.round)).toEqual([[C, null, true], [B, null, true], [A, null, false]]);

    asyncEffects = [];
    await commentCall(1, '給 C 的稱讚'); // 成功 → 連續計數歸零
    await commentCall(2, '給 B');
    expect(eventsOf(allAsync())).toEqual(['contest:comment', 'contest:comment']);
    expect(commentsOf()).toEqual([[C, '給 C 的稱讚', false], [B, '給 B', false], [A, null, false]]);
    expect(round().commentMode).toBe('ai');
  });

  it('一次失敗後成功：計數歸零，同回合之後再失敗一次仍不跳過', async () => {
    toDrawing(4);
    for (let i = 0; i < 4; i++) submitOk(`s${i + 1}`, i + 1);
    await judgeCall(0, 90);
    await commentFail(0); // A 失敗
    await judgeCall(1, 80);
    await commentCall(1, '給 B'); // B 成功 → 歸零
    await judgeCall(2, 70);
    await commentFail(2); // C 失敗：累計兩次但不連續
    expect(round()).toMatchObject({ phase: 'judging', commentMode: 'ai' });
    expect(failures.map((f) => [f.playerId, f.consecutive, f.skipped])).toEqual([[A, 1, []], [C, 1, []]]);
    await judgeCall(3, 60);
    expect(skips).toEqual([]);
    expect(round()).toMatchObject({ phase: 'ended', commentMode: 'ai' });
    expect(commentsOf()).toEqual([[A, null, true], [B, '給 B', false], [C, null, false], ['id7', null, true]]);
  });

  it('輸出空白視為失敗（單次：不關）', async () => {
    toDrawing(2);
    submitOk('s1', 1);
    submitOk('s2', 2);
    await judgeCall(0, 90);
    await commentCall(0, '   ');
    expect(failures).toEqual([{ playerId: A, reason: 'empty', consecutive: 1, skipped: [] }]);
    expect(round()).toMatchObject({ phase: 'judging', commentMode: 'ai' }); // 2026-10-13 Phase 5：原本 off
  });

  it('被丟棄的不計也不歸零：失敗一次 → 產生中的那張因參賽者離開而丟棄 → 再失敗一次即為連續第二次', async () => {
    toDrawing(4);
    for (let i = 0; i < 4; i++) submitOk(`s${i + 1}`, i + 1);
    await judgeCall(0, 90);
    await commentFail(0); // A 失敗（第一次）
    await judgeCall(1, 80); // B 的批評版產生中
    room.disconnect('s2');
    clock.advance(GRACE_MS); // B 寬限期滿離開 → 丟棄（中止，不算失敗也不歸零）
    expect(commentator.calls[1].signal.aborted).toBe(true);
    await flush();
    expect(round()).toMatchObject({ phase: 'judging', commentMode: 'ai' });
    await judgeCall(2, 70); // C 的批評版產生中
    await commentFail(2); // 連續第二次
    expect(round()).toMatchObject({ phase: 'judging', commentMode: 'off' });
    expect(failures.map((f) => [f.playerId, f.consecutive])).toEqual([[A, 1], [C, 2]]);
  });
});

describe('§6.1 連續兩次失敗 (a)(c)：第二次失敗發生在 ended 之前', () => {
  it('judging 中連續兩次失敗：第二次那張與之後排進來的各張 comment null／pending false 寫進 results，不發 contest:comment；commentMode 改 off 並 round:update', async () => {
    toDrawing(4);
    for (let i = 0; i < 4; i++) submitOk(`s${i + 1}`, i + 1);
    expect(round()).toMatchObject({ phase: 'judging', commentMode: 'ai' });
    await judgeCall(0, 90); // A 的評語產生中
    await judgeCall(1, 80); // B 排隊
    await judgeCall(2, 70); // C 排隊
    asyncEffects = [];
    await commentFail(0, new Error('連不上'));
    expect(asyncEffects).toEqual([]); // 第一次：沒有事件
    await commentFail(1, new Error('還是連不上'));
    // 一批：B 失敗、C 跳過 → 只有一則 round:update（commentMode off）
    expect(asyncEffects).toHaveLength(1);
    expect(eventsOf(asyncEffects[0])).toEqual(['round:update']);
    expect(rounds(asyncEffects[0])[0]).toMatchObject({ phase: 'judging', commentMode: 'off', judgeMode: 'ai', results: null });
    expect(failures).toEqual([
      { playerId: A, reason: 'error', error: 'Error: 連不上', consecutive: 1, skipped: [] },
      { playerId: B, reason: 'error', error: 'Error: 還是連不上', consecutive: 2, skipped: [C] },
    ]);

    await judgeCall(3, 60); // D 之後才評完：直接跳過
    expect(skips).toEqual(['id7']);
    expect(commentator.calls).toHaveLength(2); // 只呼叫過模型兩次（有界：最壞兩次逾時）
    expect(round()).toMatchObject({ phase: 'ended', commentMode: 'off', judgeMode: 'ai' });
    expect(commentsOf()).toEqual([[A, null, false], [B, null, false], [C, null, false], ['id7', null, false]]);
    expect(commentEmits(allAsync())).toEqual([]);
    // 分數與排名不受影響
    expect(round().results?.map((r) => [r.rank, r.score])).toEqual([[1, 90], [2, 80], [3, 70], [4, 60]]);
  });

  it('drawing 中連續兩次失敗（交卷即評）：commentMode 尚為 null、不發任何事件；進 judging 時直接是 off', async () => {
    toDrawing(3);
    submitOk('s1', 1);
    await judgeCall(0, 80);
    submitOk('s2', 2);
    await judgeCall(1, 70);
    asyncEffects = [];
    await commentFail(0);
    await commentFail(1);
    expect(asyncEffects).toEqual([]);
    expect(round()).toMatchObject({ phase: 'drawing', commentMode: null });
    const r = submitOk('s3', 3);
    expect(rounds(r.effects).at(-1)).toMatchObject({ phase: 'judging', commentMode: 'off' });
    await judgeCall(2, 60);
    expect(round()).toMatchObject({ phase: 'ended', commentMode: 'off' });
    expect(commentsOf()).toEqual([[A, null, false], [B, null, false], [C, null, false]]);
    expect(commentator.calls).toHaveLength(2);
    expect(skips).toEqual([C]);
  });

  it('失敗前已產生的評語保留（卡片顯示只看自身欄位）', async () => {
    toDrawing(4);
    for (let i = 0; i < 4; i++) submitOk(`s${i + 1}`, i + 1);
    await judgeCall(0, 90);
    await commentCall(0, '甲');
    await judgeCall(1, 80);
    await commentFail(1);
    await judgeCall(2, 70);
    await commentFail(2);
    await judgeCall(3, 60);
    expect(round()).toMatchObject({ phase: 'ended', commentMode: 'off' });
    expect(commentsOf()).toEqual([[A, '甲', false], [B, null, false], [C, null, false], ['id7', null, false]]);
  });

  it('下一回合重新嘗試：commentMode 從 ai 開始、連續失敗計數歸零、再次呼叫模型', async () => {
    toDrawing(3);
    submitOk('s1', 1);
    submitOk('s2', 2);
    submitOk('s3', 3);
    await judgeCall(0, 90);
    await commentFail(0);
    await judgeCall(1, 80);
    await commentFail(1);
    await judgeCall(2, 70);
    expect(round()).toMatchObject({ phase: 'ended', commentMode: 'off' });

    ok(room.volunteer('s1'));
    ok(room.setTopic('s1', '香蕉'));
    submitOk('s1', 4);
    submitOk('s2', 5);
    const r = submitOk('s3', 6);
    expect(rounds(r.effects).at(-1)).toMatchObject({ phase: 'judging', commentMode: 'ai' });
    await judgeCall(3, 50);
    expect(commentator.calls).toHaveLength(3);
    expect(commentator.calls[2].input).toMatchObject({ topic: '香蕉', score: 50 });
    // 新回合第一次失敗不延續上回合的計數
    await commentFail(2);
    expect(round()).toMatchObject({ phase: 'judging', commentMode: 'ai' });
    expect(failures.at(-1)).toMatchObject({ playerId: A, consecutive: 1 });
  });
});

describe('§6.1 連續兩次失敗 (b)：第二次失敗發生在 ended 之後', () => {
  it('第二次失敗那張與當下仍 pending 的每一張各發一則 contest:comment { comment: null }，再發一則 round:update（commentMode off）', async () => {
    await toEndedAllPending(4);
    // 佇列：A 產生中；排隊＝D 的稱讚版（插隊）、B、C
    expect(commentsOf()).toEqual([['id7', null, true], [C, null, true], [B, null, true], [A, null, true]]);
    await commentFail(0); // 第一次：只有 A 一則 null
    expect(round().commentMode).toBe('ai');
    asyncEffects = [];
    await commentFail(1); // 第一名 D 的稱讚版失敗 → 連續第二次
    expect(asyncEffects).toHaveLength(1);
    const fx = asyncEffects[0];
    expect(eventsOf(fx)).toEqual(['contest:comment', 'contest:comment', 'contest:comment', 'round:update']);
    expect(emits(fx).every((e) => e.to === 'all')).toBe(true);
    // 失敗那張（D，沒有退路 → null），再來是當下排隊中的 B、C
    expect(commentUpdates(fx)).toEqual([
      { roundNo: 1, playerId: 'id7', comment: null },
      { roundNo: 1, playerId: B, comment: null },
      { roundNo: 1, playerId: C, comment: null },
    ]);
    const updated = rounds(fx)[0];
    expect(updated).toMatchObject({ phase: 'ended', commentMode: 'off', judgeMode: 'ai' });
    expect(commentsOf(updated)).toEqual([['id7', null, false], [C, null, false], [B, null, false], [A, null, false]]);
    expect(commentsOf()).toEqual([['id7', null, false], [C, null, false], [B, null, false], [A, null, false]]);
    expect(commentator.calls).toHaveLength(2);
    expect(failures).toEqual([
      { playerId: A, reason: 'error', error: 'Error: boom', consecutive: 1, skipped: [] },
      { playerId: 'id7', reason: 'error', error: 'Error: boom', consecutive: 2, skipped: [B, C], praise: true, fallback: null },
    ]);
    // 沒有永遠 pending 的卡片；之後不再有事件
    asyncEffects = [];
    clock.advance(10 * 60_000);
    await flush();
    expect(asyncEffects).toEqual([]);
  });

  it('前面成功的不受影響：第一張字串、第二張（第一名的稱讚版）單次失敗只影響自己、第三張照常', async () => {
    await toEndedAllPending(3);
    await commentCall(0, '甲');
    asyncEffects = [];
    await commentFail(1);
    // 2026-10-13 Phase 5：原本 B 同批跳過＋round:update off
    expect(eventsOf(allAsync())).toEqual(['contest:comment']);
    expect(commentUpdates(allAsync())).toEqual([{ roundNo: 1, playerId: C, comment: null }]); // C 的批評版還在排隊就被取代 → 沒有退路
    expect(round().commentMode).toBe('ai');
    expect(failures).toEqual([{ playerId: C, reason: 'error', error: 'Error: boom', consecutive: 1, skipped: [], praise: true, fallback: null }]);
    await commentCall(2, '乙');
    expect(commentsOf()).toEqual([[C, null, false], [B, '乙', false], [A, '甲', false]]);
    expect(round().commentMode).toBe('ai');
  });

  it('逾時（COMMENT_TIMEOUT_MS，注入時鐘）：中止該張；第一次只影響該張，連續第二次才收尾；最壞多等兩次逾時', async () => {
    await toEndedAllPending(3);
    asyncEffects = [];
    clock.advance(COMMENT_TIMEOUT_MS - 1);
    await flush();
    expect(asyncEffects).toEqual([]);
    clock.advance(1);
    expect(commentator.calls[0].signal.aborted).toBe(true);
    await flush();
    expect(eventsOf(allAsync())).toEqual(['contest:comment']); // 2026-10-13 Phase 5：原本這裡就全部收尾
    expect(commentator.calls).toHaveLength(2);
    clock.advance(COMMENT_TIMEOUT_MS - 1);
    await flush();
    expect(eventsOf(allAsync())).toEqual(['contest:comment']);
    clock.advance(1);
    await flush();
    expect(eventsOf(allAsync())).toEqual(['contest:comment', 'contest:comment', 'contest:comment', 'round:update']);
    expect(failures).toEqual([
      { playerId: A, reason: 'timeout', consecutive: 1, skipped: [] },
      { playerId: C, reason: 'timeout', consecutive: 2, skipped: [B], praise: true, fallback: null },
    ]);
    expect(commentator.calls).toHaveLength(2);
    expect(clock.timers.size).toBe(0);
  });

  it('下一回合 choosing 期間連續第二次失敗：pending 的各張照發 contest:comment null；commentMode 依生命週期維持 null、不發 round:update', async () => {
    await toEndedAllPending(3);
    await commentFail(0);
    ok(room.volunteer('s2'));
    asyncEffects = [];
    await commentFail(1);
    expect(eventsOf(allAsync())).toEqual(['contest:comment', 'contest:comment']);
    expect(round()).toMatchObject({ phase: 'choosing', commentMode: null });
    expect(commentsOf()).toEqual([[C, null, false], [B, null, false], [A, null, false]]);
  });

  it('下一回合 choosing 期間單次失敗：只發該張一則 contest:comment', async () => {
    await toEndedAllPending(2);
    ok(room.volunteer('s2'));
    asyncEffects = [];
    await commentFail(0);
    expect(eventsOf(allAsync())).toEqual(['contest:comment']); // 2026-10-13 Phase 5：原本 B 也同批 null
    expect(round()).toMatchObject({ phase: 'choosing', commentMode: null });
    expect(commentsOf()).toEqual([[B, null, true], [A, null, false]]);
  });
});

// ─── 第一名重做稱讚版 ─────────────────────────────────────────────

describe('§5 評語：第一名重做稱讚版（Epic 15 Phase 4）', () => {
  it('評語已完成的第一名：揭曉時重設為 comment null／commentPending true（批評版不顯示、不發事件），之後以稱讚版重做並廣播', async () => {
    toDrawing(2);
    submitOk('s1', 1);
    await judgeCall(0, 90);
    await commentCall(0, '就這？'); // A 的批評版在揭曉前就完成了
    submitOk('s2', 2);
    asyncEffects = [];
    await judgeCall(1, 60); // B 評完 → B 的批評版開始產生 → 同一刻揭曉
    expect(round()).toMatchObject({ phase: 'ended', commentMode: 'ai' });
    expect(commentsOf()).toEqual([[A, null, true], [B, null, true]]);
    expect(commentEmits(allAsync())).toEqual([]);
    // 中途加入者的快照也看不到那句批評版
    expect(commentsOf(joinOk('s3', 'Carol').data.snapshot.round)).toEqual([[A, null, true], [B, null, true]]);
    // 在途的是別人（B）的那張：讓它跑完，稱讚版排下一個
    expect(commentator.calls).toHaveLength(2);
    expect(commentator.calls[1].signal.aborted).toBe(false);

    asyncEffects = [];
    await commentCall(1, '雜魚～');
    expect(commentUpdates(allAsync())).toEqual([{ roundNo: 1, playerId: B, comment: '雜魚～' }]);
    expect(commentator.calls).toHaveLength(3);
    const praise = commentator.calls[2].input;
    expect(Object.keys(praise).sort()).toEqual(['nickname', 'png', 'praise', 'score', 'topic']);
    // 2026-10-21 Phase 7：稱讚版帶的是第一名（A）的暱稱，不是在途那張（B）的
    expect(praise).toMatchObject({ topic: '蘋果', score: 90, nickname: 'Alice', praise: true });
    expect(commentator.calls[1].input.nickname).toBe('Bob');
    expect([...praise.png]).toEqual([...makePng(1)]); // 圖還是第一名自己的那張

    asyncEffects = [];
    await commentCall(2, '哼，還不錯嘛～');
    expect(asyncEffects).toEqual([[{ kind: 'emit', to: 'all', event: 'contest:comment', payload: { roundNo: 1, playerId: A, comment: '哼，還不錯嘛～' } }]]);
    expect(commentsOf()).toEqual([[A, '哼，還不錯嘛～', false], [B, '雜魚～', false]]);
    expect(round().commentMode).toBe('ai');
    expect(failures).toEqual([]);
  });

  it('原工作還在佇列排隊：被稱讚版取代（模型只為第一名跑一次，而且是稱讚版）；插隊順序＝在途的別人那張先完成，稱讚版排在其他排隊者之前', async () => {
    toDrawing(4);
    for (let i = 0; i < 4; i++) submitOk(`s${i + 1}`, i + 1);
    await judgeCall(0, 50); // A：批評版產生中
    await judgeCall(1, 60); // B：排隊
    await judgeCall(2, 90); // C：排隊（之後是第一名）
    await judgeCall(3, 70); // D：排隊 → 揭曉
    expect(round().phase).toBe('ended');
    expect(commentsOf()).toEqual([[C, null, true], ['id7', null, true], [B, null, true], [A, null, true]]);
    expect(commentator.calls).toHaveLength(1);
    expect(commentator.calls[0].signal.aborted).toBe(false);

    asyncEffects = [];
    await commentCall(0, '給 A');
    await commentCall(1, '給 C 的稱讚');
    await commentCall(2, '給 B');
    await commentCall(3, '給 D');
    expect(commentator.calls).toHaveLength(4); // 四個人、四次呼叫：C 沒有跑兩次
    // 2026-10-21 Phase 7：插隊的稱讚版帶第一名 Carol 的暱稱，其餘各帶各的
    expect(commentator.calls.map((c) => [c.input.score, c.input.praise === true, c.input.nickname])).toEqual([
      [50, false, 'Alice'],
      [90, true, 'Carol'],
      [60, false, 'Bob'],
      [70, false, 'Dave'],
    ]);
    expect(commentUpdates(allAsync()).map((u) => [u.playerId, u.comment])).toEqual([
      [A, '給 A'],
      [C, '給 C 的稱讚'],
      [B, '給 B'],
      ['id7', '給 D'],
    ]);
  });

  // 2026-10-13 Phase 5：原本在途的批評版直接中止、稱讚版立即接著跑
  it('原工作正在產生：讓它跑完（結果不顯示、不發事件，只當退路），稱讚版緊接著跑、在其他排隊者之前', async () => {
    toDrawing(2);
    submitOk('s1', 1);
    submitOk('s2', 2);
    await judgeCall(0, 90); // A：批評版產生中
    asyncEffects = [];
    await judgeCall(1, 60); // B：排隊 → 揭曉，A 第一名
    expect(round().phase).toBe('ended');
    expect(commentator.calls[0].signal.aborted).toBe(false);
    expect(commentator.calls).toHaveLength(1); // 稱讚版等在途的批評版跑完
    expect(commentsOf()).toEqual([[A, null, true], [B, null, true]]);

    asyncEffects = [];
    await commentCall(0, '揭曉時還在寫的批評版');
    expect(asyncEffects).toEqual([]); // 不顯示、不發事件
    expect(commentsOf()).toEqual([[A, null, true], [B, null, true]]);
    expect(commentsOf(joinOk('s3', 'Carol').data.snapshot.round)).toEqual([[A, null, true], [B, null, true]]);
    expect(commentator.calls).toHaveLength(2);
    expect(commentator.calls[1].input).toMatchObject({ score: 90, praise: true, nickname: 'Alice' }); // 2026-10-21 Phase 7
    expect(failures).toEqual([]);
    expect(skips).toEqual([]);
    expect(round().commentMode).toBe('ai');

    await commentCall(1, '第一名啦～');
    expect(commentator.calls).toHaveLength(3);
    expect(commentator.calls[2].input.praise).toBeUndefined(); // 接著才是 B 的批評版
    await commentCall(2, '雜魚～');
    expect(commentUpdates(allAsync())).toEqual([
      { roundNo: 1, playerId: A, comment: '第一名啦～' },
      { roundNo: 1, playerId: B, comment: '雜魚～' },
    ]);
    expect(commentsOf()).toEqual([[A, '第一名啦～', false], [B, '雜魚～', false]]);
  });

  it('送稱讚版的分數是該張最終分數（Clef 失敗退回 random 時就是 random 的分數）', async () => {
    toDrawing(2);
    submitOk('s1', 1);
    submitOk('s2', 2);
    judge.calls[0].reject(new Error('連不上'));
    await flush();
    expect(round()).toMatchObject({ phase: 'ended', judgeMode: 'random', commentMode: 'ai' });
    // 兩張都是 random 的 10 分，同分先交卷的 A 第一名
    expect(round().results?.map((r) => [r.playerId, r.rank, r.score])).toEqual([[A, 1, 10], [B, 2, 10]]);
    // 2026-10-13 Phase 5：A 在途的批評版不中止，跑完才輪到稱讚版
    expect(commentator.calls).toHaveLength(1);
    await commentCall(0, 'A 的批評版');
    expect(commentator.calls.at(-1)?.input).toMatchObject({ score: 10, praise: true });
  });

  it('單人回合的第一名也稱讚', async () => {
    toDrawing(2);
    room.disconnect('s2');
    clock.advance(GRACE_MS);
    expect(round()).toMatchObject({ phase: 'drawing', participantIds: [A] });
    submitOk('s1', 1);
    await judgeCall(0, 40);
    expect(round().phase).toBe('ended');
    expect(commentsOf()).toEqual([[A, null, true]]);
    // 2026-10-13 Phase 5：在途的批評版不中止，跑完才輪到稱讚版（模型共呼叫兩次，仍只發一則 contest:comment）
    expect(commentator.calls.map((c) => [c.input.praise === true, c.signal.aborted])).toEqual([[false, false]]);
    asyncEffects = [];
    await commentCall(0, '只有你一個人畫也敢交？');
    expect(asyncEffects).toEqual([]);
    expect(commentator.calls.map((c) => [c.input.praise === true, c.signal.aborted])).toEqual([[false, false], [true, false]]);
    await commentCall(1, '只有你也算第一啦～');
    expect(commentUpdates(allAsync())).toEqual([{ roundNo: 1, playerId: A, comment: '只有你也算第一啦～' }]);
  });

  it('沒有人交卷：不重做、不呼叫模型，results 每筆 null／false', () => {
    toDrawing(2);
    clock.advance(DRAW_MS + SUBMIT_GRACE_MS + 1);
    expect(round()).toMatchObject({ phase: 'ended', commentMode: 'ai' });
    expect(round().results?.map((r) => [r.rank, r.submitted, r.comment, r.commentPending])).toEqual([
      [1, false, null, false],
      [2, false, null, false],
    ]);
    expect(commentator.calls).toHaveLength(0);
    expect(commentEmits(allAsync())).toEqual([]);
  });

  it('commentMode off（本回合已連續兩次失敗）：不重做，第一名維持原值', async () => {
    toDrawing(4);
    for (let i = 0; i < 4; i++) submitOk(`s${i + 1}`, i + 1);
    await judgeCall(0, 90);
    await commentCall(0, '揭曉前就有的批評版');
    await judgeCall(1, 80);
    await commentFail(1); // B 失敗（第一次）
    await judgeCall(2, 70);
    await commentFail(2); // C 失敗（連續第二次）→ 本回合 off
    await judgeCall(3, 60);
    expect(round()).toMatchObject({ phase: 'ended', commentMode: 'off' });
    expect(commentsOf()).toEqual([[A, '揭曉前就有的批評版', false], [B, null, false], [C, null, false], ['id7', null, false]]);
    expect(commentator.calls).toHaveLength(3);
    expect(commentator.calls.every((c) => c.input.praise === undefined)).toBe(true);
    asyncEffects = [];
    clock.advance(60_000);
    await flush();
    expect(asyncEffects).toEqual([]);
  });

  it('commentMode off（環境變數關閉）：不重做，第一名 null／false、沒有事件', async () => {
    room.dispose();
    room = makeRoom({ comment: { commentator: null, timeoutMs: COMMENT_TIMEOUT_MS } });
    asyncEffects = [];
    toDrawing(2);
    submitOk('s1', 1);
    submitOk('s2', 2);
    await judgeCall(0, 90);
    await judgeCall(1, 60);
    expect(round()).toMatchObject({ phase: 'ended', commentMode: 'off' });
    expect(commentsOf()).toEqual([[A, null, false], [B, null, false]]);
    expect(commentator.calls).toHaveLength(0);
    expect(commentEmits(allAsync())).toEqual([]);
  });

  it('稱讚版逾時：COMMENT_TIMEOUT_MS 從稱讚版開始產生時起算', async () => {
    toDrawing(2);
    submitOk('s1', 1);
    submitOk('s2', 2);
    await judgeCall(0, 90);
    clock.advance(COMMENT_TIMEOUT_MS - 1); // A 的批評版差 1 ms 逾時
    await judgeCall(1, 60); // 揭曉：A 第一名，批評版在途（不中止）
    expect(round().phase).toBe('ended');
    await commentCall(0, '壓線寫完的批評版'); // 稱讚版此刻才開始產生，逾時重新起算
    expect(commentator.calls[1].input.praise).toBe(true);
    asyncEffects = [];
    clock.advance(COMMENT_TIMEOUT_MS - 1);
    await flush();
    expect(asyncEffects).toEqual([]);
    expect(failures).toEqual([]);
    clock.advance(1);
    expect(commentator.calls[1].signal.aborted).toBe(true);
    await flush();
    // 2026-10-13 Phase 5：原本 A、B 都 null 並 round:update off；現在單次失敗只影響 A，且退回批評版
    expect(asyncEffects).toEqual([[{ kind: 'emit', to: 'all', event: 'contest:comment', payload: { roundNo: 1, playerId: A, comment: '壓線寫完的批評版' } }]]);
    expect(commentsOf()).toEqual([[A, '壓線寫完的批評版', false], [B, null, true]]);
    expect(failures).toEqual([{ playerId: A, reason: 'timeout', consecutive: 1, skipped: [], praise: true, fallback: 'criticism' }]);
    expect(round().commentMode).toBe('ai');
    expect(commentator.calls).toHaveLength(3); // B 的批評版照常開始
  });

  it('下一回合 drawing 開始：還沒輪到或產生中的稱讚版一併丟棄，不算失敗', async () => {
    await toEndedAllPending(2); // calls[0] = A 批評版產生中；B 的稱讚版排隊
    await commentCall(0, '給 A'); // 稱讚版開始產生（calls[1]）
    expect(commentator.calls[1].input.praise).toBe(true);
    ok(room.volunteer('s1'));
    asyncEffects = [];
    ok(room.setTopic('s1', '香蕉'));
    expect(commentator.calls[1].signal.aborted).toBe(true);
    await flush();
    expect(commentEmits(allAsync())).toEqual([]);
    expect(failures).toEqual([]);
    expect(round()).toMatchObject({ phase: 'drawing', roundNo: 2, results: null });
  });
});

// ─── 稱讚版失敗或被跳過 → 退回批評版 ───────────────────────────────

describe('§5 評語：稱讚版失敗或被跳過 → 退回批評版（Epic 15 Phase 5，Rex 2026-10-13）', () => {
  // 2026-10-13 Phase 5：原本「第一名最終 comment null（不退回）、同批收尾 round:update off」
  it('揭曉前已產生批評版、稱讚版失敗：第一名收到那句批評版（一則 contest:comment、同步寫進 results）；單次失敗不發 round:update', async () => {
    toDrawing(3);
    submitOk('s1', 1);
    await judgeCall(0, 90);
    await commentCall(0, '揭曉前就完成的批評版');
    submitOk('s2', 2);
    await judgeCall(1, 60);
    await commentCall(1, '給 B');
    submitOk('s3', 3);
    await judgeCall(2, 50); // C 的批評版產生中 → 揭曉
    expect(round().phase).toBe('ended');
    expect(commentsOf()).toEqual([[A, null, true], [B, '給 B', false], [C, null, true]]); // 揭曉時仍重設為 pending，批評版先不顯示
    await commentCall(2, '給 C');
    expect(commentator.calls[3].input).toMatchObject({ score: 90, praise: true });

    asyncEffects = [];
    await commentFail(3, new Error('模型掛了'));
    expect(asyncEffects).toEqual([
      [{ kind: 'emit', to: 'all', event: 'contest:comment', payload: { roundNo: 1, playerId: A, comment: '揭曉前就完成的批評版' } }],
    ]);
    expect(round()).toMatchObject({ phase: 'ended', commentMode: 'ai' });
    expect(commentsOf()).toEqual([[A, '揭曉前就完成的批評版', false], [B, '給 B', false], [C, '給 C', false]]);
    expect(commentsOf(joinOk('s4', 'Dave').data.snapshot.round)).toEqual([[A, '揭曉前就完成的批評版', false], [B, '給 B', false], [C, '給 C', false]]);
    expect(failures).toEqual([
      { playerId: A, reason: 'error', error: 'Error: 模型掛了', consecutive: 1, skipped: [], praise: true, fallback: 'criticism' },
    ]);
    expect(commentator.calls).toHaveLength(4); // 不補跑批評版
  });

  it('稱讚版輸出空白也算失敗 → 退回批評版', async () => {
    toDrawing(2);
    submitOk('s1', 1);
    await judgeCall(0, 90);
    await commentCall(0, '批評 A');
    submitOk('s2', 2);
    await judgeCall(1, 60);
    await commentCall(1, '批評 B');
    asyncEffects = [];
    await commentCall(2, '  ');
    expect(commentUpdates(allAsync())).toEqual([{ roundNo: 1, playerId: A, comment: '批評 A' }]);
    expect(failures).toEqual([{ playerId: A, reason: 'empty', consecutive: 1, skipped: [], praise: true, fallback: 'criticism' }]);
  });

  it('揭曉時批評版正在產生：跑完後存成退路（不發事件）；稱讚版失敗 → 第一名只收到一則，內容是那句批評版', async () => {
    toDrawing(2);
    submitOk('s1', 1);
    submitOk('s2', 2);
    await judgeCall(0, 90); // A：批評版產生中
    await judgeCall(1, 60); // 揭曉，A 第一名
    asyncEffects = [];
    await commentCall(0, '揭曉時還在寫的批評版');
    expect(asyncEffects).toEqual([]);
    await commentFail(1, new Error('模型忙'));
    expect(asyncEffects).toEqual([
      [{ kind: 'emit', to: 'all', event: 'contest:comment', payload: { roundNo: 1, playerId: A, comment: '揭曉時還在寫的批評版' } }],
    ]);
    expect(commentsOf()).toEqual([[A, '揭曉時還在寫的批評版', false], [B, null, true]]);
    expect(failures).toEqual([{ playerId: A, reason: 'error', error: 'Error: 模型忙', consecutive: 1, skipped: [], praise: true, fallback: 'criticism' }]);
    expect(round().commentMode).toBe('ai');
    await commentCall(2, '給 B'); // 其餘照常
    expect(commentsOf()).toEqual([[A, '揭曉時還在寫的批評版', false], [B, '給 B', false]]);
  });

  it('沒有批評版（原工作還在排隊就被稱讚版取代）：稱讚版失敗 → null，不補跑批評版', async () => {
    await toEndedAllPending(2); // A 產生中；第一名 B 的批評版還在排隊 → 被取代
    await commentCall(0, '給 A');
    asyncEffects = [];
    await commentFail(1);
    expect(commentUpdates(allAsync())).toEqual([{ roundNo: 1, playerId: B, comment: null }]);
    expect(eventsOf(allAsync())).toEqual(['contest:comment']);
    expect(commentsOf()).toEqual([[B, null, false], [A, '給 A', false]]);
    expect(failures).toEqual([{ playerId: B, reason: 'error', error: 'Error: boom', consecutive: 1, skipped: [], praise: true, fallback: null }]);
    expect(commentator.calls).toHaveLength(2);
    asyncEffects = [];
    clock.advance(10 * 60_000);
    await flush();
    expect(asyncEffects).toEqual([]);
  });

  it('沒有批評版（揭曉前批評版自己失敗過）：稱讚版再失敗 → null；兩次之間有成功所以不跳過', async () => {
    toDrawing(2);
    submitOk('s1', 1);
    await judgeCall(0, 90);
    await commentFail(0); // A 的批評版失敗（drawing，沒有事件）
    submitOk('s2', 2);
    await judgeCall(1, 60); // 揭曉：A 第一名（comment null／pending false → 仍重做稱讚版）
    expect(commentsOf()).toEqual([[A, null, true], [B, null, true]]);
    await commentCall(1, '給 B');
    asyncEffects = [];
    await commentFail(2);
    expect(commentUpdates(allAsync())).toEqual([{ roundNo: 1, playerId: A, comment: null }]);
    expect(eventsOf(allAsync())).toEqual(['contest:comment']);
    expect(failures.at(-1)).toMatchObject({ playerId: A, consecutive: 1, praise: true, fallback: null });
    expect(round().commentMode).toBe('ai');
  });

  it('揭曉時在途的批評版失敗（單次）：不發事件、第一名仍 pending 等稱讚版；稱讚版成功 → 稱讚句', async () => {
    toDrawing(2);
    submitOk('s1', 1);
    submitOk('s2', 2);
    await judgeCall(0, 90);
    await judgeCall(1, 60);
    asyncEffects = [];
    await commentFail(0);
    expect(asyncEffects).toEqual([]);
    expect(commentsOf()).toEqual([[A, null, true], [B, null, true]]);
    expect(failures).toEqual([{ playerId: A, reason: 'error', error: 'Error: boom', consecutive: 1, skipped: [] }]);
    expect(round().commentMode).toBe('ai');
    await commentCall(1, '哼，還不錯嘛～');
    expect(commentUpdates(allAsync())).toEqual([{ roundNo: 1, playerId: A, comment: '哼，還不錯嘛～' }]);
  });

  it('揭曉時在途的批評版失敗、稱讚版接著也失敗＝連續兩次：第一名一則 null（沒有退路），其餘 pending 各一則 null，再一則 round:update off', async () => {
    toDrawing(2);
    submitOk('s1', 1);
    submitOk('s2', 2);
    await judgeCall(0, 90);
    await judgeCall(1, 60);
    await commentFail(0);
    asyncEffects = [];
    await commentFail(1);
    expect(asyncEffects).toHaveLength(1);
    expect(eventsOf(asyncEffects[0])).toEqual(['contest:comment', 'contest:comment', 'round:update']);
    expect(commentUpdates(asyncEffects[0])).toEqual([
      { roundNo: 1, playerId: A, comment: null },
      { roundNo: 1, playerId: B, comment: null },
    ]);
    expect(rounds(asyncEffects[0])[0]).toMatchObject({ phase: 'ended', commentMode: 'off' });
    expect(failures.at(-1)).toEqual({ playerId: A, reason: 'error', error: 'Error: boom', consecutive: 2, skipped: [B], praise: true, fallback: null });
  });

  it('稱讚版被跳過（輪到之前別張造成連續第二次失敗）：帶揭曉前已產生的批評版；其餘 null；再一則 round:update off', async () => {
    toDrawing(3);
    submitOk('s1', 1);
    await judgeCall(0, 90);
    await commentCall(0, '批評 A'); // 第一名 A 的批評版：揭曉前已產生
    submitOk('s2', 2);
    await judgeCall(1, 60);
    await commentFail(1); // B 失敗（第一次；drawing 中，沒有事件）
    submitOk('s3', 3);
    await judgeCall(2, 50); // C 的批評版產生中 → 揭曉；A 的稱讚版排在它後面
    expect(round()).toMatchObject({ phase: 'ended', commentMode: 'ai' });
    expect(commentsOf()).toEqual([[A, null, true], [B, null, false], [C, null, true]]);

    asyncEffects = [];
    await commentFail(2); // C 失敗 → 連續第二次 → A 的稱讚版被跳過
    expect(asyncEffects).toHaveLength(1);
    expect(eventsOf(asyncEffects[0])).toEqual(['contest:comment', 'contest:comment', 'round:update']);
    expect(commentUpdates(asyncEffects[0])).toEqual([
      { roundNo: 1, playerId: C, comment: null },
      { roundNo: 1, playerId: A, comment: '批評 A' },
    ]);
    const updated = rounds(asyncEffects[0])[0];
    expect(updated).toMatchObject({ phase: 'ended', commentMode: 'off' });
    expect(commentsOf(updated)).toEqual([[A, '批評 A', false], [B, null, false], [C, null, false]]);
    expect(commentsOf()).toEqual([[A, '批評 A', false], [B, null, false], [C, null, false]]);
    expect(commentator.calls).toHaveLength(3); // 稱讚版沒有呼叫模型
    // 失敗的是 C 的批評版（不是稱讚版）：log 不帶 praise／fallback；被跳過的退回不另外記
    expect(failures.at(-1)).toEqual({ playerId: C, reason: 'error', error: 'Error: boom', consecutive: 2, skipped: [A] });
    expect(skips).toEqual([]);
  });

  it('稱讚版被跳過、沒有批評版（第一名的批評版還在排隊就被取代）：null', async () => {
    toDrawing(3);
    submitOk('s1', 1);
    await judgeCall(0, 50);
    await commentFail(0); // A 失敗（第一次；drawing）
    submitOk('s2', 2);
    submitOk('s3', 3);
    await judgeCall(1, 60); // B 的批評版產生中
    await judgeCall(2, 90); // C 排隊 → 揭曉，C 第一名：排隊中的批評版被稱讚版取代
    expect(commentsOf()).toEqual([[C, null, true], [B, null, true], [A, null, false]]);
    asyncEffects = [];
    await commentFail(1); // B 失敗 → 連續第二次 → C 的稱讚版被跳過
    expect(commentUpdates(allAsync())).toEqual([
      { roundNo: 1, playerId: B, comment: null },
      { roundNo: 1, playerId: C, comment: null },
    ]);
    expect(eventsOf(allAsync())).toEqual(['contest:comment', 'contest:comment', 'round:update']);
    expect(round().commentMode).toBe('off');
  });

  it('第一名在途的批評版是連續第二次失敗：他的稱讚版同批被跳過，但只發一則 contest:comment（null）', async () => {
    toDrawing(3);
    submitOk('s1', 1);
    submitOk('s2', 2);
    submitOk('s3', 3);
    await judgeCall(0, 50);
    await commentFail(0); // A 失敗（第一次；judging，沒有事件）
    await judgeCall(1, 90); // B 的批評版產生中
    await judgeCall(2, 60); // C 排隊 → 揭曉，B 第一名：在途的批評版不中止，稱讚版排它後面
    expect(commentsOf()).toEqual([[B, null, true], [C, null, true], [A, null, false]]);
    asyncEffects = [];
    await commentFail(1); // B 的批評版失敗 → 連續第二次：同批有 B 的兩筆（批評版失敗、稱讚版跳過）
    expect(asyncEffects).toHaveLength(1);
    expect(commentUpdates(asyncEffects[0])).toEqual([
      { roundNo: 1, playerId: B, comment: null },
      { roundNo: 1, playerId: C, comment: null },
    ]);
    expect(eventsOf(asyncEffects[0])).toEqual(['contest:comment', 'contest:comment', 'round:update']);
    expect(commentsOf()).toEqual([[B, null, false], [C, null, false], [A, null, false]]);
    expect(failures.at(-1)).toEqual({ playerId: B, reason: 'error', error: 'Error: boom', consecutive: 2, skipped: [B, C] });
    expect(commentator.calls).toHaveLength(2);
  });

  it('下一回合 choosing 期間稱讚版失敗：照樣退回批評版；進入 drawing 後退路與工作一併丟棄', async () => {
    toDrawing(2);
    submitOk('s1', 1);
    await judgeCall(0, 90);
    await commentCall(0, '批評 A');
    submitOk('s2', 2);
    await judgeCall(1, 60);
    await commentCall(1, '批評 B');
    ok(room.volunteer('s2'));
    asyncEffects = [];
    await commentFail(2);
    expect(eventsOf(allAsync())).toEqual(['contest:comment']);
    expect(commentUpdates(allAsync())).toEqual([{ roundNo: 1, playerId: A, comment: '批評 A' }]);
    expect(round()).toMatchObject({ phase: 'choosing', commentMode: null });
    expect(commentsOf()).toEqual([[A, '批評 A', false], [B, '批評 B', false]]);
  });

  it('ended 之後第一名離開：稱讚版失敗照樣退回批評版（已揭曉的紀錄保留）', async () => {
    toDrawing(2);
    submitOk('s1', 1);
    await judgeCall(0, 90);
    await commentCall(0, '批評 A');
    submitOk('s2', 2);
    await judgeCall(1, 60); // 揭曉；B 的批評版產生中
    room.disconnect('s1');
    clock.advance(GRACE_MS);
    expect(room.playerList().map((p) => p.id)).toEqual([B]);
    await commentCall(1, '批評 B');
    asyncEffects = [];
    await commentFail(2);
    expect(commentUpdates(allAsync())).toEqual([{ roundNo: 1, playerId: A, comment: '批評 A' }]);
  });
});

// ─── 丟棄 ─────────────────────────────────────────────────────────

describe('§5 評語：丟棄只發生在 drawing／judging 與換回合', () => {
  it('ended 之後離開的人：評語工作照常跑完並發 contest:comment（不留下永遠 pending 的卡片）', async () => {
    await toEndedAllPending(2);
    joinOk('s3', 'Carol'); // 讓房內仍有人在線
    room.disconnect('s1');
    room.disconnect('s2');
    clock.advance(GRACE_MS);
    expect(room.playerList().map((p) => p.id)).toEqual([C]);
    expect(commentator.calls[0].signal.aborted).toBe(false);
    expect(commentsOf()).toEqual([[B, null, true], [A, null, true]]);

    asyncEffects = [];
    await commentCall(0, '人都走了還想聽評語？');
    await commentCall(1, '哼～'); // 第一名 B 的稱讚版：人走了也照樣補上
    expect(commentUpdates(allAsync())).toEqual([
      { roundNo: 1, playerId: A, comment: '人都走了還想聽評語？' },
      { roundNo: 1, playerId: B, comment: '哼～' },
    ]);
    expect(commentsOf()).toEqual([[B, '哼～', false], [A, '人都走了還想聽評語？', false]]);
    expect(commentsOf(joinOk('s4', 'Dave').data.snapshot.round)).toEqual([[B, '哼～', false], [A, '人都走了還想聽評語？', false]]);
  });

  it('judging 中參賽者寬限期滿離開：評語工作一併丟棄（產生中的中止、排隊中的移除），不算失敗', async () => {
    toDrawing(3);
    submitOk('s1', 1);
    submitOk('s2', 2);
    submitOk('s3', 3);
    await judgeCall(0, 90); // A 評語產生中
    await judgeCall(1, 80); // B 評語排隊
    room.disconnect('s2'); // B 先離開（排隊中的移除），A 後離開（產生中的中止）
    room.disconnect('s1');
    clock.advance(GRACE_MS);
    expect(commentator.calls[0].signal.aborted).toBe(true);
    await flush();
    expect(failures).toEqual([]);
    expect(round()).toMatchObject({ phase: 'judging', participantIds: [C], commentMode: 'ai' });
    expect(commentator.calls).toHaveLength(1); // B 沒被呼叫

    await judgeCall(2, 70);
    expect(round().phase).toBe('ended');
    expect(commentsOf()).toEqual([[C, null, true]]);
    // C 評完 → 批評版開始產生（calls[1]）→ 同一刻揭曉、C 是唯一的參賽者＝第一名
    // → 2026-10-13 Phase 5：批評版不中止、跑完（不發事件）才輪到稱讚版（calls[2]）
    expect(commentator.calls).toHaveLength(2);
    expect(commentator.calls[1].input.score).toBe(70);
    expect(commentator.calls[1].signal.aborted).toBe(false);
    asyncEffects = [];
    commentator.calls[0].resolve('太晚了'); // 被丟棄的那張就算回來也忽略
    await commentCall(1, 'C 的批評版');
    expect(asyncEffects).toEqual([]);
    expect(commentator.calls[2].input).toMatchObject({ score: 70, praise: true });
    await commentCall(2, '只剩你了呢');
    expect(commentUpdates(allAsync())).toEqual([{ roundNo: 1, playerId: C, comment: '只剩你了呢' }]);
    expect(failures).toEqual([]);
  });

  it('drawing 中已評分的參賽者離開：評語工作丟棄，之後不進 results', async () => {
    toDrawing(3);
    submitOk('s1', 1);
    await judgeCall(0, 50);
    room.disconnect('s1');
    clock.advance(GRACE_MS);
    expect(commentator.calls[0].signal.aborted).toBe(true);
    submitOk('s2', 2);
    submitOk('s3', 3);
    await judgeCall(1, 40);
    await judgeCall(2, 30);
    expect(round().phase).toBe('ended');
    expect(commentsOf().map(([id]) => id)).toEqual([B, C]);
    expect(failures).toEqual([]);
  });

  it('進入新回合 drawing：丟棄上回合所有未完成的評語工作；中止在途的那張不算失敗，新回合從 ai 開始', async () => {
    await toEndedAllPending(2);
    ok(room.volunteer('s2'));
    expect(commentator.calls[0].signal.aborted).toBe(false);
    asyncEffects = [];
    ok(room.setTopic('s2', '香蕉'));
    expect(commentator.calls[0].signal.aborted).toBe(true);
    await flush();
    commentator.calls[0].resolve('上回合的');
    await flush();
    expect(commentEmits(allAsync())).toEqual([]);
    expect(failures).toEqual([]);
    expect(round()).toMatchObject({ phase: 'drawing', roundNo: 2, results: null, commentMode: null });

    submitOk('s1', 3);
    const r = submitOk('s2', 4);
    expect(rounds(r.effects).at(-1)).toMatchObject({ phase: 'judging', commentMode: 'ai' });
    await judgeCall(2, 55);
    expect(commentator.calls).toHaveLength(2); // 上回合排隊中的那張（第一名 B 的稱讚版）從未被呼叫
    expect(commentator.calls[1].input).toMatchObject({ topic: '香蕉', score: 55 });
    expect(commentator.calls[1].input.praise).toBeUndefined();
    await judgeCall(3, 45);
    // 新回合揭曉：A 第一名，他產生中的批評版（calls[1]）跑完（2026-10-13 Phase 5：不中止、不發事件）才輪到稱讚版（calls[2]）
    expect(commentator.calls[1].signal.aborted).toBe(false);
    await commentCall(1, '新回合的批評版');
    expect(commentEmits(allAsync())).toEqual([]);
    expect(commentator.calls[2].input).toMatchObject({ topic: '香蕉', score: 55, praise: true });
    await commentCall(2, '新回合');
    expect(commentUpdates(allAsync())).toEqual([{ roundNo: 2, playerId: A, comment: '新回合' }]);
    expect(failures).toEqual([]);
  });

  it('dispose：中止產生中的評語、清掉逾時計時器', async () => {
    await toEndedAllPending(2);
    room.dispose();
    await flush();
    expect(commentator.calls[0].signal.aborted).toBe(true);
    expect(clock.timers.size).toBe(0);
  });
});

// ─── 關閉 ─────────────────────────────────────────────────────────

describe('§5 評語：COMMENT=off', () => {
  async function playOff(r: Room): Promise<Effect[]> {
    room.dispose();
    room = r;
    asyncEffects = [];
    toDrawing(3);
    submitOk('s1', 1);
    const fx = submitOk('s2', 2).effects;
    await judgeCall(0, 90);
    await judgeCall(1, 80);
    clock.advance(DRAW_MS + SUBMIT_GRACE_MS + 1);
    return fx;
  }

  it('不排佇列、commentMode off、所有人 commentPending false、不發 contest:comment', async () => {
    const spy = vi.fn();
    await playOff(makeRoom({ comment: { commentator: null, timeoutMs: COMMENT_TIMEOUT_MS }, onCommentSkip: spy, onCommentFailure: spy }));
    expect(rounds(allAsync()).filter((r) => r.phase === 'judging').every((r) => r.commentMode === 'off')).toBe(true);
    expect(round()).toMatchObject({ phase: 'ended', commentMode: 'off', judgeMode: 'ai' });
    expect(commentsOf()).toEqual([[A, null, false], [B, null, false], [C, null, false]]);
    clock.advance(10 * 60_000);
    await flush();
    expect(commentEmits(allAsync())).toEqual([]);
    expect(commentator.calls).toHaveLength(0);
    expect(spy).not.toHaveBeenCalled();
    expect(commentsOf(joinOk('s4', 'Dave').data.snapshot.round)).toEqual([[A, null, false], [B, null, false], [C, null, false]]);
  });

  it('Room 未注入評語器時預設關閉（不呼叫任何模型）', async () => {
    await playOff(makeRoom({ comment: undefined }));
    expect(round()).toMatchObject({ phase: 'ended', commentMode: 'off' });
    expect(commentsOf().every(([, comment, pending]) => comment === null && pending === false)).toBe(true);
    expect(commentEmits(allAsync())).toEqual([]);
  });

  it('關閉時 idle／choosing／drawing 仍為 null（judging 起才是 off）', () => {
    room.dispose();
    room = makeRoom({ comment: { commentator: null, timeoutMs: COMMENT_TIMEOUT_MS } });
    joinOk('s1', 'Alice');
    joinOk('s2', 'Bob');
    expect(round().commentMode).toBeNull();
    ok(room.volunteer('s1'));
    expect(round().commentMode).toBeNull();
    ok(room.setTopic('s1', '蘋果'));
    expect(round().commentMode).toBeNull();
    clock.advance(DRAW_MS);
    expect(round()).toMatchObject({ phase: 'judging', commentMode: 'off' });
  });
});
