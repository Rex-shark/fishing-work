// meet 主題：視訊會議偽裝殼層（DESIGN.md §15；plan/meet-theme.md「版面對照」；architecture §7）。整個畫面像一場「有人正在分享畫面」的通話：
//   舞台（左）：主畫面 tile（canvas 插槽，圓角 8px；左上標籤「<畫師> 正在分享畫面」／「尚無人分享畫面」；自己是畫師時 2px --border-focus 外框）
//     ＋主畫面上方浮動深色膠囊（toolbar 插槽，只有畫師作畫中出現）＋主畫面下方字幕列（roundStatus 插槽）；對話框置中於主畫面 tile
//   ｜右側影片條（players 插槽 → ParticipantTiles）｜右側白色面板「通話中的訊息」（chat 插槽，容器帶 data-chat-drop-zone）
//   ｜底部控制列：左 HH:mm｜會議代碼＋connection 插槽；中 麥克風、攝影機、字幕、分享畫面（volunteer 插槽）、舉手、更多、離開（紅色膠囊）；
//     右 資訊、使用者(N)（counts.online）、訊息（切換右側面板）、活動。除「分享畫面」「更多」「訊息」「資訊」外皆為裝飾（plan 決策 6）。
//   「資訊」（Epic 6，DESIGN §15.2、§16）：遊戲中＝開啟遊戲說明清單（ShellProps.help.open()，工具提示「說明」）；自動重連畫面為裝飾。
//   「更多 ⋮」選單第二項「說明…」也開說明清單（決策 8：< 768px「資訊」隱藏時的入口）。
//   「更多 ⋮」→ 選單「切換偽裝…」→ 置中於主畫面的白卡片對話框（MeetMoreMenu；資料為 props.themes）。
//   響應式（DESIGN §15.3、meetLayout.MEET_BREAKPOINTS）：< 1280px 影片條 160px；< 1024px 影片條改到主畫面下方橫向列（tile 120px）；
//   < 768px 右側面板改為覆蓋層（「訊息」開關、預設開、Esc 關閉）。
//   自動重連（screen 'resume'）：同一殼層、空的主畫面＋置中白卡片一行「正在重新加入通話…」（MeetResumeCard）。
// 畫師時控制列不變色（§15.3）；畫師身分靠主畫面標籤、tile 外框與浮動工具列。
// 功能元件的呈現（對話框、參加者 tile、聊天、控制列按鈕、工具列斷點、「分享畫面」）由 meetViews 以 ShellViewsContext 提供。
// 殼層不 import uiStore／catalog（踩雷紀錄 Epic 3 Phase 2）；主題資料經 ShellProps.themes、說明入口經 ShellProps.help。不讀 store/game：人數經 counts、畫師暱稱經 round.drawerName。
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { MIN_PLAYERS, type RoundPhase } from '@fishing-work/shared'
import { canVolunteer } from '../../features/round/roundDisplay'
import { tip } from '../../layout/tooltipPlacement'
import type { ShellGameSlots, ShellHelp, ShellPlayerCounts, ShellProps, ShellRoundState, ShellThemeSwitch } from '../types'
import { ShellViewsContext } from '../views'
import { MeetResumeCard } from './MeetDialog'
import {
  ActivitiesIcon,
  CallEndIcon,
  CameraOffIcon,
  CaptionsIcon,
  ChatBubbleIcon,
  CloseIcon,
  HandIcon,
  InfoIcon,
  MicOffIcon,
  MoreVertIcon,
  PeopleIcon,
  ShareScreenIcon,
} from './meetIcons'
import {
  CHAT_PANEL_TITLE,
  HELP_BUTTON_LABEL,
  MEET_CODE,
  MORE_MENU_LABEL,
  PANEL_OVERLAY_QUERY,
  clockText,
  participantCount,
  presenterLabel,
  waitingForPlayers,
} from './meetLayout'
import { MeetThemeDialog, MoreButton } from './MeetMoreMenu'
import { MEET_VIEWS } from './meetViews'

