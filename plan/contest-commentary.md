# Epic 15：繪圖比賽 AI 評語（メスガキ）

> 揭曉卡片上每張畫一句 AI 評語，由本機 Ollama 的 gemma4 以「メスガキ」人格產生；順帶拿掉評分前的縮圖。

**狀態**：✅
**起訖**：2026-10-12 ~ 2026-10-12
**負責**：Rex × 海圖（Chart，架構師）；實作派水手長（Bosun）

---

## 需求（Rex 2026-10-12）

1. 繪圖比賽加入 AI 評語，模型用本機 Ollama 的 `gemma4:26b-mlx-bf16`。
2. 人格「雌小鬼」，**讓 gemma4 自由發揮**，規則只有兩條：繁體中文（台灣用語）、一句話 40 字內。
3. 評審名稱 **メスガキ**。
4. 評語**只放揭曉卡片**（不進聊天室）。
5. **預設開啟**。
5a. **第一名不能跟其他人一樣單純批評，要用雌小鬼的方式稱讚**（Rex 2026-10-12 追加，Phase 3 驗收通過後做，見 Phase 4）。
6. 關掉 gemma4 的思考模式（不關會把輸出 token 全部吃掉、內容空白；海圖 2026-10-12 實測）。
7. Clef 已換 `clef:27b-nvfp4`（Ollama 0.40.3 MLX 後端，Rex 實測快很多）：**評分前不再縮圖**，交卷原圖 1280×720 直接送模型，`JUDGE_IMAGE_WIDTH` 與 `pngjs` 一併移除。

## 可行性實測（海圖 2026-10-12，M5 Max 128 GB、Ollama 0.40.3）

| 模型 | 640 寬 | 1280 原圖 | 備註 |
|---|---|---|---|
| Clef `clef:27b-nvfp4` 評分 | 約 1 秒 | 2.4 秒（1259 tokens） | 同圖重打命中 Ollama 快取 0.01 秒 |
| gemma4 評語（`think: false`） | 0.5 秒 | 1.9 秒（600 tokens） | 冷啟動載入 9～17 秒；思考模式開著 14.7 秒且內容空白 |

樣本（只給兩條規則，題目蘋果，告知 78 分）：「就這也叫蘋果？這種沒靈魂的圓圈也想拿高分，真是笨蛋雜魚呢！」「就這也叫蘋果？畫得這麼敷衍，真是沒救了呢，雜魚～！」

兩模型同時常駐約 71 GB（18 + 52.5），128 GB 機器沒問題；32 GB 機器要 `COMMENT=off`。

---

## 設計決策

