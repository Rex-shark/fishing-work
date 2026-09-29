# Epic 7：畫布背景色與新色塊

> 預設色塊加黑色與膚色；畫師可把畫布背景設成目前選的顏色，所有人同步看到

**狀態**：✅（2026-09-29 Rex 目視通過，結案）（2026-09-28 Phase 1 龍骨驗收通過：typecheck／test 80＋391＋729／build／lint 皆 0；DrawOp 與 spec §4 逐字一致；vscode 工具列收合斷點 1100 → 1120px（1100 溢出 1px），ppt 640、meet 1280 不變；首頁 9、說明 10 位元組不變，工具列有變者新基準 scratchpad/epic7/{vscode,ppt,meet}/、背景色新截圖 epic7/new/（6 張）；舵手定案追加（ppt 灰化假工具列補背景色圖示、殼層註解改現值）龍骨複驗通過，ppt 03 新基準 epic7/ppt-v2/；待舵手補協定測試、回寫 DESIGN 斷點並驗收，Rex 目視）（2026-09-28 舵手驗收通過，含協定測試與瀏覽器實測；待 Rex 目視）
**起訖**：2026-09-28 ~ 2026-09-29
**負責**：Rex × 舵手（Helm，規格與計畫）× 龍骨（Keel，派工與驗收）

---

## 需求（Rex 2026-09-28）

1. 預設顏色色塊新增**黑色**與**膚色 `#FFECEA`**。
2. 新增一個**改背景色的按鈕**：按了之後畫布背景色變成目前選擇的顏色。

## 設計決策

- 決策 1：**背景色是共享的畫布狀態，走 `draw:op`**：新增 op `{ type: 'background'; color: string }`，畫師在 drawing 階段送出，server 驗證後廣播並存入本回合歷史；中途加入者由快照的 ops 還原。原因：畫布是共享畫面（Epic 3 決策 6），畫師換背景別人必須看到，否則黑筆在別人螢幕上消失。
- 決策 2：**每回合從預設底色開始**：回合開始 ops 清空即回到 `CANVAS_BACKGROUND`（#1E1E1E）；`clear` 只清筆跡、**不重設背景**；`undo` 不影響背景；歷史正規化只保留**最後一個** `background` op（放在筆跡之前或之後皆可，渲染時背景永遠在最底層）。原因：背景是「設定」不是「筆畫」；清空畫布後通常還想在同色底上重畫。
- 決策 3：**渲染**：畫布元素本身仍透明、橡皮擦仍 `destination-out`（擦出背景色）；背景色改由 `Canvas` 依 ops 推導（`canvasBackground(ops)`＝最後一個 background op 的色，否則 `CANVAS_BACKGROUND`）以 inline style 設在畫布元素；`<html>` 的 `--bg-canvas` 常數注入維持（殼層裝飾用）。原因：只改一處，三個殼層不動。
- 決策 4：**PALETTE 改 10 色**：`['#FFFFFF', '#000000', '#FFECEA', '#9E9E9E', '#F44747', '#FF8C00', '#FFD700', '#6A9955', '#569CD6', '#C586C0']`，索引 0 白仍為預設；色塊名稱加「黑」「膚色」。原因：黑與膚色緊接白，換底色後最常用。
- 決策 5：**按鈕**：工具列在粗細滑桿（窄版「⋯」）之後的分隔線與橡皮擦之間加一顆 22×22 圖示按鈕「背景色」（2026-09-28 依實作修正位置描述）（自繪「填滿」圖示），工具提示「把背景設為目前顏色 #XXXXXX」；按下送 `background` op（顏色＝目前筆色，即使目前工具是橡皮擦）。目前背景已是該色時按鈕仍可按（無害）。原因：Rex 指定「按了背景變成目前選擇的顏色」。
- 決策 6：**server 驗證**（§5 表）：`background` 需 phase = drawing 且送出者為畫師、`color` 符合 `COLOR_PATTERN`，其餘同 `draw:op` 規則；計入 `MAX_OPS_PER_ROUND`（正規化後只剩一個，不會撐滿）。
- 決策 7：**工具列寬度**：多 2 個色塊與 1 顆按鈕約 +70px；各殼層 `compactBelowPx` 若在該寬度下完整工具列放不下，就提高斷點並回寫 DESIGN（vscode §8、ppt §13.3、meet §15.3）。原因：不能出現橫向捲動。
- 決策 9（2026-09-28 龍骨 Phase 1 提問定案）：vscode 收合斷點改 1120px；ppt 出題時的灰化假工具列補灰化背景色圖示；「清空畫布」只有背景時停用（清空不清背景）；spec §4／§5 舊敘述由舵手修正。
- 決策 8：契約變更（`shared/src/draw-guess/events.ts` 的 `DrawOp`、`constants.ts` 的 `PALETTE`）由舵手已寫入 spec §4，實作須逐字一致；協定測試 `user/protocol/draw-guess-phase2.mjs` 由舵手補 `background` 案例。

---

## 任務清單

