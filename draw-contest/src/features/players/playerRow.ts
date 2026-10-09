// 玩家列的文字（純邏輯，可單元測試）：無障礙名稱與 hover 提示。
// 畫面上以顏色＋符號（畫筆／勾）呈現，這裡補上文字，讓顏色不是唯一的訊息載體（DESIGN.md §9）。
// 顯示名稱由殼層決定（偽裝格式屬殼層），本檔只負責狀態文字。
import type { ContestPhase, PlayerPublic } from '@fishing-work/shared/draw-contest'

/** 比賽進行中（drawing／judging）：參賽者已定案，非參賽者為旁觀 */
export function isContestActive(phase: ContestPhase): boolean {
  return phase === 'drawing' || phase === 'judging'
}

/** 本回合旁觀：比賽進行中且不是參賽者（中途加入者） */
export function isSpectating(p: Pick<PlayerPublic, 'participating'>, contestActive: boolean): boolean {
  return contestActive && !p.participating
}

/** 例：`amy：120 分，出題者，已交卷，斷線中，你` */
export function playerRowLabel(
  displayName: string,
  p: Pick<PlayerPublic, 'score' | 'isSetter' | 'participating' | 'submitted' | 'connected'>,
  isMe: boolean,
  contestActive: boolean,
): string {
  const tags = [`${p.score} 分`]
  if (p.isSetter) tags.push('出題者')
  if (p.submitted) tags.push('已交卷')
  if (isSpectating(p, contestActive)) tags.push('旁觀')
  if (!p.connected) tags.push('斷線中')
  if (isMe) tags.push('你')
  return `${displayName}：${tags.join('，')}`
}
