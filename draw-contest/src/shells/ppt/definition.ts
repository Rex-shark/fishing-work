// ppt 主題的註冊資料（shells/index.ts）：簡報偽裝（DESIGN.md §13）。名稱、描述、圖示與 catalog 規劃項目一致（「簡報」、SlidesIcon）。
import { SlidesIcon } from '../themeIcons'
import type { ShellDefinition } from '../types'
import { pptWindowTitle } from './pptLayout'
import { PptShell } from './PptShell'

export const pptShell: ShellDefinition = {
  id: 'ppt',
  name: '簡報',
  description: '白底簡報軟體，像在做投影片',
  // 自繪橘紅投影片方塊（決策 8；DESIGN §13.4 --brand-slides）
  icon: SlidesIcon,
  Shell: PptShell,
  // `簡報1 - PowerPoint`；作畫中前綴 `● `（DESIGN §13.2 標題列）
  titleFor: ({ phase }) => pptWindowTitle(phase),
  // 自繪簡報圖示（draw-contest/public/favicon-ppt.svg，依 Vite base 解析；不使用 Microsoft 商標）
  faviconHref: `${import.meta.env.BASE_URL}favicon-ppt.svg`,
}
