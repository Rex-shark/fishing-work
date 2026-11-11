# 🗂 開發 Epic 索引

> 所有功能性 Epic 的總覽。每個 Epic 一行，詳細內容請點連結進入對應文件。
> 新增 Epic 時請複製 [`TEMPLATE.md`](TEMPLATE.md)。

---

## 進行中 / 待開發

| 狀態 | Epic | 起訖 | 詳細 |
|------|------|------|------|
| ⏸ | Epic 8：語音輸入（語音轉文字） | 2026-09-29 ~ — | [voice-input.md](voice-input.md)：沿用 live2D 的 whisper.cpp 做法，按麥克風講話轉成正體文字填入聊天；Meet 麥克風按鈕、ppt「聽寫」、vscode 輸入列麥克風；**2026-09-29 暫緩**：只能用區網 IP，http 下瀏覽器不開放麥克風；需區網 HTTPS 通過可行性測試才恢復 |
| 🔄 | Epic 9：Docker 部署 | 2026-09-29 ~ — | [docker-deploy.md](docker-deploy.md)：多階段 Dockerfile（node:24-slim、非 root、healthcheck）＋ docker-compose；容器內分享網址改由 `PUBLIC_URL` 或提示；換電腦 `docker compose up -d --build` 一行部署；Phase 1 完成、龍骨 docker 驗證通過（映像 362MB），待舵手協定測試 |

---

## 已完成

