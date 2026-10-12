// 試聽播放器的行為流程（features/player/AudioPlayer；spec/song-guess/design.md §3 逐條）：
// 元件掛在假 DOM 上（test/fakeDom.tsx），<audio> 以假節點代替（記錄 src、currentTime、play／pause／load 的呼叫，事件由測試觸發），
// 時間用假時鐘。驗的是「元件什麼時候對 <audio> 做什麼」；真正的解碼、緩衝與瀏覽器的自動播放政策以瀏覽器實測為準。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { START_DELAY_MS, type RoundPublic } from '@fishing-work/shared/song-guess'
import { AudioPlayer } from '../src/features/player/AudioPlayer'
import { startPlayback, useAudioStore } from '../src/features/player/audioState'
import { useVolumeStore } from '../src/features/player/volume'
import { initialGameState, useGameStore } from '../src/store/game'
import { mount, unmountAll, type FakeNode } from './fakeDom'
import { player, playingRound, reveal, round, song } from './fixtures'

/** 假時鐘的起點（本機時間） */
const T0 = 1_700_000_000_000

interface FakeAudio extends FakeNode {
  src: string
  currentTime: number
  duration: number
  readyState: number
  volume: number
  error: { code: number } | null
  play: ReturnType<typeof vi.fn<() => Promise<void>>>
  pause: ReturnType<typeof vi.fn<() => void>>
  load: ReturnType<typeof vi.fn<() => void>>
  /** 觸發事件（loadedmetadata、playing、ended、error） */
  fire(event: string): void
  listenerCount(event: string): number
}

/** 讓假節點的 <audio> 具備元件會用到的屬性與方法 */
function asAudio(node: FakeNode): void {
  if (node.tagName !== 'AUDIO') return
  const audio = node as FakeAudio
  const listeners = new Map<string, Set<() => void>>()
  audio.src = ''
  audio.currentTime = 0
  audio.duration = Number.NaN
  audio.readyState = 0
  audio.volume = 1
  audio.error = null
  audio.play = vi.fn(() => Promise.resolve())
  audio.pause = vi.fn()
  // 重新載入：回到還沒有 metadata 的狀態
  audio.load = vi.fn(() => {
    audio.readyState = 0
    audio.currentTime = 0
    audio.error = null
  })
  // React 自己也會在媒體元素上掛事件（非委派的 loadedmetadata、playing、ended、error…，都是 bind 過的 dispatchEvent）；
  // 這裡只記錄元件用 addEventListener 掛的那些（一般函式），測試觸發事件時才不會打到 React 的事件系統
  audio.addEventListener = (event: string, fn: () => void) => {
    if (fn.name.startsWith('bound ')) return
    ;(listeners.get(event) ?? listeners.set(event, new Set()).get(event))?.add(fn)
  }
  audio.removeEventListener = (event: string, fn: () => void) => void listeners.get(event)?.delete(fn)
  const removeAttribute = audio.removeAttribute as (name: string) => void
  audio.removeAttribute = (name: string) => {
    if (name === 'src') audio.src = ''
    removeAttribute(name)
  }
  audio.fire = (event) => {
    for (const fn of [...(listeners.get(event) ?? [])]) fn()
  }
  audio.listenerCount = (event) => listeners.get(event)?.size ?? 0
}

/** 掛上播放器；store 先放好初始狀態 */
async function mountPlayer(initial: RoundPublic = round()) {
  useGameStore.setState({ me: 'p1', players: [player('p1'), player('p2')], round: initial, clockOffset: 0 })
  const view = await mount(<AudioPlayer />, asAudio)
  const audio = view.one((n) => n.tagName === 'AUDIO') as FakeAudio
  return {
    audio,
    /** 收到 round:update（serverNow 預設＝現在的本機時間，偏移 0） */
    update: (next: RoundPublic, serverNow: number = Date.now()) =>
      act(async () => useGameStore.getState().setRound({ ...next, serverNow }, Date.now())),
    /** metadata 載好（可以定位了） */
    metadata: (duration = 30) =>
      act(async () => {
        audio.readyState = 1
        audio.duration = duration
        audio.fire('loadedmetadata')
      }),
    advance: (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms))),
    state: () => useAudioStore.getState().state,
  }
}

