# CLAUDE.md

本檔提供 Claude Code 在此 repo 工作時的核心指引。**主檔保持精簡**，只放本專案特有的資訊；跨專案通用的工作規則（計畫驅動、狀態符號、plan／spec／user 目錄慣例、agent 撰寫原則）定義在全域 skill `project-structure`（`~/.claude/skills/project-structure/SKILL.md`），其鋪設到本專案的版本為 [plan/README.md](plan/README.md)，不在此重複。Git 不自動 commit，由 Rex 自行 commit。

## 語言規則

所有回覆與計劃制定一律使用**繁體中文（台灣用語）**。
專有名詞優先使用台灣慣用譯名（套件、函式、陣列、字串、相依性、部署）；技術指令、API、CLI、IDE 等保持原文。

---

## 專案簡介

**fishing-work** 是一個**簡易互動遊戲平台**：部署在 Rex 本機，同事透過公司區網進來玩。
第一款遊戲為**我畫你猜（draw-guess）**：首頁輸入暱稱即可加入，不需帳號；自願玩家當畫師、自訂題目後在畫布作畫，其他人即時看畫猜題。

特殊需求：首頁為不偽裝的柔和紙張質感 UI（輸入暱稱、以卡片選介面風格，各人本機偏好），選好才進偽裝殼層：程式編輯器（VS Code 深色）、PowerPoint、Google Meet 視訊會議或 Excel 試算表，上班偷玩不被發現；有聊天室（可拖曳傳圖，不保留）；畫師自訂題目；畫布預設黑底白筆不隨主題，畫師可換背景色並同步給所有人。

目前狀態（2026-09-29）：Epic 1「我畫你猜 MVP」、Epic 2「聊天室圖片」、Epic 3「多偽裝主題（vscode／ppt）」、Epic 4「首頁（柔和 UI 選介面風格）」**全部完成**：工程、舵手驗收、Rex 目視與實機（區網、拖圖）皆通過。Epic 5「視訊會議偽裝主題（Google Meet 風格）」（`plan/meet-theme.md`）、Epic 6「遊戲說明」（`plan/help-topics.md`）、Epic 7「畫布背景色與新色塊」（`plan/canvas-background.md`）**全部完成**（舵手驗收、Rex 目視 2026-09-29 通過）。Epic 8「語音輸入」⏸ 暫緩（區網 http 無法用麥克風）。Epic 9「Docker 部署」工程完成、驗收子代理驗收通過（`plan/docker-deploy.md`），待 Rex 在新電腦實機部署。Epic 10「首頁紙張質感」Rex 採用、驗收子代理驗收通過（2026-10-07，`plan/home-paper.md`，DESIGN §14）。Epic 11「顏色面板」（取代工具列色相條，`plan/color-picker.md`）、Epic 12「作畫時間改 2 分鐘」（`ROUND_SECONDS` 120，`plan/round-time.md`）、Epic 13「試算表偽裝主題（Excel）」（`plan/excel-theme.md`、DESIGN §17）**全部完成**：驗收子代理驗收通過、Rex 目視通過（2026-10-07）。**Epic 14「繪圖比賽 MVP」**（第二款遊戲 `draw-contest/`，羅盤 × 帆；`plan/draw-contest-mvp.md`、`spec/draw-contest/`）**完成**（2026-10-09）：驗收子代理三次驗收通過、Rex 真模型目視與區網實機通過；評分器預設 `JUDGE=ollama`（Clef 決策模型，本機 Ollama；連不上自動退回隨機）。**Epic 15「繪圖比賽 AI 評語（メスガキ）」**（`plan/contest-commentary.md`）**完成**（2026-10-12）：gemma4 經 Ollama 產一句評語放揭曉卡片、第一名稱讚版、Clef 原圖直送不縮圖；兩次驗收通過、Rex 實戰目視通過。**Epic 16「猜歌 MVP」**（第三款遊戲 `song-guess/`，Meet 偽裝；`plan/song-guess-mvp.md`、`spec/song-guess/`）**完成**（2026-10-12）：出題者填歌手、server 從 Apple iTunes Search API（免金鑰）抽 5 首 30 秒試聽、各客戶端同步播、聊天室打字猜歌名；驗收通過、Rex 實機通過。進度見 [plan/backlog.md](plan/backlog.md)。

---

## 目錄結構