- 決策 1：**Clef 打分、gemma4 只產文字**，不用 gemma4 打分。原因：Clef 是校準過的決策模型，分數穩定且已驗收；gemma4 自由發揮的文字才是本 Epic 的目的。
- 決策 2：**評語不擋揭曉**。每張在 Clef 評完（含退回 random）後立刻排進獨立的評語佇列（一次一張）；`ended` 條件不變（只等評分），評語晚到就以 `contest:comment` 事件補上，卡片先顯示「…」。原因：揭曉時機與現在完全相同，評語失敗也不影響分數與排名。
- 決策 3：契約新增 `ResultEntry.comment: string | null` 與 `ResultEntry.commentPending: boolean`、`RoundPublic.commentMode: CommentMode | null`（`'ai' | 'off'`）、事件 `contest:comment`。中途加入者從快照的 `results` 拿到已產生的評語。原因：`comment` 為 null 時要分得出「還在等」與「沒有」，否則「…」會永遠掛著。
- 決策 4：**送給模型的資訊＝原圖、題目、Clef 分數**。不給暱稱、不給名次。原因：分數讓語氣與結果一致（高分不甘願、低分嘲笑）是模型自己決定的，不寫成規則；名次要等全部評完，違反決策 2；暱稱交給模型容易被亂改字。
- 決策 5：**提示詞只有人設一句＋兩條規則**（Rex 要求自由發揮）。system：「你是メスガキ，繪圖比賽的評審。規則只有兩條：用繁體中文（台灣用語）；一句話，40 字內。」user：「題目「{topic}」，評分 {score} 分。這是參賽者的畫，給一句評語。」＋圖。不加禁詞、不加範例句。後處理只做：去頭尾空白、取第一行、空字串視為失敗；超過 40 個 code point 不截斷（由畫面 `line-clamp` 處理）。
- 決策 6：Ollama 請求為 `POST /api/chat`，`think: false`、`stream: false`、`keep_alive: '30m'`、`options: { temperature: 0.9, num_predict: 80 }`，`images: [base64(原 PNG)]`。原因：思考模式必關（需求 6）；`keep_alive` 讓模型在一場遊戲裡常駐；80 token 足夠 40 字。
- （決策 7、8、15 中的逾時 20000、「第一次失敗即跳過」、「稱讚版失敗不退回」已被決策 16 取代，原文保留為歷史。）
- 決策 7：環境變數 `COMMENT`（預設 `ollama`；`off` 關閉）、`COMMENT_MODEL`（預設 `gemma4:26b-mlx-bf16`）、`COMMENT_TIMEOUT_MS`（預設 20000）；位址沿用 `OLLAMA_URL`。啟動時探測（同評分器：`GET /api/tags` 不阻塞），模型不在就 warn；**有模型時啟動後背景暖機一次**（送一則不帶圖的極短 chat 並 `keep_alive`），原因：冷啟動 9～17 秒，第一回合第一張不該等。
- 決策 8：失敗處理有界：單張逾時或輸出空白 → 該張 `comment: null`、`commentPending: false`（卡片不顯示評語行）；**同一回合第一次失敗後，剩餘各張直接跳過**（不再呼叫模型），該回合 `commentMode` 改為 `'off'`。下一回合重新嘗試。原因：與評分器的退回策略對稱，最壞只多等一次逾時。
- 決策 9：未交卷者沒有評語（`comment: null`、`commentPending: false`）。原因：沒有圖；罐頭句會重複，Rex 要的是模型自由發揮。
- 決策 10：回合進入 `drawing`（新回合）時丟棄上回合尚未完成的評語工作（不算失敗，新回合從 `'ai'` 開始）；參賽者在 `drawing`／`judging` 寬限期滿離開時丟棄其評語工作（與評分佇列相同）；**`ended` 之後離開的人評語照常跑完並發事件**（水手長 Q2 修正，否則卡片永遠「…」）。
- 決策 11：評審名稱放 `shared/src/draw-contest/constants.ts` 的 `COMMENT_PERSONA_NAME = 'メスガキ'`，server 提示詞與客戶端卡片都讀它。原因：唯一來源。
- 決策 12：**移除縮圖**：刪 `JUDGE_IMAGE_WIDTH`、`downscalePng`（plan 初稿誤寫 `resizePng`）、`pngjs` 相依（Dockerfile／映像隨之變小）；spec §6 的「縮到 640」定案改寫為「原圖直送」並保留 2026-10-07 的實測為歷史。原因：需求 7；nvfp4 在 MLX 後端 1280 只要 2.4 秒。
- 決策 13：假 Ollama（`user/mock/systemone.mjs`）加 `POST /api/chat`，回固定格式 `{ message: { role: 'assistant', content: '<依圖片雜湊挑一句>' }, done: true }`；協定測試用它驗 `contest:comment` 的流程，不碰真模型。
- 決策 16（Phase 5，Rex 2026-10-13）：(1) 稱讚版失敗或被跳過時**退回批評版**（推翻決策 15 的「不退回」）；(2) 同回合**連續兩次失敗**才跳過剩餘（原第一次即跳過）；(3) `COMMENT_TIMEOUT_MS` 預設 20 → **30 秒**（Rex 由海圖建議的 60 改為 30）。原因：Rex 以 pi-agent＋qwen3.8 實測，三個大模型共 129 GB 超過 Metal 107 GB，Ollama 反覆換頁，評語 7～16 秒、兩局逾時後整回合空白；根本解法是 pi-agent 改用 gemma4，但規則也該撐得住暫時忙碌。
- 決策 15（Phase 4，需求 5a）：**第一名的評語在 `ended` 時重做一次「稱讚版」**。原因：評語是交卷即評、不知道名次（決策 2、4），名次要到 `ended` 才有；為了不讓揭曉等評語，其他人維持原流程，只有第一名多打一次模型。做法：`ended` 計算 `results` 後，取 `rank === 1` 且有交卷者（排名規則保證唯一），把它的 `comment` 設回 `null`、`commentPending: true`（即使原本已有批評版也不顯示，避免畫面從批評閃成稱讚），其評語工作**插到評語佇列最前面**，user 提示詞換成稱讚版（逐字，2026-10-12 第二版）：`題目「{topic}」，評分 {score} 分，這張是本回合第一名。妳不甘心，但還是得承認它畫得好，用雌小鬼的口氣誇它，一句評語。`；system 不變。初稿「用雌小鬼的方式稱讚它」真模型 15 句幾乎都還在罵（「雖然畫得超爛，但勉強及格啦」），水手長比較四種寫法後採「告訴模型它畫得好、妳得承認」這版，5 句全有正面肯定。完成後照常發 `contest:comment`。`commentMode === 'off'`（關閉或本回合已失敗跳過）時不重做，第一名維持原值。單人回合的第一名也稱讚。假 Ollama 依 user 文案含「第一名」回不同句，協定測試驗第一名的評語與其他人不同且揭曉時第一名為 pending。
- 決策 14：卡片顯示（design §3）：**縮圖下方**一行（初稿寫標題列下方；水手長實作後指出同列縮圖會高低不齊，2026-10-12 改到縮圖下方），`メスガキ` 以粗體前綴、評語 12px 斜體 `--fg-muted`，`line-clamp-2`；等待中顯示「メスガキ：…」（帶前綴）；放大檢視顯示完整句。**2026-10-12 再修（事務長實戰回報）**：卡片評語不截斷（移除 `line-clamp-2`）、等待中改顯示「メスガキ：正在寫評語」，避免截斷的「…」與產生中的「…」混淆。**顯示與否只看該卡片自己的欄位（`comment !== null` 或 `commentPending`），不看 `commentMode`**（水手長 Q1 修正：回合中途失敗時已產生的評語照常顯示）。偽裝語意＝投影片的「註解」。

