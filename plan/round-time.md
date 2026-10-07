# Epic 12：作畫時間改為 10 分鐘（小修正）

> `ROUND_SECONDS` 90 → 600；所有倒數、逾時、計分都從這個常數推導，只改一處

**狀態**：✅（2026-10-07 Rex 目視「都可以」，結案）（2026-10-06 Rex 看過 10 分鐘版後改口：**改 2 分鐘**（`ROUND_SECONDS = 120`），龍骨第二輪完成並複驗：四項 0、協定測試五組全過、伺服器回合 120000 ms、瀏覽器倒數 02:00 起算；待 Rex 目視；之前 10 分鐘版：龍骨實作並複驗完成：四項 0、協定測試五組全過、瀏覽器倒數 10:00）
**起訖**：2026-10-06 ~ 2026-10-07
**負責**：Rex × 舵手（Helm）× 龍骨（Keel）

---

## 需求（Rex 2026-10-06）

> 「臨時小修正：畫畫時間限制改為 10 分鐘。然後這個參數在哪改？」

## 設計決策

- 決策 1：**只改 `shared/src/draw-guess/constants.ts` 的 `ROUND_SECONDS = 600`**。server 的回合逾時（`room.ts` `roundMs`）、計分公式（`scoring.ts`）、客戶端倒數（`countdown.ts`，mm:ss 格式 `10:00` 放得下）都引用它，不另加設定。原因：本來就是單一來源。
- 決策 2：**計分公式不變**：猜對者 `100 − floor(50 × 已用 ms / (ROUND_SECONDS × 1000))`，分數仍在 50..100，只是遞減變慢（30 秒猜對 98 分、5 分鐘 75 分）。原因：Rex 只要求改時間。
- 決策 3：**文件同步**：spec §4 常數表、overview 規則 4／8、README、說明主題 `be-drawer`／`guess`（`plan/help-topics.md` 決策 5 表已改，`helpTopics.ts` 須逐字同步）。
- 決策 4：**寫死 90 的測試與協定測試改為引用常數或換算**：`server/test/room.chat.test.ts` 的 84／75 期望值、`user/protocol/draw-guess-phase2.mjs` 的 `endsAt≈now+90s`、`draw-guess-phase3.mjs` 的分數公式。

---

## 任務清單

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | `ROUND_SECONDS = 600`；`helpTopics.ts` 兩句改「10 分鐘」；README 第 14 行 | 決策 1、3；另改兩處過時註解（`countdown.ts`「01:31（作畫 90 秒）」、`server/src/app.ts`「90 秒回合內」） |
| ✅ | 測試：`room.chat.test.ts` 兩處期望值改由公式計算；其餘以 `ROUND_SECONDS` 引用者不動；四項指令各自 exit 0 | 決策 4；`room.chat` 加 `guessScore(ms)` 由 `ROUND_MS` 推導（30 秒 98、45 秒 97、跨回合 9 秒 100）；另有 4 處寫死 90 的也改：`room.chat`「分數跨回合累加」、`scoring.test.ts`「中間值」（改以 `ROUND_MS / 50` 為一級）、`countdown.test.ts` drawing 上限、`helpDialog.test.tsx` 內文；四項 0（80＋400＋766） |
| ✅ | 協定測試 `phase2`、`phase3` 改引用 `ROUND_SECONDS`（從 `shared/dist` 或改成常數 600）並跑過 | 決策 4；兩檔頂端 `const ROUND_SECONDS = 600`（註明＝shared 常數）；新 server（3293）phase1 24、phase2 33、phase3 26、phase6 5、background 14 全過；phase2 實測 `endsAt − startedAt = 600000` |
| ✅ | 瀏覽器確認：開局後倒數顯示 `10:00`、狀態列最後 10 秒警示仍在 | 2026-10-06 龍骨（3181 建置版，Node 客戶端當畫師、瀏覽器當猜題者）：開局 3 秒狀態列「作畫中 09:57」；最後 10 秒警示只看剩餘秒數（`isCountdownWarning`，與 `ROUND_SECONDS` 無關），單元測試通過 |

---

## 驗收標準

- [x] 作畫倒數從 02:00 開始，2 分鐘到才逾時揭曉（第二輪改 120 秒）
- [x] 四項指令各自 exit 0；協定測試 phase1／2／3／6／background 全過
- [x] spec、README、說明文字與實作一致

---

## 派工規範（龍骨）

- 本檔與 `backlog.md` 只准局部替換；不 commit；子代理不得登記名冊、不得跨 session 傳訊。
- Epic 10（首頁紙張質感）與 Epic 11（顏色面板）的改動仍在工作區未 commit，不要還原、不要順手改。

---

## 第二輪（2026-10-06 Rex：「10 分鐘可以改回來了，改 2 分鐘」）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | `ROUND_SECONDS = 120`；`helpTopics.ts`、`helpDialog.test.tsx`、README、`countdown.ts`／`app.ts` 註解、`phase2`／`phase3.mjs` 檔內常數改 120；四項指令與協定測試全過；倒數顯示 `02:00` | spec、overview、help-topics 表已由舵手改；2026-10-06 龍骨：測試期望值已由常數推導，這輪只改 `scoring`／`room.chat` 三處註解（120 秒制：30 秒 88、45 秒 82、一級 2.4 秒）；四項 0（80＋400＋766）；新 server（3293）phase1 24、phase2 33、phase3 26、phase6 5、background 14 全過，`endsAt − startedAt = 120000`；瀏覽器（3181，Node 畫師＋瀏覽器猜題者）開局約 14 秒時狀態列「作畫中 01:46」 |

## 踩雷紀錄

- **`spec/overview.md` 規則第 9 條的計分公式寫死 90**（2026-10-07 帆（Sail）回報）：Epic 12 改第 4、8 條時漏了第 9 條；已改為 `/ ROUND_SECONDS`（目前 120 秒）。教訓：改常數時 grep 全部文件的舊數值，不只 grep 常數名。

- **寫死 90 的測試比派工時列的多**：除了 `room.chat.test.ts` 兩處，還有同檔「分數跨回合累加」（95）、`scoring.test.ts`（1800 ms 一級、45 秒 75、30 秒 84）、`countdown.test.ts`（95_000／90_000）、`helpDialog.test.tsx`（說明內文逐字）。改成由 `ROUND_SECONDS` 推導，下次改時間不必再動測試（說明內文除外，那是逐字綁定 plan 的表）。
- **協定測試以 `node --input-type=module < 檔案` 執行**，不經打包，不方便 import `shared` 原始碼（TS）；改用檔內常數並註明與 shared 同值。
