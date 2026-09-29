// meet 主題進遊戲後的「切換偽裝」入口（plan/meet-theme.md 決策 6；DESIGN §15.2 底部控制列「更多 ⋮」）：
//   控制列「更多選項」圓形按鈕 → 選單（portal 到 body，往上開，避免被 overflow 容器裁掉）「切換偽裝…」
//   → 白卡片對話框列出主題（ShellProps.themes）→ 選取後「切換」即切換（未上線顯示「即將推出」不可選；目前主題標「目前使用」）。
//   第二項「說明…」（Epic 6 決策 8，窄螢幕「資訊」隱藏時也進得了說明）→ 遊戲說明清單（ShellProps.help.open()）；選取時先把焦點還給按鈕，說明關閉時焦點回到「更多選項」。
// 選單的其餘項目（管理錄影、變更版面配置…）為裝飾，不可聚焦、點了無反應。選單用深灰 --bg-quickinput（決策 13(1)，與工具提示同色）。
// 鍵盤：按鈕 Enter／Space 開啟並聚焦「切換偽裝…」；↑↓ 循環、Home／End；Esc／Tab 關閉並把焦點還給按鈕；點選單外、視窗縮放時關閉。
// 對話框：↑↓／Home／End 在可選項目間移動、Enter＝切換、Esc＝取消（呼叫端把焦點還給按鈕）。
// 殼層不 import uiStore／catalog：主題資料經 ShellProps.themes（踩雷紀錄 Epic 3 Phase 2）。
import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { tip } from '../../layout/tooltipPlacement'
import type { ShellThemeSwitch } from '../types'
import { MeetCard } from './MeetDialog'
import { MoreVertIcon } from './meetIcons'
import {
  HELP_MENU_ITEM,
  MORE_MENU_DECOR,
  MORE_MENU_LABEL,
  SWITCH_THEME_ITEM,
  THEME_CANCEL,
  THEME_CONFIRM,
  THEME_DIALOG_TITLE,
  chooseMeetTheme,
  meetThemeInitialIndex,
  meetThemeItems,
  stepEnabledIndex,
  stepMenuItem,
} from './meetLayout'

/** 選單寬（px） */
const MENU_WIDTH = 240

interface MenuPosition {
  left: number
  bottom: number
}

