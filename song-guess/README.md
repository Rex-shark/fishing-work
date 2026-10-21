# song-guess

fishing-work 的「猜歌」客戶端：React 19 + Vite 8 + TypeScript + Tailwind CSS v4 + Zustand，透過 Socket.IO 連 server 的 `/song-guess` namespace。出題者選題庫（一位歌手、台灣熱門或西洋熱門），server 從 Apple iTunes 抽 5 首 30 秒試聽，所有人同時聽、在聊天室打字猜歌名；畫面偽裝成視訊會議（「有人正在分享音訊」）。

- 規則：[../spec/song-guess/overview.md](../spec/song-guess/overview.md)；事件契約、狀態機、客戶端結構：[../spec/song-guess/architecture.md](../spec/song-guess/architecture.md)（§4、§5、§7）；畫面對照：[../spec/song-guess/design.md](../spec/song-guess/design.md)
- 事件型別、常數與驗證純函式一律從 `@fishing-work/shared/song-guess` 匯入，不在本模組另行宣告；猜對與否、防洩題都由 server 判定，客戶端不自己判斷
- 正式部署（區網 80 埠、防火牆、Docker、iTunes 相關環境變數）與玩法說明見根目錄 [README.md](../README.md)；本模組建置後由 server 以 `/song-guess/` 提供，不單獨部署

## 指令（建議在專案根目錄執行）

| 指令 | 說明 |
|------|------|
| `npm run dev` | 根目錄：同時啟動 server（:7180）與三款遊戲的 Vite。猜歌的 Vite 綁 **7182**（`strictPort`，被占用就直接失敗）；平常從遊戲清單 http://localhost/ 點進 `http://localhost/song-guess/`（我畫你猜的 Vite 在 :80 把 `/song-guess` 轉到 :7182，HMR 可用），`/socket.io` 由 Vite proxy 到 `localhost:7180` |
| `npm run build` | 根目錄：建置各遊戲的 `dist/`（含 `song-guess/dist/`）與 `server/dist/index.js` |
| `npm run typecheck -w @fishing-work/song-guess` | `tsc --noEmit`（app、`test/` 與 vite.config） |
| `npm test -w @fishing-work/song-guess` | Vitest：`test/` 下的純函式測試、靜態渲染，以及掛在假 DOM 上的流程測試（見下方「測試」） |
| `npm run lint -w @fishing-work/song-guess` | ESLint（flat config + typescript-eslint） |

沒有網路或不想打真的 iTunes 時，server 可指到假 iTunes（`node user/mock/itunes.mjs`，設 `ITUNES_URL`；見根目錄 README），客戶端不需要任何設定。

## 目錄結構

```
song-guess/
├── index.html              # 內嵌腳本：CSS 套用前先依 session 鍵設 data-theme（防閃爍）
├── vite.config.ts          # base /song-guess/、port 7182、proxy
├── src/
│   ├── App.tsx             # 三分支：遊戲畫面（殼層＋插槽）／自動重連畫面／首頁；<audio> 掛在殼層之外
│   ├── home/               # 首頁（不偽裝的紙張質感 UI）：暱稱＋風格卡片（只有「視訊會議」一張）
│   ├── socket/client.ts    # 連線、加入與重連憑證、出題動作（volunteer／setSource／cancel）、聊天
│   ├── store/game.ts       # me、players、round、chat、時鐘偏移、本首得分的基準
│   ├── features/
│   │   ├── player/         # 試聽播放器與音量（見「音訊播放」）
│   │   ├── round/          # 出題對話框、回合狀態列（各階段文字、倒數）、「出題」按鈕
│   │   ├── reveal/         # 每首揭曉卡、本局排名表
│   │   ├── stage/          # 舞台：依階段切換空畫面／準備中／播放視覺／揭曉卡／排名表
│   │   ├── chat/           # 聊天室（純文字，兼猜歌輸入）
│   │   ├── players/        # 玩家清單的列資料、本首得分（+N）的推導
│   │   └── help/           # 遊戲說明（六個主題，數字由 shared 常數推導）
│   ├── shells/             # 偽裝殼層：註冊表、共通介面（types、views）、meet/
│   ├── layout/             # 工具提示、狀態列式按鈕、連線狀態、介面偏好（uiStore）
│   └── styles/theme.css    # token：:root（基底）、meet、home；波形動畫 wave-bar
└── test/                   # Vitest（fakeDom.tsx：沒有 DOM 環境時掛元件用的假 DOM；fixtures.ts：假資料）
```

