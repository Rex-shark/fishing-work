# 繪圖比賽（draw-contest）：架構與事件契約

> 本檔是繪圖比賽的**實作唯一契約**：模組佈局、Socket 事件、常數、回合狀態機、評分器、驗證方式。改動需架構師海圖（Chart）定案（2026-10-12 起兩款遊戲規格皆由海圖負責；羅盤、舵手為舊名冊）；凡涉及平台共用層（`server/` 的靜態檔路由與入口、`shared/` 的套件設定、根目錄建置設定、Docker）同樣由海圖定案，並同步 [../architecture.md](../architecture.md) §1／§3。

---

## 1. 模組佈局

```
fishing-work/
├── shared/src/draw-contest/     # 本遊戲的事件契約與常數（§4）；只經子路徑 @fishing-work/shared/draw-contest 匯出，不進 shared 根匯出（名稱會與 draw-guess 衝突）
├── server/src/games/draw-contest/
│   ├── register.ts              # /draw-contest namespace 接線（薄）：驗證 payload 形狀 → Room → ack 與效果
│   ├── room.ts                  # 房間與回合狀態機（純邏輯、Effect 模式，與 draw-guess 同一寫法但**獨立複製**，不共用程式）
│   ├── submission.ts            # PNG 交卷驗證（magic bytes、尺寸上限）
│   ├── ranking.ts               # 排名與總分（純函式）
│   ├── chat.ts                  # 聊天錯誤文案與節流（§5.3；文字驗證在 shared 的 text.ts）
│   └── judge/
│       ├── types.ts             # Judge 介面
│       ├── random.ts            # 隨機評分器（確定性：以 PNG 雜湊＋題目當種子）
│       ├── ollama.ts            # Clef 決策模型（POST /v1/systemone），Phase 3
│       ├── queue.ts             # 評分佇列（一次一張、逾時、失敗退回 random）
│       └── index.ts             # 依環境變數 JUDGE 建立評分器
│   └── commentary/              # Epic 15 評語器（§6.1）
│       ├── ollamaChat.ts        # gemma4（POST /api/chat）組請求、解析、後處理
│       ├── queue.ts             # 評語佇列（一次一張、逾時、回合內首次失敗即跳過、丟棄）
│       └── index.ts             # 依環境變數 COMMENT 建立評語器、探測、背景暖機
└── draw-contest/                # @fishing-work/draw-contest：React 19 + Vite + TS + Tailwind v4 客戶端（§7）
```

| 模組 | 職責 | 不做什麼 |
|------|------|---------|
| `shared/draw-contest` | 型別與常數 | 無執行期相依 |
| `server/games/draw-contest` | 房間、回合、交卷收集、評分佇列、排名、聊天 | 不中繼筆跡、不存資料庫 |
| `draw-contest` | 畫面、本機畫布、PNG 匯出、揭曉畫廊 | 不算分、不排名（以 server 為準） |

**決策：server 的房間／重連／暱稱邏輯是「複製」而非「抽共用」**（羅盤 2026-10-07，待舵手定案）。原因：draw-guess 的 `room.ts` 796 行裡回合邏輯與加入邏輯交織，抽共用等於重構 draw-guess；兩款遊戲的回合模型差異大，共用的只有加入／接管／寬限約 150 行。複製一份、各自演進，draw-guess 零改動、協定測試不受影響。第三款遊戲出現時再評估抽共用。

## 2. 技術棧

與平台相同（[../architecture.md](../architecture.md) §2）。客戶端 `draw-contest/` 的 `package.json`、`tsconfig`、`eslint.config.js`、`vite.config.ts` 以 `draw-guess/` 為範本；Vite `base: '/draw-contest/'`，**dev server 綁 5174**（80 已被 draw-guess 的 dev server 占用；開發只在 Rex 本機，不需區網；2026-10-12 Rex：內部埠改 5173／5174，不用 3000／3001），`/socket.io` proxy 到 `:5173`；另把 **`^/$`（遊戲清單）與 `/healthz`** proxy 到 `:5173`、**`/draw-guess`** proxy（含 ws）到 draw-guess 的 Vite `:80`（Vite 對 base 以外的根路徑會 302 到 `/draw-contest/`；加了之後直接開 `http://localhost:5174/` 也是遊戲清單；與 draw-guess 的 Vite 對稱，Rex 2026-10-12 要求、海圖定案）。

## 3. 執行拓樸與部署

### 開發

```bash
npm run dev     # concurrently：server（PORT=5173）＋ draw-guess Vite（:80）＋ draw-contest Vite（:5174）；自動開瀏覽器到 http://localhost/（遊戲清單）
```

2026-10-12 起只有一條 dev 腳本（原 `dev:contest` 移除）：從遊戲清單點進 `http://localhost/draw-contest/` 即為本遊戲的 HMR 開發版（:80 的 draw-guess Vite 把 `/draw-contest` 含 ws 轉給 :5174）。:5174 只是轉發目標，不需直接開；開發只在 Rex 本機，不給區網同事連。細節見平台 spec §3「開發」。

### 正式

`npm run build` 多建 `draw-contest/dist/`；`npm start` 同一個程序在 `/draw-contest/` 提供本遊戲，`/` 清單多一個入口。分享網址 `http://<Rex IP>/draw-contest/`。

### 評分器環境變數（server）

| 變數 | 預設 | 說明 |
|------|------|------|
| `JUDGE` | `ollama` | `ollama`：Clef 決策模型（**預設**，Rex 2026-10-07 定案；連不上 Ollama 時啟動只 log warn，每回合仍先試 ollama，失敗才退回 random 並只影響該回合，畫面標「隨機評分」）；`random`：隨機評分器（沒有模型的機器或測試用） |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama 位址；Docker 內用 `http://host.docker.internal:11434`（compose 已設） |
| `JUDGE_MODEL` | `clef:27b-nvfp4` | Rex 本機已下載的 tag（27B NVFP4，18 GB；`ollama list` 可查；2026-10-10 Rex 由 `clef:27b-q4_k_m` 改）；用其他版本（如 `clef:27b-q4_k_m`、`clef-flash`）時改此值 |
| `JUDGE_TIMEOUT_MS` | `30000` | 單張評分逾時；逾時或失敗該張退回 random，且**本回合剩餘各張一律改用 random**（有界：最壞只多等一次逾時） |
| `JUDGE_FAKE_DELAY_MS` | `1500` | random 評分器每張的假延遲（讓「評分中 n/m」看得到；測試設 0） |
| `COMMENT` | `ollama` | Epic 15 評語器：`ollama`（gemma4 產メスガキ評語，**預設**，Rex 2026-10-12 定案）；`off` 關閉（沒有 gemma4 或記憶體不足的機器，例如 32 GB） |
| `COMMENT_MODEL` | `gemma4:26b-mlx-bf16` | 評語用的 Ollama 模型 tag（52.5 GB bf16；與 Clef 同時常駐約 71 GB） |
| `COMMENT_TIMEOUT_MS` | `20000` | 單張評語逾時；逾時或輸出空白該張無評語，且本回合剩餘各張直接跳過（§6.1） |

