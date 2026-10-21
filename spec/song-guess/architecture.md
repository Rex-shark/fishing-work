# 猜歌（song-guess）：架構與事件契約

> 本檔是猜歌的**實作唯一契約**：模組佈局、iTunes 題庫、Socket 事件、常數、狀態機、答案判定、驗證方式。改動需架構師海圖（Chart）定案；凡涉及平台共用層（`server/` 的靜態檔路由與入口、`shared/` 的套件設定、根目錄建置設定、Docker）同樣由海圖定案，並同步 [../architecture.md](../architecture.md) §1／§3。規則見 [overview.md](overview.md)，畫面見 [design.md](design.md)。

---

## 1. 模組佈局

沿用繪圖比賽的分工（[../architecture.md](../architecture.md) §1 的 Epic 14 定案）：**前端獨立、server 房間邏輯獨立複製、契約走 `shared/` 子路徑**。

```
fishing-work/
├── shared/src/song-guess/
│   ├── events.ts                # 本檔 §4 逐字
│   ├── constants.ts             # 本檔 §4「常數」逐字
│   ├── answer.ts                # 歌名正規化與判定（§4「答案判定」）
│   └── index.ts                 # 匯出；package.json exports 加 "./song-guess"
├── server/src/games/song-guess/
│   ├── register.ts              # namespace /song-guess：socket 事件 → room
│   ├── room.ts                  # 房間與局／首狀態機（純邏輯、Effect 模式；獨立複製，不共用 draw-guess）
│   ├── chat.ts                  # 聊天節流與猜題判定
│   ├── itunes.ts                # iTunes Search API 客戶端：搜尋歌手、快取、逾時（§3）
│   └── picker.ts                # 過濾、去重、隨機抽 5 首（純函式，可測）
├── song-guess/                  # @fishing-work/song-guess：React 19 + Vite + TS + Tailwind v4（§7）；起步複製 draw-guess 的首頁與 meet 殼層
└── user/
    ├── mock/itunes.mjs          # 假 iTunes（只實作 /search），協定測試與沒有網路時用
    └── protocol/song-guess-*.mjs
```

共用層改動（海圖定案，同步平台 spec §1／§3）：`server/src/static.ts` 的 `games` 加 `/song-guess`；`server/public/index.html` 遊戲清單加一列；`shareLog` 的 `games` 加 `song-guess`；根 `package.json` workspaces 與 `build`／`lint`／`dev` 加 song-guess；`draw-guess/vite.config.ts` 加 `/song-guess` proxy → `:7182`；`Dockerfile` 多複製 `song-guess/package.json` 與 `song-guess/dist`。

## 2. 技術棧

與平台相同（[../architecture.md](../architecture.md) §2）。音訊播放用瀏覽器原生 `<audio>`（m4a／AAC，所有現代瀏覽器可播），不引入播放器套件。server 呼叫 iTunes 用 Node 內建 `fetch`。

## 3. 執行拓樸、iTunes 與環境變數

### 開發

```bash
npm run dev     # concurrently：server（:7180）＋ draw-guess Vite（:80）＋ draw-contest Vite（:7181）＋ song-guess Vite（:7182）＋ dev-open
```

`song-guess/vite.config.ts`：`base: '/song-guess/'`、`server.port: 7182`、`strictPort`；proxy `/socket.io`、`^/$`、`/healthz` → `:7180`，`/draw-guess` → `:80`、`/draw-contest` → `:7181`（與另兩款對稱）。從遊戲清單點進 `http://localhost/song-guess/` 即為 HMR 開發版。

### 正式

同平台：`npm run build` 後 `npm start`，server 把 `song-guess/dist` 掛在 `/song-guess`，SPA fallback 規則同另兩款。Docker 比照 Epic 14 的作法多複製一份 dist。

### iTunes Search API（server 端）

