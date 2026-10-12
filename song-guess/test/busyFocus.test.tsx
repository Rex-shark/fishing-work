// 送出中（busy）不用原生 disabled 的另外兩處（複製自我畫你猜的測試；plan/notes.md 2026-10-12；對話框見 dialogBusy.test.tsx）：
//   A. 首頁暱稱輸入框與「進入遊戲」按鈕（home/HomeScreen）：加入中輸入框 readOnly＋aria-busy、按鈕 aria-disabled＋aria-busy；
//      加入失敗後焦點在輸入框，可以直接重打再按 Enter；按鈕只有「未連線」才是原生 disabled。
//   B. 「出題」按鈕（layout/StatusItem 的 StatusButton，殼層的 volunteer 插槽就是它）：送出中 aria-disabled＋aria-busy，
//      失敗後焦點留在按鈕上；送出中再按不重複送出。
// 沒有 DOM 環境：靜態渲染的屬性（renderToStaticMarkup）＋掛在假 DOM 上的狀態流程（test/fakeDom.tsx）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PlayerPublic } from '@fishing-work/shared/song-guess'
import { VolunteerStatus } from '../src/features/round/RoundStatus'
import { HomeScreen } from '../src/home/HomeScreen'
import { StatusButton } from '../src/layout/StatusItem'
import { MEET_VIEWS } from '../src/shells/meet/meetViews'
import { ShellViewsContext, type ShellViews } from '../src/shells/views'
import { join, volunteer, type ActionOutcome } from '../src/socket/client'
import { initialGameState, useGameStore } from '../src/store/game'
import { deferred, handlersOf, mount, textOf, unmountAll } from './fakeDom'

// 首頁與「出題」只用到這三個；不載入真的 socket
vi.mock('../src/socket/client', () => ({ join: vi.fn(), volunteer: vi.fn(), rememberedNickname: () => 'rex' }))

const sources = import.meta.glob<string>(['../src/home/*.tsx', '../src/layout/StatusItem.tsx', '../src/features/round/RoundStatus.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
})
const sourceOf = (name: string) => Object.entries(sources).find(([f]) => f.endsWith(name))?.[1] ?? ''

const noop = () => {}
const NATIVE_DISABLED = /\sdisabled(?:=|\s|\/?>)/

afterEach(async () => {
  await unmountAll()
  vi.mocked(join).mockReset()
  vi.mocked(volunteer).mockReset()
  useGameStore.setState({ ...initialGameState })
})

// ─── A. 首頁 ────────────────────────────────────────────────────────

