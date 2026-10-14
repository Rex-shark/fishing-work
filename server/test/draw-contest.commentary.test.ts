// 評語器（Epic 15）：spec/draw-contest/architecture.md §3「評分器環境變數」、§6.1（ollamaChat、佇列、index）
// 對 user/mock/systemone.mjs 的 /api/chat 或注入的 fetch 測，不連真模型（§8）。
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { COMMENT_PERSONA_NAME } from '@fishing-work/shared/draw-contest';
import { createApp } from '../src/app';
import {
  DEFAULT_COMMENT_CONFIG,
  commentSetupFromEnv,
  createCommentSetup,
  readCommentConfig,
} from '../src/games/draw-contest/commentary/index';
import {
  COMMENT_SYSTEM_PROMPT,
  buildChatRequest,
  buildWarmupRequest,
  cleanComment,
  commentUserPrompt,
  createOllamaCommentator,
  parseChatResponse,
  praiseUserPrompt,
  warmupChat,
  type ChatRequest,
} from '../src/games/draw-contest/commentary/ollamaChat';
import {
  CommentQueue,
  type CommentDone,
  type CommentFailureInfo,
  type CommentJob,
  type Commentator,
} from '../src/games/draw-contest/commentary/queue';
import type { FetchLike } from '../src/games/draw-contest/judge/ollama';
import { silenceLogs } from './e2e/helpers';
import { FakeClock } from './helpers/fakeClock';
import { FnCommentator, ManualCommentator, flush, makePng } from './helpers/drawContest';

interface MockOllama {
  url: string;
  port: number;
  close(): Promise<void>;
  requests: Array<{ method: string; path: string; body?: unknown }>;
}
type StartMock = (options?: {
  delayMs?: number;
  model?: string;
  commentModel?: string;
  chatDelayMs?: number;
  chatContent?: string;
  praiseContent?: string;
}) => Promise<MockOllama>;

const MODEL = 'gemma4:26b-mlx-bf16';
const mockPath = new URL('../../user/mock/systemone.mjs', import.meta.url).href;
let startMockOllama: StartMock;
let MOCK_COMMENTS: string[];
let MOCK_PRAISES: string[];

beforeAll(async () => {
  ({ startMockOllama, MOCK_COMMENTS, MOCK_PRAISES } = (await import(mockPath)) as { startMockOllama: StartMock; MOCK_COMMENTS: string[]; MOCK_PRAISES: string[] });
});

const mocks: MockOllama[] = [];
async function mock(options: Parameters<StartMock>[0] = {}): Promise<MockOllama> {
  const m = await startMockOllama(options);
  mocks.push(m);
  return m;
}
afterEach(async () => {
  while (mocks.length > 0) await mocks.pop()!.close();
  vi.restoreAllMocks();
});

const signal = () => new AbortController().signal;
const png = (seed = 0): Buffer => Buffer.from(makePng(seed));
const jsonResponse = (status: number, body: unknown) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
/** 真 Ollama 0.40.3 的 /api/chat 回應形狀（stream: false） */
const chatResponse = (content: string) => ({
  model: MODEL,
  created_at: '2026-10-12T02:00:00.000Z',
  message: { role: 'assistant', content },
  done: true,
  done_reason: 'stop',
  total_duration: 1_900_000_000,
  load_duration: 80_000_000,
  prompt_eval_count: 600,
  eval_count: 21,
});

// ─── ollamaChat：請求 ─────────────────────────────────────────────

