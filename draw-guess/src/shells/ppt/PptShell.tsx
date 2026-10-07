// ppt 主題：PowerPoint 偽裝殼層（DESIGN.md §13；plan/camouflage-themes.md「PPT 主題版面對照」；architecture §7）。
//   標題列（橘紅，「簡報1 - PowerPoint」、右側 connection 插槽）
//   ｜功能區分頁（檔案＝選單「切換偽裝…」；常用＝裝飾按鈕群；繪圖＝畫師時 toolbar 插槽，否則整組灰化；
//     說明＝遊戲中點了才作用，內容為一排說明主題按鈕 → ShellProps.help.open(主題)（Epic 6，DESIGN §13.2、§16）；
//     「檔案」選單第二項「說明…」→ ShellProps.help.open()（決策 8：< 1024px「說明」分頁隱藏時的入口））
//   ｜左縮圖窗格（players 插槽 → SlidePlayers）｜中央灰色工作區＋投影片（canvas 插槽，畫布底色仍為 CANVAS_BACKGROUND，1px 外框＋投影片陰影）
//   ｜投影片下方備忘稿列（roundStatus 插槽）｜右註解窗格（chat 插槽，容器帶 data-chat-drop-zone）
//   ｜狀態列（投影片 N / M、中文(台灣)、備忘稿；中央「從目前投影片開始」＝ volunteer 插槽；右側顯示設定、62% 裝飾）。
//   自動重連（screen 'resume'，Epic 4）：同一殼層，空白投影片（按一下以新增標題）＋置中對話框只放一行 notice（PptResumeDialog）。
// 狀態列不因畫師變色（§13.3）；畫師身分以縮圖橘框與「繪圖」分頁作用呈現。
// 功能元件的呈現：對話框＝PptDialog、玩家清單＝SlidePlayers、聊天＝註解卡片（CommentChat）、狀態列項目＝深色字、
// 工具列收合斷點、「▶ 從目前投影片開始」（pptViews），以 ShellViewsContext 提供；淺色底的配色由正式 view 與 token（--fg-on-active）處理，不在容器上改寫 CSS 變數。
// 殼層不 import uiStore／catalog（踩雷紀錄 Phase 2）；主題資料經 ShellProps.themes、說明入口經 ShellProps.help。不讀 store/game：人數經 ShellProps.counts。
import { useRef, useState, type ComponentType, type ReactNode, type RefObject } from 'react'
import { MIN_PLAYERS, PALETTE, type RoundPhase } from '@fishing-work/shared'
import { HELP_TOPICS, type HelpTopicId } from '../../features/help/helpTopics'
import { canVolunteer } from '../../features/round/roundDisplay'
import { CloseIcon, EllipsisIcon, EraserIcon, FillIcon, SearchIcon, StopIcon, TrashIcon, UndoIcon } from '../../layout/icons'
import { tip } from '../../layout/tooltipPlacement'
import { useMediaQuery } from '../../layout/useElementSize'
import type { ShellGameSlots, ShellHelp, ShellPlayerCounts, ShellProps, ShellRoundState, ShellThemeSwitch } from '../types'
import { ShellViewsContext } from '../views'
import { FileTab, OfficeThemeDialog } from '../office/FileMenu'
import {
  CommentIcon,
  MaximizeIcon,
  MinimizeIcon,
  NormalViewIcon,
  PaletteIcon,
  PasteIcon,
  PenIcon,
  PictureIcon,
  QuestionBubbleIcon,
  RedoIcon,
  RefreshIcon,
  SaveIcon,
  SwitchThemeIcon,
} from '../office/officeIcons'
import { PptResumeDialog } from './PptDialog'
import {
  AlignLeftIcon,
  BulletsIcon,
  LayoutIcon,
  NewSlideIcon,
  NotesIcon,
  ReadingViewIcon,
  ShapesIcon,
  SlideshowIcon,
  SorterIcon,
  TextBoxIcon,
} from './pptIcons'
import {
  PPT_APP_TITLE,
  PPT_DIRTY_MARK,
  RIBBON_CONTENT_TABS,
  RIBBON_TABS,
  RIBBON_TABS_HIDDEN_WHEN_NARROW,
  activeRibbonTab,
  defaultRibbonTab,
  isSlideDirty,
  slideCounter,
  waitingForPlayers,
  type RibbonContentTab,
  type RibbonPick,
} from './pptLayout'
import { PPT_VIEWS, PPT_VOLUNTEER_VIEW } from './pptViews'

