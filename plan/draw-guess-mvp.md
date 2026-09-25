# Epic 1：我畫你猜 MVP

> 從 IDEA 初始化的空殼，做到同事在區網能一起玩的第一版

**狀態**：✅（2026-09-25 完成：Rex 回報實機區網實測「都正常」。2026-09-24 Rex 拍板開工，並授權龍骨一路開發到底、不再逐步詢問；Phase 0 ✅ 舵手驗收通過；Phase 1 ✅ 舵手驗收通過；Phase 2 ✅ 舵手驗收通過；Phase 3 ✅ 舵手驗收通過；Phase 4 ✅ 舵手驗收與 Rex 目視「大致 OK」；Phase 5 自動化部分（README、壓測、實機清單）✅，待 Rex 照 `user/lan-test-checklist.md` 實機實測；Phase 6 ✅ 舵手驗收通過、2026-09-25 Rex 第二次目視「目前沒問題」。**待 Rex 實機清單，其餘全部完成**：Epic 維持 🔄 只因 Phase 5 實機區網實測一條）
**起訖**：2026-09-24 ~ 2026-09-25
**負責**：Rex × 舵手（Helm，規格與計畫）× 龍骨（Keel，派工與驗收）

---

## 設計決策

- 決策 1：**規格以 `spec/architecture.md` 為唯一契約**，事件型別放 `shared/` 由前後端直接 import。原因：避免前後端各寫一份 payload 型別而漂移。
- 決策 2：**Room 狀態機為純邏輯類別**，計時器注入以便測試；socket 接線層保持薄。原因：遊戲規則是最容易出錯的地方，必須可單元測試。
- 決策 3：**v1 單一房間**。原因：同一批同事一起玩；多房間留給日後 Epic。
- 決策 4：**沒有路由套件、沒有元件庫**。原因：只有兩個畫面；IDE 偽裝外觀是客製版面，元件庫幫不上忙。
- 決策 5：**server 以 tsup 打包**吸收 `shared/` 原始碼，不用 TS project references。原因：省掉三個 tsconfig 互相引用的維護成本。
- 決策 6：Phase 順序「骨架 → 大廳 → 回合與畫布 → 聊天與猜題 → 介面 → 部署」，**每個 Phase 結束都可跑**。原因：讓 Rex 隨時能看到可玩的中間版本。

---

## 任務清單

### Phase 0：工具鏈與骨架

> ✅ 2026-09-24 舵手規格符合性驗收通過：四項指令自跑皆 0、server 煙霧測試 7 個端點正確、events.ts 與 spec 逐字一致、DESIGN 34 個 token 全符。待補：`server/public/index.html` 兩處色碼對齊 token（與 Phase 1 並行）。龍骨提出的 8 項差異已定案回寫 spec / DESIGN。

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | 根目錄 `package.json`：npm workspaces（shared、server、draw-guess），scripts `dev` / `build` / `start` / `typecheck` / `test`，`engines.node >= 22.12` | 根目錄 `.gitignore`（node_modules、dist、.DS_Store、*.local） |
| ✅ | `draw-guess` 轉 TypeScript：加 `typescript`、`tsconfig.json`（strict）、`.jsx → .tsx`、`vite.config.ts`、ESLint 加 typescript-eslint | Rex 已同意（2026-09-24） |
| ✅ | `draw-guess` 清除範本：App 示範頁、hero.png、react.svg、vite.svg、App.css、icons.svg；README 改為專案說明；`index.html` 改 `lang="zh-TW"`、標題 `canvas.ts - fishing-work`、favicon 換一般文件圖示 | 標題依 DESIGN.md §5「畫面」（原建議 `draw-guess — fishing-work` 作廢） |
| ✅ | `draw-guess/vite.config.ts`：`base: '/draw-guess/'`、`server.host: true`、`server.proxy['/socket.io']`（ws） | 見 architecture §3 |
| ✅ | 建 `shared/`：`events.ts`、`constants.ts`、`answer.ts` 依 architecture §4 逐字實作；Vitest 測 `normalizeAnswer` / `isCorrect` / `containsSpoiler`（全形、大小寫、空白案例） | 無執行期相依 |
| ✅ | 建 `server/`：Express 5 + Socket.IO 4 + `tsx` + `tsup`；`/healthz`、`/` 遊戲清單頁、`/draw-guess/` 靜態 + SPA fallback；註冊 `/draw-guess` namespace（先只接 connect / disconnect log） | `PORT` 環境變數 |
| ✅ | 安裝 `socket.io-client`、`zustand`、Tailwind v4 於 `draw-guess`；建 `socket/client.ts`（型別化）與空的 `store/game.ts` | |
| ✅ | 驗證：`npm run typecheck`、`npm test`、`npm run build` 各自 exit 0；`npm start` 後 `/healthz` 與 `/draw-guess/` 回 200 | 由龍骨驗收 |