- 端點：`GET https://itunes.apple.com/search?term=<歌手>&attribute=artistTerm&country=TW&media=music&entity=song&limit=200`。免金鑰；回應 `text/javascript` 但內容是 JSON；CORS `*`（但客戶端不直接打，見下）。
- 回傳欄位用到：`trackId`、`trackName`、`artistName`、`collectionName`、`artworkUrl100`、`previewUrl`（約 1 MB m4a、CORS `*`、支援 Range）、`trackTimeMillis`、`trackViewUrl`、`releaseDate`、`primaryGenreName`。
- **限流**：每 IP 約 20 次／分鐘。server 統一呼叫並以歌手名（正規化後）快取 10 分鐘；同一歌手再出題不重打。客戶端**不得**直接呼叫 iTunes。
- **逾時** 8 秒；失敗回 `SEARCH_FAILED`，`choosing` 不中斷、出題者可重試。
- **搜尋結果順序＝Apple 的熱門度**（周杰倫前八首：擱淺、晴天、七里香、說好的幸福呢、稻香…；海圖 2026-10-16 實測）。「只抽熱門歌」（Epic 18）＝過濾去重後**保持回傳順序**取前 `HOT_POOL`（30）首再隨機抽。Search API 沒有排序、年份、曲風參數（`term=2010` 回傳混雜）。
- **排行榜（Epic 18）**：`GET ${ITUNES_RSS_URL}/api/v2/<國家>/music/most-played/100/songs.json`（台灣熱門 `tw`、西洋熱門 `us`；每日更新；欄位 `id`、`name`、`artistName`、`artworkUrl100`、`url`、`releaseDate`，**沒有 `previewUrl` 與 `trackTimeMillis`**）→ 把 100 個 `id` 以**一次** `GET ${ITUNES_URL}/lookup?id=<逗號分隔>&country=${ITUNES_COUNTRY}` 補齊（回傳與 search 同形；只留 `wrapperType === 'track'` 且有 `previewUrl` 者，依榜單名次排序）。合併結果以國家為鍵快取 `ITUNES_CACHE_MS`。實測（海圖 2026-10-16）：tw／us／gb 各 100 首；us 榜前 25 首以 `country=TW` lookup 25/25 有試聽（播放端不用改；水手長 2026-10-16 實作時 us 榜 100 首 lookup 回 97 首可用）；tw 榜 100 首裡 42 首非中文（多為韓團，不過濾）。Apple 只有當下榜單、沒有歷史年榜。
- **動漫熱門（Epic 19）**：不用榜單（台灣區動畫曲風榜太偏門、日本區多角色歌），改以 **`term=anime`／`アニメ`／`動漫` 三次 Search（不帶 `attribute`，台灣商店）聯集**：去重後 647 首、排除原聲帶／翻唱後 405 首（水手長 2026-10-20 實作日重算只有 238 首、排除 38 首剩約 200；三關鍵字重疊程度每天不同，池子大小會浮動，但遠多於 60）；`anime` 前 20 ＝ 残響散歌、One Last Kiss、怪物、祝福、紅蓮華、SPECIALZ…（海圖 2026-10-20 實測）。`動畫`／`主題歌`／`OP` 關鍵字原聲帶與古典比例高，不納入。
- 實測（海圖 2026-10-12）：`artistTerm=孫燕姿` 回 200 首、全部有試聽、年份 2000–2026；`genreId` 參數無作用；曲風索引回傳混雜；`releaseDate` 為該版本發行日（重發行會是重發年）。

### 環境變數（server）

| 變數 | 預設 | 說明 |
|------|------|------|
| `ITUNES_URL` | `https://itunes.apple.com` | iTunes Search API 根網址；協定測試指到假 iTunes（`user/mock/itunes.mjs`） |
| `ITUNES_COUNTRY` | `TW` | 商店區域（search 與 lookup 都用；榜單的國家由來源決定，不受此影響） |
| `ITUNES_RSS_URL` | `https://rss.marketingtools.apple.com` | 排行榜 RSS 根網址（Epic 18）；協定測試指到假 iTunes |
| `ITUNES_TIMEOUT_MS` | `8000` | 搜尋與 lookup 逾時 |
| `ITUNES_RSS_TIMEOUT_MS` | `12000` | 排行榜 RSS 那一段的逾時（Apple RSS 偶發 8～15 秒才回；水手長 2026-10-16 實測；Epic 18） |
| `ITUNES_CACHE_MS` | `600000` | 歌手搜尋結果與排行榜（RSS ＋ lookup 合併）快取（10 分鐘） |
| `SONG_PREVIEW_CAP_MS` | `30000` | 單首最長播放毫秒；iTunes 沒有「試聽長度」欄位，`durationMs = min(trackTimeMillis ?? cap, cap)`——一般歌曲恆為 30000，全長不到 30 秒的曲子與假 iTunes 才更短（水手長 Q1，2026-10-12 定案） |

## 4. Socket 事件契約（namespace `/song-guess`）

`shared/src/song-guess/events.ts` **逐字**：

```ts
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
```

### 常數（`shared/src/song-guess/constants.ts`）

| 常數 | 值 | 說明 |
|------|----|------|
| `SONGS_PER_GAME` | 5 | 一局幾首（Rex 2026-10-12：一局 5 首） |
| `CHOOSING_SECONDS` | 60 | 出題期限（含搜尋時間） |
| `REVEAL_SECONDS` | 5 | 每首揭曉停留秒數（最後一首揭曉後直接 ended，不另計時） |
| `START_DELAY_MS` | 1500 | 進入 playing 到 `startedAt` 的緩衝：客戶端先下載試聽（約 1 MB）再同時起播；計分從 `startedAt` 起算（水手長建議，2026-10-12 定案） |
| `PREVIEW_CAP_MS` | 30000 | 單首最長播放毫秒（與 `SONG_PREVIEW_CAP_MS` 預設相同；server 以環境變數覆寫） |
| `ARTIST_MAX` | 30 | 歌手名最長（去頭尾空白後） |
| `HOT_POOL` | 30 | 歌手模式「只抽熱門歌」的候選數：過濾去重後保持 iTunes 回傳順序取前 30 首再抽（Epic 18） |
| `CHART_SIZE` | 100 | 排行榜抓幾首（RSS 路徑中的數字；Epic 18） |
| `SOURCE_TITLE` | `{ 'tw-hot': '台灣熱門', 'western-hot': '西洋熱門', 'anime-hot': '動漫熱門' }` | 非歌手來源的題庫標題（`RoundPublic.topic`；對話框選項文字也用它；Epic 18／19） |
| `ANIME_TERMS` | `['anime', 'アニメ', '動漫']` | 動漫熱門的搜尋關鍵字（Epic 19） |
| `ANIME_HOT_POOL` | 60 | 動漫熱門候選數：三關鍵字聯集依合併排名取前 60 首再抽（Epic 19） |
| `MIN_PLAYERS` | 2 | 出題所需在線人數 |
| `MAX_PLAYERS` | 50 | 房間人數上限 |
| `NICKNAME_MAX` | 12 | 暱稱最長 |
| `CHAT_MAX` | 200 | 聊天訊息最長 |
| `CHAT_HISTORY` | 100 | 快照帶的聊天則數 |
| `CHAT_MIN_INTERVAL_MS` | 300 | 每人聊天最短間隔 |
| `RECONNECT_GRACE_SECONDS` | 15 | 斷線寬限 |
| `SCORE_MAX` | 100 | 單首滿分 |
| `SCORE_MIN` | 50 | 單首最低得分（試聽最後一刻猜對） |

