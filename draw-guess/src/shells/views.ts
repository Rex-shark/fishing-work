// 殼層提供給功能元件的呈現元件（決策 1：功能元件不變，殼層提供 renderer）。
// 功能元件負責資料與行為，外觀由目前殼層的 ShellViews 決定；殼層在自己的根節點以 ShellViewsContext.Provider 提供。
// Dialog、PlayerList 必填；chat、toolbar、status、volunteer、help 選填，省略時用 vscode 主題的外觀（DEFAULT_*，定義在 shells/vscode/viewDefaults）。
import { createContext, useContext, type ChangeEvent, type ClipboardEvent, type ComponentType, type FormEvent, type ReactNode } from 'react'
import type { ChatKind, ImageMeta, PlayerPublic } from '@fishing-work/shared'
import type { ImageStatus } from '../features/chat/imageUrls'
import { VSCODE_CHAT_VIEW, VSCODE_HELP_VIEW, VSCODE_STATUS_VIEW, VSCODE_TOOLBAR_VIEW, VSCODE_VOLUNTEER_VIEW } from './vscode/viewDefaults'

// ─── 對話框（出題、放棄確認、遊戲說明；暱稱輸入自 Epic 4 起在首頁，不在殼層） ──────────────

/**
 * 對話框用途：殼層依用途決定位置、標題與外觀（vscode：快速輸入框；ppt：Office 對話框；meet：白卡片）。
 * 'help'（Epic 6，features/help/HelpDialog）：title 為對話框標題（「說明」或主題名稱）；沒有 body 時 items 為主題清單，
 * 有 body 時 items 為「返回」「關閉」，按鈕顯示選項原文（DESIGN §16）
 */
export type DialogPurpose = 'topic' | 'cancelRound' | 'help'

export interface DialogItem {
  id: string
  /** 選項文字（不含殼層自己的前綴符號） */
  label: string
  /** 右側說明（字數、倒數、快捷鍵） */
  detail?: ReactNode
  onSelect(): void
  disabled?: boolean
}

export interface DialogField {
  value: string
  onChange(value: string): void
  placeholder: string
  ariaLabel: string
  disabled?: boolean
  maxLength?: number
  invalid?: boolean
  enterKeyHint?: 'go' | 'send' | 'done'
}

export interface DialogProps {
  purpose: DialogPurpose
  /** 對話框的無障礙名稱 */
  label: string
  /** 輸入框；省略時為純選單（例如放棄確認） */
  input?: DialogField
  /** 選單上方的提問文字 */
  title?: string
  /**
   * 內文（Epic 6：說明的段落，每段一個 <p>）。選填；省略時殼層輸出與 Epic 6 前完全相同。
   * 段落的字級、行高、段距由殼層的容器決定（DESIGN §16：vscode 13px／段距 6px；ppt、meet 14px／段距 8px）
   */
  body?: ReactNode
  /** 第一個選項為預設（Enter） */
  items: DialogItem[]
  onEscape?: () => void
  /** 進行中的提示 */
  note?: string | null
  /** 錯誤訊息 */
  error?: string | null
}

// ─── 玩家清單 ───────────────────────────────────────────────────

export interface PlayerRowData {
  player: PlayerPublic
  isMe: boolean
  /** 本回合得分（作畫中與揭曉時才有） */
  gain: number | null
}

export interface PlayerListViewProps {
  rows: PlayerRowData[]
}

// ─── 聊天室（Epic 3 Phase 3：每則訊息、輸入列的外觀交給殼層） ───────────────

/** 圖片訊息在本機的顯示資料 */
export interface ChatLineImage {
  meta: ImageMeta
  /** 本機顯示狀態（imageUrls.displayStatus）：ready 才有 url */
  status: ImageStatus
  /** 縮圖的 Blob URL；沒有圖可顯示時為 null */
  url: string | null
  /** 沒有圖時的灰字佔位（`[圖片]（載入中…）` 等四種，imageUrls.IMAGE_PLACEHOLDER）；有圖時為 null */
  placeholder: string | null
}

/** server 揭曉訊息（system，`題目是 X（原因）`）拆出的題目與原因，供殼層高亮題目 */
export interface ChatReveal {
  topic: string
  reason: string
}