---

## 任務清單

### Phase 0：規格（海圖）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | spec/draw-contest/architecture.md：§3 環境變數（加 COMMENT 三個、刪 JUDGE_IMAGE_WIDTH）、§4 契約（CommentMode、ResultEntry.comment／commentPending、RoundPublic.commentMode、contest:comment）、§5 狀態機補評語時序、§6 刪縮圖、新增 §6.1 評語器、§7／§8 結構、§9 紀錄 | 2026-10-12 |
| ✅ | spec/draw-contest/overview.md：需求 7、規則 7 加評語、範圍外移除「評語文字」 | |
| ✅ | spec/draw-contest/design.md §3：卡片評語行 | |
| ✅ | backlog、CLAUDE.md 規範表加本 Epic | |

### Phase 1：server（水手長派工）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | `shared/src/draw-contest/`：events.ts 依 spec §4 逐字加 `CommentMode`、`ResultEntry.comment`／`commentPending`、`RoundPublic.commentMode`、`CommentUpdate`、`contest:comment`；constants.ts 加 `COMMENT_PERSONA_NAME` | 契約逐字比對；2026-10-12 水手長派子代理：events.ts 與 spec §4 程式區塊逐位元組相同（diff／cmp 皆 0），shared 測試 117 例通過 |
| ✅ | 移除縮圖：`judge/ollama.ts` 的 `resizePng`／`imageWidth`、`judge/index.ts` 的 `JUDGE_IMAGE_WIDTH`、`server/package.json` 的 `pngjs`、相關測試改原圖直送 | 決策 12；`npm install` 後 lockfile 會變 |
| ✅ | 新增 `server/src/games/draw-contest/commentary/`：`ollamaChat.ts`（組請求、解析、後處理）、`queue.ts`（一次一張、逾時、回合內首次失敗即跳過、丟棄規則）、`index.ts`（讀 `COMMENT`／`COMMENT_MODEL`／`COMMENT_TIMEOUT_MS`、探測、背景暖機） | 決策 5–8、10 |
| ✅ | `room.ts`／`register.ts`：評分完成 → 排評語；`results` 帶 `comment`／`commentPending`；`ended` 後評語完成 → 廣播 `contest:comment` 並更新 results；`drawing` 清佇列；`commentMode` 生命週期同 `judgeMode` | 決策 2、3、9、10 |
| ✅ | 單元測試：ollamaChat 組請求（`think: false` 等）、後處理、佇列（成功／逾時／首次失敗跳過／丟棄）、room 的 results 欄位與事件 | 測試 `COMMENT_TIMEOUT_MS` 用小值；`vitest.config.ts` 預設 `COMMENT=off`、`AppOptions` 加評語器注入點，測試不得打真模型（水手長 Q4） |
| ✅ | 假 Ollama 加 `POST /api/chat`；`user/protocol/draw-contest-comment.mjs` 協定測試（交卷→揭曉→收到 `contest:comment`；`COMMENT=off` 時 `commentMode 'off'` 且無事件；中途加入者快照帶 comment） | 決策 13 |
| ✅ | README／docker-compose：`COMMENT` 三個變數、刪 `JUDGE_IMAGE_WIDTH`、記憶體需求（兩模型 71 GB）；Dockerfile 若有 pngjs 相關敘述一併刪 | 2026-10-12 水手長複驗 Phase 1：根目錄四項 exit 0（server 22 檔 576 例）、協定測試 comment 40/40・contest phase1 106/106・draw-guess phase1 24/24、真模型端到端（5 張，揭曉後 0.5 秒內補齊評語）；Dockerfile 無 pngjs 敘述未改 |

