# Epic 9：Docker 部署（換電腦也能一行指令跑起來）

> 用 Dockerfile 把 server 與前端打包成一個映像，新電腦只要裝 Docker 就能部署

**狀態**：🔄（2026-09-29 Phase 1 完成、Phase 2 龍骨驗證通過；待舵手協定測試，容器版以 `HOST_PORT=3182` 執行中）（2026-09-29 驗收子代理有條件通過，文件已回寫；待龍骨清殘留映像與 Rex 新電腦實機部署）
**起訖**：2026-09-29 ~ —
**負責**：Rex × 舵手（Helm，規格與計畫）× 龍骨（Keel，派工與驗收）

---

## 需求（Rex 2026-09-29）

> 「撰寫 DOCKERFILE，我要換電腦部署。」

- 新電腦不必裝 Node、不必 `npm install`／`npm run build`；裝 Docker 後即可啟動。
- 同事照樣用**新電腦的區網 IP** 連線（`http://<新電腦 IP>/draw-guess/`），80 埠。

## 設計決策

- 決策 1：**多階段 Dockerfile 放專案根目錄**：`build` 階段 `npm ci`＋`npm run build`（三個 workspace）；`runtime` 階段只裝 server 的正式相依（`express`、`socket.io`；`shared` 已被 tsup 打包進 `server/dist/index.js`），複製 `server/dist`、`server/public`、`draw-guess/dist`，**維持與 repo 相同的相對路徑**（`server/src/static.ts` 以 `server/..` 找 `draw-guess/dist`）。原因：映像小、不含原始碼與開發工具；程式不必為容器改路徑。
- 決策 2：**基底映像 `node:24-slim`**（目前的 Active LTS；`engines` 為 `>=22.12`，tsup target node22）。開發機仍用 Node 25，不影響。原因：部署求穩，用 LTS。
- 決策 3：**容器內以非 root 的 `node` 使用者跑、聽 80**（Docker 20.10 起容器預設允許非 root 綁低埠）；`ENV NODE_ENV=production PORT=80 HOST=0.0.0.0 IN_CONTAINER=1`；`EXPOSE 80`；`HEALTHCHECK` 打 `/healthz`（用 Node 內建 `fetch`，不裝 curl）。
- 決策 4：**`docker-compose.yml`**（便利用，Rex 可只用 Dockerfile）：一個服務、`build: .`、`ports: "${HOST_PORT:-80}:80"`、`restart: unless-stopped`（新電腦重開機自動起來）、可選環境變數 `PUBLIC_URL`。
- 決策 5：**分享網址 log**：容器內的網路介面是 Docker 內部網段（172.x），server 印的「區網網址」會是錯的。新增可選環境變數 `PUBLIC_URL`（例如 `http://192.168.1.50/draw-guess/`）：有設就印它；沒設且 `IN_CONTAINER=1` 時改印提示「請用主機的區網 IP：http://<主機 IP>:<對外埠>/draw-guess/，或設定 PUBLIC_URL」（2026-09-29 定案：以 spec §3 文案為準），不印 172.x 網址。原因：Rex 要把正確網址給同事。**2026-10-12 更新**：分享網址改印站台根網址（遊戲清單）與 `games`，`PUBLIC_URL` 改為根網址語意（舊值相容），見 spec §3（海圖定案）。
- 決策 6：**`.dockerignore`**：排除 `node_modules`、所有 `dist`、`.git`、`.idea`、`*.iml`、`.claude`、`plan`、`spec`、`user`、`*.md`（`server/public/index.html` 不受影響）。原因：建置脈絡小、快，不把文件與本機設定打進映像。
- 決策 7：**不做的事**：不做 HTTPS（Epic 8 已暫緩）、不推到 registry（在新電腦上 `git clone` 後直接 build，避開 Apple Silicon／x86 架構差異）、Cloudflare Tunnel 維持在主機上跑（`cloudflared tunnel --url http://localhost:80`），不放進容器。
- 決策 8：**新電腦注意事項寫進 README**：Windows 的 80 埠可能被 IIS／`http.sys` 佔用 → 改 `HOST_PORT=8080` 或停掉該服務；首次啟動防火牆要允許 Docker；查 IP：macOS `ipconfig getifaddr en0`、Windows `ipconfig`。

---

## 任務清單

### Phase 1：映像與啟動

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | 根目錄 `Dockerfile`（多階段、`node:24-slim`、非 root、HEALTHCHECK）與 `.dockerignore` | 決策 1–3、6；build／deps／runtime 三階段，映像 362MB（內容 82.6MB） |
| ✅ | `server/src/index.ts`：`PUBLIC_URL`／`IN_CONTAINER` 的分享網址 log（決策 5）＋單元測試（純函式） | spec §3「Docker 部署」；純函式 `server/src/lib/shareLog.ts`、測試 `server/test/shareLog.test.ts`（9 例） |
| ✅ | 根目錄 `docker-compose.yml` | 決策 4 |
| ✅ | README 新增「Docker 部署（換電腦）」一節：安裝 Docker、clone、`docker compose up -d --build`、查 IP、分享網址、停止與更新、Windows 80 埠注意事項 | 決策 7、8 |