```
fishing-work/
├── CLAUDE.md
├── DESIGN.md               # 視覺設計指南：Dark+ 色彩 token、IDE 殼層尺寸、元件規範（做畫面前必讀）
├── draw-guess/             # 我畫你猜客戶端：React 19 + Vite + TypeScript + Tailwind v4
├── draw-contest/           # 繪圖比賽客戶端（Epic 14，獨立前端、簡報偽裝）：React 19 + Vite + TypeScript + Tailwind v4
├── song-guess/             # 猜歌客戶端（Epic 16，獨立前端、Meet 偽裝）：React 19 + Vite + TypeScript + Tailwind v4；iTunes 試聽、聊天室猜歌名
├── server/                 # Node + TypeScript + Socket.IO：房間、回合、筆跡中繼、猜題裁判，並提供各遊戲靜態檔
├── shared/                 # 前後端共用的事件契約、常數、純函式（answer / text / nickname）
├── tsconfig.base.json      # 五個 workspace 共用 TS 設定
├── Dockerfile              # 多階段映像（node:24-slim、非 root、healthcheck），Epic 9
├── docker-compose.yml      # 換電腦部署：docker compose up -d --build（HOST_PORT、PUBLIC_URL 可寫在 .env）
├── .dockerignore
├── plan/                   # 開發計畫（動態）：backlog 索引、各 Epic 詳細計畫、踩雷紀錄
├── spec/                   # 規範文件（穩定）：overview.md 產品與規則、architecture.md 架構與事件契約
├── user/
│   ├── mock/               # 假 Ollama（systemone.mjs）、假 iTunes（itunes.mjs）：協定測試與離線開發用
│   ├── protocol/           # 協定測試（只依 spec 打 Socket；每檔用全新 server、隔離埠）
│   ├── http/               # IDEA HTTP Client 測試集合（本專案以 WebSocket 為主，視需要使用）
│   └── sql/                # 手動 SQL（本專案無資料庫，暫不使用）
└── .claude/
    ├── launch.json         # 內建瀏覽器預覽設定（draw-guess-built：PORT=3181 跑建置版，驗收用）
    ├── skills/ui-ux-pro-max/  # UI/UX 設計指引資料庫（風格、配色、字型、UX 準則）
    └── team/ROSTER.md      # session 分工名冊（身分由 hook 注入，不寫在本檔）
```

---

## 技術棧

| 層 | 選型 | 狀態 |
|----|------|------|
| 後端 | Node.js + TypeScript `~6.0` + Express 5 + Socket.IO 4；`tsx` 開發、`tsup` 打包 | `server/` 已建立 |
| 前端 | React 19 + Vite 8 + TypeScript + Tailwind v4 + Zustand + ESLint 10 | `draw-guess/` 已轉 TypeScript |
| 共用型別 | TypeScript，`shared/`（事件契約、常數、純函式；無執行期相依） | 已建立 |
| 測試 | Vitest `^4`（不可升 5，Node 25 不支援） | shared / server 純邏輯 |
| 資料庫 | 無，狀態全在伺服器記憶體 | 日後要戰績或題庫再評估 SQLite |
| 部署 | 單一 Node 程序：本機直接跑，或 Docker 容器（換電腦用，Epic 9）；同事以區網 IP 連線 | 不需 HTTPS、雲端 |

---

## 開發指令

一律在**專案根目錄**執行（npm workspaces）：

```bash
npm install                 # 安裝五個 workspace 的相依（shared、server、draw-guess、draw-contest、song-guess）
npm run dev                 # 一次啟動 server（:5173，只當 proxy 目標）、我畫你猜 Vite（:80）、繪圖比賽 Vite（:5174）、猜歌 Vite（:5175），並自動開瀏覽器到 http://localhost/（遊戲清單；三款遊戲都是 HMR）
npm run build               # 建置 draw-guess/dist/ 與 server/dist/index.js
npm start                   # 正式：node server/dist/index.js（PORT 預設 80、HOST 預設 0.0.0.0；公司區網只放行標準埠）
npm run typecheck           # 五個 workspace 的 tsc --noEmit
npm test                    # Vitest（shared、server）
npm run lint                # ESLint（三個客戶端：draw-guess、draw-contest、song-guess；server／shared 無 lint，見 improvements）
npm run tunnel              # Cloudflare 快速通道（需先 brew install cloudflared），指向 :80，印出 https://xxx.trycloudflare.com
docker compose up -d --build   # Docker 部署（Epic 9，換電腦用）：建置映像並在背景啟動，:80；停止用 docker compose down
```

