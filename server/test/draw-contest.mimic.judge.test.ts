// 像不像比賽（Epic 20）的評分器與評語器：spec/draw-contest/architecture.md §6「像不像比賽」、§6.1 mimic 回合、§6「假的 Ollama」
// 對 user/mock/systemone.mjs 或注入的 fetch 測；真 Clef 樣本在 test/fixtures/draw-contest.mimic-clef.json（不連真模型）。
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  COMMENT_SYSTEM_PROMPT,
  buildChatRequest,
  commentUserPrompt,
  createOllamaCommentator,
  mimicPraiseUserPrompt,
  mimicUserPrompt,
} from '../src/games/draw-contest/commentary/ollamaChat';
import {
  EFFORT_CRITERIA,
  MIMIC_TASK,
  SIMILARITY_CRITERIA,
  SIMILARITY_INSTRUCTIONS,
  buildMimicRequest,
  buildSystemOneRequest,
  combineMimicScore,
  createOllamaJudge,
  parseMimicResponse,
  type FetchLike,
} from '../src/games/draw-contest/judge/ollama';
import { JudgeQueue, type JudgeResult } from '../src/games/draw-contest/judge/queue';
import { createRandomJudge, randomScore } from '../src/games/draw-contest/judge/random';
import { FakeClock } from './helpers/fakeClock';
import { flush, makePng } from './helpers/drawContest';

interface MockOllama {
  url: string;
  close(): Promise<void>;
  requests: Array<{ method: string; path: string; body?: unknown }>;
}
type StartMock = (options?: { model?: string; commentModel?: string }) => Promise<MockOllama>;

const JUDGE_MODEL = 'clef:27b-nvfp4';
const COMMENT_MODEL = 'gemma4:26b-mlx-bf16';
const mockPath = new URL('../../user/mock/systemone.mjs', import.meta.url).href;
let startMockOllama: StartMock;
let MOCK_COMMENTS: string[];
let MOCK_PRAISES: string[];

beforeAll(async () => {
  ({ startMockOllama, MOCK_COMMENTS, MOCK_PRAISES } = (await import(mockPath)) as {
    startMockOllama: StartMock;
    MOCK_COMMENTS: string[];
    MOCK_PRAISES: string[];
  });
});

const mocks: MockOllama[] = [];
async function mock(): Promise<MockOllama> {
  const m = await startMockOllama({ model: JUDGE_MODEL, commentModel: COMMENT_MODEL });
  mocks.push(m);
  return m;
}
afterEach(async () => {
  while (mocks.length > 0) await mocks.pop()!.close();
  vi.restoreAllMocks();
});

const signal = () => new AbortController().signal;
const jpeg = (seed = 0, size = 64): Buffer => {
  const b = Buffer.alloc(size);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  for (let i = 4; i < size; i++) b[i] = (seed * 37 + i * 11) & 0xff;
  return b;
};
const png = (seed = 0): Buffer => Buffer.from(makePng(seed));
const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * 真 Clef 回應（水手長 2026-10-26，Ollama 0.40.11、clef:27b-nvfp4、英文 instructions 版）：
 * 參考圖＝白底紅色實心圓（1280×720 JPEG），作品＝#1E1E1E 底白線圓環（1280×720 PNG）。
 * 同一批另測：方框 similarity 0.177（confidence 0.740）→ 10 分、三角形 0.118（0.816）→ 10 分、參考圖本身 3.746（0.614）→ 94 分。
 */
const REAL_MIMIC = JSON.parse(readFileSync(new URL('./fixtures/draw-contest.mimic-clef.json', import.meta.url), 'utf8')) as unknown;

