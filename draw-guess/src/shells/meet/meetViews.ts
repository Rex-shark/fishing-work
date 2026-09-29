// meet 主題提供給功能元件的呈現元件與外觀設定（ShellViews；DESIGN.md §15.2、§15.3）。MeetShell 以 ShellViewsContext 提供。
//   Dialog＝MeetDialog（白卡片、藍字按鈕）、PlayerList＝ParticipantTiles（參加者 tile）、chat＝「通話中的訊息」（MeetChat）、
//   status＝深色控制列的圓形按鈕、toolbar＝收合斷點 900px、volunteer＝「分享畫面」＋分享圖示、help＝說明內文的切換偽裝路徑（Epic 6）。
// 本檔不得 import MeetShell（MeetShell 反過來 import 本檔；踩雷紀錄：views.ts 循環 import）。
import type { ChatView, HelpView, ShellViews, StatusView, ToolbarView, VolunteerView } from '../views'
import { MeetDialog } from './MeetDialog'
import { MeetChatLine, MeetComposer } from './MeetChat'
import { ShareScreenIcon } from './meetIcons'
import { MEET_BREAKPOINTS, MEET_SWITCH_HINT, SHARE_SCREEN_LABEL } from './meetLayout'
import { ParticipantTiles } from './ParticipantTiles'

/** 右側白色面板：底 --bg-panel、訊息之間 4px */
export const MEET_CHAT_VIEW: ChatView = {
  panelClassName: 'bg-panel text-fg-on-panel leading-[20px]',
  listClassName: 'flex flex-col gap-[4px] py-[8px]',
  Line: MeetChatLine,
  Composer: MeetComposer,
  // 拖圖覆蓋層：白底 90%、2px 虛線與文字皆 --accent-panel（決策 13(2)；預設的 --bg-selection＋--fg 在白面板上看不見）
  overlayClassName: 'border-2 border-dashed border-accent-panel bg-panel/90 text-accent-panel',
}

/**
 * 底部控制列的「分享畫面」（StatusButton，目前只有 volunteer 用）：40px 圓形按鈕（寬高由 MeetShell 的外框給），
 * 底 --bg-button-secondary、hover --bg-button-secondary-hover、白字圖示、focus 外框 --border-focus（DESIGN §15.2）。
 */
export const MEET_STATUS_VIEW: StatusView = {
  buttonClassName:
    'w-full justify-center rounded-full bg-button-secondary text-fg hover:bg-button-secondary-hover focus-visible:outline-border-focus',
}

/**
 * 浮動工具列（主畫面上方置中）：視窗 < 1280px 時色相條與粗細滑桿收進「⋯」（決策 13(4)；1024–1279px 時主畫面 tile 只有 456–672px，
 * 完整工具列約 576px（膠囊含內距 600px）放不下；vscode 1120、ppt 640）
 */
export const MEET_TOOLBAR_VIEW: ToolbarView = { compactBelowPx: MEET_BREAKPOINTS.stripNarrow }

/** 「分享畫面」＝我來畫（DESIGN §15.2）；無障礙名稱為「分享畫面：自願當畫師」 */
export const MEET_VOLUNTEER_VIEW: VolunteerView = { label: SHARE_SCREEN_LABEL, icon: ShareScreenIcon }

/** 說明內文「如何切換偽裝」的 {switch}：控制列「更多 ⋮」→「切換偽裝…」 */
export const MEET_HELP_VIEW: HelpView = { switchHint: MEET_SWITCH_HINT }

export const MEET_VIEWS: ShellViews = {
  Dialog: MeetDialog,
  PlayerList: ParticipantTiles,
  chat: MEET_CHAT_VIEW,
  toolbar: MEET_TOOLBAR_VIEW,
  status: MEET_STATUS_VIEW,
  volunteer: MEET_VOLUNTEER_VIEW,
  help: MEET_HELP_VIEW,
}
