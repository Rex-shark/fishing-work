# Epic 6：遊戲說明（把偽裝介面裡的「說明」變成真的）

> 偽裝殼層裡本來就有「說明」這類假 UI，點下去改成真的遊戲說明：選主題、看說明

**狀態**：✅（2026-09-29 Rex 目視通過，結案）（2026-09-26 Phase 1 龍骨驗收通過：typecheck／test 79＋375＋714／build／lint 皆 0；vscode 02–11、ppt 18 張、首頁 9 張（含 resume 三殼層）與既有基準位元組相同；說明對話框新基準 scratchpad/epic6/help/（10 張，兩輪穩定）；舵手定案兩項修改（決策 6／8：切換偽裝內文、switchHint 去「…」、meet 更多／ppt 檔案選單加「說明…」）已完成，龍骨複驗通過：四項 0（79＋375＋718）；vscode 02–11、首頁 9、ppt 其餘 17、meet 其餘 17 位元組不變；新基準 scratchpad/epic6/help-v2/（10）、ppt-new/07、meet-v2/10 重截一致；待舵手驗收與 Rex 目視）（2026-09-26 舵手驗收通過；待 Rex 目視）
**起訖**：2026-09-26 ~ 2026-09-29
**負責**：Rex × 舵手（Helm，規格與計畫）× 龍骨（Keel，派工與驗收）

---

## 需求（Rex 2026-09-26）

> 「簡報的假 UI toolbar 裡有個『說明』是個假文字，既然有這個 UI 就利用他。改成能夠選擇，然後跳說明，例如如何切換偽裝、如何當畫家。」

1. ppt 功能區的「說明」分頁不再是裝飾：點了可以選說明主題，然後看到說明內容。
2. 主題至少包含「如何切換偽裝」「如何當畫師」。

**舵手擴充（假設，Rex 可砍）**：說明內容是共用的，vscode（齒輪選單）與 meet（「資訊」按鈕）本來也有對應的假入口，一併接上；每個殼層只多一個入口，內容同一份。

## 設計決策

- 決策 1：**說明內容是功能層的共用資料**：`features/help/helpTopics.ts` 定義主題清單（id、標題、段落），段落裡與殼層相關的名稱用佔位符（`{volunteer}`＝該殼層「我來畫」按鈕的文字、`{switch}`＝該殼層切換偽裝的路徑）由 `ShellViews` 提供的值代入。原因：內容一份、三個殼層共用；殼層只給名稱。
- 決策 2：**呈現＝既有 Dialog 兩步**：第一步「說明」清單（items＝主題）、第二步標題＝主題、內文＝段落、選項「返回」「關閉」；Esc 關閉。`DialogProps` 加選填 `body?: ReactNode`（段落），`DialogPurpose` 加 `'help'`。原因：三個殼層的對話框元件都在，只加一個內文區。
- 決策 3：**開啟方式＝App 注入 `ShellProps.help.open(topicId?)`**（同 `themes` 模式，殼層不 import uiStore）；`uiStore.helpTopic: 'list' | HelpTopicId | null`；`features/help/HelpDialog.tsx` 放進 `dialogs` 插槽。ppt 的功能區按鈕可直接 `open('switch-theme')` 跳到第二步。原因：與放棄確認框同一套機制。
- 決策 4：**各殼層入口**：ppt「說明」分頁變成可作用分頁，功能區內容為一排主題按鈕（Office 風格圖示＋標籤，一顆一主題），點按鈕開對話框；vscode 齒輪選單加「說明…」（開清單）；meet 底部「資訊」按鈕改為開清單（工具提示「說明」）。首頁 v1 不加。原因：Rex 指定 ppt；另外兩個殼層本來就有對應的假入口。
- 決策 5：**主題與內文（v1，Keel 逐字實作；Rex 看了再改）**：

| id | 標題 | 內文（段落以「／」分隔；`{volunteer}`、`{switch}` 由殼層代入） |
|----|------|------|
| `be-drawer` | 如何當畫師 | 房間至少 2 人在線時，畫面上會出現「{volunteer}」，按下去你就是本回合的畫師。／接著在 60 秒內輸入題目（1–20 字）並按 Enter，就開始作畫，時間 90 秒。／作畫中不能在聊天室說出答案，也不能傳圖片。 |
| `guess` | 如何猜題與計分 | 畫師作畫時，其他人在聊天室輸入答案，命中題目就算猜對；聊天室只會顯示「某某 猜對了」，不會洩漏答案。／猜對得 100 分，越晚猜對越少，最低 50 分；畫師每有一人猜對得 20 分。／全員猜對或 90 秒到就揭曉題目，5 秒後回到等待。 |
| `switch-theme` | 如何切換偽裝 | {switch}，選一個想要的介面風格；下次進入時首頁會預選它。／偽裝只影響你自己的畫面，其他人看到的是他們自己選的；畫布與聊天內容大家都一樣。 |
| `tools` | 畫師工具與放棄 | 作畫時的工具列有：顏色（色塊與色相條）、粗細滑桿、橡皮擦、復原、清空畫布。／「放棄本回合」會結束這回合並揭曉題目，其他人不得分。 |
| `image` | 傳圖片 | 把圖片拖進聊天室，或在輸入框貼上，單張 10 MB 以內。／圖片只即時顯示給當時在線的人，不保留；中途加入的人看不到。 |
| `reconnect` | 斷線與重新整理 | 斷線 15 秒內回來（含重新整理）會自動接回原本的暱稱與分數；超過就視為離開，畫師離開則回合結束。／同一個暱稱在別的分頁加入會接管，原分頁回到首頁。 |

