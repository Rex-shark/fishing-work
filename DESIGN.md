# DESIGN.md — 視覺設計指南

> 目的：讓「我畫你猜」在上班時間打開也像在用程式編輯器。**做任何畫面、元件、樣式之前先讀本檔。**
> 基底：**VS Code Dark+**。2026-09-24 Rex 授權舵手（Helm）決定，Rex 看成品後微調（微調記錄在第 12 節）。
> 2026-09-25 起為**多偽裝主題**：§1、§2、§6–§11 為共通原則；§3–§5 是 `vscode` 主題；§13 是 `ppt` 主題。新主題各加一節。
> 2026-09-25 Rex 需求修正：進遊戲前的**首頁不偽裝、採柔和 UI**（§14），在首頁以卡片選風格後才進偽裝殼層。
> 2026-09-25 第三套主題 `meet`（Google Meet 視訊會議）見 §15。
> 遊戲常數（畫筆色 PALETTE、粗細、邏輯畫布尺寸）以 [spec/architecture.md](spec/architecture.md) §4 為準，本檔不重複定義。

---

## 1. 設計原則

1. **偽裝優先**：每個元素先問「這在編輯器裡會長什麼樣」。沒有對應物的元素，做成編輯器裡看得到的東西：側欄、面板、狀態列項目、快速輸入框。
2. **低調**：深色、低飽和、無大面積亮色、無彈跳動畫、無音效、無彩帶。猜對了也只是終端機多一行綠字。
3. **資訊密度像 IDE**：13px 等寬字、緊湊行高、2px 圓角、1px 細邊框。
4. **文字**：介面文字繁體中文（台灣用語）；偽裝用標籤（分頁名、面板名、狀態列右側）用英文以求逼真。
5. **圖示**：SVG 線條圖示（Lucide 或 Codicons 風格，1.5px 線寬；活動列 24px，其餘 16px），**不用 emoji**。
6. **首頁例外**：未加入前的首頁不偽裝，採柔和 UI（§14）；偽裝從進入殼層開始。§1 第 1–3 條與 §7 不適用於首頁。

## 2. 偽裝深度（定案：第 2 級）

| 級別 | 內容 | 本專案 |
|------|------|--------|
| 1 | 只是深色主題 | — |
| 2 | 完整 IDE 殼層＋逼真標籤＋假行號＋分頁式視窗標題＋裝飾性假檔案（`src/`、`README.md`、`package.json`、`tsconfig.json`）、活動列帳號與設定圖示、空編輯區快捷鍵浮水印、可拖曳調整的側欄與面板 | ✅ 採用（Phase 4 實作） |
| 3 | 假程式碼內容、老闆鍵、假通知 | 日後視 Rex 反饋 |

## 3. 色彩 token

放在 `draw-guess/src/styles/theme.css` 的 `:root`，**元件內不得寫死色碼**。

### 背景

| token | 值 | 用途 |
|-------|----|------|
| `--bg-activity` | `#333333` | 最左活動列 |
| `--bg-sidebar` | `#252526` | 側欄（EXPLORER） |
| `--bg-editor` | `#1e1e1e` | 編輯區、底部面板 |
| `--bg-canvas` | `#1e1e1e`（＝`CANVAS_BACKGROUND`） | 畫布底色。**不是主題 token：不寫在 theme.css，由 main.tsx 啟動時以 inline style 把 shared 的 `CANVAS_BACKGROUND` 注入 `<html>`，所有主題一致**（畫布是共享畫面，Rex 2026-09-25 定案統一黑底、預設白筆）；畫布加 1px `--border` 外框（用 `outline`，不用 `border`：border-box 下 border 會吃掉內容區使 1280×720 微幅變形，且 getBoundingClientRect 含邊框會讓指標座標偏 1px）讓畫師看得到可畫範圍。要改純黑改該常數 |
| `--bg-tab-active` | `#1e1e1e` | 作用中分頁 |
| `--bg-tab-inactive` | `#2d2d2d` | 非作用分頁 |
| `--bg-titlebar` | `#3c3c3c` | 分頁列底、面板標題列 |
| `--bg-input` | `#3c3c3c` | 輸入框 |
| `--bg-quickinput` | `#252526` | 快速輸入框（暱稱、出題） |
| `--bg-statusbar` | `#007acc` | 狀態列（一般） |
| `--bg-statusbar-drawer` | `#b5561f` | 狀態列（**自己是畫師且 phase ∈ {choosing, drawing}**，仿 VS Code 除錯中的橘色；ended 恢復藍）。原 `#cc6633` 白字對比 3.81:1 不達 §9，改深一階為 4.87:1 |
| `--bg-hover` | `#2a2d2e` | 清單、樹狀列 hover |
| `--bg-active` | `#094771` | 清單選取 |
| `--bg-selection` | `#264f78` | 文字選取 |

### 邊框與前景

| token | 值 | 用途 |
|-------|----|------|
| `--border` | `#3c3c3c` | 所有分隔線 |
| `--border-focus` | `#007fd4` | focus 外框 |
| `--fg` | `#cccccc` | 側欄、面板、一般 UI 文字 |
| `--fg-editor` | `#d4d4d4` | 編輯區文字 |
| `--fg-muted` | `#858585` | 行號、非作用分頁、placeholder |
| `--fg-dim` | `#6e7681` | 時間戳、次要裝飾 |
| `--fg-statusbar` | `#ffffff` | 狀態列文字 |
| `--fg-link` | `#3794ff` | 連結 |
| `--accent` | `#0e639c` | 主要按鈕 |
| `--accent-hover` | `#1177bb` | 主要按鈕 hover |
| `--bg-button-secondary` | `#3a3d41` | 次要按鈕 |
| `--bg-button-secondary-hover` | `#45494e` | 次要按鈕 hover |
| `--scrollbar-thumb` | `rgba(121, 121, 121, 0.4)` | 捲軸 |
| `--statusbar-hover` | `rgba(255, 255, 255, 0.2)` | 狀態列項目 hover 疊底（藍／橘底上沒有其他可用 token） |
| `--focus-on-color` | `#ffffff` | 藍／橘等有色底上的 focus 外框（`--border-focus` 在其上看不見） |
| `--quickinput-shadow` | `0 2px 8px rgba(0, 0, 0, 0.36)` | 快速輸入框陰影（§4 的唯一陰影） |
| `--bg-slide` | `#1e1e1e` | 投影片框底（Epic 3；vscode 與畫布同色，ppt 覆寫為白） |
| `--bg-panel` | `#252526` | 「面板」token 六件組（Epic 5）：殼層自畫的白底面板（meet 的訊息面板）用；vscode／ppt 給等於側欄的值，不使用 |
| `--bg-panel-hover` | `#2a2d2e` | 面板內 hover |
| `--fg-on-panel` | `#cccccc` | 面板文字 |
| `--fg-on-panel-muted` | `#858585` | 面板次要文字 |
| `--border-panel` | `#3c3c3c` | 面板邊框與分隔線 |
| `--accent-panel` | `#3794ff` | 面板上的強調色（文字按鈕、連結） |
| `--slide-shadow` | `none` | 投影片陰影（ppt 覆寫） |
| `--fg-on-active` | `#ffffff` | 選取／按下底（`--bg-active`）上的文字與勾選記號（ppt 覆寫為深字） |

### 語意色（取自 Dark+ 語法色，讓聊天室看起來像程式輸出）

| token | 值 | 用途 |
|-------|----|------|
| `--sem-comment` | `#6a9955` | 系統訊息（顯示為 `// ...`） |
| `--sem-variable` | `#9cdcfe` | 玩家暱稱 |
| `--sem-function` | `#dcdcaa` | 畫師標記、題目字數提示 |
| `--sem-type` | `#4ec9b0` | 猜對訊息、終端機提示符 `❯` |
| `--sem-number` | `#b5cea8` | 分數、倒數 |
| `--sem-string` | `#ce9178` | 揭曉的題目 |
| `--sem-keyword` | `#569cd6` | 「我來畫」等可操作項 |
| `--sem-error` | `#f44747` | 錯誤、被擋的洩題 |
| `--sem-warning` | `#cca700` | 倒數最後 10 秒（只用在深色底上） |

## 4. 字型與尺寸

- **字型**：`ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", "Noto Sans Mono CJK TC", monospace`。不下載網路字型（區網離線可用）；日後若要 JetBrains Mono 以本機檔案引入。
- **字級**：基準 13px；側欄標題 11px 大寫（letter-spacing 0.5px）；狀態列 12px；快速輸入框 13px。**沒有標題字級**，IDE 裡沒有大標。
- **行高**：聊天室 18px（終端機感）；樹狀列 22px。
- **間距**：4px 網格。內距 4 / 8 / 12。
- **圓角**：輸入框、按鈕 2px；快速輸入框 3px；面板、分頁 0。
- **陰影**：只有浮出層有陰影，共用 `--quickinput-shadow`（`0 2px 8px rgba(0, 0, 0, 0.36)`）：快速輸入框、工具列「⋯」面板、工具提示。

## 5. 版面：IDE 殼層（`layout/IdeShell.tsx`）

```
┌────┬──────────────────┬──────────────────────────────────────────┐
│ A  │ EXPLORER         │ canvas.ts ●   README.md              ⋯   │ ← 分頁列 35px；右側為畫師工具列
│ c  │ ▾ FISHING-WORK   │  1 │                                      │
│ t  │   ▾ players      │  2 │     [畫布 16:9，置中，等比縮放，     │
│ i  │     rex.ts     ● │  3 │      四周留 16px]                    │ ← 假行號 gutter 40px
│ v  │     amy.ts   120 │  4 │                                      │
│    │     ben.ts  ✓ 87 │ …  │                                      │
│    │                  ├──────────────────────────────────────────┤
│    │                  │ PROBLEMS   OUTPUT   TERMINAL        ⌃ ×  │ ← 面板標題 35px
│    │                  │ // rex 加入了                            │
│    │                  │ amy: 是狗嗎                              │
│    │                  │ ✓ ben 猜對了                             │
│    │                  │ ❯ █                                      │ ← 輸入列
├────┴──────────────────┴──────────────────────────────────────────┤
│ ⎇ main  ⟳ 已連線  ▷ 我來畫        作畫中 01:23    Ln 12, Col 4  UTF-8  LF  TypeScript │ ← 狀態列 22px
└──────────────────────────────────────────────────────────────────┘
```