### Phase 1：大廳與玩家

> ✅ 2026-09-24 舵手規格符合性驗收通過：四項指令自跑皆 0（shared 39、server 41 測試）；events.ts 與 spec 逐字一致；客戶端無寫死色碼；舵手另寫協定測試 `user/protocol/draw-guess-phase1.mjs`（只依 spec 打 Socket，含真實 15 秒寬限期）24 項全過。龍骨提問 8 項已定案回寫 spec（architecture §12）。

> 📌 2026-09-24 規格增補（龍骨提問後舵手定案，詳見 architecture §12）：**重連接管**（穩定 playerId、`player:join` 帶 `token`、回 `JoinResult`、`PlayerPublic.connected`、15 秒寬限期、Socket.IO ping 10s/5s）、**重複 join 冪等**、**text.ts 字數與控制字元規則**。Phase 1 的 Room 測試須加：接管時舊 socket 仍在、寬限逾期→leave、寬限期中的暱稱仍占用、重複 join 冪等、暱稱含控制字元被拒。

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | server `Room`：`join` / `leave`、暱稱驗證與去重、`PlayerPublic` 投影、快照 | 純邏輯 + 測試 |
| ✅ | server `register.ts`：`player:join` ack 快照、`players:update` 廣播、離線處理、system 訊息 | |
| ✅ | client `NicknameScreen`：輸入、錯誤顯示（`NICKNAME_TAKEN` 等）、sessionStorage 記暱稱、重連自動 join | |
| ✅ | client `PlayerList`：暱稱、分數、畫師／已猜對標記 | 先用簡單樣式，Phase 4 再套 IDE 外觀 |
| ✅ | 驗證：兩個分頁用不同暱稱加入互相看得到；同暱稱被拒；關閉分頁後另一方清單即時更新 | |

### Phase 2：回合與畫布

