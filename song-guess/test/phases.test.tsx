// 各階段的畫面文字（spec/song-guess/design.md §2「各階段對照」逐列）與出題對話框的流程：
// 功能元件（RoundStatus、Stage、SourceDialog、PlayerList、ChatPanel）接真的 store，放在 meet 殼層的 ShellViews 之下，掛在假 DOM 上（test/fakeDom.tsx）。
// 驗的是「store 是這個狀態時，畫面上實際出現的字」；版面與樣式以瀏覽器實測為準。socket 以假的代替。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, type ReactNode } from 'react'
import type { RoundPublic } from '@fishing-work/shared/song-guess'
import { ChatPanel } from '../src/features/chat/ChatPanel'
import { useAudioStore } from '../src/features/player/audioState'
import { PlayerList } from '../src/features/players/PlayerList'
import { HOT_STORAGE_KEY } from '../src/features/round/hotPreference'
import { SourceDialog } from '../src/features/round/SourceDialog'
import { RoundStatus } from '../src/features/round/RoundStatus'
import { Stage } from '../src/features/stage/Stage'
import { MEET_VIEWS } from '../src/shells/meet/meetViews'
import { ShellViewsContext } from '../src/shells/views'
import { cancelRound, setSource, type ActionOutcome } from '../src/socket/client'
import { initialGameState, useGameStore, type GameState } from '../src/store/game'
import { deferred, handlersOf, mount, textOf, unmountAll, type FakeNode } from './fakeDom'
import { chartRound, player, playingRound, result, reveal, round, song } from './fixtures'

vi.mock('../src/socket/client', () => ({ setSource: vi.fn(), cancelRound: vi.fn(), volunteer: vi.fn(), sendChat: vi.fn() }))

const T0 = 1_700_000_000_000
const noop = () => {}

const PLAYERS = [player('p1', { nickname: 'rex' }), player('p2', { nickname: 'amy' }), player('p3', { nickname: 'bob' })]

function Screen({ children }: { children?: ReactNode }) {
  return (
    <ShellViewsContext.Provider value={MEET_VIEWS}>
      <div data-area="stage">
        <Stage />
      </div>
      <div data-area="caption">
        <RoundStatus />
      </div>
      <div data-area="dialogs">
        <SourceDialog />
      </div>
      {children}
    </ShellViewsContext.Provider>
  )
}

/** 以 me 的身分掛上畫面；round 的時間欄位以假時鐘的現在為準（偏移 0） */
async function show(roundState: RoundPublic, over: Partial<GameState> = {}, extra?: ReactNode) {
  useGameStore.setState({ me: 'p1', players: PLAYERS, round: roundState, clockOffset: 0, ...over })
  const view = await mount(<Screen>{extra}</Screen>)
  const area = (name: string) => view.one((n) => n.attrs['data-area'] === name)
  const find = (root: FakeNode, pred: (n: FakeNode) => boolean): FakeNode[] => [
    ...(pred(root) ? [root] : []),
    ...root.childNodes.flatMap((c) => (c.nodeType === 1 ? find(c, pred) : [])),
  ]
  return {
    ...view,
    area,
    find,
    /** 回合狀態列看得到的字（不含給報讀器的 role="status"） */
    caption: () => {
      const root = area('caption').childNodes[0] as FakeNode
      return root.childNodes.map((c) => (c.nodeType === 1 && c.attrs.role === 'status' ? '' : c.nodeType === 1 ? textOf(c) : c.nodeValue)).join('')
    },
    announcement: () => textOf(view.one((n) => n.attrs.role === 'status' && n.attrs.class === 'sr-only')),
    stage: () => textOf(area('stage')),
    stageKind: () => find(area('stage'), (n) => 'data-stage' in n.attrs)[0]?.attrs['data-stage'] ?? null,
    dialog: () => view.maybe((n) => n.attrs.role === 'dialog'),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
})

afterEach(async () => {
  await unmountAll()
  vi.useRealTimers()
  vi.mocked(setSource).mockReset()
  vi.mocked(cancelRound).mockReset()
  useGameStore.setState({ ...initialGameState })
  useAudioStore.setState({ state: 'idle' })
})

const RESULTS = [result('p2', 1, 412, 5, 'amy'), result('p1', 2, 300, 4, 'rex'), result('p3', 3, 0, 0, 'bob')]

