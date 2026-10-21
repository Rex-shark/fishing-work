// 契約來源：spec/song-guess/architecture.md §4（逐字照抄，修改需經架構師海圖定案並先改 spec）

export const SONG_GUESS_NAMESPACE = '/song-guess';

/** idle：沒有局；choosing：出題者選題庫（含 server 取歌中）；playing：某一首播放中；reveal：該首揭曉（REVEAL_SECONDS）；ended：第 5 首揭曉後的本局排名 */
export type SongPhase = 'idle' | 'choosing' | 'playing' | 'reveal' | 'ended';

/** 題庫來源（Epic 18／19）：artist＝出題者填歌手；tw-hot＝Apple Music 台灣熱門榜（當日前 100）；western-hot＝西洋熱門（美國榜當日前 100）；anime-hot＝動漫熱門（anime／アニメ／動漫 三關鍵字搜尋聯集前 ANIME_HOT_POOL 首） */
export type SongSource = 'artist' | 'tw-hot' | 'western-hot' | 'anime-hot';

/** round:setSource 的 payload；artist 模式的 hot＝只從搜尋結果前 HOT_POOL 首抽（對話框預設勾） */
export type SongSourcePayload =
  | { source: 'artist'; artist: string; hot: boolean }
  | { source: 'tw-hot' }
  | { source: 'western-hot' }
  | { source: 'anime-hot' };

export interface PlayerPublic {
  id: string;            // server 產生的穩定 id（重連接管後不變）
  nickname: string;
  score: number;         // 總分（各局得分累加）
  gameScore: number;     // 本局得分（新局開始歸零；ended 保留到下一局開始）
  isSetter: boolean;     // 本局出題者（ended 仍為 true，下一局開始才清）
  hasGuessed: boolean;   // 本首已猜對（reveal 保留，下一首開始清；非 playing／reveal 為 false）
  connected: boolean;    // false = 斷線中（RECONNECT_GRACE_SECONDS 寬限期內）
  joinedAt: number;      // epoch ms
}

/** 播放中的一首（playing／reveal 都有）；答案欄位只在 reveal 才有值 */
export interface SongPublic {
  index: number;         // 第幾首，1..SONGS_PER_GAME
  previewUrl: string;    // Apple 試聽網址（網址不含歌名）；客戶端直接以 <audio> 載入
  artist: string;        // 本首歌手（iTunes artistName）；playing 起顯示，是提示的一部分（榜單模式每首不同；Epic 18）
  startedAt: number;     // 開始播放 epoch ms（server 時鐘）＝ 進入 playing 的 now + START_DELAY_MS（讓客戶端先下載試聽）；計分從 startedAt 起算；中途加入者以 serverNow − startedAt 定位
  endsAt: number;        // 試聽結束 epoch ms（= startedAt + durationMs）
  durationMs: number;    // 本首播放長度 = min(trackTimeMillis ?? SONG_PREVIEW_CAP_MS, SONG_PREVIEW_CAP_MS)
  titleLength: number;   // 歌名字數提示：normalizeTitle(title) 的 code point 數（去副標、不含空白與標點）
  correctIds: string[];  // 本首已猜對者，依猜對順序
}

/** 揭曉資料：只在 reveal 與 ended（最後一首）時隨 round:update 送出 */
export interface SongReveal {
  index: number;
  title: string;         // 顯示用原始歌名（含副標）
  artist: string;
  album: string | null;
  artworkUrl: string | null;   // Apple 專輯封面（100px，可把 100x100 換成 300x300）
  itunesUrl: string | null;    // trackViewUrl
  scores: { playerId: string; score: number }[];   // 本首各猜對者得分，依猜對順序
}

/** 本局排名的一筆；ended 時依 rank 升冪 */
export interface GameResultEntry {
  playerId: string;
  nickname: string;
  rank: number;          // 1 起；同分者依先達到該分數者在前
  gameScore: number;
  correctCount: number;  // 本局猜對幾首
}

