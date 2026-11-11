# Epic 21：code review 修正（第一批：會掛站與同事會遇到的）

> 2026-11-10 全專案 code review（[code-review-2026-11.md](code-review-2026-11.md)）24 項中，先修高 6 項＋中 2 項（#7 歌手快取、#10 PORT）。其餘中、低項留第二批。

**狀態**：✅
**起訖**：2026-11-10 ~ 2026-11-11
**負責**：Rex × 海圖（Chart，架構師）；實作派水手長（Bosun）

---

## 需求（Rex 2026-11-10）

「派個 subAgent 做全專案 /code-review」→ 報告後 Rex「好開工」，採海圖建議分兩批，本 Epic 為第一批。

## 設計決策（項目編號＝code review 編號）

- 決策 1（#2 不可見字元）：三款 `shared/src/*/text.ts` 各加兩個純函式（規則相同，逐字複製，去重留第二批 #22）：
  - `stripInvisible(s)`：移除 `\p{Cf}`、變體選擇符（U+FE00–FE0F、U+E0100–E01EF、U+180B–180F、U+034F）、隱形填充（U+115F、U+1160、U+3164、U+FFA0、U+2800）。
  - `hasForbiddenInvisible(s)`：含上述集合**扣掉 U+200D（ZWJ）與 U+FE0F（VS16）**的任一字元（這兩個是 emoji 組合用，允許出現）。
  - **驗證**（暱稱、題目、歌手名、聊天文字）：`hasForbiddenInvisible` 為真，或 `stripInvisible(trim 後)` 為空 → 各自既有的 INVALID 錯誤碼（`NICKNAME_INVALID`／`TOPIC_INVALID`／`ARTIST_INVALID`／`MESSAGE_INVALID`），文案不變。
  - **比對**（`normalizeAnswer`、`normalizeTitle`／`normalizeFull`、`nicknameKey`、`artistKey`）：第一步先 `stripInvisible`。於是「蘋＋ZWJ＋果」仍被洩題防護攔下、「Rex＋VS16」與「Rex」視為同暱稱。
  - `isBlankAfterNormalize` 死碼（#24）順手刪除。
- 決策 2（#3 記憶體）：
  - 我畫你猜新常數 `MAX_STROKES_PER_ROUND = 2000`：本回合已用過的 strokeId 數達上限後，新的 `begin` 靜默丟棄並 log `strokeLimit`（正常作畫 2 分鐘遠低於此；`undo`／`clear` 不退還名額）。
  - 三款新常數 `JOIN_MIN_INTERVAL_MS = 1000`：**已綁定玩家的 socket** 再送 `player:join`，距上次受理不足 1 秒 → `RATE_LIMITED`「操作太頻繁，請稍候再試」；受理時回快照但**不重送任何二進位事件**（`contest:gallery`、`contest:reference`、聊天圖片），這些只在首次加入與 token 接管時補送。未綁定的 socket 不受此限（首頁打錯暱稱可立刻重試）。
  - `draw:op` 轉發頻率限制留第二批評估（有了筆畫上限後單回合轉發量已有界）。
- 決策 3（#4 洩題探測）：我畫你猜與猜歌新常數 `SPOILER_COOLDOWN_MS = 3000`：`chat:send` 被 `SPOILER_BLOCKED` 擋下時，該玩家接下來 3 秒內的 `chat:send` 一律 `RATE_LIMITED`（含正確答案）；被擋的訊息也更新 `lastChatAt`。原因：「被擋」本身洩漏「這串字含答案」，不限速可毫秒級二分探測；3 秒冷卻讓探測要付出時間分數的代價。
- 決策 4（#5 壞圖拖累整回合）：
  - 評分器錯誤分兩類：**輸入被拒**（Ollama 回 HTTP 4xx，408／429 除外）→ 只有這一張退回 random、log `judge.rejected`，**不設 `degraded`**、`judgeMode` 不變；**上游不可用**（連線失敗、逾時、5xx、408／429、回應解析失敗）→ 照現況整回合降級。
  - 評語器同理：4xx（408／429 除外）只讓該張 `comment: null`，**不計入連續失敗次數**。
  - 交卷 PNG 加結構檢查（`submission.ts`，不解碼、不算 CRC）：簽章後逐 chunk 走訪，長度不得越界；第一個 chunk 為 `IHDR`（長度 13、寬高＝`CANVAS_LOGICAL`）；至少一個 `IDAT`；最後一個 chunk 為長度 0 的 `IEND` 且檔案恰好在此結束。不合 → `SUBMISSION_INVALID`。參考圖 JPEG 加檢查結尾 `FF D9`。
