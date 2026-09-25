# Epic 2：聊天室圖片（拖曳上傳、全員可見、不保留）

> 把圖片拖進聊天室就能讓所有人看到；伺服器只中繼、不落地

**狀態**：✅（2026-09-25 舵手最終驗收通過：指令全綠、契約一致、協定測試 26/26、壓測 (b)(c) 全過、瀏覽器拖放兩端可見；2026-09-25 Rex 實機拖圖回報「都正常」，Epic 完成）
**起訖**：2026-09-25 ~ 2026-09-25
**負責**：Rex × 舵手（Helm，規格與計畫）× 龍骨（Keel，派工與驗收）

---

## 需求（Rex 2026-09-25）

1. 聊天室要能上傳圖片，**直接拖曳**進去。
2. **大家都可看到**。
3. **不保留**，簡單優先。

## 設計決策

- 決策 1：**Socket.IO 原生二進位中繼**，不做 HTTP 上傳端點、不落地、伺服器不保存 bytes。原因：「不保留」＋「簡單優先」；Socket.IO 對 `ArrayBuffer` 有原生支援，一則事件就能廣播。
- 決策 2：**歷史只留中繼資料，不留圖**：`ChatMessage{kind:'image'}` 進聊天環狀緩衝（含 mime／寬高／大小），bytes 只以 `chat:image` 事件送給當時在線者。中途加入者看到佔位「圖片（中途加入看不到）」。原因：時間軸一致、記憶體不長大。
- 決策 3：**客戶端先縮圖再送**：長邊 ≤ `IMAGE_MAX_EDGE`（1280）。**PNG 先以 PNG 輸出（保留透明），超過上限才轉 JPEG 0.85 並先填白底**（canvas 透明轉 JPEG 會變黑；截圖類多為白底，填白最自然）；JPEG 直接輸出 JPEG 0.85；GIF／WebP 不重編碼（保留動畫）。仍超過 `MAX_IMAGE_BYTES`（**10 MB**，2026-09-25 Rex 由 2 MB 改）就拒。原因：30 人同時收圖時頻寬可控；縮圖用 canvas 約 20 行。（2026-09-25 龍骨提問後補充透明處理）
- 決策 4：**作畫中的畫師不能傳圖**（choosing／drawing 期間），回 `SPOILER_BLOCKED`。原因：拖一張實物照片就等於洩題；猜題者傳圖不擋。
- 決策 5：伺服器驗 **magic bytes** 對得上 mime、大小 1..上限、寬高為 1..4096 的整數（`IMAGE_DIMENSION_MAX`，server 內部）；`ImageMeta.bytes` **由 server 以實際 data 長度填入**，客戶端不送也不驗（2026-09-25 修正：原「須等於實際長度」與 §4 payload 矛盾，刪除）；每人 `IMAGE_MIN_INTERVAL_MS`（3 秒）一張。原因：不信任客戶端，且圖比文字重。
- 決策 9：`chat:image` 也送給傳送者本人，客戶端**不做本地預覽**，與文字聊天不做本地回顯一致（畫面以 server 廣播為準）。
- 決策 6：Socket.IO server `maxHttpBufferSize` 提高到 `MAX_IMAGE_BYTES + 64 KiB`（即約 10.06 MB；預設 1 MB 會直接斷線）。
- 決策 7：客戶端只保留最近 20 張的 Blob URL，超過就 `revokeObjectURL`。原因：「不保留」也適用於客戶端記憶體。
- 決策 8：顯示為聊天行 `Bob: [圖片]` 下方縮圖（最大 240×160，`object-fit: contain`，1px `--border`），點一下切換成面板寬度。不做燈箱。沒有圖時的佔位與暱稱同行、分三種文字：`[圖片]（載入中…）`／`[圖片]（已清除）`／`[圖片]（中途加入看不到）`（2026-09-25 龍骨提問後定案，避免 10 MB 傳輸中被誤解為看不到）。

## 契約（已寫入 `spec/architecture.md` §4）