> ✅ 2026-09-24 舵手規格符合性驗收通過：四項指令自跑皆 0（shared 39、server 178、draw-guess 37）；events.ts 與 spec 逐字一致、17 個常數全符；客戶端無寫死色碼；舵手協定測試 `user/protocol/draw-guess-phase2.mjs`（回合狀態機、出題遮罩、draw:op 驗證與轉發、歷史正規化、cancel／ended／idle）全過。龍骨提問 22 項已定案回寫 spec（architecture §12），需要改程式的部分列為 Phase 3 表首任務。

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | **區網可達**（Rex 補充需求，Phase 2 第一項先做）：server `HOST` 環境變數預設 `0.0.0.0`；啟動時列舉非內部 IPv4 印出 `http://<ip>:<port>/draw-guess/`；根 README 加「區網分享」段（防火牆允許 node、另一台裝置開 `/healthz` 驗證、DHCP 保留 IP 或 `.local`） | architecture §3「區網可達」。**Rex 2026-09-24 已以 Phase 1 建置實測區網 IP 可連**；本列只做 HOST 明確化、啟動印網址、README |
| ✅ | **Cloudflare Tunnel**（Rex 補充需求）：根 `package.json` 加 `tunnel` script（`cloudflared tunnel --url http://localhost:3000`）；Express `trust proxy`、log 位址取 `CF-Connecting-IP`；README 加「外網分享（cloudflared）」段（快速通道與具名通道、安全邊界）；實測 `npm run tunnel` 網址能開 `/healthz` 並玩一回合 | **備用管道，選用**：區網已實測可連，本列不阻擋 Phase 2 驗收；script、trust proxy、CF-Connecting-IP log、README 段已完成，**tunnel 實測未做**（Rex 指示先不驗）；architecture §3「外網可達」；cloudflared 由 Rex `brew install` |
| ✅ | `MAX_PLAYERS`（50）與 `ROOM_FULL`：constants、ErrorCode、Room.join 前置條件、測試 | architecture §4、§5；tunnel 公開後的保護 |
| ✅ | Room：斷線與接管**不再發 system 訊息**（「X 斷線」「X 重新連線」移除，只留「加入」「離開」）；更新 room.test.ts 對應案例 | 2026-09-24 定案，見 architecture §5 |
| ✅ | 協定測試納入 `server/test/e2e/`（起隨機埠 server + socket.io-client，Vitest），以 `user/protocol/draw-guess-phase1.mjs` 為起點，Phase 2 起補回合／畫布案例 | 每 Phase 驗收都要跑 |
| ✅ | server `Room` 狀態機：idle / choosing / drawing / ended 全部轉移、計時器注入、`end(reason)`；Vitest 覆蓋每條轉移與離線邊界（architecture §5 表格逐列對應一個測試） | 核心任務，先做測試。須含「畫師斷線寬限內回合不中止、畫師寬限逾期→drawerLeft」（自 Phase 1 移入） |
| ✅ | server：`round:volunteer` / `round:setTopic` / `round:cancel` 接線；`round:update` 依收件者遮罩 topic | 畫師看得到題目，其他人只看字數 |
| ✅ | server：`draw:op` 驗證（畫師、drawing 階段、undo 只撤自己最後一筆）、追加歷史、轉發 | 非法 op 丟棄並 log |
| ✅ | client `canvas/render.ts`：ops → canvas 純函式（begin/move/end/undo/clear），Vitest 用假 context 驗證呼叫序列 | |
| ✅ | client `Canvas.tsx`：邏輯 1280×720、CSS 等比縮放、指標事件 → 正規化座標、rAF 批次送 `move`、本地即時繪製、收 op 增量繪製、undo/clear/快照全量重繪 | 支援 mouse 與 pointer 事件即可 |
| ✅ | client `ToolBar`：顏色（PALETTE）、粗細（BRUSH_SIZES）、橡皮擦、復原、清空、放棄；只有畫師可見 | |
| ✅ | client `RoundBar` + `TopicDialog`：「我來畫」、出題、倒數（以 `endsAt` 計算，不靠 server 每秒推）、題目提示 | |
| ✅ | 驗證：A 自願出題後畫，B 即時看到；C 中途加入看到既有筆跡；A 復原／清空 B 同步；A 關閉分頁回合結束 | |

### Phase 3：聊天與猜題

> ✅ 2026-09-24 舵手規格符合性驗收通過：四項指令自跑皆 0（shared 39、server 250、draw-guess 83）；events.ts 與 spec 逐字一致；客戶端無寫死色碼；80 埠、tunnel、dev PORT=3000 接線正確。舵手協定測試 `user/protocol/draw-guess-phase3.mjs`（判定表六種情境、部分命中擋下、大小寫／全形猜對、計分公式、全員猜對→揭曉→idle 清 hasGuessed、限速與長度）全過。龍骨提問 16 項已定案回寫（architecture §12、DESIGN §12）。

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | **埠改 80**（Rex 補充：區網 5173 被擋）：server `PORT` 預設 80；`vite.config.ts` `server.port: 80`、`strictPort: true`；tunnel script 指向 `localhost:80`；`shareUrls` 對 80 不印埠號；`EADDRINUSE`／`EACCES` 給明確提示；README、遊戲清單頁等所有網址去掉 `:3000`；e2e 不受影響（隨機埠） | architecture §3；Rex 實測：macOS 一般使用者可綁 80 |
| ✅ | Room 小修（Phase 2 驗收定案）：回 idle 時清除所有 hasGuessed；choosing 中猜題者走光 → `abort('cancelled')`「猜題者都離開了」；`setTopic` 無猜題者 → `NOT_ENOUGH_PLAYERS`；對應測試 | architecture §5 |
| ✅ | 倒數顯示 clamp 到階段長度（修剛開始顯示 01:01） | architecture §7 countdown.ts |
| ✅ | `theme.css` 補 `--bg-button-secondary(-hover)` 兩個 token 與 `@theme inline` 映射，ToolBar 次要按鈕改用 | DESIGN §3、§6 |
| ✅ | server：`chat:send` 判定表（architecture §5）、防洩題、間隔限制、`CHAT_HISTORY` 環狀緩衝、快照帶聊天 | 測試：猜對、洩題、非 drawing 階段 |
| ✅ | server `scoring.ts`：猜對者分數公式、畫師結算；全員猜對觸發 `end` | 測試邊界：0 秒、90 秒 |
| ✅ | server：`ended` 揭曉 system 訊息、5 秒後回 idle | |
| ✅ | client `ChatPanel`：訊息列表（chat / system / correct 三種樣式）、輸入、ack 錯誤提示（洩題被擋） | Enter 送出 |
| ✅ | client：分數即時更新、回合結束揭曉顯示 | |
| ✅ | 驗證：B 猜對顯示「B 猜對了」且原文不出現；B 再打題目被擋；全員猜對回合自動結束並揭曉；分數符合公式 | |

