// 繪圖比賽評語 e2e（Epic 15）：起真正的 server（隨機埠），以 socket.io-client 打 /draw-contest，
// 評語器連 user/mock/systemone.mjs 的 /api/chat（spec/draw-contest/architecture.md §5「評語」、§6.1、§8：不得打到真模型）。
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import {
  DRAW_CONTEST_NAMESPACE,
  type Ack,
  type ClientToServerEvents,
  type CommentUpdate,
  type JoinResult,
  type RoundPublic,
  type ServerToClientEvents,
} from '@fishing-work/shared/draw-contest';
import { createApp, type App, type AppOptions } from '../src/app';
import { createCommentSetup, readCommentConfig } from '../src/games/draw-contest/commentary/index';
import { buildChatRequest, buildWarmupRequest, createOllamaCommentator } from '../src/games/draw-contest/commentary/ollamaChat';
import { createRandomJudge, randomScore } from '../src/games/draw-contest/judge/random';
import { makePng } from './helpers/drawContest';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface MockOllama {
  url: string;
  close(): Promise<void>;
  requests: Array<{ method: string; path: string; body?: unknown }>;
}
type StartMock = (options?: { chatDelayMs?: number; chatContent?: string; praiseContent?: string; commentModel?: string }) => Promise<MockOllama>;

const MODEL = 'gemma4:26b-mlx-bf16';
const mockPath = new URL('../../user/mock/systemone.mjs', import.meta.url).href;
let startMockOllama: StartMock;
let MOCK_COMMENTS: string[];
let MOCK_PRAISES: string[];

let app: App | null = null;
let mock: MockOllama | null = null;
const sockets: ClientSocket[] = [];
let base = '';

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  ({ startMockOllama, MOCK_COMMENTS, MOCK_PRAISES } = (await import(mockPath)) as { startMockOllama: StartMock; MOCK_COMMENTS: string[]; MOCK_PRAISES: string[] });
});

afterEach(async () => {
  for (const s of sockets.splice(0)) s.disconnect();
  await app?.close();
  app = null;
  await mock?.close();
  mock = null;
});

/** 起 server：評分器為無延遲 random；評語器依設定連假 Ollama（等暖機結束再回傳，請求順序才固定） */
async function start(mockOptions: Parameters<StartMock>[0], options: AppOptions = {}): Promise<void> {
  mock = await startMockOllama(mockOptions);
  const config = readCommentConfig({ COMMENT: 'ollama', OLLAMA_URL: mock.url, COMMENT_MODEL: MODEL, COMMENT_TIMEOUT_MS: '2000' }, () => {});
  const comment = createCommentSetup(config, { warn: () => {}, info: () => {} });
  await comment.warmup;
  const random = createRandomJudge({ delayMs: 0 });
  app = createApp({ port: 0, host: '127.0.0.1', judge: { judge: random, fallback: random, timeoutMs: 1000 }, comment, ...options });
  const { port } = await app.listen();
  base = `http://127.0.0.1:${port}`;
}

async function connect(): Promise<ClientSocket> {
  const s: ClientSocket = io(`${base}${DRAW_CONTEST_NAMESPACE}`, { transports: ['websocket'], forceNew: true, reconnection: false });
  sockets.push(s);
  await new Promise<void>((resolve, reject) => {
    s.once('connect', () => resolve());
    s.once('connect_error', reject);
  });
  return s;
}

function request<T = void>(s: ClientSocket, event: string, ...payload: unknown[]): Promise<Ack<T>> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), 3000);
    (s.emit as unknown as (ev: string, ...a: unknown[]) => void)(event, ...payload, (r: Ack<T>) => {
      clearTimeout(t);
      resolve(r);
    });
  });
}

async function joinOk(s: ClientSocket, nickname: string): Promise<JoinResult> {
  const r = await request<JoinResult>(s, 'player:join', { nickname });
  if (!r.ok) throw new Error(`join 失敗：${r.error}`);
  return r.data;
}