/** ≥ 1024px 縮圖窗格內嵌；以下改為覆蓋層（由狀態列「投影片 N / M」開啟） */
const WIDE_QUERY = '(min-width: 1024px)'

export function PptShell(props: ShellProps) {
  return (
    <ShellViewsContext.Provider value={PPT_VIEWS}>
      {props.screen === 'game' ? (
        <GameScreen {...props} />
      ) : (
        <PptFrame
          dirty={false}
          connection={props.connection}
          ribbonDefault="常用"
          thumbnails={<BlankThumbnail />}
          slide={<BlankSlide />}
          notes={
            <span aria-hidden="true" className="px-3 text-fg-muted">
              按一下以新增備忘稿
            </span>
          }
          comments={<NoComments />}
          counter={slideCounter(0, 0)}
          statusCenter={<StartSlideshowIdle />}
          overlay={<PptResumeDialog notice={props.notice} />}
        />
      )}
    </ShellViewsContext.Provider>
  )
}

function GameScreen(props: { round: ShellRoundState; counts: ShellPlayerCounts; themes: ShellThemeSwitch; help: ShellHelp } & ShellGameSlots) {
  const { round, counts, themes, help, players, canvas, toolbar, chat, roundStatus, volunteer, connection, dialogs } = props
  // 「投影片 N / M」為裝飾（N 在線、M 玩家數）；人數由 App 注入（殼層不讀 store）
  return (
    <PptFrame
      dirty={isSlideDirty(round.phase)}
      connection={connection}
      ribbonDefault={defaultRibbonTab(round.isDrawer, round.phase)}
      drawTools={round.canDraw ? toolbar : null}
      themes={themes}
      help={help}
      thumbnails={players}
      slide={canvas}
      dialogs={dialogs}
      notes={
        <>
          <span aria-hidden="true" className="shrink-0 pr-1 pl-3 text-fg-muted">
            備忘稿：
          </span>
          {roundStatus}
        </>
      }
      comments={chat}
      counter={slideCounter(counts.online, counts.total)}
      statusCenter={<StartSlideshow phase={round.phase} online={counts.online} volunteer={volunteer} />}
    />
  )
}

// ─── 外框 ───────────────────────────────────────────────────────

interface PptFrameProps {
  /** 作畫中：標題前綴 ● */
  dirty: boolean
  connection: ReactNode
  ribbonDefault: RibbonContentTab
  /** 「繪圖」分頁的畫師工具列；null／省略＝整組灰化 */
  drawTools?: ReactNode
  /** 切換偽裝（遊戲中才有）；省略時「檔案」為裝飾 */
  themes?: ShellThemeSwitch
  /** 遊戲說明（遊戲中才有）；省略時「說明」分頁為裝飾 */
  help?: ShellHelp
  thumbnails: ReactNode
  /** 投影片（畫布）；父層為 size container */
  slide: ReactNode
  /** 浮出對話框（置中於投影片工作區） */
  dialogs?: ReactNode
  /** 備忘稿列 */
  notes: ReactNode
  /** 註解窗格本體（聊天室） */
  comments: ReactNode
  counter: string
  statusCenter: ReactNode
  /** 視窗層浮出物（自動重連畫面的對話框） */
  overlay?: ReactNode
}

