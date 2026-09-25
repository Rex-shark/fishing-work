# Epic 3：多偽裝主題（登入卡片選主題；新增 PPT 主題）

> 同一個遊戲、多套偽裝外皮：登入畫面用卡片選主題，第一個新主題是 PowerPoint

**狀態**：✅（2026-09-25 完成：舵手瀏覽器實測＋Rex 目視「目前沒問題」。Phase 1 殼層抽象龍骨驗收通過：typecheck／test 79＋375＋290／build／lint 皆 0，11 張 vscode 截圖改前改後**位元組完全相同**；舵手驗收通過；Phase 2 龍骨驗收通過（typecheck／test 79＋375＋327／build／lint 皆 0，遊戲中截圖 02–11 與基準位元組相同），舵手驗收通過；Phase 3：A（PPT 殼層、token、對話框、檔案選單、註冊 ppt）與 B（聊天 renderer／工具列斷點／狀態列樣式抽象）✅，合併後 typecheck／test 79＋375＋440／build／lint 皆 0；收尾 C（PPT 註解卡片、狀態列、我來畫文字、`--fg-on-active`、counts 注入）✅，typecheck／test 79＋375＋479／build／lint 皆 0；補件後 79＋375＋480；舵手驗收與 Rex 目視通過）
**起訖**：2026-09-25 ~ 2026-09-25
**負責**：Rex × 舵手（Helm，規格與計畫）× 龍骨（Keel，派工與驗收）

---

## 需求（Rex 2026-09-25）

1. 登入畫面除了自訂 ID（暱稱），還有**各種 UI 卡片**，卡片圖示就是偽裝主題。
2. 新增一個主題：**PPT**（PowerPoint）。

## 設計決策

- 決策 1：**殼層（shell）與功能元件分離**。功能元件（`Canvas`、`ToolBar`、`ChatPanel`、`PlayerList`、`RoundStatus`、`NicknameScreen` 的輸入邏輯）不知道自己被放在哪種偽裝裡；每個主題是一個 `Shell` 元件，只負責版面、標籤、裝飾與把功能元件放進插槽。原因：新主題只寫版面，不重寫遊戲邏輯。
- 決策 2：**主題註冊表** `shells/index.ts`：`{ id, name, icon, Shell, titleFor(state), faviconHref }`；`id` 目前為 `'vscode'` 與 `'ppt'`。原因：登入卡片與切換都從同一份清單產生。
- 決策 3：**主題是每位玩家自己的本機偏好**，存 `localStorage`（`fishing-work:draw-guess:shell`），不進 server、不同步給別人。原因：每個同事的螢幕與辦公室環境不同，偽裝要各自選；契約完全不變。
- 決策 4：**主題以 `data-theme` 切換 CSS 變數**：`theme.css` 的 `:root` 為 vscode 值；`[data-theme="ppt"]` 覆寫同名 token。Tailwind class 名稱（`bg-editor`、`text-fg`…）不變，語意對應到各主題的相對區塊。原因：不動既有元件的 class，只加一組覆寫。
- 決策 5：**PPT 主題是淺色**（PowerPoint 就是白底），與 Epic 1 的「整體黑色」不同；黑色要求屬 VS Code 主題。原因：偽裝逼真優先。
- 決策 6：**畫布底色與預設筆色不隨主題**：底色固定 shared 常數 `CANVAS_BACKGROUND`（`#1E1E1E`），預設筆 `PALETTE[0]` 白，所有主題與所有玩家一致；PPT 的投影片就是一張深色投影片。原因（Rex 2026-09-25）：畫布是共享畫面，每個人 UI 不同，畫師白筆在別人的白底上會看不見。原擬「PALETTE 加黑、依主題預設色」撤回。
- 決策 7：**登入畫面**：暱稱輸入在上，下方一列主題卡片（圖示＋名稱），點卡片立即套用主題預覽整個登入畫面；Enter 以目前選取的主題加入。進遊戲後每個殼層提供一個低調的「切換偽裝」入口（vscode：活動列底部設定齒輪選單；ppt：「檔案」分頁選單）。原因：Rex 指定卡片；進遊戲後仍能換。 **（2026-09-25 Rex 需求修正，Epic 4 [home-page.md](home-page.md)：登入改為獨立的柔和 UI 首頁，「點卡片即時預覽整個登入畫面」與殼層登入畫面作廢；遊戲中的切換入口保留）**
- 決策 8：**圖示自繪通用版**（程式碼括號、投影片方塊），用各家品牌的相近色但不用商標。原因：避免直接複製 VS Code／Microsoft 標誌。
- 決策 9：**字型隨主題**：vscode 等寬；ppt 用系統無襯線（`system-ui, "Segoe UI", "Microsoft JhengHei", "PingFang TC", sans-serif`）。原因：PowerPoint 不是等寬字。
- 決策 10：DESIGN.md 改為「共通原則 ＋ 各主題章節」：現有 §3–§8 標為 vscode 主題；新增 §13「PPT 主題」（token、版面對照、元件差異）。共通的可及性、動態、驗收清單不變。

