# Epic 19：猜歌「動漫熱門」來源

> 出題對話框第四個來源「動漫熱門」：server 以 anime／アニメ／動漫 三個關鍵字搜 iTunes（台灣商店）、合併去重、排除原聲帶與翻唱、依 Apple 排序（＝熱門度）取前 60 首再隨機抽 5。沒有選項。

**狀態**：✅
**起訖**：2026-10-20 ~ 2026-10-21
**負責**：Rex × 海圖（Chart，架構師）；實作派水手長（Bosun）

---

## 需求（Rex 2026-10-20）

「猜歌想做動漫主題」→ 海圖探測後提案「動漫熱門」來源，Rex「好開始」（名稱「動漫熱門」、前 60 首、無選項皆採海圖預設）。

## 可行性探測（海圖 2026-10-20，直接打 Apple）

| 做法 | 結果 | 判斷 |
|---|---|---|
| 舊版曲風榜 `itunes.apple.com/tw/rss/topsongs/limit=100/genre=29/json`（動畫） | 99 首全有試聽，但前 12 首有 7 首 KOTOKO、影山ヒロノブ等老動漫歌手佔榜 | 太偏門，不用 |
| 日本區動畫榜 `jp/.../genre=29` | 台灣商店有 81/100，但大量角色歌（歌手欄十幾個聲優） | 猜不到，不用 |
| 填動畫名（比照歌手模式） | 中文名搜出來多為翻唱頻道（拉拉拜檸檬、JaianM）：鏈鋸人 8、灌籃高手 3、你的名字 0；日文原名 160+ 但同事不會打 | 不做 |
| **關鍵字搜尋聯集**（TW 商店 `term=anime`／`アニメ`／`動漫`，各 200） | 去重 647 首、排除原聲帶／翻唱後 405 首、255 位歌手；`anime` 前 20 ＝ 残響散歌、One Last Kiss、怪物、祝福、紅蓮華、SPECIALZ、打上花火、AIZO… | **採用** |
| 其他關鍵字 `動畫`／`主題歌`／`OP` | 原聲帶與古典音樂比例高（81／95／75 首） | 不納入 |

## 設計決策