function PptFrame(props: PptFrameProps) {
  const { dirty, connection, ribbonDefault, drawTools, themes, help, thumbnails, slide, dialogs, notes, comments, counter, statusCenter, overlay } =
    props
  const wide = useMediaQuery(WIDE_QUERY)
  /** 寬螢幕：縮圖窗格是否收起；窄螢幕：覆蓋層是否開啟（預設關） */
  const [paneHidden, setPaneHidden] = useState(false)
  const [paneOverlay, setPaneOverlay] = useState(false)
  const paneVisible = wide ? !paneHidden : paneOverlay
  /** 「切換偽裝」對話框；關閉時焦點還給「檔案」 */
  const [themePickOpen, setThemePickOpen] = useState(false)
  const fileRef = useRef<HTMLButtonElement>(null)

  function togglePane() {
    if (wide) setPaneHidden((v) => !v)
    else setPaneOverlay((v) => !v)
  }

  function closeThemePick(refocus: boolean) {
    setThemePickOpen(false)
    if (refocus) fileRef.current?.focus()
  }

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-editor font-mono text-[13px] text-fg">
      <TitleBar dirty={dirty} connection={connection} />
      <Ribbon
        fallback={ribbonDefault}
        drawTools={drawTools}
        fileRef={fileRef}
        onSwitchTheme={themes !== undefined ? () => setThemePickOpen(true) : undefined}
        onHelp={help?.open}
        onHelpList={help !== undefined ? () => help.open() : undefined}
      />

      <div className="relative flex min-h-0 flex-1">
        {paneVisible && (
          <aside
            aria-label="投影片縮圖"
            onKeyDown={(e) => {
              if (!wide && e.key === 'Escape') setPaneOverlay(false)
            }}
            className={`w-[180px] shrink-0 overflow-y-auto border-r border-border bg-sidebar ${
              wide ? '' : 'absolute top-0 bottom-0 left-0 z-20 shadow-quickinput'
            }`}
          >
            {thumbnails}
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <main aria-label="投影片" className="relative flex min-h-0 flex-1 bg-editor p-6 max-md:p-3">
            {/* size container：投影片（畫布）依剩餘寬高等比縮放 16:9 不變形；畫布加投影片陰影（§13.2 例外） */}
            <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center [container-type:size] [&_canvas]:shadow-slide">{slide}</div>
            {dialogs}
          </main>
          <div
            aria-label="備忘稿"
            role="region"
            className="flex h-[28px] shrink-0 items-center overflow-hidden border-t border-border bg-sidebar text-[12px] whitespace-nowrap text-fg"
          >
            {notes}
          </div>
        </div>

        <section
          aria-label="註解"
          data-chat-drop-zone=""
          className="relative flex w-[260px] shrink-0 flex-col border-l border-border bg-sidebar max-lg:w-[220px] max-md:w-[180px]"
        >
          <CommentsHeader />
          <div className="min-h-0 flex-1">{comments}</div>
        </section>

        {overlay}
        {themes !== undefined && themePickOpen && <OfficeThemeDialog themes={themes} onClose={closeThemePick} />}
      </div>

      <StatusBar counter={counter} paneVisible={paneVisible} onTogglePane={togglePane} center={statusCenter} />
    </div>
  )
}

// ─── 標題列 ─────────────────────────────────────────────────────

/** 30px 橘紅：左快速存取（裝飾）、中「簡報1 - PowerPoint」（作畫中前綴 ●）、右連線狀態小字與視窗按鈕（裝飾） */
function TitleBar({ dirty, connection }: { dirty: boolean; connection: ReactNode }) {
  return (
    <header className="flex h-[30px] shrink-0 items-center bg-titlebar text-fg-statusbar">
      <div aria-hidden="true" className="flex h-full shrink-0 items-center gap-3 px-3 max-md:hidden">
        <span className="flex" {...tip('儲存')}>
          <SaveIcon />
        </span>
        <span className="flex" {...tip('復原')}>
          <UndoIcon />
        </span>
        <span className="flex" {...tip('重做')}>
          <RedoIcon />
        </span>
      </div>
      <div className="min-w-0 flex-1 truncate px-3 text-center">{dirty ? `${PPT_DIRTY_MARK} ${PPT_APP_TITLE}` : PPT_APP_TITLE}</div>
      <div className="flex h-full shrink-0 items-center text-[12px]">{connection}</div>
      <div aria-hidden="true" className="flex h-full shrink-0 items-center max-md:hidden">
        <span className="flex h-full w-[46px] items-center justify-center">
          <MinimizeIcon />
        </span>
        <span className="flex h-full w-[46px] items-center justify-center">
          <MaximizeIcon size={14} />
        </span>
        <span className="flex h-full w-[46px] items-center justify-center">
          <CloseIcon />
        </span>
      </div>
    </header>
  )
}

// ─── 功能區 ─────────────────────────────────────────────────────

export function Ribbon(props: {
  fallback: RibbonContentTab
  drawTools?: ReactNode
  fileRef: RefObject<HTMLButtonElement | null>
  onSwitchTheme?: () => void
  /** 開啟說明的某個主題（遊戲中）；省略時「說明」分頁為裝飾 */
  onHelp?: (topicId: HelpTopicId) => void
  /** 開啟說明清單（「檔案」選單的「說明…」，窄螢幕入口；決策 8） */
  onHelpList?: () => void
}) {
  const { fallback, drawTools, fileRef, onSwitchTheme, onHelp, onHelpList } = props
  const [pick, setPick] = useState<RibbonPick | null>(null)
  const active = activeRibbonTab(pick, fallback)
  const panelId = 'ppt-ribbon-panel'
  return (
    <div className="shrink-0 border-b border-border bg-activity">
      <div role="tablist" aria-label="功能區" className="flex h-[28px] items-stretch overflow-hidden bg-tab-inactive">
        <FileTab buttonRef={fileRef} onSwitchTheme={onSwitchTheme} onHelp={onHelpList} />
        {RIBBON_TABS.slice(1).map((tab) => {
          const narrowHidden = RIBBON_TABS_HIDDEN_WHEN_NARROW.includes(tab) ? 'max-lg:hidden' : ''
          const content = RIBBON_CONTENT_TABS.find((t) => t === tab && (t !== '說明' || onHelp !== undefined))
          if (content === undefined) {
            return (
              <span key={tab} aria-hidden="true" className={`flex shrink-0 items-center border-t-2 border-transparent px-3 text-fg ${narrowHidden}`}>
                {tab}
              </span>
            )
          }
          const selected = active === content
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panelId}
              onClick={() => setPick({ tab: content, base: fallback })}
              className={`flex shrink-0 cursor-pointer items-center border-t-2 px-3 transition-colors duration-100 focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-border-focus ${
                selected ? 'border-accent bg-tab-active text-accent' : 'border-transparent text-fg hover:bg-hover'
              }${narrowHidden !== '' ? ` ${narrowHidden}` : ''}`}
            >
              {tab}
            </button>
          )
        })}
      </div>
      <div
        id={panelId}
        role="tabpanel"
        aria-label={active}
        className="flex h-[64px] items-stretch overflow-x-auto overflow-y-hidden py-1"
      >
        <RibbonContent active={active} drawTools={drawTools} onHelp={onHelp} />
      </div>
    </div>
  )
}

