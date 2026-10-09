// 隨機評分器：spec/draw-contest/architecture.md §6「random」
// 種子 = FNV-1a(png bytes ‖ topic 的 UTF-8)，同一張圖＋同一題永遠同分（測試可重現）；
// score 為 20..95 的整數（均勻）、confidence 為 0.3..0.9（兩位小數）；JUDGE_FAKE_DELAY_MS 後才 resolve，期間尊重 AbortSignal。
import type { Clock } from '../room';
import type { Judge, JudgeInput, JudgeOutput } from './types';

/** random 評分器的分數範圍（spec §6：均勻 20 ～ 95） */
export const RANDOM_SCORE_MIN = 20;
export const RANDOM_SCORE_MAX = 95;
/** random 評分器的信心值範圍（spec §6：0.3 ～ 0.9） */
export const RANDOM_CONFIDENCE_MIN = 0.3;
export const RANDOM_CONFIDENCE_MAX = 0.9;

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a 32 位元；可接續上一段的雜湊值（hash 參數）以串接多段 bytes */
export function fnv1a(bytes: Uint8Array, hash = FNV_OFFSET): number {
  let h = hash >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32：32 位元種子的小型 PRNG，回傳 [0, 1) */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const encoder = new TextEncoder();

/** 確定性的隨機分數（純函式）：同一張圖＋同一題永遠回同樣的結果 */
export function randomScore(png: Uint8Array, topic: string): JudgeOutput {
  const seed = fnv1a(encoder.encode(topic), fnv1a(png));
  const next = mulberry32(seed);
  const score = RANDOM_SCORE_MIN + Math.floor(next() * (RANDOM_SCORE_MAX - RANDOM_SCORE_MIN + 1));
  const raw = RANDOM_CONFIDENCE_MIN + next() * (RANDOM_CONFIDENCE_MAX - RANDOM_CONFIDENCE_MIN);
  const confidence = Math.round(raw * 100) / 100;
  return { score, confidence };
}

/** 中止原因：signal.reason 為 Error 時沿用，否則包成 AbortError */
export function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  if (reason instanceof Error) return reason;
  const err = new Error('評分已中止');
  err.name = 'AbortError';
  return err;
}

export interface RandomJudgeOptions {
  /** 假延遲（毫秒）；0 = 不等計時器，下一個 microtask 就 resolve */
  delayMs: number;
  /** 計時器（測試注入假時鐘）；預設 Node 的 setTimeout */
  timers?: Pick<Clock, 'setTimeout' | 'clearTimeout'>;
}

const nodeTimers: Pick<Clock, 'setTimeout' | 'clearTimeout'> = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createRandomJudge(options: RandomJudgeOptions): Judge {
  const timers = options.timers ?? nodeTimers;
  const delayMs = Math.max(0, options.delayMs);
  return {
    mode: 'random',
    score(input: JudgeInput, signal: AbortSignal): Promise<JudgeOutput> {
      if (signal.aborted) return Promise.reject(abortReason(signal));
      const result = randomScore(input.png, input.topic);
      if (delayMs === 0) return Promise.resolve(result);
      return new Promise((resolve, reject) => {
        const onAbort = () => {
          timers.clearTimeout(handle);
          reject(abortReason(signal));
        };
        const handle = timers.setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve(result);
        }, delayMs);
        signal.addEventListener('abort', onAbort, { once: true });
      });
    },
  };
}
