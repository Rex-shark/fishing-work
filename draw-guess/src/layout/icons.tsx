// 線條圖示（Lucide / Codicons 風格，1.5px 線寬，stroke = currentColor）。DESIGN.md §1：不用 emoji、不引入圖示庫。
// 顏色一律由外層的 token class（text-fg、text-sem-*…）透過 currentColor 決定，本檔不含色碼。
import type { ReactNode } from 'react'

interface IconProps {
  /** 邊長 px；一般 16，活動列 24 */
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

// ─── 活動列 ─────────────────────────────────────────────────────

export function FilesIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M15 2H8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V6Z" />
      <path d="M15 2v4h4" />
      <path d="M6 6H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-1" />
    </Svg>
  )
}

export function SearchIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.35-4.35" />
    </Svg>
  )
}

export function SourceControlIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="6" cy="5" r="2.5" />
      <circle cx="6" cy="19" r="2.5" />
      <circle cx="18" cy="7" r="2.5" />
      <path d="M6 7.5v9" />
      <path d="M18 9.5c0 5-6 4-11 8" />
    </Svg>
  )
}

export function ExtensionsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="11" width="10" height="10" rx="1" />
      <path d="M3 16h10" />
      <path d="M8 11v10" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
    </Svg>
  )
}

export function AccountIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
    </Svg>
  )
}

export function GearIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </Svg>
  )
}

// ─── 樹狀、分頁、面板 ─────────────────────────────────────────────

export function ChevronDownIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  )
}

export function ChevronRightIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m9 6 6 6-6 6" />
    </Svg>
  )
}

export function ChevronUpIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m6 15 6-6 6 6" />
    </Svg>
  )
}

export function CloseIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Svg>
  )
}

export function EllipsisIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="5" cy="12" r="0.75" />
      <circle cx="12" cy="12" r="0.75" />
      <circle cx="19" cy="12" r="0.75" />
    </Svg>
  )
}

export function PlusIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Svg>
  )
}

export function SplitIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="16" rx="1" />
      <path d="M12 4v16" />
    </Svg>
  )
}

/** 檔案類型字樣（仿 Seti 圖示主題：TS、M↓、{}）；以 SVG 文字繪製，顏色由外層 class 決定 */
export function FileGlyphIcon({ glyph, size = 16, className }: IconProps & { glyph: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className ?? ''}`}
    >
      <text
        x="8"
        y="11.5"
        textAnchor="middle"
        fontSize={glyph.length > 1 ? 8 : 11}
        fontWeight="700"
        fill="currentColor"
      >
        {glyph}
      </text>
    </svg>
  )
}

// ─── 狀態列 ─────────────────────────────────────────────────────

export function GitBranchIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="8" r="2.5" />
      <path d="M6 8.5v7" />
      <path d="M18 10.5c0 3.5-4 4-9.5 6" />
    </Svg>
  )
}

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

export function PlayIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M7 4.5v15l12-7.5Z" />
    </Svg>
  )
}

export function BellIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </Svg>
  )
}

// ─── 畫師工具列 ──────────────────────────────────────────────────

export function EraserIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L11 21" />
      <path d="M22 21H7" />
      <path d="m5 11 9 9" />
    </Svg>
  )
}

export function UndoIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </Svg>
  )
}

export function TrashIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </Svg>
  )
}

/** 放棄本回合（仿除錯工具列的「停止」） */
export function StopIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="5" y="5" width="14" height="14" rx="1" />
    </Svg>
  )
}

/** 背景色（Epic 7；自繪「填滿」：傾斜的油漆桶＋一滴顏料） */
export function FillIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4.5 12.5 11 6l6 6-6.5 6.5a1.4 1.4 0 0 1-2 0l-4-4a1.4 1.4 0 0 1 0-2Z" />
      <path d="M4.5 12.5H17" />
      <path d="M7.5 2.5 11 6" />
      <path d="M21 17.5c0 1.1-.7 2-1.5 2s-1.5-.9-1.5-2c0-1.2 1.5-3.5 1.5-3.5s1.5 2.3 1.5 3.5Z" />
    </Svg>
  )
}
