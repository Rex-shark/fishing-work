# Epic 4：首頁（柔和 UI 選介面風格）

> 進遊戲前先看到一個不偽裝的柔和 UI 首頁：輸入暱稱、用卡片挑介面風格，選好才進偽裝殼層

**狀態**：✅（2026-09-25 完成：Rex 目視首頁「都正常」。2026-09-25 Phase 1 流程與資料龍骨驗收通過：typecheck／test 79＋375＋526／build／lint 皆 0，遊戲中截圖 vscode 02–11 與 Epic 3 基準位元組相同、ppt 18 張與同版重建的 Epic 3 流程位元組相同；Phase 2 首頁畫面龍骨驗收通過：typecheck／test 79＋375＋561／build／lint 皆 0，遊戲中截圖仍位元組相同，子代理瀏覽器行為 22 項 PASS；待舵手驗收與 Rex 目視）（2026-09-25 舵手驗收通過，含瀏覽器實測；`--home-on-accent` 收尾完成；Rex 目視通過）
**起訖**：2026-09-25 ~ 2026-09-25
**負責**：Rex × 舵手（Helm，規格與計畫）× 龍骨（Keel，派工與驗收）

---

## 需求（Rex 2026-09-25 需求修正）

> 「選擇 UI 畫面不是一開始就預設 VSCODE。是一個首頁，然後有不同的卡片（UI 風格）可以選。首頁風格使用柔和 UI。」

1. 一開始看到的**不是 VS Code 殼層**，而是一個**首頁**。
2. 首頁上有**不同的卡片（介面風格）**可以選；卡片圖示就是偽裝主題（Epic 3 需求延續）。
3. **首頁風格採柔和 UI**（Soft UI：淺色、圓角、柔和陰影）。
4. 其餘不變：暱稱即可加入、遊戲內仍可切換偽裝、畫布黑底白筆、契約與 server 不動。

## 設計決策

- 決策 1：**首頁是獨立畫面，不屬於任何殼層、不偽裝**。風格為「Soft UI Evolution」（ui-ux-pro-max 建議）：淺色底、白色卡片、圓角 12–16px、柔和多層陰影、文字對比 ≥ 4.5:1（不採純 neumorphism，對比不足）。原因：Rex 指定柔和 UI；偽裝從進入殼層那一刻開始。
- 決策 2：**首頁內容＝暱稱輸入＋風格卡片＋「進入遊戲」按鈕**。點卡片只做「選取」（寫入 localStorage `fishing-work:draw-guess:shell`），**首頁本身不隨風格改變外觀**；Enter 或按鈕才加入並以選取的殼層進遊戲。原因：Epic 3「點卡片即時重繪整個登入畫面」的所見即所得作廢（首頁不是殼層）；流程單純。
- 決策 3：**預選＝上次選的風格**（localStorage），沒有紀錄時預選第一張（`vscode`）。這只是卡片的預選，畫面仍是首頁，不是「預設 VS Code」。原因：回頭客少一次點擊。
- 決策 4：**自動重連期間不經首頁**。啟動或重連時若有 sessionStorage 憑證（`resuming`），App 直接渲染所選殼層的空白畫面＋一行「正在重新加入…」，成功即進遊戲；失敗（憑證失效、被其他分頁接管）才回首頁並顯示錯誤。原因：遊戲中重新整理不能閃出不偽裝的首頁。
- 決策 5：**文件層級隨畫面切換**：首頁時 `<html data-theme="home">`、`document.title` 為「fishing-work」、favicon 用預設 `favicon.svg`；進殼層時換成該主題的 `data-theme`／`titleFor`／`faviconHref`。`main.tsx` 在第一次繪製前依「是否有憑證」決定首次 `data-theme`（有 → 殼層；無 → home），避免閃爍。原因：首頁不偽裝，但分頁標題用中性的專案名即可。
- 決策 6：**首頁 token 獨立命名空間 `--home-*`**，放在 `theme.css` 的 `[data-theme='home']` 區塊（含 `color-scheme: light`），以 `@theme inline` 映射成 `home-*` class；**不重用殼層 token**。值見 DESIGN.md §14.2。原因：首頁不是偽裝，語意與殼層 token 不同，混用會讓兩邊互相牽制。
- 決策 7：**卡片描述文字由註冊表提供**：`ShellDefinition` 與 `ShellThemeOption` 新增 `description`（一行，≤ 20 字；vscode「深色程式編輯器，像在改程式碼」、ppt「白底簡報軟體，像在做投影片」），`PLANNED_THEMES` 項目同樣要有。首頁程式碼不得含任何偽裝字樣，`shellBoundary` 掃描範圍加入 `src/home/**`。原因：新主題只改註冊表。
- 決策 8：**程式碼位置 `draw-guess/src/home/`**（`HomeScreen.tsx`、`HomeThemeCards.tsx`、純函式）。可 import `shells/catalog`、`shells/types`、`shells/themeIcons`（經 catalog）、`layout/uiStore`、`layout/themeCardNav`、`socket/client`、`store/game`；**不得 import `shells/vscode`、`shells/ppt`、`shells/views`**（首頁在殼層之外，沒有 ShellViews）。`layout/ThemeCards.tsx`（IDE 樣式卡片）與 `features/lobby/NicknameScreen.tsx` 退場，鍵盤導覽純函式 `themeCardNav.ts` 沿用。原因：首頁既不是 feature 也不是 shell。
- 決策 9：**殼層的 `screen: 'login'` 改為 `screen: 'resume'`**：只剩 `notice`（「正在重新加入…」）與 `connection` 兩個插槽，沒有輸入框與卡片；`DialogPurpose` 的 `'join'` 與 `DialogProps.footer` 不再有使用者，可移除。原因：登入不再發生在殼層裡。
- 決策 10：**動態例外**：首頁允許 200ms 的陰影／邊框色／≤ 2px 位移 transition，並尊重 `prefers-reduced-motion`；殼層的 DESIGN §7 規則不變。原因：柔和 UI 的手感需要一點回饋，但首頁不偽裝所以不受 §7 限制。
- 決策 11：**遊戲中「切換偽裝…」入口不變；沒有「回首頁」**（v1 不做離開房間）。契約、server、`shared` 皆不動。