describe('design §2 各階段對照：舞台與字幕列的實際文字', () => {
  it('idle（無結果）：舞台「尚無人分享音訊」；字幕列「按「分享音訊」出題（需 2 人以上）」', async () => {
    const s = await show(round({ phase: 'idle', gameNo: 0 }))
    expect(s.stage()).toBe('尚無人分享音訊')
    expect(s.stageKind()).toBe('empty')
    expect(s.caption()).toBe('按「分享音訊」出題（需 2 人以上）')
    expect(s.dialog()).toBeNull()
  })

  it('idle（有上一局結果）：舞台是上一局排名表（標題「本局結果 · 孫燕姿」）；字幕列同上', async () => {
    const s = await show(round({ phase: 'idle', results: RESULTS, lastTopic: '孫燕姿', lastSource: 'artist' }))
    expect(s.stageKind()).toBe('results')
    expect(s.stage()).toContain('本局結果 · 孫燕姿')
    expect(s.stage()).toContain('名次暱稱本局得分猜對首數')
    expect(s.find(s.area('stage'), (n) => n.tagName === 'TR' && 'data-rank' in n.attrs).map((n) => textOf(n))).toEqual(['1amy4125', '2rex（你）3004', '3bob00'])
    expect(s.caption()).toBe('按「分享音訊」出題（需 2 人以上）')
  })

  it('choosing（自己是出題者）：對話框「分享音訊」；字幕列「正在出題 · 00:52」；舞台留白', async () => {
    const s = await show(round({ phase: 'choosing', setterId: 'p1', endsAt: T0 + 52_000 }))
    expect(s.dialog()).not.toBeNull()
    expect(textOf(s.one((n) => n.tagName === 'H2'))).toBe('分享音訊')
    expect(s.caption()).toBe('正在出題 · 00:52')
    expect(s.stage()).toBe('')
  })

  it('choosing（其他人）：舞台「<出題者> 正在準備分享音訊…」；字幕列「等待 <出題者> 出題 · 00:52」；沒有對話框', async () => {
    const s = await show(round({ phase: 'choosing', setterId: 'p2', endsAt: T0 + 52_000 }))
    expect(s.stage()).toBe('amy 正在準備分享音訊…')
    expect(s.caption()).toBe('等待 amy 出題 · 00:52')
    expect(s.dialog()).toBeNull()
  })

  it('choosing：上一局的結果還在（results 保留到第 1 首開始），但舞台不顯示排名表', async () => {
    const s = await show(round({ phase: 'choosing', setterId: 'p2', endsAt: T0 + 60_000, results: RESULTS, lastTopic: '孫燕姿', lastSource: 'artist' }))
    expect(s.stageKind()).toBe('preparing')
    expect(s.stage()).not.toContain('本局結果')
  })

  it('playing：舞台「孫燕姿 · 第 2 / 5 首」（本首歌手同題庫標題，不重複；沒有歌名與封面）；字幕列「歌名 ＿ ＿ ＿（3 字） · 00:21」', async () => {
    const r = playingRound({ setterId: 'p2' }, { index: 2, titleLength: 3, startedAt: T0 - 9000, durationMs: 30_000 })
    const s = await show(r)
    expect(s.stageKind()).toBe('playing')
    expect(s.stage()).toBe('孫燕姿 · 第 2 / 5 首')
    expect(s.find(s.area('stage'), (n) => n.tagName === 'IMG')).toEqual([])
    expect(s.caption()).toBe('歌名 ＿ ＿ ＿（3 字） · 00:21')
    expect(s.announcement()).toBe('第 2 首開始，歌名 3 個字')
  })

  it('playing：題庫標題顯示正式名稱（topic），不是出題者輸入的字；只抽熱門歌時加「（熱門）」', async () => {
    const s = await show(playingRound({ artist: 'jay chou', topic: '周杰倫', artistHot: true }, { index: 1, startedAt: T0, artist: '周杰倫' }))
    expect(s.stage()).toBe('周杰倫（熱門） · 第 1 / 5 首')
    expect(s.stage()).not.toContain('jay chou')
  })

  it('playing（歌手模式、本首歌手不同，例如合唱）：第二行「歌手：…」', async () => {
    const s = await show(playingRound({ artistHot: true }, { index: 3, startedAt: T0, artist: '孫燕姿 & 林俊傑' }))
    const lines = s.find(s.area('stage'), (n) => n.tagName === 'P').map((n) => textOf(n))
    expect(lines).toEqual(['孫燕姿（熱門） · 第 3 / 5 首', '歌手：孫燕姿 & 林俊傑'])
  })

  it('playing（台灣熱門／西洋熱門）：第一行「台灣熱門 · 第 2 / 5 首」，第二行逐首顯示該首歌手', async () => {
    const s = await show(chartRound('tw-hot', '台灣熱門', { setterId: 'p2' }, { index: 2, startedAt: T0, artist: '告五人' }))
    const lines = () => s.find(s.area('stage'), (n) => n.tagName === 'P').map((n) => textOf(n))
    expect(lines()).toEqual(['台灣熱門 · 第 2 / 5 首', '歌手：告五人'])
    // 下一首換了歌手
    await act(async () => useGameStore.getState().setRound(chartRound('tw-hot', '台灣熱門', { setterId: 'p2' }, { index: 3, startedAt: T0, artist: 'BLACKPINK' }), Date.now()))
    expect(lines()).toEqual(['台灣熱門 · 第 3 / 5 首', '歌手：BLACKPINK'])
    await act(async () => useGameStore.getState().setRound(chartRound('western-hot', '西洋熱門', { setterId: 'p2' }, { index: 1, startedAt: T0, artist: 'Taylor Swift' }), Date.now()))
    expect(lines()).toEqual(['西洋熱門 · 第 1 / 5 首', '歌手：Taylor Swift'])
  })

  it('playing：倒數每秒更新；起播緩衝期間停在整首長度', async () => {
    const s = await show(playingRound({}, { titleLength: 2, startedAt: T0 + 1500, durationMs: 30_000 }))
    expect(s.caption()).toBe('歌名 ＿ ＿（2 字） · 00:30')
    await act(async () => void (await vi.advanceTimersByTimeAsync(1500)))
    expect(s.caption()).toBe('歌名 ＿ ＿（2 字） · 00:30')
    await act(async () => void (await vi.advanceTimersByTimeAsync(9000)))
    expect(s.caption()).toBe('歌名 ＿ ＿（2 字） · 00:21')
  })

  it('playing（自己已猜對）：字幕列改「你猜對了 +87 · 00:21」；歌繼續播（舞台不變）', async () => {
    const r = playingRound({}, { index: 2, titleLength: 3, startedAt: T0 - 9000, durationMs: 30_000 })
    const s = await show(r, { players: [player('p1', { nickname: 'rex', gameScore: 100 }), PLAYERS[1]!, PLAYERS[2]!], gainBase: { key: '1:2', base: 100 } })
    expect(s.caption()).toBe('歌名 ＿ ＿ ＿（3 字） · 00:21')
    // server 判定猜對：players:update（gameScore、hasGuessed）＋ round:update（correctIds）
    await act(async () => {
      useGameStore.getState().setPlayers([player('p1', { nickname: 'rex', gameScore: 187, score: 187, hasGuessed: true }), PLAYERS[1]!, PLAYERS[2]!])
      useGameStore.getState().setRound({ ...r, song: r.song && { ...r.song, correctIds: ['p1'] }, serverNow: Date.now() }, Date.now())
    })
    expect(s.caption()).toBe('你猜對了 +87 · 00:21')
    expect(s.announcement()).toBe('你猜對了，得 87 分')
    expect(s.stage()).toBe('孫燕姿 · 第 2 / 5 首')
  })

  it('playing：瀏覽器擋自動播放時舞台出現按鈕「點一下開始播放」', async () => {
    const s = await show(playingRound({}, { startedAt: T0 - 1000 }))
    expect(s.find(s.area('stage'), (n) => n.tagName === 'BUTTON')).toEqual([])
    await act(async () => useAudioStore.getState().setState('blocked'))
    const [button] = s.find(s.area('stage'), (n) => n.tagName === 'BUTTON')
    expect(button && textOf(button)).toBe('點一下開始播放')
    await act(async () => useAudioStore.getState().setState('playing'))
    expect(s.find(s.area('stage'), (n) => n.tagName === 'BUTTON')).toEqual([])
  })

  it('reveal：舞台是揭曉卡（歌名、歌手、猜對者與分數、300px 封面）；字幕列「下一首 00:04」', async () => {
    const rv = reveal({ index: 2, title: '遇見', artist: '孫燕姿', scores: [{ playerId: 'p2', score: 96 }, { playerId: 'p1', score: 87 }] })
    const s = await show(round({ phase: 'reveal', setterId: 'p2', source: 'artist', artist: '孫燕姿', topic: '孫燕姿', song: song({ index: 2 }), reveal: rv, endsAt: T0 + 4000 }))
    expect(s.stageKind()).toBe('reveal')
    expect(textOf(s.one((n) => 'data-reveal-title' in n.attrs))).toBe('遇見')
    expect(textOf(s.one((n) => 'data-reveal-artist' in n.attrs))).toBe('孫燕姿')
    expect(s.find(s.area('stage'), (n) => n.tagName === 'LI').map((n) => textOf(n))).toEqual(['amy+96', 'rex+87'])
    expect(s.one((n) => n.tagName === 'IMG').attrs.src).toMatch(/300x300bb\.jpg$/)
    expect(s.caption()).toBe('下一首 00:04')
    expect(s.announcement()).toBe('第 2 首：《遇見》，孫燕姿，2 人猜對')
  })

  it('reveal（沒人猜對）：「沒有人猜對」', async () => {
    const s = await show(round({ phase: 'reveal', song: song({ index: 1 }), reveal: reveal({ index: 1 }), endsAt: T0 + 5000 }))
    expect(s.stage()).toContain('沒有人猜對')
    expect(s.caption()).toBe('下一首 00:05')
  })

  it('reveal（第 5 首）：字幕列「本局結束」', async () => {
    const s = await show(round({ phase: 'reveal', song: song({ index: 5 }), reveal: reveal({ index: 5 }), endsAt: T0 + 5000 }))
    expect(s.caption()).toBe('本局結束')
  })

  it('排名表標題用 lastTopic（歌手正式名，與播放中顯示的一致），不是出題者輸入的字；也不帶「（熱門）」', async () => {
    const s = await show(
      round({ phase: 'ended', setterId: 'p2', source: 'artist', artist: 'jay chou', artistHot: true, topic: '周杰倫', reveal: reveal({ index: 5 }), results: RESULTS, lastTopic: '周杰倫', lastSource: 'artist' }),
    )
    expect(s.stage()).toContain('本局結果 · 周杰倫')
    expect(s.stage()).not.toContain('jay chou')
    expect(s.stage()).not.toContain('熱門')
    // 之後有人出題又取消回到 idle：artist／topic 清空，標題仍讀 lastTopic
    await act(async () => useGameStore.getState().setRound(round({ phase: 'idle', results: RESULTS, lastTopic: '周杰倫', lastSource: 'artist' }), Date.now()))
    expect(s.stage()).toContain('本局結果 · 周杰倫')
  })

  it('排名表標題（榜單）：「本局結果 · 台灣熱門」「本局結果 · 西洋熱門」', async () => {
    const s = await show(round({ phase: 'ended', setterId: 'p2', source: 'tw-hot', topic: '台灣熱門', reveal: reveal({ index: 5 }), results: RESULTS, lastTopic: '台灣熱門', lastSource: 'tw-hot' }))
    expect(s.stage()).toContain('本局結果 · 台灣熱門')
    await act(async () => useGameStore.getState().setRound(round({ phase: 'idle', results: RESULTS, lastTopic: '西洋熱門', lastSource: 'western-hot' }), Date.now()))
    expect(s.stage()).toContain('本局結果 · 西洋熱門')
  })

  it('ended：舞台是本局排名表；字幕列「本局第一名：X（n 分）」', async () => {
    const s = await show(round({ phase: 'ended', setterId: 'p2', source: 'artist', artist: '孫燕姿', topic: '孫燕姿', reveal: reveal({ index: 5 }), results: RESULTS, lastTopic: '孫燕姿', lastSource: 'artist' }))
    expect(s.stageKind()).toBe('results')
    expect(s.stage()).toContain('本局結果 · 孫燕姿')
    expect(s.caption()).toBe('本局第一名：amy（412 分）')
    // 前三名加強調色
    expect(s.find(s.area('stage'), (n) => n.tagName === 'TR' && n.attrs.class === 'text-accent')).toHaveLength(3)
  })

  it('ended（第一名 0 分、沒有人猜對）：字幕列「本局結束：沒有人猜對」，排名表照樣顯示', async () => {
    const zero = [result('p1', 1, 0, 0, 'rex'), result('p2', 2, 0, 0, 'amy')]
    const s = await show(round({ phase: 'ended', setterId: 'p2', source: 'tw-hot', topic: '台灣熱門', reveal: reveal({ index: 5 }), results: zero, lastTopic: '台灣熱門', lastSource: 'tw-hot' }))
    expect(s.caption()).toBe('本局結束：沒有人猜對')
    expect(s.announcement()).toBe('本局結束：沒有人猜對')
    expect(s.stageKind()).toBe('results')
  })
})