| 區塊 | 尺寸 | 內容與偽裝 |
|------|------|-----------|
| 活動列 | 寬 48px | 4 個圖示（檔案、搜尋、原始碼控制、擴充）；只有第一個作用中；點第一個切換側欄顯示。其餘為裝飾，點了無反應 |
| 側欄 | 寬 240px（min 180，可摺疊） | 標題 `EXPLORER`；樹：`FISHING-WORK` › `players` › 每位玩家一列 `<暱稱>.ts` 帶檔案圖示。列右側：分數（`--sem-number`）；畫師 = 橘點 `●`（`--sem-function`，仿 git 修改標記）；已猜對 = `✓`（`--sem-type`）。自己那列粗體 |
| 分頁列 | 高 35px | 作用中 `canvas.ts`（作畫中時檔名後加 `●` 取代 `×`，仿未儲存；視窗標題則為前綴 `● `）；非作用 `README.md` 裝飾。右側：**畫師工具列**（僅畫師可見）：**目前顏色鈕**（22×22 圖示按鈕，內為 14px 目前色圓點；點擊開啟「顏色面板」，Epic 11）、10 個 16px 預設色塊（`PALETTE`）、**粗細滑桿**（寬 80px 的細軌道，拖曳左右，把手旁顯示數值，`1–64`）、背景色／橡皮擦（再按一次切回畫筆）／復原／清空／放棄圖示按鈕；沒有獨立的「畫筆」鈕。選色即回畫筆。工具列寬度不足時（斷點見 §8）滑桿收進「⋯」彈出面板。（2026-10-03 前：色相條直接放在工具列上，Epic 11 移除） |
| 假行號 gutter | 寬 40px | `1..N` 依編輯區高度 / 18px 產生，`--fg-muted`，右對齊，純裝飾 |
| 畫布區 | 剩餘 | 底 `--bg-editor`；畫布 16:9 置中等比縮放，底 `--bg-canvas`；畫師游標 `crosshair`，其他人 `default` |
| 底部面板 | 高 220px（min 120） | 標題列分頁 `PROBLEMS / OUTPUT / TERMINAL`，TERMINAL 作用中，其餘裝飾；本體 = 聊天室；最後一列為輸入列 |
| 狀態列 | 高 22px | 左：`⎇ main`、連線狀態（`⟳ 已連線` / `⚠ 重新連線中`）、**`▷ 我來畫`**（idle 且人數足夠時顯示，仿執行按鈕；人數不足時隱藏並顯示 `等待其他玩家加入（1/2）`）；中：階段與倒數（`等待中` / `出題中 00:45` / `作畫中 01:23` / `揭曉`）、idle 時 `上一回合：X`、畫師見 `題目：X`、猜題者見 `畫師 X ＿＿（2 字）`、`已猜對 1/3`、本人猜對 `本回合 +N`；右：`Ln 12, Col 4  Spaces: 2  UTF-8  LF  TypeScript` 裝飾。**狀態列文字一律白色**（彩色字在藍／橘底不可讀，§3 語意色不用於此）。自己是畫師且 choosing / drawing 時整條改 `--bg-statusbar-drawer`，ended 恢復藍 |

### 聊天室訊息格式（`features/chat`）

| kind | 顯示 | 顏色 |
|------|------|------|
| `chat` | `amy: 是狗嗎` | 暱稱 `--sem-variable`，內容 `--fg-editor` |
| `system` | `// amy 加入了` | `--sem-comment` |
| `correct` | `✓ ben 猜對了`（文字由 server 給，不含分數；分數在玩家清單與狀態列，本人另見「✓ 你猜對了 +N」） | `--sem-type` |
| 揭曉（system） | `// 題目是 狗（全員猜對）`（文字由 server 給；題目可在客戶端以 `--sem-string` 高亮） | 前綴 `--sem-comment`，題目 `--sem-string` |
| 本地錯誤提示 | 4 秒後直接消失，不做動畫（§7）；被擋的洩題訊息放回輸入框供修改 | `--sem-error` |
| `image`（Epic 2） | `Bob: [圖片]` 一行，下方縮圖最大 240×160、`object-fit: contain`、1px `--border`、圓角 2px；點一下切換為面板寬度。沒有圖可顯示時與暱稱同行的灰字佔位分四種：`[圖片]（載入中…）`（bytes 尚未到）、`[圖片]（連線較慢，已略過）`（server 送來 `data: null`）、`[圖片]（已清除）`（超過 20 張被釋放）、`[圖片]（中途加入看不到）`（只來自快照） | 暱稱 `--sem-variable`，佔位 `--fg-muted` |
| 投放覆蓋層（拖曳中） | 整個 TERMINAL 面板蓋一層 `--bg-selection` 半透明（0.35）、2px 虛線 `--border-focus`、置中文字「放開以傳送圖片」；放開或離開即消失，無動畫。殼層可用 `ChatView.overlayClassName` 覆寫（Epic 5；meet 見 §15.3） | `--fg` |
| 本地錯誤（不廣播） | `✗ 不可洩題` | `--sem-error` |
| 時間戳（可選） | `[14:32]` 靠左 | `--fg-dim` |

輸入列：提示符 `❯`（`--sem-type`）＋透明底、無邊框的輸入框，Enter 送出。

> 實作位置（Epic 3 起）：本表的終端機格式（`// ` 前綴、`❯`、`[HH:mm]`）由 vscode 殼層的 `ChatView`（`shells/vscode/TerminalChat`）提供；功能元件只產生 `ChatLineData`（kind／nickname／text／time／isMine／reveal／image），各主題自行渲染。

### 畫面

- **自動重連畫面**（Epic 4 起取代暱稱畫面；暱稱輸入改在首頁 §14）：殼層先渲染（側欄空、無分頁、面板空），視窗頂部置中同樣的**快速輸入框**（寬 600px），只有一行 `// 正在重新加入…`（`role="status"`），沒有輸入框與選項；成功即進遊戲，失敗回首頁顯示錯誤。
- **放棄回合**：同樣的快速選單確認，兩個選項「放棄本回合」（預設反白，Enter 即放棄）與「繼續作畫」（Esc）。不用 `window.confirm`。
- **出題**：同樣的快速輸入框，placeholder「輸入題目（1–20 字）後按 Enter」，Esc = 放棄。
- **回合結束**：不用 modal。終端機多一行揭曉訊息，狀態列顯示「揭曉」5 秒。
- **說明**（Epic 6）：活動列齒輪選單加「說明…」→ 同樣的快速輸入框：第一步列出主題，第二步標題＝主題、下方 13px 段落（段距 6px）、選項「返回」「關閉」；Esc 關閉。共通規範見 §16。
- **視窗標題**（`document.title`）：`canvas.ts - fishing-work`；作畫中前綴 `● `。favicon 用一般文件圖示。

## 6. 元件規範

| 元件 | 規範 |
|------|------|
| 主要按鈕 | 底 `--accent`、hover `--accent-hover`、字白、高 26px、內距 0 12px、圓角 2px |
| 次要按鈕 | 底 `--bg-button-secondary`、hover `--bg-button-secondary-hover`、字 `--fg` |
| 圖示按鈕 | 22×22、hover 底 `--bg-hover`、圓角 3px；**一律有工具提示**。Epic 7 新增「背景色」（自繪填滿圖示；提示「把背景設為目前顏色 #XXXXXX」；按下即送 `background` op；位置在粗細滑桿（窄版「⋯」）之後的分隔線與橡皮擦之間；「清空畫布」只有背景時停用） |
| 工具提示（Tooltip） | 仿 VS Code hover：底 `--bg-quickinput`、1px `--border`、字 `--fg` 12px、內距 2px 8px、圓角 3px、陰影 `--quickinput-shadow`；hover 300ms 後或 focus 立即顯示，指標離開或**點擊**即消失（滑桿拖曳中除外，否則會蓋住「⋯」面板）、無動畫；內容為功能名稱：遊戲功能用中文（「橡皮擦」「復原」「清空畫布」「放棄本回合」「粗細 12」「顏色 #FF8C00（橘）」「選擇顏色（目前 #00FF51）」「色相 139° #00FF51」「飽和度 80%、明度 60%」），偽裝用的裝飾圖示用英文（Search、Source Control、Extensions、Accounts、Manage、New Terminal、More Actions...、Split Editor Right、Notifications）；元素同時帶 `aria-label`（EXPLORER 用中文） |
| 滑桿 | 軌道高 2px 底 `--border`、已選段 `--accent`、把手 10px 圓 `--fg`；focus 外框 `--border-focus`；鍵盤 ←/→ 每次 1、Shift 每次 8 |
| 顏色面板（Epic 11） | 由工具列「目前顏色鈕」開啟；外觀同「⋯」面板（底 `--bg-quickinput`、1px `--border`、圓角 3px、`--quickinput-shadow`、portal 到 body、`placeFloating` 定位在按鈕下方；點面板外、Esc（focus 回按鈕）、視窗縮放時關閉）；`role="dialog"` `aria-label="顏色面板"`；寬 232px、內距 8px、列距 8px。內容由上而下：**飽和度／明度方塊** 216×132px、圓角 3px（底＝目前色相純色，疊白→透明（向右）與黑→透明（向上）兩層漸層；把手 12px 圓、2px 白框、填目前色；`role="slider"`，`aria-valuetext`「飽和度 80%、明度 60%」；←/→ 飽和度 ±2、↑/↓ 明度 ±2、Shift＋方向鍵同軸 ±10、PageUp/PageDown 飽和度 ±10、Home/End 飽和度 0/100）；**色相條** 216×12px（規範見下列）；**底列**：目前色預覽 22×22（圓角 3px、1px `--border`）＋色碼 `#RRGGBB` 等寬 13px `--fg`（只顯示）。每次變動立即套用並切回畫筆。方塊漸層、把手、預覽的顏色是遊戲資料，以 style 帶入 |
| 色相條 | 彩虹漸層（`linear-gradient(to right, hsl(0..360))`）、216×12px、圓角 6px、把手 12px 圓白框；範圍 0–359°；鍵盤 ←/→ 每次 5°、Shift＋方向鍵或 PageUp/PageDown 每次 30°、Home/End 到兩端。只出現在顏色面板內（2026-10-03 前為工具列上的 96×10px） |
| 輸入框 | 底 `--bg-input`、字 `--fg`、邊框 1px 同底色、focus 邊框 `--border-focus`、高 26px、圓角 2px、placeholder `--fg-muted` |
| 樹狀 / 清單列 | 高 22px、縮排 8px + 層級 × 8px、hover `--bg-hover`、選取 `--bg-active` 字白、focus 內框 1px `--border-focus` |
| 分頁 | 高 35px、內距 0 10px、非作用底 `--bg-tab-inactive` 字 `--fg-muted`、作用底 `--bg-tab-active` 字白、`×` hover 才顯示 |
| 面板分隔 | 1px `--border`，無圓角 |
| 捲軸 | 寬 10px、thumb `--scrollbar-thumb`、軌道透明、hover 才顯示 |
| Focus | 1px `--border-focus`：清單用 inset，按鈕用 outset |
| 游標 | 可點元素 `pointer`；畫師在畫布 `crosshair` |