### Phase 4：IDE 偽裝介面

> ✅ 2026-09-24 舵手規格符合性驗收通過（待補件後 Rex 目視）：四項指令自跑皆 0（shared 39、server 252、draw-guess 106）；無色碼、無 emoji 圖示、無 window.confirm；34+ token 與 theme.css 相符。舵手以內建瀏覽器開建置版（:3181）兩分頁實跑整回合：暱稱快速輸入框、EXPLORER 玩家檔案樹、canvas.ts ● 分頁與假行號、畫師工具列、橘色狀態列、筆跡同步、猜錯廣播、部分命中被擋並放回輸入框、猜對「✓ Bob 猜對了」、揭曉「題目是 貓（全員猜對）」、分數 +20/+58、5 秒後回等待「上一回合：全員猜對」。**發現兩個要補件的問題**：畫布邊界不可見、橘色狀態列白字對比 3.81:1；連同龍骨提問 6、8、9 的 token 一併補件（下方「Phase 4 補件」列）。

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | **Phase 4 補件（舵手驗收定案，Rex 目視前完成）**：`--bg-statusbar-drawer` 改 `#b5561f`；畫布加 1px `--border` 外框；`theme.css` 新增 `--statusbar-hover`、`--focus-on-color`、`--quickinput-shadow` 並改用 token（不得寫死 rgba）；狀態列 hover／focus 改用新 token | DESIGN §3、§9、§11；完成後通知舵手，再請 Rex 目視。2026-09-24 龍骨完成：畫布外框用 `outline-1 outline-border`（不用 border，避免吃掉內容區使 16:9 變形與指標座標偏 1px），實測拖曳座標與筆跡位置吻合 |
| ✅ | Room 小修（Phase 3 驗收定案）：猜對時加發 `round:update` 讓 correctIds 即時同步；對應測試 | architecture §5「猜對時的廣播」 |
| ✅ | 建立根目錄 `DESIGN.md`：Dark+ 基底、偽裝第 2 級、色彩 token、殼層尺寸、聊天格式、元件規範 | 2026-09-24 Rex 授權舵手決定，看成品再微調 |
| ✅ | `styles/theme.css` 主題 token；Tailwind v4 `@theme inline` 映射 | 依 DESIGN.md §3、§10；元件內不得出現色碼。已於 Phase 0 補件完成，舵手驗收 34 個 token 全符 |
| ✅ | `IdeShell`：活動列、側欄 EXPLORER、編輯區分頁、底部 TERMINAL 面板、狀態列 | 對照 architecture §7 表格 |
| ✅ | 各 feature 套入殼層：玩家清單偽裝檔案樹、聊天偽裝終端機、倒數與階段放狀態列 | |
| ✅ | 驗證：主 session 以瀏覽器截圖比對 DESIGN.md；整體第一眼像編輯器 | 2026-09-24 舵手瀏覽器實測通過；Rex 目視「大致 OK」，三項增修列為 Phase 6（原備註：Rex 目視驗收。2026-09-24 龍骨已完成截圖比對與回歸實測（出題、作畫同步、放棄確認、猜對→全員猜對揭曉、標題 ●、畫師狀態列橘），**待 Rex 目視**） |

