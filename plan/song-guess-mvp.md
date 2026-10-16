# Epic 16：猜歌 MVP（song-guess）

> 第三款遊戲：出題者填歌手，server 從 Apple iTunes 抽 5 首 30 秒試聽，所有人同時聽、聊天室打字猜歌名；Meet 偽裝。

**狀態**：✅
**起訖**：2026-10-12 ~ 2026-10-12
**負責**：Rex × 海圖（Chart，架構師）；實作派水手長（Bosun）

---

## 需求（Rex 2026-10-12）

1. 題庫用 Apple iTunes Search API（免金鑰、30 秒試聽），server 廣播出去。
2. 先用打字猜（不做四選一）。
3. 題庫：出題者填歌手（**必填**），畫面要秀出歌手名稱。年代、曲風、預設排行榜「等等再說」。
4. 偽裝先用 Meet 一套。
5. 每首播到底，直到有人答對；答對後還是繼續播。
6. 一局 5 首歌（原「一局一首」當場修正）。

海圖預設（Rex 未反對即採用）：計分 50～100 依速度、出題者不加分（他也猜）、沒人猜對直接揭曉、每首揭曉停 5 秒。

## 可行性探測（海圖 2026-10-12）

| 項目 | 結果 |
|---|---|
| Search API `attribute=artistTerm`（台灣區） | 「孫燕姿」200 首全有試聽，年份 2000–2026；免金鑰；CORS `*` |
| 試聽檔 | 約 1 MB m4a、CORS `*`、支援 Range，瀏覽器 `<audio>` 可直接播 |
| 排行榜 RSS、`lookup?id=` | 可用（舊網域 301 轉址）；v1 不用 |
| `genreId` 參數 | 無作用；曲風索引回傳混雜；年代只能靠 `releaseDate` 事後過濾 |

---

## 設計決策

- 決策 1：**第三款獨立前端 `song-guess/`，server 房間邏輯獨立複製，契約走 `shared/song-guess/`**，與繪圖比賽同一分工。原因：Epic 14 定案的平台結構，三款互不干擾。
- 決策 2：**server 統一打 iTunes、客戶端直接向 Apple 取試聽檔**。原因：Search API 每 IP 約 20 次／分鐘，30 個客戶端各自打會超限；試聽檔 CORS 開放，server 不必轉送 30 份音訊。同事連不到 Apple CDN 才考慮中繼（範圍外）。
- 決策 3：**歌手搜尋結果快取 10 分鐘**、逾時 8 秒、失敗不中斷出題（出題者可重試）。
- 決策 4：**抽歌規則**：有試聽、歌手名含輸入字串、`normalizeTitle` 去重（Live／Remastered／伴奏只留一首）、隨機抽 5；不足 5 首 `ARTIST_NOT_FOUND`。
- 決策 5：**出題者也猜、不加分**。原因：出題者只選歌手，不知道抽到哪幾首，沒有資訊優勢。
- 決策 6：**播到底不提早結束**（Rex 需求 5）；猜對者可多人；試聽播完 server 計時器觸發揭曉，客戶端的 `<audio>` `ended` 只停播不改狀態。
- 決策 7：**時鐘同步**用 `RoundPublic.serverNow` 估偏移、`startedAt` 定位 `currentTime`；區網偏差 < 100 ms 可接受，不做 NTP 式校正。
- 決策 8：**答案判定**在 `shared/song-guess/answer.ts`：去副標（括號、` - `、feat.）→ NFKC → 去空白與標點 → 小寫；打完整歌名也算對；已猜對者含歌名的訊息擋下（防洩題）。
- 決策 9：**中途加入者可猜、可得分**，但不列入 `participantIds`；排名對象＝參賽者 ∪ 本局有得分者。原因：人越多越好玩，又不讓沒參與的人佔排名。
- 決策 10：**偽裝只做 meet**，整套抄我畫你猜 meet 殼層；舞台是純 CSS 波形動畫，不放封面與歌名；揭曉才放封面。音量滑桿是唯一的播放控制。
- 決策 11：**假 iTunes** `user/mock/itunes.mjs` 供協定測試與離線開發；協定測試用它回的短 `trackTimeMillis` 縮時，不加縮時環境變數。
- 決策 13（水手長 Q1–Q9，2026-10-12）：`durationMs = min(trackTimeMillis ?? cap, cap)`；歌手過濾不足 5 首時以最多次 `artistName` 退回再抽（英文名、別名）；`artistDisplay` 取最多次者；去副標為空退回原名、純符號歌名排除；未猜對者訊息含歌名擋下（可多人得分，原文廣播＝送分）；`results` 進第 1 首才清；局中離開不進排名；`START_DELAY_MS` 1500 起播緩衝（客戶端先下載 1 MB 試聽再同時起播，計分從 `startedAt` 起算）。
- 決策 14（水手長實作回報 1–12，2026-10-12）：feat. 字界規則；歌手比對不去標點；最多次 artistName 退回須佔原始結果過半；括號開頭歌名直接不抽、`titleLength` 不含空白標點；`lastArtist` 改正式名；揭曉卡歌手行用 `--fg`（DESIGN §15.1 優先）；音量滑桿浮在圖示上方等版面取捨照實作；遊戲清單不加簡介（比照既有）；補 `song-guess/README.md` 與 `user/lan-test-checklist.md` 猜歌段、README 舊敘述改三款。
- 決策 12：共用層改動（海圖定案、同步平台 spec §1／§3）：`static.ts` 加 `/song-guess`、遊戲清單加一列、`shareLog` games 加一鍵、根 scripts 與 workspaces、`draw-guess/vite.config.ts` 加 `/song-guess` → `:7182`、Dockerfile 多一份 dist；開發埠 song-guess Vite **7182**。