## 7. 動態

- 只有 hover 底色有 transition，100–150ms。
- 無位移、縮放、彈跳動畫；無音效。
- 倒數每秒更新；最後 10 秒文字改 `--sem-warning`（狀態列上改用白字＋警示圖示），**不閃爍**。
- 猜對只新增一行終端機訊息。
- `prefers-reduced-motion` 自然滿足。

## 8. 響應式

- 目標 ≥ 1280px 桌機。
- **畫師工具列收合斷點**（`compactBelowPx`，視窗寬度小於此值時粗細滑桿收進「⋯」）：vscode **810px**、ppt 500px（§13.3）、meet 1100px（§15.3）、excel 500px（§17）。2026-10-03 Epic 11 移除色相條後實測：完整工具列約 468px，vscode 790 剛好放下、ppt 483 起、meet 1085 起；各留約 15–20px 餘裕（字型差異）。Epic 7 時為 1120／640／1280。
- 1024–1279px：側欄 200px。
- < 1024px：側欄摺疊成覆蓋層，由活動列按鈕開啟。
- < 768px：面板高 160px；狀態列只留連線、階段、倒數，以及**不能少的操作與資訊**：「我來畫」、題目提示、「你猜對了」（否則無法開局、畫師看不到題目）。分頁列以工具列優先（`justify-end-safe`），分頁先縮（`canvas.ts` 最小約 40px），工具列可橫向捲動。手機不是 v1 目標，能用即可。

## 9. 可及性

- 對比：`--fg-editor` / `--bg-editor` ≈ 11:1；`--fg` / `--bg-sidebar` ≈ 9:1；白字 / `--bg-statusbar` ≈ 4.6:1；白字 / `--bg-statusbar-drawer` ≈ 4.9:1。**裝飾性文字不受 4.5:1 約束**：行號、時間戳（`--fg-dim`）、非作用分頁名（`--fg-muted`）、placeholder、狀態列右側裝飾字；其餘承載資訊的文字須達標。
- 鍵盤：Enter 送出、Esc 關閉快速輸入框；Tab 順序 側欄 → 編輯區 → 面板；focus 永遠可見。
- 顏色不是唯一訊息載體：畫師與猜對除了顏色還有 `●` / `✓` 符號。

## 10. Tailwind v4 對應

`theme.css`：`:root` 定義上述變數，再以 `@theme inline` 映射成 Tailwind 色與字型 token（例：`--color-editor: var(--bg-editor)`、`--color-sidebar: var(--bg-sidebar)`、`--font-mono: var(--font-code)`），元件用 `bg-editor`、`text-fg` 等 class。**任何元件內出現 `#` 色碼即為違規。**

- **Tailwind 預設色盤已關閉**（`@theme { --color-*: initial; }`），`text-neutral-300`、`bg-slate-800` 之類的 class 不存在，只能用本檔 token。要保留預設色盤需經舵手定案。
- 字型變數名為 `--font-code`（§4 的字型堆疊），映射為 Tailwind 的 `font-mono`。
- **例外：`server/public/index.html`**（遊戲清單頁，純 HTML、不經 Tailwind）。允許在該檔 `<style>` 的 `:root` 內以 CSS 變數重複宣告用到的 token，**值必須與 §3 相同**並註明來源；不得出現 §3 以外的色碼。

## 11. 驗收清單（Phase 4）

- [ ] 第一眼截圖像 VS Code（Rex 目視）
- [ ] 無 emoji 圖示；所有可點元素 `cursor: pointer`；hover / focus 有狀態
- [ ] 無大面積亮色；無超過 150ms 的動畫
- [ ] 所有色碼來自本檔 token；畫筆色來自 spec PALETTE
- [ ] 文字對比 ≥ 4.5:1（裝飾性行號除外）
- [ ] 自己是畫師時狀態列變橘；作畫中分頁與視窗標題出現 `●`
- [x] 畫師看得到畫布邊界（1px `--border` outline；2026-09-24 舵手瀏覽器確認）

## 12. 微調記錄

| 日期 | 內容 | 決定者 |
|------|------|--------|
| 2026-09-24 | 初版：Dark+ 基底、偽裝第 2 級 | 舵手（Rex 授權） |
| 2026-09-24 | §10 補：關閉 Tailwind 預設色盤、`--font-code` 命名、遊戲清單頁例外規則 | 舵手（龍骨 Phase 0 提問） |
| 2026-09-24 | §3 補次要按鈕兩個 token（§6 原本寫死色碼） | 舵手（龍骨 Phase 2 提問 17） |
| 2026-09-24 | §5 聊天格式對齊 spec §5 的 server 文字（correct 不帶分數、揭曉為「題目是 X（原因）」）；本地錯誤提示規則 | 舵手（龍骨 Phase 3 提問 11、12、16） |
| 2026-09-24 | Rex 目視回饋：§5 工具列改為預設色塊＋色相條＋粗細滑桿；§6 新增工具提示、滑桿、色相條規範；所有圖示按鈕必有提示 | Rex（大致 OK，三項增修） |
| 2026-09-25 | Epic 2：§5 聊天 `image` 訊息與拖曳投放覆蓋層樣式 | 舵手（Rex 需求） |
| 2026-09-25 | Epic 2 客戶端定案：§5 圖片佔位分載入中／已清除／中途加入三種文字 | 舵手（龍骨提問 1–2） |
| 2026-09-25 | Epic 3：改為多主題結構（§3–§5 為 vscode），新增 §13 PPT 主題（token 覆寫、版面、差異、登入卡片） | 舵手（Rex 需求） |
| 2026-09-25 | 畫布底色改為跨主題常數 `CANVAS_BACKGROUND`（黑）、預設白筆；§13 移除 `--bg-canvas` 覆寫 | Rex（畫布是共享畫面） |
| 2026-09-25 | §13.4 登入卡片：未註冊主題「即將推出」不可選；新增 `--brand-editor` / `--brand-slides` 圖示色 token | 舵手（Epic 3 Phase 2 派工） |
| 2026-09-25 | Phase 3 同步：§5 聊天格式實作位置；§13 移除殘留的白底／黑筆字樣；§13.1 對比改實測值；§3／§13.1 新增 `--bg-slide`、`--slide-shadow`、`--fg-on-active` | 舵手（龍骨 Phase 3 回報） |
| 2026-09-25 | Phase 3 驗收：§13.1 加 `--bg-card`、`--avatar-1..6`、`--fg-on-avatar`；§13.2 註解輸入框上方功能提示小字、自己的卡片底、「等待其他玩家加入」統一用詞；§13.3 狀態列項目樣式與 640px 收合斷點 | 舵手（龍骨 Phase 3 提問 1–3） |
| 2026-09-25 | Rex 目視：vscode 畫具強化（Epic 1 Phase 6）與 ppt 主題（Epic 3）「目前沒問題」，無微調 | Rex |
| 2026-09-25 | Epic 4：需求修正「首頁不是預設 VS Code，是柔和 UI 首頁以卡片選風格」；新增 §1 第 6 條首頁例外、§14 首頁（token、版面、動態例外）；§13.4 作廢 | Rex（需求）／舵手（設計） |
| 2026-09-25 | Epic 4 Phase 1 同步：§5 暱稱畫面改為自動重連畫面（快速輸入框只剩一行提示）；§13.2 對話框列改為出題／放棄／自動重連（「加入簡報」）；§13.3 圖示句 | 舵手（龍骨 Phase 1 回報） |
| 2026-09-25 | Epic 4 Phase 2 定案：§14.1 根字級 16px；§14.2 新增 `--home-on-accent`、圖示圓底改 `currentColor` color-mix；§14.3 柔光尺寸 480×180／520×360、輸入框 focus、提示放小標右側、按鈕原生 disabled；§14.5 index.html 內嵌腳本與守門測試 | 舵手（龍骨 Phase 2 提問 1–8） |
| 2026-09-25 | Rex 目視首頁「都正常」，無微調；Epic 4 完成 | Rex |
| 2026-09-25 | Epic 5：新增 §15 視訊會議主題（Google Meet 風格；token 覆寫、版面、差異）；§3／§13.1 新增六個面板 token 與 `--brand-meet`；§14.3 卡片格 minmax 190px | 舵手（Rex 需求「來個 UI，Google Meet 版本」） |
| 2026-09-26 | Epic 6 遊戲說明：新增 §16（共通兩步對話框、段落排版）；§5 齒輪選單「說明…」；§13.2「說明」分頁可作用；§15.2「資訊」按鈕＝說明 | 舵手（Rex 需求「說明分頁既然有就利用它」） |
| 2026-09-28 | Epic 7 畫布背景色：§6 工具列色塊 10 個（加黑、膚色）、新增「背景色」圖示按鈕（自繪填滿圖示，提示「把背景設為目前顏色 #XXXXXX」，位置在粗細滑桿／「⋯」之後的分隔線與橡皮擦之間）；工具列因此加寬約 70px | 舵手（Rex 需求） |
| 2026-10-03 | Epic 11 顏色面板：§5 工具列移除色相條、「目前顏色」改成按鈕；§6 新增「顏色面板」（HSV 方塊 216×132＋色相條 216×12＋色碼）、色相條改為面板內元件、提示例子；三殼層斷點待龍骨實測回寫 | 舵手（Rex 2026-10-03：色相條太難選） |
| 2026-09-28 | Epic 7 Phase 1 實測：vscode 工具列收合斷點 1100 → **1120px**（1100px 時溢出 1px）；ppt 640、meet 1280 不變；ppt 出題時的灰化假工具列也有背景色圖示；「清空畫布」只有背景時停用 | 舵手（龍骨 Phase 1 回報） |
| 2026-10-01 | Epic 10（首頁紙張質感；2026-10-07 Rex 採用）：§14.1 改紙張版本；§14.2 `--home-bg`／`--home-surface`／`--home-surface-hover`／`--home-border`／`--home-shadow`／`--home-shadow-hover` 改暖色、移除 `--home-tint-1/2`、新增 `--home-bg-shade`（最暗紙面，對比用）與 `--home-vignette`、`--home-error` 加深為 `#B3302C`；§14.3 頁面底改四層紙面並記錄紙紋參數與量法、卡片與輸入框加 `home-paper`；§14.4 對比以最暗紙面計、`prefers-contrast: more` 無紋理 | 舵手派子代理（Rex 需求測試） |
| 2026-09-26 | Epic 6 Phase 1 定案：§16 補「檔案」與「更多 ⋮」選單的「說明…」第二項、switchHint 不帶「…」、清單步驟「關閉」 | 舵手（龍骨 Phase 1 提問 1–2） |
| 2026-09-25 | Epic 5 Phase 1 定案：§15.1 `--bg-quickinput` 改深灰（工具提示）、對話框改用 `--bg-panel`、`--sem-warning` 保留值；§15.2 畫師作畫中不顯示標籤、提示在輸入列上方；§15.3 收合 1280px、`overlayClassName`、`groupWithPrevious`；§5 覆蓋層可覆寫；§14.3 描述兩行平衡換行 | 舵手（龍骨 Phase 1 提問 1–6） |
| 2026-09-24 | Phase 6 驗收：§4 浮出層共用陰影；§6 提示文字範例、點擊隱藏、裝飾圖示英文、色相條鍵盤步進；§8 窄版分頁列規則 | 舵手（龍骨 Phase 6 提問 2–8） |
| 2026-09-24 | Phase 4 驗收：`--bg-statusbar-drawer` 改 `#b5561f`（對比）、畫布加外框、新增 `--statusbar-hover` / `--focus-on-color` / `--quickinput-shadow`；§1 活動列圖示 24px；§2 第 2 級裝飾清單；§5 分頁 `●`、狀態列內容與白字、放棄確認、加入選項；§8 窄版保留項；§9 裝飾性例外 | 舵手（龍骨 Phase 4 提問 1–12；舵手瀏覽器實測） |