function collect<T>(s: ClientSocket, event: string): T[] {
  const out: T[] = [];
  (s.on as unknown as (ev: string, fn: (p: T) => void) => void)(event, (p: T) => out.push(p));
  return out;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, ms = 3000, label = 'condition'): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`waitFor timeout: ${label}`);
    await sleep(10);
  }
}

/** random 評分器在題目「蘋果」下分數較低／較高的兩張圖（確定性：分數只看圖與題目） */
function lowHighPngs(): { low: Uint8Array; high: Uint8Array } {
  const scored = [1, 2, 3, 4, 5, 6].map((seed) => ({ png: makePng(seed), score: randomScore(makePng(seed), '蘋果').score }));
  scored.sort((x, y) => x.score - y.score);
  const low = scored[0];
  const high = scored.at(-1)!;
  if (low.score === high.score) throw new Error('測試圖的分數都一樣，無法決定第一名');
  return { low: low.png, high: high.png };
}

/**
 * 兩人加入、A 出題「蘋果」、A 先交卷再換 B；回傳兩人的 id 與收集器。
 * winner 決定誰拿高分那張圖：預設 'second'（B 第一名：他的批評版還在排隊就被稱讚版取代，假 Ollama 收到的請求順序固定）；
 * 'first'（A 第一名：他的批評版正在產生，揭曉時被中止）。
 */
async function playRound(winner: 'first' | 'second' = 'second') {
  const A = await connect();
  const B = await connect();
  const a = (await joinOk(A, 'Alice')).snapshot.you;
  const b = (await joinOk(B, 'Bob')).snapshot.you;
  const roundsA = collect<RoundPublic>(A, 'round:update');
  const commentsA = collect<CommentUpdate>(A, 'contest:comment');
  const commentsB = collect<CommentUpdate>(B, 'contest:comment');
  await request(A, 'round:volunteer');
  await request(A, 'round:setTopic', { topic: '蘋果' });
  const { low, high } = lowHighPngs();
  const pngA = winner === 'first' ? high : low;
  const pngB = winner === 'first' ? low : high;
  expect(await request(A, 'contest:submit', { png: pngA })).toMatchObject({ ok: true });
  expect(await request(B, 'contest:submit', { png: pngB })).toMatchObject({ ok: true });
  await waitFor(() => roundsA.at(-1)?.phase === 'ended', 3000, 'ended');
  return { A, B, a, b, roundsA, commentsA, commentsB, pngA, pngB };
}

