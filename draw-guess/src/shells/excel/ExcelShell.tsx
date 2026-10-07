// excel 主題：Excel 偽裝殼層（DESIGN.md §17；plan/excel-theme.md「版面對照」；architecture §7）。整個遊戲像一本開著的活頁簿：
//   標題列（綠，「活頁簿1 - Excel」、右側 connection 插槽）
//   ｜功能區分頁（檔案＝選單「切換偽裝…」「說明…」；常用＝裝飾群組＋最右「插入圖片」＝volunteer 插槽；校閱＝「顯示註解」（< 768px 開關註解窗格）；
//     說明＝遊戲中點了才作用，一排說明主題按鈕 → ShellProps.help.open(主題)；關聯式「圖片格式」＝畫師作畫中才出現並預設作用，內容為 toolbar 插槽）
//   ｜資料編輯列（名稱方塊「圖片 1」／「A1」、fx、輸入框；裝飾）
//   ｜工作表區（欄名列、列號欄、CSS 格線；A–C 欄人員表格＝players 插槽 → SheetPlayers；E 欄第 2 列起浮動「圖片 1」＝canvas 插槽，畫師作畫中顯示 8 個控點；
//     表格超過可見列數時表格區垂直捲動、圖片不動；對話框置中於工作表區）
//   ｜右「註解」窗格（chat 插槽，容器帶 data-chat-drop-zone）｜工作表分頁列（裝飾）｜狀態列（左「就緒」＋roundStatus 插槽；右 平均值／計數: N／加總、顯示設定、100%）。
//   響應式（DESIGN §17.2、決策 9）：< 1024px 註解窗格 220px、圖片改放在人員表格下方（E 欄只剩幾十 px，畫不了圖）；
//   < 768px 註解窗格改為覆蓋層（「校閱」→「顯示註解」開關，預設開，Esc 關閉）。
//   自動重連（screen 'resume'）：同一殼層、空工作表（只有表頭）＋置中對話框「開啟活頁簿」一行 notice。
// 非畫師沒有灰化假工具列（決策 2：Excel 的「常用」本來就沒有繪圖工具）；畫師身分靠「圖片格式」分頁、圖片控點與人員表格的綠框。
// 功能元件的呈現（對話框、人員表格、註解、狀態列項目、工具列斷點、「插入圖片」）由 excelViews 以 ShellViewsContext 提供。
// 殼層不 import uiStore／catalog；主題資料經 ShellProps.themes、說明入口經 ShellProps.help。不讀 store/game：人數經 ShellProps.counts。
import { useEffect, useRef, useState, type ComponentType, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { MIN_PLAYERS, type RoundPhase } from '@fishing-work/shared'
import { HELP_TOPICS, type HelpTopicId } from '../../features/help/helpTopics'
import { canVolunteer } from '../../features/round/roundDisplay'
import { ChevronDownIcon, ChevronRightIcon, CloseIcon, EllipsisIcon, FillIcon, PlusIcon, UndoIcon } from '../../layout/icons'
import { tip } from '../../layout/tooltipPlacement'
import { FileTab, OfficeThemeDialog } from '../office/FileMenu'
import {
  CheckIcon,
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
import { OFFICE_DIRTY_MARK, waitingForPlayers } from '../office/officeLayout'
import type { ShellGameSlots, ShellHelp, ShellPlayerCounts, ShellProps, ShellRoundState, ShellThemeSwitch } from '../types'
import { ShellViewsContext } from '../views'
import { ExcelResumeDialog } from './ExcelDialog'
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BordersIcon,
  ChevronLeftIcon,
  CopyIcon,
  CutIcon,
  MergeCenterIcon,
  NewCommentIcon,
  PageBreakIcon,
  PageLayoutIcon,
  ShowCommentsIcon,
  WrapTextIcon,
} from './excelIcons'
import {
  COMMENTS_OVERLAY_QUERY,
  EXCEL_APP_TITLE,
  HEADER_HEIGHT,
  PICTURE_FORMAT_TAB,
  READY_LABEL,
  RIBBON_CONTENT_TABS,
  RIBBON_TABS,
  RIBBON_TABS_HIDDEN_WHEN_NARROW,
  ROW_HEIGHT,
  SHEET_HEADERS,
  SHEET_TABS,
  SHOW_COMMENTS_LABEL,
  activeRibbonTab,
  columnName,
  columnsToFill,
  countText,
  defaultRibbonTab,
  formulaText,
  isPictureSelected,
  isWorkbookDirty,
  nameBoxText,
  rowsToFill,
  type RibbonContentTab,
  type RibbonPick,
} from './excelLayout'
import { EXCEL_VIEWS, EXCEL_VOLUNTEER_VIEW } from './excelViews'

export function ExcelShell(props: ShellProps) {
  return (
    <ShellViewsContext.Provider value={EXCEL_VIEWS}>
      {props.screen === 'game' ? (
        <GameScreen {...props} />
      ) : (
        <ExcelFrame
          dirty={false}
          connection={props.connection}
          pictureSelected={false}
          players={<EmptySheetHeader />}
          tableRows={0}
          picture={null}
          comments={<NoComments />}
          status={null}
          online={0}
          insertPicture={<InsertPictureIdle />}
          overlay={<ExcelResumeDialog notice={props.notice} />}
        />
      )}
    </ShellViewsContext.Provider>
  )
}

function GameScreen(props: { round: ShellRoundState; counts: ShellPlayerCounts; themes: ShellThemeSwitch; help: ShellHelp } & ShellGameSlots) {
  const { round, counts, themes, help, players, canvas, toolbar, chat, roundStatus, volunteer, connection, dialogs } = props
  return (
    <ExcelFrame
      dirty={isWorkbookDirty(round.phase)}
      connection={connection}
      pictureSelected={isPictureSelected(round.canDraw)}
      pictureTools={round.canDraw ? toolbar : null}
      themes={themes}
      help={help}
      players={players}
      tableRows={counts.total}
      picture={canvas}
      dialogs={dialogs}
      comments={chat}
      status={roundStatus}
      online={counts.online}
      insertPicture={<InsertPicture phase={round.phase} online={counts.online} volunteer={volunteer} />}
    />
  )
}

// ─── 外框 ───────────────────────────────────────────────────────

interface ExcelFrameProps {
  /** 作畫中：標題前綴 ● */
  dirty: boolean
  connection: ReactNode
  /** 圖片被選取（畫師作畫中）：「圖片格式」分頁、控點、名稱方塊「圖片 1」 */
  pictureSelected: boolean
  /** 「圖片格式」分頁的畫師工具列；null／省略＝沒有這個分頁的內容 */
  pictureTools?: ReactNode
  /** 切換偽裝（遊戲中才有）；省略時「檔案」為裝飾 */
  themes?: ShellThemeSwitch
  /** 遊戲說明（遊戲中才有）；省略時「說明」分頁為裝飾 */
  help?: ShellHelp
  /** A–C 欄的人員表格（players 插槽） */
  players: ReactNode
  /** 人員表格的玩家列數（counts.total）：決定列號數量與窄螢幕時圖片的位置 */
  tableRows: number
  /** 浮動圖片（canvas 插槽）；null＝沒有圖片（自動重連畫面） */
  picture: ReactNode
  /** 浮出對話框（置中於工作表區） */
  dialogs?: ReactNode
  /** 註解窗格本體（聊天室） */
  comments: ReactNode
  /** 狀態列左側的回合狀態（roundStatus 插槽） */
  status: ReactNode
  online: number
  /** 「常用」最右群組：插入圖片（我來畫） */
  insertPicture: ReactNode
  /** 置中於工作表區的浮出物（自動重連畫面的對話框） */
  overlay?: ReactNode
}

function ExcelFrame(props: ExcelFrameProps) {
  const { dirty, connection, pictureSelected, pictureTools, themes, help, players, tableRows, picture, dialogs, comments, status, online, insertPicture, overlay } =
    props
  /** 註解窗格：≥ 768px 一律顯示；< 768px 為覆蓋層，由「校閱」→「顯示註解」開關（預設開；關閉時保持掛載，輸入草稿不丟） */
  const [commentsOpen, setCommentsOpen] = useState(true)
  /** 「切換偽裝」對話框；關閉時焦點還給「檔案」 */
  const [themePickOpen, setThemePickOpen] = useState(false)
  const fileRef = useRef<HTMLButtonElement>(null)
  const commentsToggleRef = useRef<HTMLButtonElement>(null)

  function closeThemePick(refocus: boolean) {
    setThemePickOpen(false)
    if (refocus) fileRef.current?.focus()
  }

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-editor font-mono text-[13px] text-fg">
      <TitleBar dirty={dirty} connection={connection} />
      <Ribbon
        fallback={defaultRibbonTab(pictureSelected)}
        pictureTools={pictureSelected ? pictureTools : undefined}
        insertPicture={insertPicture}
        fileRef={fileRef}
        onSwitchTheme={themes !== undefined ? () => setThemePickOpen(true) : undefined}
        onHelp={help?.open}
        onHelpList={help !== undefined ? () => help.open() : undefined}
        commentsToggle={
          <ShowCommentsToggle open={commentsOpen} buttonRef={commentsToggleRef} onToggle={() => setCommentsOpen((v) => !v)} />
        }
      />
      <FormulaBar pictureSelected={pictureSelected} />

      <div className="relative flex min-h-0 flex-1">
        <Sheet players={players} tableRows={tableRows} picture={picture} pictureSelected={pictureSelected}>
          {dialogs}
          {overlay}
        </Sheet>

        <section
          aria-label="註解"
          data-chat-drop-zone=""
          onKeyDown={(e) => {
            // 覆蓋層（< 768px）：Esc 關閉並把焦點還給「顯示註解」
            if (e.key === 'Escape' && !e.nativeEvent.isComposing && window.matchMedia(COMMENTS_OVERLAY_QUERY).matches) {
              e.preventDefault()
              setCommentsOpen(false)
              commentsToggleRef.current?.focus()
            }
          }}
          className={`relative flex w-[260px] shrink-0 flex-col border-l border-border bg-sidebar max-lg:w-[220px] max-md:absolute max-md:top-0 max-md:right-0 max-md:bottom-0 max-md:z-20 max-md:w-[min(260px,calc(100%-32px))] max-md:shadow-quickinput ${
            commentsOpen ? '' : 'max-md:hidden'
          }`}
        >
          <CommentsHeader />
          <div className="min-h-0 flex-1">{comments}</div>
        </section>

        {themes !== undefined && themePickOpen && <OfficeThemeDialog themes={themes} onClose={closeThemePick} />}
      </div>

      <SheetTabs />
      <StatusBar status={status} online={online} />
    </div>
  )
}