/** 功能區內容（64px）：「繪圖」＝畫師工具列（或灰化）、「說明」＝說明主題按鈕（遊戲中）、其餘＝「常用」裝飾 */
export function RibbonContent(props: { active: RibbonContentTab; drawTools?: ReactNode; onHelp?: (topicId: HelpTopicId) => void }) {
  const { active, drawTools, onHelp } = props
  if (active === '繪圖') return <DrawRibbon tools={drawTools} />
  if (active === '說明' && onHelp !== undefined) return <HelpRibbon onOpen={onHelp} />
  return <HomeRibbon />
}

/** 功能區的一組：內容＋下方 11px 群組名稱，右側 1px 分隔 */
function RibbonGroup({ caption, children, tooltip }: { caption: string; children: ReactNode; tooltip?: string }) {
  return (
    <div {...(tooltip !== undefined ? tip(tooltip) : {})} className="flex h-full shrink-0 flex-col border-r border-border px-2">
      <div className="flex min-h-0 flex-1 items-center gap-1">{children}</div>
      <div className="text-center text-[11px] leading-[14px] text-fg-muted">{caption}</div>
    </div>
  )
}

/** 大按鈕（裝飾）：24px 圖示＋下方文字 */
function BigDecor({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="flex h-full flex-col items-center justify-center gap-[2px] px-1 text-[11px] leading-[14px] text-fg">
      {icon}
      <span>{label}</span>
    </span>
  )
}