/** 從現在起 delayMs 後起播的第 index 首 */
const startingIn = (delayMs: number, index = 1, over: Partial<RoundPublic> = {}) =>
  playingRound(over, { index, startedAt: Date.now() + delayMs, durationMs: 30_000, previewUrl: `https://audio.example/preview-${index}.m4a` })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
})

afterEach(async () => {
  await unmountAll()
  vi.useRealTimers()
  useGameStore.setState({ ...initialGameState })
  useAudioStore.setState({ state: 'idle' })
  useVolumeStore.setState({ volume: 15 })
})

describe('沒有歌的階段', () => {
  it('idle：沒有 src、不播放、狀態 idle；音量套用預設 15 → 0.15', async () => {
    const p = await mountPlayer()
    expect(p.audio.src).toBe('')
    expect(p.audio.play).not.toHaveBeenCalled()
    expect(p.state()).toBe('idle')
    expect(p.audio.volume).toBe(0.15)
    expect(p.audio.attrs).toMatchObject({ hidden: '', 'aria-hidden': 'true', preload: 'auto', 'data-audio-state': 'idle' })
  })

  it('choosing：也不播放', async () => {
    const p = await mountPlayer()
    await p.update(round({ phase: 'choosing', setterId: 'p1', endsAt: Date.now() + 60_000 }))
    expect(p.audio.src).toBe('')
    expect(p.audio.play).not.toHaveBeenCalled()
  })
})

describe('playing：收到就預載，到 startedAt 才起播', () => {
  it('收到 round:update 立刻設 src 並載入，但還不 play()（起播緩衝 START_DELAY_MS）', async () => {
    const p = await mountPlayer()
    await p.update(startingIn(START_DELAY_MS))
    expect(p.audio.src).toBe('https://audio.example/preview-1.m4a')
    expect(p.audio.load).toHaveBeenCalled()
    expect(p.audio.play).not.toHaveBeenCalled()
    expect(p.state()).toBe('waiting')
    expect(p.audio.attrs['data-audio-state']).toBe('waiting')
    expect(p.audio.attrs['data-song-index']).toBe('1')
  })

  it('metadata 先載好：仍等到 startedAt；時間到才 play()，從頭播（不定位）', async () => {
    const p = await mountPlayer()
    await p.update(startingIn(START_DELAY_MS))
    await p.metadata()
    expect(p.audio.play).not.toHaveBeenCalled()
    await p.advance(START_DELAY_MS - 1)
    expect(p.audio.play).not.toHaveBeenCalled()
    await p.advance(1)
    expect(p.audio.play).toHaveBeenCalledTimes(1)
    expect(p.audio.currentTime).toBe(0)
    expect(p.state()).toBe('playing')
  })

  it('startedAt 到了但 metadata 還沒好：先不播，載好馬上定位到已過的時間再播', async () => {
    const p = await mountPlayer()
    await p.update(startingIn(START_DELAY_MS))
    await p.advance(START_DELAY_MS + 800)
    expect(p.audio.play).not.toHaveBeenCalled()
    expect(p.state()).toBe('waiting')
    await p.metadata()
    expect(p.audio.play).toHaveBeenCalledTimes(1)
    expect(p.audio.currentTime).toBeCloseTo(0.8, 3)
  })
})

describe('中途加入／重連：從正確的位置接著播', () => {
  it('歌已播 12.5 秒：metadata 載好後 currentTime＝12.5 再 play()', async () => {
    const p = await mountPlayer()
    await p.update(startingIn(-12_500))
    expect(p.audio.play).not.toHaveBeenCalled()
    await p.metadata()
    expect(p.audio.currentTime).toBe(12.5)
    expect(p.audio.play).toHaveBeenCalledTimes(1)
    expect(p.state()).toBe('playing')
  })

  it('一開始就在播放中的局（加入時的快照）：掛載後直接載入', async () => {
    const p = await mountPlayer(startingIn(-5000, 3))
    expect(p.audio.src).toBe('https://audio.example/preview-3.m4a')
    await p.metadata()
    expect(p.audio.currentTime).toBe(5)
    expect(p.audio.attrs['data-song-index']).toBe('3')
  })

  it('時鐘偏移：本機時鐘比 server 快 1 小時，位置仍以 server 時間計算', async () => {
    const p = await mountPlayer()
    const serverNow = Date.now() - 3_600_000
    const r = playingRound({}, { startedAt: serverNow - 7000, durationMs: 30_000 })
    await p.update(r, serverNow)
    expect(useGameStore.getState().clockOffset).toBe(-3_600_000)
    await p.metadata()
    expect(p.audio.currentTime).toBe(7)
    expect(p.audio.play).toHaveBeenCalledTimes(1)
  })

  it('已超過 durationMs（快照來得太晚）：不播，等揭曉', async () => {
    const p = await mountPlayer()
    await p.update(startingIn(-31_000))
    await p.metadata()
    expect(p.audio.play).not.toHaveBeenCalled()
    expect(p.state()).toBe('over')
  })
})