// ─── 標題列 ─────────────────────────────────────────────────────

/** 30px 綠：左快速存取（裝飾）、中「活頁簿1 - Excel」（作畫中前綴 ●）、右連線狀態小字與視窗按鈕（裝飾） */
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
      <div className="min-w-0 flex-1 truncate px-3 text-center">{dirty ? `${OFFICE_DIRTY_MARK} ${EXCEL_APP_TITLE}` : EXCEL_APP_TITLE}</div>
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
  /** 「圖片格式」分頁的工具列；undefined＝沒有關聯式分頁（圖片未選取） */
  pictureTools?: ReactNode
  insertPicture: ReactNode
  commentsToggle: ReactNode
  fileRef: RefObject<HTMLButtonElement | null>
  onSwitchTheme?: () => void
  /** 開啟說明的某個主題（遊戲中）；省略時「說明」分頁為裝飾 */
  onHelp?: (topicId: HelpTopicId) => void
  /** 開啟說明清單（「檔案」選單的「說明…」，窄螢幕入口） */
  onHelpList?: () => void
}) {
  const { fallback, pictureTools, insertPicture, commentsToggle, fileRef, onSwitchTheme, onHelp, onHelpList } = props
  const [pick, setPick] = useState<RibbonPick | null>(null)
  const contextual = pictureTools !== undefined
  let active = activeRibbonTab(pick, fallback)
  if (active === PICTURE_FORMAT_TAB && !contextual) active = '常用'
  const panelId = 'excel-ribbon-panel'
  const tabs: readonly string[] = contextual ? [...RIBBON_TABS, PICTURE_FORMAT_TAB] : RIBBON_TABS
  return (
    <div className="shrink-0 border-b border-border bg-activity">
      <div role="tablist" aria-label="功能區" className="flex h-[28px] items-stretch overflow-hidden bg-tab-inactive">
        <FileTab buttonRef={fileRef} onSwitchTheme={onSwitchTheme} onHelp={onHelpList} />
        {tabs.slice(1).map((tab) => {
          const narrowHidden = (RIBBON_TABS_HIDDEN_WHEN_NARROW as readonly string[]).includes(tab) ? 'max-lg:hidden' : ''
          const content = RIBBON_CONTENT_TABS.find((t) => t === tab && (t !== '說明' || onHelp !== undefined))
          if (content === undefined) {
            return (
              <span key={tab} aria-hidden="true" className={`flex shrink-0 items-center border-t-2 border-transparent px-3 text-fg ${narrowHidden}`}>
                {tab}
              </span>
            )
          }
          const selected = active === content
          const isContextual = content === PICTURE_FORMAT_TAB
          // 關聯式分頁有色底（--bg-active）與上緣 2px --accent（DESIGN §17.2）；一般分頁作用時底白、上緣 2px --accent
          const look = isContextual
            ? `border-accent bg-active ${selected ? 'text-accent' : 'text-fg hover:bg-hover'}`
            : selected
              ? 'border-accent bg-tab-active text-accent'
              : 'border-transparent text-fg hover:bg-hover'
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panelId}
              onClick={() => setPick({ tab: content, base: fallback })}
              className={`flex shrink-0 cursor-pointer items-center border-t-2 px-3 transition-colors duration-100 focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-border-focus ${look}${
                narrowHidden !== '' ? ` ${narrowHidden}` : ''
              }`}
            >
              {tab}
            </button>
          )
        })}
      </div>
      <div id={panelId} role="tabpanel" aria-label={active} className="flex h-[64px] items-stretch overflow-x-auto overflow-y-hidden py-1">
        <RibbonContent active={active} pictureTools={pictureTools} insertPicture={insertPicture} commentsToggle={commentsToggle} onHelp={onHelp} />
      </div>
    </div>
  )
}