### 答案判定（`shared/src/song-guess/answer.ts`，純函式）

- `stripSubtitle(title)`：去掉**副標**——第一個全形或半形括號起的內容（`（…）`、`(…)`、`【…】`、`[…]`）、` - ` 之後、`feat.`／`ft.`／`featuring` 之後（不分大小寫；**前一個字不可是英文字母**，避免 `Left.`、`Gift.` 被切，`溫柔feat.孫燕姿` 照切；水手長 1，2026-10-12 定案）；再去頭尾空白。例：`如果可以 (電影"月老"主題曲)` → `如果可以`；`I'm gonna TOESA (feat. Kian84)` → `I'm gonna TOESA`；`愛 (Live)` → `愛`。去副標後為空字串（括號在開頭，如 `(......醉鬼阿Q) [feat. 孫燕姿]`、`(I Can't Get No) Satisfaction`）則退回原歌名去頭尾空白（判定用）；**這類歌 picker 直接排除不抽**（整串當答案幾乎猜不到；水手長 4，2026-10-12 改定）。
- `normalizeTitle(s)`：`stripSubtitle` → NFKC → 移除所有空白與標點（Unicode `\p{P}`、`\p{S}`）→ 英文小寫。例：`I'm gonna TOESA` → `imgonnatoesa`。
- `isCorrect(guess, title)`：`normalizeTitle(guess) === normalizeTitle(title)`，或 `normalizeTitle(guess) === normalizeFull(title)`（`normalizeFull` 不去副標、其餘相同；讓打完整歌名也算對）。正規化後為空字串一律不算。
- `containsSpoiler(text, title)`：`normalizeFull(text)` 包含 `normalizeTitle(title)`；用於已猜對者的訊息。
- `mainTitle(title)`：與 `stripSubtitle` 相同但**不退回**（括號或 feat. 開頭時回空字串）；只給 picker 排除用（水手長實作 2026-10-12）。
- `titleLength(title)`：`normalizeTitle(title)` 的 code point 數（**不含空白與標點**；`My story, your song` → 15；水手長 4，2026-10-12 定案）。
- 歌名去重（`picker.ts` 用）：同一歌手內 `normalizeTitle` 相同者只留一首（優先留 `trackTimeMillis` 最長、非 Live 者）；**`normalizeTitle` 為空（純符號）與 `stripSubtitle` 為空（括號開頭）的歌排除**。歌手名比對的正規化＝快取鍵（NFKC、小寫、去空白，**不去標點**；`SHE` 對不上 `S.H.E`，靠下方的最多次 `artistName` 退回）。

## 5. 房間與局／首狀態機（server）

