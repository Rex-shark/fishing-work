// Office 殼層（ppt、excel）進遊戲後的「切換偽裝」入口（plan/camouflage-themes.md 決策 7；DESIGN.md §13.4、§17.2；
// Epic 13 決策 4 由 ppt/FileMenu 抽到 shells/office/，輸出與抽出前逐字相同）：
//   功能區「檔案」分頁 → 選單（portal 到 body，避免被 overflow 容器裁掉）「切換偽裝…」→ Office 對話框列出主題（ShellProps.themes）
//   → 選取後「確定」即切換（未上線顯示「即將推出」不可選；目前主題標「目前使用」）。
//   第二項「說明…」（Epic 6 決策 8，窄螢幕也進得了說明）→ 遊戲說明清單（ShellProps.help.open()）；選取時先把焦點還給「檔案」，說明關閉時焦點回到「檔案」。
//   第三項（Epic 17；spec/draw-contest/design.md §3.1；有 recent 才有）＝比賽歷史的入口，字樣由殼層給（ppt「開啟最近的簡報」），右側「›」：
//     點選或 Enter／Space／→ 展開子清單（寬螢幕在右側、< 768px 接在下方），最多 5 列、最新在上；沒有存檔時一列灰字（aria-disabled）。
//     選一列 → 關閉選單、焦點還給「檔案」、開啟那一筆（ShellProps.history.open）。不可開的時機（recent.enabled 為 false）整項灰化、展不開。
//     「檔案」選單開啟時呼叫 recent.onRefresh（重讀清單）。
// 選單的其餘項目（資訊、新增、開啟…）為裝飾，不可聚焦、點了無反應。
// 鍵盤：「檔案」Enter／Space 開啟並聚焦「切換偽裝…」；↑↓ 循環、Home／End；Esc／Tab 關閉並把焦點還給「檔案」；點選單外、視窗縮放時關閉。
//   子清單裡：↑↓／Home／End 在各列間移動；←／Esc 收起子清單、焦點回到展開它的那一項；Tab 關閉整個選單（按鍵規則在 officeLayout.fileMenuKeyAction）。
// 對話框：↑↓／Home／End 在可選項目間移動、Enter＝確定、Esc＝取消（焦點還給「檔案」）。
import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { tip } from '../../layout/tooltipPlacement'
import type { ShellThemeSwitch } from '../types'
import { OfficeDialogFrame } from './OfficeDialog'
import { DIALOG_CANCEL, DIALOG_OK, chooseOfficeTheme, fileMenuKeyAction, officeThemeInitialIndex, officeThemeItems, stepThemeIndex } from './officeLayout'

interface MenuPosition {
  left: number
  top: number
}

/** 裝飾用的選單項目（仿 Office 的「檔案」後台清單；PowerPoint 與 Excel 相同） */
const DECOR_ITEMS = ['資訊', '新增', '開啟', '儲存', '另存新檔', '列印', '共用']

/** 比賽歷史在「檔案」選單裡的入口（Epic 17）：字樣由殼層給（各 Office 殼層的叫法不同），資料與動作來自 ShellProps.history */
export interface FileMenuRecent {
  /** 選單項目的文字（ppt「開啟最近的簡報」） */
  label: string
  /** 沒有存檔時子清單的灰字（ppt「沒有最近的簡報」） */
  emptyLabel: string
  /** 子清單（最新在上；label 已排好字） */
  entries: readonly { id: number; label: string }[]
  /** 現在可以開啟；false＝整項灰化、子清單展不開 */
  enabled: boolean
  /** 選了一列 */
  onOpen(id: number): void
  /** 「檔案」選單開啟時呼叫（重讀清單：另一個分頁可能寫了新紀錄） */
  onRefresh(): void
}

/**
 * 功能區分頁列最左的「檔案」：遊戲中可操作（開選單）；自動重連畫面（沒有 themes）為裝飾。
 * onHelp 省略時選單沒有「說明…」；recent 省略時沒有比賽歷史的入口
 */
