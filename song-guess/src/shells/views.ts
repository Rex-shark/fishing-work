// 殼層提供給功能元件的呈現元件（複製自我畫你猜 shells/views；功能元件不變，殼層提供 renderer）。
// 功能元件負責資料與行為，外觀由目前殼層的 ShellViews 決定；殼層在自己的根節點以 ShellViewsContext.Provider 提供。
// 猜歌只有 meet 一套殼層（spec/song-guess/architecture.md §7），沒有「預設外觀」：所有欄位必填，新殼層要全部提供。
import { createContext, useContext, type ChangeEvent, type ComponentType, type FormEvent, type ReactNode } from 'react'
import type { ChatKind, PlayerPublic } from '@fishing-work/shared/song-guess'

// ─── 對話框（出題、遊戲說明；暱稱輸入在首頁，不在殼層） ──────────────

/**
 * 對話框用途：殼層依用途決定位置、標題與外觀（meet：白卡片）。
 * 'source'＝出題（features/round/SourceDialog）：choices＝題庫來源四選一（Epic 19 起；選項多時殼層自行處理換列）；歌手模式有 input（歌手名）與 toggle（只抽熱門歌），
 *   現成題庫（榜單、動漫熱門）沒有 input、改以 description 一行說明；items 第一個＝送出、第二個＝取消出題；
 *   標題與按鈕文字由殼層決定（偽裝字樣只在殼層；spec/song-guess/design.md §1）。
 * 'help'（features/help/HelpDialog）：title 為對話框標題（「說明」或主題名稱）；沒有 body 時 items 為主題清單，
 *   有 body 時 items 為「返回」「關閉」，按鈕顯示選項原文（DESIGN §16）
 */
export type DialogPurpose = 'source' | 'help'

export interface DialogItem {
  id: string
  /** 選項文字（不含殼層自己的前綴符號） */
  label: string
  /** 右側說明（字數、倒數、快捷鍵） */
  detail?: ReactNode
  onSelect(): void
  disabled?: boolean
  /**
   * 這個選項正在執行、等 server 回應（例如出題的「搜尋中…」）：label 已換成進行中的文字，
   * 殼層必須顯示 label 原文（不可換成自己的按鈕文字），讓使用者看得到進度
   */
  pending?: boolean
}

export interface DialogField {
  value: string
  onChange(value: string): void
  placeholder: string
  ariaLabel: string
  maxLength?: number
  invalid?: boolean
  enterKeyHint?: 'go' | 'send' | 'done' | 'search'
  /**
   * 掛上時取得焦點（預設 true）。呼叫端在使用者切換來源後給 false：從其他來源切回歌手時焦點留在四選一上，
   * 方向鍵才能繼續切換（不被新掛上的欄位搶走）
   */
  autoFocus?: boolean
}

/** 單選的一個選項 */
export interface DialogChoice {
  id: string
  label: string
}

/**
 * 輸入框上方的單選（出題的題庫來源）：殼層以 role="radiogroup" 呈現（方向鍵、Home／End 切換，只有選中的那個在 Tab 順序裡）。
 * locked（送出中）：不可切換，只設 aria-disabled，**不得用原生 disabled**（理由同 DialogProps.busy）
 */
export interface DialogChoices {
  /** radiogroup 的無障礙名稱 */
  label: string
  options: readonly DialogChoice[]
  value: string
  onChange(id: string): void
  locked?: boolean
}

/** 輸入框下方的勾選（出題的「只抽熱門歌」）；locked 同 DialogChoices */
export interface DialogToggle {
  label: string
  checked: boolean
  onChange(checked: boolean): void
  locked?: boolean
}

export interface DialogProps {
  purpose: DialogPurpose
  /** 對話框的無障礙名稱 */
  label: string
  /** 輸入框上方的單選；省略＝沒有 */
  choices?: DialogChoices
  /** 輸入框；省略時為純選單（例如說明清單） */
  input?: DialogField
  /** 輸入框下方的勾選；省略＝沒有 */
  toggle?: DialogToggle
  /**
   * 沒有輸入框時的一行說明（出題的榜單模式；殼層以次要文字色呈現）；第一個選項的 detail（倒數）擺在它旁邊。
   * 有輸入框時不用（detail 擺在欄位標籤旁）
   */
  description?: string
  /** 選單上方的提問文字 */
  title?: string
  /**
   * 內文（說明的段落，每段一個 <p>）。選填。
   * 段落的字級、行高、段距由殼層的容器決定（DESIGN §16：meet 14px／段距 8px）
   */
  body?: ReactNode
  /** 第一個選項為預設（Enter） */
  items: DialogItem[]
  onEscape?: () => void
  /**
   * 送出中（等 server 回應；出題＝搜尋中）：輸入框不可編輯、選項由呼叫端各自設 disabled。
   * 殼層必須讓焦點留在對話框內：輸入框用 readOnly＋aria-busy 呈現，**不得用原生 disabled**
   * （被停用的元素會失去焦點，之後 Esc／Enter 都收不到；plan/notes.md 2026-10-12）；
   * busy 由 true 轉 false 時若焦點已不在對話框內，殼層把焦點放回輸入框（沒有輸入框時放回第一個可用選項）
   */
  busy?: boolean
  /** 進行中的提示 */
  note?: string | null
  /** 錯誤訊息 */
  error?: string | null
}

