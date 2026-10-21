// 複製自 draw-contest/room.ts @ commit 6ba1031，獨立演進（加入／接管／寬限／暱稱／ROOM_FULL／Effect 模式／注入時鐘；不共用程式）。
//
// 猜歌 Room 狀態機（純邏輯，不依賴 socket.io）：spec/song-guess/architecture.md §5
// 每個方法回傳「要送出的效果」（Effect[]），由 register.ts 負責實際 emit / 斷線。
// 計時器觸發的轉移（寬限期到期、出題期限、試聽播完、揭曉停留）沒有呼叫端可回傳，改走建構子注入的 onAsyncEffects。
// 唯一的非同步動作是 setSource（Epic 18 前叫 setArtist；歌手模式向 iTunes 搜尋、榜單模式取排行榜、動漫熱門（Epic 19）
// 取三關鍵字聯集）：回傳 Promise，取歌回來才決定 ack 與效果；搜尋器、排行榜取得器與動漫熱門題庫取得器由建構子注入。
//
// 一局：idle → choosing → (playing → reveal) × SONGS_PER_GAME → ended（ended 視同 idle，可再 volunteer）。
// - choosing：出題期限計時（含取歌時間）；逾時／cancel／出題者離開 → idle（results、lastTopic、lastSource 保留）。
//   取歌進行中再送 → SEARCH_BUSY（四種來源共用同一個旗標）；取歌回來時已不是同一次 choosing → 結果丟棄、ack NOT_SETTER。
// - 取歌成功：gameNo++、參賽者＝此刻在線者、全員 gameScore 歸零、results／lastTopic／lastSource 清空、進入第 1 首。
// - playing：startedAt＝進入的 now + START_DELAY_MS（客戶端先下載試聽再同時起播），endsAt＝startedAt + durationMs；
//   計時器到 → reveal。**不因全員猜對或人數不足提早結束**（每首播到底）。
// - reveal：公布歌名與本首得分，停 REVEAL_SECONDS；計時器到 → 下一首 playing，最後一首 → ended。
// - ended：results（ranking.ts）、lastTopic＝本局 topic（歌手模式為正式名）、lastSource＝本局 source、reveal 保留最後一首；無計時器。
//
// 答案只在 server：歌名在 reveal 之前不出現在任何對外 payload（previewUrl 不含歌名，titleLength 只給去掉空白標點後的字數）。
import { randomUUID } from 'node:crypto';
import {
  ARTIST_INVALID_MESSAGE,
  CHAT_HISTORY,
  CHOOSING_SECONDS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  NICKNAME_TAKEN_MESSAGE,
  PREVIEW_CAP_MS,
  RECONNECT_GRACE_SECONDS,
  REVEAL_SECONDS,
  SONGS_PER_GAME,
  SOURCE_TITLE,
  START_DELAY_MS,
  nicknameKey,
  titleLength,
  validateArtist,
  validateNickname,
  type Ack,
  type ChatKind,
  type ChatMessage,
  type ErrorCode,
  type JoinResult,
  type PlayerPublic,
  type RoomSnapshot,
  type RoundPublic,
  type ServerToClientEvents,
  type SongPublic,
  type SongReveal,
  type SongSource,
  type SongSourcePayload,
} from '@fishing-work/shared/song-guess';
import { CHAT_ERROR_MESSAGES, guessScore, isRateLimited, judgeMessage, validateChatText } from './chat';
import type { AnimePoolFetcher, ChartCountry, ChartFetcher, ItunesTrack, SongSearcher } from './itunes';
import { pick, pickAnime, pickChart, type PickedSong } from './picker';
import { rankGame, type GameStat } from './ranking';

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

/** 各計時長度（毫秒）；正式環境一律用 shared 常數（previewCapMs 可由環境變數 SONG_PREVIEW_CAP_MS 覆寫），測試可覆寫 */
export interface RoomDurations {
  graceMs: number;
  choosingMs: number;
  /** 每首揭曉停留 */
  revealMs: number;
  /** 進入 playing 到 startedAt 的起播緩衝 */
  startDelayMs: number;
  /** 單首最長播放毫秒：durationMs = min(trackTimeMillis ?? cap, cap) */
  previewCapMs: number;
}

export const DEFAULT_DURATIONS: Readonly<RoomDurations> = {
  graceMs: RECONNECT_GRACE_SECONDS * 1000,
  choosingMs: CHOOSING_SECONDS * 1000,
  revealMs: REVEAL_SECONDS * 1000,
  startDelayMs: START_DELAY_MS,
  previewCapMs: PREVIEW_CAP_MS,
};