### Phase 2：驗證

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | 龍骨：`docker build` 成功；`docker run -p 3182:80` 後 `/healthz` 回 `{"ok":true}`、`/draw-guess/` 載入、`/` 遊戲清單；容器以 `node` 使用者執行；healthcheck 變 healthy；映像大小回報；`docker compose up -d --build` 與 `down` 正常；`PUBLIC_URL` 有設／沒設的 log 各一次 | 用非 80 的主機埠避免與本機衝突 |
| ✅ | 舵手：對容器埠跑既有協定測試（phase1、background）；瀏覽器開容器版玩一回合 | 2026-09-29 驗收子代理（代舵手，Rex 同日指示舵手不再親自驗收）有條件通過：四項 0（80／400／729）；容器 :3182 跑 phase1 24/24、background 14/14，本機 :3190 跑 phase2 33、phase3 26、phase6 5、image 26 全過；容器 healthy、uid 1000、無 .ts／專案 .map、90 個套件版本與 lockfile 相同、dist 與本機建置 sha256 相同、log 無 172.x；瀏覽器三主題（vscode／ppt／meet）同房一回合無 console error。條件：spec 兩處用詞（已由舵手回寫）、殘留 `fishing-work:test` 映像（龍骨清） |
| ⬜ | Rex：在新電腦實際部署，同事用新電腦 IP 連線 | |

---

## 驗收標準

- [ ] 新電腦只裝 Docker，`docker compose up -d --build` 一行即可啟動，重開機自動恢復
- [ ] 同事以 `http://<新電腦 IP>/draw-guess/` 可玩；log 不會印出錯誤的 172.x 網址
- [x] 映像不含原始碼與開發相依、以非 root 執行、healthcheck 正常
- [x] 協定測試對容器版全過；`typecheck`／`test`／`build`／`lint` 各自 exit 0
- [x] `spec/architecture.md` §3、README、CLAUDE.md 與實作一致

---

## 派工規範（龍骨）

- 本檔與 `backlog.md` 只准局部替換；不 commit（Rex 自行）；子代理不得登記名冊、不得跨 session 傳訊。
- 驗證完要停掉並刪除測試用容器與映像標籤以外的殘留（`docker compose down`），不要佔用本機 80 埠。

---

## 踩雷紀錄

- **runtime 只裝 server 正式相依：不能用 `npm ci --omit=dev -w @fishing-work/server`**（2026-09-29 實測）。`socket.io-client` 是 server 的 devDependency、同時是 draw-guess 的正式相依，lockfile 不會把它標成 `dev`，於是連同 `engine.io-client`、`xmlhttprequest-ssl` 被裝進映像（多約 3MB，且違反「不含開發相依」）。改為在 `deps` 階段由 `server/package.json` 產生只含 `express`、`socket.io` 的 package.json（去掉已打包的 `@fishing-work/*`），搭配 repo 的 `package-lock.json` 跑 `npm install --omit=dev`：npm 以 lockfile 為起點，實測 90 個套件（含巢狀）版本與 lockfile 全數一致，裝出 77 個頂層套件、約 14MB，不含 workspace 連結。之後若 server 新增正式相依，不必改 Dockerfile；若新增的相依同時是別的 workspace 的相依也不受影響。
- **`.dockerignore` 的樣式以脈絡根目錄為準**：`node_modules`、`dist`、`*.md`、`*.iml` 只會排除根目錄那層，子目錄要寫 `**/node_modules`、`**/dist`、`**/*.md`、`**/*.iml`。`server/public/index.html` 不受影響。另外排除 `.env`（README 建議把 `PUBLIC_URL`／`HOST_PORT` 寫在這裡，不必進建置脈絡）。
- **sourcemap 含原始碼**：tsup 產出的 `server/dist/index.js.map` 內有 `sourcesContent`（TS 原始碼），build 階段建置後刪掉專案產出的 `*.map` 再複製，符合「映像不含原始碼」。第三方套件自帶的 `.map`（如 `socket.io/client-dist`）保留。
- **容器模式不印 `local`**：容器內的 `http://localhost/draw-guess/` 是容器埠，主機對外埠（`HOST_PORT`）可能不同，印出來會誤導，因此 `server.lan.container` 只印提示；有設 `PUBLIC_URL` 時容器內也只印 `share`（`source: "PUBLIC_URL"`）。非容器行為不變。
- **compose 未設 `PUBLIC_URL` 時傳入空字串**：`PUBLIC_URL: ${PUBLIC_URL:-}` 會讓容器環境出現 `PUBLIC_URL=`，程式把去空白後的空字串視為未設（有單元測試）。
- **HEALTHCHECK 加 `--start-interval=2s`**：`--interval=30s` 下首次檢查要等 30 秒才變 healthy；啟動期每 2 秒檢查一次，實測啟動後 1～3 秒即 healthy（需 Docker Engine 25 以上，舊版會忽略此參數）。
- **`npm ci` 在 build 階段警告 esbuild 的 postinstall 未列入 allowScripts**（npm 11 行為）：不影響建置，esbuild 由平台 optional 套件（`@esbuild/linux-*`）提供執行檔，tsup 正常產出。
- **文案差異**：決策 5 的提示文案為「容器內看不到主機的區網 IP，請用主機 IP：…」，spec §3 為「請用主機的區網 IP：http://<主機 IP>:<對外埠>/draw-guess/，或設定 PUBLIC_URL」；依派工指示以 spec 為準，已回報舵手。（2026-09-29 已定案：以 spec §3 為準，見決策 5）