| 狀態 | Epic | 起訖 | 詳細 |
|------|------|------|------|
| ✅ | Epic 21：code review 修正（第一批） | 2026-11-10 ~ 2026-11-11 | [hardening.md](hardening.md)：全專案 code review（[code-review-2026-11.md](code-review-2026-11.md)，24 項）先修高 6 項＋中 2 項：不可見字元繞過洩題與暱稱、筆畫 id 無上限可打掛 server、洩題探測不限速、壞圖拖累整回合評分、重連途中斷線丟憑證、自動交卷不重試、歌手 0 筆快取、PORT 空字串。水手長實作、acceptance-reviewer 自寫腳本重現確認 7 項已修；自動交卷改為到時預先匯出，仍受重連退避限制（第二批 #26）；第二批 18 項未排 |
| ✅ | Epic 20：繪圖比賽「像不像比賽」模式 | 2026-10-26 ~ 2026-10-26 | [contest-mimic.md](contest-mimic.md)：出題附參考圖（選填，客戶端縮成 JPEG）即為像不像比賽；Clef 同時看參考圖與作品打相似度（0.9）＋完成度（0.1）；作畫中浮動參考圖面板、揭曉第一格參考圖、評語看兩張、歷史存參考圖；契約加 `mode`／`contest:reference`。水手長實作、acceptance-reviewer 驗收通過（協定 9 檔＋新寫 mimic-extra、真 Clef 臨摹 84／亂畫 9）、375px 版面補修、Rex 實測通過；事務長技能預改完成 |
| ✅ | Epic 19：猜歌「動漫熱門」來源 | 2026-10-20 ~ 2026-10-21 | [song-guess-anime.md](song-guess-anime.md)：第四個題庫來源，無選項；anime／アニメ／動漫 三關鍵字搜 iTunes 聯集、排除原聲帶／翻唱、依 Apple 排序前 60 首抽 5；`SongSource` 加 `'anime-hot'`。水手長實作、acceptance-reviewer 驗收通過（含真 Apple 一局名次重算、排除規則 29 案例、新協定測試 anime-extra）、Rex 實測通過；排除關鍵字補 acoustic／orchestral／karaoke |
| ✅ | Epic 18：猜歌題庫來源（歌手熱門、台灣熱門、西洋熱門） | 2026-10-16 ~ 2026-10-19 | [song-guess-sources.md](song-guess-sources.md)：出題對話框三選一；歌手模式加「只抽熱門歌」預設勾（iTunes 搜尋順序即熱門度，取前 30 首抽）；台灣熱門／西洋熱門（美國榜）從 Apple Music most-played 100 ＋ lookup 補試聽隨機抽 5；`round:setArtist` → `round:setSource`、`RoundPublic.topic`、`SongPublic.artist`。水手長實作、acceptance-reviewer 驗收通過（含真 Apple 三局、窄螢幕、新協定測試 sources-extra）、Rex 實測通過；順帶修 ended 沒人猜對時字幕列與報讀文案；RSS 逾時獨立 12 秒、ack 25 秒；Rex 定榜單不排除 explicit |
| ✅ | Epic 17：繪圖比賽歷史（最近 5 場，只存瀏覽器） | 2026-10-13 ~ 2026-10-14 | [contest-history.md](contest-history.md)：揭曉後把畫、分數、排名、評語存進 IndexedDB（最近 5 場、超過刪最舊、不同步）；入口「檔案 › 開啟最近的簡報」，重用投影片瀏覽畫廊；純客戶端，契約不變。水手長實作、acceptance-reviewer 驗收通過（含 IndexedDB 不可用、多分頁）、Rex 實測通過 |
| ✅ | Epic 16：猜歌 MVP（song-guess） | 2026-10-12 ~ 2026-10-12 | [song-guess-mvp.md](song-guess-mvp.md)：第三款遊戲、獨立前端 `song-guess/`（Meet 偽裝）；出題者填歌手（必填、畫面顯示），server 從 Apple iTunes Search API（免金鑰）抽 5 首 30 秒試聽，各客戶端同步播、聊天室打字猜歌名，每首播到底、猜對不提早結束，第 5 首後本局排名；規格 `spec/song-guess/`。Phase 1–3 水手長實作、acceptance-reviewer 驗收通過（含真 iTunes 兩局、開發模式五程序）、Rex 實機通過；預設音量 15 |
| ✅ | Epic 15：繪圖比賽 AI 評語（メスガキ） | 2026-10-12 ~ 2026-10-12 | [contest-commentary.md](contest-commentary.md)：揭曉卡片每張一句評語，本機 Ollama `gemma4:26b-mlx-bf16`、雌小鬼人格自由發揮（只限繁中台灣用語、一句 40 字內）、`think: false`、預設開（`COMMENT=off` 可關）；評語不擋揭曉、`contest:comment` 補送；順帶移除評分前縮圖與 `pngjs`（Clef nvfp4 MLX 原圖 2.4 秒）。Phase 1–4 水手長實作、acceptance-reviewer 兩次驗收通過、Rex 實戰目視通過；順帶揭曉列帶題目、評語不截斷、兩款送出中焦點修正 |
| ✅ | Epic 10：首頁紙張質感（需求測試） | 2026-09-29 ~ 2026-10-07 | [home-paper.md](home-paper.md)：首頁改成暖白紙底＋紙紋（顆粒、纖維、紙漿斑駁，CSS＋內嵌 SVG）＋紙卡；只動首頁；試做給 Rex 看效果再決定採用或還原；2026-10-07 Rex 採用、acceptance-reviewer 驗收通過 |
| ✅ | Epic 13：試算表偽裝主題（Excel 風格） | 2026-10-06 ~ 2026-10-07 | [excel-theme.md](excel-theme.md)：第四套殼層 `excel`——A–C 欄人員分數表＝玩家、E 欄起浮動「圖片 1」＝畫布、「圖片格式」分頁＝工具列、右「註解」窗格＝聊天、「插入圖片」＝我來畫、出題＝「替代文字」；ppt／excel 共用 `shells/office/`。Phase 1、2 ✅（2026-10-06：工具列斷點 500px、三殼層截圖位元組不變、四主題混玩通過），待驗收；舵手定案（窄版圖片移到表格下、斷線字 `--fg-muted`、首頁卡片 2×2）已收尾；2026-10-06 acceptance-reviewer 驗收通過；2026-10-07 Rex 目視通過 |
| ✅ | Epic 12：作畫時間改 2 分鐘（小修正） | 2026-10-06 ~ 2026-10-07 | [round-time.md](round-time.md)：`ROUND_SECONDS` 90 → 600 → **120**（唯一來源；Rex 試過 10 分鐘後改 2 分鐘），同步 spec、README、說明文字；寫死 90 的測試改為由常數推導；龍骨兩輪實作並複驗完成；2026-10-07 Rex 目視通過 |
| ✅ | Epic 11：顏色面板 | 2026-10-03 ~ 2026-10-07 | [color-picker.md](color-picker.md)：96px 色相條太難選、只有純色 → 改成按「目前顏色」彈出面板（飽和度／明度方塊＋寬色相條，HSV），工具列移除色相條、三殼層斷點重測；2026-10-03 Phase 1、2 工程完成（龍骨子代理：四項 0、斷點 vscode 810／ppt 500／meet 1100（實測 790／483／1085 另留餘裕）、三殼層互動 19/19）；2026-10-03 acceptance-reviewer 驗收通過；2026-10-07 Rex 目視通過 |
| ✅ | Epic 14：繪圖比賽 MVP（draw-contest） | 2026-10-07 ~ 2026-10-09 | [draw-contest-mvp.md](draw-contest-mvp.md)：第二款遊戲、獨立前端 `draw-contest/`（簡報偽裝）；一人出題、大家同時畫 120 秒、交卷 PNG、Clef 決策模型（Ollama `/v1/systemone`，預設 `JUDGE=ollama`、連不上退回隨機）打分、投影片瀏覽揭曉；規格 `spec/draw-contest/`；acceptance-reviewer 三次驗收通過、Rex 真模型與區網實機通過 |
| ✅ | Epic 7：畫布背景色與新色塊 | 2026-09-28 ~ 2026-09-29 | [canvas-background.md](canvas-background.md)：PALETTE 加黑與膚色（10 色）；「背景色」按鈕以 `background` op 把畫布底色同步給所有人（clear 保留、undo 不影響、新回合回黑底）；vscode 工具列收合斷點 1100 → 1120px；協定測試＋舵手實測＋Rex 目視通過 |
| ✅ | Epic 6：遊戲說明 | 2026-09-26 ~ 2026-09-29 | [help-topics.md](help-topics.md)：ppt「說明」分頁、vscode 齒輪「說明…」、meet「資訊」／「更多 ⋮」→ 同一份六個主題的兩步說明對話框；舵手實測＋Rex 目視通過 |
| ✅ | Epic 5：視訊會議偽裝主題（Google Meet 風格） | 2026-09-25 ~ 2026-09-29 | [meet-theme.md](meet-theme.md)：第三套殼層 `meet`——畫布＝分享中的畫面、玩家＝參加者 tile、聊天＝白色訊息面板、「分享畫面」＝我來畫；只加殼層與 token；三主題混玩驗證通過；舵手實測＋Rex 目視通過 |
| ✅ | Epic 4：首頁（柔和 UI 選介面風格） | 2026-09-25 ~ 2026-09-25 | [home-page.md](home-page.md)：不偽裝的柔和 UI 首頁（暱稱＋風格卡片＋進入遊戲），選好才進殼層；重新整理不閃首頁（index.html 內嵌腳本＋resume 畫面）；遊戲中畫面位元組不變；舵手實測＋Rex 目視通過 |
| ✅ | Epic 2：聊天室圖片 | 2026-09-25 ~ 2026-09-25 | [chat-image.md](chat-image.md)：拖曳／貼上圖片、Socket.IO 二進位中繼、不保留、10 MB 上限、慢連線保護；30 人壓測通過；Rex 實機拖圖通過 |
| ✅ | Epic 1：我畫你猜 MVP | 2026-09-24 ~ 2026-09-25 | [draw-guess-mvp.md](draw-guess-mvp.md)：回合狀態機、畫布同步、聊天猜題計分、IDE 偽裝、畫具強化、區網 80 埠部署、30 人壓測；Rex 實機區網實測通過 |
| ✅ | Epic 3：多偽裝主題 | 2026-09-25 ~ 2026-09-25 | [camouflage-themes.md](camouflage-themes.md)：殼層抽象（vscode 外觀位元組不變）、登入主題卡片與切換入口、PPT 主題（註解卡片聊天、投影片縮圖玩家、從目前投影片開始）；舵手實測＋Rex 目視通過 |
| ✅ | Epic 0：專案啟動與需求釐清 | 2026-09-24 ~ 2026-09-24 | [project-kickoff.md](project-kickoff.md)：骨架、名冊、需求問答、技術選型（Node）、模組評估 |

---

## 圖例

⬜ 待開始　🔄 進行中　✅ 已完成　⏸ 暫停　❌ 取消

> 詳見 [`README.md`](README.md) 開發計畫管理規範。