- `ChatKind` 加 `'image'`；`ChatMessage.image?: ImageMeta`（kind 為 image 時必有，`text` 為空字串）。
- `ImageMeta { mime: ImageMime; width; height; bytes }`、`ImageMime` 四種、`ImagePayload { id; data: ArrayBuffer }`。
- Client → Server `chat:image`（payload 含 `data: ArrayBuffer`，ack `Ack<{ id }>`）；Server → Client `chat:image`（緊接同 id 的 `chat:message` 之後）。
- `ErrorCode` 加 `IMAGE_INVALID`。常數 `MAX_IMAGE_BYTES`、`IMAGE_MAX_EDGE`、`IMAGE_MIN_INTERVAL_MS`、`IMAGE_MIMES`。

---

## 任務清單

### Phase 1：契約與伺服器

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | `shared`：`events.ts` 照 §4 逐字更新（ChatKind、ImageMeta、ImageMime、ImagePayload、`chat:image` 兩向、`IMAGE_INVALID`）；`constants.ts` 加四個常數；`image.ts` 純函式 `sniffImageMime(bytes): ImageMime \| null`（magic bytes）＋測試 | 無執行期相依 |
| ✅ | server `app.ts`：`maxHttpBufferSize: MAX_IMAGE_BYTES + 65536` | 決策 6 |
| ✅ | server `Room.image(socketId, meta, bytes)`：`NOT_IN_ROOM` → `IMAGE_INVALID`（mime 不在清單、magic bytes 不符、大小 0 或超限、寬高非 1..4096 整數）→ `RATE_LIMITED`（`IMAGE_MIN_INTERVAL_MS`，與文字訊息各自計時）→ 畫師在 choosing／drawing → `SPOILER_BLOCKED`「作畫中畫師不能傳圖片」→ 推 `ChatMessage{kind:'image', text:'', image}` 入緩衝，效果：`chat:message` 給所有人、`chat:image {id, data}` 給所有在線者 | Room 純邏輯；bytes 只在效果裡經手，不存 |
| ✅ | server `register.ts`：`chat:image` 接線，payload 形狀驗證（`data` 須為 `ArrayBuffer`／`Buffer`），無 ack 則忽略並 log | |
| ✅ | 測試：room.image 單元（合法 PNG／JPEG／GIF／WebP magic bytes、mime 對不上、超限、畫師被擋、間隔）＋ e2e（兩客戶端收到 bytes 長度一致、快照只有 meta 沒有 bytes） | |

### Phase 2：客戶端

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | `ChatPanel` 拖放：整個 TERMINAL 面板為投放區；`dragover` 顯示覆蓋層「放開以傳送圖片」；只取第一個檔案；非圖片或超限 → 本地錯誤提示（沿用 4 秒消失） | DESIGN §5 |
| ✅ | `features/chat/imageUpload.ts` 純函式：`prepareImage(file) → { mime, width, height, data }`：長邊 ≤ `IMAGE_MAX_EDGE` 縮圖；PNG 先輸出 PNG（保留透明），超過上限才填白底轉 JPEG 0.85；JPEG → JPEG 0.85；GIF／WebP 原樣；仍超限拒絕 | 決策 3；用 `createImageBitmap` + canvas |
| ✅ | `socket/client.ts`：`sendImage()` 呼叫 `chat:image` 取 ack；接 `chat:image` 事件 → `Blob` → `URL.createObjectURL`，存 store 的 `imageUrls: Map<id, url>`；超過 20 張 revoke 最舊 | 決策 7 |
| ✅ | 渲染：`Bob: [圖片]` 行＋縮圖（240×160 contain、1px `--border`）；點一下切換面板寬度；歷史中沒有 bytes 的 image 訊息顯示「圖片（中途加入看不到）」 | 決策 8 |
| ✅ | （選做，順手）貼上：`paste` 事件含圖片時走同一流程 | 5 行內就做，否則跳過 |

