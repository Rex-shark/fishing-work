// ppt 主題（PowerPoint 偽裝殼層）的純邏輯（可單元測試）：視窗標題、功能區分頁、狀態列文字、對話框標題與按鍵、切換偽裝清單。
// 文字與規則依 DESIGN.md §13；本檔不含任何樣式。檔名刻意與 PptShell.tsx／PptDialog.tsx 取不同字根（macOS 檔名不分大小寫）。
// Epic 13：與 excel 共用的邏輯（對話框按鈕與按鍵、選單鍵盤、切換偽裝清單、作用分頁、人數不足說明）抽到 shells/office/officeLayout，
// 這裡以原名轉出（ppt 的匯入與測試不變）。
import type { RoundPhase } from '@fishing-work/shared'
import {
  OFFICE_DIRTY_MARK,
  activeOfficeRibbonTab,
  chooseOfficeTheme,
  officeThemeInitialIndex,
  officeThemeItems,
  type OfficeRibbonPick,
  type OfficeThemeItem,
} from '../office/officeLayout'
import type { DialogPurpose } from '../views'

export {
  DIALOG_CANCEL,
  DIALOG_CLOSE,
  DIALOG_OK,
  THEME_CURRENT_NOTE,
  THEME_UPCOMING_NOTE,
  dialogButtonLabel,
  dialogButtonText,
  dialogKeyAction,
  stepMenuItem,
  stepThemeIndex,
  waitingForPlayers,
} from '../office/officeLayout'

// ─── 視窗標題 ───────────────────────────────────────────────────

/** 標題列與 document.title（DESIGN §13.2） */
export const PPT_APP_TITLE = '簡報1 - PowerPoint'
/** 作畫中前綴（與 vscode 一致：仿未儲存） */
export const PPT_DIRTY_MARK = OFFICE_DIRTY_MARK

/** 作畫中 = 簡報「未儲存」 */
export function isSlideDirty(phase: RoundPhase): boolean {
  return phase === 'drawing'
}

/** `簡報1 - PowerPoint`；作畫中前綴 `● ` */
export function pptWindowTitle(phase: RoundPhase): string {
  return isSlideDirty(phase) ? `${PPT_DIRTY_MARK} ${PPT_APP_TITLE}` : PPT_APP_TITLE
}

// ─── 功能區（Ribbon） ────────────────────────────────────────────

/** 功能區分頁（DESIGN §13.2，11 個）；「檔案」開選單，「常用」「繪圖」「說明」（Epic 6，遊戲中）有內容，其餘為裝飾 */
export const RIBBON_TABS = ['檔案', '常用', '插入', '設計', '轉場', '動畫', '投影片放映', '校閱', '檢視', '繪圖', '說明'] as const
export type RibbonTab = (typeof RIBBON_TABS)[number]

/** 可切換內容的分頁（「說明」只在遊戲中可作用，自動重連畫面為裝飾；Epic 6） */
export type RibbonContentTab = Extract<RibbonTab, '常用' | '繪圖' | '說明'>
export const RIBBON_CONTENT_TABS: readonly RibbonContentTab[] = ['常用', '繪圖', '說明']

/** 窄螢幕（< 1024px）先藏起的裝飾分頁（「檔案」「常用」「繪圖」一定保留） */
export const RIBBON_TABS_HIDDEN_WHEN_NARROW: readonly RibbonTab[] = ['轉場', '動畫', '校閱', '檢視', '說明']

/** 預設作用分頁：自己是畫師且回合進行中（出題、作畫）→「繪圖」；否則「常用」（DESIGN §13.2）；「說明」只在點選後作用 */
export function defaultRibbonTab(isDrawer: boolean, phase: RoundPhase): Exclude<RibbonContentTab, '說明'> {
  return isDrawer && (phase === 'choosing' || phase === 'drawing') ? '繪圖' : '常用'
}

/**
 * 目前作用分頁：使用者手動點過的分頁只在「預設分頁沒變」期間有效；
 * 回合狀態改變使預設分頁改變時（例如輪到自己作畫）自動回到預設（邏輯在 office/officeLayout）。
 */
export type RibbonPick = OfficeRibbonPick<RibbonContentTab>

export const activeRibbonTab: (pick: RibbonPick | null, fallback: RibbonContentTab) => RibbonContentTab = activeOfficeRibbonTab

// ─── 狀態列 ─────────────────────────────────────────────────────

/** 「投影片 N / M」：N = 在線人數、M = 玩家數（DESIGN §13.2）；自動重連畫面（沒有玩家）為 1 / 1 */
export function slideCounter(online: number, total: number): string {
  if (!(total > 0)) return '投影片 1 / 1'
  return `投影片 ${Math.max(0, Math.min(online, total))} / ${total}`
}

/** 狀態列中央「▶ 從目前投影片開始」＝我來畫 */
export const START_SLIDESHOW_LABEL = '從目前投影片開始'

// ─── 對話框 ─────────────────────────────────────────────────────

/** 對話框標題列文字（DESIGN §13.2「對話框」） */
export const PPT_DIALOG_TITLE: Record<DialogPurpose, string> = {
  topic: '輸入標題',
  cancelRound: '捨棄變更？',
  // 說明（Epic 6）：標題列改顯示對話框的 title（「說明」或主題名稱）；此值只在沒有 title 時使用
  help: '說明',
}

/** 自動重連畫面（screen 'resume'）的對話框標題（沿用舊登入框的「加入簡報」） */
export const PPT_RESUME_TITLE = '加入簡報'

/** 遊戲說明「如何切換偽裝」的路徑（plan/help-topics.md 決策 6） */
export const PPT_SWITCH_HINT = '檔案 → 切換偽裝'

// ─── 「檔案」選單 → 切換偽裝、說明 ─────────────────────────────────

/** 切換偽裝清單的一列（office/officeLayout 的 OfficeThemeItem） */
export type PptThemeItem = OfficeThemeItem

/** 切換偽裝清單：未上線不可選並標「即將推出」；目前主題標「目前使用」 */
export const pptThemeItems = officeThemeItems

/** 一開始選取目前主題（找不到時第一個可選的） */
export const pptThemeInitialIndex = officeThemeInitialIndex

/** 確定選取：未上線或與目前相同不動作；回傳是否真的切換 */
export const choosePptTheme = chooseOfficeTheme