- **idle**：無局。`round:volunteer`（在線 ≥ MIN_PLAYERS、非 playing／reveal／choosing）→ `choosing`，`setterId`、`endsAt = now + CHOOSING_SECONDS`，`results`／`lastTopic`／`lastSource` 保留。
- **choosing**：只有出題者可 `round:setSource`／`round:cancel`。`setSource`（Epic 18 起，原 `setArtist`）：payload 不是物件、`source` 不是 `SongSource` 四值之一（Epic 19 起）、歌手模式 `hot` 不是 boolean（含缺漏）→ `SOURCE_INVALID`（榜單模式多帶的欄位忽略）；歌手模式接著驗證歌手名（去頭尾空白 1..ARTIST_MAX、不可含控制字元 → `ARTIST_INVALID`）；再查同一出題者取歌進行中（四種來源共用同一個旗標）→ `SEARCH_BUSY`。**檢查順序：`SOURCE_INVALID` → `ARTIST_INVALID` → `SEARCH_BUSY`**（與 Epic 16 相同，先驗輸入再看忙碌；水手長 Q2，2026-10-16）。**`source = 'artist'`**：呼叫 `itunes.search(artist)`（快取）→ `picker.pick(results, artist, SONGS_PER_GAME, { hot })`：留有 `previewUrl` 者、`artistName` 正規化後包含輸入者、`normalizeTitle` 非空且去重（**保持 iTunes 回傳順序**＝熱門度）；`hot = true` 時只取前 `HOT_POOL`（30）首，不足 30 就全部（**「最多次 `artistName` 過半」的退回那一輪同樣只取前 30**；水手長 Q3）；再隨機抽 5；**不足 5 首時改以「原始結果中出現最多次的 `artistName`」為過濾條件再試一次**（英文名或別名：`Jay Chou` → 周杰倫；水手長 Q2，2026-10-12 定案；**該名須佔原始結果過半**（次數 × 2 > 原始結果總筆數，嚴格大於；分母含沒試聽的；只數完全相同的 `artistName` 字串）——避免輸入的歌手不足 5 首卻出了別人的歌；水手長 3），仍不足 → `ARTIST_NOT_FOUND`；iTunes 逾時或非 2xx `SEARCH_FAILED`；成功 → `gameNo++`、`participantIds = 此刻 connected 的玩家`、全員 `gameScore = 0`、`source = 'artist'`、`artist`、`artistHot = hot`、`topic` ＝ **過濾後結果中出現最多次的 `artistName`**（合唱曲不影響；Q3；`hot` 時以前 30 首計）、`results = null`、`lastTopic`／`lastSource` 清空、進入第 1 首 `playing`，ack `{ topic }`。**`source = 'tw-hot'`／`'western-hot'`**：`itunes.chart('tw' | 'us')`（RSS → lookup 合併，快取）→ `picker.pickChart(tracks, SONGS_PER_GAME)`：留有 `previewUrl` 者、`normalizeTitle` 非空且 `mainTitle` 非空、以「`artistName` ＋ `normalizeTitle`」去重、隨機抽 5（**不排除 explicit 與打碼歌名**：美國榜實測會抽到「I'M DAT N***A」，海圖曾提議排除，Rex 2026-10-16 定「不做」，照 Apple 榜單原樣）；RSS 或 lookup 逾時／非 2xx／解析失敗、或可抽不足 5 首 → `CHART_FAILED`；成功同上，但 `artist = null`、`artistHot = false`、`topic = SOURCE_TITLE[source]`，ack `{ topic }`。**`source = 'anime-hot'`**（Epic 19）：`itunes.animePool()`（`ANIME_TERMS` 三次 Search **並行**、各自 `ITUNES_TIMEOUT_MS`；每首排名＝三份結果中的最小索引；合併結果以 `'anime'` 為鍵快取、進行中共用）→ `picker.pickAnime(tracks, SONGS_PER_GAME)`：留有 `previewUrl`、`normalizeTitle` 與 `mainTitle` 非空、`isSoundtrackOrCover` 為 false 者，以「`artistName` ＋ `normalizeTitle`」去重、依排名取前 `ANIME_HOT_POOL`（60）首、隨機抽 5；任一關鍵字失敗或可抽不足 5 首 → `CHART_FAILED`；成功同榜單（`artist = null`、`artistHot = false`、`topic = '動漫熱門'`）。ended 時 `lastTopic = topic`、`lastSource = source`（歌手模式的 topic 是**正式名**，不是輸入值；排名表標題與 playing 顯示一致；水手長 7，2026-10-12 定案）。逾時、取消、出題者寬限期滿離開 → `idle`（搜尋結果丟棄；**搜尋回來時已不是同一次 choosing → 結果丟棄、ack `NOT_SETTER`**，Q9）。
- **playing（第 i 首）**：`song = { index: i, previewUrl, artist（本首 `artistName`）, startedAt: now + START_DELAY_MS, durationMs: min(trackTimeMillis ?? cap, cap), endsAt: startedAt + durationMs, titleLength, correctIds: [] }`，全員 `hasGuessed = false`，`round:update`。`startedAt` 之前的猜題照常判定但得分以 `startedAt` 為 0 秒（即滿分）。計時器 `endsAt` 到 → `reveal`。**不因全員猜對提早結束**（Rex 需求 5）；**局中在線人數掉到 1 人或 0 人照走不中止**（計時器驅動；Q8c）。
- **猜題**（`chat:send`，phase = playing）：
  - 已猜對者：`containsSpoiler(text, title)` → `SPOILER_BLOCKED` 不廣播；否則照常廣播 `chat`。
  - 未猜對者：`containsSpoiler(text, title)` 但不 `isCorrect` → `SPOILER_BLOCKED`「猜歌名請只輸入歌名本身」不廣播（比照我畫你猜；本遊戲可多人得分，原文廣播等於送分；水手長 Q5，2026-10-12 定案）；`isCorrect(text, title)` → 得分 `score = SCORE_MAX − floor((SCORE_MAX − SCORE_MIN) × (now − startedAt) / durationMs)`（50..100）加到 `gameScore` 與 `score`，`hasGuessed = true`、`correctIds` 追加、廣播 `correct`「X 猜對了」（不含原文）、`players:update`、`round:update`；否則照常廣播 `chat`。
  - 中途加入者（不在 `participantIds`）**也可以猜**、也得分（人多才好玩），但不列入本局排名的「參賽者」統計以外的任何限制；排名依本局有得分或在 `participantIds` 者。
