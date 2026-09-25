# DESIGN.md — 視覺設計指南

> 目的：讓「我畫你猜」在上班時間打開也像在用程式編輯器。**做任何畫面、元件、樣式之前先讀本檔。**
> 基底：**VS Code Dark+**。2026-09-24 Rex 授權舵手（Helm）決定，Rex 看成品後微調（微調記錄在第 12 節）。
> 2026-09-25 起為**多偽裝主題**：§1、§2、§6–§11 為共通原則；§3–§5 是 `vscode` 主題；§13 是 `ppt` 主題。新主題各加一節。
> 2026-09-25 Rex 需求修正：進遊戲前的**首頁不偽裝、採柔和 UI**（§14），在首頁以卡片選風格後才進偽裝殼層。
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
| 分頁列 | 高 35px | 作用中 `canvas.ts`（作畫中時檔名後加 `●` 取代 `×`，仿未儲存；視窗標題則為前綴 `● `）；非作用 `README.md` 裝飾。右側：**畫師工具列**（僅畫師可見）：目前色圓點、8 個 16px 預設色塊（`PALETTE`）、**色相條**（寬 96px、高 10px 的彩虹漸層，圓形把手，拖曳或點擊選色）、**粗細滑桿**（寬 80px 的細軌道，拖曳左右，把手旁顯示數值，`1–64`）、橡皮擦（再按一次切回畫筆）／復原／清空／放棄圖示按鈕；沒有獨立的「畫筆」鈕。選色即回畫筆。工具列寬度不足時（< 1100px）色相條與滑桿收進「⋯」彈出面板 |
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
| 投放覆蓋層（拖曳中） | 整個 TERMINAL 面板蓋一層 `--bg-selection` 半透明（0.35）、2px 虛線 `--border-focus`、置中文字「放開以傳送圖片」；放開或離開即消失，無動畫 | `--fg` |
| 本地錯誤（不廣播） | `✗ 不可洩題` | `--sem-error` |
| 時間戳（可選） | `[14:32]` 靠左 | `--fg-dim` |

輸入列：提示符 `❯`（`--sem-type`）＋透明底、無邊框的輸入框，Enter 送出。

> 實作位置（Epic 3 起）：本表的終端機格式（`// ` 前綴、`❯`、`[HH:mm]`）由 vscode 殼層的 `ChatView`（`shells/vscode/TerminalChat`）提供；功能元件只產生 `ChatLineData`（kind／nickname／text／time／isMine／reveal／image），各主題自行渲染。

### 畫面

- **自動重連畫面**（Epic 4 起取代暱稱畫面；暱稱輸入改在首頁 §14）：殼層先渲染（側欄空、無分頁、面板空），視窗頂部置中同樣的**快速輸入框**（寬 600px），只有一行 `// 正在重新加入…`（`role="status"`），沒有輸入框與選項；成功即進遊戲，失敗回首頁顯示錯誤。
- **放棄回合**：同樣的快速選單確認，兩個選項「放棄本回合」（預設反白，Enter 即放棄）與「繼續作畫」（Esc）。不用 `window.confirm`。
- **出題**：同樣的快速輸入框，placeholder「輸入題目（1–20 字）後按 Enter」，Esc = 放棄。
- **回合結束**：不用 modal。終端機多一行揭曉訊息，狀態列顯示「揭曉」5 秒。
- **視窗標題**（`document.title`）：`canvas.ts - fishing-work`；作畫中前綴 `● `。favicon 用一般文件圖示。

## 6. 元件規範

| 元件 | 規範 |
|------|------|
| 主要按鈕 | 底 `--accent`、hover `--accent-hover`、字白、高 26px、內距 0 12px、圓角 2px |
| 次要按鈕 | 底 `--bg-button-secondary`、hover `--bg-button-secondary-hover`、字 `--fg` |
| 圖示按鈕 | 22×22、hover 底 `--bg-hover`、圓角 3px；**一律有工具提示** |
| 工具提示（Tooltip） | 仿 VS Code hover：底 `--bg-quickinput`、1px `--border`、字 `--fg` 12px、內距 2px 8px、圓角 3px、陰影 `--quickinput-shadow`；hover 300ms 後或 focus 立即顯示，指標離開或**點擊**即消失（滑桿拖曳中除外，否則會蓋住「⋯」面板）、無動畫；內容為功能名稱：遊戲功能用中文（「橡皮擦」「復原」「清空畫布」「放棄本回合」「粗細 12」「顏色 #FF8C00（橘）」「目前顏色 #00FF51」「色相 139° #00FF51」），偽裝用的裝飾圖示用英文（Search、Source Control、Extensions、Accounts、Manage、New Terminal、More Actions...、Split Editor Right、Notifications）；元素同時帶 `aria-label`（EXPLORER 用中文） |
| 滑桿 | 軌道高 2px 底 `--border`、已選段 `--accent`、把手 10px 圓 `--fg`；focus 外框 `--border-focus`；鍵盤 ←/→ 每次 1、Shift 每次 8 |
| 色相條 | 96×10px 彩虹漸層（`linear-gradient(to right, hsl(0..360))`）、圓角 5px、把手 12px 圓白框；範圍 0–359°；鍵盤 ←/→ 每次 5°、Shift＋方向鍵或 PageUp/PageDown 每次 30°、Home/End 到兩端 |
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
| `--focus-on-color` | `#FFFFFF` | 橘紅標題列上的 focus |
| `--font-code` | 無襯線堆疊（見上） | 全站字型 |

