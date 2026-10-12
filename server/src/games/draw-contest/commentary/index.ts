// 依環境變數建立評語器（Epic 15）：spec/draw-contest/architecture.md §3「評分器環境變數」、§6.1「啟動」
// COMMENT（ollama｜off，預設 ollama）、COMMENT_MODEL、COMMENT_TIMEOUT_MS；位址沿用 OLLAMA_URL。
// COMMENT=ollama：啟動時非同步探測一次（GET /api/tags，不阻塞啟動、只 log）；清單裡有模型就背景暖機一次
// （不帶圖的極短 chat＋keep_alive，冷啟動載入 9～17 秒，不暖機第一回合第一張會等）。
// 探測或暖機失敗都**不**永久關閉——每回合仍先試，失敗由佇列讓該回合剩餘各張跳過，所以 Ollama 晚開不必重啟 server。
import { log } from '../../../lib/log';
import { DEFAULT_JUDGE_CONFIG, PROBE_TIMEOUT_MS } from '../judge/index';
import { probeOllama, type FetchLike, type ProbeResult } from '../judge/ollama';
import { createOllamaCommentator, warmupChat, type WarmupResult } from './ollamaChat';
import type { Commentator } from './queue';

export type { CommentInput, Commentator } from './queue';

export const DEFAULT_COMMENT_CONFIG = {
  comment: 'ollama',
  /** 與評分器共用 OLLAMA_URL（唯一來源：judge/index.ts） */
  ollamaUrl: DEFAULT_JUDGE_CONFIG.ollamaUrl,
  model: 'gemma4:26b-mlx-bf16',
  timeoutMs: 20_000,
} as const;

/** 暖機逾時（毫秒）：冷啟動載入實測 9～17 秒，留足餘裕；只為 log，不影響評語 */
export const WARMUP_TIMEOUT_MS = 60_000;

export type CommentKind = 'ollama' | 'off';

export interface CommentConfig {
  comment: CommentKind;
  ollamaUrl: string;
  model: string;
  timeoutMs: number;
}

/** Room 使用的評語器組合：評語器（null = 關閉）、單張逾時 */
export interface CommentSetup {
  commentator: Commentator | null;
  timeoutMs: number;
  /** COMMENT=ollama 時的啟動探測（完成後已 log；測試可 await）；off 時不存在 */
  probe?: Promise<ProbeResult>;
  /** COMMENT=ollama 時的背景暖機（探測成功才送；null = 探測失敗而未暖機）；off 時不存在 */
  warmup?: Promise<WarmupResult | null>;
}

type Logger = (event: string, fields?: Record<string, unknown>) => void;

/** 讀環境變數（未設或不合法時用預設值；不合法者 log warn） */
export function readCommentConfig(env: NodeJS.ProcessEnv = process.env, warn: Logger = log.warn): CommentConfig {
  const rawComment = (env.COMMENT ?? '').trim().toLowerCase();
  let comment: CommentKind = DEFAULT_COMMENT_CONFIG.comment;
  if (rawComment === 'ollama' || rawComment === 'off') comment = rawComment;
  else if (rawComment !== '') warn('draw-contest.comment.envInvalid', { name: 'COMMENT', value: env.COMMENT, using: comment });

  let timeoutMs: number = DEFAULT_COMMENT_CONFIG.timeoutMs;
  const rawTimeout = env.COMMENT_TIMEOUT_MS;
  if (rawTimeout !== undefined && rawTimeout.trim() !== '') {
    const n = Number(rawTimeout);
    if (Number.isInteger(n) && n >= 1) timeoutMs = n;
    else warn('draw-contest.comment.envInvalid', { name: 'COMMENT_TIMEOUT_MS', value: rawTimeout, using: timeoutMs });
  }
  return {
    comment,
    ollamaUrl: env.OLLAMA_URL?.trim() || DEFAULT_COMMENT_CONFIG.ollamaUrl,
    model: env.COMMENT_MODEL?.trim() || DEFAULT_COMMENT_CONFIG.model,
    timeoutMs,
  };
}

export interface CommentSetupOptions {
  warn?: Logger;
  info?: Logger;
  /** 測試注入（評語、探測、暖機共用）；預設全域 fetch */
  fetch?: FetchLike;
  probeTimeoutMs?: number;
  warmupTimeoutMs?: number;
}

/** 依設定建立評語器組合；COMMENT=ollama 時非同步探測一次，模型在就背景暖機一次 */
export function createCommentSetup(config: CommentConfig, options: CommentSetupOptions = {}): CommentSetup {
  const warn = options.warn ?? log.warn;
  const info = options.info ?? log.info;
  if (config.comment !== 'ollama') return { commentator: null, timeoutMs: config.timeoutMs };

  const shared = { url: config.ollamaUrl, model: config.model, ...(options.fetch ? { fetch: options.fetch } : {}) };
  const commentator = createOllamaCommentator({
    ...shared,
    // praise：true = 第一名稱讚版（§5 評語，Phase 4），false = 一般（批評版）
    onCommented: ({ topic, score, praise, comment, chars, ms, promptTokens, evalTokens }) =>
      info('draw-contest.comment.done', {
        topic,
        score,
        praise,
        chars,
        ms,
        ...(promptTokens !== undefined ? { promptTokens } : {}),
        ...(evalTokens !== undefined ? { evalTokens } : {}),
        comment,
      }),
  });
  const probe = probeOllama({ ...shared, timeoutMs: options.probeTimeoutMs ?? PROBE_TIMEOUT_MS }).then((result) => {
    if (result.ok) info('draw-contest.comment.ollamaReady', { ollamaUrl: config.ollamaUrl, model: config.model });
    else
      warn('draw-contest.comment.commentUnavailable', {
        reason: result.reason,
        ollamaUrl: config.ollamaUrl,
        model: config.model,
        note: '每回合仍先試評語，失敗該回合剩餘各張跳過；Ollama 之後才開不用重啟。沒有這個模型的機器請設 COMMENT=off',
      });
    return result;
  });
  const warmup = probe.then(async (result) => {
    if (!result.ok) return null;
    const warmed = await warmupChat({ ...shared, timeoutMs: options.warmupTimeoutMs ?? WARMUP_TIMEOUT_MS });
    if (warmed.ok) info('draw-contest.comment.warmup', { model: config.model, ms: warmed.ms, ...(warmed.loadMs !== undefined ? { loadMs: warmed.loadMs } : {}) });
    else warn('draw-contest.comment.warmupFailed', { model: config.model, ms: warmed.ms, reason: warmed.reason });
    return warmed;
  });
  return { commentator, timeoutMs: config.timeoutMs, probe, warmup };
}

/** 讀環境變數並建立評語器組合（register 的預設） */
export function commentSetupFromEnv(env: NodeJS.ProcessEnv = process.env, warn: Logger = log.warn): CommentSetup {
  const config = readCommentConfig(env, warn);
  log.info('draw-contest.comment.config', {
    comment: config.comment,
    ...(config.comment === 'ollama' ? { ollamaUrl: config.ollamaUrl, model: config.model, timeoutMs: config.timeoutMs } : {}),
  });
  return createCommentSetup(config, { warn });
}
