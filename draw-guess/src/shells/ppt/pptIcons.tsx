// ppt 主題的 Office 風格線條圖示（DESIGN.md §13.3：自繪、16px、1.5px 線寬，不使用 Microsoft 商標）。
// stroke = currentColor，顏色一律由外層 token class 決定；本檔不含色碼。通用圖示（關閉、復原、播放…）沿用 layout/icons。
import type { ReactNode } from 'react'

interface IconProps {
  /** 邊長 px；一般 16，功能區大按鈕 24 */
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

/** 畫筆（畫師標記、繪圖分頁） */
export function PenIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
      <path d="m14.5 5.5 3 3" />
    </Svg>
  )
}

/** 勾（已猜對） */
export function CheckIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m4.5 12.5 5 5 10-11" strokeWidth={2.25} />
    </Svg>
  )
}

/** 儲存（標題列快速存取） */
export function SaveIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4.5 3.5h12l3 3v14h-15z" />
      <path d="M8 3.5v5h7v-5" />
      <path d="M7.5 20.5v-6h9v6" />
    </Svg>
  )
}

/** 重做 */
export function RedoIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M15 5l4 4-4 4" />
      <path d="M19 9H9.5a5 5 0 0 0 0 10H13" />
    </Svg>
  )
}

/** 視窗最小化 */
export function MinimizeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 12h14" />
    </Svg>
  )
}

/** 視窗最大化 */
export function MaximizeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="5.5" y="5.5" width="13" height="13" />
    </Svg>
  )
}

/** 貼上 */
export function PasteIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8.5 4.5h-3v16h13v-16h-3" />
      <rect x="8.5" y="2.5" width="7" height="4" rx="1" />
      <path d="M9 11h6M9 15h6" />
    </Svg>
  )
}

/** 新增投影片 */
export function NewSlideIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2.5" y="5.5" width="15" height="10" rx="1" />
      <path d="M5.5 9h6" />
      <path d="M20 14v7M16.5 17.5h7" />
    </Svg>
  )
}

/** 版面配置 */
export function LayoutIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="1" />
      <path d="M3.5 9.5h17M12 9.5v9" />
    </Svg>
  )
}

/** 圖案 */
export function ShapesIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="11.5" width="9" height="9" />
      <circle cx="15.5" cy="8.5" r="5" />
    </Svg>
  )
}

/** 靠左對齊 */
export function AlignLeftIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 6h16M4 10h10M4 14h16M4 18h10" />
    </Svg>
  )
}

/** 項目符號 */
export function BulletsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="5" cy="7" r="1" fill="currentColor" />
      <circle cx="5" cy="12" r="1" fill="currentColor" />
      <circle cx="5" cy="17" r="1" fill="currentColor" />
      <path d="M9 7h11M9 12h11M9 17h11" />
    </Svg>
  )
}

/** 文字方塊 */
export function TextBoxIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1" />
      <path d="M8 9h8M12 9v7" />
    </Svg>
  )
}

/** 註解（註解窗格標題） */
export function CommentIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4.5 5.5h15v10h-8l-4 3.5v-3.5h-3z" />
    </Svg>
  )
}

/** 備忘稿 */
export function NotesIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="4.5" y="3.5" width="15" height="17" rx="1" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </Svg>
  )
}

/** 標準模式 */
export function NormalViewIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="1" />
      <path d="M8.5 5.5v13" />
    </Svg>
  )
}

/** 投影片瀏覽 */
export function SorterIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="4.5" width="7" height="6" />
      <rect x="13.5" y="4.5" width="7" height="6" />
      <rect x="3.5" y="13.5" width="7" height="6" />
      <rect x="13.5" y="13.5" width="7" height="6" />
    </Svg>
  )
}

/** 閱讀檢視 */
export function ReadingViewIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 5.5h7a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 0-1.5-1.5h-7zM20.5 5.5h-7A1.5 1.5 0 0 0 12 7v12a1.5 1.5 0 0 1 1.5-1.5h7z" />
    </Svg>
  )
}

/** 投影片放映（狀態列中央「從目前投影片開始」） */
export function SlideshowIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2.5" y="4.5" width="19" height="13" rx="1" />
      <path d="m10 8 5 3-5 3z" fill="currentColor" />
      <path d="M12 17.5v3" />
    </Svg>
  )
}

/** 送出註解（註解窗格輸入框右側；紙飛機） */
export function SendIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M21 3 10.5 13.5" />
      <path d="M21 3 14.5 21l-4-7.5L3 9.5z" />
    </Svg>
  )
}

// ─── 「說明」分頁的主題按鈕（Epic 6；DESIGN §13.2） ─────────────────────────

/** 猜題與計分（對話框泡泡＋問號） */
export function QuestionBubbleIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4.5 4.5h15v11h-8l-4.5 4v-4h-2.5z" />
      <path d="M10 8.2a2 2 0 1 1 2.6 1.9c-.4.2-.6.5-.6.9v.5" />
      <circle cx="12" cy="13.2" r="0.5" fill="currentColor" />
    </Svg>
  )
}

/** 切換偽裝（兩張重疊的投影片＋循環箭頭） */
export function SwitchThemeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="3.5" width="11" height="8" rx="1" />
      <rect x="9.5" y="12.5" width="11" height="8" rx="1" />
      <path d="M17.5 4.5a3 3 0 0 1 3 3v2" />
      <path d="m19 8 1.5 1.5L22 8" />
      <path d="M6.5 19.5a3 3 0 0 1-3-3v-2" />
      <path d="M5 16 3.5 14.5 2 16" />
    </Svg>
  )
}

/** 畫師工具（調色盤） */
export function PaletteIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.2-1-1.5-1-2.6 0-.9.7-1.5 1.6-1.5h2.1a4 4 0 0 0 4-4c0-4-3.8-7.2-8.5-7.2Z" />
      <circle cx="7.8" cy="11" r="1" />
      <circle cx="10.5" cy="7.2" r="1" />
      <circle cx="15" cy="7.5" r="1" />
    </Svg>
  )
}

/** 傳圖片（圖片框：山與太陽） */
export function PictureIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1" />
      <circle cx="9" cy="9.5" r="1.5" />
      <path d="m3.5 17 5-5 4 4 2.5-2.5 5.5 5.5" />
    </Svg>
  )
}

/** 斷線與重新整理（循環箭頭） */
export function RefreshIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M19.5 12a7.5 7.5 0 0 1-13 5.1" />
      <path d="M4.5 12a7.5 7.5 0 0 1 13-5.1" />
      <path d="M17.5 3.5v3.4h-3.4" />
      <path d="M6.5 20.5v-3.4h3.4" />
    </Svg>
  )
}
