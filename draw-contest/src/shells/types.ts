// 偽裝殼層的共通介面（plan/camouflage-themes.md 決策 1、2；architecture §7「偽裝殼層」）。
// 殼層只負責版面、標籤、裝飾與把功能元件放進插槽；功能元件不知道自己被放在哪種偽裝裡。
// 功能元件需要依主題呈現的部分（對話框外觀、玩家清單的呈現）由殼層以 ShellViews（views.ts）提供。
import type { ComponentType, ReactNode } from 'react'
import type { ContestPhase } from '@fishing-work/shared/draw-contest'
import type { HelpTopicId } from '../features/help/helpTopics'
import type { HistoryMenuEntry } from '../features/history/historyDisplay'

/** 偽裝主題 id：繪圖比賽 MVP 只有簡報（spec/draw-contest/design.md §1；日後加主題就在這裡加 id） */
export type ShellId = 'ppt'

/** 殼層需要的回合狀態（只用於版面與裝飾，例如作畫中標記、功能區預設分頁、投影片區放畫布或空白投影片） */
export interface ShellRoundState {
  phase: ContestPhase
  /** 自己是本回合出題者（choosing 起） */
  isSetter: boolean
  /** 自己此刻可以作畫：本回合參賽者、phase = drawing、尚未交卷（工具列可用） */
  canDraw: boolean
  /** 投影片區放自己的畫布：本回合參賽者且 phase 為 drawing 或 judging（交卷後鎖定）；否則殼層顯示空白投影片 */
  showCanvas: boolean
  /** 本回合自己已交卷（殼層在鎖定的畫布右下角加小字，design §2「drawing（已交卷）」） */
  submitted: boolean
  /** 投影片區放揭曉畫廊（reveal 插槽）：idle／ended 且有上一回合的結果（design §2、§3）；優先於 showCanvas */
  showReveal: boolean
}

/**
 * 遊戲畫面（已加入）的插槽。每個插槽都是功能元件，殼層決定放在哪裡：
 * - dialogs：浮出的對話框（出題、遊戲說明）；殼層提供定位用的容器（position: relative）
 */
export interface ShellGameSlots {
  /** 玩家清單 */
  players: ReactNode
  /** 自己的本機畫布（父層須為 size container：container-type: size，畫布依剩餘寬高等比縮放 16:9）；殼層只在 round.showCanvas 時放 */
  canvas: ReactNode
  /** 作畫工具列（不能作畫時元件自己不渲染） */
  toolbar: ReactNode
  /**
   * 「完成」（交卷）主要按鈕（不能作畫時元件自己不渲染）。與工具列分開，殼層固定在工具列外（窄版工具列捲動或收合時仍看得到；design §4）
   */
  finish: ReactNode
  /** 揭曉畫廊（每位參賽者的畫、名次與分數；殼層只在 round.showReveal 時放；父層須可捲動或給定高度） */
  reveal: ReactNode
  /**
   * 作畫中的參考圖面板（Epic 20 像不像比賽；元件只在 mimic 回合的 drawing／judging 渲染，其餘時候自己不渲染）。
   * 殼層放在投影片工作區（父層 position: relative；面板自己浮在右上角、放大檢視蓋住工作區），疊在投影片之上、對話框之下
   */
  reference: ReactNode
  /**
   * 比賽歷史的檢視（Epic 17；design §3.1）：存檔那一場的揭曉畫廊。殼層只在 history.openId 非 null 時放，
   * 位置同 reveal（優先於 reveal 與 canvas）
   */
  historyView: ReactNode
  /** 歷史檢視時的回合狀態列（一行摘要）；殼層在 history.openId 非 null 時放在 roundStatus 的位置 */
  historyStatus: ReactNode
  /** 聊天室（純文字） */
  chat: ReactNode
  /** 回合階段、倒數、題目、交卷與評分進度、本回合名次 */
  roundStatus: ReactNode
  /** 「我出題」（idle／ended 且人數足夠時顯示） */
  volunteer: ReactNode
  /** 連線狀態（新增插槽） */
  connection: ReactNode
  /** 出題、交卷確認、說明等浮出對話框 */
  dialogs: ReactNode
}