- **reveal（第 i 首）**：`reveal = { index, title, artist, album, artworkUrl, itunesUrl, scores }`，`endsAt = now + REVEAL_SECONDS`，`round:update`。計時器到：i < SONGS_PER_GAME → 第 i+1 首 `playing`；i = SONGS_PER_GAME → `ended`（**第 5 首同樣停滿 REVEAL_SECONDS 再進 ended**；常數表「不另計時」指 ended 本身沒有計時器；Q7）。
- **ended**：`results`（§5.1）、`lastTopic = topic`、`lastSource = source`（歌手模式為正式名）、`reveal` 保留最後一首、`song = null`、`round:update`；無計時器；`round:volunteer` 可用（同 idle）。
- **離開**（寬限期滿）：從 `participantIds` 移除，也從本首 `correctIds` 與 `reveal.scores` 移除；玩家物件移除（總分隨之消失，同另兩款）；**局中離開者即使已得分也不進本局排名**（Q8a）；ended 之後才離開者 `results` 不變。出題者在 playing／reveal 離開：`setterId` 仍指向已不在的 id，客戶端以「出題者」代稱；下一次有人 `volunteer` 即換人（`isSetter` 隨之）。搜尋回來已不是同一次 choosing 時，成功與失敗一律 ack `NOT_SETTER`。出題者離開：choosing → idle；playing／reveal 不影響。
- **階段不符**：`idle`／`ended` 時 `setSource`／`cancel` → `NOT_SETTER`；`choosing` 時非出題者 → `NOT_SETTER`；`playing`／`reveal` 時 `volunteer`／`setSource`／`cancel` → `ROUND_BUSY`。
- **重連**：憑證機制同另兩款；快照的 `round.song.startedAt` 與 `serverNow` 讓客戶端從正確位置接著播。
- **時鐘**：客戶端以 `serverNow − Date.now()` 估偏移，`<audio>.currentTime = (serverNow − startedAt) / 1000` 起播；區網偏差 < 100 ms 可接受。**保證**：同一次狀態轉移發出的 `round:update`，其 `startedAt`／`endsAt`／`serverNow` 與同次產生的聊天訊息 `at` 取**同一個時鐘值**（例如 reveal 的 `endsAt − serverNow` 恰為 `REVEAL_SECONDS × 1000`）；快照與不改時間的 `round:update` 各取當下時鐘。水手長 2026-10-12 修掉跨毫秒邊界差 1 ms 的競態，由假時鐘單元測試守住；協定測試只驗方向與範圍。

### 5.1 本局排名（`ranking.ts`，純函式）

- 對象：`participantIds` ∪ 本局有得分者（含中途加入者）。
- 依 `gameScore` 降冪；同分者依**先達到該分數的時間**在前（紀錄每位玩家最後一次得分的時間）；**本局 0 分者彼此依 `participantIds` 順序**（Q8b）；`rank` 1 起連號（同分不並列）。
- `correctCount` = 本局猜對首數。

### 5.2 聊天

同繪圖比賽：200 字、每 300 ms 一則、`MESSAGE_INVALID`／`RATE_LIMITED`；系統訊息（加入、離開、出題、取消、每首揭曉「第 n 首：《歌名》」、本局結束「本局第一名：X（n 分）」）。

### 5.3 錯誤訊息（ack.message，繁中）

| 碼 | 文案 |
|----|------|
| `ARTIST_INVALID` | 歌手名稱需為 1～30 個字，不可含控制字元，也不能只有空白 |
| `ARTIST_NOT_FOUND` | 找不到這位歌手的歌（至少要 5 首有試聽的歌），換一位試試 |
| `SEARCH_FAILED` | 搜尋失敗，請再試一次 |
| `SEARCH_BUSY` | 搜尋中，請稍候 |
| `SOURCE_INVALID` | 題庫來源不正確，請重新選擇 |
| `CHART_FAILED` | 取得題庫失敗，請再試一次（Epic 19 起通用；榜單與動漫熱門共用） |
| `SPOILER_BLOCKED` | 已猜對者：「你已經猜對了，不要說出歌名」；未猜對者訊息含歌名但不完全相同：「猜歌名請只輸入歌名本身」 |
| 其餘 | 同繪圖比賽 §5.4 |

## 6. iTunes 客戶端與假 iTunes

