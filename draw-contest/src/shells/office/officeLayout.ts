// 兩套 Office 殼層（ppt、excel）共用的純邏輯（可單元測試；Epic 13 決策 4 由 ppt/pptLayout 抽出，行為與抽出前相同）：
// 對話框按鈕文字與按鍵、「檔案」選單鍵盤、切換偽裝清單、功能區作用分頁、人數不足說明、作畫中標記。
// 各殼層自己的文字（視窗標題、對話框標題、功能區分頁名）留在 <主題>Layout；本檔不含任何樣式。
import { MIN_PLAYERS } from '@fishing-work/shared/draw-contest'
import type { ShellId, ShellThemeSwitch } from '../types'

// ─── 視窗標題 ───────────────────────────────────────────────────

/** 作畫中前綴（與 vscode 一致：仿未儲存）；ppt「● 簡報1 - PowerPoint」、excel「● 活頁簿1 - Excel」 */
export const OFFICE_DIRTY_MARK = '●'

// ─── 功能區（Ribbon） ────────────────────────────────────────────

/**
 * 目前作用分頁：使用者手動點過的分頁只在「預設分頁沒變」期間有效；
 * 回合狀態改變使預設分頁改變時（例如輪到自己作畫）自動回到預設，不必在 effect 裡 setState。
 */
export interface OfficeRibbonPick<T extends string> {
  tab: T
  /** 點選當下的預設分頁 */
  base: T
}

export function activeOfficeRibbonTab<T extends string>(pick: OfficeRibbonPick<T> | null, fallback: T): T {
  return pick !== null && pick.base === fallback ? pick.tab : fallback
}

// ─── 人數 ───────────────────────────────────────────────────────

/** 人數不足時「我來畫」旁的說明（DESIGN §13.2、§17.2；用詞與 vscode 一致） */
export function waitingForPlayers(online: number): string {
  return `等待其他玩家加入（${online}/${MIN_PLAYERS}）`
}

// ─── 對話框 ─────────────────────────────────────────────────────

export const DIALOG_OK = '確定'
export const DIALOG_CANCEL = '取消'

/** 說明對話框（purpose 'help'）清單步驟的關閉按鈕 */
export const DIALOG_CLOSE = '關閉'

/** 對話框按鈕的文字：第一個選項「確定」、第二個「取消」，其餘照選項文字 */
export function dialogButtonText(index: number, label: string): string {
  if (index === 0) return DIALOG_OK
  if (index === 1) return DIALOG_CANCEL
  return label
}

/** 按鈕無障礙名稱：以可見文字開頭，再補上實際動作（WCAG 2.5.3 label in name）；可見文字等於選項文字時不重複 */
export function officeButtonLabel(text: string, label: string): string {
  return text === label ? label : `${text}：${label}`
}

/** 對話框按鈕的無障礙名稱（預設按鈕文字「確定」「取消」） */
export function dialogButtonLabel(index: number, label: string): string {
  return officeButtonLabel(dialogButtonText(index, label), label)
}

/**
 * 對話框按鍵：Esc＝取消（輸入法組字中不攔截）。Enter 走 form 原生 submit（隱式送出，注音選字的 Enter 不會觸發），
 * 因此這裡不處理 Enter。回傳 'cancel' 時呼叫端 preventDefault 並執行取消。
 */
export function dialogKeyAction(key: string, isComposing: boolean): 'cancel' | null {
  if (isComposing) return null
  return key === 'Escape' ? 'cancel' : null
}

// ─── 對話框送出中（busy）結束後的焦點還原 ──────────────────────────────

/** 對話框選項按鈕（右下按鈕、說明的主題清單）的標記（OfficeDialog 以字面值寫在 JSX，測試守門）；標題列的關閉鈕不是選項，不標 */
export const DIALOG_OPTION_ATTR = 'data-dialog-option'

/**
 * busy 結束後焦點的落點，依序找第一個存在的：輸入框 → 第一個可用的選項（未停用；選項只設 aria-disabled，不用原生 disabled）。
 * 輸入框在 busy 時是 readOnly（不是 disabled），這裡的 :not([disabled]) 只是防呆
 */
export const DIALOG_REFOCUS_SELECTORS = [
  'input:not([disabled])',
  `[${DIALOG_OPTION_ATTR}]:not([disabled]):not([aria-disabled="true"])`,
] as const

/** 焦點還原用到的最小 DOM 介面（元件以對話框根節點代入；測試以假物件代入） */
export interface DialogFocusRoot {
  /** 節點是否在對話框內（含對話框本身） */
  contains(node: unknown): boolean
  querySelector(selector: string): { focus(): void } | null
}

/** busy 是否剛結束（上一次渲染為 true、這一次不是） */
export function busyEnded(wasBusy: boolean, busy: boolean): boolean {
  return wasBusy && !busy
}

