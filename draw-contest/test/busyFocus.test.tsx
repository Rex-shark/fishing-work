// 送出中（busy）不用原生 disabled（plan/notes.md 2026-10-12 追加 A、B）：被停用的元素會失去焦點，失敗後鍵盤就接不上。
//   A. 首頁暱稱輸入框：加入中是 readOnly＋aria-busy；「進入遊戲」按鈕加入中是 aria-disabled＋aria-busy（未連線才是原生 disabled）；
//      加入失敗後焦點放回輸入框；加入中不重複送出。
//   B. 「我出題」按鈕（layout/StatusItem 的 StatusButton，features/round/RoundStatus 的 VolunteerButton）：送出中是 aria-disabled＋aria-busy，
//      按了不觸發；連按不重複送出。
// 測試環境的限制（同 dialogBusy.test.tsx）：沒有 DOM 環境，document.activeElement 與狀態轉移測不到。這裡驗：
//   (1) 靜態渲染的屬性（store 以假狀態代入，同 pptComments.test.tsx 的做法）；
//   (2) 事件處理：在測試元件的 render 裡把元件當函式呼叫，取得它回傳的元素樹，再直接呼叫 onSubmit／onClick。
//       這樣拿到的是「還沒重繪」的那一版 callback，連續呼叫兩次正好對應「狀態更新前連按兩下」，可驗重複送出有被擋；
//   (3) 原始碼守門（失敗後 focus 輸入框的那一行、沒有原生 disabled）。焦點是否真的留在原處要靠瀏覽器實測。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { isValidElement, type ReactElement, type ReactNode } from 'react'

// 假 store：靜態渲染下 Zustand 只給初始狀態，這裡以可變的假狀態代入（各測試自行設定）
const fake = vi.hoisted(() => ({
  state: {
    connection: 'connected' as 'connected' | 'connecting' | 'disconnected',
    joinError: null as string | null,
    autoJoining: false,
    round: { phase: 'idle', setterId: null, topic: null, endsAt: null, results: null },
    players: [
      { id: 'a', nickname: 'rex', connected: true },
      { id: 'b', nickname: 'amy', connected: true },
    ],
  },
}))
vi.mock('../src/store/game', () => ({
  useGameStore: (selector: (s: typeof fake.state) => unknown) => selector(fake.state),
  selectIsSetter: () => false,
  selectIsParticipant: () => false,
}))
vi.mock('../src/socket/client', () => ({ join: vi.fn(), rememberedNickname: () => 'rex', volunteer: vi.fn() }))

const { VolunteerButton, VolunteerStatus } = await import('../src/features/round/RoundStatus')
const { HomeScreen } = await import('../src/home/HomeScreen')
const { StatusButton } = await import('../src/layout/StatusItem')
const { PPT_VIEWS } = await import('../src/shells/ppt/pptViews')
const { ShellViewsContext } = await import('../src/shells/views')
const { join, volunteer } = await import('../src/socket/client')

const sources = import.meta.glob<string>(
  ['../src/home/HomeScreen.tsx', '../src/layout/StatusItem.tsx', '../src/features/round/RoundStatus.tsx', '../src/shells/ppt/PptShell.tsx'],
  { query: '?raw', import: 'default', eager: true },
)
const sourceOf = (name: string) => Object.entries(sources).find(([f]) => f.endsWith(name))?.[1] ?? ''

const FAIL = { ok: false as const, error: 'NICKNAME_TAKEN' as const, message: '暱稱已被使用' }
const NOT_ENOUGH = { ok: false as const, error: 'NOT_ENOUGH_PLAYERS' as const, message: '至少要 2 位在線玩家才能開始' }
/** 原生 disabled 屬性（不含 aria-disabled、class 裡的 disabled:） */
const NATIVE_DISABLED = /\sdisabled(?:=""|\s|\/?>)/

type AnyElement = ReactElement<Record<string, unknown>>

/** 走訪元素樹（不渲染子元件）找出第一個符合條件的元素 */
function findElement(node: ReactNode, pred: (el: AnyElement) => boolean): AnyElement | undefined {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findElement(n as ReactNode, pred)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  if (!isValidElement<Record<string, unknown>>(node)) return undefined
  return pred(node) ? node : findElement(node.props.children as ReactNode, pred)
}