- 決策 5（#1 重連）：三款客戶端 `autoJoin`：**只有 server 明確回 `ok: false` 才清憑證回首頁**。ack 沒回來（socket.io 回呼 err：逾時或途中斷線）→ 保留憑證；此刻已斷線就等下次 `connect`；仍連線（真逾時）則 2 秒後重試，最多 3 次，仍失敗 → 回首頁顯示「自動重新加入失敗：連線逾時」但**不清憑證**（重新整理可再試）。首頁手動加入行為不變。
- 決策 6（#6 自動交卷）：`autoSubmit` 改為**送出成功（ack ok 或 `ALREADY_SUBMITTED`）才記該回合已自動交卷**；失敗（未連線、逾時、其他錯誤）不記，之後每次狀態變動（含重連快照）與每 1 秒重新判斷，直到成功、收到不可重試的錯誤（`NOT_DRAWING`／`NOT_PARTICIPANT`／`SUBMISSION_INVALID`）或 phase 離開可交卷期間。
- 決策 7（#7 歌手快取）：iTunes 歌手搜尋**回 0 筆不寫快取**（快取鍵規則不變）。榜單與動漫熱門本來就只存成功結果，不動。
- 決策 8（#10 PORT）：`server/src/index.ts` 的 `PORT` 改用與其他環境變數相同的整數讀取：未設、空字串、非整數、超出 1–65535 → 退回 80 並 log warn。
- 決策 9：契約 `events.ts` 不變（沿用既有錯誤碼）；只有三款 `constants.ts` 與 spec 常數表新增常數。事務長技能不受影響（無畫面文字變動）；`CONST-DEP` 不含新常數。
- 決策 11（水手長完成回報 1–6，2026-11-10 海圖定案）：自動重加入「重試 3 次＝共送 4 次」照實作；**「輸入被拒」改白名單 400／413／415／422**，404／401／403 等算上游不可用照舊降級；**洩題冷卻期間的 `RATE_LIMITED` 換專用文案**「剛才的訊息含答案被擋下，請等 3 秒再發言」（秒數由常數組字）；地區旗（tag 字元）維持拒絕不放寬；子代理自定細節全數採用（剝除後為空含 trim、PORT 未設不 warn、節流從受理起算且接管不受限、評語被拒 log reason 'rejected'、逾時後才回的 4xx 算逾時、自動交卷本機期限只限重試、重試次數歸零時機）；**`strokeLimit` log 每回合只寫第一次**（原列第二批，順手修）。水手長另把 `INVISIBLE_FORBIDDEN` 的 ZWJ 改成 `\u{200D}` 跳脫寫法。hardening.mjs 的 RSS 斷言改以轉發數為主判定。
- 決策 12（驗收回報，2026-11-11 海圖定案）：自動交卷改為**到時先匯出 PNG 留存、重試直接送**（省掉重連後 1 秒的 `toBlob`）；`PORT` 只接受純十進位數字。重連退避與 `SUBMIT_GRACE_SECONDS` 不動。draw-guess `events.ts` 檔頭註解「舵手」屬歷史文字，不改。水手長實作自選三點（匯出失敗視同送出失敗、內容為到時那一刻的筆跡、匯出期間不鎖畫布）採用；`PORT` 另拒 `+80` 與全形數字。
- 決策 10（驗證）：新協定測試 `user/protocol/hardening.mjs`（或各款一檔）涵蓋：零寬字元暱稱／題目／聊天被拒、ZWJ 夾答案仍被擋、同暱稱加 VS16 → `NICKNAME_TAKEN`；begin＋undo 迴圈在 2000 次後被丟棄且 server 存活（RSS 不爆）；已加入 socket 連送 `player:join` → `RATE_LIMITED` 且無畫廊重送；`SPOILER_BLOCKED` 後 3 秒內 `RATE_LIMITED`；假 PNG（33 bytes、缺 IEND、缺 IDAT）→ `SUBMISSION_INVALID`；假 Ollama 對某張回 400 時其他張仍 `judgedBy: 'ai'`；歌手 0 筆後同鍵再查會再打一次上游；`PORT=` 空字串啟動綁 80（測試用 `PORT=` 改驗 log warn 與 fallback 邏輯的單元測試即可，不實際綁 80）。code review 子代理的重現腳本（scratchpad `review-repro.mjs`）可參考。

