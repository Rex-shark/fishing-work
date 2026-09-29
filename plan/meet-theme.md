# Epic 5：視訊會議偽裝主題（Google Meet 風格，`meet`）

> 第三套偽裝殼層：整個遊戲看起來像一場正在「分享畫面」的視訊會議

**狀態**：✅（2026-09-29 Rex 目視通過，結案）（2026-09-26 決策 14 實作完成（龍骨驗收，隨 Epic 6 同一子代理）：tile 膠囊全寬度只顯示總分，meet 新基準 scratchpad/epic6/meet/（僅 07／08／09-1024 三張因膠囊改變，兩輪穩定）；仍待 Rex 目視。2026-09-25 Phase 1 龍骨驗收通過：typecheck／test 79＋375＋647／build／lint 皆 0；vscode 02–11、ppt 18 張、首頁 resume 06/07 與既有基準位元組相同；首頁三卡新基準 scratchpad/epic5/phase1/home/；舵手六項定案（決策 13）後 Phase 2 龍骨驗收通過：typecheck／test 79＋375＋676／build／lint 皆 0；vscode 02–11、ppt 18 張（龍骨自跑 3 輪 18/18）、首頁 resume 與既有基準位元組相同；meet 正式基準 18 張 scratchpad/epic5/phase2/meet/、首頁新基準 phase2/home/，兩輪穩定；Phase 3 三主題混玩 30 項斷言全過；待舵手瀏覽器實測與 Rex 目視）（2026-09-25 舵手驗收通過，含瀏覽器整回合實測；待 Rex 目視）
**起訖**：2026-09-25 ~ 2026-09-29
**負責**：Rex × 舵手（Helm，規格與計畫）× 龍骨（Keel，派工與驗收）

---

## 需求（Rex 2026-09-25）

> 「來個 UI，Google Meet 版本」

在既有 vscode／ppt 之外新增 `meet` 主題：首頁多一張「視訊會議」卡片，選了進去像 Google Meet 的通話畫面。功能、契約、server 不變。

## 設計決策

