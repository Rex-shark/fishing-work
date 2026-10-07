# Epic 10：首頁紙張質感（需求測試）

> 首頁改成真實紙張的觸感：暖白紙底、紙紋與纖維、紙卡疊在紙上；先試做給 Rex 看效果再定案

**狀態**：✅（2026-10-07 Rex 採用；acceptance-reviewer 驗收通過：四項 0（80／400／838）、DESIGN §14.2 與 theme.css 19 個 token 逐字相同、紙紋參數逐層一致、對 --home-bg-shade 對比 fg 10.57／fg-muted 4.57／error 4.92、首頁 1280／375 無溢出、錯誤字實量 5.27:1、四殼層無紙紋外漏；未驗 Safari／Firefox、prefers-contrast 模擬；結案）（2026-09-29 試做：舵手直接派子代理實作，未 commit）
**起訖**：2026-09-29 ~ 2026-10-07
**負責**：Rex × 舵手（Helm，規格、派工、定案）

---

## 需求（Rex 2026-09-29）

> 「需求測試：你在首頁加上真實紙張質感，我看看效果。」

- 只動**首頁**（`data-theme="home"`）；三個偽裝殼層、契約、server 不動。
- 「需求測試」＝試做：Rex 看過截圖與實際畫面後決定**採用**（補收尾、驗收、目視）或**還原**（回到 commit `5f66fef` 的首頁）。

## 設計決策

- 決策 1：**質感全用 CSS＋內嵌 SVG 產生**：紙紋以 SVG `feTurbulence`（`fractalNoise`）＋`feColorMatrix` 轉成低透明度的灰階雜點，寫成 `data:` URI 放在 `theme.css`；不下載圖檔、不用 JS、不加執行期相依。原因：部署單純（Docker 映像不變大），無網路請求，可調參數。
- 決策 2：**三層紙紋疊加**（皆為首頁 `body` 的背景層，由上而下）：(a) 細顆粒：高頻雜點（baseFrequency 約 0.8、3–4 octaves、alpha 約 0.05–0.08）；(b) 纖維：非等向雜點（x、y 頻率差一個量級，形成細長纖維，alpha 更低）；(c) 紙漿斑駁：低頻大塊明暗（baseFrequency 約 0.005–0.01，alpha 約 0.03–0.05）。數值可由實作者依截圖微調，最後值寫進 DESIGN §14。原因：真實紙張的辨識度來自「顆粒＋纖維＋不均勻」三者，只有雜點會像噪訊不像紙。
- 決策 3：**紙色取代冷色柔光**：`--home-bg` 改為暖白紙色（建議約 `#F6F1E7`，實作者可在 `#F3EEE3`～`#F8F4EC` 間調）；原本左上藍、右下綠兩處柔光（`--home-tint-1/2`）改為**紙面光線**：中央略亮、四邊極淡的暖色暗角（vignette）。原因：藍綠柔光是 Soft UI 的語彙，與紙張的暖白衝突。
- 決策 4：**紙卡**：卡片與輸入框是「放在紙上的另一張較厚的紙」：底色比頁面略白略暖（建議約 `#FFFDF8`）、帶同一套但更淡的紙紋；邊框改暖灰（建議約 `#E6DECF`）；陰影改暖色、貼地（很短的接觸陰影＋柔和的擴散陰影），hover 時像把紙拿起來一點（陰影變大，位移仍 ≤ 2px，沿用 DESIGN §14.4 動態例外）。選取、不可選、打勾徽章的規則不變。
- 決策 5：**文字、主色不動**：`--home-fg`、`--home-accent`（按鈕、選取、focus）維持，只在對比不足時調整（例如 `--home-error` 可能要加深）。原因：試做只驗證「紙感」，範圍越小越好比較；要不要改成墨水色系等 Rex 看過再說。
- 決策 6：**對比以「最暗的紙面」計算**：新增 token 代表暗角＋紙紋疊加後最暗的實際底色（例如 `--home-bg-shade`），承載資訊的文字（`fg`、`fg-muted`、`error`）對它仍 ≥ 4.5:1；`homeTheme.test.ts` 的對比與柔光相關案例改寫成新規則。原因：紙紋與暗角會壓暗底色，不能只量平均色。
- 決策 7：**效能與可及性**：紙紋為靜態背景（不做動畫、不用 `background-attachment: fixed`、不用大面積 `mix-blend-mode`）；`prefers-contrast: more` 時拿掉紙紋與暗角，只留純紙色。原因：捲動不卡、高對比使用者不受紋理干擾。
- 決策 8：**文件同步**：DESIGN §14.1（風格）、§14.2（token 表）、§14.3（頁面底）改寫為紙張版本並註明「Epic 10 試做」；`homeTheme.test.ts` 同步。試做期間四項指令仍須各自 exit 0。若 Rex 不採用，連同本檔一起還原（本檔改 ❌ 保留紀錄）。

---

## 任務清單