describe('玩家清單與聊天提示隨階段變化', () => {
  it('揭曉時每位猜對者的列帶本首得分；播放中只有自己的', async () => {
    const rv = reveal({ index: 2, scores: [{ playerId: 'p2', score: 96 }] })
    const s = await show(round({ phase: 'reveal', song: song({ index: 2 }), reveal: rv }), {}, <PlayerList />)
    const tile = (id: string) => s.one((n) => n.attrs['data-player'] === id && n.tagName === 'LI' && 'data-tooltip' in n.attrs)
    expect(tile('p2').attrs['data-tooltip']).toBe('amy：0 分，本首 +96')
    expect(tile('p1').attrs['data-tooltip']).toBe('rex：0 分，你')
  })

  it('聊天輸入列的提示：「輸入歌名或聊天」；播放中自己猜對後改「聊天（不可說出歌名）」', async () => {
    const r = playingRound({}, { index: 1, startedAt: T0 })
    const s = await show(r, {}, <ChatPanel />)
    const hint = () => textOf(s.one((n) => n.tagName === 'P' && typeof n.attrs.id === 'string' && n.attrs.class?.includes('text-fg-on-panel-muted') === true))
    expect(hint()).toBe('輸入歌名或聊天')
    expect(s.one((n) => n.tagName === 'INPUT' && n.attrs['aria-label'] === '聊天輸入').attrs.placeholder).toBe('傳送訊息給所有人')
    await act(async () => useGameStore.getState().setRound({ ...r, song: r.song && { ...r.song, correctIds: ['p1'] } }, Date.now()))
    expect(hint()).toBe('聊天（不可說出歌名）')
  })
})

