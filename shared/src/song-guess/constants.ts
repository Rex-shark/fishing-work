// 常數來源：spec/song-guess/architecture.md §4「常數」表

/** 一局幾首（Rex 2026-10-12：一局 5 首） */
export const SONGS_PER_GAME = 5;
/** 出題期限（秒；含搜尋時間） */
export const CHOOSING_SECONDS = 60;
/** 每首揭曉停留秒數（最後一首揭曉後直接 ended，不另計時） */
export const REVEAL_SECONDS = 5;
/**
 * 進入 playing 到 startedAt 的緩衝（毫秒）：客戶端先下載試聽（約 1 MB）再同時起播；
 * 計分從 startedAt 起算（水手長建議，2026-10-12 定案）
 */
export const START_DELAY_MS = 1500;
/** 單首最長播放毫秒（與環境變數 SONG_PREVIEW_CAP_MS 的預設相同；server 以環境變數覆寫） */
export const PREVIEW_CAP_MS = 30000;
/** 歌手名最長（去頭尾空白後） */
export const ARTIST_MAX = 30;
/** 出題所需在線人數 */
export const MIN_PLAYERS = 2;
/** 房間人數上限 */
export const MAX_PLAYERS = 50;
/** 暱稱最長 */
export const NICKNAME_MAX = 12;
/** 聊天訊息最長 */
export const CHAT_MAX = 200;
/** 快照帶的聊天則數 */
export const CHAT_HISTORY = 100;
/** 每人聊天最短間隔（毫秒） */
export const CHAT_MIN_INTERVAL_MS = 300;
/** 已綁定玩家的 socket 重複 player:join 的最短間隔（毫秒；Epic 21）：不足 → RATE_LIMITED；受理時只回快照、不重送二進位事件 */
export const JOIN_MIN_INTERVAL_MS = 1000;
/** chat:send 被 SPOILER_BLOCKED 後的冷卻（毫秒；Epic 21）：期間該玩家的 chat:send 一律 RATE_LIMITED */
export const SPOILER_COOLDOWN_MS = 3000;
/** 斷線寬限（秒） */
export const RECONNECT_GRACE_SECONDS = 15;
/** 單首滿分 */
export const SCORE_MAX = 100;
/** 單首最低得分（試聽最後一刻猜對） */
export const SCORE_MIN = 50;
/** 歌手模式「只抽熱門歌」的候選數：過濾去重後保持 iTunes 回傳順序（＝熱門度）取前 30 首再抽（Epic 18） */
export const HOT_POOL = 30;
/** 排行榜抓幾首（RSS 路徑中的數字；Epic 18） */
export const CHART_SIZE = 100;
/** 非歌手來源的題庫標題（RoundPublic.topic；對話框選項文字也用它；Epic 18／19） */
export const SOURCE_TITLE = { 'tw-hot': '台灣熱門', 'western-hot': '西洋熱門', 'anime-hot': '動漫熱門' } as const;
/** 動漫熱門的搜尋關鍵字（Epic 19） */
export const ANIME_TERMS = ['anime', 'アニメ', '動漫'] as const;
/** 動漫熱門候選數：三關鍵字聯集依合併排名取前 60 首再抽（Epic 19） */
export const ANIME_HOT_POOL = 60;
