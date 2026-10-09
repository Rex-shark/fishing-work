// 作畫工具列（殼層的 toolbar 插槽；複製自我畫你猜，DESIGN.md §5、§6「圖示按鈕」「滑桿」「顏色面板」「工具提示」）。
// 目前顏色鈕（開顏色面板）、10 個 16px 預設色塊（PALETTE）、粗細滑桿（1–64）、背景色／橡皮擦／復原／清空。
// 「完成」（＝交卷）是另一個插槽 FinishButton：殼層把它固定在工具列外的右端（窄版工具列捲動或收合時仍看得到；design §4）。
// 只在「自己是參賽者、phase = drawing、尚未交卷」時渲染。所有操作只改自己的本機畫布（不送出）。
// 選色（色塊或顏色面板）即切回畫筆；橡皮擦再按一次也切回畫筆。
// 視窗寬度小於殼層給的斷點（ShellViews.toolbar.compactBelowPx；省略時用 DEFAULT_TOOLBAR_VIEW）時粗細滑桿收進「⋯」彈出面板
// （portal 到 body，不被外層的 overflow 容器裁掉；開關與定位同顏色面板，共用 useFloatingPanel）。
// 「完成」先開確認框（features/round/SubmitConfirmDialog），確認才交卷；自動交卷不經確認框。
// 按下狀態（bg-active）的字色與選中色塊外框用 --fg-on-active（深色主題為白、淺色主題為深色字），不借用狀態列的 --fg-statusbar。
// 色塊、目前色的顏色是遊戲資料（畫筆色），以 style 帶入，不是樣式 token（DESIGN §10 只約束介面色）。
import { useCallback, useEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { PALETTE } from '@fishing-work/shared/draw-contest'
import { EllipsisIcon, EraserIcon, FillIcon, TrashIcon, UndoIcon } from '../../layout/icons'
import { tip } from '../../layout/tooltipPlacement'
import { useMediaQuery } from '../../layout/useElementSize'
import { useTermsView, useToolbarView } from '../../shells/views'
import { selectCanDraw, useGameStore } from '../../store/game'
import { clearSubmitError, openSubmitConfirm, useSubmitConfirmStore } from '../round/submitConfirm'
import { backgroundLabel, backgroundOp, colorButtonLabel, hexToHsv, swatchLabel } from './brush'
import { ColorPanel } from './ColorPanel'
import type { DrawOp } from './ops'
import { SizeSlider } from './Slider'
import { fullToolbarQuery } from './toolbarLayout'
import { useFloatingPanel } from './useFloatingPanel'

/**
 * 歷史中最後一筆仍存在的 strokeId（本機畫布已正規化，就是「自己最後一筆」）。
 * 可連續 undo：每撤一筆，ops 移除該筆，下一次就指向前一筆
 */
function lastStrokeId(ops: readonly DrawOp[]): string | null {
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i]
    if (op.type === 'begin') return op.strokeId
  }
  return null
}

