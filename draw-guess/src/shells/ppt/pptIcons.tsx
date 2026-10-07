// ppt 主題專屬的 Office 風格線條圖示（DESIGN.md §13.3：自繪、16px、1.5px 線寬，不使用 Microsoft 商標）。
// 兩套 Office 殼層（ppt、excel）共用的圖示在 shells/office/officeIcons（Epic 13 抽出）；本檔只留投影片相關的圖示。
// stroke = currentColor，顏色一律由外層 token class 決定；本檔不含色碼。通用圖示（關閉、復原、播放…）沿用 layout/icons。
import { OfficeSvg as Svg, type OfficeIconProps as IconProps } from '../office/officeIcons'

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

/** 備忘稿 */
export function NotesIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="4.5" y="3.5" width="15" height="17" rx="1" />
      <path d="M8 8h8M8 12h8M8 16h5" />
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