/** 功能區內容（64px）：「圖片格式」＝畫師工具列、「說明」＝說明主題按鈕（遊戲中）、「校閱」＝顯示註解、其餘＝「常用」 */
export function RibbonContent(props: {
  active: RibbonContentTab
  pictureTools?: ReactNode
  insertPicture: ReactNode
  commentsToggle: ReactNode
  onHelp?: (topicId: HelpTopicId) => void
}) {
  const { active, pictureTools, insertPicture, commentsToggle, onHelp } = props
  if (active === PICTURE_FORMAT_TAB && pictureTools !== undefined) return <PictureFormatRibbon tools={pictureTools} />
  if (active === '說明' && onHelp !== undefined) return <HelpRibbon onOpen={onHelp} />
  if (active === '校閱') return <ReviewRibbon commentsToggle={commentsToggle} />
  return <HomeRibbon insertPicture={insertPicture} />
}

/** 功能區的一組：內容＋下方 11px 群組名稱，右側 1px 分隔（同 ppt） */
function RibbonGroup({ caption, children, className }: { caption: string; children: ReactNode; className?: string }) {
  return (
    <div className={`flex h-full shrink-0 flex-col border-r border-border px-2 ${className ?? ''}`}>
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

/** 下拉框（裝飾）：細框＋右側箭頭 */
function DropDecor({ text, className }: { text: string; className: string }) {
  return (
    <span className={`flex items-center justify-between rounded-[2px] border border-border px-1 text-[11px] leading-[18px] ${className}`}>
      <span className="truncate">{text}</span>
      <ChevronDownIcon size={10} />
    </span>
  )
}

/**
 * 「常用」：裝飾群組（剪貼簿、字型、對齊方式、數值）＋最右群組「插入圖片」＝我來畫。
 * 窄螢幕先藏裝飾群組（< 1024px 藏對齊方式與數值、< 768px 再藏字型），「插入圖片」一定看得到（不能少的操作，DESIGN §8）
 */
function HomeRibbon({ insertPicture }: { insertPicture: ReactNode }) {
  return (
    <div className="flex h-full items-stretch">
      <div aria-hidden="true" className="flex h-full items-stretch">
        <RibbonGroup caption="剪貼簿">
          <BigDecor icon={<PasteIcon size={24} />} label="貼上" />
          <span className="flex flex-col gap-1 text-fg">
            <CutIcon size={14} />
            <CopyIcon size={14} />
          </span>
        </RibbonGroup>
        <RibbonGroup caption="字型" className="max-md:hidden">
          <span className="flex flex-col gap-1 text-fg">
            <span className="flex gap-1">
              <DropDecor text="新細明體" className="w-[96px]" />
              <DropDecor text="12" className="w-[36px]" />
            </span>
            <span className="flex items-center gap-3 px-1 text-[12px] leading-[16px]">
              <span className="font-bold">B</span>
              <span className="italic">I</span>
              <span className="underline">U</span>
              <BordersIcon size={14} />
              <FillIcon size={14} />
              <span className="border-b-2 border-sem-error leading-[13px]">A</span>
            </span>
          </span>
        </RibbonGroup>
        <RibbonGroup caption="對齊方式" className="max-lg:hidden">
          <span className="flex flex-col gap-1 text-fg">
            <span className="flex items-center gap-2">
              <AlignLeftIcon size={14} />
              <AlignCenterIcon size={14} />
              <AlignRightIcon size={14} />
              <span className="flex items-center gap-1 text-[11px]">
                <WrapTextIcon size={14} />
                自動換行
              </span>
            </span>
            <span className="flex items-center gap-1 text-[11px]">
              <MergeCenterIcon size={14} />
              跨欄置中
            </span>
          </span>
        </RibbonGroup>
        <RibbonGroup caption="數值" className="max-lg:hidden">
          <span className="flex flex-col gap-1 text-fg">
            <DropDecor text="通用格式" className="w-[92px]" />
            <span className="flex items-center gap-3 px-1 text-[12px] leading-[16px]">
              <span>$</span>
              <span>%</span>
              <span>,</span>
              <span className="text-[11px]">.0</span>
              <span className="text-[11px]">.00</span>
            </span>
          </span>
        </RibbonGroup>
      </div>
      <RibbonGroup caption="圖片">
        <div className="flex h-full items-center text-[12px]">{insertPicture}</div>
      </RibbonGroup>
    </div>
  )
}

/** 「圖片格式」（關聯式分頁）：畫師作畫中放 toolbar 插槽（版面同 ppt「繪圖」分頁） */
function PictureFormatRibbon({ tools }: { tools: ReactNode }) {
  return (
    <RibbonGroup caption="畫筆">
      <div className="flex h-[30px] items-stretch">{tools}</div>
    </RibbonGroup>
  )
}

/** 「校閱」：註解群組（新增註解為裝飾、「顯示註解」開關窗格） */
function ReviewRibbon({ commentsToggle }: { commentsToggle: ReactNode }) {
  return (
    <div className="flex h-full items-stretch">
      <RibbonGroup caption="校訂">
        <span aria-hidden="true" className="flex items-center gap-1 text-[11px] text-fg">
          <CheckIcon size={14} />
          拼字檢查
        </span>
      </RibbonGroup>
      <RibbonGroup caption="註解">
        <span aria-hidden="true" className="flex">
          <BigDecor icon={<NewCommentIcon size={24} />} label="新增註解" />
        </span>
        {commentsToggle}
      </RibbonGroup>
    </div>
  )
}

/**
 * 「顯示註解」：< 768px 開關註解窗格覆蓋層（真按鈕、aria-pressed）；≥ 768px 窗格固定顯示，只顯示按下狀態的裝飾（DESIGN §17.2）。
 * 兩種以 CSS 斷點切換（不用 JS 媒體查詢，靜態渲染也一致）
 */
function ShowCommentsToggle(props: { open: boolean; buttonRef: RefObject<HTMLButtonElement | null>; onToggle: () => void }) {
  const { open, buttonRef, onToggle } = props
  const body = (
    <>
      <ShowCommentsIcon size={24} />
      <span>{SHOW_COMMENTS_LABEL}</span>
    </>
  )
  const look = 'h-full flex-col items-center justify-center gap-[2px] rounded-[2px] px-2 text-[11px] leading-[14px] text-fg'
  return (
    <>
      <span aria-hidden="true" className={`flex ${look} bg-active max-md:hidden`}>
        {body}
      </span>
      <button
        ref={buttonRef}
        type="button"
        onClick={onToggle}
        aria-pressed={open}
        {...tip(open ? '隱藏註解窗格（聊天）' : '顯示註解窗格（聊天）', 'bottom')}
        className={`hidden ${look} cursor-pointer transition-colors duration-100 focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-border-focus max-md:flex ${
          open ? 'bg-active' : 'hover:bg-hover'
        }`}
      >
        {body}
      </button>
    </>
  )
}

/** 說明主題的 Office 風格線條圖示（16px；一主題一個，同 ppt） */
const HELP_TOPIC_ICONS: Record<HelpTopicId, ComponentType<{ size?: number }>> = {
  'be-drawer': PenIcon,
  guess: QuestionBubbleIcon,
  'switch-theme': SwitchThemeIcon,
  tools: PaletteIcon,
  image: PictureIcon,
  reconnect: RefreshIcon,
}

/** 「說明」（DESIGN §17.2、§16）：一排說明主題按鈕（16px 圖示＋標籤），點了直接開該主題的說明（對話框第二步） */
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

/** 「插入圖片」：可開局時放 volunteer 插槽；否則灰化（不可點），人數不足時旁邊說明（DESIGN §17.2） */
function InsertPicture({ phase, online, volunteer }: { phase: RoundPhase; online: number; volunteer: ReactNode }) {
  if (canVolunteer(phase, online)) return <div className="flex h-[30px] items-stretch">{volunteer}</div>
  return (
    <>
      <InsertPictureIdle />
      {phase === 'idle' && online < MIN_PLAYERS && <span className="truncate px-[5px] text-fg">{waitingForPlayers(online)}</span>}
    </>
  )
}

/** 灰化的「插入圖片」：與可點時的 volunteer 插槽同一組文字與圖示（EXCEL_VOLUNTEER_VIEW） */
function InsertPictureIdle() {
  const { label, icon: Icon } = EXCEL_VOLUNTEER_VIEW
  return (
    <span aria-hidden="true" className="flex h-[30px] shrink-0 items-center gap-1 px-[6px] text-fg opacity-40">
      {Icon !== undefined && <Icon size={14} />}
      {label}
    </span>
  )
}

// ─── 資料編輯列 ──────────────────────────────────────────────────

/** 26px：名稱方塊 96px（「圖片 1」／「A1」）、✕ ✓（灰）、fx、輸入框（唯讀）；整列裝飾 */
function FormulaBar({ pictureSelected }: { pictureSelected: boolean }) {
  return (
    <div aria-hidden="true" className="flex h-[26px] shrink-0 items-center gap-1 border-b border-border bg-activity px-1 text-fg">
      <span className="flex h-[20px] w-[96px] shrink-0 items-center justify-between rounded-[2px] border border-border bg-input px-[4px]">
        <span className="truncate">{nameBoxText(pictureSelected)}</span>
        <ChevronDownIcon size={12} />
      </span>
      <span className="flex shrink-0 items-center gap-2 px-2 text-fg-muted max-md:hidden">
        <EllipsisIcon size={14} />
        <CloseIcon size={14} />
        <CheckIcon size={14} />
      </span>
      <span className="shrink-0 px-1 text-fg-muted italic">fx</span>
      <span className="flex h-[20px] min-w-0 flex-1 items-center truncate rounded-[2px] border border-border bg-input px-[6px]">
        {formulaText(pictureSelected)}
      </span>
    </div>
  )
}

// ─── 工作表區 ────────────────────────────────────────────────────

/** 元素的內容寬高（ResizeObserver）；尚未掛載為 0 */
function useBoxSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const el = ref.current
    if (el === null) return
    const observer = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (r !== undefined) setSize((s) => (s.width === r.width && s.height === r.height ? s : { width: r.width, height: r.height }))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return size
}

/**
 * 工作表區：欄名列（20px）＋可垂直捲動的「列號欄＋格線＋人員表格」＋固定不捲的浮動「圖片 1」。
 * 格線用 CSS 畫（theme.css 的 sheet-grid／sheet-grid-rows），欄名與列號是真實元素，依工作表區寬高產生到填滿為止（DESIGN §17.2、決策 5）。
 * 圖片：≥ 1024px 從 E 欄左緣（32＋128＋64×3＝352px）、第 2 列上緣（40px）起，最大寬＝工作表區寬 − 352 − 48、最大高＝工作表區高 − 60；
 *   < 1024px 改放在人員表格下方（第 n＋3 列起、A 欄左緣），寬＝工作表區寬 − 48。圖片內 16:9 畫布靠左上（size container）。
 */
function Sheet(props: { players: ReactNode; tableRows: number; picture: ReactNode; pictureSelected: boolean; children?: ReactNode }) {
  const { players, tableRows, picture, pictureSelected, children } = props
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { width } = useBoxSize(rootRef)
  const { height } = useBoxSize(scrollRef)
  const cols = columnsToFill(width)
  const rows = rowsToFill(height, tableRows)
  // 窄版圖片的上緣：欄名列＋表頭＋每位玩家＋一列空白
  const pictureTop = HEADER_HEIGHT + (tableRows + 2) * ROW_HEIGHT
  return (
    <main ref={rootRef} aria-label="工作表" className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-editor">
      <ColumnHeaders count={cols} />
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="flex">
          <RowHeaders count={rows} />
          <div className="relative flex min-w-0 flex-1">
            <div aria-hidden="true" className="sheet-grid-rows w-[128px] shrink-0 border-r border-grid-line" />
            <div aria-hidden="true" className="sheet-grid min-w-0 flex-1" />
            <div className="absolute top-0 left-0">{players}</div>
          </div>
        </div>
      </div>
      {picture !== null && (
        <div
          style={{ '--picture-top': `${pictureTop}px` } as CSSProperties}
          className="absolute top-[40px] left-[352px] h-[calc(100%-60px)] w-[calc(100%-400px)] [container-type:size] max-lg:top-[var(--picture-top)] max-lg:left-[32px] max-lg:h-[calc(100%-var(--picture-top)-20px)] max-lg:w-[calc(100%-48px)]"
        >
          <div className="relative w-fit">
            {picture}
            {pictureSelected && <SelectionHandles />}
          </div>
        </div>
      )}
      {children}
    </main>
  )
}

/** 欄名列：左上角落（32px）＋ A（128px）、B、C…（64px），底 --bg-sidebar、字 --fg-muted 12px 置中 */
function ColumnHeaders({ count }: { count: number }) {
  return (
    <div aria-hidden="true" className="flex h-[20px] shrink-0 overflow-hidden border-b border-border bg-sidebar text-[12px] leading-[19px] text-fg-muted">
      <span className="w-[32px] shrink-0 border-r border-border" />
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={`${i === 0 ? 'w-[128px]' : 'w-[64px]'} shrink-0 border-r border-grid-line text-center`}>
          {columnName(i)}
        </span>
      ))}
    </div>
  )
}

