// 偽裝主題註冊表（plan/camouflage-themes.md 決策 2；architecture §7）：{ id, name, description, icon, Shell, titleFor, faviconHref }。
// 首頁風格卡片（Epic 4，description 為卡片描述）與切換入口都從 SHELLS 產生（經 catalog.ts 加上「即將推出」項目）；ppt 於 Epic 3 Phase 3 註冊。畫布底色與預設筆色不屬於主題（決策 6）。
import { pptShell } from './ppt/definition'
import type { ShellDefinition, ShellId } from './types'
import { vscodeShell } from './vscode/definition'

export type {
  ShellDefinition,
  ShellId,
  ShellPlayerCounts,
  ShellProps,
  ShellRoundState,
  ShellThemeOption,
  ShellThemeSwitch,
  ShellTitleState,
} from './types'

/** 已註冊的主題（順序即首頁卡片順序） */
export const SHELLS: readonly ShellDefinition[] = [vscodeShell, pptShell]

/** 預設主題；未知或尚未註冊的 id 一律回退到這裡 */
export const DEFAULT_SHELL_ID: ShellId = 'vscode'

/** 是否為已註冊的主題 id（未註冊的 'ppt'、未知值、非字串皆為 false） */
export function isRegisteredShellId(value: unknown): value is ShellId {
  return SHELLS.some((s) => s.id === value)
}

/** 任意值 → 已註冊的主題 id；未知值（含尚未註冊的 'ppt'、null、非字串）回 DEFAULT_SHELL_ID */
export function resolveShellId(value: unknown): ShellId {
  return SHELLS.find((s) => s.id === value)?.id ?? DEFAULT_SHELL_ID
}

/** 取得主題定義；未知值回預設主題 */
export function getShell(id: unknown): ShellDefinition {
  const wanted = resolveShellId(id)
  return SHELLS.find((s) => s.id === wanted) ?? vscodeShell
}
