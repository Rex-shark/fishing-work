// 殼層提供給功能元件的呈現元件（複製自我畫你猜 shells/views；功能元件不變，殼層提供 renderer）。
// 功能元件負責資料與行為，外觀由目前殼層的 ShellViews 決定；殼層在自己的根節點以 ShellViewsContext.Provider 提供。
// 繪圖比賽只有 ppt 一套殼層（spec/draw-contest/architecture.md §7），沒有「預設外觀」：所有欄位必填，新殼層要全部提供。
import { createContext, useContext, type ChangeEvent, type ComponentType, type FormEvent, type ReactNode } from 'react'
import type { ChatKind, PlayerPublic } from '@fishing-work/shared/draw-contest'

// ─── 對話框（出題、交卷確認、遊戲說明；暱稱輸入自 Epic 4 起在首頁，不在殼層） ──────────────

/**
 * 對話框用途：殼層依用途決定位置、標題與外觀（ppt：Office 對話框）。
 * 'topic'＝出題（features/round/TopicDialog）；'help'（features/help/HelpDialog）：title 為對話框標題（「說明」或主題名稱）；
 * 沒有 body 時 items 為主題清單，有 body 時 items 為「返回」「關閉」，按鈕顯示選項原文（DESIGN §16）；
 * 'submit'＝交卷確認（features/round/SubmitConfirmDialog）：items 第一個＝交卷、第二個＝取消（回去繼續畫）；
 * 標題、內文與按鈕文字由殼層決定（ppt「儲存投影片？」「儲存後不能再修改」「儲存」「取消」；spec/draw-contest/design.md §2）
 */
export type DialogPurpose = 'topic' | 'help' | 'submit'

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
  maxLength?: number
  invalid?: boolean
  enterKeyHint?: 'go' | 'send' | 'done'
}

export interface DialogProps {
  purpose: DialogPurpose
  /** 對話框的無障礙名稱 */
  label: string
  /** 輸入框；省略時為純選單（例如說明清單） */
  input?: DialogField
  /** 選單上方的提問文字 */
  title?: string
  /**
   * 內文（Epic 6：說明的段落，每段一個 <p>）。選填；省略時殼層輸出與 Epic 6 前完全相同。
   * 段落的字級、行高、段距由殼層的容器決定（DESIGN §16：ppt 14px／段距 8px）
   */
  body?: ReactNode
  /** 第一個選項為預設（Enter） */
  items: DialogItem[]
  onEscape?: () => void
  /**
   * 送出中（等 server 回應）：輸入框不可編輯、選項由呼叫端各自設 disabled。
   * 殼層必須讓焦點留在對話框內：輸入框用 readOnly＋aria-busy 呈現，**不得用原生 disabled**
   * （被停用的元素會失去焦點，之後 Esc／Enter 都收不到；plan/notes.md 2026-10-12）；
   * busy 由 true 轉 false 時若焦點已不在對話框內，殼層把焦點放回輸入框（沒有輸入框時放回第一個可用選項）
   */
  busy?: boolean
  /** 進行中的提示 */
  note?: string | null
  /** 錯誤訊息 */
  error?: string | null
  /**
   * 焦點陷阱（強制回應的確認框）：Tab／Shift+Tab 在對話框內循環，不會跑到後面的畫面。
   * 省略＝非強制回應（出題、說明開著時遊戲照常進行）
   */
  trapFocus?: boolean
}

// ─── 玩家清單 ───────────────────────────────────────────────────

export interface PlayerRowData {
  player: PlayerPublic
  isMe: boolean
  /** 本回合有進行中的比賽（drawing／judging）：此時 participating＝false 的玩家顯示為旁觀 */
  contestActive: boolean
}

export interface PlayerListViewProps {
  rows: PlayerRowData[]
}

// ─── 聊天室（Epic 3 Phase 3：每則訊息、輸入列的外觀交給殼層） ───────────────

/** 一則聊天訊息的顯示資料（ChatPanel 由 ChatMessage 與本機狀態推導，features/chat/chatFormat.chatLineData） */
export interface ChatLineData {
  id: string
  kind: ChatKind
  /** 發話者 id：system 為 null */
  fromId: string | null
  nickname: string | null
  /** 原文（server 給） */
  text: string
  /** 送出時間（epoch ms） */
  at: number
  /** at 的本機時間 `HH:mm`（格式化的便利值；殼層要別的格式就用 at） */
  time: string
  /** 自己送出的訊息（fromId 等於自己的 id） */
  isMine: boolean
}

export interface ChatLineProps {
  line: ChatLineData
}

