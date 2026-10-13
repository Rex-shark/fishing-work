# draw-guess

fishing-work 的「我畫你猜」客戶端：React 19 + Vite 8 + TypeScript + Tailwind CSS v4 + Zustand，透過 Socket.IO 連 server 的 `/draw-guess` namespace。

- 架構與事件契約：[../spec/architecture.md](../spec/architecture.md)（§6 畫布模型、§7 客戶端結構）
- 事件型別與常數一律從 `@fishing-work/shared` 匯入，不在本模組另行宣告
- 正式部署（區網 80 埠、防火牆、常見問題）與玩法說明見根目錄 [README.md](../README.md)；本模組建置後由 server 以 `/draw-guess/` 提供，不單獨部署

## 指令（建議在專案根目錄執行）

| 指令 | 說明 |
|------|------|
| `npm run dev` | 根目錄：同時啟動 server（:7180）與 Vite（綁 **80 埠**、`strictPort`；開 http://localhost/draw-guess/，同事開 `http://<Rex IP>/draw-guess/`），`/socket.io` 由 Vite proxy 到 `localhost:7180`。80 被占用（例如正式版 `npm start` 在跑）會直接失敗，用 `lsof -nP -iTCP:80` 查 |
| `npm run build` | 根目錄：建置 `draw-guess/dist/` 與 `server/dist/index.js` |
| `npm run typecheck -w @fishing-work/draw-guess` | `tsc --noEmit`（app、`test/` 與 vite.config） |
| `npm test -w @fishing-work/draw-guess` | Vitest：`test/` 下的純函式測試（畫布渲染、輸入換算、store 筆跡正規化與聊天、倒數、聊天格式、得分差、殼層標題／假行號／尺寸、狀態列回合文字、玩家列） |
| `npm run lint -w @fishing-work/draw-guess` | ESLint（flat config + typescript-eslint） |

## 畫布（Phase 2）

- `src/features/canvas/render.ts`：純函式 `drawOp`（增量）／`redrawAll`（全量）／`compactOps`（歷史正規化），context 以最小介面注入，測試用假 context。
- `src/features/canvas/stroke.ts`：指標座標 → 0..1（clamp）、`move` 分批（≤ `MAX_POINTS_PER_MOVE`）、`strokeId`（有 `crypto.randomUUID` 就用，區網 http 非 secure context 時退回自產 id）。
- `Canvas.tsx` 直接訂閱 store：`opsVersion` 變了（快照、undo、clear、新回合）就全量重繪，否則只畫新追加的 op。

## 聊天與猜題（Phase 3）

- `src/features/chat/ChatPanel.tsx`：訊息列表（`chat` / `system` / `correct`，格式依 DESIGN.md §5）＋ `❯` 輸入列。Enter 送出、空白不送、送出中不鎖輸入框。
  - 捲動：在底部附近（24px 內）才自動跟隨新訊息；使用者往上捲就不拉回，自己送出訊息時跳回底部。
  - 送出失敗（`SPOILER_BLOCKED`、`RATE_LIMITED`、`MESSAGE_INVALID`、`NOT_IN_ROOM`、逾時、未連線）顯示 ack 的 `message` 於輸入列上方，4 秒後或再次輸入時清除；被擋的訊息不進列表，輸入框空著時放回原文。
  - 不做本地回顯：訊息以 server 廣播的 `chat:message` 為準（猜對時只廣播「X 猜對了」）。
- `src/features/chat/chatFormat.ts`：純函式（訊息片段、錯誤文字、placeholder、去重與截斷、捲動判斷）。本地最多保留 `CHAT_HISTORY × 2` 則。
- `src/features/players/scoreDelta.ts`：本回合得分 = 目前分數 − 進入 drawing 時的分數，用於「✓ 你猜對了 +N」與玩家清單的 `+N`（僅顯示，分數以 server 為準）。
- `src/features/round/countdown.ts`：倒數顯示值 clamp 到階段長度（出題 60、作畫 90、揭曉 5 秒），避免本機時鐘偏差造成剛開始顯示 01:01。

