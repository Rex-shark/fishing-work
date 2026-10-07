// ppt 主題的對話框（ShellViews.Dialog；DESIGN.md §13.2「對話框」、§13.3）：取代 vscode 的快速輸入框。
// 外觀與行為是兩套 Office 殼層共用的 OfficeDialog（Epic 13 由本檔抽到 shells/office/，輸出與抽出前逐字相同）；
// 本檔只給 ppt 的文字：標題「輸入標題」「捨棄變更？」、按鈕「確定」「取消」、自動重連「加入簡報」。
import { OfficeDialog, OfficeResumeDialog, type OfficeDialogConfig } from '../office/OfficeDialog'
import type { DialogProps } from '../views'
import { PPT_DIALOG_TITLE, PPT_RESUME_TITLE } from './pptLayout'

const PPT_DIALOG_CONFIG: OfficeDialogConfig = { titles: PPT_DIALOG_TITLE }

export function PptDialog(props: DialogProps) {
  return <OfficeDialog {...props} config={PPT_DIALOG_CONFIG} />
}

/** 自動重連畫面（ShellProps screen 'resume'）的對話框：標題「加入簡報」＋一行提示（role="status"） */
export function PptResumeDialog({ notice }: { notice: string }) {
  return <OfficeResumeDialog title={PPT_RESUME_TITLE} notice={notice} />
}
