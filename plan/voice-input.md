# Epic 8：語音輸入（語音轉文字，沿用 live2D 的 whisper.cpp 做法）

> 按麥克風講話，轉成繁體中文文字填進聊天輸入框；Meet 的麥克風按鈕就是開關

**狀態**：⏸（2026-09-29 Rex：暫緩，「以後有機會再用」。原因：只能用區網 IP 分享，瀏覽器在 `http://<IP>` 不開放麥克風；要用必須先有區網 HTTPS 並通過本檔「可行性測試」。本檔設計保留，恢復時從決策 A 的 A2 可行性測試開始）
**起訖**：2026-09-29 ~ —
**負責**：Rex × 舵手（Helm，規格與計畫）× 龍骨（Keel，派工與驗收）

---

## 需求（Rex 2026-09-29）

> 「本專案加上文字轉語音功能，就使用那個專案的方法。然後會議的 UI 有開啟麥克風，那個 UI 也額外觸發轉文字功能。」

- 舵手解讀：Rex 說的「那個專案的方法」是 live2D 的**語音轉文字（STT）**，後半句也是「開麥克風 → 轉文字」，因此本 Epic 做**語音轉文字**。若另外要「文字轉語音」（例如把聊天念出來），另開 Epic。
- 參考做法（live2D session 2026-09-29 提供）：麥克風 → 前端錄音轉 16kHz mono 16-bit WAV → 本機代理 → whisper.cpp server（原生 Metal `http://127.0.0.1:8791/inference`，約 1 秒／句；Docker CPU `:8792` 備援，約 21 秒／句）→ 回 `{ text }`；push-to-talk；結果填入輸入框不自動送出；簡體 → 台灣正體（opencc-js `cn`→`twp`）。參考檔：`~/IdeaProjects/live2D/three-vrm-rex/repo/packages/three-vrm/examples/rex.html`（約第 482 行 `encodeWav16k`）、`three-vrm-rex/server.mjs` 的 `/stt`、`live2D/plan/04-voice-input.md`。

---

## 最大前提：瀏覽器只在安全來源開放麥克風

`getUserMedia` 只在 `https://` 或 `localhost` 可用。同事用 `http://192.168.x.x/draw-guess/` 連進來時**錄不了音**，這與程式寫得好不好無關。因此要先選一條路：

### 決策 A（待 Rex 定案）：HTTPS 路線

| 選項 | 做法 | 優點 | 缺點 |
|------|------|------|------|
| **A1（舵手建議先做）** 只靠 localhost 與 Tunnel | 程式不動部署；要用麥克風的人改開 `npm run tunnel` 印出的 `https://…trycloudflare.com/draw-guess/` | 零部署改動，馬上能試；同一個房間，區網的人照常玩 | Tunnel 網址每次啟動會變；語音經過 Cloudflare 再回到你的電腦；要連外網 |
| A2 區網加 HTTPS 443、80 保留 | 用 mkcert 產生涵蓋你區網 IP 與 `<主機名>.local` 的憑證；server 同時聽 80（HTTP）與 443（HTTPS），同一個房間 | 區網內直接可用，語音不出公司 | 同事第一次開 HTTPS 網址要按一次「繼續前往」（或安裝你的根憑證）；IP 換了要重發憑證；server 要改成雙協定（約多 1 天） |
| A3 全面 HTTPS | 只開 443，80 轉址到 443 | 最單純的一套網址 | 所有同事（不用麥克風的也是）都要先過憑證警告 |

建議：**先 A1** 把功能做出來試玩，覺得好用再做 A2。A2 的憑證警告需要實測確認 Chrome 在「繼續前往」後是否允許麥克風。

> **2026-09-29 Rex：只能用區網 IP 分享** → A1（Tunnel）排除，改在 A2／A3 之間選。HTTPS 可以直接用 IP：憑證的 SAN 寫入區網 IP（例如 `192.168.x.x`）即可，網址為 `https://<IP>/draw-guess/`。派工前先做**可行性測試**：用自簽憑證（含 IP）在 443 起一個只有「測試麥克風」按鈕的頁面，找一台同事電腦開啟，確認 (1) 公司網路放行 443、(2) 瀏覽器允許按「繼續前往」（公司若以政策禁止略過憑證錯誤就不行）、(3) 繼續前往後麥克風權限跳得出來且錄得到音。三項都過才定 A2。