export function ToolBar() {
  const canDraw = useGameStore(selectCanDraw)
  const tool = useGameStore((s) => s.brush.tool)
  const setBrush = useGameStore((s) => s.setBrush)
  const undoTarget = useGameStore((s) => lastStrokeId(s.myCanvas.ops))
  // 有筆跡才能清空（background 不算筆跡：clear 只清筆跡、保留背景）
  const hasOps = useGameStore((s) => s.myCanvas.ops.some((o) => o.type !== 'background'))
  const color = useGameStore((s) => s.brush.color)
  const applyCanvasOp = useGameStore((s) => s.applyCanvasOp)
  const { compactBelowPx } = useToolbarView()
  const full = useMediaQuery(fullToolbarQuery(compactBelowPx))

  if (!canDraw) return null

  function handleUndo() {
    if (undoTarget !== null) applyCanvasOp({ type: 'undo', strokeId: undoTarget })
  }

  function handleClear() {
    if (hasOps) applyCanvasOp({ type: 'clear' })
  }

  // 背景色＝目前筆色（橡皮擦模式也用目前筆色）；只換自己畫布的底色，交卷的 PNG 也用它填底
  function handleBackground() {
    applyCanvasOp(backgroundOp(color))
  }

  return (
    <div role="toolbar" aria-label="作畫工具列" className="flex h-full shrink-0 items-center gap-[2px]">
      <CurrentColor />
      <Swatches />

      {full ? (
        <>
          <Separator />
          <SizeControl />
        </>
      ) : (
        <MoreBrushMenu />
      )}

      <Separator />

      <IconButton label={backgroundLabel(color)} onClick={handleBackground}>
        <FillIcon />
      </IconButton>
      <IconButton label="橡皮擦" pressed={tool === 'eraser'} onClick={() => setBrush({ tool: tool === 'eraser' ? 'pen' : 'eraser' })}>
        <EraserIcon />
      </IconButton>
      <IconButton label="復原" disabled={undoTarget === null} onClick={handleUndo}>
        <UndoIcon />
      </IconButton>
      <IconButton label="清空畫布" disabled={!hasOps} onClick={handleClear}>
        <TrashIcon />
      </IconButton>
    </div>
  )
}

/** 交卷失敗訊息停留時間（與聊天室、狀態列一致） */
const FINISH_ERROR_MS = 4000

/** 「完成」的可見文字 */
const FINISH_LABEL = '完成'

/**
 * 「完成」主要按鈕（design §2：繪圖分頁右端＝交卷）：按下先開確認框（不交卷），確認才匯出 PNG 交卷；
 * 成功後工具列與本按鈕消失、畫布鎖定。失敗（逾時、未連線、太大）以錯誤文字顯示在按鈕旁，可再按一次。
 * 只在能作畫時渲染（同 ToolBar）
 */
export function FinishButton() {
  const canDraw = useGameStore(selectCanDraw)
  if (!canDraw) return null
  return <FinishControl />
}

function FinishControl() {
  const roundNo = useGameStore((s) => s.round.roundNo)
  const busy = useGameStore((s) => s.submitting)
  const error = useSubmitConfirmStore((s) => s.error)
  const { save } = useTermsView()

  useEffect(() => {
    if (error === null) return
    const timer = setTimeout(clearSubmitError, FINISH_ERROR_MS)
    return () => clearTimeout(timer)
  }, [error])

  return (
    <div className="flex h-full shrink-0 items-center gap-1">
      {error !== null && (
        <span role="alert" className="max-w-[200px] truncate text-sem-error" {...tip(error)}>
          {error}
        </span>
      )}
      <button
        type="button"
        disabled={busy}
        aria-haspopup="dialog"
        onClick={() => openSubmitConfirm(roundNo)}
        className="h-[22px] shrink-0 cursor-pointer rounded-[2px] bg-accent px-3 text-fg-statusbar transition-colors duration-100 hover:bg-accent-hover focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-border-focus disabled:cursor-default disabled:opacity-60"
      >
        {busy ? `${save}中…` : FINISH_LABEL}
      </button>
    </div>
  )
}

/**
 * 目前顏色鈕（決策 1；DESIGN §5）：22×22 圖示按鈕，內為 14px 目前色圓點（1px --border 外框）；點擊開關顏色面板。
 * 橡皮擦中仍顯示切回畫筆後的顏色
 */
function CurrentColor() {
  const color = useGameStore((s) => s.brush.color)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const buttonRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      <IconButton label={colorButtonLabel(color)} pressed={open} expanded={open} buttonRef={buttonRef} onClick={() => setOpen((v) => !v)}>
        <span className="block h-[14px] w-[14px] rounded-full border border-border" style={{ backgroundColor: color }} />
      </IconButton>
      <ColorPanel open={open} close={close} buttonRef={buttonRef} />
    </>
  )
}

