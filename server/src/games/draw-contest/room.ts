// 複製自 draw-guess/room.ts @ commit a0587dd，獨立演進（加入／接管／寬限／暱稱／ROOM_FULL／Effect 模式／注入時鐘；不共用程式）。
//
// 繪圖比賽 Room 狀態機（純邏輯，不依賴 socket.io）：spec/draw-contest/architecture.md §5、§6
// 每個方法回傳「要送出的效果」（Effect[]），由 register.ts 負責實際 emit / 斷線。
// 計時器觸發的轉移（寬限期到期、出題期限、交卷期限、交卷寬限）與評分／評語佇列的結果沒有呼叫端可回傳，改走建構子注入的 onAsyncEffects。
//
// 回合：idle → choosing → drawing → judging → ended（ended 視同 idle，可再 volunteer）。
// - choosing：出題期限計時；逾時／cancel／出題者離開 → idle（results、lastTopic 保留）。
// - drawing：roundNo++、參賽者＝此刻在線者；交卷期限計時。全員交卷或期限到 → judging。
// - judging：endsAt 對外為 null，內部另存交卷期限（submitDeadline）做寬限判斷；
//   佇列清空且（全員交卷 或 寬限已過）→ ended。
// - ended：results（ranking.ts）、lastTopic＝本回合題目、總分累加、每位交卷者一則 contest:gallery。
//
// 評語（Epic 15，§5「評語」、§6.1）：每張評分完成的瞬間排進評語佇列（commentary/queue.ts，與評分佇列獨立）。
// - ended **不等評語**：揭曉當下已完成的寫進 results.comment，未完成者 commentPending=true，
//   之後每完成一張廣播 contest:comment 並同步更新 round.results（中途加入者的快照即為最新）。
// - 第一名重做稱讚版（Phase 4）：名次到 ended 才有，所以揭曉時把第一名的評語重設為 pending、以稱讚版提示詞插隊重做。
//   稱讚版失敗或被跳過時退回他原本的批評版（Phase 5，Rex 2026-10-13）：揭曉當下已產生的那句，或揭曉時在途、之後跑完的那句；
//   都沒有（原工作仍在排隊而被稱讚版取代、或批評版自己也失敗）才是 null，不補跑批評版。
// - 失敗規則（Phase 5）：單張失敗只影響該張；同一回合連續兩次失敗才跳過剩餘各張並把 commentMode 改 'off'。
// - commentMode 生命週期同 judgeMode：judging 起有值，關閉或本回合已連續兩次失敗後為 'off'。
// - 丟棄只發生在 drawing／judging（參賽者離開）與換回合；ended 之後離開的人評語照常跑完並廣播。
import { randomUUID } from 'node:crypto';
import {
  CHAT_HISTORY,
  CHAT_MIN_INTERVAL_MS,
  CHOOSING_SECONDS,
  DRAW_SECONDS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  NICKNAME_TAKEN_MESSAGE,
  RECONNECT_GRACE_SECONDS,
  SUBMIT_GRACE_SECONDS,
  TOPIC_INVALID_MESSAGE,
  nicknameKey,
  validateNickname,
  validateTopic,
  type Ack,
  type ChatKind,
  type ChatMessage,
  type CommentUpdate,
  type ErrorCode,
  type GalleryImage,
  type JoinResult,
  type PlayerPublic,
  type ResultEntry,
  type RoomSnapshot,
  type RoundPublic,
  type ServerToClientEvents,
} from '@fishing-work/shared/draw-contest';
import { CHAT_ERROR_MESSAGES, validateChatText } from './chat';
import { CommentQueue, type CommentDone, type CommentFailureInfo, type CommentJob, type Commentator } from './commentary/queue';
import { JudgeQueue, type JudgeFallbackInfo, type JudgeJob, type JudgeResult } from './judge/queue';
import { createRandomJudge } from './judge/random';
import type { Judge } from './judge/types';
import { rankResults, type JudgedSubmission } from './ranking';
import { copyToArrayBuffer, checkSubmission } from './submission';

// ─── 時鐘與計時器抽象（測試注入假時鐘） ─────────────────────────────

/** 計時器把手：由 Clock 實作決定型別，Room 只負責保存並交回 clearTimeout */
export type TimerHandle = unknown;

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

// ─── 效果（Effect） ────────────────────────────────────────────────

export type ServerEventName = keyof ServerToClientEvents;
export type ServerEventPayload<K extends ServerEventName> = Parameters<ServerToClientEvents[K]>[0];

/** 收件者，以 **player id** 表示（不是 socket id）；只會送給目前連線中的玩家 */
export type Audience = 'all' | { except: string } | { only: string };

/** 送出一個事件（payload 在效果建立時即定格） */
export type EmitEffect = {
  [K in ServerEventName]: {
    kind: 'emit';
    to: Audience;
    event: K;
    payload: ServerEventPayload<K>;
  };
}[ServerEventName];

/** 強制斷開某條 socket（接管時踢掉舊連線）。此 socket 已先從 Room 解除綁定，其 disconnect 不會再觸發寬限邏輯 */
export interface DisconnectEffect {
  kind: 'disconnect';
  socketId: string;
}

export type Effect = EmitEffect | DisconnectEffect;

export interface Recipient {
  playerId: string;
  socketId: string;
}

// ─── 設定與結果型別 ───────────────────────────────────────────────

/** 各計時長度（毫秒）；正式環境一律用 shared 常數，測試可覆寫 */
export interface RoomDurations {
  graceMs: number;
  choosingMs: number;
  drawMs: number;
  /** endsAt 後仍接受交卷的寬限 */
  submitGraceMs: number;
}

