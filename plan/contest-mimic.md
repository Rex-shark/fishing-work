# Epic 20：繪圖比賽「像不像比賽」模式（參考圖臨摹，Clef 比相似度）

> 出題者在「輸入標題」對話框附一張參考圖（選填）。有參考圖的回合＝像不像比賽：大家照著畫，Clef 同時看參考圖與作品打相似度分數，揭曉畫廊第一格顯示參考圖。不加新遊戲、不加新前端，同一個房間兩種玩法混著出。

**狀態**：✅
**起訖**：2026-10-26 ~ 2026-10-26
**負責**：Rex × 海圖（Chart，架構師）；實作派水手長（Bosun）；事務長（Purser）同步出題技能

---

## 需求（Rex 2026-10-26）

1. 海圖提的六個新遊戲點子裡選「5. 像不像比賽」：出題者傳一張參考圖，大家臨摹，AI 比對相似度打分。
2. **評分用 Clef**。
3. 形式：Rex 選「繪圖比賽的一種出題模式」（不是第四款遊戲）。

## 可行性探測（海圖 2026-10-26，真 Clef `clef:27b-nvfp4`、Ollama 0.40.3）

`/v1/systemone` 的 `images` 放兩張（參考圖、作品），一題 `similarity`（5 級）：

| 參考圖：白底紅色實心圓 | 作品 | similarity（0～4） | confidence |
|---|---|---|---|
| | 黑底白線圓環 | **2.33** | 0.30 |
| | 黑底白線方框 | 0.19 | 0.73 |
| | 黑底白線三角形 | 0.11 | 0.83 |
| | 參考圖本身 | 3.65 | 0.53 |

分得開；指示「不管顏色與線條粗細」有效（白底彩色圖對黑底白線仍給 2.33）。請求格式與現況相同，只是多一張圖、換題目。

## 設計決策

