// Office 風格線條圖示（ppt 與 excel 共用；DESIGN.md §13.3、§17.4：自繪、16px、1.5px 線寬，不使用 Microsoft 商標）。
// Epic 13 由 ppt/pptIcons 抽出（標題列、註解、說明主題等兩套 Office 殼層都有的圖示）；SVG 與抽出前逐字相同。
// stroke = currentColor，顏色一律由外層 token class 決定；本檔不含色碼。通用圖示（關閉、復原、播放…）沿用 layout/icons。
import type { ReactNode } from 'react'

export interface OfficeIconProps {
  /** 邊長 px；一般 16，功能區大按鈕 24 */
  size?: number
  className?: string
}

/** 線條圖示外框：24 單位 viewBox、currentColor 描邊；24px 以上線寬 1.25、其餘 1.5 */
export function OfficeSvg({ size = 16, className, children }: OfficeIconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth={size >= 24 ? 1.25 : 1.5}
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
      focusable='false'
      className={`shrink-0 ${className ?? ''}`}
    >
      {children}
    </svg>
  )
}

/** 畫筆（出題者標記、繪圖分頁） */
export function PenIcon(p: OfficeIconProps) {
  return (
    <OfficeSvg {...p}>
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
      <path d="m14.5 5.5 3 3" />
    </OfficeSvg>
  )
}

/** 勾（已交卷） */
export function CheckIcon(p: OfficeIconProps) {
  return (
    <OfficeSvg {...p}>
      <path d="m4.5 12.5 5 5 10-11" strokeWidth={2.25} />
    </OfficeSvg>
  )
}

/** 儲存（標題列快速存取） */
export function SaveIcon(p: OfficeIconProps) {
  return (
    <OfficeSvg {...p}>
      <path d="M4.5 3.5h12l3 3v14h-15z" />
      <path d="M8 3.5v5h7v-5" />
      <path d="M7.5 20.5v-6h9v6" />
    </OfficeSvg>
  )
}

/** 重做 */
export function RedoIcon(p: OfficeIconProps) {
  return (
    <OfficeSvg {...p}>
      <path d="M15 5l4 4-4 4" />
      <path d="M19 9H9.5a5 5 0 0 0 0 10H13" />
    </OfficeSvg>
  )
}

/** 視窗最小化 */
export function MinimizeIcon(p: OfficeIconProps) {
  return (
    <OfficeSvg {...p}>
      <path d="M5 12h14" />
    </OfficeSvg>
  )
}

/** 視窗最大化 */
export function MaximizeIcon(p: OfficeIconProps) {
  return (
    <OfficeSvg {...p}>
      <rect x="5.5" y="5.5" width="13" height="13" />
    </OfficeSvg>
  )
}

/** 貼上 */
export function PasteIcon(p: OfficeIconProps) {
  return (
    <OfficeSvg {...p}>
      <path d="M8.5 4.5h-3v16h13v-16h-3" />
      <rect x="8.5" y="2.5" width="7" height="4" rx="1" />
      <path d="M9 11h6M9 15h6" />
    </OfficeSvg>
  )
}

/** 註解（註解窗格標題） */
export function CommentIcon(p: OfficeIconProps) {
  return (
    <OfficeSvg {...p}>
      <path d="M4.5 5.5h15v10h-8l-4 3.5v-3.5h-3z" />
    </OfficeSvg>
  )
}

/** 標準模式 */
export function NormalViewIcon(p: OfficeIconProps) {
  return (
    <OfficeSvg {...p}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="1" />
      <path d="M8.5 5.5v13" />
    </OfficeSvg>
  )
}

/** 送出註解（註解窗格輸入框右側；紙飛機） */
export function SendIcon(p: OfficeIconProps) {
  return (
    <OfficeSvg {...p}>
      <path d="M21 3 10.5 13.5" />
      <path d="M21 3 14.5 21l-4-7.5L3 9.5z" />
    </OfficeSvg>
  )
}

/** 對話框泡泡＋問號（說明：如何出題） */
export function QuestionBubbleIcon(p: OfficeIconProps) {
  return (
    <OfficeSvg {...p}>
      <path d="M4.5 4.5h15v11h-8l-4.5 4v-4h-2.5z" />
      <path d="M10 8.2a2 2 0 1 1 2.6 1.9c-.4.2-.6.5-.6.9v.5" />
      <circle cx="12" cy="13.2" r="0.5" fill="currentColor" />
    </OfficeSvg>
  )
}

/** 切換偽裝（兩張重疊的投影片＋循環箭頭） */
export function SwitchThemeIcon(p: OfficeIconProps) {
  return (
    <OfficeSvg {...p}>
      <rect x="3.5" y="3.5" width="11" height="8" rx="1" />
      <rect x="9.5" y="12.5" width="11" height="8" rx="1" />
      <path d="M17.5 4.5a3 3 0 0 1 3 3v2" />
      <path d="m19 8 1.5 1.5L22 8" />
      <path d="M6.5 19.5a3 3 0 0 1-3-3v-2" />
      <path d="M5 16 3.5 14.5 2 16" />
    </OfficeSvg>
  )
}

/** 作畫工具（調色盤） */
export function PaletteIcon(p: OfficeIconProps) {
  return (
    <OfficeSvg {...p}>
      <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.2-1-1.5-1-2.6 0-.9.7-1.5 1.6-1.5h2.1a4 4 0 0 0 4-4c0-4-3.8-7.2-8.5-7.2Z" />
      <circle cx="7.8" cy="11" r="1" />
      <circle cx="10.5" cy="7.2" r="1" />
      <circle cx="15" cy="7.5" r="1" />
    </OfficeSvg>
  )
}

/** 傳圖片（圖片框：山與太陽） */
export function PictureIcon(p: OfficeIconProps) {
  return (
    <OfficeSvg {...p}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1" />
      <circle cx="9" cy="9.5" r="1.5" />
      <path d="m3.5 17 5-5 4 4 2.5-2.5 5.5 5.5" />
    </OfficeSvg>
  )
}

/** 斷線與重新整理（循環箭頭） */
export function RefreshIcon(p: OfficeIconProps) {
  return (
    <OfficeSvg {...p}>
      <path d="M19.5 12a7.5 7.5 0 0 1-13 5.1" />
      <path d="M4.5 12a7.5 7.5 0 0 1 13-5.1" />
      <path d="M17.5 3.5v3.4h-3.4" />
      <path d="M6.5 20.5v-3.4h3.4" />
    </OfficeSvg>
  )
}