/** 在一次 render 裡把元件當函式呼叫，回傳它產生的元素樹（hooks 照常執行；不渲染結果） */
function elementsOf(component: () => ReactNode): ReactNode {
  let tree: ReactNode = null
  const Probe = () => {
    tree = component()
    return null
  }
  renderToStaticMarkup(
    <ShellViewsContext.Provider value={PPT_VIEWS}>
      <Probe />
    </ShellViewsContext.Provider>,
  )
  return tree
}

const setState = (patch: Partial<typeof fake.state>) => Object.assign(fake.state, patch)

beforeEach(() => {
  setState({ connection: 'connected', joinError: null, autoJoining: false })
  vi.mocked(join).mockReset().mockResolvedValue(FAIL)
  vi.mocked(volunteer).mockReset().mockResolvedValue(NOT_ENOUGH)
})

// ─── A. 首頁 ────────────────────────────────────────────────────────

const home = () => renderToStaticMarkup(<HomeScreen />)
const nicknameInput = (html: string) => /<input [^>]*name="nickname"[^>]*>/.exec(html)?.[0] ?? ''
const enterButton = (html: string) => /<button type="submit"[^>]*>[^<]*<\/button>/.exec(html)?.[0] ?? ''
const classOf = (tag: string) => /class="([^"]*)"/.exec(tag)?.[1]?.split(' ') ?? []

describe('A. 首頁暱稱輸入框：加入中是 readOnly＋aria-busy，不是原生 disabled', () => {
  it('已連線、沒有在加入：可編輯（沒有 readonly／aria-busy／disabled），預設焦點在輸入框', () => {
    const input = nicknameInput(home())
    expect(input).toContain(' autofocus=""')
    expect(input).toContain(' value="rex"')
    expect(input).not.toMatch(/\sreadonly/i)
    expect(input).not.toMatch(/\saria-busy=/)
    expect(input).not.toMatch(NATIVE_DISABLED)
  })

  it('加入中（busy）：readOnly、aria-busy="true"，沒有 disabled 屬性（焦點不會掉）', () => {
    setState({ autoJoining: true })
    const input = nicknameInput(home())
    expect(input).toContain(' readOnly=""')
    expect(input).toContain(' aria-busy="true"')
    expect(input).not.toMatch(NATIVE_DISABLED)
    expect(input).toContain(' autofocus=""')
  })

  it('未連線（不是加入中）：輸入框照常可編輯', () => {
    setState({ connection: 'connecting' })
    const input = nicknameInput(home())
    expect(input).not.toMatch(/\sreadonly/i)
    expect(input).not.toMatch(/\saria-busy=/)
    expect(input).not.toMatch(NATIVE_DISABLED)
  })

  it('外觀：加入中的透明度改掛 aria-busy（與原本 disabled 時相同的 60%），沒有 disabled: 的樣式；其餘 class 不變', () => {
    const cls = classOf(nicknameInput(home()))
    expect(cls).toContain('aria-busy:opacity-60')
    expect(cls).toContain('aria-busy:cursor-default')
    expect(cls.filter((c) => c.startsWith('disabled:'))).toEqual([])
    for (const c of ['home-paper', 'bg-home-surface', 'text-home-fg', 'border-home-border', 'focus:border-home-accent', 'aria-[invalid=true]:border-home-error']) {
      expect(cls, c).toContain(c)
    }
  })

  it('加入失敗的錯誤訊息仍掛在輸入框上（aria-invalid、aria-describedby、role="alert"）', () => {
    setState({ joinError: '暱稱已被使用' })
    const html = home()
    expect(nicknameInput(html)).toContain(' aria-invalid="true"')
    expect(html).toMatch(/role="alert"[^>]*>暱稱已被使用<\/p>/)
  })
})

