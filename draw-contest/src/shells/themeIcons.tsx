// 主題卡片圖示（複製自我畫你猜；DESIGN.md §13.4）：自繪通用版，不使用 Microsoft 商標。繪圖比賽 MVP 只有簡報。
// 顏色固定為跨主題 token（text-brand-slides → theme.css 的 --brand-slides），
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

/** 簡報：橘紅投影片方塊（外框＋標題色塊＋內容色塊＋腳架） */
export function SlidesIcon({ className, ...p }: ThemeIconProps) {
  return (
    <ThemeSvg {...p} className={`text-brand-slides ${className ?? ''}`}>
      <rect x="2.5" y="3.5" width="19" height="13" rx="1.5" />
      <rect x="5.5" y="6.5" width="8" height="2.5" rx="0.5" fill="currentColor" stroke="none" />
      <rect x="5.5" y="10.5" width="13" height="3" rx="0.5" fill="currentColor" stroke="none" opacity="0.55" />
      <path d="M12 16.5v3.5" />
      <path d="M8.5 20.5h7" />
    </ThemeSvg>
  )
}
