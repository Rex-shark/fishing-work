# draw-contest

fishing-work 的「繪圖比賽」客戶端：React 19 + Vite 8 + TypeScript + Tailwind CSS v4 + Zustand，透過 Socket.IO 連 server 的 `/draw-contest` namespace。出題者送出題目後，在線的每個人各自在自己的畫布上畫 2 分鐘，交卷後由 server 的評分器逐張打分，揭曉時所有人的畫依分數排列；畫面偽裝成簡報軟體（PowerPoint）。

- 規則：[../spec/draw-contest/overview.md](../spec/draw-contest/overview.md)；事件契約、狀態機、評分器、客戶端結構：[../spec/draw-contest/architecture.md](../spec/draw-contest/architecture.md)（§4、§5、§7）；畫面對照：[../spec/draw-contest/design.md](../spec/draw-contest/design.md)
- 事件型別、常數與驗證純函式一律從 `@fishing-work/shared/draw-contest` 匯入，不在本模組另行宣告；分數、排名、評語都由 server 決定，客戶端不自己算
- 正式部署（區網 80 埠、防火牆、Docker）、評分器與評語器的環境變數（`JUDGE`、`COMMENT`、`OLLAMA_URL`…）與玩法說明見根目錄 [README.md](../README.md) 的「繪圖比賽」；本模組建置後由 server 以 `/draw-contest/` 提供，不單獨部署

## 指令（建議在專案根目錄執行）

| 指令 | 說明 |
|------|------|
| `npm run dev` | 根目錄：一次啟動五個程序——server（`PORT=7180`）、三款遊戲的 Vite、等 `/healthz` 就緒後開瀏覽器到 http://localhost/ 的小腳本。繪圖比賽的 Vite 綁 **7181**（`strictPort`，被占用就直接失敗）；平常從遊戲清單點進 `http://localhost/draw-contest/`（我畫你猜的 Vite 在 :80 把 `/draw-contest` 轉到 :7181，HMR 可用），`/socket.io` 由 Vite proxy 到 `localhost:7180` |
| `npm run build` | 根目錄：建置三款遊戲的 `dist/`（含 `draw-contest/dist/`）與 `server/dist/index.js` |
| `npm run typecheck -w @fishing-work/draw-contest` | `tsc --noEmit`（app、`test/` 與 vite.config） |
| `npm test -w @fishing-work/draw-contest` | Vitest：`test/` 下的純函式測試、靜態渲染與原始碼守門（見下方「測試」） |
| `npm run lint -w @fishing-work/draw-contest` | ESLint（flat config + typescript-eslint） |

繪圖比賽的 Vite 沒有開 `host`，只給本機用；直接開 `http://localhost:7181/` 時，`/`（遊戲清單）與 `/healthz` 轉給 server（:7180）、`/draw-guess` 轉給 :80、`/song-guess` 轉給 :7182，與從 :80 進來看到的一樣。

沒有 Ollama 的機器，server 以 `JUDGE=random COMMENT=off` 啟動即可玩（隨機評分、沒有評語）；客戶端不需要任何設定。

## 目錄結構

```
draw-contest/
├── index.html              # 內嵌腳本：CSS 套用前先依 session 鍵設 data-theme（防閃爍）
├── vite.config.ts          # base /draw-contest/、port 7181、proxy
├── src/
│   ├── main.tsx            # 第一次繪製前套好畫布底色與文件主題
│   ├── App.tsx             # 三分支：遊戲畫面（殼層＋插槽）／自動重連畫面／首頁；啟動自動交卷與比賽歷史
│   ├── pickScreen.ts       # 三分支的判定（純函式）
│   ├── home/               # 首頁（不偽裝的紙張質感 UI）：暱稱＋風格卡片（只有「簡報」一張）
│   ├── socket/client.ts    # 連線、加入與重連憑證、出題動作（volunteer／setTopic／cancel）、交卷、聊天
│   ├── store/game.ts       # me、players、round、chat、自己的畫布、畫筆、交卷狀態、揭曉畫廊的 object URL
│   ├── features/
│   │   ├── canvas/         # 本機畫布、工具列與「完成」、顏色面板、渲染純函式、交卷 PNG 匯出
│   │   ├── round/          # 出題對話框、交卷與確認框、自動交卷、回合狀態列（各階段文字、倒數）、「我出題」
│   │   ├── reveal/         # 揭曉畫廊（縮圖卡、評語行、放大檢視）
│   │   ├── history/        # 比賽歷史（最近 5 場，存在瀏覽器的 IndexedDB）
│   │   ├── chat/           # 聊天室（純文字）
│   │   ├── players/        # 玩家清單的列資料與狀態文字
│   │   └── help/           # 遊戲說明（六個主題，數字由常數推導）
│   ├── shells/             # 偽裝殼層：註冊表、共通介面（types、views）、ppt/、office/（Office 系共用元件）
│   ├── layout/             # 工具提示、狀態列式項目、連線狀態、圖示、介面偏好（uiStore）
│   └── styles/theme.css    # token：:root（基底）、ppt、home
└── test/                   # Vitest（沒有 DOM 環境；見「測試」）
```

