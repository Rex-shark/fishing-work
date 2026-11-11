# 全專案 code review（2026-11-10）

> Rex 2026-11-10 要求「派個 subAgent 做全專案 /code-review」。本檔是子代理報告的整理稿，**尚未排修**；要修時另開 Epic 並把項目搬過去。

**狀態**：🔄（第一批 #1–#7、#10 已排入 Epic 21，見 [hardening.md](hardening.md)；其餘未排）
**範圍**：`server/src`、`shared/src`、三個客戶端 `src`、`user/mock`、部署設定。唯讀審查，未改任何檔案。
**驗證程度**：標「實測」者子代理以建置版 server（隔離埠 3141–3143、自帶假 iTunes／假 Ollama）重現過；標「讀碼」者讀過上下游並對照 socket.io 4.8.3 原始碼，未現場重現。海圖尚未逐項複核。

## 總評

整體風險中等偏高。payload 形狀驗證、二進位 magic 與大小上限、ack 非函式不丟例外、佇列取消與逾時、XSS 面都做得紮實。最該先修兩類：（一）單一 Node 程序扛三款遊戲，有路徑能把記憶體打爆讓三款一起掛；（二）沒有登入、經 tunnel 公開時洩題防護可被繞過、被擋訊息不限速可當答案探測器。另有三款共用的重連 bug。

## 高

| # | 位置 | 缺陷 | 觸發與後果 | 驗證 | 建議 |
|---|------|------|------------|------|------|
| 1 | `draw-guess/src/socket/client.ts:164`（draw-contest:166、song-guess:165） | 重連途中再斷線被當成加入失敗 | 自動 `player:join` 的 ack 回來前又閃斷 → socket.io 以錯誤回呼 ack → 走 `clearSession()`＋回首頁；token 丟失，原玩家在寬限內同暱稱 `NICKNAME_TAKEN`，寬限後分數歸零 | 讀碼＋對照 socket.io-client | 只有 server 明確回 `ok:false` 才清憑證；沒收到 ack 一律保留等下次 connect |
| 2 | `shared/src/draw-guess/answer.ts:8`、`shared/src/song-guess/answer.ts:44`、三款 `text.ts:10` | 零寬與不可見字元繞過洩題防護與暱稱驗證 | 題目「蘋果」，畫師送「蘋＋U+200B＋果」→ ack ok、原樣廣播，畫面就是答案；暱稱加零寬字可冒充；U+3164 可當空白暱稱；題目可設成單一零寬字 | **實測** | 正規化與控制字元檢查加 `\p{Cf}` 與 U+3164／U+2800 等隱形字元 |
| 3 | `server/src/games/draw-guess/room.ts:505-509`；放大器 `draw-contest/room.ts:369`、draw-guess 重複 join | `usedStrokeIds` 只增不減；重複 `player:join` 每次重送整個畫廊／複製整份 ops | 畫師自訂客戶端 2 分鐘內送 40 萬次 begin＋undo：RSS 90 → 262 MB、轉發 80 萬則 `draw:op`，隨後 **server SIGABRT，三款一起掛** | **實測** | 每回合 begin 次數設上限；join 冪等分支不重送畫廊；`draw:op` 轉發加頻率限制 |
| 4 | `server/src/games/draw-guess/room.ts:436-450`（song-guess `room.ts:548-557`） | 被 `SPOILER_BLOCKED` 擋下的訊息不更新 `lastChatAt`、不限速 | 連送 20 則含題目的訊息 7 ms 內全回 `SPOILER_BLOCKED`；猜歌可把多個歌名串成一則探測、二分鎖定答案 | **實測** | 被擋的訊息也更新節流時間戳，或另設探測上限 |
| 5 | `server/src/games/draw-contest/judge/queue.ts:143`、`submission.ts:34` | 一張壞圖讓整回合降級為隨機評分 | 33 bytes 假 PNG 通過交卷驗證 → Ollama 400 → `degraded=true`，其他人的正常圖也 `judgedBy:'random'`；評語佇列同理兩張就整回合關閉 | **實測** | 區分「上游連不上／逾時」（降級整回合）與「這張輸入被拒」（只影響該張） |
| 6 | `draw-contest/src/features/round/autoSubmit.ts:77`（:29） | 自動交卷失敗後永不重試 | endsAt 前 Wi-Fi 斷 → submit 立刻失敗但 `attemptedRound` 已記 → 重連後在交卷寬限內也不再送，該張 0 分 | 讀碼 | 送出成功才記 `attemptedRound` |

