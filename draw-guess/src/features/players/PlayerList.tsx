// 玩家清單（功能部分）：整理每位玩家的列資料（自己、本回合得分），外觀由殼層提供（ShellViews.PlayerList）。
// 顯示規則（DESIGN.md §5、§6）：列右側本回合得分 +N、畫師 ●、已猜對 ✓、分數；自己那列粗體；斷線中（寬限期內）淡化。
import { useMemo } from 'react'
import { useShellViews, type PlayerRowData } from '../../shells/views'
import { useGameStore } from '../../store/game'
import { scoreGain } from './scoreDelta'

export function PlayerList() {
  const { PlayerList: View } = useShellViews()
  const players = useGameStore((s) => s.players)
  const me = useGameStore((s) => s.me)
  const baseline = useGameStore((s) => (s.round.phase === 'drawing' || s.round.phase === 'ended' ? s.scoreBaseline : null))
  const rows = useMemo<PlayerRowData[]>(
    () => players.map((p) => ({ player: p, isMe: p.id === me, gain: scoreGain(baseline, p) })),
    [players, me, baseline],
  )
  return <View rows={rows} />
}
