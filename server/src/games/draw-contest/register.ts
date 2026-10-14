// /draw-contest namespace 接線（薄）：spec/draw-contest/architecture.md §4
// 驗證 payload 形狀 → 呼叫 Room → ack 與執行效果；寫法比照 draw-guess/register.ts（獨立複製，不共用程式）。
import type { Namespace } from 'socket.io';
import {
  NICKNAME_INVALID_MESSAGE,
  TOPIC_INVALID_MESSAGE,
  type Ack,
  type ClientToServerEvents,
  type JoinResult,
  type ServerToClientEvents,
} from '@fishing-work/shared/draw-contest';
import { log } from '../../lib/log';
import { clientAddress } from '../../lib/network';
import { CHAT_ERROR_MESSAGES } from './chat';
import { commentSetupFromEnv, type CommentSetup } from './commentary/index';
import { judgeSetupFromEnv, type JudgeSetup } from './judge/index';
import { Room, type ActionOutcome, type Clock, type Effect, type RoomDurations } from './room';

export type DrawContestNamespace = Namespace<ClientToServerEvents, ServerToClientEvents>;

/** token 為 UUID（36 字）；過長者直接視為沒帶 */
const TOKEN_MAX_LENGTH = 64;

export interface RegisterOptions {
  clock?: Clock;
  durations?: Partial<RoomDurations>;
  /** 評分器（測試注入）；預設依環境變數 JUDGE 等建立（judge/index.ts） */
  judge?: JudgeSetup;
  /** 評語器（測試注入）；預設依環境變數 COMMENT 等建立（commentary/index.ts） */
  comment?: CommentSetup;
}

/** 讀取 player:join 的 payload；不信任客戶端：payload 不是物件回 null，形狀不對的欄位視為缺省 */
function readJoinPayload(payload: unknown): { nickname: string; token: string | undefined } | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { nickname, token } = payload as Record<string, unknown>;
  return {
    nickname: typeof nickname === 'string' ? nickname : '',
    token: typeof token === 'string' && token.length <= TOKEN_MAX_LENGTH ? token : undefined,
  };
}

/**
 * 從事件參數拆出 payload 與 ack：Socket.IO 會把 callback 放在最後一個參數。
 * 不信任客戶端：ack 不是函式就不呼叫；只帶 callback 沒帶 payload 時 payload 為 undefined。
 */
function splitArgs<R = Ack>(args: unknown[]): { payload: unknown; reply: ((r: R) => void) | undefined } {
  const last = args.at(-1);
  if (typeof last === 'function') {
    return { payload: args.length > 1 ? args[0] : undefined, reply: last as (r: R) => void };
  }
  return { payload: args[0], reply: undefined };
}

/** 執行 Room 回傳的效果：emit 依收件者對應到 socket；disconnect 強制斷開指定 socket */
export function applyEffects(nsp: DrawContestNamespace, room: Room, effects: Effect[]): void {
  for (const effect of effects) {
    if (effect.kind === 'disconnect') {
      nsp.sockets.get(effect.socketId)?.disconnect(true);
      continue;
    }
    const recipients = room.recipients(effect.to);
    // 注意：nsp.to([]) 會變成廣播給整個 namespace，因此沒有收件者時必須跳過
    if (recipients.length === 0) continue;
    // Effect 在建立時已依事件名稱約束 payload 型別；這裡以寬鬆簽章送出（contest:gallery 的 png 為 ArrayBuffer，單次編碼）
    (nsp.to(recipients.map((r) => r.socketId)).emit as (event: string, payload: unknown) => boolean)(
      effect.event,
      effect.payload,
    );
  }
}

/** 記錄回合轉移（ended 時附排名摘要），方便從 log 追一回合 */
function logRoundEffects(effects: Effect[]): void {
  for (const e of effects) {
    if (e.kind !== 'emit' || e.event !== 'round:update') continue;
    const r = e.payload as Parameters<ServerToClientEvents['round:update']>[0];
    if (r.phase === 'judging' || r.phase === 'ended') {
      log.info('draw-contest.round', {
        roundNo: r.roundNo,
        phase: r.phase,
        submitted: r.submittedCount,
        judged: r.judgedCount,
        judgeMode: r.judgeMode,
        commentMode: r.commentMode,
        ...(r.results ? { results: r.results.map((x) => ({ player: x.playerId, rank: x.rank, score: x.score })) } : {}),
      });
    }
  }
}