export function FileTab(props: {
  buttonRef: RefObject<HTMLButtonElement | null>
  onSwitchTheme?: () => void
  onHelp?: () => void
  recent?: FileMenuRecent
}) {
  const { buttonRef, onSwitchTheme, onHelp, recent } = props
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
    recent?.onRefresh()
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
            recent={
              recent !== undefined
                ? {
                    label: recent.label,
                    emptyLabel: recent.emptyLabel,
                    entries: recent.entries,
                    enabled: recent.enabled,
                    // 先關選單並把焦點還給「檔案」，再開啟那一筆（同「說明…」）
                    onOpen: (id) => {
                      close(true)
                      recent.onOpen(id)
                    },
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
  recent?: Omit<FileMenuRecent, 'onRefresh'>
}) {
  const { position, anchor, onClose, onSwitchTheme, onHelp, recent } = props
  const rootRef = useRef<HTMLDivElement>(null)
  const itemRef = useRef<HTMLButtonElement>(null)
  const helpRef = useRef<HTMLButtonElement>(null)
  const recentRef = useRef<HTMLButtonElement>(null)
  const subRef = useRef<HTMLDivElement>(null)
  /** 子清單（比賽歷史）是否展開；灰化時一律不顯示 */
  const [subOpen, setSubOpen] = useState(false)
  const showSub = subOpen && recent?.enabled === true
  const recentEntries = recent?.entries
  /** 上一次渲染時子清單是否顯示（判斷「剛展開」「剛收起」） */
  const subShown = useRef(false)
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

  // 子清單的焦點：剛展開 → 第一列；展開中清單換了（重讀完成，原本有焦點的那一列不見了）而焦點掉出選單 → 放回第一列；
  // 展開中被收起（回合開始而灰化）而焦點掉出選單 → 放回展開它的那一項。焦點留在選單裡，鍵盤才接得上
  useEffect(() => {
    const focusInside = rootRef.current?.contains(document.activeElement) ?? false
    if (showSub) {
      if (!subShown.current || !focusInside) subRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    } else if (subShown.current && !focusInside) {
      recentRef.current?.focus()
    }
    subShown.current = showSub
  }, [showSub, recentEntries])

  function closeSub() {
    setSubOpen(false)
    recentRef.current?.focus()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const focused = document.activeElement
    const sub = subRef.current
    const inSub = sub !== null && sub.contains(focused)
    // 可操作項目：最上層＝「切換偽裝…」＋（遊戲說明時）「說明…」＋（有比賽歷史時）它的入口；子清單＝各列（或那一列灰字）
    const items: HTMLElement[] = inSub
      ? [...sub.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      : [itemRef.current, helpRef.current, recentRef.current].filter((el): el is HTMLButtonElement => el !== null)
    const action = fileMenuKeyAction({
      key: e.key,
      inSub,
      onExpandable: focused === recentRef.current && recent?.enabled === true,
      count: items.length,
      current: items.findIndex((el) => el === focused),
    })
    if (action === null) return
    e.preventDefault()
    switch (action.type) {
      case 'close':
        onClose(true)
        break
      case 'close-sub':
        closeSub()
        break
      case 'open-sub':
        // 已經（用滑鼠）展開著：直接把焦點移進第一列；否則展開（展開後的焦點由上面的 effect 處理）
        if (showSub) sub?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
        else setSubOpen(true)
        break
      case 'focus':
        // 焦點在最上層移到別項時把（滑鼠點開的）子清單收起
        if (!inSub) setSubOpen(false)
        items[action.index]?.focus()
        break
    }
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
      {recent !== undefined && (
        <div role="none" className="relative">
          <button
            ref={recentRef}
            type="button"
            role="menuitem"
            tabIndex={-1}
            aria-haspopup="menu"
            aria-expanded={showSub}
            aria-disabled={!recent.enabled || undefined}
            data-file-recent=""
            onClick={() => {
              if (recent.enabled) setSubOpen((open) => !open)
            }}
            className="flex h-[28px] w-full cursor-pointer items-center justify-between gap-4 px-4 text-left text-fg outline-none hover:bg-hover focus:bg-active aria-disabled:cursor-default aria-disabled:text-fg-muted aria-disabled:opacity-60 aria-disabled:hover:bg-transparent"
          >
            <span>{recent.label}</span>
            <span aria-hidden="true">›</span>
          </button>
          {showSub && <FileRecentList listRef={subRef} label={recent.label} emptyLabel={recent.emptyLabel} entries={recent.entries} onOpen={recent.onOpen} />}
        </div>
      )}
    </div>
  )
}

/**
 * 比賽歷史的子清單（Epic 17；design §3.1）：一列一筆（最新在上），沒有存檔時一列灰字（aria-disabled，仍可聚焦，鍵盤展開後焦點才有落點）。
 * 寬螢幕（≥ 768px）浮在入口右側（對齊入口那一列）；以下接在入口下方（選單寬度有限，不往右長出畫面）。文字過長時換行，不截斷
 */
export function FileRecentList(props: {
  label: string
  emptyLabel: string
  entries: readonly { id: number; label: string }[]
  onOpen(id: number): void
  listRef?: RefObject<HTMLDivElement | null>
}) {
  const { label, emptyLabel, entries, onOpen, listRef } = props
  return (
    <div
      ref={listRef}
      role="menu"
      aria-label={label}
      data-file-recent-list=""
      className="w-max max-w-[min(440px,calc(100vw-16px))] min-w-full max-md:pl-3 md:absolute md:-top-[5px] md:left-full md:min-w-[220px] md:rounded-[2px] md:border md:border-border md:bg-quickinput md:py-1 md:shadow-quickinput"
    >
      {entries.length === 0 ? (
        <div
          role="menuitem"
          aria-disabled="true"
          tabIndex={-1}
          data-file-recent-empty=""
          className="flex min-h-[28px] cursor-default items-center px-4 text-fg-muted outline-none focus:bg-hover"
        >
          {emptyLabel}
        </div>
      ) : (
        entries.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            tabIndex={-1}
            data-file-recent-entry={entry.id}
            onClick={() => onOpen(entry.id)}
            className="flex min-h-[28px] w-full cursor-pointer items-center px-4 py-[5px] text-left leading-[18px] break-words text-fg outline-none hover:bg-hover focus:bg-active"
          >
            {entry.label}
          </button>
        ))
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
