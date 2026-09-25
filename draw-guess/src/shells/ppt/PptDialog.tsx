// ppt 主題的對話框（ShellViews.Dialog；DESIGN.md §13.2「對話框」、§13.3）：取代 vscode 的快速輸入框。
//   白底、標題列（「輸入標題」「捨棄變更？」＋右上關閉）、內文（提問／輸入框／提示／錯誤）、右下「確定」（主要）「取消」。
//   寬 420px，置中於殼層提供的定位容器。自動重連畫面只放一行提示（PptResumeDialog）。
// 按鍵：Enter＝確定（第一個選項）：走 form 原生 submit（單一文字欄位的隱式送出），注音等輸入法選字的 Enter 不會觸發；
//   沒有輸入框時焦點放在「確定」，Enter 由按鈕原生啟動。Esc＝取消（onEscape；沒有時為第二個選項）。
// 不可按的選項只設 aria-disabled（原生 disabled 收不到指標事件，Tooltip 出不來；踩雷紀錄 Epic 3 Phase 2）。
import { useId, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { CloseIcon } from '../../layout/icons'
import { tip } from '../../layout/tooltipPlacement'
import type { DialogItem, DialogProps } from '../views'
import { PPT_DIALOG_TITLE, PPT_RESUME_TITLE, dialogButtonLabel, dialogButtonText, dialogKeyAction } from './pptLayout'

export function PptDialog({ purpose, label, input, title, items, onEscape, note, error }: DialogProps) {
  const fieldId = useId()
  const primary = items[0] as DialogItem | undefined
  const secondary = items[1] as DialogItem | undefined

  function run(item: DialogItem | undefined) {
    if (item !== undefined && !item.disabled) item.onSelect()
  }

  // Esc 與標題列關閉鈕：onEscape 優先；沒有時執行第二個選項（「取消」）
  const cancel = onEscape ?? (secondary !== undefined ? () => run(secondary) : undefined)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    run(primary)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    if (dialogKeyAction(e.key, e.nativeEvent.isComposing) === 'cancel' && cancel !== undefined) {
      e.preventDefault()
      cancel()
    }
  }

  return (
    <PptDialogFrame
      as="form"
      label={label}
      heading={PPT_DIALOG_TITLE[purpose]}
      onSubmit={handleSubmit}
      onKeyDown={handleKeyDown}
      onClose={cancel}
    >
      {title !== undefined && <p className="mb-3 leading-[20px] text-fg">{title}</p>}

      {input !== undefined && (
        <div className="mb-1">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <label htmlFor={fieldId} className="text-fg">
              {input.ariaLabel}
            </label>
            {primary?.detail !== undefined && <span className="shrink-0 text-[12px] text-fg-muted tabular-nums">{primary.detail}</span>}
          </div>
          <input
            id={fieldId}
            autoFocus
            value={input.value}
            onChange={(e) => input.onChange(e.target.value)}
            disabled={input.disabled}
            maxLength={input.maxLength}
            placeholder={input.placeholder}
            aria-invalid={input.invalid}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint={input.enterKeyHint}
            className="block h-[26px] w-full rounded-[2px] border border-border bg-input px-[6px] text-fg outline-none placeholder:text-fg-muted focus:border-border-focus aria-[invalid=true]:border-sem-error disabled:opacity-60"
          />
        </div>
      )}

      {note != null && <p className="mt-2 truncate leading-[18px] text-fg-muted">{note}</p>}
      {error != null && (
        <p className="mt-2 leading-[18px] text-sem-error" role="alert">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {items.map((item, i) => (
          <DialogButton key={item.id} item={item} index={i} autoFocus={input === undefined && i === 0} onRun={() => run(item)} />
        ))}
      </div>
    </PptDialogFrame>
  )
}

/** 右下按鈕：第一個為主要（確定，type=submit 以承接 Enter 的隱式送出）、其餘為次要 */
function DialogButton({ item, index, autoFocus, onRun }: { item: DialogItem; index: number; autoFocus: boolean; onRun: () => void }) {
  const primary = index === 0
  const ariaLabel = dialogButtonLabel(index, item.label)
  return (
    <button
      type={primary ? 'submit' : 'button'}
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      aria-disabled={item.disabled || undefined}
      {...(ariaLabel !== item.label || item.disabled ? tip(item.label, 'top') : {})}
      onClick={primary ? undefined : onRun}
      className={`h-[26px] min-w-[80px] rounded-[2px] px-3 transition-colors duration-100 focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-border-focus ${
        primary
          ? 'bg-accent text-fg-statusbar hover:bg-accent-hover aria-disabled:hover:bg-accent'
          : 'border border-border bg-button-secondary text-fg hover:bg-button-secondary-hover aria-disabled:hover:bg-button-secondary'
      } ${item.disabled ? 'cursor-default opacity-60' : 'cursor-pointer'}`}
    >
      {dialogButtonText(index, item.label)}
    </button>
  )
}

/**
 * 自動重連畫面（ShellProps screen 'resume'）的對話框：標題列＋一行提示，沒有輸入框、按鈕與關閉鈕。
 * 提示以 role="status" 讓報讀器唸出進度
 */
export function PptResumeDialog({ notice }: { notice: string }) {
  return (
    <PptDialogFrame as="div" label={PPT_RESUME_TITLE} heading={PPT_RESUME_TITLE}>
      <p role="status" aria-live="polite" className="truncate leading-[18px] text-fg-muted">
        {notice}
      </p>
    </PptDialogFrame>
  )
}

/**
 * PowerPoint 風格的對話框外框（遊戲的對話框、「切換偽裝」與自動重連共用）：白底、1px 邊框、浮出陰影；
 * 標題列（左標題、右關閉鈕）＋內文。置中於最近的定位祖先（殼層提供 relative 容器）。
 */
export function PptDialogFrame(props: {
  as: 'form' | 'div'
  label: string
  heading: string
  onSubmit?: (e: FormEvent) => void
  onKeyDown?: (e: KeyboardEvent<HTMLFormElement & HTMLDivElement>) => void
  onClose?: () => void
  children: ReactNode
}) {
  const { as: Tag, label, heading, onSubmit, onKeyDown, onClose, children } = props
  const headingId = useId()
  return (
    <Tag
      role="dialog"
      aria-label={label}
      aria-describedby={headingId}
      onSubmit={onSubmit}
      onKeyDown={onKeyDown}
      className="absolute top-1/2 left-1/2 z-30 max-h-[calc(100%-16px)] w-[420px] max-w-[calc(100%-32px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[2px] border border-border bg-quickinput text-[13px] text-fg shadow-quickinput"
    >
      <div className="flex h-[32px] items-center justify-between pr-1 pl-4">
        <span id={headingId} className="truncate text-fg">
          {heading}
        </span>
        {onClose !== undefined && (
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉"
            {...tip('關閉', 'top')}
            className="flex h-[26px] w-[32px] cursor-pointer items-center justify-center rounded-[2px] text-fg transition-colors duration-100 hover:bg-hover focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-border-focus"
          >
            <CloseIcon />
          </button>
        )}
      </div>
      <div className="px-4 pt-1 pb-4">{children}</div>
    </Tag>
  )
}
