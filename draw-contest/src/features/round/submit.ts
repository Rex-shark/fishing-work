// 交卷（spec/draw-contest/architecture.md §4 contest:submit、§7；plan/draw-contest-mvp.md 決策 6）：
// 匯出自己的本機畫布為 1280×720 PNG → contest:submit → 成功即鎖定畫布（交卷後不能改）。
// 手動（工具列「完成」）與自動交卷（autoSubmit）共用；submitting 期間不重複送出。相依可注入，測試不必連線。
import type { DrawOp } from '../canvas/ops'
import { exportPng } from '../canvas/exportPng'
import { submit, type ActionOutcome } from '../../socket/client'
import { useGameStore } from '../../store/game'

export interface SubmitDeps {
  /** 目前的交卷狀態與本機筆跡 */
  read(): { submitted: boolean; submitting: boolean; ops: readonly DrawOp[] }
  setSubmitting(value: boolean): void
  markSubmitted(): void
  exportPng(ops: readonly DrawOp[]): Promise<ArrayBuffer>
  send(png: ArrayBuffer): Promise<ActionOutcome>
}

const defaultDeps: SubmitDeps = {
  read: () => {
    const s = useGameStore.getState()
    return { submitted: s.submitted, submitting: s.submitting, ops: s.myCanvas.ops }
  },
  setSubmitting: (value) => useGameStore.getState().setSubmitting(value),
  markSubmitted: () => useGameStore.getState().markSubmitted(),
  exportPng: (ops) => exportPng(ops),
  send: submit,
}

const ALREADY: ActionOutcome = { ok: false, error: 'ALREADY_SUBMITTED', message: '你已經交卷了' }
const BUSY: ActionOutcome = { ok: false, error: 'ALREADY_SUBMITTED', message: '正在交卷，請稍候' }
const EXPORT_FAILED: ActionOutcome = { ok: false, error: 'EXPORT_FAILED', message: '無法輸出圖片，請再試一次' }

/**
 * 交卷自己的畫：已交卷或交卷中直接回失敗（不送）；server 回 ALREADY_SUBMITTED 也視同已交卷（逾時後重送的情況）。
 * 失敗時解除 submitting，畫布恢復可畫（時間內可再按「完成」）
 */
export async function submitMyCanvas(deps: SubmitDeps = defaultDeps): Promise<ActionOutcome> {
  const { submitted, submitting, ops } = deps.read()
  if (submitted) return ALREADY
  if (submitting) return BUSY
  deps.setSubmitting(true)
  try {
    let png: ArrayBuffer
    try {
      png = await deps.exportPng(ops)
    } catch {
      return EXPORT_FAILED
    }
    const r = await deps.send(png)
    if (r.ok || r.error === 'ALREADY_SUBMITTED') deps.markSubmitted()
    return r
  } finally {
    deps.setSubmitting(false)
  }
}
