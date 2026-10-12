# other/

放不屬於產品程式碼、規格（`spec/`）、計畫（`plan/`）與手動測試檔（`user/`）的東西。由事務長（Purser）維護。

## 內容

| 路徑 | 說明 |
|---|---|
| [skills/play-draw-contest/](skills/play-draw-contest/SKILL.md) | 教 AI agent 用瀏覽器加入並玩「繪圖比賽」的技能：`SKILL.md` 是玩法，`scripts/draw-helper.js` 是注入頁面的作畫輔助（有註解的原始版），`scripts/draw-helper.min.js` 是 agent 實際貼進頁面的壓縮版 |
| [skills/set-draw-contest-topic/](skills/set-draw-contest-topic/SKILL.md) | 教 AI agent 在「繪圖比賽」當出題者：何時出題、操作步驟、怎麼選題目、出題者的規矩。以 `play-draw-contest` 為前提（agent 要先在房間裡） |

## skills/ 怎麼用

這裡的技能不會被 Claude Code 自動載入（自動載入的在 `.claude/skills/`），是給「被派去玩遊戲的 agent」讀的：

- 派工時在 prompt 裡叫 agent 先讀 `other/skills/play-draw-contest/SKILL.md`，並給它遊戲網址與暱稱。
- 要它負責出題時，再叫它讀 `other/skills/set-draw-contest-topic/SKILL.md`，並講清楚出幾題、有沒有指定主題或難度。
- 不是 Claude 的 agent（只要能操作瀏覽器）也一樣，把 `SKILL.md` 和 `scripts/draw-helper.min.js` 的內容交給它即可。
- 想讓本專案的 Claude Code session 能直接以 `/play-draw-contest` 呼叫，把整個資料夾複製或連結到 `.claude/skills/`。

兩個技能都依賴遊戲畫面上的文字與無障礙標籤（「完成」「儲存」「備忘稿」「粗細」「從目前投影片開始」「輸入標題」等）。繪圖比賽改了這些字，或新增第二套偽裝主題時，要回來更新技能與輔助腳本。完整的依賴清單在各 `SKILL.md` 檔頭的註解裡，以 `UI-DEP`（畫面文字與標籤）、`CONST-DEP`（常數）、`BUG-DEP`（為了繞過已知問題而寫的說明）標記：

```bash
grep -rn "UI-DEP\|CONST-DEP\|BUG-DEP" other/skills
```

## 改了 draw-helper.js 之後

壓縮版要重新產生（在專案根目錄；結尾的分號要拿掉，agent 才能把內容包進 `() => { return (…) }`）：

```bash
node_modules/.bin/esbuild other/skills/play-draw-contest/scripts/draw-helper.js --minify --charset=utf8 | sed -e '$ s/;$//' > other/skills/play-draw-contest/scripts/draw-helper.min.js
```
