// 交卷確認框（spec/draw-contest/design.md §2：按「完成」先開「儲存投影片？」確認框，確認才交卷；自動交卷不經確認框）：
// 開／取消／儲存的狀態流程、顯示條件、交給殼層的 Dialog props、ppt 對話框的文案與焦點陷阱標記、自動交卷與「完成」的接線。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { initialRound, initialGameState, selectCanDraw, useGameStore } from '../src/store/game'
import { startAutoSubmit, type AutoSubmitDeps, type AutoSubmitView } from '../src/features/round/autoSubmit'
import { SubmitConfirmDialog, SubmitConfirmView } from '../src/features/round/SubmitConfirmDialog'
import {
  cancelSubmitConfirm,
  clearSubmitError,
  confirmSubmit,
  openSubmitConfirm,
  submitConfirmVisible,
  useSubmitConfirmStore,
} from '../src/features/round/submitConfirm'
import type { ActionOutcome } from '../src/socket/client'
import { PptDialog } from '../src/shells/ppt/PptDialog'
import { PPT_SUBMIT_DESCRIPTION, pptDialogButtonText } from '../src/shells/ppt/pptLayout'
import { PPT_VIEWS } from '../src/shells/ppt/pptViews'
import { ShellViewsContext, type DialogProps, type ShellViews } from '../src/shells/views'

const sources = import.meta.glob<string>(['../src/features/round/autoSubmit.ts', '../src/features/canvas/ToolBar.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
})
const sourceOf = (name: string) => Object.entries(sources).find(([f]) => f.endsWith(name))?.[1] ?? ''

const OK: ActionOutcome = { ok: true }
const FAIL: ActionOutcome = { ok: false, error: 'NOT_DRAWING', message: '現在不是作畫時間' }

afterEach(() => {
  useSubmitConfirmStore.setState({ openRound: null, error: null })
  useGameStore.setState({ ...initialGameState })
})

describe('開、取消、儲存', () => {
  it('「完成」只開確認框，不交卷', () => {
    const submit = vi.fn(async () => OK)
    openSubmitConfirm(3)
    expect(useSubmitConfirmStore.getState()).toEqual({ openRound: 3, error: null })
    expect(submit).not.toHaveBeenCalled()
  })

  it('取消（Esc）：關框、不交卷', () => {
    const submit = vi.fn(async () => OK)
    openSubmitConfirm(3)
    cancelSubmitConfirm()
    expect(useSubmitConfirmStore.getState().openRound).toBeNull()
    expect(submit).not.toHaveBeenCalled()
  })

  it('儲存（Enter）：關框並交卷一次；成功沒有錯誤', async () => {
    const submit = vi.fn(async () => OK)
    openSubmitConfirm(3)
    await expect(confirmSubmit(submit)).resolves.toEqual(OK)
    expect(submit).toHaveBeenCalledTimes(1)
    expect(useSubmitConfirmStore.getState()).toEqual({ openRound: null, error: null })
  })

  it('儲存後交卷失敗：錯誤訊息留給「完成」旁顯示，可再按一次；clearSubmitError 清除', async () => {
    openSubmitConfirm(3)
    await confirmSubmit(async () => FAIL)
    expect(useSubmitConfirmStore.getState()).toEqual({ openRound: null, error: '現在不是作畫時間' })
    openSubmitConfirm(3)
    expect(useSubmitConfirmStore.getState().error).toBeNull()
    useSubmitConfirmStore.setState({ error: 'x' })
    clearSubmitError()
    expect(useSubmitConfirmStore.getState().error).toBeNull()
  })

  it('顯示條件：開在目前這一回合且還能作畫（交卷中、已交卷、時間到、換回合都不顯示）', () => {
    expect(submitConfirmVisible(3, 3, true)).toBe(true)
    expect(submitConfirmVisible(null, 3, true)).toBe(false)
    expect(submitConfirmVisible(3, 3, false)).toBe(false)
    expect(submitConfirmVisible(2, 3, true)).toBe(false)
  })
})

/** 以假 Dialog 擷取交給殼層的 props */
function capture(node: ReactNode): DialogProps | null {
  let last: DialogProps | null = null
  const views: ShellViews = {
    ...PPT_VIEWS,
    Dialog: (p: DialogProps) => {
      last = p
      return null
    },
  }
  renderToStaticMarkup(<ShellViewsContext.Provider value={views}>{node}</ShellViewsContext.Provider>)
  return last
}