## 中

| # | 位置 | 缺陷與後果 | 驗證 | 建議 |
|---|------|------------|------|------|
| 7 | `server/src/games/song-guess/itunes.ts:459／430` | 快取鍵去空白但 term 保留空白，且 0 筆結果也快取：先填「JayChou」得 0 筆 → 之後「Jay Chou」10 分鐘內都 `ARTIST_NOT_FOUND` | 讀碼 | 0 筆不快取，或鍵保留空白 |
| 8 | `server/src/games/song-guess/room.ts:456-524` | setSource 在途請求不中止、對外無全域節流：volunteer→setSource→cancel 迴圈可打爆 iTunes 每 IP 額度，之後所有人 `SEARCH_FAILED` | 讀碼 | 取消舊 AbortController 或加全域節流 |
| 9 | `server/src/app.ts:136` | `close()` 先 dispose Room 再 `io.close()`，disconnect handler 重建 15 秒寬限計時器，事件迴圈被撐住、到期還改已關閉的 Room（正式環境被 `process.exit` 掩蓋） | 讀碼＋對照 socket.io | 先 `io.close()` 再 dispose，或 dispose 後 disconnect 變 no-op |
| 10 | `server/src/index.ts:11` | `Number(process.env.PORT ?? 80)`：`PORT=` 空字串 → 0 → 綁隨機埠，同事連不上、Docker healthcheck 失敗 | 讀碼 | 比照 `readInt` 退回 80 並 warn |
| 11 | `draw-guess/src/features/canvas/Canvas.tsx:97` | pointermove 不檢查按鍵、未處理 lostpointercapture：漏收 pointerup 後滑鼠移過畫布就持續畫並廣播 | 讀碼 | `e.buttons === 0` 即結束筆畫，加 `onLostPointerCapture` |
| 12 | `draw-guess/src/store/game.ts:169` | 重連快照以訊息 id 對應舊 Blob URL；server 重啟後 id 從 m1 重數，聊天室顯示重啟前的舊圖 | 讀碼 | 快照的 `you` 變了先 revoke 清空，或 server 用跨程序唯一 id |
| 13 | `draw-guess/src/store/game.ts:170` | 重連快照覆蓋 `scoreBaseline`，閃斷後「本回合 +N」消失 | 讀碼 | 同一回合沿用既有基準 |
| 14 | `song-guess/src/store/game.ts:131` | `clockOffset` 每次 `round:update` 覆寫，單一封包延遲 800 ms 就晚 0.8 秒起播 | 讀碼 | 保留延遲最小的樣本 |
| 15 | `draw-contest/src/features/reference/ReferencePicker.tsx:56` | 只有參考圖區攔 drop；拖偏時瀏覽器直接開啟圖片離開遊戲 | 讀碼 | 視窗層級 dragover／drop preventDefault |
| 16 | `song-guess/src/features/player/AudioPlayer.tsx:84` | 試聽載入失敗後起播計時器把 `blocked` 蓋成 `waiting`，重試按鈕消失、整首沒聲音 | 讀碼 | `audio.error !== null` 時維持 blocked |
| 17 | `draw-guess/src/shells/vscode/QuickInput.tsx:170` | 滑鼠懸停改 active 不還原，出題框按 Enter 可能執行「放棄本回合」 | 讀碼 | 有輸入框時 Enter 固定第一項，或懸停不改 active |
| 18 | `draw-contest/src/layout/uiStore.ts:70`（song-guess 同） | `helpTopic` 離開遊戲不重設，重新加入後說明對話框自動彈出 | 讀碼 | reset 時一併清掉 |
| 19 | `song-guess/src/shells/meet/MeetShell.tsx:186` | < 768px 聊天覆蓋層與出題／說明對話框同為 z-30，對話框被蓋住 | 讀碼 | 對話框層級提高或開對話框時收起聊天 |
| 20 | `song-guess/src/features/round/RoundStatus.tsx:50`（draw-contest :54） | 錯誤顯示用點擊當下閉包的 round 比對；等待 ack 期間 round 換參照就不顯示錯誤 | 讀碼 | 失敗當下讀 store 的 round |