/** 10 個預設色塊（spec §4 PALETTE）：選色即切回畫筆 */
function Swatches() {
  const tool = useGameStore((s) => s.brush.tool)
  const current = useGameStore((s) => s.brush.color)
  const setBrush = useGameStore((s) => s.setBrush)
  // 反推 HSV 寫回（灰階保留原色相；決策 3），顏色面板的把手才會在對應位置
  function pick(color: string) {
    setBrush({ color, ...hexToHsv(color, useGameStore.getState().brush.hue), tool: 'pen' })
  }
  return (
    <div role="radiogroup" aria-label="預設顏色" className="flex items-center gap-[4px] px-1">
      {PALETTE.map((color, i) => {
        const selected = tool === 'pen' && current === color
        const label = swatchLabel(color, i)
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            {...tip(label)}
            onClick={() => pick(color)}
            className={`h-4 w-4 shrink-0 cursor-pointer rounded-[2px] border border-border transition-[outline-color] duration-100 hover:outline-1 hover:outline-offset-1 hover:outline-fg-muted focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-border-focus ${
              selected ? 'outline-1 outline-offset-1 outline-fg-on-active hover:outline-fg-on-active' : ''
            }`}
            style={{ backgroundColor: color }}
          />
        )
      })}
    </div>
  )
}

/** 粗細滑桿：不改變目前工具（橡皮擦也能調粗細） */
function SizeControl() {
  const size = useGameStore((s) => s.brush.size)
  const setBrush = useGameStore((s) => s.setBrush)
  return <SizeSlider value={size} onChange={(v) => setBrush({ size: v })} />
}

/**
 * 窄版「⋯」：彈出面板只放粗細滑桿（Epic 11 起色相改在顏色面板）。
 * 面板 portal 到 body、position: fixed，定位在按鈕下方；點面板外、Esc（focus 回到按鈕）、視窗縮放時關閉（useFloatingPanel）。
 */
function MoreBrushMenu() {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const { onKeyDown } = useFloatingPanel(open, close, buttonRef, panelRef)

  return (
    <>
      <Separator />
      <IconButton label="更多畫筆設定（粗細）" pressed={open} expanded={open} buttonRef={buttonRef} onClick={() => setOpen((v) => !v)}>
        <EllipsisIcon />
      </IconButton>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="畫筆設定"
            onKeyDown={onKeyDown}
            className="fixed top-0 left-0 z-50 flex flex-col gap-1 rounded-[3px] border border-border bg-quickinput px-2 py-1 font-mono text-[13px] text-fg shadow-quickinput"
          >
            <div className="flex items-center gap-1">
              <span className="w-[3em] shrink-0">粗細</span>
              <SizeControl />
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}

function Separator() {
  return <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-border" />
}

/** 圖示按鈕（DESIGN §6：22×22、hover 底 --bg-hover、圓角 3px；focus 外框 outset；一律有工具提示與 aria-label） */
function IconButton(props: {
  label: string
  onClick: () => void
  children: ReactNode
  pressed?: boolean
  expanded?: boolean
  disabled?: boolean
  buttonRef?: Ref<HTMLButtonElement>
}) {
  const { label, onClick, children, pressed, expanded, disabled, buttonRef } = props
  const stateProps =
    expanded !== undefined
      ? { 'aria-expanded': expanded, 'aria-haspopup': 'dialog' as const }
      : pressed !== undefined
        ? { 'aria-pressed': pressed }
        : {}
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      {...tip(label)}
      disabled={disabled}
      onClick={onClick}
      {...stateProps}
      className={`flex h-[22px] w-[22px] shrink-0 cursor-pointer items-center justify-center rounded-[3px] transition-colors duration-100 focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-border-focus disabled:cursor-default disabled:opacity-40 ${
        pressed ? 'bg-active text-fg-on-active' : 'text-fg hover:bg-hover disabled:hover:bg-transparent'
      }`}
    >
      {children}
    </button>
  )
}