- 決策 1：**模式由「有沒有參考圖」決定**：`round:setTopic` payload 加選填 `reference`（JPEG bytes）；有 → `RoundPublic.mode = 'mimic'`，無 → `'topic'`（現況）。題目文字仍必填（1～20 字，當標題：例「皮卡丘」「照著畫」）。
- 決策 2：**參考圖由客戶端正規化成 JPEG**：出題者選檔或拖曳（png／jpeg／webp／gif 第一幀皆可），客戶端以 canvas 縮到長邊 ≤ 1280、匯出 `image/jpeg` 品質 0.9，再送 server。原因：server 沒有影像庫（pngjs 已移除）；JPEG 讓照片維持幾百 KB；Clef 吃 1280 以內的圖速度與現況相同。server 只驗 JPEG magic（`FF D8 FF`）與 ≤ `MAX_REFERENCE_BYTES`（2 MiB）→ `REFERENCE_INVALID`。
- 決策 3：**參考圖以二進位事件 `contest:reference` 廣播**（比照 `contest:gallery`）：drawing 開始時廣播給所有在線者；join 時若 `round.mode === 'mimic'`（drawing／judging／ended）或 `results` 非 null 且 `lastMode === 'mimic'` 則補送。server 保留本回合與上回合（results 對應）的參考圖 bytes，下一回合 drawing 開始時換掉。
- 決策 4：**評分（§6 mimic 版）**：`images: [reference, drawing]`、`state.task` 改為臨摹任務、題目 `similarity`（5 級）＋ `effort`（3 級，同現況）；**不問 `is_topic`**（主體由參考圖定義）。合成 `score = round(100 × (0.9 × similarity/4 + 0.1 × effort/2))`，`confidence = similarity.confidence`。`JudgeInput` 加選填 `reference`；`random` 評分器對 mimic 回合把 reference bytes 一併進種子。
- 決策 5：**評語（Epic 15）在 mimic 回合也看兩張圖**：`images: [reference, drawing]`，user 文案「題目「{topic}」，評分 {score} 分。第一張是參考圖，第二張是參賽者「{nickname}」照著畫的，給一句評語。」稱讚版同理加「，這張是本回合第一名」。system 不變。
- 決策 6：**作畫中要看得到參考圖**：投影片區右上角浮一個「參考圖」面板（寬 25%、最小 200px、最大 360px、16:9 內縮放、1px `--border`、陰影），可點放大（同揭曉放大檢視，Esc 關）、可收合成小按鈕再展開；本機偏好不記。旁觀者與出題者也看得到。`topic` 模式沒有此面板。
- 決策 7：**揭曉**：投影片瀏覽第一格是參考圖卡片（標題「參考圖」、無名次、無分數、無評語、可放大），之後才是名次卡；備忘稿列「上一回合：{題目}（像不像）　第一名：X（n 分）」。歷史（Epic 17）把參考圖一起存進 IndexedDB（`reference: Blob | null`），回看時同樣第一格顯示；舊存檔沒有該欄位視為 null。
- 決策 8：**出題對話框**：標題「輸入標題」不變，題目欄下方加「參考圖（選填）」：拖曳區／「選擇圖片」按鈕、選後顯示縮圖與「移除」；檔案不是圖片或轉檔失敗顯示錯誤、不送出；送出中欄位 readOnly。既有 UI-DEP（事務長技能 `set-draw-contest-topic`）的輸入框與按鈕不變；**知會事務長**：新增欄位與 aria-label「參考圖」「選擇圖片」「移除參考圖」。
- 決策 9：**系統訊息**：回合開始「X 出題「{topic}」（像不像比賽：照著參考圖畫）」；揭曉不變。說明對話框「出題」「評分」各加一句。
- 決策 10：契約改動（§4 程式區塊）：`ContestMode`、`RoundPublic.mode`／`lastMode`、`ReferenceImage`、`contest:reference`、`round:setTopic` payload、`REFERENCE_INVALID`、常數 `MAX_REFERENCE_BYTES`；shared 逐字同步，**先知會水手長**。
- 決策 12（事務長 2026-10-26 兩問，海圖定案）：揭曉參考圖卡按鈕用 `data-reveal-reference`（不帶 `data-reveal`），aria-label「參考圖（放大）」／「參考圖（回到全部）」；作畫中面板 `section[aria-label="參考圖"]`，按鈕「放大參考圖」「收合參考圖」「展開參考圖」。出題對話框的題目輸入框**維持 `<input type="text">`**、檔案欄位用 `<input type="file">`（事務長腳本以 `input:not([type="file"])` 取題目框）。事務長已依 spec 預改技能並重裝到 pi-agent、ollama-agent，待實作驗收後核對。
- 決策 13（水手長完成回報 1–8，2026-10-26 海圖定案）：§5.1b 更正 `maxHttpBufferSize` 為 `MAX_IMAGE_BYTES` + 64 KiB；`reference: null` → `REFERENCE_INVALID`；server 只存一份參考圖；事件順序與 log 欄位照實作寫進 spec；轉 JPEG 前鋪白底 `REFERENCE_MATTE`；說明對話框兩句逐字寫進 design；子代理自加的畫面文字（拖曳區、轉檔中、錯誤四句、「縮小參考圖」、「載入中」）寫進 design 並知會事務長；歷史回看的備忘稿列不加「（像不像）」（維持 Epic 17 格式），選到非圖片只拒收該檔、保留先前參考圖。真 Clef 英文指示版：圓環 2.585／方框 0.177／三角形 0.118／原圖 3.746，fixture `server/test/fixtures/draw-contest.mimic-clef.json`。
- 決策 11：**假 Ollama** `/v1/systemone` 接受 `images` 兩張（分數雜湊含兩張）；協定測試新檔 `draw-contest-mimic.mjs`。

## 任務清單

### Phase 0：規格（海圖）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | 本計畫；spec/draw-contest/architecture.md §4 契約與常數、§5 狀態機與 §5.1b 參考圖驗證、§6 mimic 評分、§6.1 評語、§7 客戶端；overview 需求 8 與規則；design §2 各階段、§3 畫廊、§3.1 歷史；backlog、CLAUDE.md | 2026-10-26 |

