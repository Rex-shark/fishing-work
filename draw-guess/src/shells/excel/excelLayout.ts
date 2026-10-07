// excel 主題（Excel 偽裝殼層）的純邏輯（可單元測試）：視窗標題、功能區分頁、工作表格距、人員表格文字、狀態列、對話框文字。
// 文字與規則依 DESIGN.md §17、plan/excel-theme.md；本檔不含任何樣式。檔名刻意與 ExcelShell.tsx 取不同字根（macOS 檔名不分大小寫）。
// 與 ppt 共用的邏輯（對話框按鈕與按鍵、選單鍵盤、切換偽裝清單、作用分頁）在 office/officeLayout。
import type { PlayerPublic, RoundPhase } from '@fishing-work/shared'
import { OFFICE_DIRTY_MARK, activeOfficeRibbonTab, type OfficeRibbonPick } from '../office/officeLayout'
import type { DialogPurpose } from '../views'

// ─── 視窗標題 ───────────────────────────────────────────────────

/** 標題列與 document.title（DESIGN §17.2、plan 決策 8） */
export const EXCEL_APP_TITLE = '活頁簿1 - Excel'

/** 作畫中 = 活頁簿「未儲存」 */
export function isWorkbookDirty(phase: RoundPhase): boolean {
  return phase === 'drawing'
}

/** `活頁簿1 - Excel`；作畫中前綴 `● `（與 ppt 一致） */
export function excelWindowTitle(phase: RoundPhase): string {
  return isWorkbookDirty(phase) ? `${OFFICE_DIRTY_MARK} ${EXCEL_APP_TITLE}` : EXCEL_APP_TITLE
}

// ─── 功能區（Ribbon） ────────────────────────────────────────────

/** 固定的 9 個功能區分頁（DESIGN §17.2）；「檔案」開選單，「常用」「校閱」「說明」（遊戲中）有內容，其餘為裝飾 */
export const RIBBON_TABS = ['檔案', '常用', '插入', '頁面配置', '公式', '資料', '校閱', '檢視', '說明'] as const
export type RibbonTab = (typeof RIBBON_TABS)[number]

/** 關聯式分頁（Excel 選到圖片才出現）：畫師作畫中出現並預設作用，內容為畫師工具列 */
export const PICTURE_FORMAT_TAB = '圖片格式'

/** 可切換內容的分頁 */
export type RibbonContentTab = '常用' | '校閱' | '說明' | typeof PICTURE_FORMAT_TAB
export const RIBBON_CONTENT_TABS: readonly RibbonContentTab[] = ['常用', '校閱', '說明', PICTURE_FORMAT_TAB]

/** 窄螢幕（< 1024px）先藏起的裝飾分頁（「檔案」「常用」「插入」「校閱」與「圖片格式」一定保留；說明另有「檔案 → 說明…」入口） */
export const RIBBON_TABS_HIDDEN_WHEN_NARROW: readonly RibbonTab[] = ['頁面配置', '公式', '資料', '檢視', '說明']

/**
 * 圖片是否「被選取」：自己是畫師且作畫中（canDraw）。此時出現關聯式「圖片格式」分頁（工具列）、圖片 8 個控點、名稱方塊「圖片 1」。
 * 出題中（choosing）圖片還沒插入（替代文字對話框開著），維持「常用」
 */
export function isPictureSelected(canDraw: boolean): boolean {
  return canDraw
}

/** 預設作用分頁：圖片被選取 →「圖片格式」；否則「常用」 */
export function defaultRibbonTab(canDraw: boolean): Extract<RibbonContentTab, '常用' | typeof PICTURE_FORMAT_TAB> {
  return isPictureSelected(canDraw) ? PICTURE_FORMAT_TAB : '常用'
}

export type RibbonPick = OfficeRibbonPick<RibbonContentTab>

/** 目前作用分頁：手動點的分頁只在預設分頁不變時有效（輪到自己作畫時自動回「圖片格式」） */
export const activeRibbonTab: (pick: RibbonPick | null, fallback: RibbonContentTab) => RibbonContentTab = activeOfficeRibbonTab

/** 「常用」最右群組「插入圖片」＝我來畫（ShellViews.volunteer） */
export const INSERT_PICTURE_LABEL = '插入圖片'

/** 「校閱」→「顯示註解」（< 768px 開關註解窗格覆蓋層） */
export const SHOW_COMMENTS_LABEL = '顯示註解'

// ─── 資料編輯列 ──────────────────────────────────────────────────

/** 名稱方塊：圖片被選取時「圖片 1」，否則作用儲存格「A1」（DESIGN §17.2） */
export function nameBoxText(pictureSelected: boolean): string {
  return pictureSelected ? '圖片 1' : 'A1'
}

/** 資料編輯列的輸入框：A1 的內容是表頭「名稱」；選到圖片時空白 */
export function formulaText(pictureSelected: boolean): string {
  return pictureSelected ? '' : SHEET_HEADERS[0]
}

