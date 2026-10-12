// 狀態列式的一行項目（功能元件與殼層共用的基本元件；DESIGN.md §5「狀態列」、§8 響應式）。
// StatusItem：非互動項目（h-full、左右 5px，文字色沿用外層容器）；StatusButton：可點項目（仿「▷ 執行」）。高度由外層容器決定。
// StatusButton 的色彩（文字、hover、focus 外框）由殼層決定（ShellViews.status.buttonClassName；預設為彩色狀態列上的白字）。
// StatusButton 送出中（busy）只設 aria-disabled＋aria-busy、不用原生 disabled：被停用的按鈕會失去焦點，
// 鍵盤觸發後若失敗（例如人數不足），焦點要留在按鈕上才能再按（plan/notes.md 2026-10-12）。
import type { ReactNode } from 'react'
import { useStatusView } from '../shells/views'
import { tip } from './tooltipPlacement'

/** 狀態列上的一個項目（非互動）；互動項目用 StatusButton。truncate：文字過長時以 … 截斷 */
export function StatusItem(props: {
  children: ReactNode
  decorative?: boolean
  hideOnMobile?: boolean
  truncate?: boolean
  className?: string
  /** 裝飾項目的懸停提示（仿 VS Code，英文） */
  tooltip?: string
}) {
  const { children, decorative, hideOnMobile, truncate, className, tooltip } = props
  return (
    <span
      aria-hidden={decorative}
      {...(tooltip === undefined ? {} : tip(tooltip, 'top'))}
      className={`flex h-full min-w-0 items-center gap-1 px-[5px] ${hideOnMobile ? 'max-md:hidden' : ''} ${className ?? ''}`}
    >
      {truncate ? <span className="min-w-0 truncate">{children}</span> : children}
    </span>
  )
}

/**
 * 狀態列上的可點項目（仿「▷ 執行」）：色彩由殼層提供（預設：hover 以白色 20% 疊底，focus 白色外框，藍／橘底上 --border-focus 看不見）。
 * busy＝送出中（等 server 回應）：外觀同停用（60% 透明、預設游標、沒有 hover 底），按了不會觸發 onClick；仍可聚焦，焦點不會掉
 */
export function StatusButton(props: {
  children: ReactNode
  onClick: () => void
  label: string
  busy?: boolean
}) {
  const { children, onClick, label, busy = false } = props
  const { buttonClassName } = useStatusView()
  return (
    <button
      type="button"
      onClick={() => {
        if (!busy) onClick()
      }}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      aria-label={label}
      {...tip(label, 'top')}
      className={`flex h-full shrink-0 cursor-pointer items-center gap-1 px-[6px] ${buttonClassName} transition-colors duration-100 focus-visible:outline-1 focus-visible:-outline-offset-1 aria-disabled:cursor-default aria-disabled:opacity-60 aria-disabled:hover:bg-transparent`}
    >
      {children}
    </button>
  )
}