### Phase 5：區網部署與驗收

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | `npm run build` + `npm start` 流程文件化（README）：查 IP、防火牆、同事連線網址 | |
| ✅ | 兩台以上實體裝置經區網實測：延遲、30 人壓力可用 30 個分頁模擬 | 2026-09-24 先做可自動化的部分：30 客戶端壓測腳本（`user/protocol/draw-guess-load.mjs`）與實機實測步驟文件；實體裝置實測需 Rex。**壓測已完成**：30 人 ×3 次、50 人、51 人（ROOM_FULL）、ROUNDS=2 全 PASS，無掉訊息，op 延遲 p50 ≈1 ms／p95 ≈2–3 ms／max 15.9 ms（loopback，非真實區網），RSS 30 人約 85 MB、50 人約 112 MB 無洩漏跡象。2026-09-25 Rex 實機實測回報「都正常」 |
| ✅ | 踩雷紀錄整理 | 寫在本檔；各 Phase 驗收時已逐段寫入（Phase 0–6、部署實測），2026-09-25 龍骨確認 |

### Phase 6：Rex 目視回饋（畫具強化；與 Phase 5 並行）

> 2026-09-24 Rex 目視 Phase 4「大致 OK」，提出三項增修。前兩項動契約（`shared/` 常數與 server 驗證），第三項純客戶端。

> ✅ 2026-09-24 舵手規格符合性驗收通過（待 Rex 第二次目視）：四項指令自跑皆 0（shared 54、server 277、draw-guess 147）；events.ts 與 spec 逐字一致；常數 BRUSH_MIN/MAX/DEFAULT、COLOR_PATTERN 到位，BRUSH_SIZES 全數移除。舵手協定測試 `user/protocol/draw-guess-phase6.mjs` 5/5（含小寫色碼原樣轉發、11 種非法色碼／粗細丟棄、橡皮擦帶色）。瀏覽器實測（:3181 新 build，667px 窄版）：「⋯」面板、色相條選綠、滑桿拖到 56 與提示「粗細 56」、橡皮擦懸停提示、兩筆粗綠線 Bob 端即時同步。踩雷：舵手的預覽伺服器是舊 build 的程序，靜態檔新、驗證舊，導致一度誤判筆跡不同步；驗收前必須重啟 server 程序。龍骨提問 9 項已定案回寫（architecture §12、DESIGN §12）。

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | `shared`：`BRUSH_SIZES` 改為 `BRUSH_MIN = 1`、`BRUSH_MAX = 64`（預設 4）；`PALETTE` 保留為預設色塊；新增 `COLOR_PATTERN`；`events.ts` 的 `begin` 註解照 §4 逐字更新 | architecture §4 |
| ✅ | server `drawOp.ts`：`color` 改驗 `COLOR_PATTERN`、`size` 改驗整數且在範圍內；更新單元與 e2e 測試（含邊界 0、65、非整數、`#fff` 短碼、小寫色碼） | architecture §5「draw:op 驗證」 |
| ✅ | client `ToolBar`：粗細滑桿（拖曳／點擊／鍵盤，1–64，數值與預覽圓點）；色相條（拖曳／點擊／鍵盤，hsl → `#RRGGBB` 大寫）；預設色塊保留；目前色圓點；窄版收進「⋯」 | DESIGN §5、§6 |
| ✅ | client `Tooltip` 元件：所有圖示按鈕與色塊、滑桿、色相條懸停／focus 顯示功能名稱；同時補 `aria-label` | DESIGN §6「工具提示」 |
| ✅ | `render.ts`：任意色與 1–64 粗細渲染無異常（橡皮擦忽略色）；單點落點圓半徑隨 size | architecture §6 |
| ✅ | 驗證：舵手協定測試補 Phase 6 案例（任意色通過、短碼／非法色被丟棄、size 65 與 0.5 被丟棄）；瀏覽器實測拖曳滑桿與色相條、懸停提示；Rex 再目視 | 2026-09-25 舵手協定測試 draw-guess-phase6.mjs 5/5、瀏覽器實測通過；Rex 目視「目前沒問題」 |

> 💡 **任務粒度**：每個任務應在 1–4 小時內可完成。過大的任務切成子項。

---

## 驗收標準

Epic 完成需通過以下條件：

