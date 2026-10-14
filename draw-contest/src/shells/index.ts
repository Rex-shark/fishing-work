// 偽裝主題註冊表（複製自我畫你猜 shells/index.ts；spec/draw-contest/architecture.md §7）：{ id, name, description, icon, Shell, titleFor, faviconHref }。
// 首頁風格卡片與切換入口都從 SHELLS 產生（經 catalog.ts）。繪圖比賽 MVP 只註冊簡報（ppt）；日後加主題就在 SHELLS 多加一筆。
import { pptShell } from './ppt/definition'
import type { ShellDefinition, ShellId } from './types'

export type {
  ShellDefinition,
  ShellHelp,
  ShellHistory,
  ShellId,
  ShellPlayerCounts,
  ShellProps,
  ShellRoundState,
  ShellThemeOption,
  ShellThemeSwitch,
  ShellTitleState,
} from './types'

/** 已註冊的主題（順序即首頁卡片順序） */
export const SHELLS: readonly ShellDefinition[] = [pptShell]

/** 預設主題；未知或尚未註冊的 id 一律回退到這裡 */
export const DEFAULT_SHELL_ID: ShellId = 'ppt'

/** 是否為已註冊的主題 id（未知值、非字串皆為 false） */
export function isRegisteredShellId(value: unknown): value is ShellId {
  return SHELLS.some((s) => s.id === value)
}

/** 任意值 → 已註冊的主題 id；未知值（null、非字串、我畫你猜才有的主題 id）回 DEFAULT_SHELL_ID */
export function resolveShellId(value: unknown): ShellId {
  return SHELLS.find((s) => s.id === value)?.id ?? DEFAULT_SHELL_ID
}

/** 取得主題定義；未知值回預設主題 */
export function getShell(id: unknown): ShellDefinition {
  const wanted = resolveShellId(id)
  return SHELLS.find((s) => s.id === wanted) ?? pptShell
}
