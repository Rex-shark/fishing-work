// vscode 主題的殼層外框（DESIGN.md §5 版面、§8 響應式）：活動列｜側欄（EXPLORER）｜編輯區＋底部面板（TERMINAL）｜狀態列。
// 只負責版面與尺寸；內容由 VscodeShell 傳入（已加入：遊戲；未加入：側欄與面板皆空、浮出暱稱輸入）。
// 底部面板是聊天室的容器：帶 data-chat-drop-zone 且為 relative，聊天室以它為圖片投放區、覆蓋層蓋滿整個面板（含標題列）。
// 遊戲中（有 themes）活動列底部的設定齒輪可操作：選單「切換偽裝…」→ 快速選單（ManageMenu.tsx）、「說明…」→ 遊戲說明（help，Epic 6）；自動重連畫面齒輪維持裝飾。
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react'
import {
  AccountIcon,
  ChevronUpIcon,
  CloseIcon,
  EllipsisIcon,
  ExtensionsIcon,
  FilesIcon,
  GearIcon,
  PlusIcon,
  SearchIcon,
  SourceControlIcon,
} from '../../layout/icons'
import { tip } from '../../layout/tooltipPlacement'
import { useMediaQuery } from '../../layout/useElementSize'
import type { ShellHelp, ShellThemeSwitch } from '../types'
import { clampPanelHeight, clampSidebarWidth } from './ideLayout'
import { ManageButton, ThemeQuickPick } from './ManageMenu'

interface ShellFrameProps {
  /** EXPLORER 標題下方的內容；未加入時為空 */
  sidebar?: ReactNode
  /** 編輯區（分頁列＋內容）；外層為 relative，可放浮出的快速輸入框 */
  editor: ReactNode
  /** TERMINAL 面板本體（聊天室）；未加入時為空 */
  panel?: ReactNode
  statusBar: ReactNode
  /** 視窗層浮出物（自動重連畫面的提示框） */
  overlay?: ReactNode
  /** 切換偽裝（遊戲中才有）；省略時設定齒輪為裝飾 */
  themes?: ShellThemeSwitch
  /** 遊戲說明（遊戲中才有）；齒輪選單的「說明…」 */
  help?: ShellHelp
}

/** ≥ 1024px 側欄內嵌；以下改為覆蓋層（DESIGN §8） */
const WIDE_QUERY = '(min-width: 1024px)'