type Shown = Awaited<ReturnType<typeof show>>

/** 出題對話框的節點與操作（節點每次重查：切換來源時欄位與勾選會卸載、再掛上） */
function dialogHelpers(s: Shown) {
  const form = () => s.one((n) => n.tagName === 'FORM')
  const button = (type: string) => s.one((n) => n.tagName === 'BUTTON' && n.attrs.type === type && 'data-dialog-option' in n.attrs)
  const radio = (id: string) => s.one((n) => n.attrs['data-source-option'] === id)
  const key = (target: FakeNode, k: string) => act(async () => handlersOf(target).onKeyDown?.({ key: k, nativeEvent: { isComposing: false }, preventDefault: noop }))
  return {
    ...s,
    /** 目前的焦點（直接讀假 DOM，不是 show 當下的快照） */
    get active() {
      return (document as unknown as { activeElement: FakeNode | null }).activeElement
    },
    get form() {
      return form()
    },
    /** 歌手欄位（文字輸入框 data-dialog-input；勾選是 data-dialog-toggle） */
    get input() {
      return s.one((n) => n.tagName === 'INPUT' && 'data-dialog-input' in n.attrs)
    },
    maybeInput: () => s.maybe((n) => n.tagName === 'INPUT' && 'data-dialog-input' in n.attrs),
    checkbox: () => s.one((n) => n.tagName === 'INPUT' && 'data-dialog-toggle' in n.attrs),
    maybeCheckbox: () => s.maybe((n) => n.tagName === 'INPUT' && 'data-dialog-toggle' in n.attrs),
    group: () => s.one((n) => n.attrs.role === 'radiogroup'),
    radio,
    checkedSource: () => s.all().find((n) => n.attrs.role === 'radio' && n.attrs['aria-checked'] === 'true')?.attrs['data-source-option'] ?? null,
    primary: () => button('submit'),
    cancel: () => button('button'),
    type: (value: string) => act(async () => handlersOf(s.one((n) => n.tagName === 'INPUT' && 'data-dialog-input' in n.attrs)).onChange?.({ target: { value } })),
    /** 點三選一的某個選項 */
    pick: (id: string) => act(async () => handlersOf(radio(id)).onClick?.()),
    /** 在三選一上按鍵（方向鍵、Home／End、Enter） */
    groupKey: (k: string) => key(s.one((n) => n.attrs.role === 'radiogroup'), k),
    toggleHot: (checked: boolean) =>
      act(async () => handlersOf(s.one((n) => n.tagName === 'INPUT' && 'data-dialog-toggle' in n.attrs)).onChange?.({ target: { checked } })),
    /** 在輸入框按 Enter／點「分享」＝ form 的 submit */
    submit: () => act(async () => handlersOf(form()).onSubmit?.({ preventDefault: noop })),
    escape: () => key(form(), 'Escape'),
  }
}