- `itunes.ts`：`search(artist, { url, country, timeoutMs, fetch })` → 組 `${ITUNES_URL}/search?term=…&attribute=artistTerm&country=…&media=music&entity=song&limit=200`，`AbortSignal.timeout`，非 2xx 或 JSON 解析失敗拋 `SEARCH_FAILED`；結果快取 `ITUNES_CACHE_MS`（鍵＝NFKC 小寫去空白的歌手名）。
- `picker.ts`：純函式 `pick(tracks, artistInput, n, random, { hot })` → `{ songs, topic } | null`（Epic 18 前回傳欄位名 `artistDisplay`）；快取只存成功結果、同鍵進行中的搜尋共用同一個請求、啟動時不探測 iTunes；`AppOptions` 加 `songSearch`／`songChart`（Epic 18）／`songAnime`（Epic 19）／`songRandom`／`songDurations` 注入點；含 Q2 的「最多次 artistName」退回、Q3 的 `artistDisplay`、Q4 的排除空歌名；`random` 可注入（測試確定性）。server 的 vitest 預設把 `ITUNES_URL` 指到連不上的位址，任何測試不得打真 iTunes；真 iTunes 回應樣本存成 fixture。
- `itunes.ts` 另有 `chart(country, …)`（Epic 18）：`GET ${ITUNES_RSS_URL}/api/v2/${country}/music/most-played/${CHART_SIZE}/songs.json` → 取 `feed.results[].id` → `GET ${ITUNES_URL}/lookup?id=<逗號分隔>&country=${ITUNES_COUNTRY}` → 回 `ItunesTrack[]`（同 search 形狀、依榜單名次排序、只留 track 且有 `previewUrl`）；RSS 段逾時 `ITUNES_RSS_TIMEOUT_MS`（12 秒）、lookup 段 `ITUNES_TIMEOUT_MS`（8 秒）；任一失敗拋 `CHART_FAILED`；RSS 回的 id 在 lookup 找不到、非 track、無 `previewUrl` 者略過，RSS `results` 為空或格式不對 → `CHART_FAILED`；以 `country` 為鍵快取 `ITUNES_CACHE_MS`、同鍵進行中共用請求。`picker.ts` 加 `pick` 的 `{ hot }` 選項（保持順序、前 `HOT_POOL`）與 `pickChart(tracks, n, random)`（去重鍵 `artistName` ＋ `normalizeTitle`）。
- `itunes.ts` 另有 `animePool()`（Epic 19）：`ANIME_TERMS` 各打一次 `${ITUNES_URL}/search?term=<kw>&entity=song&country=${ITUNES_COUNTRY}&media=music&limit=200`（**不帶 `attribute`**），並行、各自逾時；回 `ItunesTrack[]` 依合併排名（最小索引）升冪；以 `'anime'` 為鍵快取 `ITUNES_CACHE_MS`。`picker.ts` 加 `isSoundtrackOrCover(track)`（`collectionName`＋`trackName` 不分大小寫比對；**拉丁字母關鍵字用單字邊界** `\b…\b`（允許英文複數 Covers／Remixes／Soundtracks；比對前先 NFKC）：`soundtrack`、`OST`、`BGM`、`instrumental`、`off vocal`、`piano`、`cover`、`remix`、`8-bit`、`music box`、`acoustic`、`orchestral`、`karaoke`（後三者為驗收 2026-10-20 發現「Acoustic Ver.」「Orchestral version」漏網後補），避免 `OST` 誤殺 LOST／Ghost、`cover` 誤殺 Discover（水手長 Q1，2026-10-20）；**日文／中文關鍵字子字串**：`サウンドトラック`、`原聲`、`原声`、`カラオケ`、`伴奏`、`鋼琴`、`カバー`、`音樂盒`、`オルゴール`）與 `pickAnime(tracks, n, random)`：有 `previewUrl` → 排除原聲帶／翻唱 → 排除 `mainTitle`／`normalizeTitle` 空 → 依合併排名升冪（同排名依 `ANIME_TERMS` 順序）→ 以「`artistName`＋`normalizeTitle`」去重保留排名較前者 → 取前 `ANIME_HOT_POOL` → 抽 n。快取存三次搜尋合併後的 tracks（未排除），排除與去重在 `pickAnime` 做；合併時以 `trackId` 識別同一首（沒有則「歌手＋歌名＋專輯」）；任一關鍵字非 2xx 或解析失敗 → `CHART_FAILED`；快取鍵 `'anime'` 與歌手搜尋快取分開（歌手填 anime 不會命中）。
- **假 iTunes**（`user/mock/itunes.mjs`）：實作 `GET /search`、**`GET /api/v2/:country/music/most-played/:n/songs.json` 與 `GET /lookup?id=`（Epic 18；`ITUNES_RSS_URL` 也指到它；`tw` 回 12 首中英混合、`us` 回 12 首西洋，形狀同真 RSS；lookup 依 id 回 search 同形資料；`MOCK_ITUNES_CHART_FAIL=1` 讓 RSS 回 500、`MOCK_ITUNES_LOOKUP_FAIL=1` 讓 lookup 回 500；`MOCK_ITUNES_DELAY_MS` 也作用在 RSS／lookup；未知國家回 404；**Epic 19：`term` 為 `anime`／`アニメ`／`動漫` 各回一份固定資料（三份有交集、含一筆原聲帶與一筆 Cover、合計去重後 ≥ 12 首），`MOCK_ITUNES_FAIL_TERM=<kw>` 讓該關鍵字回 500**）**，依 `term` 回固定的歌手資料（慢慢來樂團、壞掉樂團等；含 `Jay Chou` 別名案例、不足 5 首與查無案例），`previewUrl` 指向假 iTunes 自己的 `/preview/<id>.m4a`（回真的 2 秒單音）；環境變數 `MOCK_ITUNES_DELAY_MS`、`MOCK_ITUNES_SLOW_MS`、`MOCK_ITUNES_FAIL=1`（回 500）、`MOCK_ITUNES_TRACK_MS`（縮時）、`MOCK_ITUNES_PUBLIC_URL`。

## 7. 客戶端結構（`song-guess/src/`）

起步**複製** `draw-guess/` 的首頁（home）、meet 殼層、聊天面板、玩家清單、回合狀態、重連機制；刪掉畫布、工具列、顏色面板、圖片上傳、其他三套殼層。