export function ShellFrame({ sidebar, editor, panel, statusBar, overlay, themes, help }: ShellFrameProps) {
  const wide = useMediaQuery(WIDE_QUERY)
  /** 寬螢幕：側欄是否收起（活動列第一個圖示切換） */
  const [sidebarHidden, setSidebarHidden] = useState(false)
  /** 窄螢幕：覆蓋層是否開啟（預設關） */
  const [overlayOpen, setOverlayOpen] = useState(false)
  /** 使用者拖曳過的尺寸；null = 依 DESIGN 預設（CSS 斷點決定） */
  const [sidebarWidth, setSidebarWidth] = useState<number | null>(null)
  const [panelHeight, setPanelHeight] = useState<number | null>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const columnRef = useRef<HTMLDivElement>(null)
  /** 「切換偽裝」快速選單是否開啟；關閉時焦點還給齒輪 */
  const [themePickOpen, setThemePickOpen] = useState(false)
  const gearRef = useRef<HTMLButtonElement>(null)

  function closeThemePick(refocus: boolean) {
    setThemePickOpen(false)
    if (refocus) gearRef.current?.focus()
  }

  const sidebarVisible = wide ? !sidebarHidden : overlayOpen

  function toggleSidebar() {
    if (wide) setSidebarHidden((v) => !v)
    else setOverlayOpen((v) => !v)
  }

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-editor font-mono text-[13px] text-fg">
      <div className="relative flex min-h-0 flex-1">
        <ActivityBar
          explorerOpen={sidebarVisible}
          onToggleExplorer={toggleSidebar}
          gearRef={gearRef}
          onSwitchTheme={themes !== undefined ? () => setThemePickOpen(true) : undefined}
          onHelp={help !== undefined ? () => help.open() : undefined}
        />

        {sidebarVisible && (
          <aside
            ref={sidebarRef}
            aria-label="EXPLORER"
            onKeyDown={(e) => {
              if (!wide && e.key === 'Escape') setOverlayOpen(false)
            }}
            style={wide && sidebarWidth !== null ? { width: sidebarWidth } : undefined}
            className={`flex shrink-0 flex-col border-r border-border bg-sidebar ${
              wide
                ? 'relative w-[240px] min-w-[180px] max-xl:w-[200px]'
                : 'absolute top-0 bottom-0 left-[48px] z-20 w-[240px] max-w-[calc(100%-48px)]'
            }`}
          >
            <div className="flex h-[35px] shrink-0 items-center justify-between pr-2 pl-5 text-[11px] tracking-[0.5px] text-fg uppercase">
              <span>Explorer</span>
              <span aria-hidden="true" className="flex text-fg" {...tip('More Actions...')}>
                <EllipsisIcon />
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{sidebar}</div>
            {wide && (
              <Sash
                orientation="vertical"
                label="調整側欄寬度"
                getSize={() => sidebarRef.current?.offsetWidth ?? 240}
                setSize={(w) => setSidebarWidth(clampSidebarWidth(w, window.innerWidth))}
                className="top-0 right-[-3px] bottom-0 w-[5px] cursor-col-resize"
              />
            )}
          </aside>
        )}

        <div ref={columnRef} className="flex min-w-0 flex-1 flex-col">
          <main aria-label="編輯器" className="relative flex min-h-0 flex-1 flex-col bg-editor">
            {editor}
          </main>

          <section
            ref={panelRef}
            aria-label="TERMINAL"
            data-chat-drop-zone=""
            style={panelHeight !== null ? { height: panelHeight } : undefined}
            className="relative flex h-[220px] min-h-[120px] shrink-0 flex-col border-t border-border bg-editor max-md:h-[160px]"
          >
            <Sash
              orientation="horizontal"
              label="調整面板高度"
              invert
              getSize={() => panelRef.current?.offsetHeight ?? 220}
              setSize={(h) => setPanelHeight(clampPanelHeight(h, columnRef.current?.offsetHeight ?? window.innerHeight))}
              className="top-[-3px] right-0 left-0 h-[5px] cursor-row-resize"
            />
            <PanelHeader />
            <div className="min-h-0 flex-1">{panel}</div>
          </section>
        </div>

        {overlay}
        {themes !== undefined && themePickOpen && <ThemeQuickPick themes={themes} onClose={closeThemePick} />}
      </div>

      {statusBar}
    </div>
  )
}

// ─── 活動列 ─────────────────────────────────────────────────────

/**
 * 最左 48px：檔案（切換側欄）、搜尋、原始碼控制、擴充（DESIGN §5：其餘為裝飾，點了無反應）；
 * 底部帳號為裝飾；設定齒輪在遊戲中開「切換偽裝…」選單（決策 7），自動重連畫面為裝飾。
 */
function ActivityBar(props: {
  explorerOpen: boolean
  onToggleExplorer: () => void
  gearRef: RefObject<HTMLButtonElement | null>
  onSwitchTheme?: () => void
  onHelp?: () => void
}) {
  const { explorerOpen, onToggleExplorer, gearRef, onSwitchTheme, onHelp } = props
  // 裝飾圖示的懸停提示仿 VS Code 的英文名稱（DESIGN §1-4：偽裝用標籤用英文）
  const decorative = [
    { Icon: SearchIcon, name: 'Search' },
    { Icon: SourceControlIcon, name: 'Source Control' },
    { Icon: ExtensionsIcon, name: 'Extensions' },
  ]
  const explorerLabel = explorerOpen ? '隱藏 EXPLORER' : '顯示 EXPLORER'
  return (
    <nav aria-label="活動列" className="flex w-[48px] shrink-0 flex-col items-center justify-between bg-activity">
      <div className="flex w-full flex-col">
        <button
          type="button"
          onClick={onToggleExplorer}
          aria-label={explorerLabel}
          aria-pressed={explorerOpen}
          {...tip(explorerLabel, 'right')}
          className={`relative flex h-[48px] w-full cursor-pointer items-center justify-center transition-colors duration-100 focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-border-focus ${
            explorerOpen ? 'text-fg-statusbar' : 'text-fg-muted hover:text-fg-statusbar'
          }`}
        >
          {explorerOpen && <span aria-hidden="true" className="absolute top-0 bottom-0 left-0 w-[2px] bg-fg-statusbar" />}
          <FilesIcon size={24} />
        </button>
        {decorative.map(({ Icon, name }) => (
          <span key={name} aria-hidden="true" {...tip(name, 'right')} className="flex h-[48px] w-full items-center justify-center text-fg-muted">
            <Icon size={24} />
          </span>
        ))}
      </div>
      <div className="flex w-full flex-col text-fg-muted">
        <span aria-hidden="true" {...tip('Accounts', 'right')} className="flex h-[48px] items-center justify-center">
          <AccountIcon size={24} />
        </span>
        {onSwitchTheme !== undefined ? (
          <ManageButton buttonRef={gearRef} onSwitchTheme={onSwitchTheme} onHelp={onHelp} />
        ) : (
          <span aria-hidden="true" {...tip('Manage', 'right')} className="flex h-[48px] items-center justify-center">
            <GearIcon size={24} />
          </span>
        )}
      </div>
    </nav>
  )
}