## 偽裝殼層（Epic 1 Phase 4 → Epic 3 起為多主題）

外觀依根目錄 [DESIGN.md](../DESIGN.md)。元件內不寫色碼，只用 `styles/theme.css` 的 token class；圖示為 `src/layout/icons.tsx` 的 inline SVG（不用 emoji、不引入圖示庫）。

**殼層與功能元件分離**（plan/camouflage-themes.md 決策 1、2）：`App.tsx` 依 `uiStore.shellId` 從註冊表取殼層，把功能元件放進插槽；功能元件（`src/features/**`）不含任何偽裝字樣與版面假設（`test/shellBoundary.test.ts` 掃描原始碼把關），需要依主題呈現的部分（對話框、玩家清單）由殼層以 `ShellViews` 提供。

| 檔案 | 內容 |
|------|------|
| `src/shells/index.ts` | 主題註冊表 `SHELLS`：`{ id, name, icon, Shell, titleFor, faviconHref }`；`resolveShellId`／`getShell` 未知值回退 `vscode`；`isRegisteredShellId`。已註冊 `vscode`、`ppt` |
| `src/shells/catalog.ts` | `THEME_CATALOG`：登入卡片與「切換偽裝…」共用的主題清單＝已註冊（`available: true`）＋ `PLANNED_THEMES` 中尚未註冊的（`available: false`，顯示「即將推出」）。主題註冊後自動變可選，卡片與選單不必改。殼層不得 import 本檔（會形成循環），改經 `ShellProps.themes` 取得 |
| `src/shells/themeIcons.tsx` | 卡片圖示（自繪、不用商標）：`CodeEditorIcon`（藍角括號，`text-brand-editor`）、`SlidesIcon`（橘紅投影片方塊，`text-brand-slides`）；顏色為跨主題 token `--brand-editor`／`--brand-slides`（DESIGN §13.4） |
| `src/shells/types.ts` | `ShellProps`：遊戲畫面插槽 `players`、`canvas`、`toolbar`、`chat`、`roundStatus`、`volunteer`、`connection`、`dialogs` ＋ `round`（phase、isDrawer、canDraw）＋ `counts`（`ShellPlayerCounts`：online、total，App 從 store 推導；殼層不得 import `store/game`，shellBoundary 把關）＋ `themes`（`ShellThemeSwitch`：current、options、select，供殼層的切換偽裝入口）；登入畫面 `login`、`connection` |
| `src/shells/views.ts` | `ShellViewsContext`：殼層提供給功能元件的呈現元件 `Dialog`（依用途 join／topic／cancelRound；`footer` 放登入的主題卡片列）與 `PlayerList`；選填 `chat`（`Line`／`Composer`／面板與列表 class）、`toolbar`（`compactBelowPx`）、`status`（`buttonClassName`）、`volunteer`（「我來畫」的 `label`／`icon`）。選填欄位省略時用 vscode 外觀（`shells/vscode/viewDefaults.ts`） |
| `src/shells/vscode/viewDefaults.ts` | vscode 的 `chat`（終端機）、`toolbar`（< 1100px 收合）、`status`（彩色狀態列白字）、`volunteer`（`▷ 我來畫`）；同時是 `views.ts` 的 `DEFAULT_*` |
| `src/shells/vscode/TerminalChat.tsx`／`terminalFormat.ts` | vscode 聊天 renderer：`[HH:mm]` 時間戳、`// ` system、`✓ ` 猜對、`❯` 輸入列 |
| `src/shells/ppt/PptShell.tsx` | ppt 主題（DESIGN §13）：標題列｜功能區（檔案＝切換偽裝、常用＝裝飾、繪圖＝畫師工具列）｜左縮圖窗格｜投影片｜備忘稿列｜右註解窗格｜狀態列（投影片 N / M 取自 `counts`；中央「▶ 從目前投影片開始」＝我來畫） |
| `src/shells/ppt/pptViews.ts` | ppt 的 `ShellViews`：`PptDialog`、`SlidePlayers`、註解卡片、淺灰狀態列深色字（`text-fg`、hover `--statusbar-hover`、focus `--border-focus`）、工具列 < 640px 收合、`volunteer`＝「從目前投影片開始」＋投影片放映圖示 |
| `src/shells/ppt/CommentChat.tsx`／`commentFormat.ts` | ppt 聊天 renderer：註解卡片（24px 圓形頭像＝暱稱首字（字素）、底色依暱稱 FNV-1a 雜湊取 `--avatar-1..6`；暱稱粗體、時間、內文；自己的卡 `--bg-active`）、system 灰字單行、correct 綠勾卡片、圖片卡片內縮圖（最寬 200px）；輸入列「新增註解…」＋送出鈕（`aria-disabled` 依 `canSend`） |
| `src/shells/ppt/PptDialog.tsx`／`SlidePlayers.tsx`／`FileMenu.tsx`／`pptLayout.ts`／`pptIcons.tsx` | Office 對話框、縮圖窗格玩家清單、「檔案」選單＋切換偽裝、版面純邏輯、自繪 Office 風格圖示 |
| `src/shells/document.ts` | 依主題同步 `<html data-theme>`、`document.title`（`titleFor`）、favicon（`faviconHref`） |
| `src/layout/uiStore.ts` | `shellId`：本機偏好，localStorage 鍵 `fishing-work:draw-guess:shell`（讀寫失敗、未知值回退 `vscode` 但不覆寫存檔）；`setShellId` 只在換成另一個已註冊主題時寫入；不監聽 `storage` 事件（分頁之間不同步）；`nicknameDraft`（換主題時保留輸入到一半的暱稱）；放棄確認開關 |
| `src/layout/ThemeCards.tsx` | 登入主題卡片列（DESIGN §13.4）：120×88、圖示 40px、選取 2px `--border-focus`；`role="radiogroup"`／`radio` ＋ `aria-checked`、roving tabindex；←／→ 移動即選取（略過即將推出）、Enter 加入；即將推出 `aria-disabled`、半透明、工具提示說明。共用於所有主題，不含偽裝字樣（shellBoundary 把關） |
| `src/layout/themeCardNav.ts` | 純函式：卡片鍵盤目標、roving tabindex、工具提示文字 |
| `src/shells/vscode/VscodeShell.tsx` | vscode 主題（原 `layout/IdeShell`）：分頁 `canvas.ts`（作畫中加 `●`）＋ 裝飾分頁 `README.md`、假行號 gutter、畫布插槽；分頁列右側為工具列插槽；登入畫面為空白編輯器浮水印＋暱稱輸入 |
| `src/shells/vscode/ShellFrame.tsx` | 外框：活動列（48px，第一個圖示切換側欄；遊戲中底部設定齒輪開「切換偽裝…」選單，其餘裝飾）｜側欄 EXPLORER（240px；1024–1279px 為 200px；< 1024px 改覆蓋層）｜編輯區＋底部 TERMINAL 面板（220px；< 768px 為 160px；帶 `data-chat-drop-zone`，整個面板是圖片投放區）｜狀態列。側欄與面板可拖曳分隔線或用方向鍵調整（最小 180／120px） |
| `src/shells/vscode/StatusBar.tsx` | 狀態列（22px、白字；自己是畫師且在出題／作畫中時改 `--bg-statusbar-drawer`）；右側 `Ln 12, Col 4  Spaces: 2  UTF-8  LF  TypeScript` 裝飾 |
| `src/shells/vscode/QuickInput.tsx` | 快速輸入框（仿命令面板）＝ vscode 的 `Dialog`（`VscodeDialog`：選項前綴 `› `、提示 `// `）。Enter 執行反白選項（form 隱式送出，輸入法選字不觸發）、↑↓ 切換、Esc 關閉 |
| `src/shells/vscode/ManageMenu.tsx` | 切換偽裝入口（決策 7）：設定齒輪 `ManageButton`（`aria-haspopup="menu"`）→ 選單「切換偽裝…」（portal 到 body；↑↓、Esc 回齒輪、點外關閉）→ `ThemeQuickPick` 快速選單（目前主題標「目前使用」、未上線標「即將推出」不可選；選取即切換 `shellId`） |
| `src/shells/vscode/themePick.ts` | 純函式：快速選單選項、初始反白、`chooseTheme`（未上線／目前主題不呼叫 select）、選單鍵盤 |
| `src/shells/vscode/ExplorerPlayers.tsx` | vscode 的 `PlayerList` 呈現：檔案樹 `FISHING-WORK › players › <暱稱>.ts`；列右側 `+N`、畫師 `●`、已猜對 `✓`、分數；自己粗體、斷線中淡化斜體；方向鍵可在列間移動 |
| `src/shells/vscode/EditorTabs.tsx` | 分頁列、分頁（`×` hover 才顯示、dirty 顯示 `●`）、假行號 |
| `src/shells/vscode/ideLayout.ts` | 純函式：視窗標題、狀態列色調、玩家檔名 `<暱稱>.ts`、假行號行數、側欄／面板尺寸 clamp |
| `src/layout/StatusItem.tsx` | 狀態列式的一行項目 `StatusItem`／`StatusButton`（功能元件與殼層共用） |
| `src/features/players/PlayerList.tsx` | 玩家清單的列資料（自己、本回合 `+N`），交給殼層的 `PlayerList` 呈現 |
| `src/features/round/RoundStatus.tsx` | 「▷ 我來畫」（idle 且在線 ≥ 2 人才顯示；文字與圖示取自 `ShellViews.volunteer`）、階段與倒數（最後 10 秒加警示圖示）、題目提示／題目、猜對進度、「✓ 你猜對了 +N」 |
| `src/features/round/CancelConfirm.tsx` | 畫師按「放棄」後的確認對話框（殼層 `Dialog`，取代 `window.confirm`） |
| `src/features/lobby/NicknameScreen.tsx` | 暱稱輸入（殼層 `Dialog`，放在登入畫面的 `login` 插槽）；對話框 `footer` 為主題卡片列 |
| `src/features/canvas/canvasBackground.ts` | 畫布底色：啟動時把 shared 的 `CANVAS_BACKGROUND`（#1E1E1E）注入根節點 `--bg-canvas`，不是主題 token、所有主題一致 |