- 決策 1：**只加殼層與 token，不動功能元件**（Epic 3 決策 1、2 的架構已為此準備）：新增 `shells/meet/`、`theme.css` 的 `[data-theme='meet']` 覆寫、註冊表一行；首頁卡片自動出現。原因：這正是殼層抽象的目的。
- 決策 2：**版面對照＝「有人正在分享畫面的會議」**：畫布＝被分享的畫面（大 tile）、畫師＝分享者、「分享畫面」按鈕＝我來畫、玩家＝右側影片條的參加者 tile、聊天＝右側白色「通話中的訊息」面板、回合狀態＝主畫面下方的字幕列。對照表見下與 DESIGN §15.2。原因：每個遊戲元素都有會議裡的自然對應物，偽裝不用硬湊。
- 決策 3：**深色會議區＋白色側邊面板的混合配色**（Google Meet 現行設計即如此）。既有 token 一套只描述一種底色，因此新增 6 個「面板」token（`--bg-panel`、`--bg-panel-hover`、`--fg-on-panel`、`--fg-on-panel-muted`、`--border-panel`、`--accent-panel`），vscode／ppt 給等於自身側欄的值（外觀不變）。原因：聊天 renderer 與對話框是殼層自己畫的，需要一組白底用的顏色；不能讓深色 token 與白底混用。
- 決策 4：**參加者 tile 承載玩家清單全部資訊**：暱稱首字的彩色頭像圓（沿用 `--avatar-1..6`／`--fg-on-avatar`，Meet 關鏡頭時就是這樣）、左下暱稱、右下分數、畫師 tile 左上「分享畫面」圖示＋藍色外框、已猜對右上「舉手」圖示、斷線 tile 暗化。不另做「使用者」清單分頁。原因：遊戲需要隨時看到誰猜對，tile 一直在畫面上。
- 決策 5：**畫師工具列＝主畫面上方的浮動控制列**（深色圓角膠囊，仿分享者控制列），只有畫師時出現；「放棄本回合」按鈕留在工具列內，文字改由殼層 volunteer／status view 無法改，維持功能元件原文。原因：工具列是整組功能元件，不拆。
- 決策 6：**底部控制列的按鈕除「分享畫面」（＝我來畫）與「更多 ⋮」（切換偽裝…）外皆為裝飾**：麥克風（靜音狀態）、攝影機（關閉）、字幕、舉手、離開通話（紅色膠囊，點了無作用）、右側資訊／使用者／訊息（切換右側面板）／活動。全部有英文或中文工具提示（DESIGN §6：偽裝裝飾用英文 Tooltip 也可，Meet 介面本身是中文，這裡用中文）。原因：與 ppt 功能區分頁同一原則。
- 決策 7：**視窗標題 `Meet – kqw-mzdv-ptj`**（會議代碼為固定裝飾常數），作畫中前綴 `● `；favicon 自繪攝影機圖示，不用 Google 商標；首頁卡片圖示為綠色攝影機（`--brand-meet`）。原因：與 ppt 標題「簡報1 - PowerPoint」同一做法；不複製品牌 logo。
- 決策 8：**字型系統無襯線**（同 ppt 堆疊）；圓角 8px（Meet 的 tile 與面板）為本主題例外，與 ppt「投影片有陰影」同級的例外，寫在 DESIGN §15.3。
- 決策 9：**響應式**：< 1280px 影片條 160px；< 1024px 影片條改為主畫面下方的橫向列；< 768px 右側面板改為覆蓋層，由底部「訊息」按鈕開關（預設開）。工具列收合斷點 900px。
- 決策 10：**首頁卡片格改 `minmax(190px, 1fr)`**，三張在 640px 欄寬同列（DESIGN §14.3 同步）。原因：第三張卡片不該孤零零換行。
- 決策 12（2026-09-25 龍骨提問）：主畫面標籤需要畫師暱稱 → `ShellRoundState` 加 `drawerName: string | null`（App 由 players 依 `round.drawerId` 推導注入；無畫師為 null），與 counts 同一模式，殼層仍不讀 store；vscode／ppt 不使用、外觀不變。
- 決策 13（2026-09-25 龍骨 Phase 1 提問 1–6 定案）：(1) meet 的 `--bg-quickinput` 改 `#3C4043`（工具提示、「⋯」面板深灰白字），對話框改用 `--bg-panel`；(2) 拖圖覆蓋層改為 `ChatView.overlayClassName` 選填欄位，預設現況，meet 白底 90%＋`--accent-panel` 虛線與文字；(3) 畫師本人作畫中不顯示「正在分享畫面」標籤，其他情況照顯示；(4) meet 工具列收合斷點 1280px；(5) 同人連續訊息合併＝`ChatLineProps.groupWithPrevious` 選填、ChatPanel 計算；倒數最後 10 秒不另套 `--sem-warning`（v1 沿用白字＋圖示）；(6) 首頁描述允許兩行、`text-wrap: balance`、卡片等高。其他小差異（提示在輸入列上方、`--fg-on-active`、resume 文案、「你」、離開鈕圖示、斷點寫法、meetViews.ts）接受並已寫入 DESIGN／spec。
- 決策 14（2026-09-25 舵手驗收後）：參加者 tile 的分數膠囊只顯示總分「N 分」，「+N」放工具提示與 sr-only（字幕列已有「本回合 +N」）；原因：200px tile 放不下「+20 20 分」會把暱稱截成「Helm（…」，且此規則 < 1024px 已在用；不採計時器切換或改「（你）」樣式。待 Rex 目視後與其他回饋一起派。
- 決策 11：契約、server、`shared` 不動；既有 vscode／ppt 遊戲中截圖與首頁截圖（除多一張卡片外）必須位元組不變——首頁因卡片格與第三張卡片會變，另存新基準。

## 版面對照（寫入 DESIGN §15.2）