/** 一則聊天訊息的顯示資料（ChatPanel 由 ChatMessage 與本機狀態推導，features/chat/chatFormat.chatLineData） */
export interface ChatLineData {
  id: string
  kind: ChatKind
  /** 發話者 id：system 為 null；correct 為猜對者；image 為傳圖者 */
  fromId: string | null
  nickname: string | null
  /** 原文（server 給；image 為空字串） */
  text: string
  /** 送出時間（epoch ms） */
  at: number
  /** at 的本機時間 `HH:mm`（格式化的便利值；殼層要別的格式就用 at） */
  time: string
  /** 自己送出的訊息（fromId 等於自己的 id） */
  isMine: boolean
  /** system 揭曉訊息的題目與原因；其他訊息為 null */
  reveal: ChatReveal | null
  /** kind = image 才有 */
  image: ChatLineImage | null
}

export interface ChatLineProps {
  line: ChatLineData
  /**
   * 與前一則是同一人的連續訊息（Epic 5 決策 13(5)；ChatPanel 以 chatFormat.groupsWithPrevious 計算：同 fromId 且兩則皆為 chat／image）。
   * 選填：殼層可據此合併顯示（meet 不再重複「暱稱 HH:mm」）；vscode／ppt 忽略
   */
  groupWithPrevious?: boolean
}

/** 輸入框的受控屬性與事件：殼層原樣展開到自己的 <input>（{...input}），只加外觀 class */
export interface ChatInputProps {
  value: string
  onChange(e: ChangeEvent<HTMLInputElement>): void
  /** 貼上含圖片檔時改走傳圖流程 */
  onPaste(e: ClipboardEvent<HTMLInputElement>): void
  maxLength: number
  /** 依角色與階段變化（chatFormat.chatPlaceholder）；殼層可改用自己的文字 */
  placeholder: string
  'aria-label': string
  'aria-invalid': boolean
  autoComplete: 'off'
  enterKeyHint: 'send'
}

/**
 * 輸入列：殼層必須渲染 `<form onSubmit={onSubmit}>` 並在其中放 `<input {...input} />`
 * （form 的隱式送出：注音等輸入法選字的 Enter 不會觸發）。錯誤提示的位置與樣式由殼層決定，須帶 role="alert"。
 */
export interface ChatComposerProps {
  onSubmit(e: FormEvent<HTMLFormElement>): void
  input: ChatInputProps
  /** 輸入列上方的本地錯誤（被擋、逾時、圖片不符等），約 4 秒後自動清除；null = 無 */
  error: string | null
  /** 目前內容可送出（去頭尾空白後非空）；給有「送出」鈕的殼層判斷是否灰化 */
  canSend: boolean
}

export interface ChatView {
  /** ChatPanel 根節點的外觀 class（底色、行高） */
  panelClassName: string
  /** 訊息列表（<ul role="log">）的外觀 class（內距、間距）；列表本身的捲動由 ChatPanel 負責 */
  listClassName: string
  /** 一則訊息：根節點必須是單一 <li> */
  Line: ComponentType<ChatLineProps>
  /** 輸入列（見 ChatComposerProps） */
  Composer: ComponentType<ChatComposerProps>
  /**
   * 拖圖覆蓋層的外觀 class（底色、虛線框、文字色；Epic 5 決策 13(2)）。選填；省略＝DEFAULT_CHAT_OVERLAY_CLASS（DESIGN §5：--bg-selection 0.35、
   * 2px 虛線 --border-focus、--fg）。定位與排版（absolute inset-0、置中）由 ChatPanel 固定
   */
  overlayClassName?: string
}

// ─── 畫師工具列 ─────────────────────────────────────────────────

export interface ToolbarView {
  /** 視窗寬度小於此值（px）時，粗細滑桿收進「⋯」彈出面板；0 = 永不收合 */
  compactBelowPx: number
}

// ─── 狀態列式項目（layout/StatusItem） ──────────────────────────────

export interface StatusView {
  /** StatusButton 的色彩 class：文字色、hover 底、focus 外框色（外框粗細與位置由元件固定） */
  buttonClassName: string
}

// ─── 「我來畫」（features/round/RoundStatus 的 VolunteerStatus） ─────────────────

export interface VolunteerView {
  /** 可見文字（vscode「我來畫」；ppt「從目前投影片開始」）；無障礙名稱為 `<label>：自願當畫師`（roundDisplay.volunteerAriaLabel） */
  label: string
  /** 文字前的 14px 圖示；省略＝不顯示圖示 */
  icon?: ComponentType<{ size?: number; className?: string }>
}

// ─── 遊戲說明（features/help，Epic 6） ─────────────────────────────────

