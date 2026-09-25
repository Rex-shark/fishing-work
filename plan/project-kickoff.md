# Epic 0：專案啟動與需求釐清

> 把「空專案」變成「有定位、有技術方向、有可派工計畫」的專案

**狀態**：✅
**起訖**：2026-09-24 ~ 2026-09-24
**負責**：Rex × 舵手（Helm）

---

## 設計決策

- 決策 1：採**計畫驅動開發**，鋪設 `plan/`、`spec/`、`user/` 三層結構。原因：全域工作規則，所有專案一致。
- 決策 2：session 身分走 `.claude/team/ROSTER.md` 名冊機制，架構師為本 session。原因：多 session 分工時身分不靠記憶、不寫進 CLAUDE.md。
- 決策 3：✅ 2026-09-24 **Rex 拍板 Node**。後端 Node.js + TypeScript + Socket.IO；前端 **React 19 + Vite**（Rex 以 IDEA 初始化 `draw-guess` 模組，取代原建議的 Vue 3）；**無資料庫**。原因：本專案是即時多人遊戲，核心是 WebSocket 中繼與記憶體內的房間狀態，既有 Spring 模板的 RBAC / JPA / Redis 全用不到；理由詳見「技術選型評估」。
- 決策 4：架構師本人不寫業務程式，實作交子代理或其他 session，架構師負責規格、計畫、驗收。原因：與 Rex 其他專案的角色分工一致。
- 決策 5：✅ **模組佈局（2026-09-24 Rex 確認）**：根目錄 npm workspaces，`draw-guess/` 為遊戲客戶端、`server/` 為 Socket.IO 後端並提供各遊戲靜態檔、`shared/` 放事件名稱與 payload 型別。原因：一個 server 可承載多款遊戲（各自 namespace），每款遊戲一個客戶端模組並以路徑區分（`/draw-guess/`），與 Rex 現有多前端以路徑分流的慣例一致。
- 決策 6：✅ **draw-guess 轉 TypeScript（2026-09-24 Rex 同意）**：IDEA 產生的是 JavaScript 範本（`.jsx`），建議趁尚無程式碼時改為 TS。原因：事件 payload 型別要在 `shared/` 與前後端共用，JS 做不到編譯期檢查。

---

## 待釐清問題（全部已答，2026-09-24）

| # | 問題 | 為什麼需要 |
|---|------|-----------|
| 1 | ~~**fishing-work 是什麼？**~~ | ✅ 2026-09-24：**簡易互動遊戲平台**，部署在 Rex 本機，同事透過公司區網進來玩。第一款暫定**我畫你猜** |
| 2 | ~~**最重要的 3 個使用情境**~~ | ✅ 2026-09-24：(1) 首頁輸入自訂暱稱即可進入；(2) 自願玩家當畫師，自訂題目後在畫布作畫；(3) 其他人即時看畫、猜題（由 1、2 推得，待確認計分與回合規則） |
| 3 | ~~**使用者與角色**~~ | ✅ 2026-09-24：**不需帳號登入**，暱稱即身分；角色只有遊戲內的「畫師／猜題者」，無權限分級、無 RBAC |
| 4 | ~~**技術棧**~~ | ✅ 2026-09-24 Rex 拍板 **Node**；前端 React（IDEA 初始化 `draw-guess`） |
| 9 | ~~**`draw-guess` 要不要改 TypeScript？**~~ | ✅ 2026-09-24 Rex 同意改 TS；由子代理就地轉換（Epic 1 Phase 0） |
| 10 | ~~**模組佈局是否照決策 5？**~~ | ✅ 2026-09-24 Rex：「模組區依照你建議開工」 |
| 5 | ~~**部署目標**~~ | ✅ 2026-09-24：**Rex 本機**，同事經**公司區網**連線。不需 Docker、不需 HTTPS、不需雲端 |
| 6 | ~~**有沒有 UI？**~~ | ✅ 2026-09-24：有。**黑底畫布、整體黑色、像 IDEA / VS Code 的程式碼編輯器風格**（上班偷玩不被發現）。`DESIGN.md` 已於同日建立（Rex 授權舵手決定：Dark+ 基底、偽裝第 2 級） |
| 7 | **外部整合** | ⬜ 未提及，暫定**無** |
| 8 | ~~**架構師 session 的名字**~~ | ✅ 2026-09-24 Rex 授權自取，定名 **舵手（Helm）**，名冊與 session 標題已同步 |

---

## 技術選型評估（2026-09-24，架構師建議；同日 Rex 拍板 Node）

### 結論

