// 自動交卷（spec/draw-contest/architecture.md §5、§7；plan/draw-contest-mvp.md 決策 6）：
// drawing 中 round.endsAt 到時，若自己是參賽者且還沒交卷，匯出 PNG 送 contest:submit（含空白畫布）；
// server 在 endsAt 後 SUBMIT_GRACE_SECONDS 內仍收卷。判斷是純函式（autoSubmitDue／autoSubmitDelay），
// 排程（startAutoSubmit）的時鐘、計時器、store 與送出都可注入，測試不靠真時間。
import type { RoundPublic } from '@fishing-work/shared/draw-contest'
import { useGameStore } from '../../store/game'
import { submitMyCanvas } from './submit'

/** 判斷需要的狀態（store 的子集） */
export interface AutoSubmitView {
  me: string | null
  round: Pick<RoundPublic, 'roundNo' | 'phase' | 'endsAt' | 'participantIds'>
  submitted: boolean
  submitting: boolean
}

/** 自己是否還欠一張卷：已加入、本回合參賽者、未交卷也不在交卷途中 */
function owesSubmission(v: AutoSubmitView): boolean {
  return v.me !== null && v.round.participantIds.includes(v.me) && !v.submitted && !v.submitting
}

/**
 * 此刻該自動交卷嗎（每回合最多自動一次：attemptedRound 為已自動交過的 roundNo）：
 * - drawing：本機時間到 endsAt 才交；
 * - judging：server 已截止作畫（可能本機時鐘較慢、或剛重新整理），在寬限內立刻補交（server 以自己的時鐘判斷寬限）；
 * - 其餘階段不交。
 */
export function autoSubmitDue(v: AutoSubmitView, now: number, attemptedRound: number | null): boolean {
  if (!owesSubmission(v) || attemptedRound === v.round.roundNo) return false
  if (v.round.phase === 'judging') return true
  return v.round.phase === 'drawing' && v.round.endsAt !== null && now >= v.round.endsAt
}

/** 距離自動交卷還有幾毫秒（排計時器用）；不需要排程時為 null */
export function autoSubmitDelay(v: AutoSubmitView, now: number): number | null {
  if (!owesSubmission(v) || v.round.phase !== 'drawing' || v.round.endsAt === null) return null
  return Math.max(0, v.round.endsAt - now)
}

export interface AutoSubmitDeps {
  getState(): AutoSubmitView
  /** 狀態變動時呼叫 listener；回傳取消訂閱 */
  subscribe(listener: () => void): () => void
  now(): number
  setTimer(fn: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
  submit(): Promise<unknown>
}

const defaultDeps: AutoSubmitDeps = {
  getState: () => useGameStore.getState(),
  subscribe: (listener) => useGameStore.subscribe(listener),
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  submit: () => submitMyCanvas(),
}

/**
 * 啟動自動交卷：狀態每次變動就重新判斷並重排計時器（endsAt 到時再判斷一次）；回傳停止函式。
 * App 掛載時啟動一次（React StrictMode 會啟動兩次，第一次的停止函式會先被呼叫）
 */
export function startAutoSubmit(deps: AutoSubmitDeps = defaultDeps): () => void {
  let timer: unknown = null
  let attemptedRound: number | null = null

  function clear(): void {
    if (timer !== null) deps.clearTimer(timer)
    timer = null
  }

  function check(): void {
    clear()
    const v = deps.getState()
    const now = deps.now()
    if (autoSubmitDue(v, now, attemptedRound)) {
      attemptedRound = v.round.roundNo
      void deps.submit()
      return
    }
    const delay = autoSubmitDelay(v, now)
    if (delay !== null) timer = deps.setTimer(check, delay)
  }

  const unsubscribe = deps.subscribe(check)
  check()
  return () => {
    unsubscribe()
    clear()
  }
}