export function MeetShell(props: ShellProps) {
  return (
    <ShellViewsContext.Provider value={MEET_VIEWS}>
      {props.screen === 'game' ? (
        <GameScreen {...props} />
      ) : (
        <MeetFrame
          drawerName={null}
          highlight={false}
          stage={null}
          overlay={<MeetResumeCard />}
          players={null}
          chat={<NoMessages />}
          connection={props.connection}
          share={<ShareControl phase="idle" online={0} volunteer={null} showWaiting={false} />}
          online={0}
        />
      )}
    </ShellViewsContext.Provider>
  )
}

function GameScreen(props: { round: ShellRoundState; counts: ShellPlayerCounts; themes: ShellThemeSwitch; help: ShellHelp } & ShellGameSlots) {
  const { round, counts, themes, help, players, canvas, toolbar, chat, roundStatus, volunteer, connection, dialogs } = props
  const drawerActive = round.isDrawer && (round.phase === 'choosing' || round.phase === 'drawing')
  return (
    <MeetFrame
      drawerName={round.drawerName}
      highlight={drawerActive}
      stage={canvas}
      toolbar={round.canDraw ? toolbar : null}
      caption={roundStatus}
      overlay={dialogs}
      players={players}
      chat={chat}
      connection={connection}
      share={<ShareControl phase={round.phase} online={counts.online} volunteer={volunteer} showWaiting />}
      online={counts.online}
      themes={themes}
      help={help}
    />
  )
}

// ─── 外框 ───────────────────────────────────────────────────────

interface MeetFrameProps {
  /** 主畫面標籤的分享者（null＝尚無人分享） */
  drawerName: string | null
  /** 自己是畫師（出題、作畫中）：主畫面 tile 外框 */
  highlight: boolean
  /** 主畫面內容（canvas 插槽；父層為 size container） */
  stage: ReactNode
  /** 浮動工具列（畫師作畫中）；null／省略＝不顯示 */
  toolbar?: ReactNode
  /** 字幕列（回合狀態）；省略＝不顯示 */
  caption?: ReactNode
  /** 置中於主畫面的浮出物（對話框、自動重連卡片） */
  overlay?: ReactNode
  players: ReactNode
  chat: ReactNode
  connection: ReactNode
  share: ReactNode
  online: number
  /** 切換偽裝（遊戲中才有）；省略時「更多選項」為裝飾 */
  themes?: ShellThemeSwitch
  /** 遊戲說明（遊戲中才有）；省略時「資訊」為裝飾 */
  help?: ShellHelp
}