// ─── 面板標題列 ──────────────────────────────────────────────────

/** `PROBLEMS  OUTPUT  TERMINAL`（TERMINAL 作用中，其餘裝飾）＋右側裝飾圖示（DESIGN §5 底部面板） */
function PanelHeader() {
  return (
    <div className="flex h-[35px] shrink-0 items-center justify-between bg-titlebar px-2 text-[11px] tracking-[0.5px] uppercase">
      <div className="flex h-full items-center gap-1" aria-hidden="true">
        <span className="px-2 text-fg">Problems</span>
        <span className="px-2 text-fg">Output</span>
        <span className="flex h-full items-center border-b border-fg-statusbar px-2 text-fg-statusbar">Terminal</span>
      </div>
      <div className="flex items-center gap-2 text-fg" aria-hidden="true">
        <span className="flex" {...tip('New Terminal')}>
          <PlusIcon />
        </span>
        <span className="flex" {...tip('More Actions...')}>
          <EllipsisIcon />
        </span>
        <span className="flex" {...tip('Maximize Panel Size')}>
          <ChevronUpIcon />
        </span>
        <span className="flex" {...tip('Close Panel')}>
          <CloseIcon />
        </span>
      </div>
    </div>
  )
}

// ─── 分隔線（sash） ───────────────────────────────────────────────

/**
 * 可拖曳的分隔線：指標拖曳或方向鍵（每次 10px）調整尺寸。
 * invert：往上／往左拖代表變大（底部面板）。hover 時亮成 focus 色（transition 150ms 以內，DESIGN §7）。
 */
function Sash(props: {
  orientation: 'vertical' | 'horizontal'
  label: string
  getSize: () => number
  setSize: (size: number) => void
  invert?: boolean
  className: string
}) {
  const { orientation, label, getSize, setSize, invert, className } = props
  const drag = useRef<{ pointerId: number; start: number; size: number } | null>(null)
  const sign = invert ? -1 : 1
  const coord = (e: PointerEvent) => (orientation === 'vertical' ? e.clientX : e.clientY)

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { pointerId: e.pointerId, start: coord(e), size: getSize() }
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (d === null || d.pointerId !== e.pointerId) return
    setSize(d.size + sign * (coord(e) - d.start))
  }

  function handlePointerEnd(e: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId === e.pointerId) drag.current = null
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const grow = orientation === 'vertical' ? 'ArrowRight' : invert ? 'ArrowUp' : 'ArrowDown'
    const shrink = orientation === 'vertical' ? 'ArrowLeft' : invert ? 'ArrowDown' : 'ArrowUp'
    if (e.key !== grow && e.key !== shrink) return
    e.preventDefault()
    setSize(getSize() + (e.key === grow ? 10 : -10))
  }

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onKeyDown={handleKeyDown}
      className={`absolute z-10 touch-none transition-colors duration-150 outline-none hover:bg-border-focus focus-visible:bg-border-focus ${className}`}
    />
  )
}