export const DEFAULT_DURATIONS: Readonly<RoomDurations> = {
  graceMs: RECONNECT_GRACE_SECONDS * 1000,
  choosingMs: CHOOSING_SECONDS * 1000,
  drawMs: DRAW_SECONDS * 1000,
  submitGraceMs: SUBMIT_GRACE_SECONDS * 1000,
};

export const GRACE_MS = DEFAULT_DURATIONS.graceMs;

/** 評分器組合（judge/index.ts 的 JudgeSetup 同形） */
export interface RoomJudgeSetup {
  judge: Judge;
  fallback: Judge;
  timeoutMs: number;
}

/** 評語器組合（commentary/index.ts 的 CommentSetup 同形）；commentator 為 null = 關閉（COMMENT=off） */
export interface RoomCommentSetup {
  commentator: Commentator | null;
  timeoutMs: number;
}

/**
 * 一張評語失敗的通知（register 記 log `draw-contest.comment.failed`）：佇列的失敗資訊，
 * 失敗的是第一名稱讚版（praise: true）時多帶 fallback——'criticism' = 已退回批評版，null = 沒有退路（§5 評語，Phase 5）。
 */
export type RoomCommentFailureInfo = CommentFailureInfo & { fallback?: 'criticism' | null };

export interface RoomOptions {
  clock?: Clock;
  /** 產生 player id 與 token（預設 crypto.randomUUID；測試注入可預期的值） */
  newId?: () => string;
  /** 計時器觸發的轉移與評分結果所產生的效果 */
  onAsyncEffects?: (effects: Effect[]) => void;
  /** 覆寫計時長度（e2e 測試用） */
  durations?: Partial<RoomDurations>;
  /** 評分器（預設：無延遲的 random、逾時 30 秒）；正式環境由 register 依環境變數建立 */
  judge?: RoomJudgeSetup;
  /** 主評分器失敗退回 random 時通知（register 記 log） */
  onJudgeFallback?: (info: JudgeFallbackInfo) => void;
  /** 評語器（Epic 15；預設關閉，等同 COMMENT=off）；正式環境由 register 依環境變數建立 */
  comment?: RoomCommentSetup;
  /** 一張評語失敗時通知（register 記 log）；連續第二次失敗時 info.skipped 為因此被跳過的各張，單次失敗為空陣列 */
  onCommentFailure?: (info: RoomCommentFailureInfo) => void;
  /** 本回合已連續兩次失敗後才評完的交卷直接跳過評語時通知（register 記 log） */
  onCommentSkip?: (info: { playerId: string }) => void;
}

export interface JoinOutcome {
  ack: Ack<JoinResult>;
  effects: Effect[];
}

export interface ActionOutcome {
  ack: Ack;
  effects: Effect[];
}

export interface SubmitOutcome {
  ack: Ack<{ bytes: number }>;
  effects: Effect[];
}

/** 回合相關錯誤的繁中訊息（ack.message，客戶端直接顯示）；§5.4，其餘與我畫你猜同文案 */
export const ROUND_ERROR_MESSAGES = {
  NOT_IN_ROOM: '請先加入房間',
  ROUND_BUSY: '目前已有回合進行中',
  NOT_SETTER: '只有本回合的出題者可以這麼做',
  NOT_ENOUGH_PLAYERS: `至少要 ${MIN_PLAYERS} 位在線玩家才能開始`,
  NOT_DRAWING: '現在不是作畫時間',
  NOT_PARTICIPANT: '你不是本回合的參賽者',
  ALREADY_SUBMITTED: '你已經交卷了',
  SUBMISSION_INVALID: '圖片格式不正確或太大',
  ROOM_FULL: `房間已滿（上限 ${MAX_PLAYERS} 人），請稍後再試`,
} as const satisfies Partial<Record<ErrorCode, string>>;

/** abort 的觸發原因（choosing → idle） */
type AbortCause = 'cancel' | 'timeout' | 'setterLeft';

interface PlayerState {
  id: string;
  token: string;
  nickname: string;
  score: number;
  joinedAt: number;
  /** 目前綁定的 socket；null = 斷線中（寬限期） */
  socketId: string | null;
  graceTimer: TimerHandle | null;
  /** 最後一則被接受的聊天訊息時間（間隔限制用；被拒的訊息不更新） */
  lastChatAt: number | null;
}

interface Submission {
  playerId: string;
  /** PNG bytes（獨立複本）；評分與 contest:gallery 共用 */
  png: ArrayBuffer;
  submittedAt: number;
  /** 評分結果；null = 尚在佇列 */
  result: JudgeResult | null;
  /** 評語（Epic 15）：成功為字串；關閉、失敗、跳過或尚未產生為 null */
  comment: string | null;
  /** true = 已排進評語佇列、尚未完成 */
  commentPending: boolean;
  /**
   * 第一名稱讚版（§5 評語）：非 null = 揭曉時已排進稱讚版、尚未有結果；其餘（含稱讚版已完成）為 null。
   * fallback 是稱讚版失敗或被跳過時要退回的批評版（Phase 5）：揭曉當下 comment 已是字串就是那句；
   * 揭曉時批評版正在產生，則等它跑完由 onCommented 補上；都沒有為 null。
   */
  praise: { fallback: string | null } | null;
}

