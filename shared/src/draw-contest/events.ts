// shared/src/draw-contest/events.ts
// 契約來源：spec/draw-contest/architecture.md §4（逐字照抄，修改需經架構師海圖定案並先改 spec）

export const DRAW_CONTEST_NAMESPACE = '/draw-contest';

export type ContestPhase = 'idle' | 'choosing' | 'drawing' | 'judging' | 'ended';

/** 評分器：ai = Clef 決策模型；random = 隨機（MVP 預設，或 AI 失敗退回） */
export type JudgeMode = 'ai' | 'random';
/** Epic 15：本回合評語器；'off' = 環境變數關閉或本回合連續兩次失敗跳過 */
export type CommentMode = 'ai' | 'off';
/** Epic 20：回合模式；topic＝只有題目（現況）；mimic＝像不像比賽（出題附參考圖，評分為與參考圖的相似度） */
export type ContestMode = 'topic' | 'mimic';

export interface PlayerPublic {
  id: string;             // server 產生的穩定 id（重連接管後不變）
  nickname: string;
  score: number;          // 總分（各回合得分累加）
  connected: boolean;     // false = 斷線中（RECONNECT_GRACE_SECONDS 寬限期內）
  joinedAt: number;       // epoch ms
  isSetter: boolean;      // 本回合出題者
  participating: boolean; // 本回合參賽者（drawing 開始時在線者；中途加入者 false）
  submitted: boolean;     // 本回合已交卷
}

/** 揭曉的一筆結果；results 依 rank 升冪排列 */
export interface ResultEntry {
  playerId: string;
  nickname: string;
  rank: number;                 // 1 起；未交卷者排在所有交卷者之後
  score: number;                // 本回合得分 0..SCORE_MAX；未交卷 0
  confidence: number | null;    // 評分器信心 0..1；未交卷 null
  judgedBy: JudgeMode | null;   // 這張用哪個評分器；未交卷 null
  submitted: boolean;
  submittedAt: number | null;   // epoch ms；同分者先交卷在前
  comment: string | null;       // Epic 15：メスガキ評語；未交卷、關閉、失敗或尚未產生皆 null
  commentPending: boolean;      // Epic 15：true = 評語還在產生中（之後會收到 contest:comment）；未交卷／off 一律 false
}

export interface RoundPublic {
  roundNo: number;              // 第幾回合（從 1 起；idle 且從未開始為 0）；contest:gallery 以此配對
  phase: ContestPhase;
  setterId: string | null;      // 出題者；idle 為 null
  topic: string | null;         // drawing 起所有人看得到；choosing 時尚未設定為 null
  mode: ContestMode | null;     // Epic 20：drawing 起有值（setTopic 帶 reference → 'mimic'，否則 'topic'）；idle／choosing 為 null
  startedAt: number | null;     // drawing 開始 epoch ms
  endsAt: number | null;        // choosing：出題期限；drawing：交卷期限；其餘 null
  participantIds: string[];     // 本回合參賽者（drawing 開始時定案；寬限期滿離開者移除）
  submittedCount: number;       // 已交卷人數
  judgedCount: number;          // 已評分人數
  judgeMode: JudgeMode | null;  // 本回合評分器（judging 起；AI 失敗退回後為 'random'）
  commentMode: CommentMode | null; // Epic 15：本回合評語器（judging 起；關閉或本回合失敗跳過後為 'off'）；生命週期同 judgeMode
  results: ResultEntry[] | null; // ended 才有；下一回合 drawing 開始時清空（idle／choosing 期間資料保留；畫面上 idle／ended 顯示畫廊，choosing 不顯示）
  lastTopic: string | null;     // results 對應的題目（揭曉畫面與中途加入者顯示用）；與 results 同生命週期
  lastMode: ContestMode | null; // Epic 20：results 對應的模式；與 results 同生命週期
}

export type ChatKind = 'chat' | 'system';
export interface ChatMessage {
  id: string;
  kind: ChatKind;
  fromId: string | null;        // system 為 null
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

/** 揭曉時每位交卷者一則；round.results 有值時才會收到；中途加入者在 join ack 之後補收 */
export interface GalleryImage { roundNo: number; playerId: string; png: ArrayBuffer }

/** Epic 15：一張畫的評語完成（成功為字串、失敗為 null）；只在 ended 之後才發，ended 前完成的直接寫進 results */
export interface CommentUpdate { roundNo: number; playerId: string; comment: string | null }

/** Epic 20：像不像比賽的參考圖（客戶端正規化後的 JPEG，長邊 ≤ 1280）；drawing 開始時廣播；join 時若 round.mode 為 mimic（本回合）或 results 非 null 且 lastMode 為 mimic（上回合）則補送 */
export interface ReferenceImage { roundNo: number; jpeg: ArrayBuffer }

export type ErrorCode =
  | 'NICKNAME_INVALID' | 'NICKNAME_TAKEN' | 'NOT_IN_ROOM' | 'ROOM_FULL'
  | 'ROUND_BUSY' | 'NOT_SETTER' | 'NOT_ENOUGH_PLAYERS' | 'TOPIC_INVALID'
  | 'NOT_DRAWING' | 'NOT_PARTICIPANT' | 'ALREADY_SUBMITTED' | 'SUBMISSION_INVALID' | 'REFERENCE_INVALID'
  | 'MESSAGE_INVALID' | 'RATE_LIMITED';

export type Ack<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: ErrorCode; message: string };   // message 為繁體中文，可直接顯示

export interface ClientToServerEvents {
  'player:join': (payload: { nickname: string; token?: string }, ack: (r: Ack<JoinResult>) => void) => void;
  /** 我出題：idle／ended 且在線 ≥ MIN_PLAYERS → choosing */
  'round:volunteer': (ack: (r: Ack) => void) => void;
  /** 出題者送題 → drawing（參賽者＝此刻在線者）；Epic 20：reference 為選填的參考圖（JPEG bytes，1..MAX_REFERENCE_BYTES），有 → 本回合 mode 'mimic' */
  'round:setTopic': (payload: { topic: string; reference?: ArrayBuffer }, ack: (r: Ack) => void) => void;
  /** 出題者在 choosing 取消 → idle */
  'round:cancel': (ack: (r: Ack) => void) => void;
  /** 交卷：drawing（或 endsAt 後 SUBMIT_GRACE_SECONDS 內）、參賽者、每回合一次；png 為 PNG 檔 bytes */
  'contest:submit': (payload: { png: ArrayBuffer }, ack: (r: Ack<{ bytes: number }>) => void) => void;
  'chat:send': (payload: { text: string }, ack: (r: Ack) => void) => void;
}

export interface ServerToClientEvents {
  'players:update': (players: PlayerPublic[]) => void;
  'round:update': (round: RoundPublic) => void;
  /** 揭曉：每位交卷者一則（ended 時廣播；join 時若 results 非 null 則補送） */
  'contest:gallery': (image: GalleryImage) => void;
  /** Epic 20：mimic 回合的參考圖；drawing 開始時廣播給所有在線者，join 時依 ReferenceImage 註解補送 */
  'contest:reference': (image: ReferenceImage) => void;
  /** Epic 15：ended 後評語陸續完成時廣播；收到即把 results 該筆的 comment 填入、commentPending 設 false */
  'contest:comment': (update: CommentUpdate) => void;
  'chat:message': (message: ChatMessage) => void;
}