/** 「常用」：裝飾性按鈕群（新增投影片、版面配置、字型…），純裝飾 */
function HomeRibbon() {
  return (
    <div aria-hidden="true" className="flex h-full items-stretch">
      <RibbonGroup caption="剪貼簿">
        <BigDecor icon={<PasteIcon size={24} />} label="貼上" />
      </RibbonGroup>
      <RibbonGroup caption="投影片">
        <BigDecor icon={<NewSlideIcon size={24} />} label="新增投影片" />
        <span className="flex flex-col gap-1 text-[11px] text-fg">
          <span className="flex items-center gap-1">
            <LayoutIcon size={14} />
            版面配置
          </span>
          <span className="flex items-center gap-1">
            <TextBoxIcon size={14} />
            文字方塊
          </span>
        </span>
      </RibbonGroup>
      <RibbonGroup caption="字型">
        <span className="flex flex-col gap-1 text-fg">
          <span className="flex gap-1">
            <span className="w-[112px] truncate rounded-[2px] border border-border px-1 text-[11px] leading-[18px]">微軟正黑體 (本文)</span>
            <span className="w-[32px] rounded-[2px] border border-border px-1 text-[11px] leading-[18px]">18</span>
          </span>
          <span className="flex gap-3 px-1 text-[12px] leading-[16px]">
            <span className="font-bold">B</span>
            <span className="italic">I</span>
            <span className="underline">U</span>
            <span className="line-through">S</span>
          </span>
        </span>
      </RibbonGroup>
      <RibbonGroup caption="段落">
        <span className="flex gap-2 text-fg">
          <BulletsIcon />
          <AlignLeftIcon />
        </span>
      </RibbonGroup>
      <RibbonGroup caption="繪圖">
        <BigDecor icon={<ShapesIcon size={24} />} label="圖案" />
      </RibbonGroup>
      <RibbonGroup caption="編輯">
        <span className="flex items-center gap-1 text-[11px] text-fg">
          <SearchIcon size={14} />
          尋找
        </span>
      </RibbonGroup>
    </div>
  )
}

/** 「繪圖」：畫師（作畫中）放 toolbar 插槽；否則同樣的工具整組灰化、不可點（§13.2） */
function DrawRibbon({ tools }: { tools?: ReactNode }) {
  if (tools !== null && tools !== undefined) {
    return (
      <RibbonGroup caption="畫筆">
        <div className="flex h-[30px] items-stretch">{tools}</div>
      </RibbonGroup>
    )
  }
  return (
    <RibbonGroup caption="畫筆（只有本回合的畫師可以使用）" tooltip="只有本回合的畫師可以使用繪圖工具">
      <div aria-hidden="true" className="pointer-events-none flex h-[30px] items-center gap-[6px] text-fg opacity-40 select-none">
        {/* 目前顏色鈕（Epic 11：取代原本的畫筆圖示與色相條，與真工具列同位置）：22×22 內 14px 圓點，填預設白筆（PALETTE[0]） */}
        <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center">
          <span className="block h-[14px] w-[14px] rounded-full border border-border" style={{ backgroundColor: PALETTE[0] }} />
        </span>
        <span className="flex items-center gap-[4px]">
          {PALETTE.map((color) => (
            // 畫筆色是遊戲資料（spec PALETTE），以 style 帶入（同 ToolBar）
            <span key={color} className="block h-4 w-4 rounded-[2px] border border-border" style={{ backgroundColor: color }} />
          ))}
        </span>
        <span className="relative block h-[2px] w-[80px] bg-border">
          <span className="absolute top-0 left-0 block h-[2px] w-[20%] bg-accent" />
        </span>
        {/* 背景色（Epic 7）：與真工具列同位置（粗細之後、橡皮擦之前） */}
        <FillIcon />
        <EraserIcon />
        <UndoIcon />
        <TrashIcon />
        <StopIcon />
      </div>
    </RibbonGroup>
  )
}

