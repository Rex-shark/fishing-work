import type { Namespace } from 'socket.io';
import {
  IMAGE_SKIP_BUFFER_BYTES,
  NICKNAME_INVALID_MESSAGE,
  type Ack,
  type ClientToServerEvents,
  type JoinResult,
  type ServerToClientEvents,
} from '@fishing-work/shared';
import { log } from '../../lib/log';
import { clientAddress } from '../../lib/network';
import { CHAT_ERROR_MESSAGES } from './chat';
import { IMAGE_ERROR_MESSAGES, readImagePayload } from './image';
import { Room, type ActionOutcome, type Clock, type Effect, type RoomDurations } from './room';
import { partitionRecipients, pendingBytes } from './slowLink';
import { TOPIC_INVALID_MESSAGE } from './topic';

export type DrawGuessNamespace = Namespace<ClientToServerEvents, ServerToClientEvents>;

/** v1 單一房間 */
export const ROOM_ID = 'main';
/** token 為 UUID（36 字）；過長者直接視為沒帶 */
const TOKEN_MAX_LENGTH = 64;

/** 查某條 socket（以 socket id 表示）目前的待送量（bytes）；慢連線保護用（§5「圖片訊息」） */
export type PendingBytesOf = (socketId: string) => number;

export interface RegisterOptions {
  clock?: Clock;
  durations?: Partial<RoomDurations>;
  /** 覆寫待送量查詢（e2e 模擬慢連線用）；預設讀 engine.io writeBuffer ＋ ws bufferedAmount（見 slowLink.ts） */
  pendingBytesOf?: PendingBytesOf;
}

/** 預設待送量查詢：namespace 內找 socket → engine.io 連線 → pendingBytes；找不到（已離線）為 0 */
export function defaultPendingBytesOf(nsp: DrawGuessNamespace): PendingBytesOf {
  return (socketId) => pendingBytes(nsp.sockets.get(socketId)?.conn);
}

/** applyEffects 的選項 */
export interface ApplyOptions {
  /** 省略時用 defaultPendingBytesOf(nsp) */
  pendingBytesOf?: PendingBytesOf;
}

/** 讀取 player:join 的 payload；不信任客戶端：payload 不是物件回 null，形狀不對的欄位視為缺省（nickname 視為空字串 → NICKNAME_INVALID） */
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
function splitArgs(args: unknown[]): { payload: unknown; reply: ((r: Ack) => void) | undefined } {
  const last = args.at(-1);
  if (typeof last === 'function') {
    return { payload: args.length > 1 ? args[0] : undefined, reply: last as (r: Ack) => void };
  }
  return { payload: args[0], reply: undefined };
}

/**
 * 執行 Room 回傳的效果：emit 依收件者對應到 socket；disconnect 強制斷開指定 socket。
 * chat:image（固定 payload）另做慢連線保護（§5「圖片訊息」）：待送量 > IMAGE_SKIP_BUFFER_BYTES 的收件者改收
 * { id, data: null }。正常群組**單次** nsp.to([...]).emit（Socket.IO 只編碼一次、二進位共用同一個 Buffer），
 * 略過群組再單次廣播一則極小的 data: null。
 */
export function applyEffects(nsp: DrawGuessNamespace, room: Room, effects: Effect[], options: ApplyOptions = {}): void {
  for (const effect of effects) {
    if (effect.kind === 'disconnect') {
      nsp.sockets.get(effect.socketId)?.disconnect(true);
      continue;
    }
    const recipients = room.recipients(effect.to);
    // 注意：nsp.to([]) 會變成廣播給整個 namespace，因此沒有收件者時必須跳過
    if (recipients.length === 0) continue;
    // Effect 在建立時已依事件名稱約束 payload 型別；這裡以寬鬆簽章送出
    const send = (socketIds: string | string[], payload: unknown) =>
      (nsp.to(socketIds).emit as (event: string, payload: unknown) => boolean)(effect.event, payload);
    if (effect.event === 'chat:image' && typeof effect.payload !== 'function' && effect.payload.data !== null) {
      const { id } = effect.payload;
      const { normal, skipped } = partitionRecipients(
        recipients.map((r) => r.socketId),
        options.pendingBytesOf ?? defaultPendingBytesOf(nsp),
        IMAGE_SKIP_BUFFER_BYTES,
      );
      if (normal.length > 0) send(normal, effect.payload);
      if (skipped.length > 0) {
        send(skipped, { id, data: null });
        log.info('draw-guess.image.skipped', { id, skipped, delivered: normal.length });
      }
      continue;
    }
    const { payload } = effect;
    if (typeof payload === 'function') {
      // 依收件者產生（round:update 遮罩 topic）
      for (const r of recipients) send(r.socketId, payload(r.playerId));
    } else {
      send(recipients.map((r) => r.socketId), payload);
    }
  }
}