## 首頁版面（寫入 DESIGN §14）

| 區塊 | 內容 |
|------|------|
| 頁面 | 全視窗、可捲動；置中欄 max 640px；側邊 24px（< 480px 為 16px）；淺色底加兩處柔光漸層 |
| 標題 | 「我畫你猜」＋副標「輸入暱稱、挑一種介面風格，就能加入」 |
| 暱稱 | label「暱稱」、48px 高圓角輸入框、右側字數 `n/12`、下方錯誤文字（`role="alert"`）；Enter＝進入遊戲 |
| 介面風格 | 小標＋提示「只影響你自己的畫面，之後可在遊戲內切換」；卡片格 `repeat(auto-fill, minmax(220px, 1fr))`；卡片＝圓形淡色底 48px 圖示＋名稱＋描述；選取＝accent 邊框＋淡色底＋右上打勾徽章；不可選＝半透明＋「即將推出」膠囊 |
| 進入遊戲 | 全寬 48px 主按鈕；未連線／加入中 disabled；加入中顯示「加入中…」 |
| 連線狀態 | 一行小字：圓點＋「已連線」「正在連線到伺服器…」「連線中斷，重新連線中…」 |
| 頁尾 | 「fishing-work」小字 |

---

## 任務清單

### Phase 1：流程與資料（不做首頁外觀）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | 註冊表：`ShellDefinition`／`ShellThemeOption`／`PlannedTheme` 加 `description`；vscode、ppt 的 definition 與 catalog 填入；相關測試更新 | 決策 7 |
| ✅ | `store/game`：加 `resuming`（啟動時＝有憑證；`autoJoin` 失敗、`clearSession`、被踢 → false；`applyJoin` 成功後不影響）；`socket/client` 提供 `hasSavedSession()` | 決策 4；純邏輯要有測試 |
| ✅ | `App.tsx` 三分支：已加入 → 殼層 `game`；未加入且 `resuming` → 殼層 `resume`；否則 → `<HomeScreen/>`。分支判定抽成純函式 `pickScreen({ joined, resuming })` 並測試 | 決策 4 |
| ✅ | `ShellProps` 的 `'login'` 變體改為 `{ screen: 'resume'; notice; connection }`；VscodeShell／PptShell 的未加入分支只顯示 notice（建議：vscode 快速輸入框只放 note、ppt 對話框只放 note），移除輸入框與卡片列 | 決策 9 |
| ✅ | `shells/document.ts` 泛化為「套用文件主題」：接受 `home` 或殼層；`main.tsx` 首次繪製前依 `hasSavedSession()` 決定 `data-theme`；App 依畫面同步 `data-theme`／title／favicon | 決策 5 |
| ✅ | 驗證：typecheck／test／build／lint 0；遊戲中畫面（vscode 02–11、ppt 遊戲中）截圖與 Epic 3 基準**位元組相同** | 登入畫面截圖本來就會變，不比對 |