## PPT 主題版面對照（寫入 DESIGN §13）

| PowerPoint 元素 | 實際內容 |
|-----------------|---------|
| 標題列（橘紅 `--bg-titlebar`，白字）「簡報1 - PowerPoint」 | 視窗標題；右側小字為連線狀態 |
| 功能區分頁：檔案 常用 插入 設計 轉場 動畫 投影片放映 校閱 檢視 **繪圖** 說明 | 裝飾；畫師時「繪圖」為作用分頁，內含畫師工具列（筆色塊、色相條、粗細滑桿、橡皮擦、復原、清空、放棄），非畫師時工具列灰化 |
| 左側縮圖窗格 | 玩家清單：每人一張編號縮圖（暱稱為投影片標題、分數為小字）；畫師縮圖橘色外框；已猜對綠勾；斷線中淡化 |
| 中央投影片（16:9，灰色工作區） | 畫布：**底色固定 `CANVAS_BACKGROUND` 黑**（深色設計的投影片，PowerPoint 常見）；1px `--border` 外框已是投影片邊緣 |
| 右側「註解」窗格 | 聊天室：每則為註解卡片（圓形頭像取暱稱首字、暱稱、時間、內文）；system 為灰字單行；correct 為綠勾卡片；圖片訊息為卡片內縮圖；底部「新增註解…」輸入框 |
| 底部「備忘稿」列 | 回合狀態一行：階段、倒數、題目／字數提示、本回合分數 |
| 狀態列（淺灰） | 左：「投影片 N / M」（N＝在線人數、M＝房間人數上限或玩家數，裝飾）、「中文(台灣)」、「備忘稿」；中：**「▶ 從目前投影片開始」＝我來畫**（人數不足時灰化並顯示「等待其他人加入（1/2）」）；右：「顯示設定」、縮放「62%」 |
| 暱稱／出題／放棄確認 | PowerPoint 風格對話框（白底、標題列、「確定」「取消」按鈕），取代快速輸入框 |
| 視窗標題 | 「簡報1 - PowerPoint」；作畫中前綴「● 」與 vscode 一致 |

---

## 任務清單

### Phase 1：殼層抽象（不改外觀）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | `shared`：新增 `CANVAS_BACKGROUND = '#1E1E1E'`；client 的畫布底色改由此常數注入（不再讀主題 token）；`PALETTE` 不變 | 決策 6；server 無影響 |
| ✅ | 抽出 `shells/index.ts` 註冊表與 `ShellProps`（插槽：players、canvas、toolbar、chat、roundStatus、dialogs）；現有 `IdeShell` 改為 `shells/vscode/VscodeShell.tsx`，功能元件不含任何 VS Code 字樣與版面假設 | 決策 1、2 |
| ✅ | `layout/uiStore.ts` 加 `shellId`（localStorage 讀寫，預設 `vscode`）；`<html data-theme>` 隨之切換；`document.title` 與 favicon 由 `titleFor`／`faviconHref` 決定 | 決策 3、4 |
| ✅ | 驗證：vscode 主題畫面與 Epic 1 Phase 6 完全一致（截圖比對）；typecheck／test／lint／build 0 | 重構不改外觀 |