/** /draw-guess namespace 事件接線（薄）：驗證 payload 形狀 → 呼叫 Room → ack 與執行效果 */
export function registerDrawGuess(nsp: DrawGuessNamespace, options: RegisterOptions = {}): Room {
  const apply: ApplyOptions = { pendingBytesOf: options.pendingBytesOf ?? defaultPendingBytesOf(nsp) };
  const room: Room = new Room({
    clock: options.clock,
    durations: options.durations,
    onAsyncEffects: (effects) => {
      try {
        applyEffects(nsp, room, effects, apply);
      } catch (err) {
        log.error('draw-guess.async.error', { err: String(err) });
      }
    },
  });

  nsp.on('connection', (socket) => {
    const addr = clientAddress(socket.handshake.headers, socket.handshake.address);
    log.info('draw-guess.connect', { id: socket.id, addr });

    socket.on('player:join', (payload: unknown, ack: unknown) => {
      // 不帶 callback 的惡意／錯誤客戶端：無法回快照，直接忽略
      if (typeof ack !== 'function') {
        log.warn('draw-guess.join.noAck', { socket: socket.id });
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
        reply(result);
        applyEffects(nsp, room, effects, apply);
        if (result.ok) {
          log.info('draw-guess.join', {
            socket: socket.id,
            player: result.data.snapshot.you,
            takeover: effects.some((e) => e.kind === 'disconnect'),
            withToken: token !== undefined,
            addr,
          });
        } else {
          log.info('draw-guess.join.rejected', { socket: socket.id, error: result.error, addr });
        }
      } catch (err) {
        log.error('draw-guess.join.error', { socket: socket.id, err: String(err) });
      }
    });

    /** 回合事件的共同處理：呼叫 Room → ack（若有）→ 執行效果 → log */
    const handleAction = (event: string, run: (payload: unknown) => ActionOutcome) => (...args: unknown[]) => {
      const { payload, reply } = splitArgs(args);
      try {
        const { ack, effects } = run(payload);
        reply?.(ack);
        applyEffects(nsp, room, effects, apply);
        log.info(`draw-guess.${event}`, {
          socket: socket.id,
          player: room.playerIdOf(socket.id) ?? null,
          ok: ack.ok,
          ...(ack.ok ? {} : { error: ack.error }),
          ...(reply ? {} : { noAck: true }),
        });
      } catch (err) {
        log.error(`draw-guess.${event}.error`, { socket: socket.id, err: String(err) });
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

    // chat:image（§5「圖片訊息」）：沒帶 ack 直接忽略（傳圖者無從得知結果，不值得廣播最大 MAX_IMAGE_BYTES 的資料）；
    // payload 形狀不對 → IMAGE_INVALID；其餘判定都在 Room.image。bytes 只經手、不保存。
    socket.on('chat:image', (...args: unknown[]) => {
      const { payload, reply } = splitArgs(args);
      if (reply === undefined) {
        log.warn('draw-guess.image.noAck', { socket: socket.id });
        return;
      }
      const respond = reply as (r: Ack<{ id: string }>) => void;
      try {
        const parsed = readImagePayload(payload);
        if (parsed === null) {
          respond({ ok: false, error: 'IMAGE_INVALID', message: IMAGE_ERROR_MESSAGES.PAYLOAD });
          log.info('draw-guess.image', { socket: socket.id, player: room.playerIdOf(socket.id) ?? null, ok: false, error: 'IMAGE_INVALID', reason: 'payload' });
          return;
        }
        const { ack, effects } = room.image(socket.id, parsed.meta, parsed.data);
        respond(ack);
        applyEffects(nsp, room, effects, apply);
        log.info('draw-guess.image', {
          socket: socket.id,
          player: room.playerIdOf(socket.id) ?? null,
          ok: ack.ok,
          mime: parsed.meta.mime,
          bytes: parsed.data.byteLength,
          ...(ack.ok ? { id: ack.data.id } : { error: ack.error }),
        });
      } catch (err) {
        log.error('draw-guess.image.error', { socket: socket.id, err: String(err) });
      }
    });

    // draw:op 無 ack；形狀與權限驗證都在 Room.draw，不合法者丟棄並 log（不回錯誤、不斷線）
    socket.on('draw:op', (op: unknown) => {
      try {
        const { effects, dropped, quiet } = room.draw(socket.id, op);
        if (dropped !== null) {
          // strokeLimit 每回合只記第一次（spec §9.1，Epic 21 決策 11）；其後同類丟棄 quiet，不寫 log
          if (quiet === true) return;
          // 回合剛結束時畫師仍在途的 op 也會落到這裡，屬正常競態，用 info
          log.info('draw-guess.draw.dropped', { socket: socket.id, player: room.playerIdOf(socket.id) ?? null, reason: dropped });
          return;
        }
        applyEffects(nsp, room, effects, apply);
      } catch (err) {
        log.error('draw-guess.draw.error', { socket: socket.id, err: String(err) });
      }
    });

    socket.on('disconnect', (reason) => {
      try {
        const player = room.playerIdOf(socket.id);
        applyEffects(nsp, room, room.disconnect(socket.id), apply);
        log.info('draw-guess.disconnect', { socket: socket.id, player: player ?? null, reason });
      } catch (err) {
        log.error('draw-guess.disconnect.error', { socket: socket.id, err: String(err) });
      }
    });
  });

  return room;
}
