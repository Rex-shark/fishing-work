# 系統架構與事件契約（architecture）

> 本檔是實作的**唯一契約**：模組邊界、技術棧、Socket 事件、資料型別、回合狀態機、驗證方式。
> 產品範圍與遊戲規則見 [overview.md](overview.md)。改本檔需經舵手（Helm）定案。

---

## 1. 模組佈局

```
fishing-work/
├── package.json            # npm workspaces 根：dev / build / start / typecheck / test / lint 一鍵指令
├── tsconfig.base.json      # 三個模組共用的 TS 設定（strict、moduleResolution: bundler、verbatimModuleSyntax）
├── shared/                 # @fishing-work/shared：事件契約 events.ts、constants.ts、純函式 answer.ts / text.ts / nickname.ts
├── server/                 # @fishing-work/server：Node + TypeScript + Socket.IO；提供各遊戲靜態檔
└── draw-guess/             # @fishing-work/draw-guess：React 19 + Vite + TypeScript 客戶端
```

| 模組 | 職責 | 不做什麼 |
|------|------|---------|
| `shared` | 前後端共用的**型別與純邏輯**：`events.ts`、`constants.ts`、`answer.ts` | 不含任何執行期相依（無 socket.io、無 react） |
| `server` | 房間與回合狀態機、筆跡中繼與歷史、猜題裁判、計分、靜態檔服務 | 不存資料庫、不渲染畫面 |
| `draw-guess` | 畫面、輸入、Canvas 渲染、與 server 的 Socket 連線 | 不做遊戲判定（誰猜對、幾分，一律以 server 為準） |

**多款遊戲的預留**：server 以 Socket.IO **namespace** 區分遊戲（`/draw-guess`、日後 `/xxx`），以 URL 路徑提供各客戶端（`/draw-guess/`、`/xxx/`），首頁 `/` 列出遊戲清單。每款遊戲一個客戶端模組。

---

## 2. 技術棧

| 層 | 選型 | 版本 / 備註 |
|----|------|------------|
| 執行環境 | Node.js | ≥ 22.12（Rex 本機 25.8） |
| 套件管理 | npm workspaces | 根目錄一個 lockfile |
| 語言 | TypeScript **`~6.0.3`** | 三個模組皆 `strict: true`，繼承 `tsconfig.base.json`。**不可升 7.x**：typescript-eslint 8.70 要求 `<6.1.0`（2026-09-24 Phase 0 踩雷） |
| 後端 HTTP | Express 5 | 只用來提供靜態檔與 `/healthz` |
| 即時通訊 | Socket.IO 4（server）/ socket.io-client 4（client） | 使用型別化事件（`Server<ClientToServerEvents, ServerToClientEvents>`） |
| 後端開發 / 建置 | `tsx watch`（開發）、`tsup`（建置成單一 `dist/index.js`） | tsup 以 esbuild 打包；`shared` 的 `exports` 指向 `.ts` 原始碼，因此 tsup 必須設 `noExternal: ['@fishing-work/shared']` |
| 前端 | React 19 + Vite 8 + `@vitejs/plugin-react` | 現有 `draw-guess/` 轉 TS |
| 前端狀態 | Zustand | 一個 `useGameStore`；不引入 Redux |
| 前端路由 | 無 | 只有「暱稱頁」與「遊戲頁」兩個畫面，以 store 中是否已加入切換 |
| 樣式 | Tailwind CSS v4 + CSS 變數（主題 token） | 不用元件庫；IDE 外觀為客製版面。最終依 `DESIGN.md` |
| 字型 | 系統等寬字（`ui-monospace, "SF Mono", Menlo, Consolas, monospace`） | 不下載網路字型，區網離線可用 |
| Canvas | 原生 Canvas 2D API | 不用繪圖套件 |
| 測試 | Vitest **`^4.1`**（shared、server 純邏輯；client 純函式） | **不可升 5.x**：其 engines 不含 Node 25（Rex 本機 25.8）。沒有測試檔的 workspace 用 `--passWithNoTests`。UI 由主 session 以瀏覽器實測 |
| Lint | ESLint 10 flat config + typescript-eslint | 沿用 IDEA 產生的設定加 TS |

---

## 3. 執行拓樸

### 開發

```
瀏覽器 ──http://<Rex IP>/draw-guess/（:80）──▶ Vite dev server（draw-guess，綁 :80）
                                              │  proxy /socket.io（ws）
                                              ▼
                                         server（tsx watch，dev script 明確帶 PORT=3000；只當 proxy 目標，同事不直連）
```

- `draw-guess/vite.config.ts`：`base: '/draw-guess/'`、**`server.port: 80`、`server.strictPort: true`**（公司區網只放行標準埠，5173 會被擋；Rex 2026-09-24 實測）、`server.host: true`（區網同事也能連 dev server）、**`server.allowedHosts: ['.trycloudflare.com', '.local']`**（Vite 預設只接受 localhost 與 IP 的 Host 標頭，經 tunnel 或 mDNS 名稱連 dev 會被「Blocked request」擋下；前綴點＝含子網域；具名通道用自有網域時要再加該網域；2026-09-24 Rex 實測發現、龍骨修正）、`server.proxy['/socket.io'] = { target: 'http://localhost:3000', ws: true }`。
- 根目錄 `npm run dev` 同時啟動 server 與 Vite（`concurrently`）。

### 正式（Rex 本機，區網）

```
同事瀏覽器 ──http://<Rex 區網 IP>/draw-guess/（:80）──▶ server（單一 Node 程序）
                                                        ├─ /             → server/public/index.html（遊戲清單）
                                                        ├─ /draw-guess/* → draw-guess/dist（SPA）
                                                        ├─ /socket.io    → Socket.IO
                                                        └─ /healthz      → 200 { ok: true }
```

- 根目錄 `npm run build`（shared → draw-guess → server）後 `npm start`。
- **區網可達（Rex 2026-09-24 明確需求；同日 Rex 以 Phase 1 建置實測區網 IP 可連，server 預設已綁所有介面）**：
  - server 以 `HOST` 環境變數綁定，預設 **`0.0.0.0`**（所有介面），不得綁 `localhost`／`127.0.0.1`。
  - 啟動時列舉本機所有非內部 IPv4（`os.networkInterfaces()`），log 印出可分享的網址，例如 `http://192.168.1.23/draw-guess/`（80 埠不顯示埠號）；找不到任何區網 IP 時 log warn。
  - 客戶端**不設定任何伺服器位址**：正式環境同源，開發環境走 Vite proxy；同事只需要 Rex 分享的網址。
  - Socket.IO 不設 CORS（同源）；Vite dev 綁 80 且 `server.host: true`，同事開 `http://<Rex IP>/draw-guess/` 就是開發版（HMR）；正式與開發不能同時跑（都占 80）。
  - macOS 防火牆：首次啟動會跳「是否允許 node 接受連入連線」→ 允許；若防火牆設為「封鎖所有連入連線」需改掉。驗證方式：另一台裝置開 `http://<Rex IP>/healthz` 回 `{"ok":true}`。
  - IP 會隨 DHCP 變動：建議在公司路由器為 Rex 的機器保留 IP，或改用 `http://<電腦名稱>.local/`（mDNS，macOS 與多數 Windows 10+ 可解析）。