### 13.2 版面

```
┌──────────────────────────────────────────────────────────────┐
│ 簡報1 - PowerPoint                              ⟳ 已連線  ─ □ ×│ ← 標題列 30px 橘紅
│ 檔案  常用  插入  設計  轉場  動畫  投影片放映  校閱  檢視  繪圖  說明 │ ← 功能區分頁 28px
│ [筆 ● ■ ■ ■ ■ ■ ■ ■ ■ | 色相 ▬▬ | 粗細 ─●── 12 | 橡皮擦 復原 清空 放棄]│ ← 功能區內容 64px（繪圖分頁）
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
| 功能區分頁 | 28px | 11 個分頁文字；畫師時「繪圖」作用（底白、上緣 2px `--accent`），否則「常用」作用 |
| 功能區內容 | 64px | 「繪圖」：畫師工具列（預設白筆，跨主題一致；色塊、色相條、粗細滑桿、橡皮擦、復原、清空、放棄）；非畫師時整組灰化（`opacity .4`、不可點）。「常用」：裝飾性按鈕群（新增投影片、版面配置、字型…）純裝飾 |
| 左縮圖窗格 | 寬 180px | 玩家清單：編號＋16:9 縮圖卡（白底 1px `--border`），卡內暱稱（粗體）與分數（右下小字）；畫師卡外框 2px `--accent`；已猜對右上綠勾；斷線中 `opacity .5`；自己的卡底 `--bg-active` |
| 中央 | 剩餘 | 灰工作區置中投影片（畫布，底色固定黑 `CANVAS_BACKGROUND`，畫師預設白筆），`--border` 1px 外框＋ `0 1px 3px rgba(0,0,0,.15)` 陰影（PowerPoint 投影片本身有陰影，屬本主題例外） |
| 備忘稿列 | 28px（投影片下方） | 「備忘稿：」＋階段、倒數、題目／字數提示、本回合分數；idle 顯示「上一回合：X」 |
| 右註解窗格 | 寬 260px | 標題「註解」；訊息卡片（底 `--bg-card`）：24px 圓形頭像（暱稱首字、底色依暱稱雜湊取 `--avatar-1..6`）、暱稱粗體、時間 `--fg-dim`（裝飾）、內文；自己的卡片底 `--bg-active`；system 為灰字單行無卡片；correct 卡片左側綠勾；圖片卡片內縮圖 200px；底部「新增註解…」輸入框＋送出鈕，**輸入框上方一行 12px `--fg-muted` 小字顯示功能提示**（「輸入答案或聊天」／「畫師不可說出答案」），placeholder 維持「新增註解…」保偽裝 |
| 狀態列 | 22px | 左：「投影片 N / M」（N 在線人數、M 玩家數）、「中文(台灣)」、「備忘稿」；中：**「▶ 從目前投影片開始」＝我來畫**（人數不足灰化＋「等待其他玩家加入（1/2）」，用詞與 vscode 一致）；右：「顯示設定」「▭ 62%」裝飾 |
| 對話框 | 寬 420px | 出題／放棄確認／自動重連：白底、標題列（「輸入標題」「捨棄變更？」「加入簡報」）、內文、右下「確定」（主要）「取消」；Enter／Esc 對應；自動重連對話框（Epic 4）只有標題「加入簡報」與一行「正在重新加入…」（`role="status"`），暱稱輸入在首頁 §14 |

### 13.3 與 vscode 主題的差異

- 狀態列不因畫師變色；畫師身分靠縮圖橘框與「繪圖」分頁作用。
- 狀態列項目：`text-fg`、hover `--statusbar-hover`、focus `--border-focus`（不用 vscode 的白字白框）。
- 工具列收合斷點 640px（PPT 功能區整列給工具列，完整寬約 533px）；vscode 為 1100px。
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

圖示為自繪 SVG 線條／色塊，不使用 VS Code 或 Microsoft 商標。

## 14. 首頁（`data-theme="home"`，Epic 4）

> 首頁**不偽裝**（Rex 2026-09-25 需求修正）：柔和 UI。只在「未加入且沒有重連憑證」時顯示；自動重連不經首頁（直接顯示所選殼層的空白畫面＋「正在重新加入…」）。規劃：[plan/home-page.md](plan/home-page.md)。

### 14.1 風格

Soft UI Evolution（ui-ux-pro-max 建議；不採純 neumorphism，對比不足）：淺色底加柔光漸層、白色卡片、圓角 12–16px、柔和多層陰影、承載資訊的文字對比 ≥ 4.5:1；系統無襯線字（不下載網路字型）；**根字級 16px**（殼層為 13px；home 下 `html` 改 16px，rem 尺寸才正確）。

### 14.2 token（`theme.css` 的 `[data-theme='home']`，命名空間 `--home-*`；不重用殼層 token）

| token | 值 | 用途（對比為實算值） |
|-------|----|------|
| `--home-bg` | `#F4F5FA` | 頁面底 |
| `--home-tint-1` | `#E4E8FA` | 左上柔光（`radial-gradient`，裝飾） |
| `--home-tint-2` | `#E2F3EA` | 右下柔光（裝飾） |
| `--home-surface` | `#FFFFFF` | 卡片、輸入框底 |
| `--home-surface-hover` | `#FAFBFF` | 卡片 hover 底 |
| `--home-fg` | `#2B2F3A` | 主要文字（白底 13.4:1、頁面底 12.3:1） |
| `--home-fg-muted` | `#5F6673` | 說明文字（頁面底 5.3:1、選取卡片底 5.1:1） |
| `--home-fg-dim` | `#9CA3AF` | 裝飾小字（字數計、頁尾；不受 4.5:1 約束） |
| `--home-border` | `#E3E6EF` | 1px 邊框 |
| `--home-accent` | `#4F5FD9` | 主按鈕底、選取邊框、focus 外框（白字 5.3:1） |
| `--home-accent-hover` | `#4352C4` | 主按鈕 hover（白字 6.5:1） |
| `--home-accent-soft` | `#EEF0FC` | 選取卡片底 |
| `--home-on-accent` | `#FFFFFF` | `--home-accent` 底上的前景（主按鈕文字、打勾徽章）；不沿用 `--home-surface`，兩者語意不同 |
| `--home-error` | `#C93B3B` | 錯誤文字（白底 5.0:1、頁面底 4.6:1） |
| `--home-ok` | `#1F7A4D` | 已連線圓點（4.9:1） |
| `--home-shadow` | `0 1px 2px rgba(31, 41, 55, 0.04), 0 8px 24px rgba(31, 41, 55, 0.08)` | 卡片、輸入框 focus 前 |
| `--home-shadow-hover` | `0 2px 4px rgba(31, 41, 55, 0.06), 0 12px 32px rgba(31, 41, 55, 0.12)` | 卡片 hover |
| `--home-radius` | `16px` | 卡片；輸入框與按鈕 12px、膠囊 999px |
| `--font-home` | `system-ui, 'Segoe UI', 'Microsoft JhengHei', 'PingFang TC', sans-serif` | 全頁字型（與 ppt 同堆疊） |