describe('首頁（HomeScreen）：加入中不用原生 disabled，加入失敗後焦點在暱稱輸入框', () => {
  const TAKEN: ActionOutcome = { ok: false, error: 'NICKNAME_TAKEN', message: '暱稱已被使用' }
  /** socket/client 的 join 失敗時會把訊息寫進 store.joinError（這裡的 join 是假的，由測試代勞） */
  const failJoin = () => useGameStore.setState({ joinError: '暱稱已被使用' })

  async function mountHome(state: Partial<typeof initialGameState> = { connection: 'connected' }) {
    useGameStore.setState(state)
    const view = await mount(<HomeScreen />)
    return {
      ...view,
      get active() {
        return view.active
      },
      input: view.one((n) => n.tagName === 'INPUT'),
      form: view.one((n) => n.tagName === 'FORM'),
      button: view.one((n) => n.tagName === 'BUTTON' && n.attrs.type === 'submit'),
      cards: view.one((n) => n.attrs.role === 'radiogroup'),
      /** 在輸入框按 Enter／點「進入遊戲」＝ form 的 submit */
      submit: () => act(async () => handlersOf(view.one((n) => n.tagName === 'FORM')).onSubmit?.({ preventDefault: noop })),
    }
  }

  it('已連線、未送出：輸入框可編輯且有預設焦點；按鈕可按（沒有任何 disabled／aria-disabled／aria-busy）', async () => {
    const home = await mountHome()
    expect(home.active).toBe(home.input)
    expect(Object.keys(home.input.attrs).filter((k) => /disabled|readonly|busy/.test(k))).toEqual([])
    expect(Object.keys(home.button.attrs).filter((k) => /disabled|busy/.test(k))).toEqual([])
    expect(textOf(home.button)).toBe('進入遊戲')
  })

  it('加入中：輸入框 readOnly＋aria-busy、按鈕 aria-disabled＋aria-busy，都不是原生 disabled；焦點留在輸入框', async () => {
    const pending = deferred()
    vi.mocked(join).mockReturnValue(pending.promise)
    const home = await mountHome()
    await home.submit()
    expect(join).toHaveBeenCalledTimes(1)
    expect(join).toHaveBeenLastCalledWith('rex')
    expect(home.input.attrs).toMatchObject({ readonly: '', 'aria-busy': 'true' })
    expect(home.input.attrs).not.toHaveProperty('disabled')
    expect(home.button.attrs).toMatchObject({ 'aria-disabled': 'true', 'aria-busy': 'true' })
    expect(home.button.attrs).not.toHaveProperty('disabled')
    expect(textOf(home.button)).toBe('加入中…')
    expect(home.active).toBe(home.input)
    // 整個首頁沒有任何原生 disabled（風格卡片在加入中也不停用，「即將推出」只用 aria-disabled）
    expect(home.all().filter((n) => 'disabled' in n.attrs)).toEqual([])
    await pending.settle(TAKEN, failJoin)
  })

  it('加入中再按 Enter、再點按鈕、在風格卡片按 Enter：都不重複送出', async () => {
    const pending = deferred()
    vi.mocked(join).mockReturnValue(pending.promise)
    const home = await mountHome()
    await home.submit()
    await home.submit()
    await act(async () => handlersOf(home.cards).onKeyDown?.({ key: 'Enter', nativeEvent: { isComposing: false }, preventDefault: noop }))
    expect(join).toHaveBeenCalledTimes(1)
    await pending.settle(TAKEN, failJoin)
  })

  it('加入失敗（暱稱重複）：busy 解除、顯示錯誤、焦點在輸入框；重打後按 Enter 可再送出', async () => {
    const first = deferred()
    vi.mocked(join).mockReturnValueOnce(first.promise)
    const home = await mountHome()
    await home.submit()
    await first.settle(TAKEN, failJoin)

    expect(home.active).toBe(home.input)
    expect(Object.keys(home.input.attrs).filter((k) => /disabled|readonly|busy/.test(k))).toEqual([])
    expect(home.input.attrs['aria-invalid']).toBe('true')
    expect(Object.keys(home.button.attrs).filter((k) => /disabled|busy/.test(k))).toEqual([])
    expect(textOf(home.button)).toBe('進入遊戲')
    expect(textOf(home.one((n) => n.attrs.role === 'alert'))).toBe('暱稱已被使用')

    const second = deferred()
    vi.mocked(join).mockReturnValueOnce(second.promise)
    await act(async () => handlersOf(home.input).onChange?.({ target: { value: 'rex2' } }))
    await home.submit()
    expect(join).toHaveBeenCalledTimes(2)
    expect(join).toHaveBeenLastCalledWith('rex2')
    expect(home.active).toBe(home.input)
    await second.settle(TAKEN, failJoin)
  })

  it('用滑鼠點按鈕或在風格卡片按 Enter 送出：加入中焦點不掉，失敗後焦點移到輸入框（錯誤訊息就在輸入框下方）', async () => {
    const home = await mountHome()
    const card = home.one((n) => n.attrs.role === 'radio' && n.attrs.tabindex === '0')
    for (const from of [home.button, card]) {
      const pending = deferred()
      vi.mocked(join).mockReturnValueOnce(pending.promise)
      from.focus()
      expect(home.active).toBe(from)
      await home.submit()
      expect(home.active).toBe(from)
      await pending.settle(TAKEN, failJoin)
      expect(home.active).toBe(home.input)
    }
    expect(join).toHaveBeenCalledTimes(2)
  })

  it('未連線（不是加入中）：按鈕維持原生 disabled（同原本），沒有 aria-disabled／aria-busy；輸入框照常可編輯；送出無效', async () => {
    for (const connection of ['connecting', 'disconnected'] as const) {
      const home = await mountHome({ connection })
      expect(home.button.attrs).toHaveProperty('disabled')
      expect(Object.keys(home.button.attrs).filter((k) => /aria-disabled|busy/.test(k))).toEqual([])
      expect(Object.keys(home.input.attrs).filter((k) => /disabled|readonly|busy/.test(k))).toEqual([])
      expect(home.active).toBe(home.input)
      await home.submit()
      expect(join).not.toHaveBeenCalled()
    }
  })

  it('連上線後按鈕恢復可按', async () => {
    const home = await mountHome({ connection: 'connecting' })
    expect(home.button.attrs).toHaveProperty('disabled')
    await act(async () => useGameStore.setState({ connection: 'connected' }))
    expect(Object.keys(home.button.attrs).filter((k) => /disabled|busy/.test(k))).toEqual([])
  })

  it('自動加入中（store.autoJoining）：同樣是 readOnly＋aria-busy／aria-disabled＋aria-busy，預設焦點仍在輸入框；按鈕文字不變', async () => {
    const home = await mountHome({ connection: 'connected', autoJoining: true })
    expect(home.input.attrs).toMatchObject({ readonly: '', 'aria-busy': 'true' })
    expect(home.button.attrs).toMatchObject({ 'aria-disabled': 'true', 'aria-busy': 'true' })
    expect(home.all().filter((n) => 'disabled' in n.attrs)).toEqual([])
    expect(textOf(home.button)).toBe('進入遊戲')
    expect(home.active).toBe(home.input)
    await home.submit()
    expect(join).not.toHaveBeenCalled()
    // 自動加入結束（失敗而留在首頁）：焦點在輸入框
    home.button.focus()
    await act(async () => useGameStore.setState({ autoJoining: false, joinError: '暱稱已被使用' }))
    expect(home.active).toBe(home.input)
    expect(Object.keys(home.button.attrs).filter((k) => /disabled|busy/.test(k))).toEqual([])
  })

  it('加入中又斷線：按鈕仍是 aria-disabled（不在加入中把有焦點的按鈕設成原生 disabled）', async () => {
    const pending = deferred()
    vi.mocked(join).mockReturnValue(pending.promise)
    const home = await mountHome()
    home.button.focus()
    await home.submit()
    await act(async () => useGameStore.setState({ connection: 'disconnected' }))
    expect(home.button.attrs).not.toHaveProperty('disabled')
    expect(home.button.attrs).toMatchObject({ 'aria-disabled': 'true', 'aria-busy': 'true' })
    expect(home.active).toBe(home.button)
    await pending.settle({ ok: false, error: 'DISCONNECTED', message: '尚未連線到伺服器，請稍候再試' }, failJoin)
    // 結束後回到「未連線」的原生 disabled；焦點已放回輸入框
    expect(home.button.attrs).toHaveProperty('disabled')
    expect(home.active).toBe(home.input)
  })

  it('外觀：加入中的透明度改掛 aria-busy／aria-disabled（輸入框 60%、按鈕 50%，同原本的 disabled:）；未連線的 disabled: 樣式保留', async () => {
    const home = await mountHome()
    const input = (home.input.attrs.class ?? '').split(' ')
    expect(input).toContain('aria-busy:opacity-60')
    expect(input).toContain('aria-busy:cursor-default')
    expect(input.filter((c) => c.startsWith('disabled:'))).toEqual([])
    for (const c of ['home-paper', 'bg-home-surface', 'border-home-border', 'aria-[invalid=true]:border-home-error']) expect(input, c).toContain(c)
    const button = (home.button.attrs.class ?? '').split(' ')
    for (const c of [
      'bg-home-accent',
      'enabled:hover:bg-home-accent-hover',
      'disabled:cursor-default',
      'disabled:opacity-50',
      'aria-disabled:cursor-default',
      'aria-disabled:opacity-50',
      // aria-disabled 時 hover 不變色（原生 disabled 時 enabled:hover 本來就不生效）
      'enabled:aria-disabled:hover:bg-home-accent',
    ]) {
      expect(button, c).toContain(c)
    }
  })

  it('靜態渲染（初始狀態＝未連線）：按鈕 disabled=""、輸入框沒有 readonly／aria-busy', () => {
    const html = renderToStaticMarkup(<HomeScreen />)
    const input = /<input [^>]*>/.exec(html)?.[0] ?? ''
    const button = /<button type="submit"[^>]*>/.exec(html)?.[0] ?? ''
    expect(input).not.toMatch(NATIVE_DISABLED)
    expect(input).not.toMatch(/\sreadonly|\saria-busy=/i)
    expect(input).toContain(' autofocus=""')
    expect(button).toContain(' disabled=""')
    expect(button).not.toMatch(/aria-disabled=|aria-busy=/)
  })

  it('原始碼守門：首頁的原生 disabled 只剩按鈕的「未連線且不是加入中」；風格卡片沒有原生 disabled', () => {
    const home = sourceOf('/home/HomeScreen.tsx')
    expect(home.match(/\sdisabled=\{[^}]*\}/g)).toEqual([' disabled={offline && !busy}'])
    expect(home).toContain('readOnly={busy}')
    expect(home.match(/aria-busy=\{busy \|\| undefined\}/g)).toHaveLength(2)
    expect(home).toContain('aria-disabled={busy || undefined}')
    expect(sourceOf('/home/HomeThemeCards.tsx')).not.toMatch(/\sdisabled=\{/)
  })
})

