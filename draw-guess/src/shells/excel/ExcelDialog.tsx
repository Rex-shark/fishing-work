// excel 主題的對話框（ShellViews.Dialog；DESIGN.md §17.2「對話框」）：兩套 Office 殼層共用的 OfficeDialog（shells/office/），本檔只給 excel 的文字：
//   出題＝圖片的「替代文字」（說明一行「為這張圖片輸入描述」、輸入框、「確定」「取消」）；
//   放棄確認＝「刪除圖片？」（「刪除」主要、「取消」）；說明依 §16；自動重連「開啟活頁簿」＋一行「正在重新加入…」（role="status"）。
import { OfficeDialog, OfficeResumeDialog, type OfficeDialogConfig } from '../office/OfficeDialog'
import type { DialogProps } from '../views'
import { ALT_TEXT_DESCRIPTION, EXCEL_DIALOG_TITLE, EXCEL_RESUME_TITLE, excelDialogButtonText } from './excelLayout'

const EXCEL_DIALOG_CONFIG: OfficeDialogConfig = {
  titles: EXCEL_DIALOG_TITLE,
  descriptions: { topic: ALT_TEXT_DESCRIPTION },
  buttonText: excelDialogButtonText,
}

export function ExcelDialog(props: DialogProps) {
  return <OfficeDialog {...props} config={EXCEL_DIALOG_CONFIG} />
}

/** 自動重連畫面（ShellProps screen 'resume'）的對話框：標題「開啟活頁簿」＋一行提示 */
export function ExcelResumeDialog({ notice }: { notice: string }) {
  return <OfficeResumeDialog title={EXCEL_RESUME_TITLE} notice={notice} />
}