/** /draw-contest namespace 事件接線（薄）：驗證 payload 形狀 → 呼叫 Room → ack 與執行效果 */
export function registerDrawContest(nsp: DrawContestNamespace, options: RegisterOptions = {}): Room {
  const room: Room = new Room({
    clock: options.clock,
    durations: options.durations,
    judge: options.judge ?? judgeSetupFromEnv(),
    onJudgeFallback: (info) => log.warn('draw-contest.judge.fallback', { ...info }),
    comment: options.comment ?? commentSetupFromEnv(),
    // 評語成功的 log（題目、分數、字數、耗時）由評語器回報：commentary/index.ts 的 draw-contest.comment.done
    // failed：consecutive 為本回合連續失敗次數（達 2 才跳過剩餘，skipped 列出被跳過者）；
    // 第一名稱讚版（praise: true）多帶 fallback：'criticism' = 已退回批評版、null = 沒有退路（§5 評語，Phase 5）
    onCommentFailure: (info) => log.warn('draw-contest.comment.failed', { ...info }),
    onCommentSkip: (info) => log.info('draw-contest.comment.skipped', { ...info }),
    onAsyncEffects: (effects) => {
      try {
        applyEffects(nsp, room, effects);
        logRoundEffects(effects);
      } catch (err) {
        log.error('draw-contest.async.error', { err: String(err) });
      }
    },
  });

  nsp.on('connection', (socket) => {
    const addr = clientAddress(socket.handshake.headers, socket.handshake.address);
    log.info('draw-contest.connect', { id: socket.id, addr });

    socket.on('player:join', (payload: unknown, ack: unknown) => {
      // 不帶 callback 的惡意／錯誤客戶端：無法回快照，直接忽略
      if (typeof ack !== 'function') {
        log.warn('draw-contest.join.noAck', { socket: socket.id });
        return;
      }
      if (!socket.connected) return;
      const reply = ack as (r: Ack<JoinResult>) => void;
      try {
        const parsed = readJoinPayload(payload);
        if (parsed === null) {
          reply({ ok: false, error: 'NICKNAME_INVALID', message: NICKNAME_INVALID_MESSAGE });
          return;
        }
        const { nickname, token } = parsed;
        const { ack: result, effects } = room.join(socket.id, nickname, token);
        // 先 ack 再送效果：中途加入者在 join ack 之後補收畫廊（§4）
        reply(result);
        applyEffects(nsp, room, effects);
        if (result.ok) {
          log.info('draw-contest.join', {
            socket: socket.id,
            player: result.data.snapshot.you,
            takeover: effects.some((e) => e.kind === 'disconnect'),
            withToken: token !== undefined,
            addr,
          });
        } else {
          log.info('draw-contest.join.rejected', { socket: socket.id, error: result.error, addr });
        }
      } catch (err) {
        log.error('draw-contest.join.error', { socket: socket.id, err: String(err) });
      }
    });

    /** 回合事件的共同處理：呼叫 Room → ack（若有）→ 執行效果 → log */
    const handleAction = (event: string, run: (payload: unknown) => ActionOutcome) => (...args: unknown[]) => {
      const { payload, reply } = splitArgs(args);
      try {
        const { ack, effects } = run(payload);
        reply?.(ack);
        applyEffects(nsp, room, effects);
        logRoundEffects(effects);
        log.info(`draw-contest.${event}`, {
          socket: socket.id,
          player: room.playerIdOf(socket.id) ?? null,
          ok: ack.ok,
          ...(ack.ok ? {} : { error: ack.error }),
          ...(reply ? {} : { noAck: true }),
        });
      } catch (err) {
        log.error(`draw-contest.${event}.error`, { socket: socket.id, err: String(err) });
      }
    };

    socket.on('round:volunteer', handleAction('volunteer', () => room.volunteer(socket.id)));

    socket.on(
      'round:setTopic',
      handleAction('setTopic', (payload) => {
        const topic =
          typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>).topic : undefined;
        if (typeof topic !== 'string') {
          return { ack: { ok: false, error: 'TOPIC_INVALID', message: TOPIC_INVALID_MESSAGE }, effects: [] };
        }
        return room.setTopic(socket.id, topic);
      }),
    );

    socket.on('round:cancel', handleAction('cancel', () => room.cancel(socket.id)));

    // contest:submit：payload 形狀與 PNG 內容都在 Room.submit 驗（§5 交卷檢查順序：phase → 參賽者 → 已交卷 → PNG）
    socket.on('contest:submit', (...args: unknown[]) => {
      const { payload, reply } = splitArgs<Ack<{ bytes: number }>>(args);
      try {
        const { ack, effects } = room.submit(socket.id, payload);
        reply?.(ack);
        applyEffects(nsp, room, effects);
        logRoundEffects(effects);
        log.info('draw-contest.submit', {
          socket: socket.id,
          player: room.playerIdOf(socket.id) ?? null,
          ok: ack.ok,
          ...(ack.ok ? { bytes: ack.data.bytes } : { error: ack.error }),
          ...(reply ? {} : { noAck: true }),
        });
      } catch (err) {
        log.error('draw-contest.submit.error', { socket: socket.id, err: String(err) });
      }
    });

    // chat:send：payload 形狀不對（不是物件、text 不是字串）→ MESSAGE_INVALID；其餘判定都在 Room.chat
    socket.on(
      'chat:send',
      handleAction('chat', (payload) => {
        const text =
          typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>).text : undefined;
        if (typeof text !== 'string') {
          return { ack: { ok: false, error: 'MESSAGE_INVALID', message: CHAT_ERROR_MESSAGES.MESSAGE_INVALID }, effects: [] };
        }
        return room.chat(socket.id, text);
      }),
    );

    socket.on('disconnect', (reason) => {
      try {
        const player = room.playerIdOf(socket.id);
        applyEffects(nsp, room, room.disconnect(socket.id));
        log.info('draw-contest.disconnect', { socket: socket.id, player: player ?? null, reason });
      } catch (err) {
        log.error('draw-contest.disconnect.error', { socket: socket.id, err: String(err) });
      }
    });
  });

  return room;
}
