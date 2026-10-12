// Clef 評分器（ollama.ts）與 JUDGE=ollama 的組合：spec/draw-contest/architecture.md §3、§6
// 對 user/mock/systemone.mjs（同真 Ollama 0.40.0 格式）或注入的 fetch 測，不連真模型。
// 2026-10-12（Epic 15 決策 12）：縮圖與 pngjs 已移除，交卷原圖 base64 直送；測試圖改用 helpers 的 makePng（server 不解碼圖片）。
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { createJudgeSetup, judgeSetupFromEnv, readJudgeConfig } from '../src/games/draw-contest/judge/index';
import {
  EFFORT_CRITERIA,
  JUDGE_TASK,
  LIKENESS_CRITERIA,
  WARMUP_PNG_BASE64,
  buildSystemOneRequest,
  buildWarmupRequest,
  combineScore,
  createOllamaJudge,
  parseSystemOneResponse,
  probeOllama,
  warmupSystemOne,
  type FetchLike,
} from '../src/games/draw-contest/judge/ollama';
import { JudgeQueue, type JudgeFallbackInfo, type JudgeResult } from '../src/games/draw-contest/judge/queue';
import { createRandomJudge } from '../src/games/draw-contest/judge/random';
import { silenceLogs } from './e2e/helpers';
import { makePng } from './helpers/drawContest';

interface MockOllama {
  url: string;
  port: number;
  close(): Promise<void>;
  requests: Array<{ method: string; path: string; body?: unknown }>;
}
type StartMock = (options?: { port?: number; host?: string; delayMs?: number; model?: string; commentModel?: string }) => Promise<MockOllama>;

const MODEL = 'clef:27b-q4_k_m';
const mockPath = new URL('../../user/mock/systemone.mjs', import.meta.url).href;
let startMockOllama: StartMock;

beforeAll(async () => {
  ({ startMockOllama } = (await import(mockPath)) as { startMockOllama: StartMock });
});

const mocks: MockOllama[] = [];
async function mock(options: { delayMs?: number; model?: string } = {}): Promise<MockOllama> {
  const m = await startMockOllama({ model: MODEL, ...options });
  mocks.push(m);
  return m;
}
afterEach(async () => {
  while (mocks.length > 0) await mocks.pop()!.close();
  vi.restoreAllMocks();
});

/** 交卷原圖（1280×720 的 PNG bytes）；seed 改變內容 */
const realPng = (seed = 0): Buffer => Buffer.from(makePng(seed));
const signal = () => new AbortController().signal;

/** 真模型實測回應（2026-10-07，Ollama 0.40.0、clef:27b-q4_k_m、1280×720 蘋果線稿、topic 'an apple'） */
const REAL_RESPONSE = {
  model: MODEL,
  answers: {
    likeness: {
      type: 'score',
      score: 2.8727408163126174,
      legend: { '0': 'Unrecognizable', '1': 'Vaguely related', '2': 'Somewhat recognizable', '3': 'Clearly recognizable', '4': 'Unmistakable' },
      probabilities: { '0': 0.021973601399766472, '1': 0.059547662652252885, '2': 0.18276021391494196, '3': 0.49520136230167466, '4': 0.24051715973136412 },
      confidence: 0.22131643720216898,
    },
    is_topic: { type: 'noul', noul: 0.9582562973240407 },
    effort: {
      type: 'score',
      score: 1.4287152413838506,
      legend: { '0': 'Blank or scribble', '1': 'Partial', '2': 'Complete drawing' },
      probabilities: { '0': 0.07831141954696863, '1': 0.414661919522212, '2': 0.5070266609308194 },
      confidence: 0.17272381080310306,
    },
  },
  usage: { input_tokens: 1286, output_tokens: 0 },
};