describe('§6.1 請求格式', () => {
  it('評審名稱唯一來源：COMMENT_PERSONA_NAME = メスガキ', () => {
    expect(COMMENT_PERSONA_NAME).toBe('メスガキ');
  });

  it('system／user 提示詞逐字（§6.1）；只有人設一句＋兩條規則', () => {
    expect(COMMENT_SYSTEM_PROMPT).toBe('你是メスガキ，繪圖比賽的評審。規則只有兩條：用繁體中文（台灣用語）；一句話，40 字內。');
    expect(commentUserPrompt('蘋果', 78)).toBe('題目「蘋果」，評分 78 分。這是參賽者的畫，給一句評語。');
    expect(commentUserPrompt('a cat', 0)).toBe('題目「a cat」，評分 0 分。這是參賽者的畫，給一句評語。');
  });

  it('buildChatRequest：逐欄位（model、stream false、think false、keep_alive 30m、messages、options）', () => {
    const body = buildChatRequest(MODEL, '蘋果', 78, 'AAAA');
    expect(body).toEqual({
      model: MODEL,
      stream: false,
      think: false,
      keep_alive: '30m',
      messages: [
        { role: 'system', content: '你是メスガキ，繪圖比賽的評審。規則只有兩條：用繁體中文（台灣用語）；一句話，40 字內。' },
        { role: 'user', content: '題目「蘋果」，評分 78 分。這是參賽者的畫，給一句評語。', images: ['AAAA'] },
      ],
      options: { temperature: 0.9, num_predict: 80 },
    });
    expect(Object.keys(body).sort()).toEqual(['keep_alive', 'messages', 'model', 'options', 'stream', 'think']);
    // think 是 false 而不是缺省：gemma4 預設思考會把 num_predict 全吃掉（plan 踩雷紀錄）
    expect(body.think).toBe(false);
    expect(body.stream).toBe(false);
  });

  it('不給暱稱與名次、不加禁詞與範例句：請求全文只出現人設、兩條規則、題目與分數', () => {
    const text = JSON.stringify(buildChatRequest(MODEL, '蘋果', 78, 'AAAA').messages.map((m) => m.content));
    expect(text).not.toMatch(/暱稱|名次|第.名|rank|範例|例如|不要|不可|禁止/);
  });

  it('第一名稱讚版（Phase 4）：user 文案逐字（§6.1）；system、圖片與其餘參數都不變', () => {
    expect(praiseUserPrompt('蘋果', 78)).toBe('題目「蘋果」，評分 78 分，這張是本回合第一名。妳不甘心，但還是得承認它畫得好，用雌小鬼的口氣誇它，一句評語。');
    const normal = buildChatRequest(MODEL, '蘋果', 78, 'AAAA');
    const praise = buildChatRequest(MODEL, '蘋果', 78, 'AAAA', true);
    expect(praise).toEqual({
      model: MODEL,
      stream: false,
      think: false,
      keep_alive: '30m',
      messages: [
        { role: 'system', content: '你是メスガキ，繪圖比賽的評審。規則只有兩條：用繁體中文（台灣用語）；一句話，40 字內。' },
        { role: 'user', content: '題目「蘋果」，評分 78 分，這張是本回合第一名。妳不甘心，但還是得承認它畫得好，用雌小鬼的口氣誇它，一句評語。', images: ['AAAA'] },
      ],
      options: { temperature: 0.9, num_predict: 80 },
    });
    // 只差 user 文案那一格
    expect({ ...praise, messages: [praise.messages[0], { ...praise.messages[1], content: normal.messages[1].content }] }).toEqual(normal);
    expect(buildChatRequest(MODEL, '蘋果', 78, 'AAAA', false)).toEqual(normal);
    // 「第一名」只出現在稱讚版（一般版不給名次）；兩版都不給暱稱
    expect(normal.messages[1].content).not.toContain('第一名');
    expect(JSON.stringify(praise.messages.map((m) => m.content))).not.toMatch(/暱稱|rank/);
  });

  it('評語器依 input.praise 選文案：true → 稱讚版（假 Ollama 回稱讚句），沒帶或 false → 一般版；onCommented 回報 praise', async () => {
    const m = await mock();
    const onCommented = vi.fn();
    const commentator = createOllamaCommentator({ url: m.url, model: MODEL, onCommented });
    const image = png(3);
    const critique = await commentator.comment({ png: image, topic: '蘋果', score: 78 }, signal());
    const praise = await commentator.comment({ png: image, topic: '蘋果', score: 78, praise: true }, signal());
    const explicitFalse = await commentator.comment({ png: image, topic: '蘋果', score: 78, praise: false }, signal());
    expect(MOCK_COMMENTS).toContain(critique);
    expect(MOCK_PRAISES).toContain(praise);
    expect(explicitFalse).toBe(critique);
    expect(MOCK_COMMENTS.filter((c) => MOCK_PRAISES.includes(c))).toEqual([]); // 兩組句子沒有交集
    const bodies = m.requests.map((r) => r.body as ChatRequest);
    expect(bodies[0]).toEqual(buildChatRequest(MODEL, '蘋果', 78, image.toString('base64')));
    expect(bodies[1]).toEqual(buildChatRequest(MODEL, '蘋果', 78, image.toString('base64'), true));
    expect(bodies[2]).toEqual(bodies[0]);
    expect(onCommented.mock.calls.map((c) => [c[0].praise, c[0].comment])).toEqual([
      [false, critique],
      [true, praise],
      [false, critique],
    ]);
  });

  it('假 Ollama 的固定內容：MOCK_CHAT_CONTENT 不分批評／稱讚；MOCK_PRAISE_CONTENT 只換稱讚版（優先）', async () => {
    const fixed = await mock({ chatContent: '固定句' });
    const c1 = createOllamaCommentator({ url: fixed.url, model: MODEL });
    expect(await c1.comment({ png: png(1), topic: 't', score: 1 }, signal())).toBe('固定句');
    expect(await c1.comment({ png: png(1), topic: 't', score: 1, praise: true }, signal())).toBe('固定句');
    const praiseOnly = await mock({ chatContent: '固定句', praiseContent: '' });
    const c2 = createOllamaCommentator({ url: praiseOnly.url, model: MODEL });
    expect(await c2.comment({ png: png(1), topic: 't', score: 1 }, signal())).toBe('固定句');
    expect(await c2.comment({ png: png(1), topic: 't', score: 1, praise: true }, signal())).toBe('');
  });

  it('暖機請求：不帶圖的極短 chat、keep_alive 30m、同樣關思考', () => {
    expect(buildWarmupRequest(MODEL)).toEqual({
      model: MODEL,
      stream: false,
      think: false,
      keep_alive: '30m',
      messages: [{ role: 'user', content: '嗨' }],
      options: { num_predict: 1 },
    });
  });

  it('對假 Ollama 送出：POST /api/chat、圖片為交卷原 PNG 的 base64（不縮圖）、回傳固定句之一', async () => {
    const m = await mock();
    const onCommented = vi.fn();
    const commentator = createOllamaCommentator({ url: `${m.url}/`, model: MODEL, onCommented });
    const image = png(3);
    const out = await commentator.comment({ png: image, topic: '蘋果', score: 78 }, signal());
    expect(MOCK_COMMENTS).toContain(out);
    expect(m.requests).toHaveLength(1);
    const req = m.requests[0];
    expect([req.method, req.path]).toEqual(['POST', '/api/chat']);
    const body = req.body as ChatRequest;
    expect(body).toEqual(buildChatRequest(MODEL, '蘋果', 78, image.toString('base64')));
    expect(Buffer.from(body.messages[1].images![0], 'base64').equals(Buffer.from(makePng(3)))).toBe(true);
    // 同一張圖永遠同一句
    expect(await commentator.comment({ png: png(3), topic: '香蕉', score: 5 }, signal())).toBe(out);
    expect(onCommented).toHaveBeenCalledWith(
      expect.objectContaining({ topic: '蘋果', score: 78, praise: false, comment: out, chars: [...out].length, promptTokens: expect.any(Number), evalTokens: expect.any(Number) }),
    );
  });
});

// ─── ollamaChat：回應與後處理 ─────────────────────────────────────