// ─── 工作表格距（DESIGN §17.2：列高 20px、欄寬 64px，A 欄 128px；欄名列 20px、列號欄 32px） ─────────────

export const ROW_HEIGHT = 20
export const COL_WIDTH = 64
export const COL_A_WIDTH = 128
export const HEADER_HEIGHT = 20
export const ROW_HEADER_WIDTH = 32

/** 欄名：0 → A、25 → Z、26 → AA（Excel 的 26 進位欄名） */
export function columnName(index: number): string {
  let n = Math.max(0, Math.floor(index)) + 1
  let name = ''
  while (n > 0) {
    const r = (n - 1) % 26
    name = String.fromCharCode(65 + r) + name
    n = Math.floor((n - 1) / 26)
  }
  return name
}

/** 填滿 width px 需要的欄數（含 A 欄；不足一欄也算一欄）；至少 A–E 五欄 */
export function columnsToFill(width: number): number {
  const rest = Math.max(0, width - ROW_HEADER_WIDTH - COL_A_WIDTH)
  return Math.max(5, 1 + Math.ceil(rest / COL_WIDTH))
}

/** 列數：填滿 height px（不足一列也算一列），且至少容得下表頭＋每位玩家＋一列空白 */
export function rowsToFill(height: number, players: number): number {
  return Math.max(Math.ceil(Math.max(0, height) / ROW_HEIGHT), Math.max(0, players) + 2)
}

// ─── 人員表格（DESIGN §17.3） ─────────────────────────────────────

/** 表頭（第 1 列，A–C 欄） */
export const SHEET_HEADERS = ['名稱', '分數', '狀態'] as const

/** 名稱欄：自己加「（你）」 */
export function sheetNameText(nickname: string, isMe: boolean): string {
  return isMe ? `${nickname}（你）` : nickname
}

export type SheetStatusTone = 'drawer' | 'guessed' | 'offline'

/**
 * 狀態欄：畫師「✎ 繪圖中」、已猜對「✓ +N」（本回合得分不明時只有「✓」）、斷線「離線」、否則空白（null）。
 * 同時符合多項時依此順序取第一項
 */
export function sheetStatus(
  p: Pick<PlayerPublic, 'isDrawer' | 'hasGuessed' | 'connected'>,
  gain: number | null,
): { text: string; tone: SheetStatusTone } | null {
  if (p.isDrawer) return { text: '✎ 繪圖中', tone: 'drawer' }
  if (p.hasGuessed) return { text: gain !== null ? `✓ +${gain}` : '✓', tone: 'guessed' }
  if (!p.connected) return { text: '離線', tone: 'offline' }
  return null
}

// ─── 狀態列 ─────────────────────────────────────────────────────

/** 狀態列最左（Excel 的模式指示）：固定「就緒」，回合狀態接在後面（同 ppt「備忘稿：」前綴的做法） */
export const READY_LABEL = '就緒'

/** 「計數: N」：N＝在線人數（counts.online） */
export function countText(online: number): string {
  return `計數: ${Math.max(0, online)}`
}

/** 工作表分頁列（裝飾）；第一張作用 */
export const SHEET_TABS = ['工作表1', '工作表2', '工作表3'] as const

// ─── 對話框 ─────────────────────────────────────────────────────

/** 對話框標題列文字（DESIGN §17.2「對話框」）：出題＝圖片的替代文字、放棄＝刪除圖片 */
export const EXCEL_DIALOG_TITLE: Record<DialogPurpose, string> = {
  topic: '替代文字',
  cancelRound: '刪除圖片？',
  // 說明：標題列改顯示對話框的 title（「說明」或主題名稱）；此值只在沒有 title 時使用
  help: '說明',
}

/** 出題對話框標題列下方的說明一行 */
export const ALT_TEXT_DESCRIPTION = '為這張圖片輸入描述'

/** 放棄確認的主要按鈕（取代「確定」）；第二個仍是「取消」 */
export const DELETE_PICTURE_BUTTON = '刪除'

/** 按鈕文字：放棄確認的第一個按鈕「刪除」；其餘用預設（undefined） */
export function excelDialogButtonText(purpose: DialogPurpose, index: number): string | undefined {
  return purpose === 'cancelRound' && index === 0 ? DELETE_PICTURE_BUTTON : undefined
}

/** 自動重連畫面（screen 'resume'）的對話框標題 */
export const EXCEL_RESUME_TITLE = '開啟活頁簿'

/** 遊戲說明「如何切換偽裝」的路徑（DESIGN §16；與 ppt 相同：「檔案」選單） */
export const EXCEL_SWITCH_HINT = '檔案 → 切換偽裝'

// ─── 註解窗格 ────────────────────────────────────────────────────

/** 註解輸入框的 placeholder（DESIGN §17.2「開始對話」）；功能提示顯示在輸入框上方 */
export const EXCEL_COMMENT_PLACEHOLDER = '開始對話'

/** < 768px 註解窗格改為覆蓋層（「校閱」→「顯示註解」開關） */
export const COMMENTS_OVERLAY_QUERY = '(max-width: 767.98px)'
