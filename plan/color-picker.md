# Epic 11：顏色面板（取代工具列的色相條）

> 畫師按「目前顏色」打開一個顏色面板：大面積的飽和度／明度方塊＋寬色相條，看得清、選得準；三個殼層共用

**狀態**：✅（2026-10-07 Rex 目視「都可以」，結案）（2026-10-03 acceptance-reviewer 驗收**通過**：四項 0（80／400／766）、shared／server 無 diff、協定 phase1 24／phase2 33／background 14、三殼層瀏覽器實測全 PASS（面板 token、拖方塊深色 `#4A0F0F` 與粉彩、色相條、鍵盤、Esc／點外／縮放關閉、色塊反推把手與選取框、斷點 ±1px、ppt 灰化鈕、說明內文）、console 無錯誤；文件差異已由舵手回寫；**待 Rex 目視**）（2026-10-03 Phase 1、2 龍骨子代理完成：四項 0、斷點初值 vscode 790／ppt 490／meet 1090（後改 810／500／1100）、三殼層互動 19/19；龍骨複驗通過（四項 0：80＋400＋765；shared／server 無 diff、Epic 10 檔案 sha 未變；重截三殼層與新基準位元組相同、非工具列畫面與改動前相同；互動腳本三殼層各 20/20）；`hexToHsv` 不取整已定案（舵手 2026-10-03）；收尾：斷點留餘裕改 vscode 810／ppt 500／meet 1100、說明「畫師工具與放棄」同步，四項 0（80＋400＋766）；龍骨複驗收尾通過（重截三殼層 27 張與 epic11 新基準／v2 位元組相同、互動腳本新斷點各 20/20）；待 acceptance-reviewer 驗收）
**起訖**：2026-10-03 ~ 2026-10-07
**負責**：Rex × 舵手（Helm，規格與計畫）× 龍骨（Keel，派工）× acceptance-reviewer（驗收）

---

## 需求（Rex 2026-10-03）

> 「畫筆選擇顏色修正：現在換顏色是用水平拖曳，這樣很難選到想要的顏色。修改方式你決定：1. 改成跳出一個調色盤自己選顏色；2. 原本的選色點下去之後放大；3. 你設計。」

- 現況問題：色相條只有 96px 寬卻要涵蓋 360°，每 1px 跳約 4°，拖到想要的顏色很難；而且只能選 `hsl(h, 100%, 50%)` 的純色，沒有深色、淺色、粉彩。
- 舵手決定：**選項 1**，做成工具列內的**彈出顏色面板**（不是瀏覽器原生 `<input type="color">`：各平台長相不同、無法套主題、Windows 會跳出系統對話框破壞偽裝）。工具列上的色相條**移除**，由面板取代。

## 設計決策

- 決策 1：**入口＝工具列最左的「目前顏色」改成按鈕**（22×22 圖示按鈕，裡面是 14px 的目前色圓點，1px `--border` 外框）。點擊開啟面板、再點或 Esc 關閉；`aria-haspopup="dialog"`、`aria-expanded`。提示與 `aria-label`：「選擇顏色（目前 #XXXXXX）」。原因：目前色本來就在那裡，點它選顏色最直覺；色塊照舊一鍵快選。
- 決策 2：**面板內容**（由上而下，寬 232px、內距 8px，複用「⋯」面板的外觀：`--bg-quickinput`、1px `--border`、圓角 3px、`--quickinput-shadow`、portal 到 body、`position: fixed`、以 `placeFloating` 定位在按鈕下方；點面板外、Esc（focus 回按鈕）、視窗縮放時關閉）：
  1. **飽和度／明度方塊** 216×132px、圓角 3px：底為目前色相的純色，疊 `linear-gradient(to right, #FFF, transparent)` 與 `linear-gradient(to top, #000, transparent)`（HSV：x＝飽和度 0–100、y＝明度 100–0）；把手 12px 圓、2px 白框、填目前色；指標按下／拖曳即選（`setPointerCapture`，拖出方塊 clamp）。
  2. **色相條** 216×12px：沿用 `HueSlider`（寬度改由 props 提供），鍵盤規則不變。
  3. **底列**：目前色預覽 22×22（圓角 3px、1px `--border`）＋色碼 `#RRGGBB`（等寬 13px `--fg`，只顯示不可輸入）。
  面板裡每一次變動都**立即**套到畫筆（`setBrush`）並切回畫筆工具，不需要「確定」。原因：與現在的即時選色一致；少一步。
