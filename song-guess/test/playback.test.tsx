// 播放邏輯（spec/song-guess/design.md §3、architecture §5「playing」「時鐘」；plan 決策 6、7、13）：
// 時鐘偏移、何時該播與定位到哪、定位容許值、音量的範圍與存檔、<audio> 元素本身的屬性。純函式為主，不需要 DOM。
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PREVIEW_CAP_MS, START_DELAY_MS } from '@fishing-work/shared/song-guess'
import { AudioPlayer } from '../src/features/player/AudioPlayer'
import { estimateClockOffset, toServerTime } from '../src/features/player/clock'
import {
  MAX_RESYNC_PER_SONG,
  SEEK_TOLERANCE_SEC,
  START_PLAYBACK_LABEL,
  activeSong,
  isAutoplayBlocked,
  playbackPlan,
  seekTarget,
  songKey,
} from '../src/features/player/playback'
import {
  VOLUME_DEFAULT,
  VOLUME_MAX,
  VOLUME_MIN,
  VOLUME_STORAGE_KEY,
  clampVolume,
  loadVolume,
  saveVolume,
  toAudioVolume,
  useVolumeStore,
  type VolumeStorage,
} from '../src/features/player/volume'
import { playingRound, reveal, round, song } from './fixtures'

const fs = (await import('node:fs' as string)) as { readFileSync(path: URL, encoding: 'utf8'): string }
const read = (f: string) => fs.readFileSync(new URL(f, import.meta.url), 'utf8')

