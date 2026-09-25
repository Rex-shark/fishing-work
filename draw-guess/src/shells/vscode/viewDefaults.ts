// vscode 主題提供給功能元件的外觀設定（ShellViews 的選填欄位）；也是 shells/views 的 DEFAULT_*：
// 殼層沒有提供 chat／toolbar／status／volunteer 時，功能元件沿用這裡的 vscode 外觀。
// 本檔不得在執行期 import shells/views（views 反過來 import 本檔當預設值；只能 import type）。
import type { ChatView, StatusView, ToolbarView, VolunteerView } from '../views'
import { PlayIcon } from '../../layout/icons'
import { TerminalChatLine, TerminalComposer } from './TerminalChat'

/** 底部 TERMINAL 面板：編輯區底色、18px 行高、左右 12px */
export const VSCODE_CHAT_VIEW: ChatView = {
  panelClassName: 'bg-editor leading-[18px]',
  listClassName: 'px-3 py-1',
  Line: TerminalChatLine,
  Composer: TerminalComposer,
}

/** DESIGN §5：分頁列右側的工具列寬度不足（視窗 < 1100px）時色相條與滑桿收進「⋯」 */
export const VSCODE_TOOLBAR_VIEW: ToolbarView = { compactBelowPx: 1100 }

/** 藍／橘狀態列上的可點項目：白字、hover 白色 20% 疊底、focus 白色外框（--border-focus 在彩色底上看不見） */
export const VSCODE_STATUS_VIEW: StatusView = {
  buttonClassName: 'text-fg-statusbar hover:bg-statusbar-hover focus-visible:outline-focus-on-color',
}

/** DESIGN §5 狀態列左側「▷ 我來畫」（仿執行按鈕） */
export const VSCODE_VOLUNTEER_VIEW: VolunteerView = { label: '我來畫', icon: PlayIcon }