describe('§6 mimic 請求格式（文案逐字）', () => {
  it('buildMimicRequest：images [參考圖, 作品]、state.task 為 MIMIC_TASK、兩題 similarity＋effort，不問 is_topic', () => {
    expect(buildMimicRequest(JUDGE_MODEL, '皮卡丘', 'REF', 'PNG')).toEqual({
      model: JUDGE_MODEL,
      images: ['REF', 'PNG'],
      state: { task: 'A player tried to copy the first image (the reference) by drawing the second image in a drawing contest.', topic: '皮卡丘' },
      questions: {
        similarity: {
          type: 'score',
          instructions:
            "The first image is the reference and the second is the player's drawing. How closely does the drawing reproduce the reference in shapes, composition and main subject, ignoring colour and line thickness?",
          criteria: ['Completely different', 'Slightly similar', 'Roughly similar', 'Very similar', 'Nearly identical'],
        },
        effort: { type: 'score', instructions: 'How complete is the drawing?', criteria: ['Blank or scribble', 'Partial', 'Complete drawing'] },
      },
    });
    expect(MIMIC_TASK).toBe('A player tried to copy the first image (the reference) by drawing the second image in a drawing contest.');
    expect([...SIMILARITY_CRITERIA]).toHaveLength(5);
    expect(SIMILARITY_INSTRUCTIONS).toContain('ignoring colour and line thickness');
  });

  it('createOllamaJudge：有 reference → 對假 Ollama 送 mimic 版（兩張圖 bytes 逐位元相同、順序參考圖在前）；沒有 → 原三題版', async () => {
    const m = await mock();
    const judge = createOllamaJudge({ url: m.url, model: JUDGE_MODEL });
    const ref = jpeg(1);
    const work = png(2);
    const out = await judge.score({ png: work, topic: '皮卡丘', reference: ref }, signal());
    expect(Number.isInteger(out.score) && out.score >= 0 && out.score <= 100).toBe(true);
    const body = m.requests[0].body as ReturnType<typeof buildMimicRequest>;
    expect(body.state).toEqual({ task: MIMIC_TASK, topic: '皮卡丘' });
    expect(Object.keys(body.questions)).toEqual(['similarity', 'effort']);
    expect(body.images).toHaveLength(2);
    expect(Buffer.from(body.images[0], 'base64').equals(ref)).toBe(true);
    expect(Buffer.from(body.images[1], 'base64').equals(work)).toBe(true);

    await judge.score({ png: work, topic: '蘋果' }, signal());
    const plain = m.requests[1].body as ReturnType<typeof buildSystemOneRequest>;
    expect(Object.keys(plain.questions)).toEqual(['likeness', 'is_topic', 'effort']);
    expect(plain.images).toHaveLength(1);
  });

  it('假 Ollama：同兩張圖同分；只換參考圖或只換作品通常不同分（雜湊含兩張）', async () => {
    const m = await mock();
    const judge = createOllamaJudge({ url: m.url, model: JUDGE_MODEL });
    const first = await judge.score({ png: png(0), topic: '照著畫', reference: jpeg(0) }, signal());
    expect(await judge.score({ png: png(0), topic: '照著畫', reference: Buffer.from(jpeg(0)) }, signal())).toEqual(first);
    const byRef = new Set<string>();
    const byWork = new Set<string>();
    for (let k = 1; k <= 5; k++) {
      byRef.add(JSON.stringify(await judge.score({ png: png(0), topic: '照著畫', reference: jpeg(k) }, signal())));
      byWork.add(JSON.stringify(await judge.score({ png: png(k), topic: '照著畫', reference: jpeg(0) }, signal())));
    }
    expect(byRef.size).toBeGreaterThan(1);
    expect(byWork.size).toBeGreaterThan(1);
  });
});