describe('§6.1 回應解析與後處理', () => {
  it('parseChatResponse：取 message.content；不是物件、缺 message、content 不是字串 → throw', () => {
    expect(parseChatResponse(chatResponse('就這？'))).toBe('就這？');
    expect(parseChatResponse({ message: { role: 'assistant', content: '' } })).toBe('');
    expect(() => parseChatResponse(null)).toThrow();
    expect(() => parseChatResponse('text')).toThrow();
    expect(() => parseChatResponse({ model: MODEL, done: true })).toThrow(/message/);
    expect(() => parseChatResponse({ message: { role: 'assistant' } })).toThrow(/content/);
    expect(() => parseChatResponse({ message: { content: 42 } })).toThrow(/content/);
  });

  it('cleanComment：去頭尾空白、取第一行；全空白 → 空字串', () => {
    expect(cleanComment('  就這也叫蘋果？  ')).toBe('就這也叫蘋果？');
    expect(cleanComment('\n\n第一句～\n第二句')).toBe('第一句～');
    expect(cleanComment('第一句 \r\n第二句')).toBe('第一句');
    expect(cleanComment('')).toBe('');
    expect(cleanComment(' \n\t ')).toBe('');
  });

  it('不截斷：超過 40 字原樣保留（40 字是給模型的規則，畫面以 line-clamp 處理）', () => {
    const long = '雜魚'.repeat(40);
    expect(cleanComment(long)).toBe(long);
    expect([...cleanComment(long)]).toHaveLength(80);
  });

  it('真實回應形狀經 fetch 注入：回後處理過的一句；onCommented 回報字數（code point）、耗時與 tokens', async () => {
    const onCommented = vi.fn();
    const fetchImpl: FetchLike = () => Promise.resolve(jsonResponse(200, chatResponse('  就這也叫蘋果？真是笨蛋雜魚呢😈\n（補充）')));
    const out = await createOllamaCommentator({ url: 'http://x', model: MODEL, fetch: fetchImpl, onCommented }).comment({ png: png(), topic: '蘋果', score: 78 }, signal());
    expect(out).toBe('就這也叫蘋果？真是笨蛋雜魚呢😈');
    expect(onCommented).toHaveBeenCalledWith({ topic: '蘋果', score: 78, praise: false, comment: out, chars: 15, ms: expect.any(Number), promptTokens: 600, evalTokens: 21 });
  });

  it('content 空白（思考模式吃光 token 的症狀）：回空字串，交給佇列判失敗', async () => {
    const fetchImpl: FetchLike = () => Promise.resolve(jsonResponse(200, chatResponse('  \n ')));
    expect(await createOllamaCommentator({ url: 'http://x', model: MODEL, fetch: fetchImpl }).comment({ png: png(), topic: 't', score: 1 }, signal())).toBe('');
  });
});