export interface RoomOptions {
  clock?: Clock;
  /** 產生 player id 與 token（預設 crypto.randomUUID；測試注入可預期的值） */
  newId?: () => string;
  /** 計時器觸發的轉移所產生的效果 */
  onAsyncEffects?: (effects: Effect[]) => void;
  /** 覆寫計時長度（測試、環境變數） */
  durations?: Partial<RoomDurations>;
  /** 歌手搜尋器（預設：一律失敗，Room 本身不碰網路）；正式環境由 register 依環境變數建立（itunes.ts） */
  search?: SongSearcher;
  /** 排行榜取得器（Epic 18；預設：一律失敗 → CHART_FAILED）；正式環境由 register 依環境變數建立（itunes.ts） */
  chart?: ChartFetcher;
  /** 動漫熱門題庫取得器（Epic 19；預設：一律失敗 → CHART_FAILED）；正式環境由 register 依環境變數建立（itunes.ts） */
  animePool?: AnimePoolFetcher;
  /** 抽歌用的亂數，回 [0, 1)（預設 Math.random；測試注入） */
  random?: () => number;
}

export interface JoinOutcome {
  ack: Ack<JoinResult>;
  effects: Effect[];
}

export interface ActionOutcome {
  ack: Ack;
  effects: Effect[];
}

export interface SetSourceOutcome {
  ack: Ack<{ topic: string }>;
  effects: Effect[];
}

/** 榜單來源（Epic 18；動漫熱門不是榜單，Epic 19 另走 animePool） */
type ChartSource = 'tw-hot' | 'western-hot';

/** 榜單來源對應的國家（Epic 18 決策 4：西洋熱門＝美國榜） */
export const CHART_COUNTRY = { 'tw-hot': 'tw', 'western-hot': 'us' } as const satisfies Record<ChartSource, ChartCountry>;

/**
 * 解析 round:setSource 的 payload（不信任客戶端；§5 choosing）：
 * 不是物件、source 不是四值之一（Epic 19 加 'anime-hot'）、歌手模式 hot 不是 boolean（含缺漏）→ SOURCE_INVALID；
 * 歌手模式 artist 不是字串 → ARTIST_INVALID（歌手名的內容由 Room 以 validateArtist 驗）；榜單與動漫熱門多帶的欄位忽略。
 */
export function parseSourcePayload(
  payload: unknown,
): { ok: true; payload: SongSourcePayload } | { ok: false; error: 'SOURCE_INVALID' | 'ARTIST_INVALID' } {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return { ok: false, error: 'SOURCE_INVALID' };
  const p = payload as Record<string, unknown>;
  if (p.source === 'tw-hot' || p.source === 'western-hot' || p.source === 'anime-hot') return { ok: true, payload: { source: p.source } };
  if (p.source !== 'artist' || typeof p.hot !== 'boolean') return { ok: false, error: 'SOURCE_INVALID' };
  if (typeof p.artist !== 'string') return { ok: false, error: 'ARTIST_INVALID' };
  return { ok: true, payload: { source: 'artist', artist: p.artist, hot: p.hot } };
}

/** 回合相關錯誤的繁中訊息（ack.message，客戶端直接顯示）；§5.3，其餘與繪圖比賽同文案 */
export const ROUND_ERROR_MESSAGES = {
  NOT_IN_ROOM: '請先加入房間',
  ROUND_BUSY: '目前已有回合進行中',
  NOT_SETTER: '只有本回合的出題者可以這麼做',
  NOT_ENOUGH_PLAYERS: `至少要 ${MIN_PLAYERS} 位在線玩家才能開始`,
  ROOM_FULL: `房間已滿（上限 ${MAX_PLAYERS} 人），請稍後再試`,
  ARTIST_INVALID: ARTIST_INVALID_MESSAGE,
  ARTIST_NOT_FOUND: `找不到這位歌手的歌（至少要 ${SONGS_PER_GAME} 首有試聽的歌），換一位試試`,
  SEARCH_FAILED: '搜尋失敗，請再試一次',
  SEARCH_BUSY: '搜尋中，請稍候',
  SOURCE_INVALID: '題庫來源不正確，請重新選擇',
  // 2026-10-20 Epic 19：由「取得排行榜失敗」改通用文案（榜單與動漫熱門共用；§5.3）
  CHART_FAILED: '取得題庫失敗，請再試一次',
} as const satisfies Partial<Record<ErrorCode, string>>;

type RoundErrorCode = keyof typeof ROUND_ERROR_MESSAGES;

/** abort 的觸發原因（choosing → idle） */
type AbortCause = 'cancel' | 'timeout' | 'setterLeft';