/** idle 回合；roundNo、results、lastTopic 沿用上一回合（畫廊停著，§5 欄位生命週期） */
function idleRound(roundNo: number, results: ResultEntry[] | null, lastTopic: string | null): RoundPublic {
  return {
    roundNo,
    phase: 'idle',
    setterId: null,
    topic: null,
    startedAt: null,
    endsAt: null,
    participantIds: [],
    submittedCount: 0,
    judgedCount: 0,
    judgeMode: null,
    commentMode: null,
    results,
    lastTopic,
  };
}

/** 定格複本（陣列與結果物件都複製，之後狀態改變不影響已送出的效果） */
function freezeRound(r: RoundPublic): RoundPublic {
  return {
    ...r,
    participantIds: [...r.participantIds],
    results: r.results === null ? null : r.results.map((e) => ({ ...e })),
  };
}

function fail(error: keyof typeof ROUND_ERROR_MESSAGES): ActionOutcome {
  return { ack: { ok: false, error, message: ROUND_ERROR_MESSAGES[error] }, effects: [] };
}

function submitFail(error: 'NOT_IN_ROOM' | 'NOT_DRAWING' | 'NOT_PARTICIPANT' | 'ALREADY_SUBMITTED' | 'SUBMISSION_INVALID'): SubmitOutcome {
  return { ack: { ok: false, error, message: ROUND_ERROR_MESSAGES[error] }, effects: [] };
}

function chatFail(error: 'MESSAGE_INVALID' | 'RATE_LIMITED'): ActionOutcome {
  return { ack: { ok: false, error, message: CHAT_ERROR_MESSAGES[error] }, effects: [] };
}

const OK: Ack = { ok: true, data: undefined };

/** Room 未注入評分器時的預設：無延遲 random、逾時 30 秒 */
function defaultJudgeSetup(): RoomJudgeSetup {
  const random = createRandomJudge({ delayMs: 0 });
  return { judge: random, fallback: random, timeoutMs: 30_000 };
}

/** Room 未注入評語器時的預設：關閉（不呼叫任何模型） */
const DEFAULT_COMMENT_SETUP: RoomCommentSetup = { commentator: null, timeoutMs: 30_000 };

// ─── Room ─────────────────────────────────────────────────────────

export class Room {
  protected readonly clock: Clock;
  private readonly newId: () => string;
  private readonly onAsyncEffects: (effects: Effect[]) => void;
  private readonly durations: RoomDurations;
  private readonly queue: JudgeQueue;
  private readonly comments: CommentQueue;

  /** 依加入順序插入；playerList() 另依 joinedAt 排序 */
  protected readonly players = new Map<string, PlayerState>();
  private readonly bySocket = new Map<string, string>();
  private readonly byToken = new Map<string, string>();

  protected round: RoundPublic = idleRound(0, null, null);
  private roundTimer: TimerHandle | null = null;
  /** 本回合交卷期限（drawing 的 endsAt）；judging 時 round.endsAt 為 null，寬限判斷以此為準 */
  private submitDeadline: number | null = null;
  /** 交卷寬限已過（計時器觸發）；之後不再收交卷 */
  private submitClosed = false;

  /** 本回合的交卷（參賽者 id → 交卷）；下一回合 drawing 開始時清空，idle／choosing 期間保留給畫廊 */
  private readonly submissions = new Map<string, Submission>();

  /** 環狀緩衝：最多 CHAT_HISTORY 則 */
  private readonly chatLog: ChatMessage[] = [];
  private chatSeq = 0;

  constructor(options: RoomOptions = {}) {
    this.clock = options.clock ?? realClock;
    this.newId = options.newId ?? (() => randomUUID());
    this.onAsyncEffects = options.onAsyncEffects ?? (() => {});
    this.durations = { ...DEFAULT_DURATIONS, ...options.durations };
    const setup = options.judge ?? defaultJudgeSetup();
    this.queue = new JudgeQueue({
      judge: setup.judge,
      fallback: setup.fallback,
      timeoutMs: setup.timeoutMs,
      clock: this.clock,
      onDone: (job, result) => this.onAsyncEffects(this.onJudged(job, result)),
      onFallback: options.onJudgeFallback,
    });
    const comment = options.comment ?? DEFAULT_COMMENT_SETUP;
    this.comments = new CommentQueue({
      commentator: comment.commentator,
      timeoutMs: comment.timeoutMs,
      clock: this.clock,
      onDone: (batch) => {
        const effects = this.onCommented(batch);
        if (effects.length > 0) this.onAsyncEffects(effects);
      },
      onFailure: (info) => options.onCommentFailure?.(this.withPraiseFallback(info)),
      onSkip: options.onCommentSkip,
    });
  }

  // ─── 玩家轉移 ───────────────────────────────────────────────────