> `npm run dev`、`npm start` 是長跑指令，**不要在前景執行**（會卡住 session）。驗證指令要分開跑、各自看 exit code。

### 區網分享（同事連線）

`npm start` 後 log 會印出區網網址（`share` 形如 `http://192.168.x.x/`（遊戲清單），80 埠不帶埠號；`games` 另列三款遊戲的網址），直接分享給同事。首次啟動 macOS 若詢問是否允許 node 接受連入連線 → 允許；macOS 一般使用者即可綁 80，不需 sudo。驗證：另一台裝置開 `http://<Rex IP>/healthz` 回 `{"ok":true}`。驗證或測試時可用 `PORT=3100 npm start` 避開 80（5173／5174／5175 是開發模式的內部埠，也避開）。詳見 `spec/architecture.md` §3。

### 外網分享（Cloudflare Tunnel，備用）

區網為主要方式（已實測可連）。需要外網或區網臨時不通時，`npm start` 之後另開終端 `npm run tunnel`，把印出的 `https://<隨機>.trycloudflare.com/draw-guess/` 分享出去。同一個 server 程序同時服務區網與 tunnel，程式不需改。tunnel 等於對全網公開、沒有登入，靠網址不外流；人數上限 50。詳見 `spec/architecture.md` §3「外網可達」。

### 常用端點

| 端點 | 說明 |
|------|------|
| `http://localhost/` | 遊戲清單（正式建置，:80） |
| `http://localhost/draw-guess/` | 我畫你猜（正式建置）；`npm run dev` 時同一網址是 Vite 開發版（HMR，`/socket.io` proxy 到 :5173） |
| `http://localhost/draw-contest/`、`http://localhost/song-guess/` | 繪圖比賽、猜歌（正式建置）；`npm run dev` 時同樣是各自 Vite 的開發版（經 :80 轉發） |
| `http://localhost/healthz` | 健康檢查 |

---

## 規範文件（實作前必讀）

| 檔案 | 內容 |
|------|------|
| [spec/overview.md](spec/overview.md) | 產品定位、v1 遊戲規則、範圍內外 |
| [spec/architecture.md](spec/architecture.md) | 模組佈局、Socket 事件契約（型別放 `shared/`）、回合狀態機、驗證指令。**實作唯一契約，改動需架構師（海圖）定案** |
| [spec/song-guess/](spec/song-guess/) | **猜歌**（Epic 16）：`overview.md` 規則、`architecture.md` 契約／狀態機／iTunes 題庫／答案判定（改動需架構師定案）、`design.md` Meet 偽裝對照 |
| [spec/draw-contest/](spec/draw-contest/) | **繪圖比賽**（Epic 14）：`overview.md` 規則、`architecture.md` 契約／狀態機／評分器／部署（改動需架構師（海圖）定案）、`design.md` 簡報偽裝的畫面對照 |
| [plan/draw-guess-mvp.md](plan/draw-guess-mvp.md) | Epic 1 任務拆解與派工規範 |
| [plan/chat-image.md](plan/chat-image.md) | Epic 2 聊天室圖片（拖曳上傳、即時中繼、不保留） |
| [plan/camouflage-themes.md](plan/camouflage-themes.md) | Epic 3 多偽裝主題（vscode／ppt 殼層、遊戲內切換） |
| [plan/home-page.md](plan/home-page.md) | Epic 4 首頁（不偽裝的柔和 UI：暱稱＋風格卡片，選好才進殼層；自動重連不經首頁） |
| [plan/meet-theme.md](plan/meet-theme.md) | Epic 5 視訊會議偽裝主題（Google Meet 風格的第三套殼層 `meet`） |
| [plan/help-topics.md](plan/help-topics.md) | Epic 6 遊戲說明（偽裝介面裡的「說明」入口 → 兩步說明對話框，內容一份三殼層共用） |
| [plan/canvas-background.md](plan/canvas-background.md) | Epic 7 畫布背景色與新色塊（`background` op 同步底色；PALETTE 加黑與膚色） |
| [plan/voice-input.md](plan/voice-input.md) | Epic 8 語音輸入（語音轉文字；whisper.cpp＋opencc 正體）——**⏸ 暫緩**：區網 http 下瀏覽器不開放麥克風 |
| [plan/docker-deploy.md](plan/docker-deploy.md) | Epic 9 Docker 部署（多階段映像、compose、容器內分享網址） |
| [plan/home-paper.md](plan/home-paper.md) | Epic 10 首頁紙張質感（暖白紙底＋CSS 紙紋，2026-10-07 採用） |
| [plan/color-picker.md](plan/color-picker.md) | Epic 11 顏色面板（取代工具列色相條：HSV 方塊＋寬色相條，三殼層共用） |
| [plan/round-time.md](plan/round-time.md) | Epic 12 作畫時間改 2 分鐘（`ROUND_SECONDS` 唯一來源；改時間只動它＋說明文字） |
| [plan/excel-theme.md](plan/excel-theme.md) | Epic 13 試算表偽裝主題（Excel 風格的第四套殼層 `excel`；DESIGN §17） |
| [plan/draw-contest-mvp.md](plan/draw-contest-mvp.md) | Epic 14 繪圖比賽 MVP（第二款遊戲：出題→同時畫→評分器打分→投影片瀏覽揭曉；MVP 隨機評分，Phase 3 接 Clef／Ollama） |
| [plan/song-guess-mvp.md](plan/song-guess-mvp.md) | Epic 16 猜歌 MVP（第三款遊戲：出題者填歌手 → server 從 iTunes 抽 5 首試聽 → 同步播、打字猜 → 逐首揭曉 → 本局排名；Meet 偽裝） |
| [plan/contest-commentary.md](plan/contest-commentary.md) | Epic 15 繪圖比賽 AI 評語（揭曉卡片每張一句メスガキ評語：gemma4 經 Ollama `/api/chat`、`think: false`、自由發揮；評語不擋揭曉；順帶移除評分前縮圖） |