## 任務清單

### Phase 0：規格（海圖）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | 本計畫；spec/architecture.md §4 常數與 §9.1、spec/draw-contest/architecture.md §5.5、spec/song-guess/architecture.md §5.4；backlog、CLAUDE.md | 2026-11-10 |

### Phase 1：shared ＋ server（水手長派工）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | 三款 `text.ts`：`stripInvisible`／`hasForbiddenInvisible`；驗證與比對函式套用；刪 `isBlankAfterNormalize`；單元測試 | 決策 1；2026-11-10 A 份子代理（`shared/test/invisible.test.ts`；我畫你猜題目／聊天驗證在 server `topic.ts`／`chat.ts` 也套用） |
| ✅ | 三款 `constants.ts`：`JOIN_MIN_INTERVAL_MS`；draw-guess `MAX_STROKES_PER_ROUND`；draw-guess／song-guess `SPOILER_COOLDOWN_MS` | 決策 2、3；常數測試依 spec 表更新（2026-11-10） |
| ✅ | draw-guess `room.ts`：筆畫上限；三款 register／room：已綁定 socket 的 join 節流與不重送二進位 | 決策 2；draw-guess（筆畫上限＋節流）、song-guess（節流）2026-11-10 A 份完成（兩款 join 本來就不送二進位）；draw-contest 由 B 份完成（2026-11-10） |
| ✅ | draw-guess／song-guess `room.ts`：洩題冷卻 | 決策 3；2026-11-10 A 份 |
| ✅ | draw-contest `judge/`、`commentary/`：錯誤分類；`submission.ts` PNG 結構檢查；`reference.ts` JPEG 結尾 | 決策 4；`judge/httpError.ts`（`UpstreamHttpError` 帶 status、`isInputRejected`），假 Ollama 加 `MOCK_REJECT_MARKER`／`MOCK_CHAT_REJECT_MARKER`／`MOCK_REJECT_STATUS`；協定測試 `draw-contest-hardening.mjs`（2026-11-10） |
| ✅ | song-guess `itunes.ts`：0 筆不快取；`server/src/index.ts` PORT | 決策 7、8；2026-11-10 A 份（`readPort` 在 `server/src/lib/network.ts`；假 iTunes 加 `/_mock/requests` 計數端點） |
| ✅ | 協定測試與單元測試（決策 10）；既有測試不退化 | 2026-11-10 A 份：`user/protocol/hardening.mjs`（三款不可見字元、我畫你猜／猜歌 join 節流與洩題冷卻、筆畫上限壓測、歌手 0 筆不快取）＋我畫你猜／猜歌既有 12 檔重跑；繪圖比賽部分由 B 份完成（`draw-contest-hardening.mjs` 38 項＋既有 7 檔）；水手長複驗 2026-11-10 全過 |

### Phase 2：客戶端（水手長派工）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | 三款 `socket/client.ts` autoJoin 新規則＋測試（`sessionResume` 類） | 決策 5；狀態機抽成各款 `socket/autoJoin.ts`（2026-11-10） |
| ✅ | draw-contest `autoSubmit.ts` 新規則＋測試 | 決策 6（2026-11-10） |
| ✅ | 客戶端首頁／對話框的本地驗證若有呼叫 shared 驗證函式，確認新規則的錯誤訊息正常顯示 | 決策 1；只有猜歌出題對話框預檢 `validateArtist`，其餘照 server ack 顯示（2026-11-10） |

