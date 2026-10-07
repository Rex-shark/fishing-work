// 首頁的介面風格卡片（plan/home-page.md 決策 2、7、8；DESIGN §14.3、§14.4）。
//   卡片：底 --home-surface 加紙卡紋理（home-paper，Epic 10 試做）、圓角 --home-radius、內距 20px、1px --home-border、--home-shadow；左上 64px 圓形淡色底（home-icon-disc）放 48px 圖示；
//   名稱 16px／600、描述（註冊表 description）13px／18px --home-fg-muted，允許兩行、text-wrap: balance（Epic 5 決策 13(6)）；卡片等高（grid stretch）。
//   選取：2px --home-accent 邊框（1px border ＋ 1px inset ring，不改尺寸）＋底 --home-accent-soft ＋右上 20px 打勾徽章。
//   hover（可選者）：底 --home-surface-hover、--home-shadow-hover、上移 2px；200ms；prefers-reduced-motion 時不位移。
//   不可選（即將推出）：opacity .55、cursor default、右上「即將推出」膠囊。
// 鍵盤：radiogroup／radio ＋ aria-checked、roving tabindex、←／→（↑／↓）移動即選取並略過不可選、Home／End、Space／點擊選取、
// Enter＝進入遊戲（layout/themeCardNav 的純邏輯）；focus 為 2px --home-accent 外框、offset 2px。
// 卡片名稱、描述、圖示一律來自註冊表（shells/catalog）；點卡片只選取（呼叫端寫入 uiStore.shellId），首頁外觀不隨之改變。
// 首頁在殼層之外：不得 import 特定殼層、shells/views、工具提示，也不得含偽裝字樣（test/shellBoundary.test.ts 把關）。
import { useRef, type KeyboardEvent } from 'react'
import { UPCOMING_LABEL, cardKeyTarget, tabStopIndex } from '../layout/themeCardNav'
import type { ShellThemeOption } from '../shells/types'

export interface HomeThemeCardsProps {
  options: readonly ShellThemeOption[]
  value: string
  /** 只會以可選（available）的 id 呼叫 */
  onSelect(id: ShellThemeOption['id']): void
  /** 卡片上按 Enter＝進入遊戲 */
  onEnter?: () => void
  /** radiogroup 的標籤元素 id（區塊小標「介面風格」） */
  labelledBy?: string
}

/** 卡片共通：home-paper 紙卡紋理（只設 background-image，底色仍由 bg-home-* 決定）；200ms 只轉場底色、邊框色、陰影；位移（hover 上移 2px）與其轉場只在 motion-safe（未要求減少動態）時啟用（DESIGN §14.4） */
const CARD_BASE =
  'home-paper relative flex flex-col items-start gap-3 rounded-home border p-5 text-left shadow-home transition-[background-color,border-color,box-shadow] duration-200 motion-safe:transition-[background-color,border-color,box-shadow,translate] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-home-accent'
const CARD_CHECKED = 'border-home-accent bg-home-accent-soft ring-1 ring-inset ring-home-accent'
const CARD_UNCHECKED = 'border-home-border bg-home-surface'
const CARD_AVAILABLE = 'cursor-pointer hover:shadow-home-hover motion-safe:hover:-translate-y-0.5'
const CARD_UNAVAILABLE = 'cursor-default opacity-55'

export function HomeThemeCards({ options, value, onSelect, onEnter, labelledBy }: HomeThemeCardsProps) {
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([])
  const tabStop = tabStopIndex(options, value)

  function choose(option: ShellThemeOption) {
    if (option.available) onSelect(option.id)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      onEnter?.()
      return
    }
    const from = cardRefs.current.findIndex((el) => el === document.activeElement)
    const target = cardKeyTarget(options, from < 0 ? tabStop : from, e.key)
    if (target === null) return
    e.preventDefault()
    const option = options[target]
    if (option === undefined) return
    cardRefs.current[target]?.focus()
    choose(option)
  }

  return (
    <div
      role="radiogroup"
      aria-label={labelledBy === undefined ? '介面風格' : undefined}
      aria-labelledby={labelledBy}
      onKeyDown={handleKeyDown}
      className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4"
    >
      {options.map((option, i) => {
        const checked = option.id === value
        const Icon = option.icon
        return (
          <button
            key={option.id}
            ref={(el) => {
              cardRefs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-disabled={option.available ? undefined : true}
            tabIndex={i === tabStop ? 0 : -1}
            onClick={() => choose(option)}
            className={`${CARD_BASE} ${checked ? CARD_CHECKED : CARD_UNCHECKED} ${
              option.available ? `${CARD_AVAILABLE} ${checked ? '' : 'hover:bg-home-surface-hover'}` : CARD_UNAVAILABLE
            }`}
          >
            {/* 64px 圓形淡色底（圖示品牌色 12% 混白）＋ 48px 圖示：svg 自身 64px、內距 8px（border-box） */}
            <Icon size={64} className="home-icon-disc rounded-full p-2" />
            <span className="flex flex-col gap-1">
              <span className="text-[16px] leading-[22px] font-semibold text-home-fg">{option.name}</span>
              <span className="text-[13px] leading-[18px] text-home-fg-muted [text-wrap:balance]">{option.description}</span>
            </span>
            {checked && option.available && <CheckBadge />}
            {!option.available && (
              <span className="absolute top-4 right-4 rounded-full border border-home-border px-2 text-[12px] leading-[18px] text-home-fg-dim">
                {UPCOMING_LABEL}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** 右上 20px 圓形打勾徽章（--home-accent 底、白色勾）；純裝飾，選取狀態由 aria-checked 表達 */
function CheckBadge() {
  return (
    <span
      data-check-badge=""
      aria-hidden="true"
      className="absolute top-4 right-4 flex size-5 items-center justify-center rounded-full bg-home-accent text-home-on-accent"
    >
      <svg width={12} height={12} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" focusable="false">
        <path d="M2.5 6.2 5 8.5l4.5-5" />
      </svg>
    </span>
  )
}