// ─── B. 「出題」 ───────────────────────────────────────────────────

describe('StatusButton：不可按／送出中只設 aria-disabled／aria-busy，不用原生 disabled', () => {
  const render = (props: { disabled?: boolean; busy?: boolean }, views: ShellViews = MEET_VIEWS) =>
    renderToStaticMarkup(
      <ShellViewsContext.Provider value={views}>
        <StatusButton label="分享音訊：出題" onClick={noop} {...props}>
          <span>分享音訊</span>
        </StatusButton>
      </ShellViewsContext.Provider>,
    )

  it('busy：aria-disabled="true"＋aria-busy="true"，沒有 disabled 屬性', () => {
    const html = render({ busy: true })
    expect(html).toContain(' aria-disabled="true" aria-busy="true"')
    expect(html).not.toMatch(NATIVE_DISABLED)
  })

  it('disabled：只有 aria-disabled（不是送出中，不帶 aria-busy），同樣沒有原生 disabled', () => {
    const html = render({ disabled: true })
    expect(html).toContain(' aria-disabled="true"')
    expect(html).not.toMatch(/\saria-busy=/)
    expect(html).not.toMatch(NATIVE_DISABLED)
  })

  it('可按：沒有 aria-disabled／aria-busy；disabled={false}、busy={false} 與省略相同', () => {
    const html = render({})
    expect(html).not.toMatch(/\saria-disabled=|\saria-busy=/)
    expect(html).not.toMatch(NATIVE_DISABLED)
    expect(render({ disabled: false, busy: false })).toBe(html)
  })

  it('外觀改掛 aria-disabled（opacity .6、cursor default、hover 底透明，同原本的 disabled:）；殼層色彩照舊', () => {
    for (const html of [render({}), render({ busy: true })]) {
      const cls = /class="([^"]*)"/.exec(html)?.[1]?.split(' ') ?? []
      for (const c of ['aria-disabled:cursor-default', 'aria-disabled:opacity-60', 'aria-disabled:hover:bg-transparent', 'cursor-pointer']) expect(cls, c).toContain(c)
      expect(cls.filter((c) => c.startsWith('disabled:'))).toEqual([])
      expect(html).toContain(MEET_VIEWS.status.buttonClassName)
    }
  })

  it('原始碼守門：StatusButton 沒有原生 disabled；「出題」以 busy 傳入', () => {
    expect(sourceOf('/layout/StatusItem.tsx')).not.toMatch(/\sdisabled=\{/)
    const round = sourceOf('/features/round/RoundStatus.tsx')
    expect(round).toMatch(/<StatusButton .*\sbusy=\{busy\}>/)
    expect(round).not.toMatch(/<StatusButton .*\sdisabled=/)
    // 正向對照
    expect(/\sdisabled=\{/.test('<button disabled={disabled} />')).toBe(true)
    expect(/\sdisabled=\{/.test('<button aria-disabled={inactive || undefined} />')).toBe(false)
  })
})

describe('StatusButton 的點擊：不可按期間在 onClick 內擋掉', () => {
  it.each([
    ['可按', {}, 1],
    ['busy', { busy: true }, 0],
    ['disabled', { disabled: true }, 0],
  ] as const)('%s', async (_name, props, calls) => {
    const onClick = vi.fn()
    const view = await mount(
      <ShellViewsContext.Provider value={MEET_VIEWS}>
        <StatusButton label="分享音訊：出題" onClick={onClick} {...props}>
          <span>分享音訊</span>
        </StatusButton>
      </ShellViewsContext.Provider>,
    )
    const button = view.one((n) => n.tagName === 'BUTTON')
    button.focus()
    await act(async () => handlersOf(button).onClick?.())
    expect(onClick).toHaveBeenCalledTimes(calls)
    // 不可按時仍可聚焦（不是原生 disabled）
    expect(view.active).toBe(button)
  })
})

describe('「出題」（VolunteerStatus）：殼層的 volunteer 插槽就是這顆 StatusButton；送出失敗後焦點留在按鈕上', () => {
  const NOT_ENOUGH: ActionOutcome = { ok: false, error: 'NOT_ENOUGH_PLAYERS', message: '至少要 2 人才能開始' }
  const player = (id: string): PlayerPublic => ({ id, nickname: id, score: 0, gameScore: 0, isSetter: false, hasGuessed: false, connected: true, joinedAt: 0 })

  const SHELLS: [string, ShellViews, string][] = [['meet', MEET_VIEWS, '分享音訊']]

  it.each(SHELLS)('%s：鍵盤觸發 → 送出中不重複送出 → 失敗後 busy 解除、焦點仍在按鈕、可再按一次', async (_name, views, label) => {
    useGameStore.setState({ me: 'a', players: [player('a'), player('b')] })
    const first = deferred()
    vi.mocked(volunteer).mockReturnValueOnce(first.promise)
    const view = await mount(
      <ShellViewsContext.Provider value={views}>
        <VolunteerStatus />
      </ShellViewsContext.Provider>,
    )
    // 這個殼層的 volunteer 插槽裡只有這一顆按鈕
    const button = view.one((n) => n.tagName === 'BUTTON')
    expect(button.attrs['aria-label']).toBe(`${label}：出題`)
    expect(textOf(button)).toBe(label)
    expect(Object.keys(button.attrs).filter((k) => /disabled|busy/.test(k))).toEqual([])

    // Tab 到按鈕後按 Enter／Space（瀏覽器對 button 觸發 click）
    button.focus()
    await act(async () => handlersOf(button).onClick?.())
    expect(volunteer).toHaveBeenCalledTimes(1)
    expect(button.attrs).toMatchObject({ 'aria-disabled': 'true', 'aria-busy': 'true' })
    expect(button.attrs).not.toHaveProperty('disabled')
    expect(textOf(button)).toBe('請稍候…')
    expect(view.active).toBe(button)

    // 送出中再按：不重複送出
    await act(async () => handlersOf(button).onClick?.())
    expect(volunteer).toHaveBeenCalledTimes(1)

    await first.settle(NOT_ENOUGH)
    expect(Object.keys(button.attrs).filter((k) => /disabled|busy/.test(k))).toEqual([])
    expect(textOf(button)).toBe(label)
    expect(textOf(view.one((n) => n.attrs.role === 'alert'))).toBe('至少要 2 人才能開始')
    expect(view.active).toBe(button)

    const second = deferred()
    vi.mocked(volunteer).mockReturnValueOnce(second.promise)
    await act(async () => handlersOf(button).onClick?.())
    expect(volunteer).toHaveBeenCalledTimes(2)
    await second.settle(NOT_ENOUGH)
    expect(view.active).toBe(button)
  })

  it('人數不足或局進行中：不渲染按鈕（殼層另以不可點的灰化樣式呈現，不是 StatusButton）', async () => {
    useGameStore.setState({ me: 'a', players: [player('a')] })
    const view = await mount(
      <ShellViewsContext.Provider value={MEET_VIEWS}>
        <VolunteerStatus />
      </ShellViewsContext.Provider>,
    )
    expect(view.maybe((n) => n.tagName === 'BUTTON')).toBeNull()
    await act(async () => useGameStore.setState({ players: [player('a'), player('b')], round: { ...useGameStore.getState().round, phase: 'playing' } }))
    expect(view.maybe((n) => n.tagName === 'BUTTON')).toBeNull()
    // ended（本局排名停著）人數足夠：可以再出題
    await act(async () => useGameStore.setState({ round: { ...useGameStore.getState().round, phase: 'ended' } }))
    expect(view.maybe((n) => n.tagName === 'BUTTON')).not.toBeNull()
  })
})