- 決策 1：**`SongSource` 加 `'anime-hot'`**，payload `{ source: 'anime-hot' }`，`SOURCE_TITLE['anime-hot'] = '動漫熱門'`；對話框四選一。契約區塊改動，shared 逐字同步。
- 決策 2：**題庫＝三關鍵字搜尋聯集**：`ANIME_TERMS = ['anime', 'アニメ', '動漫']`（shared 常數），各打一次既有 Search API（`term=<kw>&entity=song&country=TW&limit=200`，**不帶 `attribute`**）；每首的排名＝它在三份結果中的最小索引；依排名升冪、以「`artistName` ＋ `normalizeTitle`」去重；排除**原聲帶／翻唱**（決策 3）；取前 `ANIME_HOT_POOL = 60` 首；隨機抽 5。原因：Apple 搜尋順序即熱門度（Epic 18 探測）；前 60 首是同事叫得出名字的範圍。
- 決策 3：**排除規則**（server `picker.ts` 純函式 `isSoundtrackOrCover(track)`）：`collectionName` 或 `trackName` 以不分大小寫比對含任一：`soundtrack`、`サウンドトラック`、`原聲`、`原声`、`OST`、`BGM`、`instrumental`、`off vocal`、`カラオケ`、`伴奏`、`piano`、`鋼琴`、`cover`、`カバー`、`remix`、`8-bit`、`music box`、`音樂盒`、`オルゴール`。另排除 `mainTitle` 為空與 `normalizeTitle` 為空者（同榜單模式）。
- 決策 4：**三次搜尋合併結果以 `'anime'` 為鍵快取 `ITUNES_CACHE_MS`**，同鍵進行中共用請求；任一關鍵字搜尋失敗 → 整體失敗，錯誤碼沿用 `CHART_FAILED`（文案改通用：「取得題庫失敗，請再試一次」）；可抽不足 5 首亦 `CHART_FAILED`。不新增環境變數（用 `ITUNES_URL`、`ITUNES_COUNTRY`、`ITUNES_TIMEOUT_MS`；三次搜尋各自 8 秒逾時，**並行**發出）。
- 決策 5：**顯示與榜單模式相同**：tile「動漫熱門 · 第 n / 5 首」＋「歌手：{song.artist}」、排名表「本局結果 · 動漫熱門」、系統訊息「X 出題「動漫熱門」，共 5 首」；對話框說明文「從 Apple Music 的動漫歌曲裡隨機抽 5 首（熱門前 60）」。
- 決策 6：**假 iTunes** 對 `term` 為 `anime`／`アニメ`／`動漫` 各回一份固定資料（三份有交集、含一筆原聲帶與一筆 Cover 供排除驗證、合計去重後 ≥ 12 首），其餘行為不變。協定測試新檔 `song-guess-anime.mjs`：抽到的 5 首落在前 60（假資料直接全在）、排除項不會被抽到、三關鍵字之一回 500（`MOCK_ITUNES_FAIL_TERM=アニメ`）→ `CHART_FAILED`、`topic`／`lastTopic`／`lastSource`／`song.artist`。
- 決策 8（水手長派工疑義 1–6，2026-10-20 海圖定案）：排除關鍵字**拉丁字母用單字邊界、日中文子字串**（避免 `OST` 誤殺 LOST IN PARADISE、`cover` 誤殺 Discover）；處理順序 previewUrl → 排除 → 空歌名 → 合併排名（同名次依關鍵字順序）→ 去重保留排名前者 → 前 60 → 抽 5，快取存未排除的合併 tracks；spec §5 `source` 改「四值之一」，SEARCH_BUSY 旗標與「回來已非同一次 choosing → NOT_SETTER」適用動漫熱門；`CHART_FAILED` 通用文案連帶改既有協定測試與單元測試斷言；動漫熱門送出中按鈕「搜尋中…」、無障礙名「分享：抽歌並開始」；fixture 對真 Apple 三關鍵字各打一次。
- 決策 9（水手長完成回報 1–4，2026-10-20 海圖定案）：§3 補實作日池子 238／200 首、大小每天浮動；拉丁關鍵字允許複數、NFKC 後比對；合併以 `trackId` 識別；解析失敗亦 `CHART_FAILED`；動漫快取與歌手快取分開；對話框換列看對話框寬度（container query 340px）；`isPresetSource`（三個無欄位來源）／`isChartSource`（兩個榜單，決定「取得排行榜…」）拆開；說明對話框關鍵字用常數組字，改以「、」串接；sources-extra 兩處既有不穩定斷言（合唱曲含「孫燕姿」即可、等系統訊息到）水手長修正。
- 決策 10（驗收回報，2026-10-20 海圖定案）：排除關鍵字補 `acoustic`、`orchestral`、`karaoke`（拉丁字母、單字邊界、允許複數）；歌名叫「Anime」的非動漫歌混入屬關鍵字搜尋本質，記 spec §9 待 Rex 指示；送出中按鈕 aria-label 不帶「分享：」前綴為 Epic 18 既有，記 improvements。
- 決策 7：**年代、作品名條件不做**（探測：中文作品名命中差）；留 §9。

## 任務清單

### Phase 0：規格（海圖）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | 本計畫；spec/song-guess/architecture.md §3（關鍵字聯集）、§4 契約（`'anime-hot'`、`SOURCE_TITLE`、`ANIME_TERMS`、`ANIME_HOT_POOL`）、§5 分支、§5.3 文案、§6、§7、§8、§10；overview 需求 8；design §1 四選一；backlog、CLAUDE.md | 2026-10-20 |