### Phase 2：客戶端（水手長派工）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | store：`contest:comment` 更新 `round.results[].comment`／`commentPending`；join 快照直接帶 | |
| ✅ | `features/reveal/`：卡片評語行（決策 14）、放大檢視完整句、`revealView.ts` 純函式加 `comment` 欄位與測試 | design §3 |
| ✅ | 殼層字詞：ppt 殼層的 `terms` 若需要「註解」字樣由殼層提供，功能元件不寫死偽裝字樣（沿用 shellBoundary 測試） | |
| ✅ | 說明對話框加一句「メスガキ會在揭曉時評語」 | 若 draw-contest 有說明主題；2026-10-12 水手長複驗 Phase 2：draw-contest 26 檔 600 例、lint／build exit 0；瀏覽器實測（建置版 :3181、真模型）卡片評語行與放大檢視符合 design §3，console 無錯誤 |

### Phase 2.5：收尾（水手長回報後的定案，2026-10-12）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | 評語行移到縮圖下方；pending 顯示「メスガキ：…」 | design §3、spec §7 已改 |
| ✅ | Clef 暖機：`JUDGE=ollama` 且探測到模型時，啟動後背景送 1×1 PNG 的 systemone 請求，只 log | spec §6.1；水手長實測冷啟動第一張 13.4 秒 |
| ✅ | 說明對話框「評分」主題改掉「目前使用隨機評分…日後改用 AI」的 Epic 14 舊文案，改為「由 Clef 評分、メスガキ評語；連不上 Ollama 時退回隨機評分」 | 水手長範圍外發現；2026-10-12 水手長複驗 Phase 2.5：根目錄四項 exit 0（server 581、draw-contest 602）、comment 協定測試 40/40；瀏覽器實測（假 Ollama 延遲 7 秒）同列縮圖上緣對齊、評語行在縮圖下方、pending 顯示「メスガキ：…」；Clef 暖機實測 2.3 秒、暖機後第一張 1.5 秒（真冷啟動未重現） |

