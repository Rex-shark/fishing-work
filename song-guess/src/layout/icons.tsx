// 線條圖示（Lucide 風格，1.5px 線寬，stroke = currentColor）。DESIGN.md §1：不用 emoji、不引入圖示庫。
// 顏色一律由外層的 token class（text-fg、text-sem-*…）透過 currentColor 決定，本檔不含色碼。
// 只留功能元件用得到的（連線狀態、錯誤提示、揭曉卡的封面佔位）；殼層自己的圖示在 shells/<主題>/。
import type { ReactNode } from 'react'

interface IconProps {
  /** 邊長 px；一般 16 */
  size?: number
  className?: string
}

function Svg({ size = 16, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={size >= 24 ? 1.25 : 1.5}
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

// ─── 連線狀態、錯誤提示 ─────────────────────────────────────────────

export function SyncIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
      <path d="M3 21v-5h5" />
      <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
      <path d="M21 3v5h-5" />
    </Svg>
  )
}

export function WarningIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Svg>
  )
}

export function ErrorIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </Svg>
  )
}

// ─── 揭曉卡 ─────────────────────────────────────────────────────

/** 音符：沒有專輯封面時的佔位 */
export function MusicNoteIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 18V5l11-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </Svg>
  )
}