### Phase 1：shared ＋ server ＋ 假 iTunes（水手長派工）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | `events.ts` 逐字同步；`constants.ts` 加 `ANIME_TERMS`、`ANIME_HOT_POOL`、`SOURCE_TITLE['anime-hot']`；契約測試 | 決策 1、2；2026-10-20 常數表測試支援陣列值（ANIME_TERMS 逐值比對）、events 型別案例加 `'anime-hot'` |
| ✅ | `itunes.ts` 加 `animePool()`（三關鍵字並行搜尋、合併排名、快取）；`picker.ts` 加 `isSoundtrackOrCover`、`pickAnime(tracks, n, random)`（排除、去重、前 60、抽 5）＋單元測試；真 Apple 樣本存 fixture | 決策 2–4；2026-10-20 樣本 `server/test/fixtures/song-guess.anime.json`（三關鍵字各前 40，合併 49、排除 14）；拉丁關鍵字整字比對（LOST 不誤殺） |
| ✅ | `room.ts` 第四分支；`CHART_FAILED` 文案改通用；vitest | 決策 4、5；2026-10-20 注入點 `AppOptions.songAnime`；server vitest 920 通過 |
| ✅ | 假 iTunes 三關鍵字資料與 `MOCK_ITUNES_FAIL_TERM`；協定測試 `song-guess-anime.mjs`；既有 sources／sources-extra 不受影響 | 決策 6；2026-10-20 anime 51/51（兩次）；sources／sources-extra 只改 CHART_FAILED 文案 |

### Phase 2：客戶端（水手長派工）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | 對話框四選一（「動漫熱門」排第四）、說明文；375px 四個選項不溢出（必要時兩列） | 決策 5；design §1。2026-10-20：送出中「搜尋中…」、無障礙名「分享：抽歌並開始」；四選一外層 `@container`，內文 < 340px 以 CSS 換 2×2（`meetLayout.segmentedGroupClass`），DOM／方向鍵順序不變；`isChartSource` 拆成 `isPresetSource`（無欄位）＋ `isChartSource`（只限兩個榜單） |
| ✅ | 說明對話框「出題」「怎麼玩」加動漫熱門一句；測試更新 | 2026-10-20：關鍵字、前 60、抽 5 皆由 `ANIME_TERMS`／`ANIME_HOT_POOL`／`SONGS_PER_GAME` 組字；客戶端測試 591 通過（未做瀏覽器實測，留給 Phase 3） |

### Phase 2.5：決策 10 補做（水手長派工）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | `isSoundtrackOrCover` 補 `acoustic`、`orchestral`、`karaoke`＋單元測試案例 | 2026-10-20；水手長直接改 `picker.ts` 拉丁關鍵字清單（同一條邊界／複數／NFKC 規則）；新增測試：「螺旋 - RASEN - Acoustic Ver. -」「生命的記憶 (Orchestral version)」「(Karaoke Version)」與複數被排除、「Acoustically」「Orchestrally」「Karaokeish」不被排除；server typecheck exit 0、測試 921 通過（真 Apple fixture 排除數不變） |

### Phase 3：驗收

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | 水手長回報 → 海圖派 acceptance-reviewer（四項、契約逐字、協定測試、真 Apple 動漫熱門一局、375px） |  2026-10-20 通過：四項 exit 0（shared 212、server 920、draw-guess 931、draw-contest 807、song-guess 591）；契約逐位元組一致；八個協定測試全過，驗收子代理新寫 `song-guess-anime-extra.mjs` 42/42；排除規則 29 案例（LOST IN PARADISE、Discover 不誤殺）；真 Apple 一局五首名次 56／58／32／33／17 皆在前 60、無原聲帶／翻唱；375px 四選一 2×2 無溢出；console 無錯誤。低嚴重度 3 項：歌名叫「Anime」的非動漫歌混入（記 §9）、Acoustic／Orchestral 漏網（補關鍵字，派水手長）、送出中 aria-label 不帶「分享：」前綴（Epic 18 既有，記 improvements） |
| ✅ | Rex 目視 | 2026-10-21 Rex 以 IDEA 實測「OK」 |

## 驗收標準

- [x] 四項指令 exit 0；`events.ts` 與 spec §4 逐字一致。
- [x] 真 Apple 動漫熱門一局：5 首都有試聽與封面、沒有原聲帶／翻唱、抽到的歌落在合併排名前 60；tile 與排名表標題為「動漫熱門」。
- [x] 任一關鍵字搜尋失敗 → `CHART_FAILED`「取得題庫失敗，請再試一次」，仍在 choosing。
- [x] 既有三種來源與另兩款協定測試不受影響。

## 踩雷紀錄

（尚無）