### Phase 1：shared ＋ server ＋ 假 Ollama（水手長派工）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | `events.ts`／`constants.ts` 依 §4 逐字同步；契約測試 | 決策 10 |
| ✅ | `room.ts`：setTopic 收 `reference`、驗證（`reference.ts`：JPEG magic、大小）、`mode`／`lastMode`、`contest:reference` 廣播與 join 補送、保留上回合參考圖；系統訊息 | 決策 1–3、9 |
| ✅ | `judge/`：`JudgeInput.reference`；`ollama.ts` mimic 版請求（similarity＋effort、合成 0.9／0.1）；`random.ts` 種子含 reference；單元測試含真 Clef 回應樣本 fixture | 決策 4 |
| ✅ | `commentary/`：mimic 回合兩張圖與新文案 | 決策 5 |
| ✅ | 假 Ollama 兩張圖；協定測試 `draw-contest-mimic.mjs`（有參考圖→mode mimic、`contest:reference` 廣播與中途加入補送、JPEG 驗證三種失敗、評分走雙圖、揭曉 lastMode、下一回合 topic 模式不帶參考圖）；既有協定測試不退化 | 決策 11 |

### Phase 2：客戶端（水手長派工）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | 出題對話框參考圖區：選檔／拖曳、canvas 縮圖轉 JPEG（`features/reference/normalize.ts` 純函式可測）、預覽、移除、錯誤 | 決策 2、8 |
| ✅ | store 收 `contest:reference`（object URL 建／revoke）；作畫中「參考圖」浮動面板（展開／收合／放大）；旁觀者亦顯示 | 決策 6 |
| ✅ | 揭曉第一格參考圖卡；備忘稿列「（像不像）」；歷史存檔含參考圖與回看顯示 | 決策 7 |
| ✅ | 說明對話框兩句；殼層只給偽裝字樣，`shellBoundary` 照舊；測試 | 決策 9 |

### Phase 2.5：375px 版面補修（驗收低嚴重度 2 項，海圖 2026-10-26 決定修）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | 出題對話框參考圖預覽列窄寬度 `flex-wrap`（或縮圖 `max-w-full`），「移除」不被截；作畫中面板在 < 540px（工具列收合斷點）改 `max-width: calc(100% - 24px)` 且預設收合；375／768 重測無溢出（水手長派工） | |

### Phase 3：驗收

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | 水手長回報 → 海圖派 acceptance-reviewer（四項、契約逐字、協定測試、瀏覽器：上傳照片出題、作畫中面板、揭曉第一格、歷史回看、真 Clef 一回合分數合理、topic 模式不退化） | 2026-10-26 有條件通過：四項 exit 0（shared 218、server 959、draw-guess 931、draw-contest 881、song-guess 591）；契約逐位元組一致（7100 bytes）；協定 9 檔全過，新寫 `draw-contest-mimic-extra.mjs` 37/37；瀏覽器三回合（mimic→topic→mimic）全 PASS，透明 PNG 轉 JPEG 白底確認；真 Clef 臨摹 84 分／亂畫 9 分，評語看得出對照參考圖；低嚴重度 2 項皆 375px 版面（對話框預覽列「移除」被截、面板 min-width 200 > 投影片區 195），海圖決定補修（Phase 2.5） |
| ✅ | 事務長：`set-draw-contest-topic` 技能補「參考圖選填」說明（不上傳即為原玩法） | 2026-10-26 事務長依 spec 預改兩份技能與輔助腳本（題目框選法 `input:not([type="file"])`、略過參考圖卡、認 mimic 系統訊息），對建置版回歸通過；待 Rex 目視後對實際畫面核對 |
| ✅ | Rex 目視 | 2026-10-26 Rex 以 IDEA 實測「看起來沒問題」 |

## 驗收標準

- [x] 四項指令 exit 0；`events.ts`／`constants.ts` 與 spec §4 逐字一致。
- [x] 出題附圖 → 所有人作畫中看得到參考圖、可放大／收合；不附圖 → 與現況完全相同。
- [x] 真 Clef：照著參考圖畫的分數明顯高於亂畫；揭曉第一格是參考圖、名次卡不含它；評語看得出是對照參考圖講的。
- [x] 中途加入與重新整理都能收到參考圖；歷史回看第一格有參考圖。
- [x] 參考圖非 JPEG 或 > 2 MiB → `REFERENCE_INVALID`，仍在 choosing。
- [x] 既有繪圖比賽協定測試與另兩款不受影響。

## 踩雷紀錄

（尚無）
