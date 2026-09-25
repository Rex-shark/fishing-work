// 畫師工具列（殼層的 toolbar 插槽；DESIGN.md §5 畫師工具列、§6「圖示按鈕」「滑桿」「色相條」「工具提示」）。
// 目前色圓點、8 個 16px 預設色塊（PALETTE）、色相條、粗細滑桿（1–64）、橡皮擦／復原／清空／放棄。
// 只在「自己是畫師且 phase = drawing」時渲染。選色（色塊或色相條）即切回畫筆；橡皮擦再按一次也切回畫筆。
// 視窗寬度小於殼層給的斷點（ShellViews.toolbar.compactBelowPx；預設 1100px）時色相條與滑桿收進「⋯」彈出面板
// （portal 到 body，不被外層的 overflow 容器裁掉）。
// 「放棄」開啟確認對話框（CancelConfirm），不用 window.confirm。
// 按下狀態（bg-active）的字色與選中色塊外框用 --fg-on-active（深色主題為白、淺色主題為深色字），不借用狀態列的 --fg-statusbar。
// 色塊、目前色、色相條的顏色是遊戲資料（畫筆色），以 style 帶入，不是樣式 token（DESIGN §10 只約束介面色）。
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { PALETTE, type DrawOp } from '@fishing-work/shared'
import { EllipsisIcon, EraserIcon, StopIcon, TrashIcon, UndoIcon } from '../../layout/icons'
import { placeFloating, tip } from '../../layout/tooltipPlacement'
import { useUiStore } from '../../layout/uiStore'
import { useMediaQuery } from '../../layout/useElementSize'
import { isOpsFull, sendDrawOp } from '../../socket/client'
import { useToolbarView } from '../../shells/views'
import { selectCanDraw, useGameStore } from '../../store/game'
import { hueToHex, swatchLabel } from './brush'
import { HueSlider, SizeSlider } from './Slider'
import { fullToolbarQuery } from './toolbarLayout'

/**
 * 歷史中最後一筆仍存在的 strokeId（ops 已正規化、本回合全由畫師產生，因此就是「自己最後一筆」）。
 * 可連續 undo：每撤一筆，ops 移除該筆，下一次就指向前一筆（architecture §5「draw:op 驗證」）
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
  const undoTarget = useGameStore((s) => lastStrokeId(s.ops))
  const hasOps = useGameStore((s) => s.ops.length > 0)
  const opsFull = useGameStore((s) => isOpsFull(s.ops.length))
  const confirming = useUiStore((s) => s.cancelConfirmOpen)
  const setConfirming = useUiStore((s) => s.setCancelConfirmOpen)
  const { compactBelowPx } = useToolbarView()
  const full = useMediaQuery(fullToolbarQuery(compactBelowPx))

  if (!canDraw) return null

  function handleUndo() {
    if (undoTarget !== null) sendDrawOp({ type: 'undo', strokeId: undoTarget })
  }

  function handleClear() {
    if (hasOps) sendDrawOp({ type: 'clear' })
  }

  return (
    <div role="toolbar" aria-label="畫師工具列" className="flex h-full shrink-0 items-center gap-[2px]">
      {opsFull && (
        <span className="mr-2 max-w-[220px] truncate text-sem-warning" role="status" {...tip('筆跡已達上限，請復原或清空後再畫')}>
          筆跡已達上限，請復原或清空
        </span>
      )}

      <CurrentColor />
      <Swatches />

      {full ? (
        <>
          <HueControl />
          <Separator />
          <SizeControl />
        </>
      ) : (
        <MoreBrushMenu />
      )}

      <Separator />

      <IconButton label="橡皮擦" pressed={tool === 'eraser'} onClick={() => setBrush({ tool: tool === 'eraser' ? 'pen' : 'eraser' })}>
        <EraserIcon />
      </IconButton>
      <IconButton label="復原" disabled={undoTarget === null} onClick={handleUndo}>
        <UndoIcon />
      </IconButton>
      <IconButton label="清空畫布" disabled={!hasOps} onClick={handleClear}>
        <TrashIcon />
      </IconButton>
      <IconButton label="放棄本回合" pressed={confirming} onClick={() => setConfirming(!confirming)}>
        <StopIcon />
      </IconButton>
    </div>
  )
}

/** 目前色圓點（DESIGN §5）：橡皮擦中仍顯示切回畫筆後的顏色 */
function CurrentColor() {
  const color = useGameStore((s) => s.brush.color)
  const label = `目前顏色 ${color}`
  return (
    <span role="img" aria-label={label} {...tip(label)} className="mx-1 flex h-[22px] w-4 shrink-0 items-center justify-center">
      <span className="block h-3 w-3 rounded-full border border-border" style={{ backgroundColor: color }} />
    </span>
  )
}