## 回合畫面

各階段舞台、回合狀態列與「出題」按鈕顯示什麼，逐列對照 [design.md](../spec/song-guess/design.md) §2；文字由純函式產生，測試逐列比對：

- `src/features/round/roundDisplay.ts`：`roundCaption`（回合狀態列：歌名字數提示「歌名 ＿ ＿ ＿（3 字） · 00:21」、自己猜對「你猜對了 +87」、「下一首 00:04」…）、`roundAnnouncement`（給報讀器的狀態變化，不含倒數）、`canVolunteer`。字數直接顯示 server 給的 `song.titleLength`（不含空白與標點），客戶端不自己算。
- `src/features/round/countdown.ts`：倒數＝`round.endsAt` −「校正後的現在」，clamp 到該階段長度（起播緩衝期間停在整首長度）。
- `src/features/player/clock.ts`：**時鐘偏移**。每次 `round:update`／快照都帶 `round.serverNow`，以 `serverNow − Date.now()` 估偏移（存在 store 的 `clockOffset`）；倒數與播放定位一律用 `Date.now() + clockOffset`，本機時鐘差幾秒不影響。
- `src/features/players/scoreDelta.ts`：server 不單獨告訴本人這首得幾分；播放中的「+N」＝本局得分（`gameScore`）減掉這首開始時的值，揭曉時改讀 `reveal.scores`。中途接管時若已經猜對，基準不明，只顯示「你猜對了」。
- `src/features/round/roundDisplay.ts` 另有播放中舞台的兩行字 `playingStageLines`（Epic 18）：第一行「{topic}{歌手模式且只抽熱門時「（熱門）」} · 第 n / 5 首」、第二行「歌手：{song.artist}」（歌手模式且與 topic 相同時省略；榜單與動漫熱門一律顯示，每首歌手不同）；殼層只負責排版。
- `src/features/reveal/revealView.ts`：舞台此刻顯示什麼（`stageMode`）、封面的 300px 版網址、猜對者列、排名列與標題（「本局結果 · {lastTopic}」：歌手正式名、「台灣熱門」「西洋熱門」或「動漫熱門」）。
- `src/features/round/SourceDialog.tsx`：出題對話框（Epic 18；Epic 19 加「動漫熱門」）。頂部四選一「歌手／台灣熱門／西洋熱門／動漫熱門」（`role="radiogroup"`，每次開都回到「歌手」；375px 等窄畫面以 CSS 換成兩列 2×2，DOM 與方向鍵順序不變，`meetLayout.segmentedGroupClass`）；歌手模式有欄位與「只抽熱門歌」勾選（預設勾，`hotPreference.ts` 記住上次），現成題庫（兩個榜單與動漫熱門，`roundDisplay.isPresetSource`）只有一行說明。送出 `round:setSource`（payload 由 `roundDisplay.sourcePayload` 組），ack 逾時放寬到 25 秒（榜單要打 RSS（12 秒）＋ lookup（8 秒）兩段；動漫熱門三次搜尋並行、各 8 秒）。歌手名以 shared 的 `validateArtist` 預檢；送出中按鈕改「搜尋中…」（歌手、動漫熱門）／「取得排行榜…」（榜單），輸入框是 `readOnly`＋`aria-busy`、四選一與勾選只設 `aria-disabled`，**不用原生 `disabled`**（焦點不會掉：歌手模式失敗後可直接改字再按 Enter，現成題庫焦點留在「分享」）；送出中仍可取消。切換來源後欄位不搶焦點（`DialogField.autoFocus`），方向鍵可連續切換。

