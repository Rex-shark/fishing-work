// meet 主題提供給功能元件的呈現元件與外觀設定（ShellViews；DESIGN.md §15.2、§15.3；spec/song-guess/design.md §1）。MeetShell 以 ShellViewsContext 提供。
//   Dialog＝MeetDialog（白卡片、藍字按鈕）、PlayerList＝ParticipantTiles（參加者 tile）、Stage＝MeetStage（主畫面的音訊波形與文字）、
//   Volume＝MeetVolume（控制列的喇叭圖示＋浮出的滑桿）、chat＝「通話中的訊息」（MeetChat）、status＝深色控制列的圓形按鈕、
//   volunteer＝「分享音訊」＋圖示、help＝說明內文的切換偽裝路徑。
// 本檔不得 import MeetShell（MeetShell 反過來 import 本檔；踩雷紀錄：views.ts 循環 import）。
import type { ChatView, HelpView, ShellViews, StatusView, VolunteerView } from '../views'
import { MeetDialog } from './MeetDialog'
import { MeetChatLine, MeetComposer } from './MeetChat'
import { ShareAudioIcon } from './meetIcons'
import { MEET_SWITCH_HINT, SHARE_AUDIO_LABEL } from './meetLayout'
import { MeetStage } from './MeetStage'
import { MeetVolume } from './MeetVolume'
import { ParticipantTiles } from './ParticipantTiles'

/** 右側白色面板：底 --bg-panel、訊息之間 4px */
export const MEET_CHAT_VIEW: ChatView = {
  panelClassName: 'bg-panel text-fg-on-panel leading-[20px]',
  listClassName: 'flex flex-col gap-[4px] py-[8px]',
  Line: MeetChatLine,
  Composer: MeetComposer,
}

/**
 * 底部控制列的「分享音訊」（StatusButton，目前只有 volunteer 用）：40px 圓形按鈕（寬高由 MeetShell 的外框給），
 * 底 --bg-button-secondary、hover --bg-button-secondary-hover、白字圖示、focus 外框 --border-focus（DESIGN §15.2）。
 */
export const MEET_STATUS_VIEW: StatusView = {
  buttonClassName:
    'w-full justify-center rounded-full bg-button-secondary text-fg hover:bg-button-secondary-hover focus-visible:outline-border-focus',
}

/** 「分享音訊」＝出題（design §1）；無障礙名稱為「分享音訊：出題」 */
export const MEET_VOLUNTEER_VIEW: VolunteerView = { label: SHARE_AUDIO_LABEL, icon: ShareAudioIcon }

/** 說明內文「切換偽裝」的 {switch}：控制列「更多 ⋮」→「切換偽裝…」 */
export const MEET_HELP_VIEW: HelpView = { switchHint: MEET_SWITCH_HINT }

export const MEET_VIEWS: ShellViews = {
  Dialog: MeetDialog,
  PlayerList: ParticipantTiles,
  Stage: MeetStage,
  Volume: MeetVolume,
  chat: MEET_CHAT_VIEW,
  status: MEET_STATUS_VIEW,
  volunteer: MEET_VOLUNTEER_VIEW,
  help: MEET_HELP_VIEW,
}