describe('A.「進入遊戲」按鈕：三種狀態', () => {
  it('可送出（已連線、沒有在加入）：沒有 disabled、aria-disabled、aria-busy', () => {
    const button = enterButton(home())
    expect(button).toContain('>進入遊戲</button>')
    expect(button).not.toMatch(NATIVE_DISABLED)
    expect(button).not.toMatch(/\saria-disabled=|\saria-busy=/)
  })

  it('加入中（busy）：aria-disabled＋aria-busy，不是原生 disabled（按鈕仍可聚焦）', () => {
    setState({ autoJoining: true })
    const button = enterButton(home())
    expect(button).toContain(' aria-disabled="true"')
    expect(button).toContain(' aria-busy="true"')
    expect(button).not.toMatch(NATIVE_DISABLED)
    // 整個首頁加入中都沒有原生 disabled
    expect(home()).not.toMatch(NATIVE_DISABLED)
  })

  it.each(['connecting', 'disconnected'] as const)('未連線（%s、不是加入中）：維持原生 disabled，沒有 aria-disabled／aria-busy', (connection) => {
    setState({ connection })
    const button = enterButton(home())
    expect(button).toMatch(NATIVE_DISABLED)
    expect(button).not.toMatch(/\saria-disabled=|\saria-busy=/)
  })

  it('未連線又在加入中：以加入中為準（aria-disabled＋aria-busy，不是原生 disabled）', () => {
    setState({ connection: 'connecting', autoJoining: true })
    const button = enterButton(home())
    expect(button).toContain(' aria-disabled="true"')
    expect(button).not.toMatch(NATIVE_DISABLED)
  })

  it('外觀：原本 disabled: 的樣式保留（未連線用），另掛同值的 aria-disabled:（加入中用）；hover 只在可按時生效', () => {
    const cls = classOf(enterButton(home()))
    for (const c of ['disabled:cursor-default', 'disabled:opacity-50', 'aria-disabled:cursor-default', 'aria-disabled:opacity-50']) expect(cls, c).toContain(c)
    expect(cls).toContain('enabled:not-aria-disabled:hover:bg-home-accent-hover')
    expect(cls).not.toContain('enabled:hover:bg-home-accent-hover')
    for (const c of ['bg-home-accent', 'text-home-on-accent', 'cursor-pointer', 'focus-visible:outline-home-accent']) expect(cls, c).toContain(c)
  })
})

describe('A. 首頁送出：加入中不重複送出；失敗後可以再送', () => {
  const submit = (tree: ReactNode) => {
    const form = findElement(tree, (el) => el.type === 'form')
    expect(form).toBeDefined()
    ;(form?.props.onSubmit as (e: { preventDefault(): void }) => void)({ preventDefault: () => {} })
  }

  it('送出（Enter／按鈕）呼叫 join 一次；狀態還沒更新前再送一次也不會重複（以 ref 擋）', async () => {
    const tree = elementsOf(HomeScreen)
    submit(tree)
    submit(tree)
    expect(join).toHaveBeenCalledTimes(1)
    expect(join).toHaveBeenLastCalledWith('rex')
    // 失敗（暱稱重複）後放行：同一個表單可以再送
    await expect(vi.mocked(join).mock.results[0]?.value).resolves.toEqual(FAIL)
    await vi.waitFor(() => {
      submit(tree)
      expect(join).toHaveBeenCalledTimes(2)
    })
  })

  it('加入中（busy）送出：不呼叫 join', () => {
    setState({ autoJoining: true })
    submit(elementsOf(HomeScreen))
    expect(join).not.toHaveBeenCalled()
  })

  it('未連線送出：不呼叫 join（同原本）', () => {
    setState({ connection: 'disconnected' })
    submit(elementsOf(HomeScreen))
    expect(join).not.toHaveBeenCalled()
  })

  it('原始碼守門：輸入框與按鈕不再有 disabled={busy}／disabled={!canSubmit}；加入失敗時 focus 輸入框', () => {
    const src = sourceOf('HomeScreen.tsx')
    expect(src.length).toBeGreaterThan(0)
    expect(src).not.toMatch(/disabled=\{busy\}|disabled=\{!canSubmit\}/)
    expect(src).toContain('readOnly={busy}')
    expect(src).toContain("disabled={!busy && connection !== 'connected'}")
    expect(src).toMatch(/<input\s+ref=\{inputRef\}/)
    expect(src).toMatch(/const r = await join\(nickname\)[\s\S]*?\} else \{[\s\S]*?inputRef\.current\?\.focus\(\)/)
  })
})

// ─── B.「我出題」按鈕 ─────────────────────────────────────────────────

const withViews = (node: ReactNode) => renderToStaticMarkup(<ShellViewsContext.Provider value={PPT_VIEWS}>{node}</ShellViewsContext.Provider>)

