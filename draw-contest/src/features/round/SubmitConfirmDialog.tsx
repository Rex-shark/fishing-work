// 交卷確認框（spec/draw-contest/design.md §2）：標題、內文與按鈕文字由殼層提供
// （ShellViews.Dialog，purpose 'submit'）；本元件只給行為：第一個選項＝交卷（Enter）、第二個＝取消（Esc），強制回應（焦點陷阱）。
// 放在殼層的 dialogs 插槽。開關狀態在 submitConfirm（「完成」開、取消／交卷關）。
import { selectCanDraw, useGameStore } from '../../store/game'
import { useShellViews, useTermsView } from '../../shells/views'
import { cancelSubmitConfirm, confirmSubmit, submitConfirmVisible, useSubmitConfirmStore } from './submitConfirm'

export function SubmitConfirmDialog() {
  const openRound = useSubmitConfirmStore((s) => s.openRound)
  const roundNo = useGameStore((s) => s.round.roundNo)
  const canDraw = useGameStore(selectCanDraw)
  if (!submitConfirmVisible(openRound, roundNo, canDraw)) return null
  return <SubmitConfirmView />
}

/** 交卷確認的對話框內容（不接 store 的部分；測試以假 Dialog 擷取 props） */
export function SubmitConfirmView() {
  const { Dialog } = useShellViews()
  // 選項文字用殼層的叫法（ppt「儲存」），與按鈕可見文字相同，不會多出洩底的工具提示
  const { save } = useTermsView()
  return (
    <Dialog
      purpose="submit"
      label={`${save}確認`}
      items={[
        { id: 'submit', label: save, detail: 'Enter', onSelect: () => void confirmSubmit() },
        { id: 'cancel', label: '取消', detail: 'Esc', onSelect: cancelSubmitConfirm },
      ]}
      onEscape={cancelSubmitConfirm}
      trapFocus
    />
  )
}
