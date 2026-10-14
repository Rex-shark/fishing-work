// 畫面三分支（plan/home-page.md 決策 4；architecture §7；判定為純函式 pickScreen）：
//   已加入 → 目前殼層（uiStore.shellId）的遊戲畫面，把功能元件放進插槽（themes＝切換偽裝入口的資料；counts＝在線／玩家數；
//   round＝殼層需要的回合狀態（出題者、能否作畫、是否顯示自己的畫布、已交卷、是否顯示揭曉畫廊）；help＝遊戲說明入口（features/help）；
//   history＝比賽歷史的清單、開著的那一筆與開關（features/history，Epic 17；只存在這台瀏覽器）；殼層不讀 store）；
//   未加入但有重連憑證（resuming）→ 殼層的自動重連畫面（空白畫面＋「正在重新加入…」），遊戲中重新整理不閃首頁；
//   其餘 → 首頁（home/HomeScreen，不偽裝）。
// 文件層級（<html data-theme>、document.title、favicon）依畫面同步：首頁為 HOME_DOCUMENT，殼層為該主題（shells/document.ts）。
// 自動交卷（features/round/autoSubmit）與比賽歷史的紀錄（features/history/historyStore）在 App 掛載時啟動。
// 色彩一律用 theme.css 的 token class（DESIGN.md §3、§10），不得寫色碼
import { useEffect, useLayoutEffect, useMemo } from 'react'
import { Canvas } from './features/canvas/Canvas'
import { FinishButton, ToolBar } from './features/canvas/ToolBar'
import { ChatPanel } from './features/chat/ChatPanel'
import { HelpDialog } from './features/help/HelpDialog'
import { openHelp } from './features/help/helpOpen'
import { HistoryStatus, HistoryView } from './features/history/HistoryView'
import { canViewHistory, historyMenuEntries } from './features/history/historyDisplay'
import { closeHistory, openHistory, refreshHistory, startHistory, useHistoryStore } from './features/history/historyStore'
import { PlayerList } from './features/players/PlayerList'
import { startAutoSubmit } from './features/round/autoSubmit'
import { Reveal } from './features/reveal/Reveal'
import { RoundStatus, VolunteerStatus } from './features/round/RoundStatus'
import { countConnected } from './features/round/roundDisplay'
import { SubmitConfirmDialog } from './features/round/SubmitConfirmDialog'
import { TopicDialog } from './features/round/TopicDialog'
import { HomeScreen } from './home/HomeScreen'
import { ConnectionStatus } from './layout/ConnectionStatus'
import { TooltipLayer } from './layout/Tooltip'
import { useUiStore } from './layout/uiStore'
import { pickScreen } from './pickScreen'
import { getShell, type ShellHelp, type ShellHistory, type ShellThemeSwitch } from './shells'
import { THEME_CATALOG } from './shells/catalog'
import { HOME_DOCUMENT, applyDocumentTheme } from './shells/document'
import { connect } from './socket/client'
import { selectCanDraw, selectIsSetter, selectShowCanvas, selectShowReveal, useGameStore } from './store/game'

/** 自動重連畫面的提示（ShellProps screen 'resume' 的 notice） */
const RESUME_NOTICE = '正在重新加入…'

/** 遊戲說明的入口（Epic 6 決策 3）：殼層呼叫 open，開關在 uiStore.helpTopic（殼層不 import uiStore） */
const HELP: ShellHelp = { open: openHelp }

function App() {
  const joined = useGameStore((s) => s.me !== null)
  const resuming = useGameStore((s) => s.resuming)
  const phase = useGameStore((s) => s.round.phase)
  const isSetter = useGameStore(selectIsSetter)
  const canDraw = useGameStore(selectCanDraw)
  const showCanvas = useGameStore(selectShowCanvas)
  const showReveal = useGameStore(selectShowReveal)
  const submitted = useGameStore((s) => s.submitted)
  // 殼層的人數計數（ShellProps.counts）：selector 只回傳數字（回傳新陣列會無限重繪）
  const online = useGameStore((s) => countConnected(s.players))
  const total = useGameStore((s) => s.players.length)
  const counts = useMemo(() => ({ online, total }), [online, total])
  const shellId = useUiStore((s) => s.shellId)
  const setShellId = useUiStore((s) => s.setShellId)
  const shell = getShell(shellId)
  // 遊戲中的「切換偽裝…」入口（決策 7）：與首頁風格卡片同一份 catalog；殼層只負責呈現
  const themes = useMemo<ShellThemeSwitch>(() => ({ current: shellId, options: THEME_CATALOG, select: setShellId }), [shellId, setShellId])
  // 比賽歷史（Epic 17）：清單與開著的那一筆在 historyStore；可開的時機（idle／ended／choosing 非出題者）由 historyDisplay 判斷，殼層只負責呈現
  const historyRecords = useHistoryStore((s) => s.entries)
  const historyOpenId = useHistoryStore((s) => s.open?.record.id ?? null)
  const canOpenHistory = canViewHistory({ joined, phase, isSetter })
  const history = useMemo<ShellHistory>(
    () => ({
      entries: historyMenuEntries(historyRecords),
      openId: historyOpenId,
      canOpen: canOpenHistory,
      open: openHistory,
      close: closeHistory,
      refresh: () => void refreshHistory(),
    }),
    [historyRecords, historyOpenId, canOpenHistory],
  )
  const screen = pickScreen({ joined, resuming })
  // 未加入時標題視為 idle（離開遊戲畫面時還原）
  const titlePhase = joined ? phase : 'idle'

  useEffect(() => {
    connect()
  }, [])

  // 自動交卷：endsAt 到時若自己是參賽者且未交卷，匯出 PNG 交卷（含空白畫布）
  useEffect(() => startAutoSubmit(), [])

  // 比賽歷史：揭曉後把這回合存進瀏覽器、之後補上晚到的圖與評語；不能看歷史的時機把開著的關掉
  useEffect(() => startHistory(), [])

  useLayoutEffect(() => {
    applyDocumentTheme(document, screen === 'home' ? HOME_DOCUMENT : shell, { phase: titlePhase })
  }, [screen, shell, titlePhase])

  const { Shell } = shell
  // key：自動重連與遊戲畫面各自掛載（切換時殼層的版面狀態重設）
  return (
    <>
      {screen === 'game' ? (
        <Shell
          key="game"
          screen="game"
          round={{ phase, isSetter, canDraw, showCanvas, submitted, showReveal }}
          counts={counts}
          themes={themes}
          help={HELP}
          history={history}
          players={<PlayerList />}
          canvas={<Canvas />}
          toolbar={<ToolBar />}
          finish={<FinishButton />}
          reveal={<Reveal />}
          historyView={<HistoryView />}
          historyStatus={<HistoryStatus />}
          chat={<ChatPanel />}
          roundStatus={<RoundStatus />}
          volunteer={<VolunteerStatus />}
          connection={<ConnectionStatus />}
          dialogs={
            <>
              {/* 說明放最前：出題與它同時出現時疊在上面（同 z 層後渲染者在上） */}
              <HelpDialog />
              <TopicDialog />
              <SubmitConfirmDialog />
            </>
          }
        />
      ) : screen === 'resume' ? (
        <Shell key="resume" screen="resume" notice={RESUME_NOTICE} connection={<ConnectionStatus />} />
      ) : (
        <HomeScreen />
      )}
      {/* 工具提示浮層全域只掛一個（事件委派處理所有 data-tooltip 元素；DESIGN §6）；首頁沒有 data-tooltip 元素 */}
      <TooltipLayer />
    </>
  )
}

export default App
