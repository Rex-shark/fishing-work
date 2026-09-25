// vscode 主題的註冊資料（shells/index.ts）：程式編輯器偽裝（DESIGN.md §3–§5）。
import { CodeEditorIcon } from '../themeIcons'
import type { ShellDefinition } from '../types'
import { windowTitle } from './ideLayout'
import { VscodeShell } from './VscodeShell'

export const vscodeShell: ShellDefinition = {
  id: 'vscode',
  name: '程式編輯器',
  description: '深色程式編輯器，像在改程式碼',
  // 自繪藍色角括號（決策 8；DESIGN §13.4 --brand-editor）
  icon: CodeEditorIcon,
  Shell: VscodeShell,
  // `canvas.ts - fishing-work`；作畫中前綴 `● `（DESIGN §5 視窗標題）
  titleFor: ({ phase }) => windowTitle(phase),
  // 一般文件圖示（draw-guess/public/favicon.svg，依 Vite base 解析）
  faviconHref: `${import.meta.env.BASE_URL}favicon.svg`,
}