- **外網可達（備用）：Cloudflare Tunnel（Rex 2026-09-24 先補充「區網疑似有問題」，隨後更正區網可連；tunnel 保留為備用管道，不是主要部署方式）**：
  - 用 `cloudflared` 把本機 `:80` 曝露成 HTTPS 網址。**同一個 server 程序同時服務區網與 tunnel，程式不需分支**：所有 URL 都是相對路徑、Socket.IO 同源；WebSocket 經 Cloudflare 可通，不通時 Socket.IO 自動退回 long-polling。
  - 快速通道（不需 Cloudflare 帳號）：`npm run tunnel`（= `cloudflared tunnel --url http://localhost:80`），終端印出 `https://<隨機>.trycloudflare.com`；分享 `https://<隨機>.trycloudflare.com/draw-guess/`。每次重啟網址會變。
  - 具名通道（有託管在 Cloudflare 的網域時，網址固定）：`cloudflared tunnel login` → `tunnel create` → `tunnel route dns` → `tunnel run`；`~/.cloudflared/config.yml` 的 `ingress` 指向 `http://localhost:80`。
  - server 端配合：Express `app.set('trust proxy', true)`；log 的客戶端位址優先取 `CF-Connecting-IP`，其次 `X-Forwarded-For`，最後 socket 位址。
  - 安全邊界：tunnel 網址等於對全網公開，本專案**沒有登入機制**，靠網址不外流。因此加 `MAX_PLAYERS`（50）防止被灌爆記憶體；快速通道的隨機網址難以猜測；要更嚴格再上 Cloudflare Access（Zero Trust 政策，免費方案可用），程式不必改。
  - 安裝：`brew install cloudflared`（Rex 自行）。
  - **tunnel 建議接正式版（`npm run build` → `npm start`）**：Express 沒有 Host 限制。接 dev（Vite）雖已加 `allowedHosts`，但 HMR 的 websocket 經 tunnel 連不上，瀏覽器 console 會報錯，遊戲本身不受影響。
  - 快速通道的新網址要等 DNS 傳播，**啟動後約半分鐘到一分鐘內可能解析不到**（`NXDOMAIN`），稍等再試；同一個 cloudflared 程序持續跑的期間網址不變，本機 server 重啟不需要重開 tunnel。
- Socket.IO server 選項：`maxHttpBufferSize: MAX_IMAGE_BYTES + 65536`（預設 1 MB 會讓傳圖直接斷線；Epic 2）、`pingInterval: 10000`、**`pingTimeout: 30000`**（2026-09-25 由 5000 放寬：ping 封包排在待送的大圖之後，2 MiB/s 的連線收一張 10 MB 就要 5 秒，原設定會誤判斷線；先改 20 秒，壓測 (c) 最壞 19.2 秒只剩 1 秒餘裕，再放到 30 秒作安全邊際。代價是死連線最慢 40 秒才判定，加上 15 秒寬限期，名額與畫師身分最慢 55 秒釋出，仍在 90 秒回合內，v1 接受）。
- 靜態檔規則：`/draw-guess`（無斜線）301 到 `/draw-guess/`；`/draw-guess/` 下**無副檔名**的路徑回 `index.html`（SPA fallback）；**帶副檔名**但找不到的路徑回 404，不做 fallback（避免缺檔的 JS 被當成 HTML）。
- **`PORT` 環境變數預設 `80`**（2026-09-24 Rex：區網非標準埠被擋），`HOST` 預設 `0.0.0.0`。macOS 10.14 起一般使用者即可綁 1024 以下的埠，不需 sudo；Linux 需 `sudo` 或 `setcap`。啟動遇 `EADDRINUSE` 時 log 提示 `lsof -nP -iTCP:80` 查占用者，並提醒「`npm run dev` 與 `npm start` 都占 80，不能同時跑」；遇 `EACCES` 提示改用 `PORT=8080` 或提權。驗證與測試用非 80 埠（e2e 用隨機埠）。
- 查本機區網 IP：`ipconfig getifaddr en0`。
- 不需 HTTPS：Canvas 與 WebSocket 在 http 下皆可用。

---

## 4. Socket 事件契約（namespace `/draw-guess`）

以下型別放在 `shared/src/draw-guess/events.ts`，**前後端直接 import，不各自宣告**。

```ts
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
  | { type: 'clear' };

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
```

### 常數（`shared/src/draw-guess/constants.ts`）

| 常數 | 值 | 說明 |
|------|----|------|
| `ROUND_SECONDS` | 90 | 作畫時間 |
| `CHOOSING_SECONDS` | 60 | 出題期限 |
| `ENDED_SECONDS` | 5 | 揭曉停留 |
| `MIN_PLAYERS` | 2 | 開始回合最少在線人數 |
| `NICKNAME_MAX` | 12 | 暱稱最長（去頭尾空白後） |
| `TOPIC_MAX` | 20 | 題目最長 |
| `CHAT_MAX` | 200 | 聊天訊息最長 |
| `CHAT_HISTORY` | 100 | 快照帶的聊天則數 |
| `CANVAS_LOGICAL` | `{ width: 1280, height: 720 }` | 邏輯畫布尺寸（16:9） |
| `BRUSH_MIN` / `BRUSH_MAX` / `BRUSH_DEFAULT` | 1 / 64 / 4 | 粗細範圍（邏輯像素，整數）與預設值。2026-09-24 Rex 目視回饋：固定四段不夠、要能更粗，改為滑桿拖曳（取代原 `BRUSH_SIZES = [2, 4, 8, 16]`） |
| `PALETTE` | `['#FFFFFF', '#9E9E9E', '#F44747', '#FF8C00', '#FFD700', '#6A9955', '#569CD6', '#C586C0']` | **預設色塊**（快速選色），索引 0 白色為預設，**所有主題一致**；不再是合法色的白名單。2026-09-24 Rex 目視回饋：顏色要能從色相條任選，server 改為接受任意 `#RRGGBB`。（2026-09-25 曾擬加黑色供白底主題，Rex 定案畫布統一黑底後撤回） |
| `CANVAS_BACKGROUND` | `'#1E1E1E'` | **畫布底色，所有主題與所有玩家一致**（畫布內容是共享狀態，底色不同會讓同一筆畫在別人螢幕上看不見）；CSS 由此常數注入，不是主題 token。Rex 2026-09-25：先暫統一黑底、預設白筆 |
| `COLOR_PATTERN` | `/^#[0-9A-Fa-f]{6}$/` | 合法色碼格式；客戶端送出前一律正規化為大寫 6 位 |
| `IMAGE_MIMES` | `['image/png', 'image/jpeg', 'image/gif', 'image/webp']` | 可傳的圖片格式（Epic 2） |
| `MAX_IMAGE_BYTES` | 10 485 760（10 MB） | 單張上限（客戶端縮圖後）；Socket.IO `maxHttpBufferSize` 設為此值 + 64 KiB。2026-09-25 Rex：2 MB 太小，改 10 MB |
| `IMAGE_MAX_EDGE` | 1280 | 客戶端縮圖：長邊上限（GIF／WebP 不重編碼） |
| `IMAGE_MIN_INTERVAL_MS` | 3000 | 每人傳圖最短間隔（與文字訊息各自計時） |
| `IMAGE_SKIP_BUFFER_BYTES` | `2 × MAX_IMAGE_BYTES + 2 MiB`（≈ 22 MiB） | 收件 socket 待送量超過此值就略過這張圖（送 `data: null`）。**推導**：允許兩張在途；最壞積壓 ≈ 門檻 + 一張 = 32 MiB，在設計下限頻寬 2 MiB/s 下 16 秒 < `pingTimeout` 30 秒（餘裕 14 秒），不會斷線；區網正常客戶端幾秒內消化完，三人同時送也不會被略過（2026-09-25 壓測 (c) 發現 2 MiB 門檻會讓正常客戶端也被略過，改此）。放 shared，只有 server 用 |
| `CHAT_MIN_INTERVAL_MS` | 300 | 每人聊天最短間隔 |
| `RECONNECT_GRACE_SECONDS` | 15 | 斷線後保留玩家（分數、畫師身分）的寬限期，逾時才視為離開 |
| `MAX_PLAYERS` | 50 | 房間人數上限（**含寬限期中的玩家**，因為名額與暱稱一樣在寬限期內保留；2026-09-24 定案不排除）；達上限的新玩家回 `ROOM_FULL`，最多等 15 秒逾期釋出。tunnel 對外公開時的記憶體保護 |
| `MAX_POINTS_PER_MOVE` | 64 | 一則 `move` 最多帶的點數；超過整則丟棄 |
| `MAX_OPS_PER_ROUND` | 10000 | 本回合筆跡歷史（正規化後的 begin/move/end）上限；超過丟棄新 op 並 log，`clear` 仍可用 |
| `STROKE_ID_MAX` | 64 | strokeId 長度上限（客戶端用 `crypto.randomUUID()`） |

