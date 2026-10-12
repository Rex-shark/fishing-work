// 評語佇列（Epic 15）：spec/draw-contest/architecture.md §6.1「佇列」、§5「評語」
// - 一次一張、依加入順序；與評分佇列（judge/queue.ts）獨立，寫法比照它。
// - 每張以 COMMENT_TIMEOUT_MS 逾時（AbortSignal 中止）。失敗（逾時、評語器 reject、輸出空白）→ 該張沒有評語，
//   **本回合剩餘各張直接跳過**（不呼叫模型）：當下排隊中的與失敗那張同一批回報，之後 push 的直接回 false。
//   有界：最壞只多等一次逾時。評語沒有退回用的替代品（評分才有 random）。
// - discard(playerId)：丟棄該玩家的工作（排隊中直接移除；產生中則中止並忽略結果），**不算失敗**。
// - reset()：換回合時整批清空（中止在途的那張，不算失敗）、模式回到 'ai'。
// - pushFront(job)：第一名重做稱讚版（§5 評語，Phase 4）用。插到佇列最前面並取代同一玩家既有的工作：
//   排隊中的直接換掉；正在產生的中止（不算失敗、結果忽略），新工作立即接著跑；在途的是別人的就等它跑完才輪到。
// 結果經建構子注入的 onDone 非同步回報（Room 再轉成 onAsyncEffects）；一次回報一批，
// 讓 Room 把「失敗那張＋被跳過的各張」併成同一組效果（§6.1 事件規則 (b)）。
import type { CommentMode } from '@fishing-work/shared/draw-contest';
import type { Clock, TimerHandle } from '../room';

/** 送給評語器的資料（§6.1、Epic 15 決策 4）：交卷原圖、題目、該張最終分數；不給暱稱與名次 */
export interface CommentInput {
  png: Buffer;
  topic: string;
  /** 該張的最終分數 0..SCORE_MAX（Clef 失敗退回 random 時就是 random 的分數） */
  score: number;
  /** true = 第一名稱讚版（§6.1，Phase 4）：user 提示詞改用稱讚版；只有 ended 時的第一名重做會帶，其餘一律不帶 */
  praise?: boolean;
}

/** 評語器：回傳後處理過的一句評語；失敗以 reject 表示，回空字串（或非字串）由佇列視為失敗 */
export interface Commentator {
  comment(input: CommentInput, signal: AbortSignal): Promise<string>;
}

export interface CommentJob {
  playerId: string;
  input: CommentInput;
}

export type CommentFailureReason = 'timeout' | 'error' | 'empty';

export type CommentResult =
  | { status: 'ok'; comment: string }
  | { status: 'failed'; reason: CommentFailureReason; error?: string }
  /** 同一回合前面有一張失敗，這張沒有呼叫模型 */
  | { status: 'skipped' };

export interface CommentDone {
  job: CommentJob;
  result: CommentResult;
}

/** 一張評語失敗的資訊（給 register 記 log）；skipped 為因此被跳過的排隊中玩家；praise 只在失敗的是第一名稱讚版時出現 */
export interface CommentFailureInfo {
  playerId: string;
  reason: CommentFailureReason;
  error?: string;
  skipped: string[];
  praise?: true;
}

export interface CommentQueueOptions {
  /** null = 評語關閉（COMMENT=off）：模式恆為 'off'，push 一律回 false */
  commentator: Commentator | null;
  /** 單張逾時（毫秒） */
  timeoutMs: number;
  clock: Pick<Clock, 'setTimeout' | 'clearTimeout'>;
  /** 成功：一筆；失敗：失敗那張在前，其後為當下排隊中而被跳過的各張（依排隊順序） */
  onDone: (batch: CommentDone[]) => void;
  onFailure?: (info: CommentFailureInfo) => void;
  /** 本回合已失敗後才 push 進來而直接跳過的工作 */
  onSkip?: (info: { playerId: string }) => void;
}

interface Entry {
  job: CommentJob;
  /** 被 discard／reset 丟棄後為 true；產生中的結果一律忽略 */
  cancelled: boolean;
  controller: AbortController | null;
}

type Attempt = { kind: 'ok'; comment: string } | { kind: 'failed'; reason: CommentFailureReason; error?: string } | { kind: 'cancelled' };

export class CommentQueue {
  private readonly opts: CommentQueueOptions;
  private pending: Entry[] = [];
  private current: Entry | null = null;
  /** 本回合是否已有一張失敗（之後各張直接跳過） */
  private failed = false;
  private disposed = false;

  constructor(options: CommentQueueOptions) {
    this.opts = options;
  }

  /** 是否有評語器（false = 環境變數關閉） */
  get enabled(): boolean {
    return this.opts.commentator !== null;
  }

  /** 本回合目前的評語器模式：關閉，或本回合已失敗跳過 → 'off' */
  get mode(): CommentMode {
    return this.enabled && !this.failed ? 'ai' : 'off';
  }

