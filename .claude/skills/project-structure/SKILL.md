---
name: project-structure
description: >-
  Scaffold Rex 慣用的專案資料結構（plan/ 計畫驅動開發、spec/ 專案文件、user/ 使用者操作檔含 http 與 sql），
  並提醒根目錄 DESIGN.md 視覺設計指南的存在與用途（格式依 Google design.md 規格，沒有時先與使用者討論，不自動產生）。
  每次開新專案、fork 模板、或想把既有 repo 套上這套結構時都用此 skill，
  使所有專案保持一致的目錄與工作流程慣例。
  觸發時機：使用者說「建立專案結構 / 初始化專案 / 套上我習慣的結構 / scaffold / 新專案骨架 /
  plan spec user 目錄 / 計畫驅動開發」等，即使沒明講「skill」也應主動使用。
  全程以繁體中文（台灣用語）產出文件。
---

# 專案資料結構 Scaffold（plan / spec / user）

這個 skill 把一套以**計畫驅動開發（plan-driven development）**為核心的專案資料結構，
一次鋪設到新專案或既有 repo，讓每個專案的規劃、文件、測試慣例都長得一樣、可快速上手。

## 三個頂層目錄與用途

| 目錄 | 用途 | 重點 |
|------|------|------|
| `plan/` | **開發計畫的單一事實來源**。每次規劃程式碼前，都先在此寫計畫 | 改任何程式碼前後都要同步；Epic 索引 + 詳細計畫 + 踩雷紀錄 |
| `spec/` | **專案文件目錄**。穩定的規範、標準、資料庫設計 | 與 `plan/`（會變動的計畫）區分：`spec/` 放相對穩定的規範 |
| `user/` | **使用者操作用的檔案**。手動操作 / 測試用的工具檔 | `http/` 放 API 測試、`sql/` 放手動查詢腳本 |

> 設計哲學：**`plan/` 是動詞（持續規劃與追蹤），`spec/` 是名詞（穩定的事實），`user/` 是工具（手動操作）。**

## 完整結構

```
<專案根>/
├── DESIGN.md              # 視覺設計指南（有 UI 的專案才需要，格式依 Google design.md 規格，見下方說明）
├── plan/
│   ├── README.md          # 開發計畫管理規範（方法論，可直接沿用）
│   ├── TEMPLATE.md        # 新 Epic 文件範本（複製改寫）
│   ├── backlog.md         # Epic 索引總覽（一個 Epic 一行）
│   ├── improvements.md    # 跨 Epic 的品質 / 安全 / 運維改進
│   └── notes.md           # 30 分鐘內可完成的臨時小修正（完成即刪）
├── spec/
│   ├── README.md          # spec 目錄用途說明
│   └── db/
│       └── erd.mmd        # Mermaid ERD（資料庫關係圖）
└── user/
    ├── http/
    │   ├── README.md             # HTTP 測試集合使用說明與慣例
    │   └── http-client.env.json  # 環境變數（dev / prod）
    └── sql/
        └── console.sql           # 手動查詢 / 暫存腳本
```

## 如何鋪設

此 skill 的 `assets/` 目錄就是上述結構的範本檔。鋪設步驟：

1. **確認目標專案根目錄**（通常是目前工作目錄）。
2. **檢查衝突**：若目標已存在 `plan/`、`spec/` 或 `user/`，**不要覆蓋**——
   先告訴使用者哪些已存在，詢問要「跳過已存在的」還是「合併補齊缺漏檔案」。預設只補缺漏、不蓋既有。
3. **複製 `assets/` 內的對應檔案**到目標專案的同名路徑（保持目錄層級）。
4. **替換佔位符**（見下）。
5. **依專案需求詢問是否建立 subagent**（見下方「`.claude/agents/`」章節）——
   看得出是前後端分離就問要不要建 `backend-dev` / `frontend-dev`，不要一律都建。
6. **回報**建立了哪些檔案、跳過了哪些。
6. **提一下 `DESIGN.md`**（見下方說明）——這一步只是告知與討論，**不產生檔案**。

> 複製時請逐檔處理、保留目錄結構；`assets/` 內的檔名與相對路徑就是最終結果該有的樣子。

## 佔位符替換

