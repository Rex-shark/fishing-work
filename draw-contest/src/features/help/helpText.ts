// 說明文字的小工具（純函式）：作畫時間的中文說法由 DRAW_SECONDS 推導（唯一來源；改時間不必改說明）。
import { DRAW_SECONDS } from '@fishing-work/shared/draw-contest'

/** 秒數 → 「2 分鐘」「90 秒」「1 分 30 秒」 */
export function formatDuration(seconds: number = DRAW_SECONDS): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m === 0) return `${s} 秒`
  return s === 0 ? `${m} 分鐘` : `${m} 分 ${s} 秒`
}