- 決策 3：**顏色模型用 HSV**：store 的 `brush` 由 `{ tool, color, size, hue }` 改為 `{ tool, color, size, hue, sat, val }`（`sat`、`val` 0–100；預設白＝`hue 0, sat 0, val 100`）。`color` 永遠＝`hsvToHex(hue, sat, val)` 的大寫 `#RRGGBB`；面板拖曳與鍵盤只產生**整數**，點預設色塊時反推 `hexToHsv` 寫回三個值且**不取整**（2026-10-03 定案：整數 HSV 表示不了 `#FFECEA` 等色塊，取整會讓 color 差 1–2／255、色塊選取外框消失；顯示時四捨五入；灰階時色相保留原值）。純函式 `hsvToHex`、`hexToHsv` 放 `features/canvas/brush.ts` 並有單元測試（任意色往返逐字相同；整數格點 → 色碼每 channel 誤差 ≤ 1／255）。原因：方塊＋色相條就是 HSV；保留 hue 讓方塊在 `sat = 0` 時不會跳色相。
- 決策 4：**方塊的鍵盤操作**：方塊本身 `role="slider"`、`tabIndex=0`、`aria-label="飽和度與明度"`、`aria-valuenow` 給飽和度、`aria-valuetext="飽和度 80%、明度 60%"`（兩者都唸）；←/→ 飽和度 ±2、↑/↓ 明度 ±2、Shift 或 PageUp／PageDown ±10、Home／End 飽和度 0／100。原因：ARIA 沒有現成的二維滑桿角色，鍵盤能用、讀得出數值即可。
- 決策 5：**工具列移除色相條**：完整版工具列＝目前顏色鈕、10 色塊、分隔線、粗細滑桿、分隔線、背景色、橡皮擦、復原、清空、放棄；窄版「⋯」面板只剩粗細。工具列因此窄約 108px，**三個殼層的 `compactBelowPx` 重新實測**（規則同 Epic 7：在該寬度下完整工具列放得下、容器 `scrollWidth ≤ clientWidth`，取 10 的倍數的最小值，**再留約 15–20px 餘裕**給字型差異；2026-10-03 定案：實測 vscode 790／ppt 483／meet 1085 起放得下 → 取 **810／500／1100**），實測後回寫 DESIGN（§8、§13.3、§15.3）。ppt 出題時的灰化假工具列（`PptShell` 的 `DrawRibbon`）同步：拿掉色相條、放灰化的目前顏色鈕。原因：一種自訂顏色的方式就好；工具列更短，更多寬度不必收合。
- 決策 6：**殼層不動**：面板用既有 token（三主題各自已有 `--bg-quickinput`、`--border`、`--quickinput-shadow`），不新增 token、不改 `ShellProps`；面板裡的顏色（方塊漸層、把手、預覽）是遊戲資料，以 style 帶入（同 DESIGN §10 既有例外）。
- 決策 7：**不做**：最近使用的顏色、吸管、色碼輸入框、透明度。列入 backlog 候選。
- 決策 8：**契約、server 不動**（顏色仍是任意 `#RRGGBB`，spec §4 `COLOR_PATTERN`）。

## 文件變更（舵手已寫）

- `spec/architecture.md` §6「顏色」、§7 `store/game.ts` 的 brush 欄位。
- `DESIGN.md` §5 分頁列工具列描述、§6 新增「顏色面板」列、「色相條」列改為面板內元件、工具提示例子；§8／§13.3／§15.3 的斷點由龍骨實測後回寫。

---

## 任務清單

### Phase 1：純函式與狀態

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | `brush.ts`：`hsvToHex(h, s, v)`、`hexToHsv(hex)`（灰階保留傳入的色相）、方塊的指標位置 → `{ sat, val }`、鍵盤 → `{ sat, val }` 純函式；測試（往返、邊界、PALETTE 10 色反推再轉回逐字相同） | 決策 3、4。2026-10-03 龍骨子代理：另有 `svFromPointer`、`svKeyValue`、`svLabel`、`colorButtonLabel`；`hexToHsv` 回傳**不取整**的精確值（見踩雷紀錄，已定案（舵手 2026-10-03））；PageUp／PageDown 定為飽和度 ±10（舵手確認） |
| ✅ | `store/game.ts`：brush 加 `sat`、`val`；`setBrush` 不變；`initialBrush` 為白；測試更新 | spec §7。點色塊時 `hexToHsv(color, 目前色相)` 寫回三值 |

