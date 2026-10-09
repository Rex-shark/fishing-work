// 遊戲說明的開關（Epic 6 決策 3）：App 以 openHelp 實作 ShellProps.help.open，HelpDialog 以 closeHelp 關閉。
// 狀態在 uiStore.helpTopic；另外記住開啟當下有焦點的元素（殼層的說明入口），關閉時把焦點還給它（元素已不在畫面上時略過）。
// 獨立成 .ts：HelpDialog.tsx 只匯出元件（react-refresh 規則）。
import { useUiStore } from '../../layout/uiStore'
import type { HelpTopicId } from './helpTopics'

/** 開啟說明時有焦點的元素（關閉時還焦點用） */
let opener: HTMLElement | null = null

/** 目前有焦點的元素；非瀏覽器環境（測試）為 null */
function focusedElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const el = document.activeElement
  return typeof HTMLElement !== 'undefined' && el instanceof HTMLElement && el !== document.body ? el : null
}

/** 開啟說明：省略 topicId＝主題清單；給 topicId＝直接顯示該主題內文 */
export function openHelp(topicId?: HelpTopicId): void {
  opener = focusedElement()
  useUiStore.getState().setHelpTopic(topicId ?? 'list')
}

/** 關閉說明，焦點還給開啟它的元素 */
export function closeHelp(): void {
  const el = opener
  opener = null
  useUiStore.getState().setHelpTopic(null)
  if (el !== null && el.isConnected) el.focus()
}
