// vscode 主題進遊戲後的「切換偽裝」入口（決策 7）：齒輪選單 → 快速選單 → 選取即切換
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRef } from 'react'
import { THEME_CATALOG } from '../src/shells/catalog'
import type { ShellId, ShellThemeSwitch } from '../src/shells/types'
import { ManageButton, ThemeQuickPick } from '../src/shells/vscode/ManageMenu'
import {
  THEME_CURRENT_DETAIL,
  THEME_UPCOMING_DETAIL,
  chooseTheme,
  stepMenuIndex,
  themePickInitialIndex,
  themePickItems,
} from '../src/shells/vscode/themePick'

function switcher(current: ShellId, options = THEME_CATALOG) {
  const calls: ShellId[] = []
  const themes: ShellThemeSwitch = { current, options, select: (id) => void calls.push(id) }
  return { themes, calls }
}

const bothAvailable = THEME_CATALOG.map((o) => ({ ...o, available: true }))
/** ppt 尚未註冊時的清單（Phase 2 狀態）：「即將推出」行為測試用 */
const withUpcoming = THEME_CATALOG.map((o) => (o.id === 'ppt' ? { ...o, available: false } : o))

describe('themePickItems：與登入卡片同一份 catalog', () => {
  it('未上線的主題：程式編輯器（目前使用）、簡報（即將推出、不可選）', () => {
    expect(themePickItems(switcher('vscode', withUpcoming).themes)).toEqual([
      { id: 'vscode', label: '程式編輯器', detail: THEME_CURRENT_DETAIL, disabled: false },
      { id: 'ppt', label: '簡報', detail: THEME_UPCOMING_DETAIL, disabled: true },
      { id: 'meet', label: '視訊會議', detail: undefined, disabled: false },
      { id: 'excel', label: '試算表', detail: undefined, disabled: false },
    ])
  })

  it('全部上線時（Epic 13 起四個主題）：只有目前主題有說明', () => {
    expect(themePickItems(switcher('ppt', bothAvailable).themes).map((i) => [i.id, i.detail, i.disabled])).toEqual([
      ['vscode', undefined, false],
      ['ppt', THEME_CURRENT_DETAIL, false],
      ['meet', undefined, false],
      ['excel', undefined, false],
    ])
  })

  it('一開始反白目前主題', () => {
    expect(themePickInitialIndex(switcher('vscode').themes)).toBe(0)
    expect(themePickInitialIndex(switcher('ppt', bothAvailable).themes)).toBe(1)
  })
})

describe('chooseTheme：選取即切換 shellId', () => {
  it('選另一個已上線主題 → 呼叫 select', () => {
    const { themes, calls } = switcher('vscode', bothAvailable)
    expect(chooseTheme(themes, 'ppt')).toBe(true)
    expect(calls).toEqual(['ppt'])
  })

  it('即將推出 → 不呼叫', () => {
    const { themes, calls } = switcher('vscode', withUpcoming)
    expect(chooseTheme(themes, 'ppt')).toBe(false)
    expect(calls).toEqual([])
  })

  it('選目前主題 → 不呼叫（不重寫 localStorage）', () => {
    const { themes, calls } = switcher('vscode')
    expect(chooseTheme(themes, 'vscode')).toBe(false)
    expect(calls).toEqual([])
  })
})

describe('stepMenuIndex：齒輪選單鍵盤', () => {
  it('↑↓ 循環、Home／End、其他鍵 null', () => {
    expect(stepMenuIndex(3, 0, 'ArrowDown')).toBe(1)
    expect(stepMenuIndex(3, 2, 'ArrowDown')).toBe(0)
    expect(stepMenuIndex(3, 0, 'ArrowUp')).toBe(2)
    expect(stepMenuIndex(3, 1, 'Home')).toBe(0)
    expect(stepMenuIndex(3, 1, 'End')).toBe(2)
    expect(stepMenuIndex(3, 1, 'Enter')).toBeNull()
    expect(stepMenuIndex(0, 0, 'ArrowDown')).toBeNull()
  })
})

describe('靜態渲染', () => {
  it('齒輪：可操作按鈕、aria-haspopup="menu"、關閉時 aria-expanded=false、懸停提示 Manage', () => {
    const html = renderToStaticMarkup(<ManageButton buttonRef={createRef()} onSwitchTheme={() => {}} />)
    expect(html).toMatch(/^<button type="button"/)
    expect(html).toContain('aria-label="管理"')
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('data-tooltip="Manage"')
    expect(html).not.toContain('role="menu"')
  })

  it('快速選單：列出主題、目前主題反白、即將推出 aria-disabled', () => {
    const html = renderToStaticMarkup(<ThemeQuickPick themes={switcher('vscode', withUpcoming).themes} onClose={() => {}} />)
    expect(html).toContain('aria-label="切換偽裝"')
    expect(html).toContain('選擇偽裝主題')
    expect(html).toMatch(/aria-selected="true"[^>]*>.*› 程式編輯器.*目前使用/)
    expect(html).toMatch(/aria-selected="false" aria-disabled="true"[^>]*>.*› 簡報.*即將推出/)
  })
})