/** 說明主題的 Office 風格線條圖示（16px；一主題一個） */
const HELP_TOPIC_ICONS: Record<HelpTopicId, ComponentType<{ size?: number }>> = {
  'be-drawer': PenIcon,
  guess: QuestionBubbleIcon,
  'switch-theme': SwitchThemeIcon,
  tools: PaletteIcon,
  image: PictureIcon,
  reconnect: RefreshIcon,
}

/** 「說明」（Epic 6，DESIGN §13.2）：一排說明主題按鈕（16px 圖示＋標籤），點了直接開該主題的說明（對話框第二步） */
export function HelpRibbon({ onOpen }: { onOpen: (topicId: HelpTopicId) => void }) {
  return (
    <RibbonGroup caption="說明">
      {HELP_TOPICS.map((topic) => {
        const Icon = HELP_TOPIC_ICONS[topic.id]
        return (
          <button
            key={topic.id}
            type="button"
            onClick={() => onOpen(topic.id)}
            className="flex h-[28px] shrink-0 cursor-pointer items-center gap-[6px] rounded-[2px] px-[8px] text-[12px] text-fg transition-colors duration-100 hover:bg-hover focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-border-focus"
          >
            <Icon size={16} />
            {topic.title}
          </button>
        )
      })}
    </RibbonGroup>
  )
}

// ─── 註解窗格 ────────────────────────────────────────────────────

function CommentsHeader() {
  return (
    <div className="flex h-[32px] shrink-0 items-center justify-between border-b border-border pr-2 pl-3">
      <span className="flex items-center gap-2 text-fg">
        <CommentIcon />
        註解
      </span>
      <span aria-hidden="true" className="flex items-center gap-2 text-fg">
        <span className="flex" {...tip('更多選項')}>
          <EllipsisIcon />
        </span>
        <span className="flex" {...tip('關閉窗格')}>
          <CloseIcon />
        </span>
      </span>
    </div>
  )
}

/** 自動重連畫面的註解窗格（空） */
function NoComments() {
  return (
    <div aria-hidden="true" className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-fg-muted">
      <CommentIcon size={24} />
      <span>這份簡報還沒有任何註解</span>
    </div>
  )
}

// ─── 投影片（自動重連畫面） ────────────────────────────────────────

/** 空白投影片：白底、1px 外框、陰影，內含兩個虛線佔位框（純裝飾） */
function BlankSlide() {
  return (
    <div
      aria-hidden="true"
      className="flex aspect-video w-[min(100cqw,calc(100cqh*16/9))] flex-col items-center justify-center gap-[3%] bg-slide text-fg-muted shadow-slide outline-1 outline-border"
    >
      <span className="flex h-[22%] w-[84%] items-center justify-center border border-dashed border-border text-[length:max(14px,3.4cqw)]">
        按一下以新增標題
      </span>
      <span className="flex h-[14%] w-[84%] items-center justify-center border border-dashed border-border text-[length:max(12px,1.8cqw)]">
        按一下以新增副標題
      </span>
    </div>
  )
}