### 答案判定（`shared/src/draw-guess/answer.ts`）

```ts
export function normalizeAnswer(s: string): string
// 1. Unicode NFKC（全形→半形）  2. 移除所有空白  3. 英文轉小寫
export function isCorrect(guess: string, topic: string): boolean  // normalize 後全等
export function containsSpoiler(text: string, topic: string): boolean // normalize 後 text 包含 topic
// 兩者在 normalizeAnswer(topic) === '' 時一律回 false（避免 ''.includes('') 為 true）。
// 對應地，setTopic 的合法性除了長度 1..TOPIC_MAX，還要求 normalizeAnswer(topic) 非空，否則 TOPIC_INVALID。
```

### 文字長度與合法性（`shared/src/draw-guess/text.ts`）

```ts
export function countChars(s: string): number      // Unicode code point 數：[...s].length；emoji 算 1，不做字形叢集
export function hasControlChars(s: string): boolean // /\p{Cc}/u.test(s)（含換行、tab）
```

| 欄位 | 規則（server 為準，client 可預檢） | 違反時 |
|------|----------------------------------|--------|
| 暱稱 | 去頭尾空白後 1..`NICKNAME_MAX` code points；無控制字元 | `NICKNAME_INVALID` |
| 題目 | 去頭尾空白後 1..`TOPIC_MAX` code points；無控制字元；`normalizeAnswer(topic)` 非空 | `TOPIC_INVALID` |
| 聊天 | 去頭尾空白後 1..`CHAT_MAX` code points；無控制字元（單行） | `MESSAGE_INVALID` |

### 暱稱（`shared/src/draw-guess/nickname.ts`）

```ts
export function validateNickname(raw: string): { ok: true; nickname: string } | { ok: false; error: 'NICKNAME_INVALID'; message: string }
  // 依上表驗證；合法時回傳去頭尾空白後的暱稱
export function nicknameKey(nickname: string): string   // NFKC + toLowerCase：去重比對鍵，Alice / alice / Ａｌｉｃｅ 視為同名
export const NICKNAME_INVALID_MESSAGE: string, NICKNAME_TAKEN_MESSAGE: string   // 繁中錯誤訊息，server ack 直接使用
```

---

## 5. 房間與回合狀態機（server）

單一房間 `main`。`Room` 為**純邏輯類別**（不依賴 socket.io，只以字串 socketId 運作），所有轉移都是方法呼叫並回傳要執行的**效果（Effect）**：`emit`（收件者以 player id 表示：`all` / `except` / `only`，payload 可依收件者產生以遮罩 topic）與 `disconnect`（踢掉舊 socket）；計時器觸發的轉移經注入的 `onAsyncEffects` 回報。**playerId ↔ 目前 socketId 的對應由 `Room` 維護**（重複 join 冪等、被踢舊 socket 的 disconnect 要忽略，都需要在單元測試中驗證），`register.ts` 只做 payload 形狀驗證、呼叫 `Room`、把效果對應到真實 socket。

```
            volunteer(≥MIN_PLAYERS)              setTopic(valid)
  ┌──────┐ ───────────────────────▶ ┌──────────┐ ─────────────────▶ ┌─────────┐
  │ idle │                          │ choosing │                    │ drawing │
  └──────┘ ◀─────────────────────── └──────────┘                    └─────────┘
      ▲      timeout(CHOOSING) /            │                            │
      │      cancel / drawerLeft            │                            │ allGuessed / timeout(ROUND)
      │                                     │                            │ / cancel / drawerLeft
      │            ENDED_SECONDS 後         ▼                            ▼
      └──────────────────────────────── ┌───────┐ ◀───────────────────────┘
                                        │ ended │   揭曉 topic 給所有人
                                        └───────┘
```

| 事件 | 前置條件 | 動作 | 廣播 |
|------|---------|------|------|
| `join`（新玩家） | 無 token、或 token 對不到現存玩家；玩家數（含寬限期中）< `MAX_PLAYERS`（否則 `ROOM_FULL`）；暱稱合法且未被占用（以 `nicknameKey` 比對：NFKC＋小寫，**含寬限期中的玩家**） | 產生穩定 playerId 與 token，建 player（connected=true），system 訊息先入緩衝再取快照，回 `JoinResult` | `players:update`；system 訊息「X 加入」**廣播時排除本人**（本人已在快照中看到） |
| `join`（接管） | token 對到現存玩家（連線中或寬限期內） | 綁定新 socket、connected=true、取消寬限計時；舊 socket 若仍在則強制斷開，且其 disconnect **不得**觸發下方 `disconnect` 邏輯；忽略 payload.nickname；回同一 token 與快照 | 從寬限期回來時 `players:update`；**不發 system 訊息**（2026-09-24 定案：斷線／重連只靠玩家清單的 `connected` 標記呈現，避免 F5 洗版）；同一連線中的接管不廣播 |
| `join`（重複） | 該 socket 已加入 | 冪等：忽略 payload，回同一 token 與目前快照，不改名、不重建 | 無 |
| `disconnect` | socket 是該玩家目前綁定的 socket（否則忽略） | connected=false，啟動 `RECONNECT_GRACE_SECONDS` 計時；**畫師斷線不中止回合**，計時器照走 | `players:update`；**不發 system 訊息**（同上） |
| `leave` | 寬限期到期（或日後的主動離開） | 移除 player；若是畫師：choosing → `abort('drawerLeft')`、drawing → `end('drawerLeft')`。若不是畫師，**依序**判斷：(1) 非畫師人數（含寬限期中）為 0 → choosing 時 `abort('cancelled')`、drawing 時 `end('cancelled')`，訊息用「猜題者都離開了」；(2) 否則 drawing 且剩餘非畫師全猜對 → `end('allGuessed')` | `players:update`、system 訊息「X 離開」 |
| `volunteer` | phase = idle（choosing / drawing / ended 一律 `ROUND_BUSY`）、在線人數（`connected === true`）≥ MIN_PLAYERS（否則 `NOT_ENOUGH_PLAYERS`）、呼叫者已加入 | drawer = 自己，phase = choosing，endsAt = now + 60s | `round:update` |
| `setTopic` | phase = choosing、呼叫者為 drawer、非畫師人數（含寬限期中）≥ 1（否則 `NOT_ENOUGH_PLAYERS`）、題目合法（去頭尾空白後 1..TOPIC_MAX 字，且 `normalizeAnswer(topic)` 非空） | phase = drawing，清空 ops、open stroke 與 correctIds，所有玩家 hasGuessed=false，startedAt/endsAt；`topicLength` = 去頭尾空白後的 code point 數（中間空白算） | `round:update`（畫師含 topic，其餘只含 topicLength）、`draw:op {clear}` 給畫師以外的人（畫師端在 phase 轉為 drawing 時自行清空）、system 訊息「X 開始作畫」 |
| `draw` | phase = drawing、呼叫者為 drawer、op 通過下方「draw:op 驗證」 | 依「筆跡歷史正規化」更新 ops | 合法的 op 原樣轉發給畫師以外的人；不合法者靜默丟棄並 log（不 ack、不斷線） |
| `chat` | 訊息長度 1..CHAT_MAX、間隔 ≥ 300 ms | 見下方判定表 | 依判定 |
| `cancel` | phase ∈ {choosing, drawing}、呼叫者為 drawer | choosing → `abort('cancelled')`；drawing → `end('cancelled')` | 見各列 |
| 計時器到期 | choosing → `abort('cancelled')`；drawing → `end('timeout')` | | 見各列 |
| `abort(reason)`（只在 choosing） | 出題階段被取消、逾時、畫師離開或猜題者走光 | **直接回 idle**（沒有題目可揭曉，不經 ended）：drawer = null、isDrawer 清除、endReason = reason（取消與逾時都是 `cancelled`）、endsAt = null | `round:update`（phase idle）、`players:update`、system 訊息「X 取消出題」／「X 出題逾時」／「畫師 X 離開」／「猜題者都離開了」 |
| `end(reason)`（只在 drawing） | 全員猜對、逾時、取消、畫師離開或猜題者走光 | phase = ended，topic 對所有人可見，`endsAt = null`、`startedAt` 保留，畫師 `+20 × correctIds.length`，關閉 open stroke；`ENDED_SECONDS` 後 phase = idle、drawer = null、isDrawer 與 **hasGuessed 全部清除**、correctIds = []、endReason 保留到下次 volunteer（ops 保留到下次 setTopic） | `round:update`（ended）、`players:update`（分數）、system 訊息 **`題目是 X（原因）`**，原因文字：全員猜對／時間到／畫師取消／畫師離開／猜題者都離開了；5 秒後 `round:update`（idle）＋ `players:update` |

