// vscode 主題進遊戲後的「切換偽裝」入口（plan/camouflage-themes.md 決策 7；DESIGN.md §13.4）：
//   活動列底部設定齒輪（Manage）→ 選單「切換偽裝…」→ 快速選單列出主題（ShellProps.themes；未上線顯示「即將推出」不可選）→ 選取即切換。
// 選單仿 VS Code 的 Manage 選單：貼齊活動列右側、底邊對齊齒輪；portal 到 body（避免被 overflow 容器裁掉，踩雷紀錄 Epic 1 Phase 5）。
// 鍵盤：齒輪 Enter／Space 開啟並聚焦第一項；↑↓／Home／End 移動；Esc 關閉並把焦點還給齒輪；Tab 或點選單外關閉。
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { GearIcon } from '../../layout/icons'
import { tip } from '../../layout/tooltipPlacement'
import type { ShellThemeSwitch } from '../types'
import { QuickInput } from './QuickInput'
import { chooseTheme, stepMenuIndex, themePickInitialIndex, themePickItems } from './themePick'

interface MenuPosition {
  left: number
  bottom: number
}

export interface ManageMenuItem {
  id: string
  label: string
  onSelect(): void
}

/** 活動列底部的設定齒輪（可操作版；自動重連畫面仍為裝飾） */
export function ManageButton({ buttonRef, onSwitchTheme }: { buttonRef: RefObject<HTMLButtonElement | null>; onSwitchTheme: () => void }) {
  const [menu, setMenu] = useState<MenuPosition | null>(null)

  function toggle() {
    if (menu !== null) {
      setMenu(null)
      return
    }
    const r = buttonRef.current?.getBoundingClientRect()
    if (r === undefined) return
    setMenu({ left: r.right, bottom: window.innerHeight - r.bottom })
  }

  function close(refocus: boolean) {
    setMenu(null)
    if (refocus) buttonRef.current?.focus()
  }

  const items: ManageMenuItem[] = [
    {
      id: 'switch-theme',
      label: '切換偽裝…',
      onSelect: () => {
        close(false)
        onSwitchTheme()
      },
    },
  ]

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label="管理"
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        {...tip('Manage', 'right')}
        className={`flex h-[48px] w-full cursor-pointer items-center justify-center transition-colors duration-100 focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-border-focus ${
          menu !== null ? 'text-fg-statusbar' : 'hover:text-fg-statusbar'
        }`}
      >
        <GearIcon size={24} />
      </button>
      {menu !== null && createPortal(<ManageMenuList position={menu} anchor={buttonRef} items={items} onClose={close} />, document.body)}
    </>
  )
}

function ManageMenuList(props: {
  position: MenuPosition
  anchor: RefObject<HTMLElement | null>
  items: ManageMenuItem[]
  onClose: (refocus: boolean) => void
}) {
  const { position, anchor, items, onClose } = props
  const rootRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  // onClose 每次重繪都是新函式（遊戲狀態一變殼層就重繪）；監聽器只在開啟時掛一次，改讀最新的 onClose
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  // 開啟即聚焦第一項（只在開啟時一次）
  useEffect(() => {
    itemRefs.current[0]?.focus()
  }, [])

  // 點選單與齒輪以外的地方、視窗縮放時關閉
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
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose(true)
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      onClose(true)
      return
    }
    const current = itemRefs.current.findIndex((el) => el === document.activeElement)
    const next = stepMenuIndex(items.length, current < 0 ? 0 : current, e.key)
    if (next === null) return
    e.preventDefault()
    itemRefs.current[next]?.focus()
  }

  return (
    <div
      ref={rootRef}
      role="menu"
      aria-label="管理"
      onKeyDown={handleKeyDown}
      style={{ left: position.left, bottom: position.bottom }}
      className="fixed z-40 min-w-[200px] rounded-[3px] border border-border bg-quickinput py-1 font-mono text-[13px] text-fg shadow-quickinput"
    >
      {items.map((item, i) => (
        <button
          key={item.id}
          ref={(el) => {
            itemRefs.current[i] = el
          }}
          type="button"
          role="menuitem"
          tabIndex={-1}
          onClick={item.onSelect}
          className="flex h-[26px] w-full cursor-pointer items-center px-5 text-left outline-none hover:bg-active hover:text-fg-statusbar focus:bg-active focus:text-fg-statusbar"
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

/**
 * 「切換偽裝」快速選單（仿命令面板的主題選擇）：視窗頂部置中（與自動重連的提示框同位置）；
 * Enter／點選切換，Esc 關閉並把焦點還給齒輪，焦點離開（點選單外）即關閉。
 */
export function ThemeQuickPick({ themes, onClose }: { themes: ShellThemeSwitch; onClose: (refocus: boolean) => void }) {
  const items = themePickItems(themes).map((item) => ({
    id: item.id,
    label: `› ${item.label}`,
    detail: item.detail,
    disabled: item.disabled,
    onSelect: () => onClose(!chooseTheme(themes, item.id)),
  }))
  return (
    <div
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) onClose(false)
      }}
    >
      <QuickInput
        label="切換偽裝"
        title="選擇偽裝主題"
        className="absolute top-2 left-1/2 -translate-x-1/2"
        initialActive={themePickInitialIndex(themes)}
        items={items}
        onEscape={() => onClose(true)}
      />
    </div>
  )
}
