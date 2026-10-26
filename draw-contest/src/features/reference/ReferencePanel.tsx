// 作畫中的參考圖面板（Epic 20 像不像比賽；plan/contest-mimic.md 決策 6、12；spec/draw-contest/design.md §2）：
//   本回合 mode 'mimic' 且 drawing／judging 時，浮在中央工作區右上角（殼層把 reference 插槽放進中央工作區，父層為 position: relative）。
//   出題者、參賽者、旁觀者都看得到；topic 模式沒有此面板（元件自己不渲染）。
//   展開：section[aria-label="參考圖"]，寬 25%（最小 200px、最大 360px），標題列「參考圖」＋收合鈕「收合參考圖」，
//         下方 16:9 圖片按鈕「放大參考圖」（圖片 contain、--bg-editor 底；圖還沒到顯示「載入中」），1px --border、陰影。
//   收合：section 還在，裡面只剩一顆小按鈕「展開參考圖」（AI 遊玩技能以 section 判斷是不是像不像比賽，所以收合時不拿掉 section）。
//   放大：同揭曉的放大檢視（標題列 → 16:9 圖片，置中於中央工作區），再點或 Esc 回去，焦點還給「放大參考圖」。
//   展開／收合／放大都是本機狀態，不記偏好（每回合重新掛載即回到初始狀態）。
//   窄視窗（Phase 2.5；< 工具列收合斷點 ShellViews.toolbar.compactBelowPx，ppt 540px）：初始收合（只看掛載當下的寬度），
//   展開時寬度上限改為 calc(100% - 24px)（最小寬也不超過它），左緣不超出中央工作區；寬視窗維持 25%／200～360px。
// 狀態轉移是純函式（referencePanelNext），畫面是不接 store 的 ReferencePanelView（測試以靜態渲染驗證）。
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDownIcon, ChevronUpIcon } from '../../layout/icons'
import { tip } from '../../layout/tooltipPlacement'
import { useMediaQuery } from '../../layout/useElementSize'
import { useToolbarView } from '../../shells/views'
import { fullToolbarQuery } from '../canvas/toolbarLayout'
import { selectReferenceUrl, selectShowReferencePanel, useGameStore } from '../../store/game'
import { initialReferencePanelState, referencePanelNext, type ReferencePanelAction, type ReferencePanelState } from './referencePanelState'
import { REFERENCE_PANEL_TEXT } from './referenceText'

export function ReferencePanel() {
  const show = useGameStore(selectShowReferencePanel)
  const url = useGameStore(selectReferenceUrl)
  if (!show) return null
  return <ReferencePanelBody url={url} />
}

/** 有狀態的部分（展開／收合／放大）；卸載即忘記 */
function ReferencePanelBody({ url }: { url: string | null }) {
  const { compactBelowPx } = useToolbarView()
  const narrow = !useMediaQuery(fullToolbarQuery(compactBelowPx))
  // 初始狀態只看掛載當下的寬度
  const [state, setState] = useState<ReferencePanelState>(() => initialReferencePanelState(narrow))
  return <ReferencePanelView url={url} state={state} narrow={narrow} onAction={(action) => setState((s) => referencePanelNext(s, action))} />
}

/**
 * 操作後焦點要去的按鈕（按下的那顆按鈕操作後已不在畫面上）：放大 → 放大檢視、回去 → 「放大參考圖」、
 * 收合 → 「展開參考圖」、展開 → 「收合參考圖」
 */
const FOCUS_AFTER: Record<ReferencePanelAction, string> = {
  zoom: 'zoomed',
  unzoom: 'zoom',
  collapse: 'expand',
  expand: 'collapse',
}

/** 寬視窗：25%，200～360px（design §2） */
const PANEL_WIDTH_WIDE = 'max-w-[360px] min-w-[200px]'
/** 窄視窗：上限 calc(100% - 24px)（左右各留 12px，同 top-3 right-3 的間距）；最小寬也不超過它（min-width 會壓過 max-width） */
const PANEL_WIDTH_NARROW = 'max-w-[calc(100%-24px)] min-w-[min(200px,calc(100%-24px))]'

/**
 * 面板本體（不接 store）。url＝參考圖的 object URL（null＝還沒收到，顯示「載入中」）。
 * 狀態改變後把焦點放到新狀態的主要按鈕（只在使用者操作過之後；初次掛載不搶畫布的焦點）
 */