describe('同一首歌的後續更新不打斷播放', () => {
  it('有人猜對（round:update 的 correctIds 變了）：不重新載入、不重新定位、不再 play()', async () => {
    const p = await mountPlayer()
    const r = startingIn(-2000)
    await p.update(r)
    await p.metadata()
    const loads = p.audio.load.mock.calls.length
    p.audio.currentTime = 6.2
    await p.advance(4000)
    await p.update({ ...r, song: r.song && { ...r.song, correctIds: ['p2'] } })
    expect(p.audio.load).toHaveBeenCalledTimes(loads)
    expect(p.audio.play).toHaveBeenCalledTimes(1)
    expect(p.audio.currentTime).toBe(6.2)
    expect(p.audio.src).toBe('https://audio.example/preview-1.m4a')
  })

  it('緩衝後才出聲（playing 事件）且位置落後太多：校正一次；落後在容許範圍內不動', async () => {
    const p = await mountPlayer()
    await p.update(startingIn(-2000))
    await p.metadata()
    expect(p.audio.currentTime).toBe(2)
    // 緩衝了 3 秒才真的出聲：位置還在 2 秒，應該是 5 秒
    await p.advance(3000)
    await act(async () => p.audio.fire('playing'))
    expect(p.audio.currentTime).toBe(5)
    // 之後正常播放：位置跟得上，不再定位
    p.audio.currentTime = 5.1
    await act(async () => p.audio.fire('playing'))
    expect(p.audio.currentTime).toBe(5.1)
  })
})

describe('自動播放被擋（NotAllowedError）', () => {
  it('狀態轉 blocked；使用者點「開始播放」→ 在同一次呼叫裡 play()，定位到目前進度', async () => {
    const p = await mountPlayer()
    p.audio.play.mockRejectedValueOnce(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }))
    await p.update(startingIn(-1000))
    await p.metadata()
    expect(p.audio.play).toHaveBeenCalledTimes(1)
    expect(p.state()).toBe('blocked')
    expect(p.audio.attrs['data-audio-state']).toBe('blocked')
    // 使用者 4 秒後才點
    await p.advance(4000)
    await act(async () => startPlayback())
    expect(p.audio.play).toHaveBeenCalledTimes(2)
    expect(p.audio.currentTime).toBe(5)
    expect(p.state()).toBe('playing')
  })

  it('被 pause 中斷之類的其他錯誤不算被擋（不顯示按鈕）', async () => {
    const p = await mountPlayer()
    p.audio.play.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    await p.update(startingIn(-1000))
    await p.metadata()
    expect(p.state()).not.toBe('blocked')
  })

  it('試聽載入失敗（error 事件）：也顯示按鈕；點了重新載入並播放', async () => {
    const p = await mountPlayer()
    await p.update(startingIn(-1000))
    await act(async () => {
      p.audio.error = { code: 2 }
      p.audio.fire('error')
    })
    expect(p.state()).toBe('blocked')
    const loads = p.audio.load.mock.calls.length
    await act(async () => startPlayback())
    expect(p.audio.load).toHaveBeenCalledTimes(loads + 1)
    expect(p.audio.play).toHaveBeenCalledTimes(1)
  })

  it('沒有歌時點了也不動作', async () => {
    const p = await mountPlayer()
    await act(async () => startPlayback())
    expect(p.audio.play).not.toHaveBeenCalled()
  })
})