### Phase 4：第一名稱讚版（Rex 2026-10-12 追加；**Phase 3 驗收通過後**由海圖改 spec §5／§6.1 再派水手長）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | spec §5 ended、§6.1 提示詞與佇列補「第一名重做」（海圖） | 決策 15；2026-10-12 已寫 |
| ✅ | server：`ended` 時第一名 comment 重設為 pending、插隊重做（稱讚版 user 文案）；`commentMode 'off'` 不重做；單元測試 | 決策 15 |
| ✅ | 假 Ollama：user 含「第一名」時回稱讚句；協定測試補第一名案例 | |
| ✅ | 說明對話框「評語」句補「第一名會被稱讚」 | 2026-10-12 水手長複驗 Phase 4：根目錄四項 exit 0（server 600、draw-contest 608）；協定 comment 55/55、comment-fallback 38/38、contest phase1 106/106；真模型一回合：揭曉時第一名 pending、稱讚版 0.5 秒後插隊先到。**待定案**：現行稱讚版文案的真模型語氣仍偏批評（已附提示詞比較數據給海圖） |
| ✅ | 驗收（acceptance-reviewer）＋ Rex 真模型目視第一名評語 | 2026-10-12 驗收通過：四項 exit 0（server 600、draw-contest 608）、協定 9 檔重跑全過＋新寫 `draw-contest-comment-praise.mjs` 36/36（單人回合中止在途、五人插隊順序、只有稱讚版失敗與下一回合重試）、真模型三回合第一名皆 pending→稱讚句（+536～1069 ms）、卡片無閃動。稱讚句原文：「嘖，雖然畫得還算及格，但這種程度也想當第一名，真是太沒出息了啦！」「嘖，這種程度居然拿第一？雖然畫得很不錯啦，但別以為這樣就贏定我了！」「嘖，這種程度也能拿第一？雖然畫得還算可以啦，但別以為我會認輸喔！」**語氣待 Rex 目視定案** |

### Phase 5：評語韌性（Rex 2026-10-13 實測三局後定案；起因：pi-agent 的本地模型把 gemma4 擠出記憶體，評語 7～16 秒甚至逾時）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | spec §3／§5／§6.1 回寫（海圖） | 決策 16 |
| ✅ | server：稱讚版失敗或被跳過 → 退回揭曉前已產生的批評版（`contest:comment` 送出；沒有則 null）；連續兩次失敗才跳過本回合剩餘（中間成功即歸零）；`COMMENT_TIMEOUT_MS` 預設 30000；單元測試（退回、兩次才跳過、一次失敗後成功不跳過、逾時預設）與 e2e；假 Ollama 已有 `MOCK_PRAISE_CONTENT` 與延遲可用 | 決策 16；2026-10-13 水手長派子代理完成：`queue.ts` 連續失敗計數（`COMMENT_MAX_CONSECUTIVE_FAILURES = 2`）、`pushFront` 不再中止同一玩家在途的工作（依海圖回寫的 §5：跑完當退路）；`room.ts` 交卷紀錄加 `praise.fallback`、`onCommented` 以 `job.input.praise` 分辨、log `comment.failed` 加 `consecutive` 與稱讚版的 `fallback`；根目錄四項 exit 0（server 27 檔 805 例）；假 Ollama 未改 |
| ✅ | README／compose 的 `COMMENT_TIMEOUT_MS` 預設與說明；說明對話框若有提到「評語失敗就沒有」改成「稱讚版失敗會退回一般評語」 | 2026-10-13：README 環境變數表與「第一名會被稱讚」段、`docker-compose.yml`、`draw-contest/README.md` 已改；說明對話框「排名與總分」補「稱讚寫不出來時改顯示一般評語」（helpTopics／helpDialog 測試同步，draw-contest 32 檔 807 例） |
| ✅ | 協定測試 `draw-contest-comment-praise.mjs`／`comment-fallback.mjs` 對應案例改寫（稱讚版失敗現在退回批評版；單次逾時不跳過） | 既有斷言依新定案改，加註日期；2026-10-13：praise 55/55（丙改四回合：通用、揭曉前已有批評版、排隊中被取代 → null、在途跑完當退路）、comment-fallback 51/51（乙改兩次逾時＋「第一次逾時不收尾」時間斷言；丙加「drawing 只失敗一次 → judging 仍 ai」回合）、comment 55/55（未改）、phase1 106/106；各跑兩次以上皆全過 |
| ✅ | 驗收（acceptance-reviewer）＋ Rex 再玩一局 | 2026-10-13 驗收通過：四項 exit 0（server 805）、契約逐位元組相同、協定 7 支全過＋新寫 comment-resilience 35/35（六回合覆蓋連續計數每種情況）、真模型兩回合評語 0.45～2.6 秒（qwen3.8 未載入）、瀏覽器目視 PASS。真模型「稱讚版逾時→看到批評版」待 Rex 以 pi-agent 把 qwen3.8 載回來再玩一局 |

### Phase 6：評審名稱改「ミオ」（Rex 2026-10-21）