describe('§6.1 錯誤與中止', () => {
  it('HTTP 非 2xx → throw（附狀態碼與 Ollama 的 error 文字）', async () => {
    const m = await mock({ commentModel: 'other:1b' });
    const commentator = createOllamaCommentator({ url: m.url, model: MODEL });
    await expect(commentator.comment({ png: png(), topic: '蘋果', score: 50 }, signal())).rejects.toThrow(/HTTP 404.*not found/);
    const fetch500: FetchLike = () => Promise.resolve(new Response('boom', { status: 500 }));
    await expect(createOllamaCommentator({ url: 'http://x', model: MODEL, fetch: fetch500 }).comment({ png: png(), topic: 't', score: 1 }, signal())).rejects.toThrow(/HTTP 500：boom/);
  });

  it('連線被拒 → throw，訊息帶原因（ECONNREFUSED）；壞 JSON、缺 message → throw', async () => {
    const m = await mock();
    const url = m.url;
    await mocks.pop()!.close(); // 埠剛釋放，連線會被拒
    await expect(createOllamaCommentator({ url, model: MODEL }).comment({ png: png(), topic: '蘋果', score: 50 }, signal())).rejects.toThrow(/連不上 Ollama.*ECONNREFUSED/);
    for (const body of ['{not json', { model: MODEL, done: true }]) {
      const fetchImpl: FetchLike = () => Promise.resolve(jsonResponse(200, body));
      await expect(createOllamaCommentator({ url: 'http://x', model: MODEL, fetch: fetchImpl }).comment({ png: png(), topic: 't', score: 1 }, signal())).rejects.toThrow();
    }
  });

  it('AbortSignal 接到 fetch：假 Ollama 延遲 5 秒，100 ms 時中止 → 立即 reject；已中止則不送請求', async () => {
    const m = await mock({ chatDelayMs: 5000 });
    const commentator = createOllamaCommentator({ url: m.url, model: MODEL });
    const ac = new AbortController();
    const err = new Error('評語逾時（100 ms）');
    err.name = 'TimeoutError';
    setTimeout(() => ac.abort(err), 100);
    const t0 = Date.now();
    await expect(commentator.comment({ png: png(), topic: '蘋果', score: 50 }, ac.signal)).rejects.toThrow(/評語逾時/);
    expect(Date.now() - t0).toBeLessThan(2000);
    const fetchSpy = vi.fn<FetchLike>();
    const aborted = new AbortController();
    aborted.abort();
    await expect(createOllamaCommentator({ url: 'http://x', model: MODEL, fetch: fetchSpy }).comment({ png: png(), topic: 't', score: 1 }, aborted.signal)).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ─── 佇列 ─────────────────────────────────────────────────────────

describe('§6.1 評語佇列', () => {
  function setup(timeoutMs = 1000, commentator: Commentator | null | undefined = undefined) {
    const clock = new FakeClock();
    const manual = new ManualCommentator();
    const batches: CommentDone[][] = [];
    const failures: CommentFailureInfo[] = [];
    const skips: string[] = [];
    const queue = new CommentQueue({
      commentator: commentator === undefined ? manual : commentator,
      timeoutMs,
      clock,
      onDone: (batch) => batches.push(batch),
      onFailure: (info) => failures.push(info),
      onSkip: (info) => skips.push(info.playerId),
    });
    const job = (playerId: string, score = 50): CommentJob => ({ playerId, input: { png: png(), topic: 't', score } });
    const flat = () => batches.flat().map(({ job: j, result }) => [j.playerId, result.status, result.status === 'ok' ? result.comment : null]);
    return { clock, manual, batches, failures, skips, queue, job, flat };
  }

  it('一次一張、依加入順序；前一張完成才開始下一張；成功每張一批', async () => {
    const { manual, batches, queue, job, flat } = setup();
    expect(queue.mode).toBe('ai');
    expect(queue.enabled).toBe(true);
    expect([queue.push(job('a')), queue.push(job('b')), queue.push(job('c'))]).toEqual([true, true, true]);
    expect(manual.calls).toHaveLength(1);
    expect(queue.size).toBe(3);
    manual.resolveCall(0, '一');
    await flush();
    expect(manual.calls).toHaveLength(2);
    manual.resolveCall(1, '二');
    await flush();
    manual.resolveCall(2, '三');
    await flush();
    expect(flat()).toEqual([
      ['a', 'ok', '一'],
      ['b', 'ok', '二'],
      ['c', 'ok', '三'],
    ]);
    expect(batches.map((b) => b.length)).toEqual([1, 1, 1]);
    expect(queue.size).toBe(0);
    expect(queue.mode).toBe('ai');
  });

  it('送給評語器的是工作的 input（圖、題目、分數）', () => {
    const { manual, queue } = setup();
    const input = { png: png(9), topic: '蘋果', score: 78 };
    queue.push({ playerId: 'a', input });
    expect(manual.calls[0].input).toBe(input);
  });

  // ── 失敗規則（2026-10-13 Phase 5，Rex 定案）：單次失敗只影響該張；連續兩次失敗（中間沒有成功）才跳過本回合剩餘 ──

  it('單次逾時：AbortSignal 中止、只有該張失敗（一筆一批、skipped 為空）；模式仍 ai，下一張照常呼叫模型', async () => {
    const { clock, manual, batches, failures, skips, queue, job, flat } = setup(1000);
    queue.push(job('a'));
    queue.push(job('b'));
    queue.push(job('c'));
    clock.advance(999);
    await flush();
    expect(batches).toEqual([]);
    clock.advance(1);
    expect(manual.calls[0].signal.aborted).toBe(true);
    await flush();
    // 2026-10-13 Phase 5：原本這裡 b、c 同批 skipped、模式 off
    expect(queue.mode).toBe('ai');
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(1);
    expect(batches[0][0].result).toEqual({ status: 'failed', reason: 'timeout' });
    expect(failures).toEqual([{ playerId: 'a', reason: 'timeout', consecutive: 1, skipped: [] }]);
    expect(manual.calls).toHaveLength(2); // b 照常開始
    expect(queue.size).toBe(2);
    expect(queue.push(job('d'))).toBe(true); // 失敗一次後 push 照常排入
    manual.resolveCall(1, '二');
    await flush();
    manual.resolveCall(2, '三');
    await flush();
    manual.resolveCall(3, '四');
    await flush();
    expect(flat()).toEqual([
      ['a', 'failed', null],
      ['b', 'ok', '二'],
      ['c', 'ok', '三'],
      ['d', 'ok', '四'],
    ]);
    expect(skips).toEqual([]);
    expect(queue.mode).toBe('ai');
    expect(clock.timers.size).toBe(0);
  });

  it('連續兩次失敗：第二次失敗那張與當下排隊中的各張同一批回報（skipped、不呼叫模型）；模式變 off；有界＝最壞兩次逾時', async () => {
    const { clock, manual, batches, failures, queue, job, flat } = setup(1000);
    for (const id of ['a', 'b', 'c', 'd']) queue.push(job(id));
    clock.advance(1000); // a 逾時
    await flush();
    expect(queue.mode).toBe('ai');
    expect(manual.calls).toHaveLength(2);
    clock.advance(999); // b 的逾時從它開始產生時起算
    await flush();
    expect(batches).toHaveLength(1);
    clock.advance(1); // b 逾時 → 連續第二次
    expect(manual.calls[1].signal.aborted).toBe(true);
    await flush();
    expect(queue.mode).toBe('off');
    expect(batches.map((x) => x.length)).toEqual([1, 3]);
    expect(flat()).toEqual([
      ['a', 'failed', null],
      ['b', 'failed', null],
      ['c', 'skipped', null],
      ['d', 'skipped', null],
    ]);
    expect(failures).toEqual([
      { playerId: 'a', reason: 'timeout', consecutive: 1, skipped: [] },
      { playerId: 'b', reason: 'timeout', consecutive: 2, skipped: ['c', 'd'] },
    ]);
    expect(manual.calls).toHaveLength(2); // 兩次逾時後不再呼叫模型
    expect(queue.size).toBe(0);
    expect(clock.timers.size).toBe(0);
  });

  it('連續兩次失敗後才 push 的：直接回 false（不排入、不呼叫模型、不回報 onDone），onSkip 通知；只失敗一次不會', async () => {
    const { manual, batches, failures, skips, queue, job } = setup();
    queue.push(job('a'));
    manual.rejectCall(0, new Error('連不上'));
    await flush();
    expect(failures).toEqual([{ playerId: 'a', reason: 'error', error: 'Error: 連不上', consecutive: 1, skipped: [] }]);
    expect(queue.push(job('b'))).toBe(true); // 2026-10-13 Phase 5：原本第一次失敗後就回 false
    expect(skips).toEqual([]);
    manual.rejectCall(1, new Error('還是連不上'));
    await flush();
    expect(failures.at(-1)).toEqual({ playerId: 'b', reason: 'error', error: 'Error: 還是連不上', consecutive: 2, skipped: [] });
    expect(queue.mode).toBe('off');
    expect(queue.push(job('c'))).toBe(false);
    expect(queue.push(job('d'))).toBe(false);
    await flush();
    expect(skips).toEqual(['c', 'd']);
    expect(manual.calls).toHaveLength(2);
    expect(batches).toHaveLength(2);
    expect(queue.size).toBe(0);
  });

  it('輸出空白或不是字串 → 失敗（reason empty）；單次不關、連續兩次才 off', async () => {
    for (const out of ['', '   ', 42 as unknown as string]) {
      const s = setup(1000, new FnCommentator(() => out));
      s.queue.push(s.job('x'));
      await flush();
      expect(s.batches[0][0].result).toEqual({ status: 'failed', reason: 'empty' });
      expect(s.queue.mode).toBe('ai'); // 2026-10-13 Phase 5：原本一次就 off
      s.queue.push(s.job('y'));
      await flush();
      expect(s.batches[1][0].result).toEqual({ status: 'failed', reason: 'empty' });
      expect(s.queue.mode).toBe('off');
    }
  });

  it('一次失敗後成功：計數歸零，之後再失敗一次仍不跳過（失敗、成功、失敗、成功、連兩次失敗才跳過）', async () => {
    const { manual, failures, queue, job, flat } = setup();
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) queue.push(job(id));
    manual.rejectCall(0);
    await flush();
    manual.resolveCall(1, '二');
    await flush();
    manual.rejectCall(2);
    await flush();
    expect(queue.mode).toBe('ai'); // 累計兩次失敗但不連續
    manual.resolveCall(3, '四');
    await flush();
    manual.rejectCall(4);
    await flush();
    expect(queue.mode).toBe('ai');
    manual.rejectCall(5);
    await flush();
    expect(queue.mode).toBe('off');
    expect(flat()).toEqual([
      ['a', 'failed', null],
      ['b', 'ok', '二'],
      ['c', 'failed', null],
      ['d', 'ok', '四'],
      ['e', 'failed', null],
      ['f', 'failed', null],
      ['g', 'skipped', null],
    ]);
    expect(failures.map((f) => [f.playerId, f.consecutive, f.skipped])).toEqual([
      ['a', 1, []],
      ['c', 1, []],
      ['e', 1, []],
      ['f', 2, ['g']],
    ]);
    expect(manual.calls).toHaveLength(6);
  });

  it('被取消的不計也不歸零：失敗一次 → discard 產生中的一張 → 再失敗一次即為連續第二次', async () => {
    const { manual, failures, queue, job, flat } = setup();
    for (const id of ['a', 'b', 'c', 'd']) queue.push(job(id));
    manual.rejectCall(0);
    await flush();
    expect(queue.discard('b')).toBe(true); // b 產生中 → 中止（不計、不歸零），c 接著跑
    expect(manual.calls[1].signal.aborted).toBe(true);
    manual.calls[1].resolve('太晚了'); // 被取消的就算成功回來也不歸零
    await flush();
    expect(queue.mode).toBe('ai');
    expect(manual.calls).toHaveLength(3);
    manual.rejectCall(2);
    await flush();
    expect(queue.mode).toBe('off');
    expect(flat()).toEqual([
      ['a', 'failed', null],
      ['c', 'failed', null],
      ['d', 'skipped', null],
    ]);
    expect(failures.map((f) => [f.playerId, f.consecutive])).toEqual([['a', 1], ['c', 2]]);
  });

  it('被取消的不加計數：discard 產生中的兩張後仍是 ai，之後照常呼叫模型', async () => {
    const { manual, failures, queue, job } = setup();
    for (const id of ['a', 'b', 'c']) queue.push(job(id));
    queue.discard('a');
    queue.discard('b');
    await flush();
    expect(failures).toEqual([]);
    expect(queue.mode).toBe('ai');
    expect(manual.calls).toHaveLength(3);
    expect(queue.push(job('d'))).toBe(true);
  });

  it('成功的不受之後的失敗影響：前兩張 ok、第三、四張連續失敗、第五張跳過', async () => {
    const { manual, queue, job, flat } = setup();
    for (const id of ['a', 'b', 'c', 'd', 'e']) queue.push(job(id));
    manual.resolveCall(0, '一');
    await flush();
    manual.resolveCall(1, '二');
    await flush();
    manual.rejectCall(2);
    await flush();
    manual.rejectCall(3);
    await flush();
    expect(flat()).toEqual([
      ['a', 'ok', '一'],
      ['b', 'ok', '二'],
      ['c', 'failed', null],
      ['d', 'failed', null],
      ['e', 'skipped', null],
    ]);
  });

  it('discard：排隊中的移除；產生中的中止並忽略結果、立即換下一張；**不算失敗**', async () => {
    const { manual, failures, queue, job, flat } = setup();
    queue.push(job('a'));
    queue.push(job('b'));
    queue.push(job('c'));
    expect(queue.discard('b')).toBe(true);
    expect(queue.discard('a')).toBe(true);
    expect(manual.calls[0].signal.aborted).toBe(true);
    expect(manual.calls).toHaveLength(2);
    manual.calls[0].resolve('太晚了');
    manual.resolveCall(1, '給 c 的');
    await flush();
    expect(flat()).toEqual([['c', 'ok', '給 c 的']]);
    expect(failures).toEqual([]);
    expect(queue.mode).toBe('ai');
    expect(queue.discard('zzz')).toBe(false);
  });

  it('reset（換回合）：整批清空、中止在途的那張且**不算失敗**；連續失敗計數歸零（已 off 的回合 reset 後回到 ai；只失敗一次的也歸零）', async () => {
    const { clock, manual, batches, failures, queue, job } = setup(1000);
    queue.push(job('a'));
    queue.push(job('b'));
    queue.reset();
    expect(manual.calls[0].signal.aborted).toBe(true);
    await flush();
    expect(batches).toEqual([]);
    expect(failures).toEqual([]);
    expect(queue.mode).toBe('ai');
    expect(queue.size).toBe(0);
    expect(clock.timers.size).toBe(0);

    // 這回合連續兩次失敗 → off；下一回合重新嘗試（2026-10-13 Phase 5：原本一次就 off）
    queue.push(job('c'));
    queue.push(job('c2'));
    clock.advance(1000);
    await flush();
    expect(queue.mode).toBe('ai');
    clock.advance(1000);
    await flush();
    expect(queue.mode).toBe('off');
    queue.reset();
    expect(queue.mode).toBe('ai');
    expect(queue.push(job('d'))).toBe(true);
    expect(manual.calls).toHaveLength(4);
    manual.resolveCall(3, '新回合');
    await flush();
    expect(batches.at(-1)).toEqual([{ job: expect.objectContaining({ playerId: 'd' }), result: { status: 'ok', comment: '新回合' } }]);

    // 上回合只失敗一次就換回合：計數歸零，新回合要再連續兩次才跳過
    queue.push(job('e'));
    manual.rejectCall(4);
    await flush();
    queue.reset();
    queue.push(job('f'));
    manual.rejectCall(5);
    await flush();
    expect(failures.at(-1)).toMatchObject({ playerId: 'f', consecutive: 1 });
    expect(queue.mode).toBe('ai');
    expect(queue.push(job('g'))).toBe(true);
  });

  it('pushFront（第一名重做）：插到最前面、取代同一玩家排隊中的工作；在途的別人那張先跑完', async () => {
    const { manual, queue, job, flat } = setup();
    for (const id of ['a', 'b', 'c', 'd']) queue.push(job(id));
    const praise: CommentJob = { playerId: 'c', input: { png: png(), topic: 't', score: 90, praise: true } };
    expect(queue.pushFront(praise)).toBe(true);
    expect(queue.size).toBe(4); // c 原本排隊中的那張被換掉，不是多一張
    expect(manual.calls).toHaveLength(1);
    expect(manual.calls[0].signal.aborted).toBe(false);
    manual.resolveCall(0, '給 a');
    await flush();
    expect(manual.calls[1].input).toBe(praise.input);
    manual.resolveCall(1, '稱讚 c');
    await flush();
    manual.resolveCall(2, '給 b');
    await flush();
    manual.resolveCall(3, '給 d');
    await flush();
    expect(manual.calls).toHaveLength(4);
    expect(flat()).toEqual([
      ['a', 'ok', '給 a'],
      ['c', 'ok', '稱讚 c'],
      ['b', 'ok', '給 b'],
      ['d', 'ok', '給 d'],
    ]);
  });

  // 2026-10-13 Phase 5：原本同一玩家在途的工作會被中止、新工作立即開始；改為讓它跑完（那句批評版留給 Room 當退路）
  it('pushFront：同一玩家的工作正在產生 → 讓它跑完並照常回報，新工作排在它之後、其他排隊者之前；佇列閒置時立即開始', async () => {
    const { clock, manual, batches, failures, queue, job, flat } = setup();
    queue.push(job('a', 90));
    queue.push(job('b'));
    const praise: CommentJob = { playerId: 'a', input: { png: png(), topic: 't', score: 90, praise: true } };
    expect(queue.pushFront(praise)).toBe(true);
    expect(manual.calls[0].signal.aborted).toBe(false);
    expect(manual.calls).toHaveLength(1); // 稱讚版要等在途的批評版跑完
    expect(queue.size).toBe(3); // 同一玩家兩個工作：在途的批評版＋排隊的稱讚版
    manual.resolveCall(0, 'a 的批評版');
    await flush();
    expect(batches).toHaveLength(1);
    expect(batches[0][0]).toMatchObject({ job: { playerId: 'a' }, result: { status: 'ok', comment: 'a 的批評版' } });
    expect(batches[0][0].job.input.praise).toBeUndefined();
    expect(manual.calls).toHaveLength(2);
    expect(manual.calls[1].input).toBe(praise.input);
    manual.resolveCall(1, '稱讚 a');
    await flush();
    manual.resolveCall(2, '給 b');
    await flush();
    expect(flat()).toEqual([
      ['a', 'ok', 'a 的批評版'],
      ['a', 'ok', '稱讚 a'],
      ['b', 'ok', '給 b'],
    ]);
    expect(failures).toEqual([]);
    expect(queue.mode).toBe('ai');
    expect(clock.timers.size).toBe(0);

    // 佇列閒置、該玩家沒有既有工作：直接開始
    expect(queue.pushFront({ playerId: 'z', input: { png: png(), topic: 't', score: 1, praise: true } })).toBe(true);
    expect(manual.calls).toHaveLength(4);
    expect(manual.calls[3].input.praise).toBe(true);
  });

  it('pushFront：同一玩家在途的那張失敗照常計入——單次失敗時稱讚版照跑；已失敗過一次則為連續第二次，稱讚版同批 skipped', async () => {
    const one = setup();
    one.queue.push(one.job('a', 90));
    one.queue.pushFront({ playerId: 'a', input: { png: png(), topic: 't', score: 90, praise: true } });
    one.manual.rejectCall(0);
    await flush();
    expect(one.queue.mode).toBe('ai');
    expect(one.manual.calls).toHaveLength(2);
    expect(one.manual.calls[1].input.praise).toBe(true);
    expect(one.failures).toEqual([{ playerId: 'a', reason: 'error', error: 'Error: boom', consecutive: 1, skipped: [] }]);

    const two = setup();
    two.queue.push(two.job('x'));
    two.queue.push(two.job('a', 90));
    two.queue.push(two.job('b'));
    two.manual.rejectCall(0); // x 失敗（第一次）
    await flush();
    two.queue.pushFront({ playerId: 'a', input: { png: png(), topic: 't', score: 90, praise: true } }); // a 的批評版在途
    two.manual.rejectCall(1); // 連續第二次
    await flush();
    expect(two.queue.mode).toBe('off');
    expect(two.batches.at(-1)?.map((d) => [d.job.playerId, d.job.input.praise === true, d.result.status])).toEqual([
      ['a', false, 'failed'],
      ['a', true, 'skipped'],
      ['b', false, 'skipped'],
    ]);
    expect(two.manual.calls).toHaveLength(2);
  });

  it('discard：同一玩家在途的批評版與排隊的稱讚版一起丟棄（不算失敗）', async () => {
    const { manual, batches, failures, queue, job, flat } = setup();
    queue.push(job('a', 90));
    queue.push(job('b'));
    queue.pushFront({ playerId: 'a', input: { png: png(), topic: 't', score: 90, praise: true } });
    expect(queue.discard('a')).toBe(true);
    expect(manual.calls[0].signal.aborted).toBe(true);
    expect(queue.size).toBe(1);
    manual.calls[0].resolve('太晚了');
    await flush();
    expect(batches).toEqual([]);
    expect(manual.calls).toHaveLength(2);
    expect(manual.calls[1].input.praise).toBeUndefined(); // 接著跑的是 b，不是 a 的稱讚版
    manual.resolveCall(1, '給 b');
    await flush();
    expect(flat()).toEqual([['b', 'ok', '給 b']]);
    expect(failures).toEqual([]);
  });

  it('pushFront 的工作失敗：onFailure 帶 praise: true、照常計入連續失敗；連續兩次失敗、關閉或 dispose 後 pushFront 回 false', async () => {
    const a = setup();
    a.queue.push(a.job('x'));
    a.queue.pushFront({ playerId: 'w', input: { png: png(), topic: 't', score: 99, praise: true } });
    a.queue.push(a.job('v'));
    a.manual.resolveCall(0, '給 x');
    await flush();
    a.manual.rejectCall(1, new Error('boom'));
    await flush();
    expect(a.failures).toEqual([{ playerId: 'w', reason: 'error', error: 'Error: boom', consecutive: 1, skipped: [], praise: true }]);
    expect(a.queue.mode).toBe('ai'); // 2026-10-13 Phase 5：稱讚版單次失敗不關
    expect(a.manual.calls).toHaveLength(3); // v 照常開始
    expect(a.queue.pushFront(a.job('y'))).toBe(true);
    a.manual.rejectCall(2); // v 失敗 → 稱讚版那次＋這次＝連續兩次
    await flush();
    expect(a.queue.mode).toBe('off');
    expect(a.failures.at(-1)).toEqual({ playerId: 'v', reason: 'error', error: 'Error: boom', consecutive: 2, skipped: ['y'] });
    expect(a.queue.pushFront(a.job('z'))).toBe(false); // 已連續兩次失敗：跳過
    expect(a.skips).toEqual(['z']);

    const off = setup(1000, null);
    expect(off.queue.pushFront(off.job('y'))).toBe(false);
    expect(off.skips).toEqual([]);

    const gone = setup();
    gone.queue.dispose();
    expect(gone.queue.pushFront(gone.job('y'))).toBe(false);
    expect(gone.manual.calls).toHaveLength(0);
  });

  it('dispose：中止在途、之後不再接受工作', async () => {
    const { manual, batches, queue, job } = setup();
    queue.push(job('a'));
    queue.dispose();
    expect(manual.calls[0].signal.aborted).toBe(true);
    expect(queue.push(job('b'))).toBe(false);
    await flush();
    expect(manual.calls).toHaveLength(1);
    expect(batches).toEqual([]);
  });

  it('關閉（commentator null，COMMENT=off）：模式恆為 off、push 回 false、不通知 onSkip', async () => {
    const { batches, skips, queue, job } = setup(1000, null);
    expect(queue.enabled).toBe(false);
    expect(queue.mode).toBe('off');
    expect(queue.push(job('a'))).toBe(false);
    queue.reset();
    expect(queue.mode).toBe('off');
    await flush();
    expect(batches).toEqual([]);
    expect(skips).toEqual([]);
  });

  // 2026-10-13 Phase 5：原本第一次逾時就把 p2 一起 skipped、只打一次模型
  it('真實計時器＋假 Ollama 延遲：COMMENT_TIMEOUT_MS 逾時 → 第一張只失敗自己，第二張照打模型；連續兩次逾時後剩餘跳過', async () => {
    const m = await mock({ chatDelayMs: 5000 });
    const batches: CommentDone[][] = [];
    const queue = new CommentQueue({
      commentator: createOllamaCommentator({ url: m.url, model: MODEL }),
      timeoutMs: 150,
      clock: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
      onDone: (batch) => batches.push(batch),
    });
    const t0 = Date.now();
    queue.push({ playerId: 'p1', input: { png: png(1), topic: '蘋果', score: 60 } });
    queue.push({ playerId: 'p2', input: { png: png(2), topic: '蘋果', score: 40 } });
    queue.push({ playerId: 'p3', input: { png: png(3), topic: '蘋果', score: 20 } });
    await vi.waitFor(() => expect(batches).toHaveLength(2), { timeout: 3000 });
    expect(Date.now() - t0).toBeLessThan(2500); // 有界：兩次逾時（各 150 ms），不是三次、更不是假 Ollama 的 5 秒
    expect(batches.map((b) => b.map((d) => [d.job.playerId, d.result.status]))).toEqual([
      [['p1', 'failed']],
      [['p2', 'failed'], ['p3', 'skipped']],
    ]);
    expect(batches[0][0].result).toMatchObject({ reason: 'timeout' });
    expect(batches[1][0].result).toMatchObject({ reason: 'timeout' });
    expect(queue.mode).toBe('off');
    expect(m.requests.filter((r) => r.path === '/api/chat')).toHaveLength(2);
    queue.dispose();
  });
});

// ─── 設定 ─────────────────────────────────────────────────────────

describe('§3 評語器環境變數', () => {
  // 2026-10-13 Phase 5：COMMENT_TIMEOUT_MS 預設 20000 → 30000
  it('預設值：COMMENT ollama（Rex 2026-10-12 定案）、gemma4:26b-mlx-bf16、30 秒、位址沿用 OLLAMA_URL 的預設', () => {
    expect(readCommentConfig({}, () => {})).toEqual({
      comment: 'ollama',
      ollamaUrl: 'http://127.0.0.1:11434',
      model: 'gemma4:26b-mlx-bf16',
      timeoutMs: 30_000,
    });
    expect(DEFAULT_COMMENT_CONFIG.comment).toBe('ollama');
    expect(DEFAULT_COMMENT_CONFIG.timeoutMs).toBe(30_000);
  });

  it('讀取各變數（大小寫、頭尾空白不拘）；位址讀 OLLAMA_URL', () => {
    const warn = vi.fn();
    expect(
      readCommentConfig({ COMMENT: ' OFF ', OLLAMA_URL: 'http://host.docker.internal:11434', COMMENT_MODEL: ' gemma4:e4b ', COMMENT_TIMEOUT_MS: '5000' }, warn),
    ).toEqual({ comment: 'off', ollamaUrl: 'http://host.docker.internal:11434', model: 'gemma4:e4b', timeoutMs: 5000 });
    expect(readCommentConfig({ COMMENT: 'Ollama' }, warn).comment).toBe('ollama');
    expect(warn).not.toHaveBeenCalled();
  });

  it('不合法的值退回預設並 warn；空字串視為未設', () => {
    const warn = vi.fn();
    expect(readCommentConfig({ COMMENT: 'gpt', COMMENT_TIMEOUT_MS: '0' }, warn)).toMatchObject({ comment: 'ollama', timeoutMs: 30_000 });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith('draw-contest.comment.envInvalid', { name: 'COMMENT', value: 'gpt', using: 'ollama' });
    expect(warn).toHaveBeenCalledWith('draw-contest.comment.envInvalid', { name: 'COMMENT_TIMEOUT_MS', value: '0', using: 30_000 });
    for (const bad of ['-5', '1.5', 'abc']) expect(readCommentConfig({ COMMENT_TIMEOUT_MS: bad }, warn).timeoutMs).toBe(30_000);
    expect(warn).toHaveBeenCalledTimes(5);
    expect(readCommentConfig({ COMMENT: '', COMMENT_MODEL: '  ', COMMENT_TIMEOUT_MS: ' ', OLLAMA_URL: '' }, warn)).toEqual(readCommentConfig({}, warn));
    expect(warn).toHaveBeenCalledTimes(5);
  });
});

describe('§6.1 啟動：探測與背景暖機', () => {
  const cfg = (url: string, model = MODEL) => readCommentConfig({ COMMENT: 'ollama', OLLAMA_URL: url, COMMENT_MODEL: model, COMMENT_TIMEOUT_MS: '1234' }, () => {});

  it('COMMENT=off：沒有評語器、不探測、不暖機、不 warn、timeoutMs 帶入', () => {
    const warn = vi.fn();
    const fetch = vi.fn();
    const setup = createCommentSetup({ ...readCommentConfig({ COMMENT: 'off' }, () => {}), timeoutMs: 777 }, { warn, fetch });
    expect(setup.commentator).toBeNull();
    expect(setup.timeoutMs).toBe(777);
    expect(setup.probe).toBeUndefined();
    expect(setup.warmup).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('模型在：log ollamaReady，接著背景暖機一次（不帶圖、keep_alive 30m、think false），結果只 log', async () => {
    const m = await mock();
    const warn = vi.fn();
    const info = vi.fn();
    const setup = createCommentSetup(cfg(m.url), { warn, info });
    expect(setup.commentator).not.toBeNull();
    expect(setup.timeoutMs).toBe(1234);
    expect(await setup.probe).toMatchObject({ ok: true });
    expect(await setup.warmup).toMatchObject({ ok: true, ms: expect.any(Number) });
    expect(m.requests.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /api/tags', 'POST /api/chat']);
    expect(m.requests[1].body).toEqual(buildWarmupRequest(MODEL));
    expect(JSON.stringify(m.requests[1].body)).not.toContain('images');
    expect(info).toHaveBeenCalledWith('draw-contest.comment.ollamaReady', expect.objectContaining({ model: MODEL }));
    expect(info).toHaveBeenCalledWith('draw-contest.comment.warmup', expect.objectContaining({ model: MODEL, ms: expect.any(Number) }));
    expect(warn).not.toHaveBeenCalled();
  });

  it('清單沒有該模型：只 warn commentUnavailable（附原因）、不暖機；評語器仍在（每回合仍嘗試）', async () => {
    const m = await mock({ commentModel: 'other:1b' });
    const warn = vi.fn();
    const setup = createCommentSetup(cfg(m.url), { warn, info: () => {} });
    expect(await setup.probe).toEqual({ ok: false, reason: expect.stringMatching(/沒有模型 gemma4:26b-mlx-bf16/) });
    expect(await setup.warmup).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('draw-contest.comment.commentUnavailable', expect.objectContaining({ reason: expect.stringMatching(/沒有模型/), model: MODEL }));
    expect(m.requests.map((r) => r.path)).toEqual(['/api/tags']);
    expect(setup.commentator).not.toBeNull();
  });

  it('連不上（127.0.0.1:1）：warn commentUnavailable 附原因、不暖機', async () => {
    const warn = vi.fn();
    const setup = createCommentSetup(cfg('http://127.0.0.1:1'), { warn, info: () => {} });
    expect((await setup.probe)?.ok).toBe(false);
    expect(await setup.warmup).toBeNull();
    expect(warn).toHaveBeenCalledWith('draw-contest.comment.commentUnavailable', expect.objectContaining({ reason: expect.stringMatching(/連不上 Ollama/), ollamaUrl: 'http://127.0.0.1:1' }));
  });

  it('探測不阻塞：createCommentSetup 同步回傳，掛住的位址 3 秒逾時前評語器已可用', () => {
    const hang: FetchLike = (_u, init) => new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(init.signal!.reason)));
    const t0 = Date.now();
    const setup = createCommentSetup(cfg('http://x'), { warn: () => {}, info: () => {}, fetch: hang, probeTimeoutMs: 50 });
    expect(Date.now() - t0).toBeLessThan(50);
    expect(setup.commentator).not.toBeNull();
    return expect(setup.warmup).resolves.toBeNull();
  });

  it('暖機失敗（HTTP 500、逾時）：只 warn warmupFailed，不 throw、不影響評語器', async () => {
    const tags = { models: [{ name: MODEL }] };
    const warn = vi.fn();
    const fetch500: FetchLike = (u) => Promise.resolve(u.endsWith('/api/tags') ? jsonResponse(200, tags) : new Response('boom', { status: 500 }));
    const setup = createCommentSetup(cfg('http://x'), { warn, info: () => {}, fetch: fetch500 });
    expect(await setup.warmup).toMatchObject({ ok: false, reason: expect.stringMatching(/HTTP 500/) });
    expect(warn).toHaveBeenCalledWith('draw-contest.comment.warmupFailed', expect.objectContaining({ model: MODEL, reason: expect.stringMatching(/HTTP 500/) }));
    expect(setup.commentator).not.toBeNull();

    const hang: FetchLike = (_u, init) => new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(init.signal!.reason)));
    expect(await warmupChat({ url: 'http://x', model: MODEL, timeoutMs: 50, fetch: hang })).toMatchObject({ ok: false, reason: expect.stringMatching(/暖機逾時/) });
  });

  it('評語成功時 log draw-contest.comment.done（題目、分數、字數、耗時、評語）', async () => {
    const m = await mock();
    const info = vi.fn();
    const setup = createCommentSetup(cfg(m.url), { warn: () => {}, info });
    await setup.warmup;
    const out = await setup.commentator!.comment({ png: png(5), topic: '蘋果', score: 66 }, signal());
    expect(info).toHaveBeenCalledWith('draw-contest.comment.done', expect.objectContaining({ topic: '蘋果', score: 66, praise: false, chars: [...out].length, ms: expect.any(Number), comment: out }));
    // 稱讚版的 log 分得出來：praise true
    const praised = await setup.commentator!.comment({ png: png(5), topic: '蘋果', score: 66, praise: true }, signal());
    expect(info).toHaveBeenCalledWith('draw-contest.comment.done', expect.objectContaining({ topic: '蘋果', score: 66, praise: true, comment: praised }));
  });
});

describe('測試隔離：vitest 不碰真的 Ollama（127.0.0.1:11434）', () => {
  it('server/vitest.config.ts 把 COMMENT 設 off：從環境變數建出來的評語器是關閉的、沒有探測與暖機', () => {
    expect(process.env.COMMENT).toBe('off');
    silenceLogs();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const setup = commentSetupFromEnv(process.env, () => {});
    expect(setup.commentator).toBeNull();
    expect(setup.probe).toBeUndefined();
    expect(setup.warmup).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('createApp() 不注入評語器：起停過程沒有任何 fetch', async () => {
    silenceLogs();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const app = createApp({ port: 0, host: '127.0.0.1' });
    await app.listen();
    await new Promise((r) => setTimeout(r, 50));
    await app.close();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
