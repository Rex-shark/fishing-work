// 常數來源：spec/architecture.md §4「常數」表

/** 作畫時間（秒） */
export const ROUND_SECONDS = 90;
/** 出題期限（秒） */
export const CHOOSING_SECONDS = 60;
/** 揭曉停留（秒） */
export const ENDED_SECONDS = 5;
/** 開始回合最少在線人數 */
export const MIN_PLAYERS = 2;
/** 暱稱最長（去頭尾空白後） */
export const NICKNAME_MAX = 12;
/** 題目最長 */
export const TOPIC_MAX = 20;
/** 聊天訊息最長 */
export const CHAT_MAX = 200;
/** 快照帶的聊天則數 */
export const CHAT_HISTORY = 100;
/** 邏輯畫布尺寸（16:9） */
export const CANVAS_LOGICAL = { width: 1280, height: 720 } as const;
/** 筆刷粗細下限（邏輯像素，整數） */
export const BRUSH_MIN = 1;
/** 筆刷粗細上限（邏輯像素，整數） */
export const BRUSH_MAX = 64;
/** 筆刷預設粗細（邏輯像素）；spec 只寫「預設 4」未命名常數 */
export const BRUSH_DEFAULT = 4;
/**
 * 預設色塊（快速選色）：白、灰、紅、橘、黃、綠、藍、紫；索引 0 為預設。取自 VS Code Dark+ 語法色系，不含黑色（擦除用橡皮擦）。
 * 不再是合法色的白名單：任意符合 COLOR_PATTERN 的色碼皆合法
 */
export const PALETTE = ['#FFFFFF', '#9E9E9E', '#F44747', '#FF8C00', '#FFD700', '#6A9955', '#569CD6', '#C586C0'] as const;
/**
 * 畫布底色：所有偽裝主題與所有玩家一致（畫布內容是共享狀態，底色不同會讓同一筆畫在別人螢幕上看不見）。
 * CSS 由此常數注入，不是主題 token（2026-09-25 Rex：先暫統一黑底、預設白筆）
 */
export const CANVAS_BACKGROUND = '#1E1E1E';
/** 合法色碼格式（#RRGGBB）；客戶端送出前一律正規化為大寫 6 位 */
export const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
/** 可傳的圖片格式（Epic 2） */
export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
/** 單張圖片上限（客戶端縮圖後，bytes）；Socket.IO maxHttpBufferSize 設為此值 + 64 KiB */
export const MAX_IMAGE_BYTES = 10_485_760;
/** 客戶端縮圖：長邊上限（像素；GIF／WebP 不重編碼） */
export const IMAGE_MAX_EDGE = 1280;
/** 每人傳圖最短間隔（毫秒；與文字訊息各自計時） */
export const IMAGE_MIN_INTERVAL_MS = 3000;
/**
 * 收件 socket 待送量（bytes）超過此值就略過這張圖（送 chat:image { id, data: null }），保護慢連線不被 ping timeout 斷線。
 * 2 × MAX_IMAGE_BYTES + 2 MiB（= 23_068_672，約 22 MiB）：允許兩張在途；最壞積壓 ≈ 門檻 + 一張 ≈ 32 MiB，
 * 在設計下限 2 MiB/s 下 16 秒 < pingTimeout 30 秒（壓測實測最慢 19.2 秒）。區網正常客戶端三人同時送也不會被略過（2026-09-25 壓測定案）。
 * 放 shared，只有 server 用
 */
export const IMAGE_SKIP_BUFFER_BYTES = 2 * MAX_IMAGE_BYTES + 2_097_152;
/** 每人聊天最短間隔（毫秒） */
export const CHAT_MIN_INTERVAL_MS = 300;
/** 斷線後保留玩家（分數、畫師身分）的寬限期（秒），逾時才視為離開 */
export const RECONNECT_GRACE_SECONDS = 15;
/** 房間人數上限（含寬限期中的玩家）；達上限的新玩家回 ROOM_FULL。tunnel 對外公開時的記憶體保護 */
export const MAX_PLAYERS = 50;
/** 一則 move 最多帶的點數；超過整則丟棄 */
export const MAX_POINTS_PER_MOVE = 64;
/** 本回合筆跡歷史（正規化後的 begin/move/end）上限；超過丟棄新 op 並 log，clear 仍可用 */
export const MAX_OPS_PER_ROUND = 10000;
/** strokeId 長度上限（客戶端用 crypto.randomUUID()） */
export const STROKE_ID_MAX = 64;
