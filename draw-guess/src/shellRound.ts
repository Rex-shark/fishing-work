// 殼層回合狀態的推導（純函式，可單元測試；plan/meet-theme.md 決策 12；architecture §7 shells/types.ts）。
// App 由 store 推導後經 ShellProps.round 注入：殼層不讀 store/game（shellBoundary 把關），與 counts 同一模式。
// 獨立成檔：App.tsx 只匯出元件（react-refresh 規則），與 pickScreen.ts 相同。
import type { PlayerPublic, RoundPublic } from '@fishing-work/shared'

/**
 * 本回合畫師的暱稱（ShellRoundState.drawerName）：idle（沒有回合）為 null；choosing／drawing／ended 依 round.drawerId 找玩家，
 * 找不到（畫師已離開）為 null。ended 仍回傳暱稱（揭曉時標籤照舊顯示）。
 */
export function drawerNameOf(
  round: Pick<RoundPublic, 'phase' | 'drawerId'>,
  players: readonly Pick<PlayerPublic, 'id' | 'nickname'>[],
): string | null {
  if (round.phase === 'idle' || round.drawerId === null) return null
  return players.find((p) => p.id === round.drawerId)?.nickname ?? null
}