/** 自動重連畫面的縮圖窗格：一張空白投影片（選取中） */
function BlankThumbnail() {
  return (
    <div aria-hidden="true" className="flex gap-1 py-3 pr-3 pl-1">
      <span className="w-5 shrink-0 pt-[2px] text-right text-[11px] leading-[14px] text-fg-muted">1</span>
      <span className="block aspect-video min-w-0 flex-1 rounded-[1px] bg-slide outline-2 outline-accent" />
    </div>
  )
}

// ─── 狀態列 ─────────────────────────────────────────────────────

/** 狀態列中央：可開局時放 volunteer 插槽；否則「▶ 從目前投影片開始」灰化，人數不足時旁邊說明（§13.2） */
function StartSlideshow({ phase, online, volunteer }: { phase: RoundPhase; online: number; volunteer: ReactNode }) {
  if (canVolunteer(phase, online)) return <div className="flex h-full items-center">{volunteer}</div>
  return (
    <>
      <StartSlideshowIdle />
      {phase === 'idle' && online < MIN_PLAYERS && <span className="truncate px-[5px]">{waitingForPlayers(online)}</span>}
    </>
  )
}

/** 灰化的「▶ 從目前投影片開始」（不可點）：與可點時的 volunteer 插槽同一組文字與圖示（PPT_VOLUNTEER_VIEW） */
function StartSlideshowIdle() {
  const { label, icon: Icon } = PPT_VOLUNTEER_VIEW
  return (
    <span aria-hidden="true" className="flex h-full shrink-0 items-center gap-1 px-[6px] opacity-40">
      {Icon !== undefined && <Icon size={14} />}
      {label}
    </span>
  )
}

function StatusBar(props: { counter: string; paneVisible: boolean; onTogglePane: () => void; center: ReactNode }) {
  const { counter, paneVisible, onTogglePane, center } = props
  const paneLabel = paneVisible ? '隱藏投影片縮圖（玩家清單）' : '顯示投影片縮圖（玩家清單）'
  return (
    <footer
      aria-label="狀態列"
      className="flex h-[22px] shrink-0 items-center overflow-hidden border-t border-border bg-statusbar text-[12px] whitespace-nowrap text-fg"
    >
      <div className="flex h-full shrink-0 items-center">
        <button
          type="button"
          onClick={onTogglePane}
          aria-label={`${counter}，${paneLabel}`}
          aria-pressed={paneVisible}
          {...tip(paneLabel, 'top')}
          className="flex h-full cursor-pointer items-center px-2 tabular-nums transition-colors duration-100 hover:bg-statusbar-hover focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-border-focus"
        >
          {counter}
        </button>
        <span aria-hidden="true" className="flex h-full items-center px-2 max-md:hidden">
          中文(台灣)
        </span>
        <span aria-hidden="true" className="flex h-full items-center gap-1 px-2 max-md:hidden">
          <NotesIcon size={14} />
          備忘稿
        </span>
      </div>
      <div className="flex h-full min-w-0 flex-1 items-center justify-center">{center}</div>
      <div aria-hidden="true" className="flex h-full shrink-0 items-center gap-1 px-2 max-md:hidden">
        <span className="px-1 max-lg:hidden">顯示設定</span>
        <span className="flex items-center gap-2 px-1">
          <NormalViewIcon size={14} />
          <SorterIcon size={14} />
          <ReadingViewIcon size={14} />
          <SlideshowIcon size={14} />
        </span>
        <span className="flex items-center gap-1 px-1 max-lg:hidden">
          <span>−</span>
          <span className="relative block h-px w-[80px] bg-fg-muted">
            <span className="absolute top-[-4px] left-[46%] block h-[9px] w-[3px] bg-fg" />
          </span>
          <span>+</span>
        </span>
        <span className="px-1 tabular-nums">62%</span>
      </div>
    </footer>
  )
}
