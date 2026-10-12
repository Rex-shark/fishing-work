# fishing-work

部署在本機、同事透過公司區網（或 Cloudflare Tunnel）進來玩的簡易互動遊戲平台；第一款遊戲是偽裝成程式編輯器的「我畫你猜」。

- 產品範圍與遊戲規則：[spec/overview.md](spec/overview.md)
- 架構與事件契約：[spec/architecture.md](spec/architecture.md)（部署細節見 §3）
- 開發計畫：[plan/](plan/)
- 區網實機實測清單：[user/lan-test-checklist.md](user/lan-test-checklist.md)

## 玩法（給同事）

1. 瀏覽器開 Rex 分享的網址（例如 `http://192.168.1.23/draw-guess/`），在畫面上方的輸入框打暱稱（1～12 字，不可與房內的人重複）按 Enter。
2. 沒有回合進行時，任何人都可以按底部狀態列的「▷ 我來畫」當畫師（至少 2 人在線）。
3. 畫師在上方輸入框出題（1～20 字，60 秒內要出），接著有 2 分鐘作畫；分頁列右側的工具列有顏色、粗細、橡皮擦、復原、清空、放棄（滑鼠停在圖示上會顯示名稱）。
4. 其他人在底部 **TERMINAL** 輸入答案按 Enter。完全相符就算猜對（不分大小寫、全形半形、空白），原文不會公開，大家只會看到「X 猜對了」；越快猜對分數越高（50～100），畫師每有一人猜對 +20。
5. 全員猜對、時間到或畫師放棄時揭曉題目，5 秒後回到等待，下一位可以按「我來畫」。
6. 重新整理頁面或短暫斷線，15 秒內會自動接回，分數與畫師身分都保留。

畫師與已猜對的人打出含題目的訊息會被擋下；猜題者打「是長頸鹿嗎」這種含答案的句子也會被擋，只輸入答案本身即可。

## 需求

- Node.js ≥ 22.12（改用 Docker 部署則只需要 Docker，見下方「Docker 部署（換電腦）」）
- （外網分享才需要）`cloudflared`

## 正式部署（區網）

同一個 Node 程序提供網頁與即時連線，不需要資料庫或其他服務。

```bash
npm install          # 第一次或相依性有變動時
npm run build        # 產出 draw-guess/dist/ 與 server/dist/index.js
npm start            # 單一 Node 程序，預設 HOST=0.0.0.0（所有介面）、PORT=80
```

1. **看啟動 log**：`server.lan` 那一行的 `share` 會列出站台根網址（遊戲清單，每個區網 IP 一個），例如 `http://192.168.1.23/`（80 埠不帶埠號）；`games` 另列兩款遊戲的完整網址（`draw-guess` → `http://192.168.1.23/draw-guess/`、`draw-contest` → `http://192.168.1.23/draw-contest/`）；找不到區網 IP 時會印 `server.lan.none` 警告（確認已連上 Wi-Fi／有線網路）。
2. **查 IP**（也可直接看 log）：`ipconfig getifaddr en0`（有線網路可能是 `en1` 等其他介面）。
3. **macOS 防火牆**：第一次啟動會跳出「是否允許 node 接受連入連線」→ 選「允許」。若「系統設定 → 網路 → 防火牆 → 選項」設成「封鎖所有連入連線」，需取消。
4. **用另一台裝置驗證**：同事的電腦或手機開 `http://<IP>/healthz`，應回 `{"ok":true}`。
5. **分享** `http://<IP>/draw-guess/` 給同事即可（`http://<IP>/` 是遊戲清單頁）。客戶端不需要設定任何伺服器位址。
6. **IP 會隨 DHCP 變動**：請在路由器為這台電腦保留 IP，或改用 `http://<電腦名稱>.local/draw-guess/`（mDNS，macOS 與多數 Windows 10+ 可解析）。電腦名稱見「系統設定 → 一般 → 共享」底部的「本機主機名稱」，或在終端機執行 `scutil --get LocalHostName`。