describe('e2e /draw-contest 評語（假 Ollama /api/chat）', () => {
  it('交卷 → 揭曉（不等評語）→ 每張一則 contest:comment；第一名是稱讚版；請求帶原圖、題目、分數與 think false；中途加入者快照帶 comment', async () => {
    await start({ chatDelayMs: 150 });
    const t0 = Date.now();
    const { a, b, roundsA, commentsA, commentsB, pngA, pngB } = await playRound();
    // 揭曉不等評語：每張至少要 150 ms，兩張排隊共 300 ms 以上，ended 早就到了
    const ended = roundsA.at(-1) as RoundPublic;
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(ended.commentMode).toBe('ai');
    expect(roundsA.filter((r) => r.phase === 'judging').every((r) => r.commentMode === 'ai')).toBe(true);
    expect(ended.results?.map((r) => [r.comment, r.commentPending])).toEqual([[null, true], [null, true]]);

    await waitFor(() => commentsA.length === 2 && commentsB.length === 2, 3000, 'contest:comment');
    expect(commentsA).toEqual(commentsB);
    expect(commentsA.map((c) => c.playerId).sort()).toEqual([a, b].sort());
    // 第一名（B）拿到稱讚句、A 拿到批評句；兩組句子沒有交集
    expect(ended.results?.map((r) => r.playerId)).toEqual([b, a]);
    for (const c of commentsA) expect(c.roundNo).toBe(1);
    expect(MOCK_PRAISES).toContain(commentsA.find((c) => c.playerId === b)?.comment);
    expect(MOCK_COMMENTS).toContain(commentsA.find((c) => c.playerId === a)?.comment);

    // 假 Ollama 收到：探測、暖機（不帶圖）、A 的批評版、B 的稱讚版（原圖、題目、最終分數；逐欄位同 buildChatRequest）。
    // B 原本排隊中的批評版被取代，模型只為他跑一次
    const chats = (mock as MockOllama).requests.filter((r) => r.path === '/api/chat').map((r) => r.body);
    expect(chats[0]).toEqual(buildWarmupRequest(MODEL));
    const expected = [
      buildChatRequest(MODEL, '蘋果', randomScore(pngA, '蘋果').score, Buffer.from(pngA).toString('base64')),
      buildChatRequest(MODEL, '蘋果', randomScore(pngB, '蘋果').score, Buffer.from(pngB).toString('base64'), true),
    ];
    expect(chats.slice(1)).toEqual(expected);

    // 中途加入：快照的 results 帶已產生的評語，不再 pending
    const C = await connect();
    const lateComments = collect<CommentUpdate>(C, 'contest:comment');
    const snap = (await joinOk(C, 'Carol')).snapshot.round;
    expect(snap.commentMode).toBe('ai');
    for (const r of snap.results ?? []) {
      expect(r.commentPending).toBe(false);
      expect(r.comment).toBe(commentsA.find((c) => c.playerId === r.playerId)?.comment);
    }
    await sleep(100);
    expect(lateComments).toEqual([]);
  });

  it('評語還在產生時加入：快照 commentPending true，之後收到 contest:comment', async () => {
    await start({ chatDelayMs: 300 });
    const { a, b } = await playRound();
    const C = await connect();
    const lateComments = collect<CommentUpdate>(C, 'contest:comment');
    const snap = (await joinOk(C, 'Carol')).snapshot.round;
    expect(snap.results?.map((r) => r.commentPending)).toEqual([true, true]);
    await waitFor(() => lateComments.length === 2, 3000, 'late contest:comment');
    expect(lateComments.map((c) => c.playerId).sort()).toEqual([a, b].sort());
    expect(lateComments.every((c) => typeof c.comment === 'string' && c.comment.length > 0)).toBe(true);
  });

  it('第一名的批評版正在產生時揭曉：中止它、改跑稱讚版；兩人最終各一則評語（第一名稱讚句、另一人批評句）', async () => {
    await start({ chatDelayMs: 150 });
    const { a, b, roundsA, commentsA } = await playRound('first');
    const ended = roundsA.at(-1) as RoundPublic;
    expect(ended.results?.map((r) => [r.playerId, r.comment, r.commentPending])).toEqual([[a, null, true], [b, null, true]]);
    await waitFor(() => commentsA.length === 2, 3000, 'contest:comment');
    await sleep(400); // 被中止的那張不會再冒出事件
    expect(commentsA).toHaveLength(2);
    expect(MOCK_PRAISES).toContain(commentsA.find((c) => c.playerId === a)?.comment);
    expect(MOCK_COMMENTS).toContain(commentsA.find((c) => c.playerId === b)?.comment);
    expect(roundsA.at(-1)).toBe(ended); // 中止不算失敗：沒有多出 commentMode off 的 round:update
    const praises = (mock as MockOllama).requests.filter((r) => r.path === '/api/chat' && JSON.stringify(r.body).includes('第一名'));
    expect(praises).toHaveLength(1);
  });

  it('只有第一名的稱讚版失敗（輸出空白）：其他人的評語照常，第一名收到 contest:comment null，再一則 round:update commentMode off', async () => {
    await start({ chatDelayMs: 150, praiseContent: '' });
    const { a, b, roundsA, commentsA } = await playRound();
    const endedIndex = roundsA.length - 1;
    await waitFor(() => commentsA.length === 2 && roundsA.at(-1)?.commentMode === 'off', 3000, 'praise failure');
    expect(MOCK_COMMENTS).toContain(commentsA.find((c) => c.playerId === a)?.comment);
    expect(commentsA.find((c) => c.playerId === b)?.comment).toBeNull();
    expect(roundsA).toHaveLength(endedIndex + 2);
    expect(roundsA.at(-1)?.results?.map((r) => [r.playerId, r.comment === null, r.commentPending])).toEqual([[b, true, false], [a, false, false]]);
  });

  it('失敗在 ended 之後（模型輸出空白）：每張 pending 各一則 contest:comment null，再一則 round:update commentMode off；只呼叫模型一次', async () => {
    await start({ chatDelayMs: 150, chatContent: '   ' });
    const { roundsA, commentsA } = await playRound();
    const endedIndex = roundsA.length - 1;
    await waitFor(() => commentsA.length === 2 && roundsA.at(-1)?.commentMode === 'off', 3000, 'failure events');
    expect(commentsA.map((c) => c.comment)).toEqual([null, null]);
    expect(roundsA).toHaveLength(endedIndex + 2);
    expect(roundsA.at(-1)).toMatchObject({ phase: 'ended', commentMode: 'off' });
    expect(roundsA.at(-1)?.results?.map((r) => [r.comment, r.commentPending])).toEqual([[null, false], [null, false]]);
    // 暖機一次＋評語一次（第二張直接跳過）
    expect((mock as MockOllama).requests.filter((r) => r.path === '/api/chat')).toHaveLength(2);
  });

  it('逾時（COMMENT_TIMEOUT_MS 小值、假 Ollama 延遲 5 秒）：有界，逾時後同樣收尾', async () => {
    // 只取評語器、不經 createCommentSetup：它的暖機會先被 5 秒延遲卡住
    mock = await startMockOllama({ chatDelayMs: 5000 });
    const random = createRandomJudge({ delayMs: 0 });
    app = createApp({
      port: 0,
      host: '127.0.0.1',
      judge: { judge: random, fallback: random, timeoutMs: 1000 },
      comment: { commentator: createOllamaCommentator({ url: mock.url, model: MODEL }), timeoutMs: 100 },
    });
    base = `http://127.0.0.1:${(await app.listen()).port}`;
    const t0 = Date.now();
    const { roundsA, commentsA } = await playRound();
    await waitFor(() => commentsA.length === 2 && roundsA.at(-1)?.commentMode === 'off', 3000, 'timeout events');
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(commentsA.map((c) => c.comment)).toEqual([null, null]);
    expect(mock.requests.filter((r) => r.path === '/api/chat')).toHaveLength(1);
  });

  it('COMMENT=off（注入關閉的評語器）：commentMode off、沒有 pending、沒有 contest:comment、不碰 Ollama', async () => {
    mock = await startMockOllama({});
    const random = createRandomJudge({ delayMs: 0 });
    const comment = createCommentSetup(readCommentConfig({ COMMENT: 'off', OLLAMA_URL: mock.url }, () => {}), { warn: () => {}, info: () => {} });
    app = createApp({ port: 0, host: '127.0.0.1', judge: { judge: random, fallback: random, timeoutMs: 1000 }, comment });
    base = `http://127.0.0.1:${(await app.listen()).port}`;
    const { roundsA, commentsA, commentsB } = await playRound();
    expect(roundsA.filter((r) => r.phase === 'judging' || r.phase === 'ended').every((r) => r.commentMode === 'off')).toBe(true);
    expect(roundsA.at(-1)?.results?.map((r) => [r.comment, r.commentPending])).toEqual([[null, false], [null, false]]);
    await sleep(200);
    expect(commentsA).toEqual([]);
    expect(commentsB).toEqual([]);
    expect(mock.requests).toEqual([]);
  });
});
