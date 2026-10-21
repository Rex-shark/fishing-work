// meet 主題的對話框（ShellViews.Dialog；DESIGN.md §15.2「對話框」、§15.3；spec/song-guess/design.md §1「出題（選題庫）」）。
//   白卡片（--bg-panel、圓角 8px、--quickinput-shadow；--bg-quickinput 在 meet 是工具提示用的深灰）、標題 20px（出題＝「分享音訊」）、內文 14px、
//   右下藍字文字按鈕（--accent-panel；出題「取消／分享」，送出中主要按鈕改顯示「搜尋中…」（歌手、動漫熱門）／「取得排行榜…」（榜單））。寬 420px，置中於殼層提供的定位容器（主畫面 tile）。
//   出題（Epic 18）：標題下方 segmented 四選一（choices，role="radiogroup"：選中者 --accent-panel 字＋ --bg-panel-hover 底；Epic 19 加「動漫熱門」，
//   對話框內文窄於 340px（375px 手機）時以 CSS 換成兩列 2×2，meetLayout.segmentedGroupClass）；
//   歌手模式＝欄位＋下方勾選（toggle，原生 checkbox、accent-color --accent-panel）；現成題庫（榜單、動漫熱門）＝一行說明（description，--fg-on-panel-muted）＋右側倒數。
//   design §1 寫說明用 --fg-muted，但白卡片上只用面板 token（下一行），對應的是 --fg-on-panel-muted。
//   自動重連畫面只放一行提示（MeetResumeCard）。
// 白底只用面板 token（--fg-on-panel／--fg-on-panel-muted／--border-panel／--accent-panel）與 --bg-input、--sem-error，不用深色區的 --fg。
// 按鍵：Enter＝第一個選項（主要，畫面最右）：走 form 原生 submit（單一文字欄位的隱式送出），注音等輸入法選字的 Enter 不會觸發；
//   沒有輸入框時焦點放在主要按鈕，Enter 由按鈕原生啟動。Esc＝取消（onEscape；沒有時為第二個選項）。
// 不可按的選項只設 aria-disabled（原生 disabled 收不到指標事件，Tooltip 出不來；踩雷紀錄 Epic 3 Phase 2）。
// 遊戲說明（purpose 'help'；DESIGN §16）：標題為 title（「說明」或主題名稱）、內文 body 為 14px 段落（段距 8px、--fg-on-panel）；
//   沒有 body 時 items 為主題清單（一列一個按鈕，↑↓／Home／End 移動）＋右下「關閉」；有 body 時按鈕顯示選項原文（「關閉」「返回」，主要在最右）。
// 送出中（DialogProps.busy；出題＝搜尋中；plan/notes.md 2026-10-12）：輸入框改 readOnly＋aria-busy（外觀同原本的停用：opacity .6），不用原生 disabled，
//   焦點留在輸入框，送出失敗後 Esc／Enter 照常可用；busy 結束時若焦點已不在對話框內，放回輸入框（沒有輸入框時放回第一個可用選項＝主要按鈕；shells/dialogFocus）。
import { useId, useRef, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { tip } from '../../layout/tooltipPlacement'
import { useRestoreDialogFocus } from '../dialogFocus'
import type { DialogChoices, DialogItem, DialogProps, DialogPurpose, DialogToggle } from '../views'
import {
  HELP_CLOSE_TEXT,
  MEET_DIALOG_REFOCUS_SELECTORS,
  MEET_RESUME_TEXT,
  choiceKeyTarget,
  dialogKeyAction,
  meetDialogButtonLabel,
  meetDialogButtonText,
  meetDialogHeading,
  segmentedGroupClass,
} from './meetLayout'

export function MeetDialog({ purpose, label, choices, input, toggle, description, title, body, items, onEscape, busy = false, note, error }: DialogProps) {
  const fieldId = useId()
  const rootRef = useRef<(HTMLFormElement & HTMLDivElement) | null>(null)
  // 保險：busy 結束時焦點若已不在對話框內（掉到 body），放回輸入框或第一個可用選項；Esc／Enter 掛在對話框上，焦點在外面就收不到
  useRestoreDialogFocus(busy, rootRef, MEET_DIALOG_REFOCUS_SELECTORS)
  const primary = items[0] as DialogItem | undefined
  const secondary = items[1] as DialogItem | undefined

  function run(item: DialogItem | undefined) {
    if (item !== undefined && !item.disabled) item.onSelect()
  }

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
    <MeetCard
      as="form"
      rootRef={rootRef}
      label={label}
      heading={meetDialogHeading(purpose, title)}
      onSubmit={handleSubmit}
      onKeyDown={handleKeyDown}
    >
      {title !== undefined && purpose !== 'help' && <p className="mb-[12px] text-[14px] leading-[20px] text-fg-on-panel">{title}</p>}
      {body !== undefined && <div className="flex flex-col gap-[8px] text-[14px] leading-[20px] text-fg-on-panel">{body}</div>}

      {choices !== undefined && <Segmented choices={choices} onEnter={() => run(primary)} />}

      {input === undefined && description !== undefined && (
        <div className="mb-[4px] flex items-baseline justify-between gap-[8px]">
          <p className="min-w-0 text-[14px] leading-[20px] text-fg-on-panel-muted">{description}</p>
          {primary?.detail !== undefined && (
            <span className="shrink-0 text-[12px] text-fg-on-panel-muted tabular-nums">{primary.detail}</span>
          )}
        </div>
      )}

      {input !== undefined && (
        <div className="mb-[4px]">
          <div className="mb-[4px] flex items-baseline justify-between gap-[8px]">
            <label htmlFor={fieldId} className="text-[14px] text-fg-on-panel">
              {input.ariaLabel}
            </label>
            {primary?.detail !== undefined && (
              <span className="shrink-0 text-[12px] text-fg-on-panel-muted tabular-nums">{primary.detail}</span>
            )}
          </div>
          <input
            id={fieldId}
            autoFocus={input.autoFocus ?? true}
            value={input.value}
            onChange={(e) => input.onChange(e.target.value)}
            // 送出中：readOnly＋aria-busy，不用原生 disabled（會失去焦點）
            readOnly={busy}
            aria-busy={busy || undefined}
            maxLength={input.maxLength}
            placeholder={input.placeholder}
            aria-invalid={input.invalid}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint={input.enterKeyHint}
            data-dialog-input=""
            className="block h-[40px] w-full rounded-[4px] border border-border-panel bg-input px-[12px] text-[14px] text-fg-on-panel outline-none placeholder:text-fg-on-panel-muted focus:border-accent-panel aria-[invalid=true]:border-sem-error aria-busy:cursor-default aria-busy:opacity-60"
          />
          {toggle !== undefined && <Toggle toggle={toggle} />}
        </div>
      )}

      {note != null && <p className="mt-[8px] truncate text-[14px] leading-[20px] text-fg-on-panel-muted">{note}</p>}
      {error != null && (
        <p className="mt-[8px] text-[14px] leading-[20px] text-sem-error" role="alert">
          {error}
        </p>
      )}

      {purpose === 'help' && body === undefined ? (
        <HelpTopicList items={items} onRun={run} onClose={cancel} />
      ) : (
        /* 畫面上由左而右：次要…主要（Meet 的主要動作在最右）；DOM 同畫面順序 */
        <div className="mt-[20px] flex flex-wrap justify-end gap-[8px]">
          {items
            .map((item, index) => ({ item, index }))
            .reverse()
            .map(({ item, index }) => (
              <DialogButton
                key={item.id}
                purpose={purpose}
                item={item}
                index={index}
                autoFocus={input === undefined && index === 0}
                onRun={() => run(item)}
              />
            ))}
        </div>
      )}
    </MeetCard>
  )
}

