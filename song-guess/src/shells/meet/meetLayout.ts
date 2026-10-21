// meet 主題（視訊會議偽裝殼層）的純邏輯（可單元測試）：視窗標題、會議代碼、舞台標籤與文字、對話框文字與按鍵、控制列文字。
// 文字與規則依 spec/song-guess/design.md（§1 偽裝語意、§2 各階段對照）與 DESIGN.md §15；本檔不含任何樣式。
// 檔名刻意與 MeetShell.tsx／MeetDialog.tsx 取不同字根（macOS 檔名不分大小寫）。
import { MIN_PLAYERS, type SongPhase } from '@fishing-work/shared/song-guess'
import type { ShellId, ShellRoundState, ShellThemeSwitch } from '../types'
import { DIALOG_OPTION_ATTR, DIALOG_REFOCUS_SELECTORS } from '../dialogFocus'
import type { DialogPurpose } from '../views'

// ─── 視窗標題 ───────────────────────────────────────────────────

/** 會議代碼（固定裝飾常數；與我畫你猜的 meet 殼層相同） */
export const MEET_CODE = 'kqw-mzdv-ptj'
/** 視窗標題（DESIGN §15.3；「Meet」與代碼之間為 en dash U+2013） */
export const MEET_APP_TITLE = `Meet – ${MEET_CODE}`

/** `Meet – kqw-mzdv-ptj`：各階段都一樣（猜歌沒有「作畫中」的前綴；分頁標題不洩漏有歌在播） */
export function meetWindowTitle(): string {
  return MEET_APP_TITLE
}

// ─── 舞台 ───────────────────────────────────────────────────────

/** 出題的偽裝叫法（控制列按鈕、對話框標題、舞台文字都用它） */
export const SHARE_AUDIO_LABEL = '分享音訊'

/** 出題者不在玩家清單時的稱呼 */
export const SETTER_FALLBACK = '出題者'

/**
 * 主畫面左上標籤（design §1、§2）：播放中「<出題者> 正在分享音訊」；揭曉「第 n / N 首」；
 * idle 顯示上一局排名時「上一局」；其餘階段沒有標籤（null）
 */
export function stageLabel(round: Pick<ShellRoundState, 'phase' | 'setterName' | 'songIndex' | 'songCount' | 'showLastResults'>): string | null {
  switch (round.phase) {
    case 'playing':
      return `${round.setterName !== null && round.setterName !== '' ? round.setterName : SETTER_FALLBACK} 正在${SHARE_AUDIO_LABEL}`
    case 'reveal':
      return round.songIndex !== null ? songProgress(round.songIndex, round.songCount) : null
    case 'idle':
      return round.showLastResults ? LAST_GAME_LABEL : null
    default:
      return null
  }
}

/** idle 顯示上一局排名時的標籤 */
export const LAST_GAME_LABEL = '上一局'

/** 「第 2 / 5 首」 */
export function songProgress(index: number, total: number): string {
  return `第 ${index} / ${total} 首`
}

/** 舞台：沒有局也沒有結果（design §2 idle） */
export const STAGE_EMPTY_TEXT = `尚無人${SHARE_AUDIO_LABEL}`

/** 舞台：其他人看到出題者正在選題庫（design §2 choosing） */
export function preparingText(setterName: string | null): string {
  return `${setterName !== null && setterName !== '' ? setterName : SETTER_FALLBACK} 正在準備${SHARE_AUDIO_LABEL}…`
}

/**
 * 波形直條（design §1：5～7 根，純 CSS、不讀真實音訊）：每根的最低高度比例、週期（ms）與延遲（ms）都不同，看起來才不整齊。
 * rest＝靜止時（還沒起播、prefers-reduced-motion）的高度比例
 */
