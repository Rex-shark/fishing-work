// 狀態列左側的連線狀態（DESIGN.md §5：`⟳ 已連線` / `⚠ 重新連線中`）。狀態列一律白字，以圖示區分狀態。
import { SyncIcon, WarningIcon } from '../../layout/icons'
import { useGameStore, type ConnectionState } from '../../store/game'

const LABEL: Record<ConnectionState, string> = {
  connected: '已連線',
  connecting: '連線中…',
  disconnected: '未連線',
}

/** 已加入後的「連線中」代表斷線重連中 */
export function ConnectionStatus() {
  const connection = useGameStore((s) => s.connection)
  const joined = useGameStore((s) => s.me !== null)
  const label = joined && connection === 'connecting' ? '重新連線中…' : LABEL[connection]
  return (
    <span role="status" aria-live="polite" className="flex h-full shrink-0 items-center gap-1 px-[5px]">
      {connection === 'connected' ? <SyncIcon size={14} /> : <WarningIcon size={14} />}
      <span>{label}</span>
    </span>
  )
}
