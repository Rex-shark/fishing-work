// ppt 主題的聊天 renderer（ShellViews.chat；DESIGN.md §13.2「右註解窗格」）：PowerPoint 的註解卡片。
// 卡片與輸入列是兩套 Office 殼層共用的 OfficeCommentLine／OfficeCommentComposer（Epic 13 由本檔抽到 shells/office/，輸出與抽出前逐字相同）；
// 本檔只給 ppt 的輸入框 placeholder「新增註解…」。
import { OfficeCommentComposer, OfficeCommentLine } from '../office/CommentChat'
import type { ChatComposerProps, ChatLineProps } from '../views'
import { COMMENT_PLACEHOLDER } from './commentFormat'

export function CommentLine(props: ChatLineProps) {
  return <OfficeCommentLine {...props} />
}

/** 輸入列：placeholder 固定「新增註解…」保偽裝；功能提示改顯示在輸入框上方一行（DESIGN §13.2） */
export function CommentComposer(props: ChatComposerProps) {
  return <OfficeCommentComposer {...props} placeholder={COMMENT_PLACEHOLDER} />
}
