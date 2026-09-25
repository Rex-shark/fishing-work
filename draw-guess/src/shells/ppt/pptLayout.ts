// ppt 主題（PowerPoint 偽裝殼層）的純邏輯（可單元測試）：視窗標題、功能區分頁、狀態列文字、對話框標題與按鍵、切換偽裝清單。
// 文字與規則依 DESIGN.md §13；本檔不含任何樣式。檔名刻意與 PptShell.tsx／PptDialog.tsx 取不同字根（macOS 檔名不分大小寫）。
import { MIN_PLAYERS, type RoundPhase } from '@fishing-work/shared'
import type { ShellId, ShellThemeSwitch } from '../types'
import type { DialogPurpose } from '../views'

// ─── 視窗標題 ───────────────────────────────────────────────────

/** 標題列與 document.title（DESIGN §13.2） */
export const PPT_APP_TITLE = '簡報1 - PowerPoint'
/** 作畫中前綴（與 vscode 一致：仿未儲存） */
export const PPT_DIRTY_MARK = '●'

/** 作畫中 = 簡報「未儲存」 */
export function isSlideDirty(phase: RoundPhase): boolean {
  return phase === 'drawing'
}

/** `簡報1 - PowerPoint`；作畫中前綴 `● ` */
export function pptWindowTitle(phase: RoundPhase): string {
  return isSlideDirty(phase) ? `${PPT_DIRTY_MARK} ${PPT_APP_TITLE}` : PPT_APP_TITLE
}

// ─── 功能區（Ribbon） ────────────────────────────────────────────

/** 功能區分頁（DESIGN §13.2，11 個）；「檔案」開選單，「常用」「繪圖」有內容，其餘為裝飾 */
export const RIBBON_TABS = ['檔案', '常用', '插入', '設計', '轉場', '動畫', '投影片放映', '校閱', '檢視', '繪圖', '說明'] as const
export type RibbonTab = (typeof RIBBON_TABS)[number]

/** 可切換內容的分頁 */
export type RibbonContentTab = Extract<RibbonTab, '常用' | '繪圖'>
export const RIBBON_CONTENT_TABS: readonly RibbonContentTab[] = ['常用', '繪圖']

/** 窄螢幕（< 1024px）先藏起的裝飾分頁（「檔案」「常用」「繪圖」一定保留） */
export const RIBBON_TABS_HIDDEN_WHEN_NARROW: readonly RibbonTab[] = ['轉場', '動畫', '校閱', '檢視', '說明']

/** 預設作用分頁：自己是畫師且回合進行中（出題、作畫）→「繪圖」；否則「常用」（DESIGN §13.2） */
export function defaultRibbonTab(isDrawer: boolean, phase: RoundPhase): RibbonContentTab {
  return isDrawer && (phase === 'choosing' || phase === 'drawing') ? '繪圖' : '常用'
}

/**
 * 目前作用分頁：使用者手動點過的分頁只在「預設分頁沒變」期間有效；
 * 回合狀態改變使預設分頁改變時（例如輪到自己作畫）自動回到預設，不必在 effect 裡 setState。
 */
export interface RibbonPick {
  tab: RibbonContentTab
  /** 點選當下的預設分頁 */
  base: RibbonContentTab
}

export function activeRibbonTab(pick: RibbonPick | null, fallback: RibbonContentTab): RibbonContentTab {
  return pick !== null && pick.base === fallback ? pick.tab : fallback
}

// ─── 狀態列 ─────────────────────────────────────────────────────

/** 「投影片 N / M」：N = 在線人數、M = 玩家數（DESIGN §13.2）；自動重連畫面（沒有玩家）為 1 / 1 */
export function slideCounter(online: number, total: number): string {
  if (!(total > 0)) return '投影片 1 / 1'
  return `投影片 ${Math.max(0, Math.min(online, total))} / ${total}`
}

/** 人數不足時「從目前投影片開始」旁的說明（DESIGN §13.2；用詞與備忘稿列、vscode 一致） */
export function waitingForPlayers(online: number): string {
  return `等待其他玩家加入（${online}/${MIN_PLAYERS}）`
}

/** 狀態列中央「▶ 從目前投影片開始」＝我來畫 */
export const START_SLIDESHOW_LABEL = '從目前投影片開始'