### draw:op 驗證（server；不合法者靜默丟棄並 log）

| op | 通過條件 |
|----|---------|
| 共同 | phase = drawing、送出者為畫師、payload 為物件且 `type` 為已知值；`strokeId` 為 1..`STROKE_ID_MAX` 字元的字串 |
| `begin` | `tool` ∈ {pen, eraser}；`color` 符合 `COLOR_PATTERN`（任意 `#RRGGBB`；橡皮擦也要帶合法色，渲染時忽略）；`size` 為整數且 `BRUSH_MIN` ≤ size ≤ `BRUSH_MAX`；`point` 的 x、y 為有限數且在 0..1；`strokeId` 未在本回合用過 |
| `move` | `strokeId` = 目前 open stroke；`points` 為 1..`MAX_POINTS_PER_MOVE` 個合法點 |
| `end` | `strokeId` = 目前 open stroke |
| `undo` | `strokeId` = 歷史中**最後一筆仍存在的 stroke**（可連續 undo，每次撤剩餘的最後一筆）；若有 open stroke 先視為已 end |
| `clear` | 永遠合法（drawing 階段、畫師） |

- **open stroke**：`begin` 後、`end` 前的那一筆。收到新的 `begin` 時舊的 open stroke 視為已 `end`（指標離開視窗會漏掉 pointerup）。
- 歷史上限：正規化後的 ops 數 ≥ `MAX_OPS_PER_ROUND` 時丟棄新的 `begin`／`move`／`end` 並 log；`undo`／`clear` 仍受理。
- 不做每秒速率限制（區網／tunnel）；上限即保護。

### 筆跡歷史正規化（server 與 client 都照此維護 `ops[]`）

- `ops[]` **只含** `begin` / `move` / `end`；`undo` 會把該 strokeId 的所有 op 從歷史移除，`clear` 清空，兩者本身不存入。
- 因此快照的 `ops` 直接重播即得目前畫面；中途加入者不需要理解 undo。
- 轉發給其他客戶端的仍是原始 op（含 `undo` / `clear`），客戶端收到後對自己的 `ops[]` 做同樣的正規化再重繪。

### 聊天訊息判定（phase = drawing 時）

| 發送者 | 訊息內容 | 結果 |
|--------|---------|------|
| 未猜對的猜題者 | `isCorrect(text, topic)` | 標記 hasGuessed、加分、廣播 `chat:message{kind:'correct', text:'X 猜對了'}`；原文不廣播；若全員猜對 → `end('allGuessed')` |
| 未猜對的猜題者 | 不相符但 `containsSpoiler(text, topic)`（例如題目「蘋果」打「是蘋果嗎」） | **不廣播**，ack `SPOILER_BLOCKED`，message「猜答案請只輸入答案本身」（2026-09-24 定案：寬鬆判成猜對會把「不是蘋果」也算對，不採） |
| 未猜對的猜題者 | 不相符且不含題目 | 廣播 `kind:'chat'` |
| 畫師或已猜對者 | 含題目 | 不廣播，ack `SPOILER_BLOCKED` |
| 畫師或已猜對者 | 不含題目 | 廣播 `kind:'chat'` |

phase ≠ drawing 時所有訊息都是一般聊天。

### 圖片訊息（`chat:image`，Epic 2）

| 檢查順序 | 結果 |
|---------|------|
| 不帶 ack | 忽略並 log warn（與 `player:join` 同；回合事件「無 ack 照常執行」的通則不適用於圖片） |
| payload 形狀（`data` 非 `ArrayBuffer` 或 `Uint8Array`（含 `Buffer`）——其他 TypedArray／DataView 一律拒、欄位缺） | register 回 `IMAGE_INVALID` |
| 未加入 | `NOT_IN_ROOM` |
| 依序：`mime` ∉ `IMAGE_MIMES` → 大小 0 或 > `MAX_IMAGE_BYTES` → magic bytes 與 mime 不符 → 寬高非 1..`IMAGE_DIMENSION_MAX`（4096，server 內部常數）整數 | `IMAGE_INVALID`，`message` 依原因給不同繁中文字（格式不支援／內容與格式不符／太大／寬高不合法／payload 格式錯誤） |
| 距上一張 < `IMAGE_MIN_INTERVAL_MS` | `RATE_LIMITED`（獨立於文字訊息的時間戳；被拒不更新） |
| 傳圖者是畫師且 phase ∈ {choosing, drawing} | `SPOILER_BLOCKED`「作畫中畫師不能傳圖片」（猜題者不擋） |
| 通過 | `ImageMeta.bytes` 由 server 以實際 `data` 長度填入（客戶端不送、不驗）；先 ack `{ id }` 再廣播（與既有事件一致）：推 `ChatMessage{kind:'image', text:'', image: meta}` 入聊天緩衝 → `chat:message` 給所有人 → `chat:image {id, data}` 給所有**在線**者（**含本人**，客戶端不做本地預覽）。**慢連線保護（2026-09-25 壓測定案）**：送出前檢查每個收件 socket 的待送量（engine.io `writeBuffer` 累計 bytes 或底層 ws `bufferedAmount`），超過 `IMAGE_SKIP_BUFFER_BYTES`（≈ 22 MiB，允許兩張在途）者**不送 bytes，改送 `chat:image {id, data: null}`**（一則極小訊息），客戶端顯示「[圖片]（連線較慢，已略過）」；其餘收件者不受影響。待送量 = engine.io `writeBuffer` 內封包位元組 + ws `bufferedAmount`（皆為私有欄位，以執行期形狀檢查讀取，形狀不符視為 0 = 照送）。正常群組與略過群組各一次 emit。**實作要求：`chat:image` 的 payload 必須是固定值（不得用依收件者產生的函式），由 `applyEffects` 以單次 `nsp.to([...socketIds]).emit` 送出，Socket.IO 只編碼一次、二進位附件共用同一個 Buffer**；逐一 emit 會讓每條連線各持一份 10 MB 緩衝，30 人瞬間多出數百 MB。**server 不保存 bytes**：中途加入者的快照只有 meta，客戶端顯示「圖片（中途加入看不到）」 |

- **猜題者範圍**：「全員猜對」與 setTopic 的「無猜題者」都算**在房的非畫師（含寬限期中）**，與「leave 後才移除」一致；斷線者不會永久卡住回合，因為寬限 15 秒後就 leave 並重新判斷。
- **間隔限制**：時間戳只在訊息**真正被接受**（廣播或判定猜對）時更新；被 `RATE_LIMITED`、`SPOILER_BLOCKED`、`MESSAGE_INVALID` 拒絕的都不更新。
- **檢查順序**：payload 形狀（register 回 `MESSAGE_INVALID`）→ `NOT_IN_ROOM` → 文字合法性 `MESSAGE_INVALID` → `RATE_LIMITED` → 判定表。
- **猜對時的廣播**：`chat:message{kind:'correct'}`（`fromId`／`nickname` 為猜對者）＋ `players:update`（hasGuessed、分數）＋ **`round:update`（correctIds 同步；2026-09-24 定案，Phase 4 補發）**。客戶端顯示已猜對進度可用 `hasGuessed` 或 `correctIds`，兩者一致。
- **猜對者公式的回合長度**：用 Room 注入的回合長度（正式 = `ROUND_SECONDS`，e2e 可縮短）；已用秒數 clamp 在 0..回合長度（時鐘異常 → 100 分；逾時在途訊息 → 50 分）。
- **錯誤訊息（ack.message，客戶端直接顯示）**：猜題者部分命中「猜答案請只輸入答案本身」；畫師或已猜對者含題目「訊息含有題目，不會送出（畫師與已猜對者不能透露答案）」；setTopic 無猜題者「沒有猜題者，無法開始作畫」（防呆，正常流程走不到，choosing 猜題者走光已先 abort）。