---

## 13. PPT 主題（`data-theme="ppt"`，Epic 3）

> 偽裝成 PowerPoint。**淺色**是這個偽裝的必然特性（PowerPoint 就是白底），§1 的「低調」在此指：Office 淺灰、無亮色大面積、動態一樣克制。**畫布例外：底色固定黑、預設白筆，與所有主題一致**（共享畫面，Rex 2026-09-25 定案）。字型改為無襯線：`system-ui, "Segoe UI", "Microsoft JhengHei", "PingFang TC", sans-serif`，基準 13px。

### 13.1 token 覆寫（同名 token，只列與 §3 不同者）

| token | 值 | 用途（PPT 對應） |
|-------|----|------|
| `--bg-titlebar` | `#B7472A` | 標題列（PowerPoint 橘紅） |
| `--fg-statusbar` | `#FFFFFF` | 標題列白字（對比 5.3:1，實測） |
| `--bg-activity` | `#FFFFFF` | 功能區（Ribbon）底 |
| `--bg-sidebar` | `#F3F2F1` | 左縮圖窗格、右註解窗格、狀態列 |
| `--bg-editor` | `#E6E6E6` | 投影片工作區（灰） |
| `--bg-tab-active` | `#FFFFFF` | 作用中功能區分頁 |
| `--bg-tab-inactive` | `#F3F2F1` | 非作用分頁 |
| `--bg-input` | `#FFFFFF` | 輸入框 |
| `--bg-quickinput` | `#FFFFFF` | 對話框 |
| `--bg-statusbar` | `#F3F2F1` | 狀態列（淺灰，深字） |
| `--bg-statusbar-drawer` | `#F3F2F1` | PPT 主題狀態列不變色；畫師身分以縮圖橘框與「繪圖」分頁作用呈現 |
| `--bg-hover` | `#EDEBE9` | hover |
| `--bg-active` | `#FDE7E9` | 選取（淡橘紅） |
| `--bg-selection` | `#FCE4D6` | 文字選取 |
| `--border` | `#D2D0CE` | 分隔線、投影片邊緣 |
| `--border-focus` | `#B7472A` | focus 外框 |
| `--fg` / `--fg-editor` | `#252525` | 一般文字（對白 15.7:1） |
| `--fg-muted` | `#605E5C` | 次要文字（6.5:1，實測） |
| `--fg-dim` | `#8A8886` | 時間戳（3.5:1，裝飾） |
| `--fg-link` | `#0078D4` | 連結 |
| `--accent` / `--accent-hover` | `#B7472A` / `#9E3B23` | 主要按鈕（白字） |
| `--bg-button-secondary(-hover)` | `#FFFFFF` / `#F3F2F1` | 次要按鈕（1px `--border`） |
| `--sem-comment` | `#605E5C` | system 訊息（灰字） |
| `--sem-variable` | `#252525` | 暱稱（粗體） |
| `--sem-function` | `#B7472A` | 畫師標記 |
| `--sem-type` | `#107C10` | 猜對（綠） |
| `--sem-number` | `#605E5C` | 分數 |
| `--sem-string` | `#B7472A` | 揭曉的題目 |
| `--sem-keyword` | `#0078D4` | 可操作項 |
| `--sem-error` | `#A4262C` | 錯誤 |
| `--sem-warning` | `#8A6D00` | 最後 10 秒 |
| `--statusbar-hover` | `rgba(0, 0, 0, 0.06)` | 狀態列項目 hover |
| `--bg-slide` | `#FFFFFF` | 投影片框與縮圖卡底（畫布本身仍為 `CANVAS_BACKGROUND` 黑，只有框是白） |
| `--slide-shadow` | `0 1px 3px rgba(0, 0, 0, 0.15)` | 投影片陰影（本主題例外） |
| `--fg-on-active` | `#252525` | 選取／按下底（`--bg-active` 淡橘紅）上的文字與色塊勾選記號；vscode 為白 |
| `--bg-card` | `#FFFFFF` | 註解卡片底（文字對比 15.3:1）；vscode 值 `#252526` 未使用 |
| `--avatar-1..6` | `#005A9E` `#006F73` `#6B4FA0` `#9A0089` `#8C4A00` `#486860` | 註解頭像底，依暱稱 FNV-1a 雜湊取一；跨主題共用、ppt 不覆寫 |
| `--fg-on-avatar` | `#FFFFFF` | 頭像首字（六色上對比 5.9–7.7:1） |
| `--bg-panel`／`--bg-panel-hover`／`--fg-on-panel`／`--fg-on-panel-muted`／`--border-panel`／`--accent-panel` | `#F3F2F1`／`#EDEBE9`／`#252525`／`#605E5C`／`#D2D0CE`／`#0078D4` | 面板 token（Epic 5 新增，ppt 不使用；值＝ppt 側欄同名色，外觀不變） |
| `--focus-on-color` | `#FFFFFF` | 橘紅標題列上的 focus |
| `--font-code` | 無襯線堆疊（見上） | 全站字型 |

### 13.2 版面

```
┌──────────────────────────────────────────────────────────────┐
│ 簡報1 - PowerPoint                              ⟳ 已連線  ─ □ ×│ ← 標題列 30px 橘紅
│ 檔案  常用  插入  設計  轉場  動畫  投影片放映  校閱  檢視  繪圖  說明 │ ← 功能區分頁 28px
│ [● ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ | 粗細 ─●── 12 | 背景色 橡皮擦 復原 清空 放棄]   │ ← 功能區內容 64px（繪圖分頁）
├───────┬──────────────────────────────────────────┬───────────┤
│ 1 ┌─┐ │                                          │ 註解      │
│   │A│ │        ┌────────────────────────┐        │ ┌───────┐ │
│ 2 ┌─┐ │        │      投影片（畫布）      │        │ │(B) Bob │ │
│   │B│ │        │        黑底 16:9        │        │ │ 是狗嗎  │ │
│ 3 ┌─┐ │        └────────────────────────┘        │ └───────┘ │
│   │C│ │                                          │ ✓ Carol   │
│       │ 備忘稿：作畫中 01:23  題目：貓            │ 新增註解… │
├───────┴──────────────────────────────────────────┴───────────┤
│ 投影片 3 / 3   中文(台灣)   備忘稿   ▶ 從目前投影片開始   顯示設定  62% │ ← 狀態列 22px
└──────────────────────────────────────────────────────────────┘
```

| 區塊 | 尺寸 | 內容 |
|------|------|------|
| 標題列 | 30px | 「簡報1 - PowerPoint」置中；右側連線狀態小字；作畫中標題與 `document.title` 前綴 `● ` |
| 功能區分頁 | 28px | 11 個分頁文字；畫師時「繪圖」作用（底白、上緣 2px `--accent`），否則「常用」作用。**「說明」分頁自 Epic 6 起可作用**：點了成為作用分頁，功能區內容顯示一排主題按鈕（Office 風格圖示 16px＋標籤，一顆一主題），點按鈕開 PptDialog 說明（§16）；未點時外觀與先前完全相同 |
| 功能區內容 | 64px | 「繪圖」：畫師工具列（預設白筆，跨主題一致；目前顏色鈕（開顏色面板）、色塊、粗細滑桿、背景色、橡皮擦、復原、清空、放棄）；非畫師時整組灰化（`opacity .4`、不可點；目前顏色鈕固定顯示白，殼層不讀 store）。「常用」：裝飾性按鈕群（新增投影片、版面配置、字型…）純裝飾 |
| 左縮圖窗格 | 寬 180px | 玩家清單：編號＋16:9 縮圖卡（白底 1px `--border`），卡內暱稱（粗體）與分數（右下小字）；畫師卡外框 2px `--accent`；已猜對右上綠勾；斷線中 `opacity .5`；自己的卡底 `--bg-active` |
| 中央 | 剩餘 | 灰工作區置中投影片（畫布，底色固定黑 `CANVAS_BACKGROUND`，畫師預設白筆），`--border` 1px 外框＋ `0 1px 3px rgba(0,0,0,.15)` 陰影（PowerPoint 投影片本身有陰影，屬本主題例外） |
| 備忘稿列 | 28px（投影片下方） | 「備忘稿：」＋階段、倒數、題目／字數提示、本回合分數；idle 顯示「上一回合：X」 |
| 右註解窗格 | 寬 260px | 標題「註解」；訊息卡片（底 `--bg-card`）：24px 圓形頭像（暱稱首字、底色依暱稱雜湊取 `--avatar-1..6`）、暱稱粗體、時間 `--fg-dim`（裝飾）、內文；自己的卡片底 `--bg-active`；system 為灰字單行無卡片；correct 卡片左側綠勾；圖片卡片內縮圖 200px；底部「新增註解…」輸入框＋送出鈕，**輸入框上方一行 12px `--fg-muted` 小字顯示功能提示**（「輸入答案或聊天」／「畫師不可說出答案」），placeholder 維持「新增註解…」保偽裝 |
| 狀態列 | 22px | 左：「投影片 N / M」（N 在線人數、M 玩家數）、「中文(台灣)」、「備忘稿」；中：**「▶ 從目前投影片開始」＝我來畫**（人數不足灰化＋「等待其他玩家加入（1/2）」，用詞與 vscode 一致）；右：「顯示設定」「▭ 62%」裝飾 |
| 對話框 | 寬 420px | 出題／放棄確認／自動重連：白底、標題列（「輸入標題」「捨棄變更？」「加入簡報」）、內文、右下「確定」（主要）「取消」；Enter／Esc 對應；自動重連對話框（Epic 4）只有標題「加入簡報」與一行「正在重新加入…」（`role="status"`），暱稱輸入在首頁 §14 |

