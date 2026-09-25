# CLAUDE.md

本檔提供 Claude Code 在此 repo 工作時的核心指引。**主檔保持精簡**，只放本專案特有的資訊；跨專案通用的工作規則（計畫驅動、狀態符號、Git 不自動 commit）已在全域 `~/.claude/CLAUDE.md`，不在此重複。

## 語言規則

所有回覆與計劃制定一律使用**繁體中文（台灣用語）**。
專有名詞優先使用台灣慣用譯名（套件、函式、陣列、字串、相依性、部署）；技術指令、API、CLI、IDE 等保持原文。

---

## 專案簡介

**fishing-work** 是一個**簡易互動遊戲平台**：部署在 Rex 本機，同事透過公司區網進來玩。
第一款遊戲為**我畫你猜（draw-guess）**：首頁輸入暱稱即可加入，不需帳號；自願玩家當畫師、自訂題目後在畫布作畫，其他人即時看畫猜題。

特殊需求：首頁為不偽裝的柔和 UI（輸入暱稱、以卡片選介面風格，各人本機偏好），選好才進偽裝殼層：程式編輯器（VS Code 深色）或 PowerPoint，上班偷玩不被發現；有聊天室（可拖曳傳圖，不保留）；畫師自訂題目；畫布統一黑底白筆不隨主題。

目前狀態（2026-09-25）：Epic 1「我畫你猜 MVP」、Epic 2「聊天室圖片」、Epic 3「多偽裝主題（vscode／ppt）」、Epic 4「首頁（柔和 UI 選介面風格）」**全部完成**：工程、舵手驗收、Rex 目視與實機（區網、拖圖）皆通過；目前沒有進行中的 Epic。進度見 [plan/backlog.md](plan/backlog.md)。

---

## 目錄結構

```
fishing-work/
├── CLAUDE.md
├── DESIGN.md               # 視覺設計指南：Dark+ 色彩 token、IDE 殼層尺寸、元件規範（做畫面前必讀）
├── draw-guess/             # 我畫你猜客戶端：React 19 + Vite + TypeScript + Tailwind v4
├── server/                 # Node + TypeScript + Socket.IO：房間、回合、筆跡中繼、猜題裁判，並提供各遊戲靜態檔
├── shared/                 # 前後端共用的事件契約、常數、純函式（answer / text / nickname）
├── tsconfig.base.json      # 三模組共用 TS 設定
├── plan/                   # 開發計畫（動態）：backlog 索引、各 Epic 詳細計畫、踩雷紀錄
├── spec/                   # 規範文件（穩定）：overview.md 產品與規則、architecture.md 架構與事件契約
├── user/
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
| 部署 | Rex 本機單一 Node 程序，同事以區網 IP 連線 | 不需 Docker、HTTPS、雲端 |

---

## 開發指令

一律在**專案根目錄**執行（npm workspaces）：

```bash
npm install                 # 安裝三個 workspace 的相依
npm run dev                 # 同時啟動 server（:3000，只當 proxy 目標）與 Vite（綁 :80 → http://localhost/draw-guess/）
npm run build               # 建置 draw-guess/dist/ 與 server/dist/index.js
npm start                   # 正式：node server/dist/index.js（PORT 預設 80、HOST 預設 0.0.0.0；公司區網只放行標準埠）
npm run typecheck           # 三個 workspace 的 tsc --noEmit
npm test                    # Vitest（shared、server）
npm run lint                # ESLint（目前只涵蓋 draw-guess）
npm run tunnel              # Cloudflare 快速通道（需先 brew install cloudflared），指向 :80，印出 https://xxx.trycloudflare.com
```

> `npm run dev`、`npm start` 是長跑指令，**不要在前景執行**（會卡住 session）。驗證指令要分開跑、各自看 exit code。

### 區網分享（同事連線）

`npm start` 後 log 會印出區網網址（形如 `http://192.168.x.x/draw-guess/`，80 埠不帶埠號），直接分享給同事。首次啟動 macOS 若詢問是否允許 node 接受連入連線 → 允許；macOS 一般使用者即可綁 80，不需 sudo。驗證：另一台裝置開 `http://<Rex IP>/healthz` 回 `{"ok":true}`。驗證或測試時可用 `PORT=3000 npm start` 避開 80。詳見 `spec/architecture.md` §3。

### 外網分享（Cloudflare Tunnel，備用）

區網為主要方式（已實測可連）。需要外網或區網臨時不通時，`npm start` 之後另開終端 `npm run tunnel`，把印出的 `https://<隨機>.trycloudflare.com/draw-guess/` 分享出去。同一個 server 程序同時服務區網與 tunnel，程式不需改。tunnel 等於對全網公開、沒有登入，靠網址不外流；人數上限 50。詳見 `spec/architecture.md` §3「外網可達」。

### 常用端點

| 端點 | 說明 |
|------|------|
| `http://localhost/` | 遊戲清單（正式建置，:80） |
| `http://localhost/draw-guess/` | 我畫你猜（正式建置）；`npm run dev` 時同一網址是 Vite 開發版（HMR，`/socket.io` proxy 到 :3000） |
| `http://localhost/healthz` | 健康檢查 |

---

## 規範文件（實作前必讀）

| 檔案 | 內容 |
|------|------|
| [spec/overview.md](spec/overview.md) | 產品定位、v1 遊戲規則、範圍內外 |
| [spec/architecture.md](spec/architecture.md) | 模組佈局、Socket 事件契約（型別放 `shared/`）、回合狀態機、驗證指令。**實作唯一契約，改動需舵手定案** |
| [plan/draw-guess-mvp.md](plan/draw-guess-mvp.md) | Epic 1 任務拆解與派工規範 |
| [plan/chat-image.md](plan/chat-image.md) | Epic 2 聊天室圖片（拖曳上傳、即時中繼、不保留） |
| [plan/camouflage-themes.md](plan/camouflage-themes.md) | Epic 3 多偽裝主題（vscode／ppt 殼層、遊戲內切換） |
| [plan/home-page.md](plan/home-page.md) | Epic 4 首頁（不偽裝的柔和 UI：暱稱＋風格卡片，選好才進殼層；自動重連不經首頁） |

---

## 開發流程

- **所有實作必須由 `plan/` 驅動**：修改程式碼前後皆須同步對應 Epic 文件與 `backlog.md`。規範見 [plan/README.md](plan/README.md)。
- **本專案無資料庫**，`spec/db/erd.mmd` 暫不維護；遊戲狀態模型寫在 `spec/architecture.md`（規劃中）。
- **`DESIGN.md`**：已建立（共通原則 ＋ 各偽裝主題章節：vscode §3–§5、ppt §13；首頁 §14 不偽裝、柔和 UI）。**產生任何畫面、元件、樣式前先讀 [DESIGN.md](DESIGN.md)**，色碼一律用 token，不得寫死；新主題只加 token 覆寫與殼層，不動功能元件。

---

## Claude Skills（[.claude/skills/](.claude/skills/)）

| 技能 | 功能 | 使用時機 |
|------|------|----------|
| `ui-ux-pro-max` | UI/UX 設計指引資料庫：風格、配色、字型配對、UX 準則、圖表類型，依技術棧給優先建議（Python 腳本查詢） | 設計任何畫面、元件、樣式之前；與 `DESIGN.md` 搭配使用 |

---

## 團隊分工

多 session 協作的身分與職責寫在 [.claude/team/ROSTER.md](.claude/team/ROSTER.md)，查詢與登記用 `/team-identity`。
子代理沒有 session 身分；派工 prompt 須註明不得登記名冊、不得跨 session 傳訊。
