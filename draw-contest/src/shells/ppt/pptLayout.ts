// ppt 主題（PowerPoint 偽裝殼層）的純邏輯（可單元測試）：視窗標題、功能區分頁、狀態列文字、對話框標題與按鍵、切換偽裝清單。
// 文字與規則依 DESIGN.md §13；本檔不含任何樣式。檔名刻意與 PptShell.tsx／PptDialog.tsx 取不同字根（macOS 檔名不分大小寫）。
// 與 Office 系殼層共用的邏輯（對話框按鈕與按鍵、選單鍵盤、切換偽裝清單、作用分頁、人數不足說明）在 shells/office/officeLayout，這裡以原名轉出。
import type { ContestPhase } from '@fishing-work/shared/draw-contest'
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
/** 作畫中前綴（仿未儲存） */
export const PPT_DIRTY_MARK = OFFICE_DIRTY_MARK

/** 作畫中 = 簡報「未儲存」 */
export function isSlideDirty(phase: ContestPhase): boolean {
  return phase === 'drawing'
}

/** `簡報1 - PowerPoint`；作畫中前綴 `● ` */
export function pptWindowTitle(phase: ContestPhase): string {
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

/** 預設作用分頁：自己此刻可以作畫（參賽者、作畫中、未交卷）→「繪圖」；否則「常用」（design §2）；「說明」只在點選後作用 */
export function defaultRibbonTab(canDraw: boolean): Exclude<RibbonContentTab, '說明'> {
  return canDraw ? '繪圖' : '常用'
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

/** 狀態列中央「▶ 從目前投影片開始」＝我出題（design §2） */
export const START_SLIDESHOW_LABEL = '從目前投影片開始'

// ─── 對話框 ─────────────────────────────────────────────────────

/** 對話框標題列文字（DESIGN §13.2「對話框」；spec/draw-contest/design.md §2） */
export const PPT_DIALOG_TITLE: Record<DialogPurpose, string> = {
  topic: '輸入標題',
  // 說明（Epic 6）：標題列改顯示對話框的 title（「說明」或主題名稱）；此值只在沒有 title 時使用
  help: '說明',
  // 交卷確認（design §2 drawing：按「完成」先開確認框）
  submit: '儲存投影片？',
}

/** 交卷確認框的內文（design §2） */
export const PPT_SUBMIT_DESCRIPTION = '儲存後不能再修改'
/** 交卷確認框的按鈕：第一個（主要，Enter）「儲存」、第二個（Esc）「取消」 */
export const PPT_SUBMIT_OK = '儲存'

/** 對話框按鈕的可見文字（OfficeDialogConfig.buttonText）：交卷確認的主要按鈕為「儲存」；其餘用預設（確定／取消） */
export function pptDialogButtonText(purpose: DialogPurpose, index: number): string | undefined {
  return purpose === 'submit' && index === 0 ? PPT_SUBMIT_OK : undefined
}

// ─── 偽裝用語（ShellViews.terms） ──────────────────────────────────

/** 題目＝投影片「標題」、交卷＝「儲存」、揭曉畫廊＝「投影片瀏覽」檢視、比賽歷史＝「最近的簡報」（Epic 17；design §2「歷史檢視」列） */
export const PPT_TERMS = { topic: '標題', save: '儲存', gallery: '投影片瀏覽', recent: '最近的簡報' } as const

/** 已交卷時鎖定畫布右下角的小字（design §2「drawing（已交卷）」） */
export const PPT_SAVED_CAPTION = '已儲存，等待其他人…'

/** 自動重連畫面（screen 'resume'）的對話框標題（沿用舊登入框的「加入簡報」） */
export const PPT_RESUME_TITLE = '加入簡報'

/** 遊戲說明「如何切換偽裝」的路徑（plan/help-topics.md 決策 6） */
export const PPT_SWITCH_HINT = '檔案 → 切換偽裝'

// ─── 比賽歷史（Epic 17；spec/draw-contest/design.md §3.1） ────────────────────

/** 「檔案」選單的入口（PowerPoint「檔案 › 開啟 › 最近」的語意）；右側的「›」由選單加 */
export const PPT_RECENT_LABEL = '開啟最近的簡報'
/** 沒有存檔（或讀不到）時子清單的灰字 */
export const PPT_RECENT_EMPTY = '沒有最近的簡報'
/** 歷史檢視時狀態列中段的按鈕（＝回到目前的畫面；design §2「歷史檢視」列） */
export const PPT_RECENT_CLOSE = '關閉簡報'
/** 遊戲說明「回看最近幾場」的路徑（plan/contest-history.md 任務表） */
export const PPT_RECENT_HINT = '檔案 › 開啟最近的簡報'

// ─── 「檔案」選單 → 切換偽裝、說明 ─────────────────────────────────

/** 切換偽裝清單的一列（office/officeLayout 的 OfficeThemeItem） */
export type PptThemeItem = OfficeThemeItem

/** 切換偽裝清單：未上線不可選並標「即將推出」；目前主題標「目前使用」 */
export const pptThemeItems = officeThemeItems

/** 一開始選取目前主題（找不到時第一個可選的） */
export const pptThemeInitialIndex = officeThemeInitialIndex

/** 確定選取：未上線或與目前相同不動作；回傳是否真的切換 */
export const choosePptTheme = chooseOfficeTheme