/** 輸入框的受控屬性與事件：殼層原樣展開到自己的 <input>（{...input}），只加外觀 class */
export interface ChatInputProps {
  value: string
  onChange(e: ChangeEvent<HTMLInputElement>): void
  maxLength: number
  /** 功能提示（chatFormat.CHAT_HINT）；殼層可改用自己的文字 */
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
  /** 輸入列上方的本地錯誤（太快、不合法、逾時等），約 4 秒後自動清除；null = 無 */
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
}

// ─── 作畫工具列 ─────────────────────────────────────────────────

export interface ToolbarView {
  /** 視窗寬度小於此值（px）時，粗細滑桿收進「⋯」彈出面板；0 = 永不收合 */
  compactBelowPx: number
}

// ─── 狀態列式項目（layout/StatusItem） ──────────────────────────────

export interface StatusView {
  /** StatusButton 的色彩 class：文字色、hover 底、focus 外框色（外框粗細與位置由元件固定） */
  buttonClassName: string
}

// ─── 「我出題」（features/round/RoundStatus 的 VolunteerStatus） ─────────────────

export interface VolunteerView {
  /** 可見文字（ppt「從目前投影片開始」）；無障礙名稱為 `<label>：我出題`（roundDisplay.volunteerAriaLabel） */
  label: string
  /** 文字前的 14px 圖示；省略＝不顯示圖示 */
  icon?: ComponentType<{ size?: number; className?: string }>
}

// ─── 遊戲說明（features/help，Epic 6） ─────────────────────────────────

export interface HelpView {
  /** 說明內文的 {switch}：本殼層切換偽裝的操作路徑（例如「檔案 → 切換偽裝」；不帶「…」，代入內文後才不會連續標點） */
  switchHint: string
  /** 說明內文的 {recent}：本殼層回看最近幾場的操作路徑（Epic 17；ppt「檔案 › 開啟最近的簡報」） */
  recentHint: string
}

// ─── 偽裝用語（繪圖比賽：功能元件的文字裡，與偽裝有關的名詞由殼層提供） ─────────────────

/**
 * 功能元件顯示的文字裡，題目、交卷、揭曉畫廊、比賽歷史的叫法屬於偽裝（ppt：題目＝「標題」、交卷＝「儲存」、畫廊＝「投影片瀏覽」、歷史＝「最近的簡報」）。
 * 功能元件以這些詞組句（例如「已{save} 3/8」「{topic}：蘋果」「未{save}」），本身不寫死偽裝字樣（shellBoundary 把關）
 */
export interface TermsView {
  /** 題目的叫法（ppt「標題」）：「正在輸入標題…」「標題：蘋果」 */
  topic: string
  /** 交卷的叫法（ppt「儲存」）：「已儲存 3/8」「未儲存」「儲存中…」 */
  save: string
  /** 揭曉畫廊的無障礙名稱（ppt「投影片瀏覽」） */
  gallery: string
  /** 比賽歷史（存在瀏覽器的最近幾場）在回合狀態列的叫法（Epic 17；ppt「最近的簡報」）：「最近的簡報：蘋果（10/12 14:03）…」 */
  recent: string
}

// ─── Context ────────────────────────────────────────────────────

export interface ShellViews {
  Dialog: ComponentType<DialogProps>
  PlayerList: ComponentType<PlayerListViewProps>
  /** 聊天室外觀 */
  chat: ChatView
  /** 作畫工具列 */
  toolbar: ToolbarView
  /** 狀態列式項目 */
  status: StatusView
  /** 「我出題」的文字與圖示 */
  volunteer: VolunteerView
  /** 遊戲說明代入的殼層名稱 */
  help: HelpView
  /** 偽裝用語（題目、交卷、畫廊、比賽歷史的叫法） */
  terms: TermsView
}

export const ShellViewsContext = createContext<ShellViews | null>(null)

/** 取得目前殼層的呈現元件；功能元件必須放在殼層之內 */
export function useShellViews(): ShellViews {
  const views = useContext(ShellViewsContext)
  if (views === null) throw new Error('功能元件必須放在殼層（Shell）之內')
  return views
}

/** 聊天室外觀 */
export function useChatView(): ChatView {
  return useShellViews().chat
}
/** 作畫工具列設定 */
export function useToolbarView(): ToolbarView {
  return useShellViews().toolbar
}
/** 狀態列式項目外觀 */
export function useStatusView(): StatusView {
  return useShellViews().status
}
/** 「我出題」的文字與圖示 */
export function useVolunteerView(): VolunteerView {
  return useShellViews().volunteer
}
/** 遊戲說明代入的殼層名稱 */
export function useHelpView(): HelpView {
  return useShellViews().help
}
/** 偽裝用語（題目、交卷、畫廊的叫法） */
export function useTermsView(): TermsView {
  return useShellViews().terms
}