describe('出題對話框的流程（歌手模式：搜尋中、失敗、取消）', () => {
  const NOT_FOUND: ActionOutcome = { ok: false, error: 'ARTIST_NOT_FOUND', message: '找不到這位歌手的歌（至少要 5 首有試聽的歌），換一位試試' }
  const FAILED: ActionOutcome = { ok: false, error: 'SEARCH_FAILED', message: '搜尋失敗，請再試一次' }

  async function openDialog() {
    const s = await show(round({ phase: 'choosing', setterId: 'p1', endsAt: T0 + 60_000 }))
    return dialogHelpers(s)
  }

  it('送出：payload 為 { source: artist, artist, hot }；「只抽熱門歌」預設勾、取消勾選就送 hot: false', async () => {
    vi.mocked(setSource).mockResolvedValue(NOT_FOUND)
    const d = await openDialog()
    expect(d.checkbox().checked).toBe(true)
    await d.type('孫燕姿')
    await d.submit()
    expect(setSource).toHaveBeenLastCalledWith({ source: 'artist', artist: '孫燕姿', hot: true })
    await d.toggleHot(false)
    expect(d.checkbox().checked).toBe(false)
    await d.submit()
    expect(setSource).toHaveBeenLastCalledWith({ source: 'artist', artist: '孫燕姿', hot: false })
  })
  it('開啟：欄位「歌手」有預設焦點、placeholder、字數與出題倒數；按鈕「取消」「分享」', async () => {
    const d = await openDialog()
    expect(d.active).toBe(d.input)
    expect(d.input.attrs.placeholder).toBe('輸入歌手名稱（例如：孫燕姿）')
    expect(textOf(d.one((n) => n.tagName === 'LABEL' && 'for' in n.attrs))).toBe('歌手')
    expect(textOf(d.primary())).toBe('分享')
    expect(textOf(d.cancel())).toBe('取消')
    expect(textOf(d.form)).toContain('0/30 · 01:00')
    await d.type('孫燕姿')
    expect(textOf(d.form)).toContain('3/30 · 01:00')
  })

  it('送出 → 搜尋中：欄位 readOnly＋aria-busy（不是 disabled）、按鈕文字「搜尋中…」、焦點留在欄位；搜尋中再按 Enter 不重複送', async () => {
    const pending = deferred()
    vi.mocked(setSource).mockReturnValue(pending.promise)
    const d = await openDialog()
    await d.type('孫燕姿')
    await d.submit()
    expect(setSource).toHaveBeenCalledTimes(1)
    expect(setSource).toHaveBeenLastCalledWith({ source: 'artist', artist: '孫燕姿', hot: true })
    expect(d.input.attrs).toMatchObject({ readonly: '', 'aria-busy': 'true' })
    expect(d.input.attrs).not.toHaveProperty('disabled')
    expect(textOf(d.primary())).toBe('搜尋中…')
    expect(d.primary().attrs).toMatchObject({ 'aria-disabled': 'true', 'aria-busy': 'true' })
    expect(d.all().filter((n) => 'disabled' in n.attrs)).toEqual([])
    expect(d.active).toBe(d.input)
    await d.submit()
    expect(setSource).toHaveBeenCalledTimes(1)
    // 送出中三選一與勾選不可切換（只設 aria-disabled）
    expect(d.radio('tw-hot').attrs['aria-disabled']).toBe('true')
    expect(d.checkbox().attrs['aria-disabled']).toBe('true')
    await d.pick('tw-hot')
    await d.toggleHot(false)
    expect(d.radio('artist').attrs['aria-checked']).toBe('true')
    expect(d.checkbox().checked).toBe(true)
    expect(d.active).toBe(d.input)
    await pending.settle(NOT_FOUND)
    // 失敗後恢復可切換，內容都還在
    expect(d.radio('tw-hot').attrs).not.toHaveProperty('aria-disabled')
    expect(d.input.attrs.value ?? d.input.value).toBe('孫燕姿')
  })

  it('預檢：空白或超過 30 字不送出，直接顯示與 server 相同的訊息；焦點留在欄位', async () => {
    const d = await openDialog()
    await d.submit()
    await d.type('   ')
    await d.submit()
    await d.type('歌'.repeat(31))
    await d.submit()
    expect(setSource).not.toHaveBeenCalled()
    expect(textOf(d.one((n) => n.attrs.role === 'alert'))).toBe('歌手名稱需為 1～30 個字，不可含控制字元，也不能只有空白')
    expect(Object.keys(d.input.attrs).filter((k) => /disabled|readonly|busy/.test(k))).toEqual([])
    expect(d.active).toBe(d.input)
  })

  it('找不到歌手：顯示 server 的訊息、欄位恢復可編輯且焦點還在；改名字再按 Enter 可重送', async () => {
    const first = deferred()
    vi.mocked(setSource).mockReturnValueOnce(first.promise)
    const d = await openDialog()
    await d.type('不存在的歌手')
    await d.submit()
    await first.settle(NOT_FOUND)
    expect(textOf(d.one((n) => n.attrs.role === 'alert'))).toBe(NOT_FOUND.message)
    expect(Object.keys(d.input.attrs).filter((k) => /disabled|readonly|busy/.test(k))).toEqual([])
    expect(d.input.attrs['aria-invalid']).toBe('true')
    expect(textOf(d.primary())).toBe('分享')
    expect(d.active).toBe(d.input)
    // 仍在 choosing：對話框還在
    expect(d.dialog()).not.toBeNull()

    const second = deferred()
    vi.mocked(setSource).mockReturnValueOnce(second.promise)
    await d.type('孫燕姿')
    // 開始輸入就清掉錯誤
    expect(d.maybe((n) => n.attrs.role === 'alert')).toBeNull()
    await d.submit()
    expect(setSource).toHaveBeenCalledTimes(2)
    expect(setSource).toHaveBeenLastCalledWith({ source: 'artist', artist: '孫燕姿', hot: true })
    await second.settle(FAILED)
    expect(textOf(d.one((n) => n.attrs.role === 'alert'))).toBe('搜尋失敗，請再試一次')
    expect(d.active).toBe(d.input)
  })

  it('搜尋成功：server 的 round:update 把階段帶進第 1 首，對話框關閉、舞台開始顯示播放畫面', async () => {
    const pending = deferred()
    vi.mocked(setSource).mockReturnValue(pending.promise)
    const d = await openDialog()
    await d.type('孫燕姿')
    await d.submit()
    await pending.settle({ ok: true }, () =>
      useGameStore.getState().setRound(playingRound({ serverNow: Date.now() }, { index: 1, startedAt: Date.now() + 1500 }), Date.now()),
    )
    expect(d.dialog()).toBeNull()
    expect(d.stage()).toBe('孫燕姿 · 第 1 / 5 首')
  })

  it('成功的 ack 先到、round:update 還沒到的那一瞬間：維持「搜尋中…」（不閃回「分享」、不能重複送）', async () => {
    const pending = deferred()
    vi.mocked(setSource).mockReturnValue(pending.promise)
    const d = await openDialog()
    await d.type('孫燕姿')
    await d.submit()
    await pending.settle({ ok: true })
    expect(d.dialog()).not.toBeNull()
    expect(textOf(d.primary())).toBe('搜尋中…')
    expect(d.input.attrs).toMatchObject({ readonly: '', 'aria-busy': 'true' })
    await d.submit()
    expect(setSource).toHaveBeenCalledTimes(1)
    await act(async () => useGameStore.getState().setRound(playingRound({ serverNow: Date.now() }, { index: 1, startedAt: Date.now() + 1500 }), Date.now()))
    expect(d.dialog()).toBeNull()
  })

  it('Esc 或「取消」：送 round:cancel；搜尋中也可以取消', async () => {
    vi.mocked(cancelRound).mockResolvedValue({ ok: true })
    const d = await openDialog()
    await d.escape()
    expect(cancelRound).toHaveBeenCalledTimes(1)
    await act(async () => handlersOf(d.cancel()).onClick?.())
    expect(cancelRound).toHaveBeenCalledTimes(2)

    const pending = deferred()
    vi.mocked(setSource).mockReturnValue(pending.promise)
    await d.type('孫燕姿')
    await d.submit()
    expect(textOf(d.primary())).toBe('搜尋中…')
    expect(d.cancel().attrs).not.toHaveProperty('aria-disabled')
    await d.escape()
    expect(cancelRound).toHaveBeenCalledTimes(3)
    await pending.settle({ ok: false, error: 'NOT_SETTER', message: '你不是出題者' })
  })

  it('輸入法組字中的 Esc 不取消', async () => {
    const d = await openDialog()
    await act(async () => handlersOf(d.form).onKeyDown?.({ key: 'Escape', nativeEvent: { isComposing: true }, preventDefault: noop }))
    expect(cancelRound).not.toHaveBeenCalled()
  })
})