describe('SubmitConfirmDialog → 殼層 Dialog', () => {
  it('purpose submit、強制回應（焦點陷阱）、第一個選項＝交卷（Enter）、第二個＝取消（Esc）', async () => {
    const p = capture(<SubmitConfirmView />)
    expect(p?.purpose).toBe('submit')
    expect(p?.trapFocus).toBe(true)
    expect(p?.input).toBeUndefined()
    expect(p?.items.map((i) => i.label)).toEqual(['儲存', '取消'])
    openSubmitConfirm(1)
    p?.onEscape?.()
    expect(useSubmitConfirmStore.getState().openRound).toBeNull()
    openSubmitConfirm(1)
    p?.items[1]?.onSelect()
    expect(useSubmitConfirmStore.getState().openRound).toBeNull()
  })

  it('接 store 的條件：開著但不能作畫（旁觀、已交卷、交卷中）不顯示；參賽者作畫中才顯示', () => {
    // renderToStaticMarkup 讀的是 store 的初始狀態（zustand 的 server snapshot），這裡直接驗證元件用的兩個條件
    const visible = (patch: Partial<typeof initialGameState>) => {
      const s = { ...initialGameState, me: 'a', ...patch }
      return submitConfirmVisible(4, s.round.roundNo, selectCanDraw(s))
    }
    const drawing = (ids: string[]) => ({ ...initialRound, roundNo: 4, phase: 'drawing' as const, participantIds: ids })
    expect(visible({ round: drawing(['b']) })).toBe(false)
    expect(visible({ round: drawing(['a', 'b']) })).toBe(true)
    expect(visible({ round: drawing(['a', 'b']), submitted: true })).toBe(false)
    expect(visible({ round: drawing(['a', 'b']), submitting: true })).toBe(false)
    expect(visible({ round: { ...drawing(['a']), phase: 'judging' } })).toBe(false)
    // 初始狀態（未加入）不渲染
    openSubmitConfirm(0)
    expect(capture(<SubmitConfirmDialog />)).toBeNull()
  })
})

describe('ppt 交卷確認框（design §2）', () => {
  const props: DialogProps = {
    purpose: 'submit',
    label: '儲存確認',
    items: [
      { id: 'submit', label: '儲存', onSelect: () => {} },
      { id: 'cancel', label: '取消', onSelect: () => {} },
    ],
    onEscape: () => {},
    trapFocus: true,
  }
  const html = renderToStaticMarkup(<PptDialog {...props} />)

  it('標題「儲存投影片？」、內文「儲存後不能再修改」、按鈕「儲存」（主要，submit＝Enter）「取消」', () => {
    expect(html).toMatch(/<span id="[^"]+" class="truncate text-fg">儲存投影片？<\/span>/)
    expect(PPT_SUBMIT_DESCRIPTION).toBe('儲存後不能再修改')
    expect(html).toContain('>儲存後不能再修改</p>')
    expect(html).toMatch(/<button type="submit"[^>]*autofocus=""[^>]*>儲存<\/button>/)
    expect(html).toMatch(/<button type="button"[^>]*>取消<\/button>/)
    expect(pptDialogButtonText('submit', 0)).toBe('儲存')
    expect(pptDialogButtonText('submit', 1)).toBeUndefined()
    expect(pptDialogButtonText('topic', 0)).toBeUndefined()
  })

  it('強制回應：aria-modal；其他用途（出題、說明）不加', () => {
    expect(html).toContain('aria-modal="true"')
    const topic = renderToStaticMarkup(<PptDialog purpose="topic" label="出題" items={[{ id: 'a', label: 'a', onSelect: () => {} }]} />)
    expect(topic).not.toContain('aria-modal')
  })
})

describe('接線：「完成」開確認框、自動交卷不經確認框', () => {
  it('ToolBar 的「完成」呼叫 openSubmitConfirm，不直接交卷', () => {
    const src = sourceOf('/ToolBar.tsx')
    expect(src).toContain('onClick={() => openSubmitConfirm(roundNo)}')
    expect(src).not.toMatch(/submitMyCanvas/)
  })

  it('autoSubmit 不 import 確認框，預設直接呼叫 submitMyCanvas', () => {
    const src = sourceOf('/autoSubmit.ts')
    expect(src).not.toMatch(/submitConfirm/)
    expect(src).toContain('submit: () => submitMyCanvas()')
  })

  it('時間到自動交卷：直接送出、確認框不會打開', () => {
    const view: AutoSubmitView = {
      me: 'a',
      round: { roundNo: 1, phase: 'drawing', endsAt: 1000, participantIds: ['a'] },
      submitted: false,
      submitting: false,
    }
    const submit = vi.fn(async () => OK)
    const deps: AutoSubmitDeps = {
      getState: () => view,
      subscribe: () => () => {},
      now: () => 1000,
      setTimer: () => null,
      clearTimer: () => {},
      submit,
    }
    const stop = startAutoSubmit(deps)
    expect(submit).toHaveBeenCalledTimes(1)
    expect(useSubmitConfirmStore.getState().openRound).toBeNull()
    stop()
  })
})
