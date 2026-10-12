// meet 主題：視訊會議偽裝殼層（DESIGN.md §15；spec/song-guess/design.md；architecture §7）。整個畫面像一場「有人正在分享音訊」的通話：
//   舞台（左）：主畫面 tile（stage 插槽，圓角 8px；左上標籤「<出題者> 正在分享音訊」／「第 n / N 首」／「上一局」）
//     ＋主畫面下方字幕列（roundStatus 插槽）；對話框置中於主畫面 tile
//   ｜右側影片條（players 插槽 → ParticipantTiles）｜右側白色面板「通話中的訊息」（chat 插槽）
//   ｜底部控制列：左 HH:mm｜會議代碼＋connection 插槽；中 音量（volume 插槽）、麥克風、攝影機、字幕、分享音訊（volunteer 插槽）、舉手、更多、離開（紅色膠囊）；
//     右 資訊、使用者(N)（counts.online）、訊息（切換右側面板）、活動。除「音量」「分享音訊」「更多」「訊息」「資訊」外皆為裝飾。
//   「資訊」（DESIGN §15.2、§16）：遊戲中＝開啟遊戲說明清單（ShellProps.help.open()，工具提示「說明」）；自動重連畫面為裝飾。
//   「更多 ⋮」選單第二項「說明…」也開說明清單（< 768px「資訊」隱藏時的入口）。
//   「更多 ⋮」→ 選單「切換偽裝…」→ 置中於主畫面的白卡片對話框（MeetMoreMenu；資料為 props.themes）。
//   響應式（DESIGN §15.3、meetLayout.MEET_BREAKPOINTS）：< 1280px 影片條 160px；< 1024px 影片條改到主畫面下方橫向列（tile 120px）；
//   < 768px 右側面板改為覆蓋層（「訊息」開關、預設開、Esc 關閉）。沒有工具列，所以沒有收合斷點（design §4）。
//   自動重連（screen 'resume'）：同一殼層、空的主畫面＋置中白卡片一行「正在重新加入通話…」（MeetResumeCard）。
// 功能元件的呈現（對話框、參加者 tile、舞台、音量、聊天、控制列按鈕、「分享音訊」）由 meetViews 以 ShellViewsContext 提供。
// 殼層不 import uiStore／catalog；主題資料經 ShellProps.themes、說明入口經 ShellProps.help。不讀 store/game：人數經 counts、局的狀態經 round。
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
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
  ShareAudioIcon,
} from './meetIcons'
import {
  CHAT_PANEL_TITLE,
  HELP_BUTTON_LABEL,
  MEET_CODE,
  MORE_MENU_LABEL,
  PANEL_OVERLAY_QUERY,
  clockText,
  participantCount,
  shareControlState,
  shareControlTip,
  stageLabel,
  waitingForPlayers,
  type ShareControlState,
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
          label={null}
          sharing={false}
          stage={null}
          overlay={<MeetResumeCard />}
          players={null}
          chat={<NoMessages />}
          connection={props.connection}
          volume={null}
          share={<ShareControl state="busy" online={0} volunteer={null} decorative />}
          online={0}
        />
      )}
    </ShellViewsContext.Provider>
  )
}

function GameScreen(props: { round: ShellRoundState; counts: ShellPlayerCounts; themes: ShellThemeSwitch; help: ShellHelp } & ShellGameSlots) {
  const { round, counts, themes, help, players, stage, chat, roundStatus, volunteer, volume, connection, dialogs } = props
  return (
    <MeetFrame
      label={stageLabel(round)}
      sharing={round.phase === 'playing'}
      stage={stage}
      caption={roundStatus}
      overlay={dialogs}
      players={players}
      chat={chat}
      connection={connection}
      volume={volume}
      share={<ShareControl state={shareControlState(round.phase, round.isSetter, counts.online)} online={counts.online} volunteer={volunteer} />}
      online={counts.online}
      themes={themes}
      help={help}
    />
  )
}

// ─── 外框 ───────────────────────────────────────────────────────

interface MeetFrameProps {
  /** 主畫面左上標籤（meetLayout.stageLabel）；null＝不顯示 */
  label: string | null
  /** 標籤前加喇叭圖示（播放中：有人正在分享音訊） */
  sharing: boolean
  /** 主畫面內容（stage 插槽：播放視覺、揭曉卡、排名表；置中，內容太高時自行捲動） */
  stage: ReactNode
  /** 字幕列（回合狀態）；省略＝不顯示 */
  caption?: ReactNode
  /** 置中於主畫面的浮出物（對話框、自動重連卡片） */
  overlay?: ReactNode
  players: ReactNode
  chat: ReactNode
  connection: ReactNode
  /** 音量（volume 插槽）；null＝不顯示（自動重連畫面） */
  volume: ReactNode
  share: ReactNode
  online: number
  /** 切換偽裝（遊戲中才有）；省略時「更多選項」為裝飾 */
  themes?: ShellThemeSwitch
  /** 遊戲說明（遊戲中才有）；省略時「資訊」為裝飾 */
  help?: ShellHelp
}