/** 列號欄：32px，1、2、3…（每列 20px），跟著表格捲動 */
function RowHeaders({ count }: { count: number }) {
  return (
    <div aria-hidden="true" className="w-[32px] shrink-0 border-r border-border bg-sidebar text-[12px] leading-[19px] text-fg-muted">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="block h-[20px] border-b border-grid-line text-center tabular-nums">
          {i + 1}
        </span>
      ))}
    </div>
  )
}

/** 圖片被選取時的 8 個 7px 圓形控點（白底 1px --border-focus），中心落在圖片外框上；不攔指標事件（畫布邊緣照樣可畫） */
function SelectionHandles() {
  const spots = [
    'top-0 left-0',
    'top-0 left-1/2',
    'top-0 left-full',
    'top-1/2 left-0',
    'top-1/2 left-full',
    'top-full left-0',
    'top-full left-1/2',
    'top-full left-full',
  ]
  return (
    <span aria-hidden="true" data-picture-handles="" className="pointer-events-none absolute inset-0">
      {spots.map((spot) => (
        <span
          key={spot}
          className={`absolute ${spot} block h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-border-focus bg-input`}
        />
      ))}
    </span>
  )
}

/** 自動重連畫面的工作表：只有表頭列（還沒有玩家） */
function EmptySheetHeader() {
  return (
    <div aria-hidden="true" className="flex text-[13px] text-fg">
      {SHEET_HEADERS.map((header, i) => (
        <span
          key={header}
          className={`h-[20px] shrink-0 border-r border-b border-grid-line border-b-border bg-sidebar px-[4px] leading-[19px] font-bold ${
            i === 0 ? 'w-[128px]' : 'w-[64px]'
          } ${i === 1 ? 'text-right' : ''}`}
        >
          {header}
        </span>
      ))}
    </div>
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
      <span>這本活頁簿還沒有任何註解</span>
    </div>
  )
}