### 回合操作的錯誤碼與雜項（Phase 2 定案）

| 情境 | 回應 |
|------|------|
| 未加入的 socket 做任何回合操作 | `NOT_IN_ROOM` |
| 人數已達 `MAX_PLAYERS` | `ROOM_FULL`，判斷排在暱稱驗證之前 |
| idle 時 `setTopic`（沒有畫師） | `NOT_DRAWER` |
| 畫師在非 choosing 階段 `setTopic` | `ROUND_BUSY` |
| ended 時 `cancel` | `NOT_DRAWER` |
| 回合事件不帶 ack | 照常執行，只是不回覆（`player:join` 不帶 ack 則忽略，見 §9） |
| `draw:op` 被丟棄 | log 等級 **info**（回合剛結束的在途 op 是正常競態，不是錯誤） |
| `players:update` 時機 | **凡 `PlayerPublic` 任一欄位變動即發**（connected、isDrawer、hasGuessed、score），不限於 join / leave |
| 新 `begin` 自動關閉舊 open stroke | 歷史**不補** `end` op；無效的 `undo` 不影響 open stroke |

### 計分

- 猜對者：`100 − floor(50 × (now − startedAt) / (ROUND_SECONDS × 1000))`，範圍 50..100。
- 畫師：回合結束時 `+20 × correctIds.length`。
- 分數存在 `Room` 記憶體，伺服器重啟歸零。

---

## 6. 畫布模型（client）

- 邏輯尺寸 1280×720，`<canvas>` 的 `width/height` 固定為邏輯尺寸，以 CSS 等比縮放到容器；指標事件座標換算為 0..1 後送出。
- 畫布本身透明，底色由 CSS 背景提供，**值固定為 `CANVAS_BACKGROUND`（#1E1E1E），不隨偽裝主題改變**；預設筆色固定 `PALETTE[0]` 白。原因：畫布是共享狀態，畫師看到的與所有人看到的必須一致（Rex 2026-09-25 定案）。橡皮擦用 `globalCompositeOperation = 'destination-out'`。
- 筆畫：`lineCap = lineJoin = 'round'`；`begin` 落點、`move` 逐點 `lineTo`。
- 客戶端保存完整 `ops[]`；`undo`／`clear`／收到快照時**從 ops 全量重繪**，其餘為增量繪製。
- 畫師本地即時繪製不等 server 回音；server 不回傳畫師自己的 op。
- `move` 以 `requestAnimationFrame` 批次送出（最多 60 次/秒，一則 ≤ `MAX_POINTS_PER_MOVE` 點，超過就拆成多則），LAN 下不另做節流。
- 客戶端送出前把座標 **clamp 到 0..1**（指標拖出畫布時仍能畫到邊緣）、去掉與前一點相同的點；`strokeId` 優先用 `crypto.randomUUID()`，**它只在 secure context（https／localhost）存在，同事以 `http://<IP>` 連線時沒有**，退回「時間 + 序號 + 亂數」（≤ `STROKE_ID_MAX`）。
- 畫師本地即時繪製與送出同在 rAF 批次時發生（最多晚一影格）。
- 進入 drawing 時客戶端自行清空 `ops[]`（server 的 `draw:op {clear}` 只送給畫師以外的人）。
- 本地 `ops[]` 達 `MAX_OPS_PER_ROUND` 時停止送 `begin`／`move`／`end` 並提示，`undo`／`clear` 仍可用。
- 畫師的 `undo` 按鈕送目前歷史最後一筆 stroke 的 id；沒有筆畫時按鈕停用。
- **粗細**：水平滑桿左右拖曳（或點擊），範圍 `BRUSH_MIN..BRUSH_MAX`，即時顯示數值與預覽圓點；送出的 `size` 取整數。
- **顏色**：8 個預設色塊（`PALETTE`）＋**色相條**（0–360° 的彩虹漸層，拖曳或點擊選色，轉成 `hsl(h, 100%, 50%)` 再轉 `#RRGGBB` 大寫）；目前色顯示在工具列上。選色即切回畫筆。

---

## 7. 客戶端結構（`draw-guess/src/`）

