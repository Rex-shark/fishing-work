// 回合狀態的呈現（純邏輯，可單元測試）：階段文字、結束原因、題目字數提示、「我來畫」顯示條件。
// 文字依 DESIGN.md §5；規則依 spec/overview.md 與 architecture §5。狀態列色調屬殼層。
import { MIN_PLAYERS, type EndReason, type PlayerPublic, type RoundPhase } from '@fishing-work/shared'

export const PHASE_LABEL: Record<RoundPhase, string> = {
  idle: '等待中',
  choosing: '出題中',
  drawing: '作畫中',
  ended: '揭曉',
}

/** choosing 的取消與逾時都是 cancelled，統一顯示「回合取消」（architecture §7 RoundBar 規則沿用） */
export const END_REASON_LABEL: Record<Exclude<EndReason, null>, string> = {
  allGuessed: '全員猜對',
  timeout: '時間到',
  drawerLeft: '畫師離開',
  cancelled: '回合取消',
}

/** 倒數最後幾秒改警示（DESIGN §7：狀態列上用白字＋警示圖示，不閃爍） */
export const WARNING_SECONDS = 10

export function isCountdownWarning(remaining: number | null): boolean {
  return remaining !== null && remaining <= WARNING_SECONDS
}

/** 猜題者看到的題目字數提示：`＿ ＿ ＿`（每字一個全形底線，以半形空白分隔）；0 或非法值回空字串 */
export function topicBlanks(length: number | null): string {
  if (length === null || !Number.isInteger(length) || length <= 0) return ''
  return Array.from({ length }, () => '＿').join(' ')
}

/** 在線（connected）人數；selector 用，回傳數字避免 Zustand 無限重繪 */
export function countConnected(players: readonly Pick<PlayerPublic, 'connected'>[]): number {
  return players.filter((p) => p.connected).length
}

/** 「▷ 我來畫」只在 idle 且在線人數 ≥ MIN_PLAYERS 時顯示（DESIGN §5 狀態列；server 同條件，architecture §5 volunteer） */
export function canVolunteer(phase: RoundPhase, connectedCount: number): boolean {
  return phase === 'idle' && connectedCount >= MIN_PLAYERS
}

/** 「我來畫」按鈕的無障礙名稱：以可見文字開頭（WCAG 2.5.3 label in name），再說明動作；文字由殼層決定（ShellViews.volunteer） */
export function volunteerAriaLabel(label: string): string {
  return `${label}：自願當畫師`
}
