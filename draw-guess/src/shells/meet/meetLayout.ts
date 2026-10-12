// meet 主題（視訊會議偽裝殼層）的純邏輯（可單元測試）：視窗標題、會議代碼、主畫面標籤、對話框文字與按鍵、控制列文字。
// 文字與規則依 DESIGN.md §15、plan/meet-theme.md；本檔不含任何樣式。檔名刻意與 MeetShell.tsx／MeetDialog.tsx 取不同字根（macOS 檔名不分大小寫）。
import { MIN_PLAYERS, type RoundPhase } from '@fishing-work/shared'
import type { ShellId, ShellThemeSwitch } from '../types'
import { DIALOG_OPTION_ATTR, DIALOG_REFOCUS_SELECTORS } from '../dialogFocus'
import type { DialogPurpose } from '../views'

// ─── 視窗標題 ───────────────────────────────────────────────────

/** 會議代碼（固定裝飾常數；plan 決策 7） */
export const MEET_CODE = 'kqw-mzdv-ptj'
/** 視窗標題（DESIGN §15.3；「Meet」與代碼之間為 en dash U+2013） */
export const MEET_APP_TITLE = `Meet – ${MEET_CODE}`
/** 作畫中前綴（與 vscode／ppt 一致） */
export const MEET_DIRTY_MARK = '●'

/** `Meet – kqw-mzdv-ptj`；作畫中前綴 `● ` */
export function meetWindowTitle(phase: RoundPhase): string {
  return phase === 'drawing' ? `${MEET_DIRTY_MARK} ${MEET_APP_TITLE}` : MEET_APP_TITLE
}

// ─── 舞台 ───────────────────────────────────────────────────────

/** 主畫面左上標籤（DESIGN §15.2）：有畫師時「<畫師> 正在分享畫面」，否則「尚無人分享畫面」 */
export function presenterLabel(drawerName: string | null): string {
  return drawerName !== null && drawerName !== '' ? `${drawerName} 正在分享畫面` : '尚無人分享畫面'
}

// ─── 參加者 tile ──────────────────────────────────────────────────

/** 斷線中的 tile 左下文字（DESIGN §15.2） */
export const OFFLINE_TEXT = '連線中斷'
/** 自己的 tile 暱稱後綴 */
export const ME_SUFFIX = '（你）'

/** tile 左下文字：暱稱（自己加「（你）」）；斷線中為「連線中斷」 */
export function tileName(nickname: string, isMe: boolean, connected: boolean): string {
  if (!connected) return OFFLINE_TEXT
  return isMe ? `${nickname}${ME_SUFFIX}` : nickname
}

// ─── 控制列 ─────────────────────────────────────────────────────

/** 「分享畫面」＝我來畫（ShellViews.volunteer 的可見文字） */
export const SHARE_SCREEN_LABEL = '分享畫面'

/** 人數不足時「分享畫面」上方的說明（DESIGN §15.2；用詞與 vscode／ppt 一致） */
export function waitingForPlayers(online: number): string {
  return `等待其他玩家加入（${online}/${MIN_PLAYERS}）`
}

