// ppt 主題提供給功能元件的呈現元件與外觀設定（ShellViews；DESIGN.md §13.2）。PptShell 以 ShellViewsContext 提供。
//   Dialog＝PptDialog（Office 對話框）、PlayerList＝SlidePlayers（縮圖窗格）、chat＝註解卡片（CommentChat）、
//   status＝淺灰狀態列上的深色字、toolbar＝功能區的收合斷點、volunteer＝「▶ 從目前投影片開始」。
import type { ChatView, ShellViews, StatusView, ToolbarView, VolunteerView } from '../views'
import { CommentComposer, CommentLine } from './CommentChat'
import { PptDialog } from './PptDialog'
import { SlideshowIcon } from './pptIcons'
import { START_SLIDESHOW_LABEL } from './pptLayout'
import { SlidePlayers } from './SlidePlayers'

/** 右註解窗格：窗格底色 --bg-sidebar、卡片之間 8px */
export const PPT_CHAT_VIEW: ChatView = {
  panelClassName: 'bg-sidebar leading-[18px]',
  listClassName: 'flex flex-col gap-2 p-2',
  Line: CommentLine,
  Composer: CommentComposer,
}

/**
 * 淺灰狀態列（§13.1 --bg-statusbar）上的可點項目：深色字 --fg（13.7:1）、hover 疊 --statusbar-hover（黑 6%）、
 * focus 外框 --border-focus（橘紅，對淺灰 4.8:1）。取代 vscode 的白字／白框（淺底上看不見）。
 */
export const PPT_STATUS_VIEW: StatusView = {
  buttonClassName: 'text-fg hover:bg-statusbar-hover focus-visible:outline-border-focus',
}

/**
 * 功能區「繪圖」分頁：工具列獨占一整列（功能區與視窗同寬，不與分頁或其他群組共用）；實測完整工具列 519px、連同群組內距 533px。
 * 視窗 < 640px 才把色相條與粗細滑桿收進「⋯」（保留約 100px 餘裕給捲軸與字型差異）；以上都放得下完整工具列，不必像 vscode 在 1100px 就收合。
 */
export const PPT_TOOLBAR_VIEW: ToolbarView = { compactBelowPx: 640 }

/** DESIGN §13.2 狀態列中央「▶ 從目前投影片開始」＝我來畫；人數不足時殼層以同一組文字與圖示顯示灰化版本 */
export const PPT_VOLUNTEER_VIEW: VolunteerView = { label: START_SLIDESHOW_LABEL, icon: SlideshowIcon }

export const PPT_VIEWS: ShellViews = {
  Dialog: PptDialog,
  PlayerList: SlidePlayers,
  chat: PPT_CHAT_VIEW,
  toolbar: PPT_TOOLBAR_VIEW,
  status: PPT_STATUS_VIEW,
  volunteer: PPT_VOLUNTEER_VIEW,
}