---

## 任務清單

### Phase 0：規格（海圖）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | spec/song-guess/overview.md、architecture.md（契約、狀態機、iTunes、答案判定）、design.md（Meet 對照） | 2026-10-12 |
| ✅ | backlog、CLAUDE.md 目錄與規範表加本 Epic | |
| ✅ | 平台 spec §1／§3 加第三款（static、清單、shareLog、dev 埠 7182、Docker） | 2026-10-12 海圖回寫 |

### Phase 1：shared ＋ server（水手長派工）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | `shared/src/song-guess/`：events.ts／constants.ts 依 spec §4 逐字；answer.ts 純函式＋測試（副標、feat.、全半形、標點、完整歌名、洩題）；package.json exports 加 `./song-guess` | 契約逐字比對測試比照 draw-contest |
| ✅ | `server/src/games/song-guess/itunes.ts`（搜尋、快取、逾時、`fetch` 可注入）＋ `picker.ts`（過濾、去重、隨機抽，`random` 可注入）＋ 單元測試 | 真 iTunes 的回應樣本存進測試 fixture |
| ✅ | `room.ts`／`register.ts`／`chat.ts`／`ranking.ts`：spec §5 狀態機（choosing 搜尋、5 首逐首、計分、防洩題、揭曉、ended 排名、重連、離開）＋ vitest（假時鐘）與 e2e | 複製 draw-contest 的 room 骨架改寫 |
| ✅ | `app.ts` 註冊 `/song-guess` namespace；`AppOptions` 加 iTunes 注入點（測試） | |
| ✅ | 假 iTunes `user/mock/itunes.mjs`；協定測試 `user/protocol/song-guess-phase1.mjs`（spec §8 清單） | 與另兩款協定測試並存 |
| ✅ | README／docker-compose：`ITUNES_*`、`SONG_PREVIEW_CAP_MS`；Dockerfile 多複製 song-guess |；2026-10-12 水手長複驗 Phase 1：根目錄四項 exit 0（shared 203、server 767）；協定 song-guess phase1 110/110、draw-contest phase1 106/106、draw-guess phase1 24/24 同一程序並存；README／compose／Dockerfile 由平台整合子代理完成（Docker 未實際建置，本機無 docker） |

