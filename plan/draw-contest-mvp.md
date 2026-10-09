# Epic 14：繪圖比賽 MVP（draw-contest）

> 平台第二款遊戲：一人出題、大家同時畫、評分器打分排名、投影片瀏覽揭曉；先用隨機評分讓沒有 AI 也能試玩

**狀態**：✅（2026-10-09 完成：Phase 0–3 工程與 acceptance-reviewer 驗收通過；Rex 真模型目視與區網實機通過；揭曉畫廊「不夠顯眼」先不改）
**起訖**：2026-10-07 ~ 2026-10-09
**負責**：Rex × 羅盤（Compass，規格與計畫）× 帆（Sail，派工與驗收）× 舵手（Helm，共用層定案）× acceptance-reviewer（驗收）

---

## 需求（Rex 2026-10-07）

1. 先一個偽裝：簡報。
2. 「我來畫」改為「我出題」，由玩家出題（例如蘋果）。
3. 題目出完後所有人進繪圖模式（120 秒）。
4. 畫完後圖片給模型打分；**評分先用隨機**，沒有 AI 也能試玩。模型用 Clef 決策模型（`ggml-org/Clef-GGUF`），之後以 Ollama 本機部署，相似度分數交給它。
5. 秀出分數與排名，並展示大家的畫（排版由團隊設計）。
6. 注意 Docker 部署後與本機 Ollama 的連線。

規格：[spec/draw-contest/overview.md](../spec/draw-contest/overview.md)（規則）、[architecture.md](../spec/draw-contest/architecture.md)（契約、狀態機、評分器、部署）、[design.md](../spec/draw-contest/design.md)（畫面對照）。

## 設計決策

- 決策 1：**前端完全獨立**（Rex 2026-10-07 定案）：新 workspace `draw-contest/`，不引用 `draw-guess/`；殼層與首頁**複製**自 draw-guess 工作區現況（2026-10-07，含 Epic 10–13 未 commit 的改動），之後各走各的、不同步。原因：兩款遊戲差異大，只是剛好都畫畫。
- 決策 2：**server 的房間／重連／暱稱邏輯複製，不抽共用**（待舵手定案）：`server/src/games/draw-contest/` 自成一套，draw-guess 零改動。原因：spec/draw-contest/architecture §1。
- 決策 3：**筆跡只在本機，交卷送 PNG**：不做即時中繼，server 不存 ops。原因：沒人需要即時看別人畫；省掉最複雜的一段；重新整理會失去未交卷的畫（可接受，寫進規則 10）。
- 決策 4：**評分器介面化、MVP 預設 random**：`Judge` 介面＋`random`／`ollama` 兩實作，環境變數 `JUDGE` 切換；random 以圖片雜湊當種子（確定性），帶假延遲讓「評分中 n/m」看得到。原因：Rex 需求 4；模型未下載。
- 決策 5：**交卷即評、一次一張、失敗退回 random 且本回合剩餘全走 random**：有界等待，AI 掛掉比賽仍能收場。原因：architecture §6。
- 決策 6：**交卷後不能改**；所有參賽者交卷即提前揭曉；時間到自動交卷（5 秒寬限）。原因：交卷即評，改圖會作廢已評分數。
- 決策 7：**出題者也一起畫**；題目對所有人公開。原因：不是猜題遊戲，公開題目沒有優勢。
- 決策 8：**揭曉＝投影片瀏覽**、無倒數、停到下一回合；中途加入者在 join 後補收畫廊。原因：Rex 需求 5；簡報的檢視模式天生就是畫廊。
- 決策 9：**Ollama 不進映像**，容器以 `OLLAMA_URL=http://host.docker.internal:11434` 連主機；compose 加 `extra_hosts: host.docker.internal:host-gateway`；Linux 主機要 `OLLAMA_HOST=0.0.0.0`。原因：模型 18 GB；Rex 需求 6。
- 決策 10：**`shared` 只經子路徑匯出** `@fishing-work/shared/draw-contest`，不進根匯出。原因：型別名稱（`PlayerPublic`、`RoundPublic`…）與 draw-guess 衝突。
- 決策 11：**開發腳本另加 `dev:contest`**，`npm run dev` 不變；contest 的 Vite dev 綁 3001。原因：80 已被 draw-guess 的 dev server 占用；不影響舵手那邊的流程。

## 版面對照

見 [spec/draw-contest/design.md](../spec/draw-contest/design.md) §2（各階段）、§3（投影片瀏覽）。

---

## 任務清單