- [x] `npm run typecheck`、`npm test`、`npm run build` 各自 exit 0
- [x] `Room` 狀態機測試涵蓋 architecture §5 每一列與離線邊界
- [x] 區網內另一台裝置以 `http://<IP>/draw-guess/`（80 埠）完整玩完一回合（出題、畫、猜對、揭曉、計分）（2026-09-25 Rex 實機「都正常」）
- [x] 中途加入者能看到既有筆跡與最近聊天
- [x] 介面符合 `DESIGN.md`，Rex 目視確認「像編輯器」（2026-09-24 大致 OK）
- [x] Phase 6 三項增修完成並經 Rex 再目視（2026-09-25）
- [x] `spec/architecture.md` 與實作一致（事件、常數、結構）；差異已回寫

---

## 派工規範（給龍骨）

- 每個 Phase 派一個子代理或分前後端兩個；派工 prompt 給**絕對路徑**並要求先讀 `spec/architecture.md` 對應章節。
- 前後端並行時，事件契約以 `shared/` 為準，**誰改 `shared/` 要在回報寫明**；規格疑義找舵手，不自行改 spec。
- 回報必須附各驗證指令的 exit code；UI 類要附截圖。
- 子代理 prompt 註明：「你是龍骨（Keel）派出的子代理，沒有團隊身分：不要登記名冊、不要跨 session 傳訊、不要自稱名冊裡的名字。」
- **多 session 共改本檔與 `backlog.md` 一律局部替換（Edit / 精確字串取代），禁止整檔寫入**；改之前先讀當下內容。2026-09-24 曾因整檔覆寫蓋掉另一 session 的修改。

---

## 踩雷紀錄

### Phase 0（2026-09-24，龍骨驗收）

- **TypeScript 7 與 typescript-eslint 不相容**：`typescript@latest` 為 7.0.2，typescript-eslint 8.70 要求 `<6.1.0`。鎖 `typescript: "~6.0.3"`。
- **Vitest 5 不支援 Node 25**：engines 只列 22、24、≥26，Rex 本機為 25.8。改用 `vitest: "^4.1.11"`。
- **沒有測試檔的 workspace 讓 `npm test` 失敗**：Vitest 找不到測試預設回非 0。server、draw-guess 的 test script 加 `--passWithNoTests`；根目錄 `npm run test --workspaces` 任一失敗即非 0。
- **tsup 預設不打包 dependencies**：shared 的 `exports` 直接指向 `.ts`，不加 `noExternal: ['@fishing-work/shared']` 的話 `node dist/index.js` 會 import 到 `.ts` 而失敗。
- **Express 5 萬用字元要具名**：`/draw-guess/{*splat}` 同時比對 `/draw-guess/` 與深層路徑。
- **靜態檔路徑同時適用 dev 與 build**：`static.ts` 在 `server/src/`、打包後在 `server/dist/`，皆在 `server/` 下一層，以 `import.meta.url` 往上一層取 server 根目錄。
- **draw-guess 用兩份 tsconfig**：app（DOM 型別）與 `vite.config.ts`（Node 型別）分別 `tsc --noEmit -p`，不用 Vite 範本的 project references + `tsc -b`。
- **驗收腳本在 zsh 用 `for c in "npm run x"; do $c` 會 exit 127**：zsh 不做字詞分割，要用 `eval "$c"`（龍骨自己踩的，與專案無關）。

### Phase 1（2026-09-24，龍骨驗收）

- **`nsp.to([])` 會廣播給整個 namespace**：收件者為空時必須跳過，register 的 applyEffects 已擋。
- **快照要在 ack callback 內同步套用**：polling 傳輸時 ack 與後續廣播可能同一封包同步解開；若 `await emitWithAck` 再套快照，會晚於廣播而蓋掉剛收到的訊息。
- **整合測試連跑兩次會撞 NICKNAME_TAKEN**：上一輪玩家仍在 15 秒寬限期內，屬正確行為；重跑前重啟 server 或等 15 秒。
- **`noUnusedLocals` 會報未使用的 private 成員**：Phase 2 擴充點（`afterPlayerLeft`）因此宣告為 `protected`。
- **瀏覽器「複製分頁」會連 sessionStorage 一起複製**：兩分頁帶同一 token 會互相接管；被接管的分頁收到 `io server disconnect` 時清憑證回暱稱頁並提示。
- **socket↔player 對應放在 Room**：「舊 socket 的 disconnect 不得觸發寬限」與「同 socket 重複 join」都靠它判斷，放 Room 才能單元測試；register 只查詢與執行效果。