function MeetFrame(props: MeetFrameProps) {
  const { label, sharing, stage, caption, overlay, players, chat, connection, volume, share, online, themes, help } = props
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
            <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-[8px] bg-tab-active">
              {/* 舞台內容置中；上方留給標籤、下方留給字幕列（不蓋住內容）。揭曉卡與排名表太高時在自己的容器內捲動 */}
              <div data-stage-area="" className="absolute inset-x-[16px] top-[52px] bottom-[60px] flex items-center justify-center">
                {stage}
              </div>
              {label !== null && (
                <div className="absolute inset-x-[12px] top-[12px] flex h-[28px] items-center">
                  <StageLabel text={label} sharing={sharing} />
                </div>
              )}
              {caption !== undefined && (
                <div className="absolute bottom-[12px] left-1/2 flex h-[36px] max-w-[min(720px,calc(100%-24px))] -translate-x-1/2 items-center overflow-hidden rounded-[8px] bg-tab-active/90 px-[16px] text-[14px] whitespace-nowrap text-fg">
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
        volume={volume}
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

/** 主畫面左上標籤：白字半透明深底膠囊（DESIGN §15.2）；播放中前面加喇叭圖示 */
function StageLabel({ text, sharing }: { text: string; sharing: boolean }) {
  return (
    <span data-stage-label="" className="flex h-[28px] max-w-full min-w-0 items-center gap-[6px] rounded-full bg-editor/70 px-[12px] text-[12px] text-fg">
      {sharing && <ShareAudioIcon size={14} />}
      <span className="truncate">{text}</span>
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
  /** 音量（麥克風左側；design §1「音量」） */
  volume: ReactNode
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
  const { connection, volume, share, online, chatOpen, chatToggleRef, onToggleChat, more, info } = props
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
        {volume}
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

/** 控制列右側「資訊」＝遊戲說明：外觀同裝飾圖示（無底色、hover --bg-hover），點了開說明清單；工具提示「說明」 */
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
 * 「分享音訊」＝出題（design §2「控制列」欄）：
 *   ready：放 volunteer 插槽（StatusButton，外觀由 MEET_STATUS_VIEW 給；可見文字收成 sr-only、圖示放大到 20px、錯誤提示浮在按鈕上方）；
 *   active（自己正在出題）：同樣的圓形按鈕、圖示 --accent，不可點；
 *   waiting（人數不足）：灰化（opacity .5）＋上方 12px 小字「等待其他玩家加入（n/2）」；busy（局進行中）：灰化。
 * decorative：自動重連畫面，只是裝飾（不顯示小字）
 */
function ShareControl(props: { state: ShareControlState; online: number; volunteer: ReactNode; decorative?: boolean }) {
  const { state, online, volunteer, decorative = false } = props
  if (state === 'ready') {
    return (
      <div
        data-share-control="ready"
        className="relative flex h-[40px] w-[40px] shrink-0 [&>[role=alert]]:absolute [&>[role=alert]]:bottom-[calc(100%+4px)] [&>[role=alert]]:left-1/2 [&>[role=alert]]:h-auto [&>[role=alert]]:-translate-x-1/2 [&>[role=alert]]:text-[12px] [&>[role=alert]]:whitespace-nowrap [&>button]:h-[40px] [&>button>span]:sr-only [&>button>svg]:size-[20px]"
      >
        {volunteer}
      </div>
    )
  }
  return (
    <div data-share-control={state} className="relative flex h-[40px] w-[40px] shrink-0">
      {state === 'waiting' && !decorative && (
        <span className="absolute bottom-[calc(100%+4px)] left-1/2 -translate-x-1/2 text-[12px] leading-[16px] whitespace-nowrap text-fg">
          {waitingForPlayers(online)}
        </span>
      )}
      <span
        aria-hidden="true"
        {...tip(shareControlTip(state), 'top')}
        className={`flex h-[40px] w-[40px] items-center justify-center rounded-full bg-button-secondary ${state === 'active' ? 'text-accent' : 'text-fg opacity-50'}`}
      >
        <ShareAudioIcon size={20} />
      </span>
    </div>
  )
}