| Google Meet 元素 | 實際內容 |
|------------------|---------|
| 主畫面（分享中的畫面，大 tile，圓角 8px） | 畫布（黑底 `CANVAS_BACKGROUND`，本來就像分享出來的深色螢幕）；左上標籤「<畫師> 正在分享畫面」，idle 時「尚無人分享畫面」 |
| 主畫面上方浮動控制列 | 畫師工具列（只有畫師時出現） |
| 主畫面下方字幕列 | 回合狀態：階段、倒數、題目／字數提示、本回合分數（字幕樣式：半透明深底白字） |
| 右側影片條（參加者 tile） | 玩家清單（決策 4） |
| 右側白色面板「通話中的訊息」 | 聊天室：每則「暱稱  HH:mm」＋內文；system 灰字置中小字；correct 綠字＋打勾；圖片為縮圖卡；輸入列為膠囊「傳送訊息給所有人」＋送出圖示；輸入列上方小字功能提示（同 ppt） |
| 底部控制列左：時間 `HH:mm` ｜ 會議代碼 | 裝飾＋ connection 插槽（連線狀態小字） |
| 底部控制列中：麥克風、攝影機、字幕、**分享畫面**、舉手、更多 ⋮、離開 | 「分享畫面」＝我來畫（人數不足時灰化＋「等待其他玩家加入（n/2）」）；「更多」選單有「切換偽裝…」；其餘裝飾 |
| 底部控制列右：資訊、使用者(N)、訊息、活動 | 「訊息」切換右側面板；使用者(N) 顯示在線人數（counts）；其餘裝飾 |
| 對話框（白色卡片，藍色文字按鈕） | 出題「輸入題目」；放棄確認「停止分享畫面？」（「繼續分享」「停止分享」）；自動重連「正在重新加入通話…」 |
| 視窗標題 | `Meet – kqw-mzdv-ptj`；作畫中前綴 `● ` |

---

## 任務清單

### Phase 1：token、註冊與殼層骨架

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | `theme.css`：`:root` 與 `[data-theme='ppt']` 加 6 個面板 token（值＝各自側欄色，外觀不變）＋ `--brand-meet`；新增 `[data-theme='meet']` 覆寫（DESIGN §15.1 表）；`@theme inline` 映射 | 決策 3；vscode／ppt 截圖必須位元組不變 |
| ✅ | 註冊表：`ShellId` 加 `'meet'`；`shells/meet/definition.ts`（name「視訊會議」、description「深色視訊會議，像在開會分享畫面」、icon 綠色攝影機、titleFor、favicon-meet.svg）；`SHELLS` 順序 vscode、ppt、meet；catalog／首頁測試更新 | 決策 7 |
| ✅ | `shells/meet/MeetShell.tsx`：舞台（主 tile＋浮動工具列＋字幕列）、右側影片條、右側白色面板、底部控制列，依對照表放入插槽；`data-chat-drop-zone` 標在白色面板 | 決策 2、5、6 |
| ✅ | `ShellViews`：MeetDialog（白卡片、藍字按鈕）、PlayerList＝參加者 tile、ChatView（Meet 訊息格式與膠囊輸入列）、toolbar `compactBelowPx: 900`、status、volunteer `{ label: '分享畫面', icon: 分享圖示 }` | 決策 4、5 |
| ✅ | 自繪 SVG 圖示（16px 線條）：麥克風、攝影機、字幕、分享畫面、舉手、更多、離開、資訊、使用者、訊息、活動；首頁卡片攝影機（40px 用） | 不用 Google 圖示字型與商標 |
| ✅ | 首頁卡片格 `minmax(190px, 1fr)`；DESIGN §14.3 已改 | 決策 10 |
| ✅ | 驗證：typecheck／test／build／lint 0；vscode／ppt 遊戲中截圖位元組不變；首頁新基準（三張卡片） | |