interface PlayerState {
  id: string;
  token: string;
  nickname: string;
  /** 總分（各局得分累加） */
  score: number;
  /** 本局得分（新局開始歸零） */
  gameScore: number;
  /** 本局猜對首數 */
  correctCount: number;
  /** 本局最後一次得分的時間（排名同分時先達到者在前） */
  lastScoreAt: number | null;
  joinedAt: number;
  /** 目前綁定的 socket；null = 斷線中（寬限期） */
  socketId: string | null;
  graceTimer: TimerHandle | null;
  /** 最後一則被接受的聊天訊息時間（間隔限制用；被拒的訊息不更新） */
  lastChatAt: number | null;
}

/** 進行中的一局（playing／reveal）：抽到的歌與目前進度。答案只存在這裡 */
interface GameState {
  songs: PickedSong[];
  /** 目前第幾首（0 起） */
  index: number;
  /** 本首各猜對者得分，依猜對順序 */
  scores: { playerId: string; score: number }[];
}

/** Room 內部保存的回合狀態：對外的 RoundPublic 少了 serverNow（送出當下才填） */
type RoundState = Omit<RoundPublic, 'serverNow'>;

/** 上一局的排名與其題庫（§4 欄位生命週期：results、lastTopic、lastSource 一起保留、一起清空） */
type LastGame = Pick<RoundPublic, 'results' | 'lastTopic' | 'lastSource'>;

const NO_LAST_GAME: LastGame = { results: null, lastTopic: null, lastSource: null };

/** idle 回合；gameNo、results、lastTopic、lastSource 沿用上一局（排名停著） */
function idleRound(gameNo: number, last: LastGame): RoundState {
  return {
    gameNo,
    phase: 'idle',
    setterId: null,
    source: null,
    artist: null,
    artistHot: false,
    topic: null,
    songCount: SONGS_PER_GAME,
    endsAt: null,
    song: null,
    reveal: null,
    results: last.results,
    lastTopic: last.lastTopic,
    lastSource: last.lastSource,
    participantIds: [],
  };
}

function lastGameOf(r: RoundState): LastGame {
  return { results: r.results, lastTopic: r.lastTopic, lastSource: r.lastSource };
}

function freezeSong(s: SongPublic | null): SongPublic | null {
  return s === null ? null : { ...s, correctIds: [...s.correctIds] };
}

function freezeReveal(r: SongReveal | null): SongReveal | null {
  return r === null ? null : { ...r, scores: r.scores.map((e) => ({ ...e })) };
}

/** 定格複本並填入 serverNow（陣列與巢狀物件都複製，之後狀態改變不影響已送出的效果） */
function freezeRound(r: RoundState, serverNow: number): RoundPublic {
  return {
    ...r,
    song: freezeSong(r.song),
    reveal: freezeReveal(r.reveal),
    results: r.results === null ? null : r.results.map((e) => ({ ...e })),
    participantIds: [...r.participantIds],
    serverNow,
  };
}

function fail(error: RoundErrorCode): ActionOutcome {
  return { ack: { ok: false, error, message: ROUND_ERROR_MESSAGES[error] }, effects: [] };
}

function sourceFail(error: RoundErrorCode): SetSourceOutcome {
  return { ack: { ok: false, error, message: ROUND_ERROR_MESSAGES[error] }, effects: [] };
}

function chatFail(error: 'MESSAGE_INVALID' | 'RATE_LIMITED' | 'SPOILER_BLOCKED', message: string): ActionOutcome {
  return { ack: { ok: false, error, message }, effects: [] };
}

const OK: Ack = { ok: true, data: undefined };

/** Room 未注入搜尋器時的預設：一律失敗（→ SEARCH_FAILED），確保純邏輯的 Room 不會碰網路 */
const NO_SEARCH: SongSearcher = () => Promise.reject(new Error('未設定歌手搜尋器'));
/** Room 未注入排行榜取得器時的預設：一律失敗（→ CHART_FAILED） */
const NO_CHART: ChartFetcher = () => Promise.reject(new Error('未設定排行榜取得器'));
/** Room 未注入動漫熱門題庫取得器時的預設：一律失敗（→ CHART_FAILED；Epic 19） */
const NO_ANIME: AnimePoolFetcher = () => Promise.reject(new Error('未設定動漫熱門題庫取得器'));

// ─── Room ─────────────────────────────────────────────────────────

export class Room {
  protected readonly clock: Clock;
  private readonly newId: () => string;
  private readonly onAsyncEffects: (effects: Effect[]) => void;
  private readonly durations: RoomDurations;
  private readonly search: SongSearcher;
  private readonly chart: ChartFetcher;
  private readonly animePool: AnimePoolFetcher;
  private readonly random: () => number;