describe('時鐘偏移（clock）：serverNow − 本機時間；倒數與定位用校正後的時間', () => {
  it('本機慢 3 秒 → 偏移 +3000；本機快 2 秒 → −2000；相同 → 0', () => {
    expect(estimateClockOffset(1_003_000, 1_000_000)).toBe(3000)
    expect(estimateClockOffset(998_000, 1_000_000)).toBe(-2000)
    expect(estimateClockOffset(5, 5)).toBe(0)
  })

  it('不是有限數字 → 0（不校正）', () => {
    expect(estimateClockOffset(Number.NaN, 1)).toBe(0)
    expect(estimateClockOffset(1, Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('toServerTime：本機時間 + 偏移；偏移不是有限數字時原樣', () => {
    expect(toServerTime(1_000_000, 3000)).toBe(1_003_000)
    expect(toServerTime(1_000_000, -2000)).toBe(998_000)
    expect(toServerTime(1_000_000, Number.NaN)).toBe(1_000_000)
  })

  it('本機時鐘差很多也算得出正確的播放位置：server 已播 10 秒 → 定位 10 秒', () => {
    const r = playingRound({ serverNow: 110_000 }, { startedAt: 100_000 })
    // 本機時鐘比 server 快 1 小時
    const localNow = 110_000 + 3_600_000
    const offset = estimateClockOffset(r.serverNow, localNow)
    expect(playbackPlan(r, toServerTime(localNow, offset))).toEqual({ kind: 'play', src: r.song?.previewUrl, positionSec: 10 })
  })
})

describe('playbackPlan：何時該播、定位到哪', () => {
  const src = 'https://audio.example/preview-1.m4a'
  const r = playingRound({}, { startedAt: 100_000, durationMs: 30_000 })

  it('不是 playing（idle／choosing／reveal／ended）→ stop（停播並清 src）；reveal 雖然還帶著 song 也不播', () => {
    expect(playbackPlan(round({ phase: 'idle' }), 0)).toEqual({ kind: 'stop' })
    expect(playbackPlan(round({ phase: 'choosing' }), 0)).toEqual({ kind: 'stop' })
    expect(playbackPlan(round({ phase: 'reveal', song: song(), reveal: reveal() }), 110_000)).toEqual({ kind: 'stop' })
    expect(playbackPlan(round({ phase: 'ended', reveal: reveal() }), 110_000)).toEqual({ kind: 'stop' })
  })

  it('playing 但沒有 song、或網址空白 → stop', () => {
    expect(playbackPlan(round({ phase: 'playing', song: null }), 0)).toEqual({ kind: 'stop' })
    expect(playbackPlan(playingRound({}, { previewUrl: '' }), 110_000)).toEqual({ kind: 'stop' })
  })

  it('起播緩衝（START_DELAY_MS）：startedAt 還沒到 → wait，delayMs＝還差多久（這段時間先載入試聽）', () => {
    expect(START_DELAY_MS).toBeGreaterThan(0)
    const enteredAt = 100_000 - START_DELAY_MS
    expect(playbackPlan(r, enteredAt)).toEqual({ kind: 'wait', src, delayMs: START_DELAY_MS })
    expect(playbackPlan(r, 99_999)).toEqual({ kind: 'wait', src, delayMs: 1 })
  })

  it('到 startedAt → 從 0 秒播', () => {
    expect(playbackPlan(r, 100_000)).toEqual({ kind: 'play', src, positionSec: 0 })
  })

  it('中途加入／重連：定位到（校正後現在 − startedAt）÷ 1000 秒', () => {
    expect(playbackPlan(r, 112_500)).toEqual({ kind: 'play', src, positionSec: 12.5 })
    expect(playbackPlan(r, 129_999)).toEqual({ kind: 'play', src, positionSec: 29.999 })
  })

  it('超過 durationMs → over（不播，等 server 的揭曉）', () => {
    expect(playbackPlan(r, 130_000)).toEqual({ kind: 'over', src })
    expect(playbackPlan(r, 999_999)).toEqual({ kind: 'over', src })
  })

  it('短曲（durationMs 2 秒）以 durationMs 為準，不是固定 30 秒', () => {
    const short = playingRound({}, { startedAt: 100_000, durationMs: 2000 })
    expect(playbackPlan(short, 101_000)).toEqual({ kind: 'play', src, positionSec: 1 })
    expect(playbackPlan(short, 102_000)).toEqual({ kind: 'over', src })
    expect(PREVIEW_CAP_MS).toBe(30_000)
  })

  it('song 的時間欄位不合理（NaN、長度 ≤ 0）→ stop', () => {
    expect(playbackPlan(playingRound({}, { startedAt: Number.NaN }), 1)).toEqual({ kind: 'stop' })
    expect(playbackPlan(playingRound({}, { durationMs: 0 }), 100_000)).toEqual({ kind: 'stop' })
    expect(playbackPlan(r, Number.NaN)).toEqual({ kind: 'stop' })
  })

  it('activeSong：只有 playing 才有', () => {
    expect(activeSong(r)).toBe(r.song)
    expect(activeSong({ phase: 'reveal', song: r.song })).toBeNull()
    expect(activeSong({ phase: 'playing', song: null })).toBeNull()
  })
})

describe('songKey：同一首歌的識別（變了才重新載入與定位）', () => {
  it('猜對造成的 round:update（correctIds、serverNow 變）不改 key', () => {
    const a = playingRound({ serverNow: 1 })
    const b = playingRound({ serverNow: 2 }, { correctIds: ['p2'] })
    expect(songKey(a)).toBe(songKey(b))
    expect(songKey(a)).not.toBeNull()
  })

  it('換一首、換一局、開始時間不同 → key 不同', () => {
    const a = songKey(playingRound())
    expect(songKey(playingRound({}, { index: 2, previewUrl: 'https://audio.example/preview-2.m4a' }))).not.toBe(a)
    expect(songKey(playingRound({ gameNo: 2 }))).not.toBe(a)
    expect(songKey(playingRound({}, { startedAt: 200_000 }))).not.toBe(a)
  })

  it('不是 playing → null（reveal／ended／idle 停播並清 src）', () => {
    expect(songKey(round({ phase: 'reveal', song: song(), reveal: reveal() }))).toBeNull()
    expect(songKey(round({ phase: 'idle' }))).toBeNull()
  })
})

describe('seekTarget：差距超過容許值才定位（seek 會讓聲音斷一下）', () => {
  it('從頭起播（位置 0、目標 0）不定位', () => {
    expect(seekTarget(0, 0)).toBeNull()
  })

  it('差距在容許值內不定位；超過才定位到目標', () => {
    expect(seekTarget(10, 10 + SEEK_TOLERANCE_SEC)).toBeNull()
    expect(seekTarget(10, 10.2)).toBeNull()
    expect(seekTarget(0, 12.5)).toBe(12.5)
    expect(seekTarget(15, 12.5)).toBe(12.5)
  })

  it('目標為負（還沒到 startedAt）當 0', () => {
    expect(seekTarget(3, -1)).toBe(0)
    expect(seekTarget(0, -1)).toBeNull()
  })

  it('目標超過檔案長度時夾在結尾前一點（不直接觸發 ended）；長度未知（NaN）不夾', () => {
    expect(seekTarget(0, 29.99, 29.5)).toBeCloseTo(29.45, 5)
    expect(seekTarget(0, 29.99, Number.NaN)).toBe(29.99)
  })

  it('目前位置不是數字 → 直接定位', () => {
    expect(seekTarget(Number.NaN, 5)).toBe(5)
  })

  it('每首自動校正有次數上限', () => {
    expect(MAX_RESYNC_PER_SONG).toBeGreaterThanOrEqual(1)
    expect(MAX_RESYNC_PER_SONG).toBeLessThanOrEqual(5)
  })
})

describe('自動播放被擋', () => {
  it('play() 以 NotAllowedError 拒絕才算被擋；被 pause 中斷（AbortError）或其他錯誤不算', () => {
    expect(isAutoplayBlocked({ name: 'NotAllowedError' })).toBe(true)
    expect(isAutoplayBlocked(Object.assign(new Error('x'), { name: 'NotAllowedError' }))).toBe(true)
    expect(isAutoplayBlocked({ name: 'AbortError' })).toBe(false)
    expect(isAutoplayBlocked(new Error('x'))).toBe(false)
    expect(isAutoplayBlocked(null)).toBe(false)
    expect(isAutoplayBlocked('NotAllowedError')).toBe(false)
  })

  it('按鈕文字「點一下開始播放」（design §3）', () => {
    expect(START_PLAYBACK_LABEL).toBe('點一下開始播放')
  })
})

describe('音量（design §3）：0～100、預設 15、存 localStorage', () => {
  function memory(init: Record<string, string> = {}) {
    const data = new Map(Object.entries(init))
    const storage: VolumeStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
    return { storage, data }
  }
  const throwing: VolumeStorage = {
    getItem: () => {
      throw new Error('SecurityError')
    },
    setItem: () => {
      throw new Error('QuotaExceededError')
    },
  }

  it('鍵名 fishing-work:song-guess:volume；範圍 0..100、預設 15', () => {
    expect(VOLUME_STORAGE_KEY).toBe('fishing-work:song-guess:volume')
    expect([VOLUME_MIN, VOLUME_MAX, VOLUME_DEFAULT]).toEqual([0, 100, 15])
  })

  it('clampVolume：夾到 0..100 的整數；不是數字回預設', () => {
    expect(clampVolume(-5)).toBe(0)
    expect(clampVolume(150)).toBe(100)
    expect(clampVolume(42.6)).toBe(43)
    expect(clampVolume('30')).toBe(30)
    for (const bad of [Number.NaN, 'abc', '', '  ', null, undefined, {}]) expect(clampVolume(bad)).toBe(15)
  })

  it('toAudioVolume：0..100 → <audio>.volume 的 0..1', () => {
    expect(toAudioVolume(0)).toBe(0)
    expect(toAudioVolume(60)).toBe(0.6)
    expect(toAudioVolume(100)).toBe(1)
    expect(toAudioVolume(250)).toBe(1)
  })

  it('loadVolume：沒存過、壞值、讀取失敗、沒有 storage → 15；存過 → 原值（含 0）', () => {
    expect(loadVolume(memory().storage)).toBe(15)
    expect(loadVolume(memory({ [VOLUME_STORAGE_KEY]: 'loud' }).storage)).toBe(15)
    expect(loadVolume(throwing)).toBe(15)
    expect(loadVolume(null)).toBe(15)
    expect(loadVolume(memory({ [VOLUME_STORAGE_KEY]: '25' }).storage)).toBe(25)
    expect(loadVolume(memory({ [VOLUME_STORAGE_KEY]: '0' }).storage)).toBe(0)
  })

  it('saveVolume：寫入夾過的整數字串；寫入失敗不影響呼叫端', () => {
    const { storage, data } = memory()
    saveVolume(72.4, storage)
    expect(data.get(VOLUME_STORAGE_KEY)).toBe('72')
    expect(() => saveVolume(10, throwing)).not.toThrow()
    expect(() => saveVolume(10, null)).not.toThrow()
  })

  it('store：非瀏覽器環境初始 15；setVolume 夾值', () => {
    expect(useVolumeStore.getState().volume).toBe(15)
    useVolumeStore.getState().setVolume(130)
    expect(useVolumeStore.getState().volume).toBe(100)
    useVolumeStore.getState().setVolume(60)
    expect(useVolumeStore.getState().volume).toBe(60)
  })
})

describe('<audio> 元素（design §3：隱藏、aria-hidden、preload="auto"）', () => {
  const html = renderToStaticMarkup(<AudioPlayer />)

  it('隱藏、不給輔助技術、預載；沒有原生控制列；一開始沒有 src', () => {
    expect(html).toMatch(/^<audio\b/)
    expect(html).toContain('hidden=""')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('preload="auto"')
    expect(html).not.toMatch(/\scontrols\b|\sautoplay\b|\sloop\b|\ssrc=/i)
  })

  it('觀察點：data-song-player、data-audio-state（初始 idle）', () => {
    expect(html).toContain('data-song-player=""')
    expect(html).toContain('data-audio-state="idle"')
  })

  it('原始碼：ended 事件只改播放器狀態（over），不碰遊戲 store 的動作；來源只用 song.previewUrl', () => {
    const src = read('../src/features/player/AudioPlayer.tsx')
    expect(src).toContain("audio.addEventListener('ended', onEnded)")
    expect(src).toMatch(/const onEnded = \(\) => \{\s*if \(!disposed\) setState\('over'\)\s*\}/)
    expect(src).not.toMatch(/setRound|setPlayers|applySnapshot|socket/)
    expect(src).toContain('audio.src = song.previewUrl')
    // 停播並清 src
    expect(src).toMatch(/audio\.pause\(\)\s*audio\.removeAttribute\('src'\)\s*audio\.load\(\)\s*setState\('idle'\)/)
  })

  it('客戶端不直接呼叫題庫 API：src 底下沒有 itunes.apple.com 的搜尋網址、沒有 fetch', async () => {
    const sources = import.meta.glob<string>('../src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
    expect(Object.keys(sources).length).toBeGreaterThan(40)
    for (const [file, text] of Object.entries(sources)) {
      expect(text, file).not.toMatch(/itunes\.apple\.com|\/search\?|\bfetch\(|XMLHttpRequest/)
    }
  })
})
