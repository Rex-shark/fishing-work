// 契約來源：spec/architecture.md §4（逐字照抄，修改需經舵手定案並先改 spec）

export const DRAW_GUESS_NAMESPACE = '/draw-guess';

/** 畫布座標一律正規化為 0..1（相對於邏輯畫布 1280×720） */
export interface Point { x: number; y: number }

export type Tool = 'pen' | 'eraser';

/** 畫布操作：畫師送出、server 驗證後轉發並存入本回合歷史 */
export type DrawOp =
  | { type: 'begin'; strokeId: string; tool: Tool; color: string; size: number; point: Point }  // color 為 #RRGGBB（任意色）；size 為整數 BRUSH_MIN..BRUSH_MAX
  | { type: 'move';  strokeId: string; points: Point[] }          // 每個動畫影格批次送一次
  | { type: 'end';   strokeId: string }
  | { type: 'undo';  strokeId: string }                           // 移除該筆畫，客戶端重繪
  | { type: 'clear' }                                             // 只清筆跡，不重設背景（Epic 7）
  | { type: 'background'; color: string };                        // 畫布背景色（Epic 7）：#RRGGBB；歷史只保留最後一個；每回合從 CANVAS_BACKGROUND 開始

export type RoundPhase = 'idle' | 'choosing' | 'drawing' | 'ended';
export type EndReason = 'allGuessed' | 'timeout' | 'drawerLeft' | 'cancelled' | null;

export interface PlayerPublic {
  id: string;            // server 產生的穩定 id（不是 socket.id；重連接管後不變）
  nickname: string;
  score: number;
  isDrawer: boolean;
  hasGuessed: boolean;   // 本回合已猜對
  connected: boolean;    // false = 斷線中（RECONNECT_GRACE_SECONDS 寬限期內，可用 token 接回）
  joinedAt: number;      // epoch ms
}

/** 回合狀態。topic 依收件者不同：畫師在 choosing/drawing 看得到；所有人在 ended 看得到；其餘為 null */
export interface RoundPublic {
  phase: RoundPhase;
  drawerId: string | null;
  topic: string | null;
  topicLength: number | null;   // 給猜題者的提示（字數）
  startedAt: number | null;     // drawing 開始 epoch ms
  endsAt: number | null;        // drawing 結束期限 epoch ms；choosing 時為出題期限
  correctIds: string[];
  endReason: EndReason;
}

export type ChatKind = 'chat' | 'system' | 'correct' | 'image';
export type ImageMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
/** 圖片中繼資料：進聊天歷史；圖片本體不進歷史（不保留），只以 chat:image 送給當時在線者。bytes 由 server 依實際 data 長度填入 */
export interface ImageMeta { mime: ImageMime; width: number; height: number; bytes: number }
export interface ChatMessage {
  id: string;
  kind: ChatKind;
  fromId: string | null;        // system 為 null；correct 為猜對者本人；image 為傳圖者
  nickname: string | null;
  text: string;                 // image 時為空字串
  at: number;
  image?: ImageMeta;            // kind 為 image 時必有
}
/** 圖片 bytes：與同 id 的 chat:message 成對，緊接其後送出。data 為 null = server 因該連線待送量過大而略過這張（連線較慢） */
export interface ImagePayload { id: string; data: ArrayBuffer | null }

export interface RoomSnapshot {
  you: string;                  // 自己的 player id
  players: PlayerPublic[];
  round: RoundPublic;
  ops: DrawOp[];                // 本回合筆跡歷史，供中途加入者重播
  chat: ChatMessage[];          // 最近 CHAT_HISTORY 則
}

/** join 成功的回傳。token 是重連憑證，只給本人；客戶端存 sessionStorage，下次 join 帶上即可接管 */
export interface JoinResult { token: string; snapshot: RoomSnapshot }

export type ErrorCode =
  | 'NICKNAME_INVALID' | 'NICKNAME_TAKEN' | 'NOT_IN_ROOM'
  | 'ROUND_BUSY' | 'NOT_DRAWER' | 'NOT_ENOUGH_PLAYERS' | 'TOPIC_INVALID'
  | 'MESSAGE_INVALID' | 'SPOILER_BLOCKED' | 'RATE_LIMITED' | 'ROOM_FULL' | 'IMAGE_INVALID';

export type Ack<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: ErrorCode; message: string };   // message 為繁體中文，可直接顯示

export interface ClientToServerEvents {
  'player:join':     (p: { nickname: string; token?: string }, ack: (r: Ack<JoinResult>) => void) => void;
  'round:volunteer': (ack: (r: Ack) => void) => void;
  'round:setTopic':  (p: { topic: string }, ack: (r: Ack) => void) => void;
  'round:cancel':    (ack: (r: Ack) => void) => void;          // 畫師放棄本回合
  'draw:op':         (op: DrawOp) => void;                     // 無 ack；非畫師送來一律丟棄
  'chat:send':       (p: { text: string }, ack: (r: Ack) => void) => void;
  'chat:image':      (p: { mime: ImageMime; width: number; height: number; data: ArrayBuffer }, ack: (r: Ack<{ id: string }>) => void) => void;  // 客戶端先縮圖；server 驗 magic bytes
}

export interface ServerToClientEvents {
  'room:snapshot':  (s: RoomSnapshot) => void;      // 快照重送（保留給日後 server 端重建狀態用）；v1 的 join 走 ack，不發此事件
  'players:update': (players: PlayerPublic[]) => void;
  'round:update':   (round: RoundPublic) => void;   // 每次狀態轉移；topic 依收件者遮罩
  'draw:op':        (op: DrawOp) => void;           // 轉發給畫師以外的所有人
  'chat:message':   (m: ChatMessage) => void;
  'chat:image':     (p: ImagePayload) => void;    // 緊接同 id 的 chat:message(kind image) 之後，只送給當時在線者；不存入歷史；待送量過大的連線收到 data: null（略過）
}