### Phase 0：共用層（舵手 2026-10-07 定案，附條件；帆派工；每項都是加法、不改 draw-guess 行為）

**舵手定案條件**（驗收必查）：
- 複製的 `room.ts` 檔頭註明「複製自 draw-guess/room.ts @ commit a0587dd，獨立演進」；`draw-guess/` 下零 diff；驗收必跑 `user/protocol/draw-guess-*.mjs` 全部（phase1／2／3／6／image／background）全過。
- `npm run dev`、`npm start`、`npm run build` 的 draw-guess 行為不變；新 workspace 必須有 `typecheck` 與 `test` script（無測試時 `vitest run --passWithNoTests`），否則 `npm test --workspaces` 會炸。
- shared 子路徑由 tsup `noExternal` 一併打包，不改 tsup 設定；驗收確認 `server/dist/index.js` 不含對 shared 的 require。
- `/draw-guess` 的 SPA fallback（無副檔名回 index、帶副檔名 404）與 `/healthz` 逐字不變；`static.missing` 警告每款各一則。
- `PUBLIC_URL` 語意不變（仍是我畫你猜的完整網址）；`shareLog` 由 origin 推出第二款：`server.lan` 事件加 `games: ["/draw-guess/","/draw-contest/"]` 與 `shareContest`，既有 `share`／`local`／`source` 欄位不變；容器提示加一句「繪圖比賽為 /draw-contest/」；`shareLog.test.ts` 既有 9 例不得改、只能加。
- Docker 驗收照 Epic 9：非 80 主機埠 build＋跑一次，`/draw-contest/` 與 `/draw-guess/` 都載得到，回報映像大小。
- README 的「繪圖比賽」與「Ollama 連線」兩節放在 Docker 一節之後，不改既有段落。
- 資料夾歸屬：`server/src/games/draw-contest/`、`shared/src/draw-contest/`、`draw-contest/` 歸羅盤與帆；`server/src/{app,index,static}.ts`、`shared/package.json`、根 `package.json`、Dockerfile、compose、README 既有段落仍是共用層，六項以外的改動要知會舵手。

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | 根 `package.json`：workspaces 加 `draw-contest`；scripts 加 `dev:contest`（server :3000 ＋ contest Vite :3001）、`build` 加 contest、`lint` 加 contest | typecheck／test 用 `--workspaces` 自動涵蓋 |
| ✅ | `shared/package.json` exports 加 `./draw-contest`；新增 `shared/src/draw-contest/{events,constants,nickname,text,index}.ts`（§4 逐字） | 不動 `shared/src/index.ts`；2026-10-07 新檔先行（帆派子代理，含 shared/test/draw-contest.*.test.ts）；exports 那一行舵手 2026-10-07 定案，併入 Phase 0 子代理（static／index／shareLog／public／Docker／README／exports）；根 `package.json` 由 Phase 2 腳手架子代理做、`app.ts` 由 Phase 1 server 子代理做（避免多個子代理同改一檔）；Docker 實跑驗收待客戶端可建置後 |
| ✅ | `server/src/static.ts`：以清單方式掛 `/draw-guess`、`/draw-contest` 兩個靜態目錄＋SPA fallback；`server/public/index.html` 加「繪圖比賽 → /draw-contest/」；`server/src/index.ts` log 的 games 加 namespace、分享網址印兩款 | 舵手提示：維持 `server/..` 相對路徑 |
| ✅ | `server/src/app.ts`：註冊 `/draw-contest` namespace（`registerDrawContest`）；`App` 介面加 `drawContestRoom`；`close()` 一併 dispose | 契約 §4 |
| ✅ | `Dockerfile`／`docker-compose.yml`：複製 `draw-contest/package.json` 與 `dist`；compose 加 `JUDGE`、`OLLAMA_URL`、`JUDGE_MODEL`、`extra_hosts` | 決策 9；`.dockerignore` 檢查不排除 contest |
| ✅ | `spec/architecture.md` §1／§3 加繪圖比賽一行與環境變數表（舵手 2026-10-07 已回寫） | |
| ✅ | `README.md` 加「繪圖比賽」與「Ollama 連線」兩節（Docker 一節之後；macOS Docker Desktop 直連、Linux 需 `OLLAMA_HOST=0.0.0.0`） | 不改既有段落 |

