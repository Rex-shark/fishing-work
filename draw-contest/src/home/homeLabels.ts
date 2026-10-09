// 首頁的純文字邏輯（plan/home-page.md 決策 8；DESIGN §14.3）。檔名與 HomeScreen／HomeThemeCards 取不同字根，避免 macOS 大小寫撞名。
import type { ConnectionState } from '../store/game'

/** 連線狀態一行（DESIGN §14.3「連線狀態」） */
export function homeConnectionLabel(connection: ConnectionState): string {
  switch (connection) {
    case 'connected':
      return '已連線'
    case 'connecting':
      return '正在連線到伺服器…'
    case 'disconnected':
      return '連線中斷，重新連線中…'
  }
}

/** 「進入遊戲」按鈕文字：加入中顯示「加入中…」 */
export function enterButtonLabel(submitting: boolean): string {
  return submitting ? '加入中…' : '進入遊戲'
}