經過：Rex 先說「評分雌小鬼（日文那個）直接移除，直接顯示評語就好」→ 海圖定了「不顯示名稱、aria-label 改『評語：』」並派工，牽動客戶端四檔、測試四檔、事務長技能三處 → Rex「沒想到要改這麼多地方，等等先不改」→ 全部還原 → Rex 改為**「把メスガキ改成一個日文名字，只要字串替換」**，選定「ミオ」。

決策 17（海圖 2026-10-21）：
- 顯示用常數 **`COMMENT_PERSONA_NAME` 的值由 `'メスガキ'` 改為 `'ミオ'`**（Rex 選定的日文名字；原想用評語的日文「ミオ」，Rex 改要人名，海圖提 ミオ／リン／ナナ／アカネ，Rex「ミオ很好」），卡片前綴、pending 文字、aria-label、說明對話框全部跟著常數變，程式結構不動。
- **server 提示詞的人設改寫死 `メスガキ`**（不再讀該常數；雌小鬼人格與語氣不變，Rex 10/12「語氣不用調」）；`ollamaChat.ts` 一處與其測試。
- 測試中寫死 `'メスガキ'` 的斷言（shared constants、server commentary 的「唯一來源」案例、draw-contest reveal／helpTopics／helpDialog）改 `'ミオ'`，提示詞斷言維持 メスガキ。
- 契約（events.ts）不變；events.ts 註解「メスガキ評語」是契約區塊的一部分，**不動**（描述人格仍正確）。
- 事務長技能三處（MAINTENANCE.md、SKILL.md、manual-ui.md）字串替換 メスガキ → ミオ；pi-agent 複本等 Rex 說再重裝。

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | spec：architecture §4 常數表、§6.1 提示詞註記、§7；design §3；本計畫 | 2026-10-21 海圖 |
| ✅ | shared `COMMENT_PERSONA_NAME = 'ミオ'`；server 提示詞寫死 メスガキ；測試同步；根 README 一句（水手長派工） | 2026-10-21 水手長複驗：8 檔；四項 exit 0（shared 212、server 921、draw-contest 807）；draw-contest bundle「ミオ」1 處、「メスガキ」0 處；server bundle 提示詞仍 メスガキ |
| ✅ | 事務長：技能三處字串替換 | 2026-10-21 事務長回報：MAINTENANCE.md、SKILL.md、manual-ui.md 已改 ミオ，UI-DEP 字串已改 ミオ（MAINTENANCE.md 保留一句「原為メスガキ」註記）；腳本不比對字串；pi-agent 複本等 Rex 說再重裝 |
| ✅ | 驗收：四項、瀏覽器揭曉卡片前綴「ミオ：」、pending「ミオ：正在寫評語」、說明對話框、線上請求的 system 提示詞仍 メスガキ（假 Ollama 記錄）；Rex 目視 | 2026-10-21 驗收子代理通過：四項 exit 0（shared 212、server 921、draw-guess 931、draw-contest 807、song-guess 591）；契約逐位元組一致；5 支繪圖比賽協定測試 302/302；建置版＋假 Ollama 玩一回合 10 情境 PASS（卡片、pending、aria-label、放大、歷史回看、說明對話框、畫面無 メスガキ、提示詞 メスガキ）；低嚴重度 6 項皆文件措辭，海圖已修。Rex 2026-10-26 目視通過（與 Phase 7、Epic 20 一併） |

### Phase 7：評語 60 字、token 120、提示詞帶暱稱（Rex 2026-10-21）