### 13.3 與 vscode 主題的差異

- 狀態列不因畫師變色；畫師身分靠縮圖橘框與「繪圖」分頁作用。
- 狀態列項目：`text-fg`、hover `--statusbar-hover`、focus `--border-focus`（不用 vscode 的白字白框）。
- 工具列收合斷點 500px（PPT 功能區整列給工具列，完整寬約 483px）；vscode 為 810px。
- 沒有假行號、沒有終端機提示符；聊天是註解卡片。
- 投影片有陰影（例外）；其餘 §6 的元件規範（高度、圓角 2px、無動畫）沿用。
- 圖示：功能區用 Office 風格線條圖示（自繪，16px），不用 Microsoft 商標；首頁風格卡片圖示為橘紅投影片方塊（§13.4 token）。

### 13.4 登入畫面的主題卡片（共通）

> **Epic 4 起作廢**（Rex 2026-09-25 需求修正）：卡片改在不偽裝的首頁（§14），殼層不再有登入畫面；本節只保留 `--brand-*` 圖示色 token 的定義，其餘版面描述為歷史。

暱稱對話框最下方一列卡片（上方 1px `--border` 分隔線；`role="radiogroup"`），每張 120×88：圖示 40px、名稱（「程式編輯器」「簡報」）、選取時 2px `--border-focus` 外框；hover `--bg-hover`；鍵盤 ←/→ 切換、Enter 加入；點卡片立即以該主題重繪整個登入畫面（所見即所得）。尚未註冊的主題卡片顯示但標「即將推出」、不可選（`aria-disabled`、`opacity .5`、有提示）。選擇存 `localStorage`，進遊戲後可由各殼層的「切換偽裝…」再改；分頁之間不同步。

**卡片圖示色（跨主題共用 token，兩種主題底色上皆 ≥ 3:1）**：

| token | 值 | 用途 |
|-------|----|------|
| `--brand-editor` | `#3B8EEA` | 「程式編輯器」圖示（角括號，藍） |
| `--brand-slides` | `#B7472A` | 「簡報」圖示（投影片方塊，橘紅） |
| `--brand-meet` | `#1E8E3E` | 「視訊會議」圖示（攝影機，綠；白底 4.2:1、首頁底 3.9:1） |

圖示為自繪 SVG 線條／色塊，不使用 VS Code 或 Microsoft 商標。

## 14. 首頁（`data-theme="home"`，Epic 4）

> 首頁**不偽裝**（Rex 2026-09-25 需求修正）：柔和 UI；Epic 10（2026-10-01 試做、2026-10-07 Rex 採用）加上紙張質感（§14.1、§14.3「紙紋參數」）。只在「未加入且沒有重連憑證」時顯示；自動重連不經首頁（直接顯示所選殼層的空白畫面＋「正在重新加入…」）。規劃：[plan/home-page.md](plan/home-page.md)。

### 14.1 風格

**紙張質感（Epic 10，2026-10-07 Rex 採用；[plan/home-paper.md](plan/home-paper.md)）**：暖白紙底，帶細顆粒、纖維與不均勻的紙漿明暗，四邊極淡的暖色暗角；卡片與輸入框是「疊在紙上的另一張較厚的紙」（略白略暖、紙紋更淡、暖灰邊框、暖色貼地陰影）。質感全用 CSS＋內嵌 SVG（`feTurbulence`）產生，不下載圖檔、不用 JS、靜態不動。版面骨架沿用原本的 Soft UI Evolution（ui-ux-pro-max 建議；不採純 neumorphism，對比不足）：圓角 12–16px、柔和多層陰影、承載資訊的文字對比 ≥ 4.5:1（頁面底以最暗紙面 `--home-bg-shade` 計）；文字色與主色（`--home-fg`、`--home-accent`）不變；系統無襯線字（不下載網路字型）；**根字級 16px**（殼層為 13px；home 下 `html` 改 16px，rem 尺寸才正確）。

> Epic 10 之前（commit `5f66fef`）為冷色版本：`--home-bg #F4F5FA`、左上藍／右下綠兩處柔光（`--home-tint-1 #E4E8FA`、`--home-tint-2 #E2F3EA`）、白色卡片、冷灰陰影（歷史註記）。

### 14.2 token（`theme.css` 的 `[data-theme='home']`，命名空間 `--home-*`；不重用殼層 token）

| token | 值 | 用途（對比為實算值） |
|-------|----|------|
| `--home-bg` | `#F8F4EB` | 頁面底：暖白紙色（Epic 10；紙紋與暗角疊在它上面） |
| `--home-bg-shade` | `#EAE4D9` | **最暗紙面**（Epic 10）：紙紋最暗處再疊上滿值暗角後的實際底色，截圖實量（§14.3）。只供對比計算，不映射成 class、不直接上色；改紙紋或暗角參數後必須重量 |
| `--home-vignette` | `rgba(112, 84, 44, 0.025)` | 紙面暗角的邊緣色（Epic 10；`radial-gradient`，中央透明；只給 `body`，不映射成 class） |
| `--home-surface` | `#FFFDF8` | 卡片、輸入框底：紙卡（比頁面略白略暖；上面疊 `home-paper` 紙卡紋理） |
| `--home-surface-hover` | `#FFFEFB` | 卡片 hover 底（拿起來時更亮一點） |
| `--home-fg` | `#2B2F3A` | 主要文字（紙卡 13.2:1、頁面底 12.2:1、最暗紙面 10.6:1） |
| `--home-fg-muted` | `#5F6673` | 說明文字（紙卡 5.7:1、頁面底 5.3:1、最暗紙面 4.57:1、選取卡片底 5.1:1） |
| `--home-fg-dim` | `#9CA3AF` | 裝飾小字（字數計、頁尾；不受 4.5:1 約束） |
| `--home-border` | `#E6DECF` | 1px 邊框（暖灰） |
| `--home-accent` | `#4F5FD9` | 主按鈕底、選取邊框、focus 外框（白字 5.3:1；圖形對頁面底 4.8:1、最暗紙面 4.2:1） |
| `--home-accent-hover` | `#4352C4` | 主按鈕 hover（白字 6.5:1） |
| `--home-accent-soft` | `#EEF0FC` | 選取卡片底 |
| `--home-on-accent` | `#FFFFFF` | `--home-accent` 底上的前景（主按鈕文字、打勾徽章）；不沿用 `--home-surface`，兩者語意不同 |
| `--home-error` | `#B3302C` | 錯誤文字（紙卡 6.1:1、頁面底 5.7:1、最暗紙面 4.9:1）。Epic 10 由 `#C93B3B` 加深：原值在最暗紙面只有 4.0:1 |
| `--home-ok` | `#1F7A4D` | 已連線圓點（圖形；頁面底 4.8:1、最暗紙面 4.2:1） |
| `--home-shadow` | `0 1px 1px rgba(84, 62, 32, 0.1), 0 2px 6px rgba(84, 62, 32, 0.06), 0 8px 20px rgba(84, 62, 32, 0.06)` | 卡片：暖色貼地陰影（1px 接觸陰影＋兩層柔和擴散） |
| `--home-shadow-hover` | `0 2px 2px rgba(84, 62, 32, 0.08), 0 6px 12px rgba(84, 62, 32, 0.08), 0 16px 32px rgba(84, 62, 32, 0.12)` | 卡片 hover：像把紙拿起來（陰影變大變遠） |
| `--home-radius` | `16px` | 卡片；輸入框與按鈕 12px、膠囊 999px |
| `--font-home` | `system-ui, 'Segoe UI', 'Microsoft JhengHei', 'PingFang TC', sans-serif` | 全頁字型（與 ppt 同堆疊） |

卡片圖示沿用跨主題 token `--brand-editor`／`--brand-slides`（§13.4；圖示為圖形，≥ 3:1 即可）；圖示底的圓形淡色底以 `color-mix(in srgb, currentColor 12%, var(--home-surface))` 產生（currentColor 即圖示的 `--brand-*`，新主題不必加規則），不另加色碼。

### 14.3 版面