  /**
   * 加入（三種 join，與我畫你猜相同）：
   * - 重複：該 socket 已綁定玩家 → 冪等回目前 token 與快照，忽略 payload。
   * - 接管：token 對到現存玩家 → 綁新 socket、踢舊 socket、取消寬限計時，忽略 nickname。
   * - 新玩家：人數（含寬限期中）< MAX_PLAYERS；暱稱合法且未被占用（不分大小寫，含寬限期中的玩家）。
   * 三種皆在 round.results 非 null 時，於 ack 之後補送畫廊給本人（contest:gallery，§4）。
   */
  join(socketId: string, nickname: string, token?: string): JoinOutcome {
    const boundId = this.bySocket.get(socketId);
    if (boundId !== undefined) {
      const player = this.mustGet(boundId);
      return { ack: this.joinAck(player), effects: this.galleryEffects({ only: player.id }) };
    }

    const tokenOwner = token === undefined ? undefined : this.byToken.get(token);
    if (tokenOwner !== undefined) return this.takeOver(socketId, this.mustGet(tokenOwner));

    if (this.players.size >= MAX_PLAYERS) {
      return { ack: { ok: false, error: 'ROOM_FULL', message: ROUND_ERROR_MESSAGES.ROOM_FULL }, effects: [] };
    }

    const check = validateNickname(nickname);
    if (!check.ok) return { ack: check, effects: [] };

    const key = nicknameKey(check.nickname);
    for (const p of this.players.values()) {
      if (nicknameKey(p.nickname) === key) {
        return { ack: { ok: false, error: 'NICKNAME_TAKEN', message: NICKNAME_TAKEN_MESSAGE }, effects: [] };
      }
    }

    const player: PlayerState = {
      id: this.newId(),
      token: this.newId(),
      nickname: check.nickname,
      score: 0,
      joinedAt: this.clock.now(),
      socketId,
      graceTimer: null,
      lastChatAt: null,
    };
    this.players.set(player.id, player);
    this.byToken.set(player.token, player.id);
    this.bySocket.set(socketId, player.id);

    // 系統訊息先入緩衝再取快照：本人從快照看到，廣播時排除本人以免重複
    const msg = this.pushSystem(`${player.nickname} 加入`);
    return {
      ack: this.joinAck(player),
      effects: [
        this.playersUpdate(),
        { kind: 'emit', to: { except: player.id }, event: 'chat:message', payload: msg },
        ...this.galleryEffects({ only: player.id }),
      ],
    };
  }

  /**
   * socket 斷線：若是玩家目前綁定的 socket → connected=false 並起寬限計時；否則忽略（含已被接管的舊 socket）。
   * 不發 system 訊息；斷線中的參賽者仍是參賽者（寬限期滿才移除），回合計時器照走。
   */
  disconnect(socketId: string): Effect[] {
    const playerId = this.bySocket.get(socketId);
    if (playerId === undefined) return [];
    const player = this.mustGet(playerId);
    this.bySocket.delete(socketId);
    player.socketId = null;
    player.graceTimer = this.clock.setTimeout(() => {
      player.graceTimer = null;
      this.onAsyncEffects(this.leave(player.id));
    }, this.durations.graceMs);
    return [this.playersUpdate()];
  }

  /** 玩家離開房間（寬限期到期；日後的主動離開）。未知 id 為 no-op */
  leave(playerId: string): Effect[] {
    const player = this.players.get(playerId);
    if (player === undefined) return [];
    this.cancelGrace(player);
    this.players.delete(player.id);
    this.byToken.delete(player.token);
    if (player.socketId !== null) this.bySocket.delete(player.socketId);

    const msg = this.pushSystem(`${player.nickname} 離開`);
    return [
      this.playersUpdate(),
      { kind: 'emit', to: 'all', event: 'chat:message', payload: msg },
      ...this.roundAfterLeave(player),
    ];
  }

  // ─── 回合轉移 ───────────────────────────────────────────────────

  /** 我出題：phase = idle／ended、在線人數 ≥ MIN_PLAYERS → choosing（results 保留） */
  volunteer(socketId: string): ActionOutcome {
    const player = this.playerBySocket(socketId);
    if (player === undefined) return fail('NOT_IN_ROOM');
    if (this.round.phase !== 'idle' && this.round.phase !== 'ended') return fail('ROUND_BUSY');
    if (this.onlineCount() < MIN_PLAYERS) return fail('NOT_ENOUGH_PLAYERS');

    this.round = {
      ...idleRound(this.round.roundNo, this.round.results, this.round.lastTopic),
      phase: 'choosing',
      setterId: player.id,
      endsAt: this.clock.now() + this.durations.choosingMs,
    };
    this.submitDeadline = null;
    this.setRoundTimer(this.durations.choosingMs, () => this.abort('timeout'));
    return { ack: OK, effects: [this.roundUpdate(), this.playersUpdate()] };
  }

  /**
   * 出題：phase = choosing、呼叫者為出題者、題目合法 → drawing。
   * idle／ended 或非出題者 → NOT_SETTER；drawing／judging 的出題者 → ROUND_BUSY。
   */
  setTopic(socketId: string, rawTopic: string): ActionOutcome {
    const player = this.playerBySocket(socketId);
    if (player === undefined) return fail('NOT_IN_ROOM');
    const denied = this.setterGate(player);
    if (denied !== null) return denied;
    const check = validateTopic(rawTopic);
    if (!check.ok) return { ack: { ok: false, error: 'TOPIC_INVALID', message: TOPIC_INVALID_MESSAGE }, effects: [] };

    // 新回合：清掉上回合的交卷與畫廊、評分佇列換回合；上回合未完成的評語工作一併丟棄（不算失敗，§5 評語）
    this.submissions.clear();
    this.queue.reset();
    this.comments.reset();
    const now = this.clock.now();
    const endsAt = now + this.durations.drawMs;
    this.submitDeadline = endsAt;
    this.submitClosed = false;
    this.round = {
      roundNo: this.round.roundNo + 1,
      phase: 'drawing',
      setterId: player.id,
      topic: check.topic,
      startedAt: now,
      endsAt,
      participantIds: this.playerList().filter((p) => p.connected).map((p) => p.id),
      submittedCount: 0,
      judgedCount: 0,
      judgeMode: null,
      commentMode: null,
      results: null,
      lastTopic: null,
    };
    this.setRoundTimer(this.durations.drawMs, () => this.toJudging());

    const msg = this.pushSystem(`${player.nickname} 出題「${check.topic}」，開始作畫`);
    return {
      ack: OK,
      effects: [this.roundUpdate(), this.playersUpdate(), { kind: 'emit', to: 'all', event: 'chat:message', payload: msg }],
    };
  }