### Phase 2：面板與工具列

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | `features/canvas/ColorPanel.tsx`：面板（方塊、色相條、底列）、開關與定位（複用 `MoreBrushMenu` 的做法，可抽成共用 hook）、鍵盤 | 決策 2、4。共用 hook `features/canvas/useFloatingPanel.ts`（定位、開啟 focus 第一個滑桿、點外／縮放關閉、Esc 還焦點），「⋯」面板也改用；面板內距與列距用 px（`p-[8px]`、`gap-[8px]`），外框內 232px、含 1px 外框 234px |
| ✅ | `ToolBar.tsx`：`CurrentColor` 改成按鈕＋面板；移除 `HueControl`；「⋯」面板只剩粗細；`Slider.tsx` 的 `HueSlider` 寬度改 props | 決策 1、5。「⋯」提示改「更多畫筆設定（粗細）」；`HueSlider` 只剩面板使用：寬由 props、高 12px（圓角 6px），鍵盤不變 |
| ✅ | `PptShell` 的 `DrawRibbon` 灰化假工具列同步 | 決策 5。拿掉色相條；最前面的畫筆圖示換成灰化目前顏色鈕（22×22 內 14px 圓點，填 `PALETTE[0]`；殼層不讀 store） |
| ✅ | 三殼層實測 `compactBelowPx`，降到放得下的最小 10 倍數；回寫 `shells/*` 的值與註解、DESIGN §8／§13.3／§15.3 | 決策 5。實測最小放得下 vscode 790、ppt 483、meet 1085；舵手 2026-10-03 定案留餘裕：vscode 1120 → **810**、ppt 640 → **500**、meet 1280 → **1100**（餘裕約 20／17／15px；meet 不再共用 `MEET_BREAKPOINTS.stripNarrow`）；量測方法與數據見踩雷紀錄。DESIGN 回寫 §13.3、§15.3（§8 由舵手寫）；真實建置驗證斷點 −1px 收合、斷點與 +1px 完整、容器與頁面不溢出 |
| ✅ | 驗證：`typecheck`／`test`／`build`／`lint` 各自 exit 0；三殼層畫師開面板、拖方塊與色相條、鍵盤操作、Esc／點外關閉、點色塊後面板位置對應；非畫師與遊戲中其他畫面位元組不變（工具列以外） | 2026-10-03 龍骨子代理：四項 0（test 80＋400＋765）；截圖每殼層 9 張，工具列沒出現的 vscode 5、ppt 4、meet 5 張與改動前位元組相同，有畫師工具列者（含 ppt 出題時灰化假工具列）新基準 scratchpad `epic11/{vscode,ppt,meet}/`（兩輪穩定）；面板互動腳本三殼層各 19/19 PASS，新截圖 `epic11/new/` |

### Phase 3：驗收

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | `acceptance-reviewer` 驗收（四項指令、純函式測試、瀏覽器三殼層實測） | 2026-10-03 通過；未驗：觸控拖曳、螢幕閱讀器朗讀。低：「⋯」面板仍用 rem 內距（6.5px），既有行為不處理 |
| ✅ | Rex 目視 | 2026-10-07「都可以」 |

---

## 驗收標準

- [x] 畫師點「目前顏色」開啟面板，拖方塊可選到深色、淺色、粉彩，拖色相條換色相；每次變動立即套用並切回畫筆；Esc／點外關閉
- [x] 工具列沒有色相條；窄版「⋯」只剩粗細；三殼層斷點實測後回寫，無橫向捲動
- [x] `brush` 狀態為 `{ tool, color, size, hue, sat, val }`，`color` 與 HSV 一致；點色塊後面板的把手在對應位置
- [x] 鍵盤可操作方塊與色相條；面板有 `role="dialog"`、`aria-label`
- [x] 四項指令各自 exit 0；契約與 server 不動；spec §6／§7 與 DESIGN §5／§6／斷點與實作一致

---

## 派工規範（龍骨）