- **頁面**：全視窗、可捲動（`html, body` 的 `overflow: hidden` 在 home 下解除）；置中欄 max 640px，側邊 24px（< 480px 為 16px）；內容垂直置中，高於視窗時從頂端排。底為**紙面**（Epic 10）：`html` 純 `--home-bg`；`body` 在 `--home-bg` 上疊四層靜態背景（由上而下：暗角、細顆粒、纖維、紙漿斑駁），參數見下方「紙紋參數」。`@media (prefers-contrast: more)` 時 `body` 只留純 `--home-bg`、`home-paper` 無紋理。不做動畫、不用 `background-attachment: fixed`、不用 `mix-blend-mode`。
- **紙紋參數（Epic 10 最終值；`theme.css` 的 `html[data-theme='home'] body` 與 `@utility home-paper`）**：每層是一張內嵌 SVG（`data:` URI），`feTurbulence type='fractalNoise' stitchTiles='stitch'`（圖塊無縫）→ `feColorMatrix` 把雜訊的 R 通道轉成 alpha（`alpha = a·R + b`，負值即 0；R 平均約 0.5、標準差約 0.12）、顏色固定為暖褐墨色 `rgb(.36 .27 .15)`（壓暗）或白（提亮）；`color-interpolation-filters='sRGB'`。三種圖塊尺寸互異（256／640／1024），重複週期 5120px，看不出拼接。

  | 層 | 圖塊（＝`background-size`） | `baseFrequency`／`numOctaves`／`seed` | alpha（a·R + b；峰值） | 說明 |
  |----|------|------|------|------|
  | 暗角 | 全頁 | — | `--home-vignette`（0.025） | `radial-gradient(ellipse farthest-corner at 50% 45%, transparent 60%, var(--home-vignette))`：中央略亮、四邊極淡的暖色 |
  | 細顆粒 | 256px | `.85`／3／0 | 壓暗 `.2R − .1`（約 0.09）＋提亮（白）`−.2R + .1` | 高頻等向雜點，同一張雜訊的亮暗兩半各自上色，平均亮度不變 |
  | 纖維 | 640px | 橫向 `.025 .6`／3／7；直向 `.6 .03`／3／5 | 橫向 `.4R − .25`（約 0.11）；直向 `.3R − .2`（約 0.07） | 非等向雜點（x、y 頻率差 20 倍以上）形成細長纖維；各再乘上一張低頻遮罩（`.012`／2／seed 11、13；`3R − 1.2`、`3R − 1.3`，`feComposite operator='in'`），纖維成簇出現、不是整頁平行線 |
  | 紙漿斑駁 | 1024px | `.005`／3／3 | 壓暗 `.08R − .04`（約 0.02）＋提亮（白）`−.25R + .125`（約 0.085） | 低頻大塊明暗，含蓄 |
  | 紙卡（`home-paper`） | 256px | 顆粒 `.85`／3／0；纖維 `.025 .6`／3／7（同遮罩 seed 11） | 顆粒 `.14R − .07`；纖維 `.3R − .2` | 卡片與輸入框：同一套顆粒＋橫向纖維、更淡；只設 `background-image`／`background-size`，底色仍由 `bg-home-*` class 決定 |

  **最暗紙面 `--home-bg-shade` 的量法**：關掉暗角，以 headless Chrome 截完整重複週期（5120×5120 CSS px；DSF 1 與 2 都量），取最暗的 4×4 CSS px 區塊平均色（DSF 1 為 `rgb(237, 232, 222)`，比 DSF 2 暗），再疊上滿值暗角（alpha 0.025）→ `#EAE4D9`。實際視窗（1280×800、1366×768、1440×900、1920×1080、375×812）量到的最暗 4×4 區塊為 `#ECE6DC`～`#EFEBE1`，都比它亮。改任何紙紋或暗角參數後要重量並更新 token（`homeTheme.test.ts` 只守「不亮於純紙色疊滿值暗角」這個下限與各文字色對它的對比）。紙卡上最暗 4×4 區塊：未選取 `#FBF8F2`（`--home-fg-muted` 5.4:1）、已選取（`--home-accent-soft` 底）`#EAECF7`（4.9:1）。
- **標題**：「我畫你猜」28px／600 `--home-fg`；副標「輸入暱稱、挑一種介面風格，就能加入」15px `--home-fg-muted`。
- **暱稱**：label「暱稱」14px／500；輸入框高 48px、圓角 12px、底 `--home-surface` 加紙卡紋理（`home-paper`，Epic 10）、1px `--home-border`、字 16px、placeholder `--home-fg-dim`；focus 為邊框轉 `--home-accent` 加 2px `--home-accent` outline（offset 0）；右側字數 `n/12` 12px `--home-fg-dim`（超過改 `--home-error`）；錯誤在下方 13px `--home-error`、`role="alert"`。Enter＝進入遊戲。
- **介面風格**：小標「介面風格」14px／500，提示「只影響你自己的畫面，之後可在遊戲內切換」12px `--home-fg-dim` 放小標右側、窄螢幕換到下一行。卡片格 `grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))`、gap 16px（Epic 13 起四張卡片在 640px 欄寬排 2×2；Epic 5–12 為 190px 讓三張同列，四張時會變 3＋1 不好看，2026-10-06 改回 220px）。每張卡片（Epic 10：紙卡，疊在紙上的另一張較厚的紙）：底 `--home-surface` 加紙卡紋理（`home-paper`）、圓角 `--home-radius`、內距 20px、1px `--home-border`（暖灰）、`--home-shadow`（暖色貼地）；左上 64px 圓形淡色底（§14.2 的 `color-mix`）放 48px 圖示；名稱 16px／600 `--home-fg`；描述（註冊表 `description`）13px／18px `--home-fg-muted`，允許兩行、`text-wrap: balance`（三卡同列時 150px 內寬放不下 14 字，平衡換行讓它在逗號附近斷）；卡片等高（grid stretch）。**選取**：2px `--home-accent` 邊框（以 `box-shadow: inset 0 0 0 2px` 或 outline 實作，不改尺寸）＋底 `--home-accent-soft`＋右上 20px 圓形 `--home-accent` 底 `--home-on-accent` 打勾（SVG）。**hover**（可選者；像把紙拿起來一點）：底 `--home-surface-hover`、`--home-shadow-hover`、`translateY(-2px)`（`prefers-reduced-motion: reduce` 時不位移）；選取中的卡片底仍是 `--home-accent-soft`（紙卡紋理照樣疊在上面）。**不可選**（即將推出）：`opacity .55`、`cursor: default`、右上「即將推出」膠囊（12px、1px `--home-border`、`--home-fg-dim`）。
- **進入遊戲**：全寬、高 48px、圓角 12px、底 `--home-accent`、字 `--home-on-accent` 16px／600；hover `--home-accent-hover`；未連線與加入中用原生 `disabled`（`opacity .5`、`cursor: default`；首頁不偽裝、沒有 Tooltip，不必用 aria-disabled）；加入中顯示「加入中…」。
- **連線狀態**：一行 13px `--home-fg-muted`：8px 圓點（已連線 `--home-ok`，其他 `--home-fg-dim`）＋文字「已連線」「正在連線到伺服器…」「連線中斷，重新連線中…」；`aria-live="polite"`。
- **頁尾**：「fishing-work」12px `--home-fg-dim`。

### 14.4 動態與可及性

- **動態例外**（決策 10）：允許 200ms `transition`（陰影、邊框色、底色、≤ 2px 位移）；`prefers-reduced-motion: reduce` 時關閉位移。無彈跳、無音效。
- **鍵盤**：卡片 `role="radiogroup"`／`role="radio"`＋`aria-checked`、roving tabindex、←／→（↑／↓）移動即選取並略過不可選、Home／End、Space／點擊選取、Enter＝進入遊戲（沿用 `layout/themeCardNav.ts`）；Tab 順序 暱稱 → 卡片 → 進入遊戲；focus 為 2px `--home-accent` 外框、offset 2px，永遠可見。
- 卡片描述直接寫在卡片上，**不用 Tooltip**（Tooltip 是殼層元件）。
- 對比：承載資訊的文字 ≥ 4.5:1（值見 §14.2）；頁面底上的文字以**最暗紙面** `--home-bg-shade` 計（紙紋與暗角會壓暗底色，不能只量 `--home-bg`；Epic 10）；顏色不是唯一訊息載體（選取有打勾徽章、不可選有文字膠囊）。
- **高對比偏好**（Epic 10）：`prefers-contrast: more` 時拿掉紙紋與暗角（`body` 只留純 `--home-bg`、`home-paper` 無紋理）。紙紋為靜態背景，`prefers-reduced-motion` 不影響它。
- **響應式**：375px 單欄、按鈕全寬、無橫向捲動；≥ 640px 兩欄卡片。

### 14.5 文件層級與流程

- 首頁：`<html data-theme="home">`、`document.title`「fishing-work」、favicon `favicon.svg`；進殼層即換成該主題的值（`shells/document.ts`）。`main.tsx` 第一次繪製前依「是否有重連憑證」決定 `data-theme`（有 → 所選殼層；無 → home）。在此之前 `index.html` 的 `<head>` 最前面（CSS 之前）有 6 行內嵌腳本先設 `data-theme`（只判斷 session 鍵是否存在、不驗 JSON：有 → localStorage 的主題原字串或 vscode；無或任何例外 → home），不做 title 邏輯；靜態 `<title>` 為中性「fishing-work」。守門測試比對兩個 storage 鍵名（`SESSION_KEY`、`SHELL_STORAGE_KEY`）並以假 storage 執行腳本對照 `initialDocumentTheme`。
- 自動重連（有憑證）期間顯示所選殼層的空白畫面與「正在重新加入…」（`ShellProps` 的 `screen: 'resume'`），不顯示首頁；失敗才回首頁並顯示錯誤。

## 15. 視訊會議主題（`data-theme="meet"`，Epic 5）

> 偽裝成一場「有人正在分享畫面」的 Google Meet 通話。深色會議區＋白色側邊面板；圓角 8px 為本主題例外。規劃：[plan/meet-theme.md](plan/meet-theme.md)。

### 15.1 token 覆寫（同名 token，只列與 §3 不同者；對比為實算值）

