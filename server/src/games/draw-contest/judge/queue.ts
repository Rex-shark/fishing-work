// 評分佇列：spec/draw-contest/architecture.md §6「佇列」
// - 一次一張（JUDGE_CONCURRENCY 固定 1）；依加入順序評分。
// - 每張以 JUDGE_TIMEOUT_MS 逾時（AbortSignal 中止）；失敗、逾時或輸出不合法 → 該張改用 fallback（random）評分，
//   並把本回合模式降為 random，本回合剩餘各張直接走 fallback（有界：最壞只多等一次逾時）。
// - discard(playerId)：丟棄該玩家的工作（排隊中直接移除；評分中則中止並忽略結果）。
// - reset()：換回合時整批清空、模式回到主評分器。
// 結果經建構子注入的 onDone 非同步回報（Room 再轉成 onAsyncEffects）。
import { SCORE_MAX, type JudgeMode } from '@fishing-work/shared/draw-contest';
import type { Clock, TimerHandle } from '../room';
import { randomScore } from './random';
import type { Judge, JudgeInput, JudgeOutput } from './types';

export interface JudgeJob {
  playerId: string;
  input: JudgeInput;
}

export interface JudgeResult extends JudgeOutput {
  judgedBy: JudgeMode;
}

/** 主評分器失敗而退回 random 的資訊（給 register 記 log） */
export interface JudgeFallbackInfo {
  playerId: string;
  reason: 'timeout' | 'error' | 'invalid';
  error?: string;
}

export interface JudgeQueueOptions {
  judge: Judge;
  /** 退回用的評分器（random） */
  fallback: Judge;
  /** 單張逾時（毫秒） */
  timeoutMs: number;
  clock: Pick<Clock, 'setTimeout' | 'clearTimeout'>;
  onDone: (job: JudgeJob, result: JudgeResult) => void;
  onFallback?: (info: JudgeFallbackInfo) => void;
}

interface Entry {
  job: JudgeJob;
  /** 被 discard／reset 丟棄後為 true；評分中的結果一律忽略 */
  cancelled: boolean;
  controller: AbortController | null;
}

type Attempt = { kind: 'ok'; out: JudgeOutput } | { kind: 'failed'; reason: JudgeFallbackInfo['reason']; error?: string } | { kind: 'cancelled' };

/** 合法輸出：score 為 0..SCORE_MAX 整數、confidence 為 0..1 的有限數 */
function isValidOutput(out: unknown): out is JudgeOutput {
  if (typeof out !== 'object' || out === null) return false;
  const { score, confidence } = out as Record<string, unknown>;
  return (
    typeof score === 'number' && Number.isInteger(score) && score >= 0 && score <= SCORE_MAX &&
    typeof confidence === 'number' && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1
  );
}

export class JudgeQueue {
  private readonly opts: JudgeQueueOptions;
  private pending: Entry[] = [];
  private current: Entry | null = null;
  /** 本回合是否已退回 random */
  private degraded = false;
  private disposed = false;

  constructor(options: JudgeQueueOptions) {
    this.opts = options;
  }

  /** 本回合目前的評分器模式（主評分器失敗退回後為 fallback 的模式） */
  get mode(): JudgeMode {
    return this.degraded ? this.opts.fallback.mode : this.opts.judge.mode;
  }

  /** 排隊中＋評分中的張數 */
  get size(): number {
    return this.pending.length + (this.current === null ? 0 : 1);
  }

  push(job: JudgeJob): void {
    if (this.disposed) return;
    this.pending.push({ job, cancelled: false, controller: null });
    this.pump();
  }

  /** 丟棄指定玩家的工作（排隊中與評分中皆是）；回傳是否有丟棄 */
  discard(playerId: string): boolean {
    let found = false;
    this.pending = this.pending.filter((e) => {
      if (e.job.playerId !== playerId) return true;
      found = true;
      return false;
    });
    if (this.current !== null && this.current.job.playerId === playerId) {
      this.cancel(this.current);
      found = true;
    }
    return found;
  }

  /** 換回合：清空排隊、中止評分中的那張、模式回到主評分器 */
  reset(): void {
    this.pending = [];
    if (this.current !== null) this.cancel(this.current);
    this.degraded = false;
  }

  dispose(): void {
    this.disposed = true;
    this.reset();
  }

  // ─── 內部 ─────────────────────────────────────────────────────────

  private cancel(entry: Entry): void {
    entry.cancelled = true;
    entry.controller?.abort();
    // 評分中的那張讓出位置：結果回來時會被忽略，下一張立即開始
    if (this.current === entry) {
      this.current = null;
      this.pump();
    }
  }

  private pump(): void {
    if (this.disposed || this.current !== null) return;
    const entry = this.pending.shift();
    if (entry === undefined) return;
    this.current = entry;
    void this.run(entry);
  }

  private async run(entry: Entry): Promise<void> {
    let judgedBy: JudgeMode;
    let attempt: Attempt;
    if (this.degraded) {
      judgedBy = this.opts.fallback.mode;
      attempt = await this.attempt(this.opts.fallback, entry);
    } else {
      judgedBy = this.opts.judge.mode;
      attempt = await this.attempt(this.opts.judge, entry);
      if (attempt.kind === 'failed') {
        this.degraded = true;
        this.opts.onFallback?.({ playerId: entry.job.playerId, reason: attempt.reason, ...(attempt.error ? { error: attempt.error } : {}) });
        judgedBy = this.opts.fallback.mode;
        attempt = await this.attempt(this.opts.fallback, entry);
      }
    }
    if (attempt.kind === 'cancelled' || entry.cancelled) return;
    // fallback 也失敗（理論上不會）：最後手段，以純函式算確定性分數
    const out = attempt.kind === 'ok' ? attempt.out : randomScore(entry.job.input.png, entry.job.input.topic);
    if (attempt.kind === 'failed') judgedBy = 'random';
    this.current = null;
    try {
      this.opts.onDone(entry.job, { score: out.score, confidence: out.confidence, judgedBy });
    } finally {
      this.pump();
    }
  }

  private async attempt(judge: Judge, entry: Entry): Promise<Attempt> {
    if (entry.cancelled) return { kind: 'cancelled' };
    const controller = new AbortController();
    entry.controller = controller;
    let timedOut = false;
    const timer: TimerHandle = this.opts.clock.setTimeout(() => {
      timedOut = true;
      const err = new Error(`評分逾時（${this.opts.timeoutMs} ms）`);
      err.name = 'TimeoutError';
      controller.abort(err);
    }, this.opts.timeoutMs);
    try {
      const out = await judge.score(entry.job.input, controller.signal);
      if (entry.cancelled) return { kind: 'cancelled' };
      if (timedOut) return { kind: 'failed', reason: 'timeout' };
      if (!isValidOutput(out)) return { kind: 'failed', reason: 'invalid' };
      return { kind: 'ok', out };
    } catch (err) {
      if (entry.cancelled) return { kind: 'cancelled' };
      return timedOut ? { kind: 'failed', reason: 'timeout' } : { kind: 'failed', reason: 'error', error: String(err) };
    } finally {
      this.opts.clock.clearTimeout(timer);
      entry.controller = null;
    }
  }
}