### Phase 2：首頁畫面

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | `theme.css`：`[data-theme='home']` 區塊（`color-scheme: light`、`--home-*`、`--font-home`）與 `@theme inline` 映射；`html, body` 的 `overflow: hidden` 在 home 下改為可捲動 | 決策 6；DESIGN §14.2 |
| ✅ | `home/HomeScreen.tsx`：標題、暱稱輸入（沿用 `join`／`rememberedNickname`／`nicknameDraft`、字數、錯誤）、風格卡片、「進入遊戲」、連線狀態、頁尾 | DESIGN §14.3 |
| ✅ | `home/HomeThemeCards.tsx`：沿用 `themeCardNav` 的 radiogroup／roving tabindex／←→／Home／End／Enter 規則，改為首頁樣式（描述文字、打勾徽章、即將推出膠囊）；刪除 `layout/ThemeCards.tsx` 與 `features/lobby/NicknameScreen.tsx` | 決策 2、8；DESIGN §14.3、§14.4 |
| ✅ | `shellBoundary`：掃描範圍加 `src/home/**`（同一份 FORBIDDEN 清單；不得 import shells/vscode、shells/ppt、shells/views）；`themeCatalog` 測試改測 `HomeThemeCards`；首頁 token 對比測試（承載資訊的文字 ≥ 4.5:1，值同 DESIGN §14.2） | 決策 7、8 |
| ✅ | 響應式：375px 單欄、無橫向捲動；`prefers-reduced-motion` 關閉位移 | DESIGN §14.4 |

### Phase 3：驗證

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | typecheck／test／build／lint 各自 exit 0 | 2026-09-25 龍骨自跑：79＋375＋561 皆過 |
| ✅ | 瀏覽器（新 server 程序）：首頁 → 選「簡報」→ 進入遊戲 → PPT 殼層；重新整理 → **不閃首頁**、直接回 PPT；第二分頁選「程式編輯器」→ vscode；同暱稱在第二分頁加入 → 第一分頁被踢回首頁並顯示錯誤；375px 首頁單欄 | 決策 2–5；2026-09-25 舵手驗收：typecheck／test 79＋375＋561／build／lint 皆 0；內建瀏覽器（新 server 3181）：無憑證首頁 data-theme home、title fishing-work、根字級 16px、卡片描述來自註冊表；輸入 Helm 選「簡報」Enter → PPT；重新整理仍 ppt、不見首頁、已重新加入；第二分頁預選簡報（localStorage 共用）改選程式編輯器 → vscode，第一分頁不受影響；第三分頁以同憑證接管 → 第二分頁回首頁、錯誤「此暱稱已在其他分頁或連線重新加入」、暱稱預填、憑證已清、title fishing-work；375px 單欄、卡片與按鈕 343px、側邊 16px、無橫向捲動 |
| ✅ | 遊戲中截圖與 Epic 3 基準位元組相同（vscode 02–11、ppt 遊戲中） | 首頁與 resume 畫面另存新基準。2026-09-25 龍骨 cmp：vscode 02–11 與 epic3/baseline、ppt 18 張與 epic4/phase1/e3flow-ppt-r1 全部位元組相同；首頁／resume 7 張正式基準 scratchpad/epic4/phase2/baseline/，兩輪位元組相同 |
| ✅ | 舵手驗收；Rex 目視首頁 | 舵手驗收 ✅（2026-09-25，見上列）；龍骨收尾 `--home-on-accent` ✅；2026-09-25 Rex 目視「都正常」 |

---

## 驗收標準