| token | 值 | 用途 |
|-------|----|------|
| `--bg-activity`／`--bg-sidebar`／`--bg-editor`／`--bg-titlebar`／`--bg-statusbar`／`--bg-statusbar-drawer` | `#202124` | 會議區底（底部控制列、影片條、舞台）；畫師時控制列不變色（畫師靠主畫面標籤與 tile 外框） |
| `--bg-tab-active`／`--bg-tab-inactive`／`--bg-slide` | `#3C4043` | 主畫面 tile 與參加者 tile 底；`--fg` 於其上 8.7:1 |
| `--bg-input` | `#F1F3F4` | 面板輸入膠囊與對話框輸入框（白底區）；`--fg-on-panel` 於其上 14.5:1 |
| `--bg-quickinput` | `#3C4043` | 工具提示（layout/Tooltip）與工具列「⋯」面板：Meet 的提示就是深灰白字（`--fg` 8.7:1）；**對話框不用此 token，改用 `--bg-panel`** |
| `--bg-card` | `#FFFFFF` | 訊息卡 |
| `--bg-hover` | `#3C4043` | 深色區 hover（控制列按鈕、選單） |
| `--bg-active` | `#8AB4F8` | 按下／選取（工具列按下的按鈕、色塊外框）；`--fg-on-active` `#202124`（7.6:1） |
| `--bg-selection` | `#394457` | 文字選取 |
| `--border` | `#5F6368` | 深色區邊框 |
| `--border-focus` | `#8AB4F8` | focus 外框、畫師 tile 外框 |
| `--fg`／`--fg-editor`／`--fg-statusbar` | `#E8EAED` | 深色區文字（13.4:1；tile 上 8.7:1） |
| `--fg-muted` | `#9AA0A6` | 深色區次要文字（`#202124` 上 6.1:1；**tile 上只有 4.0:1，tile 內承載資訊的文字一律用 `--fg`**） |
| `--fg-dim` | `#80868B` | 裝飾（時間、會議代碼） |
| `--fg-link`／`--accent` | `#8AB4F8` | 深色區強調（已猜對舉手圖示、作用中的「分享畫面」） |
| `--accent-hover` | `#AECBFA` | |
| `--bg-button-secondary`／`--bg-button-secondary-hover` | `#3C4043`／`#5F6368` | 控制列圓形按鈕 |
| `--scrollbar-thumb` | `rgba(255, 255, 255, 0.3)` | |
| `--statusbar-hover` | `rgba(255, 255, 255, 0.12)` | 控制列 hover |
| `--focus-on-color` | `#FFFFFF` | |
| `--quickinput-shadow` | `0 4px 12px rgba(0, 0, 0, 0.4)` | 對話框陰影 |
| `--slide-shadow` | `none` | |
| `--sem-comment` | `#9AA0A6` | 深色區系統字（未使用；面板內 system 用 `--fg-on-panel-muted`） |
| `--sem-variable`／`--sem-function`／`--sem-number`／`--sem-string`／`--sem-keyword` | `#E8EAED` | 未使用（給深色區可讀值） |
| `--sem-type` | `#188038` | 面板內「猜對」綠字（白底 5.0:1） |
| `--sem-error` | `#D93025` | 面板與對話框的錯誤文字（白底 4.8:1）；深色區不顯示錯誤 |
| `--sem-warning` | `#FDD663` | 保留值（`#202124` 上 11.5:1）；v1 字幕列倒數不另套色，沿用功能元件的白字＋警示圖示 |
| `--bg-panel` | `#FFFFFF` | 右側「通話中的訊息」面板底 |
| `--bg-panel-hover` | `#F1F3F4` | 面板內 hover |
| `--fg-on-panel` | `#202124` | 面板文字（16.1:1） |
| `--fg-on-panel-muted` | `#5F6368` | 面板次要文字：時間戳、system、功能提示（6.1:1） |
| `--border-panel` | `#DADCE0` | 面板分隔線 |
| `--accent-panel` | `#1967D2` | 面板與對話框的藍色文字按鈕、送出圖示（白底 5.4:1；不用 `#1A73E8`，只有 4.5:1） |
| `--font-code` | `system-ui, 'Segoe UI', 'Microsoft JhengHei', 'PingFang TC', sans-serif` | 全介面無襯線 |

不覆寫：`--bg-canvas`（畫布固定黑）、`--brand-*`、`--avatar-1..6`／`--fg-on-avatar`（參加者 tile 的頭像圓沿用）。

### 15.2 版面

| 區塊 | 尺寸 | 內容 |
|------|------|------|
| 舞台（左） | 佔剩餘寬高；內距 16px | 主畫面 tile：16:9 畫布置中，圓角 8px，底 `--bg-tab-active`；左上 12px 標籤「<畫師> 正在分享畫面」（idle「尚無人分享畫面」），白字半透明深底膠囊；**畫師本人作畫中不顯示標籤**（上緣整列給浮動工具列，1280px 時 tile 約 672px 放不下兩者；猜題者與其他階段照顯示）；畫師時 tile 外框 2px `--border-focus` |
| 浮動工具列 | 主畫面上緣往下 12px，置中，高 44px | 畫師工具列（toolbar 插槽）：深色膠囊（底 `--bg-tab-active`、圓角 22px、`--quickinput-shadow`）；只有畫師時出現 |
| 字幕列 | 主畫面下緣往上 12px，置中，最大寬 720px | 回合狀態（roundStatus 插槽）：底 `--bg-tab-active` 90%、白字 14px、圓角 8px、內距 8px 16px；倒數最後 10 秒沿用功能元件的白字＋警示圖示，不另套色（決策 13） |
| 右側影片條 | 寬 200px（< 1280px 為 160px），gap 8px，可捲動 | 參加者 tile 16:9 圓角 8px 底 `--bg-tab-inactive`：置中 40px 頭像圓（暱稱首字、`--avatar-n`、`--fg-on-avatar`）；左下暱稱 12px `--fg`（自己加「（你）」）；右下分數膠囊 12px `--fg` 只顯示總分「N 分」（本回合的「+N」不上 tile，放工具提示與 sr-only；字幕列與「你猜對了」已顯示 +N；200px tile 放不下「+20 20 分」會擠掉暱稱）；畫師：左上 16px 分享圖示＋2px `--border-focus` 外框；已猜對：右上 16px 舉手圖示 `--accent`；斷線：整張 `opacity .5`＋左下改「連線中斷」 |
| 右側面板 | 寬 360px，外距 16px（上、右、下），圓角 8px，底 `--bg-panel` | 標題列 48px「通話中的訊息」＋右側 × 關閉（＝切換面板）；輸入列上方 12px `--fg-on-panel-muted` 功能提示（同 ppt）（畫師「聊天（不可說出答案）」、猜題者「輸入答案或聊天」，`aria-describedby`）；訊息列表（`role="log"`）；底部輸入列：膠囊 `--bg-input` 圓角 24px 高 40px、placeholder「傳送訊息給所有人」、右側送出圖示 `--accent-panel`（`canSend` 為 false 時 `--fg-on-panel-muted`）；投放覆蓋層蓋整個面板（`data-chat-drop-zone`） |
| 底部控制列 | 高 80px，底 `--bg-activity`，三欄 | 左：`HH:mm` ｜ `kqw-mzdv-ptj`（`--fg`／`--fg-dim`）＋ connection 插槽小字；中：40px 圓形按鈕 ×6（底 `--bg-button-secondary`、白色 20px 圖示、hover `--bg-button-secondary-hover`）麥克風（靜音斜線）、攝影機（關閉斜線）、字幕、**分享畫面**（volunteer 插槽：可按時圖示白、按下開局；人數不足時 `opacity .5` 並在按鈕上方 12px 小字「等待其他玩家加入（n/2）」）、舉手、更多 ⋮（選單：切換偽裝…）；最右 離開通話：紅色膠囊 56×40 底 `#D93025`＝`--sem-error`（白字 4.8:1）、裝飾；右：資訊（Epic 6 起＝遊戲說明清單，工具提示「說明」）、使用者(N)（N＝counts.online）、訊息（切換面板，開啟時圖示 `--accent`）、活動 |
| 對話框 | 寬 420px | 白卡片 `--bg-panel` 圓角 8px、`--quickinput-shadow`、標題 20px `--fg-on-panel`、內文 14px、右下文字按鈕（`--accent-panel`，14px／500，hover `--bg-panel-hover`）：出題「輸入題目」（取消／分享）；放棄確認「停止分享畫面？」（繼續分享／停止分享，後者 `--sem-error`）；自動重連「正在重新加入通話…」單行 `role="status"` |

### 15.3 與其他主題的差異

- 圓角 8px（tile、面板、對話框）、控制列圓形按鈕、膠囊輸入列：本主題例外（§6 的 2px 圓角不適用）。
- 畫師時控制列不變色；畫師身分靠主畫面標籤、tile 外框與浮動工具列。
- 聊天訊息格式：`暱稱`（13px／500 `--fg-on-panel`；自己的訊息顯示「你」）＋ 右側 `HH:mm`（12px `--fg-on-panel-muted`）一行，內文 14px 換行；連續同人訊息只顯示一次名字（見下）；system 12px `--fg-on-panel-muted` 置中；correct `--sem-type` 加打勾；image 縮圖卡（同 §5 尺寸）。
- 工具列收合斷點 **1100px**（< 1100 一律收進「⋯」：完整工具列連膠囊內距約 493px，1085px 起主畫面 tile 才放得下；< 1024px 影片條移到下方也放不下）；vscode 810、ppt 500。
- 拖圖覆蓋層：`ChatView.overlayClassName`（選填，Epic 5 新增；預設＝§5 的 `--bg-selection` 0.35）；meet 為白底 `--bg-panel` 90%、2px 虛線與「放開以傳送圖片」文字皆 `--accent-panel`。
- 連續同人訊息只顯示一次名字：`ChatLineProps.groupWithPrevious`（選填，ChatPanel 計算：與前一則同 fromId 且兩則皆為 chat／image）；其他殼層忽略。
- 圖示：自繪 Material 風格線條圖示（16px 面板內、20px 控制列），不用 Google 圖示字型與商標；首頁卡片圖示為綠色攝影機 `--brand-meet`。
- 響應式：< 1024px 影片條改為主畫面下方橫向列（tile 寬 120px）；< 768px 右側面板改為覆蓋層，由「訊息」按鈕開關，預設開。
- 視窗標題 `Meet – kqw-mzdv-ptj`，作畫中前綴 `● `；favicon `favicon-meet.svg`（自繪攝影機）。

## 16. 遊戲說明（共通，Epic 6）

> 偽裝介面裡本來就有的「說明」假入口改成真的：ppt 功能區「說明」分頁、vscode 齒輪選單「說明…」、meet 底部「資訊」按鈕。規劃與內文：[plan/help-topics.md](plan/help-topics.md)。

- **內容一份**（`features/help/helpTopics.ts`），殼層只提供兩個名稱：「我來畫」按鈕文字（`volunteer.label`）與切換偽裝路徑（`ShellViews.help.switchHint`，不帶「…」）。
- **入口在所有寬度都可達**：除主入口（ppt「說明」分頁、vscode 齒輪、meet「資訊」）外，ppt「檔案」選單與 meet「更多 ⋮」選單各有第二項「說明…」（窄螢幕主入口隱藏時仍可開）。清單步驟右下有「關閉」；vscode 內文選項帶 Enter／Esc 提示。
- **兩步對話框**（既有 Dialog 加 `body`）：第一步標題「說明」、items＝六個主題；第二步標題＝主題、body＝段落、items「返回」「關閉」；Esc 關閉。ppt 的功能區按鈕直接跳第二步。
- **段落排版**：vscode 13px／行高 18px、段距 6px、`--fg`；ppt 與 meet 14px／行高 20px、段距 8px、`--fg`（meet 對話框在白卡片上用 `--fg-on-panel`）。內文最多約 6 行，不捲動。
- 對話框寬度、按鈕、鍵盤與各殼層既有對話框相同；不新增色碼。