export const WAVE_BARS = [
  { min: 0.3, rest: 0.45, duration: 900, delay: 0 },
  { min: 0.2, rest: 0.7, duration: 700, delay: -250 },
  { min: 0.35, rest: 0.55, duration: 1100, delay: -600 },
  { min: 0.15, rest: 0.9, duration: 800, delay: -100 },
  { min: 0.35, rest: 0.6, duration: 1000, delay: -450 },
  { min: 0.2, rest: 0.75, duration: 750, delay: -300 },
  { min: 0.3, rest: 0.4, duration: 950, delay: -700 },
] as const

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

/** 人數不足時「分享音訊」上方的說明（design §2 idle） */
export function waitingForPlayers(online: number): string {
  return `等待其他玩家加入（${online}/${MIN_PLAYERS}）`
}

/** 「分享音訊」按鈕的樣子（design §2「控制列」欄） */
export type ShareControlState =
  /** 可按：放 volunteer 插槽（功能元件的按鈕） */
  | 'ready'
  /** 自己正在出題（choosing）：作用中（--accent），不可再按 */
  | 'active'
  /** 沒有進行中的局但人數不足：灰化＋上方小字 */
  | 'waiting'
  /** 別人出題中、播放中、揭曉中：灰化 */
  | 'busy'

/** 依階段、是否為出題者與在線人數決定「分享音訊」按鈕的樣子（可按的條件與功能元件 canVolunteer 相同） */
export function shareControlState(phase: SongPhase, isSetter: boolean, online: number): ShareControlState {
  if (phase === 'idle' || phase === 'ended') return online >= MIN_PLAYERS ? 'ready' : 'waiting'
  return phase === 'choosing' && isSetter ? 'active' : 'busy'
}

/** 不可按時的工具提示 */
export function shareControlTip(state: Exclude<ShareControlState, 'ready'>): string {
  switch (state) {
    case 'active':
      return `正在準備${SHARE_AUDIO_LABEL}`
    case 'waiting':
      return `${SHARE_AUDIO_LABEL}（等待其他玩家加入）`
    case 'busy':
      return `${SHARE_AUDIO_LABEL}（這一局進行中）`
  }
}