### Phase 1：server 與契約（帆派工）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | `room.ts`：加入／接管／寬限／暱稱（複製 draw-guess 寫法）＋ 狀態機 §5（idle→choosing→drawing→judging→ended）、參賽者定案、交卷、佇列回呼、results、總分；Effect 模式、注入時鐘 | 單元測試：狀態轉移、全員交卷提前結束、寬限補交、離開者移除、同分排序 |
| ✅ | `submission.ts`（PNG magic＋IHDR 尺寸）、`ranking.ts`（純函式）、`chat` 驗證與節流 | 單元測試 |
| ✅ | `judge/`：`types`、`random`（FNV-1a 種子、假延遲）、`queue`（一次一張、逾時、退回 random、丟棄離開者）、`index`（讀 `JUDGE` 等環境變數） | `ollama.ts` 留 Phase 3；單元測試：確定性、逾時退回、佇列順序 |
| ✅ | `register.ts`：事件接線、payload 形狀驗證、二進位 `png` 讀取、log 事件名 `draw-contest.*` | Socket.IO `maxHttpBufferSize` 取兩遊戲上限的最大值（draw-guess 的 10 MB 已夠） |
| ✅ | 協定測試 `user/protocol/draw-contest-phase1.mjs`（2026-10-07 帆派子代理寫草稿，Phase 0 接線後才跑得起來）：§8 清單；`JUDGE=random JUDGE_FAKE_DELAY_MS=0`；與 draw-guess 協定測試並存全過 | 2026-10-07 快速段 97/97、`TEST_SLOW=1` 107/107（含 lastTopic）；draw-guess phase1／2／3／6／image／background 全過；server vitest 487 例；2026-10-07 acceptance-reviewer 驗收 Phase 0＋1 通過（Docker 映像 362 MB） |

### Phase 2：客戶端（帆派工）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | 建 `draw-contest/`（package／tsconfig／eslint／vite：base `/draw-contest/`、port 3001、proxy）；複製 §7 列出的目錄；刪 vscode／meet／excel；`theme.css` 只留 `:root`／`home`／`ppt`；偏好鍵改 `fishing-work:draw-contest:*`；`index.html` 內嵌腳本 | 決策 1、10、11 |
| ✅ | store／socket：對接 §4 契約；`gallery` object URL 生命週期；自動交卷（endsAt 到時匯出 PNG） | |
| ✅ | 畫布改純本機：移除 `draw:op` 送出、保留 undo／clear／背景色；`exportPng()` 以 1280×720 離屏 canvas 輸出 | |
| ✅ | 首頁（一張「簡報」卡）、簡報殼層各階段（design §2）：我出題、「輸入標題」、繪圖分頁＋「完成」與「儲存投影片？」確認、備忘稿列文案、縮圖卡狀態（已儲存勾、旁觀）、鎖定畫布 | 殼層不讀 store（shellBoundary 沿用） |
| ✅ | `features/reveal/` 投影片瀏覽（design §3）：網格、名次、分數、「隨機」小字、未儲存空白、前三名高亮、自己高亮；放大可選 | |
| ✅ | 說明內容改寫（六個主題改為繪圖比賽流程）；聊天純文字 | |
| ✅ | 測試：複製並調整 draw-guess 的客戶端測試（shellBoundary、themeCatalog、store、countdown 等）；新增 reveal、exportPng、自動交卷測試 | |
| ✅ | 驗證：四項 0；瀏覽器兩分頁跑完一回合（出題→兩人畫→交卷→評分中→投影片瀏覽）；截圖 1280／1024／800／375 | 2026-10-07 帆派子代理：四項 0（draw-contest 26 檔 561 例）；建置版一分頁＋4 個 socket 機器人跑兩回合（含確認框、自動交卷、揭曉重整重連、出題取消），console 無訊息；ppt 工具列斷點 500 → **540px**（「完成」獨立插槽固定在功能區右端）；截圖在帆的 scratchpad `ep14-phase2/`；2026-10-07 acceptance-reviewer 驗收 Phase 2 通過（8 項，3 回合、真等 120 秒自動交卷、540／539 斷點）；揭曉網格間距 `gap-4`（ppt 根字級 13px＝13px）改 `gap-[16px]` 對齊 design §3 |

