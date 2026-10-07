// 偽裝殼層的共通介面（plan/camouflage-themes.md 決策 1、2；architecture §7「偽裝殼層」）。
// 殼層只負責版面、標籤、裝飾與把功能元件放進插槽；功能元件不知道自己被放在哪種偽裝裡。
// 功能元件需要依主題呈現的部分（對話框外觀、玩家清單的呈現）由殼層以 ShellViews（views.ts）提供。
import type { ComponentType, ReactNode } from 'react'
import type { RoundPhase } from '@fishing-work/shared'
import type { HelpTopicId } from '../features/help/helpTopics'

/** 偽裝主題 id（決策 2：vscode、ppt；ppt 於 Epic 3 Phase 3 註冊；meet 於 Epic 5 註冊；excel 於 Epic 13 註冊） */
export type ShellId = 'vscode' | 'ppt' | 'meet' | 'excel'

/** 殼層需要的回合狀態（只用於版面與裝飾，例如作畫中標記、畫師時的配色、工具列與裝飾圖示的切換） */
export interface ShellRoundState {
  phase: RoundPhase
  /** 自己是本回合畫師 */
  isDrawer: boolean
  /** 自己是畫師且 phase = drawing（工具列可用） */
  canDraw: boolean
  /**
   * 本回合畫師的暱稱（Epic 5 決策 12；meet 主畫面標籤「<畫師> 正在分享畫面」用）：App 由 players 依 round.drawerId 推導
   * （shellRound.drawerNameOf）；idle 或畫師已不在玩家清單為 null，ended 仍有值。殼層不讀 store，與 counts 同一模式；vscode／ppt 不使用
   */
  drawerName: string | null
}

/**
 * 遊戲畫面（已加入）的插槽。每個插槽都是功能元件，殼層決定放在哪裡：
 * - chat：殼層放聊天室的容器必須帶 `data-chat-drop-zone` 屬性且為定位元素（position: relative），
 *   聊天室以它為圖片投放區、並把拖曳覆蓋層 portal 進去蓋滿整個容器（見 features/chat/dropZone.ts）
 * - dialogs：浮出的對話框（出題、放棄確認、遊戲說明）；殼層提供定位用的容器（position: relative）
 */
export interface ShellGameSlots {
  /** 玩家清單 */
  players: ReactNode
  /** 畫布（父層須為 size container：container-type: size，畫布依剩餘寬高等比縮放 16:9） */
  canvas: ReactNode
  /** 畫師工具列（非畫師時元件自己不渲染） */
  toolbar: ReactNode
  /** 聊天室（兼猜題輸入、圖片投放區） */
  chat: ReactNode
  /** 回合階段、倒數、題目提示、猜對進度、本回合得分 */
  roundStatus: ReactNode
  /** 「我來畫」（idle 且人數足夠時顯示；新增插槽：spec 的 roundStatus 之外，各主題擺放位置不同） */
  volunteer: ReactNode
  /** 連線狀態（新增插槽） */
  connection: ReactNode
  /** 出題、放棄確認等浮出對話框 */
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
 * 遊戲畫面的「切換偽裝」入口所需資料（決策 7）：殼層只負責呈現（vscode：設定齒輪選單 → 快速選單），
 * 目前主題與切換由 App 從 uiStore 注入；殼層不直接 import uiStore（避免 uiStore → 註冊表 → 殼層 → uiStore 的循環相依）。
 */
export interface ShellThemeSwitch {
  current: ShellId
  options: readonly ShellThemeOption[]
  /** 切換主題；未註冊或與目前相同時不動作（uiStore.setShellId） */
  select(id: ShellId): void
}

/**
 * 遊戲說明的入口（Epic 6 決策 3）：殼層的說明入口（ppt「說明」分頁的主題按鈕、vscode 齒輪「說明…」、meet「資訊」）呼叫 open；
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
       * 自動重連畫面（未加入、但有重連憑證；Epic 4 決策 4、9）：殼層渲染空白畫面＋一行 notice（「正在重新加入…」）。
       * 登入改在首頁（home/），殼層不再有輸入框與卡片。
       */
      screen: 'resume'
      notice: string
      connection: ReactNode
    }

/** document.title 的輸入（未加入時 phase 視為 idle） */
export interface ShellTitleState {
  phase: RoundPhase
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
