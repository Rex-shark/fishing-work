// 放棄本回合的確認：不用 window.confirm，改用殼層提供的對話框（ShellViews.Dialog；DESIGN.md §5「放棄回合」）。
// Enter／點選「放棄本回合」送出 round:cancel；Esc 或「繼續作畫」關閉。失去作畫權（回合結束）時自動關閉。
// 送出中（busy）交給殼層：沒有輸入框，選項只設 aria-disabled（焦點不會掉）；失敗後焦點若已不在對話框內，殼層放回第一個可用選項。
import { useEffect, useState } from 'react'
import { useUiStore } from '../../layout/uiStore'
import { useShellViews } from '../../shells/views'
import { cancelRound } from '../../socket/client'
import { selectCanDraw, useGameStore } from '../../store/game'

export function CancelConfirm() {
  const open = useUiStore((s) => s.cancelConfirmOpen)
  const setOpen = useUiStore((s) => s.setCancelConfirmOpen)
  const canDraw = useGameStore(selectCanDraw)

  // 回合已結束（時間到、全員猜對、斷線）就不再需要確認
  useEffect(() => {
    if (!canDraw && open) setOpen(false)
  }, [canDraw, open, setOpen])

  if (!open || !canDraw) return null
  return <CancelPick onClose={() => setOpen(false)} />
}

function CancelPick({ onClose }: { onClose: () => void }) {
  const { Dialog } = useShellViews()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    if (busy) return
    setBusy(true)
    setError(null)
    const r = await cancelRound()
    setBusy(false)
    if (r.ok) onClose()
    else setError(r.message)
  }

  return (
    <Dialog
      purpose="cancelRound"
      label="放棄本回合"
      title="放棄這一回合？題目會直接揭曉。"
      busy={busy}
      items={[
        { id: 'confirm', label: busy ? '放棄中…' : '放棄本回合', detail: 'Enter', onSelect: () => void handleConfirm(), disabled: busy },
        { id: 'keep', label: '繼續作畫', detail: 'Esc', onSelect: onClose },
      ]}
      onEscape={onClose}
      error={error}
    />
  )
}
