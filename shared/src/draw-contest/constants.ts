// 常數來源：spec/draw-contest/architecture.md §4「常數」表

/** 作畫時間（秒）；唯一來源，README／說明文字由此推導 */
export const DRAW_SECONDS = 120;
/** 出題期限（秒） */
export const CHOOSING_SECONDS = 60;
/** endsAt 後仍接受交卷的寬限（秒；自動交卷在途） */
export const SUBMIT_GRACE_SECONDS = 5;
/** 我出題所需在線人數 */
export const MIN_PLAYERS = 2;
/** 房間人數上限（含寬限期中的玩家）；達上限的新玩家回 ROOM_FULL */
export const MAX_PLAYERS = 50;
/** 暱稱最長（去頭尾空白後） */
export const NICKNAME_MAX = 12;
/** 題目最長 */
export const TOPIC_MAX = 20;
/** 聊天訊息最長 */
export const CHAT_MAX = 200;
/** 快照帶的聊天則數 */
export const CHAT_HISTORY = 100;
/** 每人聊天最短間隔（毫秒） */
export const CHAT_MIN_INTERVAL_MS = 300;
/** 斷線後保留玩家（總分、出題者／參賽者身分）的寬限期（秒），逾時才視為離開 */
export const RECONNECT_GRACE_SECONDS = 15;
/** 邏輯畫布尺寸（16:9）；交卷 PNG 即此尺寸 */
export const CANVAS_LOGICAL = { width: 1280, height: 720 } as const;
/**
 * 畫布預設底色（與我畫你猜一致）。
 * 繪圖比賽的畫布是每人自己的本機畫布（不中繼筆跡），此為各人畫布的預設底色
 */
export const CANVAS_BACKGROUND = '#1E1E1E';
/** 交卷 PNG 上限（bytes，2 MiB；線條畫通常 < 100 KB）；Socket.IO maxHttpBufferSize 設為此值 + 64 KiB */
export const MAX_SUBMISSION_BYTES = 2_097_152;
/** 單回合滿分 */
export const SCORE_MAX = 100;
/** 筆刷粗細下限（邏輯像素，整數；同我畫你猜） */
export const BRUSH_MIN = 1;
/** 筆刷粗細上限（邏輯像素，整數；同我畫你猜） */
export const BRUSH_MAX = 64;
/** 筆刷預設粗細（邏輯像素；同我畫你猜） */
export const BRUSH_DEFAULT = 4;
/**
 * 預設色塊（快速選色）：白、黑、膚色、灰、紅、橘、黃、綠、藍、紫；索引 0 為預設（所有主題一致，同我畫你猜）。
 * 黑與膚色緊接白：搭配可換的本機畫布底色使用。
 * 不是合法色的白名單：任意符合 COLOR_PATTERN 的色碼皆合法
 */
export const PALETTE = ['#FFFFFF', '#000000', '#FFECEA', '#9E9E9E', '#F44747', '#FF8C00', '#FFD700', '#6A9955', '#569CD6', '#C586C0'] as const;
/** 合法色碼格式（#RRGGBB）；客戶端一律正規化為大寫 6 位（同我畫你猜） */
export const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
