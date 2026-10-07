// excel 主題的聊天 renderer（ShellViews.chat；DESIGN.md §17.2「右註解窗格」）：Excel 的執行緒註解。
// 卡片與輸入列是兩套 Office 殼層共用的 OfficeCommentLine／OfficeCommentComposer（shells/office/CommentChat，與 ppt §13.2 相同）；
// 本檔只給 excel 的輸入框 placeholder「開始對話」（功能提示仍顯示在輸入框上方一行）。
import { OfficeCommentComposer } from '../office/CommentChat'
import type { ChatComposerProps } from '../views'
import { EXCEL_COMMENT_PLACEHOLDER } from './excelLayout'

export function ExcelCommentComposer(props: ChatComposerProps) {
  return <OfficeCommentComposer {...props} placeholder={EXCEL_COMMENT_PLACEHOLDER} />
}