  /** 依加入順序插入；playerList() 另依 joinedAt 排序 */
  protected readonly players = new Map<string, PlayerState>();
  private readonly bySocket = new Map<string, string>();
  private readonly byToken = new Map<string, string>();

  protected round: RoundState = idleRound(0, NO_LAST_GAME);
  private roundTimer: TimerHandle | null = null;
  /** 進行中的一局；playing／reveal 以外為 null */
  private game: GameState | null = null;

  /** 每次進入或離開 choosing 就 +1：搜尋回來時與出發時不同 → 已不是同一次 choosing，結果丟棄 */
  private choosingSeq = 0;
  /** 本次 choosing 有取歌進行中（SEARCH_BUSY 用；四種來源共用）；離開 choosing 時清掉 */
  private searching = false;

  /** 環狀緩衝：最多 CHAT_HISTORY 則 */
  private readonly chatLog: ChatMessage[] = [];
  private chatSeq = 0;

  constructor(options: RoomOptions = {}) {
    this.clock = options.clock ?? realClock;
    this.newId = options.newId ?? (() => randomUUID());
    this.onAsyncEffects = options.onAsyncEffects ?? (() => {});
    // 只採用有給數值的欄位（呼叫端可能傳 { previewCapMs: undefined }），其餘用預設
    const durations: RoomDurations = { ...DEFAULT_DURATIONS };
    for (const key of Object.keys(durations) as (keyof RoomDurations)[]) {
      const value = options.durations?.[key];
      if (typeof value === 'number') durations[key] = value;
    }
    this.durations = durations;
    this.search = options.search ?? NO_SEARCH;
    this.chart = options.chart ?? NO_CHART;
    this.animePool = options.animePool ?? NO_ANIME;
    this.random = options.random ?? Math.random;
  }

  // ─── 玩家轉移 ───────────────────────────────────────────────────