### Phase 2：細節、響應式、對比

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | 參加者 tile 狀態：畫師外框＋圖示、已猜對舉手、斷線暗化、自己標「你」、分數變動 | 決策 4；`playerRow`／`scoreDelta` 純函式沿用 |
| ✅ | 「更多 ⋮」選單（切換偽裝…）；「訊息」按鈕開關面板；面板關閉時聊天投放區仍是面板（關閉＝不可拖圖，可接受） | 決策 6、9 |
| ✅ | 響應式三個斷點與工具列收合 900px | 決策 9 |
| ✅ | 對比：深色區與白色面板所有承載資訊文字 ≥ 4.5:1（值見 DESIGN §15.1）；`meetTheme` 測試解析 DESIGN 表逐字比對 token | |
| ✅ | shellBoundary：`shells/meet/**` 不 import uiStore／catalog／store；功能元件不含 Meet 字樣 | |

### Phase 3：驗證

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | typecheck／test／build／lint 各自 exit 0 | 2026-09-25 龍骨自跑：79＋375＋676 皆過 |
| ✅ | headless 混玩：meet 畫師 × vscode 猜題者 × ppt 猜題者整回合（含傳圖、洩題被擋、猜對、揭曉、放棄） | 2026-09-25 `scratchpad/epic5/mixed-shots.mjs` 30 項斷言全過：三端畫布雜湊一致、三端收到圖片、洩題只提示本人（meet 白面板紅字可見）、猜對／揭曉／分數三端逐字一致、放棄「停止分享畫面？」後三端回 idle、全程無 console error；截圖 phase3/mixed/（非基準） |
| ✅ | 舵手瀏覽器實測（首頁選「視訊會議」→ 整回合）；Rex 目視 | ；2026-09-25 舵手驗收 ✅：typecheck／test 79＋375＋676／build／lint 皆 0，shared／server 無 diff、features 只 +18／−3；內建瀏覽器（新 server 3181）：首頁三卡（描述兩行平衡換行）→ 選「視訊會議」→ Meet 殼層（尚無人分享畫面、參加者 tile、白色訊息面板、控制列）；Bob 以 vscode 加入；Helm 按「分享畫面」→ 白色出題對話框（取消／分享）→ 作畫：浮動工具列、字幕列「作畫中 01:30 題目：貓 已猜對 0/1」、畫師 tile 藍框＋分享圖示；Bob 端看到筆跡並猜對 → Meet 端「Bob 猜對了」綠勾、揭曉、tile 舉手圖示與 +100／+20 分數膠囊。2026-09-29 Rex 目視通過 |

---

## 驗收標準

- [x] `npm run typecheck`、`npm test`、`npm run build`、`npm run lint` 各自 exit 0
- [ ] 首頁第三張卡片「視訊會議」；進去第一眼像 Google Meet 的分享畫面會議（Rex 目視）
- [x] 「分享畫面」能開局；畫師工具列在主畫面上方；字幕列顯示回合狀態；tile 顯示畫師／已猜對
- [x] vscode／ppt 遊戲中截圖與 Epic 4 完成時位元組相同；契約與 server 未變
- [x] `spec/architecture.md` §7、`DESIGN.md` §15 與實作一致

---

## 派工規範（龍骨）

- 本檔與 `backlog.md` 只准局部替換；不 commit（Rex 自行）；子代理不得登記名冊、不得跨 session 傳訊；驗收前重啟 server 程序。
- 色碼一律 token，值以 DESIGN §15.1 為準；要改先問舵手。

---

## 踩雷紀錄

### Phase 1（2026-09-25，龍骨驗收）