- 決策 6：`ShellViews` 加選填 `help?: { switchHint: string }`：vscode「左下角齒輪 → 切換偽裝」（預設）、ppt「檔案 → 切換偽裝」、meet「更多 ⋮ → 切換偽裝」（**不帶「…」**，避免代入後連續標點）；`{volunteer}` 取 `volunteer.label`。
- 決策 8（2026-09-26 龍骨 Phase 1 提問定案）：(1) 「如何切換偽裝」第一段改為「{switch}，選一個想要的介面風格；下次進入時首頁會預選它。」，刪除「回到首頁」句（遊戲內沒有回首頁入口）；(2) 窄螢幕也要進得了說明：meet「更多 ⋮」選單與 ppt「檔案」選單各加第二項「說明…」（開清單），原入口保留；(3) 其他差異（清單步驟右下「關閉」、vscode 選項帶 Enter／Esc 提示、「說明…」為齒輪選單第二項）接受。
- 決策 7：契約、server、`shared` 不動；既有截圖（三殼層遊戲中、首頁、resume）位元組不變——ppt「說明」分頁未點時外觀不得改變。

---

## 任務清單

### Phase 1：內容、對話框、三個入口

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | `features/help/helpTopics.ts`：主題資料（決策 5）＋ `renderTopic(topic, { volunteer, switch })` 純函式（代入佔位符、切段）＋測試（每個主題有標題與 ≥ 1 段、佔位符全部代入、id 唯一） | 決策 1、5 |
| ✅ | `views.ts`：`DialogProps.body?`、`DialogPurpose` 加 `'help'`、`ShellViews.help?`；三個 Dialog 實作渲染 body（vscode：快速輸入框內 13px 段落、段距 6px；ppt／meet：14px 段落、段距 8px） | 決策 2、6 |
| ✅ | `uiStore.helpTopic`；`features/help/HelpDialog.tsx`（清單 → 內文 → 返回／關閉；Esc 關閉；焦點回到開啟它的按鈕由殼層處理或忽略）；App 把 `<HelpDialog/>` 放進 dialogs、注入 `ShellProps.help` | 決策 3 |
| ✅ | ppt：「說明」分頁可作用（點了成為作用分頁，功能區顯示一排主題按鈕；`RIBBON_TABS_HIDDEN_WHEN_NARROW` 維持）；按鈕 `open(id)` | 決策 4；DESIGN §13.2 |
| ✅ | vscode：ManageMenu 加「說明…」；meet：「資訊」按鈕 → `open()`，工具提示「說明」 | 決策 4；DESIGN §5、§15.2 |
| ✅ | shellBoundary：`features/help/**` 不含偽裝字樣（切換路徑來自 views）；殼層不 import uiStore | |
| ✅ | 驗證：typecheck／test／build／lint 0；三殼層遊戲中、首頁、resume 截圖與現有基準位元組相同；說明對話框三殼層各存新基準（清單、內文） | 決策 7 |

### Phase 2：驗證

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | 舵手瀏覽器實測（ppt 點「說明」→ 主題 → 內文 → 返回 → 關閉；vscode、meet 入口）；Rex 目視 | ；2026-09-26 舵手驗收 ✅：typecheck／test 79＋375＋718／build／lint 皆 0，shared／server 無 diff；內建瀏覽器（新 server 3181，ppt）：「說明」分頁作用中功能區六顆主題按鈕 → 「如何切換偽裝」對話框內文「檔案 → 切換偽裝，選一個想要的介面風格；下次進入時首頁會預選它。」→ 返回清單 → Esc 關閉且焦點回按鈕；「檔案」選單第二項「說明…」。2026-09-29 Rex 目視通過 |

---

## 驗收標準

- [x] `npm run typecheck`、`npm test`、`npm run build`、`npm run lint` 各自 exit 0
- [x] ppt 點「說明」分頁能選主題並看到說明；vscode 與 meet 也能開同一份說明
- [x] 說明內文的「我來畫」按鈕名稱與切換偽裝路徑隨殼層不同
- [x] 既有截圖位元組不變；契約與 server 未變
- [x] `spec/architecture.md` §7 與 `DESIGN.md` §16 與實作一致

---

## 派工規範（龍骨）

- 本檔與 `backlog.md` 只准局部替換；不 commit（Rex 自行）；子代理不得登記名冊、不得跨 session 傳訊；驗收前重啟 server 程序。
- 可與 Epic 5 決策 14（tile 分數膠囊只顯示總分）一起派。

---

## 踩雷紀錄

### Phase 1（2026-09-26，龍骨驗收）

- **zustand 在 `renderToStaticMarkup` 時讀的是初始狀態**（server snapshot 用 `getInitialState()`）：把對話框拆成純的 `HelpDialogView`（狀態由呼叫端傳入）來測完整流程。
- **ppt／meet 對話框原本把按鈕文字固定換成「確定／分享」「取消」**：說明對話框要依 purpose 分支才顯示得出「返回」「關閉」；未提供 body 時輸出以 sha256 對照 Epic 5 版逐字相同。
- **快速輸入框換步時沿用舊的反白位置**：同一元件實例保留 `active`，兩步各給 `key` 重新掛載。
- **react-hooks/refs 規則**：render 期間把讀 ref 的函式傳進 helper 會被擋，改為 helper 只回傳項目描述、呼叫放在事件閉包。
- **ppt「說明」由 span 改 button 截圖仍位元組相同**（class 相同、preflight 已重設 button），但窄螢幕隱藏的 class 要手動補到 button 上。
- **內文以佔位符代入時要注意標點**：`{switch}。` 代入「…切換偽裝…」後會出現「…。」連續標點。
- **說明內文與 plan 表逐字綁定**：測試每次解析 plan 決策 5 的表比對，plan 改了測試就會失敗（改內文要同步改實作）。