describe('B. StatusButton：送出中是 aria-disabled＋aria-busy，不是原生 disabled', () => {
  const render = (busy?: boolean) =>
    withViews(
      <StatusButton label="開始：我出題" onClick={() => {}} busy={busy}>
        <span>開始</span>
      </StatusButton>,
    )

  it('busy：aria-disabled="true"、aria-busy="true"，沒有 disabled 屬性（焦點留在按鈕上）', () => {
    const html = render(true)
    expect(html).toContain(' aria-disabled="true"')
    expect(html).toContain(' aria-busy="true"')
    expect(html).not.toMatch(NATIVE_DISABLED)
    expect(html).toContain('aria-label="開始：我出題"')
  })

  it('不是 busy（或省略）：沒有 aria-disabled／aria-busy／disabled', () => {
    for (const html of [render(false), render()]) {
      expect(html).not.toMatch(/\saria-disabled=|\saria-busy=/)
      expect(html).not.toMatch(NATIVE_DISABLED)
    }
    expect(render()).toBe(render(false))
  })

  it('外觀：原本 disabled: 的三個樣式改掛 aria-disabled:（60% 透明、預設游標、沒有 hover 底）；殼層給的色彩照舊', () => {
    const cls = classOf(render(true))
    for (const c of ['aria-disabled:cursor-default', 'aria-disabled:opacity-60', 'aria-disabled:hover:bg-transparent']) expect(cls, c).toContain(c)
    expect(cls.filter((c) => c.startsWith('disabled:'))).toEqual([])
    for (const c of ['text-fg', 'hover:bg-statusbar-hover', 'focus-visible:outline-border-focus', 'cursor-pointer']) expect(cls, c).toContain(c)
  })

  it('busy 時按下不觸發 onClick；不是 busy 才觸發', () => {
    const onClick = vi.fn()
    const click = (busy: boolean) => {
      const button = findElement(
        elementsOf(() => StatusButton({ label: 'x', onClick, busy, children: null })),
        (el) => el.type === 'button',
      )
      expect(button).toBeDefined()
      ;(button?.props.onClick as () => void)()
    }
    click(true)
    expect(onClick).not.toHaveBeenCalled()
    click(false)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('原始碼守門：StatusItem.tsx 沒有原生 disabled 屬性', () => {
    const src = sourceOf('StatusItem.tsx')
    expect(src.length).toBeGreaterThan(0)
    expect(src).not.toMatch(/\sdisabled=\{/)
    expect(src).toContain('aria-disabled={busy || undefined}')
    expect(src).toContain('aria-busy={busy || undefined}')
  })
})

describe('B.「我出題」（VolunteerButton）：把 busy 交給 StatusButton，重複送出在這裡擋', () => {
  const volunteerButton = () => findElement(elementsOf(VolunteerButton), (el) => el.type === StatusButton)

  it('交給 StatusButton 的是 busy（初始 false），沒有 disabled', () => {
    const el = volunteerButton()
    expect(el).toBeDefined()
    expect(el?.props.busy).toBe(false)
    expect(Object.keys(el?.props ?? {})).not.toContain('disabled')
    expect(el?.props.label).toBe('從目前投影片開始：我出題')
  })

  it('按下呼叫 round:volunteer 一次；狀態還沒更新前連按也不重複（以 ref 擋）；失敗（人數不足）後可以再按', async () => {
    const el = volunteerButton()
    const click = el?.props.onClick as () => void
    click()
    click()
    click()
    expect(volunteer).toHaveBeenCalledTimes(1)
    await expect(vi.mocked(volunteer).mock.results[0]?.value).resolves.toEqual(NOT_ENOUGH)
    await vi.waitFor(() => {
      click()
      expect(volunteer).toHaveBeenCalledTimes(2)
    })
  })

  it('實際渲染（VolunteerStatus → ppt 的狀態列按鈕）：可按的狀態下沒有任何停用屬性', () => {
    const html = withViews(<VolunteerStatus />)
    expect(html).toContain('aria-label="從目前投影片開始：我出題"')
    expect(html).not.toMatch(NATIVE_DISABLED)
    expect(html).not.toMatch(/\saria-disabled=|\saria-busy=/)
  })

  it('原始碼守門：RoundStatus 傳 busy={busy}、不傳 disabled；ppt 殼層沒有自己另外渲染這顆按鈕（灰化版是 aria-hidden 的 span，不可聚焦）', () => {
    const round = sourceOf('RoundStatus.tsx')
    expect(round).toContain('busy={busy}')
    expect(round).not.toMatch(/disabled=\{busy\}/)
    const shell = sourceOf('PptShell.tsx')
    expect(shell).not.toContain('StatusButton')
    expect(shell).toMatch(/function StartSlideshowIdle\(\) \{[\s\S]*?<span aria-hidden="true"/)
  })
})