### Phase 2（2026-09-24，龍骨驗收）

- **`crypto.randomUUID` 在區網 http 下不存在**：只在 https 或 localhost 提供，同事用 `http://<IP>:3000` 連線時是 undefined；本機測試容易漏掉。strokeId 改為有就用、沒有就「時間＋序號＋亂數」。
- **單點用零長度線段畫不出來**：`moveTo` 後 `lineTo` 同一點在部分瀏覽器不畫圓頭，begin 落點改用 `arc` + `fill`。
- **JSX 內全形空白（U+3000）觸發 ESLint `no-irregular-whitespace`**：改用 margin 排版。
- **畫布等比縮放用 CSS container query**：外層 `container-type:size`，畫布寬 `min(100cqw, 100cqh×16/9)`，寬高任一受限都不變形。
- **e2e 的 ack／廣播順序**：join 的 ack resolve 後，同一次 join 的廣播可能晚到；收集器要在 join 前掛好、斷言取最新一則，否則約 2/12 機率失敗。
- **Socket.IO 的 callback 一律在最後一個參數**：volunteer／cancel 的 ack 是第一個參數，setTopic 不帶 payload 時第一個參數就是函式；server 用 `splitArgs` 統一處理。
- **`{ ok: true, data: undefined }` 序列化後變成 `{ ok: true }`**：客戶端判斷 ack 不可依賴 `data` 鍵存在。
- **非畫師人數為 0 時「剩餘非畫師全猜對」空泛成立**：leave 的判斷須先檢查人數 0（cancelled）再檢查 allGuessed，否則 cancelled 永遠觸發不到。
- **瀏覽器自動化點工具列要用元素 ref**：多分頁時截圖座標框會變，用座標點擊可能落空（龍骨驗收時踩到，與專案無關）。

### Phase 3（2026-09-24，龍骨驗收）

- **Zustand v5 selector 不可回傳新陣列／物件**：例如 `s.players.filter(...)` 會無限重繪（getSnapshot should be cached）；改選原始值（數字）或用 shallow 比較。
- **input `maxLength` 以 UTF-16 計**：emoji 算 2，與 spec 的 code point 計數不同，不能直接設成 CHAT_MAX；長度以 server 為準。
- **中文輸入法按 Enter 選字**：用 form 原生 submit 不會在注音選字時觸發；若改自訂 keydown 處理要加 composition 判斷，否則 Safari 會送出半套字。
- **`vite --port` 會覆蓋 config 的 80**：搭配 `--strictPort` 可在臨時埠冒煙測試而不占 80。
- **Room 欄位與方法撞名**：原 `chat` 緩衝欄位與新 `chat()` 方法同名，欄位改名 `chatLog`。
- **桌面 app 的瀏覽器窗格會自動重連 localhost:3000**：驗收留下的分頁會在下一次有人於 3000 開 server 時以舊暱稱加入，干擾測試；驗完要關分頁，協定／手動驗證改用隔離埠加 `HOST=127.0.0.1`。
- **背景程序要記 node 本身的 pid**：用子 shell 包 nohup 時 pgrep 抓到外層 shell，殺掉後 node 被 launchd 收養繼續占埠；直接用 `$!` 或 `env PORT=… node … &` 記 pid。
- **zsh 環境沒有 `timeout` 指令**（exit 127）。
- **被擋的聊天訊息會放回輸入框**：方便使用者修改，但接著打字會接在後面；驗收時要先清空輸入框（UX 行為，非 bug）。

### Phase 4（2026-09-24，龍骨驗收）