const jsonResponse = (status: number, body: unknown) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('§6 請求格式', () => {
  it('buildSystemOneRequest：model、images、state、三題 instructions 與等級文案逐字（§6）', () => {
    expect(buildSystemOneRequest(MODEL, '蘋果', 'AAAA')).toEqual({
      model: MODEL,
      images: ['AAAA'],
      state: { task: 'A player drew this picture in a drawing contest.', topic: '蘋果' },
      questions: {
        likeness: {
          type: 'score',
          instructions: "How clearly does this drawing depict the topic '蘋果'?",
          criteria: ['Unrecognizable', 'Vaguely related', 'Somewhat recognizable', 'Clearly recognizable', 'Unmistakable'],
        },
        is_topic: { type: 'noul', instructions: 'Is this a drawing of 蘋果?' },
        effort: { type: 'score', instructions: 'How complete is the drawing?', criteria: ['Blank or scribble', 'Partial', 'Complete drawing'] },
      },
    });
  });

  it('對假 Ollama 送出：POST /v1/systemone、圖片為交卷原 PNG 的 base64（不縮圖，bytes 逐位元相同）', async () => {
    const m = await mock();
    const judge = createOllamaJudge({ url: `${m.url}/`, model: MODEL });
    const png = realPng(7);
    const copy = Buffer.from(png);
    const out = await judge.score({ png, topic: '蘋果' }, signal());
    expect(judge.mode).toBe('ai');
    expect(Number.isInteger(out.score)).toBe(true);
    expect(out.score).toBeGreaterThanOrEqual(0);
    expect(out.score).toBeLessThanOrEqual(100);
    expect(out.confidence).toBeGreaterThanOrEqual(0);
    expect(out.confidence).toBeLessThanOrEqual(1);
    expect(m.requests).toHaveLength(1);
    const req = m.requests[0];
    expect([req.method, req.path]).toEqual(['POST', '/v1/systemone']);
    const body = req.body as ReturnType<typeof buildSystemOneRequest>;
    expect(body.model).toBe(MODEL);
    expect(body.state).toEqual({ task: JUDGE_TASK, topic: '蘋果' });
    expect(body.questions.likeness.criteria).toEqual([...LIKENESS_CRITERIA]);
    expect(body.questions.effort.criteria).toEqual([...EFFORT_CRITERIA]);
    expect(body.questions.likeness.instructions).toBe("How clearly does this drawing depict the topic '蘋果'?");
    expect(body.questions.is_topic.instructions).toBe('Is this a drawing of 蘋果?');
    expect(body.questions.effort.instructions).toBe('How complete is the drawing?');
    expect(body.images).toHaveLength(1);
    expect(Buffer.from(body.images[0], 'base64').equals(copy)).toBe(true);
    expect(png.equals(copy)).toBe(true); // 原 Buffer 不變
  });

  it('同一張圖＋同一題，假 Ollama 給同分；不同圖通常不同分', async () => {
    const m = await mock();
    const judge = createOllamaJudge({ url: m.url, model: MODEL });
    const a = realPng(0);
    const outs = new Set<string>();
    const first = await judge.score({ png: a, topic: '貓' }, signal());
    expect(await judge.score({ png: Buffer.from(a), topic: '貓' }, signal())).toEqual(first);
    for (let k = 1; k <= 5; k++) outs.add(JSON.stringify(await judge.score({ png: realPng(k), topic: '貓' }, signal())));
    expect(outs.size).toBeGreaterThan(1);
  });
});

describe('§6 解析與合成', () => {
  it('真實回應：likeness 2.87／is_topic 0.96／effort 1.43 → 79 分、confidence = likeness.confidence', () => {
    const raw = parseSystemOneResponse(REAL_RESPONSE);
    expect(raw).toEqual({ likeness: 2.8727408163126174, likenessConfidence: 0.22131643720216898, isTopic: 0.9582562973240407, effort: 1.4287152413838506 });
    expect(combineScore(raw)).toEqual({ score: 79, confidence: 0.22131643720216898 });
  });

  it('合成公式與邊界：全滿 100、全零 0、spec §6 羅盤實測的蘋果三值 → 63', () => {
    expect(combineScore({ likeness: 4, likenessConfidence: 1, isTopic: 1, effort: 2 })).toEqual({ score: 100, confidence: 1 });
    expect(combineScore({ likeness: 0, likenessConfidence: 0, isTopic: 0, effort: 0 })).toEqual({ score: 0, confidence: 0 });
    expect(combineScore({ likeness: 2.2, likenessConfidence: 0.5, isTopic: 0.82, effort: 1.12 }).score).toBe(63);
        // 0.6×(2/4) + 0.3×0.5 + 0.1×(1/2) = 0.3 + 0.15 + 0.05 = 0.5
    expect(combineScore({ likeness: 2, likenessConfidence: 0.3, isTopic: 0.5, effort: 1 }).score).toBe(50);
  });

  it('浮點誤差的微小越界夾回邊界；明顯越界、缺欄位、型別錯誤 → throw', () => {
    const withAns = (patch: Record<string, unknown>) => ({ ...REAL_RESPONSE, answers: { ...REAL_RESPONSE.answers, ...patch } });
    expect(parseSystemOneResponse(withAns({ is_topic: { type: 'noul', noul: 1 + 1e-12 } })).isTopic).toBe(1);
    expect(() => parseSystemOneResponse(withAns({ is_topic: { type: 'noul', noul: 1.2 } }))).toThrow(/is_topic/);
    expect(() => parseSystemOneResponse(withAns({ likeness: { ...REAL_RESPONSE.answers.likeness, score: 4.5 } }))).toThrow(/likeness/);
    expect(() => parseSystemOneResponse(withAns({ likeness: { ...REAL_RESPONSE.answers.likeness, confidence: Number.NaN } }))).toThrow(/confidence/);
    expect(() => parseSystemOneResponse(withAns({ effort: { type: 'score', score: '1' } }))).toThrow(/effort/);
    expect(() => parseSystemOneResponse(withAns({ effort: { type: 'noul', noul: 0.5 } }))).toThrow(/effort/);
    expect(() => parseSystemOneResponse(withAns({ is_topic: undefined }))).toThrow(/is_topic/);
    expect(() => parseSystemOneResponse({ model: MODEL })).toThrow(/answers/);
    expect(() => parseSystemOneResponse(null)).toThrow();
  });
});