---

## 開發流程

- **所有實作必須由 `plan/` 驅動**：修改程式碼前後皆須同步對應 Epic 文件與 `backlog.md`。規範見 [plan/README.md](plan/README.md)。
- **本專案無資料庫**，`spec/db/erd.mmd` 暫不維護；遊戲狀態模型寫在 `spec/architecture.md`（規劃中）。
- **改畫面文字、無障礙標籤、殼層、畫布指標處理或滑桿換算前**，先 `grep -rn "UI-DEP\|CONST-DEP\|BUG-DEP" other/skills`：事務長（Purser）維護的 AI 代理遊玩技能依賴這些字串與行為，改動要知會事務長（2026-10-12）。
- **`DESIGN.md`**：已建立（共通原則 ＋ 各偽裝主題章節：vscode §3–§5、ppt §13、meet §15、excel §17；首頁 §14 不偽裝、柔和 UI；說明 §16）。**產生任何畫面、元件、樣式前先讀 [DESIGN.md](DESIGN.md)**，色碼一律用 token，不得寫死；新主題只加 token 覆寫與殼層，不動功能元件。

---

## Claude Skills（[.claude/skills/](.claude/skills/)）

| 技能 | 功能 | 使用時機 |
|------|------|----------|
| `ui-ux-pro-max` | UI/UX 設計指引資料庫：風格、配色、字型配對、UX 準則、圖表類型，依技術棧給優先建議（Python 腳本查詢） | 設計任何畫面、元件、樣式之前；與 `DESIGN.md` 搭配使用 |

---

## 團隊分工

多 session 協作的身分與職責寫在 [.claude/team/ROSTER.md](.claude/team/ROSTER.md)，查詢與登記用 `/team-identity`。
子代理沒有 session 身分；派工 prompt 須註明不得登記名冊、不得跨 session 傳訊。
驗收：實作子代理回報完成後，架構師（海圖）派 [`acceptance-reviewer`](.claude/agents/acceptance-reviewer.md) 子代理做獨立驗收（四項指令、契約比對、協定測試、瀏覽器實測），架構師依報告定案與回寫文件，不親自驗收（Rex 2026-09-29 定案）。

> 名冊中出現的舵手（Helm）、龍骨（Keel）、羅盤（Compass）、帆（Sail）為另一台電腦上的舊 session，2026-10-10 已移除；plan／spec 內提到他們的地方是歷史紀錄，不改。