describe('§6 mimic 解析與合成', () => {
  it('真 Clef 回應（圓環對紅圓）：similarity 2.58／effort 1.49 → 66 分、confidence = similarity.confidence', () => {
    const raw = parseMimicResponse(REAL_MIMIC);
    expect(raw).toEqual({ similarity: 2.5849445863464724, similarityConfidence: 0.11641733662514975, effort: 1.4917770495025107 });
    expect(combineMimicScore(raw)).toEqual({ score: 66, confidence: 0.11641733662514975 });
  });

  it('真 Clef 回應經 fetch 注入：judge 回 66 分；onScored 回報 mode mimic 與原始兩值', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => jsonResponse(200, REAL_MIMIC));
    const onScored = vi.fn();
    const judge = createOllamaJudge({ url: 'http://x', model: JUDGE_MODEL, fetch: fetchImpl, onScored });
    const out = await judge.score({ png: png(), topic: '照著畫', reference: jpeg() }, signal());
    expect(out).toEqual({ score: 66, confidence: 0.11641733662514975 });
    expect(onScored).toHaveBeenCalledWith(
      expect.objectContaining({ topic: '照著畫', mode: 'mimic', out, inputTokens: 2093, raw: expect.objectContaining({ similarity: 2.5849445863464724 }) }),
    );
  });

  it('合成公式 round(100 × (0.9 × similarity/4 + 0.1 × effort/2))：全滿 100、全零 0、探測的方框／三角形／原圖', () => {
    expect(combineMimicScore({ similarity: 4, similarityConfidence: 1, effort: 2 })).toEqual({ score: 100, confidence: 1 });
    expect(combineMimicScore({ similarity: 0, similarityConfidence: 0, effort: 0 })).toEqual({ score: 0, confidence: 0 });
    // 0.9×(2/4) + 0.1×(1/2) = 0.45 + 0.05 = 0.5
    expect(combineMimicScore({ similarity: 2, similarityConfidence: 0.3, effort: 1 }).score).toBe(50);
    expect(combineMimicScore({ similarity: 0.177, similarityConfidence: 0.74, effort: 1.151 }).score).toBe(10);
    expect(combineMimicScore({ similarity: 0.118, similarityConfidence: 0.816, effort: 1.56 }).score).toBe(10);
    expect(combineMimicScore({ similarity: 3.746, similarityConfidence: 0.614, effort: 1.886 }).score).toBe(94);
  });

  it('缺 similarity、回成三題版（likeness）、數值越界 → throw（佇列退回 random）', () => {
    const real = REAL_MIMIC as { answers: Record<string, unknown> };
    const withAns = (patch: Record<string, unknown>) => ({ ...real, answers: { ...real.answers, ...patch } });
    expect(() => parseMimicResponse(withAns({ similarity: undefined }))).toThrow(/similarity/);
    expect(() => parseMimicResponse({ answers: { likeness: { type: 'score', score: 2, confidence: 0.5 }, effort: real.answers.effort } })).toThrow(/similarity/);
    expect(() => parseMimicResponse(withAns({ similarity: { type: 'score', score: 4.5, confidence: 0.2 } }))).toThrow(/similarity/);
    expect(() => parseMimicResponse(withAns({ effort: { type: 'noul', noul: 0.5 } }))).toThrow(/effort/);
    expect(() => parseMimicResponse(null)).toThrow();
    expect(EFFORT_CRITERIA).toHaveLength(3);
  });
});

describe('§6 random：mimic 回合種子 = FNV-1a(reference ‖ png ‖ topic)', () => {
  it('等同把參考圖接在交卷 bytes 前面的種子；沒有參考圖時與原本相同', () => {
    const ref = jpeg(3);
    const work = png(4);
    expect(randomScore(work, '照著畫', ref)).toEqual(randomScore(Buffer.concat([ref, work]), '照著畫'));
    expect(randomScore(work, '照著畫', undefined)).toEqual(randomScore(work, '照著畫'));
  });

  it('同參考圖＋同作品＋同題永遠同分；換參考圖通常不同分', async () => {
    const judge = createRandomJudge({ delayMs: 0 });
    const a = await judge.score({ png: png(1), topic: '照著畫', reference: jpeg(1) }, signal());
    expect(await judge.score({ png: png(1), topic: '照著畫', reference: jpeg(1) }, signal())).toEqual(a);
    const outs = new Set<number>();
    for (let k = 0; k < 8; k++) outs.add((await judge.score({ png: png(1), topic: '照著畫', reference: jpeg(k) }, signal())).score);
    expect(outs.size).toBeGreaterThan(1);
  });

  it('佇列：主評分器失敗退回 random 時，退回的分數也含參考圖種子', async () => {
    const clock = new FakeClock();
    const results: JudgeResult[] = [];
    const failing = { mode: 'ai' as const, score: () => Promise.reject(new Error('boom')) };
    const queue = new JudgeQueue({ judge: failing, fallback: createRandomJudge({ delayMs: 0 }), timeoutMs: 1000, clock, onDone: (_j, r) => results.push(r) });
    const ref = jpeg(5);
    const work = png(6);
    queue.push({ playerId: 'p1', input: { png: work, topic: '照著畫', reference: ref } });
    await flush();
    await flush();
    expect(results).toEqual([{ ...randomScore(work, '照著畫', ref), judgedBy: 'random' }]);
    queue.dispose();
  });
});