  /** 出題者在 choosing 取消 → idle。idle／ended 或非出題者 → NOT_SETTER；drawing／judging 的出題者 → ROUND_BUSY */
  cancel(socketId: string): ActionOutcome {
    const player = this.playerBySocket(socketId);
    if (player === undefined) return fail('NOT_IN_ROOM');
    const denied = this.setterGate(player);
    if (denied !== null) return denied;
    return { ack: OK, effects: this.abort('cancel') };
  }

  /**
   * 交卷（§5「交卷」，檢查順序依 §5）：未加入 → NOT_IN_ROOM；
   * phase 不是 drawing 也不是寬限內的 judging → NOT_DRAWING；非參賽者 → NOT_PARTICIPANT；
   * 已交卷 → ALREADY_SUBMITTED；payload／PNG 不合法（§5.1）→ SUBMISSION_INVALID。
   * 成功：存 bytes 複本、排進評分佇列、players:update、round:update；drawing 中全員交卷 → judging。
   */
  submit(socketId: string, payload: unknown): SubmitOutcome {
    const player = this.playerBySocket(socketId);
    if (player === undefined) return submitFail('NOT_IN_ROOM');
    if (!this.acceptingSubmissions()) return submitFail('NOT_DRAWING');
    if (!this.round.participantIds.includes(player.id)) return submitFail('NOT_PARTICIPANT');
    if (this.submissions.has(player.id)) return submitFail('ALREADY_SUBMITTED');
    const check = checkSubmission(payload);
    if (!check.ok) return submitFail('SUBMISSION_INVALID');

    const png = copyToArrayBuffer(check.png);
    this.submissions.set(player.id, {
      playerId: player.id,
      png,
      submittedAt: this.clock.now(),
      result: null,
      comment: null,
      commentPending: false,
      praise: null,
    });
    this.syncCounts();
    this.queue.push({
      playerId: player.id,
      input: { png: Buffer.from(png), topic: this.round.topic ?? '' },
    });

    const effects: Effect[] = [this.playersUpdate(), this.roundUpdate()];
    if (this.round.phase === 'drawing' && this.allSubmitted()) effects.push(...this.toJudging());
    return { ack: { ok: true, data: { bytes: png.byteLength } }, effects };
  }

  /**
   * 聊天（§5.3）：未加入 → NOT_IN_ROOM；文字不合法 → MESSAGE_INVALID；
   * 距上一則被接受的訊息 < CHAT_MIN_INTERVAL_MS → RATE_LIMITED。只有被接受的訊息才更新間隔時間戳。
   */
  chat(socketId: string, rawText: string): ActionOutcome {
    const player = this.playerBySocket(socketId);
    if (player === undefined) return fail('NOT_IN_ROOM');
    const check = validateChatText(rawText);
    if (!check.ok) return chatFail('MESSAGE_INVALID');
    const now = this.clock.now();
    if (player.lastChatAt !== null && now - player.lastChatAt < CHAT_MIN_INTERVAL_MS) return chatFail('RATE_LIMITED');

    player.lastChatAt = now;
    const msg = this.pushMessage('chat', check.text, player);
    return { ack: OK, effects: [{ kind: 'emit', to: 'all', event: 'chat:message', payload: msg }] };
  }

  /** 清掉所有計時器、評分佇列與評語佇列（伺服器關閉、測試收尾） */
  dispose(): void {
    for (const p of this.players.values()) this.cancelGrace(p);
    this.clearRoundTimer();
    this.queue.dispose();
    this.comments.dispose();
  }

  // ─── 查詢與投影 ───────────────────────────────────────────────────

  snapshot(forPlayerId: string): RoomSnapshot {
    return {
      you: forPlayerId,
      players: this.playerList(),
      round: freezeRound(this.round),
      chat: [...this.chatLog],
    };
  }

  /** 依 joinedAt 排序（同時間依加入順序） */
  playerList(): PlayerPublic[] {
    return [...this.players.values()].sort((a, b) => a.joinedAt - b.joinedAt).map((p) => this.toPublic(p));
  }

