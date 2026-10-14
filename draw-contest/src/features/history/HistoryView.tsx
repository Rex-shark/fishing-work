// 比賽歷史的檢視（Epic 17；spec/draw-contest/design.md §2「歷史檢視」列、§3.1）：開著的那一筆存檔，重用揭曉畫廊（reveal 的 RevealView）。
//   HistoryView：存檔那場的畫、名次、分數、評語（沒有「產生中」；自己當時那張照樣標示）；放大檢視沿用 RevealView 的。
//     圖片的 object URL 由 historyStore 管（開啟時從 Blob 建立，關閉／換開另一筆／自動關閉時 revoke），本元件只讀。
//   HistoryStatus：回合狀態列位置的一行摘要（historyDisplay.historyNotes）。
// 殼層在 ShellProps.history.openId 非 null 時把這兩個元件放進對應的位置；入口與檢視的叫法來自 ShellViews.terms，本檔不寫死偽裝字樣。
import { StatusItem } from '../../layout/StatusItem'
import { useTermsView } from '../../shells/views'
import { RevealView } from '../reveal/Reveal'
import { historyCards, historyNotes } from './historyDisplay'
import { useHistoryStore } from './historyStore'

/** 存檔的揭曉畫廊；沒有開著的歷史時不渲染 */
export function HistoryView() {
  const open = useHistoryStore((s) => s.open)
  const terms = useTermsView()
  if (open === null) return null
  // key：換開另一筆時重新掛載（放大檢視回到網格）
  return <RevealView key={open.record.id} cards={historyCards(open.record, open.urls, terms)} label={terms.gallery} />
}

/** 檢視時的回合狀態列：一行摘要，過長以 … 截斷（同 RoundStatus 的最後一段） */
export function HistoryStatus() {
  const record = useHistoryStore((s) => s.open?.record ?? null)
  const terms = useTermsView()
  if (record === null) return null
  return (
    <div role="status" aria-live="polite" className="flex h-full min-w-0 items-center">
      <StatusItem truncate>{historyNotes(record, terms)}</StatusItem>
    </div>
  )
}
