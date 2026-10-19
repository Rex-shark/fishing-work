// /song-guess namespace 接線（薄）：spec/song-guess/architecture.md §4
// 驗證 payload 形狀 → 呼叫 Room → ack 與執行效果；寫法比照 draw-contest/register.ts（獨立複製，不共用程式）。
// 與另兩款不同的只有 round:setSource（Epic 18 前為 round:setArtist，不保留舊名）：Room 要先向 iTunes 搜尋或取排行榜，
// 回傳 Promise，取歌回來才 ack 與送效果。
import type { Namespace } from 'socket.io';
import {
  NICKNAME_INVALID_MESSAGE,
  type Ack,
  type ClientToServerEvents,
  type JoinResult,
  type ServerToClientEvents,
} from '@fishing-work/shared/song-guess';
import { log } from '../../lib/log';
import { clientAddress } from '../../lib/network';
import { CHAT_ERROR_MESSAGES } from './chat';
import { songGuessSetupFromEnv, type ChartFetcher, type SongSearcher } from './itunes';
import { Room, type ActionOutcome, type Clock, type Effect, type RoomDurations } from './room';

export type SongGuessNamespace = Namespace<ClientToServerEvents, ServerToClientEvents>;

/** token 為 UUID（36 字）；過長者直接視為沒帶 */
const TOKEN_MAX_LENGTH = 64;