### 決策 B（待 Rex 定案）：轉完的文字

- **B1（舵手建議）**：填進聊天輸入框，按 Enter 才送出（live2D 做法，可先改錯字）。
- B2：直接送出（猜題更快，但辨識錯字也會送出）。

---

## 設計決策（舵手已定）

- 決策 1：**server 代理 whisper**：新增 Socket.IO 事件 `stt:transcribe`（二進位 WAV＋ack 回 `{ text }`），server 轉送 whisper.cpp（`STT_URL` 預設 `http://127.0.0.1:8791/inference`，連不上退 `STT_URL_FALLBACK` 預設 `:8792`，與 live2D 相同的環境變數名），multipart 欄位 `file`、`response_format=json`、`language=zh`、`prompt` 放一句繁體引導句。原因：同事的瀏覽器連不到你電腦的 127.0.0.1；走既有 Socket.IO 連線，只有已加入的玩家能用，不必另做驗證。
- 決策 2：**server 端轉台灣正體**（opencc-js `cn`→`twp`）再回傳。原因：猜題是字串比對，簡體「猫」命中不了題目「貓」；只轉一個地方。
- 決策 3：**音訊不保存、不轉給別人**：只有轉出的文字回給講話的人本人；要不要送進聊天由本人決定（決策 B）。
- 決策 4：**push-to-talk 切換**：按一下開始錄、再按一下結束並送出轉換；**最長 15 秒自動停止**；沒有 VAD 自動斷句（v1 不做）。
- 決策 5：**錄音做法沿用 live2D**：`getUserMedia` → `AudioContext` 收 Float32 PCM → 前端降頻 16kHz、編碼 WAV（純函式 `encodeWav16k`，可單元測試），不需要 ffmpeg。
- 決策 6：**節流**：每人同時只能有 1 個轉換中、兩次間隔 ≥ 1 秒（`RATE_LIMITED`）；server 對 whisper 同時 1 個請求、排隊上限 5（超過回 `STT_BUSY`）；whisper 逾時 45 秒（CPU 備援很慢）；客戶端 ack 逾時 60 秒。
- 決策 7：**不在安全來源時**（`window.isSecureContext` 為 false 或沒有 `mediaDevices`）：麥克風按鈕仍在（偽裝不變），按下只顯示本地提示「需要 HTTPS 連線才能使用麥克風」；whisper 沒開時顯示「語音轉文字服務未啟動」。
- 決策 8：**三個殼層的入口**（都是各軟體原本就有的麥克風）：

| 殼層 | 入口 | 錄音中的樣子 |
|------|------|-------------|
| meet | 底部控制列**麥克風按鈕**（目前是裝飾的靜音圖示）：按下＝開麥克風＝開始錄；再按＝關麥克風＝停止並轉文字 | 按鈕變成開啟狀態（白色麥克風）；自己的參加者 tile 出現說話中聲波圖示；字幕列短暫顯示「正在聆聽…」「轉換中…」；轉完若訊息面板關著就自動打開 |
| ppt | 「常用」功能區右側加 Office 的「**聽寫**」按鈕（麥克風圖示＋「聽寫」） | 按鈕呈按下狀態；註解輸入框 placeholder 改「正在聆聽…」 |
| vscode | 終端機輸入列右端**麥克風圖示**（仿 VS Code 語音聽寫），提示「開始聽寫」 | 圖示變作用色；輸入列 placeholder 改「正在聆聽…」 |

- 決策 9：**功能層與殼層分工**：錄音、編碼、送出、狀態機（idle／recording／transcribing／error）放 `features/voice/`（`useDictation`＋純函式），殼層只拿 `ShellProps.voice`（`{ state, toggle() }`，App 注入，與 `help`／`themes` 同模式）決定入口與樣子；轉出的文字經 ChatPanel 既有的輸入框狀態填入。
- 決策 10：**契約變更（定案後寫入 spec §4）**：