```
main.tsx
App.tsx                       # 三分支（Epic 4，純函式 pickScreen）：已加入 → 殼層 screen 'game'；未加入且 resuming（有重連憑證）→ 殼層 screen 'resume'（空白畫面＋「正在重新加入…」）；否則 → home/HomeScreen（不偽裝的首頁）。依畫面同步 <html data-theme>（home 或殼層 id）、title、favicon
pickScreen.ts                 # 純函式 pickScreen({ joined, resuming }) → 'game' | 'resume' | 'home'（獨立成檔：App.tsx 只匯出元件，react-refresh 規則）
socket/client.ts              # 型別化 socket、連線；connect 後以 sessionStorage 的 { nickname, token } 自動 join（接管）；被伺服器踢掉（其他分頁接管）→ 清憑證、回暱稱頁提示、重新連線
store/game.ts                 # Zustand：me、players、round、ops、chat、connection、brush（{ tool, color, size, hue }，跨回合保留，reset 不清，重新整理才重設）
features/
  lobby/ConnectionStatus.tsx  # 連線狀態（殼層插槽）；NicknameScreen 已於 Epic 4 退場（登入改在 home/）
  canvas/Canvas.tsx           # 渲染與指標事件
  canvas/render.ts            # 純函式：ops → canvas（可測）
  canvas/ToolBar.tsx          # 畫師專用：顏色、粗細、橡皮擦、復原、清空、放棄；收合斷點由殼層 toolbar.compactBelowPx 提供（toolbarLayout.ts 純函式）
  chat/ChatPanel.tsx          # 訊息列表 + 輸入（猜題）；整個面板為圖片投放區（Epic 2）；渲染交給殼層 ChatView
  chat/chatLineData.ts        # 訊息 → ChatLineData（kind／nickname／fromId／text／at／time／isMine／reveal／image；parseReveal 拆「題目是 X（原因）」），各殼層自行渲染
  chat/imageUpload.ts         # 純函式：檔案 → 縮圖（長邊 ≤ IMAGE_MAX_EDGE）：PNG 先輸出 PNG（保留透明），超過上限才填白轉 JPEG 0.85；JPEG → JPEG 0.85；GIF／WebP 原樣 → { mime, width, height, data }。本機預檢與 server 同文字；來源檔 > 32 MB 直接拒（避免解碼卡死）；GIF／WebP 寬高 > 4096 本機先擋；投放區外放開不送。sendImage ack 逾時 60 秒（2 Mbps 下 10 MB 約 40 秒）
  chat/ImageMessage.tsx       # 縮圖 240×160、點擊切換面板寬度；沒有圖時依狀態顯示佔位（載入中／已清除／中途加入看不到）
  chat/imageUrls.ts           # Blob URL 管理：最多 20 張，超過 revoke 最舊；store 記錄 id → url 與狀態
  players/PlayerList.tsx      # 玩家、分數、畫師標記、已猜對標記
  round/RoundBar.tsx          # 階段、倒數、題目提示／題目、「我來畫」按鈕；idle 顯示「上一回合：X」直到下次 volunteer；choosing 的取消與逾時統一顯示「回合取消」
  round/countdown.ts          # 倒數以本機時鐘計算（時鐘偏差 v1 接受）；顯示值須 clamp 到該階段長度，避免剛開始顯示 01:01
  round/TopicDialog.tsx       # 畫師出題
shells/index.ts               # 偽裝主題註冊表（Epic 3）：SHELLS、DEFAULT_SHELL_ID、resolveShellId（未知或未註冊 id 回退 vscode 但不覆寫存檔）、getShell；定義 { id, name, description, icon, Shell, titleFor, faviconHref }（description：首頁卡片一行描述，Epic 4）。畫布底色與預設筆色不屬於主題
shells/types.ts               # ShellProps 插槽：players、canvas、toolbar、chat、roundStatus、volunteer、connection、round: { phase, isDrawer, canDraw }、themes（ShellThemeSwitch：目前主題、選項 ShellThemeOption[]、切換）；自動重連畫面為 { screen: 'resume', notice, connection }（Epic 4：登入改在首頁，殼層不再有輸入框與卡片）；ShellTitleState 供 titleFor。resume 變體的 notice 為 string（App 給「正在重新加入…」）。DialogProps 自 Epic 4 起無 footer（DialogPurpose 也無 'join'）；QuickInput 無 footer、initialActive 保留（ManageMenu 用）。殼層不 import uiStore／catalog，主題資料一律由 App 經 ShellProps.themes 注入（避免循環）
shells/catalog.ts             # THEME_CATALOG = buildThemeCatalog(SHELLS, PLANNED_THEMES)：已註冊者 available:true；已規劃未註冊者（目前 ppt）available:false 顯示「即將推出」不可選；註冊後自動取代，元件不必改
shells/themeIcons.tsx         # 自繪圖示：程式編輯器（角括號，--brand-editor）、簡報（投影片方塊，--brand-slides）；不用商標
shells/vscode/ManageMenu.tsx  # 活動列齒輪選單（aria-haspopup=menu），目前只有「切換偽裝…」→ themePick.ts 的 ThemeQuickPick（快速選單列出主題，目前使用／即將推出）；登入畫面的齒輪仍為裝飾
shells/views.ts               # ShellViewsContext：殼層提供 Dialog（join／topic／cancelRound）、PlayerList、選填的 chat（ChatView：panelClassName／listClassName／Line／Composer；資料為 ChatLineData）、toolbar（compactBelowPx，預設 1100，ppt 640）、status（buttonClassName）、volunteer `{ label, icon? }`（預設「▷ 我來畫」，ppt「從目前投影片開始」＋放映圖示，無障礙名稱不變）；未提供者用 shells/vscode/viewDefaults。ShellProps.counts `{ online, total }` 由 App 注入給殼層狀態列（殼層不得 import store/game，shellBoundary 把關）
shells/document.ts            # applyDocumentTheme(doc, theme, state)：DocumentTheme＝殼層 ShellDefinition 或 HOME_DOCUMENT（id 'home'、title「fishing-work」、favicon.svg）；initialDocumentTheme(hasSavedSession, shell) 給 main.tsx 首次繪製前用。同步<html data-theme>（'home' 或殼層 id）、document.title（首頁「fishing-work」；殼層 titleFor）、favicon（首頁 favicon.svg；殼層 faviconHref）。main.tsx 第一次繪製前依 hasSavedSession() 決定首次值（Epic 4）
shells/vscode/                # VscodeShell（活動列｜側欄｜編輯區｜底部面板｜狀態列，原 layout/IdeShell）、ShellFrame、StatusBar、EditorTabs、QuickInput（VscodeDialog；Epic 4 起無 footer）、QuickInputNotice（resume 畫面：快速輸入框只有一行 `// 正在重新加入…`，role=status）、ExplorerPlayers、ideLayout、definition、TerminalChat＋terminalFormat（終端機聊天 ChatView：`// `、`❯`、`[HH:mm]`）、viewDefaults（預設 ChatView／ToolbarView／StatusView＝vscode 樣式）；殼層以 data-chat-drop-zone 標出聊天投放區，ChatPanel 找最近祖先並 portal 覆蓋層
shells/ppt/                   # definition、PptShell（橘紅標題列｜11 個功能區分頁｜左縮圖窗格｜灰工作區＋黑投影片｜備忘稿列｜右註解窗格｜淺灰狀態列；< 1024px 縮圖窗格改覆蓋層）、PptDialog（確定／取消、Enter／Esc；Epic 4 起無 footer）、PptResumeDialog（resume 畫面：標題「加入簡報」＋一行「正在重新加入…」，role=status）、SlidePlayers（玩家＝編號縮圖卡）、FileMenu（「檔案」分頁選單：切換偽裝…）、pptIcons、pptLayout
shells/ppt/PptShell.tsx       # 標題列｜功能區｜左縮圖窗格｜中央投影片｜右註解窗格｜備忘稿列｜狀態列（PowerPoint 偽裝）
layout/uiStore.ts             # 含 shellId（localStorage、try/catch，本機偏好，不進 server；setShellId 對未註冊或相同 id 不動作、不寫入，預存的未註冊 id 不覆寫；分頁之間不同步、不監聽 storage 事件）、nicknameDraft（換主題時保留暱稱草稿）；import 註冊表（layout 依賴 shells，無循環）
layout/themeCardNav.ts        # 風格卡片鍵盤導覽純函式（roving tabindex、←/→ 跳過不可選、Home/End）；layout/ThemeCards.tsx（IDE 樣式卡片）已於 Epic 4 退場
home/HomeScreen.tsx           # 首頁（Epic 4，不偽裝、柔和 UI，DESIGN §14）：標題、暱稱（join／rememberedNickname／nicknameDraft、字數、錯誤）、風格卡片、「進入遊戲」、連線狀態一行、頁尾。可 import shells/catalog、shells/types、layout/uiStore、layout/themeCardNav、socket/client、store/game；不得 import shells/vscode、shells/ppt、shells/views（首頁在殼層之外）。連線狀態文字：connected「已連線」、connecting「正在連線到伺服器…」、disconnected「連線中斷，重新連線中…」（DESIGN §14.3）
home/homeLabels.ts            # 首頁文案（連線狀態三種文字等）純資料／函式，供測試
home/HomeThemeCards.tsx       # 首頁風格卡片（radiogroup／radio、roving tabindex、Enter＝進入遊戲）：圖示＋名稱＋描述（來自註冊表）、選取打勾徽章、不可選「即將推出」膠囊；點卡片只寫 uiStore.shellId，首頁外觀不隨之改變
test/shellBoundary.test.ts    # 原始碼掃描：功能元件不得含偽裝字樣、不得 import 特定殼層（Epic 3 Phase 1 起把關）
styles/theme.css              # CSS 變數：:root 為 vscode；[data-theme="ppt"] 覆寫同名 token；[data-theme="home"] 為首頁的獨立命名空間 --home-*（不重用殼層 token，DESIGN §14.2）；值依 DESIGN.md §3 與 §13。--bg-canvas 不在此檔：由 main.tsx 啟動時以 inline style 把 CANVAS_BACKGROUND 注入 <html>
```

### 偽裝殼層（Epic 3 起為多主題）

功能元件（Canvas、ToolBar、ChatPanel、PlayerList、RoundStatus、對話框邏輯）不含偽裝假設，透過 `ShellProps` 插槽放進各主題的 `Shell`。主題是每位玩家的本機偏好，契約與 server 完全不變。各主題版面對照見 DESIGN.md（vscode §5、ppt §13）。

**首頁不屬於殼層**（Epic 4，Rex 2026-09-25 需求修正）：未加入且沒有重連憑證時顯示 `home/HomeScreen`（柔和 UI、不偽裝，DESIGN §14），在那裡輸入暱稱、以卡片選風格；加入成功才進殼層。有憑證時（遊戲中重新整理）直接顯示所選殼層的 `resume` 畫面自動重連，不經首頁。

### IDE 偽裝殼層對照（vscode 主題）

> 尺寸、色彩 token、聊天格式、元件規範以根目錄 [DESIGN.md](../DESIGN.md) 為準；此表只定義「什麼資料放在哪個區塊」。

| IDE 元素 | 實際內容 |
|----------|---------|
| 活動列（最左） | 兩三個圖示，純裝飾或切換側欄 |
| 側欄「EXPLORER」 | 玩家清單，玩家名偽裝成檔名，分數偽裝成行數 |
| 編輯區分頁 | 畫布，分頁名如 `canvas.ts`；畫師工具列偽裝成編輯器工具列 |
| 底部面板「TERMINAL」 | 聊天室；輸入列偽裝成命令提示 |
| 狀態列 | 左：連線狀態；中：回合階段與倒數；右：`Ln 12, Col 4  UTF-8  TypeScript` 之類的裝飾 |

---

## 8. 伺服器結構（`server/src/`）

```
index.ts                      # 讀環境變數（PORT、HOST）→ createApp → listen；印出區網分享網址；SIGINT/SIGTERM 優雅關閉
app.ts                        # createApp 工廠：Express（trust proxy）+ http + Socket.IO + 各遊戲 namespace；e2e 以隨機埠與短計時呼叫
static.ts                     # /、/draw-guess/（SPA fallback，規則見 §3）、/healthz
games/draw-guess/
  register.ts                 # namespace 事件接線（薄）：payload 形狀驗證 → Room → ack 與效果
  room.ts                     # Room 狀態機（純邏輯，含計時器抽象以便測試）
  drawOp.ts                   # draw:op 無狀態形狀驗證（有狀態檢查在 Room.draw）
  topic.ts                    # 題目驗證
  chat.ts                     # 聊天文字驗證與錯誤訊息
  image.ts                    # 圖片驗證（mime 清單、magic bytes、大小、寬高）與錯誤訊息（Epic 2；magic bytes 判定的純函式放 shared/image.ts）
  slowLink.ts                 # 慢連線判定純函式：待送量計算與略過決策（Epic 2）；AppOptions.ping／pendingBytesOf 為測試注入點（比照 durations）
  scoring.ts                  # 計分純函式（畫師 +20×猜對人數、猜對者 100−floor(50×elapsed/roundMs)）
