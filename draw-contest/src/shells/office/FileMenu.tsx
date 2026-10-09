// Office 殼層（ppt、excel）進遊戲後的「切換偽裝」入口（plan/camouflage-themes.md 決策 7；DESIGN.md §13.4、§17.2；
// Epic 13 決策 4 由 ppt/FileMenu 抽到 shells/office/，輸出與抽出前逐字相同）：
//   功能區「檔案」分頁 → 選單（portal 到 body，避免被 overflow 容器裁掉）「切換偽裝…」→ Office 對話框列出主題（ShellProps.themes）
//   → 選取後「確定」即切換（未上線顯示「即將推出」不可選；目前主題標「目前使用」）。
//   第二項「說明…」（Epic 6 決策 8，窄螢幕也進得了說明）→ 遊戲說明清單（ShellProps.help.open()）；選取時先把焦點還給「檔案」，說明關閉時焦點回到「檔案」。
// 選單的其餘項目（資訊、新增、開啟…）為裝飾，不可聚焦、點了無反應。
// 鍵盤：「檔案」Enter／Space 開啟並聚焦「切換偽裝…」；↑↓ 循環、Home／End；Esc／Tab 關閉並把焦點還給「檔案」；點選單外、視窗縮放時關閉。
// 對話框：↑↓／Home／End 在可選項目間移動、Enter＝確定、Esc＝取消（焦點還給「檔案」）。
import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { tip } from '../../layout/tooltipPlacement'
import type { ShellThemeSwitch } from '../types'
import { OfficeDialogFrame } from './OfficeDialog'
import { DIALOG_CANCEL, DIALOG_OK, chooseOfficeTheme, officeThemeInitialIndex, officeThemeItems, stepMenuItem, stepThemeIndex } from './officeLayout'

interface MenuPosition {
  left: number
  top: number
}

/** 裝飾用的選單項目（仿 Office 的「檔案」後台清單；PowerPoint 與 Excel 相同） */
const DECOR_ITEMS = ['資訊', '新增', '開啟', '儲存', '另存新檔', '列印', '共用']

/** 功能區分頁列最左的「檔案」：遊戲中可操作（開選單）；自動重連畫面（沒有 themes）為裝飾。onHelp 省略時選單沒有「說明…」 */
export function FileTab(props: { buttonRef: RefObject<HTMLButtonElement | null>; onSwitchTheme?: () => void; onHelp?: () => void }) {
  const { buttonRef, onSwitchTheme, onHelp } = props
  const [menu, setMenu] = useState<MenuPosition | null>(null)

  if (onSwitchTheme === undefined) {
    return (
      <span aria-hidden="true" className="flex h-full shrink-0 items-center px-3 text-fg">
        檔案
      </span>
    )
  }

  function toggle() {
    if (menu !== null) {
      setMenu(null)
      return
    }
    const r = buttonRef.current?.getBoundingClientRect()
    if (r === undefined) return
    setMenu({ left: r.left, top: r.bottom })
  }

  function close(refocus: boolean) {
    setMenu(null)
    if (refocus) buttonRef.current?.focus()
  }

  const switchTheme = onSwitchTheme
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label="檔案"
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        {...tip('檔案', 'bottom')}
        className={`flex h-full shrink-0 cursor-pointer items-center px-3 text-fg transition-colors duration-100 hover:bg-hover focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-border-focus ${
          menu !== null ? 'bg-hover' : ''
        }`}
      >
        檔案
      </button>
      {menu !== null &&
        createPortal(
          <FileMenuList
            position={menu}
            anchor={buttonRef}
            onClose={close}
            onSwitchTheme={() => {
              close(false)
              switchTheme()
            }}
            onHelp={
              onHelp !== undefined
                ? () => {
                    close(true)
                    onHelp()
                  }
                : undefined
            }
          />,
          document.body,
        )}
    </>
  )
}

