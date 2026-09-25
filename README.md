# fishing-work

部署在本機、同事透過公司區網（或 Cloudflare Tunnel）進來玩的簡易互動遊戲平台；第一款遊戲是偽裝成程式編輯器的「我畫你猜」。

- 產品範圍與遊戲規則：[spec/overview.md](spec/overview.md)
- 架構與事件契約：[spec/architecture.md](spec/architecture.md)（部署細節見 §3）
- 開發計畫：[plan/](plan/)
- 區網實機實測清單：[user/lan-test-checklist.md](user/lan-test-checklist.md)

## 玩法（給同事）

1. 瀏覽器開 Rex 分享的網址（例如 `http://192.168.1.23/draw-guess/`），在畫面上方的輸入框打暱稱（1～12 字，不可與房內的人重複）按 Enter。
2. 沒有回合進行時，任何人都可以按底部狀態列的「▷ 我來畫」當畫師（至少 2 人在線）。
3. 畫師在上方輸入框出題（1～20 字，60 秒內要出），接著有 90 秒作畫；分頁列右側的工具列有顏色、粗細、橡皮擦、復原、清空、放棄（滑鼠停在圖示上會顯示名稱）。
4. 其他人在底部 **TERMINAL** 輸入答案按 Enter。完全相符就算猜對（不分大小寫、全形半形、空白），原文不會公開，大家只會看到「X 猜對了」；越快猜對分數越高（50～100），畫師每有一人猜對 +20。
5. 全員猜對、時間到或畫師放棄時揭曉題目，5 秒後回到等待，下一位可以按「我來畫」。
6. 重新整理頁面或短暫斷線，15 秒內會自動接回，分數與畫師身分都保留。

畫師與已猜對的人打出含題目的訊息會被擋下；猜題者打「是長頸鹿嗎」這種含答案的句子也會被擋，只輸入答案本身即可。

## 需求

- Node.js ≥ 22.12
- （外網分享才需要）`cloudflared`

## 正式部署（區網）

同一個 Node 程序提供網頁與即時連線，不需要資料庫或其他服務。

```bash
npm install          # 第一次或相依性有變動時
npm run build        # 產出 draw-guess/dist/ 與 server/dist/index.js
npm start            # 單一 Node 程序，預設 HOST=0.0.0.0（所有介面）、PORT=80
```

1. **看啟動 log**：`server.lan` 那一行的 `share` 會列出可分享的網址（每個區網 IP 一個），例如 `http://192.168.1.23/draw-guess/`（80 埠不帶埠號）；找不到區網 IP 時會印 `server.lan.none` 警告（確認已連上 Wi-Fi／有線網路）。
2. **查 IP**（也可直接看 log）：`ipconfig getifaddr en0`（有線網路可能是 `en1` 等其他介面）。
3. **macOS 防火牆**：第一次啟動會跳出「是否允許 node 接受連入連線」→ 選「允許」。若「系統設定 → 網路 → 防火牆 → 選項」設成「封鎖所有連入連線」，需取消。
4. **用另一台裝置驗證**：同事的電腦或手機開 `http://<IP>/healthz`，應回 `{"ok":true}`。
5. **分享** `http://<IP>/draw-guess/` 給同事即可（`http://<IP>/` 是遊戲清單頁）。客戶端不需要設定任何伺服器位址。
6. **IP 會隨 DHCP 變動**：請在路由器為這台電腦保留 IP，或改用 `http://<電腦名稱>.local/draw-guess/`（mDNS，macOS 與多數 Windows 10+ 可解析）。電腦名稱見「系統設定 → 一般 → 共享」底部的「本機主機名稱」，或在終端機執行 `scutil --get LocalHostName`。

環境變數：`PORT`（預設 80）、`HOST`（預設 `0.0.0.0`）。例如 `PORT=8080 npm start`（非 80 埠時網址會帶埠號 `http://<IP>:8080/draw-guess/`）；`HOST=127.0.0.1` 只允許本機連線，區網同事會連不上。

- 為什麼是 80：公司區網只放行標準埠，5173／3000 之類的埠會被擋。macOS 10.14 起一般使用者即可綁 80，不需 sudo；Linux 需 `sudo` 或 `setcap`。
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

## 開發

```bash
npm install
npm run dev          # 同時啟動 Vite（綁 :80）與 server（:3000，只當 proxy 目標）
```

瀏覽器開 <http://localhost/draw-guess/>（Vite 開發版，HMR）。Vite 綁 80 並把 `/socket.io` proxy 到 `localhost:3000` 的 server；區網同事開 `http://<IP>/draw-guess/` 看到的也是開發版。

**正式與開發不能同時跑**：`npm run dev`（Vite）與 `npm start` 都占 80。要在開發時驗證建置結果，改用其他埠，例如 `PORT=3100 npm start`（dev 的 server 已占 3000）。

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