### Phase 2.5：決策 11 補做（水手長派工）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | 被拒白名單 400／413／415／422（judge 與 commentary）；洩題冷卻專用文案（draw-guess、song-guess）；`strokeLimit` log 每回合一次；測試同步 | 2026-11-10；A 份完成：洩題冷卻專用文案（冷卻先於一般間隔判定，冷卻期間一律專用文案）、`strokeLimit` log 每回合一次（`DrawOutcome.quiet`）與測試；白名單由 B 份完成（`INPUT_REJECTED_STATUSES`；404 等降級，協定測試 `draw-contest-hardening.mjs` 46 項）；水手長複驗 2026-11-10 全過 |

### Phase 2.6：決策 12 補做（水手長派工）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | `autoSubmit`：到時先匯出 PNG 留存（每回合一次）、重試直接送；測試同步 | 2026-11-11；`submit.ts` 加 `exportMyCanvas`／`submitPreparedPng`；匯出失敗比照送出失敗（1 秒後、期限內再匯出） |
| ✅ | `readPort` 只收 `^\d+$`；測試同步 | 2026-11-11；水手長 2026-11-11 完成：`^\d+$` 判定，測試補 `0x50`／`1e3`／`+80`／全形數字 |

### Phase 3：驗收

> Phase 2.6 複驗（驗收子代理 2026-11-11）：四項 exit 0（draw-contest 927、server 1057）；`readPort` 五例通過。#6 同時序（−2.5 s 離線、+2.0 s 恢復）5 次：匯出都在 `endsAt` 當下 0.03～0.35 秒完成且只一次、重連後 10 ms 內送出同一份；**成功 3 次、失敗 2 次**，失敗兩次都是 socket.io 重連本身落在寬限之後（晚 470 ms 與 910 ms），非匯出造成；其中 1 次（重連 +4.63 s）是本次修正救回。+7 s 恢復不重試、全程在線與手動交卷不退化。海圖定案：決策 12 判通過；重連太晚屬已知限制，改善方向（瀏覽器 `online` 事件主動重連、縮短重連退避上限）記為 code review 第 26 項列第二批。

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | 水手長回報 → 海圖派 acceptance-reviewer（四項、契約不變、協定測試、重現 code review 的四個實測項目確認已修、三款各玩一回合不退化） | 2026-11-11 有條件通過：四項 exit 0（shared 332、server 1053、draw-guess 945、draw-contest 917、song-guess 613）；契約無變動；協定 23 檔全過（hardening 79、draw-contest-hardening 46）；驗收自寫腳本重現 #2（68 項）、#3（20 萬對只轉發 2000、server 存活、1000 次 join 999 次節流）、#4、#5（30 項）、#7、#10 全數已修；瀏覽器 #1 三款丟兩次 ack 皆自動接回、ack 不回 26 秒後回首頁且憑證保留；#6 自動交卷四次試驗三成一敗（重連後才匯出花 1 秒，+5.92 s 超過寬限）→ 決策 12 補修；低：`PORT` 接受 `0x50`／`1e3` → 一併修 |
| ✅ | Rex 目視（正常遊玩無感即可） | 2026-11-11 Rex 指示「分兩筆 commit」；未另外回報目視結果，依驗收報告結案 |

## 驗收標準

- [x] 四項指令 exit 0；三款 `events.ts` 與 spec 逐字一致（無變動）。
- [x] code review #2、#3、#4、#5 的重現步驟不再成立；#3 壓測後 server 存活且三款可繼續玩。
- [x] Wi-Fi 閃斷兩次（模擬：join ack 前斷線）後自動接回，憑證與分數保留。
- [ ] 作畫時間到的瞬間斷線，重連後在寬限內自動交卷成功。（部分達成：預先匯出後 5 次成功 3 次，失敗來自重連退避，列第二批 #26）
- [x] 正常遊玩（含 emoji 暱稱如 👨‍👩‍👧、❤️）不受影響。

## 第二批（未排）

code review #8、#9、#11–#23、#25（丟棄 log 量）、#26（重連退避，Epic 21 驗收時新增），見 [code-review-2026-11.md](code-review-2026-11.md)。

## 踩雷紀錄

（尚無）