/**
 * 房間人數（殼層的裝飾計數，例如 ppt 狀態列「投影片 N / M」與人數不足的說明）。
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
  /** 首頁卡片的一行描述（≤ 20 字；Epic 4 決策 7） */
  description: string
  icon: ComponentType<{ size?: number; className?: string }>
  /** 已註冊（可選）；false = 「即將推出」、不可選 */
  available: boolean
}

/**
 * 遊戲畫面的「切換偽裝」入口所需資料（決策 7）：殼層只負責呈現（ppt：「檔案」→「切換偽裝…」），
 * 目前主題與切換由 App 從 uiStore 注入；殼層不直接 import uiStore（避免 uiStore → 註冊表 → 殼層 → uiStore 的循環相依）。
 */
export interface ShellThemeSwitch {
  current: ShellId
  options: readonly ShellThemeOption[]
  /** 切換主題；未註冊或與目前相同時不動作（uiStore.setShellId） */
  select(id: ShellId): void
}

/**
 * 遊戲說明的入口（Epic 6 決策 3）：殼層的說明入口（ppt「說明」分頁的主題按鈕、「檔案」→「說明…」）呼叫 open；
 * 開關狀態在 uiStore.helpTopic，由 App 注入（殼層不 import uiStore，與 themes 同一模式）。對話框本身是 dialogs 插槽裡的 HelpDialog
 */
export interface ShellHelp {
  /** 開啟說明：省略 topicId＝主題清單（第一步）；給 topicId＝直接顯示該主題（第二步） */
  open(topicId?: HelpTopicId): void
}

/**
 * 比賽歷史的入口與檢視（Epic 17；plan/contest-history.md 決策 6、7、7a、10；design §3.1）：最近幾場存在這台瀏覽器的回合。
 * 殼層只負責呈現：入口的清單（ppt：「檔案」→「開啟最近的簡報」）、檢視時把 historyView／historyStatus 插槽放上去、
 * 一顆呼叫 close 的按鈕（字樣由殼層給）。資料與動作由 App 從 features/history 注入；殼層不讀 store、不碰 IndexedDB
 */
export interface ShellHistory {
  /** 清單（最新在上，最多 5 列；label 已排好字）；空陣列＝沒有存檔（或讀不到） */
  entries: readonly HistoryMenuEntry[]
  /** 開著的那一筆的 id；null＝沒有在看歷史 */
  openId: number | null
  /** 現在可以開啟（idle／ended，或 choosing 而自己不是出題者）；false 時入口整項灰化 */
  canOpen: boolean
  /** 開啟一筆（不可開或 id 不存在時不動作） */
  open(id: number): void
  /** 關閉，回到目前的畫面 */
  close(): void
  /** 重讀清單：殼層在入口的選單開啟時呼叫（另一個分頁可能寫了新紀錄） */
  refresh(): void
}

export type ShellProps =
  | ({
      screen: 'game'
      round: ShellRoundState
      counts: ShellPlayerCounts
      themes: ShellThemeSwitch
      help: ShellHelp
      history: ShellHistory
    } & ShellGameSlots)
  | {
      /**
       * 自動重連畫面（未加入、但有重連憑證；Epic 4 決策 4、9）：殼層渲染空白畫面＋一行 notice（「正在重新加入…」）。
       * 登入改在首頁（home/），殼層不再有輸入框與卡片。
       */
      screen: 'resume'
      notice: string
      connection: ReactNode
    }

/** document.title 的輸入（未加入時 phase 視為 idle） */
export interface ShellTitleState {
  phase: ContestPhase
}

/** 註冊表的一筆（決策 2）：首頁風格卡片與切換都從同一份清單產生 */
export interface ShellDefinition {
  id: ShellId
  /** 卡片名稱（中文） */
  name: string
  /** 首頁卡片的一行描述（≤ 20 字；Epic 4 決策 7） */
  description: string
  /** 卡片圖示 */
  icon: ComponentType<{ size?: number; className?: string }>
  Shell: ComponentType<ShellProps>
  /** 視窗標題 */
  titleFor(state: ShellTitleState): string
  /** favicon 網址 */
  faviconHref: string
}