## 17. 試算表主題（`data-theme="excel"`，Epic 13）

> 偽裝成一本開著的 Excel 活頁簿：左邊一張人員分數表、右邊一張浮在儲存格上的圖片、右側註解窗格。淺色 Office 風格，與 §13 同一家族，只有主色（綠）不同；**畫布仍固定黑底白筆**。字型與基準字級同 §13。規劃：[plan/excel-theme.md](plan/excel-theme.md)。

### 17.1 token 覆寫（同名 token，只列與 §13 ppt 不同者；未列者與 ppt 相同）

| token | 值 | 用途（Excel 對應） |
|-------|----|------|
| `--bg-titlebar` | `#217346` | 標題列（Excel 綠；白字 5.8:1） |
| `--border-focus` | `#217346` | focus 外框、作用中儲存格框、圖片選取控點 |
| `--accent` / `--accent-hover` | `#217346` / `#185C37` | 主要按鈕（白字 5.8:1／hover 8.0:1）；作用分頁與「工作表1」的綠字（白底 5.8:1） |
| `--bg-active` | `#DCEBE2` | 選取（畫師列底、作用分頁）；其上 `--fg`／`--fg-on-active` 12.4:1、`--accent` 4.7:1 |
| `--bg-selection` | `#C6E0CF` | 文字選取（`--fg` 10.9:1） |
| `--sem-function` | `#217346` | 畫師標記（「✎ 繪圖中」；畫師列 `--bg-active` 底 4.7:1、白底 5.8:1） |
| `--sem-string` | `#217346` | 揭曉的題目（註解窗格 `--bg-sidebar` 5.2:1、卡片白底 5.8:1） |
| `--grid-line` | `#E1E1E1` | 儲存格格線（新增 token；`:root`／ppt／meet 值＝各自 `--border`，未使用；裝飾線，白底 1.3:1） |
| `--bg-editor` | `#FFFFFF` | 工作表底（Excel 儲存格是白的；ppt 為灰工作區）；其上 `--fg` 15.3:1、`--fg-muted` 6.5:1、`--sem-type` 5.4:1；斷線字用 `--fg-muted` 6.5:1（§17.3；`--fg-dim` 只有 3.5:1，不用於承載資訊的文字） |
| `--brand-sheets` | `#217346` | 首頁「試算表」卡片圖示（跨主題共用 token，與 `--brand-*` 同列；圖形：首頁底 5.3:1、最暗紙面 4.6:1、白底 5.8:1） |

對比為實算值（龍骨 Phase 2 回寫，2026-10-06）；未列者同 §13.1（例：欄名列與列號 `--fg-muted` 在 `--bg-sidebar` 上 5.8:1）。

### 17.2 版面

```
┌──────────────────────────────────────────────────────────────────┐
│ 活頁簿1 - Excel                                   ⟳ 已連線  ─ □ ×│ ← 標題列 30px 綠
│ 檔案  常用  插入  頁面配置  公式  資料  校閱  檢視  說明  [圖片格式]   │ ← 功能區分頁 28px（畫師時「圖片格式」作用）
│ [● ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ | 粗細 ─●── 12 | 背景色 橡皮擦 復原 清空 放棄]│ ← 功能區內容 64px
│ 圖片 1   ▾ │ fx │                                                  │ ← 資料編輯列 26px
├────┬────────┬────┬────┬────┬──────────────────────────┬──────────┤
│    │   A    │ B  │ C  │ D  │  E   F   G   H   I   J   │ 註解     │
│ 1  │ 名稱   │分數│狀態│    │                          │ ┌──────┐ │
│ 2  │ 小明   │120 │✎   │    │  ┌────────────────────┐  │ │(B)Bob│ │
│ 3  │ 阿華(你)│ 80 │✓ +50│   │  │   圖片 1（畫布）    │  │ │是狗嗎│ │
│ 4  │ Carol  │  0 │離線│    │  │     黑底 16:9      │  │ └──────┘ │
│ 5  │        │    │    │    │  └────────────────────┘  │ 開始對話…│
├────┴────────┴────┴────┴────┴──────────────────────────┴──────────┤
│ 工作表1 │ 工作表2 │ 工作表3 │ ＋                                   │ ← 工作表分頁列 24px
│ 作畫中 01:23  題目：貓            平均值: —  計數: 3  加總: —  ▭ 100% │ ← 狀態列 22px
└──────────────────────────────────────────────────────────────────┘
```

| 區塊 | 尺寸 | 內容 |
|------|------|------|
| 標題列 | 30px | 「活頁簿1 - Excel」置中；右側連線狀態；作畫中標題與 `document.title` 前綴 `● ` |
| 功能區分頁 | 28px | 9 個固定分頁＋畫師作畫中出現的關聯式「圖片格式」（< 1024px 隱藏「頁面配置、公式、資料、檢視、說明」五個分頁，說明改由「檔案 → 說明…」進入；`excelLayout.ts` `RIBBON_TABS_HIDDEN_WHEN_NARROW`）（Excel 關聯式分頁有色底：底 `--bg-active`、上緣 2px `--accent`）；作用分頁規則同 §13.2；「說明」可作用（§16）；「檔案」開 Backstage 選單（切換偽裝…、說明…） |
| 功能區內容 | 64px | 「圖片格式」：畫師工具列（同 §13.2，非畫師看「常用」）；「常用」：裝飾群組（剪貼簿、字型、對齊方式、數值）＋最右群組「插入圖片」（14px 圖示＋標籤，圖示尺寸由功能元件決定，同 ppt）＝我來畫，人數不足時灰化＋「等待其他玩家加入（n/2）」；「校閱」：「顯示註解」切換窗格（< 768px 才有作用）；非畫師的「常用」不顯示灰化工具列（Excel 的常用分頁本來就沒有繪圖工具；與 ppt 不同） |
| 資料編輯列 | 26px | 名稱方塊 96px（畫師時「圖片 1」，否則「A1」）、`fx`、輸入框（底 `--bg-input`，裝飾、唯讀） |
| 工作表區 | 剩餘 | 底 `--bg-editor` 白；格線 `--grid-line`：列高 20px、欄寬 64px（A 欄 128px）；欄名列 20px 高、列號欄 32px 寬，底 `--bg-sidebar`、字 `--fg-muted` 12px 置中；人員表格佔 A–C 欄（§17.3）；「圖片 1」從 E 欄左緣、第 2 列上緣起，16:9 依剩餘寬高縮放（最大寬＝工作表區寬 − 表格 − 48px，最大高＝工作表區高 − 60px），1px `--border` 外框；畫師時 8 個 7px 圓形控點（白底 1px `--border-focus`）。**< 1024px**：依上式圖片太小（1024 時約 364px 寬、800 時 180px）難以作畫，改為「窄螢幕畫布優先」（同 ppt／meet）：圖片移到人員表格下方（A 欄左緣、第 n+3 列起，n＝玩家列數），寬＝工作表區寬 − 48px（左側 32px 列號欄＋右側留 16px）、高＝工作表區高 − 圖片上緣 − 20px（2026-10-06 龍骨 Phase 2 定案） |
| 右註解窗格 | 260px（< 1024px 220px；< 768px 覆蓋層） | 標題「註解」＋關閉 ×（裝飾）；訊息卡片、頭像、system、correct、圖片縮圖與 ppt §13.2 相同；輸入列 placeholder「開始對話」，上方功能提示小字同 ppt |
| 工作表分頁列 | 24px | 「工作表1」作用（底白、下緣 2px `--accent`、字 `--accent` 粗體）、「工作表2」「工作表3」、「＋」；純裝飾 |
| 狀態列 | 22px | 左：固定「就緒」＋roundStatus（idle 時「上一回合：X」；< 768px 隱藏，與其他主題一致）；右：「平均值: —」「計數: N」（N＝在線人數 counts）「加總: —」、顯示設定圖示、「100%」 |
| 對話框 | 寬 420px | Office 對話框（§13.2 同款）：出題「替代文字」（說明一行「為這張圖片輸入描述」、輸入框、「確定」「取消」）；放棄「刪除圖片？」（「刪除」主要、「取消」）；自動重連「開啟活頁簿」＋「正在重新加入…」；說明依 §16 |

### 17.3 人員表格（PlayerList view）

- 表頭列（第 1 列）：「名稱」「分數」「狀態」，粗體、底 `--bg-sidebar`、下緣 1px `--border`。
- 每位玩家一列（第 2 列起）：名稱（自己加「（你）」、自己粗體；斷線 `--fg-muted`）；分數右對齊 `tabular-nums`；狀態：畫師「✎ 繪圖中」`--sem-function`、已猜對「✓ +N」`--sem-type`、斷線「離線」`--fg-muted`（白底 6.5:1；`--fg-dim` 只有 3.5:1，不符 §9；2026-10-06 定案）、否則空白。
- 畫師列整列底 `--bg-active`；畫師的名稱格有 2px `--border-focus` 作用中儲存格框。
- 列數超過可見高度時表格區垂直捲動（圖片固定不捲）；格線與列號跟著表格捲動。

### 17.4 與其他主題的差異

- 工作表底是白的（ppt 工作區是灰的）；畫布黑底在白格線上像一張深色圖片。
- 非畫師時沒有灰化假工具列（「常用」分頁本來沒有繪圖工具）；畫師身分靠「圖片格式」分頁、圖片控點與人員表格的綠框。
- 工具列收合斷點 **500px**（2026-10-06 Phase 2 實測：「圖片格式」分頁整列給工具列，完整工具列約 469px、連群組內距 483px 起 scrollWidth ≤ clientWidth（482px 溢出 1px）；取 500px 留 17px 給字型差異；建置版驗證 499px 收合、500px 完整、無溢出）；vscode 810、ppt 500、meet 1100。
- 其餘 §6 元件規範（高度、圓角 2px、無動畫）沿用；圖示自繪 Office 風格線條，不用 Microsoft 商標。
