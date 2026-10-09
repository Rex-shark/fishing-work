// 客戶端倒數：以 round.endsAt − Date.now() 計算，不靠 server 每秒推（architecture Phase 2 任務）。
// 本機時鐘與 server 的偏差會直接反映在倒數上（v1 接受），因此顯示值 clamp 到該階段長度：
// 本機時鐘比 server 慢、或無條件進位時，剛開始不會出現 01:01（出題 60 秒）或 02:01（作畫 120 秒）。
import { useSyncExternalStore } from 'react'
import { CHOOSING_SECONDS, DRAW_SECONDS, type ContestPhase } from '@fishing-work/shared/draw-contest'

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

/** 各階段的長度上限（秒）；只有出題與作畫有倒數（architecture §4 RoundPublic.endsAt：其餘階段為 null） */
export const PHASE_SECONDS: Record<ContestPhase, number | null> = {
  idle: null,
  choosing: CHOOSING_SECONDS,
  drawing: DRAW_SECONDS,
  judging: null,
  ended: null,
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

/** 依階段 clamp 的剩餘秒數；idle 或 endsAt 為 null 時回 null */
export function phaseRemainingSeconds(phase: ContestPhase, endsAt: number | null, at: number): number | null {
  const max = PHASE_SECONDS[phase]
  if (max === null) return null
  return remainingSeconds(endsAt, at, max)
}

/** mm:ss */
export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 共用一個 250ms 計時器的倒數 hook：顯示值 clamp 到該階段長度 */
export function usePhaseRemainingSeconds(phase: ContestPhase, endsAt: number | null): number | null {
  const at = useSyncExternalStore(subscribe, getNow)
  return phaseRemainingSeconds(phase, endsAt, at)
}
