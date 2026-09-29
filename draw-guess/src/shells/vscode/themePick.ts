// vscode 主題「切換偽裝」入口的純邏輯（決策 7；元件在 ManageMenu.tsx，檔名刻意取不同字根，避免 macOS 大小寫撞名）：
// 活動列底部設定齒輪 → 選單「切換偽裝…」→ 快速選單列出主題（ShellProps.themes，與首頁風格卡片同一份 catalog）。
import type { ShellId, ShellThemeSwitch } from '../types'

export interface ThemePickItem {
  id: ShellId
  label: string
  /** 右側說明：目前使用中／即將推出 */
  detail?: string
  disabled: boolean
}

export const THEME_CURRENT_DETAIL = '目前使用'
export const THEME_UPCOMING_DETAIL = '即將推出'

/** 快速選單的選項：未上線主題不可選並標「即將推出」；目前主題標「目前使用」 */
export function themePickItems(themes: Pick<ShellThemeSwitch, 'current' | 'options'>): ThemePickItem[] {
  return themes.options.map((o) => ({
    id: o.id,
    label: o.name,
    detail: !o.available ? THEME_UPCOMING_DETAIL : o.id === themes.current ? THEME_CURRENT_DETAIL : undefined,
    disabled: !o.available,
  }))
}

/** 一開始反白目前主題（找不到時第一個） */
export function themePickInitialIndex(themes: Pick<ShellThemeSwitch, 'current' | 'options'>): number {
  return Math.max(0, themes.options.findIndex((o) => o.id === themes.current))
}

/**
 * 選取主題：未上線不動作；與目前相同也不呼叫 select（不重寫 localStorage）。
 * 回傳是否真的切換（呼叫端據此決定關閉快速選單後是否把焦點還給齒輪）。
 */
export function chooseTheme(themes: ShellThemeSwitch, id: ShellId): boolean {
  const option = themes.options.find((o) => o.id === id)
  if (option === undefined || !option.available || id === themes.current) return false
  themes.select(id)
  return true
}

export interface ManageMenuEntry {
  id: 'switch-theme' | 'help'
  label: string
  /** 選取後關閉選單時是否把焦點還給齒輪 */
  refocus: boolean
}

/**
 * 齒輪選單的項目（DESIGN §5）：「切換偽裝…」；有遊戲說明（Epic 6）時第二項「說明…」。
 * 切換偽裝不還焦點（快速選單接手）；說明先把焦點還給齒輪（說明關閉時焦點回到開啟它的元素＝齒輪）
 */
export function manageMenuEntries(hasHelp: boolean): ManageMenuEntry[] {
  const items: ManageMenuEntry[] = [{ id: 'switch-theme', label: '切換偽裝…', refocus: false }]
  if (hasHelp) items.push({ id: 'help', label: '說明…', refocus: true })
  return items
}

/** 選取齒輪選單的項目：先關閉選單，再開快速選單或說明（help.open() 不帶主題＝清單） */
export function selectManageEntry(
  entry: ManageMenuEntry,
  handlers: { close(refocus: boolean): void; onSwitchTheme(): void; onHelp?: () => void },
): void {
  handlers.close(entry.refocus)
  if (entry.id === 'help') handlers.onHelp?.()
  else handlers.onSwitchTheme()
}

/** 選單鍵盤：↑↓ 循環、Home／End 到兩端；其他鍵回 null */
export function stepMenuIndex(count: number, index: number, key: string): number | null {
  if (count <= 0) return null
  switch (key) {
    case 'ArrowDown':
      return (index + 1) % count
    case 'ArrowUp':
      return (index - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}