## 回合畫面

五個階段 `idle → choosing → drawing → judging → ended`，各階段投影片區、功能區、備忘稿列、縮圖窗格與狀態列中段顯示什麼，逐列對照 [design.md](../spec/draw-contest/design.md) §2；文字由純函式產生，測試逐列比對。

- `src/features/round/roundDisplay.ts`：`roundNotes`（回合狀態列：「上一回合：蘋果　第一名：X（87 分）」、「X 正在輸入標題… 00:45」、「作畫中 01:23　標題：蘋果　已儲存 3/8」、「正在評分 5/8…」、揭曉的「蘋果　第一名：X（87 分）」）、`canVolunteer`（idle／ended 且在線 ≥ `MIN_PLAYERS` 才能出題）。句子裡「標題」「儲存」這類叫法來自殼層（見「偽裝殼層」）。
- `src/features/round/countdown.ts`：倒數＝`round.endsAt − Date.now()`，不靠 server 每秒推；顯示值 clamp 到該階段長度（出題 `CHOOSING_SECONDS` 60 秒、作畫 `DRAW_SECONDS` 120 秒），本機時鐘慢幾秒也不會出現 02:01。最後 10 秒改警示色並加圖示。
- `src/features/round/TopicDialog.tsx`：出題對話框，只在自己是出題者的 choosing 顯示。Enter 送出（`round:setTopic`）、Esc 放棄（`round:cancel`）；題目合不合法以 server 為準，前端只顯示字數。送出中輸入框是 `readOnly`＋`aria-busy`、**不用原生 `disabled`**（焦點不會掉，失敗後可直接改字再按 Enter）。

### 本機畫布與交卷

**筆跡不經 server。** 每個人畫在自己的瀏覽器裡，別人看不到作畫過程；交卷時才把整張畫匯出成 PNG 送出。

- `src/features/canvas/ops.ts`：本機筆跡 `DrawOp`（不屬於 Socket 契約，所以定義在客戶端）。筆跡只在 store 的 `myCanvas`（記憶體）：斷線重連不丟，**重新整理頁面會丟**（還沒交卷的畫沒有存任何地方）。
- `src/features/canvas/Canvas.tsx`：渲染 `myCanvas`；自己是參賽者、phase 為 drawing、還沒交卷時才接受指標輸入。交卷後與 judging 期間鎖定，只顯示。
- `src/features/canvas/ToolBar.tsx`：目前顏色鈕（開顏色面板 `ColorPanel.tsx`）、`PALETTE` 的 10 個色塊、粗細滑桿（`BRUSH_MIN`～`BRUSH_MAX`）、背景色、橡皮擦、復原、清空；全部只改自己的畫布。視窗寬度小於殼層給的斷點（ppt 540px）時粗細滑桿收進「⋯」面板。`FinishButton`（「完成」）是另一個插槽，殼層把它固定在工具列的捲動區之外。
- `src/features/canvas/exportPng.ts`：以 `CANVAS_LOGICAL`（1280×720）的離屏 canvas 重繪——先填底色、再疊筆跡層——輸出 PNG bytes。不直接拿畫面上的 `<canvas>`：畫面上的底色是 CSS 背景，畫布像素本身不含底色。
- `src/features/round/submit.ts`：`submitMyCanvas()`＝匯出 PNG → `contest:submit` → 成功即鎖定。超過 `MAX_SUBMISSION_BYTES`（2 MiB）不送；等 ack 的逾時放寬到 15 秒，逾時後重送若得到 `ALREADY_SUBMITTED` 視同已交卷。
- `src/features/round/submitConfirm.ts`／`SubmitConfirmDialog.tsx`：按「完成」先開確認框（強制回應、焦點陷阱），確認才交卷；交卷後不能再改。

### 自動交卷

`src/features/round/autoSubmit.ts`（`App` 掛載時啟動）：自己是參賽者而還沒交卷時，

- drawing：本機時間到 `round.endsAt` 就交出目前的畫（空白也交），不經確認框；
- judging：server 已截止作畫（本機時鐘較慢，或剛重新整理）→ 立刻補交，是否還在 `SUBMIT_GRACE_SECONDS`（5 秒）寬限內由 server 判斷。

