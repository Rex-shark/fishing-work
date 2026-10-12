// 偽裝殼層的共通介面（複製自我畫你猜 shells/types；spec/song-guess/architecture.md §7「殼層介面」）。
// 殼層只負責版面、標籤、裝飾與把功能元件放進插槽；功能元件不知道自己被放在哪種偽裝裡。
// 功能元件需要依主題呈現的部分（對話框外觀、玩家清單、舞台、音量）由殼層以 ShellViews（views.ts）提供。
import type { ComponentType, ReactNode } from 'react'
import type { SongPhase } from '@fishing-work/shared/song-guess'
import type { HelpTopicId } from '../features/help/helpTopics'

/** 偽裝主題 id：猜歌 v1 只有視訊會議（spec/song-guess/design.md；日後加主題就在這裡加 id） */
export type ShellId = 'meet'

/** 殼層需要的局／首狀態（只用於版面與裝飾：舞台標籤、「出題」按鈕的三種樣子） */
export interface ShellRoundState {
  phase: SongPhase
  /** 自己是本局出題者（choosing 起；ended 仍為 true） */
  isSetter: boolean
  /** 本局出題者的暱稱（App 由 players 依 round.setterId 推導）；idle 或出題者已不在玩家清單為 null */
  setterName: string | null
  /** 目前這首是第幾首（playing／reveal 才有；其餘 null） */
  songIndex: number | null
  /** 一局幾首（round.songCount） */
  songCount: number
  /** 舞台正在顯示上一局的排名（idle 且有上一局結果；design §2「idle（有上一局結果）」） */
  showLastResults: boolean
}

/**
 * 遊戲畫面（已加入）的插槽（spec §7：stage、roundStatus、volunteer、chat、players、volume，另有 connection、dialogs）。
 * 每個插槽都是功能元件，殼層決定放在哪裡：
 * - dialogs：浮出的對話框（出題、遊戲說明）；殼層提供定位用的容器（position: relative）
 */
export interface ShellGameSlots {
  /** 玩家清單 */
  players: ReactNode
  /** 舞台：播放中的視覺、每首揭曉卡、本局排名（父層給定寬高，內容自行置中與捲動） */
  stage: ReactNode
  /** 聊天室（兼猜歌輸入） */
  chat: ReactNode
  /** 階段、倒數、歌名字數提示、自己猜對的得分 */
  roundStatus: ReactNode
  /** 「出題」（idle／ended 且人數足夠時顯示；各主題擺放位置不同） */
  volunteer: ReactNode
  /** 音量（本機偏好；唯一的播放控制） */
  volume: ReactNode
  /** 連線狀態 */
  connection: ReactNode
  /** 出題、說明等浮出對話框 */
  dialogs: ReactNode
}

/**
 * 房間人數（殼層的裝飾計數與人數不足的說明）。
 * 由 App 從 store 推導後注入：殼層不直接讀 store/game（shellBoundary 把關），與 round、themes 相同。
 */
export interface ShellPlayerCounts {
  /** 在線（connected）人數 */
  online: number
  /** 玩家數（含寬限期中的斷線者） */
  total: number
}

/** 可顯示的主題（首頁風格卡片與各殼層「切換偽裝…」共用；由 shells/catalog.ts 產生） */
export interface ShellThemeOption {
  id: ShellId
  /** 卡片／選單名稱（中文） */
  name: string
  /** 首頁卡片的一行描述（≤ 20 字） */
  description: string
  icon: ComponentType<{ size?: number; className?: string }>
  /** 已註冊（可選）；false = 「即將推出」、不可選 */
  available: boolean
}

/**
 * 遊戲畫面的「切換偽裝」入口所需資料：殼層只負責呈現，
 * 目前主題與切換由 App 從 uiStore 注入；殼層不直接 import uiStore（避免 uiStore → 註冊表 → 殼層 → uiStore 的循環相依）。
 */
export interface ShellThemeSwitch {
  current: ShellId
  options: readonly ShellThemeOption[]
  /** 切換主題；未註冊或與目前相同時不動作（uiStore.setShellId） */
  select(id: ShellId): void
}

/**
 * 遊戲說明的入口：殼層的說明入口呼叫 open；
 * 開關狀態在 uiStore.helpTopic，由 App 注入（殼層不 import uiStore，與 themes 同一模式）。對話框本身是 dialogs 插槽裡的 HelpDialog
 */
export interface ShellHelp {
  /** 開啟說明：省略 topicId＝主題清單（第一步）；給 topicId＝直接顯示該主題（第二步） */
  open(topicId?: HelpTopicId): void
}

export type ShellProps =
  | ({ screen: 'game'; round: ShellRoundState; counts: ShellPlayerCounts; themes: ShellThemeSwitch; help: ShellHelp } & ShellGameSlots)
  | {
      /**
       * 自動重連畫面（未加入、但有重連憑證）：殼層渲染空白畫面＋一行 notice（「正在重新加入…」）。
       * 登入在首頁（home/），殼層沒有輸入框與卡片。
       */
      screen: 'resume'
      notice: string
      connection: ReactNode
    }

/** document.title 的輸入（未加入時 phase 視為 idle） */
export interface ShellTitleState {
  phase: SongPhase
}

/** 註冊表的一筆：首頁風格卡片與切換都從同一份清單產生 */
export interface ShellDefinition {
  id: ShellId
  /** 卡片名稱（中文） */
  name: string
  /** 首頁卡片的一行描述（≤ 20 字） */
  description: string
  /** 卡片圖示 */
  icon: ComponentType<{ size?: number; className?: string }>
  Shell: ComponentType<ShellProps>
  /** 視窗標題 */
  titleFor(state: ShellTitleState): string
  /** favicon 網址 */
  faviconHref: string
}