> `JUDGE_IMAGE_WIDTH` 已於 2026-10-12 移除（Epic 15 決策 12）：Clef `clef:27b-nvfp4` 在 Ollama 0.40.3 MLX 後端下 1280×720 原圖 2.4 秒，不再縮圖。

### Docker（Epic 9 的映像，Phase 0 修改）

- `Dockerfile`：build 階段多 `COPY draw-contest/package.json draw-contest/`，runtime 多 `COPY --from=build /app/draw-contest/dist ./draw-contest/dist`。維持 repo 相對路徑（Epic 9 決策 1）。**模型不進映像**（18 GB），容器只以 HTTP 呼叫主機的 Ollama。
- `docker-compose.yml`：加 `JUDGE`、`OLLAMA_URL`（預設 `http://host.docker.internal:11434`）、`JUDGE_MODEL` 環境變數，並加 `extra_hosts: ["host.docker.internal:host-gateway"]`（Linux 需要；macOS／Windows 的 Docker Desktop 本來就解析得到）。
- **主機 Ollama 的綁定**：macOS Docker Desktop 下 `host.docker.internal` 可連到主機 `127.0.0.1` 的服務，Ollama 預設設定即可。Linux 主機走 `host-gateway` 會從 bridge 網段進來，Ollama 必須以 `OLLAMA_HOST=0.0.0.0` 啟動才收得到。README 要寫這兩種情況。
- 健康檢查不含 Ollama：Ollama 掛掉遊戲仍可玩（退回 random）。

## 4. Socket 事件契約（namespace `/draw-contest`）

> 型別檔 `shared/src/draw-contest/events.ts` 與常數檔 `constants.ts` **逐字**依本節撰寫；驗收以 diff 比對。

```ts
// shared/src/draw-contest/events.ts
// 契約來源：spec/draw-contest/architecture.md §4（逐字照抄，修改需經架構師海圖定案並先改 spec）

export const DRAW_CONTEST_NAMESPACE = '/draw-contest';

export type ContestPhase = 'idle' | 'choosing' | 'drawing' | 'judging' | 'ended';

/** 評分器：ai = Clef 決策模型；random = 隨機（MVP 預設，或 AI 失敗退回） */
export type JudgeMode = 'ai' | 'random';
/** Epic 15：本回合評語器；'off' = 環境變數關閉或本回合已失敗跳過 */
export type CommentMode = 'ai' | 'off';

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
  startedAt: number | null;     // drawing 開始 epoch ms
  endsAt: number | null;        // choosing：出題期限；drawing：交卷期限；其餘 null
  participantIds: string[];     // 本回合參賽者（drawing 開始時定案；寬限期滿離開者移除）
  submittedCount: number;       // 已交卷人數
  judgedCount: number;          // 已評分人數
  judgeMode: JudgeMode | null;  // 本回合評分器（judging 起；AI 失敗退回後為 'random'）
  commentMode: CommentMode | null; // Epic 15：本回合評語器（judging 起；關閉或本回合失敗跳過後為 'off'）；生命週期同 judgeMode
  results: ResultEntry[] | null; // ended 才有；下一回合 drawing 開始時清空（idle／choosing 期間資料保留；畫面上 idle／ended 顯示畫廊，choosing 不顯示）
  lastTopic: string | null;     // results 對應的題目（揭曉畫面與中途加入者顯示用）；與 results 同生命週期
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

export type ErrorCode =
  | 'NICKNAME_INVALID' | 'NICKNAME_TAKEN' | 'NOT_IN_ROOM' | 'ROOM_FULL'
  | 'ROUND_BUSY' | 'NOT_SETTER' | 'NOT_ENOUGH_PLAYERS' | 'TOPIC_INVALID'
  | 'NOT_DRAWING' | 'NOT_PARTICIPANT' | 'ALREADY_SUBMITTED' | 'SUBMISSION_INVALID'
  | 'MESSAGE_INVALID' | 'RATE_LIMITED';

export type Ack<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: ErrorCode; message: string };   // message 為繁體中文，可直接顯示

export interface ClientToServerEvents {
  'player:join': (payload: { nickname: string; token?: string }, ack: (r: Ack<JoinResult>) => void) => void;
  /** 我出題：idle／ended 且在線 ≥ MIN_PLAYERS → choosing */
  'round:volunteer': (ack: (r: Ack) => void) => void;
  /** 出題者送題 → drawing（參賽者＝此刻在線者） */
  'round:setTopic': (payload: { topic: string }, ack: (r: Ack) => void) => void;
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
  /** Epic 15：ended 後評語陸續完成時廣播；收到即把 results 該筆的 comment 填入、commentPending 設 false */
  'contest:comment': (update: CommentUpdate) => void;
  'chat:message': (message: ChatMessage) => void;
}
```

### 常數（`shared/src/draw-contest/constants.ts`）

> Epic 15 新增：`COMMENT_PERSONA_NAME = 'メスガキ'`（評審名稱唯一來源：server 提示詞與揭曉卡片都讀它；Rex 2026-10-12 定名）。