/** 底部控制列左側的時間 `HH:mm`（本機時間） */
export function clockText(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** 右側「使用者」按鈕的人數（counts.online；自動重連畫面沒有玩家時為 1＝自己） */
export function participantCount(online: number): number {
  return online > 0 ? online : 1
}

// ─── 右側面板 ────────────────────────────────────────────────────

export const CHAT_PANEL_TITLE = '通話中的訊息'
/** 輸入膠囊的 placeholder（DESIGN §15.2）；取代功能元件依角色給的提示文字（改顯示在輸入列上方） */
export const MEET_CHAT_PLACEHOLDER = '傳送訊息給所有人'
export const MEET_SEND_LABEL = '傳送訊息'
/** 自己送出的訊息名字（Meet 顯示「你」） */
export const MEET_SELF_NAME = '你'

/** 訊息列的名字：自己送出的為「你」，其餘為暱稱（null 為空字串） */
export function chatSenderName(nickname: string | null, isMine: boolean): string {
  return isMine ? MEET_SELF_NAME : (nickname ?? '')
}

// ─── 對話框 ─────────────────────────────────────────────────────

/** 對話框標題（DESIGN §15.2「對話框」）；說明（'help'，Epic 6）的標題為對話框的 title（「說明」或主題名稱），不在此表 */
export const MEET_DIALOG_TITLE: Record<Exclude<DialogPurpose, 'help'>, string> = {
  topic: '輸入題目',
  cancelRound: '停止分享畫面？',
}

/** 說明對話框的標題（沒有 title 時） */
export const MEET_HELP_TITLE = '說明'

/** 對話框標題：說明用 title，其餘依用途 */
export function meetDialogHeading(purpose: DialogPurpose, title: string | undefined): string {
  return purpose === 'help' ? (title ?? MEET_HELP_TITLE) : MEET_DIALOG_TITLE[purpose]
}

/** 對話框按鈕文字：[第一個選項（主要）, 第二個選項]；第三個以後照選項文字。說明（'help'）一律照選項文字（「返回」「關閉」） */
export const MEET_DIALOG_BUTTONS: Record<Exclude<DialogPurpose, 'help'>, readonly [string, string]> = {
  topic: ['分享', '取消'],
  cancelRound: ['停止分享', '繼續分享'],
}

/** 自動重連畫面（screen 'resume'）的一行提示（DESIGN §15.2） */
export const MEET_RESUME_TEXT = '正在重新加入通話…'

/** 對話框按鈕的可見文字 */
export function meetDialogButtonText(purpose: DialogPurpose, index: number, label: string): string {
  if (purpose === 'help') return label
  const texts = MEET_DIALOG_BUTTONS[purpose]
  return index === 0 ? texts[0] : index === 1 ? texts[1] : label
}

/** 對話框按鈕的無障礙名稱：以可見文字開頭，再補上實際動作（WCAG 2.5.3 label in name） */
export function meetDialogButtonLabel(purpose: DialogPurpose, index: number, label: string): string {
  const text = meetDialogButtonText(purpose, index, label)
  return text === label ? label : `${text}：${label}`
}

/** 「停止分享」是破壞性動作（放棄本回合）：文字用 --sem-error（DESIGN §15.2） */
export function isDestructiveButton(purpose: DialogPurpose, index: number): boolean {
  return purpose === 'cancelRound' && index === 0
}

/**
 * 對話框按鍵：Esc＝取消（輸入法組字中不攔截）。Enter 走 form 原生 submit（隱式送出，注音選字的 Enter 不會觸發），
 * 因此這裡不處理 Enter。
 */
export function dialogKeyAction(key: string, isComposing: boolean): 'cancel' | null {
  if (isComposing) return null
  return key === 'Escape' ? 'cancel' : null
}

/**
 * busy 結束後焦點的落點（dialogFocus.restoreDialogFocus）：輸入框 → 主要按鈕（第一個選項，type=submit）→ 其餘可用選項。
 * Meet 的按鈕在 DOM 裡是「次要…主要」（主要在最右），照預設的 DOM 順序會落在次要按鈕，所以先找主要按鈕
 */
export const MEET_DIALOG_REFOCUS_SELECTORS = [
  DIALOG_REFOCUS_SELECTORS[0],
  `[${DIALOG_OPTION_ATTR}][type="submit"]:not([disabled]):not([aria-disabled="true"])`,
  DIALOG_REFOCUS_SELECTORS[1],
] as const

/** 說明對話框（purpose 'help'）清單步驟的關閉按鈕 */
export const HELP_CLOSE_TEXT = '關閉'

/** 底部控制列右側「資訊」＝遊戲說明（Epic 6；DESIGN §15.2）：工具提示與無障礙名稱 */
export const HELP_BUTTON_LABEL = '說明'

/** 遊戲說明「如何切換偽裝」的路徑（plan/help-topics.md 決策 6） */
export const MEET_SWITCH_HINT = '更多 ⋮ → 切換偽裝'

// ─── 響應式（DESIGN §15.3；plan 決策 9） ─────────────────────────────

/**
 * 斷點（px）：< stripNarrow 影片條 160px（工具列也在此收合，決策 13(4)）；< stripBelow 影片條改到主畫面下方橫向列（tile 寬 120px）；
 * < panelOverlay 右側面板改為覆蓋層（由「訊息」開關，預設開）。
 * MeetShell 以 Tailwind 的 max-xl（80rem＝1280px）、max-lg（64rem＝1024px）、max-md（48rem＝768px）實作，數值與此一致（測試守著）
 */
export const MEET_BREAKPOINTS = { stripNarrow: 1280, stripBelow: 1024, panelOverlay: 768 } as const

export interface MeetLayout {
  /** 影片條位置：主畫面右側直向，或主畫面下方橫向 */
  strip: 'side' | 'below'
  /** 參加者 tile 寬（px） */
  tileWidth: number
  /** 右側面板是否為覆蓋層 */
  panelOverlay: boolean
}

/** 視窗寬度 → 版面（純邏輯；畫面上的尺寸由對應的 Tailwind 斷點 class 決定） */
export function meetLayoutFor(width: number): MeetLayout {
  const below = width < MEET_BREAKPOINTS.stripBelow
  return {
    strip: below ? 'below' : 'side',
    tileWidth: below ? 120 : width < MEET_BREAKPOINTS.stripNarrow ? 144 : 184,
    panelOverlay: width < MEET_BREAKPOINTS.panelOverlay,
  }
}

/** 覆蓋層模式的 media query（MeetShell 以此決定面板的 Esc 關閉與焦點處理） */
export const PANEL_OVERLAY_QUERY = `(max-width: ${MEET_BREAKPOINTS.panelOverlay - 0.02}px)`

// ─── 「更多 ⋮」選單 → 切換偽裝 ───────────────────────────────────────

export const MORE_MENU_LABEL = '更多選項'
export const SWITCH_THEME_ITEM = '切換偽裝…'
/** 「更多 ⋮」選單第二項：遊戲說明清單（Epic 6 決策 8；窄螢幕「資訊」隱藏時的入口） */
export const HELP_MENU_ITEM = '說明…'

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
/** 選單的裝飾項目（仿會議的「更多選項」選單；不可聚焦、點了無反應） */
export const MORE_MENU_DECOR = ['管理錄影', '變更版面配置', '全螢幕', '套用視覺效果', '設定'] as const

export const THEME_DIALOG_TITLE = '切換偽裝'
export const THEME_CURRENT_NOTE = '目前使用'
export const THEME_UPCOMING_NOTE = '即將推出'
export const THEME_CONFIRM = '切換'
export const THEME_CANCEL = '取消'

export interface MeetThemeItem {
  id: ShellId
  name: string
  /** 右側說明：目前使用／即將推出 */
  note?: string
  disabled: boolean
  current: boolean
}

/** 切換偽裝清單：未上線不可選並標「即將推出」；目前主題標「目前使用」 */
export function meetThemeItems(themes: Pick<ShellThemeSwitch, 'current' | 'options'>): MeetThemeItem[] {
  return themes.options.map((o) => ({
    id: o.id,
    name: o.name,
    note: !o.available ? THEME_UPCOMING_NOTE : o.id === themes.current ? THEME_CURRENT_NOTE : undefined,
    disabled: !o.available,
    current: o.id === themes.current,
  }))
}

/** 一開始選取目前主題（找不到時第一個可選的） */
export function meetThemeInitialIndex(themes: Pick<ShellThemeSwitch, 'current' | 'options'>): number {
  const current = themes.options.findIndex((o) => o.id === themes.current)
  if (current >= 0) return current
  return Math.max(0, themes.options.findIndex((o) => o.available))
}

/** ↑↓ 在可選項目間移動（略過即將推出、循環）、Home／End 到兩端的可選項目；其他鍵或沒有可選項目回 null */
export function stepEnabledIndex(items: readonly Pick<MeetThemeItem, 'disabled'>[], index: number, key: string): number | null {
  const enabled = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0)
  if (enabled.length === 0) return null
  switch (key) {
    case 'ArrowDown':
      return enabled.find((i) => i > index) ?? enabled[0] ?? null
    case 'ArrowUp':
      return [...enabled].reverse().find((i) => i < index) ?? enabled[enabled.length - 1] ?? null
    case 'Home':
      return enabled[0] ?? null
    case 'End':
      return enabled[enabled.length - 1] ?? null
    default:
      return null
  }
}

/** 確定切換：未上線或與目前相同不呼叫 select（不重寫 localStorage）；回傳是否真的切換 */
export function chooseMeetTheme(themes: ShellThemeSwitch, id: ShellId): boolean {
  const option = themes.options.find((o) => o.id === id)
  if (option === undefined || !option.available || id === themes.current) return false
  themes.select(id)
  return true
}