### Phase 3：驗收

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | 舵手協定測試 `user/protocol/draw-guess-image.mjs`：70 bytes PNG 雙端 SHA 一致、間隔、六種 IMAGE_INVALID、非二進位、無 ack、10 MB+1 不斷線、剛好 10 MB GIF SHA 一致、四種格式、畫師 choosing／drawing 被擋、猜題者可傳、中途加入者快照只有 meta、**慢連線（暫停 TCP 讀取）收到 data: null 且不斷線、正常客戶端 0 略過** | 2026-09-25 舵手：26/26 全過（2 MiB 與 22 MiB 門檻下斷言皆成立） |
| ✅ | 瀏覽器：龍骨以 DataTransfer 注入檔案模擬拖放；Rex 實機拖一張截圖進去，兩台裝置都看到 | 2026-09-25 龍骨模擬拖放 59 ms；舵手於內建瀏覽器（:3181 最終 build）以 DataTransfer 注入 400×300 PNG，Bob 端拖入、Helm 端即時看到縮圖。2026-09-25 Rex 實機拖圖「都正常」 |
| ✅ | 壓測：30 客戶端各收 5 張接近 10 MB 的圖（隔離埠），量 RSS 峰值與回落、所有人收到的位元組數一致、慢客戶端不影響其他人收圖時間；`chat:image` 必須是單次 emit（architecture §5） | 龍骨提議；通過門檻：RSS 峰值回落到基準 +20% 內。2026-09-25 結果（`user/protocol/draw-guess-image-load.mjs`，隔離埠 3195）：位元組一致 150／145／435 張全 PASS、事件順序與傳送者本人收到 PASS、單次 emit 成立（每張 RSS +10–20 MB，非 +300 MB）、正常客戶端延遲 p95 約 114 ms（3 人同時送約 242 ms）且不受慢客戶端影響。**兩個待舵手決策**：(1) RSS 門檻在 macOS 量不到回落——強制 GC 後 `arrayBuffers` 歸 0、heapUsed 10 MB，但 malloc 不歸還、`ps` RSS 停在約 230 MB，連跑三輪不再成長（有上限、非洩漏）；(2) 慢客戶端（≈2 MiB/s）收連續 10 MB 圖時 ping 封包排在圖片後，超過 pingTimeout 5 秒被斷線 |
| ✅ | **慢連線保護（壓測發現）**：server 送 `chat:image` 前檢查收件 socket 待送量，> `IMAGE_SKIP_BUFFER_BYTES`（2 MiB）改送 `{ id, data: null }`；`pingTimeout` 5 → 20 秒；client 收到 `data: null` 顯示「[圖片]（連線較慢，已略過）」；`events.ts` 逐字同步 §4；測試：模擬慢 socket 被略過而不斷線、其他人照收 | architecture §3／§4／§5；龍骨方案 A + B。2026-09-25 實作完成（`server/src/games/draw-guess/slowLink.ts`：待送量＝engine.io `conn.writeBuffer`＋ws `bufferedAmount`；正常群組單次廣播、略過群組單次 `data: null`；client `skipped` 狀態）；typecheck／test（77／374／238）／build／lint 皆 0。壓測：單一傳送者 (a)(b) PASS、慢客戶端不斷線；**多傳送者 (c) FAIL：三人同時送 10 MB 時 29 位正常客戶端每輪 1–2 張被略過（2 MiB 門檻小於一張在途圖）**。舵手定案門檻改 `2 × MAX_IMAGE_BYTES + 2 MiB`（≈22 MiB）後重跑（每組新 server、`--expose-gc`）：**(b) PASS 36/36**（慢客戶端不斷線、略過 0 張、RSS 比值 1.036、GC 後 arrayBuffers 0.04 MB）；**(c) PASS 35/35**（正常客戶端 0 略過、1305 張位元組一致、慢客戶端不斷線且每輪略過 9 張、GC 後 0.04 MB）。**風險**：(c) 慢客戶端收圖最慢 19.2 秒，距 pingTimeout 20 秒僅約 1 秒（節流實測平均約 1.75 MiB/s，略低於設計下限 2 MiB/s）→ 舵手定案 **pingTimeout 改 30 秒**（死連線最慢 40＋15＝55 秒釋出），龍骨已改 `PING_TIMEOUT_MS` 並補 e2e 斷言；typecheck／test（77／375／238）／build／lint 皆 0 |

---

## 驗收標準

