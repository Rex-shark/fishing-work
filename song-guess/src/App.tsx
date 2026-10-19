// 畫面三分支（複製自我畫你猜；spec/song-guess/architecture.md §7；判定為純函式 pickScreen）：
//   已加入 → 目前殼層（uiStore.shellId）的遊戲畫面，把功能元件放進插槽（themes＝切換偽裝入口的資料；counts＝在線／玩家數；
//   round＝殼層需要的局狀態（出題者暱稱、第幾首、是否顯示上一局排名）；help＝遊戲說明入口（features/help）；殼層不讀 store）；
//   未加入但有重連憑證（resuming）→ 殼層的自動重連畫面（空白畫面＋「正在重新加入…」），遊戲中重新整理不閃首頁；
//   其餘 → 首頁（home/HomeScreen，不偽裝）。
// 文件層級（<html data-theme>、document.title、favicon）依畫面同步：首頁為 HOME_DOCUMENT，殼層為該主題（shells/document.ts）。
// 試聽播放器（features/player/AudioPlayer：隱藏的 <audio>）在遊戲畫面時掛在殼層之外：沒有畫面、不隨殼層重新掛載。
// 色彩一律用 theme.css 的 token class（DESIGN.md §3、§10），不得寫色碼
import { useEffect, useLayoutEffect, useMemo } from 'react'
import { ChatPanel } from './features/chat/ChatPanel'
import { HelpDialog } from './features/help/HelpDialog'
import { openHelp } from './features/help/helpOpen'
import { AudioPlayer } from './features/player/AudioPlayer'
import { VolumeControl } from './features/player/VolumeControl'
import { PlayerList } from './features/players/PlayerList'
import { showsLastResults } from './features/reveal/revealView'
import { SourceDialog } from './features/round/SourceDialog'
import { RoundStatus, VolunteerStatus } from './features/round/RoundStatus'
import { countConnected, setterNameOf } from './features/round/roundDisplay'
import { Stage } from './features/stage/Stage'
import { HomeScreen } from './home/HomeScreen'
import { ConnectionStatus } from './layout/ConnectionStatus'
import { TooltipLayer } from './layout/Tooltip'
import { useUiStore } from './layout/uiStore'
import { pickScreen } from './pickScreen'
import { getShell, type ShellHelp, type ShellRoundState, type ShellThemeSwitch } from './shells'
import { THEME_CATALOG } from './shells/catalog'
import { HOME_DOCUMENT, applyDocumentTheme } from './shells/document'
import { connect } from './socket/client'
import { selectIsSetter, useGameStore } from './store/game'

/** 自動重連畫面的提示（ShellProps screen 'resume' 的 notice） */
const RESUME_NOTICE = '正在重新加入…'

/** 遊戲說明的入口：殼層呼叫 open，開關在 uiStore.helpTopic（殼層不 import uiStore） */
const HELP: ShellHelp = { open: openHelp }

function App() {
  const joined = useGameStore((s) => s.me !== null)
  const resuming = useGameStore((s) => s.resuming)
  const phase = useGameStore((s) => s.round.phase)
  const isSetter = useGameStore(selectIsSetter)
  // 殼層需要的局狀態（ShellProps.round）：selector 各自回傳原始值（值相同不重繪；回傳新物件會無限重繪）
  const setterName = useGameStore((s) => setterNameOf(s.round, s.players))
  const songIndex = useGameStore((s) => s.round.song?.index ?? null)
  const songCount = useGameStore((s) => s.round.songCount)
  const showLastResults = useGameStore((s) => showsLastResults(s.round))
  const round = useMemo<ShellRoundState>(
    () => ({ phase, isSetter, setterName, songIndex, songCount, showLastResults }),
    [phase, isSetter, setterName, songIndex, songCount, showLastResults],
  )
  // 殼層的人數計數（ShellProps.counts）：selector 只回傳數字
  const online = useGameStore((s) => countConnected(s.players))
  const total = useGameStore((s) => s.players.length)
  const counts = useMemo(() => ({ online, total }), [online, total])
  const shellId = useUiStore((s) => s.shellId)
  const setShellId = useUiStore((s) => s.setShellId)
  const shell = getShell(shellId)
  // 遊戲中的「切換偽裝…」入口：與首頁風格卡片同一份 catalog；殼層只負責呈現
  const themes = useMemo<ShellThemeSwitch>(() => ({ current: shellId, options: THEME_CATALOG, select: setShellId }), [shellId, setShellId])
  const screen = pickScreen({ joined, resuming })
  // 未加入時標題視為 idle（離開遊戲畫面時還原）
  const titlePhase = joined ? phase : 'idle'

  useEffect(() => {
    connect()
  }, [])

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
          round={round}
          counts={counts}
          themes={themes}
          help={HELP}
          players={<PlayerList />}
          stage={<Stage />}
          chat={<ChatPanel />}
          roundStatus={<RoundStatus />}
          volunteer={<VolunteerStatus />}
          volume={<VolumeControl />}
          connection={<ConnectionStatus />}
          dialogs={
            <>
              {/* 說明放最前：出題與它同時出現時疊在上面（同 z 層後渲染者在上） */}
              <HelpDialog />
              <SourceDialog />
            </>
          }
        />
      ) : screen === 'resume' ? (
        <Shell key="resume" screen="resume" notice={RESUME_NOTICE} connection={<ConnectionStatus />} />
      ) : (
        <HomeScreen />
      )}
      {/* 試聽播放器：只在遊戲畫面掛載（離開遊戲即停播並釋放）；隱藏、不佔版面 */}
      {screen === 'game' && <AudioPlayer />}
      {/* 工具提示浮層全域只掛一個（事件委派處理所有 data-tooltip 元素；DESIGN §6）；首頁沒有 data-tooltip 元素 */}
      <TooltipLayer />
    </>
  )
}

export default App