/** 控制列的「更多選項」：40px 圓形按鈕（與其他控制列按鈕同外觀）＋選單；onHelp 省略時選單沒有「說明…」 */
export function MoreButton(props: { buttonRef: RefObject<HTMLButtonElement | null>; onSwitchTheme: () => void; onHelp?: () => void }) {
  const { buttonRef, onSwitchTheme, onHelp } = props
  const [menu, setMenu] = useState<MenuPosition | null>(null)

  function toggle() {
    if (menu !== null) {
      setMenu(null)
      return
    }
    const r = buttonRef.current?.getBoundingClientRect()
    if (r === undefined) return
    const left = Math.min(Math.max(8, r.left + r.width / 2 - MENU_WIDTH / 2), window.innerWidth - MENU_WIDTH - 8)
    setMenu({ left, bottom: window.innerHeight - r.top + 8 })
  }

  function close(refocus: boolean) {
    setMenu(null)
    if (refocus) buttonRef.current?.focus()
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label={MORE_MENU_LABEL}
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        {...tip(MORE_MENU_LABEL, 'top')}
        className={`flex h-[40px] w-[40px] shrink-0 cursor-pointer items-center justify-center rounded-full text-fg transition-colors duration-100 hover:bg-button-secondary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus ${
          menu !== null ? 'bg-button-secondary-hover' : 'bg-button-secondary'
        }`}
      >
        <MoreVertIcon size={20} />
      </button>
      {menu !== null &&
        createPortal(
          <MoreMenuList
            position={menu}
            anchor={buttonRef}
            onClose={close}
            onSwitchTheme={() => {
              close(false)
              onSwitchTheme()
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

export function MoreMenuList(props: {
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
    const next = stepMenuItem(items.length, items.findIndex((el) => el === document.activeElement), e.key)
    if (next === null) return
    e.preventDefault()
    items[next]?.focus()
  }

  return (
    <div
      ref={rootRef}
      role="menu"
      aria-label={MORE_MENU_LABEL}
      onKeyDown={handleKeyDown}
      style={{ left: position.left, bottom: position.bottom }}
      className="fixed z-40 w-[240px] rounded-[8px] bg-quickinput py-[8px] font-mono text-[14px] text-fg shadow-quickinput"
    >
      {MORE_MENU_DECOR.map((name) => (
        <div key={name} role="none" aria-hidden="true" className="flex h-[40px] items-center px-[16px]">
          {name}
        </div>
      ))}
      <div role="separator" className="my-[8px] h-px bg-border" />
      <button
        ref={itemRef}
        type="button"
        role="menuitem"
        tabIndex={-1}
        onClick={onSwitchTheme}
        className="flex h-[40px] w-full cursor-pointer items-center px-[16px] text-left text-fg outline-none hover:bg-button-secondary-hover focus:bg-button-secondary-hover"
      >
        {SWITCH_THEME_ITEM}
      </button>
      {onHelp !== undefined && (
        <button
          ref={helpRef}
          type="button"
          role="menuitem"
          tabIndex={-1}
          onClick={onHelp}
          className="flex h-[40px] w-full cursor-pointer items-center px-[16px] text-left text-fg outline-none hover:bg-button-secondary-hover focus:bg-button-secondary-hover"
        >
          {HELP_MENU_ITEM}
        </button>
      )}
    </div>
  )
}

/**
 * 「切換偽裝」白卡片對話框：清單列出主題（圖示、名稱、目前使用／即將推出），選取後「切換」。
 * 放在殼層的定位容器內（主畫面 tile，置中）；關閉（取消、Esc、選目前主題）時 onClose() 讓呼叫端把焦點還給「更多選項」。
 */
export function MeetThemeDialog({ themes, onClose }: { themes: ShellThemeSwitch; onClose: () => void }) {
  const items = meetThemeItems(themes)
  const [active, setActive] = useState(() => meetThemeInitialIndex(themes))
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
    if (!chooseMeetTheme(themes, item.id)) onClose()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLFormElement & HTMLDivElement>) {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.target !== listRef.current) return
    if (e.key === 'Enter') {
      e.preventDefault()
      confirm(active)
      return
    }
    const next = stepEnabledIndex(items, active, e.key)
    if (next === null) return
    e.preventDefault()
    setActive(next)
  }

  return (
    <MeetCard as="div" label={THEME_DIALOG_TITLE} heading={THEME_DIALOG_TITLE} onKeyDown={handleKeyDown}>
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="偽裝主題"
        tabIndex={0}
        aria-activedescendant={optionId(active)}
        className="-mx-[8px] flex flex-col gap-[2px] rounded-[4px] outline-none focus-visible:outline-2 focus-visible:outline-accent-panel"
      >
        {items.map((item, i) => {
          const Icon = themes.options[i]?.icon
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
              className={`flex h-[48px] items-center gap-[12px] rounded-[4px] px-[8px] transition-colors duration-100 ${
                item.disabled ? 'cursor-default opacity-50' : 'cursor-pointer'
              } ${selected ? 'bg-panel-hover' : item.disabled ? '' : 'hover:bg-panel-hover'}`}
            >
              <span
                aria-hidden="true"
                className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 ${
                  selected ? 'border-accent-panel' : 'border-fg-on-panel-muted'
                }`}
              >
                {selected && <span className="block h-[8px] w-[8px] rounded-full bg-accent-panel" />}
              </span>
              {Icon !== undefined && <Icon size={24} />}
              <span className="min-w-0 flex-1 truncate text-fg-on-panel">{item.name}</span>
              {item.note !== undefined && <span className="shrink-0 text-[12px] text-fg-on-panel-muted">{item.note}</span>}
            </li>
          )
        })}
      </ul>
      <div className="mt-[20px] flex justify-end gap-[8px]">
        <button
          type="button"
          onClick={onClose}
          className="h-[36px] min-w-[64px] cursor-pointer rounded-[4px] px-[12px] text-[14px] font-medium text-accent-panel transition-colors duration-100 hover:bg-panel-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-panel"
        >
          {THEME_CANCEL}
        </button>
        <button
          type="button"
          onClick={() => confirm(active)}
          aria-label={`${THEME_CONFIRM}：切換到選取的主題`}
          className="h-[36px] min-w-[64px] cursor-pointer rounded-[4px] px-[12px] text-[14px] font-medium text-accent-panel transition-colors duration-100 hover:bg-panel-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-panel"
        >
          {THEME_CONFIRM}
        </button>
      </div>
    </MeetCard>
  )
}
