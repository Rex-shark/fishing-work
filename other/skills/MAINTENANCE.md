# 技能維護紀錄（繪圖比賽）

給維護技能的人看的，玩遊戲的 agent 不需要讀，安裝到別的專案時也不會帶過去。維護者：事務長（Purser）。

涵蓋 `play-draw-contest`（含 `scripts/draw-helper.js` 與 `references/manual-ui.md`）與 `set-draw-contest-topic`。

## 依賴清單

技能與輔助腳本依賴 draw-contest 簡報殼層的下列畫面文字、無障礙標籤、行為與常數。遊戲改了其中任何一項，就要回來更新對應的檔案。搜尋方式：

```bash
grep -n "UI-DEP\|CONST-DEP\|BUG-DEP" other/skills/MAINTENANCE.md
```

- UI-DEP 首頁：「繪圖比賽」「暱稱」「介面風格」「簡報」「進入遊戲」「這個暱稱已經有人使用」「此暱稱已在其他分頁或連線重新加入」；`input[name="nickname"]` 與它所在的 form；錯誤訊息是 `[role="alert"]`
- UI-DEP 殼層：「備忘稿」「備忘稿：」「註解」「新增註解…」「聊天輸入」「聊天訊息」「玩家清單」「投影片瀏覽」「繪圖」「說明」「已連線」；分頁標題「簡報1 - PowerPoint」、作畫中前綴「● 」；窄視窗收合玩家清單的按鈕「投影片 n / n，顯示投影片縮圖（玩家清單）」；空白投影片「按一下以新增標題」「按一下以新增副標題」
- UI-DEP 聊天室：`[aria-label="聊天訊息"] > li[data-kind="chat"|"system"]`；玩家訊息的暱稱在 `div > span:not([aria-hidden])`、時間在 `time`、內文在 `p`；輸入框 `[aria-label="聊天輸入"]` 與它所在的 form（送出走 form 的 submit）；系統訊息「X 加入」「X 出題「…」，開始作畫」「揭曉：第一名 X（N 分）」「X 取消出題」「X 出題逾時」「出題者 X 離開」
- UI-DEP 出題入口：按鈕的 aria-label 以「：我出題」結尾（簡報殼層是「從目前投影片開始：我出題」）；人數不足時沒有這顆按鈕，改顯示「等待其他玩家加入（1/2）」；錯誤訊息「目前已有回合進行中」「至少要 2 位在線玩家才能開始」
- UI-DEP 出題對話框：`[role="dialog"]`，標題「輸入標題」；輸入框 `[role="dialog"] input` 與它所在的 form；按鈕「確定」「取消」；字數與倒數「0/20 · 01:00」；錯誤 `[role="dialog"] [role="alert"]`「題目需為 1～20 個字，不可含控制字元，也不能只有空白」
- UI-DEP 回合狀態列：等待中「上一回合：—」或「上一回合：{題目}　第一名：X（n 分）」、出題「（X ）正在輸入標題… mm:ss」、作畫「作畫中 mm:ss」「標題：」「本回合旁觀：」「已儲存 n/m」、評分「正在評分 n/m…」、揭曉「{題目}　第一名：X（n 分）」或「{題目}　沒有人交卷」（題目後是全形空白 U+3000；隨機評分加「（隨機評分）」）；各段是 `[aria-label="備忘稿"] [role="status"]` 的直接子元素。`status()` 以第一段的句型判斷階段、以全形空白切出題目
- UI-DEP 畫布：canvas 的 aria-label「畫布」「畫布（已鎖定）」；「已儲存，等待其他人…」；畫布接受 pointerId 1 的 pointerdown／pointermove／pointerup
- UI-DEP 工具列：「選擇顏色（目前 #RRGGBB）」「顏色 #RRGGBB（色名）」「顏色面板」「色相」「飽和度與明度」「粗細」「更多畫筆設定」「把背景設為目前顏色」「橡皮擦」「復原」「清空畫布」；粗細滑桿、色相條、飽和度明度方塊都是「點哪裡就是哪個值」的線性對應
- UI-DEP 交卷：「完成」「儲存投影片？」「儲存」
- UI-DEP 揭曉：`ol[aria-label="投影片瀏覽"]`；`button[data-reveal]` 的 aria-label「第 N 名 暱稱，X 分（，隨機評分）（，你）（，メスガキ：評語）（放大）」；`[data-reveal-comment="pending"|"text"]`；評語前綴「メスガキ」、產生中「メスガキ：正在寫評語」、卡片評語不截斷
- UI-DEP 行為：choosing 階段不顯示揭曉畫廊；評語比分數晚到，第一名那句通常最晚、最壞約兩次評語時間，單張逾時 30 秒，所以「正在寫評語」最久約 60 秒（Epic 15 Phase 5，水手長 2026-10-13 知會；技能據此把等評語的上限定在約 100 秒）；單張評語失敗時那張沒有評語行；第一名那句不保證是稱讚；按下出題按鈕後對話框要等伺服器回應才出現；題目送出失敗後焦點留在輸入框、原內容保留；加入房間不換頁（在首頁裝的腳本會留著）
- CONST-DEP：DRAW_SECONDS 120、CHOOSING_SECONDS 60、SUBMIT_GRACE_SECONDS 5、RECONNECT_GRACE_SECONDS 15、MIN_PLAYERS 2、NICKNAME_MAX 12、TOPIC_MAX 20、CHAT_MAX 200、CANVAS_LOGICAL 1280×720、PALETTE 十色、BRUSH 1–64 預設 4、粗細滑桿鍵盤步進 1／8、色相 0–360、飽和度與明度 0–100
- BUG-DEP：（目前沒有）

## 改了 draw-helper.js 之後

1. 重新產生壓縮版（在 fishing-work 專案根目錄；結尾的分號要拿掉，agent 才能把內容包進 `() => { return (…) }`）：

   ```bash
   node_modules/.bin/esbuild other/skills/play-draw-contest/scripts/draw-helper.js --minify --charset=utf8 | sed -e '$ s/;$//' > other/skills/play-draw-contest/scripts/draw-helper.min.js
   ```

2. 重新安裝到用得到的專案（見 `other/README.md`）。

## 驗證方式

- 隔離的測試伺服器（不碰 :80）：`HOST=127.0.0.1 PORT=3191 JUDGE=random COMMENT=off node server/dist/index.js`，兩個分頁各加入一位玩家跑完一回合。
- 用真正的 Playwright MCP 驗證：`npx -y @playwright/mcp@latest --headless --isolated`，以 `browser_run_code_unsafe` 的 `page.addScriptTag({ path })` 載入壓縮版，再用 `browser_evaluate` 呼叫 `dc.*`。

## 沿革

- 2026-10-12：建立兩份技能；子代理實戰兩回合（第一回合兩個同模型；第二回合 opus／sonnet／haiku）後修訂；對上海圖當日通知的兩次畫面改動（出題對話框失焦修正、揭曉列帶題目與評語不截斷）。
- 2026-10-13：水手長知會 Epic 15 Phase 5（第一名評語可能更晚、單張逾時 30 秒），技能加上等評語的上限。
- 2026-10-13：子代理連玩兩回合無誤。整理：流程改以腳本函式為主（新增 `join`／`say`／`volunteer`／`setTopic`／`cancelTopic`），手動操作移到 `references/manual-ui.md`，依賴清單從 SKILL.md 檔頭移到本檔。以 Playwright MCP 1.64（無頭）對建置版實測整回合通過。安裝到 pi-agent 專案。
