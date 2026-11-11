// Room 狀態機（純邏輯，不依賴 socket.io）：spec/architecture.md §5、§9
// 每個方法回傳「要送出的效果」（Effect[]），由 register.ts 負責實際 emit / 斷線。
// 計時器觸發的轉移（寬限期到期、出題／作畫期限、揭曉停留）沒有呼叫端可回傳，改走建構子注入的 onAsyncEffects。
import { randomUUID } from 'node:crypto';
import {
  CHAT_HISTORY,
  CHAT_MIN_INTERVAL_MS,
  CHOOSING_SECONDS,
  ENDED_SECONDS,
  IMAGE_MIN_INTERVAL_MS,
  JOIN_MIN_INTERVAL_MS,
  MAX_OPS_PER_ROUND,
  MAX_PLAYERS,
  MAX_STROKES_PER_ROUND,
  MIN_PLAYERS,
  NICKNAME_TAKEN_MESSAGE,
  RECONNECT_GRACE_SECONDS,
  ROUND_SECONDS,
  SPOILER_COOLDOWN_MS,
  containsSpoiler,
  countChars,
  isCorrect,
  nicknameKey,
  validateNickname,
  type Ack,
  type ChatKind,
  type ChatMessage,
  type DrawOp,
  type EndReason,
  type ErrorCode,
  type ImageMeta,
  type JoinResult,
  type PlayerPublic,
  type RoomSnapshot,
  type RoundPublic,
  type ServerToClientEvents,
} from '@fishing-work/shared';
import { CHAT_ERROR_MESSAGES, validateChatText } from './chat';
import { sanitizeDrawOp } from './drawOp';
import { IMAGE_ERROR_MESSAGES, toArrayBuffer, validateImage, type ImageMetaInput } from './image';
import { drawerRoundScore, guesserScore } from './scoring';
import { TOPIC_INVALID_MESSAGE, validateTopic } from './topic';

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

/**
 * 送出一個事件。payload 可為固定值，或「依收件者 player id 產生」的函式
 * （round:update 以此遮罩 topic：畫師看得到、其他人只看得到字數）。
 */
