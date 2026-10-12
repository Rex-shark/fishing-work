// 主題卡片圖示（複製自我畫你猜；DESIGN.md §13.4）：自繪通用版，不使用 Google 商標。猜歌 v1 只有視訊會議。
// 顏色固定為跨主題 token（text-brand-meet → theme.css 的 --brand-meet），
// 不隨 data-theme 改變：卡片列在任何主題下都顯示同一組圖示。本檔不含色碼。
// 由註冊表（各主題的 definition.icon）與 catalog 的「即將推出」項目共用，因此放在 shells/ 根層、不屬於任一主題資料夾。
import type { ReactNode } from 'react'

interface ThemeIconProps {
  /** 邊長 px；卡片 40 */
  size?: number
  className?: string
}

function ThemeSvg({ size = 40, className, children }: ThemeIconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className ?? ''}`}
    >
      {children}
    </svg>
  )
}

/** 視訊會議：綠色攝影機（機身圓角方塊＋右側鏡頭三角；DESIGN §13.4 --brand-meet） */
export function VideoCallIcon({ className, ...p }: ThemeIconProps) {
  return (
    <ThemeSvg {...p} className={`text-brand-meet ${className ?? ''}`}>
      <rect x="2.5" y="6" width="13" height="12" rx="2.5" fill="currentColor" stroke="none" />
      <path d="M17.5 10.2 21.5 7.5v9l-4-2.7Z" fill="currentColor" stroke="none" />
    </ThemeSvg>
  )
}
