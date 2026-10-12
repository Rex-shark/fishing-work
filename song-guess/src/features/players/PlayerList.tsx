// 玩家清單（功能部分）：整理每位玩家的列資料（自己、本首得分），外觀由殼層提供（ShellViews.PlayerList）。
// 本首得分：揭曉時每位猜對者都有（reveal.scores）；播放中只有自己的推得出來（store 的 selectMyGain）。
import { useMemo } from 'react'
import { useShellViews, type PlayerRowData } from '../../shells/views'
import { selectMyGain, useGameStore } from '../../store/game'
import { revealScoreOf } from './scoreDelta'

export function PlayerList() {
  const { PlayerList: View } = useShellViews()
  const players = useGameStore((s) => s.players)
  const me = useGameStore((s) => s.me)
  const myGain = useGameStore(selectMyGain)
  // 只有揭曉階段才用揭曉資料（ended 的 reveal 是最後一首，本局已結束，不再標在玩家列上）
  const reveal = useGameStore((s) => (s.round.phase === 'reveal' ? s.round.reveal : null))
  const rows = useMemo<PlayerRowData[]>(
    () =>
      players.map((p) => ({
        player: p,
        isMe: p.id === me,
        gain: reveal !== null ? revealScoreOf(reveal, p.id) : p.id === me ? myGain : null,
      })),
    [players, me, myGain, reveal],
  )
  return <View rows={rows} />
}