export interface HelpView {
  /** 說明內文的 {switch}：本殼層切換偽裝的操作路徑（例如「左下角齒輪 → 切換偽裝」；不帶「…」，代入內文後才不會連續標點） */
  switchHint: string
}

// ─── Context ────────────────────────────────────────────────────

export interface ShellViews {
  Dialog: ComponentType<DialogProps>
  PlayerList: ComponentType<PlayerListViewProps>
  /** 聊天室外觀；省略 = DEFAULT_CHAT_VIEW（vscode 終端機樣式） */
  chat?: ChatView
  /** 畫師工具列；省略 = DEFAULT_TOOLBAR_VIEW（< 810px 收合） */
  toolbar?: ToolbarView
  /** 狀態列式項目；省略 = DEFAULT_STATUS_VIEW（彩色狀態列上的白字） */
  status?: StatusView
  /** 「我來畫」的文字與圖示；省略 = DEFAULT_VOLUNTEER_VIEW（▷ 我來畫） */
  volunteer?: VolunteerView
  /** 遊戲說明代入的殼層名稱；省略 = DEFAULT_HELP_VIEW（vscode 的切換路徑） */
  help?: HelpView
}

/** 拖圖覆蓋層的預設外觀（DESIGN §5；Epic 5 前 ChatPanel 寫死的值，vscode／ppt 沿用） */
export const DEFAULT_CHAT_OVERLAY_CLASS = 'border-2 border-dashed border-border-focus bg-selection/35 text-fg'

/** 殼層未提供時的預設：vscode 主題的外觀（Epic 3 Phase 1 前的樣子） */
export const DEFAULT_CHAT_VIEW: ChatView = VSCODE_CHAT_VIEW
export const DEFAULT_TOOLBAR_VIEW: ToolbarView = VSCODE_TOOLBAR_VIEW
export const DEFAULT_STATUS_VIEW: StatusView = VSCODE_STATUS_VIEW
export const DEFAULT_VOLUNTEER_VIEW: VolunteerView = VSCODE_VOLUNTEER_VIEW
export const DEFAULT_HELP_VIEW: HelpView = VSCODE_HELP_VIEW

export const ShellViewsContext = createContext<ShellViews | null>(null)

/** 取得目前殼層的呈現元件；功能元件必須放在殼層之內 */
export function useShellViews(): ShellViews {
  const views = useContext(ShellViewsContext)
  if (views === null) throw new Error('功能元件必須放在殼層（Shell）之內')
  return views
}

/** 選填欄位補上預設值（殼層之外或殼層未提供時用 vscode 外觀） */
export function resolveChatView(views: ShellViews | null): ChatView {
  return views?.chat ?? DEFAULT_CHAT_VIEW
}
/** 拖圖覆蓋層外觀（ChatView.overlayClassName；未提供時為預設） */
export function resolveChatOverlayClass(view: Pick<ChatView, 'overlayClassName'>): string {
  return view.overlayClassName ?? DEFAULT_CHAT_OVERLAY_CLASS
}
export function resolveToolbarView(views: ShellViews | null): ToolbarView {
  return views?.toolbar ?? DEFAULT_TOOLBAR_VIEW
}
export function resolveStatusView(views: ShellViews | null): StatusView {
  return views?.status ?? DEFAULT_STATUS_VIEW
}
export function resolveVolunteerView(views: ShellViews | null): VolunteerView {
  return views?.volunteer ?? DEFAULT_VOLUNTEER_VIEW
}
export function resolveHelpView(views: ShellViews | null): HelpView {
  return views?.help ?? DEFAULT_HELP_VIEW
}

/** 聊天室外觀（殼層未提供時為預設） */
export function useChatView(): ChatView {
  return resolveChatView(useContext(ShellViewsContext))
}
/** 畫師工具列設定（殼層未提供時為預設） */
export function useToolbarView(): ToolbarView {
  return resolveToolbarView(useContext(ShellViewsContext))
}
/** 狀態列式項目外觀（殼層未提供時為預設；也可在殼層之外使用） */
export function useStatusView(): StatusView {
  return resolveStatusView(useContext(ShellViewsContext))
}
/** 「我來畫」的文字與圖示（殼層未提供時為預設） */
export function useVolunteerView(): VolunteerView {
  return resolveVolunteerView(useContext(ShellViewsContext))
}
/** 遊戲說明代入的殼層名稱（殼層未提供時為預設） */
export function useHelpView(): HelpView {
  return resolveHelpView(useContext(ShellViewsContext))
}
