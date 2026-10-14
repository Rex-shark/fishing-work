# Epic 17：繪圖比賽歷史（最近 5 場，只存瀏覽器）

> 揭曉後把這回合的畫、分數、排名、評語存進自己的瀏覽器，之後從簡報的「檔案 › 最近」翻回來看；只留最近 5 場，不同步、不長期保存。

**狀態**：✅
**起訖**：2026-10-13 ~ 2026-10-14
**負責**：Rex × 海圖（Chart，架構師）；實作派水手長（Bosun）

---

## 需求（Rex 2026-10-13）

1. 繪圖比賽要有「歷史查詢區」，把比賽結果保存起來能看到。
2. 不用永久、不用長期；**只放在瀏覽器**。
3. 新玩家**不需要**看到之前的（不經 server、不同步給別人）。
4. **只記錄最近 5 場**。

## 設計決策

- 決策 1：**純客戶端，不動 server、契約、`shared/`**。資料來源就是揭曉時客戶端已收到的 `round.results`、`round.lastTopic`、`contest:gallery` 的 PNG、`contest:comment` 的評語。原因：需求 2、3；server 無資料庫（spec 範圍外）。
- 決策 2：**存 IndexedDB**（不是 localStorage）：一場 30 人每人一張 PNG（線稿通常 < 100 KB、上限 2 MiB），5 場可能超過 localStorage 的 5 MB；IndexedDB 存 `Blob` 不必 base64。資料庫 `fishing-work:draw-contest`、object store `history`，主鍵 `id`。不引入套件，用原生 API 包一層小 wrapper（`features/history/historyDb.ts`，可注入假實作測試）。
- 決策 3：**一筆＝一回合**：`{ id, savedAt, roundNo, topic, judgeMode, commentMode, me: string | null, results: ResultEntry[]（含 comment；commentPending 一律存 false）, images: { playerId → Blob } }`。`id = startedAt`（`RoundPublic.startedAt`，drawing 開始的 epoch ms；server 重啟後 `roundNo` 會重複，`startedAt` 不會）。`me` ＝ 建檔當下自己的 playerId，檢視時用來標「你」（水手長 Q3，2026-10-13 定案）。`savedAt` ＝ 首次建檔時間，之後更新不變；清單與備忘稿列的「月/日 時:分」用它（本機時區；Q6）。
- 決策 4：**何時存**：`round.phase` 轉為 `ended` 且 `results` 非 null **且至少一人交卷**（Q2：沒人交卷的回合不存，免得佔名額）時建檔（此時畫廊圖片可能還沒全到、評語可能 pending）；建檔時把 `id` 記在記憶體，之後同一 `roundNo` 的 `contest:gallery`／`contest:comment` 以此 **更新**該筆（`startedAt` 在 choosing 會被 server 清成 null，不能再從 round 讀；Q1a），直到下一回合 `drawing` 才放掉；離開頁面後不再更新（pending 的評語就留 null）。**中途加入或重新整理時 phase 已是 idle／choosing（`startedAt` null）則不建檔**；phase 為 `ended` 才建（Q1b）。重新整理後在 ended 補收的畫廊以相同 id 合併，評語以非 null 優先，不被較舊的快照蓋掉（Q7）。
- 決策 5：**只留 5 筆**：寫入後若超過 `HISTORY_MAX = 5`（客戶端常數），刪 `savedAt` 最舊者。沒有「清除」功能（需求沒要，5 筆自然淘汰）。
- 決策 6：**入口＝簡報「檔案」選單的「開啟最近的簡報」**（PowerPoint 的「檔案 › 開啟 › 最近」語意）：子清單最多 5 列，每列「{題目} — {月/日 時:分} — 第一名 {暱稱}（{分}）」，沒有歷史時灰字「沒有最近的簡報」。原因：偽裝自然、不必新增分頁或按鈕；寬螢幕與窄螢幕都已有「檔案」選單。
- 決策 7a（Q4、Q5）：`ShellProps.history` 加 `refresh(): void`，殼層在「檔案」選單開啟時呼叫（另一個分頁可能寫了新紀錄）；本分頁自己寫入後 `entries` 自動更新。**`judging` 也灰化**，可開的白名單只有 `idle`／`ended`／`choosing`（非出題者）。
- 決策 7：**檢視＝重用揭曉畫廊**（`RevealView`，投影片瀏覽）：點選一筆 → 中央投影片區改顯示該場的畫廊（評語為存檔內容，不會有「正在寫評語」；沒評語的卡片不顯示評語行），備忘稿列顯示「最近的簡報：{題目}（{月/日 時:分}）　第一名：X（n 分）」，功能區「常用」，狀態列中段放「回到目前」按鈕（偽裝字樣由殼層給，例如「關閉簡報」）。**只在 `idle`／`ended`／`choosing`（非出題者）可開**；進入 `drawing` 或自己成為出題者時自動關閉回到目前畫面。放大檢視沿用。
- 決策 8：**圖片以 object URL 顯示**，開啟一筆時從 Blob 建、關閉時 revoke（與現有 gallery 一樣）。
- 決策 9：**IndexedDB 不可用**（隱私模式、封鎖、配額滿）時靜默：存檔失敗只 `console.warn`，入口顯示「沒有最近的簡報」，遊戲不受影響。
- 決策 10：殼層邊界維持：`features/history/`（db、store、`HistoryView`、清單資料純函式）不含偽裝字樣；殼層只多 `ShellProps.history: { entries, openId, canOpen, open(id), close(), refresh() }` 與「檔案」選單一項（欄位依決策 7a、12）；`shellBoundary` 測試沿用。
- 決策 11：**同一瀏覽器不分暱稱**（需求是「放在瀏覽器」）；不同分頁共用同一個 IndexedDB，清單在開啟選單時重讀。同一瀏覽器兩個分頁以不同玩家玩同一回合時，`me` 是先建檔的那位（可接受）。
- 決策 12（水手長實作回報 1–13，2026-10-13）：純函式檔名 `historyDisplay.ts`；`ShellProps.history` 多 `canOpen`、`entries` 為 `{ id, label }[]`；object URL 在 store；被修剪或建檔失敗的筆不會被晚到的圖或評語建回；有交卷但沒存到圖的卡片顯示空白；無存檔時入口仍在、灰字在子清單內；子清單只點選或鍵盤展開、列文字換行不截斷；時間「月/日 時:分」月日不補零、時分補零；IndexedDB 失敗每次 `console.warn` 不去重；`getAll` 略過形狀不對的資料；「關閉簡報」由殼層渲染；draw-contest/README.md 本來是 draw-guess 舊複本，**順帶改寫為繪圖比賽的內容**。

