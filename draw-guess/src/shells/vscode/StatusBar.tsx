// vscode 主題的狀態列（DESIGN.md §5：高 22px、12px 字；自己是畫師時整條改 --bg-statusbar-drawer）。
// 左：分支與連線狀態等；中：回合階段與倒數；右：`Ln 12, Col 4  Spaces: 2  UTF-8  LF  TypeScript` 裝飾。
// < 768px 只留連線、階段、倒數（DESIGN §8）：各項以 hideOnMobile 控制。
import type { ReactNode } from 'react'
import { BellIcon, GitBranchIcon } from '../../layout/icons'
import { StatusItem } from '../../layout/StatusItem'

interface StatusBarProps {
  drawer?: boolean
  left?: ReactNode
  center?: ReactNode
}

export function StatusBar({ drawer = false, left, center }: StatusBarProps) {
  return (
    <footer
      aria-label="狀態列"
      className={`flex h-[22px] shrink-0 items-center overflow-hidden text-[12px] whitespace-nowrap text-fg-statusbar ${
        drawer ? 'bg-statusbar-drawer' : 'bg-statusbar'
      }`}
    >
      <div className="flex h-full shrink-0 items-center">
        <StatusItem hideOnMobile decorative>
          <GitBranchIcon size={14} />
          <span>main</span>
        </StatusItem>
        {left}
      </div>
      <div className="flex h-full min-w-0 flex-1 items-center">{center}</div>
      <div aria-hidden="true" className="flex h-full shrink-0 items-center max-md:hidden">
        <StatusItem>Ln 12, Col 4</StatusItem>
        <StatusItem className="max-xl:hidden">Spaces: 2</StatusItem>
        <StatusItem className="max-lg:hidden">UTF-8</StatusItem>
        <StatusItem className="max-lg:hidden">LF</StatusItem>
        <StatusItem>TypeScript</StatusItem>
        <StatusItem tooltip="Notifications">
          <BellIcon size={14} />
        </StatusItem>
      </div>
    </footer>
  )
}