| 常數 | 值 | 說明 |
|------|----|------|
| `DRAW_SECONDS` | 120 | 作畫時間（秒）；唯一來源，README／說明文字由此推導 |
| `COMMENT_PERSONA_NAME` | `'メスガキ'` | Epic 15 評審名稱；server 提示詞與揭曉卡片前綴都讀它 |
| `CHOOSING_SECONDS` | 60 | 出題期限 |
| `SUBMIT_GRACE_SECONDS` | 5 | endsAt 後仍接受交卷的寬限（自動交卷在途） |
| `MIN_PLAYERS` | 2 | 我出題所需在線人數 |
| `MAX_PLAYERS` | 50 | 房間上限 |
| `NICKNAME_MAX` | 12 | 暱稱最長 |
| `TOPIC_MAX` | 20 | 題目最長 |
| `CHAT_MAX` | 200 | 聊天最長 |
| `CHAT_HISTORY` | 100 | 快照帶的聊天則數 |
| `CHAT_MIN_INTERVAL_MS` | 300 | 聊天最短間隔 |
| `RECONNECT_GRACE_SECONDS` | 15 | 斷線寬限 |
| `CANVAS_LOGICAL` | `{ width: 1280, height: 720 }` | 邏輯畫布；交卷 PNG 即此尺寸 |
| `CANVAS_BACKGROUND` | `'#1E1E1E'` | 畫布預設底色（與我畫你猜一致） |
| `MAX_SUBMISSION_BYTES` | 2_097_152 | 交卷 PNG 上限（2 MiB；線條畫通常 < 100 KB）；Socket.IO `maxHttpBufferSize` 以此 + 64 KiB |
| `SCORE_MAX` | 100 | 單回合滿分 |
| `BRUSH_MIN`／`BRUSH_MAX`／`BRUSH_DEFAULT` | 1／64／4 | 同我畫你猜 |
| `PALETTE`／`COLOR_PATTERN` | 同我畫你猜 | 色塊與色碼格式 |

暱稱與文字的純函式**複製**到 `shared/src/draw-contest/`（不從 draw-guess 匯入，兩遊戲獨立演進）：`nickname.ts` 放 `validateNickname`、`nicknameKey`；`text.ts` 放 `countChars`、`hasControlChars`、`validateTopic`、`validateChatText` 與 `TOPIC_INVALID_MESSAGE`（文案與 draw-guess 的 `server/topic.ts` 相同，但本遊戲放 shared 讓前端可共用）。`validateTopic` 所需的「去空白後非空」正規化寫成 `text.ts` 的私有函式，**不複製** `answer.ts`（本遊戲不判答案）。server 的 `chat.ts` 只放錯誤文案與節流，import `validateChatText`。

## 5. 房間與回合狀態機（server）

```
idle ──volunteer（在線≥2）──▶ choosing ──setTopic──▶ drawing ──全員交卷 或 endsAt──▶ judging ──佇列清空且寬限過──▶ ended
  ▲                             │ 逾時／cancel／出題者離開                                                         │
  └─────────────────────────────┘                                        volunteer（ended 視同 idle）◀───────────────┘
```

- **choosing**：`setterId`、`endsAt = now + CHOOSING_SECONDS`。逾時、`round:cancel`、出題者寬限期滿離開 → `idle`（`results` 保留）。
- **drawing**：`roundNo++`、`topic`、`startedAt`、`endsAt = now + DRAW_SECONDS`、`participantIds = 此刻 connected 的玩家`（含出題者）、`results = null`、清掉上回合的交卷與畫廊。`players.participating／submitted` 同步更新。
- **交卷** `contest:submit`：須 phase 為 `drawing`，或 `judging` 且 `now ≤ endsAt + SUBMIT_GRACE_SECONDS`；須為參賽者；每回合一次（`ALREADY_SUBMITTED`）；PNG 驗證見 §5.1。成功 → 存入 submissions、`submittedCount++`、排進評分佇列、`players:update`、`round:update`。所有參賽者都交卷 → 立即 `judging`。
- **judging**：`judgeMode` 設為目前評分器模式。佇列一次一張；每張完成 `judgedCount++` 並 `round:update`。`endsAt + SUBMIT_GRACE_SECONDS` 過後不再收交卷；未交卷者視為 0 分。**佇列清空，且（所有參賽者都已交卷 或 `now > endsAt + SUBMIT_GRACE_SECONDS`）** → `ended`（全員提前交卷時不等寬限；2026-10-07 帆指出原文矛盾後修正）。
- **ended**：計算 `results`（§5.2）、總分累加、廣播 `round:update` 與每張 `contest:gallery`。無計時器。`round:volunteer` 可用（同 idle）。
- **評語（Epic 15）**：每張評分完成（含退回 random）的瞬間排進評語佇列（§6.1，一次一張）；`judging` 開始時 `commentMode` 設為目前評語器模式。**`ended` 不等評語**：計算 `results` 時已完成的評語直接寫進 `comment`，未完成者 `commentPending: true`；**第一名重做稱讚版（Epic 15 Phase 4，Rex 2026-10-12）**：`commentMode === 'ai'` 時，取 `rank === 1` 且 `submitted` 者（排名規則保證唯一），不論其評語是否已完成，一律設 `comment: null`、`commentPending: true` 寫進 results，並把它的評語工作以**稱讚版**提示詞（§6.1）插到評語佇列最前面（在途那張跑完才輪到）；若它原本的工作仍在佇列中則取代之；**正在產生中則直接中止**（不算失敗、不發事件、結果丟棄），稱讚版立即接著跑；在途的是別人的才等它跑完。稱讚版的逾時從開始產生時起算。**稱讚版失敗 → 第一名最終 `comment: null`**，即使原本已有批評版也不退回（第一名不該顯示批評），其餘照規則 (b)。`commentMode` 已為 `'off'`（關閉或本回合已失敗）時不重設、不重做，第一名維持原值。完成後照常 `contest:comment`。單人回合的第一名也稱讚；之後每完成一張廣播 `contest:comment`（成功或失敗都發）並同步更新 server 端的 `results`（中途加入者快照即為最新）。進入 `drawing` 時丟棄上回合未完成的評語工作（中止在途的那張**不算失敗**，新回合仍從 `'ai'` 開始）。**丟棄只發生在 `drawing`／`judging`**：參賽者在這兩階段寬限期滿離開時，其交卷與評語工作一起丟棄（本來就不進 results）；**`ended` 之後離開的人，評語工作照常跑完並發 `contest:comment`**（results 與畫廊是已揭曉的紀錄，保留），不會留下永遠 pending 的卡片（水手長 Q2，2026-10-12 定案）。未交卷者 `comment: null`、`commentPending: false`。`commentMode === 'off'`（環境變數關閉）時不排佇列、所有人 `commentPending: false`。
- **參賽者離開**（寬限期滿）：從 `participantIds` 移除；已交卷的那張仍在佇列的話丟棄（不計入 `judgedCount`、不進 results）。判定「全員交卷」與「全員評完」都以當下的 `participantIds` 為準。
- **出題者離開**：choosing → idle；drawing／judging 不影響（題目已公開）。
- **階段不符的回合事件**：`idle`／`ended` 時 `round:setTopic`、`round:cancel` → `NOT_SETTER`（比照 draw-guess 的 `NOT_DRAWER`）；`choosing` 時非出題者 → `NOT_SETTER`；`drawing`／`judging` 時 `round:volunteer`、`round:setTopic`、`round:cancel` → `ROUND_BUSY`。
- **計數**：參賽者離開時 `submittedCount`、`judgedCount` 依當下 `participantIds` 重算（已評分者離開兩數都減，n/m 不會卡住）。`ended` 之後離開的人，`results`、`lastTopic` 與畫廊都保留（已揭曉的紀錄）。
- **欄位生命週期**：`participating`／`submitted` 在 `idle`／`choosing` 一律 false；`isSetter` 在 `ended` 仍為 true、`setterId` 保留到下一次 `volunteer`；`topic` 在 `drawing` 起有值、下一回合 `choosing` 時回 null，`lastTopic` 與 `results` 同進退（`ended` 時設為本回合題目、下一回合 `drawing` 開始時清空）。
- **system 訊息**：加入／離開、「X 取消出題」「X 出題逾時」「出題者 X 離開」、回合開始（含題目）、揭曉（第一名；沒人交卷時「揭曉：沒有人交卷」）。
- **重複 join**：同一 socket 再送 `player:join` 時照「results 非 null 則補送畫廊」的字面再補送一次（無害，不特別擋）。
- **交卷檢查順序**：phase（含寬限）→ `NOT_DRAWING`；參賽者 → `NOT_PARTICIPANT`；已交卷 → `ALREADY_SUBMITTED`；PNG → `SUBMISSION_INVALID`。
- **廣播**：每次狀態轉移各廣播一則 `round:update`，不合併（全員交卷且佇列已清空時，`judging` 與 `ended` 各一則）。題目去頭尾空白後存。`contest:gallery` 廣播給所有在線者（含旁觀者），每位交卷者各一則。
- **人數不足**：drawing 中參賽者剩 1 人以下不中止（單人也能評分）。`participantIds` 變空（全員寬限期滿離開）時「全員交卷」空真成立：直接進 `judging` 再到 `ended`，`results = []`。