### Phase 1：契約、server、渲染

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | `shared`：`PALETTE` 改 10 色；`DrawOp` 加 `background` | 決策 4、1；與 spec §4 逐字一致（`shared/test/constants.test.ts` 以 spec 值斷言） |
| ✅ | `server/drawOp.ts`：`background` 驗證（drawing、畫師、COLOR_PATTERN）；`room.ts` 歷史正規化：只留最後一個 background、`clear` 不清背景、`undo` 不影響；測試 | 決策 2、6；已有 background 時原地取代（長度不變）；`room.round.test.ts` 新增 16 案 |
| ✅ | `client`：`features/canvas/canvasState.ts`（或 render.ts）純函式 `canvasBackground(ops)`；`Canvas` 以 inline style 套背景；`render.ts` 不變；測試 | 決策 3；`canvasBackground(ops)` 放在既有的 `features/canvas/canvasBackground.ts`（與 `applyCanvasBackground` 同檔）；`render.ts` 渲染不變，但 `compactOps` 與 `drawOp` 須認得 `background`（見踩雷）；store `appendOp` 同樣正規化 |
| ✅ | `ToolBar`：10 個色塊（名稱加黑、膚色）＋「背景色」按鈕與工具提示；`sendDrawOp({ type: 'background', color })` | 決策 4、5；按鈕在色相條／粗細（或「⋯」）之後的分隔線與橡皮擦之間；`FillIcon` 自繪；`brush.ts` 的 `backgroundLabel`／`backgroundOp`；「清空畫布」改為有筆跡才可按（只有背景時停用） |
| ✅ | 工具列寬度：量三殼層在各自 `compactBelowPx` 下完整工具列是否放得下，不夠就提高斷點並回報舵手改 DESIGN | 決策 7；完整工具列約 576px。vscode 1100px 溢出 1px → **提高為 1120px**；ppt 640px 餘裕 67px、meet 1280px 膠囊 600px／可用 648px，皆不變 |
| ✅ | 驗證：typecheck／test／build／lint 0；既有截圖除工具列（色塊數）外位元組不變；工具列有變的截圖另存新基準 | 2026-09-28 龍骨子代理：三輪截圖穩定；新基準 scratchpad/epic7/{vscode,ppt,meet}，背景色新截圖 scratchpad/epic7/new |

### Phase 2：驗證

| 狀態 | 任務 | 備註 |
|------|------|------|
| ✅ | 舵手協定測試補 `background` 案例（合法、非畫師、非 drawing、色碼不合法、中途加入者快照含背景、clear 後背景仍在） | 舵手自跑；2026-09-28 舵手：新增 `user/protocol/draw-guess-background.mjs` 14/14；既有 phase1 24、phase3 26、phase6 5、image 26 全過；phase2 兩個「不合法」案例自 Epic 1 Phase 6 起已變合法（`#123456`、粗細 5），改為 `#12345`、65 後 33/33 |
| ✅ | 舵手瀏覽器實測：畫師選膚色 → 背景色 → 黑筆作畫 → 猜題者端同色同筆跡；clear 後背景仍在；下一回合回黑底 | ；2026-09-28 舵手（新 server 3181）：Helm（vscode 畫師）選膚色 → 背景色 → 黑筆作畫，Bob（ppt 猜題者）畫布 `rgb(255, 236, 234)` 且看到黑線；清空後雙方筆跡歸零、背景仍膚色、「清空」回到停用；四項 80＋391＋729 皆 0、DrawOp 與 spec 逐字相同 |
| ✅ | Rex 目視 | 2026-09-29 Rex：「OK 都沒問題」 |

---

## 驗收標準

- [x] `npm run typecheck`、`npm test`、`npm run build`、`npm run lint` 各自 exit 0
- [x] 色塊有黑與膚色；按「背景色」後所有人的畫布背景同步變色；中途加入者也看到
- [x] `clear` 不清背景、`undo` 不影響背景、新回合回黑底
- [x] 協定測試 `background` 案例全過；`shared/src/draw-guess/events.ts` 與 spec §4 逐字一致
- [x] 三殼層工具列無橫向捲動；`spec/architecture.md` §4–§6 與 `DESIGN.md` 與實作一致

---

## 派工規範（龍骨）

- 本檔與 `backlog.md` 只准局部替換；不 commit（Rex 自行）；子代理不得登記名冊、不得跨 session 傳訊；驗收前重啟 server 程序。
- 契約改動以 spec §4 為準，不得自行增減欄位。

---

## 踩雷紀錄

- **Phase 1（2026-09-28）**：
  - `render.ts` 的 `compactOps` 原本「clear 清空全部」、undo 以 `o.type === 'clear' || o.strokeId !== …` 過濾；加入 `background` 後型別與語意都要跟著改（clear 保留 background、undo 略過 background、background 原地取代），否則快照重播與 store 的 clear 會把背景一起清掉。渲染本身（`drawOp` 對 background 直接 return）不變。
  - store `appendOp` 收到 background 時**原地取代**舊的而非「刪舊＋附加」：ops 長度不變、`opsVersion` 不遞增，Canvas 的增量繪製計數（`drawn`）不會錯位，也不必全量重繪。
  - 「清空畫布」原本以 `ops.length > 0` 判斷可按；背景進 ops 後只有背景也會亮起，改為「有 background 以外的 op」。
  - `sendDrawOp` 的歷史上限檢查要放行 `background`（與 undo／clear 同），否則筆跡滿了就換不了底色。
  - vscode 分頁列的工具列容器是 `flex-auto` 且分頁 `shrink-[10]`：空間不足時兩者按比例縮，工具列容器在 1100px 被分到 588px（內容 589px）溢出 1px，即使分頁還沒縮完；因此不能只看「總寬是否夠」，要實測容器的 scrollWidth／clientWidth。
  - 截圖腳本：ppt／meet 的「放棄本回合」對話框按 Enter 不會送出（焦點不在確定鈕），要點對話框的 submit 按鈕。
  - ppt「繪圖」功能區在非作畫時的灰化假工具列（`PptShell` 的 `DrawRibbon`）直接跑 `PALETTE`，色塊自動變 10 個，但圖示是寫死的清單；舵手定案補灰化 `FillIcon`（粗細之後、橡皮擦之前），出題時與作畫時外觀一致。殼層註解裡的舊斷點與寬度（vscode 1100、meet 542px、ppt 519／533px）一併改為現值（1120、576px、576／591px）。
