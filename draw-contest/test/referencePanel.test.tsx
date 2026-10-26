// 像不像比賽的參考圖：store 的生命週期與作畫中的參考圖面板（Epic 20；plan/contest-mimic.md 決策 3、6、12；design §2）。
//   store：contest:reference 以 roundNo 配對（比 round:update 早到也收、舊回合的不收）、object URL 換一張／新回合／換回合快照／reset 時 revoke；
//          selectReferenceUrl、selectShowReferencePanel（mimic 且 drawing／judging；出題者、參賽者、旁觀者都看得到）。
//   面板：狀態轉移（展開 ⇄ 放大、展開 ⇄ 收合）、靜態渲染（section[aria-label="參考圖"]、按鈕名稱、尺寸 class、收合後 section 仍在、載入中）、
//         store 接線、ppt 殼層把 reference 插槽放進投影片工作區（對話框之前）。
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import type { PlayerPublic, RoomSnapshot, RoundPublic } from '@fishing-work/shared/draw-contest'
import { ReferencePanel, ReferencePanelView } from '../src/features/reference/ReferencePanel'
import { initialReferencePanelState, referencePanelNext, type ReferencePanelState } from '../src/features/reference/referencePanelState'
import { PPT_TOOLBAR_VIEW } from '../src/shells/ppt/pptViews'
import { REFERENCE_PANEL_TEXT } from '../src/features/reference/referenceText'
import { PptShell } from '../src/shells/ppt/PptShell'
import type { ShellProps } from '../src/shells/types'
import { initialGameState, initialRound, selectReferenceUrl, selectShowReferencePanel, useGameStore } from '../src/store/game'

const round = (patch: Partial<RoundPublic>): RoundPublic => ({ ...initialRound, ...patch })
const player = (id: string, patch: Partial<PlayerPublic> = {}): PlayerPublic => ({
  id,
  nickname: id,
  score: 0,
  connected: true,
  joinedAt: 0,
  isSetter: false,
  participating: false,
  submitted: false,
  ...patch,
})
const snapshot = (r: RoundPublic, you = 'me'): RoomSnapshot => ({ you, players: [player(you)], round: r, chat: [] })
const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer
const get = () => useGameStore.getState()

let created: MockInstance<typeof URL.createObjectURL>
let revoked: MockInstance<typeof URL.revokeObjectURL>
let seq = 0

