// meet 主題的線條圖示（自繪 Material 風格，DESIGN.md §15.3：面板內 16px、控制列 20px；不用 Google 圖示字型與商標）。
// stroke = currentColor，顏色由外層的 token class 決定；本檔不含色碼。首頁卡片的攝影機圖示在 shells/themeIcons（跨主題共用）。
import type { ReactNode } from 'react'

interface IconProps {
  /** 邊長 px；一般 16，控制列 20 */
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

/** 麥克風（靜音：斜線） */
export function MicOffIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M15 10.5V6a3 3 0 0 0-5.7-1.3" />
      <path d="M9 9v3a3 3 0 0 0 4.8 2.4" />
      <path d="M18.5 11.5a6.5 6.5 0 0 1-1.2 3.7M5.5 11.5a6.5 6.5 0 0 0 10.1 5.4" />
      <path d="M12 18v3" />
      <path d="m3 3 18 18" />
    </Svg>
  )
}

/** 攝影機（關閉：斜線） */
export function CameraOffIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10 6h4a2 2 0 0 1 2 2v2.5l5-3v9l-2.2-1.3" />
      <path d="M16 16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2" />
      <path d="m3 3 18 18" />
    </Svg>
  )
}

/** 字幕（CC 方框） */
export function CaptionsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M10.5 10.2a2 2 0 1 0 0 3.6" />
      <path d="M17 10.2a2 2 0 1 0 0 3.6" />
    </Svg>
  )
}

/** 分享畫面（螢幕＋向上箭頭） */
export function ShareScreenIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2.5" y="4" width="19" height="13" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 14V8" />
      <path d="m9 10.5 3-3 3 3" />
    </Svg>
  )
}

/** 舉手 */
export function HandIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M12 10.5v-6a1.5 1.5 0 0 1 3 0v6" />
      <path d="M15 10.5V7a1.5 1.5 0 0 1 3 0v7a7 7 0 0 1-7 7h-.5a6 6 0 0 1-4.6-2.2L3.6 15.9a1.5 1.5 0 0 1 2.3-1.9L9 16V8a1.5 1.5 0 0 1 3 0" />
    </Svg>
  )
}

/** 更多（直式三點 ⋮） */
export function MoreVertIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="5.5" r="1.1" fill="currentColor" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" />
      <circle cx="12" cy="18.5" r="1.1" fill="currentColor" />
    </Svg>
  )
}

/** 離開通話（橫放的話筒） */
export function CallEndIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.3 13.6a2 2 0 0 1-.3-2.6C5.3 8.4 8.5 7 12 7s6.7 1.4 9 4a2 2 0 0 1-.3 2.6l-1.6 1.3a1.5 1.5 0 0 1-2-.1l-1.3-1.3a1.5 1.5 0 0 1-.4-1.3l.3-1.4a11 11 0 0 0-7.4 0l.3 1.4a1.5 1.5 0 0 1-.4 1.3l-1.3 1.3a1.5 1.5 0 0 1-2 .1Z" />
    </Svg>
  )
}

/** 會議資訊（圓圈 i） */
export function InfoIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <circle cx="12" cy="7.8" r="0.6" fill="currentColor" />
    </Svg>
  )
}

/** 使用者（兩個人） */
export function PeopleIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 19a6 6 0 0 1 12 0" />
      <path d="M15.5 5a3.2 3.2 0 0 1 0 6.2" />
      <path d="M17.5 13.6A6 6 0 0 1 21 19" />
    </Svg>
  )
}

/** 訊息（對話框泡泡） */
export function ChatBubbleIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H8l-4 3.5V6a1 1 0 0 1 1-1Z" />
      <path d="M8 9.5h8M8 12.5h5" />
    </Svg>
  )
}

/** 活動（三角、圓、方塊） */
export function ActivitiesIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m7 3.5 3.8 6.5H3.2Z" />
      <circle cx="17" cy="7" r="3.3" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
      <path d="M17 13.5v7M13.5 17h7" />
    </Svg>
  )
}

/** 送出（紙飛機） */
export function SendIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 4.5 20.5 12 4 19.5l2.5-7.5Z" />
      <path d="M6.5 12H13" />
    </Svg>
  )
}

/** 打勾（猜對訊息） */
export function CheckCircleIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.3 2.7 2.7L16 9.7" />
    </Svg>
  )
}

/** 關閉（×） */
export function CloseIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  )
}

/** 斷線（Wi-Fi 斜線） */
export function OfflineIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.5 9a15 15 0 0 1 5-3M11 5.1A15 15 0 0 1 21.5 9" />
      <path d="M5.5 12.5a10 10 0 0 1 4-2.2M15 10.6a10 10 0 0 1 3.5 1.9" />
      <path d="M9 16a5 5 0 0 1 6 0" />
      <circle cx="12" cy="19.5" r="0.6" fill="currentColor" />
      <path d="m3 3 18 18" />
    </Svg>
  )
}