```ts
// ClientToServerEvents
'stt:transcribe': (p: { data: ArrayBuffer }, ack: (r: Ack<{ text: string }>) => void) => void;  // 16kHz mono 16-bit PCM WAV
// ErrorCode 新增
| 'STT_INVALID'      // 不是合法 WAV、格式不符、太短（< 0.3 秒）或超過上限
| 'STT_UNAVAILABLE'  // whisper 兩個網址都連不上或逾時
| 'STT_BUSY'         // 排隊已滿
// 常數
STT_SAMPLE_RATE = 16000
STT_MAX_SECONDS = 15
STT_MAX_BYTES = 44 + 16000 * 2 * 15   // 480 044
STT_MIN_INTERVAL_MS = 1000
```

- 決策 11：**部署**：CLAUDE.md 與 README 加「啟動語音服務：`cd ~/IdeaProjects/whisper-cpp && bash whisper/run-server.sh`」；server 啟動時探測 whisper 是否可連並印一行 log（不可連也照常啟動，只是語音功能回錯）。

---

## 任務清單（決策 A、B 定案後細化）

### Phase 1：server 代理與契約

| 狀態 | 任務 | 備註 |
|------|------|------|
| ⬜ | `shared`：事件、錯誤碼、常數（決策 10）；WAV 標頭檢查純函式 | 與 spec §4 逐字一致 |
| ⬜ | `server/src/lib/stt.ts`：multipart 轉送 whisper、主備網址、逾時、同時 1 個＋排隊 5、opencc 轉正體；`register` 接 `stt:transcribe`（驗證、節流、錯誤碼） | 決策 1、2、6 |
| ⬜ | 協定測試（舵手）：合法 WAV（用 whisper 的假服務回固定簡體字，驗證轉成正體）、非 WAV、超長、太短、未加入、連發節流、whisper 全掛 → `STT_UNAVAILABLE`、排隊滿 → `STT_BUSY` | 用環境變數把 `STT_URL` 指到測試用假服務 |

### Phase 2：前端錄音與三個入口

| 狀態 | 任務 | 備註 |
|------|------|------|
| ⬜ | `features/voice/`：`encodeWav16k`（降頻＋WAV 編碼，單元測試）、`useDictation` 狀態機、15 秒自動停止、安全來源與錯誤提示 | 決策 4、5、7 |
| ⬜ | `ShellProps.voice`；三殼層入口與錄音中外觀（決策 8）；文字填入聊天輸入框（決策 B） | DESIGN 各主題章節同步 |
| ⬜ | 驗證：四項 0；既有截圖在「未錄音」狀態位元組不變；錄音中外觀另存基準 | |

### Phase 3：部署與實測

| 狀態 | 任務 | 備註 |
|------|------|------|
| ⬜ | 依決策 A：A1 只寫文件；A2 加 HTTPS 443（mkcert、雙協定同一房間） | |
| ⬜ | 舵手實測（localhost 真麥克風＋真 whisper）；Rex 實測（Tunnel 或 HTTPS 網址、另一台電腦） | |

---

## 驗收標準

- [ ] 四項指令各自 exit 0；契約與 spec §4 逐字一致
- [ ] 三個殼層都能按麥克風講一句話，轉成**台灣正體**文字出現在聊天輸入框（或依決策 B 直接送出）
- [ ] 不安全來源、whisper 沒開、排隊滿、錄太短都有清楚提示，不會卡住
- [ ] 音訊不保存、不轉給別人
- [ ] 協定測試全過；既有畫面未錄音時位元組不變

---

## 派工規範（龍骨）

- 本檔與 `backlog.md` 只准局部替換；不 commit（Rex 自行）；子代理不得登記名冊、不得跨 session 傳訊；驗收前重啟 server 程序。
- 讀 live2D 的參考檔只為了解做法，不複製其專案結構；不改 live2D 與 whisper-cpp 兩個專案。

---

## 踩雷紀錄

（尚無）
