// 客戶端倒數：以 round.endsAt −「校正後的現在」計算，不靠 server 每秒推。
// 校正後的現在＝Date.now() + store.clockOffset（features/player/clock：每次 round:update／快照以 round.serverNow 重估），
// 本機時鐘與 server 差幾秒也不影響倒數。顯示值仍 clamp 到該階段長度：
// 起播前的緩衝（START_DELAY_MS）期間，試聽倒數停在整首長度（00:30），不會出現 00:32。
import { useSyncExternalStore } from 'react'
import { CHOOSING_SECONDS, PREVIEW_CAP_MS, REVEAL_SECONDS, type RoundPublic } from '@fishing-work/shared/song-guess'
import { toServerTime } from '../player/clock'
import { useGameStore } from '../../store/game'

const TICK_MS = 250

let now = Date.now()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (timer === null) {
    now = Date.now()
    timer = setInterval(() => {
      now = Date.now()
      for (const l of listeners) l()
    }, TICK_MS)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}

const getNow = () => now

type RoundClock = Pick<RoundPublic, 'phase' | 'endsAt' | 'song'>

/**
 * 各階段倒數的長度上限（秒）：choosing＝出題期限、playing＝這首的試聽長度（durationMs，無條件進位）、reveal＝揭曉停留；
 * idle、ended 沒有倒數（null）
 */
export function phaseMaxSeconds(round: Pick<RoundPublic, 'phase' | 'song'>): number | null {
  switch (round.phase) {
    case 'choosing':
      return CHOOSING_SECONDS
    case 'playing':
      return Math.ceil((round.song?.durationMs ?? PREVIEW_CAP_MS) / 1000)
    case 'reveal':
      return REVEAL_SECONDS
    default:
      return null
  }
}

/**
 * 距 endsAt 剩餘的整秒數（無條件進位），clamp 到 0..maxSeconds；endsAt 為 null 時回 null。
 * maxSeconds 省略時只做下限 0。
 */
export function remainingSeconds(endsAt: number | null, at: number, maxSeconds?: number): number | null {
  if (endsAt === null || !Number.isFinite(endsAt)) return null
  const s = Math.max(0, Math.ceil((endsAt - at) / 1000))
  return maxSeconds === undefined ? s : Math.min(s, Math.max(0, maxSeconds))
}

/** 依階段 clamp 的剩餘秒數（serverNowMs 為校正後的現在）；idle、ended 或 endsAt 為 null 時回 null */
export function roundRemainingSeconds(round: RoundClock, serverNowMs: number): number | null {
  const max = phaseMaxSeconds(round)
  if (max === null) return null
  return remainingSeconds(round.endsAt, serverNowMs, max)
}

/** mm:ss */
export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 共用一個 250ms 計時器的倒數 hook：以校正後的時間計算，顯示值 clamp 到該階段長度 */
export function useRoundRemainingSeconds(round: RoundClock): number | null {
  const at = useSyncExternalStore(subscribe, getNow)
  const offset = useGameStore((s) => s.clockOffset)
  return roundRemainingSeconds(round, toServerTime(at, offset))
}