範本內可能出現以下佔位符，鋪設時依專案實況替換（找不到對應資訊就先留著並提醒使用者填）：

| 佔位符 | 替換為 |
|--------|--------|
| `<專案名稱>` | 專案名稱 |
| `your-domain.com` | 正式環境網域（暫不知道就留著） |
| `http://localhost:8080` | 後端開發位址（無後端則整檔可省略） |

## 各目錄的慣例（鋪設後沿用）

詳細規範就寫在被複製過去的文件裡，這裡只提綱挈領：

### DESIGN.md — 視覺設計指南

**根目錄的 `DESIGN.md` 記錄整個專案的視覺風格**，讓後續產生的畫面都長得一致。

- **已存在** → 產生任何畫面、元件、樣式前先讀它，照它走。
- **不存在** → **不要自己生一份**。跟使用者說「這個專案還沒有 `DESIGN.md`」，
  問要不要一起建，再依他的想法寫。**內容由他決定，格式照下方規格。**
- **子目錄可以有自己的 `DESIGN.md`**（例如 `frontend/DESIGN.md`），寫該範圍的細部規範。
  **就近優先**：從當前檔案往上找，最接近的那份優先，其餘繼承上層。

**格式規格：Google `design.md`**（[google-labs-code/design.md](https://github.com/google-labs-code/design.md)，Apache-2.0）。
規格全文存在本 skill 的 `reference/design-md-spec.md`，**寫或改 DESIGN.md 前先 Read 它**。重點：

- **兩層結構**：YAML frontmatter 放機器可讀的 token（`name`、`colors`、`typography`、`rounded`、`spacing`、`components`），
  Markdown 正文放設計理由與用法。**token 是規範值，正文只解釋怎麼用**，兩邊的數值不能打架。
- **正文八個 `##` 段落**，可省略但順序固定：
  Overview → Colors → Typography → Layout → Elevation & Depth → Shapes → Components → Do's and Don'ts。
  刻意不寫的段落用 frontmatter 的 `omitted` 列出來，linter 才不會警告。
- `colors.primary` 必填；色值建議用 `#RRGGBB`；token 之間用 `{colors.primary}` 互相引用。
- **寫完驗證**：`npx @google/design.md lint DESIGN.md`，會檢查段落順序、壞掉的 token 引用、WCAG 對比度，輸出 JSON。
- 同一套規格的工具：impeccable skill 的 `/impeccable document` 可從既有程式碼萃取出這種格式的 DESIGN.md
  （收藏與說明見 rex-notes `docs/claude-skills.md`）。

### plan/ — 計畫驅動開發
- **新功能 / Epic**：在 `backlog.md` 加一行索引 → 複製 `TEMPLATE.md` 為 `<feature-kebab-case>.md` → 填設計決策與任務。
- **狀態符號統一**：⬜ 待開始　🔄 進行中　✅ 已完成　⏸ 暫停　❌ 取消。**不要混用** `[x]`、`(done)`、純文字「已完成」。
- **踩雷紀錄**寫在對應 Epic 文件的「## 踩雷紀錄」區塊，三行格式（症狀 / 根因 / 解法）。`notes.md` 不留踩雷。
- Epic 文件命名用語意化 kebab-case（`auth-jwt.md`），**不要** `epic-1.md`。
- 完整規範見 `plan/README.md`。

### spec/ — 專案文件
- 放**相對穩定**的規範：架構標準、命名規範、API 約定、資料庫 ERD。
- 資料庫關係維護在 `spec/db/erd.mmd`（Mermaid `erDiagram`），新增資料表時同步更新。
- 領域規範依需要新增檔案（如 `backend-standards.md`、`api-conventions.md`）。

### user/ — 使用者操作檔
- `http/`：每個 API 資源一個 `.http` 檔（IDEA HTTP Client 格式），環境變數集中於 `http-client.env.json`，**不要把帳密寫死在 `.http` 內**。慣例見 `user/http/README.md`。
- `sql/`：手動查詢、資料修補、暫存腳本。`console.sql` 為日常暫存草稿。

## `.claude/agents/` — 依專案需求建立 subagent

**不是每個專案都要**。看專案結構決定：有獨立前後端就問使用者要不要建 `backend-dev` / `frontend-dev`；
單一技術棧的小專案通常不需要。建立前先問過，不要自作主張鋪一堆用不到的 agent。

### ⚠️ 最重要：不要重複 CLAUDE.md

subagent 啟動時，context 裡**已經有**專案 `CLAUDE.md` 全文、全域 `~/.claude/CLAUDE.md` 全文、
`memory/MEMORY.md` 索引行。**其餘全部沒有** —— `spec/`、`plan/`、`.claude/rules/`、README、
原始碼都只有路徑名沒有內容，必須主動 `Read`。

所以 agent 檔裡：

- ❌ 不要抄程式碼慣例、架構說明、目錄結構、commit 規則 —— CLAUDE.md 已有
- ✅ 要列「開工前必須主動 Read 的檔案清單」—— 那些真的不在 context 裡

> 實例：某專案的 `backend-dev` 原本 143 行，砍掉與 CLAUDE.md 重複的部分後剩 61 行，資訊量不變。

另外，**agent 拿到的是主 session 啟動當下的快照**，主 session 開始後才改的 CLAUDE.md 它看不到；
剛改過關鍵指引就要在派工 prompt 裡直接講明，或請使用者重開 session。

### 檔案格式

`.claude/agents/<name>.md`，frontmatter 四欄：

```yaml
---
name: backend-dev                              # 與檔名相同，kebab-case
description: 一句話講技術棧與職責。當使用者要求 X、Y、Z 時使用。   # 要寫「觸發時機」
tools: Read, Write, Edit, Glob, Grep, Bash     # 只給需要的；審查型不給 Write/Edit
model: sonnet                                  # 實作型 sonnet 即可
---
```

本體章節（依需要取捨，不要硬湊）：角色 → 開工前要主動 Read 的檔案 → 工作流程 →
驗證 → 輸出格式 → 額外禁令。

### 角色邊界要寫明「不碰什麼」

| 角色 | 負責 | 明確排除 |
|------|------|---------|
| `backend-dev` | 後端實作 | 不碰前端目錄 |
| `frontend-dev` | 前端實作 | 不碰後端；需要 API 時在回報寫明契約，不自己改 |
| `doc-sync` | 稽核文件與程式碼一致性 | 只改文件對齊程式碼，不改程式碼 |
| `code-reviewer` | 只讀審查 | 不修改任何檔案 |

### 技術棧一律以檔案為準

寫 agent 前先讀 `package.json` / `pom.xml` 等確認**真實**技術棧與版本。
照抄別的專案會出事 —— 例如專案用原生 CSS，卻抄了 Tailwind 的設定，agent 會直接 `npm install`。

### 驗證段落必寫三件事

這是 agent 最容易造假的地方：

1. **指令分開跑、各自檢查 `$?`** —— 不可用 `cmd | tail && echo "通過"`，
   `&&` 拿到的是 pipe 最後一個指令的 exit code，失敗也會印「通過」
2. **哪些長跑指令禁止在前景執行**（`spring-boot:run`、`npm run dev` 會卡住）
3. **不准誇大驗證範圍** —— 例如只有 smoke test 的專案，最多只能說「編譯通過」；
   UI 類要求實際看畫面截圖，只跑 build 不算

### 建立後

在 `CLAUDE.md` 的目錄結構表補一行，列出本專案有哪些 agent 及其職責。

### 派工時（寫給主 session）

- 派工 prompt 要給**絕對路徑**，因為 agent 讀到的 CLAUDE.md 可能是舊快照
- 多個 agent 並行時，凡「誰負責做某個轉換」都要寫成**對照表**而非散文
  （實例：`web-` 前綴由誰加沒寫清楚，前後端各加一次，產生 `web-web-xxx`）
- 收到回報要**自己驗**，不能只轉述 agent 說「通過」

## 與 CLAUDE.md 的搭配（選用但建議）

若專案有 `CLAUDE.md`，建議在其中加入一條規則指向本結構，讓 AI 助理每次都遵守：
「**所有實作必須由 plan 驅動，修改程式碼前後皆須同步 `plan/` 文件**」，並列出上方狀態符號。
若使用者要求，可協助把這段補進 `CLAUDE.md`。