describe('停播', () => {
  it('reveal：pause() 並清掉 src；狀態回 idle', async () => {
    const p = await mountPlayer()
    const r = startingIn(-2000)
    await p.update(r)
    await p.metadata()
    p.audio.pause.mockClear()
    await p.update(round({ phase: 'reveal', setterId: 'p1', song: r.song, reveal: reveal(), endsAt: Date.now() + 5000 }))
    expect(p.audio.pause).toHaveBeenCalled()
    expect(p.audio.src).toBe('')
    expect(p.state()).toBe('idle')
    // 事件監聽也拿掉了
    for (const event of ['loadedmetadata', 'playing', 'ended', 'error']) expect(p.audio.listenerCount(event), event).toBe(0)
  })

  it('ended（本局結束）、idle（出題者取消）：同樣停播並清 src', async () => {
    for (const next of [round({ phase: 'ended', reveal: reveal({ index: 5 }), results: [] }), round({ phase: 'idle' })]) {
      const p = await mountPlayer(startingIn(-2000))
      await p.metadata()
      await p.update(next)
      expect(p.audio.src, next.phase).toBe('')
      expect(p.state(), next.phase).toBe('idle')
      await unmountAll()
      vi.useFakeTimers()
      vi.setSystemTime(T0)
    }
  })

  it('<audio> 的 ended 事件（檔案比 durationMs 短）：只把播放器狀態改成 over，遊戲狀態不變、仍等 server 的揭曉', async () => {
    const p = await mountPlayer()
    const r = startingIn(-2000)
    await p.update(r)
    await p.metadata()
    const before = useGameStore.getState().round
    await act(async () => p.audio.fire('ended'))
    expect(p.state()).toBe('over')
    expect(useGameStore.getState().round).toBe(before)
    expect(useGameStore.getState().round.phase).toBe('playing')
    expect(p.audio.src).toBe('https://audio.example/preview-1.m4a')
  })

  it('播放時間到了但 server 的揭曉還沒來：到 endsAt 不會自己切階段（等 round:update）', async () => {
    const p = await mountPlayer()
    await p.update(startingIn(0))
    await p.metadata()
    await p.advance(31_000)
    expect(useGameStore.getState().round.phase).toBe('playing')
  })
})

describe('下一首', () => {
  it('reveal 之後的下一首：換成新的 src、重新載入、到新的 startedAt 才播', async () => {
    const p = await mountPlayer()
    const first = startingIn(-28_000, 1)
    await p.update(first)
    await p.metadata()
    await p.update(round({ phase: 'reveal', song: first.song, reveal: reveal() }))
    p.audio.play.mockClear()
    await p.update(startingIn(START_DELAY_MS, 2))
    expect(p.audio.src).toBe('https://audio.example/preview-2.m4a')
    expect(p.audio.readyState).toBe(0)
    await p.metadata()
    expect(p.audio.play).not.toHaveBeenCalled()
    await p.advance(START_DELAY_MS)
    expect(p.audio.play).toHaveBeenCalledTimes(1)
    expect(p.audio.currentTime).toBe(0)
    expect(p.audio.attrs['data-song-index']).toBe('2')
  })
})

describe('音量', () => {
  it('滑桿的值即時套到 <audio>.volume（0～100 → 0～1）；換歌不重設', async () => {
    const p = await mountPlayer()
    await act(async () => useVolumeStore.getState().setVolume(30))
    expect(p.audio.volume).toBe(0.3)
    await p.update(startingIn(-1000))
    await p.metadata()
    expect(p.audio.volume).toBe(0.3)
    await act(async () => useVolumeStore.getState().setVolume(0))
    expect(p.audio.volume).toBe(0)
  })
})

describe('卸載（離開遊戲畫面）', () => {
  it('清掉計時器與事件監聽；之後時間到也不會 play()', async () => {
    const p = await mountPlayer()
    await p.update(startingIn(START_DELAY_MS))
    await p.metadata()
    await unmountAll()
    vi.useFakeTimers()
    await vi.advanceTimersByTimeAsync(START_DELAY_MS + 1000)
    expect(p.audio.play).not.toHaveBeenCalled()
    expect(p.audio.listenerCount('loadedmetadata')).toBe(0)
    // song 用不到的 import 保持型別檢查：song() 可產生合法的 SongPublic
    expect(song().index).toBe(1)
  })
})
