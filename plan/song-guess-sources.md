# Epic 18：猜歌題庫來源（歌手熱門、台灣熱門、西洋熱門）

> 出題對話框從「只能填歌手」變成三種來源：歌手（新增「只抽熱門歌」勾選，預設勾）、台灣熱門（Apple Music 台灣榜當日前 100）、西洋熱門（美國榜當日前 100）。

**狀態**：✅
**起訖**：2026-10-16 ~ 2026-10-19
**負責**：Rex × 海圖（Chart，架構師）；實作派水手長（Bosun）

---

## 需求（Rex 2026-10-16）

1. 歌手搜尋**加一個選項「熱門」，預設勾選**；勾了之後只抓熱門歌。
2. 再做一個**台灣熱門**：沒有選項，直接抓當日熱門。
3. 問「有沒有西洋熱門」→ 海圖實測可行（美國榜），納入本 Epic 當第三個來源。

## 可行性探測（海圖 2026-10-16，直接打 Apple）

| 項目 | 結果 |
|---|---|
| Search API 回傳順序 | **就是熱門度**：周杰倫前八首＝擱淺、晴天、七里香、說好的幸福呢、稻香…；沒有 `sort`、年份、曲風參數（`term=2010` 回傳混雜） |
| 台灣熱門榜 | `rss.marketingtools.apple.com/api/v2/tw/music/most-played/100/songs.json`：100 首、每日更新；**沒有 `previewUrl`**，要拿 `id` 打 `lookup` 補（10 首實測 10/10 有試聽）；100 首裡 42 首非中文（多為韓團） |
| 西洋熱門榜 | 同端點 `us`（美國榜；`gb` 英國榜也有）；美國榜前 25 首用 `lookup?country=TW` 查 25/25 都在台灣商店且有試聽 → 播放端不用改 |
| 年代 | 歌手模式可用 `releaseDate` 事後過濾（周杰倫 2010 年有 8 首）；「某年全台熱門」Apple 只有**當下**榜單、沒有歷史榜 → 做不到，留待換資料源 |

## 設計決策

