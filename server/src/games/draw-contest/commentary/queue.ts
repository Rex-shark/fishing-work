// 評語佇列（Epic 15）：spec/draw-contest/architecture.md §6.1「佇列」、§5「評語」
// - 一次一張、依加入順序；與評分佇列（judge/queue.ts）獨立，寫法比照它。
// - 每張以 COMMENT_TIMEOUT_MS 逾時（AbortSignal 中止）。失敗（逾時、評語器 reject、輸出空白）→ 該張沒有評語。
// - 失敗規則（Phase 5，Rex 2026-10-13）：單次失敗只影響該張，下一張照常呼叫模型；
//   **同一回合連續兩次失敗（中間沒有成功）** 才把本回合剩餘各張直接跳過（不呼叫模型）：當下排隊中的與第二次失敗那張
//   同一批回報，之後 push 的直接回 false，模式變 'off'。有界：最壞多等兩次逾時。
//   連續失敗的計數：成功歸零；失敗 +1（第一名稱讚版失敗也算）；被取消的（discard、排隊中被 pushFront 取代、reset）不加也不歸零；
//   reset（換回合）歸零。
// - 輸入被拒（Epic 21 §5.5，code review #5）：評語器回 HTTP 400／413／415／422（白名單，決策 11）→ 該張沒有評語（照常回報 failed，reason 'rejected'），
//   但**不計入連續失敗**（計數不加也不歸零，與取消相同），所以不會因為一兩張壞圖就跳過整回合。
// - discard(playerId)：丟棄該玩家的所有工作（排隊中直接移除；產生中則中止並忽略結果），**不算失敗**。
// - reset()：換回合時整批清空（中止在途的那張，不算失敗）、連續失敗計數歸零、模式回到 'ai'。
// - pushFront(job)：第一名重做稱讚版（§5 評語，Phase 4）用。插到佇列最前面：同一玩家**排隊中**的工作直接換掉；
//   **在途的那張一律讓它跑完**（不論是別人的還是同一玩家的，Phase 5 改：原本同一玩家在途的會被中止），新工作緊接著跑。
//   所以佇列裡可能同時有同一玩家的兩個工作（在途的批評版＋排隊的稱讚版），兩者各自回報、各自計入成功或失敗；
//   以 job.input.praise 分辨。
// 結果經建構子注入的 onDone 非同步回報（Room 再轉成 onAsyncEffects）；一次回報一批，
// 讓 Room 把「第二次失敗那張＋被跳過的各張」併成同一組效果（§6.1 事件規則 (b)）。
// 佇列只回報「失敗／跳過」，不決定該張最後顯示什麼：第一名稱讚版失敗或被跳過時退回批評版是 Room 的事（room.ts onCommented）。
import type { CommentMode } from '@fishing-work/shared/draw-contest';
import { isInputRejected } from '../judge/httpError';
import type { Clock, TimerHandle } from '../room';

/**
 * 送給評語器的資料（§6.1、Epic 15 決策 4）：交卷原圖、題目、該張最終分數、參賽者暱稱；不給名次。
 * 暱稱 2026-10-21 起給（Phase 7 決策 18，Rex：嘗試看看模型會不會利用名稱）。
 */
export interface CommentInput {
  png: Buffer;
  topic: string;
  /** 該玩家建評語輸入當下的暱稱（已過 validateNickname，不另過濾；Phase 7） */
  nickname: string;
  /** 該張的最終分數 0..SCORE_MAX（Clef 失敗退回 random 時就是 random 的分數） */
  score: number;
  /** true = 第一名稱讚版（§6.1，Phase 4）：user 提示詞改用稱讚版；只有 ended 時的第一名重做會帶，其餘一律不帶 */
  praise?: boolean;
  /** Epic 20 像不像比賽：本回合參考圖 JPEG；有值時 images 為 [參考圖, 交卷 PNG]、user 文案改 mimic 版（§6.1） */
  reference?: Buffer;
}

/** 評語器：回傳後處理過的一句評語；失敗以 reject 表示，回空字串（或非字串）由佇列視為失敗 */
export interface Commentator {
  comment(input: CommentInput, signal: AbortSignal): Promise<string>;
}

export interface CommentJob {
  playerId: string;
  input: CommentInput;
}

/** rejected = 這張輸入被上游拒絕（HTTP 400／413／415／422，白名單）：不計入連續失敗（§5.5） */
export type CommentFailureReason = 'timeout' | 'error' | 'empty' | 'rejected';

/** 同一回合連續失敗達此次數（中間沒有成功）才跳過剩餘各張（§6.1 佇列，Phase 5 由 1 放寬為 2） */
export const COMMENT_MAX_CONSECUTIVE_FAILURES = 2;

export type CommentResult =
  | { status: 'ok'; comment: string }
  | { status: 'failed'; reason: CommentFailureReason; error?: string }
  /** 本回合已連續兩次失敗，這張沒有呼叫模型 */
  | { status: 'skipped' };

export interface CommentDone {
  job: CommentJob;
  result: CommentResult;
}

/**
 * 一張評語失敗的資訊（給 register 記 log）。
 * consecutive：含這張在內，本回合連續失敗的次數（1 = 單次失敗，只影響這張；達 COMMENT_MAX_CONSECUTIVE_FAILURES = 本回合到此為止）；
 * reason 'rejected' 不計入，consecutive 為當下的次數（不含這張，可為 0）。
 * skipped：因此被跳過的排隊中玩家——單次失敗時一律為空陣列，連續第二次失敗時才可能有。
 * praise 只在失敗的是第一名稱讚版時出現。
 */
