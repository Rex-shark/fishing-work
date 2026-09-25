// App 的三分支判定（plan/home-page.md 決策 4；architecture §7 App.tsx）：
//   已加入 → 殼層的遊戲畫面（'game'）；
//   未加入但有重連憑證（resuming：啟動或重連時正以 token 自動重新加入）→ 殼層的自動重連畫面（'resume'，空白畫面＋「正在重新加入…」）；
//   其餘 → 首頁（'home'，不偽裝）。
// 遊戲中重新整理時 resuming 為 true，因此不會先閃出首頁；自動重加入失敗（憑證失效、被其他分頁接管）時 resuming 轉 false 才回首頁。
// 純函式獨立成檔（App.tsx 只匯出元件，react-refresh 規則）。

export type AppScreen = 'game' | 'resume' | 'home'

export function pickScreen({ joined, resuming }: { joined: boolean; resuming: boolean }): AppScreen {
  if (joined) return 'game'
  return resuming ? 'resume' : 'home'
}