/**
 * 出題的題庫來源（segmented 四選一）：role="radiogroup"，一個選項一顆 role="radio" 的按鈕；
 * 外層 @container 量對話框內文寬，選項多且放不下時換成兩列（segmentedGroupClass；DOM 與方向鍵順序不變）；
 * 只有選中的那顆在 Tab 順序裡（roving tabindex），←→↑↓／Home／End 切換並選取（meetLayout.choiceKeyTarget）；Enter＝送出（同主要按鈕）。
 * locked（送出中）：aria-disabled、點了或按方向鍵都不切換，焦點留在原處（不用原生 disabled）
 */
function Segmented({ choices, onEnter }: { choices: DialogChoices; onEnter: () => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const { options, value, onChange, locked = false } = choices
  const current = options.findIndex((o) => o.id === value)

  function select(index: number) {
    const option = options[index]
    if (locked || option === undefined) return
    if (option.id !== value) onChange(option.id)
    refs.current[index]?.focus()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing) return
      // type="button" 的按鈕按 Enter 原本是「點一下」；這裡改成送出，與在欄位裡按 Enter 一致
      e.preventDefault()
      onEnter()
      return
    }
    const target = choiceKeyTarget(e.key, current, options.length)
    if (target === null) return
    e.preventDefault()
    select(target)
  }

  return (
    <div className="@container mb-[16px]">
      <div
        role="radiogroup"
        aria-label={choices.label}
        aria-disabled={locked || undefined}
        onKeyDown={handleKeyDown}
        className={segmentedGroupClass(options.length)}
      >
        {options.map((option, i) => {
          const checked = option.id === value
          return (
            <button
              key={option.id}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-disabled={locked || undefined}
              tabIndex={checked || (current < 0 && i === 0) ? 0 : -1}
              data-source-option={option.id}
              onClick={() => select(i)}
              className={`h-[32px] min-w-0 flex-1 truncate rounded-full px-[8px] text-[14px] transition-colors duration-100 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-panel ${
                checked ? 'bg-panel-hover font-medium text-accent-panel' : 'text-fg-on-panel'
              } ${locked ? 'cursor-default' : checked ? 'cursor-pointer' : 'cursor-pointer hover:bg-panel-hover'}`}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** 歌手欄位下方的勾選：原生 checkbox（Space 切換）；locked 時 aria-disabled、onChange 不理會（受控值不變），焦點留在原處 */
function Toggle({ toggle }: { toggle: DialogToggle }) {
  const { label, checked, onChange, locked = false } = toggle
  return (
    <label className={`mt-[8px] flex w-fit items-center gap-[8px] text-[14px] leading-[20px] text-fg-on-panel ${locked ? 'cursor-default opacity-60' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        checked={checked}
        aria-disabled={locked || undefined}
        onChange={(e) => {
          if (!locked) onChange(e.target.checked)
        }}
        data-dialog-toggle=""
        className="size-[16px] shrink-0 cursor-[inherit] accent-accent-panel"
      />
      {label}
    </label>
  )
}

/** 說明的主題清單（第一步）：一列一個按鈕（點選即進入該主題，hover／focus 底 --bg-panel-hover），開啟時焦點在第一列；右下「關閉」 */
function HelpTopicList({ items, onRun, onClose }: { items: DialogItem[]; onRun: (item: DialogItem) => void; onClose?: () => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  function handleKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    const current = refs.current.findIndex((el) => el === document.activeElement)
    const next =
      e.key === 'ArrowDown' ? (current + 1) % items.length
      : e.key === 'ArrowUp' ? (current - 1 + items.length) % items.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? items.length - 1
      : null
    if (next === null || items.length === 0) return
    e.preventDefault()
    refs.current[next]?.focus()
  }

  return (
    <>
      <ul onKeyDown={handleKeyDown} className="-mx-[8px] flex flex-col gap-[2px]">
        {items.map((item, i) => (
          <li key={item.id}>
            <button
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              autoFocus={i === 0}
              aria-disabled={item.disabled || undefined}
              data-dialog-option=""
              onClick={() => onRun(item)}
              className="flex h-[40px] w-full cursor-pointer items-center rounded-[4px] px-[8px] text-left text-[14px] text-fg-on-panel transition-colors duration-100 outline-none hover:bg-panel-hover focus:bg-panel-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-panel"
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
      {onClose !== undefined && (
        <div className="mt-[20px] flex justify-end gap-[8px]">
          <button
            type="button"
            onClick={onClose}
            className="h-[36px] min-w-[64px] cursor-pointer rounded-[4px] px-[12px] text-[14px] font-medium text-accent-panel transition-colors duration-100 hover:bg-panel-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-panel"
          >
            {HELP_CLOSE_TEXT}
          </button>
        </div>
      )}
    </>
  )
}

/**
 * 文字按鈕：第一個選項為主要（type=submit 以承接 Enter 的隱式送出），其餘 type=button。
 * data-dialog-option（dialogFocus.DIALOG_OPTION_ATTR）：標記為對話框的選項，busy 結束後還原焦點時用
 */
function DialogButton(props: { purpose: DialogPurpose; item: DialogItem; index: number; autoFocus: boolean; onRun: () => void }) {
  const { purpose, item, index, autoFocus, onRun } = props
  const primary = index === 0
  const pending = item.pending === true
  const ariaLabel = meetDialogButtonLabel(purpose, index, item.label, pending)
  return (
    <button
      type={primary ? 'submit' : 'button'}
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      aria-disabled={item.disabled || undefined}
      aria-busy={pending || undefined}
      data-dialog-option=""
      {...(ariaLabel !== item.label || item.disabled ? tip(item.label, 'top') : {})}
      onClick={primary ? undefined : onRun}
      className={`h-[36px] min-w-[64px] rounded-[4px] px-[12px] text-[14px] font-medium text-accent-panel transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-panel ${
        item.disabled ? 'cursor-default opacity-60' : 'cursor-pointer hover:bg-panel-hover'
      }`}
    >
      {meetDialogButtonText(purpose, index, item.label, pending)}
    </button>
  )
}

/**
 * 自動重連畫面（ShellProps screen 'resume'）的白卡片：只有一行「正在重新加入通話…」（role="status"），沒有按鈕。
 * App 給的 notice（「正在重新加入…」）改以 Meet 用語呈現，與 ppt「新增註解…」取代 placeholder 同一做法
 */
export function MeetResumeCard() {
  return (
    <MeetCard as="div" label={MEET_RESUME_TEXT}>
      <p role="status" aria-live="polite" className="truncate text-[16px] leading-[24px] text-fg-on-panel">
        {MEET_RESUME_TEXT}
      </p>
    </MeetCard>
  )
}

/** Meet 風格的白卡片外框：標題（可省略）＋內文；置中於最近的定位祖先 */
export function MeetCard(props: {
  as: 'form' | 'div'
  label: string
  heading?: string
  onSubmit?: (e: FormEvent) => void
  onKeyDown?: (e: KeyboardEvent<HTMLFormElement & HTMLDivElement>) => void
  /** 對話框根節點（呼叫端要查焦點是否還在對話框內時用） */
  rootRef?: RefObject<(HTMLFormElement & HTMLDivElement) | null>
  children: ReactNode
}) {
  const { as: Tag, label, heading, onSubmit, onKeyDown, rootRef, children } = props
  const headingId = useId()
  return (
    <Tag
      ref={rootRef}
      role="dialog"
      aria-label={label}
      aria-describedby={heading !== undefined ? headingId : undefined}
      onSubmit={onSubmit}
      onKeyDown={onKeyDown}
      className="absolute top-1/2 left-1/2 z-30 max-h-[calc(100%-16px)] w-[420px] max-w-[calc(100%-32px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[8px] bg-panel px-[24px] pt-[20px] pb-[16px] text-[14px] text-fg-on-panel shadow-quickinput"
    >
      {heading !== undefined && (
        <h2 id={headingId} className="mb-[16px] truncate text-[20px] leading-[28px] font-normal text-fg-on-panel">
          {heading}
        </h2>
      )}
      {children}
    </Tag>
  )
}
