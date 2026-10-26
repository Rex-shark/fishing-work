# other/

放不屬於產品程式碼、規格（`spec/`）、計畫（`plan/`）與手動測試檔（`user/`）的東西。由事務長（Purser）維護。

## 內容

| 路徑 | 說明 |
|---|---|
| [skills/play-draw-contest/](skills/play-draw-contest/SKILL.md) | 教 AI agent 用瀏覽器加入並玩「繪圖比賽」。`SKILL.md` 是以輔助腳本為主的玩法；`references/manual-ui.md` 是不用腳本時的手動操作；`scripts/draw-helper.min.js` 是 agent 裝進頁面的腳本，`scripts/draw-helper.js` 是它有註解的原始版 |
| [skills/set-draw-contest-topic/](skills/set-draw-contest-topic/SKILL.md) | 教 AI agent 在「繪圖比賽」當出題者：何時出題、怎麼送出、怎麼選題目、出題者的規矩。以 `play-draw-contest` 為前提 |
| [skills/MAINTENANCE.md](skills/MAINTENANCE.md) | 維護紀錄：技能依賴的畫面文字與常數（`UI-DEP`／`CONST-DEP`／`BUG-DEP`）、改腳本後要做的事、驗證方式、沿革 |
| [skills/install.sh](skills/install.sh) | 把兩份技能安裝或更新到另一個專案的技能目錄 |

## 安裝到別的專案

這裡的技能不會被本專案的 Claude Code 自動載入，是給「被派去玩遊戲的 agent」讀的。

```bash
other/skills/install.sh /Users/liuyoucheng/IdeaProjects/pi-agent/.pi/skills
```

- 目標填對方的技能目錄：pi 是 `<專案>/.pi/skills`，Claude Code 是 `<專案>/.claude/skills`。
- 只會帶 `SKILL.md`、`references/` 與壓縮版腳本；同名技能整個換掉，其他技能不動。
- **改了這裡的技能或腳本之後要重跑一次**，安裝過去的是複本，不會自動更新。Rex 2026-10-26 定案：技能改版後由事務長自動重裝到下表所有位置，事後告知。

已安裝的地方：

| 專案 | 位置 | 最後安裝 |
|---|---|---|
| pi-agent（pi ＋ 本機 Ollama 模型 ＋ Playwright MCP） | `/Users/liuyoucheng/IdeaProjects/pi-agent/.pi/skills/` | 2026-10-26 |
| ollama-agent（Claude Code） | `/Users/liuyoucheng/Desktop/ollama-agent/.claude/skills/` | 2026-10-26 |

## 不安裝，直接派工

在本專案裡派子代理時，在 prompt 裡叫它先讀 `other/skills/play-draw-contest/SKILL.md`（要出題再加 `other/skills/set-draw-contest-topic/SKILL.md`），並給它遊戲網址與暱稱。

## 維護

繪圖比賽改了畫面文字、無障礙標籤，或新增第二套偽裝主題時，要對照 [skills/MAINTENANCE.md](skills/MAINTENANCE.md) 的依賴清單更新技能與腳本，重產壓縮版，再重新安裝。