每回合最多自動交一次。判斷是純函式（`autoSubmitDue`／`autoSubmitDelay`），時鐘與計時器可注入。

### 揭曉畫廊

`src/features/reveal/`：idle／ended 且有上一回合結果時放在投影片區（choosing 時結果還在，但投影片區是空白投影片）。

- `revealView.ts`（純函式）：依 `results` 的 `rank` 排序；名次 1～3 用 ①②③；前三名且有交卷才加框；未交卷的卡片分數位置顯示「未儲存」（叫法來自殼層）、縮圖空白。
- `Reveal.tsx`：每位參賽者一張 16:9 縮圖卡（標題列＝名次、暱稱、分數），自己那張卡底色不同。點縮圖（或 Enter／Space）放大，再點或 Esc 回網格，焦點還給原縮圖。
- 圖片來自 `contest:gallery`（每位交卷者一則 PNG）：store 收到就建 object URL（`gallery`），新回合 drawing 開始、換了回合的快照、回首頁時全部 revoke。交卷了但圖還沒到的卡片顯示灰底「載入中」。
- **評語行**在縮圖下方：評審名稱（shared 的 `COMMENT_PERSONA_NAME`）粗體前綴＋評語，完整顯示不截斷。顯示與否只看該卡片自己的 `comment`／`commentPending`，不看 `round.commentMode`：有字 → 顯示；還在產生 → 「正在寫評語」；兩者皆否（未交卷、失敗、評語關閉）→ 整行不渲染，卡片變矮。

## AI 評分與評語（客戶端看到的樣子）

評分器與評語器都在 server（架構與模型見 architecture §6、§6.1）；客戶端只呈現收到的欄位。

- **評分中**：備忘稿列「正在評分 n/m…」，m 是已交卷數。
- **隨機評分**：連不上 Ollama 或設了 `JUDGE=random` 時，該張 `judgedBy` 為 `random`——卡片分數旁加小字「隨機」，備忘稿列的「正在評分」與第一名摘要後加「（隨機評分）」。
- **評語晚到**：揭曉不等評語。還沒寫好的卡片先顯示「正在寫評語」，之後每完成一張 server 發一則 `contest:comment`，store 的 `applyComment` 把它補進 `round.results`（成功是字串、失敗是 null，兩者都結束「正在寫」）。只收 `roundNo` 相符的；有人已經按了出題（phase 變成 choosing）也照樣補，下一回合 drawing 開始後才不再收。
- **第一名是稱讚版**：名次揭曉時才知道誰第一，所以第一名的評語在揭曉當下被重設成「正在寫評語」、重寫一次，會比其他人晚一點出現；稱讚版失敗時 server 改送他原本的一般評語（沒有才是 null），客戶端照收到的 `contest:comment` 顯示，不需要分辨。
- **沒有評語**：`COMMENT=off`、評語器失敗的那一張，或同一回合連續兩次失敗後剩下的各張——卡片就是沒有評語行，分數與排名不受影響。

## 比賽歷史

`src/features/history/`（Epic 17）：揭曉後把這回合的畫、分數、排名、評語存進**這台瀏覽器**，之後可以翻回來看。不經 server、不同步給別人、不分暱稱；只留最近 `HISTORY_MAX`（5）場。