describe('§6.1 mimic 回合評語（兩張圖、文案逐字）', () => {
  it('mimic 批評版與稱讚版 user 文案', () => {
    expect(mimicUserPrompt('皮卡丘', 66, '小明')).toBe('題目「皮卡丘」，評分 66 分。第一張是參考圖，第二張是參賽者「小明」照著畫的，給一句評語。');
    expect(mimicPraiseUserPrompt('皮卡丘', 94, '小明')).toBe(
      '題目「皮卡丘」，評分 94 分，這張是本回合第一名，參賽者「小明」。第一張是參考圖，第二張是它照著畫的。妳不甘心，但還是得承認它畫得像，用雌小鬼的口氣誇它，一句評語。',
    );
  });

  it('buildChatRequest 帶參考圖：images [參考圖, 作品]、user 文案用 mimic 版；system 與參數不變；不帶時與原本相同', () => {
    const plain = buildChatRequest(COMMENT_MODEL, '蘋果', 70, '小明', 'PNG');
    const mimic = buildChatRequest(COMMENT_MODEL, '皮卡丘', 66, '小明', 'PNG', false, 'REF');
    const praise = buildChatRequest(COMMENT_MODEL, '皮卡丘', 94, '小明', 'PNG', true, 'REF');
    expect(plain.messages[1]).toEqual({ role: 'user', content: commentUserPrompt('蘋果', 70, '小明'), images: ['PNG'] });
    expect(mimic.messages).toEqual([
      { role: 'system', content: COMMENT_SYSTEM_PROMPT },
      { role: 'user', content: mimicUserPrompt('皮卡丘', 66, '小明'), images: ['REF', 'PNG'] },
    ]);
    expect(praise.messages[1]).toEqual({ role: 'user', content: mimicPraiseUserPrompt('皮卡丘', 94, '小明'), images: ['REF', 'PNG'] });
    const { messages: _a, ...restPlain } = plain;
    const { messages: _b, ...restMimic } = mimic;
    expect(restMimic).toEqual(restPlain);
  });

  it('對假 Ollama 送出：兩張圖 bytes 逐位元相同；mimic 稱讚版回稱讚句、批評版回批評句；onCommented 帶 mimic', async () => {
    const m = await mock();
    const onCommented = vi.fn();
    const commentator = createOllamaCommentator({ url: m.url, model: COMMENT_MODEL, onCommented });
    const ref = jpeg(7);
    const work = png(8);
    const criticism = await commentator.comment({ png: work, topic: '皮卡丘', score: 66, nickname: '小明', reference: ref }, signal());
    const praised = await commentator.comment({ png: work, topic: '皮卡丘', score: 94, nickname: '小明', reference: ref, praise: true }, signal());
    expect(MOCK_COMMENTS).toContain(criticism);
    expect(MOCK_PRAISES).toContain(praised);
    const body = m.requests[0].body as { messages: Array<{ images?: string[]; content: string }> };
    const images = body.messages[1].images ?? [];
    expect(images).toHaveLength(2);
    expect(Buffer.from(images[0], 'base64').equals(ref)).toBe(true);
    expect(Buffer.from(images[1], 'base64').equals(work)).toBe(true);
    expect(body.messages[1].content).toBe(mimicUserPrompt('皮卡丘', 66, '小明'));
    expect(onCommented).toHaveBeenCalledWith(expect.objectContaining({ praise: false, mimic: true, comment: criticism }));
    expect(onCommented).toHaveBeenCalledWith(expect.objectContaining({ praise: true, mimic: true, comment: praised }));
  });
});