- 本檔與 `backlog.md` 只准局部替換；不 commit（Rex 自行）；子代理不得登記名冊、不得跨 session 傳訊；驗收前重啟 server 程序。
- 不動 `shared/`、`server/`；不新增 token；首頁（Epic 10 試做中，工作區有未 commit 的改動）不要碰。

---

## 踩雷紀錄

- **整數 HSV 無法精確表示所有色塊（已定案（舵手 2026-10-03））**：整數 hue／sat／val 只有約 367 萬種組合，`#FFECEA`（v＝100 時 min＝234 需要 sat 落在 8.04–8.43）、`#F44747`、`#FFD700` 等色塊取整後轉回會差 1–2／255，「PALETTE 10 色反推再轉回逐字相同」與「sat／val 整數」不能同時成立；而且若點色塊後 color 變成 `#FFEDEB`，色塊的選取外框（`aria-checked` 比對 color）也會失效。實作取「`hexToHsv` 回傳不取整的精確值」：點色塊後 store 的 hue／sat／val 可能帶小數，`color` 仍逐字＝`hsvToHex(hue, sat, val)`＝色塊色；面板操作（指標、鍵盤）一律產生整數；`aria-valuenow`、提示文字四捨五入顯示。另一種做法是 store 存整數、點色塊時 color 直接寫色塊色（不再保證 color＝hsvToHex(…)），需改 spec §6／§7 其中一處。
- **往返誤差的定義**：任意 `#RRGGBB` → 精確 HSV → `#RRGGBB` 逐字相同（測試以每 channel 間隔 5 取樣 140,608 色）；整數 HSV 格點 → `#RRGGBB` 與浮點參考值每 channel 差 ≤ 1／255。`hsvToHex(h, 100, 100)` 與舊 `hueToHex(h)` 在 .5 進位處（例 6° 的 25.5）可能差 1，因此不拿 hueToHex 當逐字基準。
- **Tailwind 的 `p-2`／`gap-2` 是 rem**：vscode 根字級 13px，`p-2` 只有 6.5px，面板寬變 231px。面板改用 `p-[8px]`、`gap-[8px]`。
- **斷點量測方法**：以 `addScriptToEvaluateOnNewDocument` 覆寫 `matchMedia`，讓 `(min-width: <目前斷點>px)` 恆成立（強制完整工具列），320–1600px 每 10px 量一次工具列所在捲動容器（`overflow-x: auto` 的最近祖先）的 scrollWidth／clientWidth，轉折處逐 1px；取「該寬度以上全部放得下」的最小 10 倍數。改動前的量測與 Epic 7 一致（vscode 1101px 起放得下），驗證方法可信。結果（完整工具列寬 576 → 約 468px）：vscode 790px 起放得下（789：481／480、790：481／481）；ppt 483px 起（482：483／482）；meet 1085px 起（1084：493／492），< 1024px 影片條移到下方也放不下。再以真實建置驗證斷點 −1px 為「⋯」、斷點與 +1px 為完整且容器與頁面都不溢出。**註**：最小 10 倍數（790／490／1090）在斷點處容器剛好貼齊（0–7px 餘裕）；舵手 2026-10-03 定案留餘裕改 810／500／1100。
- **截圖基準遺失**：scratchpad `epic7/`、`epic6/` 的腳本與基準圖已不在（目錄是空的），改為在改動前把建置產物複製到 `epic11/base-app/`，以同一支新寫的腳本（`epic11/shots.mjs`，headless Chrome＋CDP＋socket.io 機器人）截改動前後各兩輪比對。meet「我來畫」按下後指標停在控制列按鈕上，hover 過場會讓按鈕圖示 1 像素抖動，腳本改為按下後把指標移到空白處。倒數偶爾在「正規化成 00:00」與截圖之間跳秒（ppt 07 出現 01:29），`shot()` 改為截圖後再檢查、仍有非 00:00 的時間就重新正規化再截。
- **ppt 灰化目前顏色鈕固定白**（`PALETTE[0]`，殼層不讀 store）：舵手 2026-10-03 確認。
- **說明「畫師工具與放棄」**：`helpTopics.ts` 依 plan/help-topics.md 決策 5 的新表逐字同步（顏色面板、背景色），`helpTopics.test.ts` 解析 plan 表比對通過，另補「不再提色相條」的測試；截圖 scratchpad `epic11/v2/help-tools.png`。
