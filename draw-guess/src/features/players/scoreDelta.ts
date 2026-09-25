// 本回合得分變化（純顯示用；分數一律以 server 的 players:update 為準，這裡只做前後差）。
// 基準分在「進入 drawing」時記下；中途加入（快照）時已猜對的人基準不明，不顯示差值。
import type { PlayerPublic, RoundPhase } from '@fishing-work/shared'

/** playerId → 本回合開始時的分數 */
export type ScoreBaseline = Readonly<Record<string, number>>

/** 進入 drawing 的那一刻：所有人的分數即為基準（出題到作畫之間分數不會變） */
export function captureBaseline(players: readonly PlayerPublic[]): ScoreBaseline {
  return Object.fromEntries(players.map((p) => [p.id, p.score]))
}

/**
 * 快照（加入／重連接管）時的基準：只有 drawing 階段能推得出來，且排除已猜對的人
 * （他們的分數已含本回合所得）；畫師的分數要到回合結束才加，仍可當基準。其餘階段回 null。
 */
export function baselineFromSnapshot(phase: RoundPhase, players: readonly PlayerPublic[]): ScoreBaseline | null {
  if (phase !== 'drawing') return null
  return captureBaseline(players.filter((p) => !p.hasGuessed))
}

/** 本回合得分（> 0 才回傳）；基準不明或沒加分時回 null */
export function scoreGain(baseline: ScoreBaseline | null, player: Pick<PlayerPublic, 'id' | 'score'>): number | null {
  if (baseline === null) return null
  const base = baseline[player.id]
  if (base === undefined) return null
  const gain = player.score - base
  return gain > 0 ? gain : null
}