function MeetFrame(props: MeetFrameProps) {
  const { drawerName, highlight, stage, toolbar, caption, overlay, players, chat, connection, share, online, themes, help } = props
  /** 右側「通話中的訊息」面板（預設開；關閉時保持掛載，輸入草稿不丟；< 768px 為覆蓋層） */
  const [chatOpen, setChatOpen] = useState(true)
  /** 「切換偽裝」對話框；關閉時焦點還給「更多選項」 */
  const [themePickOpen, setThemePickOpen] = useState(false)
  const moreRef = useRef<HTMLButtonElement>(null)
  const chatToggleRef = useRef<HTMLButtonElement>(null)

  function closeChat() {
    setChatOpen(false)
    chatToggleRef.current?.focus()
  }

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-editor font-mono text-[13px] text-fg">
      <div className="relative flex min-h-0 flex-1">
        {/* 舞台＋影片條：≥ 1024px 影片條在主畫面右側（直向，< 1280px 160px）；< 1024px 改到主畫面下方橫向列 */}
        <div className="flex min-h-0 min-w-0 flex-1 max-lg:flex-col">
          <main aria-label="會議畫面" className="flex min-h-0 min-w-0 flex-1 p-[16px] pr-[8px] max-lg:pr-[16px] max-lg:pb-[8px]">
            <div
              className={`relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-[8px] bg-tab-active ${
                highlight ? 'outline-2 -outline-offset-2 outline-border-focus' : ''
              }`}
            >
              {/* size container：畫布依剩餘寬高等比縮放 16:9；上方留給標籤與浮動工具列、下方留給字幕列（不蓋住畫布） */}
              <div className="absolute inset-x-[16px] top-[64px] bottom-[56px] flex items-center justify-center [container-type:size]">{stage}</div>
              <div className="absolute inset-x-[12px] top-[12px] flex h-[44px] items-center gap-[12px]">
                {/* 畫師作畫中：上方整列給浮動工具列（完整工具列約 576px，與標籤並排會被裁掉）；標籤只給其他人看（決策 13(3)） */}
                {toolbar !== null && toolbar !== undefined ? (
                  <div className="mx-auto flex h-[44px] min-w-0 items-center overflow-x-auto rounded-[22px] bg-tab-active px-[12px] shadow-quickinput">
                    {toolbar}
                  </div>
                ) : (
                  <PresenterLabel drawerName={drawerName} />
                )}
              </div>
              {caption !== undefined && (
                <div className="absolute bottom-[12px] left-1/2 flex h-[36px] max-w-[min(720px,calc(100%-24px))] -translate-x-1/2 items-center overflow-hidden rounded-[8px] bg-tab-active/90 px-[12px] text-[14px] whitespace-nowrap text-fg">
                  {caption}
                </div>
              )}
              {overlay}
              {themes !== undefined && themePickOpen && (
                <MeetThemeDialog
                  themes={themes}
                  onClose={() => {
                    setThemePickOpen(false)
                    moreRef.current?.focus()
                  }}
                />
              )}
            </div>
          </main>

          <aside
            aria-label="參加者"
            className="w-[200px] shrink-0 overflow-y-auto px-[8px] py-[16px] max-xl:w-[160px] max-lg:w-auto max-lg:overflow-x-auto max-lg:overflow-y-hidden max-lg:px-[16px] max-lg:pt-0"
          >
            {players}
          </aside>
        </div>

        <section
          aria-label={CHAT_PANEL_TITLE}
          data-chat-drop-zone=""
          onKeyDown={(e) => {
            // 覆蓋層（< 768px）：Esc 關閉並把焦點還給「訊息」
            if (e.key === 'Escape' && !e.nativeEvent.isComposing && window.matchMedia(PANEL_OVERLAY_QUERY).matches) {
              e.preventDefault()
              closeChat()
            }
          }}
          className={`relative my-[16px] mr-[16px] ml-[8px] w-[360px] shrink-0 flex-col overflow-hidden rounded-[8px] bg-panel text-fg-on-panel max-md:absolute max-md:top-[16px] max-md:right-[16px] max-md:bottom-[16px] max-md:z-30 max-md:m-0 max-md:w-[min(360px,calc(100%-32px))] max-md:shadow-quickinput ${
            chatOpen ? 'flex' : 'hidden'
          }`}
        >
          <div className="flex h-[48px] shrink-0 items-center justify-between pr-[8px] pl-[20px]">
            <h2 className="truncate text-[16px] font-normal text-fg-on-panel">{CHAT_PANEL_TITLE}</h2>
            <button
              type="button"
              onClick={closeChat}
              aria-label="關閉通話中的訊息"
              {...tip('關閉', 'top')}
              className="flex h-[36px] w-[36px] cursor-pointer items-center justify-center rounded-full text-fg-on-panel transition-colors duration-100 hover:bg-panel-hover focus-visible:outline-2 focus-visible:outline-accent-panel"
            >
              <CloseIcon size={20} />
            </button>
          </div>
          <div className="min-h-0 flex-1">{chat}</div>
        </section>
      </div>

      <ControlBar
        connection={connection}
        share={share}
        online={online}
        chatOpen={chatOpen}
        chatToggleRef={chatToggleRef}
        onToggleChat={() => setChatOpen((v) => !v)}
        info={
          help !== undefined ? (
            <HelpButton onOpen={() => help.open()} />
          ) : (
            <IconDecor label="會議詳細資料" className="max-md:hidden">
              <InfoIcon size={20} />
            </IconDecor>
          )
        }
        more={
          themes !== undefined ? (
            <MoreButton
              buttonRef={moreRef}
              onSwitchTheme={() => setThemePickOpen(true)}
              onHelp={help !== undefined ? () => help.open() : undefined}
            />
          ) : (
            <RoundDecor label={MORE_MENU_LABEL}>
              <MoreVertIcon size={20} />
            </RoundDecor>
          )
        }
      />
    </div>
  )
}