- **存在哪**：IndexedDB 資料庫 `fishing-work:draw-contest`（版本 1）、object store `history`、主鍵 `id`、沒有索引。同一瀏覽器的所有分頁共用。
- **一筆＝一回合**：`{ id, savedAt, roundNo, topic, judgeMode, commentMode, me, results, images }`。`id` 是該回合的 `round.startedAt`；`me` 是建檔當下自己的 playerId（檢視時標「你」）；`images` 是 playerId → PNG 的 `Blob`；`results` 的 `commentPending` 一律存成 false。
- **何時存**（`historyStore.ts`）：phase 為 ended、有結果、至少一人交卷就建檔。之後同一回合每到一張圖、每補上一則評語都更新該筆（phase 已是 idle／choosing 也算），直到下一回合開始或離開遊戲；`savedAt` 維持首次建檔時間。加入或重新整理時 phase 不是 ended 就不建檔。重新整理後在 ended 補收的資料以相同 `id` 合併：已有的評語不被較舊的快照蓋掉、圖片只補沒有的。每次寫入後超過 5 筆就刪 `savedAt` 最舊的。
- **入口**：「檔案」選單的「開啟最近的簡報 ›」，子清單最新在上，每列「蘋果 — 10/12 14:03 — 第一名 Alice（87 分）」；沒有存檔時是一列灰字「沒有最近的簡報」。只有 idle、ended、choosing（自己不是出題者）可以開，其餘時機整項灰化。開啟「檔案」選單時會重讀清單（別的分頁可能寫了新紀錄）。
- **檢視**：投影片區以揭曉畫廊顯示存檔那一場（重用 `RevealView`，放大檢視照舊，沒有「正在寫評語」；沒存到圖的卡片是空白）；備忘稿列「最近的簡報：蘋果（10/12 14:03）　第一名：X（87 分）」；狀態列中段是「關閉簡報」。玩家清單與聊天仍是現場的。下一回合 drawing 開始、或自己成為出題者時自動關閉。
- **object URL**：開啟一筆時從 Blob 建立，關閉、換開另一筆、自動關閉時全部 revoke（在 `historyStore.ts`，與 store 的 `gallery` 同一做法）。
- **IndexedDB 不可用**（隱私模式、被封鎖、配額滿）：靜默。只在 console 留 `[draw-contest] 比賽歷史寫入失敗`／`讀取失敗` 之類的警告，入口顯示「沒有最近的簡報」，遊戲完全不受影響。
- **銜接點只有兩處**：`App` 掛載時 `startHistory()` 訂閱遊戲 store 的 `round`／`me`；`socket/client.ts` 的 `contest:gallery` 多呼叫一次 `recordGalleryImage`（store 只留 object URL，原始 PNG 要從事件拿）。

| 檔案 | 內容 |
|------|------|
| `historyDb.ts` | `HistoryRecord`、存取介面 `HistoryDb`（`getAll`／`put`／`update`／`delete`）、原生 IndexedDB 的小 wrapper `createIndexedDbHistory`（不用套件）、記憶體假實作 `createMemoryHistoryDb`（測試注入）、`trimHistory` |
| `historyStore.ts` | 紀錄器（建檔／更新／停止／合併／修剪的時序）、檢視狀態 `useHistoryStore`（清單、開著的那一筆與 object URL）、`startHistory`／`openHistory`／`closeHistory`／`refreshHistory` |
| `historyDisplay.ts` | 純函式：可開的時機 `canViewHistory`、時間格式、清單列文字、備忘稿列文字、存檔 → 畫廊卡片 |
| `HistoryView.tsx` | `HistoryView`（存檔的畫廊）、`HistoryStatus`（備忘稿列那一行） |

## 本機偏好鍵

都在 `fishing-work:draw-contest` 命名空間，不與另兩款遊戲撞鍵：

| 鍵 | 存放 | 內容 |
|----|------|------|
| `fishing-work:draw-contest:shell` | localStorage | 偽裝主題 id（目前只有 `ppt`）；`index.html` 的內嵌腳本也讀它 |
| `fishing-work:draw-contest:session` | sessionStorage（每個分頁各一份） | 重連憑證 `{ nickname, token }`；有憑證時啟動直接進殼層的自動重連畫面，不經首頁。sessionStorage 不可用時退回記憶體 |
| `fishing-work:draw-contest`（store `history`） | IndexedDB | 比賽歷史，最近 5 場（見上一節） |

畫筆的顏色與粗細、還沒交卷的畫都只在記憶體，不寫入任何儲存。

## 偽裝殼層

外觀依根目錄 [DESIGN.md](../DESIGN.md) §13（簡報）、§14（首頁）、§16（說明）與 [design.md](../spec/draw-contest/design.md)。元件內不寫色碼，只用 `styles/theme.css` 的 token class；圖示為 inline SVG（不用 emoji、不引入圖示庫）。畫布底色是 shared 的 `CANVAS_BACKGROUND`，不是主題 token，不隨主題改變。

**殼層與功能元件分離**：`App.tsx` 依 `uiStore.shellId` 從註冊表取殼層，把功能元件放進插槽。功能元件（`src/features/**`）不含任何偽裝字樣（「投影片」「備忘稿」「簡報」「檔案」…）、不 import 特定殼層；殼層不讀 store、不碰 IndexedDB，資料一律經 `ShellProps`（`test/shellBoundary.test.ts` 掃描原始碼把關）。功能元件要在句子裡用到偽裝的叫法時，用殼層給的 `ShellViews.terms` 組句——題目＝「標題」、交卷＝「儲存」、畫廊＝「投影片瀏覽」、歷史＝「最近的簡報」。