### Phase 3：Clef 決策模型（模型下載後）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | `judge/ollama.ts`：`POST /v1/systemone`（base64 PNG、三題、合成分數、AbortSignal 逾時）；`JUDGE=ollama` 時連不上啟動只 log warn（非阻塞），每回合仍先試 ollama、失敗才退回 random（只影響該回合）；送模型前以純 JS（建議 `pngjs`）把 PNG 縮到 `JUDGE_IMAGE_WIDTH` 640×360 | architecture §3、§6（2026-10-07 羅盤實測：640 約 4.5 秒、不反白） |
| ✅ | `user/mock/systemone.mjs` 假 Ollama（同格式、雜湊分數）；`ollama.ts` 單元測試對假伺服器跑 | |
| ✅ | 本機實測（2026-10-07 羅盤，Rex 已下載 `clef:27b-q4_k_m`、M5 32 GB）：1280 約 14 秒、640 約 4.5 秒；蘋果 63 分 vs 汽車 11 分；黑底不需反白；結果已寫回 spec §6 | 剩：中文題目實測一次（接好後由帆做） |
| ✅ | Docker 實測：`docker compose up -d --build`，容器連 `host.docker.internal:11434` 評分成功；README 寫 macOS／Linux 兩種設定 | 決策 9；2026-10-07 acceptance-reviewer 驗收 Phase 3 有條件通過（10 項過；容器 judgedBy ai、蘋果 82／空白 4、單張約 4.7–5.0 秒；映像 363 MB、pngjs 7.0.0、無 @types；探測非阻塞的字面條件待舵手定案） |
| ✅ | 預設 `JUDGE` 改為 `ollama`（judge/index.ts、compose `${JUDGE:-ollama}`、README；spec §3 表已改）；連不上自動退回 random | Rex 2026-10-07 定案：改 |

### Phase 4：驗收

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | `acceptance-reviewer` 驗收（四項、契約逐字比對、協定測試、draw-guess 協定測試不受影響、瀏覽器兩分頁一回合） | 2026-10-07 分兩次驗收（Phase 0＋1 七項、Phase 2 八項）皆通過，羅盤定案；已知限制：375px 備忘稿截斷、「說明」分頁與垃圾桶在捲動區外（手機範圍外） |
| ✅ | Rex 目視與區網實機 | 2026-10-07 本機隨機模式 OK；2026-10-09 真模型（預設 ollama）試玩 OK、區網同事連線 OK；揭曉畫廊「不夠顯眼」，Rex 決定先不改 |

---

## 驗收標準

- [x] 首頁 `/` 多「繪圖比賽」入口；`/draw-contest/` 首頁輸入暱稱、選「簡報」進殼層（2026-10-07 驗收通過）
- [x] 兩人以上：我出題 → 輸入標題 → 所有人同時作畫 120 秒（含出題者）→ 完成／自動交卷 → 「正在評分 n/m」→ 投影片瀏覽顯示每人的畫、分數、名次，前三名高亮；`JUDGE=random` 下標示隨機評分（2026-10-07 驗收：4 分頁＋2 機器人 3 回合，真等 120 秒自動交卷）
- [x] 中途加入者本回合旁觀、揭曉後看得到畫廊；重新整理自動重連；所有人交卷即提前揭曉（2026-10-07 驗收：前兩項瀏覽器實測，提前揭曉由協定測試與 e2e 覆蓋）
- [x] `shared/src/draw-contest/events.ts` 與 spec §4 逐字相同；`user/protocol/draw-contest-phase1.mjs` 全過；`user/protocol/draw-guess-*.mjs` 仍全過（2026-10-07 acceptance-reviewer：97／107、draw-guess 六支全過）
- [x] draw-guess 的程式與截圖不受影響（`git diff --stat -- draw-guess` 為空）（2026-10-07 驗收通過）
- [x] 四項指令各自 exit 0；Docker 映像含兩款遊戲，compose 可設 `OLLAMA_URL`（2026-10-07 驗收通過：映像 362 MB、非 80 埠實跑兩款皆可載）
- [x] spec/draw-contest 三份文件、README、CLAUDE.md 與實作一致（2026-10-07 羅盤回寫完成）

---

## 派工規範（帆）

- 本檔與 `backlog.md` 只准 Edit 局部替換；不 commit；子代理不得登記名冊、不得跨 session 傳訊、不得動 git 暫存區（git mv／add／reset）；驗收前重啟 server 程序。
- **Phase 0 的每一項都是共用層**：等舵手定案後才動；動的時候只做加法，`git diff -- draw-guess` 必須為空。
- 工作區有 Epic 10–13 未 commit 的改動：不要還原、不要順手改。複製 draw-guess 的檔案時照工作區現況複製。
- 色碼只用 token；殼層不讀 store；說明與對話框文案全繁中。
- 評分器以 `JUDGE=random` 開發與測試；`ollama.ts` 不在 Phase 1／2 範圍。

---

## 踩雷紀錄

（尚無）