- [x] `npm run typecheck`、`npm test`、`npm run build`、`npm run lint` 各自 exit 0
- [x] 沒有憑證時第一眼是柔和 UI 首頁（Rex 目視），不是任何殼層；卡片圖示即偽裝主題，選取存本機、下次預選
- [x] 選好風格加入後直接進該殼層；遊戲中重新整理不閃首頁
- [x] 遊戲中畫面與 Epic 3 完成時位元組相同；契約與 server 未變
- [x] 首頁承載資訊的文字對比 ≥ 4.5:1；375px 可用
- [x] `spec/architecture.md` §7、`DESIGN.md` §14、`spec/overview.md` 與實作一致（§14.2 的 19 個 token 由 `homeTheme.test.ts` 逐字比對 theme.css）

---

## 派工規範（龍骨）

- 本檔與 `backlog.md` **只准局部替換**（Edit），不得整檔覆寫；狀態符號由改的人自己更新。
- 不 commit（Rex 自行 commit）。子代理不得登記名冊、不得跨 session 傳訊。
- 驗收前必重啟 server 程序（靜態檔新、驗證舊會誤判）。
- 色碼一律 token；首頁 token 值以 DESIGN §14.2 為準，要改先問舵手。

---

## 踩雷紀錄

### Phase 1（2026-09-25，龍骨驗收）

- **ppt 截圖基準不可直接沿用 Epic 3 的 `phase3c/ppt-r2`**：該腳本沒正規化時間文字（Epic 3 自己兩輪就不同），且基準早於 Epic 3 補件（等待文字、註解提示）。做法：scratchpad 複製原始碼只把登入流程還原成 Epic 3、重建當基準（先驗證還原版 vscode 01–11 與舊基準位元組相同），兩支腳本都加時間正規化，再比 E3 流程 vs E4 流程。
- **首頁操作不可留下滑鼠 hover 到遊戲中截圖**：vscode 腳本全程 DOM click；ppt 腳本 `clickAt` 後 `mouseAway`。
- **node 測試 import `socket/client` 前要 stub `location`、spy `socket.connect`**：模組載入即 `io('/draw-guess')`。
- **`resuming` 在模組載入時就設定**（`setResuming(hasSavedSession())`），早於 App 第一次渲染；`main.tsx` 在 `createRoot` 前套用文件主題，重新整理時 data-theme 序列為 `[null, 殼層]`，從未出現 home。
- **macOS `sed` 對多位元組字元的量詞只作用在最後一個 byte**：含 UTF-8 的正規式改用 python。

### Phase 2（2026-09-25，龍骨驗收）

- **首頁繼承殼層 13px 根字級**：rem 基準 13px 讓 Tailwind 尺寸全偏小（`h-12` 只有 39px、hover 位移 1.625px）；只在 `html[data-theme='home']` 把根字級改 16px。
- **Tailwind v4 位移用獨立的 `translate` 屬性**，transition 清單要寫 `translate` 不是 `transform`。
- **減少動態用 `motion-safe:` 開啟**，不要用 `motion-reduce:` 覆寫（同 variant 排序問題）。
- **柔光漸層會壓低疊在上面的文字對比**：`--home-error` 疊在 `--home-tint-1` 上只有 4.13:1；左上柔光垂直半徑限 180px，讓窄螢幕錯誤列只落在純 `--home-bg`（4.6:1），測試守著。
- **index.html 內嵌腳本的鍵名是字面值**：守門測試讀 index.html 原文比對 `SESSION_KEY`／`SHELL_STORAGE_KEY`，並以假 storage 執行腳本對照 `initialDocumentTheme`。
- **「只准 home-* class」掃描要允許 `shadow-home` 這種值剛好是 `home` 的 class**。
- **收尾（2026-09-25 龍骨自改）**：依舵手定案新增 `--home-on-accent: #FFFFFF`＋`--color-home-on-accent` 映射，主按鈕文字與打勾徽章由 `text-home-surface` 改 `text-home-on-accent`；`homeTheme.test.ts` 的 DESIGN 表 token 數 18→19、映射清單與對比組合（on-accent／accent、accent-hover）同步。typecheck／test 79＋375＋561／build／lint 皆 0；首頁／resume 7 張以新 build 重截與正式基準位元組相同（值相同、不改外觀）。守門測試逐字比對 DESIGN 表的好處：DESIGN 加 token 而 CSS 沒加會立刻失敗。