export interface CommentFailureInfo {
  playerId: string;
  reason: CommentFailureReason;
  error?: string;
  consecutive: number;
  skipped: string[];
  praise?: true;
}

export interface CommentQueueOptions {
  /** null = 評語關閉（COMMENT=off）：模式恆為 'off'，push 一律回 false */
  commentator: Commentator | null;
  /** 單張逾時（毫秒） */
  timeoutMs: number;
  clock: Pick<Clock, 'setTimeout' | 'clearTimeout'>;
  /**
   * 成功：一筆；單次失敗：失敗那張一筆；連續第二次失敗：失敗那張在前，其後為當下排隊中而被跳過的各張（依排隊順序）。
   * 呼叫當下 mode 已是最新（連續第二次失敗的那一批，mode 已為 'off'）。
   */
  onDone: (batch: CommentDone[]) => void;
  onFailure?: (info: CommentFailureInfo) => void;
  /** 本回合已連續兩次失敗後才 push 進來而直接跳過的工作 */
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
  /** 本回合目前連續失敗的次數（成功歸零；取消不動；reset 歸零） */
  private failures = 0;
  private disposed = false;

  constructor(options: CommentQueueOptions) {
    this.opts = options;
  }

  /** 是否有評語器（false = 環境變數關閉） */
  get enabled(): boolean {
    return this.opts.commentator !== null;
  }

  /** 本回合是否已連續兩次失敗（之後各張直接跳過） */
  private get tripped(): boolean {
    return this.failures >= COMMENT_MAX_CONSECUTIVE_FAILURES;
  }

  /** 本回合目前的評語器模式：關閉，或本回合已連續兩次失敗 → 'off'；只失敗一次仍是 'ai' */
  get mode(): CommentMode {
    return this.enabled && !this.tripped ? 'ai' : 'off';
  }

  /** 排隊中＋產生中的張數 */
  get size(): number {
    return this.pending.length + (this.current === null ? 0 : 1);
  }

  /**
   * 排進佇列；回傳是否已排入。false＝這張不會有評語也不會有 onDone（關閉、本回合已連續兩次失敗、或已 dispose），
   * 呼叫端當場就能把該張定為「沒有評語」（§6.1 事件規則 (a)）。
   */
  push(job: CommentJob): boolean {
    if (this.disposed || !this.enabled) return false;
    if (this.tripped) {
      this.opts.onSkip?.({ playerId: job.playerId });
      return false;
    }
    this.pending.push({ job, cancelled: false, controller: null });
    this.pump();
    return true;
  }

  /**
   * 插到佇列最前面（第一名重做稱讚版用，§5 評語）；回傳是否已排入（false 的條件與 push 相同）。
   * - 該玩家原本的工作還在排隊 → 換掉（模型只會為他跑新的這一次；被換掉的不回報、不計入連續失敗）。
   * - 該玩家原本的工作正在產生 → **讓它跑完**（Phase 5，Rex 2026-10-13：那句批評版留給 Room 當稱讚版失敗的退路），
   *   照常經 onDone 回報、照常計入成功或失敗；新工作排下一個。
   * - 正在產生的是別人的 → 同樣讓它跑完，新工作排下一個（在其他排隊者之前）。
   */
  pushFront(job: CommentJob): boolean {
    if (this.disposed || !this.enabled) return false;
    if (this.tripped) {
      this.opts.onSkip?.({ playerId: job.playerId });
      return false;
    }
    this.pending = this.pending.filter((e) => e.job.playerId !== job.playerId);
    this.pending.unshift({ job, cancelled: false, controller: null });
    // 有在途的就等它跑完（pump 不動）；佇列閒置則立即開始
    this.pump();
    return true;
  }

  /** 丟棄指定玩家的所有工作（排隊中與產生中皆是——第一名可能兩者各有一張；不算失敗）；回傳是否有丟棄 */
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

  /** 換回合：清空排隊、中止產生中的那張（不算失敗）、連續失敗計數歸零（模式回到 'ai'） */
  reset(): void {
    this.pending = [];
    if (this.current !== null) this.cancel(this.current);
    this.failures = 0;
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
    // 被取消的（discard、reset）到此為止：不回報，連續失敗計數不加也不歸零
    if (attempt.kind === 'cancelled' || entry.cancelled) return;
    this.current = null;
    const batch: CommentDone[] = [];
    if (attempt.kind === 'ok') {
      this.failures = 0;
      batch.push({ job: entry.job, result: { status: 'ok', comment: attempt.comment } });
    } else {
      // 輸入被拒（4xx）只讓這張沒有評語，不計入連續失敗（§5.5）
      if (attempt.reason !== 'rejected') this.failures += 1;
      // 單次失敗只影響這張，排隊中的照常跑；連續第二次失敗：本回合到此為止，排隊中的各張不再呼叫模型
      let skipped: Entry[] = [];
      if (this.tripped) {
        skipped = this.pending;
        this.pending = [];
      }
      const detail = attempt.error === undefined ? {} : { error: attempt.error };
      batch.push({ job: entry.job, result: { status: 'failed', reason: attempt.reason, ...detail } });
      for (const e of skipped) batch.push({ job: e.job, result: { status: 'skipped' } });
      this.opts.onFailure?.({
        playerId: entry.job.playerId,
        reason: attempt.reason,
        ...detail,
        consecutive: this.failures,
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
      if (timedOut) return { kind: 'failed', reason: 'timeout' };
      return { kind: 'failed', reason: isInputRejected(err) ? 'rejected' : 'error', error: String(err) };
    } finally {
      this.opts.clock.clearTimeout(timer);
      entry.controller = null;
    }
  }
}