- `features/player/`：`<audio>` 播放器（無畫面控制，由 `round.song` 驅動）：收到 playing 載入 `previewUrl`、依時鐘偏移定位、`play()`；reveal／ended 停止；音量滑桿在殼層控制列（唯一的使用者控制）；`autoplay` 被擋時（極端）顯示「點一下開始播放」。
- `features/round/`：出題對話框（來源四選一：歌手／台灣熱門／西洋熱門／動漫熱門（Epic 19）；歌手模式有歌手欄位與「只抽熱門歌」勾選，預設勾、localStorage 記上次；榜單模式一行說明；搜尋中狀態、錯誤訊息；Epic 18）、回合狀態列（題庫標題、本首歌手、第 n / 5 首、倒數、揭曉資訊）。
- `features/reveal/`：每首揭曉卡（封面、歌名、歌手、猜對者與分數）與本局排名（ended）。
- `features/chat/`、`features/players/`、`features/help/`：沿用。`shared/src/song-guess/` 另有 `nickname.ts`、`text.ts`（含 `validateArtist`，複製自繪圖比賽）；server 另有 `ranking.ts`。系統訊息：「X 出題「{topic}」，共 5 首」（topic：歌手正式名、「台灣熱門」、「西洋熱門」或「動漫熱門」）、每首揭曉「第 n 首：《歌名》」、「本局結束：沒有人猜對」或「本局第一名：X（n 分）」；**狀態列（字幕列）與 `role="status"` 報讀在 ended 用同一規則**：第一名本局 0 分時顯示／朗讀「本局結束：沒有人猜對」，不顯示「本局第一名：X（0 分）」（Epic 16 起兩處不一致，水手長 2026-10-16 發現，Epic 18 順帶修）。`setSource` 的 ack 逾時放寬到 25 秒（歌手：iTunes 8 秒；榜單：RSS 12 秒 ＋ lookup 8 秒；Epic 18 由 15 改 25）。無障礙：三選一群組名「題庫來源」、榜單模式送出鈕名「分享：抽歌並開始」（畫面文字仍「分享」）、出題者進 choosing 報讀「請選擇題庫來源」；Enter 在三選一上＝送出。server 對壞 payload 先回 `SOURCE_INVALID` 再查 `NOT_IN_ROOM`／`NOT_SETTER`（比照 Epic 16 在 register 先驅形狀）；歌手模式 `artist` 非字串 → `ARTIST_INVALID`。
- 殼層介面 `ShellViews`：比照 draw-guess 的 meet 殼層，插槽改為 `stage`（舞台：分享音訊中的視覺）、`roundStatus`、`volunteer`（「分享音訊」）、`chat`、`players`、`volume`。
- `shellBoundary` 測試沿用。

## 8. 驗證方式（派工與驗收共用）

四項指令同平台（分開跑、各自看 exit code）。協定測試 `user/protocol/song-guess-phase1.mjs`（加入／出題／搜尋失敗與不足 5 首／第 1 首 playing／猜對計分／防洩題／揭曉／5 首走完 ended 排名／中途加入快照／重連）與 `song-guess-rules.mjs`（驗收子代理 2026-10-12 新寫，82 案例：退回過半規則、三種出題失敗仍在 choosing、時鐘保證的方向與範圍、洩題三種、多人猜對不提早結束、同分與 0 分排序、results 生命週期、重連）對假 iTunes 跑：`ITUNES_URL=http://127.0.0.1:<埠>`，試聽長度以假 iTunes 回的 `trackTimeMillis` 短值（例如 2000 ms）縮時，**不新增縮時用環境變數**；須與另兩款的協定測試並存（三個 namespace 互不影響）。Epic 18 加 `song-guess-sources.mjs`（等 ended 的寬限＝揭曉 5 秒＋4 秒，主機負載下可能偶發，重跑即可）與驗收子代理補寫的 `song-guess-sources-extra.mjs`（榜單取歌中再送 → `SEARCH_BUSY`、`SOURCE_INVALID` → `ARTIST_INVALID` → `SEARCH_BUSY` 順序、壞 payload 先於 `NOT_SETTER`／`NOT_IN_ROOM`、RSS／lookup 500 → `CHART_FAILED`、ended 0 分系統訊息）；Epic 19 加 `song-guess-anime.mjs`（既有 sources／sources-extra 對 `CHART_FAILED` 舊文案「取得排行榜失敗」的斷言同步改通用文案；anime 類測試多 server 並行對主機負載敏感，同 sources 備註；驗收子代理另寫 `song-guess-anime-extra.mjs` 42 案例：單一關鍵字 500 只影響動漫熱門、三關鍵字並行且不帶 attribute、取歌中 `SEARCH_BUSY`、排除樣本連 5 局不抽到、`'anime'` 快取與歌手搜尋分開；抽到的 5 首落在前 60、原聲帶／Cover 不被抽到、`MOCK_ITUNES_FAIL_TERM` → `CHART_FAILED`、`topic`／`lastTopic`／`lastSource`／`song.artist`）：`ITUNES_RSS_URL` 也指到假 iTunes；驗熱門抽樣落在前 30、非熱門可抽到 30 之後、台灣熱門與西洋熱門各一局、`CHART_FAILED`（RSS 壞、lookup 壞）、`SOURCE_INVALID`、`topic`／`lastTopic`／`lastSource`／`song.artist`。瀏覽器實測用 `.claude/launch.json` 的 `draw-guess-built`（同一程序服務三款遊戲，開 `/song-guess/`），真 iTunes 一回合（Rex 本機有網路）。

## 9. 尚未定案