- 決策 1：**事件改名 `round:setArtist` → `round:setSource`**，payload 為 discriminated union：`{ source: 'artist', artist, hot } | { source: 'tw-hot' } | { source: 'western-hot' }`，ack `{ topic }`。原因：來源會再增加（年代等），一開始就用可擴充的形狀；事務長的技能目前沒有猜歌依賴（`other/skills/MAINTENANCE.md` 無 song-guess 項），改名無外部成本。
- 決策 2：**「熱門」＝過濾去重後保持 iTunes 回傳順序、取前 `HOT_POOL = 30` 首再隨機抽 5**；不足 30 就全部（等同現況）。原因：Search API 的順序就是 Apple 的熱門度（探測 1），不必另打 API；取 30 讓同一歌手連玩幾局不會每次都同五首。
- 決策 3：**榜單模式 server 兩段呼叫**：RSS（100 個 id）→ 一次 `lookup?id=<100 個>&country=TW` 補 `previewUrl`／`trackTimeMillis`；合併結果以國家為鍵快取 `ITUNES_CACHE_MS`（10 分鐘；榜單一天才變一次）。原因：lookup 一次可帶多 id，兩次呼叫換 10 分鐘內任意局數；台灣商店的試聽網址讓西洋榜也能播（探測 3）。
- 決策 4：**西洋熱門＝美國榜 `us`**。Apple 榜單只分國家、沒有「西洋」分類；美國榜是一般認知的西洋熱門；英國榜留待有人要。
- 決策 5：**榜單模式不過濾語言**（台灣榜含韓團、西洋歌照出）：Rex「直接抓當日熱門」。
- 決策 6：**`RoundPublic` 欄位泛化**：`artistDisplay` → `topic`（題庫標題：歌手正式名／「台灣熱門」／「西洋熱門」）、`lastArtist` → `lastTopic`，新增 `source`、`lastSource`、`artistHot`；`SongPublic` 新增 **`artist`（本首歌手）**。原因：榜單模式每首歌手不同，原本「歌手全程顯示」的提示改成逐首顯示該首歌手（歌手模式顯示的內容不變，只是來源從局改成首）。
- 決策 7：**榜單去重鍵＝`artistName` ＋ `normalizeTitle`**（歌手模式仍只用歌名）：同名歌不同歌手是不同的歌；括號開頭、純符號歌名照舊排除。
- 決策 8：**失敗碼**：榜單 RSS／lookup 逾時、非 2xx、解析失敗、可抽不足 5 首 → 新碼 `CHART_FAILED`「取得排行榜失敗，請再試一次」；`source` 不合法 → `SOURCE_INVALID`；歌手模式沿用 `ARTIST_INVALID`／`ARTIST_NOT_FOUND`／`SEARCH_FAILED`。`setSource` 的 ack 逾時 15 → **20 秒**（榜單兩段各 8 秒）。
- 決策 9：**對話框**（design §1）：頂部三選一「歌手／台灣熱門／西洋熱門」（segmented，預設歌手）；歌手模式＝原欄位 ＋ 勾選「只抽熱門歌」（**預設勾**，本機偏好 localStorage 記住上次）；榜單模式＝一行說明「從今天的 Apple Music 台灣（美國）熱門 100 首隨機抽 5 首」＋「分享」按鈕。偽裝字樣仍是「分享音訊」。
- 決策 10：**顯示**：playing tile 第一行「{topic}{歌手模式且 hot 時加「（熱門）」} · 第 n / 5 首」、第二行「歌手：{song.artist}」（歌手模式若與 topic 相同則省略第二行）；排名表標題「本局結果 · {lastTopic}」；系統訊息「X 出題「{topic}」，共 5 首」文案模板不變。
- 決策 11：**假 iTunes 擴充**：`user/mock/itunes.mjs` 加 `GET /api/v2/:country/music/most-played/100/songs.json`（`tw` 12 首中英混合、`us` 12 首西洋，形狀同真 RSS）與 `GET /lookup?id=`（依 id 回 search 同形資料）；`MOCK_ITUNES_CHART_FAIL=1`（RSS 回 500）、`MOCK_ITUNES_LOOKUP_FAIL=1`（lookup 回 500）。協定測試把 `ITUNES_RSS_URL` 也指到它。
- 決策 13（水手長派工疑義 1–8，2026-10-16 海圖定案）：payload 非物件／`source` 非三值／歌手模式 `hot` 非 boolean → `SOURCE_INVALID`，榜單模式多帶欄位忽略；**檢查順序 `SOURCE_INVALID` → `ARTIST_INVALID` → `SEARCH_BUSY`**（維持 Epic 16 的「先驗輸入再看忙碌」，不對調），`SEARCH_BUSY` 兩種來源共用旗標；熱門也套用在「最多次 `artistName` 過半」退回那一輪；榜單中 lookup 找不到、非 track、無 `previewUrl` 的 id 略過，RSS 空或格式錯 → `CHART_FAILED`，`pickChart` 從全部抽不套 `HOT_POOL`，快取只存成功、同國家進行中共用請求，「回來已不是同一次 choosing → `NOT_SETTER`」兩種來源都適用；**不保留 `round:setArtist` 相容別名**；對話框每次開啟回到「歌手」（只有「只抽熱門歌」記 localStorage），榜單模式失敗後焦點留在「分享」；系統訊息不加「（熱門）」；reveal 階段 tile 維持揭曉卡，兩行顯示只在 playing；真 RSS／lookup 樣本由子代理對真 Apple 各打一次存 fixture。
- 決策 14（水手長完成回報 1–6 ＋ 範圍外觀察，2026-10-16 海圖定案）：**RSS 段逾時獨立為 `ITUNES_RSS_TIMEOUT_MS` 預設 12 秒**（Apple RSS 偶發 8～15 秒才回），lookup 仍 8 秒，`setSource` ack 逾時 20 → **25 秒**；榜單模式**不排除** explicit 與歌名含 `*` 的歌（海圖提議排除，Rex 2026-10-16 在海圖 session 確認「不做」，照 Apple 榜單原樣）；子代理自訂的無障礙名稱與 Enter 行為照實作寫進 spec §7；榜單說明文用 `--fg-on-panel-muted`（design 改）；壞 payload 先於 `NOT_IN_ROOM`／`NOT_SETTER`；「topic 以前 30 首計」＝歌名落在前 30 首候選裡的所有過濾結果；§4 `SongPhase` 註解改「出題者選題庫（含 server 取歌中）」（契約區塊，已通知水手長同步）；**順帶修 Epic 16 舊問題**：ended 狀態列與報讀文字第一名 0 分時改為「本局結束：沒有人猜對」，與聊天訊息三處一致。協定測試 rules 的「第 2 首開始 hasGuessed 全清」斷言在並行負載下偶發（`players:update` 在下一封包），水手長加等待，非產品問題。
- 決策 12：**年代條件不在本 Epic**（Rex 本次沒要）；spec §9 改寫為可行的形式（歌手 ＋ 年代區間），歷史年榜標記為資料源限制。

