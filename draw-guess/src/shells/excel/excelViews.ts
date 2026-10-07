// excel 主題提供給功能元件的呈現元件與外觀設定（ShellViews；DESIGN.md §17.2、§17.3）。ExcelShell 以 ShellViewsContext 提供。
//   Dialog＝ExcelDialog（Office 對話框：替代文字／刪除圖片？）、PlayerList＝SheetPlayers（A–C 欄人員表格）、
//   chat＝Office 註解卡片（placeholder「開始對話」）、status＝淺灰狀態列與功能區上的深色字（同 ppt）、toolbar＝「圖片格式」分頁的收合斷點、
//   volunteer＝「插入圖片」、help＝說明內文的切換偽裝路徑（「檔案 → 切換偽裝」）。
import { OfficeCommentLine } from '../office/CommentChat'
import type { ChatView, HelpView, ShellViews, StatusView, ToolbarView, VolunteerView } from '../views'
import { ExcelCommentComposer } from './ExcelComments'
import { ExcelDialog } from './ExcelDialog'
import { InsertPictureIcon } from './excelIcons'
import { EXCEL_SWITCH_HINT, INSERT_PICTURE_LABEL } from './excelLayout'
import { SheetPlayers } from './SheetPlayers'

/** 右註解窗格：窗格底色 --bg-sidebar、卡片之間 8px（同 ppt） */
export const EXCEL_CHAT_VIEW: ChatView = {
  panelClassName: 'bg-sidebar leading-[18px]',
  listClassName: 'flex flex-col gap-2 p-2',
  Line: OfficeCommentLine,
  Composer: ExcelCommentComposer,
}

/** 淺灰狀態列（--bg-statusbar）與白色功能區上的可點項目：深色字 --fg、hover 疊 --statusbar-hover、focus 外框 --border-focus（綠，同 ppt 做法） */
export const EXCEL_STATUS_VIEW: StatusView = {
  buttonClassName: 'text-fg hover:bg-statusbar-hover focus-visible:outline-border-focus',
}

/**
 * 功能區「圖片格式」分頁：工具列獨占一整列（功能區與視窗同寬），版面同 ppt 的「繪圖」分頁。
 * 實測（2026-10-06，Epic 13 Phase 2；DESIGN §17.4）：完整工具列約 469px、連群組內距 483px 起功能區內容容器 scrollWidth ≤ clientWidth
 * （482px 溢出 1px）；取 500px，留 17px 給字型差異。建置版驗證 499px 收合、500px 完整、無溢出。視窗小於此值才把粗細滑桿收進「⋯」
 */
export const EXCEL_TOOLBAR_VIEW: ToolbarView = { compactBelowPx: 500 }

/** DESIGN §17.2「常用」最右群組「插入圖片」＝我來畫；人數不足時殼層以同一組文字與圖示顯示灰化版本 */
export const EXCEL_VOLUNTEER_VIEW: VolunteerView = { label: INSERT_PICTURE_LABEL, icon: InsertPictureIcon }

/** 說明內文「如何切換偽裝」的 {switch}：功能區「檔案」→「切換偽裝…」（與 ppt 相同） */
export const EXCEL_HELP_VIEW: HelpView = { switchHint: EXCEL_SWITCH_HINT }

export const EXCEL_VIEWS: ShellViews = {
  Dialog: ExcelDialog,
  PlayerList: SheetPlayers,
  chat: EXCEL_CHAT_VIEW,
  toolbar: EXCEL_TOOLBAR_VIEW,
  status: EXCEL_STATUS_VIEW,
  volunteer: EXCEL_VOLUNTEER_VIEW,
  help: EXCEL_HELP_VIEW,
}