## 任務清單

### Phase 0：規格（海圖）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | 本計畫；spec/draw-contest/design.md §2 表加「歷史檢視」列與 §3.1；architecture §7 客戶端結構補 `features/history/`、§9 註明契約不變 | 2026-10-13 |

### Phase 1：客戶端（水手長派工）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | `features/history/historyDb.ts`：IndexedDB wrapper（open、put、getAll 依 savedAt 降冪、delete、修剪到 5 筆）＋可注入的記憶體假實作；`HISTORY_MAX = 5` | 決策 2、5、9 |
| ✅ | `features/history/historyStore.ts`（或併入 game store 的訂閱）：ended 建檔、gallery／comment 更新、drawing 停止更新；只對 `round.startedAt` 對得上的回合寫 | 決策 3、4；用 vitest 假 DB 驗時序 |
| ✅ | `features/history/historyDisplay.ts` 純函式（原名 historyView.ts 與 HistoryView.tsx 撞大小寫，決策 12）：清單列文字（題目、時間、第一名）、把存檔轉成 `RevealCard[]`（重用 `revealView.ts`） | 決策 6、7 |
| ✅ | `features/history/HistoryView.tsx`：以 `RevealView` 顯示存檔畫廊（object URL 建／revoke） | 決策 7、8 |
| ✅ | 殼層：`ShellProps.history`；ppt「檔案」選單加「開啟最近的簡報」子清單；中央區在 `history.openId` 非 null 時顯示 `HistoryView`；備忘稿列與狀態列中段對應文案；`drawing`／自己出題時自動關閉 | design §2「歷史檢視」列；`shellBoundary` |
| ✅ | 測試：db wrapper（假 IndexedDB 或記憶體實作）、store 時序（ended → gallery → comment → 下一回合）、修剪 5 筆、清單文字、殼層選單渲染；三殼層截圖位元組測試照既有做法 | |
| ✅ | 說明對話框「排名與總分」補一句「最近 5 場可從「檔案 › 開啟最近的簡報」回看，只存在這台瀏覽器」 | |

### Phase 2：驗收

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | 水手長回報 → 海圖派 acceptance-reviewer（四項、瀏覽器實測：玩 6 場只剩 5 筆、重新整理後還在、評語晚到有補進去、drawing 中自動關閉、隱私模式不壞） | 2026-10-13 通過：四項 exit 0（draw-contest 807）、server／shared 0 行、協定無退化；瀏覽器 18 情境 PASS 含 IndexedDB 不可用（只 warn）、多分頁 refresh、768px；低嚴重度 2 項（warn 不去重、檢視中要出題須先關閉）都不改程式 |
| ✅ | Rex 目視 | 2026-10-14 Rex 以 IDEA 啟動實測「都沒問題」 |

## 驗收標準

- [x] 四項指令 exit 0；server／shared 零改動（`git diff --stat` 只在 `draw-contest/`）。
- [x] 揭曉後「檔案 › 開啟最近的簡報」出現該場；重新整理、重新加入後仍在；第 6 場後最舊的消失。
- [x] 點選一筆看到該場所有畫、分數、名次、評語（含揭曉後才到的評語）；「回到目前」回到現場；`drawing` 開始時自動關閉。
- [x] IndexedDB 不可用時遊戲照常、入口顯示「沒有最近的簡報」。
- [x] 殼層不含功能邏輯、功能元件不含偽裝字樣（`shellBoundary` 過）。

## 踩雷紀錄

（尚無）