## 畫具強化（Phase 6）

| 檔案 | 內容 |
|------|------|
| `src/features/canvas/ToolBar.tsx` | 畫師工具列：預設色塊（`PALETTE`）、目前顏色圓點、色相條、粗細滑桿（`BRUSH_MIN`..`BRUSH_MAX`，預設 `BRUSH_DEFAULT`）、橡皮擦、復原、清空、放棄；選色即切回畫筆。寬度小於殼層斷點（`ShellViews.toolbar.compactBelowPx`：vscode 1100、ppt 640）時色相與粗細收進「⋯」面板（portal 到 body，外點／Esc／視窗縮放關閉）；按下狀態與選中色塊外框用 `--fg-on-active` |
| `src/features/canvas/Slider.tsx` | 共用滑桿（`role="slider"`）：拖曳、點軌道、←→ 步進 1、Shift／PageUp／PageDown 大步進、Home／End |
| `src/features/canvas/brush.ts` | 純函式：`hueToHex`（hsl(h,100%,50%) → 大寫 `#RRGGBB`）、指標／鍵盤值計算、送出前的色碼與粗細整理、預覽圓點尺寸上限、色塊標籤 |
| `src/layout/Tooltip.tsx` | 全域 `<TooltipLayer/>`：以 `data-tooltip` 標記的元素懸停 300ms 或鍵盤 focus 即顯示；離開、blur、Esc、點擊（滑桿除外）隱藏；portal 到 body |
| `src/layout/tooltipPlacement.ts` | 純函式：提示位置（預設下方、活動列在右側、空間不足翻到上方並保持在視窗內） |