export interface RegisterOptions {
  clock?: Clock;
  /** 覆寫計時長度（測試用）；previewCapMs 未給時用環境變數 SONG_PREVIEW_CAP_MS（預設 shared 的 PREVIEW_CAP_MS） */
  durations?: Partial<RoomDurations>;
  /** 歌手搜尋器（測試注入）；預設依環境變數 ITUNES_URL 等建立帶快取的 iTunes 客戶端（itunes.ts） */
  search?: SongSearcher;
  /** 排行榜取得器（測試注入；Epic 18）；預設依環境變數 ITUNES_RSS_URL、ITUNES_URL 等建立（與搜尋器共用同一個 iTunes 客戶端） */
  chart?: ChartFetcher;
  /** 抽歌用的亂數（測試注入；預設 Math.random） */
  random?: () => number;
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
export function applyEffects(nsp: SongGuessNamespace, room: Room, effects: Effect[]): void {
  for (const effect of effects) {
    if (effect.kind === 'disconnect') {
      nsp.sockets.get(effect.socketId)?.disconnect(true);
      continue;
    }
    const recipients = room.recipients(effect.to);
    // 注意：nsp.to([]) 會變成廣播給整個 namespace，因此沒有收件者時必須跳過
    if (recipients.length === 0) continue;
    // Effect 在建立時已依事件名稱約束 payload 型別；這裡以寬鬆簽章送出
    (nsp.to(recipients.map((r) => r.socketId)).emit as (event: string, payload: unknown) => boolean)(
      effect.event,
      effect.payload,
    );
  }
}

/** 記錄回合轉移，方便從 log 追一局：每首開始（不含歌名）、每首揭曉（歌名與得分）、本局排名 */
function logRoundEffects(effects: Effect[]): void {
  for (const e of effects) {
    if (e.kind !== 'emit' || e.event !== 'round:update') continue;
    const r = e.payload as Parameters<ServerToClientEvents['round:update']>[0];
    if (r.phase === 'playing' && r.song !== null && r.song.correctIds.length === 0) {
      log.info('song-guess.round', {
        gameNo: r.gameNo,
        phase: r.phase,
        source: r.source,
        topic: r.topic,
        hot: r.artistHot,
        song: r.song.index,
        durationMs: r.song.durationMs,
        titleLength: r.song.titleLength,
      });
    } else if (r.phase === 'reveal' && r.reveal !== null) {
      log.info('song-guess.round', { gameNo: r.gameNo, phase: r.phase, song: r.reveal.index, title: r.reveal.title, scores: r.reveal.scores });
    } else if (r.phase === 'ended' && r.results !== null) {
      log.info('song-guess.round', {
        gameNo: r.gameNo,
        phase: r.phase,
        source: r.lastSource,
        topic: r.lastTopic,
        results: r.results.map((x) => ({ player: x.playerId, rank: x.rank, gameScore: x.gameScore, correct: x.correctCount })),
      });
    }
  }
}

/** /song-guess namespace 事件接線（薄）：驗證 payload 形狀 → 呼叫 Room → ack 與執行效果 */
export function registerSongGuess(nsp: SongGuessNamespace, options: RegisterOptions = {}): Room {
  // 搜尋器、排行榜取得器與播放上限：三者都有注入時不讀環境變數（測試不需要 iTunes 客戶端）
  const needEnv = options.search === undefined || options.chart === undefined || options.durations?.previewCapMs === undefined;
  const fromEnv = needEnv ? songGuessSetupFromEnv() : null;
  const room: Room = new Room({
    clock: options.clock,
    durations: { ...(fromEnv ? { previewCapMs: fromEnv.previewCapMs } : {}), ...options.durations },
    search: options.search ?? fromEnv?.search,
    chart: options.chart ?? fromEnv?.chart,
    random: options.random,
    onAsyncEffects: (effects) => {
      try {
        applyEffects(nsp, room, effects);
        logRoundEffects(effects);
      } catch (err) {
        log.error('song-guess.async.error', { err: String(err) });
      }
    },
  });

  nsp.on('connection', (socket) => {
    const addr = clientAddress(socket.handshake.headers, socket.handshake.address);
    log.info('song-guess.connect', { id: socket.id, addr });

    socket.on('player:join', (payload: unknown, ack: unknown) => {
      // 不帶 callback 的惡意／錯誤客戶端：無法回快照，直接忽略
      if (typeof ack !== 'function') {
        log.warn('song-guess.join.noAck', { socket: socket.id });
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
        applyEffects(nsp, room, effects);
        if (result.ok) {
          log.info('song-guess.join', {
            socket: socket.id,
            player: result.data.snapshot.you,
            takeover: effects.some((e) => e.kind === 'disconnect'),
            withToken: token !== undefined,
            addr,
          });
        } else {
          log.info('song-guess.join.rejected', { socket: socket.id, error: result.error, addr });
        }
      } catch (err) {
        log.error('song-guess.join.error', { socket: socket.id, err: String(err) });
      }
    });

    /** ack（若有）→ 執行效果 → log；同步與非同步的回合事件共用 */
    const finish = <T>(event: string, reply: ((r: Ack<T>) => void) | undefined, outcome: { ack: Ack<T>; effects: Effect[] }): void => {
      const { ack, effects } = outcome;
      // 先 ack 再廣播（與另兩款一致）：setSource 成功時出題者先收到 ack，再收到第 1 首的 round:update
      reply?.(ack);
      applyEffects(nsp, room, effects);
      logRoundEffects(effects);
      log.info(`song-guess.${event}`, {
        socket: socket.id,
        player: room.playerIdOf(socket.id) ?? null,
        ok: ack.ok,
        ...(ack.ok ? {} : { error: ack.error }),
        ...(reply ? {} : { noAck: true }),
      });
    };

    /** 同步回合事件的共同處理：呼叫 Room → ack（若有）→ 執行效果 → log */
    const handleAction = (event: string, run: (payload: unknown) => ActionOutcome) => (...args: unknown[]) => {
      const { payload, reply } = splitArgs(args);
      try {
        finish(event, reply, run(payload));
      } catch (err) {
        log.error(`song-guess.${event}.error`, { socket: socket.id, err: String(err) });
      }
    };

    socket.on('round:volunteer', handleAction('volunteer', () => room.volunteer(socket.id)));

    // round:setSource：payload 形狀（SOURCE_INVALID 等）、判定與取歌都在 Room.setSource（非同步；parseSourcePayload）
    socket.on('round:setSource', (...args: unknown[]) => {
      const { payload, reply } = splitArgs<Ack<{ topic: string }>>(args);
      const onError = (err: unknown): void => log.error('song-guess.setSource.error', { socket: socket.id, err: String(err) });
      try {
        room.setSource(socket.id, payload).then((outcome) => {
          try {
            finish('setSource', reply, outcome);
          } catch (err) {
            onError(err);
          }
        }, onError);
      } catch (err) {
        onError(err);
      }
    });

    socket.on('round:cancel', handleAction('cancel', () => room.cancel(socket.id)));

    // chat:send：payload 形狀不對（不是物件、text 不是字串）→ MESSAGE_INVALID；其餘判定（含猜題）都在 Room.chat
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
        log.info('song-guess.disconnect', { socket: socket.id, player: player ?? null, reason });
      } catch (err) {
        log.error('song-guess.disconnect.error', { socket: socket.id, err: String(err) });
      }
    });
  });

  return room;
}