決策 18（海圖 2026-10-21）：
- system 規則「一句話，40 字內」→「**60 字內**」；`num_predict` 80 → **120**（60 字約 60～90 token）。
- user 文案加入暱稱、**不多加任何指示**（Rex：嘗試看看模型會不會利用名稱）：批評版「題目「{topic}」，評分 {score} 分。這是參賽者「{nickname}」的畫，給一句評語。」；稱讚版「…這張是本回合第一名，參賽者「{nickname}」。妳不甘心…」。
- 暱稱來源＝該玩家當下的 `nickname`（已 `validateNickname` 1～12 字、無控制字元，提示詞注入面小，不另過濾）；評語佇列的輸入多帶 `nickname`。
- 畫面不截斷不變；契約不變；假 Ollama 不需改（不比對 user 文案的話）；協定測試若有逐字斷言 user 文案就跟著改。

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | spec §6.1 三處＋變更紀錄；本計畫 | 2026-10-21 海圖 |
| ✅ | `ollamaChat.ts`：system 60 字、`COMMENT_OPTIONS.num_predict` 120、`commentUserPrompt`／`praiseUserPrompt` 加 `nickname` 參數；`queue.ts`／`room.ts` 傳暱稱；單元測試與協定測試逐字斷言同步（水手長派工，與 Phase 6 同一批 commit） | 2026-10-21 水手長派子代理完成：`CommentInput.nickname` 由 room 在 onJudged／redoWinnerComment 取該玩家當下暱稱；假 Ollama 稱讚版判斷改比對「這張是本回合第一名」（暱稱含「第一名」不誤判）；四項 exit 0（server 923）；協定 5 支全過 |
| ✅ | 驗收：四項、協定 5 支、假 Ollama 記錄的 user 文案含暱稱與 60 字規則、`num_predict` 120；Rex 真模型目視（看模型會不會用名字、句子長度） | 2026-10-21 驗收子代理通過：四項 exit 0（shared 212、server 923、draw-guess 931、draw-contest 807、song-guess 591）；協定 5 支 302/302；記錄用假 Ollama 四回合 13 則請求：system 60 字版逐字、`num_predict` 120、每則暱稱／分數／圖片 sha256 對應交卷者本人、稱讚版帶第一名暱稱、暱稱「我是第一名」不誤觸；瀏覽器 61 字評語不截斷、前綴「ミオ：」；低嚴重度 1 項（overview 需求表 40 字）海圖已補。Rex 2026-10-26 真模型目視通過 |

### Phase 3：驗收

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | 水手長回報 → 海圖派 acceptance-reviewer（四項指令、契約逐字比對、協定測試、瀏覽器實測含 `COMMENT=off`） | 2026-10-12 通過：四項 exit 0（server 581、draw-contest 603）、契約逐位元組相同、協定 7 檔全過＋新寫 fallback 34/34、瀏覽器 8 情境 PASS、真模型兩回合端到端；低嚴重度 3 項（細線稿 62 屬畫作差異、間距 5 vs 6px 為四捨五入、測試埠被瀏覽器分頁佔住）皆不需改程式 |
| ✅ | Rex 真模型目視：幾張真畫的評語風格、揭曉卡片版面 | 2026-10-12 Rex 實戰兩回合（西瓜、熱氣球）後定案「語氣不用調」，commit 35020f0 |
| ⬜ | Docker 容器經 host.docker.internal 的評語（有 docker 的機器） | 可延後 |

---

## 驗收標準

- [x] `npm run typecheck`、`npm test`、`npm run lint`、`npm run build` 皆 exit 0（分開跑）。
- [x] `shared/src/draw-contest/events.ts` 與 spec §4 程式區塊逐字一致（4706 bytes 相同）。
- [x] 真模型：交卷後揭曉畫面每張卡片在數秒內出現メスガキ的一句評語；分數與揭曉時機與 Epic 14 相同（揭曉後 0.2～1.7 秒補齊）。
- [x] `COMMENT=off`：卡片沒有評語行，其餘不變；Ollama 關閉時評分與評語都退回、揭曉仍在有界時間內出現（fallback 協定測試 34/34）。
- [x] 縮圖程式與 `pngjs` 已移除，評分分數水準與 Epic 14 驗收相當（粗線稿或彩色蘋果 70 分以上、空白 10 分以下；驗收時細線稿 62、粗線稿 71、彩色 80、空白 3）。
- [x] 協定測試 `draw-contest-comment.mjs` 40/40、`draw-contest-comment-fallback.mjs` 34/34；assertion 只依 spec。
- [x] spec／README／compose 已同步。

---

## 踩雷紀錄

### 2026-10-12：gemma4 回覆內容空白

- **症狀**：`/api/chat` 回 200、`eval_count` 80，但 `message.content` 是空字串。
- **根因**：gemma4 預設開思考模式，`num_predict` 80 全被思考 token 用掉。
- **解法**：請求帶 `think: false`（決策 6）；暖機後 0.4～0.5 秒出一句。