- [x] `npm run typecheck`、`npm test`、`npm run build`、`npm run lint` 各自 exit 0
- [x] （2026-09-25 Rex 實機拖圖「都正常」；龍骨模擬拖放 59 ms、舵手內建瀏覽器兩端可見，協定測試剛好 10 MB GIF 送達）拖一張 3000px 的 PNG 進聊天室，所有人 1 秒內看到縮圖（以 Rex 實機 Chrome 或背景分頁量測；內建瀏覽器窗格的前景分頁 `canvas.toBlob` 固定約 1 秒，屬環境因素）；拖一張 8 MB 的 GIF 能送達
- [x] 記憶體：單傳送者情境 (a)(b) 30 人 × 5 張近上限**連跑 3 輪，第 3 輪 RSS 峰值 ≤ 第 1 輪 +10%**；所有情境（含多傳送者 (c)）強制 GC 後 `process.memoryUsage().arrayBuffers` < 5 MB（macOS malloc 不歸還大區塊，RSS 本身不回落不算洩漏；多傳送者 RSS 比值波動屬 malloc，不作門檻；2026-09-25 依壓測改）
- [x] 慢連線（2 MiB/s，設計下限）每 3 秒收一張 10 MB **不斷線**；積壓超過門檻時該連線看到「已略過」（單傳送者通常 0 張、三人同時送時會略過）；**三人同時送**時正常客戶端 0 張被略過（門檻 ≈ 22 MiB 允許兩張在途；`pingTimeout` 30 秒）
- [x] 中途加入者看到佔位而非圖片；重新整理後圖片消失（不保留）
- [x] 作畫中的畫師拖圖被擋並提示；猜題者可傳
- [x] `spec/architecture.md` 與實作一致

---

## 踩雷紀錄

### Phase 1–2（2026-09-25，龍骨驗收）

- **Node 的 `Buffer#slice` 不複製（等同 `subarray`）**：socket.io 在 server 還原的二進位是整個 WebSocket frame 的切片（實測 byteOffset 122）。`view.slice().buffer` 會把整個 frame 轉發出去（B 收到 191 bytes 而非 69）；要 `new Uint8Array(view).buffer` 確實複製。只有 e2e 抓得到，純 `Uint8Array` 的單元測試抓不到。
- **TypeScript 6 下 `Uint8Array<ArrayBufferLike>` 不能當 `BlobPart`**：由 TypedArray 視圖建出的要 `.slice()` 取得 `Uint8Array<ArrayBuffer>`。
- **shared 的 `ChatKind` 加 `'image'` 後，client 的 switch 缺分支會讓 typecheck 失敗**：契約加列舉值時，前後端的窮舉 switch 都要同步。
- **拖放覆蓋層靠 `absolute inset-0` 蓋住面板**：依賴 ChatPanel 外層沒有定位、最近的定位祖先是 ShellFrame 的 section；這層關係不要改。
- **內建瀏覽器窗格的前景分頁沒有 idle 時間**：連與遊戲無關的 `/healthz` 頁在前景時，`requestIdleCallback` 3 秒都不觸發，`canvas.toBlob`／`OffscreenCanvas.convertToBlob` 固定卡約 1000 ms（Chrome 的 toBlob 以 idle task 排程、1 秒逾時強制執行）。頁面本身 0 次 rAF，非遊戲程式造成。量測縮圖延遲要在有 idle 的分頁：3000×2000、5.6 MB 的 PNG 從 drop 到兩邊顯示 **59 ms**。真實瀏覽器以 Rex 實機為準。

### 慢連線保護（2026-09-25，龍骨驗收）

- **待送量門檻不能小於「一張在途的圖」**：2 MiB 門檻下，多人同時送 10 MB 圖時，第二張到達時每個收件者的待送量都已超過 2 MiB，連區網正常客戶端也被略過。門檻應以「最慢支援速率 × pingTimeout」與「允許幾張在途」來定。
- **暫停讀取的死連線在 e2e 收尾會卡住**：server 以 ping timeout 關 ws 時要等對方回 close frame（ws closeTimeout 30 秒），測試結束前要 `ws.resume()`。
- **macOS loopback 核心緩衝各約 4 MiB**：暫停讀取時會先吃掉一部分資料，e2e 斷言用「至少 1 張被略過」，不寫死哪一張。
- **engine.io `writeBuffer` 與 ws `bufferedAmount` 都是 private**：以執行期形狀檢查讀取，形狀不符算 0（寧可照送不誤擋）；升級 socket.io／ws 後要重驗。
- **量 GC 後記憶體不必改 server**：`node --expose-gc --inspect`，經 CDP `Runtime.evaluate` 呼叫兩次 `gc()` 再讀 `process.memoryUsage()`。
