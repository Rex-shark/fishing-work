// 對話框送出中（DialogProps.busy）結束後的焦點還原：三套殼層對話框共用（office/OfficeDialog＝ppt＋excel、meet/MeetDialog、vscode/QuickInput）。
// 送出中的輸入框一律 readOnly＋aria-busy，不用原生 disabled：被停用的元素會失去焦點（activeElement 變成 body），
// 而 Esc／Enter 掛在對話框自己的 onKeyDown／onSubmit，焦點不在對話框內就收不到，只剩滑鼠能操作（plan/notes.md 2026-10-12）。
// readOnly 已讓焦點留在原處；這裡是保險：busy 由 true 轉 false 時焦點若已不在對話框內，放回輸入框（沒有輸入框時放回第一個可用選項）。
// 純邏輯（busyEnded、restoreDialogFocus）與繪圖比賽的 shells/office/officeLayout 同名同義；本檔另把 effect 包成 hook 給三個元件共用。
import { useEffect, useRef, type RefObject } from 'react'

/**
 * 對話框選項的標記（各殼層以字面值寫在 JSX）：Office／Meet 是右下按鈕與說明的主題清單（標題列的關閉鈕不是選項，不標）；
 * vscode 的選項不可聚焦（aria-activedescendant），標在承接焦點的選單（listbox）上
 */
export const DIALOG_OPTION_ATTR = 'data-dialog-option'

/**
 * busy 結束後焦點的落點，依序找第一個存在的：輸入框 → 第一個可用的選項（未停用；選項只設 aria-disabled，不用原生 disabled）。
 * 輸入框在 busy 時是 readOnly（不是 disabled），這裡的 :not([disabled]) 只是防呆
 */
export const DIALOG_REFOCUS_SELECTORS = [
  'input:not([disabled])',
  `[${DIALOG_OPTION_ATTR}]:not([disabled]):not([aria-disabled="true"])`,
] as const

/** 焦點還原用到的最小 DOM 介面（元件以對話框根節點代入；測試以假物件代入） */
export interface DialogFocusRoot {
  /** 節點是否在對話框內（含對話框本身） */
  contains(node: unknown): boolean
  querySelector(selector: string): { focus(): void } | null
}

/** busy 是否剛結束（上一次渲染為 true、這一次不是） */
export function busyEnded(wasBusy: boolean, busy: boolean): boolean {
  return wasBusy && !busy
}

/**
 * busy 結束後的保險：焦點不在對話框內（例如掉到 body）時放回輸入框，沒有輸入框就放回第一個可用選項；
 * 焦點還在對話框內就不動（使用者可能已經 Tab 到別的按鈕）。回傳是否移動了焦點。
 * selectors：落點的順序，預設 DIALOG_REFOCUS_SELECTORS；選項的 DOM 順序與選項順序不同的殼層（meet）給自己的
 */
export function restoreDialogFocus(root: DialogFocusRoot, active: unknown, selectors: readonly string[] = DIALOG_REFOCUS_SELECTORS): boolean {
  if (active != null && root.contains(active)) return false
  for (const selector of selectors) {
    const target = root.querySelector(selector)
    if (target !== null) {
      target.focus()
      return true
    }
  }
  return false
}

/**
 * 殼層對話框的 effect：busy 由 true 轉 false 時（送出失敗、對話框還在）呼叫 restoreDialogFocus。
 * rootRef 為對話框根節點（role="dialog"）；送出成功時對話框通常已卸載，不會走到還原
 */
export function useRestoreDialogFocus(
  busy: boolean,
  rootRef: RefObject<HTMLElement | null>,
  selectors: readonly string[] = DIALOG_REFOCUS_SELECTORS,
): void {
  const wasBusy = useRef(false)
  useEffect(() => {
    const ended = busyEnded(wasBusy.current, busy)
    wasBusy.current = busy
    const root = rootRef.current
    if (!ended || root === null) return
    restoreDialogFocus(
      { contains: (node) => root.contains(node as Node | null), querySelector: (selector) => root.querySelector<HTMLElement>(selector) },
      document.activeElement,
      selectors,
    )
  }, [busy, rootRef, selectors])
}