describe('§6 錯誤與中止', () => {
  const png = () => realPng();

  it('HTTP 非 2xx → throw（附狀態碼與 Ollama 的 error 文字）', async () => {
    const m = await mock({ model: 'other:1b' });
    const judge = createOllamaJudge({ url: m.url, model: MODEL });
    await expect(judge.score({ png: png(), topic: '蘋果' }, signal())).rejects.toThrow(/HTTP 404.*not found/);
    const fetch500: FetchLike = () => Promise.resolve(new Response('boom', { status: 500 }));
    await expect(createOllamaJudge({ url: 'http://x', model: MODEL, fetch: fetch500 }).score({ png: png(), topic: 't' }, signal())).rejects.toThrow(/HTTP 500：boom/);
  });

  it('連線被拒 → throw，訊息帶原因（ECONNREFUSED），不只是 fetch failed', async () => {
    const m = await mock();
    const url = m.url;
    await mocks.pop()!.close(); // 埠剛釋放，連線會被拒
    const judge = createOllamaJudge({ url, model: MODEL });
    await expect(judge.score({ png: png(), topic: '蘋果' }, signal())).rejects.toThrow(/連不上 Ollama.*ECONNREFUSED/);
    expect(await probeOllama({ url, model: MODEL })).toEqual({ ok: false, reason: expect.stringMatching(/ECONNREFUSED/) });
  });

  it('壞 JSON、缺 answers、數值不合法 → throw', async () => {
    const cases: unknown[] = ['{not json', { model: MODEL }, { answers: { ...REAL_RESPONSE.answers, is_topic: { type: 'noul', noul: -3 } } }];
    for (const body of cases) {
      const fetchImpl: FetchLike = () => Promise.resolve(jsonResponse(200, body));
      await expect(createOllamaJudge({ url: 'http://x', model: MODEL, fetch: fetchImpl }).score({ png: png(), topic: 't' }, signal())).rejects.toThrow();
    }
  });

  it('真實回應經 fetch 注入：回 79 分；onScored 回報原始三值、耗時與 tokens', async () => {
    const onScored = vi.fn();
    const fetchImpl: FetchLike = () => Promise.resolve(jsonResponse(200, REAL_RESPONSE));
    const out = await createOllamaJudge({ url: 'http://x', model: MODEL, fetch: fetchImpl, onScored }).score({ png: png(), topic: 'an apple' }, signal());
    expect(out).toEqual({ score: 79, confidence: 0.22131643720216898 });
    expect(onScored).toHaveBeenCalledWith(expect.objectContaining({ topic: 'an apple', out, inputTokens: 1286, raw: expect.objectContaining({ likeness: 2.8727408163126174 }) }));
  });

  it('AbortSignal 接到 fetch：假 Ollama 延遲 5 秒，100 ms 時中止 → 立即 reject；已中止則不送請求', async () => {
    const m = await mock({ delayMs: 5000 });
    const judge = createOllamaJudge({ url: m.url, model: MODEL });
    const ac = new AbortController();
    const err = new Error('評分逾時（100 ms）');
    err.name = 'TimeoutError';
    setTimeout(() => ac.abort(err), 100);
    const t0 = Date.now();
    await expect(judge.score({ png: png(), topic: '蘋果' }, ac.signal)).rejects.toThrow(/評分逾時/);
    expect(Date.now() - t0).toBeLessThan(2000);
    const fetchSpy = vi.fn<FetchLike>();
    const aborted = new AbortController();
    aborted.abort();
    await expect(createOllamaJudge({ url: 'http://x', model: MODEL, fetch: fetchSpy }).score({ png: png(), topic: 't' }, aborted.signal)).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('佇列逾時（JUDGE_TIMEOUT_MS）：ollama 逾時 → 該張改 random、本回合模式降為 random', async () => {
    const m = await mock({ delayMs: 5000 });
    const done: JudgeResult[] = [];
    const fallbacks: JudgeFallbackInfo[] = [];
    const queue = new JudgeQueue({
      judge: createOllamaJudge({ url: m.url, model: MODEL }),
      fallback: createRandomJudge({ delayMs: 0 }),
      timeoutMs: 150,
      clock: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
      onDone: (_job, r) => done.push(r),
      onFallback: (info) => fallbacks.push(info),
    });
    expect(queue.mode).toBe('ai');
    queue.push({ playerId: 'p1', input: { png: png(), topic: '蘋果' } });
    await vi.waitFor(() => expect(done).toHaveLength(1), { timeout: 2000 });
    expect(done[0].judgedBy).toBe('random');
    expect(fallbacks[0]).toMatchObject({ playerId: 'p1', reason: 'timeout' });
    expect(queue.mode).toBe('random');
    queue.dispose();
  });
});

describe('§3 JUDGE=ollama：組合、啟動探測、不永久退回', () => {
  const cfg = (url: string, model = MODEL) => ({ ...readJudgeConfig({ JUDGE: 'ollama', OLLAMA_URL: url, JUDGE_MODEL: model }, () => {}), fakeDelayMs: 0 });

  it('探測成功：主評分器 ai、fallback random；log info ollamaReady、不 warn；接著背景暖機一次', async () => {
    const m = await mock();
    const warn = vi.fn();
    const info = vi.fn();
    const setup = createJudgeSetup(cfg(m.url), { warn, info });
    expect(setup.judge.mode).toBe('ai');
    expect(setup.fallback.mode).toBe('random');
    // 假 Ollama 的 /api/tags 同時列評分模型與評語模型（Epic 15）
    expect(await setup.probe).toMatchObject({ ok: true, models: [MODEL, 'gemma4:26b-mlx-bf16'] });
    expect(info).toHaveBeenCalledWith('draw-contest.judge.ollamaReady', expect.objectContaining({ model: MODEL }));
    // 探測之後只多一則暖機請求（Epic 15 Phase 2.5；原本這裡只有 GET /api/tags）
    expect(await setup.warmup).toMatchObject({ ok: true });
    expect(warn).not.toHaveBeenCalled();
    expect(m.requests.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /api/tags', 'POST /v1/systemone']);
  });

  it('連不上（127.0.0.1:1）：warn ollamaUnavailable 附原因，但主評分器仍是 ai（不永久改 random）', async () => {
    const warn = vi.fn();
    const setup = createJudgeSetup(cfg('http://127.0.0.1:1'), { warn, info: () => {} });
    const r = await setup.probe;
    expect(r?.ok).toBe(false);
    expect(warn).toHaveBeenCalledWith('draw-contest.judge.ollamaUnavailable', expect.objectContaining({ reason: expect.stringMatching(/連不上 Ollama/), ollamaUrl: 'http://127.0.0.1:1' }));
    expect(setup.judge.mode).toBe('ai');
    // 探測失敗就不暖機：只有 ollamaUnavailable 那一則 warn
    expect(await setup.warmup).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('清單沒有該 model：warn 附原因', async () => {
    const m = await mock({ model: 'other:1b' });
    const warn = vi.fn();
    const setup = createJudgeSetup(cfg(m.url), { warn, info: () => {} });
    const r = await setup.probe;
    expect(r).toEqual({ ok: false, reason: expect.stringMatching(/沒有模型 clef:27b-q4_k_m/) });
    expect(warn).toHaveBeenCalledWith('draw-contest.judge.ollamaUnavailable', expect.any(Object));
    // 模型不在：不暖機、沒有 systemone 請求
    expect(await setup.warmup).toBeNull();
    expect(m.requests.map((x) => x.path)).toEqual(['/api/tags']);
  });

  it('探測逾時與非 2xx：回 ok=false 附原因', async () => {
    const hang: FetchLike = (_u, init) => new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(init.signal!.reason)));
    expect(await probeOllama({ url: 'http://x', model: MODEL, timeoutMs: 50, fetch: hang })).toEqual({ ok: false, reason: expect.stringMatching(/逾時/) });
    expect(await probeOllama({ url: 'http://x', model: MODEL, fetch: () => Promise.resolve(new Response('', { status: 503 })) })).toEqual({ ok: false, reason: expect.stringMatching(/503/) });
  });

  it('啟動時連不上、之後 Ollama 才開：不用重啟，下一回合（queue.reset 後）就以 ai 評分', async () => {
    // 啟動：Ollama 尚未開 → 探測失敗、第一回合退回 random
    let target = 'http://127.0.0.1:1';
    const fetchImpl: FetchLike = (u, init) => fetch(u.replace('http://ollama.invalid', target), init);
    const setup = createJudgeSetup(cfg('http://ollama.invalid'), { warn: () => {}, info: () => {}, fetch: fetchImpl });
    expect((await setup.probe)?.ok).toBe(false);
    expect(await setup.warmup).toBeNull();
    const done: JudgeResult[] = [];
    const queue = new JudgeQueue({
      ...setup,
      clock: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
      onDone: (_job, r) => done.push(r),
    });
    const png = realPng();
    queue.push({ playerId: 'a', input: { png, topic: '蘋果' } });
    await vi.waitFor(() => expect(done).toHaveLength(1));
    expect(done[0].judgedBy).toBe('random');
    expect(queue.mode).toBe('random');
    // Ollama 開了 → 下一回合
    const m = await mock();
    target = m.url;
    queue.reset();
    expect(queue.mode).toBe('ai');
    queue.push({ playerId: 'a', input: { png, topic: '蘋果' } });
    await vi.waitFor(() => expect(done).toHaveLength(2));
    expect(done[1].judgedBy).toBe('ai');
    queue.dispose();
  });
});

describe('§6.1 啟動：Clef 背景暖機（Epic 15 Phase 2.5）', () => {
  const cfg = (url: string, model = MODEL) => ({ ...readJudgeConfig({ JUDGE: 'ollama', OLLAMA_URL: url, JUDGE_MODEL: model }, () => {}), fakeDelayMs: 0 });
  const tags = { models: [{ name: MODEL }] };
  const hang: FetchLike = (_u, init) => new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(init.signal!.reason)));

  it('暖機用的 1×1 PNG：寫死的位元組是合法 PNG（magic、IHDR 1×1 8-bit RGB、IDAT 解壓為單一像素 #1E1E1E、IEND）', () => {
    const png = Buffer.from(WARMUP_PNG_BASE64, 'base64');
    expect(png.toString('base64')).toBe(WARMUP_PNG_BASE64);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const chunks: { type: string; data: Buffer }[] = [];
    for (let o = 8; o < png.length; ) {
      const len = png.readUInt32BE(o);
      chunks.push({ type: png.toString('ascii', o + 4, o + 8), data: png.subarray(o + 8, o + 8 + len) });
      o += 12 + len;
    }
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    const ihdr = chunks[0].data;
    expect([ihdr.readUInt32BE(0), ihdr.readUInt32BE(4), ihdr[8], ihdr[9], ihdr[10], ihdr[11], ihdr[12]]).toEqual([1, 1, 8, 2, 0, 0, 0]);
    expect([...inflateSync(chunks[1].data)]).toEqual([0, 0x1e, 0x1e, 0x1e]);
  });

  it('暖機請求：與評分請求同一份 state／questions、圖片為 1×1 PNG、另帶 keep_alive 30m', () => {
    const body = buildWarmupRequest(MODEL);
    expect(body).toEqual({ ...buildSystemOneRequest(MODEL, 'warmup', WARMUP_PNG_BASE64), keep_alive: '30m' });
    expect(body.images).toEqual([WARMUP_PNG_BASE64]);
    expect(body.state).toEqual({ task: JUDGE_TASK, topic: 'warmup' });
    expect(Object.keys(body.questions)).toEqual(['likeness', 'is_topic', 'effort']);
    // 評分請求本身不帶 keep_alive（§6 請求格式不變）
    expect(buildSystemOneRequest(MODEL, '蘋果', 'AAAA')).not.toHaveProperty('keep_alive');
  });

  it('模型在：探測後背景送一則 POST /v1/systemone（1×1 PNG）；結果只 log draw-contest.judge.warmup，不當成評分（沒有 judge.scored）', async () => {
    const m = await mock();
    const warn = vi.fn();
    const info = vi.fn();
    const setup = createJudgeSetup(cfg(m.url), { warn, info });
    expect(await setup.warmup).toEqual({ ok: true, ms: expect.any(Number), inputTokens: expect.any(Number) });
    expect(m.requests.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /api/tags', 'POST /v1/systemone']);
    expect(m.requests[1].body).toEqual(buildWarmupRequest(MODEL));
    expect(info).toHaveBeenCalledWith('draw-contest.judge.warmup', { model: MODEL, ms: expect.any(Number), inputTokens: expect.any(Number) });
    expect(info.mock.calls.map((c) => c[0])).toEqual(['draw-contest.judge.ollamaReady', 'draw-contest.judge.warmup']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('不阻塞：createJudgeSetup 同步回傳；暖機掛住時評分器照常可用，逾時後只 warn warmupFailed', async () => {
    const warn = vi.fn();
    const fetchImpl: FetchLike = (u, init) => (u.endsWith('/api/tags') ? Promise.resolve(jsonResponse(200, tags)) : hang(u, init));
    const t0 = Date.now();
    const setup = createJudgeSetup(cfg('http://x'), { warn, info: () => {}, fetch: fetchImpl, warmupTimeoutMs: 80 });
    expect(Date.now() - t0).toBeLessThan(50);
    expect(setup.judge.mode).toBe('ai');
    expect(await setup.warmup).toEqual({ ok: false, ms: expect.any(Number), reason: expect.stringMatching(/暖機逾時（80 ms）/) });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('draw-contest.judge.warmupFailed', { model: MODEL, ms: expect.any(Number), reason: expect.stringMatching(/暖機逾時/) });
  });

  it('暖機失敗（HTTP 500、回應缺欄位）：只 warn、不 throw；之後的評分不受影響（每張仍照常嘗試）', async () => {
    let failWarmup = true;
    const warn = vi.fn();
    const fetchImpl: FetchLike = (u) => {
      if (u.endsWith('/api/tags')) return Promise.resolve(jsonResponse(200, tags));
      return Promise.resolve(failWarmup ? new Response('boom', { status: 500 }) : jsonResponse(200, REAL_RESPONSE));
    };
    const setup = createJudgeSetup(cfg('http://x'), { warn, info: () => {}, fetch: fetchImpl });
    expect(await setup.warmup).toMatchObject({ ok: false, reason: expect.stringMatching(/HTTP 500：boom/) });
    expect(warn).toHaveBeenCalledWith('draw-contest.judge.warmupFailed', expect.objectContaining({ model: MODEL, reason: expect.stringMatching(/HTTP 500/) }));
    failWarmup = false;
    await expect(setup.judge.score({ png: realPng(), topic: 'an apple' }, signal())).resolves.toMatchObject({ score: 79 });

    const noAnswers: FetchLike = () => Promise.resolve(jsonResponse(200, { model: MODEL }));
    expect(await warmupSystemOne({ url: 'http://x', model: MODEL, timeoutMs: 1000, fetch: noAnswers })).toMatchObject({ ok: false, reason: expect.stringMatching(/answers/) });
    await expect(warmupSystemOne({ url: 'http://127.0.0.1:1', model: MODEL, timeoutMs: 1000 })).resolves.toMatchObject({ ok: false, reason: expect.stringMatching(/連不上 Ollama/) });
  });
});

describe('測試隔離：vitest 不碰真的 Ollama（127.0.0.1:11434）', () => {
  it('server/vitest.config.ts 把 JUDGE 設 random、OLLAMA_URL 指向不可能連上的位址', () => {
    expect(process.env.JUDGE).toBe('random');
    expect(process.env.OLLAMA_URL).toBe('http://127.0.0.1:1');
    const setup = judgeSetupFromEnv(process.env, () => {});
    expect(setup.judge.mode).toBe('random');
    expect(setup.probe).toBeUndefined();
    expect(setup.warmup).toBeUndefined();
  });

  it('createApp() 不注入評分器（draw-guess 的 e2e 就是這樣起 server）：起停過程沒有任何 fetch', async () => {
    silenceLogs();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const app = createApp({ port: 0, host: '127.0.0.1' });
    await app.listen();
    await new Promise((r) => setTimeout(r, 50));
    await app.close();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});
