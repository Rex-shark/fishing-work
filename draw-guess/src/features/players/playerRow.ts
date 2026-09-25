// 玩家列的文字（純邏輯，可單元測試）：無障礙名稱與 hover 提示。
// 畫面上以顏色＋符號（● / ✓）呈現，這裡補上文字，讓顏色不是唯一的訊息載體（DESIGN.md §9）。
// 顯示名稱由殼層決定（偽裝格式屬殼層），本檔只負責狀態文字。
import type { PlayerPublic } from '@fishing-work/shared'

/** 例：`amy.ts：120 分，畫師，本回合 +40，斷線中，你`（displayName 由殼層提供） */
export function playerRowLabel(
  displayName: string,
  p: Pick<PlayerPublic, 'score' | 'isDrawer' | 'hasGuessed' | 'connected'>,
  isMe: boolean,
  gain: number | null,
): string {
  const tags = [`${p.score} 分`]
  if (p.isDrawer) tags.push('畫師')
  if (p.hasGuessed) tags.push('已猜對')
  if (gain !== null) tags.push(`本回合 +${gain}`)
  if (!p.connected) tags.push('斷線中')
  if (isMe) tags.push('你')
  return `${displayName}：${tags.join('，')}`
}