**需要後端，但不需要 Java。** 建議 Node.js（TypeScript）+ Socket.IO；Spring Boot WebSocket 是可行備案。

### 為什麼不能純前端

- 畫師的筆跡要**即時廣播**給所有猜題者；瀏覽器不能接受連線，必須有一台伺服器中繼。
- 題目要對猜題者**保密**、猜對與否要有**裁判**、誰是畫師與計分要有**唯一權威**。這些狀態放在任何一個玩家的瀏覽器都不可靠（關分頁就全沒）。
- WebRTC 點對點仍需 signaling 伺服器，且 mesh 連線在區網也不見得穩，複雜度反而更高。

### 後端真正要做的事（全部在記憶體，不需資料庫）

| 職責 | 說明 |
|------|------|
| 玩家與房間 | 暱稱加入、離線移除、房間清單 |
| 回合狀態 | 誰是畫師、題目（僅畫師與伺服器知道）、回合計時 |
| 筆跡中繼 | 畫師送筆畫片段，伺服器廣播；保留本回合筆畫供中途加入者重播 |
| 猜題裁判 | 比對猜測與題目、公告猜對者、計分、回合結束揭曉 |

### 三個方案比較

| 方案 | 適合度 | 說明 |
|------|--------|------|
| **Node.js + Socket.IO**（建議） | ◎ | 即時事件是原生強項；前後端同用 TypeScript，事件型別可共用；單一程序同時提供靜態頁與 WebSocket，`node server` 即上線；之後加第二、第三款遊戲仍是同一套事件模型 |
| Spring Boot WebSocket（備案） | ○ | 可行，Rex 熟、既有 agent 與規範可沿用。但需砍掉 Security / JPA / Redis 模板包袱；STOMP 對高頻筆跡稍重，建議用原生 `WebSocketHandler`；前後端兩種語言，事件型別要維護兩份 |
| 純前端 / WebRTC | ✗ | 見上方理由，不建議 |

### 建議技術棧（若 Rex 選 Node）

| 層 | 選型 | 備註 |
|----|------|------|
| 後端 | Node 20 + TypeScript + Socket.IO | 房間、回合、筆跡中繼、猜題裁判 |
| 前端 | Vue 3 + Vite + TypeScript | Canvas 繪圖、猜題聊天、計分板；套用 `ui-ux-pro-max` 與 `DESIGN.md` |
| 共用 | `shared/` 套件放事件名稱與 payload 型別 | 前後端同一份定義 |
| 資料庫 | 無 | 日後要戰績或題庫再加 SQLite |
| 部署 | `npm run build` 後單一 Node 程序 | 同事開 `http://<Rex 區網 IP>:<port>`；macOS 防火牆需放行該 port |

### 若 Rex 選 Java

Spring Boot 3 + `spring-boot-starter-websocket`（原生 handler，不用 STOMP）+ 靜態資源放 `resources/static/`，**不加** Spring Security、JPA、Redis。單一 fat jar `java -jar` 啟動。

---

## draw-guess 模組評估（2026-09-24，Rex 以 IDEA 初始化，架構師檢視）

**結論：能用，當本遊戲的 React 客戶端沒問題；但它只是前端，且是 JavaScript。** 開工前要補後端模組與（建議）轉 TS。

| 項目 | 現況 | 判定 | 說明 |
|------|------|------|------|
| 建置工具 | Vite 8.3.0，`@vitejs/plugin-react` 6（Oxc） | ✅ | Node 25.8.1 符合 engines（≥22.12）；`npm run build` 實測通過，265 ms |
| UI 框架 | React 19.3.0 | ✅ | 與 Rex 的 good-neighbor 模板同代 |
| Lint | ESLint 10 flat config + react-hooks + react-refresh | ✅ | 轉 TS 時需加 typescript-eslint |
| 語言 | **JavaScript**（`.jsx`，無 tsconfig） | ⚠️ | 建議改 TS，見決策 6 |
| 範圍 | 只有前端 | ⚠️ | 後端 `server/`、共用 `shared/` 尚未存在，見決策 5 |
| Vite 設定 | 只有 `plugins: [react()]` | ⚠️ | 需加 `server.host`、`server.proxy`、`base`，見 Phase 3 |
| 範本殘留 | 示範頁、hero.png、兩個 logo、App.css、icons.svg、英文 README | 🧹 | 開工第一件事清掉 |
| `index.html` | `lang="en"`、標題 `draw-guess` | 🧹 | 改 `zh-TW` 與中文標題 |
| 依賴 | 只有 react / react-dom | ⬜ | 開工需加 `socket.io-client`；路由與樣式（Tailwind v4 + shadcn/ui 或原生 CSS）待 `DESIGN.md` 討論後定 |
| Canvas | 無額外套件 | ✅ | 原生 Canvas API 足夠；筆觸美化可選 `perfect-freehand` |
| `.gitignore` | 忽略 node_modules、dist、.idea | ✅ | 根目錄 `git init` 時另建根 `.gitignore` |