### Phase 2：登入卡片與切換入口

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | `NicknameScreen`：暱稱輸入下方加主題卡片列（`ThemeCard`：圖示 40px、名稱、選取外框 `--border-focus`），點卡片即時切換整個登入畫面的主題；鍵盤 ←/→ 可選；卡片有工具提示 | 決策 7、8 |
| ✅ | 自繪兩個 SVG 圖示：程式編輯器（藍、角括號）、簡報（橘紅、投影片方塊）；註冊表 icon 由 Phase 1 暫用的 FilesIcon 換成自繪 | 決策 8 |
| ✅ | 進遊戲後的切換入口：vscode 設定齒輪選單「切換偽裝…」開快速選單列出主題；ppt「檔案」分頁選單同功能 | 決策 7。2026-09-25 龍骨：ppt「檔案」選單依賴 PptShell，移到 Phase 3 做；Phase 2 只做 vscode 齒輪入口 |
| ✅ | 驗證：選 ppt 加入 → 重新整理仍是 ppt；兩個分頁各選不同主題互不影響 | 2026-09-25 龍骨：ppt 在 Phase 3 才註冊，Phase 2 卡片列顯示 ppt 為「即將推出」（不可選）；「選 ppt 重新整理仍是 ppt」移到 Phase 3 驗；Phase 2 驗 vscode 選取保留、localStorage 預存 ppt 時不覆寫、兩分頁互不影響 |

### Phase 3：PPT 主題

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | `theme.css` 加 `[data-theme="ppt"]` token 覆寫（DESIGN §13 表）；字型改無襯線 | 決策 4、9 |
| ✅ | `shells/ppt/PptShell.tsx`：標題列、功能區分頁、左縮圖窗格、中央投影片、右註解窗格、底部備忘稿列、狀態列，依對照表放入插槽 | 版面對照 |
| ✅ | PPT 風格對話框元件（暱稱、出題、放棄確認）取代快速輸入框 | 只在 ppt 主題使用 |
| ✅ | 聊天訊息在 ppt 的卡片渲染（頭像首字、system 灰字、correct 綠勾、圖片縮圖） | 功能元件不變，殼層提供 renderer。**Phase 1 遺留的終端機偽裝要在此抽象**：system 的 `// ` 前綴、`❯` 提示符、`[HH:mm]` 時間戳改由殼層 renderer 決定；ToolBar 的 < 1100px 收合斷點改由殼層提供；StatusItem／StatusButton 改用殼層給的 token |
| ✅ | 對比檢查：淺色底所有承載資訊的文字 ≥ 4.5:1 | DESIGN §9 |
| ✅ | 驗證：舵手瀏覽器實測整回合（ppt 畫師、vscode 猜題者混用）；Rex 目視 | 2026-09-25 龍骨驗收：子代理 headless 混玩兩輪（ppt 畫師 × vscode 猜題者 × ppt 猜題者，含傳圖、洩題被擋、猜對、揭曉）通過；vscode 02–11＋登入與基準位元組相同。舵手瀏覽器實測通過（PPT 猜題者 × vscode 畫師整回合）；補件（龍骨自改）：PPT 註解輸入框上方 12px `--fg-muted` 功能提示（`aria-describedby` 關聯，placeholder 維持「新增註解…」）、等待文字統一「等待其他玩家加入（n/2）」，typecheck／test 79＋375＋480／build／lint 皆 0、瀏覽器確認畫師「聊天（不可說出答案）」猜題者「輸入答案或聊天」。2026-09-25 Rex 目視「目前沒問題」，無微調 |

---

## 驗收標準

- [x] `npm run typecheck`、`npm test`、`npm run build`、`npm run lint` 各自 exit 0
- [x] 登入畫面有主題卡片，點選即預覽，Enter 以該主題加入；選擇存本機，重新整理保留
- [x] vscode 主題外觀與 Epic 1 完成時一致
- [x] ppt 主題第一眼像 PowerPoint（Rex 目視）；畫布為黑色投影片、預設白筆（與 vscode 完全相同的畫面）；聊天在註解窗格；「從目前投影片開始」能開局
- [x] 兩種主題的玩家同房互玩一回合無異常（契約未變）
- [x] `spec/architecture.md` §7 與 `DESIGN.md` §13 與實作一致

---

## 踩雷紀錄

### Phase 1（2026-09-25，龍骨驗收）

