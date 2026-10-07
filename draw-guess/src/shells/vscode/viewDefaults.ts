// vscode 主題提供給功能元件的外觀設定（ShellViews 的選填欄位）；也是 shells/views 的 DEFAULT_*：
// 殼層沒有提供 chat／toolbar／status／volunteer／help 時，功能元件沿用這裡的 vscode 外觀。
// 本檔不得在執行期 import shells/views（views 反過來 import 本檔當預設值；只能 import type）。
import type { ChatView, HelpView, StatusView, ToolbarView, VolunteerView } from '../views'
import { PlayIcon } from '../../layout/icons'
import { TerminalChatLine, TerminalComposer } from './TerminalChat'

/** 底部 TERMINAL 面板：編輯區底色、18px 行高、左右 12px */
export const VSCODE_CHAT_VIEW: ChatView = {
  panelClassName: 'bg-editor leading-[18px]',
  listClassName: 'px-3 py-1',
  Line: TerminalChatLine,
  Composer: TerminalComposer,
}

/**
 * DESIGN §5：分頁列右側的工具列寬度不足（視窗 < 810px）時粗細滑桿收進「⋯」。
 * Epic 11 移除色相條、目前顏色改 22px 按鈕，完整工具列約 468px（Epic 7 為 576px，當時斷點 1120px）：
 * 實測分頁列右側容器 790px 起 scrollWidth ≤ clientWidth（790px 時 481／481 剛好貼齊、789px 溢出 1px；
 * < 1024px 側欄收成覆蓋層，編輯區反而變寬，790px 以上全部放得下）；取 810px，留約 20px 給字型差異（舵手 2026-10-03 定案）
 */
export const VSCODE_TOOLBAR_VIEW: ToolbarView = { compactBelowPx: 810 }

/** 藍／橘狀態列上的可點項目：白字、hover 白色 20% 疊底、focus 白色外框（--border-focus 在彩色底上看不見） */
export const VSCODE_STATUS_VIEW: StatusView = {
  buttonClassName: 'text-fg-statusbar hover:bg-statusbar-hover focus-visible:outline-focus-on-color',
}

/** DESIGN §5 狀態列左側「▷ 我來畫」（仿執行按鈕） */
export const VSCODE_VOLUNTEER_VIEW: VolunteerView = { label: '我來畫', icon: PlayIcon }

/** 遊戲說明「如何切換偽裝」的路徑（DESIGN §5 活動列設定齒輪 → 選單；plan/help-topics.md 決策 6） */
export const VSCODE_HELP_VIEW: HelpView = { switchHint: '左下角齒輪 → 切換偽裝' }