describe('出題對話框的流程（來源三選一、榜單模式、本機偏好）', () => {
  const CHART_FAILED: ActionOutcome = { ok: false, error: 'CHART_FAILED', message: '取得排行榜失敗，請再試一次' }
  const SOURCE_INVALID: ActionOutcome = { ok: false, error: 'SOURCE_INVALID', message: '題庫來源不正確，請重新選擇' }
  const choosing = () => round({ phase: 'choosing', setterId: 'p1', endsAt: T0 + 52_000 })

  async function openDialog() {
    return dialogHelpers(await show(choosing()))
  }

  it('開啟：三選一「歌手／台灣熱門／西洋熱門」預設歌手；歌手模式有欄位與勾選（預設勾）、沒有榜單說明', async () => {
    const d = await openDialog()
    expect(d.group().attrs['aria-label']).toBe('題庫來源')
    expect(d.all().filter((n) => n.attrs.role === 'radio').map((n) => textOf(n))).toEqual(['歌手', '台灣熱門', '西洋熱門'])
    expect(d.checkedSource()).toBe('artist')
    expect(d.maybeInput()).not.toBeNull()
    expect(d.checkbox().checked).toBe(true)
    expect(textOf(d.form)).toContain('只抽熱門歌')
    expect(textOf(d.form)).not.toContain('Apple Music')
    expect(d.active).toBe(d.input)
  })

  it('切到台灣熱門：欄位與勾選消失、出現一行說明與倒數；焦點留在三選一；再切回歌手時欄位不搶焦點、原本打的字還在', async () => {
    const d = await openDialog()
    await d.type('孫燕姿')
    await d.pick('tw-hot')
    expect(d.checkedSource()).toBe('tw-hot')
    expect(d.maybeInput()).toBeNull()
    expect(d.maybeCheckbox()).toBeNull()
    expect(textOf(d.form)).toContain('從今天的 Apple Music 台灣熱門 100 首隨機抽 5 首')
    expect(textOf(d.form)).toContain('00:52')
    expect(d.active).toBe(d.radio('tw-hot'))
    // 只有選中的那顆在 Tab 順序裡
    expect(['artist', 'tw-hot', 'western-hot'].map((id) => d.radio(id).attrs.tabindex)).toEqual(['-1', '0', '-1'])
    await d.pick('western-hot')
    expect(textOf(d.form)).toContain('從今天的 Apple Music 美國熱門 100 首隨機抽 5 首')
    await d.pick('artist')
    expect(d.input.value).toBe('孫燕姿')
    expect(d.active).toBe(d.radio('artist'))
    expect(d.checkbox().checked).toBe(true)
  })

  it('三選一的鍵盤：→／← 循環切換、Home／End；Enter＝送出', async () => {
    vi.mocked(setSource).mockResolvedValue(CHART_FAILED)
    const d = await openDialog()
    await d.groupKey('ArrowRight')
    expect(d.checkedSource()).toBe('tw-hot')
    expect(d.active).toBe(d.radio('tw-hot'))
    await d.groupKey('ArrowRight')
    expect(d.checkedSource()).toBe('western-hot')
    await d.groupKey('ArrowRight')
    expect(d.checkedSource()).toBe('artist')
    // 切回歌手時欄位掛上但不搶焦點，方向鍵可以繼續切
    expect(d.active).toBe(d.radio('artist'))
    await d.groupKey('ArrowLeft')
    expect(d.checkedSource()).toBe('western-hot')
    await d.groupKey('Home')
    expect(d.checkedSource()).toBe('artist')
    await d.groupKey('End')
    expect(d.checkedSource()).toBe('western-hot')
    await d.groupKey('Enter')
    expect(setSource).toHaveBeenCalledTimes(1)
    expect(setSource).toHaveBeenLastCalledWith({ source: 'western-hot' })
  })

  it('榜單送出：payload 只有 source；送出中按鈕「取得排行榜…」、三選一鎖住；失敗顯示 CHART_FAILED 文案、焦點留在「分享」按鈕；可重試或換來源', async () => {
    const first = deferred()
    vi.mocked(setSource).mockReturnValueOnce(first.promise)
    const d = await openDialog()
    await d.pick('tw-hot')
    // 用滑鼠點「分享」：焦點在按鈕上
    d.primary().focus()
    await d.submit()
    expect(setSource).toHaveBeenLastCalledWith({ source: 'tw-hot' })
    expect(textOf(d.primary())).toBe('取得排行榜…')
    expect(d.primary().attrs).toMatchObject({ 'aria-disabled': 'true', 'aria-busy': 'true' })
    expect(d.group().attrs['aria-disabled']).toBe('true')
    expect(d.all().filter((n) => 'disabled' in n.attrs)).toEqual([])
    await d.pick('western-hot')
    await d.groupKey('ArrowRight')
    expect(d.checkedSource()).toBe('tw-hot')
    // 送出中再按 Enter 不重複送
    await d.submit()
    expect(setSource).toHaveBeenCalledTimes(1)
    expect(d.active).toBe(d.primary())
    await first.settle(CHART_FAILED)
    expect(textOf(d.one((n) => n.attrs.role === 'alert'))).toBe('取得排行榜失敗，請再試一次')
    expect(textOf(d.primary())).toBe('分享')
    expect(d.active).toBe(d.primary())
    expect(d.checkedSource()).toBe('tw-hot')
    expect(d.dialog()).not.toBeNull()
    // 換來源就清掉錯誤；再送一次
    await d.pick('western-hot')
    expect(d.maybe((n) => n.attrs.role === 'alert')).toBeNull()
    vi.mocked(setSource).mockResolvedValueOnce(SOURCE_INVALID)
    await d.submit()
    expect(setSource).toHaveBeenLastCalledWith({ source: 'western-hot' })
    expect(textOf(d.one((n) => n.attrs.role === 'alert'))).toBe('題庫來源不正確，請重新選擇')
  })

  it('榜單模式不做歌手名預檢（欄位是空的也直接送）', async () => {
    vi.mocked(setSource).mockResolvedValue(CHART_FAILED)
    const d = await openDialog()
    await d.pick('western-hot')
    await d.submit()
    expect(setSource).toHaveBeenLastCalledWith({ source: 'western-hot' })
  })

  it('榜單送出成功：round:update 帶進第 1 首，對話框關閉、舞台「台灣熱門 · 第 1 / 5 首」＋本首歌手', async () => {
    const pending = deferred()
    vi.mocked(setSource).mockReturnValue(pending.promise)
    const d = await openDialog()
    await d.pick('tw-hot')
    await d.submit()
    await pending.settle({ ok: true }, () =>
      useGameStore.getState().setRound(chartRound('tw-hot', '台灣熱門', { serverNow: Date.now() }, { index: 1, startedAt: Date.now() + 1500, artist: '告五人' }), Date.now()),
    )
    expect(d.dialog()).toBeNull()
    expect(d.stage()).toBe('台灣熱門 · 第 1 / 5 首歌手：告五人')
  })

  it('每次開對話框都回到「歌手」（不記住上次的來源）', async () => {
    vi.mocked(cancelRound).mockResolvedValue({ ok: true })
    const d = await openDialog()
    await d.pick('western-hot')
    await act(async () => useGameStore.getState().setRound(round({ phase: 'idle' }), Date.now()))
    expect(d.dialog()).toBeNull()
    await act(async () => useGameStore.getState().setRound(choosing(), Date.now()))
    expect(d.checkedSource()).toBe('artist')
    expect(d.maybeInput()).not.toBeNull()
  })

  it('「只抽熱門歌」記在 localStorage（fishing-work:song-guess:hot）：讀上次的值、勾選變更時寫回', async () => {
    const s = await show(round({ phase: 'idle' }))
    const stored = new Map<string, string>([[HOT_STORAGE_KEY, '0']])
    const setItem = vi.fn((k: string, v: string) => void stored.set(k, v))
    ;(window as unknown as { localStorage: Pick<Storage, 'getItem' | 'setItem'> }).localStorage = { getItem: (k) => stored.get(k) ?? null, setItem }
    await act(async () => useGameStore.getState().setRound(choosing(), Date.now()))
    const d = dialogHelpers(s)
    expect(d.checkbox().checked).toBe(false)
    await d.toggleHot(true)
    expect(setItem).toHaveBeenLastCalledWith(HOT_STORAGE_KEY, '1')
    expect(d.checkbox().checked).toBe(true)
    await d.toggleHot(false)
    expect(stored.get(HOT_STORAGE_KEY)).toBe('0')
  })

  it('localStorage 讀寫丟例外：預設勾、勾選照常可切換（只是記不住）', async () => {
    const s = await show(round({ phase: 'idle' }))
    const boom = () => {
      throw new Error('blocked')
    }
    ;(window as unknown as { localStorage: Pick<Storage, 'getItem' | 'setItem'> }).localStorage = { getItem: boom, setItem: boom }
    await act(async () => useGameStore.getState().setRound(choosing(), Date.now()))
    const d = dialogHelpers(s)
    expect(d.checkbox().checked).toBe(true)
    await d.toggleHot(false)
    expect(d.checkbox().checked).toBe(false)
  })
})