export function FileMenuList(props: {
  position: MenuPosition
  anchor: RefObject<HTMLElement | null>
  onClose: (refocus: boolean) => void
  onSwitchTheme: () => void
  onHelp?: () => void
}) {
  const { position, anchor, onClose, onSwitchTheme, onHelp } = props
  const rootRef = useRef<HTMLDivElement>(null)
  const itemRef = useRef<HTMLButtonElement>(null)
  const helpRef = useRef<HTMLButtonElement>(null)
  // onClose 每次重繪都是新函式（遊戲狀態一變殼層就重繪）；監聽器只在開啟時掛一次，改讀最新的 onClose
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    itemRef.current?.focus()
  }, [])

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      const t = e.target
      if (!(t instanceof Node)) return
      if (rootRef.current?.contains(t) || anchor.current?.contains(t)) return
      closeRef.current(false)
    }
    function onResize() {
      closeRef.current(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('resize', onResize)
    }
  }, [anchor])

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault()
      onClose(true)
      return
    }
    // 可操作項目：「切換偽裝…」＋（遊戲說明時）「說明…」；↑↓ 循環、Home／End 到兩端
    const items = [itemRef.current, helpRef.current].filter((el): el is HTMLButtonElement => el !== null)
    const current = items.findIndex((el) => el === document.activeElement)
    const next = stepMenuItem(items.length, current, e.key)
    if (next === null) return
    e.preventDefault()
    items[next]?.focus()
  }

  return (
    <div
      ref={rootRef}
      role="menu"
      aria-label="檔案"
      onKeyDown={handleKeyDown}
      style={{ left: position.left, top: position.top }}
      className="fixed z-40 min-w-[220px] rounded-[2px] border border-border bg-quickinput py-1 font-mono text-[13px] text-fg shadow-quickinput"
    >
      {DECOR_ITEMS.map((name) => (
        <div key={name} role="none" aria-hidden="true" className="flex h-[28px] items-center px-4 text-fg-muted">
          {name}
        </div>
      ))}
      <div role="separator" className="my-1 h-px bg-border" />
      <button
        ref={itemRef}
        type="button"
        role="menuitem"
        tabIndex={-1}
        onClick={onSwitchTheme}
        className="flex h-[28px] w-full cursor-pointer items-center px-4 text-left text-fg outline-none hover:bg-hover focus:bg-active"
      >
        切換偽裝…
      </button>
      {onHelp !== undefined && (
        <button
          ref={helpRef}
          type="button"
          role="menuitem"
          tabIndex={-1}
          onClick={onHelp}
          className="flex h-[28px] w-full cursor-pointer items-center px-4 text-left text-fg outline-none hover:bg-hover focus:bg-active"
        >
          說明…
        </button>
      )}
    </div>
  )
}

/**
 * 「切換偽裝」對話框（Office 風格）：清單列出主題（圖示、名稱、目前使用／即將推出），選取後「確定」切換。
 * 放在殼層的定位容器內（置中）；關閉（取消、Esc、關閉鈕、選目前主題）時 onClose(true) 讓呼叫端把焦點還給「檔案」。
 */
export function OfficeThemeDialog({ themes, onClose }: { themes: ShellThemeSwitch; onClose: (refocus: boolean) => void }) {
  const items = officeThemeItems(themes)
  const [active, setActive] = useState(() => officeThemeInitialIndex(themes))
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useId()
  const optionId = (i: number) => `${listId}-opt-${i}`

  useEffect(() => {
    listRef.current?.focus()
  }, [])

  function confirm(index: number) {
    const item = items[index]
    if (item === undefined || item.disabled) return
    // 真的切換時殼層會整個換掉，不必還焦點；選目前主題＝關閉
    if (!chooseOfficeTheme(themes, item.id)) onClose(true)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose(true)
      return
    }
    if (e.key === 'Enter' && e.target === listRef.current) {
      e.preventDefault()
      confirm(active)
      return
    }
    if (e.target !== listRef.current) return
    const next = stepThemeIndex(items, active, e.key)
    if (next === null) return
    e.preventDefault()
    setActive(next)
  }

  return (
    <OfficeDialogFrame as="div" label="切換偽裝" heading="切換偽裝" onKeyDown={handleKeyDown} onClose={() => onClose(true)}>
      <p className="mb-2 text-fg">選擇偽裝主題</p>
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="偽裝主題"
        tabIndex={0}
        aria-activedescendant={optionId(active)}
        className="rounded-[2px] border border-border bg-input py-1 outline-none focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-border-focus"
      >
        {items.map((item, i) => {
          const option = themes.options[i]
          const Icon = option?.icon
          const selected = i === active
          return (
            <li
              key={item.id}
              id={optionId(i)}
              role="option"
              aria-selected={selected}
              aria-disabled={item.disabled || undefined}
              onMouseDown={(e) => e.preventDefault() /* 保持清單焦點 */}
              onClick={() => {
                if (!item.disabled) setActive(i)
              }}
              onDoubleClick={() => confirm(i)}
              {...(item.disabled ? tip(`「${item.name}」${item.note ?? ''}，暫不可選`, 'right') : {})}
              className={`flex h-[36px] items-center gap-3 px-3 transition-colors duration-100 ${
                item.disabled ? 'cursor-default opacity-50' : 'cursor-pointer'
              } ${selected ? 'bg-active' : item.disabled ? '' : 'hover:bg-hover'}`}
            >
              {Icon !== undefined && <Icon size={24} />}
              <span className="min-w-0 flex-1 truncate text-fg">{item.name}</span>
              {item.note !== undefined && <span className="shrink-0 text-[12px] text-fg-muted">{item.note}</span>}
            </li>
          )
        })}
      </ul>
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => confirm(active)}
          aria-label={`${DIALOG_OK}：切換到選取的主題`}
          className="h-[26px] min-w-[80px] cursor-pointer rounded-[2px] bg-accent px-3 text-fg-statusbar transition-colors duration-100 hover:bg-accent-hover focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          {DIALOG_OK}
        </button>
        <button
          type="button"
          onClick={() => onClose(true)}
          aria-label={DIALOG_CANCEL}
          className="h-[26px] min-w-[80px] cursor-pointer rounded-[2px] border border-border bg-button-secondary px-3 text-fg transition-colors duration-100 hover:bg-button-secondary-hover focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          {DIALOG_CANCEL}
        </button>
      </div>
    </OfficeDialogFrame>
  )
}