卡片圖示沿用跨主題 token `--brand-editor`／`--brand-slides`（§13.4；圖示為圖形，≥ 3:1 即可）；圖示底的圓形淡色底以 `color-mix(in srgb, currentColor 12%, var(--home-surface))` 產生（currentColor 即圖示的 `--brand-*`，新主題不必加規則），不另加色碼。

### 14.3 版面

- **頁面**：全視窗、可捲動（`html, body` 的 `overflow: hidden` 在 home 下解除）；置中欄 max 640px，側邊 24px（< 480px 為 16px）；內容垂直置中，高於視窗時從頂端排。底色 `--home-bg` 加左上 `--home-tint-1`（ellipse 480×180）、右下 `--home-tint-2`（ellipse 520×360）兩處 `radial-gradient` 柔光；左上垂直半徑限 180px，讓錯誤文字所在列落在純 `--home-bg` 上（`--home-error` 疊在 tint-1 只有 4.1:1；測試守著）。
- **標題**：「我畫你猜」28px／600 `--home-fg`；副標「輸入暱稱、挑一種介面風格，就能加入」15px `--home-fg-muted`。
- **暱稱**：label「暱稱」14px／500；輸入框高 48px、圓角 12px、底 `--home-surface`、1px `--home-border`、字 16px、placeholder `--home-fg-dim`；focus 為邊框轉 `--home-accent` 加 2px `--home-accent` outline（offset 0）；右側字數 `n/12` 12px `--home-fg-dim`（超過改 `--home-error`）；錯誤在下方 13px `--home-error`、`role="alert"`。Enter＝進入遊戲。
- **介面風格**：小標「介面風格」14px／500，提示「只影響你自己的畫面，之後可在遊戲內切換」12px `--home-fg-dim` 放小標右側、窄螢幕換到下一行。卡片格 `grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))`、gap 16px。每張卡片：底 `--home-surface`、圓角 `--home-radius`、內距 20px、1px `--home-border`、`--home-shadow`；左上 64px 圓形淡色底（§14.2 的 `color-mix`）放 48px 圖示；名稱 16px／600 `--home-fg`；描述（註冊表 `description`）13px `--home-fg-muted`。**選取**：2px `--home-accent` 邊框（以 `box-shadow: inset 0 0 0 2px` 或 outline 實作，不改尺寸）＋底 `--home-accent-soft`＋右上 20px 圓形 `--home-accent` 底 `--home-on-accent` 打勾（SVG）。**hover**（可選者）：底 `--home-surface-hover`、`--home-shadow-hover`、`translateY(-2px)`。**不可選**（即將推出）：`opacity .55`、`cursor: default`、右上「即將推出」膠囊（12px、1px `--home-border`、`--home-fg-dim`）。
- **進入遊戲**：全寬、高 48px、圓角 12px、底 `--home-accent`、字 `--home-on-accent` 16px／600；hover `--home-accent-hover`；未連線與加入中用原生 `disabled`（`opacity .5`、`cursor: default`；首頁不偽裝、沒有 Tooltip，不必用 aria-disabled）；加入中顯示「加入中…」。
- **連線狀態**：一行 13px `--home-fg-muted`：8px 圓點（已連線 `--home-ok`，其他 `--home-fg-dim`）＋文字「已連線」「正在連線到伺服器…」「連線中斷，重新連線中…」；`aria-live="polite"`。
- **頁尾**：「fishing-work」12px `--home-fg-dim`。

