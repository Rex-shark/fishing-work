// vscode 主題：IDE 偽裝殼層（DESIGN.md §5；architecture §7「IDE 偽裝殼層對照」），原 layout/IdeShell。
//   已加入：活動列｜側欄 EXPLORER（players 插槽）｜編輯區（分頁 canvas.ts ＋ 假行號 ＋ canvas 插槽；分頁列右側為 toolbar 插槽）
//   ｜底部 TERMINAL（chat 插槽）｜狀態列（connection、volunteer、roundStatus 插槽＋裝飾；自己是畫師時變橘）
//   自動重連（screen 'resume'，Epic 4）：同一殼層，側欄與面板空白、編輯區為快捷鍵浮水印，視窗頂部的快速輸入框只放一行 notice。
// 作畫中：分頁加 ●（仿未儲存）；視窗標題由註冊表的 titleFor 產生（App 同步）。
// 功能元件的呈現：對話框＝快速輸入框（VscodeDialog）、玩家清單＝檔案樹（ExplorerPlayers）、聊天＝終端機輸出（TerminalChat）、
// 工具列 < 810px 收合、狀態列項目白字、「▷ 我來畫」（viewDefaults），以 ShellViewsContext 提供。
// 切換偽裝（決策 7）：遊戲中活動列設定齒輪 → 「切換偽裝…」→ 快速選單（ShellFrame／ManageMenu，資料為 props.themes）；「說明…」→ props.help.open()（Epic 6）。
import type { ReactNode } from 'react'
import { EllipsisIcon, SplitIcon } from '../../layout/icons'
import { tip } from '../../layout/tooltipPlacement'
import type { ShellGameSlots, ShellHelp, ShellProps, ShellRoundState, ShellThemeSwitch } from '../types'
import { ShellViewsContext, type ShellViews } from '../views'
import { EditorTab, EditorTabBar, Gutter } from './EditorTabs'
import { ExplorerPlayers } from './ExplorerPlayers'
import { CANVAS_TAB, isCanvasDirty, isDrawerStatusBar } from './ideLayout'
import { QuickInputNotice, VscodeDialog } from './QuickInput'
import { ShellFrame } from './ShellFrame'
import { StatusBar } from './StatusBar'
import { VSCODE_CHAT_VIEW, VSCODE_HELP_VIEW, VSCODE_STATUS_VIEW, VSCODE_TOOLBAR_VIEW, VSCODE_VOLUNTEER_VIEW } from './viewDefaults'

const VSCODE_VIEWS: ShellViews = {
  Dialog: VscodeDialog,
  PlayerList: ExplorerPlayers,
  chat: VSCODE_CHAT_VIEW,
  toolbar: VSCODE_TOOLBAR_VIEW,
  status: VSCODE_STATUS_VIEW,
  volunteer: VSCODE_VOLUNTEER_VIEW,
  help: VSCODE_HELP_VIEW,
}

export function VscodeShell(props: ShellProps) {
  return (
    <ShellViewsContext.Provider value={VSCODE_VIEWS}>
      {props.screen === 'game' ? (
        <GameScreen {...props} />
      ) : (
        <ShellFrame
          editor={<EmptyEditor />}
          statusBar={<StatusBar left={props.connection} />}
          overlay={<QuickInputNotice notice={props.notice} />}
        />
      )}
    </ShellViewsContext.Provider>
  )
}

function GameScreen(props: { round: ShellRoundState; themes: ShellThemeSwitch; help: ShellHelp } & ShellGameSlots) {
  const { round, themes, help, players, canvas, toolbar, chat, roundStatus, volunteer, connection, dialogs } = props
  return (
    <ShellFrame
      themes={themes}
      help={help}
      sidebar={players}
      editor={<Editor round={round} canvas={canvas} toolbar={toolbar} dialogs={dialogs} />}
      panel={chat}
      statusBar={
        <StatusBar
          drawer={isDrawerStatusBar(round.isDrawer, round.phase)}
          left={
            <>
              {connection}
              {volunteer}
            </>
          }
          center={roundStatus}
        />
      }
    />
  )
}

function Editor(props: { round: ShellRoundState; canvas: ReactNode; toolbar: ReactNode; dialogs: ReactNode }) {
  const { round, canvas, toolbar, dialogs } = props
  return (
    <>
      <EditorTabBar
        tabs={
          <>
            <EditorTab name={CANVAS_TAB} glyph="TS" glyphClass="text-sem-keyword" active dirty={isCanvasDirty(round.phase)} />
            <EditorTab name="README.md" glyph="M↓" glyphClass="text-sem-keyword" />
          </>
        }
        actions={round.canDraw ? toolbar : <EditorActions />}
      />
      <div className="flex min-h-0 flex-1">
        <Gutter />
        {/* 畫布區：size container，讓畫布依剩餘寬高等比縮放 16:9（寬高任一受限都不變形、不溢出），四周留 16px */}
        <div className="flex min-h-0 min-w-0 flex-1 p-4">
          <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center [container-type:size]">{canvas}</div>
        </div>
      </div>
      {dialogs}
    </>
  )
}

/** 非畫師時分頁列右側的裝飾圖示（分割編輯器、更多動作） */
function EditorActions() {
  return (
    <div aria-hidden="true" className="flex items-center gap-2 text-fg">
      <span className="flex" {...tip('Split Editor Right')}>
        <SplitIcon />
      </span>
      <span className="flex" {...tip('More Actions...')}>
        <EllipsisIcon />
      </span>
    </div>
  )
}

/** 沒有開啟任何檔案時的編輯區（自動重連畫面）：仿 VS Code 的空白編輯器浮水印（快捷鍵提示，純裝飾） */
function EmptyEditor() {
  const hints: [string, string][] = [
    ['Show All Commands', '⇧ ⌘ P'],
    ['Go to File', '⌘ P'],
    ['Find in Files', '⇧ ⌘ F'],
    ['Toggle Terminal', '⌃ `'],
  ]
  return (
    <div aria-hidden="true" className="flex flex-1 items-center justify-center">
      <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-2 text-fg-muted">
        {hints.map(([label, keys]) => (
          <div key={label} className="contents">
            <dt className="text-right">{label}</dt>
            <dd className="tracking-[2px]">{keys}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
