// meet 主題的註冊資料（shells/index.ts）：視訊會議偽裝（DESIGN.md §15；plan/meet-theme.md 決策 7）。
import { VideoCallIcon } from '../themeIcons'
import type { ShellDefinition } from '../types'
import { meetWindowTitle } from './meetLayout'
import { MeetShell } from './MeetShell'

export const meetShell: ShellDefinition = {
  id: 'meet',
  name: '視訊會議',
  description: '深色視訊會議，像在開會分享畫面',
  // 自繪綠色攝影機（DESIGN §13.4 --brand-meet；不使用 Google 商標）
  icon: VideoCallIcon,
  Shell: MeetShell,
  // `Meet – kqw-mzdv-ptj`；作畫中前綴 `● `（DESIGN §15.3）
  titleFor: ({ phase }) => meetWindowTitle(phase),
  // 自繪攝影機圖示（draw-guess/public/favicon-meet.svg，依 Vite base 解析）
  faviconHref: `${import.meta.env.BASE_URL}favicon-meet.svg`,
}
