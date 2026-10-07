// excel 主題的註冊資料（shells/index.ts）：試算表偽裝（DESIGN.md §17；plan/excel-theme.md 決策 8）。
import { SheetsIcon } from '../themeIcons'
import type { ShellDefinition } from '../types'
import { excelWindowTitle } from './excelLayout'
import { ExcelShell } from './ExcelShell'

export const excelShell: ShellDefinition = {
  id: 'excel',
  name: '試算表',
  description: '白底試算表，像在整理資料',
  // 自繪綠色表格方塊（DESIGN §17.1 --brand-sheets）
  icon: SheetsIcon,
  Shell: ExcelShell,
  // `活頁簿1 - Excel`；作畫中前綴 `● `（DESIGN §17.2 標題列）
  titleFor: ({ phase }) => excelWindowTitle(phase),
  // 自繪綠色表格圖示（draw-guess/public/favicon-excel.svg，依 Vite base 解析；不使用 Microsoft 商標）
  faviconHref: `${import.meta.env.BASE_URL}favicon-excel.svg`,
}