環境變數：`PORT`（預設 80）、`HOST`（預設 `0.0.0.0`）。例如 `PORT=8080 npm start`（非 80 埠時網址會帶埠號 `http://<IP>:8080/`）；`HOST=127.0.0.1` 只允許本機連線，區網同事會連不上。選用 `PUBLIC_URL`（站台根網址，例如 `http://192.168.1.50/`）：有設時 `server.lan` 的 `share` 只印這個網址、`games` 由同一 origin 推出兩款遊戲的網址（`source: "PUBLIC_URL"`），主要給 Docker 部署用。

- 為什麼是 80：公司區網只放行標準埠，5173 之類的埠會被擋。macOS 10.14 起一般使用者即可綁 80，不需 sudo；Linux 需 `sudo` 或 `setcap`。
- 伺服器重啟後分數歸零（只存在記憶體）。

### 常見問題

| 狀況 | 原因與處理 |
|------|-----------|
| 啟動失敗 `server.listen.failed`，`code` 為 `EADDRINUSE` | 80 埠已被占用。用 `lsof -nP -iTCP:80` 查占用者；常見是 `npm run dev` 還開著——**`npm run dev`（Vite）與 `npm start` 都占 80，不能同時跑**。也可改用其他埠，例如 `PORT=8080 npm start` |
| 啟動失敗，`code` 為 `EACCES` | 沒有權限綁 80（Linux 常見）。改 `PORT=8080 npm start`，或提權（Linux 需 `sudo` 或 `setcap`） |
| 同事連不上 | 依序檢查：① 同事開 `http://<IP>/healthz` 有沒有回 `{"ok":true}`；② macOS 防火牆是否允許 node（見上方步驟 3）；③ 雙方是否在同一個網段（訪客 Wi-Fi、VPN 常是不同網段）；④ 公司網路是否擋了該埠（非 80 埠通常會被擋）；⑤ IP 是否已變動（重看啟動 log）。區網不通時可改用下方的外網分享 |
| 本機能開、同事顯示「重新連線中」 | 多半是網路中斷或 IP 變動；server 端會在 15 秒寬限期內保留玩家，恢復後自動接回 |
| 關掉終端機視窗 server 就停了 | `npm start` 綁在該終端機。玩的期間保持視窗開著（可縮小），或用 `tmux`（需 `brew install tmux`）：`tmux new -s game` → `npm start` → 按 `Ctrl+B` 再按 `D` 離開，之後 `tmux attach -t game` 回來、`Ctrl+C` 停止。注意 `nohup npm start &` **擋不住**：Node 啟動時會把訊號處理重設為預設值，關閉終端機的 SIGHUP 仍會讓它結束 |
| 電腦睡眠後大家斷線 | 用 macOS 內建的 `caffeinate` 讓電腦在 server 執行期間不閒置睡眠：`caffeinate -i npm start`（可與 tmux 併用）。筆電闔上螢幕仍會睡眠，玩的期間不要闔上 |
| 第 51 人加入顯示「房間已滿」 | 房間上限 50 人（含 15 秒寬限期內斷線的人）；稍等斷線者逾期後即可加入 |

## 外網分享（備用，cloudflared）

**主要部署方式是上面的區網**；區網不通、或同事不在同一個網段時，才用 Cloudflare Tunnel 把本機 `:80` 曝露成 HTTPS 網址（同一個 server 程序同時服務區網與 tunnel，程式不用改）。

1. 安裝：`brew install cloudflared`
2. 先建置並啟動正式版：`npm run build` → `npm start`（`npm run dev` 也能接 tunnel，但 Vite 的 HMR websocket 經 tunnel 連不上，瀏覽器 console 會報錯，遊戲本身不受影響）
3. 另開終端機：`npm run tunnel`（等同 `cloudflared tunnel --url http://localhost:80`）
4. 終端機會印出 `https://<隨機>.trycloudflare.com`，分享 `https://<隨機>.trycloudflare.com/draw-guess/` 即可。

注意：

- 新網址剛印出來時可能要等**半分鐘到一分鐘**才解析得到（DNS 傳播），開不起來先等一下再重試；本機 server 重啟不用重開 tunnel。
- 快速通道的網址是臨時的，**每次重啟 tunnel 都會變**；要固定網址需用具名通道（見 [spec/architecture.md](spec/architecture.md) §3「外網可達」）。
- **網址公開即任何人都能進來**，本專案沒有登入機制，只靠網址不外流（房間上限 50 人）。只分享給同事，**玩完就關掉 tunnel**（在該終端機按 Ctrl+C）。
- tunnel 固定指向 80 埠；server 若改用其他 `PORT`，tunnel 會連不到。

