// 編輯區的分頁列與假行號（DESIGN.md §5「分頁列」「假行號 gutter」、§6「分頁」）。
import { useRef, type ReactNode } from 'react'
import { CloseIcon, FileGlyphIcon } from '../../layout/icons'
import { useElementHeight } from '../../layout/useElementSize'
import { DIRTY_MARK, gutterLineCount } from './ideLayout'

/**
 * 分頁列：高 35px；左側分頁、右側動作（畫師工具列或裝飾圖示）。
 * 寬度不足時分頁先縮（shrink 權重 10，分頁被 overflow-hidden 截掉），工具列盡量完整顯示；
 * 仍放不下時工具列可橫向捲動。用 safe 對齊（justify-end-safe）：一般的 justify-end 溢出時內容會往左跑出容器、捲不到
 */
export function EditorTabBar({ tabs, actions }: { tabs: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex h-[35px] shrink-0 items-stretch bg-titlebar">
      <div role="tablist" aria-label="已開啟的檔案" className="flex min-w-0 shrink-[10] items-stretch overflow-hidden">
        {tabs}
      </div>
      <div className="flex min-w-0 flex-auto items-center justify-end-safe overflow-x-auto px-2">{actions}</div>
    </div>
  )
}

/**
 * 一個分頁：非作用底 --bg-tab-inactive 字 --fg-muted；作用底 --bg-tab-active 字白。
 * `×` 只在 hover 顯示（裝飾，不可關閉）；dirty 時常駐 `●`（仿未儲存）。
 */
export function EditorTab(props: { name: string; glyph: string; glyphClass: string; active?: boolean; dirty?: boolean }) {
  const { name, glyph, glyphClass, active = false, dirty = false } = props
  return (
    <div
      role="tab"
      aria-selected={active}
      aria-label={dirty ? `${name}（未儲存）` : name}
      className={`group flex min-w-0 shrink-0 items-center gap-[6px] border-r border-border px-[10px] ${
        active ? 'bg-tab-active text-fg-statusbar' : 'bg-tab-inactive text-fg-muted'
      }`}
    >
      <FileGlyphIcon glyph={glyph} className={glyphClass} />
      <span className="truncate">{name}</span>
      <span aria-hidden="true" className="flex w-4 shrink-0 items-center justify-center">
        {dirty ? (
          <span className="text-fg-statusbar">{DIRTY_MARK}</span>
        ) : (
          <span className="invisible group-hover:visible">
            <CloseIcon size={14} />
          </span>
        )}
      </span>
    </div>
  )
}

/** 假行號：`1..N` 依自身高度 / 18px 產生，右對齊、--fg-muted，純裝飾（對比可低於 4.5:1） */
export function Gutter() {
  const ref = useRef<HTMLDivElement>(null)
  const height = useElementHeight(ref)
  const lines = gutterLineCount(height)
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="w-[40px] shrink-0 overflow-hidden pr-2 text-right leading-[18px] text-fg-muted select-none"
    >
      {Array.from({ length: lines }, (_, i) => (
        <div key={i}>{i + 1}</div>
      ))}
    </div>
  )
}