### 5.1 交卷 PNG 驗證（`submission.ts`）

- payload 為物件、`png` 為 ArrayBuffer／Buffer／Uint8Array（Socket.IO 二進位），長度 1 ～ `MAX_SUBMISSION_BYTES`。
- 前 8 bytes 為 PNG magic `89 50 4E 47 0D 0A 1A 0A`；IHDR 的寬高須等於 `CANVAS_LOGICAL`（客戶端以 1280×720 匯出）。
- 不合法 → `SUBMISSION_INVALID`。server 不解碼圖片，只存 bytes。

### 5.2 排名與總分（`ranking.ts`，純函式）

- 交卷者依 `score` 降冪、同分依 `submittedAt` 升冪；`rank` 從 1 起，同分不並列（先交卷者在前）。
- 未交卷的參賽者接在後面，`score 0`、`confidence null`、`judgedBy null`、`rank` 接續；彼此之間依 `participantIds` 順序（＝drawing 開始時的加入順序）。
- 每位參賽者 `player.score += entry.score`。

### 5.3 聊天

純文字；`validateChatText`（去頭尾空白後 1 ～ `CHAT_MAX` 字）→ `MESSAGE_INVALID`；每人 `CHAT_MIN_INTERVAL_MS` 內再送 → `RATE_LIMITED`。system 訊息：加入／離開、回合開始（含題目）、揭曉（第一名）。

### 5.4 錯誤訊息（ack.message，繁中）

| 錯誤 | 訊息 |
|------|------|
| `ROUND_BUSY` | 目前已有回合進行中 |
| `NOT_SETTER` | 只有本回合的出題者可以這麼做 |
| `NOT_ENOUGH_PLAYERS` | 至少要 2 位在線玩家才能開始 |
| `NOT_DRAWING` | 現在不是作畫時間 |
| `NOT_PARTICIPANT` | 你不是本回合的參賽者 |
| `ALREADY_SUBMITTED` | 你已經交卷了 |
| `SUBMISSION_INVALID` | 圖片格式不正確或太大 |
| 其餘 | 與我畫你猜同文案 |

## 6. 評分器（`judge/`）

```ts
// judge/types.ts
export interface JudgeInput { png: Buffer; topic: string }
export interface JudgeOutput { score: number; confidence: number }   // 0..SCORE_MAX 整數；0..1
export interface Judge {
  readonly mode: JudgeMode;
  score(input: JudgeInput, signal: AbortSignal): Promise<JudgeOutput>;
}
```

