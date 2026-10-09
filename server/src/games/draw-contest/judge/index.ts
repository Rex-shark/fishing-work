// 依環境變數建立評分器：spec/draw-contest/architecture.md §3「評分器環境變數」、§6
// JUDGE（ollama｜random，預設 ollama）、OLLAMA_URL、JUDGE_MODEL、JUDGE_IMAGE_WIDTH、JUDGE_TIMEOUT_MS、JUDGE_FAKE_DELAY_MS。
// JUDGE=ollama：主評分器為 Clef（ollama.ts）、fallback 為 random。啟動時非同步探測一次（不阻塞啟動、只 log）；
// 探測失敗也**不**永久改成 random——每回合仍先試 ollama，連不上會很快失敗並由佇列退回 random（本回合剩餘走 random），
// 所以 Ollama 之後才開也不用重啟 server。
import { log } from '../../../lib/log';
import type { Clock } from '../room';
import { createOllamaJudge, probeOllama, type FetchLike, type ProbeResult } from './ollama';
import { createRandomJudge } from './random';
import type { Judge } from './types';

export type { Judge, JudgeInput, JudgeOutput } from './types';

export const DEFAULT_JUDGE_CONFIG = {
  judge: 'ollama',
  ollamaUrl: 'http://127.0.0.1:11434',
  model: 'clef:27b-q4_k_m',
  imageWidth: 640,
  timeoutMs: 30_000,
  fakeDelayMs: 1500,
} as const;

/** 啟動探測的逾時（毫秒）：只為 log，不影響評分 */
export const PROBE_TIMEOUT_MS = 3000;

export type JudgeKind = 'random' | 'ollama';

export interface JudgeConfig {
  judge: JudgeKind;
  ollamaUrl: string;
  model: string;
  imageWidth: number;
  timeoutMs: number;
  fakeDelayMs: number;
}

/** Room 使用的評分器組合：主評分器、退回用的 random、單張逾時 */
export interface JudgeSetup {
  judge: Judge;
  fallback: Judge;
  timeoutMs: number;
  /** JUDGE=ollama 時的啟動探測（完成後已 log；測試可 await）；random 時不存在 */
  probe?: Promise<ProbeResult>;
}

type Logger = (event: string, fields?: Record<string, unknown>) => void;

/** 整數環境變數（≥ min）；空字串、非整數、小於 min → 預設值並 warn */
function readInt(env: NodeJS.ProcessEnv, name: string, fallback: number, warn: Logger, min: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) {
    warn('draw-contest.judge.envInvalid', { name, value: raw, using: fallback });
    return fallback;
  }
  return n;
}

/** 讀環境變數（未設或不合法時用預設值；不合法者 log warn） */
export function readJudgeConfig(env: NodeJS.ProcessEnv = process.env, warn: Logger = log.warn): JudgeConfig {
  const rawJudge = (env.JUDGE ?? '').trim().toLowerCase();
  let judge: JudgeKind = DEFAULT_JUDGE_CONFIG.judge;
  if (rawJudge === 'random' || rawJudge === 'ollama') judge = rawJudge;
  else if (rawJudge !== '') warn('draw-contest.judge.envInvalid', { name: 'JUDGE', value: env.JUDGE, using: judge });
  return {
    judge,
    ollamaUrl: env.OLLAMA_URL?.trim() || DEFAULT_JUDGE_CONFIG.ollamaUrl,
    model: env.JUDGE_MODEL?.trim() || DEFAULT_JUDGE_CONFIG.model,
    imageWidth: readInt(env, 'JUDGE_IMAGE_WIDTH', DEFAULT_JUDGE_CONFIG.imageWidth, warn, 1),
    timeoutMs: readInt(env, 'JUDGE_TIMEOUT_MS', DEFAULT_JUDGE_CONFIG.timeoutMs, warn, 1),
    fakeDelayMs: readInt(env, 'JUDGE_FAKE_DELAY_MS', DEFAULT_JUDGE_CONFIG.fakeDelayMs, warn, 0),
  };
}

export interface JudgeSetupOptions {
  timers?: Pick<Clock, 'setTimeout' | 'clearTimeout'>;
  warn?: Logger;
  info?: Logger;
  /** 測試注入（評分與探測共用）；預設全域 fetch */
  fetch?: FetchLike;
  probeTimeoutMs?: number;
}

/** 依設定建立評分器組合；JUDGE=ollama 時主評分器為 ollama、fallback 為 random，並非同步探測一次 */
export function createJudgeSetup(config: JudgeConfig, options: JudgeSetupOptions = {}): JudgeSetup {
  const warn = options.warn ?? log.warn;
  const info = options.info ?? log.info;
  const random = createRandomJudge({ delayMs: config.fakeDelayMs, timers: options.timers });
  if (config.judge !== 'ollama') return { judge: random, fallback: random, timeoutMs: config.timeoutMs };

  const ollama = createOllamaJudge({
    url: config.ollamaUrl,
    model: config.model,
    imageWidth: config.imageWidth,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    onScored: ({ topic, raw, out, ms, inputTokens }) =>
      info('draw-contest.judge.scored', { topic, ...raw, score: out.score, confidence: out.confidence, ms, ...(inputTokens !== undefined ? { inputTokens } : {}) }),
  });
  const probe = probeOllama({
    url: config.ollamaUrl,
    model: config.model,
    timeoutMs: options.probeTimeoutMs ?? PROBE_TIMEOUT_MS,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  }).then((result) => {
    if (result.ok) info('draw-contest.judge.ollamaReady', { ollamaUrl: config.ollamaUrl, model: config.model });
    else
      warn('draw-contest.judge.ollamaUnavailable', {
        reason: result.reason,
        ollamaUrl: config.ollamaUrl,
        model: config.model,
        note: '每回合仍先試 ollama，失敗該回合退回隨機評分；Ollama 之後才開不用重啟',
      });
    return result;
  });
  return { judge: ollama, fallback: random, timeoutMs: config.timeoutMs, probe };
}

/** 讀環境變數並建立評分器組合（register 的預設） */
export function judgeSetupFromEnv(env: NodeJS.ProcessEnv = process.env, warn: Logger = log.warn): JudgeSetup {
  const config = readJudgeConfig(env, warn);
  log.info('draw-contest.judge.config', {
    judge: config.judge,
    timeoutMs: config.timeoutMs,
    ...(config.judge === 'ollama'
      ? { ollamaUrl: config.ollamaUrl, model: config.model, imageWidth: config.imageWidth }
      : { fakeDelayMs: config.fakeDelayMs }),
  });
  return createJudgeSetup(config, { warn });
}