| 檔案 | 內容 |
|------|------|
| `src/shells/index.ts`／`catalog.ts` | 主題註冊表 `SHELLS`（目前只有 `ppt`）與首頁卡片／「切換偽裝…」共用的清單；日後加主題在這裡多加一筆 |
| `src/shells/types.ts` | `ShellProps`：插槽 `players`、`canvas`、`toolbar`、`finish`、`reveal`、`historyView`、`historyStatus`、`chat`、`roundStatus`、`volunteer`、`connection`、`dialogs` ＋ `round`（phase、isSetter、canDraw、showCanvas、submitted、showReveal）＋ `counts`、`themes`、`help`、`history`（entries、openId、canOpen、open、close、refresh） |
| `src/shells/views.ts` | `ShellViews`（全部必填）：`Dialog`（用途 `topic`／`help`／`submit`；`busy`、`trapFocus`）、`PlayerList`、`chat`、`toolbar`（收合斷點）、`status`、`volunteer`、`help`（`switchHint`、`recentHint`）、`terms`（`topic`、`save`、`gallery`、`recent`） |
| `src/shells/document.ts` | 依畫面同步 `<html data-theme>`、`document.title`、favicon（首頁為 `home`） |
| `src/shells/ppt/PptShell.tsx` | 版面：標題列（作畫中前綴 `●`）｜功能區（檔案、常用、繪圖、說明…；右端固定「完成」）｜左縮圖窗格（玩家）｜投影片區（歷史／畫廊／自己的畫布／空白投影片）｜備忘稿列（回合狀態）｜右註解窗格（聊天）｜狀態列（中央「從目前投影片開始」＝我出題，看歷史時改為「關閉簡報」） |
| `src/shells/ppt/pptLayout.ts`／`pptViews.ts` | 純函式與文字（視窗標題、功能區分頁、對話框標題與按鈕、偽裝用語、比賽歷史的字樣）；ppt 的 `ShellViews` |
| `src/shells/ppt/PptDialog.tsx`／`SlidePlayers.tsx`／`CommentChat.tsx` | 對話框的文字（「輸入標題」「儲存投影片？」）、縮圖窗格的玩家卡（出題者外框、已交卷綠勾、旁觀淡化）、註解卡片 |
| `src/shells/office/FileMenu.tsx` | 「檔案」選單：「切換偽裝…」「說明…」「開啟最近的簡報 ›」（子清單）；切換偽裝的對話框；選單鍵盤與焦點 |
| `src/shells/office/OfficeDialog.tsx`／`CommentChat.tsx`／`officeLayout.ts` | Office 系殼層共用：對話框外觀與焦點、註解卡片與輸入列、純邏輯（按鈕文字、選單按鍵規則 `fileMenuKeyAction`、切換偽裝清單） |
| `src/layout/uiStore.ts` | 介面偏好：`shellId`（寫入 localStorage）、`nicknameDraft`、`helpTopic`（說明對話框的開關） |

## 測試

專案的 Vitest 沒有 DOM 環境（沒有 jsdom），也沒有 IndexedDB。做法：

- **純函式**：回合文字、倒數、畫布渲染（假 context 記錄呼叫序列）、PNG 匯出（假 canvas）、畫廊卡片、歷史的清單與備忘稿列文字。
- **靜態渲染**（`renderToStaticMarkup`）：比對元件輸出的結構與屬性。靜態渲染下 Zustand 只給初始狀態，需要其他狀態的測試以可變的假 store 代入（`vi.mock`）。
- **把元件當函式呼叫**取得元素樹，直接呼叫 `onClick`／`onSubmit`（`test/busyFocus.test.tsx`、`test/historyShell.test.tsx`）：驗事件處理有沒有接對、重複送出有沒有被擋。
- **store 與時序**直接驅動（`test/store.test.ts`、`test/autoSubmit.test.ts`、`test/historyStore.test.ts`）：`URL.createObjectURL`／`revokeObjectURL` 以 spy 取代；歷史注入記憶體假 DB 與假時鐘，照 server 的事件順序走一遍。
- **IndexedDB wrapper**（`test/historyDb.test.ts`）：注入自寫的假 `IDBFactory`（只實作用到的 API），與記憶體假實作跑同一組介面測試，另測不可用與各種失敗。
- **socket 接線**（`test/sessionResume.test.ts`）：以假的 `location`／`sessionStorage` 載入 `socket/client`，直接觸發已註冊的事件處理。
- **原始碼守門**（`test/shellBoundary.test.ts` 等）：殼層分界、偽裝字樣、色碼、不用原生 `disabled`。

測不到、要靠瀏覽器實測的：焦點與鍵盤操作（對話框、「檔案」選單的子清單展開與收起）、版面與響應式、真正的 canvas 繪圖與 PNG 內容、真的 IndexedDB（Blob 落地、配額、隱私模式、多分頁）、與真模型的評分和評語時序。驗收方式見 architecture §8。
