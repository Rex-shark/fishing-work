// ppt 主題提供給功能元件的呈現元件與外觀設定（ShellViews；DESIGN.md §13.2）。PptShell 以 ShellViewsContext 提供。
//   Dialog＝PptDialog（Office 對話框）、PlayerList＝SlidePlayers（縮圖窗格）、chat＝註解卡片（CommentChat）、
//   status＝淺灰狀態列上的深色字、toolbar＝功能區的收合斷點、volunteer＝「▶ 從目前投影片開始」、help＝說明內文的切換偽裝路徑（Epic 6）。
import type { ChatView, HelpView, ShellViews, StatusView, TermsView, ToolbarView, VolunteerView } from '../views'
import { CommentComposer, CommentLine } from './CommentChat'
import { PptDialog } from './PptDialog'
import { SlideshowIcon } from './pptIcons'
import { PPT_SWITCH_HINT, PPT_TERMS, START_SLIDESHOW_LABEL } from './pptLayout'
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
 * 功能區「繪圖」分頁：工具列獨占一整列的捲動區（tabpanel），「完成」固定在它右邊（不捲動，任何寬度都看得到；design §4）。
 * 繪圖比賽 Phase 2 第二段實測（2026-10-07，建置版、Chromium、視窗寬度模擬）：完整工具列 444.9px、連同群組內距與分隔 459px；
 * 「完成」固定區 60.5px；tabpanel 寬＝視窗 − 60px。視窗 519px 起 scrollWidth ≤ clientWidth（518px 溢出 1px），
 * 收合後（粗細滑桿進「⋯」）內容 350px。取 540px（約 20px 給字型差異，同我畫你猜 483→500 的留白慣例）：
 * 視窗 < 540px 才把粗細滑桿收進「⋯」；375px 時收合後的工具列仍可橫向捲動 35px，「完成」固定在右端（x 322–368）
 */
export const PPT_TOOLBAR_VIEW: ToolbarView = { compactBelowPx: 540 }

/** DESIGN §13.2 狀態列中央「▶ 從目前投影片開始」＝我來畫；人數不足時殼層以同一組文字與圖示顯示灰化版本 */
export const PPT_VOLUNTEER_VIEW: VolunteerView = { label: START_SLIDESHOW_LABEL, icon: SlideshowIcon }

/** 說明內文「如何切換偽裝」的 {switch}：功能區「檔案」→「切換偽裝…」 */
export const PPT_HELP_VIEW: HelpView = { switchHint: PPT_SWITCH_HINT }

/** 偽裝用語：題目＝「標題」、交卷＝「儲存」、揭曉畫廊＝「投影片瀏覽」 */
export const PPT_TERMS_VIEW: TermsView = PPT_TERMS

export const PPT_VIEWS: ShellViews = {
  Dialog: PptDialog,
  PlayerList: SlidePlayers,
  chat: PPT_CHAT_VIEW,
  toolbar: PPT_TOOLBAR_VIEW,
  status: PPT_STATUS_VIEW,
  volunteer: PPT_VOLUNTEER_VIEW,
  help: PPT_HELP_VIEW,
  terms: PPT_TERMS_VIEW,
}