## 音訊播放

**這款遊戲會出聲，玩的人要戴耳機。** 畫面上沒有播放器，只有控制列的音量。

- `src/features/player/AudioPlayer.tsx`：一個隱藏的 `<audio>`（`aria-hidden`、`preload="auto"`），由 `round.song` 驅動，掛在 `App`（殼層之外）。
  - 試聽檔由**各人的瀏覽器直接向 Apple 取**（`song.previewUrl`，約 1 MB）；server 只給網址與開始時間，不轉送音訊。客戶端**不呼叫 iTunes Search API**（歌手名交給 server 搜尋），也不對 `<audio>` 設 `type` 或依 MIME 判斷。同事的電腦若連不到 Apple 的 CDN 就聽不到（見下方「點一下開始播放」）。
  - 收到 playing 立刻設 `src` 預載；到 `song.startedAt`（進入 playing 後 `START_DELAY_MS` 的起播緩衝）才 `play()`，所有人同時起播。
  - 中途加入、重新整理、斷線重連：`currentTime =（校正後現在 − startedAt）÷ 1000` 再播；超過 `durationMs` 就不播，等揭曉。
  - 同一首的後續 `round:update`（有人猜對）不重新載入也不重新定位；緩衝後才出聲而位置落後時自動校正（每首有次數上限）。
  - reveal／ended／idle／choosing：`pause()` 並清掉 `src`。`<audio>` 自己的 `ended` 事件只停播，畫面仍等 server 的揭曉。
- `src/features/player/playback.ts`：上述判斷的純函式（`playbackPlan`：stop／wait／play／over；`seekTarget`；`songKey`），可單元測試。
- **「點一下開始播放」**：瀏覽器擋自動播放（`play()` 以 `NotAllowedError` 拒絕）或試聽載入失敗時，舞台中央的波形換成這顆按鈕；點了會在同一次點擊裡重新載入並播放，位置接上目前進度。加入遊戲時的點擊通常已滿足瀏覽器的互動條件，這是保險。
- `src/features/player/volume.ts`：音量 0～100、預設 60，是唯一的播放控制（沒有暫停、重播、快轉）。
- 實測觀察點：`audio[data-song-player]` 的 `data-audio-state`（`idle`／`waiting`／`playing`／`blocked`／`over`）與 `data-song-index`；舞台 `[data-stage]`、`[data-playback]`、`[data-wave]`。

## 本機偏好鍵

都在 `fishing-work:song-guess:` 命名空間，不與另兩款遊戲撞鍵（`test/shellBoundary.test.ts` 把關）：

| 鍵 | 存放 | 內容 |
|----|------|------|
| `fishing-work:song-guess:shell` | localStorage | 偽裝主題 id（目前只有 `meet`）；`index.html` 的內嵌腳本也讀它 |
| `fishing-work:song-guess:session` | sessionStorage（每個分頁各一份） | 重連憑證 `{ nickname, token }`；有憑證時啟動直接進殼層的自動重連畫面，不經首頁 |
| `fishing-work:song-guess:volume` | localStorage | 音量 0～100 |
| `fishing-work:song-guess:hot` | localStorage | 出題對話框「只抽熱門歌」上次的選擇（`'1'`／`'0'`；沒有或讀不到＝勾） |

## 偽裝殼層

外觀依根目錄 [DESIGN.md](../DESIGN.md) §14（首頁）、§15（視訊會議）與 [design.md](../spec/song-guess/design.md)。元件內不寫色碼，只用 `styles/theme.css` 的 token class；舞台 tile 內承載資訊的文字一律 `--fg`（DESIGN §15.1）。圖示為 inline SVG（不用 emoji、不引入圖示庫）。

**殼層與功能元件分離**：`App.tsx` 依 `uiStore.shellId` 從註冊表取殼層，把功能元件放進插槽；功能元件（`src/features/**`）不含任何偽裝字樣（「分享音訊」「通話中」…）、不 import 特定殼層，殼層不讀 store（`test/shellBoundary.test.ts` 掃描原始碼把關）。功能元件要在句子裡提到出題按鈕時，用殼層給的 `ShellViews.volunteer.label` 組句。