### Phase 1：試做

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | 改前截圖：目前建置版首頁 1280×800 與 375×812，以及 1:1 局部放大（卡片與紙底交界） | 放在舵手 scratchpad，給 Rex 對照 |
| ✅ | `theme.css`：紙色 token、三層紙紋、暗角、紙卡底與陰影；`prefers-contrast: more` 退回純色 | 決策 1–4、7；只改 `[data-theme='home']` 相關規則。最終值：`--home-bg #F8F4EB`、`--home-bg-shade #EAE4D9`（實量）、`--home-vignette rgba(112, 84, 44, 0.025)`、`--home-surface #FFFDF8`、`--home-border #E6DECF`、`--home-error #B3302C`（加深）；移除 `--home-tint-1/2`；紋理參數見 DESIGN §14.3「紙紋參數」 |
| ✅ | 首頁元件（`src/home/`）必要的 class 調整（例如卡片、輸入框掛上紙紋 utility） | 只用 `home-*` class，不寫死色碼。卡片（`CARD_BASE`）與暱稱輸入框各加一個 `home-paper`；其餘只改註解 |
| ✅ | DESIGN §14 與 `homeTheme.test.ts` 同步；四項指令各自 exit 0 | 決策 6、8。2026-10-01：typecheck／test（shared 80、server 400、draw-guess 735）／lint／build 皆 exit 0；`homeTheme.test.ts` 39 案例（新增「首頁紙張質感」一組 7 案例、對比改以 `--home-bg-shade` 計、移除柔光半徑案例） |
| ✅ | 改後截圖（同尺寸、同局部）；確認進殼層後三個殼層的 `html`／`body` 背景不受影響 | 殼層不動。截圖在舵手 scratchpad `epic10/after/`（另有 `contrast-more.png`）；vscode／ppt／meet 加入後 `html`／`body` 的 `background-image` 皆 `none`、全頁沒有元素帶 `feTurbulence`，殼層截圖與改前逐像素相同（只有聊天時間戳／時鐘不同） |
| ✅ | Rex 看效果：採用 → Phase 2；不採用 → 還原 | 2026-10-07 Rex：「好，採用」 |

### Phase 2：採用後收尾（Rex 決定採用才做）

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | 依 Rex 意見微調；`acceptance-reviewer` 驗收；Rex 目視 | 2026-10-07 Rex 直接採用無微調；驗收通過；DESIGN §14 與 theme.css 註解的「試做」字樣已改 |

---

## 驗收標準

- [x] 首頁一眼看得出是紙：暖白底、有顆粒與纖維、不均勻的紙漿明暗；卡片像疊在紙上的另一張紙
- [x] 承載資訊的文字對最暗紙面 ≥ 4.5:1；`prefers-contrast: more` 時無紋理
- [x] 三個殼層外觀不變；契約與 server 不動
- [x] `typecheck`／`test`／`build`／`lint` 各自 exit 0；DESIGN §14 與實作一致

---

## 派工規範

- 本檔與 `backlog.md` 只准局部替換；不 commit（Rex 自行）；子代理不得登記名冊、不得跨 session 傳訊。

---

## 踩雷紀錄

- **只有雜點不像紙，整頁平行纖維像木紋**：第一版三層直接疊（顆粒 alpha 峰值約 0.14、橫向纖維 `.015 .3`、斑駁 `.007`）看起來像布紋／木紋加髒污。修正：纖維頻率改 `.025 .6`（更細更短），再乘一張低頻遮罩（`feComposite operator='in'`）讓纖維成簇出現；加一層較淡的直向纖維打破方向感；斑駁降到 `.005`、壓暗只留 0.02、以提亮為主。
- **`feColorMatrix` 把雜訊轉 alpha 要帶負偏移**：`fractalNoise` 的 R 通道平均約 0.5、標準差約 0.12（實測），直接當 alpha 會整片變暗變灰。用 `alpha = a·R + b`（b 為負）只留雜訊的上半部；顆粒與斑駁另用同一張雜訊的下半部上白色提亮，平均亮度才不會掉。
- **對比不能只憑公式或單一視窗估**：紙紋圖塊 256／640／1024 的重複週期是 5120px，視窗只看得到左上一角；DSF 1 與 2 的取樣也不同（DSF 1 較暗）。最暗紙面要截完整週期（關暗角）取最暗 4×4 CSS px 區塊，再疊滿值暗角。第一輪參數（`--home-bg #F7F2E8`、暗角 0.04）在 1280×800 量到 4.65:1，但完整週期最壞情況只有 4.37:1（`--home-fg-muted`）；最後把纖維峰值、暗角（0.04 → 0.025）調低、紙色調亮一階才到 4.57:1。暗角因此非常淡，要更明顯就得加深 `--home-fg-muted`（待 Rex 決定）。
- **`--home-error` 原值 `#C93B3B` 在最暗紙面只有 4.0:1**（純紙色上也只有 4.6:1），加深為 `#B3302C`（最暗紙面 4.9:1）。
- **`url(` 的守門測試**：內嵌 SVG 裡 `filter='url(%23a)'` 也是 `url(`，測「theme.css 沒有外部圖檔」時要把這種片段引用排除。`#` 在 data URI 裡必須寫成 `%23`，否則 `#` 之後整段被當成 fragment、紋理不顯示。
- **Tailwind v4 `@utility` 內可巢狀 `@media`**：`home-paper` 的 `prefers-contrast: more` 直接寫在 utility 裡，建置後展開成 `@media (prefers-contrast:more){.home-paper{background-image:none}}`。
- **子代理中斷後 server 殘留**：試做中途因用量額度中斷，3281 上的 server（舊建置）留著沒關；接續時先 `lsof -ti tcp:3281 | xargs kill` 再重新 build、重起。長跑程序要在每個階段結束時就關，不要留到最後。