  /** 排隊中＋產生中的張數 */
  get size(): number {
    return this.pending.length + (this.current === null ? 0 : 1);
  }

  /**
   * 排進佇列；回傳是否已排入。false＝這張不會有評語也不會有 onDone（關閉、本回合已失敗跳過、或已 dispose），
   * 呼叫端當場就能把該張定為「沒有評語」（§6.1 事件規則 (a)）。
   */
  push(job: CommentJob): boolean {
    if (this.disposed || !this.enabled) return false;
    if (this.failed) {
      this.opts.onSkip?.({ playerId: job.playerId });
      return false;
    }
    this.pending.push({ job, cancelled: false, controller: null });
    this.pump();
    return true;
  }

  /**
   * 插到佇列最前面，並取代同一玩家既有的工作（第一名重做稱讚版用，§5 評語）；回傳是否已排入（false 的條件與 push 相同）。
   * - 該玩家原本的工作還在排隊 → 換掉（模型只會為他跑新的這一次）。
   * - 該玩家原本的工作正在產生 → 中止（不算失敗、結果忽略、不回報 onDone），新工作立即接著跑：結果反正要丟，不必多等一次模型。
   * - 正在產生的是別人的 → 讓它跑完，新工作排下一個（在其他排隊者之前）。
   */
  pushFront(job: CommentJob): boolean {
    if (this.disposed || !this.enabled) return false;
    if (this.failed) {
      this.opts.onSkip?.({ playerId: job.playerId });
      return false;
    }
    this.pending = this.pending.filter((e) => e.job.playerId !== job.playerId);
    this.pending.unshift({ job, cancelled: false, controller: null });
    // 先插隊再中止：cancel 會讓出位置並立刻 pump，取到的就是剛插進來的這張
    if (this.current !== null && this.current.job.playerId === job.playerId) this.cancel(this.current);
    else this.pump();
    return true;
  }

  /** 丟棄指定玩家的工作（排隊中與產生中皆是，不算失敗）；回傳是否有丟棄 */
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

  /** 換回合：清空排隊、中止產生中的那張（不算失敗）、模式回到 'ai' */
  reset(): void {
    this.pending = [];
    if (this.current !== null) this.cancel(this.current);
    this.failed = false;
  }

  dispose(): void {
    this.disposed = true;
    this.reset();
  }

  // ─── 內部 ─────────────────────────────────────────────────────────

  private cancel(entry: Entry): void {
    entry.cancelled = true;
    entry.controller?.abort();
    // 產生中的那張讓出位置：結果回來時會被忽略，下一張立即開始
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
    const attempt = await this.attempt(entry);
    if (attempt.kind === 'cancelled' || entry.cancelled) return;
    this.current = null;
    const batch: CommentDone[] = [];
    if (attempt.kind === 'ok') {
      batch.push({ job: entry.job, result: { status: 'ok', comment: attempt.comment } });
    } else {
      // 首次失敗：本回合到此為止，排隊中的各張不再呼叫模型
      this.failed = true;
      const skipped = this.pending;
      this.pending = [];
      const detail = attempt.error === undefined ? {} : { error: attempt.error };
      batch.push({ job: entry.job, result: { status: 'failed', reason: attempt.reason, ...detail } });
      for (const e of skipped) batch.push({ job: e.job, result: { status: 'skipped' } });
      this.opts.onFailure?.({
        playerId: entry.job.playerId,
        reason: attempt.reason,
        ...detail,
        skipped: skipped.map((e) => e.job.playerId),
        ...(entry.job.input.praise === true ? { praise: true as const } : {}),
      });
    }
    try {
      this.opts.onDone(batch);
    } finally {
      this.pump();
    }
  }

  private async attempt(entry: Entry): Promise<Attempt> {
    const commentator = this.opts.commentator;
    if (entry.cancelled || commentator === null) return { kind: 'cancelled' };
    const controller = new AbortController();
    entry.controller = controller;
    let timedOut = false;
    const timer: TimerHandle = this.opts.clock.setTimeout(() => {
      timedOut = true;
      const err = new Error(`評語逾時（${this.opts.timeoutMs} ms）`);
      err.name = 'TimeoutError';
      controller.abort(err);
    }, this.opts.timeoutMs);
    try {
      const out: unknown = await commentator.comment(entry.job.input, controller.signal);
      if (entry.cancelled) return { kind: 'cancelled' };
      if (timedOut) return { kind: 'failed', reason: 'timeout' };
      // 空字串視為失敗（§6.1）；評語器已做過後處理，這裡只把關
      if (typeof out !== 'string' || out.trim() === '') return { kind: 'failed', reason: 'empty' };
      return { kind: 'ok', comment: out };
    } catch (err) {
      if (entry.cancelled) return { kind: 'cancelled' };
      return timedOut ? { kind: 'failed', reason: 'timeout' } : { kind: 'failed', reason: 'error', error: String(err) };
    } finally {
      this.opts.clock.clearTimeout(timer);
      entry.controller = null;
    }
  }
}
