// 試聽播放器（spec/song-guess/design.md §3；architecture §7 features/player）：一個隱藏的 <audio>，沒有畫面控制，由 round.song 驅動。
//   playing：收到就設 src 預載（preload="auto"）；到 startedAt（進入 playing 的 now + START_DELAY_MS）才 play()，所有人同時起播；
//     中途加入／重連：currentTime＝（校正後現在 − startedAt）÷ 1000 再 play()；
//     play() 被瀏覽器擋下（NotAllowedError）或試聽載入失敗 → 狀態 'blocked'，舞台顯示按鈕讓使用者點一下（audioState.startPlayback）；
//     點了就在同一次點擊裡 play()（載入失敗時先重新載入），位置等真的出聲時再校正；
//   reveal／ended／idle／choosing：pause() 並清掉 src；
//   <audio> 的 ended 事件（檔案比 durationMs 短）只停播，畫面仍等 server 的揭曉，不改任何遊戲狀態。
// 何時該播、定位到哪由純函式 playback.playbackPlan 決定；時間一律用校正後的 server 時鐘（clock.toServerTime）。
// 只把 server 給的 previewUrl 交給 <audio>：客戶端不呼叫題庫 API。
// 觀察點（實測用）：audio[data-song-player]，data-audio-state＝idle｜waiting｜playing｜blocked｜over，data-song-index＝第幾首。
import { useEffect, useRef } from 'react'
import { useGameStore } from '../../store/game'
import { registerStarter, useAudioStore } from './audioState'
import { toServerTime } from './clock'
import { MAX_RESYNC_PER_SONG, activeSong, isAutoplayBlocked, playbackPlan, seekTarget, songKey } from './playback'
import { toAudioVolume, useVolumeStore } from './volume'

/** HTMLMediaElement.HAVE_METADATA：知道長度、可以定位 */
const HAVE_METADATA = 1

export function AudioPlayer() {
  const ref = useRef<HTMLAudioElement>(null)
  const volume = useVolumeStore((s) => s.volume)
  // 同一首歌的識別：猜對造成的 round:update 不會變，不重新載入也不重新定位
  const key = useGameStore((s) => songKey(s.round))
  const index = useGameStore((s) => activeSong(s.round)?.index ?? null)
  const state = useAudioStore((s) => s.state)

  useEffect(() => {
    if (ref.current !== null) ref.current.volume = toAudioVolume(volume)
  }, [volume])

  useEffect(() => {
    const audio = ref.current
    if (audio === null) return
    const setState = useAudioStore.getState().setState
    const song = activeSong(useGameStore.getState().round)

    if (key === null || song === null) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      setState('idle')
      return
    }

    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let resyncs = 0
    const round = { phase: 'playing' as const, song }
    const plan = () => playbackPlan(round, toServerTime(Date.now(), useGameStore.getState().clockOffset))

    const play = () => {
      audio.play().then(
        () => {
          if (!disposed) setState('playing')
        },
        (error: unknown) => {
          // 其他錯誤（換歌時被 pause 中斷的 AbortError 等）不處理：下一次 attempt 會再試
          if (!disposed && isAutoplayBlocked(error)) setState('blocked')
        },
      )
    }

    /**
     * 依現在的時間決定等、播或不播；可重複呼叫（計時器到、metadata 載好、使用者點按鈕）。
     * fromGesture：使用者點了「開始播放」。play() 必須在這次點擊的同步呼叫裡執行瀏覽器才放行，
     * 所以即使 metadata 還沒載好（或上次載入失敗）也立刻 play()，位置等真的出聲時（playing 事件）再校正
     */
    const attempt = (fromGesture = false) => {
      if (disposed) return
      clearTimeout(timer)
      const p = plan()
      if (p.kind === 'wait') {
        setState('waiting')
        timer = setTimeout(attempt, p.delayMs)
        return
      }
      if (p.kind !== 'play') {
        audio.pause()
        setState('over')
        return
      }
      if (audio.readyState < HAVE_METADATA || audio.error !== null) {
        setState('waiting')
        if (!fromGesture) return
        if (audio.error !== null) audio.load()
        play()
        return
      }
      const target = seekTarget(audio.currentTime, p.positionSec, audio.duration)
      if (target !== null) audio.currentTime = target
      play()
    }

    const onMetadata = () => attempt()
    /** 真的開始出聲（含緩衝後恢復）：資料來得慢時位置會落後，超過容許值就校正（每首有次數上限） */
    const onPlaying = () => {
      if (disposed || resyncs >= MAX_RESYNC_PER_SONG) return
      const p = plan()
      if (p.kind !== 'play') return
      const target = seekTarget(audio.currentTime, p.positionSec, audio.duration)
      if (target === null) return
      resyncs += 1
      audio.currentTime = target
    }
    /** 檔案比 durationMs 短：只停播，等 server 的揭曉 */
    const onEnded = () => {
      if (!disposed) setState('over')
    }
    /** 試聽載不下來（網路、來源連不到）：讓使用者可以點一下重試 */
    const onError = () => {
      if (!disposed) setState('blocked')
    }

    audio.addEventListener('loadedmetadata', onMetadata)
    audio.addEventListener('playing', onPlaying)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)
    registerStarter(() => attempt(true))
    audio.src = song.previewUrl
    audio.load()
    attempt()

    return () => {
      disposed = true
      clearTimeout(timer)
      audio.removeEventListener('loadedmetadata', onMetadata)
      audio.removeEventListener('playing', onPlaying)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
      registerStarter(null)
    }
  }, [key])

  return <audio ref={ref} hidden aria-hidden="true" preload="auto" data-song-player="" data-audio-state={state} data-song-index={index ?? undefined} />
}
