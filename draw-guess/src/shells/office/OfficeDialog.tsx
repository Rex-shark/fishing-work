// Office 對話框（ppt 與 excel 共用；Epic 13 決策 4 由 ppt/PptDialog 抽出，ppt 的輸出與抽出前逐字相同；DESIGN.md §13.2「對話框」、§17.2）：
//   白底、標題列（殼層給的標題：ppt「輸入標題」「捨棄變更？」、excel「替代文字」「刪除圖片？」＋右上關閉）、
//   內文（殼層給的說明一行（選填，excel 出題「為這張圖片輸入描述」）／提問／輸入框／提示／錯誤）、右下「確定」（主要）「取消」
//   （按鈕文字殼層可依用途改，excel 放棄確認為「刪除」）。寬 420px，置中於殼層提供的定位容器。
//   殼層以 OfficeDialogConfig 決定上述文字（各殼層包一層成 ShellViews.Dialog）；自動重連畫面只放一行提示（OfficeResumeDialog）。
// 按鍵：Enter＝確定（第一個選項）：走 form 原生 submit（單一文字欄位的隱式送出），注音等輸入法選字的 Enter 不會觸發；
//   沒有輸入框時焦點放在「確定」，Enter 由按鈕原生啟動。Esc＝取消（onEscape；沒有時為第二個選項）。
// 不可按的選項只設 aria-disabled（原生 disabled 收不到指標事件，Tooltip 出不來；踩雷紀錄 Epic 3 Phase 2）。
// 遊戲說明（purpose 'help'，Epic 6；DESIGN §16）：標題列顯示 title（「說明」或主題名稱）、內文 body 為 14px 段落（段距 8px）；
//   沒有 body 時 items 為主題清單（一列一個按鈕，↑↓／Home／End 移動）＋右下「關閉」；有 body 時按鈕顯示選項原文（「返回」「關閉」）。
//   body 未提供時輸出與 Epic 6 前完全相同。
import { useId, useRef, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { CloseIcon } from '../../layout/icons'
import { tip } from '../../layout/tooltipPlacement'
import type { DialogItem, DialogProps, DialogPurpose } from '../views'
import { DIALOG_CLOSE, dialogButtonText, dialogKeyAction, officeButtonLabel } from './officeLayout'

/** 殼層決定的對話框文字（ppt：PPT_DIALOG_CONFIG；excel：EXCEL_DIALOG_CONFIG） */
export interface OfficeDialogConfig {
  /** 標題列文字（說明對話框有 title 時改顯示 title） */
  titles: Record<DialogPurpose, string>
  /** 標題列下方的說明一行（選填；excel 出題「為這張圖片輸入描述」） */
  descriptions?: Partial<Record<DialogPurpose, string>>
  /** 右下按鈕的可見文字；省略或回 undefined＝預設（第一個「確定」、第二個「取消」、其餘照選項文字） */
  buttonText?: (purpose: DialogPurpose, index: number, label: string) => string | undefined
}

export function OfficeDialog(props: DialogProps & { config: OfficeDialogConfig }) {
  const { purpose, label, input, title, body, items, onEscape, note, error, config } = props
  const fieldId = useId()
  const description = config.descriptions?.[purpose]
  // 說明：title 當標題列文字、按鈕顯示選項原文
  const help = purpose === 'help'
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
    <OfficeDialogFrame
      as="form"
      label={label}
      heading={help && title !== undefined ? title : config.titles[purpose]}
      onSubmit={handleSubmit}
      onKeyDown={handleKeyDown}
      onClose={cancel}
    >
      {description !== undefined && <p className="mb-3 leading-[20px] text-fg">{description}</p>}
      {title !== undefined && !help && <p className="mb-3 leading-[20px] text-fg">{title}</p>}
      {body !== undefined && <div className="flex flex-col gap-[8px] text-[14px] leading-[20px] text-fg">{body}</div>}

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

      {help && body === undefined ? (
        <HelpTopicList items={items} onRun={run} onClose={cancel} />
      ) : (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {items.map((item, i) => (
            <DialogButton
              key={item.id}
              item={item}
              text={help ? item.label : (config.buttonText?.(purpose, i, item.label) ?? dialogButtonText(i, item.label))}
              primary={i === 0}
              autoFocus={input === undefined && i === 0}
              onRun={() => run(item)}
            />
          ))}
        </div>
      )}
    </OfficeDialogFrame>
  )
}

/**
 * 右下按鈕：第一個為主要（確定，type=submit 以承接 Enter 的隱式送出）、其餘為次要。
 * text：可見文字（預設「確定」「取消」；說明對話框為選項原文）；無障礙名稱以可見文字開頭再補實際動作
 */
function DialogButton(props: { item: DialogItem; text: string; primary: boolean; autoFocus: boolean; onRun: () => void }) {
  const { item, text, primary, autoFocus, onRun } = props
  const ariaLabel = officeButtonLabel(text, item.label)
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
      {text}
    </button>
  )
}

/** 說明的主題清單（第一步）：白底清單框、一列一個按鈕（點選即進入該主題），開啟時焦點在第一列；右下「關閉」 */
function HelpTopicList({ items, onRun, onClose }: { items: DialogItem[]; onRun: (item: DialogItem) => void; onClose?: () => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  function handleKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    const current = refs.current.findIndex((el) => el === document.activeElement)
    const last = items.length - 1
    const next =
      e.key === 'ArrowDown' ? (current + 1) % items.length
      : e.key === 'ArrowUp' ? (current - 1 + items.length) % items.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : null
    if (next === null || items.length === 0) return
    e.preventDefault()
    refs.current[next]?.focus()
  }

  return (
    <>
      <ul onKeyDown={handleKeyDown} className="rounded-[2px] border border-border bg-input py-1">
        {items.map((item, i) => (
          <li key={item.id}>
            <button
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              autoFocus={i === 0}
              aria-disabled={item.disabled || undefined}
              onClick={() => onRun(item)}
              className="flex h-[32px] w-full cursor-pointer items-center px-3 text-left text-fg transition-colors duration-100 outline-none hover:bg-hover focus:bg-active focus:text-fg-on-active"
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
      {onClose !== undefined && (
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-[26px] min-w-[80px] cursor-pointer rounded-[2px] border border-border bg-button-secondary px-3 text-fg transition-colors duration-100 hover:bg-button-secondary-hover focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          >
            {DIALOG_CLOSE}
          </button>
        </div>
      )}
    </>
  )
}

/**
 * 自動重連畫面（ShellProps screen 'resume'）的對話框：標題列＋一行提示，沒有輸入框、按鈕與關閉鈕。
 * 提示以 role="status" 讓報讀器唸出進度
 */
export function OfficeResumeDialog({ title, notice }: { title: string; notice: string }) {
  return (
    <OfficeDialogFrame as="div" label={title} heading={title}>
      <p role="status" aria-live="polite" className="truncate leading-[18px] text-fg-muted">
        {notice}
      </p>
    </OfficeDialogFrame>
  )
}

/**
 * Office 風格的對話框外框（遊戲的對話框、「切換偽裝」與自動重連共用）：白底、1px 邊框、浮出陰影；
 * 標題列（左標題、右關閉鈕）＋內文。置中於最近的定位祖先（殼層提供 relative 容器）。
 */
export function OfficeDialogFrame(props: {
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