/**
 * busy 結束後的保險：焦點不在對話框內（例如掉到 body）時放回輸入框，沒有輸入框就放回第一個可用選項；
 * 焦點還在對話框內就不動（使用者可能已經 Tab 到別的按鈕）。回傳是否移動了焦點
 */
export function restoreDialogFocus(root: DialogFocusRoot, active: unknown): boolean {
  if (active != null && root.contains(active)) return false
  for (const selector of DIALOG_REFOCUS_SELECTORS) {
    const target = root.querySelector(selector)
    if (target !== null) {
      target.focus()
      return true
    }
  }
  return false
}

// ─── 註解窗格 ────────────────────────────────────────────────────

/** 註解輸入列送出鈕的名稱與提示 */
export const COMMENT_SEND_LABEL = '送出註解'

// ─── 「檔案」選單 → 切換偽裝、說明 ─────────────────────────────────

/** 選單鍵盤（可操作項目 count 個；current 為目前焦點，-1＝不在項目上）：↑↓ 循環、Home／End 到兩端；其他鍵或沒有項目回 null */
export function stepMenuItem(count: number, current: number, key: string): number | null {
  if (count <= 0) return null
  const at = current < 0 ? 0 : current
  switch (key) {
    case 'ArrowDown':
      return current < 0 ? 0 : (at + 1) % count
    case 'ArrowUp':
      return current < 0 ? count - 1 : (at - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

/**
 * 「檔案」選單含一層子清單時的按鍵（Epic 17 的最近清單；spec/draw-contest/design.md §3.1）：
 * - Tab：關閉整個選單（焦點還給「檔案」）；
 * - Esc：焦點在子清單裡 → 只收起子清單（焦點回到展開它的那一項）；否則關閉整個選單；
 * - ←：在子清單裡 → 收起子清單；→：焦點在可展開（且未灰化）的那一項上 → 展開；
 * - ↑↓／Home／End：在焦點所在的那一層循環（stepMenuItem）；其餘按鍵 null（Enter／Space 走按鈕的原生 click）
 */
export type FileMenuKeyAction = { type: 'close' } | { type: 'close-sub' } | { type: 'open-sub' } | { type: 'focus'; index: number }

export function fileMenuKeyAction(input: {
  key: string
  /** 焦點在子清單裡 */
  inSub: boolean
  /** 焦點在可展開的那一項上，而且它可用（沒有灰化） */
  onExpandable: boolean
  /** 焦點所在那一層的可操作項目數 */
  count: number
  /** 焦點在那一層的第幾項；-1＝不在項目上 */
  current: number
}): FileMenuKeyAction | null {
  const { key, inSub, onExpandable, count, current } = input
  if (key === 'Tab') return { type: 'close' }
  if (key === 'Escape') return { type: inSub ? 'close-sub' : 'close' }
  if (key === 'ArrowLeft') return inSub ? { type: 'close-sub' } : null
  if (key === 'ArrowRight') return !inSub && onExpandable ? { type: 'open-sub' } : null
  const index = stepMenuItem(count, current, key)
  return index === null ? null : { type: 'focus', index }
}

export const THEME_CURRENT_NOTE = '目前使用'
export const THEME_UPCOMING_NOTE = '即將推出'

export interface OfficeThemeItem {
  id: ShellId
  name: string
  /** 右側說明：目前使用／即將推出 */
  note?: string
  disabled: boolean
  current: boolean
}

/** 切換偽裝清單：未上線不可選並標「即將推出」；目前主題標「目前使用」 */
export function officeThemeItems(themes: Pick<ShellThemeSwitch, 'current' | 'options'>): OfficeThemeItem[] {
  return themes.options.map((o) => ({
    id: o.id,
    name: o.name,
    note: !o.available ? THEME_UPCOMING_NOTE : o.id === themes.current ? THEME_CURRENT_NOTE : undefined,
    disabled: !o.available,
    current: o.id === themes.current,
  }))
}

/** 一開始選取目前主題（找不到時第一個可選的） */
export function officeThemeInitialIndex(themes: Pick<ShellThemeSwitch, 'current' | 'options'>): number {
  const current = themes.options.findIndex((o) => o.id === themes.current)
  if (current >= 0) return current
  return Math.max(0, themes.options.findIndex((o) => o.available))
}

/** ↑↓ 在可選項目間移動（略過即將推出）、Home／End 到兩端的可選項目；其他鍵或沒有可選項目回 null */
export function stepThemeIndex(items: readonly Pick<OfficeThemeItem, 'disabled'>[], index: number, key: string): number | null {
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
export function chooseOfficeTheme(themes: ShellThemeSwitch, id: ShellId): boolean {
  const option = themes.options.find((o) => o.id === id)
  if (option === undefined || !option.available || id === themes.current) return false
  themes.select(id)
  return true
}