beforeEach(() => {
  useGameStore.setState({ ...initialGameState, gallery: new Map(), reference: null })
  seq = 0
  created = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:ref/${++seq}`)
  revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

const drawingMimic = (roundNo = 1, patch: Partial<RoundPublic> = {}) =>
  round({ roundNo, phase: 'drawing', topic: '貓', mode: 'mimic', participantIds: ['me'], ...patch })

describe('store：參考圖（contest:reference）的 object URL 生命週期', () => {
  it('初始沒有參考圖；RoundPublic 的 mode／lastMode 初始為 null', () => {
    expect(get().reference).toBeNull()
    expect(initialRound.mode).toBeNull()
    expect(initialRound.lastMode).toBeNull()
  })

  it('收到本回合的參考圖：建 image/jpeg 的 object URL；再收到一張就 revoke 前一張', () => {
    get().applySnapshot(snapshot(drawingMimic(1)))
    get().setReference({ roundNo: 1, jpeg: jpeg() })
    expect(get().reference).toEqual({ roundNo: 1, url: 'blob:ref/1' })
    expect((created.mock.calls[0]?.[0] as Blob).type).toBe('image/jpeg')
    get().setReference({ roundNo: 1, jpeg: jpeg() })
    expect(revoked).toHaveBeenCalledWith('blob:ref/1')
    expect(get().reference?.url).toBe('blob:ref/2')
  })

  it('舊回合的參考圖不收；空 bytes 不收', () => {
    get().applySnapshot(snapshot(drawingMimic(3)))
    get().setReference({ roundNo: 2, jpeg: jpeg() })
    get().setReference({ roundNo: 3, jpeg: new ArrayBuffer(0) })
    expect(get().reference).toBeNull()
    expect(created).not.toHaveBeenCalled()
  })

  it('廣播比 round:update 早到：先收下（roundNo 比目前大），新回合開始時留著、不 revoke', () => {
    get().applySnapshot(snapshot(round({ roundNo: 1, phase: 'choosing' })))
    get().setReference({ roundNo: 2, jpeg: jpeg() })
    expect(selectReferenceUrl(get())).toBeNull()
    get().setRound(drawingMimic(2))
    expect(revoked).not.toHaveBeenCalled()
    expect(selectReferenceUrl(get())).toBe('blob:ref/1')
  })

  it('揭曉後（ended → idle → choosing）參考圖保留給揭曉畫廊；下一回合 drawing 開始時 revoke', () => {
    get().applySnapshot(snapshot(drawingMimic(1)))
    get().setReference({ roundNo: 1, jpeg: jpeg() })
    get().setRound(round({ roundNo: 1, phase: 'ended', results: [], lastTopic: '貓', lastMode: 'mimic' }))
    get().setRound(round({ roundNo: 1, phase: 'choosing', results: [], lastTopic: '貓', lastMode: 'mimic' }))
    expect(selectReferenceUrl(get())).toBe('blob:ref/1')
    expect(revoked).not.toHaveBeenCalled()
    get().setRound(round({ roundNo: 2, phase: 'drawing', topic: '狗', mode: 'topic' }))
    expect(revoked).toHaveBeenCalledWith('blob:ref/1')
    expect(get().reference).toBeNull()
  })

  it('同一回合的快照（重連接管）保留；換了回合的快照 revoke', () => {
    get().applySnapshot(snapshot(drawingMimic(1)))
    get().setReference({ roundNo: 1, jpeg: jpeg() })
    get().applySnapshot(snapshot(drawingMimic(1)))
    expect(get().reference?.url).toBe('blob:ref/1')
    get().applySnapshot(snapshot(drawingMimic(5)))
    expect(revoked).toHaveBeenCalledWith('blob:ref/1')
    expect(get().reference).toBeNull()
  })

  it('reset（離開遊戲）revoke', () => {
    get().applySnapshot(snapshot(drawingMimic(1)))
    get().setReference({ roundNo: 1, jpeg: jpeg() })
    get().reset()
    expect(revoked).toHaveBeenCalledWith('blob:ref/1')
    expect(get().reference).toBeNull()
  })

  it('selectShowReferencePanel：mimic 的 drawing／judging 才有；topic 模式、其餘階段沒有；與自己是不是參賽者無關', () => {
    const show = (r: Partial<RoundPublic>) => selectShowReferencePanel({ round: round(r) })
    expect(show({ phase: 'drawing', mode: 'mimic' })).toBe(true)
    expect(show({ phase: 'judging', mode: 'mimic' })).toBe(true)
    expect(show({ phase: 'drawing', mode: 'topic' })).toBe(false)
    expect(show({ phase: 'ended', mode: 'mimic' })).toBe(false)
    expect(show({ phase: 'choosing', mode: null })).toBe(false)
    expect(show({ phase: 'drawing', mode: 'mimic', participantIds: [] })).toBe(true)
  })
})

describe('參考圖面板：狀態轉移', () => {
  it('展開 ⇄ 放大、展開 ⇄ 收合；不合時宜的操作維持原狀態', () => {
    expect(referencePanelNext('expanded', 'zoom')).toBe('zoomed')
    expect(referencePanelNext('zoomed', 'unzoom')).toBe('expanded')
    expect(referencePanelNext('expanded', 'collapse')).toBe('collapsed')
    expect(referencePanelNext('collapsed', 'expand')).toBe('expanded')
    const stay: [ReferencePanelState, Parameters<typeof referencePanelNext>[1]][] = [
      ['collapsed', 'zoom'],
      ['zoomed', 'collapse'],
      ['expanded', 'unzoom'],
      ['expanded', 'expand'],
    ]
    for (const [state, action] of stay) expect(referencePanelNext(state, action), `${state} ${action}`).toBe(state)
  })

  it('文字照 plan 決策 12（AI 遊玩技能依賴）', () => {
    expect(REFERENCE_PANEL_TEXT).toMatchObject({ region: '參考圖', zoom: '放大參考圖', collapse: '收合參考圖', expand: '展開參考圖' })
  })
})

const view = (state: ReferencePanelState, url: string | null = 'blob:ref/1') =>
  renderToStaticMarkup(<ReferencePanelView url={url} state={state} onAction={() => {}} />)
const buttons = (html: string) => [...html.matchAll(/<button [^>]*aria-label="([^"]+)"/g)].map((m) => m[1])

describe('參考圖面板（靜態渲染）', () => {
  it('展開：section[aria-label="參考圖"] 浮在右上角，寬 25%（200～360px）、1px --border、陰影；按鈕「收合參考圖」「放大參考圖」', () => {
    const html = view('expanded')
    expect(html).toMatch(/<section aria-label="參考圖" class="[^"]*absolute top-3 right-3[^"]*"/)
    const section = /<section [^>]*>/.exec(html)?.[0] ?? ''
    for (const cls of ['w-[25%]', 'min-w-[200px]', 'max-w-[360px]', 'border', 'border-border', 'shadow-quickinput', 'bg-quickinput']) {
      expect(section, cls).toContain(cls)
    }
    expect(buttons(html)).toEqual(['收合參考圖', '放大參考圖'])
    expect(html).toContain('>參考圖<')
    expect(html).toMatch(/<button [^>]*aria-label="放大參考圖"[^>]*class="[^"]*aspect-video[^"]*bg-editor/)
    expect(html).toMatch(/<img src="blob:ref\/1" alt="參考圖"[^>]*object-contain/)
    // 色碼一律用 token
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it('收合：section 還在，裡面只剩「展開參考圖」一顆按鈕', () => {
    const html = view('collapsed')
    expect(html).toContain('<section aria-label="參考圖"')
    expect(buttons(html)).toEqual(['展開參考圖'])
    expect(html).not.toContain('<img')
    expect(/<section [^>]*>/.exec(html)?.[0]).not.toContain('w-[25%]')
  })

  it('放大：工作區中央的放大檢視（按鈕「縮小參考圖」有預設焦點、16:9 size container）；面板的 section 仍在', () => {
    const html = view('zoomed')
    expect(html).toContain('<section aria-label="參考圖"')
    expect(buttons(html)).toEqual(['收合參考圖', '放大參考圖', REFERENCE_PANEL_TEXT.unzoom])
    expect(html).toMatch(/<button type="button" autofocus="" data-reference-focus="zoomed" aria-label="縮小參考圖"/)
    expect(html).toContain('absolute inset-0 z-20')
    expect(html).toContain('[container-type:size]')
    expect(html).toContain('w-[min(100cqw,calc((100cqh-28px)*16/9))]')
  })

  it('圖還沒到：灰底「載入中」', () => {
    const html = view('expanded', null)
    expect(html).toContain('>載入中<')
    expect(html).not.toContain('<img')
  })
})

describe('參考圖面板：store 接線（元件自己決定渲染與否）', () => {
  // 靜態渲染時 zustand 讀的是 store 的初始狀態（server snapshot），接線改以原始碼守門；顯示條件本身由上面的 selector 測試驗
  const source =
    Object.values(import.meta.glob<string>('../src/features/reference/ReferencePanel.tsx', { query: '?raw', import: 'default', eager: true }))[0] ?? ''

  it('ReferencePanel 以 selectShowReferencePanel 決定渲染、以 selectReferenceUrl 取圖；初始狀態（idle）不渲染', () => {
    expect(source).toContain('const show = useGameStore(selectShowReferencePanel)')
    expect(source).toContain('const url = useGameStore(selectReferenceUrl)')
    expect(source).toMatch(/if \(!show\) return null/)
    expect(renderToStaticMarkup(<ReferencePanel />)).toBe('')
  })

  it('展開／收合／放大是元件自己的狀態（useState，初始狀態依視窗寬；不寫 localStorage）', () => {
    expect(source).toContain('useState<ReferencePanelState>(() => initialReferencePanelState(narrow))')
    expect(source).not.toMatch(/localStorage|sessionStorage/)
  })

  it('旁觀者與出題者也看得到：顯示條件與自己的身分無關（mimic 的 drawing／judging）', () => {
    const base = { round: drawingMimic(1, { participantIds: ['other'], setterId: 'me' }), reference: { roundNo: 1, url: 'blob:x' } }
    expect(selectShowReferencePanel(base)).toBe(true)
    expect(selectReferenceUrl(base)).toBe('blob:x')
    expect(selectReferenceUrl({ ...base, reference: { roundNo: 0, url: 'blob:old' } })).toBeNull()
  })
})

describe('ppt 殼層：reference 插槽放進投影片工作區（在投影片之後、對話框之前）', () => {
  type AnyElement = { type: unknown; props: Record<string, unknown> & { children?: unknown } }
  const slot = (name: string) => <span data-slot={name} />

  it('GameScreen 把 reference 交給外框的 floating', () => {
    const props: ShellProps = {
      screen: 'game',
      round: { phase: 'drawing', isSetter: false, canDraw: true, showCanvas: true, submitted: false, showReveal: false },
      counts: { online: 2, total: 2 },
      themes: { current: 'ppt', options: [], select: () => {} },
      help: { open: () => {} },
      history: { entries: [], openId: null, canOpen: false, open: () => {}, close: () => {}, refresh: () => {} },
      players: slot('players'),
      canvas: slot('canvas'),
      toolbar: slot('toolbar'),
      finish: slot('finish'),
      reveal: slot('reveal'),
      reference: slot('reference'),
      historyView: slot('historyView'),
      historyStatus: slot('historyStatus'),
      chat: slot('chat'),
      roundStatus: slot('roundStatus'),
      volunteer: slot('volunteer'),
      connection: slot('connection'),
      dialogs: slot('dialogs'),
    }
    const provider = PptShell(props) as AnyElement
    const game = provider.props.children as AnyElement
    const frame = (game.type as (p: unknown) => AnyElement)(game.props)
    expect(renderToStaticMarkup(<>{frame.props.floating as ReactNode}</>)).toBe('<span data-slot="reference"></span>')
  })

  it('外框在投影片工作區（main，position: relative）裡依序放 slide → floating → dialogs（原始碼守門）', () => {
    const source =
      Object.values(import.meta.glob<string>('../src/shells/ppt/PptShell.tsx', { query: '?raw', import: 'default', eager: true }))[0] ?? ''
    expect(source).toMatch(/<main aria-label="投影片" className="relative[^"]*">[\s\S]*?\{slide\}<\/div>\s*\{floating\}\s*\{dialogs\}\s*<\/main>/)
  })

  it('App 把 ReferencePanel 放進 reference 插槽（原始碼守門）', () => {
    const app = Object.values(import.meta.glob<string>('../src/App.tsx', { query: '?raw', import: 'default', eager: true }))[0] ?? ''
    expect(app).toContain('reference={<ReferencePanel />}')
  })
})

describe('Phase 2.5：窄視窗（< 工具列收合斷點）', () => {
  const source =
    Object.values(import.meta.glob<string>('../src/features/reference/ReferencePanel.tsx', { query: '?raw', import: 'default', eager: true }))[0] ?? ''
  const sectionTag = (html: string) => /<section [^>]*>/.exec(html)?.[0] ?? ''
  const narrowView = (state: ReferencePanelState) =>
    renderToStaticMarkup(<ReferencePanelView url="blob:ref/1" state={state} narrow onAction={() => {}} />)

  it('初始狀態：窄視窗收合、寬視窗展開', () => {
    expect(initialReferencePanelState(true)).toBe('collapsed')
    expect(initialReferencePanelState(false)).toBe('expanded')
  })

  it('斷點沿用殼層的工具列收合斷點（ppt 540px），只在掛載時決定初始狀態（原始碼守門）', () => {
    expect(PPT_TOOLBAR_VIEW.compactBelowPx).toBe(540)
    expect(source).toContain('const { compactBelowPx } = useToolbarView()')
    expect(source).toContain('const narrow = !useMediaQuery(fullToolbarQuery(compactBelowPx))')
    expect(source).toContain('useState<ReferencePanelState>(() => initialReferencePanelState(narrow))')
    expect(source).not.toMatch(/localStorage|sessionStorage/)
    // 不另寫斷點數字
    expect(source).not.toMatch(/\b540\b/)
  })

  it('窄視窗展開：寬度上限 calc(100% - 24px)、最小寬不超過它；不再有 min-w-[200px]／max-w-[360px]', () => {
    const tag = sectionTag(narrowView('expanded'))
    expect(tag).toContain('max-w-[calc(100%-24px)]')
    expect(tag).toContain('min-w-[min(200px,calc(100%-24px))]')
    expect(tag).not.toContain('min-w-[200px]')
    expect(tag).not.toContain('max-w-[360px]')
    expect(tag).toContain('w-[25%]')
  })

  it('窄視窗收合：section 仍在、只剩「展開參考圖」，同樣不超出工作區', () => {
    const html = narrowView('collapsed')
    expect(sectionTag(html)).toContain('aria-label="參考圖"')
    expect(sectionTag(html)).toContain('max-w-[calc(100%-24px)]')
    expect(buttons(html)).toEqual(['展開參考圖'])
  })

  it('寬視窗（narrow 省略或 false）維持原本的 25%／200～360px', () => {
    const tag = sectionTag(view('expanded'))
    expect(tag).toContain('min-w-[200px]')
    expect(tag).toContain('max-w-[360px]')
    expect(tag).not.toContain('calc(100%-24px)')
    expect(renderToStaticMarkup(<ReferencePanelView url="blob:ref/1" state="expanded" narrow={false} onAction={() => {}} />)).toBe(view('expanded'))
  })
})