export type EmitEffect = {
  [K in ServerEventName]: {
    kind: 'emit';
    to: Audience;
    event: K;
    payload: ServerEventPayload<K> | ((playerId: string) => ServerEventPayload<K>);
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
  roundMs: number;
  endedMs: number;
}

export const DEFAULT_DURATIONS: Readonly<RoomDurations> = {
  graceMs: RECONNECT_GRACE_SECONDS * 1000,
  choosingMs: CHOOSING_SECONDS * 1000,
  roundMs: ROUND_SECONDS * 1000,
  endedMs: ENDED_SECONDS * 1000,
};

export const GRACE_MS = DEFAULT_DURATIONS.graceMs;

export interface RoomOptions {
  clock?: Clock;
  /** 產生 player id 與 token（預設 crypto.randomUUID；測試注入可預期的值） */
  newId?: () => string;
  /** 計時器觸發的轉移所產生的效果 */
  onAsyncEffects?: (effects: Effect[]) => void;
  /** 覆寫計時長度（e2e 測試用） */
  durations?: Partial<RoomDurations>;
}

export interface JoinOutcome {
  ack: Ack<JoinResult>;
  effects: Effect[];
}

export interface ActionOutcome {
  ack: Ack;
  effects: Effect[];
}

/** chat:image 的結果：ack 帶新訊息 id（§4 Ack<{ id }>） */
export interface ImageOutcome {
  ack: Ack<{ id: string }>;
  effects: Effect[];
}

/**
 * draw:op 無 ack：dropped 為丟棄原因（給 register 記 log），合法時為 null。
 * quiet：丟棄但不必寫 log（strokeLimit 每回合只寫第一次，spec §9.1；灌 10 萬對不會寫 10 萬行）
 */
export interface DrawOutcome {
  effects: Effect[];
  dropped: string | null;
  quiet?: boolean;
}

/** 回合相關錯誤的繁中訊息（ack.message，客戶端直接顯示） */
export const ROUND_ERROR_MESSAGES = {
  NOT_IN_ROOM: '請先加入房間',
  ROUND_BUSY: '目前已有回合進行中',
  NOT_ENOUGH_PLAYERS: `至少要 ${MIN_PLAYERS} 位在線玩家才能開始`,
  NOT_DRAWER: '只有本回合的畫師可以這麼做',
  ROOM_FULL: `房間已滿（上限 ${MAX_PLAYERS} 人），請稍後再試`,
} as const satisfies Partial<Record<ErrorCode, string>>;

/** 已綁定玩家的 socket 重複 player:join 太頻繁（< JOIN_MIN_INTERVAL_MS）→ RATE_LIMITED 的訊息（spec §9.1，Epic 21） */
export const JOIN_RATE_LIMITED_MESSAGE = '操作太頻繁，請稍候再試';

/** setTopic 時沒有任何猜題者（在房非畫師，含寬限期中）→ NOT_ENOUGH_PLAYERS 的訊息 */
export const NO_GUESSERS_MESSAGE = '沒有猜題者，無法開始作畫';

/** 猜題者走光（leave 後非畫師為 0）時的原因文字：abort 的 system 訊息、end 的揭曉原因共用（spec §5） */
const NO_GUESSERS_LABEL = '猜題者都離開了';

/** end(reason) 的 system 揭曉訊息所附原因（spec §5） */
const END_REASON_LABEL: Record<Exclude<EndReason, null>, string> = {
  allGuessed: '全員猜對',
  timeout: '時間到',
  cancelled: '畫師取消',
  drawerLeft: '畫師離開',
};

/** abort 的觸發原因：cancel、timeout、noGuessers 的 endReason 都是 cancelled，但 system 訊息不同 */
type AbortCause = 'cancel' | 'timeout' | 'drawerLeft' | 'noGuessers';

interface PlayerState {
  id: string;
  token: string;
  nickname: string;
  score: number;
  isDrawer: boolean;
  hasGuessed: boolean;
  joinedAt: number;
  /** 目前綁定的 socket；null = 斷線中（寬限期） */
  socketId: string | null;
  graceTimer: TimerHandle | null;
  /** 最後一則被接受或被 SPOILER_BLOCKED 擋下的聊天訊息時間（間隔限制用；其他被拒的訊息不更新，spec §5、§9.1） */
  lastChatAt: number | null;
  /** 最後一次 chat:send 被 SPOILER_BLOCKED 的時間：之後 SPOILER_COOLDOWN_MS 內 chat:send 一律 RATE_LIMITED（§9.1，Epic 21） */
  lastSpoilerAt: number | null;
  /** 最後一次受理 player:join 的時間（新玩家、接管、重複皆算）：已綁定 socket 的重複 join 節流用（§9.1，Epic 21） */
  lastJoinAt: number;
  /** 最後一張被接受的圖片時間（與文字訊息各自計時；被拒不更新，spec §5「圖片訊息」） */
  lastImageAt: number | null;
}

function toPublic(p: PlayerState): PlayerPublic {
  return {
    id: p.id,
    nickname: p.nickname,
    score: p.score,
    isDrawer: p.isDrawer,
    hasGuessed: p.hasGuessed,
    connected: p.socketId !== null,
    joinedAt: p.joinedAt,
  };
}

function idleRound(endReason: EndReason = null): RoundPublic {
  return {
    phase: 'idle',
    drawerId: null,
    topic: null,
    topicLength: null,
    startedAt: null,
    endsAt: null,
    correctIds: [],
    endReason,
  };
}

/** topic 遮罩：畫師在 choosing/drawing 看得到；所有人在 ended 看得到；其餘為 null */
function project(r: RoundPublic, forPlayerId: string): RoundPublic {
  const visible =
    r.phase === 'ended' || (r.drawerId === forPlayerId && (r.phase === 'choosing' || r.phase === 'drawing'));
  return { ...r, topic: visible ? r.topic : null, correctIds: [...r.correctIds] };
}

function fail(error: keyof typeof ROUND_ERROR_MESSAGES): ActionOutcome {
  return { ack: { ok: false, error, message: ROUND_ERROR_MESSAGES[error] }, effects: [] };
}

function chatFail(error: 'MESSAGE_INVALID' | 'RATE_LIMITED' | 'SPOILER_BLOCKED', message: string): ActionOutcome {
  return { ack: { ok: false, error, message }, effects: [] };
}

const OK: Ack = { ok: true, data: undefined };

// ─── Room ─────────────────────────────────────────────────────────

export class Room {
  protected readonly clock: Clock;
  private readonly newId: () => string;
  private readonly onAsyncEffects: (effects: Effect[]) => void;
  private readonly durations: RoomDurations;

  /** 依加入順序插入；playerList() 另依 joinedAt 排序 */
  protected readonly players = new Map<string, PlayerState>();
  private readonly bySocket = new Map<string, string>();
  private readonly byToken = new Map<string, string>();

  /** 內部回合狀態（topic 未遮罩）；對外一律經 projectRound */
  protected round: RoundPublic = idleRound();
  private roundTimer: TimerHandle | null = null;

  /** 筆跡歷史（正規化後只含 begin/move/end 與至多一個 background，§5「筆跡歷史正規化」） */
  private ops: DrawOp[] = [];
  /** 目前 open stroke（begin 後、end 前） */
  private openStroke: string | null = null;
  /** 歷史中仍存在的筆畫，依 begin 順序（undo 撤最後一筆） */
  private strokeOrder: string[] = [];
  /** 本回合用過的 strokeId（含已 undo／clear 的），不得重用 */
  private readonly usedStrokeIds = new Set<string>();
  /** 本回合是否已回報過 strokeLimit（之後的同類丟棄 quiet，不再逐則寫 log；換回合重置） */
  private strokeLimitReported = false;

  /** 環狀緩衝：最多 CHAT_HISTORY 則 */
  private readonly chatLog: ChatMessage[] = [];
  private chatSeq = 0;

  constructor(options: RoomOptions = {}) {
    this.clock = options.clock ?? realClock;
    this.newId = options.newId ?? (() => randomUUID());
    this.onAsyncEffects = options.onAsyncEffects ?? (() => {});
    this.durations = { ...DEFAULT_DURATIONS, ...options.durations };
  }

  // ─── 玩家轉移 ───────────────────────────────────────────────────

  /**
   * 加入（§5 三種 join）：
   * - 重複：該 socket 已綁定玩家 → 冪等回目前 token 與快照，忽略 payload；距上次受理 < JOIN_MIN_INTERVAL_MS → RATE_LIMITED
   *   （§9.1，Epic 21：快照含整份 ops 複本，連送可灌爆記憶體）。本款沒有要補送的二進位事件。
   * - 接管：token 對到現存玩家 → 綁新 socket、踢舊 socket、取消寬限計時，忽略 nickname。
   * - 新玩家：人數（含寬限期中）< MAX_PLAYERS；暱稱合法且未被占用（不分大小寫，含寬限期中的玩家）。
   */
  join(socketId: string, nickname: string, token?: string): JoinOutcome {
    const boundId = this.bySocket.get(socketId);
    if (boundId !== undefined) {
      const player = this.mustGet(boundId);
      const now = this.clock.now();
      if (now - player.lastJoinAt < JOIN_MIN_INTERVAL_MS) {
        return { ack: { ok: false, error: 'RATE_LIMITED', message: JOIN_RATE_LIMITED_MESSAGE }, effects: [] };
      }
      player.lastJoinAt = now;
      return { ack: this.joinAck(player), effects: [] };
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
      isDrawer: false,
      hasGuessed: false,
      joinedAt: this.clock.now(),
      socketId,
      graceTimer: null,
      lastChatAt: null,
      lastSpoilerAt: null,
      lastJoinAt: this.clock.now(),
      lastImageAt: null,
    };
    this.players.set(player.id, player);
    this.byToken.set(player.token, player.id);
    this.bySocket.set(socketId, player.id);

    // 系統訊息先入緩衝再取快照：本人從快照看到，廣播時排除本人以免重複
    const msg = this.pushSystem(`${player.nickname} 加入`);
    return {
      ack: this.joinAck(player),
      effects: [this.playersUpdate(), { kind: 'emit', to: { except: player.id }, event: 'chat:message', payload: msg }],
    };
  }

  /**
   * socket 斷線：若是玩家目前綁定的 socket → connected=false 並起寬限計時；否則忽略（含已被接管的舊 socket）。
   * 不發 system 訊息（§5：斷線／重連只靠 connected 標記呈現）；畫師斷線不中止回合，回合計時器照走。
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

  /** 我來畫：phase = idle、在線人數 ≥ MIN_PLAYERS → choosing */
  volunteer(socketId: string): ActionOutcome {
    const player = this.playerBySocket(socketId);
    if (player === undefined) return fail('NOT_IN_ROOM');
    if (this.round.phase !== 'idle') return fail('ROUND_BUSY');
    if (this.onlineCount() < MIN_PLAYERS) return fail('NOT_ENOUGH_PLAYERS');

    player.isDrawer = true;
    this.round = {
      ...idleRound(),
      phase: 'choosing',
      drawerId: player.id,
      endsAt: this.clock.now() + this.durations.choosingMs,
    };
    this.setRoundTimer(this.durations.choosingMs, () => this.abort('timeout'));
    return { ack: OK, effects: [this.roundUpdate(), this.playersUpdate()] };
  }

  /** 出題：phase = choosing、呼叫者為畫師、題目合法 → drawing */
  setTopic(socketId: string, rawTopic: string): ActionOutcome {
    const player = this.playerBySocket(socketId);
    if (player === undefined) return fail('NOT_IN_ROOM');
    if (this.round.drawerId !== player.id) return fail('NOT_DRAWER');
    if (this.round.phase !== 'choosing') return fail('ROUND_BUSY');
    if (this.guessers().length === 0) {
      return { ack: { ok: false, error: 'NOT_ENOUGH_PLAYERS', message: NO_GUESSERS_MESSAGE }, effects: [] };
    }
    const check = validateTopic(rawTopic);
    if (!check.ok) return { ack: { ok: false, error: 'TOPIC_INVALID', message: TOPIC_INVALID_MESSAGE }, effects: [] };

    this.resetDrawing();
    const guessedChanged = this.clearGuessed();
    const now = this.clock.now();
    this.round = {
      ...this.round,
      phase: 'drawing',
      topic: check.topic,
      topicLength: countChars(check.topic),
      startedAt: now,
      endsAt: now + this.durations.roundMs,
      correctIds: [],
      endReason: null,
    };
    this.setRoundTimer(this.durations.roundMs, () => this.end('timeout'));

    const msg = this.pushSystem(`${player.nickname} 開始作畫`);
    const effects: Effect[] = [
      this.roundUpdate(),
      { kind: 'emit', to: { except: player.id }, event: 'draw:op', payload: { type: 'clear' } },
      { kind: 'emit', to: 'all', event: 'chat:message', payload: msg },
    ];
    if (guessedChanged) effects.push(this.playersUpdate());
    return { ack: OK, effects };
  }

  /** 畫師放棄：choosing → abort('cancelled')；drawing → end('cancelled') */
  cancel(socketId: string): ActionOutcome {
    const player = this.playerBySocket(socketId);
    if (player === undefined) return fail('NOT_IN_ROOM');
    if (this.round.drawerId !== player.id) return fail('NOT_DRAWER');
    if (this.round.phase === 'choosing') return { ack: OK, effects: this.abort('cancel') };
    if (this.round.phase === 'drawing') return { ack: OK, effects: this.end('cancelled') };
    return fail('NOT_DRAWER');
  }

  /**
   * 聊天／猜題（§5 chat 列與「聊天訊息判定」）：
   * 未加入 → NOT_IN_ROOM；文字不合法 → MESSAGE_INVALID；距上一則被接受的訊息 < CHAT_MIN_INTERVAL_MS → RATE_LIMITED。
   * phase = drawing 時依判定表：未猜對的猜題者猜中 → 猜對（原文不廣播）；含題目但不相符 → SPOILER_BLOCKED；
   * 畫師或已猜對者含題目 → SPOILER_BLOCKED；其餘廣播一般聊天。phase ≠ drawing 一律一般聊天。
   * 被接受（廣播出去）與被 SPOILER_BLOCKED 擋下的訊息更新間隔時間戳；被擋後 SPOILER_COOLDOWN_MS 內一律 RATE_LIMITED
   * （§9.1，Epic 21：「被擋」本身洩漏「這串字含答案」，不限速可毫秒級二分探測）。
   */
  chat(socketId: string, rawText: string): ActionOutcome {
    const player = this.playerBySocket(socketId);
    if (player === undefined) return fail('NOT_IN_ROOM');
    const check = validateChatText(rawText);
    if (!check.ok) return chatFail('MESSAGE_INVALID', CHAT_ERROR_MESSAGES.MESSAGE_INVALID);
    const now = this.clock.now();
    // 洩題冷卻先判：冷卻期間一律回專用文案（spec §9.1，決策 11），即使同時也未滿一般間隔
    if (player.lastSpoilerAt !== null && now - player.lastSpoilerAt < SPOILER_COOLDOWN_MS) {
      return chatFail('RATE_LIMITED', CHAT_ERROR_MESSAGES.RATE_LIMITED_SPOILER);
    }
    if (player.lastChatAt !== null && now - player.lastChatAt < CHAT_MIN_INTERVAL_MS) {
      return chatFail('RATE_LIMITED', CHAT_ERROR_MESSAGES.RATE_LIMITED);
    }
    const { text } = check;

    const { phase, topic, drawerId } = this.round;
    if (phase === 'drawing' && topic !== null) {
      const guessing = drawerId !== player.id && !player.hasGuessed;
      if (guessing && isCorrect(text, topic)) return this.correctGuess(player, now);
      if (containsSpoiler(text, topic)) {
        player.lastChatAt = now;
        player.lastSpoilerAt = now;
        return chatFail(
          'SPOILER_BLOCKED',
          guessing ? CHAT_ERROR_MESSAGES.SPOILER_BLOCKED_GUESS : CHAT_ERROR_MESSAGES.SPOILER_BLOCKED,
        );
      }
    }

    player.lastChatAt = now;
    const msg = this.pushMessage('chat', text, player);
    return { ack: OK, effects: [{ kind: 'emit', to: 'all', event: 'chat:message', payload: msg }] };
  }

  /**
   * 傳圖片（§5「圖片訊息」檢查表；payload 形狀由 register 先驗）：
   * 未加入 → NOT_IN_ROOM；內容不合法 → IMAGE_INVALID；距上一張被接受的圖 < IMAGE_MIN_INTERVAL_MS → RATE_LIMITED；
   * 畫師在 choosing／drawing → SPOILER_BLOCKED。通過時只把 meta 推進聊天緩衝，
   * 效果依序為 chat:message（kind image）→ chat:image {id, data}（所有在線者，含本人）。
   * **不保存 bytes**：data 只放在回傳的效果物件裡經手。
   */
  image(socketId: string, meta: ImageMetaInput, data: Uint8Array): ImageOutcome {
    const reject = (error: ErrorCode, message: string): ImageOutcome => ({ ack: { ok: false, error, message }, effects: [] });
    const player = this.playerBySocket(socketId);
    if (player === undefined) return reject('NOT_IN_ROOM', ROUND_ERROR_MESSAGES.NOT_IN_ROOM);
    const check = validateImage(meta, data);
    if (!check.ok) return reject('IMAGE_INVALID', check.message);
    const now = this.clock.now();
    if (player.lastImageAt !== null && now - player.lastImageAt < IMAGE_MIN_INTERVAL_MS) {
      return reject('RATE_LIMITED', IMAGE_ERROR_MESSAGES.RATE_LIMITED);
    }
    const { phase, drawerId } = this.round;
    if (drawerId === player.id && (phase === 'choosing' || phase === 'drawing')) {
      return reject('SPOILER_BLOCKED', IMAGE_ERROR_MESSAGES.SPOILER_BLOCKED);
    }

    player.lastImageAt = now;
    const msg = this.pushMessage('image', '', player, check.meta);
    return {
      ack: { ok: true, data: { id: msg.id } },
      effects: [
        { kind: 'emit', to: 'all', event: 'chat:message', payload: msg },
        { kind: 'emit', to: 'all', event: 'chat:image', payload: { id: msg.id, data: toArrayBuffer(data) } },
      ],
    };
  }

  /** 畫布操作（§5「draw:op 驗證」「筆跡歷史正規化」）；不合法者丟棄，dropped 為原因 */
  draw(socketId: string, raw: unknown): DrawOutcome {
    const drop = (reason: string): DrawOutcome => ({ effects: [], dropped: reason });
    const playerId = this.bySocket.get(socketId);
    if (playerId === undefined) return drop('notInRoom');
    if (this.round.phase !== 'drawing') return drop('phase');
    if (this.round.drawerId !== playerId) return drop('notDrawer');
    const parsed = sanitizeDrawOp(raw);
    if (!parsed.ok) return drop(`invalid:${parsed.reason}`);
    const op = parsed.op;
    const full = this.ops.length >= MAX_OPS_PER_ROUND;

    switch (op.type) {
      case 'begin':
        if (this.usedStrokeIds.has(op.strokeId)) return drop('strokeUsed');
        // 本回合 strokeId 名額（§9.1，Epic 21；undo／clear 不退還）：begin＋undo 迴圈不再能讓 usedStrokeIds 無限成長
        if (this.usedStrokeIds.size >= MAX_STROKES_PER_ROUND) {
          if (this.strokeLimitReported) return { effects: [], dropped: 'strokeLimit', quiet: true };
          this.strokeLimitReported = true;
          return drop('strokeLimit');
        }
        if (full) return drop('opsLimit');
        // 新的 begin 自動關閉舊的 open stroke（指標離開視窗會漏掉 pointerup）
        this.openStroke = op.strokeId;
        this.usedStrokeIds.add(op.strokeId);
        this.strokeOrder.push(op.strokeId);
        this.ops.push(op);
        break;
      case 'move':
      case 'end':
        if (op.strokeId !== this.openStroke) return drop('notOpenStroke');
        if (full) return drop('opsLimit');
        this.ops.push(op);
        if (op.type === 'end') this.openStroke = null;
        break;
      case 'undo':
        // 若有 open stroke 先視為已 end；open stroke 必為最後一筆，不影響下方比對
        if (op.strokeId !== this.strokeOrder.at(-1)) return drop('undoNotLast');
        this.openStroke = null;
        this.strokeOrder.pop();
        this.ops = this.ops.filter((o) => o.type === 'background' || o.type === 'clear' || o.strokeId !== op.strokeId);
        break;
      case 'clear':
        // 只清筆跡，背景保留（Epic 7 決策 2）
        this.ops = this.ops.filter((o) => o.type === 'background');
        this.strokeOrder = [];
        this.openStroke = null;
        break;
      case 'background': {
        // 歷史只保留最後一個 background（原地取代舊的；不受歷史上限限制，正規化後只剩一個）；
        // 不影響 open stroke 與 undo 順序
        const i = this.ops.findIndex((o) => o.type === 'background');
        if (i >= 0) this.ops[i] = op;
        else this.ops.push(op);
        break;
      }
    }
    return { effects: [{ kind: 'emit', to: { except: playerId }, event: 'draw:op', payload: op }], dropped: null };
  }

  /** 清掉所有計時器（伺服器關閉、測試收尾） */
  dispose(): void {
    for (const p of this.players.values()) this.cancelGrace(p);
    this.clearRoundTimer();
  }

  // ─── 查詢與投影 ───────────────────────────────────────────────────

  snapshot(forPlayerId: string): RoomSnapshot {
    return {
      you: forPlayerId,
      players: this.playerList(),
      round: this.projectRound(forPlayerId),
      ops: structuredClone(this.ops),
      chat: [...this.chatLog],
    };
  }

  /** 依 joinedAt 排序（同時間依加入順序） */
  playerList(): PlayerPublic[] {
    return [...this.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map(toPublic);
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

  /** 目前回合狀態，依收件者遮罩 topic */
  projectRound(forPlayerId: string): RoundPublic {
    return project(this.round, forPlayerId);
  }

  // ─── 回合內部 ─────────────────────────────────────────────────────

  /**
   * 玩家真正離開後的回合處理（§5 leave）。同一次離開只會觸發一種結束，依序判斷：
   * 畫師離開（choosing → abort、drawing → end）→ 非畫師為 0（choosing → abort、drawing → end，皆為 cancelled「猜題者都離開了」）
   * → drawing 且剩餘非畫師全猜對 → allGuessed。
   * （非畫師為 0 時「全猜對」會空泛成立，因此先判斷人數。）
   */
  private roundAfterLeave(left: PlayerState): Effect[] {
    const { phase, drawerId } = this.round;
    if (drawerId === left.id) {
      if (phase === 'choosing') return this.abort('drawerLeft', left.nickname);
      if (phase === 'drawing') return this.end('drawerLeft');
      return [];
    }
    if (phase !== 'choosing' && phase !== 'drawing') return [];
    const guessers = this.guessers();
    if (guessers.length === 0) {
      return phase === 'choosing' ? this.abort('noGuessers') : this.end('cancelled', NO_GUESSERS_LABEL);
    }
    if (phase === 'drawing' && guessers.every((p) => p.hasGuessed)) return this.end('allGuessed');
    return [];
  }

  /** 出題階段中止（§5 abort）：直接回 idle，沒有揭曉 */
  private abort(cause: AbortCause, leftNickname?: string): Effect[] {
    const drawer = this.round.drawerId === null ? undefined : this.players.get(this.round.drawerId);
    const nickname = drawer?.nickname ?? leftNickname ?? '';
    this.clearRoundTimer();
    if (drawer) drawer.isDrawer = false;
    // 回 idle 一律清 hasGuessed（§5；choosing 時理應已是 false，防呆）
    const guessedChanged = this.clearGuessed();
    this.round = idleRound(cause === 'drawerLeft' ? 'drawerLeft' : 'cancelled');

    const text = {
      cancel: `${nickname} 取消出題`,
      timeout: `${nickname} 出題逾時`,
      drawerLeft: `畫師 ${nickname} 離開`,
      noGuessers: NO_GUESSERS_LABEL,
    }[cause];
    const msg = this.pushSystem(text);
    const effects: Effect[] = [this.roundUpdate()];
    if (drawer || guessedChanged) effects.push(this.playersUpdate());
    effects.push({ kind: 'emit', to: 'all', event: 'chat:message', payload: msg });
    return effects;
  }

  /** 作畫階段結束（§5 end）：ended → ENDED 後回 idle */
  private end(reason: Exclude<EndReason, null>, label = END_REASON_LABEL[reason]): Effect[] {
    this.clearRoundTimer();
    this.openStroke = null;
    const drawer = this.round.drawerId === null ? undefined : this.players.get(this.round.drawerId);
    if (drawer) drawer.score += drawerRoundScore(this.round.correctIds.length);
    this.round = { ...this.round, phase: 'ended', endsAt: null, endReason: reason };
    this.setRoundTimer(this.durations.endedMs, () => this.toIdle());

    const msg = this.pushSystem(`題目是 ${this.round.topic ?? ''}（${label}）`);
    return [this.roundUpdate(), this.playersUpdate(), { kind: 'emit', to: 'all', event: 'chat:message', payload: msg }];
  }

  /** 揭曉停留結束：drawer = null、isDrawer 與 hasGuessed 清除；endReason 保留到下次 volunteer、ops 保留到下次 setTopic */
  private toIdle(): Effect[] {
    for (const p of this.players.values()) p.isDrawer = false;
    this.clearGuessed();
    this.round = idleRound(this.round.endReason);
    return [this.roundUpdate(), this.playersUpdate()];
  }

  /**
   * 未猜對的猜題者猜中（§5 判定表第一列）：hasGuessed、correctIds、加分；廣播 players:update、「X 猜對了」（原文不廣播）；
   * 在房非畫師（含寬限期中）全部猜對 → end('allGuessed')（由 end 發 ended 的 round:update）；否則加發 round:update 同步 correctIds。
   */
  private correctGuess(player: PlayerState, now: number): ActionOutcome {
    player.lastChatAt = now;
    player.hasGuessed = true;
    player.score += guesserScore(this.round.startedAt ?? now, now, this.durations.roundMs);
    this.round = { ...this.round, correctIds: [...this.round.correctIds, player.id] };

    const msg = this.pushMessage('correct', `${player.nickname} 猜對了`, player);
    const effects: Effect[] = [this.playersUpdate(), { kind: 'emit', to: 'all', event: 'chat:message', payload: msg }];
    // 全員猜對 → end 自己會發 round:update（ended，含 correctIds），不再多發一則 drawing 的
    if (this.guessers().every((p) => p.hasGuessed)) effects.push(...this.end('allGuessed'));
    else effects.push(this.roundUpdate()); // correctIds 即時同步（§5「猜對時的廣播」，Phase 4 補發）；topic 依收件者遮罩
    return { ack: OK, effects };
  }

  /** 猜題者：在房的非畫師（含寬限期中）；「全員猜對」與「無猜題者」都以此計算（§5） */
  private guessers(): PlayerState[] {
    const { drawerId } = this.round;
    return [...this.players.values()].filter((p) => p.id !== drawerId);
  }

  /** 清除所有玩家的 hasGuessed；回傳是否有變動 */
  private clearGuessed(): boolean {
    let changed = false;
    for (const p of this.players.values()) {
      if (p.hasGuessed) changed = true;
      p.hasGuessed = false;
    }
    return changed;
  }

  private resetDrawing(): void {
    this.ops = [];
    this.openStroke = null;
    this.strokeOrder = [];
    this.usedStrokeIds.clear();
    this.strokeLimitReported = false;
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

  /** round:update：payload 在此刻定格（之後狀態改變不影響），再依收件者遮罩 topic */
  private roundUpdate(): Effect {
    const frozen: RoundPublic = { ...this.round, correctIds: [...this.round.correctIds] };
    return { kind: 'emit', to: 'all', event: 'round:update', payload: (playerId) => project(frozen, playerId) };
  }

  // ─── 其他內部 ─────────────────────────────────────────────────────

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
    player.lastJoinAt = this.clock.now();
    this.bySocket.set(socketId, player.id);

    // 不發 system 訊息（§5）：從寬限期回來只更新玩家清單的 connected
    if (wasGrace) effects.push(this.playersUpdate());
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

  /** 訊息入環狀緩衝（最多 CHAT_HISTORY 則）後回傳；system 的 fromId / nickname 為 null；image 只帶 meta（不含 bytes） */
  private pushMessage(kind: ChatKind, text: string, from?: PlayerState, image?: ImageMeta): ChatMessage {
    const msg: ChatMessage = {
      id: `m${++this.chatSeq}`,
      kind,
      fromId: kind === 'system' ? null : (from?.id ?? null),
      nickname: kind === 'system' ? null : (from?.nickname ?? null),
      text,
      at: this.clock.now(),
      ...(image === undefined ? {} : { image }),
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
