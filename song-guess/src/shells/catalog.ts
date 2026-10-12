// 可顯示的主題清單（複製自我畫你猜 shells/catalog）：首頁風格卡片與各殼層「切換偽裝…」共用同一份。
//   已註冊的主題（SHELLS）→ available: true，名稱、描述與圖示取自註冊表；
//   已規劃但尚未註冊的主題（PLANNED_THEMES）→ available: false，顯示「即將推出」、不可選。
// 某主題一旦加進 SHELLS，PLANNED_THEMES 的同 id 項目自動被註冊表取代（變可選），卡片與選單元件都不必改。
// 注意：殼層（shells/<主題>/）不得 import 本檔（本檔 import 註冊表 → 殼層，會形成循環）；殼層經 ShellProps.themes 取得。
import { SHELLS } from './index'
import type { ShellDefinition, ShellThemeOption } from './types'

export type PlannedTheme = Omit<ShellThemeOption, 'available'>

/** 已規劃、尚未註冊的主題（順序接在已註冊主題之後）；猜歌 v1 沒有規劃中的主題（只有一張「視訊會議」卡，design.md 開頭） */
export const PLANNED_THEMES: readonly PlannedTheme[] = []

/** 註冊表 ＋ 規劃中 → 卡片清單。已註冊在前（依 SHELLS 順序），同 id 以註冊表為準 */
export function buildThemeCatalog(
  registered: readonly Pick<ShellDefinition, 'id' | 'name' | 'description' | 'icon'>[],
  planned: readonly PlannedTheme[],
): ShellThemeOption[] {
  const ids = new Set(registered.map((s) => s.id))
  return [
    ...registered.map(({ id, name, description, icon }) => ({ id, name, description, icon, available: true })),
    ...planned.filter((p) => !ids.has(p.id)).map((p) => ({ ...p, available: false })),
  ]
}

export const THEME_CATALOG: readonly ShellThemeOption[] = buildThemeCatalog(SHELLS, PLANNED_THEMES)
