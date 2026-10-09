// 玩家清單（功能部分）：整理每位玩家的列資料（自己、比賽是否進行中），外觀由殼層提供（ShellViews.PlayerList）。
// 顯示規則（spec/draw-contest/design.md §2「左縮圖窗格」）：出題者外框、已交卷勾、旁觀淡化、自己卡底、斷線淡化。
import { useMemo } from 'react'
import { useShellViews, type PlayerRowData } from '../../shells/views'
import { useGameStore } from '../../store/game'
import { isContestActive } from './playerRow'

export function PlayerList() {
  const { PlayerList: View } = useShellViews()
  const players = useGameStore((s) => s.players)
  const me = useGameStore((s) => s.me)
  const contestActive = useGameStore((s) => isContestActive(s.round.phase))
  const rows = useMemo<PlayerRowData[]>(
    () => players.map((p) => ({ player: p, isMe: p.id === me, contestActive })),
    [players, me, contestActive],
  )
  return <View rows={rows} />
}