### 14.4 動態與可及性

- **動態例外**（決策 10）：允許 200ms `transition`（陰影、邊框色、底色、≤ 2px 位移）；`prefers-reduced-motion: reduce` 時關閉位移。無彈跳、無音效。
- **鍵盤**：卡片 `role="radiogroup"`／`role="radio"`＋`aria-checked`、roving tabindex、←／→（↑／↓）移動即選取並略過不可選、Home／End、Space／點擊選取、Enter＝進入遊戲（沿用 `layout/themeCardNav.ts`）；Tab 順序 暱稱 → 卡片 → 進入遊戲；focus 為 2px `--home-accent` 外框、offset 2px，永遠可見。
- 卡片描述直接寫在卡片上，**不用 Tooltip**（Tooltip 是殼層元件）。
- 對比：承載資訊的文字 ≥ 4.5:1（值見 §14.2）；顏色不是唯一訊息載體（選取有打勾徽章、不可選有文字膠囊）。
- **響應式**：375px 單欄、按鈕全寬、無橫向捲動；≥ 640px 兩欄卡片。

### 14.5 文件層級與流程

- 首頁：`<html data-theme="home">`、`document.title`「fishing-work」、favicon `favicon.svg`；進殼層即換成該主題的值（`shells/document.ts`）。`main.tsx` 第一次繪製前依「是否有重連憑證」決定 `data-theme`（有 → 所選殼層；無 → home）。在此之前 `index.html` 的 `<head>` 最前面（CSS 之前）有 6 行內嵌腳本先設 `data-theme`（只判斷 session 鍵是否存在、不驗 JSON：有 → localStorage 的主題原字串或 vscode；無或任何例外 → home），不做 title 邏輯；靜態 `<title>` 為中性「fishing-work」。守門測試比對兩個 storage 鍵名（`SESSION_KEY`、`SHELL_STORAGE_KEY`）並以假 storage 執行腳本對照 `initialDocumentTheme`。
- 自動重連（有憑證）期間顯示所選殼層的空白畫面與「正在重新加入…」（`ShellProps` 的 `screen: 'resume'`），不顯示首頁；失敗才回首頁並顯示錯誤。