## Docker 部署（換電腦）

新電腦**只要裝 Docker**，不必裝 Node、不必 `npm install`／`npm run build`：映像在建置時就把前後端建好，只含執行需要的檔案（不含原始碼與開發工具），以非 root 使用者執行，並內建 `/healthz` 健康檢查。

1. **安裝 Docker Desktop**（macOS／Windows），啟動一次讓它跑起來。
2. **取得程式並啟動**：

   ```bash
   git clone <repo 網址> fishing-work
   cd fishing-work
   docker compose up -d --build     # 第一次會建置映像，約一兩分鐘
   ```

3. **查這台電腦的區網 IP**：macOS `ipconfig getifaddr en0`（有線網路可能是 `en1`）；Windows 在命令提示字元執行 `ipconfig`，看「IPv4 位址」。
4. **分享** `http://<IP>/draw-guess/` 給同事（`http://<IP>/healthz` 回 `{"ok":true}` 代表連得到）。
   - 容器內看不到主機的區網 IP，啟動 log 不會列出分享網址，而是印 `server.lan.container` 提示。想讓 log 直接印出正確網址，可設 `PUBLIC_URL`（站台根網址）：

     ```bash
     PUBLIC_URL=http://192.168.1.50/ docker compose up -d
     ```

     或在專案根目錄建立 `.env` 檔寫入 `PUBLIC_URL=http://192.168.1.50/`（`HOST_PORT` 也可以寫在這裡），之後 `docker compose up -d` 都會套用。舊值 `PUBLIC_URL=http://192.168.1.50/draw-guess/` 仍相容（程式只取 origin，印出來一樣是根網址）。

常用指令（都在專案根目錄執行）：

| 動作 | 指令 |
|------|------|
| 看 log | `docker compose logs`（持續追蹤加 `-f`） |
| 停止並移除容器 | `docker compose down` |
| 更新到最新版 | `git pull` 後 `docker compose up -d --build` |
| 看狀態（含健康檢查） | `docker compose ps` |

- **重開機自動恢復**：compose 設了 `restart: unless-stopped`，只要 Docker Desktop 有開機自動啟動（設定 → General →「Start Docker Desktop when you sign in」）就會自己起來；用 `docker compose down` 停掉的則不會。
- **Windows 的 80 埠被占用**（常見是 IIS 或 `http.sys`，啟動時報埠已被使用）：改用其他主機埠，例如 PowerShell `$env:HOST_PORT=8080; docker compose up -d --build`（或寫進 `.env`：`HOST_PORT=8080`），分享網址要帶埠號 `http://<IP>:8080/`（我畫你猜為 `http://<IP>:8080/draw-guess/`）；也可以停掉占用 80 的服務。注意公司區網可能只放行標準埠。
- **防火牆**：第一次啟動時系統若詢問是否允許 Docker 接受連入連線 → 允許，否則同事連不上。
- **外網分享**：Cloudflare Tunnel 仍在主機上跑（不放進容器）：`cloudflared tunnel --url http://localhost:80`（主機埠改過就改成對應埠）。
- 只想用 Dockerfile 不用 compose 也可以：`docker build -t fishing-work .` → `docker run -d --name fishing-work -p 80:80 --restart unless-stopped fishing-work`。要讓 log 印出正確的分享網址，`docker run` 再加 `-e PUBLIC_URL=http://<新電腦 IP>/`（站台根網址）。

## 繪圖比賽

平台的第二款遊戲（Epic 14），與我畫你猜由**同一個 server 程序**提供，偽裝成簡報（PowerPoint）。規則見 [spec/draw-contest/overview.md](spec/draw-contest/overview.md)，契約與部署見 [spec/draw-contest/architecture.md](spec/draw-contest/architecture.md)。

**怎麼玩**（給同事）：

