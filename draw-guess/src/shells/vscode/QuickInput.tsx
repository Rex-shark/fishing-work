// 快速輸入框（仿 VS Code 命令面板 / Quick Pick；DESIGN.md §5「畫面」、§4 陰影與圓角）＝ vscode 主題的對話框呈現。
// 用於出題、放棄確認、切換偽裝的快速選單；自動重連畫面只放一行提示（QuickInputNotice）。上方一個輸入框（可省略），下方一串選項；Enter 執行反白的選項、↑↓ 切換、Esc 關閉。
// Enter 走 form 原生 submit（單一文字欄位的隱式送出），注音等輸入法選字的 Enter 不會觸發（踩雷紀錄 Phase 3）。
// 功能元件以 ShellViews.Dialog（shells/views.ts）使用，本主題的實作為檔尾的 VscodeDialog。
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import type { DialogProps, DialogPurpose } from '../views'

export interface QuickItem {
  id: string
  label: ReactNode
  /** 右側說明（快捷鍵、字數、倒數） */
  detail?: ReactNode
  onSelect(): void
  disabled?: boolean
}

export interface QuickInputField {
  value: string
  onChange(value: string): void
  placeholder: string
  ariaLabel: string
  disabled?: boolean
  maxLength?: number
  invalid?: boolean
  enterKeyHint?: 'go' | 'send' | 'done'
}

interface QuickInputProps {
  /** 對話框的無障礙名稱 */
  label: string
  /** 輸入框；省略時為純選單（例如放棄確認），焦點落在選單上 */
  input?: QuickInputField
  /** 選單上方的說明列（純選單時當提問） */
  title?: ReactNode
  items: QuickItem[]
  onEscape?: () => void
  /** 框內最下方的訊息（錯誤以 text-sem-error 顯示） */
  message?: ReactNode
  /** 定位用 class（absolute／top 等由呼叫端決定） */
  className?: string
  /** 一開始反白的選項（預設第一個） */
  initialActive?: number
}

/** 快速輸入框的外框樣式（QuickInput 與 QuickInputNotice 共用） */
const QUICK_INPUT_BOX = 'z-30 w-[600px] max-w-[calc(100%-32px)] rounded-[3px] border border-border bg-quickinput p-[6px] text-[13px] text-fg shadow-quickinput'

export function QuickInput({ label, input, title, items, onEscape, message, className, initialActive = 0 }: QuickInputProps) {
  const [active, setActive] = useState(initialActive)
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useId()
  const activeIndex = Math.min(active, Math.max(0, items.length - 1))
  const activeItem = items[activeIndex] as QuickItem | undefined

  // 純選單：開啟時把焦點放到選單上，鍵盤可直接操作
  useEffect(() => {
    if (input === undefined) listRef.current?.focus()
  }, [input])

  function run(item: QuickItem | undefined) {
    if (item !== undefined && !item.disabled) item.onSelect()
  }

  function move(delta: number) {
    if (items.length === 0) return
    setActive((activeIndex + delta + items.length) % items.length)
  }

  /** ↑↓ 切換、Esc 關閉；輸入法組字中一律不攔截 */
  function handleKeyDown(e: KeyboardEvent<HTMLElement>, handleEnter: boolean) {
    if (e.nativeEvent.isComposing) return
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        move(1)
        break
      case 'ArrowUp':
        e.preventDefault()
        move(-1)
        break
      case 'Escape':
        if (onEscape) {
          e.preventDefault()
          onEscape()
        }
        break
      case 'Enter':
        if (handleEnter) {
          e.preventDefault()
          run(activeItem)
        }
        break
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    run(activeItem)
  }

  const optionId = (i: number) => `${listId}-opt-${i}`

  return (
    <form
      role="dialog"
      aria-label={label}
      onSubmit={handleSubmit}
      className={`${QUICK_INPUT_BOX} ${className ?? ''}`}
    >
      {title !== undefined && <div className="px-1 pb-1 leading-[22px] text-fg">{title}</div>}

      {input !== undefined && (
        <input
          autoFocus
          value={input.value}
          onChange={(e) => input.onChange(e.target.value)}
          onKeyDown={(e) => handleKeyDown(e, false)}
          disabled={input.disabled}
          maxLength={input.maxLength}
          placeholder={input.placeholder}
          aria-label={input.ariaLabel}
          aria-invalid={input.invalid}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeItem ? optionId(activeIndex) : undefined}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint={input.enterKeyHint}
          className="block h-[26px] w-full rounded-[2px] border border-input bg-input px-[6px] text-fg outline-none placeholder:text-fg-muted focus:border-border-focus disabled:opacity-60"
        />
      )}

      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={label}
        tabIndex={input === undefined ? 0 : -1}
        aria-activedescendant={input === undefined && activeItem ? optionId(activeIndex) : undefined}
        onKeyDown={input === undefined ? (e) => handleKeyDown(e, true) : undefined}
        className={`${input !== undefined ? 'mt-[6px]' : ''} rounded-[2px] outline-none focus-visible:outline-1 focus-visible:outline-border-focus`}
      >
        {items.map((item, i) => {
          const selected = i === activeIndex
          return (
            <li
              key={item.id}
              id={optionId(i)}
              role="option"
              aria-selected={selected}
              aria-disabled={item.disabled}
              onMouseDown={(e) => e.preventDefault() /* 保持輸入框焦點 */}
              onMouseEnter={() => setActive(i)}
              onClick={() => run(item)}
              className={`flex h-[22px] items-center gap-2 rounded-[2px] px-[6px] transition-colors duration-100 ${
                item.disabled ? 'cursor-default opacity-50' : 'cursor-pointer'
              } ${selected ? 'bg-active text-fg-statusbar' : 'text-fg hover:bg-hover'}`}
            >
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.detail !== undefined && (
                <span className={`shrink-0 tabular-nums ${selected ? 'text-fg-statusbar' : 'text-fg'}`}>{item.detail}</span>
              )}
            </li>
          )
        })}
      </ul>

      {message}
    </form>
  )
}