- **截圖要可重現才能做「外觀不變」驗收**：同一 server 連跑會撞 NICKNAME_TAKEN（寬限期），每次用全新 server；猜對分數隨時間遞減，要固定猜題時間點；畫筆 rAF 批次邊界影響反鋸齒，要固定每點間隔；文字游標以 `caret-color: transparent` 隱藏；倒數與時間戳在截圖前改成 `00:00`。基準圖連跑兩次 0 差異才算可用。工具在 scratchpad `epic3/`（`shots.mjs`、`run.sh`、`compare.mjs`，headless Chrome + CDP，不需套件）。
- **Vitest 裡 `.css?raw` 會變空字串**：要讀 CSS 原始碼改用動態 `import('node:fs')`（app tsconfig 不含 Node 型別）。
- **Node 25 全域 `localStorage` 存在但 `getItem` 不是函式**（沒給 `--localstorage-file` 時），取用還會印警告；uiStore 只取 `window.localStorage` 並全程 try/catch。
- **react-hooks v7 禁止在 effect 裡同步 setState**：投放區元素改用 callback ref 存進 state 再推導。
- **macOS 檔名大小寫又一次**：`VscodeShell.tsx` 旁的純邏輯檔取名 `ideLayout.ts`，不用 `vscodeShell.ts`。
- **畫布底色改由 JS 以 inline style 注入 `<html>` 的 `--bg-canvas`**：任何主題樣式表都蓋不過，確保所有主題畫布一致。

### Phase 2（2026-09-25，龍骨驗收）

- **殼層不得 import uiStore／catalog**：uiStore／catalog → 註冊表 → 殼層，殼層若反向 import 會形成循環，模組初始化順序一不對就 TDZ 崩潰；主題資料一律由 App 經 `ShellProps.themes` 注入，`shellBoundary` 測試把關。
- **原生 `disabled` 按鈕收不到指標事件、Tooltip 出不來**：不可選的卡片只設 `aria-disabled`。
- **換主題會讓整個殼層重新掛載**：輸入到一半的暱稱存 `uiStore.nicknameDraft`，鍵盤換主題後把焦點放回選取中的卡片。
- **tsconfig lib 為 ES2022，沒有 `findLastIndex`**。
- **react-refresh 規則：.tsx 不能同時匯出元件與非元件**：純函式搬到獨立 .ts。
- **CDP 模擬 Enter 要帶 `text: '\r'`**，否則只有 keydown、不會觸發按鈕原生啟動。
- **截圖偶發差異要重跑判定**：11-drag-overlay 第 1 輪出現 21 像素偶發差異，第 2、3 輪 0；以多輪結果判定。

### Phase 3（2026-09-25，龍骨驗收）

- **新增主題會打破把該 id 當「未註冊範例」的舊測試**：註冊 ppt 時 4 檔 13 案失敗；「未註冊值」測試範例請用不存在的 id（如 `'keynote'`）。
- **並行子代理共用 build 產物**：B 的截圖會混進 A 當下的狀態；B 改用 scratchpad 隔離副本（自己的 src＋A 的原始檔）建置來證明外觀不變。並行時兩邊的 build 與截圖要各自隔離。
- **`@theme inline` 讓 utility 在使用位置才解析 `var(--token)`**：可用 CSS 變數作用域就地覆寫配色（A 的暫時解法），但正式做法應是 token（`--fg-on-active`）或殼層 view；暫時解法已於 C 移除。
- **views.ts 執行期 import 預設值時，預設值檔對 views 只能 `import type`**，否則循環 TDZ。
- **`useSyncExternalStore` 沒給 getServerSnapshot 時 `renderToStaticMarkup` 直接拋錯**：用到 `useMediaQuery` 的殼層只能測子元件與純邏輯，殼層本身靠瀏覽器驗證。
- **React 19 SSR 會在含 `<img>` 的輸出前插 `<link rel="preload">`**：測試不能以 `^<li` 錨定開頭。
- **shellBoundary 掃描也掃註解**：功能元件註解寫「vscode 白」、PPT 測試註解寫色碼都會失敗，註解也要用主題中性說法、不寫色碼。
- **窄窗格縮圖只加 max-width 會留白邊**：inline height 還在，要再加 `h-auto`。
- **Tailwind v4 沒有 `aria-invalid:` 變體**，寫 `aria-[invalid=true]:`。
- **頭像首字要以字素取**：`Intl.Segmenter` 取 👍🏽、🇹🇼、👨‍👩‍👧 完整字素，無 Segmenter 時退回 code point。