1. 瀏覽器開 `http://<IP>/draw-contest/`（`http://<IP>/` 遊戲清單也有入口），輸入暱稱（規則同我畫你猜），選「簡報」進入。
2. 沒有回合進行時，任何人可按「我出題」成為出題者（至少 2 人在線），60 秒內輸入題目（1～20 字，例如「蘋果」）。
3. 題目送出時在線的所有人（**含出題者**）同時作畫 2 分鐘；題目對所有人公開，每人只看得到自己的畫布。
4. 畫完按「完成」交卷（交卷後不能改）；時間到會自動交卷。中途加入的人本回合旁觀。
5. 評分器逐張打分（0～100），全部評完後以投影片瀏覽揭曉每人的畫、分數與名次，前三名高亮；隨機評分時畫面會標示「隨機評分」。揭曉停到有人按「我出題」開始下一回合。

**網址**：正式（`npm start` 或 Docker）為 `http://<IP>/draw-contest/`；`PUBLIC_URL` 填站台根網址（例如 `http://<IP>/`），啟動 log `server.lan` 的 `games` 會列兩款遊戲的完整網址（2026-10-12 起；舊的 `/draw-guess/` 值仍相容）。

**開發**：

```bash
npm run dev  # 一次啟動 server（:5173）、我畫你猜的 Vite（:80）與繪圖比賽的 Vite（:5174），並自動開瀏覽器到 http://localhost/（遊戲清單）
```

從遊戲清單點進 <http://localhost/draw-contest/> 就是 Vite 開發版（HMR；:80 的 Vite 把 `/draw-contest` 轉給 :5174，`/socket.io` 轉給 server :5173）。5173／5174 只是內部轉發目標，不需要直接開，也不給區網同事連。

## Ollama 連線

繪圖比賽的評分器（Clef 打分）與評語器（gemma4 以「メスガキ」評審人設，對每張畫講一句評語，只顯示在揭曉卡片上）以環境變數切換（server 讀取；Docker 由 `docker-compose.yml` 帶入，可寫在 `.env`）：

| 變數 | 預設 | 說明 |
|------|------|------|
| `JUDGE` | `ollama` | `ollama`：Clef 決策模型（**預設**）；`random`：隨機評分器（不需要 AI）。**沒有 Ollama 的機器設 `JUDGE=random`** |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama 位址；Docker 內預設 `http://host.docker.internal:11434`（compose 已設） |
| `JUDGE_MODEL` | `clef:27b-nvfp4` | Ollama 裡的模型 tag（27B NVFP4，約 18 GB；`ollama list` 可查）；用其他版本（如 `clef:27b-q4_k_m`、`clef-flash`）時改此值 |
| `JUDGE_TIMEOUT_MS` | `30000` | 單張評分逾時；逾時或失敗的那張退回隨機，且本回合剩下的一律改用隨機 |
| `JUDGE_FAKE_DELAY_MS` | `1500` | 隨機評分器每張的假延遲（讓「評分中 n/m」看得到；測試設 0） |
| `COMMENT` | `ollama` | 評語器：`ollama`（gemma4 產メスガキ評語，**預設**）；`off` 關閉。**沒有 gemma4 或記憶體不足的機器（例如 32 GB）設 `COMMENT=off`** |
| `COMMENT_MODEL` | `gemma4:26b-mlx-bf16` | 評語用的 Ollama 模型 tag（約 52.5 GB；`ollama list` 可查），位址同樣用 `OLLAMA_URL` |
| `COMMENT_TIMEOUT_MS` | `20000` | 單張評語逾時；逾時或輸出空白的那張沒有評語，且本回合剩下的各張直接跳過（下一回合再試） |

- **交卷原圖直送，不再縮圖**（2026-10-12）：Clef `clef:27b-nvfp4` 在 Ollama 0.40.3 的 MLX 後端下 1280×720 原圖約 2.4 秒，`JUDGE_IMAGE_WIDTH` 已移除（設了也不會讀）。
- **記憶體需求**：評分與評語兩個模型會同時常駐，合計約 **71 GB**（Clef 約 18 GB＋gemma4 約 52.5 GB），128 GB 的機器沒問題；**32 GB 的機器請設 `COMMENT=off`**（只留評分），或連評分也不用時再加 `JUDGE=random`。
- **評語不影響揭曉**：分數與排名只由評分器決定；每張評完分才開始產生評語，揭曉不等它，晚到的評語會自動補在卡片上（等待中顯示「…」）。**第一名會被稱讚**：名次揭曉時才知道，所以第一名的評語在揭曉當下重做一次「稱讚版」（同一個評審人設），會比其他人晚一點出現；稱讚版失敗時第一名沒有評語。啟動時若清單裡有 `COMMENT_MODEL` 會先在背景暖機一次（log `draw-contest.comment.warmup`，冷啟動載入約 9～17 秒）；連不上或沒有該模型只會警告 `draw-contest.comment.commentUnavailable`，遊戲照常可玩、卡片只是沒有評語。