| 檔案 | 內容 |
|------|------|
| `src/shells/index.ts`／`catalog.ts` | 主題註冊表 `SHELLS`（目前只有 `meet`）與首頁卡片／「切換偽裝…」共用的清單；日後加主題在這裡多加一筆 |
| `src/shells/types.ts` | `ShellProps`：插槽 `players`、`stage`、`chat`、`roundStatus`、`volunteer`、`volume`、`connection`、`dialogs` ＋ `round`（phase、isSetter、setterName、songIndex、songCount、showLastResults）＋ `counts`、`themes`、`help` |
| `src/shells/views.ts` | `ShellViews`（全部必填）：`Dialog`（用途 `source`／`help`；`busy` 與選項的 `pending`；出題用的 `choices`（四選一）、`toggle`（勾選）、`description`（榜單與動漫熱門的說明））、`PlayerList`、`Stage`（空畫面／準備中／播放視覺）、`Volume`、`chat`、`status`、`volunteer`、`help` |
| `src/shells/meet/MeetShell.tsx` | 版面：主畫面 tile（舞台＋左上標籤＋字幕列＋對話框）｜參加者影片條｜「通話中的訊息」面板｜控制列（音量、分享音訊、更多、資訊…）；響應式斷點同 DESIGN §15.3，沒有工具列收合斷點 |
| `src/shells/meet/MeetStage.tsx` | 舞台的非結果畫面：「尚無人分享音訊」、「<出題者> 正在準備分享音訊…」、音訊波形（7 根直條，純 CSS、不讀真實音訊，`prefers-reduced-motion` 時不動）＋功能元件給的兩行字（「孫燕姿（熱門） · 第 n / 5 首」／「歌手：…」）；播放中不顯示歌名與封面 |
| `src/shells/meet/MeetVolume.tsx` | 控制列的喇叭圖示；滑鼠移上去或鍵盤聚焦時滑桿浮在圖示上方（不推擠控制列），點圖示可釘住，Esc 收起 |
| `src/shells/meet/MeetDialog.tsx`／`ParticipantTiles.tsx`／`MeetChat.tsx`／`MeetMoreMenu.tsx` | 白卡片對話框（出題「分享音訊」：segmented 四選一（窄時 2×2）、勾選、現成題庫說明；說明）、參加者 tile（出題者喇叭圖示＋外框、本首已猜對舉手圖示、總分膠囊）、聊天 renderer、「更多 ⋮」選單與切換偽裝 |
| `src/shells/meet/meetLayout.ts` | 純函式與文字：舞台標籤、舞台文字、「分享音訊」按鈕的四種樣子、對話框標題與按鈕文字、響應式斷點 |

## 測試

專案的 Vitest 沒有 DOM 環境（沒有 jsdom）。除了純函式與 `renderToStaticMarkup` 的靜態渲染，`test/fakeDom.tsx` 提供一個只有 React 掛元件會用到的假 DOM，讓元件真的掛載、狀態真的更新、effect 真的執行：

- `test/audioPlayer.test.tsx`：`<audio>` 以假節點代替（記錄 `src`、`currentTime`、`play`／`pause`／`load`），配合假時鐘驗起播緩衝、中途定位、時鐘偏移、被擋與重試、停播、換首。
- `test/phases.test.tsx`：store 設成各階段，比對舞台與回合狀態列實際出現的字；出題對話框的四選一、榜單模式、動漫熱門、送出中／失敗／取消流程與焦點、「只抽熱門歌」的 localStorage 讀寫。
- `test/busyFocus.test.tsx`、`test/dialogBusy.test.tsx`：送出中不用原生 `disabled`、失敗後焦點的位置。

真正的音訊解碼、緩衝、瀏覽器的自動播放政策與版面，仍以瀏覽器實測為準（驗收方式見 architecture §8）。