## 任務清單

### Phase 0：規格（海圖）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | 本計畫；spec/song-guess/architecture.md §3（RSS、`ITUNES_RSS_URL`）、§4 契約（`SongSource`、`SongSourcePayload`、`round:setSource`、`RoundPublic`／`SongPublic` 欄位、錯誤碼、常數 `HOT_POOL`／`CHART_SIZE`／`SOURCE_TITLE`）、§5 choosing 分支、§5.3、§6、§7、§8、§9；overview 需求 7 與規則；design §1／§2 | 2026-10-16 |
| ✅ | backlog、CLAUDE.md 規範表與進度 | |

### Phase 1：shared ＋ server ＋ 假 iTunes（水手長派工）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | `shared/src/song-guess/events.ts` 依 spec §4 逐字同步；`constants.ts` 加 `HOT_POOL`、`CHART_SIZE`、`SOURCE_TITLE`；契約逐字測試更新 | 決策 1、6；2026-10-16 常數測試改為解析表內物件值（SOURCE_TITLE 逐值比對、18 列），型別 fixture 改新欄位 |
| ✅ | `itunes.ts` 加 `chart(country)`（RSS → lookup 合併、快取、`CHART_FAILED`）；`readSongGuessConfig` 讀 `ITUNES_RSS_URL`；真 RSS／lookup 回應樣本存 fixture | 決策 3；2026-10-16 樣本 `server/test/fixtures/song-guess.chart.json`（tw／us 各前 20 名；us 另附台灣商店 lookup 查不到的 3 首，實測 us 榜 100 首 lookup 只回 97） |
| ✅ | `picker.ts`：`pick` 加 `{ hot }`（保持順序、前 `HOT_POOL`）、新 `pickChart`（去重鍵歌手＋歌名）＋單元測試 | 決策 2、7；2026-10-16 去重保留各歌第一次出現的名次，退回那一輪同樣套 hot |
| ✅ | `room.ts`：`round:setSource` 三分支、`source`／`artistHot`／`topic`／`lastTopic`／`lastSource`、`song.artist`；`SOURCE_INVALID`；vitest（假時鐘）與 e2e 更新 | 決策 6、8；2026-10-16 檢查順序 SOURCE_INVALID → ARTIST_INVALID → SEARCH_BUSY（同 Epic 16）；`AppOptions` 加 `songChart` 注入點；舊事件名不保留 |
| ✅ | `user/mock/itunes.mjs` 擴充（決策 11）；協定測試 `song-guess-phase1.mjs`／`song-guess-rules.mjs` 改 `setSource`；新增 `song-guess-sources.mjs`（熱門抽樣落在前 30、非熱門可抽到 30 之後、台灣熱門、西洋熱門、`CHART_FAILED` 兩種、`SOURCE_INVALID`、`topic`／`lastTopic`／`song.artist`） | 決策 11；2026-10-16 假 iTunes 加「熱門歌手」60 首；sources 需三個 server（主、RSS 壞、lookup 壞）兩個假 iTunes，用法見檔頭；rules 補一處 ended 後等待（既有計時競態） |
| ✅ | README／docker-compose：`ITUNES_RSS_URL` | 2026-10-16 README 猜歌出題說明改三種來源、網路需求加 `rss.marketingtools.apple.com` |