### Phase 2：客戶端（水手長派工）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | 建 `song-guess/`：複製 draw-guess 的首頁、meet 殼層、聊天、玩家、重連、說明；刪畫布／工具列／顏色面板／圖片／其他殼層；base `/song-guess/`、Vite 7182、proxy 對稱 | 首頁卡片只有「視訊會議」 |
| ✅ | store 與 socket：`round:update`／`players:update`／`chat:message`，時鐘偏移 | |
| ✅ | `features/player/`：`<audio>` 播放、定位、自動播放被擋的保險、音量滑桿（localStorage） | design §3 |
| ✅ | `features/round/`：分享音訊對話框（歌手、搜尋中、錯誤）、字幕列（歌手、第 n / 5、字數提示、倒數） | design §2 |
| ✅ | `features/reveal/`：揭曉卡（封面、歌名、歌手、猜對者分數）、本局排名表 | design §1 |
| ✅ | meet 殼層：舞台波形動畫、「分享音訊」按鈕、音量、參加者 tile 的出題者／猜對標記；shellBoundary 測試 | DESIGN §15 |
| ✅ | 說明對話框六主題 | 2026-10-12 水手長複驗 Phase 2：song-guess 25 檔 530 例、lint／build exit 0；瀏覽器接真 iTunes 玩完一局（孫燕姿 5 首）：播放、定位、猜對計分、兩種洩題擋下、重新整理接續、揭曉卡、排名表、音量皆正常，console 無錯誤 |

### Phase 3：平台整合（水手長派工，海圖回寫平台 spec）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | `server/src/static.ts` 加 `/song-guess`；`server/public/index.html` 加「猜歌」；`shareLog` games 加 `song-guess`（index.ts 傳入）＋測試 | 決策 12 |
| ✅ | 根 `package.json`：workspaces、`build`、`lint`、`dev`（concurrently 第五個程序）；`draw-guess/vite.config.ts` 與 `draw-contest/vite.config.ts` 加 `/song-guess` → `:7182` | spec/architecture.md §3 |
| ✅ | README 遊戲清單（水手長）；CLAUDE.md 目錄與開發指令（海圖） | 2026-10-12 |

### Phase 4：驗收

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | 水手長回報 → 海圖派 acceptance-reviewer（四項、契約逐字、協定測試對假 iTunes、瀏覽器實測含自動播放與音量、真 iTunes 一局） | 2026-10-12 通過：四項 exit 0（五 workspace 共 3112 測試）、契約逐位元組相同、13 支協定測試全過＋新寫 song-guess-rules 82/82、真 iTunes 兩局、起播誤差 < 100 ms、開發模式五程序實際啟動 OK；低嚴重度 2 項已回寫 design |
| ✅ | Rex 區網實機：兩台電腦戴耳機玩一局，確認同步與同事電腦能連 Apple CDN | 2026-10-12 Rex：「都沒問題」；預設音量依 Rex 改為 15（原 60） |

---

## 驗收標準

- [x] 四項指令 exit 0（分開跑）；三款遊戲的既有測試全過。
- [x] `shared/src/song-guess/events.ts` 與 spec §4 程式區塊逐字一致。
- [x] 真 iTunes：填「孫燕姿」→ 5 首逐首播放，每首 30 秒內猜對即得分且歌繼續播，試聽結束揭曉含封面，第 5 首後顯示本局排名。
- [x] 不足 5 首或查無歌手 → `ARTIST_NOT_FOUND`，可重填；iTunes 連不上 → `SEARCH_FAILED`，出題不中斷。
- [x] 答案判定：「如果可以」對 `如果可以 (電影"月老"主題曲)` 算對；打完整歌名算對；已猜對者說出歌名被擋。
- [x] 中途加入者從目前進度接著聽、可猜、不列入參賽者；重連後位置正確。
- [x] 協定測試 `song-guess-phase1.mjs` 全過；另兩款協定測試不受影響。
- [x] spec／README／compose／CLAUDE.md 已同步。

---

## 踩雷紀錄

- **Vite 擋 tunnel 網址（複製設定漏項）**（2026-10-14）：Rex 以 `npm run dev` ＋ `npm run tunnel` 開 `https://<隨機>.trycloudflare.com/song-guess/`，回 403「Blocked request. This host (…trycloudflare.com) is not allowed」。原因：:80 的我畫你猜 Vite 把 `/song-guess` 轉到 :7182 時保留原 Host 標頭，而 Epic 14／16 複製 vite.config 時只抄了 proxy、沒抄 `server.allowedHosts`。修正：三份 vite.config 都設 `allowedHosts: ['.trycloudflare.com', '.local']`（spec §3）。以 `curl -H "Host: x.trycloudflare.com" http://127.0.0.1/song-guess/` 驗證 200；Vite 自動重啟，不用重開 dev。分享給外部仍建議 `npm run build` → `npm start`（Express 無 Host 檢查、HMR websocket 也不會經 tunnel 報錯）。