- **macOS 檔名不分大小寫**：`RoundStatus.tsx` 與 `roundStatus.ts` 撞名，TypeScript 報 TS1261／TS1149；純邏輯檔改名 `roundDisplay.ts`。
- **Tailwind v4 `@theme inline` 變數自我參照**：`--shadow-quickinput: var(--shadow-quickinput)` 形成循環；`:root` 端改名 `--quickinput-shadow`。
- **SVG 屬性不吃 `var()`**：`fontFamily="var(--font-code)"` 無效，改為繼承外層字型。
- **flex 容器上的 `truncate` 無效**：文字直接放在 flex 容器裡不會出 `…`，要內層再包一個 span。
- **浮層不能放在 `overflow-x-auto` 容器內**：放棄確認改由 `uiStore` 控制、渲染在編輯區。
- **瀏覽器窗格截圖無法存檔**：子代理改用本機 Chrome headless + CDP（Node 25 內建 WebSocket）產生截圖，不需裝套件。
- **畫布底色與編輯區同色**：`--bg-canvas` = `--bg-editor`，畫師看不出可畫範圍；補件加 1px 外框，是否改純黑待 Rex 決定（DESIGN §3 已預留）。
- **畫布外框要用 outline 不用 border**：Tailwind preflight 是 border-box，border 會吃掉 `aspect-video` 的內容區、讓 1280×720 邏輯畫布微幅變形，`getBoundingClientRect` 也會把邊框算進去造成座標偏 1px；outline 不影響版面。
- **瀏覽器窗格的 resize_window 模擬尺寸與截圖座標框比例不同時，拖曳座標會失準**：驗收畫布座標要在未模擬尺寸（desktop preset）下做（龍骨驗收時踩到，與專案無關）。

### Phase 5（2026-09-24，龍骨驗收）

- **`nohup` 擋不住 node 被 SIGHUP 結束**：node 啟動時把訊號處理重設為預設，關掉終端機 server 仍會停；要常駐用 tmux 或保持終端機開著，防睡眠用 `caffeinate -i npm start`（筆電闔上螢幕仍會睡）。
- **滿房後約 15 秒內新玩家拿到 ROOM_FULL**：斷線者在寬限期內仍占名額（符合 spec）；連跑壓測或滿房重開局要等寬限期過，README 常見問題已寫。
- **zsh 會把 `echo =====` 當成 `=cmd` 展開**：回報「not found」並 exit 1，分隔線要加引號。
- **壓測量延遲的方法**：op 沒有時間戳，先驗證「收到的第 i 則 == 送出的第 i 則」（排序鍵值的 JSON 比對，避免欄位順序差異誤判），再用同程序 `performance.now()` 相減。
- **loopback 延遲不代表真實區網**：壓測只走 WebSocket、同機，未涵蓋 polling→WebSocket 升級與實體網路；真實延遲靠 `user/lan-test-checklist.md` 實機目視。

### Phase 6（2026-09-24，龍骨驗收）

- **只差大小寫的檔名又撞了**：`Tooltip.tsx` 與 `tooltip.ts` 在 macOS 撞名（同 Phase 4 的坑），純邏輯檔改名 `tooltipPlacement.ts`。純邏輯檔一律取不同字根，不要只靠大小寫區分。
- **`overflow-x-auto` 容器內 `justify-end` 溢出的內容捲不到**：溢出往左跑、無法捲回；改用 `justify-end-safe`。
- **滑桿在目前值上點擊也要觸發**：若只在值改變時才回呼，點色相條目前位置不會切回該色；pointerdown 與按鍵一律觸發。
- **浮層（「⋯」面板、Tooltip）要 portal 到 body**：放在工具列裡會被 overflow 容器裁掉。
- **瀏覽器窗格截圖可能落後 DOM 一步**：DOM 已更新但截圖還沒；把分頁切到前景或用 JS 讀 DOM 確認。
- **Phase 6 後壓測回歸**：新 build 以隔離埠 3190 跑 30 人 33/33 PASS，op p95 2.3 ms、chat p95 2.8 ms，RSS 72→85 MB，server log 無 warn／error。

### 部署實測（2026-09-24，Rex 回報、龍骨修正）

- **Vite dev server 擋 tunnel 網址**：Rex 以 `npm run dev`（Vite 綁 80）+ cloudflared 分享，瀏覽器顯示「Blocked request. This host ("*.trycloudflare.com") is not allowed」。Vite 預設只接受 localhost 與 IP 的 Host 標頭，`<電腦名稱>.local` 也會被擋。修正：`draw-guess/vite.config.ts` 加 `server.allowedHosts: ['.trycloudflare.com', '.local']`；以 Host 標頭實測 trycloudflare／.local 200、其他網域仍 403。正式版（`npm start`，Express）沒有此檢查。
- **tunnel 建議接正式版**：dev 的 HMR websocket 經 tunnel 會連不上（console 報錯，不影響遊戲）；分享給同事用 `npm run build` → `npm start` → `npm run tunnel`。