/** 音量：圖示按鈕的無障礙名稱與工具提示（「音量 60」；0 為「音量 0（靜音）」） */
export function volumeTip(label: string, value: number): string {
  return value <= 0 ? `${label} ${value}（靜音）` : `${label} ${value}`
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
/** 輸入膠囊的 placeholder（DESIGN §15.2）；取代功能元件給的提示文字（改顯示在輸入列上方） */
export const MEET_CHAT_PLACEHOLDER = '傳送訊息給所有人'
export const MEET_SEND_LABEL = '傳送訊息'
/** 自己送出的訊息名字（Meet 顯示「你」） */
export const MEET_SELF_NAME = '你'

/** 訊息列的名字：自己送出的為「你」，其餘為暱稱（null 為空字串） */
export function chatSenderName(nickname: string | null, isMine: boolean): string {
  return isMine ? MEET_SELF_NAME : (nickname ?? '')
}

// ─── 對話框 ─────────────────────────────────────────────────────

/** 對話框標題（design §1「出題（選題庫）」：對話框「分享音訊」）；說明（'help'）的標題為對話框的 title（「說明」或主題名稱），不在此表 */
export const MEET_DIALOG_TITLE: Record<Exclude<DialogPurpose, 'help'>, string> = {
  source: SHARE_AUDIO_LABEL,
}

/** 說明對話框的標題（沒有 title 時） */
export const MEET_HELP_TITLE = '說明'

/** 對話框標題：說明用 title，其餘依用途 */
export function meetDialogHeading(purpose: DialogPurpose, title: string | undefined): string {
  return purpose === 'help' ? (title ?? MEET_HELP_TITLE) : MEET_DIALOG_TITLE[purpose]
}

/** 對話框按鈕文字：[第一個選項（主要）, 第二個選項]；第三個以後照選項文字。說明（'help'）一律照選項文字（「返回」「關閉」） */
export const MEET_DIALOG_BUTTONS: Record<Exclude<DialogPurpose, 'help'>, readonly [string, string]> = {
  source: ['分享', '取消'],
}

/** 自動重連畫面（screen 'resume'）的一行提示（DESIGN §15.2） */
export const MEET_RESUME_TEXT = '正在重新加入通話…'

/**
 * 對話框按鈕的可見文字。pending（DialogItem.pending：這個選項正在等 server，例如「搜尋中…」）時顯示選項原文，
 * 不換成偽裝的按鈕文字（design §1：搜尋中按鈕文字「搜尋中…」）
 */
export function meetDialogButtonText(purpose: DialogPurpose, index: number, label: string, pending: boolean = false): string {
  if (purpose === 'help' || pending) return label
  const texts = MEET_DIALOG_BUTTONS[purpose]
  return index === 0 ? texts[0] : index === 1 ? texts[1] : label
}

/** 對話框按鈕的無障礙名稱：以可見文字開頭，再補上實際動作（WCAG 2.5.3 label in name） */
export function meetDialogButtonLabel(purpose: DialogPurpose, index: number, label: string, pending: boolean = false): string {
  const text = meetDialogButtonText(purpose, index, label, pending)
  return text === label ? label : `${text}：${label}`
}

/**
 * 題庫來源四選一（segmented）的方向鍵：←↑ 上一個、→↓ 下一個（頭尾循環）、Home／End 第一個／最後一個；其餘鍵回 null。
 * current < 0（沒有選中）時 → 從第一個開始。換成兩列（segmentedGroupClass）時順序不變：左上→右上→左下→右下，↑↓ 也照這個順序走
 */
export function choiceKeyTarget(key: string, current: number, count: number): number | null {
  if (count <= 0) return null
  const from = current < 0 ? 0 : current
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowUp':
      return (from - 1 + count) % count
    case 'ArrowRight':
    case 'ArrowDown':
      return (from + 1) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

/**
 * segmented 一列最多放幾個選項：超過時（Epic 19 起四選一）窄的對話框會換成兩列（2×2）。
 * 三個以內的選項文字短（「歌手／台灣熱門／西洋熱門」），375px 寬一列放得下，維持原樣
 */
export const SEGMENTED_SINGLE_ROW_MAX = 3

/**
 * segmented（role="radiogroup"）的 class：以外層容器（@container，對話框內文寬）判斷，不看視窗寬——對話框置中於 tile，tile 比視窗窄。
 *   選項 ≤ SEGMENTED_SINGLE_ROW_MAX：一列膠囊（rounded-full）。
 *   選項更多：容器 < 340px（375px 手機的白卡片內文約 295px；四個選項一列至少要約 300px，「台灣熱門」4 字＋左右 8px）→ 兩欄 grid（2×2，圓角 18px）；
 *     ≥ 340px（桌機 420px 卡片內文 372px）→ 一列膠囊。只用 CSS 換列，DOM 順序（＝方向鍵順序）不變。
 * Tailwind 掃描原始碼取 class，所以這裡寫完整字串，不拼接數字
 */
export function segmentedGroupClass(count: number): string {
  const base = 'border border-border-panel p-[2px]'
  if (count <= SEGMENTED_SINGLE_ROW_MAX) return `flex rounded-full ${base}`
  return `grid grid-cols-2 gap-[2px] rounded-[18px] ${base} @min-[340px]:flex @min-[340px]:gap-0 @min-[340px]:rounded-full`
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

/** 底部控制列右側「資訊」＝遊戲說明（DESIGN §15.2）：工具提示與無障礙名稱 */
export const HELP_BUTTON_LABEL = '說明'

/** 遊戲說明「切換偽裝」的路徑 */
export const MEET_SWITCH_HINT = '更多 ⋮ → 切換偽裝'

// ─── 響應式（DESIGN §15.3；plan 決策 9） ─────────────────────────────

/**
 * 斷點（px）：< stripNarrow 影片條 160px；< stripBelow 影片條改到主畫面下方橫向列（tile 寬 120px）；
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
/** 「更多 ⋮」選單第二項：遊戲說明清單（窄螢幕「資訊」隱藏時的入口） */
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
