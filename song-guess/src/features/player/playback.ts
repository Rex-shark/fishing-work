// 播放的純邏輯（spec/song-guess/design.md §3、architecture.md §5「playing」「時鐘」）：何時該播、該定位到哪。
// 元件（AudioPlayer）只負責把結果套到 <audio>；這裡不碰 DOM，可單元測試。
//   收到 playing 即載入試聽（預載）；startedAt（＝進入 playing 的 now + START_DELAY_MS）到了才起播，所有人同時開始；
//   中途加入／重連：定位到（校正後現在 − startedAt）÷ 1000 秒再播；超過 durationMs 就不播，等 server 的揭曉；
//   其他階段（idle／choosing／reveal／ended）：停播並清掉來源。
import type { RoundPublic, SongPublic } from '@fishing-work/shared/song-guess'

/** 播放器該做的事 */
export type PlaybackPlan =
  /** 沒有歌要播：pause 並清 src */
  | { kind: 'stop' }
  /** 已可載入、還沒到 startedAt：delayMs 毫秒後再算一次（屆時起播） */
  | { kind: 'wait'; src: string; delayMs: number }
  /** 該播了：定位到 positionSec（秒）後 play() */
  | { kind: 'play'; src: string; positionSec: number }
  /** 這首的播放時間已過（等 server 揭曉）：保留 src、不播 */
  | { kind: 'over'; src: string }

/** 自動播放被擋時舞台上那顆按鈕的文字（design §3）；殼層照樣顯示，遊戲說明也引用同一個常數 */
export const START_PLAYBACK_LABEL = '點一下開始播放'

/** 播放器對外的狀態（<audio data-audio-state>、舞台的波形與「開始播放」按鈕） */
export type AudioState = 'idle' | 'waiting' | 'playing' | 'blocked' | 'over'

/** 目前要播的那一首：只有 playing 且有 song 才有；reveal 的 song 仍在但不播 */
export function activeSong(round: Pick<RoundPublic, 'phase' | 'song'>): SongPublic | null {
  return round.phase === 'playing' ? round.song : null
}

/**
 * 依局狀態與「校正後的現在」（server 時鐘，毫秒）決定播放器該做什麼。
 * song 的欄位不合理（網址空白、時間不是有限數字、長度 ≤ 0）一律視為沒有歌可播
 */
export function playbackPlan(round: Pick<RoundPublic, 'phase' | 'song'>, serverNowMs: number): PlaybackPlan {
  const song = activeSong(round)
  if (song === null || song.previewUrl === '') return { kind: 'stop' }
  const { previewUrl: src, startedAt, durationMs } = song
  if (!Number.isFinite(startedAt) || !Number.isFinite(durationMs) || !Number.isFinite(serverNowMs) || durationMs <= 0) return { kind: 'stop' }
  const elapsed = serverNowMs - startedAt
  if (elapsed < 0) return { kind: 'wait', src, delayMs: -elapsed }
  if (elapsed >= durationMs) return { kind: 'over', src }
  return { kind: 'play', src, positionSec: elapsed / 1000 }
}

/** 播放位置與應有位置差多少秒以內不重新定位（seek 會讓聲音斷一下；區網的時鐘誤差本來就在這個量級） */
export const SEEK_TOLERANCE_SEC = 0.35

/**
 * 需要定位時回傳目標秒數，否則 null。
 * 目標若超過檔案長度（mediaDuration，未知傳 NaN）則夾在結尾前一點，避免直接觸發 ended
 */
export function seekTarget(currentSec: number, positionSec: number, mediaDuration: number = Number.NaN, tolerance: number = SEEK_TOLERANCE_SEC): number | null {
  const wanted = Math.max(0, positionSec)
  const target = Number.isFinite(mediaDuration) && mediaDuration > 0 ? Math.min(wanted, Math.max(0, mediaDuration - 0.05)) : wanted
  if (!Number.isFinite(currentSec)) return target
  return Math.abs(currentSec - target) > tolerance ? target : null
}

/** 一首歌播放途中最多自動校正幾次（緩衝不足時每次 seek 又會再緩衝，不設上限會一直斷） */
export const MAX_RESYNC_PER_SONG = 3

/** play() 被拒絕的原因是不是「瀏覽器擋自動播放」（NotAllowedError）；其他錯誤（載入失敗、被 pause 中斷）不算 */
export function isAutoplayBlocked(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'NotAllowedError'
}

/** 同一首歌的識別（局號＋第幾首＋網址＋開始時間）：變了才重新載入與定位；猜對造成的 round:update 不會變 */
export function songKey(round: Pick<RoundPublic, 'gameNo' | 'phase' | 'song'>): string | null {
  const song = activeSong(round)
  return song === null ? null : `${round.gameNo}:${song.index}:${song.startedAt}:${song.previewUrl}`
}
