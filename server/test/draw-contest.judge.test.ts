// 評分器：spec/draw-contest/architecture.md §3「評分器環境變數」、§6（random、佇列、index）
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_JUDGE_CONFIG, createJudgeSetup, readJudgeConfig } from '../src/games/draw-contest/judge/index';
import { JudgeQueue, type JudgeFallbackInfo, type JudgeJob, type JudgeResult } from '../src/games/draw-contest/judge/queue';
import { createRandomJudge, fnv1a, randomScore } from '../src/games/draw-contest/judge/random';
import { FakeClock } from './helpers/fakeClock';
import { FnJudge, ManualJudge, flush, makePng } from './helpers/drawContest';

const signal = () => new AbortController().signal;

describe('§6 random 評分器', () => {
  it('FNV-1a 32 位元：已知向量', () => {
    expect(fnv1a(new Uint8Array())).toBe(0x811c9dc5);
    expect(fnv1a(new TextEncoder().encode('a'))).toBe(0xe40c292c);
    expect(fnv1a(new TextEncoder().encode('foobar'))).toBe(0xbf9cf968);
  });

  it('確定性：同一張圖＋同一題永遠同分；換圖或換題通常不同', () => {
    const png = makePng(1);
    expect(randomScore(png, '蘋果')).toEqual(randomScore(Uint8Array.from(png), '蘋果'));
    const outs = new Set<string>();
    for (let i = 0; i < 20; i++) outs.add(JSON.stringify(randomScore(makePng(i), '蘋果')));
    expect(outs.size).toBeGreaterThan(10);
    expect(randomScore(png, '蘋果')).not.toEqual(randomScore(png, '香蕉'));
  });

  it('範圍：score 為 20..95 整數、confidence 為 0.3..0.9；大量樣本涵蓋兩端附近', () => {
    let min = 100;
    let max = 0;
    for (let i = 0; i < 3000; i++) {
      const { score, confidence } = randomScore(makePng(i, 1280, 720, 8 + (i % 5)), `t${i}`);
      expect(Number.isInteger(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(20);
      expect(score).toBeLessThanOrEqual(95);
      expect(confidence).toBeGreaterThanOrEqual(0.3);
      expect(confidence).toBeLessThanOrEqual(0.9);
      min = Math.min(min, score);
      max = Math.max(max, score);
    }
    expect(min).toBeLessThanOrEqual(22);
    expect(max).toBeGreaterThanOrEqual(93);
  });

  it('mode = random；delay 0 立即 resolve，結果等於 randomScore', async () => {
    const j = createRandomJudge({ delayMs: 0 });
    expect(j.mode).toBe('random');
    const png = Buffer.from(makePng(4));
    await expect(j.score({ png, topic: '貓' }, signal())).resolves.toEqual(randomScore(png, '貓'));
  });

  it('假延遲：時間到才 resolve；中途 abort → reject 並清掉計時器；已 abort 直接 reject', async () => {
    const clock = new FakeClock();
    const j = createRandomJudge({ delayMs: 1500, timers: clock });
    const input = { png: Buffer.from(makePng()), topic: '狗' };
    let done = false;
    const p = j.score(input, signal()).then((r) => {
      done = true;
      return r;
    });
    clock.advance(1499);
    await flush();
    expect(done).toBe(false);
    clock.advance(1);
    await expect(p).resolves.toEqual(randomScore(input.png, '狗'));

    const ctrl = new AbortController();
    const p2 = j.score(input, ctrl.signal);
    ctrl.abort();
    await expect(p2).rejects.toThrow();
    expect(clock.timers.size).toBe(0);

    await expect(j.score(input, ctrl.signal)).rejects.toThrow();
  });
});

describe('§6 評分佇列', () => {
  function setup(timeoutMs = 1000) {
    const clock = new FakeClock();
    const judge = new ManualJudge('ai');
    const fallback = new FnJudge(() => ({ score: 33, confidence: 0.3 }), 'random');
    const done: [JudgeJob, JudgeResult][] = [];
    const fallbacks: JudgeFallbackInfo[] = [];
    const queue = new JudgeQueue({
      judge,
      fallback,
      timeoutMs,
      clock,
      onDone: (job, result) => done.push([job, result]),
      onFallback: (info) => fallbacks.push(info),
    });
    const job = (playerId: string): JudgeJob => ({ playerId, input: { png: Buffer.from(makePng()), topic: 't' } });
    return { clock, judge, fallback, done, fallbacks, queue, job };
  }

  it('一次一張、依加入順序；前一張完成才開始下一張', async () => {
    const { judge, done, queue, job } = setup();
    queue.push(job('a'));
    queue.push(job('b'));
    queue.push(job('c'));
    expect(judge.calls).toHaveLength(1);
    expect(queue.size).toBe(3);
    judge.resolveCall(0, 10);
    await flush();
    expect(judge.calls).toHaveLength(2);
    judge.resolveCall(1, 20);
    await flush();
    judge.resolveCall(2, 30);
    await flush();
    expect(done.map(([j, r]) => [j.playerId, r.score, r.judgedBy])).toEqual([
      ['a', 10, 'ai'],
      ['b', 20, 'ai'],
      ['c', 30, 'ai'],
    ]);
    expect(queue.size).toBe(0);
  });

  it('逾時：AbortSignal 中止、該張改 fallback、模式降為 random、剩餘直接走 fallback', async () => {
    const { clock, judge, fallback, done, fallbacks, queue, job } = setup(1000);
    queue.push(job('a'));
    queue.push(job('b'));
    expect(queue.mode).toBe('ai');
    clock.advance(999);
    await flush();
    expect(done).toEqual([]);
    clock.advance(1);
    expect(judge.calls[0].signal.aborted).toBe(true);
    await flush();
    expect(queue.mode).toBe('random');
    expect(fallbacks).toEqual([{ playerId: 'a', reason: 'timeout' }]);
    expect(done.map(([j, r]) => [j.playerId, r.score, r.judgedBy])).toEqual([
      ['a', 33, 'random'],
      ['b', 33, 'random'],
    ]);
    expect(judge.calls).toHaveLength(1);
    expect(fallback.inputs).toHaveLength(2);
    expect(clock.timers.size).toBe(0);
  });

  it('失敗（reject）與輸出不合法 → 退回 fallback', async () => {
    const a = setup();
    a.queue.push(a.job('x'));
    a.judge.calls[0].reject(new Error('連不上'));
    await flush();
    expect(a.fallbacks[0]).toMatchObject({ playerId: 'x', reason: 'error' });
    expect(a.done[0][1]).toEqual({ score: 33, confidence: 0.3, judgedBy: 'random' });

    const b = setup();
    b.queue.push(b.job('y'));
    b.judge.resolveCall(0, 101);
    await flush();
    expect(b.fallbacks[0]).toMatchObject({ playerId: 'y', reason: 'invalid' });
    expect(b.done[0][1].judgedBy).toBe('random');
  });

  it('discard：排隊中的移除；評分中的中止並忽略結果、立即換下一張', async () => {
    const { judge, done, queue, job } = setup();
    queue.push(job('a'));
    queue.push(job('b'));
    queue.push(job('c'));
    expect(queue.discard('b')).toBe(true);
    expect(queue.discard('a')).toBe(true);
    expect(judge.calls[0].signal.aborted).toBe(true);
    expect(judge.calls).toHaveLength(2);
    judge.calls[0].resolve({ score: 99, confidence: 1 });
    judge.resolveCall(1, 44);
    await flush();
    expect(done.map(([j]) => j.playerId)).toEqual(['c']);
    expect(queue.discard('zzz')).toBe(false);
  });

  it('reset：整批清空、模式回到主評分器；dispose 後不再接受工作', async () => {
    const { clock, judge, done, queue, job } = setup(1000);
    queue.push(job('a'));
    clock.advance(1000);
    await flush();
    expect(queue.mode).toBe('random');
    queue.push(job('b'));
    queue.push(job('c'));
    await flush();
    queue.reset();
    expect(queue.mode).toBe('ai');
    queue.push(job('d'));
    expect(judge.calls).toHaveLength(2);
    queue.reset();
    expect(judge.calls[1].signal.aborted).toBe(true);
    await flush();
    queue.dispose();
    queue.push(job('e'));
    expect(judge.calls).toHaveLength(2);
    expect(done.map(([j]) => j.playerId)).toEqual(['a', 'b', 'c']);
  });
});

describe('§3 評分器環境變數', () => {
  it('預設值（JUDGE 預設 ollama，Rex 2026-10-07 定案）', () => {
    expect(readJudgeConfig({}, () => {})).toEqual({
      judge: 'ollama',
      ollamaUrl: 'http://127.0.0.1:11434',
      model: 'clef:27b-nvfp4',
      imageWidth: 640,
      timeoutMs: 30_000,
      fakeDelayMs: 1500,
    });
    expect(DEFAULT_JUDGE_CONFIG.judge).toBe('ollama');
  });

  it('讀取各變數；不合法的值退回預設並 warn', () => {
    const warn = vi.fn();
    expect(
      readJudgeConfig(
        {
          JUDGE: 'Random',
          OLLAMA_URL: 'http://host.docker.internal:11434',
          JUDGE_MODEL: 'clef-flash',
          JUDGE_IMAGE_WIDTH: '320',
          JUDGE_TIMEOUT_MS: '5000',
          JUDGE_FAKE_DELAY_MS: '0',
        },
        warn,
      ),
    ).toEqual({ judge: 'random', ollamaUrl: 'http://host.docker.internal:11434', model: 'clef-flash', imageWidth: 320, timeoutMs: 5000, fakeDelayMs: 0 });
    expect(warn).not.toHaveBeenCalled();
    const cfg = readJudgeConfig({ JUDGE: 'gpt', JUDGE_IMAGE_WIDTH: '0', JUDGE_TIMEOUT_MS: '0', JUDGE_FAKE_DELAY_MS: '-1' }, warn);
    expect(cfg).toMatchObject({ judge: 'ollama', imageWidth: 640, timeoutMs: 30_000, fakeDelayMs: 1500 });
    expect(warn).toHaveBeenCalledTimes(4);
    expect(readJudgeConfig({ JUDGE_IMAGE_WIDTH: '640.5' }, warn).imageWidth).toBe(640);
  });

  it('JUDGE=random：主評分器與 fallback 皆 random、不探測、不 warn、timeoutMs 帶入', () => {
    const warn = vi.fn();
    const fetch = vi.fn();
    const setup = createJudgeSetup({ ...readJudgeConfig({ JUDGE: 'random' }, () => {}), timeoutMs: 1234 }, { warn, fetch });
    expect(setup.judge.mode).toBe('random');
    expect(setup.fallback.mode).toBe('random');
    expect(setup.timeoutMs).toBe(1234);
    expect(setup.probe).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