export interface RoundPublic {
  gameNo: number;                // 第幾局（從 1 起；從未開始為 0）
  phase: SongPhase;
  setterId: string | null;       // 出題者；idle 為 null
  source: SongSource | null;     // 題庫來源（第一首開始起；idle 為 null）
  artist: string | null;         // source = 'artist' 時出題者輸入的歌手名（第一首開始起所有人看得到）；其餘 null
  artistHot: boolean;            // source = 'artist' 時是否只抽熱門歌（HOT_POOL）；其餘 false
  topic: string | null;          // 題庫標題（顯示用；第一首開始起）：'artist' ＝ iTunes 回傳的歌手正式名；'tw-hot'／'western-hot'／'anime-hot' ＝ SOURCE_TITLE（「台灣熱門」／「西洋熱門」／「動漫熱門」）
  songCount: number;             // = SONGS_PER_GAME
  endsAt: number | null;         // choosing：出題期限；playing：= song.endsAt；reveal：下一首開始時間；其餘 null
  song: SongPublic | null;       // playing／reveal 時有值
  reveal: SongReveal | null;     // reveal 時為本首；ended 時為最後一首；其餘 null
  results: GameResultEntry[] | null;  // ended 才有；下一局搜尋成功、進入第 1 首時才清空（idle／choosing 期間保留，畫面顯示上一局排名）
  lastTopic: string | null;      // results 對應的題庫標題（= 該局 topic）；與 results 同生命週期
  lastSource: SongSource | null; // results 對應的題庫來源（= 該局 source）；與 results 同生命週期
  serverNow: number;             // 送出當下的 server 時鐘 epoch ms（客戶端算時鐘偏移用）
  participantIds: string[];      // 本局參賽者（choosing 搜尋成功時定案＝此刻 connected 的玩家；寬限期滿離開者移除；中途加入者不加入但可猜）
}

export type ChatKind = 'chat' | 'system' | 'correct';
export interface ChatMessage {
  id: string;
  kind: ChatKind;
  fromId: string | null;        // system 為 null；correct 為猜對者本人
  nickname: string | null;
  text: string;
  at: number;
}

export interface RoomSnapshot {
  you: string;
  players: PlayerPublic[];
  round: RoundPublic;
  chat: ChatMessage[];          // 最近 CHAT_HISTORY 則
}

/** join 成功的回傳；token 為重連憑證（客戶端存 sessionStorage） */
export interface JoinResult { token: string; snapshot: RoomSnapshot }

export type ErrorCode =
  | 'NICKNAME_INVALID' | 'NICKNAME_TAKEN' | 'NOT_IN_ROOM' | 'ROOM_FULL'
  | 'ROUND_BUSY' | 'NOT_SETTER' | 'NOT_ENOUGH_PLAYERS' | 'ARTIST_INVALID'
  | 'ARTIST_NOT_FOUND' | 'SEARCH_FAILED' | 'SEARCH_BUSY' | 'SOURCE_INVALID' | 'CHART_FAILED'
  | 'MESSAGE_INVALID' | 'SPOILER_BLOCKED' | 'RATE_LIMITED';

export type Ack<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: ErrorCode; message: string };   // message 為繁體中文，可直接顯示

export interface ClientToServerEvents {
  'player:join': (payload: { nickname: string; token?: string }, ack: (r: Ack<JoinResult>) => void) => void;
  /** 出題：idle／ended 且在線 ≥ MIN_PLAYERS → choosing */
  'round:volunteer': (ack: (r: Ack) => void) => void;
  /** 出題者送題庫來源 → server 取歌（artist：搜尋 iTunes；tw-hot／western-hot：排行榜 RSS ＋ lookup）；成功 ack 後進入第 1 首 playing；
   *  失敗 ack 帶 ARTIST_INVALID／ARTIST_NOT_FOUND／SEARCH_FAILED／CHART_FAILED／SOURCE_INVALID，仍在 choosing */
  'round:setSource': (payload: SongSourcePayload, ack: (r: Ack<{ topic: string }>) => void) => void;
  /** 出題者在 choosing 取消 → idle */
  'round:cancel': (ack: (r: Ack) => void) => void;
  'chat:send': (payload: { text: string }, ack: (r: Ack) => void) => void;
}

export interface ServerToClientEvents {
  'players:update': (players: PlayerPublic[]) => void;
  'round:update': (round: RoundPublic) => void;
  'chat:message': (message: ChatMessage) => void;
}