lib/log.ts                    # 簡單結構化 log（時間、事件、玩家）
lib/network.ts                # 區網 IPv4 列舉、分享網址、log 用客戶端位址（CF-Connecting-IP → X-Forwarded-For → socket）
public/index.html             # 首頁：遊戲清單
test/                         # Vitest：room、room.round、scoring、network、e2e/（起隨機埠 server + socket.io-client）、helpers/fakeClock（answer / text / nickname 的測試在 shared/test/）
```

---

## 9. 錯誤處理與邊界

- 所有需要回應的事件都用 **ack** 回 `Ack<T>`；`message` 為繁體中文，客戶端直接顯示。
- 非畫師送 `draw:op`、非 drawing 階段送 `draw:op`：靜默丟棄並記 log。
- 暱稱：去頭尾空白後 1..12 字；不分大小寫比對重複；重複回 `NICKNAME_TAKEN`。
- 斷線重連：客戶端用 sessionStorage 存 `{ nickname, token }`，`connect` 後自動重送 `player:join` 帶 token。寬限期內（含 F5 重新整理）接管原玩家，分數與畫師身分保留；逾期則 token 失效，server 當新玩家處理（暱稱若仍空著就用同名，分數歸零）。自動重加入失敗（`NICKNAME_TAKEN` 等）**不做退避重試**：清除 sessionStorage，回暱稱頁顯示錯誤。
- 玩家 id 是 server 產生的穩定 id，**不是** socket.id；`Room` 維護 playerId ↔ 目前 socketId 的對應。
- 斷線期間客戶端**保留 `me` 與遊戲畫面**，只把連線狀態顯示為「重新連線中」；自動重加入失敗才清憑證回暱稱頁。
- 被接管的分頁（例如瀏覽器「複製分頁」會複製 sessionStorage）收到 `io server disconnect` → 清憑證、回暱稱頁提示「此暱稱已在其他分頁或連線重新加入」、重新連線。
- 防禦性限制：`player:join` payload 不是物件 → `NICKNAME_INVALID`；`nickname` 非字串視為空字串；`token` 非字串或長度 > 64 視為未帶；不帶 ack 的 join 直接忽略並 log warn。
- 伺服器不信任客戶端的任何判定（分數、猜對、畫師身分）。
- **二進位 payload 必須複製成獨立的 `ArrayBuffer` 再轉發**（`new Uint8Array(view).buffer`）：Socket.IO 在 server 還原的二進位是整個 WebSocket frame 的切片（實測 `byteOffset` 122），而 Node 的 `Buffer#slice` 不複製、等同 `subarray`，直接取 `.buffer` 會把整個 frame 送出去（2026-09-25 Epic 2 踩雷，B 收到 191 bytes 而非 69；只有 e2e 抓得到，已有單元測試）。

---

## 10. 驗證方式（派工與驗收共用）

每條指令**分開跑、各自檢查 exit code**，不可用 `cmd | tail && echo 通過`。

| 指令（根目錄） | 通過條件 |
|---------------|---------|
| `npm run typecheck` | 三個 workspace 皆 `tsc --noEmit` 為 0 |
| `npm run lint` | ESLint 為 0（目前只涵蓋 `draw-guess`；server / shared 加 ESLint 列在 improvements） |
| `npm test` | Vitest 全綠（shared、server 至少涵蓋 room 狀態機、answer、scoring） |
| `npm run build` | 產出 `draw-guess/dist/` 與 `server/dist/index.js` |
| `HOST=127.0.0.1 PORT=3190 npm start` + `curl -s 127.0.0.1:3190/healthz` | 驗證時用**隔離埠且只綁本機**（避開 80，也避免桌面 app 的瀏覽器窗格自動重連 3000 把舊分頁帶進來）；回 `{"ok":true}`；`curl -sI 127.0.0.1:3190/draw-guess/` 回 200 |
| `user/protocol/draw-guess-phase*.mjs`、`draw-guess-load.mjs` | 協定測試全 PASS；30 人壓測不掉訊息、快照與本地 ops 一致、op 延遲 p95 < 100 ms（loopback 數字僅供回歸，真實區網以 `user/lan-test-checklist.md` 實機為準）、50 人可入、第 51 人 `ROOM_FULL` |
| 瀏覽器 | 兩個分頁以不同暱稱加入，一方畫、另一方即時看到；猜對顯示「猜對了」；中途開第三個分頁能看到現有筆跡 |

長跑指令（`npm run dev`、`npm start`）**不得在前景執行**。

---

## 11. 尚未定案

（無。模組佈局 2026-09-24 經 Rex 確認；`DESIGN.md` 同日由舵手建立，Rex 看成品後微調。）

---

## 12. 變更紀錄