// ─── 對話框 ─────────────────────────────────────────────────────

/** 對話框標題列文字（DESIGN §13.2「對話框」） */
export const PPT_DIALOG_TITLE: Record<DialogPurpose, string> = {
  topic: '輸入標題',
  cancelRound: '捨棄變更？',
}

/** 自動重連畫面（screen 'resume'）的對話框標題（沿用舊登入框的「加入簡報」） */
export const PPT_RESUME_TITLE = '加入簡報'

export const DIALOG_OK = '確定'
export const DIALOG_CANCEL = '取消'

/** 對話框按鈕的文字：第一個選項「確定」、第二個「取消」，其餘照選項文字 */
export function dialogButtonText(index: number, label: string): string {
  if (index === 0) return DIALOG_OK
  if (index === 1) return DIALOG_CANCEL
  return label
}

/** 對話框按鈕的無障礙名稱：以可見文字開頭，再補上實際動作（WCAG 2.5.3 label in name） */
export function dialogButtonLabel(index: number, label: string): string {
  const text = dialogButtonText(index, label)
  return text === label ? label : `${text}：${label}`
}

/**
 * 對話框按鍵：Esc＝取消（輸入法組字中不攔截）。Enter 走 form 原生 submit（隱式送出，注音選字的 Enter 不會觸發），
 * 因此這裡不處理 Enter。回傳 'cancel' 時呼叫端 preventDefault 並執行取消。
 */
export function dialogKeyAction(key: string, isComposing: boolean): 'cancel' | null {
  if (isComposing) return null
  return key === 'Escape' ? 'cancel' : null
}

// ─── 「檔案」選單 → 切換偽裝 ─────────────────────────────────────

export const THEME_CURRENT_NOTE = '目前使用'
export const THEME_UPCOMING_NOTE = '即將推出'

export interface PptThemeItem {
  id: ShellId
  name: string
  /** 右側說明：目前使用／即將推出 */
  note?: string
  disabled: boolean
  current: boolean
}

/** 切換偽裝清單：未上線不可選並標「即將推出」；目前主題標「目前使用」 */
export function pptThemeItems(themes: Pick<ShellThemeSwitch, 'current' | 'options'>): PptThemeItem[] {
  return themes.options.map((o) => ({
    id: o.id,
    name: o.name,
    note: !o.available ? THEME_UPCOMING_NOTE : o.id === themes.current ? THEME_CURRENT_NOTE : undefined,
    disabled: !o.available,
    current: o.id === themes.current,
  }))
}

/** 一開始選取目前主題（找不到時第一個可選的） */
export function pptThemeInitialIndex(themes: Pick<ShellThemeSwitch, 'current' | 'options'>): number {
  const current = themes.options.findIndex((o) => o.id === themes.current)
  if (current >= 0) return current
  return Math.max(0, themes.options.findIndex((o) => o.available))
}

/** ↑↓ 在可選項目間移動（略過即將推出）、Home／End 到兩端的可選項目；其他鍵或沒有可選項目回 null */
export function stepThemeIndex(items: readonly Pick<PptThemeItem, 'disabled'>[], index: number, key: string): number | null {
  const enabled = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0)
  if (enabled.length === 0) return null
  switch (key) {
    case 'ArrowDown': {
      const next = enabled.find((i) => i > index)
      return next ?? enabled[0] ?? null
    }
    case 'ArrowUp': {
      const prev = [...enabled].reverse().find((i) => i < index)
      return prev ?? enabled[enabled.length - 1] ?? null
    }
    case 'Home':
      return enabled[0] ?? null
    case 'End':
      return enabled[enabled.length - 1] ?? null
    default:
      return null
  }
}

/**
 * 確定選取：未上線不動作；與目前相同也不呼叫 select（不重寫 localStorage）。
 * 回傳是否真的切換（切換後殼層會整個換掉，呼叫端不必再還焦點）。
 */
export function choosePptTheme(themes: ShellThemeSwitch, id: ShellId): boolean {
  const option = themes.options.find((o) => o.id === id)
  if (option === undefined || !option.available || id === themes.current) return false
  themes.select(id)
  return true
}
