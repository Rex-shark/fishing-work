// excel 主題專屬的 Office 風格線條圖示（DESIGN.md §17.4：自繪、16px、1.5px 線寬，不使用 Microsoft 商標與 Office 圖示字型）。
// 兩套 Office 殼層共用的圖示（標題列、註解、說明主題…）在 shells/office/officeIcons；通用圖示（關閉、加號、填滿…）沿用 layout/icons。
// stroke = currentColor，顏色一律由外層 token class 決定；本檔不含色碼。
import { OfficeSvg as Svg, type OfficeIconProps as IconProps } from '../office/officeIcons'

/** 插入圖片（「常用」最右群組＝我來畫）：圖片框＋右下加號 */
export function InsertPictureIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M13.5 19.5h-10v-15h17v8" />
      <circle cx="8.5" cy="9" r="1.5" />
      <path d="m3.5 16.5 4.5-4.5 3.5 3.5 2.5-2.5 2 2" />
      <path d="M18.5 15v6M15.5 18h6" />
    </Svg>
  )
}

/** 顯示註解（「校閱」→ 開關註解窗格）：兩個重疊的對話泡泡 */
export function ShowCommentsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 4.5h12v8h-6l-3.5 3v-3h-2.5z" />
      <path d="M18 8.5h2.5v8H18v3l-3.5-3h-4" />
    </Svg>
  )
}

/** 新增註解（「校閱」裝飾）：對話泡泡＋加號 */
export function NewCommentIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4.5 5.5h15v10h-8l-4 3.5v-3.5h-3z" />
      <path d="M12 8v5M9.5 10.5h5" />
    </Svg>
  )
}

/** 剪下（剪貼簿裝飾） */
export function CutIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="7" cy="17.5" r="2.5" />
      <circle cx="17" cy="17.5" r="2.5" />
      <path d="M8.8 15.7 17 3.5M15.2 15.7 7 3.5" />
    </Svg>
  )
}

/** 複製（剪貼簿裝飾） */
export function CopyIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="8.5" y="8.5" width="11" height="12" rx="1" />
      <path d="M15.5 8.5v-4h-11v12h4" />
    </Svg>
  )
}

/** 框線（字型群組裝飾）：田字格 */
export function BordersIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="4.5" y="4.5" width="15" height="15" />
      <path d="M12 4.5v15M4.5 12h15" strokeDasharray="1.5 2" />
    </Svg>
  )
}

/** 置中對齊（對齊方式群組裝飾） */
export function AlignCenterIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 6h16M7 10h10M4 14h16M7 18h10" />
    </Svg>
  )
}

/** 靠右對齊（對齊方式群組裝飾） */
export function AlignRightIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 6h16M10 10h10M4 14h16M10 18h10" />
    </Svg>
  )
}

/** 靠左對齊（對齊方式群組裝飾） */
export function AlignLeftIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 6h16M4 10h10M4 14h16M4 18h10" />
    </Svg>
  )
}

/** 自動換行（對齊方式群組裝飾）：兩行字，第二行折返箭頭 */
export function WrapTextIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 6h16M4 18h6" />
      <path d="M4 12h13a2.5 2.5 0 0 1 0 5h-4" />
      <path d="m14.5 15-2 2 2 2" />
    </Svg>
  )
}

/** 跨欄置中（對齊方式群組裝飾）：方框內左右箭頭 */
export function MergeCenterIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="5.5" width="17" height="13" />
      <path d="M7 12h10M9 10l-2 2 2 2M15 10l2 2-2 2" />
    </Svg>
  )
}

/** 整頁模式（狀態列顯示設定）：紙張與邊界 */
export function PageLayoutIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="5.5" y="3.5" width="13" height="17" rx="1" />
      <path d="M8.5 7.5h7M8.5 11h7M8.5 14.5h4" />
    </Svg>
  )
}

/** 分頁預覽（狀態列顯示設定）：兩張紙與虛線分頁 */
export function PageBreakIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1" />
      <path d="M12 4.5v15" strokeDasharray="2 2" />
    </Svg>
  )
}

/** 工作表分頁列的捲動箭頭（向左）；向右用 layout/icons 的 ChevronRightIcon */
export function ChevronLeftIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m14.5 6-6 6 6 6" />
    </Svg>
  )
}