- **殼層 html 字級 13px，Tailwind rem 尺寸縮成 13/16**：meet 要符合 DESIGN 的 px 就用 `h-[40px]` 這類 px 寫法（ppt 原本就有此縮小現象，未動）。
- **共用 token 在混合配色主題會出事**：全域 Tooltip 與 ToolBar「⋯」面板用 `bg-quickinput`＋`text-fg`，meet 的 quickinput 是白、fg 是淺灰 → 約 1.2:1 看不見；拖圖覆蓋層 `bg-selection/35 text-fg` 蓋在白色面板上也看不見。新增「一深一淺」混合主題時，要逐一檢查所有跨殼層共用元件（Tooltip、彈出面板、覆蓋層）用的 token 組合。
- **新增第三張卡片打破用 `lastIndexOf('<button')` 找「最後一張」的測試**：改用 `aria-disabled` 定位；截圖腳本的卡片數檢查也要跟著改。
- **頭像函式搬到中性位置 `shells/avatar.ts`**：ppt 與 meet 共用，ppt 輸出不變。
- **Tooltip placement 只有 top／right／bottom，沒有 left**；`ImageStatus` 的值是 `'pending'` 不是 `'loading'`。

### Phase 2（2026-09-25，龍骨驗收）

- **`text-balance` 會被首頁「只准 home-* 色彩 class」守門規則誤判**：改寫 `[text-wrap:balance]`。
- **`useMediaQuery` 在 SSR 報 Missing getServerSnapshot**：殼層要做靜態渲染測試時，改在事件當下查 `matchMedia`。
- **`bg-panel/90` 算出的是 `oklab(… / 0.9)` 不是 rgba**：截圖斷言兩種都要接受。
- **meet 控制列有即時時鐘**：所有截圖（含首頁 resume）都要先把 HH:mm 正規化。
- **卡片選取有 200ms 轉場**：截圖前多等，否則邊框差 1 像素。
- **ppt 回歸曾出現 1 像素偶發差異（註解卡片半像素邊框 213 vs 210）**：子代理 11 輪中 3 輪出現、版面 DOM 完全相同；龍骨另跑 3 輪全部 18/18。判定為 Chrome 渲染抖動；回歸判定以「連續多輪」為準。
- **功能元件的選填擴充點（`ChatView.overlayClassName`、`ChatLineProps.groupWithPrevious`）預設值必須等於改動前的寫死值**：以測試斷言預設 class 字串與舊版相同、vscode／ppt 傳不傳輸出一致，確保舊主題位元組不變。

---

## 後續評估：真實鏡頭（Rex 2026-09-28 提問，尚未排程）

| 題目 | 難度 | 做法與限制 |
|------|------|-----------|
| 1. 讀取自己的鏡頭，在自己螢幕的 tile 顯示自己的畫面 | **低**（約半天） | `getUserMedia` → `<video>` 放進自己的 tile；不經 server。**限制：瀏覽器只在安全來源允許鏡頭**——`http://192.168.x.x` 不算，只有 `localhost` 與 HTTPS 可以。要讓同事用，必須替 80 埠加 HTTPS（自簽憑證要每台電腦信任）或走 Cloudflare Tunnel 的 HTTPS 網址。另：分頁會出現錄影中的紅點，反而更像真的會議 |
| 2. 別人也看得到開鏡頭者的畫面 | **中到高** | (a) **WebRTC 網狀**：用現有 Socket.IO 當信令（offer／answer／ICE），區網內免 STUN／TURN；每個開鏡頭者對每個觀看者一條連線，3–5 人開鏡頭還行，人多就吃 CPU 與頻寬；公司 Wi-Fi 若開 client isolation 會連不上；tunnel 用戶要 STUN／TURN。約 2–3 天含實測。(b) **SFU**（mediasoup／LiveKit）：server 中繼、可擴充，但是一套新子系統，1–2 週。(c) **低畫質快照**：每秒 2–5 張 160×90 JPEG 走 Epic 2 的圖片中繼，server 廣播，沒有 WebRTC、tunnel 也通，看起來像卡卡的視訊，約 1 天。三者都同樣需要題目 1 的 HTTPS 前提 |

建議順序：先解 HTTPS（否則兩題都做不了），再做題目 1，題目 2 先用 (c) 驗證想法，真的需要流暢視訊再上 (a)。