- **`random`**：種子 = FNV-1a(png bytes ‖ topic)，輸出 `score` 均勻 20 ～ 95、`confidence` 0.3 ～ 0.9；同一張圖永遠同分（測試可重現）。`JUDGE_FAKE_DELAY_MS` 後才 resolve。
- **`ollama`**：**連不上的行為**（2026-10-07 定案）：啟動時 `GET /api/tags` 探測（逾時 3 秒、不阻塞 listen；2026-10-07 驗收：掛住的位址下 listen 先印、/healthz 224 ms 可用），連不上或清單裡沒有 `JUDGE_MODEL` 都只 log warn `ollamaUnavailable`，**不永久退回**；每回合仍先試 ollama，失敗由佇列退回 random（本回合剩餘走 random），所以 Ollama 晚開不必重啟 server。沒有 Ollama 的機器建議直接設 `JUDGE=random` 省掉每回合一次逾時。請求格式：`POST ${OLLAMA_URL}/v1/systemone`，`model = JUDGE_MODEL`，`images: [base64(png)]`，`state: { task: 'A player drew this picture in a drawing contest.', topic }`，questions：
  - `likeness`（score；instructions `How clearly does this drawing depict the topic '{topic}'?`；5 級：Unrecognizable／Vaguely related／Somewhat recognizable／Clearly recognizable／Unmistakable）
  - `is_topic`（noul；instructions `Is this a drawing of {topic}?`）
  - `effort`（score；instructions `How complete is the drawing?`；3 級：Blank or scribble／Partial／Complete drawing）
  - 三題都帶 `instructions`（Ollama 文件把 score 題的 instructions 列為必填；2026-10-07 定案，文案與羅盤實測相同）。
  - 合成：`score = round(100 × (0.6 × likeness/4 + 0.3 × is_topic + 0.1 × effort/2))`，`confidence = likeness.confidence`。
  - **2026-10-07 羅盤實測**（Ollama 0.40.0、`clef:27b-q4_k_m`、M5 32 GB、1280×720 蘋果線稿）：對「an apple」likeness 2.20／is_topic 0.82／effort 1.12 → 合成 63 分；同一張對「a car」likeness 0.37／is_topic 0.09 → 11 分，分得開。黑底白筆與白底黑筆結果幾乎相同（2.20 vs 2.12），**不需反白**。延遲：1280×720 約 14 秒（1299 tokens）、640×360 約 4.5 秒（515 tokens，likeness 2.17 幾乎不變）、320×180 約 3.3 秒但失真（1.84）。當時定案：server 送模型前縮到 `JUDGE_IMAGE_WIDTH`（640）。**2026-10-12 作廢（Epic 15 決策 12）**：Clef 換 `clef:27b-nvfp4` 並由 Ollama 0.40.3 MLX 後端執行後，1280×720 原圖只要 2.4 秒（1259 tokens），**交卷原圖直送、不再縮圖**，`JUDGE_IMAGE_WIDTH`、`resizePng`、`pngjs` 一併移除。
  - 題目語言：`topic` 原樣放進 state 與 instructions（中文題目直接送）。**帆 2026-10-07 實測**（640 寬、約 585 tokens、judgedBy 'ai'）：中文題「蘋果」蘋果圖 likeness 2.69／is_topic 0.93／effort 1.32 → 75 分（4.6 秒，暖機首張 10.2 秒），空白圖 → 3 分；英文題「apple」蘋果圖 → 76 分、空白圖 → 2 分；中英幾乎相同。對照 1280 原圖 79 分、13.8 秒。Docker 容器經 host.docker.internal 評分結果與本機相同。**補 instructions 後重跑**（2026-10-07 驗收）：線稿蘋果 76（likeness 2.76／is_topic 0.92／effort 1.47）、空白 3；彩色蘋果圖本機與 Docker 都 82 分、約 4.7–5.0 秒、空白 4 分。Ollama 掛住（收連線不回應）時第一張等滿 30 秒逾時退回、其餘直接 random，交卷到揭曉 33 秒（有界）。未驗：冷啟動暖機（實測過一次首張 10.2 秒）。
  - **2026-10-10 換 `clef:27b-nvfp4` 實測**（Ollama 0.40.2、M5 Max 128 GB、640 寬、約 597 tokens、合成圖）：請求與回應格式不變。蘋果線稿對「an apple」77 分（likeness 2.81／is_topic 0.92／effort 1.40）、對「蘋果」74 分、彩色蘋果 79 分、汽車線稿對「汽車」81 分；畫錯題（蘋果圖對「a car」9 分、汽車圖對「蘋果」10 分）、空白 3 分、亂塗 4 分，分得開，與 Q4 版同一水準。延遲：暖機首張 4.7 秒，之後每張約 0.6–1.3 秒。未驗：Docker 容器經 host.docker.internal、32 GB 機器上的速度。
  - **`confidence` 的含義**：熵正規化的「模型有多確定」，不是「畫得多好」：蘋果圖的 likeness confidence 只有 0.19–0.22（機率分散在 2～4 級），空白圖反而 0.78–0.83（集中在 0 級）。v1 只存進 `results.confidence`、畫面不顯示；日後若要用，只能當「AI 不太確定」的標記，不得當品質指標。
- **佇列**（`queue.ts`）：一次一張（`JUDGE_CONCURRENCY` 固定 1，不開放設定；27B 單張 4.5 秒，30 人最壞約 2.5 分鐘，交卷即評所以大多在倒數內算完）；每張 `JUDGE_TIMEOUT_MS` 逾時（AbortSignal）；失敗或逾時 → 該張改用 random 評分、`judgeMode` 設為 `'random'`，本回合剩餘各張直接走 random。回合結束（參賽者離開）時丟棄已無對應者的工作。
- **假的 Ollama**（Phase 3，`user/mock/systemone.mjs`）：只實作 `POST /v1/systemone`，回應格式與真 Ollama 相同、分數由圖片雜湊決定；用來在模型未就緒時測 `ollama.ts` 的組請求與解析。

### 6.1 評語器（Epic 15，`commentary/`）

- **目的**：每張畫一句メスガキ評語，只顯示在揭曉卡片（Rex 2026-10-12 定案）。Clef 負責分數、gemma4 只負責文字，兩者各自獨立。
- **模組**：`server/src/games/draw-contest/commentary/`：`ollamaChat.ts`（組請求、解析、後處理）、`queue.ts`（一次一張、逾時、回合內首次失敗即跳過、丟棄規則）、`index.ts`（讀 `COMMENT`／`COMMENT_MODEL`／`COMMENT_TIMEOUT_MS`、啟動探測與背景暖機）。
- **請求**：`POST ${OLLAMA_URL}/api/chat`，body `{ model: COMMENT_MODEL, stream: false, think: false, keep_alive: '30m', messages, options: { temperature: 0.9, num_predict: 80 } }`。`messages`：
  - system（逐字）：`你是メスガキ，繪圖比賽的評審。規則只有兩條：用繁體中文（台灣用語）；一句話，40 字內。`（`メスガキ` 讀 `COMMENT_PERSONA_NAME`）
  - user（逐字）：`題目「{topic}」，評分 {score} 分。這是參賽者的畫，給一句評語。`，`images: [base64(交卷原 PNG)]`。
  - **第一名稱讚版**（Phase 4）：user 改為（逐字）`題目「{topic}」，評分 {score} 分，這張是本回合第一名。妳不甘心，但還是得承認它畫得好，用雌小鬼的口氣誇它，一句評語。`，system 不變、其餘參數不變。只有 §5 的第一名重做用它。**文案由來**（水手長 2026-10-12 真模型比較，同圖同參數各 5 句）：初稿「用雌小鬼的方式稱讚它」5 句中 3 句仍直說「超爛／笨拙」；加禁止句「可以嘴硬，但不可以說它畫得爛」改善有限；告訴模型「它畫得好、妳得承認」才 5 句全有正面肯定（例：「哈啊？這種簡單的蘋果也能拿第一？雖然畫得很像樣啦，但別太得意喔！」）。海圖定案採此版；簡體字（例「强」）不做後處理，留 Rex 目視。
  - **不加禁詞、不加範例句、不給暱稱與名次**（Rex 2026-10-12：讓 gemma4 自由發揮，規則只有兩條）。第一名稱讚版是唯一例外，且也只告訴模型「這是第一名、它畫得好、妳得承認、用雌小鬼的口氣誇它」。
  - **`think: false` 必帶**：gemma4 預設思考，`num_predict` 80 會全被思考吃掉、`content` 空白（海圖 2026-10-12 實測 14.7 秒空回覆；關掉後 0.4～0.5 秒）。
