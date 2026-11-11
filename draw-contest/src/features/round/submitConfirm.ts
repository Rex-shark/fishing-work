// 交卷確認（spec/draw-contest/design.md §2 drawing：按「完成」先開確認框，確認才交卷；overview 規則 5「按完成確認後交卷」）。
// 狀態：openRound＝開著的確認框屬於哪一回合（null＝關閉）。以 roundNo 記，新回合不會殘留上一回合開著的框；
//   可不可以顯示另由 SubmitConfirmDialog 以「此刻能作畫」把關（時間到自動交卷、交卷中，框自動消失）。
// error：確認後交卷失敗的訊息（顯示在「完成」旁，4 秒或再按一次時清除）。
// 自動交卷（autoSubmit）直接呼叫 exportMyCanvas／submitPreparedPng，不經本檔（時間到不問）。
// 獨立成 .ts：元件檔只匯出元件（react-refresh 規則）；相依可注入，測試不必連線。
import { create } from 'zustand'
import type { ActionOutcome } from '../../socket/client'
import { submitMyCanvas } from './submit'

interface SubmitConfirmState {
  /** 開著的確認框所屬的 roundNo；null＝關閉 */
  openRound: number | null
  /** 確認後交卷失敗的訊息 */
  error: string | null
}

export const useSubmitConfirmStore = create<SubmitConfirmState>()(() => ({ openRound: null, error: null }))

/** 開啟確認框時有焦點的元素（「完成」）；取消或交卷失敗時把焦點還給它 */
let opener: HTMLElement | null = null

function focusedElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const el = document.activeElement
  return typeof HTMLElement !== 'undefined' && el instanceof HTMLElement && el !== document.body ? el : null
}

function refocusOpener(): void {
  const el = opener
  opener = null
  if (el !== null && el.isConnected) el.focus()
}

/** 「完成」：開確認框（不交卷） */
export function openSubmitConfirm(roundNo: number): void {
  opener = focusedElement()
  useSubmitConfirmStore.setState({ openRound: roundNo, error: null })
}

/** 「取消」／Esc／關閉鈕：關框、不交卷，焦點回到「完成」 */
export function cancelSubmitConfirm(): void {
  useSubmitConfirmStore.setState({ openRound: null })
  refocusOpener()
}

/** 清掉「完成」旁的錯誤訊息 */
export function clearSubmitError(): void {
  useSubmitConfirmStore.setState({ error: null })
}

/**
 * 「儲存」（Enter）：關框並交卷。成功後工具列與「完成」隨之消失（不還焦點）；
 * 失敗時把訊息放到 error、焦點回到「完成」（時間內可再按一次）
 */
export async function confirmSubmit(submit: () => Promise<ActionOutcome> = submitMyCanvas): Promise<ActionOutcome> {
  useSubmitConfirmStore.setState({ openRound: null, error: null })
  const r = await submit()
  if (!r.ok) {
    useSubmitConfirmStore.setState({ error: r.message })
    refocusOpener()
  } else {
    opener = null
  }
  return r
}

/** 確認框此刻是否顯示：開在目前這一回合，且自己還能作畫（未交卷、未在交卷途中、仍在 drawing） */
export function submitConfirmVisible(openRound: number | null, roundNo: number, canDraw: boolean): boolean {
  return openRound !== null && openRound === roundNo && canDraw
}