## 低（效能與維護）

| # | 位置 | 說明 |
|---|------|------|
| 21 | 三款 `features/round/countdown.ts` | `getSnapshot` 回原始毫秒，RoundStatus 每秒重繪 4 次，idle／ended 也照跑 |
| 22 | 三款 `socket/client.ts` ack 樣板、三份 `nickname.ts`／`text.ts`、殼層選單、server 的 `httpError`／`postJson`／`readInt` | 大量逐字複製，改一處易漏（第 1 項的修正正落在 ack 樣板） |
| 23 | `ImageMime` vs `IMAGE_MIMES`、`SongSource` vs `SOURCE_TITLE` | 型別與常數雙寫，改一邊 tsc 不報錯 |
| 24 | `shared/src/*/text.ts` `isBlankAfterNormalize` | `trim()` 後為死碼，宣稱要擋的隱形字元擋不住（見第 2 項）；Epic 21 已刪 |
| 25 | `server/src/games/draw-guess/room.ts` `draw:op` 丟棄 log | Epic 21 實作時發現（水手長 2026-11-10）：`strokeLimit` 已改每回合只寫一次，但其他丟棄原因（如 `undoNotLast`）仍逐則寫 info log，灌 10 萬對約 19.8 萬行。建議所有丟棄原因統一「每回合每種原因只寫第一次＋回合結束時寫一行各原因的累計數」 |

### Epic 21 驗收時新增

| # | 位置 | 說明 |
|---|------|------|
| 26 | 三款 `socket/client.ts`（socket.io 重連設定） | 用 socket.io 預設重連退避：網路恢復後實測再等 1.5～3.9 秒才連上。繪圖比賽在 `endsAt` 前後斷網約 4.5 秒時，自動交卷 5 次有 2 次因重連落在 5 秒寬限之後而交不出去（PNG 已預先匯出，不是匯出慢）。改善方向：瀏覽器 `online` 事件時主動 `socket.connect()`、把 `reconnectionDelayMax` 調小（例如 2000）；不建議放寬 `SUBMIT_GRACE_SECONDS`（會拖慢揭曉） |

## 看過沒問題

- server 的 payload 形狀驗證（`readJoinPayload`、`splitArgs`、`readImagePayload`、`checkSubmission`、`checkReference`、`parseSourcePayload`、`sanitizeDrawOp`）。
- 評分／評語佇列的取消與逾時、`choosingSeq` 丟棄過期結果、handler 全包 try／catch。
- 客戶端無 `dangerouslySetInnerHTML`／`innerHTML`／`eval`；object URL 有配對 revoke。
- iTunes 回傳網址只收 http(s)、榜單 id 只收純數字；靜態檔 fallback 無路徑穿越。

## 沒審到

- 客戶端元件只讀碼、未在瀏覽器跑；DESIGN token 合規未逐一核對。
- 第 1、7、8 項未現場重現（重現腳本先被第 3 項打掛 server）。
- 比賽歷史 IndexedDB 失敗路徑、各 `vite.config.ts`、Dockerfile 未深入；`other/skills/MAINTENANCE.md` 依賴字串未比對。