export function ReferencePanelView(props: {
  url: string | null
  state: ReferencePanelState
  /** 窄視窗（< 工具列收合斷點）：寬度上限 calc(100% - 24px) */
  narrow?: boolean
  onAction: (action: ReferencePanelAction) => void
}) {
  const { url, state, narrow = false, onAction } = props
  const rootRef = useRef<HTMLDivElement>(null)
  /** 最近一次操作（初次掛載為 null：不搶畫布的焦點） */
  const lastAction = useRef<ReferencePanelAction | null>(null)

  useEffect(() => {
    if (lastAction.current === null) return
    rootRef.current?.querySelector<HTMLElement>(`[data-reference-focus="${FOCUS_AFTER[lastAction.current]}"]`)?.focus()
  }, [state])

  const act = (action: ReferencePanelAction) => {
    lastAction.current = action
    onAction(action)
  }

  function handleZoomKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      act('unzoom')
    }
  }

  return (
    <div ref={rootRef} className="contents">
      <section
        aria-label={REFERENCE_PANEL_TEXT.region}
        className={`absolute top-3 right-3 z-10 ${
          state === 'collapsed'
            ? narrow
              ? 'max-w-[calc(100%-24px)]'
              : ''
            : `w-[25%] ${narrow ? PANEL_WIDTH_NARROW : PANEL_WIDTH_WIDE} rounded-[2px] border border-border bg-quickinput shadow-quickinput`
        }`}
      >
        {state === 'collapsed' ? (
          <button
            type="button"
            data-reference-focus="expand"
            aria-label={REFERENCE_PANEL_TEXT.expand}
            {...tip(REFERENCE_PANEL_TEXT.expand, 'bottom')}
            onClick={() => act('expand')}
            className="flex h-[26px] cursor-pointer items-center gap-1 rounded-[2px] border border-border bg-quickinput px-2 text-[12px] text-fg shadow-quickinput transition-colors duration-100 hover:bg-hover focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-border-focus"
          >
            <span>{REFERENCE_PANEL_TEXT.title}</span>
            <ChevronDownIcon size={14} />
          </button>
        ) : (
          <>
            <div className="flex h-[26px] items-center justify-between pr-[1px] pl-2 text-[12px] text-fg">
              <span className="truncate">{REFERENCE_PANEL_TEXT.title}</span>
              <button
                type="button"
                data-reference-focus="collapse"
                aria-label={REFERENCE_PANEL_TEXT.collapse}
                {...tip(REFERENCE_PANEL_TEXT.collapse, 'bottom')}
                onClick={() => act('collapse')}
                className="flex h-[24px] w-[24px] cursor-pointer items-center justify-center rounded-[2px] text-fg transition-colors duration-100 hover:bg-hover focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-border-focus"
              >
                <ChevronUpIcon size={14} />
              </button>
            </div>
            <button
              type="button"
              data-reference-focus="zoom"
              aria-label={REFERENCE_PANEL_TEXT.zoom}
              {...tip(REFERENCE_PANEL_TEXT.zoom, 'bottom')}
              onClick={() => act('zoom')}
              className="block aspect-video w-full cursor-zoom-in overflow-hidden border-t border-border bg-editor focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus"
            >
              <ReferenceImage url={url} />
            </button>
          </>
        )}
      </section>

      {state === 'zoomed' && (
        // 放大檢視：蓋住中央工作區，16:9 依剩餘寬高縮放（size container），同揭曉的放大檢視
        <div className="absolute inset-0 z-20 bg-editor p-6 max-md:p-3">
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 [container-type:size]">
            <div className="w-[min(100cqw,calc((100cqh-28px)*16/9))]">
              <div aria-hidden="true" className="mb-1 text-[12px] leading-[18px] font-bold text-fg">
                {REFERENCE_PANEL_TEXT.title}
              </div>
              <button
                type="button"
                autoFocus
                data-reference-focus="zoomed"
                aria-label={REFERENCE_PANEL_TEXT.unzoom}
                onClick={() => act('unzoom')}
                onKeyDown={handleZoomKeyDown}
                className="block aspect-video w-full cursor-zoom-out overflow-hidden bg-editor shadow-slide outline-1 outline-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
              >
                <ReferenceImage url={url} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** 圖片（contain）；還沒收到顯示灰底「載入中」 */
function ReferenceImage({ url }: { url: string | null }) {
  if (url === null) {
    return <span className="flex h-full w-full items-center justify-center bg-hover text-[12px] text-fg-muted">{REFERENCE_PANEL_TEXT.loading}</span>
  }
  return <img src={url} alt={REFERENCE_PANEL_TEXT.title} draggable={false} className="block h-full w-full object-contain" />
}