/** 快速輸入框內的錯誤列（DESIGN §5：以 --sem-error 顯示在框內下方） */
export function QuickInputError({ children }: { children: ReactNode }) {
  return (
    <p className="mt-1 truncate px-[6px] leading-[18px] text-sem-error" role="alert">
      ✗ {children}
    </p>
  )
}

/** 快速輸入框內的提示列（例如「// 正在重新加入…」） */
export function QuickInputNote({ children }: { children: ReactNode }) {
  return <p className="mt-1 truncate px-[6px] leading-[18px] text-sem-comment">{children}</p>
}

/**
 * 自動重連畫面（ShellProps screen 'resume'）的快速輸入框：沒有輸入框與選項，只放一行註解式提示，
 * 位置同舊登入框（視窗頂部置中）。role="status" 讓報讀器唸出進度
 */
export function QuickInputNotice({ notice }: { notice: string }) {
  return (
    <div role="status" aria-live="polite" className={`${QUICK_INPUT_BOX} absolute top-2 left-1/2 -translate-x-1/2`}>
      <p className="truncate px-[6px] leading-[22px] text-sem-comment">{`// ${notice}`}</p>
    </div>
  )
}

// ─── vscode 主題的對話框（ShellViews.Dialog） ─────────────────────────

/** 位置：遊戲中浮在編輯區分頁列（35px）下方置中（DESIGN §5「畫面」） */
const DIALOG_POSITION: Record<DialogPurpose, string> = {
  topic: 'absolute top-[35px] left-1/2 -translate-x-1/2',
  cancelRound: 'absolute top-[35px] left-1/2 -translate-x-1/2',
}

/** 選項前綴 `› `、提問白字、提示以註解 `// ` 呈現（仿命令面板與程式註解） */
export function VscodeDialog({ purpose, label, input, title, items, onEscape, note, error }: DialogProps) {
  return (
    <QuickInput
      label={label}
      className={DIALOG_POSITION[purpose]}
      input={input}
      title={title !== undefined ? <span className="text-fg">{title}</span> : undefined}
      items={items.map((item) => ({ ...item, label: `› ${item.label}` }))}
      onEscape={onEscape}
      message={
        <>
          {note != null && <QuickInputNote>{`// ${note}`}</QuickInputNote>}
          {error != null && <QuickInputError>{error}</QuickInputError>}
        </>
      }
    />
  )
}