// ─── 玩家清單 ───────────────────────────────────────────────────

export interface PlayerRowData {
  player: PlayerPublic
  isMe: boolean
  /** 本首得分（揭曉時每位猜對者都有；播放中只有自己的推得出來）；沒有為 null */
  gain: number | null
}

export interface PlayerListViewProps {
  rows: PlayerRowData[]
}

// ─── 聊天室（每則訊息、輸入列的外觀交給殼層） ───────────────

/** 一則聊天訊息的顯示資料（ChatPanel 由 ChatMessage 與本機狀態推導，features/chat/chatFormat.chatLineData） */
export interface ChatLineData {
  id: string
  kind: ChatKind
  /** 發話者 id：system 為 null；correct 為猜對者 */
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
  /**
   * 與前一則是同一人的連續訊息（ChatPanel 以 chatFormat.groupsWithPrevious 計算：同 fromId 且兩則皆為 chat）。
   * 選填：殼層可據此合併顯示（不再重複「暱稱 HH:mm」）
   */
  groupWithPrevious?: boolean
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
  /** 輸入列上方的本地錯誤（被擋、太快、逾時等），約 4 秒後自動清除；null = 無 */
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

// ─── 狀態列式項目（layout/StatusItem） ──────────────────────────────

export interface StatusView {
  /** StatusButton 的色彩 class：文字色、hover 底、focus 外框色（外框粗細與位置由元件固定） */
  buttonClassName: string
}

// ─── 「出題」（features/round/RoundStatus 的 VolunteerStatus） ─────────────────

export interface VolunteerView {
  /**
   * 出題動作的叫法，也是按鈕的可見文字（偽裝字樣，由殼層給）；無障礙名稱為 `<label>：出題`（roundDisplay.volunteerAriaLabel）。
   * 功能元件要在句子裡提到這個按鈕時（回合狀態、遊戲說明）一律用它組句，不寫死
   */
  label: string
  /** 文字前的 14px 圖示；省略＝不顯示圖示 */
  icon?: ComponentType<{ size?: number; className?: string }>
}

// ─── 遊戲說明（features/help） ─────────────────────────────────

export interface HelpView {
  /** 說明內文的 {switch}：本殼層切換偽裝的操作路徑（不帶「…」，代入內文後才不會連續標點） */
  switchHint: string
}

// ─── 舞台（features/stage：沒有揭曉卡與排名表時的畫面） ──────────────────────

/** 播放器此刻的狀態（features/player/playback.AudioState）：殼層據此決定波形動或停、要不要顯示「開始播放」按鈕 */
export type StagePlayback = 'idle' | 'waiting' | 'playing' | 'blocked' | 'over'

/**
 * 舞台的三種「非結果」畫面（每首揭曉卡與本局排名表是功能元件 features/reveal，不經殼層）：
 * - empty：沒有局、也沒有上一局結果
 * - preparing：出題者正在選題庫（choosing）；自己是出題者時對話框疊在上面
 * - playing：某一首播放中：殼層畫「有聲音在播」的視覺（不得顯示歌名與封面）＋功能元件給的兩行字（題庫標題與第幾首、本首歌手）；
 *   playback 為 'blocked'（瀏覽器擋自動播放）時須顯示一個按鈕讓使用者點一下，呼叫 onStart
 */
export type StageViewProps =
  | { kind: 'empty' }
  | { kind: 'preparing'; setterName: string | null; isSetter: boolean }
  | {
      kind: 'playing'
      /** 第一行：「孫燕姿（熱門） · 第 2 / 5 首」「台灣熱門 · 第 2 / 5 首」（features/round/roundDisplay.playingStageLines） */
      heading: string
      /** 第二行：「歌手：周杰倫」；null＝不顯示（歌手模式且與題庫標題相同） */
      artistLine: string | null
      playback: StagePlayback
      /** 手動起播按鈕的文字（features/player/playback.START_PLAYBACK_LABEL） */
      startLabel: string
      /** 使用者手動起播（自動播放被擋時的保險） */
      onStart(): void
    }

// ─── 音量（features/player/VolumeControl） ─────────────────────────────

export interface VolumeViewProps {
  /** 目前音量（整數 min..max） */
  value: number
  min: number
  max: number
  onChange(value: number): void
  /** 滑桿的無障礙名稱（「音量」） */
  label: string
}

// ─── Context ────────────────────────────────────────────────────

export interface ShellViews {
  Dialog: ComponentType<DialogProps>
  PlayerList: ComponentType<PlayerListViewProps>
  /** 舞台的非結果畫面 */
  Stage: ComponentType<StageViewProps>
  /** 音量控制的外觀（圖示＋滑桿；須可用鍵盤操作） */
  Volume: ComponentType<VolumeViewProps>
  /** 聊天室外觀 */
  chat: ChatView
  /** 狀態列式項目 */
  status: StatusView
  /** 「出題」的文字與圖示 */
  volunteer: VolunteerView
  /** 遊戲說明代入的殼層名稱 */
  help: HelpView
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
/** 狀態列式項目外觀 */
export function useStatusView(): StatusView {
  return useShellViews().status
}
/** 「出題」的文字與圖示 */
export function useVolunteerView(): VolunteerView {
  return useShellViews().volunteer
}
/** 遊戲說明代入的殼層名稱 */
export function useHelpView(): HelpView {
  return useShellViews().help
}