- **回應**：`200 { message: { role: 'assistant', content }, done: true, ... }`。後處理：`content` 去頭尾空白、取第一行；空字串視為失敗。**不截斷**（40 字是給模型的規則，畫面以 `line-clamp` 處理）。
- **啟動**：`COMMENT=ollama` 時 `GET /api/tags` 探測（逾時 3 秒、不阻塞 listen，同評分器）；清單裡沒有 `COMMENT_MODEL` 只 log warn `commentUnavailable`，每回合仍嘗試。有模型時**背景暖機一次**（內容「嗨」、`num_predict: 1`、`think: false`、`keep_alive: '30m'`、逾時 60 秒；探測失敗就不暖機；結果只 log `warmup`／`warmupFailed`）：冷啟動載入實測 9～17 秒，不暖機第一回合第一張會等。**Clef 也比照暖機**（2026-10-12 海圖定案，Epic 15 收尾）：`JUDGE=ollama` 且探測到模型時，啟動後背景送一張 1×1 PNG（寫死 69 bytes、單一像素 `#1E1E1E`）的 `/v1/systemone` 請求（state／questions 同評分三題、題目 `'warmup'`、逾時 60 秒、**帶 `keep_alive: '30m'`**——不帶的話 Clef 只留 Ollama 預設 5 分鐘，啟動後 5 分鐘沒人玩暖機就白做；代價是閒置多佔 18 GB 約 25 分鐘，接受），結果只 log `draw-contest.judge.warmup`（model、ms、inputTokens）／`warmupFailed`（model、ms、reason）；`JUDGE=random` 不暖機。Clef 與 gemma4 的暖機各接在自己的探測後同時送出、不排先後。原因：水手長實測 Clef 冷啟動第一張 13.4 秒；暖機後第一張 1.5 秒。log 事件名：`draw-contest.comment.{config, ollamaReady, commentUnavailable, warmup, warmupFailed, done, failed, skipped, envInvalid}`（`done` 印出評語原文）。Room 未注入評語器時預設關閉；`JUDGE_IMAGE_WIDTH` 設了不讀也不 warn。
- **佇列**：一次一張，與評分佇列獨立；每張 `COMMENT_TIMEOUT_MS` 逾時（AbortSignal）。失敗（逾時、非 2xx、解析失敗、空字串）→ 該張 `comment: null`；**本回合剩餘各張直接跳過**（不呼叫模型，各張 `comment: null`），`commentMode` 改 `'off'` 並 `round:update`；下一回合重新嘗試。有界：最壞只多等一次逾時。**事件（水手長 Q3，2026-10-12 定案）**：(a) 失敗在 `ended` 之前 → 失敗那張與之後排進來的各張直接 `comment: null`、`commentPending: false`，寫進 results，不發 `contest:comment`；(b) 失敗在 `ended` 之後 → 失敗那張與當下仍 pending 的每一張各發一則 `contest:comment { comment: null }`，再發一則 `round:update`（`commentMode 'off'`）；**例外**：若已進入下一回合 `choosing`（`commentMode` 依生命週期已是 null），只發各張 `contest:comment`、不發 `round:update`（水手長回報 3，2026-10-12 定案）。(c) 失敗在 `drawing`（交卷即評）→ 當下 `commentMode` 仍為 null、不發事件，進 `judging` 時直接設 `'off'`（回報 4，定案）。`round:update` 與 `contest:comment` 的先後順序不強制。丟棄規則見 §5。
- **實測**（海圖 2026-10-12，M5 Max 128 GB、Ollama 0.40.3、`gemma4:26b-mlx-bf16`）：640 寬 0.5 秒、1280 原圖 1.9 秒（600 tokens）；兩模型同時常駐約 71 GB。樣本：「就這也叫蘋果？這種沒靈魂的圓圈也想拿高分，真是笨蛋雜魚呢！」。**驗收子代理 2026-10-12 端到端（建置版、預設環境變數、合成圖）**：原圖直送 Clef `inputTokens` 1257；Clef 暖機 2.7 秒（熱）、gemma4 暖機 55 ms（已載入）；彩色蘋果 80、粗線稿 71、細線稿 62、空白 3；交卷到揭曉 1.7～5.9 秒；評語每張 0.5～2.4 秒、25～29 字，揭曉後 0.2～1.7 秒補齊；沒有永遠「…」的卡片。**Phase 4 稱讚版**（驗收 2026-10-12，三回合）：prompt 629 tokens、537～670 ms；揭曉後 +536～1069 ms 到（在途是自己的被中止時第一個到）；三句皆含正面肯定但為傲嬌式（「還算及格」「畫得很不錯」「還算可以」），語氣待 Rex 目視定案。
- **假的 Ollama**：`user/mock/systemone.mjs` 加 `POST /api/chat`，回 `{ model, message: { role: 'assistant', content }, done: true }`，`content` 依圖片雜湊從固定幾句挑一句（Phase 4：user 文案含「第一名」時從另一組稱讚句挑）；環境變數 `MOCK_COMMENT_MODEL`／`MOCK_CHAT_DELAY_MS`／`MOCK_CHAT_CONTENT`（固定內容優先、不分批評稱讚）／`MOCK_PRAISE_CONTENT`（只換稱讚版回應，測「只有稱讚版失敗」）；`/api/tags` 列兩個模型。協定測試只用它：`draw-contest-comment.mjs` 需兩個 server（`TEST_PORT` 評語開、`TEST_PORT_OFF` 評語關）加一個假 Ollama，`MOCK_CHAT_DELAY_MS` ≥ 300 才測得到「揭曉後補收」；另有 `draw-contest-comment-fallback.mjs`（驗收子代理 2026-10-12 新寫；三 server＋兩假 Ollama）在協定層驗三個退回情境：甲 `OLLAMA_URL` 連不上（評分與評語都退回、揭曉有界、第二回合重試）、乙 `COMMENT_TIMEOUT_MS` 逾時＝規則 (b)（每張 `contest:comment { comment: null }` ＋ `round:update 'off'`）、丙 假 Ollama 空輸出＝規則 (c)(a)。規則 (b) 的例外、離開與換回合丟棄、ended 後離開者照常收到評語需要精準時序，以 vitest（假時鐘＋假 Ollama e2e）為主。協定測試用法註明**避免用瀏覽器開過的埠**（桌面 app 分頁會自動重連佔住房間）。Phase 4 另有 `draw-contest-comment-praise.mjs`（驗收子代理 2026-10-12 新寫；兩 server＋兩假 Ollama）：單人回合（在途批評版被中止、只收一則稱讚句）、五人插隊順序（在途者先跑完、稱讚版插在排隊者之前、早完成的第一名仍重設 pending）、只有稱讚版失敗（`MOCK_PRAISE_CONTENT=`：第一名 null 不退回、規則 (b)、下一回合重試）。