// ─── 工作表分頁列、狀態列 ─────────────────────────────────────────

/** 24px：捲動箭頭、「工作表1」（作用：底白、下緣 2px --accent、字 --accent 粗體）、「工作表2」「工作表3」、「＋」；純裝飾 */
function SheetTabs() {
  return (
    <div aria-hidden="true" className="flex h-[24px] shrink-0 items-stretch overflow-hidden border-t border-border bg-sidebar text-[12px] whitespace-nowrap text-fg">
      <span className="flex shrink-0 items-center gap-1 px-2 text-fg-muted">
        <ChevronLeftIcon size={12} />
        <ChevronRightIcon size={12} />
      </span>
      {SHEET_TABS.map((name, i) => (
        <span
          key={name}
          className={`flex shrink-0 items-center border-r border-border px-3 ${i === 0 ? 'border-b-2 border-b-accent bg-tab-active font-bold text-accent' : ''}`}
        >
          {name}
        </span>
      ))}
      <span className="flex shrink-0 items-center px-2" {...tip('新增工作表', 'top')}>
        <PlusIcon size={14} />
      </span>
    </div>
  )
}

/** 22px：左「就緒」＋回合狀態；右「平均值: —」「計數: N」「加總: —」、顯示設定、縮放 100%（計數以外為裝飾） */
function StatusBar({ status, online }: { status: ReactNode; online: number }) {
  return (
    <footer
      aria-label="狀態列"
      className="flex h-[22px] shrink-0 items-center overflow-hidden border-t border-border bg-statusbar text-[12px] whitespace-nowrap text-fg"
    >
      <div className="flex h-full min-w-0 flex-1 items-center">
        <span aria-hidden="true" className="shrink-0 pr-1 pl-3">
          {READY_LABEL}
        </span>
        {status}
      </div>
      <div className="flex h-full shrink-0 items-center gap-1 px-2">
        <span aria-hidden="true" className="px-1 max-lg:hidden">
          平均值: —
        </span>
        <span {...tip('在線人數', 'top')} className="px-1 tabular-nums">
          {countText(online)}
        </span>
        <span aria-hidden="true" className="px-1 max-lg:hidden">
          加總: —
        </span>
        <span aria-hidden="true" className="flex items-center gap-2 px-1 max-md:hidden" {...tip('顯示設定', 'top')}>
          <NormalViewIcon size={14} />
          <PageLayoutIcon size={14} />
          <PageBreakIcon size={14} />
        </span>
        <span aria-hidden="true" className="flex items-center gap-1 px-1 max-lg:hidden">
          <span>−</span>
          <span className="relative block h-px w-[80px] bg-fg-muted">
            <span className="absolute top-[-4px] left-1/2 block h-[9px] w-[3px] bg-fg" />
          </span>
          <span>+</span>
        </span>
        <span aria-hidden="true" className="px-1 tabular-nums max-md:hidden">
          100%
        </span>
      </div>
    </footer>
  )
}