- 同事電腦連不到 Apple CDN 時的 server 中繼（v2）。
- 年代條件：歌手 ＋ 年代區間（`releaseDate` 事後過濾，不足 5 首時放寬前後各一年）。「某年全台熱門」做不到：Apple 只有當下榜單、沒有歷史年榜（海圖 2026-10-16 探測）。曲風：`genreId` 無效，暫無資料源。
- 動漫熱門的關鍵字搜尋會混入歌名就叫「Anime」的非動漫歌（LUCKY TAPES《Anime》、TABLO《anime》，前 60 名內兩首；驗收 2026-10-20 觀察）；關鍵字搜尋本質如此，若要排除需加黑名單或要求專輯名含動畫字樣，待 Rex 指示。
- **日文歌名的中文猜法：不處理**（Rex 2026-10-21 定案）。Apple 只有一個 `trackName`，沒有譯名欄位；台灣商店歌名由唱片公司填，實測前 40 首動漫歌：多數保留日文原名、8 首是羅馬拼音或英文（Uchiagehanabi／homura／Niji／I'm invincible），中文譯名只有少數（隔壁的龍貓、惡魔之子）。可做的只有「接受日本商店歌名當別名」＋「新字體→繁體對照」，解決拼音與字形、解決不了中文譯名，Rex 定不做。
- 動漫「填作品名」：中文作品名搜尋多為翻唱頻道、池子小（鏈鋸人 8、你的名字 0），日文原名可用但同事不會打；Epic 19 只做「動漫熱門」（海圖 2026-10-20 探測）。
- 沒人猜對時「再播一次」（v1 直接揭曉）。

## 10. 變更紀錄

| 日期 | 內容 |
|------|------|
| 2026-10-20 | **Epic 19 動漫熱門**：§4 `SongSource` 加 `'anime-hot'`、payload、`SOURCE_TITLE['anime-hot']`、常數 `ANIME_TERMS`／`ANIME_HOT_POOL` 60；§3 關鍵字聯集探測；§5 第四分支；§5.3 `CHART_FAILED` 文案改通用；§6 `animePool`／`isSoundtrackOrCover`／`pickAnime`、假 iTunes 三關鍵字與 `MOCK_ITUNES_FAIL_TERM`；§7 四選一；§8 `song-guess-anime.mjs`；§9 作品名不做 | Rex 2026-10-20「猜歌想做動漫主題」→ 海圖探測：曲風榜偏門、作品名命中差，關鍵字聯集最佳；Rex「好開始」（`plan/song-guess-anime.md`） |
| 2026-10-16 | **Epic 18 題庫來源**：§4 `round:setArtist` → `round:setSource`（payload `SongSourcePayload`：歌手＋`hot`／台灣熱門／西洋熱門，ack `{ topic }`）、`RoundPublic` 的 `artistDisplay`／`lastArtist` → `topic`／`lastTopic`，新增 `source`、`artistHot`、`lastSource`；`SongPublic.artist`；錯誤碼 `SOURCE_INVALID`、`CHART_FAILED`；常數 `HOT_POOL` 30、`CHART_SIZE` 100、`SOURCE_TITLE`；§3 排行榜 RSS ＋ lookup、`ITUNES_RSS_URL`；§5 choosing 三分支；§6 `chart`／`pickChart`、假 iTunes 擴充；§7 對話框與顯示；§8 `song-guess-sources.mjs`；§9 年代改寫 | Rex 2026-10-16：歌手搜尋加「熱門」預設勾、台灣熱門直接抓當日、問西洋熱門；海圖實測 Search 順序即熱門度、RSS 無 previewUrl 需 lookup、美國榜在台灣商店 25/25 有試聽（`plan/song-guess-sources.md`） |
| 2026-10-12 | Phase 1–3 驗收通過（acceptance-reviewer）：§8 補 `song-guess-rules.mjs`；design §2 idle 列改「灰化不可按」。實測：起播位置誤差 60～84 ms；真 iTunes 兩局（孫燕姿、Jay Chou→周杰倫）；Cmd+A 為測試工具限制非產品問題 |
| 2026-10-12 | 水手長四件修改回報：§4 加 `mainTitle`；退回過半的三個細節；§5 時鐘「同一次轉移取同一值」保證（1 ms 競態修正）；design 佔位音符圖示保留 `--fg-muted` |
| 2026-10-12 | 水手長實作回報後定案（1–12）：feat. 字界；歌手比對不去標點；退回對象須佔原始結果過半；括號開頭歌名排除、`titleLength` 不含空白標點；`setterId` 語意；離開者從 correctIds／scores 移除；`lastArtist` 改正式名；實作細節（快取、注入點、系統訊息、ack 15 秒、假 iTunes 參數）回寫 |
| 2026-10-12 | 水手長派工前疑義定案（Q1–Q9）：`durationMs` 以 `trackTimeMillis` 為準；英文名／別名以最多次 `artistName` 退回再抽；`artistDisplay` 取最多次者；去副標為空退回原名、純符號歌名排除；未猜對者含歌名訊息擋下；`results` 進第 1 首才清；第 5 首照停揭曉；局中離開者不進排名、0 分者依 `participantIds`、人數掉到 1 照走；搜尋回來已非同次 choosing 丟棄；新增 `START_DELAY_MS` 1500 起播緩衝 |
| 2026-10-12 | 初版（海圖）：Rex 定案打字猜、歌手必填且顯示、Meet 偽裝、每首播到底、一局 5 首；計分 50～100 與沒人猜對直接揭曉為海圖預設（Rex 未反對即採用）；iTunes 可行性探測寫入 §3 |