## 7. 客戶端結構（`draw-contest/src/`）

以 `draw-guess/src/` **工作區現況（2026-10-07，含 Epic 10–13 未 commit 的改動）** 為範本複製，之後獨立演進、不同步。保留的目錄：`home/`（首頁：暱稱＋風格卡片，只有「簡報」一張）、`shells/`（`types`、`index`、`views`、`catalog`、`document`、`avatar`、`themeIcons`、`ppt/`、`office/`；**不複製** `vscode/`、`meet/`、`excel/`）、`features/canvas/`（改為純本機：不送 `draw:op`、新增 `exportPng()`）、`features/chat/`（純文字，拿掉圖片）、`features/players/`、`features/round/`、`features/help/`（說明內容改寫）、`layout/`、`socket/`、`store/`、`styles/theme.css`（只留 `:root`、`home`、`ppt` 的 token）。

- 本機偏好鍵：`fishing-work:draw-contest:shell`、`fishing-work:draw-contest:session`（不與 draw-guess 撞鍵）。
- `index.html` 內嵌腳本依 session 鍵設 `data-theme`，與 draw-guess 同法。
- **Epic 15**：store 處理 `contest:comment`（更新 `round.results[].comment`／`commentPending`）；`features/reveal/` 卡片**縮圖下方**加評語行（2026-10-12 定案改到縮圖下方，標題列與縮圖高度固定、同列縮圖對齊；評語行數不同只影響卡片底部；評語行上方間距 6px，讓出前三名外框與焦點外框；**放大檢視的完整句同樣放圖片下方**）（design §3：`メスガキ` 粗體前綴＋12px 斜體 `--fg-muted`、**不截斷**（2026-10-12 移除 `line-clamp-2`）；`commentPending` 顯示「メスガキ：正在寫評語」（2026-10-12 由「メスガキ：…」改，避免與截斷的「…」混淆）；**顯示與否只看該卡片自己的欄位：`comment !== null` 或 `commentPending` 才顯示該行**，客戶端不看 `commentMode`（水手長 Q1，2026-10-12 定案：回合中途失敗時已產生的評語照常顯示；`COMMENT=off` 時每張本來就是 null／false）），放大檢視顯示完整句；`revealView.ts` 純函式加 `comment` 欄位。
- 新增 `features/reveal/`：揭曉畫廊（投影片瀏覽），資料來自 store 的 `round.results` 與 `gallery: Map<playerId, objectURL>`（`contest:gallery` 收到就建 object URL；新回合 drawing 開始時 revoke）。
- store 新增：`myCanvas`（本機筆跡、僅記憶體）、`submitted`、`gallery`。自動交卷：`round.endsAt` 到時若未交卷，客戶端匯出 PNG 送 `contest:submit`（在 `SUBMIT_GRACE_SECONDS` 內）。
- `shellBoundary` 測試沿用（殼層不讀 store、功能元件不出現偽裝字樣）。殼層介面相對 draw-guess 的差異：`ShellRoundState` 加 `submitted`、`showReveal`；插槽加 `finish`（「完成」，功能區右端固定）、`reveal`（投影片瀏覽）；`ShellViews` 加 `terms`（「標題」「儲存」「投影片瀏覽」等偽裝字樣由殼層傳入，功能元件不得出現）；`DialogPurpose` 加 `'submit'`；`DialogProps` 加 `trapFocus`。工具列收合斷點 540px（design §4）。
- 實作細節（帆 2026-10-07 Phase 2 第一段定案）：本機筆跡型別 `DrawOp`／`Point`／`Tool` 放 `features/canvas/ops.ts`（筆跡不走契約，不放 shared）；`exportPng(ops, createCanvas?)` 以離屏 canvas 先填底色（畫面底色是 CSS 背景）再疊筆跡輸出 1280×720 PNG，從 store 取筆跡交卷的流程在 `submitMyCanvas()`；`ConnectionStatus` 放 `layout/`（不設 `features/lobby/`）；自動交卷：`drawing` 時本機時間到 `endsAt` 即交，收到 `judging` 時不看本機時鐘立即補交，寬限由 server 判斷。

## 8. 驗證方式（派工與驗收共用）

四項指令同平台（`npm run typecheck`、`npm test`、`npm run lint`、`npm run build`，分開跑、各自看 exit code）。協定測試：`user/protocol/draw-contest-phase1.mjs`（加入／出題／作畫／交卷／評分／揭曉／排名／中途加入補收畫廊／重連）只依本檔 §4／§5 打 Socket，`JUDGE=random JUDGE_FAKE_DELAY_MS=0 COMMENT=off` 跑（Epic 15 起加 `COMMENT=off`，否則會暖機並呼叫真模型、results 出現 `commentPending: true`；phase1 對 results／round 的斷言補 `comment`／`commentPending`／`commentMode` 欄位）；server 的 vitest 預設 `COMMENT=off`（`vitest.config.ts`，與 `JUDGE=random`、`OLLAMA_URL=127.0.0.1:1` 並列），`AppOptions` 加評語器注入點（比照 `judge`），要測評語的測試一律注入或連假 Ollama，**不得打到真模型**；Epic 15 另有 `user/protocol/draw-contest-comment.mjs`（對假 Ollama 的 `/api/chat`：交卷→揭曉→`contest:comment`；`COMMENT=off` 時 `commentMode 'off'`、無事件；中途加入者快照帶 `comment`）；**不新增縮時用的環境變數**：需要等真實計時的情境（出題逾時回 idle、出題者或參賽者寬限期滿離開與佇列丟棄、`results = []`、`ROOM_FULL`）放 server 的 vitest 單元與 e2e（`AppOptions.durations` 縮時，比照 draw-guess），協定測試只測真實時間可及的，另附 `TEST_SLOW=1` 才跑的慢速段；須與 `user/protocol/draw-guess-*.mjs` 全過並存（server 兩個 namespace 互不影響）。瀏覽器實測用 `.claude/launch.json` 的 `draw-guess-built`（同一程序服務兩款遊戲，開 `/draw-contest/`）。