  /** 在線人數（connected === true）；volunteer 以此判斷 MIN_PLAYERS */
  onlineCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.socketId !== null) n++;
    return n;
  }

  playerIdOf(socketId: string): string | undefined {
    return this.bySocket.get(socketId);
  }

  /** 目前回合狀態（複本） */
  currentRound(): RoundPublic {
    return freezeRound(this.round);
  }

  /** 把收件者解析成「連線中玩家的 socket」；斷線中的玩家收不到，重連時由快照補齊 */
  recipients(to: Audience): Recipient[] {
    const out: Recipient[] = [];
    for (const p of this.players.values()) {
      if (p.socketId === null) continue;
      if (to !== 'all') {
        if ('only' in to && p.id !== to.only) continue;
        if ('except' in to && p.id === to.except) continue;
      }
      out.push({ playerId: p.id, socketId: p.socketId });
    }
    return out;
  }

  // ─── 回合內部 ─────────────────────────────────────────────────────

  /** setTopic／cancel 的共同權限：choosing 的出題者通過（null）；drawing／judging 的出題者 → ROUND_BUSY；其餘 → NOT_SETTER */
  private setterGate(player: PlayerState): ActionOutcome | null {
    const { phase, setterId } = this.round;
    if (setterId !== player.id || phase === 'idle' || phase === 'ended') return fail('NOT_SETTER');
    if (phase !== 'choosing') return fail('ROUND_BUSY');
    return null;
  }

  /** drawing，或 judging 且 now ≤ 交卷期限 + SUBMIT_GRACE_SECONDS（且寬限計時器尚未觸發） */
  private acceptingSubmissions(): boolean {
    const { phase } = this.round;
    if (phase === 'drawing') return true;
    if (phase !== 'judging' || this.submitClosed || this.submitDeadline === null) return false;
    return this.clock.now() <= this.submitDeadline + this.durations.submitGraceMs;
  }

  /** 以當下的 participantIds 判斷全員交卷（空集合為真） */
  private allSubmitted(): boolean {
    return this.round.participantIds.every((id) => this.submissions.has(id));
  }

  /** submittedCount／judgedCount 以當下參賽者的交卷重算（離開者的交卷已移除） */
  private syncCounts(): void {
    let judged = 0;
    for (const s of this.submissions.values()) if (s.result !== null) judged++;
    this.round = { ...this.round, submittedCount: this.submissions.size, judgedCount: judged };
  }

  /** drawing → judging（交卷期限到或全員交卷）：endsAt 對外為 null；judgeMode／commentMode 設為當下模式；起寬限計時；可能立即 ended */
  private toJudging(): Effect[] {
    if (this.round.phase !== 'drawing') return [];
    this.clearRoundTimer();
    this.round = { ...this.round, phase: 'judging', endsAt: null, judgeMode: this.queue.mode, commentMode: this.comments.mode };
    const deadline = this.submitDeadline ?? this.clock.now();
    // 「now > 交卷期限 + 寬限」才算寬限已過，故多 1 ms
    const wait = Math.max(0, deadline + this.durations.submitGraceMs + 1 - this.clock.now());
    this.setRoundTimer(wait, () => {
      this.submitClosed = true;
      return this.maybeEnd();
    });
    return [this.roundUpdate(), ...this.maybeEnd()];
  }

  /** judging 且佇列清空（每張都評完）且（全員交卷 或 寬限已過）→ ended */
  private maybeEnd(): Effect[] {
    if (this.round.phase !== 'judging') return [];
    for (const s of this.submissions.values()) if (s.result === null) return [];
    const graceOver = this.submitClosed || (this.submitDeadline !== null && this.clock.now() > this.submitDeadline + this.durations.submitGraceMs);
    if (!this.allSubmitted() && !graceOver) return [];
    return this.end();
  }

  /** 評分佇列回報一張的結果；評完的瞬間排進評語佇列（§5 評語），之後才判斷是否 ended（ended 不等評語） */
  private onJudged(job: JudgeJob, result: JudgeResult): Effect[] {
    const { phase } = this.round;
    if (phase !== 'drawing' && phase !== 'judging') return [];
    const sub = this.submissions.get(job.playerId);
    if (sub === undefined || sub.result !== null) return [];
    sub.result = result;
    // 送給評語器的是原圖、題目與該張最終分數（退回 random 時就是 random 的分數）；不給暱稱與名次。
    // 關閉或本回合已連續兩次失敗時 push 回 false：這張沒有評語（comment null、commentPending false）
    sub.commentPending = this.comments.push({
      playerId: sub.playerId,
      input: { png: Buffer.from(sub.png), topic: job.input.topic, score: result.score },
    });
    this.syncCounts();
    if (phase === 'judging') this.round = { ...this.round, judgeMode: this.queue.mode };
    return [this.roundUpdate(), ...this.maybeEnd()];
  }

  /**
   * 評語佇列回報一批結果（成功或單次失敗：一筆；連續第二次失敗：失敗那張＋當下排隊中而被跳過的各張），§5 評語、§6.1 事件規則：
   * - ended 之前（results 尚未產生）：只記在交卷上，揭曉時寫進 results，**不發 contest:comment**。
   * - ended 之後（results 已揭曉；含下一回合開始前的 idle／choosing）：更新 round.results 該筆並各廣播一則 contest:comment
   *   （成功為字串、失敗或跳過為 null）。ended 後才離開的人交卷仍在，評語照常補上。
   * - 第一名（揭曉時已排稱讚版，sub.praise 非 null）以 job.input.praise 分辨兩種結果：
   *   批評版（揭曉時在途、現在才跑完）→ 不顯示、不發事件，成功就存成退路；
   *   稱讚版 → 成功用稱讚句，失敗或被跳過退回批評版（沒有才 null），只發這一則。
   * - 單次失敗不動 commentMode、不發 round:update。佇列已連續兩次失敗（mode 'off'）且本回合 commentMode 為 'ai'（judging／ended）
   *   → 改 'off' 並廣播一則 round:update，排在 contest:comment 之後；已進下一回合 choosing（commentMode 為 null）則不發。
   *   drawing 中 commentMode 尚為 null，進 judging 時才依佇列當下模式設定（只失敗一次仍是 'ai'，連續兩次直接 'off'）。
   */
  private onCommented(batch: CommentDone[]): Effect[] {
    const effects: Effect[] = [];
    for (const { job, result } of batch) {
      const sub = this.submissions.get(job.playerId);
      if (sub === undefined) continue;
      const isPraise = job.input.praise === true;
      if (sub.praise !== null && !isPraise) {
        if (result.status === 'ok') sub.praise.fallback = result.comment;
        continue;
      }
      if (!sub.commentPending) continue;
      const comment = result.status === 'ok' ? result.comment : isPraise ? (sub.praise?.fallback ?? null) : null;
      sub.comment = comment;
      sub.commentPending = false;
      if (isPraise) sub.praise = null;
      const { results, roundNo } = this.round;
      if (results === null || !results.some((e) => e.playerId === sub.playerId)) continue;
      this.round = {
        ...this.round,
        results: results.map((e) => (e.playerId === sub.playerId ? { ...e, comment, commentPending: false } : e)),
      };
      const update: CommentUpdate = { roundNo, playerId: sub.playerId, comment };
      effects.push({ kind: 'emit', to: 'all', event: 'contest:comment', payload: update });
    }
    if (this.comments.mode === 'off' && this.round.commentMode === 'ai') {
      this.round = { ...this.round, commentMode: 'off' };
      effects.push(this.roundUpdate());
    }
    return effects;
  }

  /** 失敗的是第一名稱讚版時，在失敗通知補上有沒有退路（log 用；此時在途的批評版早已跑完，退路已定） */
  private withPraiseFallback(info: CommentFailureInfo): RoomCommentFailureInfo {
    if (info.praise !== true) return info;
    const fallback = this.submissions.get(info.playerId)?.praise?.fallback ?? null;
    return { ...info, fallback: fallback === null ? null : 'criticism' };
  }

  /**
   * judging → ended：results、總分累加、round:update、players:update、揭曉訊息、每張 contest:gallery。
   * 不等評語：已完成的寫進 results.comment，還在佇列的 commentPending=true（之後由 contest:comment 補上）；
   * 第一名另外重做稱讚版（redoWinnerComment）。
   */
  private end(): Effect[] {
    this.clearRoundTimer();
    const judged = new Map<string, JudgedSubmission>();
    for (const s of this.submissions.values()) {
      if (s.result === null) continue;
      judged.set(s.playerId, {
        submittedAt: s.submittedAt,
        score: s.result.score,
        confidence: s.result.confidence,
        judgedBy: s.result.judgedBy,
        comment: s.comment,
        commentPending: s.commentPending,
      });
    }
    const results = rankResults(this.round.participantIds, judged, (id) => this.players.get(id)?.nickname ?? '');
    for (const r of results) {
      const p = this.players.get(r.playerId);
      if (p) p.score += r.score;
    }
    const commentMode = this.round.commentMode ?? this.comments.mode;
    if (commentMode === 'ai') this.redoWinnerComment(results);
    this.round = {
      ...this.round,
      phase: 'ended',
      endsAt: null,
      judgeMode: this.round.judgeMode ?? this.queue.mode,
      commentMode,
      results,
      lastTopic: this.round.topic,
    };

    const first = results[0];
    const text =
      first !== undefined && first.submitted
        ? `揭曉：第一名 ${first.nickname}（${first.score} 分）`
        : '揭曉：沒有人交卷';
    const msg = this.pushSystem(text);
    return [
      this.roundUpdate(),
      this.playersUpdate(),
      { kind: 'emit', to: 'all', event: 'chat:message', payload: msg },
      ...this.galleryEffects('all'),
    ];
  }

  /**
   * 第一名重做稱讚版（§5 評語、§6.1，Epic 15 Phase 4；退路為 Phase 5）：只在本回合 commentMode 為 'ai' 時由 end() 呼叫。
   * 取 rank 1 且有交卷者（§5.2 排名規則保證唯一；沒人交卷就沒有）：不論他的評語是否已完成，一律在交卷紀錄與 results 設回
   * comment null、commentPending true（已產生的批評版不顯示，免得畫面從批評閃成稱讚），並以稱讚版提示詞插到評語佇列最前面
   * （他原本排隊中的工作被取代；正在產生中的讓它跑完，見 CommentQueue.pushFront）。完成後照常經 onCommented 廣播 contest:comment。
   * 設回 null 之前先把已產生的批評版記成退路（sub.praise.fallback）：稱讚版失敗或被跳過時第一名顯示它，沒有退路才沒有評語。
   */
  private redoWinnerComment(results: ResultEntry[]): void {
    const winner = results[0];
    if (winner === undefined || winner.rank !== 1 || !winner.submitted) return;
    const sub = this.submissions.get(winner.playerId);
    if (sub === undefined || sub.result === null) return;
    const job: CommentJob = {
      playerId: sub.playerId,
      input: { png: Buffer.from(sub.png), topic: this.round.topic ?? '', score: sub.result.score, praise: true },
    };
    if (!this.comments.pushFront(job)) return;
    sub.praise = { fallback: sub.comment };
    sub.comment = null;
    sub.commentPending = true;
    results[0] = { ...winner, comment: null, commentPending: true };
  }

  /** round.results 非 null 時，每位交卷者一則 contest:gallery（依 rank 順序） */
  private galleryEffects(to: Audience): Effect[] {
    const { results, roundNo } = this.round;
    if (results === null) return [];
    const effects: Effect[] = [];
    for (const r of results) {
      if (!r.submitted) continue;
      const sub = this.submissions.get(r.playerId);
      if (sub === undefined) continue;
      const image: GalleryImage = { roundNo, playerId: r.playerId, png: sub.png };
      effects.push({ kind: 'emit', to, event: 'contest:gallery', payload: image });
    }
    return effects;
  }

  /**
   * 玩家真正離開後的回合處理：
   * - 出題者在 choosing 離開 → idle。
   * - drawing／judging 的參賽者離開 → 從 participantIds 移除、交卷移除並丟棄評分與評語佇列的工作、重算計數；
   *   drawing 中剩餘全員已交卷（含空集合）→ judging；judging 中重新判斷是否 ended。
   * - ended／idle：results 是已揭曉的紀錄，不變動；交卷與評語工作都保留，評語照常跑完並廣播（§5 評語）。
   */
  private roundAfterLeave(left: PlayerState): Effect[] {
    const { phase, setterId, participantIds } = this.round;
    if (phase === 'choosing') return setterId === left.id ? this.abort('setterLeft', left.nickname) : [];
    if ((phase !== 'drawing' && phase !== 'judging') || !participantIds.includes(left.id)) return [];

    this.submissions.delete(left.id);
    this.queue.discard(left.id);
    this.comments.discard(left.id);
    this.round = { ...this.round, participantIds: participantIds.filter((id) => id !== left.id) };
    this.syncCounts();
    const effects: Effect[] = [this.roundUpdate()];
    if (phase === 'drawing') {
      if (this.allSubmitted()) effects.push(...this.toJudging());
    } else {
      effects.push(...this.maybeEnd());
    }
    return effects;
  }

  /** 出題階段中止：choosing → idle（results 保留） */
  private abort(cause: AbortCause, leftNickname?: string): Effect[] {
    const setter = this.round.setterId === null ? undefined : this.players.get(this.round.setterId);
    const nickname = setter?.nickname ?? leftNickname ?? '';
    this.clearRoundTimer();
    this.round = idleRound(this.round.roundNo, this.round.results, this.round.lastTopic);

    const text = {
      cancel: `${nickname} 取消出題`,
      timeout: `${nickname} 出題逾時`,
      setterLeft: `出題者 ${nickname} 離開`,
    }[cause];
    const msg = this.pushSystem(text);
    return [this.roundUpdate(), this.playersUpdate(), { kind: 'emit', to: 'all', event: 'chat:message', payload: msg }];
  }

  private setRoundTimer(ms: number, transition: () => Effect[]): void {
    this.clearRoundTimer();
    this.roundTimer = this.clock.setTimeout(() => {
      this.roundTimer = null;
      this.onAsyncEffects(transition());
    }, ms);
  }

  private clearRoundTimer(): void {
    if (this.roundTimer !== null) {
      this.clock.clearTimeout(this.roundTimer);
      this.roundTimer = null;
    }
  }

  /** round:update：payload 在此刻定格 */
  private roundUpdate(): Effect {
    return { kind: 'emit', to: 'all', event: 'round:update', payload: freezeRound(this.round) };
  }

  // ─── 其他內部 ─────────────────────────────────────────────────────

  /** isSetter／participating／submitted 由回合狀態推導；idle／choosing 時 participating 與 submitted 為 false */
  private toPublic(p: PlayerState): PlayerPublic {
    const { phase, setterId, participantIds } = this.round;
    const inRound = phase === 'drawing' || phase === 'judging' || phase === 'ended';
    const participating = inRound && participantIds.includes(p.id);
    return {
      id: p.id,
      nickname: p.nickname,
      score: p.score,
      connected: p.socketId !== null,
      joinedAt: p.joinedAt,
      isSetter: phase !== 'idle' && setterId === p.id,
      participating,
      submitted: participating && this.submissions.has(p.id),
    };
  }

  private takeOver(socketId: string, player: PlayerState): JoinOutcome {
    const effects: Effect[] = [];
    const oldSocket = player.socketId;
    const wasGrace = oldSocket === null;

    this.cancelGrace(player);
    if (oldSocket !== null) {
      // 先解除綁定，舊 socket 之後的 disconnect 會被 disconnect() 忽略
      this.bySocket.delete(oldSocket);
      effects.push({ kind: 'disconnect', socketId: oldSocket });
    }
    player.socketId = socketId;
    this.bySocket.set(socketId, player.id);

    // 不發 system 訊息：從寬限期回來只更新玩家清單的 connected
    if (wasGrace) effects.push(this.playersUpdate());
    effects.push(...this.galleryEffects({ only: player.id }));
    return { ack: this.joinAck(player), effects };
  }

  private joinAck(player: PlayerState): Ack<JoinResult> {
    return { ok: true, data: { token: player.token, snapshot: this.snapshot(player.id) } };
  }

  private playersUpdate(): Effect {
    return { kind: 'emit', to: 'all', event: 'players:update', payload: this.playerList() };
  }

  private pushSystem(text: string): ChatMessage {
    return this.pushMessage('system', text);
  }

  /** 訊息入環狀緩衝（最多 CHAT_HISTORY 則）後回傳；system 的 fromId / nickname 為 null */
  private pushMessage(kind: ChatKind, text: string, from?: PlayerState): ChatMessage {
    const msg: ChatMessage = {
      id: `m${++this.chatSeq}`,
      kind,
      fromId: kind === 'system' ? null : (from?.id ?? null),
      nickname: kind === 'system' ? null : (from?.nickname ?? null),
      text,
      at: this.clock.now(),
    };
    this.chatLog.push(msg);
    if (this.chatLog.length > CHAT_HISTORY) this.chatLog.splice(0, this.chatLog.length - CHAT_HISTORY);
    return msg;
  }

  private playerBySocket(socketId: string): PlayerState | undefined {
    const id = this.bySocket.get(socketId);
    return id === undefined ? undefined : this.players.get(id);
  }

  private cancelGrace(player: PlayerState): void {
    if (player.graceTimer !== null) {
      this.clock.clearTimeout(player.graceTimer);
      player.graceTimer = null;
    }
  }

  private mustGet(playerId: string): PlayerState {
    const p = this.players.get(playerId);
    if (p === undefined) throw new Error(`玩家不存在：${playerId}`);
    return p;
  }
}