| 日期 | 變更 | 原因 |
|------|------|------|
| 2026-09-25 | **Epic 4 首頁**：§7 新增 `home/`（HomeScreen、HomeThemeCards）、App 三分支 `pickScreen`、`ShellProps` 的 `login` 改 `resume`、註冊表加 `description`、document.ts 泛化（home）、theme.css `[data-theme="home"]`；NicknameScreen 與 layout/ThemeCards 退場。契約與 server 不變 | Rex 2026-09-25 需求修正：首頁不是預設 VS Code，是柔和 UI 首頁以卡片選風格 |
| 2026-09-24 | 初版定案（Rex 拍板 Node） | — |
| 2026-09-24 | §2 版本鎖定、§3 靜態檔規則、§4 空字串規則、§8 測試位置、§10 lint（Phase 0 驗收） | 龍骨 Phase 0 提問 |
| 2026-09-24 | §3 **區網可達**：`HOST` 預設 0.0.0.0、啟動印區網網址、防火牆與 DHCP 說明 | Rex 補充需求「要設定區網 IP 能夠連」 |
| 2026-09-25 | Epic 3 Phase 3 同步：§7 shells/ppt/*、views.ts 的 chat／toolbar／status／volunteer 介面與 viewDefaults、TerminalChat、chatLineData、toolbarLayout、ShellProps.counts | 龍骨 Phase 3 回報 |
| 2026-09-25 | Epic 3 Phase 2 驗收定案：§7 ShellProps.themes、DialogProps.footer、QuickInput initialActive／footer、catalog.ts、themeIcons.tsx、ManageMenu／themePick、ThemeCards／themeCardNav、uiStore.setShellId 語意與 nicknameDraft | 龍骨 Phase 2 提問 1–7 |
| 2026-09-25 | Epic 3 Phase 1 驗收定案：§7 ShellProps 實際插槽（volunteer、connection、round、login）、ShellViewsContext、shells/document.ts、data-chat-drop-zone、shellBoundary 測試、--bg-canvas 由 main.tsx 注入 | 龍骨 Phase 1 提問 1–6 |
| 2026-09-25 | **畫布統一**：§4 新增 `CANVAS_BACKGROUND`（#1E1E1E，所有主題一致）、`PALETTE` 撤回黑色；§6 畫布底色與預設筆色不隨主題 | Rex 2026-09-25：「畫布預設主題不同的確是個問題，先暫統一黑底、預設白筆」 |
| 2026-09-25 | **Epic 3 多偽裝主題**：§7 `shells/` 註冊表、vscode／ppt 殼層、`uiStore.shellId`、`theme.css` 以 `data-theme` 覆寫 | Rex 2026-09-25：登入畫面卡片選偽裝主題、新增 PPT 主題 |
| 2026-09-25 | `pingTimeout` 20 → 30 秒（壓測最壞 19.2 秒只剩 1 秒餘裕） | Epic 2 最終驗收定案 |
| 2026-09-25 | 慢連線門檻改為 `2 × MAX_IMAGE_BYTES + 2 MiB`（推導自 pingTimeout 與 2 MiB/s 設計下限）；§8 `slowLink.ts` | 龍骨壓測 (c)：三人同時送時 2 MiB 門檻讓正常客戶端也被略過 |
| 2026-09-25 | Epic 2 壓測定案：§4 `ImagePayload.data` 允許 `null`（略過）、`IMAGE_SKIP_BUFFER_BYTES`；§5 慢連線保護；§3 `pingTimeout` 5 → 20 秒 | 龍骨壓測：2 MiB/s 客戶端每 3 秒收一張 10 MB 在 14 秒被 ping timeout 斷線 |
| 2026-09-25 | Epic 2 客戶端定案：§7 imageUrls.ts、本機預檢與 32 MB 來源上限、60 秒逾時；DESIGN §5 三種佔位 | 龍骨提問 1–7 |
| 2026-09-25 | §5 `chat:image` 單次 emit 實作要求（10 MB × 30 人的記憶體風險） | 龍骨提醒 |
| 2026-09-25 | Epic 2 Phase 1 定案：刪除「meta.bytes 須等於實際長度」（payload 本無此欄，改由 server 填入）；圖片無 ack 忽略；`data` 型別範圍；`IMAGE_DIMENSION_MAX`；`IMAGE_INVALID` 分原因訊息與檢查順序；先 ack 再廣播；§9 二進位切片踩雷 | 龍骨 Epic 2 提問 |
| 2026-09-25 | `MAX_IMAGE_BYTES` 2 MB → 10 MB（§4 常數、§3 `maxHttpBufferSize` 隨之） | Rex：「2M 太小 改 10M」 |
| 2026-09-25 | Epic 2 派工定案：透明 PNG 先保留 PNG、超限才填白轉 JPEG；`meta.bytes` 須等於實際長度；`chat:image` 含本人、不做本地預覽 | 龍骨 Epic 2 提問 1–2 |
| 2026-09-25 | **Epic 2 聊天室圖片**：§4 `ChatKind` 加 `image`、`ImageMeta`／`ImageMime`／`ImagePayload`、`chat:image` 兩向事件、`IMAGE_INVALID`、四個常數；§5 圖片訊息檢查表（畫師作畫中不能傳圖）；§3 `maxHttpBufferSize`；§7／§8 檔案 | Rex 2026-09-25：聊天室要能拖曳上傳圖片、大家都看到、不保留、簡單優先 |
| 2026-09-24 | 部署實測：§3 Vite `allowedHosts`（tunnel／mDNS 名稱連 dev 被擋）、tunnel 建議接正式版與 HMR 限制、快速通道 DNS 傳播延遲 | Rex 實測 tunnel 回報「Blocked request」；龍骨修正 |
| 2026-09-24 | Phase 6 驗收定案：§4 `BRUSH_DEFAULT`；§7 store 的 brush 狀態跨回合保留 | 龍骨 Phase 6 提問 1、9 |
| 2026-09-24 | Phase 5 定案：§10 驗證改隔離埠＋`HOST=127.0.0.1`、加入協定測試與壓測列；§4 `MAX_PLAYERS` 含寬限期中玩家維持不變 | 龍骨 Phase 5 提問 1–2 |
| 2026-09-24 | **Rex 目視回饋（Epic 1 Phase 6）**：§4 `BRUSH_SIZES` → `BRUSH_MIN`/`BRUSH_MAX`（1..64，滑桿）、`PALETTE` 降為預設色塊、新增 `COLOR_PATTERN`、`begin` 註解；§5 `begin` 驗證改任意 `#RRGGBB` 與整數粗細範圍；§6 滑桿與色相條 | Rex 2026-09-24：粗細改左右拖曳且要更粗、顏色改七彩色相可選、圖示懸停顯示功能 |
| 2026-09-24 | Phase 3 驗收定案：§4 correct 訊息的 fromId 為猜對者；§5 時間戳更新規則、檢查順序、猜對時加發 `round:update`（Phase 4 補）、公式回合長度、錯誤訊息全文；§8 `chat.ts`；§3 EADDRINUSE 提示 | 龍骨 Phase 3 提問 1–16 |
| 2026-09-24 | Phase 3 派工定案：§5 猜題者訊息含題目但不相符 → `SPOILER_BLOCKED` 不廣播（堵洩題漏洞）；猜題者範圍含寬限期中；`RATE_LIMITED` 不更新時間戳；§3 dev script 帶 `PORT=3000` | 龍骨 Phase 3 提問 1–4 |
| 2026-09-24 | **埠改 80**：§3 `PORT` 預設 80、Vite dev 綁 80、tunnel 指向 80、所有分享網址去掉埠號、§10 驗證用非 80 埠 | Rex 更正：「區網似乎用 5173 會被擋住，你要改成 80」 |
| 2026-09-24 | Phase 2 驗收定案：§5 leave 判斷順序與「猜題者都離開了」、揭曉訊息格式、`abort`／`end` 欄位細節、idle 時清 hasGuessed、setTopic 需有猜題者、topicLength 定義、錯誤碼與雜項表；§6 strokeId 退路、客戶端清空與上限；§7 RoundBar／countdown；§8 新增 app.ts / drawOp.ts / topic.ts / network.ts / e2e | 龍骨 Phase 2 提問 1–22 |
| 2026-09-24 | **外網可達（Cloudflare Tunnel，備用）**：§3 新增 tunnel 章節（快速／具名通道、trust proxy、安全邊界）；§4 `MAX_PLAYERS` 與 `ROOM_FULL`；§5 join 人數上限 | Rex 補充：「區網好像有問題，新增 cloudflared tunnel 也要可以連」；隨後更正區網實測可連，tunnel 降為備用 |
| 2026-09-24 | Phase 2 派工前補強：§4 常數 `MAX_POINTS_PER_MOVE` / `MAX_OPS_PER_ROUND` / `STROKE_ID_MAX`；§5 新增「draw:op 驗證」「筆跡歷史正規化」、`abort`（choosing 直接回 idle）與 `end` 語意分開、volunteer 錯誤碼；§6 客戶端 clamp 與 undo 行為 | 龍骨 Phase 2 派工時預告的疑義，先定案 |
| 2026-09-24 | Phase 1 驗收定案：§4 `nickname.ts`（`nicknameKey` NFKC＋小寫去重）、§5 Room 持有 socket 對應與 Effect 模式、加入訊息排除本人、**斷線／重連不發 system 訊息**、§7 客戶端接管註解、§9 被接管分頁與防禦性限制 | 龍骨 Phase 1 提問 1–8 |
| 2026-09-24 | **重連機制**：玩家 id 改為穩定 id、`player:join` 加 `token`、回傳 `JoinResult`、`PlayerPublic.connected`、`RECONNECT_GRACE_SECONDS`、§5 新增接管 / 重複 / disconnect 列、§3 ping 設定；**文字規則**：`text.ts` code point 計數與控制字元禁令；**重複 join** 冪等 | 龍骨 Phase 1 提問：socket.io 重連時舊 socket 未逾時會撞 `NICKNAME_TAKEN`；退避重試治標，接管治本，且順帶保住 F5 後的分數與畫師身分 |