/** 主畫面左上標籤：白字半透明深底膠囊（DESIGN §15.2） */
function PresenterLabel({ drawerName }: { drawerName: string | null }) {
  return (
    <span className="flex h-[28px] max-w-[45%] min-w-0 shrink-0 items-center gap-[6px] rounded-full bg-editor/70 px-[12px] text-[12px] text-fg">
      {drawerName !== null && <ShareScreenIcon size={14} />}
      <span className="truncate">{presenterLabel(drawerName)}</span>
    </span>
  )
}

/** 自動重連畫面的訊息面板（空） */
function NoMessages() {
  return (
    <div aria-hidden="true" className="flex h-full items-start justify-center px-[20px] pt-[8px] text-center text-[12px] leading-[16px] text-fg-on-panel-muted">
      通話中的參與者才看得到這些訊息
    </div>
  )
}

// ─── 底部控制列 ──────────────────────────────────────────────────

/** 目前時間 `HH:mm`（每到整分鐘更新） */
function useClock(): string {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer = 0
    const schedule = () => {
      const d = new Date()
      timer = window.setTimeout(
        () => {
          setNow(new Date())
          schedule()
        },
        60_000 - d.getSeconds() * 1000 - d.getMilliseconds() + 50,
      )
    }
    schedule()
    return () => window.clearTimeout(timer)
  }, [])
  return clockText(now)
}

function ControlBar(props: {
  connection: ReactNode
  share: ReactNode
  online: number
  chatOpen: boolean
  chatToggleRef: RefObject<HTMLButtonElement | null>
  onToggleChat: () => void
  /** 「更多選項」（遊戲中為選單按鈕，自動重連畫面為裝飾） */
  more: ReactNode
  /** 右側「資訊」（遊戲中為說明按鈕，自動重連畫面為裝飾） */
  info: ReactNode
}) {
  const { connection, share, online, chatOpen, chatToggleRef, onToggleChat, more, info } = props
  const clock = useClock()
  const people = participantCount(online)
  return (
    <footer aria-label="會議控制項" className="grid h-[80px] shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-[16px] bg-activity px-[16px]">
      <div className="flex min-w-0 items-center gap-[12px] text-[14px]">
        <span aria-hidden="true" className="shrink-0 text-fg tabular-nums">
          {clock}
        </span>
        <span aria-hidden="true" className="text-fg-dim max-lg:hidden">
          |
        </span>
        <span aria-hidden="true" className="min-w-0 truncate text-fg-dim max-lg:hidden">
          {MEET_CODE}
        </span>
        <span className="flex h-[24px] shrink-0 items-center text-[12px] text-fg-muted">{connection}</span>
      </div>

      <div className="flex items-center gap-[8px]">
        <RoundDecor label="開啟麥克風">
          <MicOffIcon size={20} />
        </RoundDecor>
        <RoundDecor label="開啟攝影機">
          <CameraOffIcon size={20} />
        </RoundDecor>
        <RoundDecor label="開啟字幕" className="max-md:hidden">
          <CaptionsIcon size={20} />
        </RoundDecor>
        {share}
        <RoundDecor label="舉手" className="max-md:hidden">
          <HandIcon size={20} />
        </RoundDecor>
        {more}
        <span
          aria-hidden="true"
          {...tip('離開通話', 'top')}
          className="flex h-[40px] w-[56px] shrink-0 items-center justify-center rounded-full bg-sem-error text-fg"
        >
          <CallEndIcon size={20} />
        </span>
      </div>

      <div className="flex min-w-0 items-center justify-end gap-[4px]">
        {info}
        <span
          role="img"
          aria-label={`使用者 ${people} 人`}
          {...tip(`使用者（${people}）`, 'top')}
          className="relative flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full text-fg max-md:hidden"
        >
          <PeopleIcon size={20} />
          <span className="absolute top-[4px] right-[2px] min-w-[16px] rounded-full bg-button-secondary px-[4px] text-center text-[11px] leading-[16px] text-fg tabular-nums">
            {people}
          </span>
        </span>
        <button
          ref={chatToggleRef}
          type="button"
          onClick={onToggleChat}
          aria-label="通話中的訊息"
          aria-pressed={chatOpen}
          {...tip(chatOpen ? '隱藏通話中的訊息' : '顯示通話中的訊息', 'top')}
          className={`flex h-[40px] w-[40px] shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-100 hover:bg-hover focus-visible:outline-2 focus-visible:outline-border-focus ${
            chatOpen ? 'text-accent' : 'text-fg'
          }`}
        >
          <ChatBubbleIcon size={20} />
        </button>
        <IconDecor label="活動" className="max-md:hidden">
          <ActivitiesIcon size={20} />
        </IconDecor>
      </div>
    </footer>
  )
}