  /**
   * 加入（三種 join，與另兩款相同）：
   * - 重複：該 socket 已綁定玩家 → 冪等回目前 token 與快照，忽略 payload。
   * - 接管：token 對到現存玩家 → 綁新 socket、踢舊 socket、取消寬限計時，忽略 nickname。
   * - 新玩家：人數（含寬限期中）< MAX_PLAYERS；暱稱合法且未被占用（不分大小寫，含寬限期中的玩家）。
   * 中途加入者不列入 participantIds，但快照帶進行中的那首（previewUrl、startedAt、serverNow），可以接著聽、可以猜。
   */
  join(socketId: string, nickname: string, token?: string): JoinOutcome {
    const boundId = this.bySocket.get(socketId);
    if (boundId !== undefined) return { ack: this.joinAck(this.mustGet(boundId)), effects: [] };

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
      gameScore: 0,
      correctCount: 0,
      lastScoreAt: null,
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
      effects: [this.playersUpdate(), { kind: 'emit', to: { except: player.id }, event: 'chat:message', payload: msg }],
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

  /**
   * 出題：phase = idle／ended、在線人數 ≥ MIN_PLAYERS → choosing（results、lastTopic、lastSource 保留，畫面繼續顯示上一局排名）。
   * choosing／playing／reveal（不論是誰）→ ROUND_BUSY。
   */
  volunteer(socketId: string): ActionOutcome {
    const player = this.playerBySocket(socketId);
    if (player === undefined) return fail('NOT_IN_ROOM');
    if (this.round.phase !== 'idle' && this.round.phase !== 'ended') return fail('ROUND_BUSY');
    if (this.onlineCount() < MIN_PLAYERS) return fail('NOT_ENOUGH_PLAYERS');

    this.game = null;
    this.choosingSeq++;
    this.searching = false;
    const now = this.clock.now();
    this.round = {
      ...idleRound(this.round.gameNo, lastGameOf(this.round)),
      phase: 'choosing',
      setterId: player.id,
      endsAt: now + this.durations.choosingMs,
    };
    this.setRoundTimer(this.durations.choosingMs, () => this.abort('timeout'));
    return { ack: OK, effects: [this.roundUpdate(now), this.playersUpdate()] };
  }

  /**
   * 出題者送題庫來源（非同步；Epic 18 前為 setArtist）。payload 來自客戶端、不信任。
   * 檢查順序（§5 choosing；SOURCE_INVALID → ARTIST_INVALID → SEARCH_BUSY，與 Epic 16 相同：先驗輸入再看忙碌）：
   * payload 形狀（parseSourcePayload：SOURCE_INVALID，歌手模式 artist 不是字串 → ARTIST_INVALID；比照 Epic 16 在
   * register 先驗形狀，所以早於身分檢查）→ 未加入 NOT_IN_ROOM → 階段與身分（setterGate）→ 歌手模式歌手名內容不合法
   * ARTIST_INVALID → 本次 choosing 取歌進行中（四種來源共用）SEARCH_BUSY。
   * 取歌回來：
   * - 已不是同一次 choosing（逾時、取消、出題者離開，或之後又開了新的 choosing）→ 結果丟棄、ack NOT_SETTER。
   * - 歌手：搜尋失敗 → SEARCH_FAILED；可抽的歌不足 → ARTIST_NOT_FOUND。
   * - 榜單：RSS／lookup 失敗或可抽的歌不足 → CHART_FAILED。
   * - 動漫熱門（Epic 19）：任一關鍵字搜尋失敗或可抽的歌不足 → CHART_FAILED。
   * - 失敗都仍在 choosing、期限不變，出題者可重試或換來源；成功 → 開始新的一局、進入第 1 首 playing，ack { topic }。
   * 效果在 ack 之後才送（register 先回 ack 再 emit）。
   */
  setSource(socketId: string, rawPayload: unknown): Promise<SetSourceOutcome> {
    const parsed = parseSourcePayload(rawPayload);
    if (!parsed.ok) return Promise.resolve(sourceFail(parsed.error));
    const { payload } = parsed;
    const player = this.playerBySocket(socketId);
    if (player === undefined) return Promise.resolve(sourceFail('NOT_IN_ROOM'));
    const denied = this.setterGate(player);
    if (denied !== null) return Promise.resolve(sourceFail(denied));

    let artist: string | null = null;
    if (payload.source === 'artist') {
      const check = validateArtist(payload.artist);
      if (!check.ok) return Promise.resolve(sourceFail('ARTIST_INVALID'));
      artist = check.artist;
    }
    if (this.searching) return Promise.resolve(sourceFail('SEARCH_BUSY'));

    const seq = this.choosingSeq;
    this.searching = true;
    let request: Promise<ItunesTrack[]>;
    try {
      if (artist !== null) request = this.search(artist);
      else if (payload.source === 'anime-hot') request = this.animePool();
      else request = this.chart(CHART_COUNTRY[payload.source as ChartSource]);
    } catch (err) {
      request = Promise.reject(err);
    }
    const failCode: RoundErrorCode = artist !== null ? 'SEARCH_FAILED' : 'CHART_FAILED';
    return request.then(
      (tracks) => {
        if (!this.finishSearch(seq)) return sourceFail('NOT_SETTER');
        if (payload.source === 'artist' && artist !== null) {
          const picked = pick(tracks, artist, SONGS_PER_GAME, this.random, { hot: payload.hot });
          if (picked === null) return sourceFail('ARTIST_NOT_FOUND');
          return this.startGame(player, { source: 'artist', artist, artistHot: payload.hot, topic: picked.topic }, picked.songs);
        }
        const songs = payload.source === 'anime-hot' ? pickAnime(tracks, SONGS_PER_GAME, this.random) : pickChart(tracks, SONGS_PER_GAME, this.random);
        if (songs === null) return sourceFail('CHART_FAILED');
        const source = payload.source as Exclude<SongSource, 'artist'>;
        return this.startGame(player, { source, artist: null, artistHot: false, topic: SOURCE_TITLE[source] }, songs);
      },
      () => (this.finishSearch(seq) ? sourceFail(failCode) : sourceFail('NOT_SETTER')),
    );
  }

  /** 出題者在 choosing 取消 → idle（搜尋進行中也可以取消，結果回來時丟棄）。其餘階段見 setterGate */
  cancel(socketId: string): ActionOutcome {
    const player = this.playerBySocket(socketId);
    if (player === undefined) return fail('NOT_IN_ROOM');
    const denied = this.setterGate(player);
    if (denied !== null) return fail(denied);
    return { ack: OK, effects: this.abort('cancel') };
  }

  /**
   * 聊天與猜題（§5「猜題」、§5.2）：未加入 → NOT_IN_ROOM；文字不合法 → MESSAGE_INVALID；
   * 距上一則被接受的訊息 < CHAT_MIN_INTERVAL_MS → RATE_LIMITED。
   * playing 時依 judgeMessage 判定：猜對 → 得分並廣播「X 猜對了」（不含原文）；含歌名 → SPOILER_BLOCKED（不廣播）；其餘照常廣播。
   * 出題者、中途加入者都可以猜、都得分。只有被接受的訊息（含猜對）才更新間隔時間戳。
   */
  chat(socketId: string, rawText: string): ActionOutcome {
    const player = this.playerBySocket(socketId);
    if (player === undefined) return fail('NOT_IN_ROOM');
    const check = validateChatText(rawText);
    if (!check.ok) return chatFail('MESSAGE_INVALID', CHAT_ERROR_MESSAGES.MESSAGE_INVALID);
    const now = this.clock.now();
    if (isRateLimited(player.lastChatAt, now)) return chatFail('RATE_LIMITED', CHAT_ERROR_MESSAGES.RATE_LIMITED);
    const { text } = check;

    const { phase, song } = this.round;
    const current = this.currentSong();
    if (phase === 'playing' && song !== null && current !== null) {
      const verdict = judgeMessage(text, current.title, song.correctIds.includes(player.id));
      if (verdict === 'correct') return this.correctGuess(player, song, now);
      if (verdict === 'spoilerGuessed') return chatFail('SPOILER_BLOCKED', CHAT_ERROR_MESSAGES.SPOILER_BLOCKED);
      if (verdict === 'spoilerGuess') return chatFail('SPOILER_BLOCKED', CHAT_ERROR_MESSAGES.SPOILER_BLOCKED_GUESS);
    }

    player.lastChatAt = now;
    const msg = this.pushMessage('chat', text, player, now);
    return { ack: OK, effects: [{ kind: 'emit', to: 'all', event: 'chat:message', payload: msg }] };
  }

  /** 清掉所有計時器（伺服器關閉、測試收尾）；進行中的搜尋回來時會因 choosingSeq 不同而被丟棄 */
  dispose(): void {
    for (const p of this.players.values()) this.cancelGrace(p);
    this.clearRoundTimer();
    this.choosingSeq++;
    this.searching = false;
  }

  // ─── 查詢與投影 ───────────────────────────────────────────────────

  snapshot(forPlayerId: string): RoomSnapshot {
    return {
      you: forPlayerId,
      players: this.playerList(),
      round: this.currentRound(),
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

  /** 目前回合狀態（複本；serverNow 為呼叫當下的時鐘） */
  currentRound(): RoundPublic {
    return freezeRound(this.round, this.clock.now());
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

  /**
   * setSource／cancel 的共同權限（§5「階段不符」）：choosing 的出題者通過（null）；
   * playing／reveal（不論是誰）→ ROUND_BUSY；idle／ended、或 choosing 的非出題者 → NOT_SETTER。
   */
  private setterGate(player: PlayerState): 'ROUND_BUSY' | 'NOT_SETTER' | null {
    const { phase, setterId } = this.round;
    if (phase === 'playing' || phase === 'reveal') return 'ROUND_BUSY';
    if (phase !== 'choosing' || setterId !== player.id) return 'NOT_SETTER';
    return null;
  }

  /** 搜尋回來：是否仍是出發時的那次 choosing。是 → 清掉搜尋中旗標（可再送）；否 → 旗標屬於別次 choosing，不動 */
  private finishSearch(seq: number): boolean {
    if (this.choosingSeq !== seq || this.round.phase !== 'choosing') return false;
    this.searching = false;
    return true;
  }

  /** 進行中的那首（答案）；playing／reveal 以外為 null */
  private currentSong(): PickedSong | null {
    return this.game === null ? null : (this.game.songs[this.game.index] ?? null);
  }

  /**
   * 取歌成功 → 新的一局（§5 choosing）：gameNo++、參賽者＝此刻 connected 的玩家、全員本局統計歸零、
   * source／artist／artistHot／topic 定案、results／lastTopic／lastSource 清空、進入第 1 首。
   * 效果：round:update → players:update → 系統訊息「X 出題「{topic}」，共 5 首」（不加「熱門」字樣）。
   */
  private startGame(
    setter: PlayerState,
    bank: Pick<RoundPublic, 'artist' | 'artistHot' | 'topic'> & { source: SongSource; topic: string },
    songs: PickedSong[],
  ): SetSourceOutcome {
    this.choosingSeq++;
    this.searching = false;
    for (const p of this.players.values()) {
      p.gameScore = 0;
      p.correctCount = 0;
      p.lastScoreAt = null;
    }
    this.game = { songs, index: 0, scores: [] };
    this.round = {
      ...idleRound(this.round.gameNo + 1, NO_LAST_GAME),
      setterId: setter.id,
      source: bank.source,
      artist: bank.artist,
      artistHot: bank.artistHot,
      topic: bank.topic,
      participantIds: this.playerList().filter((p) => p.connected).map((p) => p.id),
    };
    const effects = this.playSong(0);
    const msg = this.pushSystem(`${setter.nickname} 出題「${bank.topic}」，共 ${songs.length} 首`);
    effects.push({ kind: 'emit', to: 'all', event: 'chat:message', payload: msg });
    return { ack: { ok: true, data: { topic: bank.topic } }, effects };
  }

  /**
   * 進入第 index+1 首的 playing（§5 playing）：startedAt＝now + 起播緩衝、endsAt＝startedAt + durationMs；
   * 全員 hasGuessed 清空（由 correctIds 推導）；計時器到 endsAt → reveal。效果：round:update → players:update。
   */
  private playSong(index: number): Effect[] {
    const game = this.game;
    const picked = game?.songs[index];
    if (game === null || picked === undefined) return [];
    game.index = index;
    game.scores = [];

    // durationMs = min(trackTimeMillis ?? cap, cap)；全長不明或不是正數（不該發生）時以上限代替
    const cap = this.durations.previewCapMs;
    const full = picked.trackTimeMillis;
    const durationMs = full !== null && full > 0 ? Math.min(full, cap) : cap;
    const now = this.clock.now();
    const startedAt = now + this.durations.startDelayMs;
    const endsAt = startedAt + durationMs;
    this.round = {
      ...this.round,
      phase: 'playing',
      endsAt,
      song: {
        index: index + 1,
        previewUrl: picked.previewUrl,
        artist: picked.artist,
        startedAt,
        endsAt,
        durationMs,
        titleLength: titleLength(picked.title),
        correctIds: [],
      },
      reveal: null,
    };
    this.setRoundTimer(endsAt - now, () => this.toReveal());
    return [this.roundUpdate(now), this.playersUpdate()];
  }

  /**
   * 猜對（§5 猜題）：得分依 startedAt 起算的已用時間，加到本局得分與總分；correctIds 追加。
   * 效果依 spec 順序：chat:message（correct「X 猜對了」，不含原文）→ players:update → round:update。歌照播，不提早結束。
   */
  private correctGuess(player: PlayerState, song: SongPublic, now: number): ActionOutcome {
    const score = guessScore(song.startedAt, now, song.durationMs);
    player.lastChatAt = now;
    player.score += score;
    player.gameScore += score;
    player.correctCount += 1;
    player.lastScoreAt = now;
    this.game?.scores.push({ playerId: player.id, score });
    this.round = { ...this.round, song: { ...song, correctIds: [...song.correctIds, player.id] } };

    // 訊息的 at 與 round 的 serverNow 都用計分的那個 now：客戶端以 at − startedAt 代入計分式可以驗算出同一個分數
    const msg = this.pushMessage('correct', `${player.nickname} 猜對了`, player, now);
    return {
      ack: OK,
      effects: [{ kind: 'emit', to: 'all', event: 'chat:message', payload: msg }, this.playersUpdate(), this.roundUpdate(now)],
    };
  }

  /** playing → reveal（試聽播完）：公布歌名、歌手、專輯、封面與本首得分；endsAt＝now + 揭曉停留；song 與 hasGuessed 保留 */
  private toReveal(): Effect[] {
    const game = this.game;
    const picked = this.currentSong();
    if (this.round.phase !== 'playing' || game === null || picked === null) return [];
    const index = game.index + 1;
    const now = this.clock.now();
    this.round = {
      ...this.round,
      phase: 'reveal',
      endsAt: now + this.durations.revealMs,
      reveal: {
        index,
        title: picked.title,
        artist: picked.artist,
        album: picked.album,
        artworkUrl: picked.artworkUrl,
        itunesUrl: picked.itunesUrl,
        scores: game.scores.map((e) => ({ ...e })),
      },
    };
    this.setRoundTimer(this.durations.revealMs, () => this.afterReveal());
    const msg = this.pushMessage('system', `第 ${index} 首：《${picked.title}》`, undefined, now);
    return [this.roundUpdate(now), { kind: 'emit', to: 'all', event: 'chat:message', payload: msg }];
  }

  /** 揭曉停留結束：還有下一首 → playing；最後一首 → ended（第 5 首同樣停滿揭曉時間） */
  private afterReveal(): Effect[] {
    const game = this.game;
    if (this.round.phase !== 'reveal' || game === null) return [];
    if (game.index + 1 < game.songs.length) return this.playSong(game.index + 1);
    return this.end();
  }

  /**
   * reveal（最後一首）→ ended：results（§5.1）、lastTopic＝本局 topic（歌手模式為正式名，不是輸入值）、lastSource＝本局 source、
   * reveal 保留最後一首、song 清空；無計時器。
   * 效果：round:update → players:update（hasGuessed 清空）→ 系統訊息。
   */
  private end(): Effect[] {
    this.clearRoundTimer();
    const stats = new Map<string, GameStat>();
    for (const p of this.players.values()) {
      stats.set(p.id, { gameScore: p.gameScore, correctCount: p.correctCount, lastScoreAt: p.lastScoreAt });
    }
    const results = rankGame(this.round.participantIds, stats, (id) => this.players.get(id)?.nickname ?? '');
    this.game = null;
    this.round = {
      ...this.round,
      phase: 'ended',
      endsAt: null,
      song: null,
      results,
      lastTopic: this.round.topic,
      lastSource: this.round.source,
    };

    const first = results[0];
    const text =
      first !== undefined && first.gameScore > 0
        ? `本局第一名：${first.nickname}（${first.gameScore} 分）`
        : '本局結束：沒有人猜對';
    const msg = this.pushSystem(text);
    return [this.roundUpdate(), this.playersUpdate(), { kind: 'emit', to: 'all', event: 'chat:message', payload: msg }];
  }

  /**
   * 玩家真正離開後的回合處理（§5 離開）：
   * - 出題者在 choosing 離開 → idle（進行中的搜尋結果丟棄）。
   * - playing／reveal：從 participantIds 移除；本首的 correctIds 與得分紀錄也移除（玩家物件已不在，id 沒有對象）；
   *   局照走（計時器驅動，人數掉到 1 或 0 也不中止），離開者不進本局排名。出題者離開不影響。
   * - ended：從 participantIds 移除；results 與 reveal 是已揭曉的紀錄，不變動。
   */
  private roundAfterLeave(left: PlayerState): Effect[] {
    const { phase, setterId, participantIds, song, reveal } = this.round;
    if (phase === 'choosing') return setterId === left.id ? this.abort('setterLeft', left.nickname) : [];
    if (phase === 'idle') return [];

    const wasParticipant = participantIds.includes(left.id);
    const inSong = phase !== 'ended' && song !== null && song.correctIds.includes(left.id);
    if (!wasParticipant && !inSong) return [];

    this.round = { ...this.round, participantIds: participantIds.filter((id) => id !== left.id) };
    if (inSong && song !== null) {
      if (this.game !== null) this.game.scores = this.game.scores.filter((e) => e.playerId !== left.id);
      this.round = {
        ...this.round,
        song: { ...song, correctIds: song.correctIds.filter((id) => id !== left.id) },
        reveal: reveal === null ? null : { ...reveal, scores: reveal.scores.filter((e) => e.playerId !== left.id) },
      };
    }
    return [this.roundUpdate()];
  }

  /** 出題階段中止：choosing → idle（results、lastTopic、lastSource 保留；進行中的取歌結果回來時丟棄） */
  private abort(cause: AbortCause, leftNickname?: string): Effect[] {
    const setter = this.round.setterId === null ? undefined : this.players.get(this.round.setterId);
    const nickname = setter?.nickname ?? leftNickname ?? '';
    this.clearRoundTimer();
    this.choosingSeq++;
    this.searching = false;
    this.round = idleRound(this.round.gameNo, lastGameOf(this.round));

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

  /**
   * round:update：payload 在此刻定格。serverNow 預設取當下的時鐘；
   * 轉移本身用 now 算出 endsAt／startedAt 時（volunteer、playSong、toReveal、猜對），把同一個 now 傳進來——
   * 時鐘只取一次，客戶端看到的 `endsAt − serverNow`、`startedAt − serverNow` 才會剛好等於常數
   * （分兩次取在機器忙時會差 1 ms：2026-10-12 協定測試在三支同時跑時抓到）。
   */
  private roundUpdate(now: number = this.clock.now()): Effect {
    return { kind: 'emit', to: 'all', event: 'round:update', payload: freezeRound(this.round, now) };
  }

  // ─── 其他內部 ─────────────────────────────────────────────────────

  /** isSetter／hasGuessed 由回合狀態推導：isSetter 在 idle 為 false（ended 仍為 true）；hasGuessed 只在 playing／reveal 有值 */
  private toPublic(p: PlayerState): PlayerPublic {
    const { phase, setterId, song } = this.round;
    const guessed = (phase === 'playing' || phase === 'reveal') && song !== null && song.correctIds.includes(p.id);
    return {
      id: p.id,
      nickname: p.nickname,
      score: p.score,
      gameScore: p.gameScore,
      isSetter: phase !== 'idle' && setterId === p.id,
      hasGuessed: guessed,
      connected: p.socketId !== null,
      joinedAt: p.joinedAt,
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

  /** 訊息入環狀緩衝（最多 CHAT_HISTORY 則）後回傳；system 的 fromId / nickname 為 null。at 預設取當下的時鐘（呼叫端已取過 now 就傳進來） */
  private pushMessage(kind: ChatKind, text: string, from?: PlayerState, at: number = this.clock.now()): ChatMessage {
    const msg: ChatMessage = {
      id: `m${++this.chatSeq}`,
      kind,
      fromId: kind === 'system' ? null : (from?.id ?? null),
      nickname: kind === 'system' ? null : (from?.nickname ?? null),
      text,
      at,
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