- **預設 `ollama`**：連不上 Ollama 或沒有該模型時，啟動 log 警告 `draw-contest.judge.ollamaUnavailable`（附原因），**遊戲照常可玩**：每回合仍先試 Ollama，連不上就該回合自動退回隨機，畫面備忘稿標「（隨機評分）」。Ollama 之後才開也**不用重啟** server，下一回合就會改用 AI 評分。確定沒有 Ollama 的機器直接設 `JUDGE=random` 與 `COMMENT=off`，省掉每回合的連線嘗試與 log。啟動時若清單裡有 `JUDGE_MODEL`，會先在背景暖機一次（送一張 1×1 的圖把 Clef 載進記憶體並常駐 30 分鐘，log `draw-contest.judge.warmup`；Clef 冷啟動第一張約 13 秒，暖機後第一回合第一張不必等），暖機失敗只警告 `draw-contest.judge.warmupFailed`、不影響評分。`/healthz` 不檢查 Ollama。
- **模型不進映像**：Ollama 跑在主機上，容器只以 HTTP 呼叫它。
- **macOS（Docker Desktop）**：容器經 `host.docker.internal` 可直接連到主機 `127.0.0.1` 上的 Ollama，**預設設定即可**，不必改 Ollama 的綁定。
- **Linux 主機**：compose 以 `extra_hosts: host.docker.internal:host-gateway` 讓容器解析得到主機，但連線會從 Docker bridge 網段進來，Ollama 必須以 `OLLAMA_HOST=0.0.0.0` 啟動（例如 `OLLAMA_HOST=0.0.0.0 ollama serve`，或在 systemd 服務設定此環境變數）才收得到。
- 不用 Docker、直接 `npm start` 時，預設的 `http://127.0.0.1:11434` 就是本機 Ollama，不必另設；沒有 Ollama 時用 `JUDGE=random COMMENT=off npm start`。
- 模型未就緒時可用假 Ollama 測接線：`node user/mock/systemone.mjs`（預設 `127.0.0.1:11435`，評分的 `/v1/systemone` 與評語的 `/api/chat` 都有），再以 `OLLAMA_URL=http://127.0.0.1:11435 npm start` 指向它。

## 開發

```bash
npm install
npm run dev          # 同時啟動 Vite（綁 :80）與 server（:5173，只當 proxy 目標）
```

瀏覽器開 <http://localhost/draw-guess/>（Vite 開發版，HMR）。Vite 綁 80 並把 `/socket.io` proxy 到 `localhost:5173` 的 server；區網同事開 `http://<IP>/draw-guess/` 看到的也是開發版。

**正式與開發不能同時跑**：`npm run dev`（Vite）與 `npm start` 都占 80。要在開發時驗證建置結果，改用其他埠，例如 `PORT=3100 npm start`（dev 的 server 已占 5173、繪圖比賽 Vite 占 5174）。

## 驗證指令（根目錄，每條分開跑）

```bash
npm run typecheck    # 三個 workspace 的 tsc --noEmit
npm test             # Vitest：shared、server（含 e2e 協定測試）、draw-guess
npm run build        # 建置 client 與 server
npm run lint         # ESLint（目前涵蓋 draw-guess）
```

協定測試與壓測（選用，需先 `npm run build`；用隔離埠與 `HOST=127.0.0.1`，不要占 80）：

```bash
PORT=3180 HOST=127.0.0.1 node server/dist/index.js &          # 背景啟動，記下 node 的 pid（$!）
TEST_PORT=3180 SERVER_PID=<pid> node user/protocol/draw-guess-load.mjs   # 30 客戶端壓測；CLIENTS／ROUNDS 可調
kill <pid>
```

壓測內容與結果判讀見腳本檔頭；`user/protocol/` 下的 `draw-guess-phase*.mjs` 是各 Phase 的協定測試。