/** 8 個預設色塊（spec §4 PALETTE）：選色即切回畫筆 */
function Swatches() {
  const tool = useGameStore((s) => s.brush.tool)
  const current = useGameStore((s) => s.brush.color)
  const setBrush = useGameStore((s) => s.setBrush)
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
            onClick={() => setBrush({ color, tool: 'pen' })}
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

/** 色相條：選色相即把顏色設為 hsl(h,100%,50%) 的大寫 #RRGGBB 並切回畫筆 */
function HueControl() {
  const hue = useGameStore((s) => s.brush.hue)
  const setBrush = useGameStore((s) => s.setBrush)
  return <HueSlider hue={hue} onChange={(h) => setBrush({ hue: h, color: hueToHex(h), tool: 'pen' })} />
}

/** 粗細滑桿：不改變目前工具（橡皮擦也能調粗細） */
function SizeControl() {
  const size = useGameStore((s) => s.brush.size)
  const setBrush = useGameStore((s) => s.setBrush)
  return <SizeSlider value={size} onChange={(v) => setBrush({ size: v })} />
}

/**
 * 窄版「⋯」：彈出面板放色相條與粗細滑桿。
 * 面板 portal 到 body、position: fixed，定位在按鈕下方；點面板外、Esc（focus 回到按鈕）、視窗縮放時關閉。
 */
function MoreBrushMenu() {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // 定位（paint 前完成）；直接寫 DOM style，不觸發額外 render
  useLayoutEffect(() => {
    const button = buttonRef.current
    const panel = panelRef.current
    if (!open || button === null || panel === null) return
    const r = button.getBoundingClientRect()
    const pos = placeFloating(
      { left: r.left, top: r.top, width: r.width, height: r.height },
      { width: panel.offsetWidth, height: panel.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      'bottom',
    )
    panel.style.left = `${pos.left}px`
    panel.style.top = `${pos.top}px`
    // 開啟後把 focus 移到第一個滑桿，鍵盤可直接調整
    panel.querySelector<HTMLElement>('[role="slider"]')?.focus({ preventScroll: true })
  }, [open])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      const t = e.target
      if (!(t instanceof Node)) return
      if (panelRef.current?.contains(t) || buttonRef.current?.contains(t)) return
      setOpen(false)
    }
    function onResize() {
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  return (
    <>
      <Separator />
      <IconButton
        label="更多畫筆設定（色相、粗細）"
        pressed={open}
        expanded={open}
        buttonRef={buttonRef}
        onClick={() => setOpen((v) => !v)}
      >
        <EllipsisIcon />
      </IconButton>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="畫筆設定"
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return
              e.preventDefault()
              setOpen(false)
              buttonRef.current?.focus()
            }}
            className="fixed top-0 left-0 z-50 flex flex-col gap-1 rounded-[3px] border border-border bg-quickinput px-2 py-1 font-mono text-[13px] text-fg shadow-quickinput"
          >
            <div className="flex items-center gap-1">
              <span className="w-[3em] shrink-0">色相</span>
              <HueControl />
            </div>
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