> 驗證方式：`npm run build` 於 `draw-guess/` 實跑，產物 `dist/` 已於驗證後刪除，模組維持 Rex 初始化的原狀。

---

## 任務清單

### Phase 1：專案骨架

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | 鋪設 `plan/`、`spec/`、`user/` 結構 | 依 project-structure skill 範本 |
| ✅ | 建立 `.claude/team/ROSTER.md` 並登記架構師 | 定名 舵手（Helm） |
| ✅ | 複製 `ui-ux-pro-max` skill 到 `.claude/skills/` | Rex 指示，UI 設計時使用 |
| ✅ | 撰寫精簡 `CLAUDE.md` | 只放專案特有資訊，不重複全域規則 |
| ✅ | 建立本 Epic 文件並列出待釐清問題 | |

### Phase 2：需求釐清與規格

| 狀態 | 任務 | 備註 |
|------|------|------|
| ⬜ | 取得 Rex 對上方 8 個問題的回答 | 阻塞項 |
| ✅ | 撰寫 `spec/overview.md`：產品定位、使用者、範圍內外、v1 遊戲規則、特殊需求 | 2026-09-24 |
| ✅ | 撰寫 `spec/architecture.md`：模組佈局、技術棧、拓樸、Socket 事件契約、狀態機、驗證方式 | 2026-09-24 |
| ❌ | 初版 `spec/db/erd.mmd` | 無資料庫，取消；狀態模型改寫在 `spec/architecture.md` |
| ✅ | 拆出功能 Epic 寫入 `backlog.md`，每個 Epic 建檔 | Epic 1 `draw-guess-mvp.md`，六個 Phase |
| ✅ | 更新 `CLAUDE.md` 的專案簡介、技術棧、開發指令 | 2026-09-24 |

### Phase 3：開發環境

> 以下任務已細化並移交 [draw-guess-mvp.md](draw-guess-mvp.md) Phase 0，此處僅保留索引；狀態以 Epic 1 為準。

| 狀態 | 任務 | 備註 |
|------|------|------|
| ⬜ | `git init` 與根目錄 `.gitignore` | Rex 自行操作；`.gitignore` 內容依技術棧由架構師提供 |
| ⬜ | `draw-guess` 轉 TypeScript、清除範本內容（App.jsx 示範頁、hero.png、react.svg、vite.svg、App.css、icons.svg、README） | 待問題 9 確認；派工 |
| ⬜ | `draw-guess/vite.config` 加 `server.host: true`（區網可連 dev server）、`server.proxy` 把 `/socket.io` 轉到後端、`base: '/draw-guess/'` | 派工 |
| ⬜ | `draw-guess/index.html` 改 `lang="zh-TW"` 與標題 | 派工 |
| ⬜ | 根目錄 `package.json` 建 npm workspaces | 待問題 10 確認 |
| ⬜ | 建 `shared/`：事件名稱與 payload 型別 | 依 spec/architecture.md 事件表 |
| ⬜ | 建 `server/`：Node + TypeScript + Socket.IO 骨架，提供 `draw-guess/dist` 靜態檔 | 派工 |
| ⬜ | 安裝 `socket.io`（server）與 `socket.io-client`（draw-guess） | 隨上兩項 |
| ⬜ | 建立 `.claude/agents/` 子代理定義 | 只建用得到的 |
| ⬜ | `DESIGN.md` 討論（若有 UI） | 不自動產生 |
| ⬜ | `user/http/http-client.env.json` 依實際後端位址調整 | 目前為範本預設值 |

> 💡 **任務粒度**：每個任務應在 1–4 小時內可完成。過大的任務切成子項。

---

## 驗收標準

Epic 完成需通過以下條件：

- [x] 待釐清問題皆有答案或明確假設（問題 7 暫定無、問題 10 暫依決策 5），並記錄於 `spec/overview.md`
- [x] `spec/architecture.md` 定案技術棧與模組邊界
- [x] `backlog.md` 至少有 1 個可立即開工的功能 Epic，且該 Epic 文件的 Phase 0 任務已可派工
- [x] `CLAUDE.md` 的專案簡介與技術棧不再是「待定」
- [x] 名冊裡架構師有正式名字，session 標題與之一致

---

## 踩雷紀錄

（暫無）