/** 控制列右側「資訊」＝遊戲說明（Epic 6）：外觀同裝飾圖示（無底色、hover --bg-hover），點了開說明清單；工具提示「說明」 */
export function HelpButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={HELP_BUTTON_LABEL}
      {...tip(HELP_BUTTON_LABEL, 'top')}
      className="flex h-[40px] w-[40px] shrink-0 cursor-pointer items-center justify-center rounded-full text-fg transition-colors duration-100 hover:bg-hover focus-visible:outline-2 focus-visible:outline-border-focus max-md:hidden"
    >
      <InfoIcon size={20} />
    </button>
  )
}

/** 控制列中央的裝飾圓形按鈕（40px、底 --bg-button-secondary）；點了無作用，有工具提示 */
function RoundDecor({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      {...tip(label, 'top')}
      className={`flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full bg-button-secondary text-fg transition-colors duration-100 hover:bg-button-secondary-hover ${className ?? ''}`}
    >
      {children}
    </span>
  )
}

/** 控制列右側的裝飾圖示（無底色，hover --bg-hover） */
function IconDecor({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      {...tip(label, 'top')}
      className={`flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full text-fg transition-colors duration-100 hover:bg-hover ${className ?? ''}`}
    >
      {children}
    </span>
  )
}

/**
 * 「分享畫面」＝我來畫（DESIGN §15.2）：可開局時放 volunteer 插槽（StatusButton，外觀由 MEET_STATUS_VIEW 給；可見文字收成 sr-only、
 * 圖示放大到 20px、錯誤提示浮在按鈕上方）；否則同樣的圓形按鈕灰化（opacity .5、不可點），人數不足時上方 12px 小字說明。
 */
function ShareControl(props: { phase: RoundPhase; online: number; volunteer: ReactNode; showWaiting: boolean }) {
  const { phase, online, volunteer, showWaiting } = props
  if (canVolunteer(phase, online)) {
    return (
      <div className="relative flex h-[40px] w-[40px] shrink-0 [&>[role=alert]]:absolute [&>[role=alert]]:bottom-[calc(100%+4px)] [&>[role=alert]]:left-1/2 [&>[role=alert]]:h-auto [&>[role=alert]]:-translate-x-1/2 [&>[role=alert]]:text-[12px] [&>[role=alert]]:whitespace-nowrap [&>button]:h-[40px] [&>button>span]:sr-only [&>button>svg]:size-[20px]">
        {volunteer}
      </div>
    )
  }
  const waiting = showWaiting && phase === 'idle' && online < MIN_PLAYERS
  return (
    <div className="relative flex h-[40px] w-[40px] shrink-0">
      {waiting && (
        <span className="absolute bottom-[calc(100%+4px)] left-1/2 -translate-x-1/2 text-[12px] leading-[16px] whitespace-nowrap text-fg">
          {waitingForPlayers(online)}
        </span>
      )}
      <span
        aria-hidden="true"
        {...tip(phase === 'idle' ? '分享畫面（等待其他玩家加入）' : '分享畫面（回合進行中）', 'top')}
        className="flex h-[40px] w-[40px] items-center justify-center rounded-full bg-button-secondary text-fg opacity-50"
      >
        <ShareScreenIcon size={20} />
      </span>
    </div>
  )
}