## 9. 變更紀錄

| 日期 | 內容 |
|------|------|
| 2026-10-12 | 事務長實戰回報兩點體驗（Rex 轉交）：design §2 ended 備忘稿列帶題目「{題目}　第一名：X（n 分）」；design §3／§7 評語行不截斷、pending 文字改「メスガキ：正在寫評語」（海圖定案，小修正派水手長） |
| 2026-10-12 | Phase 4 水手長回報後定案：§6.1 稱讚版 user 文案改為「妳不甘心，但還是得承認它畫得好，用雌小鬼的口氣誇它」（初稿「稱讚它」真模型仍在罵）；§5 補在途中止、逾時起算、稱讚版失敗不退回批評版、off 不重設；假 Ollama 加 `MOCK_PRAISE_CONTENT`；log `comment.done` 帶 `praise` |
| 2026-10-12 | Phase 3 驗收通過（acceptance-reviewer）：§8 補 `draw-contest-comment-fallback.mjs`、§6.1 補端到端數據。**Phase 4 第一名稱讚版（Rex 追加）**：§5 ended 第一名重做（重設 pending、插隊）、§6.1 稱讚版 user 文案與假 Ollama 規則 |
| 2026-10-12 | 水手長實作回報後定案：§7／design §3 評語行改到**縮圖下方**、pending 帶「メスガキ：」前綴；§6.1 失敗規則補 (b) 例外與 (c)、暖機細節、log 事件名、假 Ollama 參數；**Clef 也暖機**；§1 目錄樹加 `commentary/`；§4 常數表加 `COMMENT_PERSONA_NAME` |
| 2026-10-12 | 水手長派工前疑義定案（Q1–Q4）：§7 評語行只看卡片自身欄位不看 `commentMode`；§5 丟棄只在 drawing／judging、ended 後離開者評語照跑；§6.1 失敗在 ended 前後的事件規則；§8 phase1 與 vitest 加 `COMMENT=off`、`AppOptions` 評語器注入點；檔頭定案者改海圖 |
| 2026-10-12 | **Epic 15 AI 評語（海圖定案）**：§3 加 `COMMENT`／`COMMENT_MODEL`／`COMMENT_TIMEOUT_MS`、刪 `JUDGE_IMAGE_WIDTH`；§4 加 `CommentMode`、`ResultEntry.comment`／`commentPending`、`RoundPublic.commentMode`、`CommentUpdate`、`contest:comment`、常數 `COMMENT_PERSONA_NAME`；§5 評語時序（ended 不等評語）；§6 縮圖定案作廢、新增 §6.1 評語器；§7 卡片評語行；§8 協定測試 | Rex 2026-10-12：加メスガキ評語（gemma4 自由發揮、只放卡片、預設開）、Clef nvfp4 不再縮圖、關思考模式 |
| 2026-10-12 | §2／§3：`dev:contest` 移除，併入根目錄 `npm run dev`（三個程序一次起）；draw-contest Vite 加三條 proxy（`^/$`、`/healthz` → `:3000`，`/draw-guess` → `:80`）；平台 spec §3 已改（Rex 2026-10-12、海圖定案） |
| 2026-10-10 | Rex 換模型：§3 `JUDGE_MODEL` 預設 `clef:27b-q4_k_m` → `clef:27b-nvfp4`（程式、compose、README、假 Ollama 預設同步）；§6 補 nvfp4 實測數據；契約與評分邏輯不變 |
| 2026-10-07 | 初版（羅盤）：契約 §4、狀態機 §5、評分器 §6；共用層項目（§1 複製決策、§3 Docker／環境變數、根目錄建置）送舵手定案 |
| 2026-10-07 | Phase 3 驗收通過後回寫：§3 `JUDGE` 退回語意改為「每回合先試、失敗才退回該回合」；§6 探測含模型存在檢查與非阻塞實測、補 instructions 後的分數 |
| 2026-10-07 | 帆 Phase 3 回報後：§6 三題補 instructions（定案）、中文題實測數據、`confidence` 含義、連不上時「只 warn、每回合重試」；§3 `JUDGE` 預設 ollama（Rex 定案） |
| 2026-10-07 | 羅盤實測 Clef：§3 `JUDGE_MODEL` 預設改 `clef:27b-q4_k_m`、新增 `JUDGE_IMAGE_WIDTH`；§6 寫入實測數據、不反白、縮圖 640 定案 |
| 2026-10-07 | 帆 Phase 2 第二段回報後：§4 results 註解改為「choosing 不顯示畫廊」；§7 補殼層介面差異、斷點 540、`finish` 插槽；design §2／§3／§4 同步 |
| 2026-10-07 | 帆 Phase 2 第一段回報後補 §7 實作細節：筆跡型別在客戶端、`exportPng` 簽名與底色、`ConnectionStatus` 位置、自動交卷時機 |
| 2026-10-07 | 帆 Phase 1 回報後補定：§4 `RoundPublic.lastTopic`（契約加欄位，與 results 同生命週期）；§5 計數重算、ended 後離開保留結果、欄位生命週期、system 訊息、重複 join 補送 |
| 2026-10-07 | 帆寫協定測試後補定：§5 階段不符的錯誤碼、交卷檢查順序、廣播不合併、題目去空白、畫廊含旁觀者；§8 不新增縮時變數、計時情境改 vitest 縮時測 |
| 2026-10-07 | 帆回報實作後補齊：§4 末段列出 `text.ts` 的 `hasControlChars`、`validateChatText`、`TOPIC_INVALID_MESSAGE`；§1 `chat.ts` 職責改為「錯誤文案與節流」 |
| 2026-10-07 | 帆審閱後修正：§5 judging 結束條件（全員交卷不等寬限）、參賽者全離開→`results = []`、§5.2 未交卷者依 `participantIds` 排序、§1 補 `chat.ts`、`validateTopic` 放 `text.ts` 不複製 `answer.ts` |