### Phase 2：客戶端（水手長派工）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | 出題對話框：三選一、歌手模式勾選（預設勾、localStorage）、榜單模式說明文；送出 `round:setSource`；ack 逾時 20 秒；錯誤文案 | 決策 9；沿用 Epic 15 的送出中不失焦做法（readOnly／aria-busy）。2026-10-16 水手長子代理：`ArtistDialog` 改名 `SourceDialog`（purpose `source`）、`hotPreference.ts`；殼層 `DialogProps` 加 `choices`／`toggle`／`description` |
| ✅ | store／型別：`topic`、`source`、`artistHot`、`lastTopic`、`song.artist`；`roundDisplay.ts`、`MeetStage`、`GameRanking`、`revealView` 標題、系統訊息 | 決策 10。2026-10-16：兩行字由 `roundDisplay.playingStageLines` 產生、殼層只排版；系統訊息是 server 文字，客戶端原樣顯示 |
| ✅ | 說明對話框「出題」「怎麼玩」改寫（三種來源、熱門定義） | 2026-10-16：數字由 `HOT_POOL`、`CHART_SIZE`、`SOURCE_TITLE` 推導 |
| ✅ | 測試：對話框三模式渲染與送出 payload、顯示純函式、shellBoundary 照舊 | 2026-10-16：song-guess 576 個測試通過（新增 `hotPreference.test.ts`）；四項 exit 0；瀏覽器實測待 Phase 3 |

### Phase 2.5：決策 14 補做（水手長派工）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | `ITUNES_RSS_TIMEOUT_MS` 12 秒（README／compose 補）、ack 25 秒；ended 狀態列與報讀 0 分文案；events.ts `SongPhase` 註解逐字同步 | 2026-10-16；原第 2 項「榜單排除 explicit／`*`」Rex 定不做，已還原；server 端 `ITUNES_RSS_TIMEOUT_MS`（只作用在 RSS 段，lookup 仍 `ITUNES_TIMEOUT_MS`）與 README／compose 已完成 |

### Phase 3：驗收

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | 水手長回報 → 海圖派 acceptance-reviewer（四項、契約逐字、協定測試對假 iTunes、瀏覽器真 iTunes：周杰倫熱門一局、台灣熱門一局、西洋熱門一局） |  2026-10-16 通過：四項 exit 0（137 檔；shared 210、server 874、draw-guess 931、draw-contest 807、song-guess 578）；契約逐位元組一致（7294 bytes）；協定六檔全過，驗收子代理新寫 `user/protocol/song-guess-sources-extra.mjs` 37/37（榜單取歌中 `SEARCH_BUSY`、檢查順序、壞 payload 先於身分檢查、RSS／lookup 500 → `CHART_FAILED`、ended 0 分系統訊息）；瀏覽器真 Apple 三局（周杰倫熱門 5 首名次 1～30 內、台灣熱門 100 首、西洋熱門 97 首）、對話框無障礙與 localStorage、375／768 版面全 PASS、console 無錯誤；低嚴重度 2 項（說明文字「每首歌手都不同」改「可能不同」派水手長；有分時字幕列與報讀措辭不同記 improvements） |
| ✅ | Rex 目視 | 2026-10-19 Rex 以 IDEA 啟動實測三種來源「沒問題」 |

## 驗收標準

- [x] 四項指令 exit 0；`shared/src/song-guess/events.ts` 與 spec §4 逐字一致。
- [x] 歌手模式預設勾「只抽熱門歌」，抽到的 5 首都在該歌手搜尋結果去重後的前 30 首內；取消勾選可抽到 30 之後。
- [x] 台灣熱門、西洋熱門各玩一局：5 首都有試聽、逐首顯示該首歌手（去重鍵是歌手＋歌名，同一歌手可能出現兩首）、揭曉有封面、排名表標題為「本局結果 · 台灣熱門」／「西洋熱門」。
- [x] RSS 或 lookup 失敗 → `CHART_FAILED`，仍在 choosing 可重試或換來源。
- [x] 另兩款協定測試不受影響；事務長無需改動（MAINTENANCE 無猜歌依賴）。

## 踩雷紀錄

（尚無）
