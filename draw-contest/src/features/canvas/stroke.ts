// 作畫輸入端的純函式：指標座標正規化、strokeId（複製自我畫你猜；繪圖比賽的筆跡只在本機，不分批送出）
import { STROKE_ID_MAX, type Point } from './ops'

/**
 * 螢幕座標 → 0..1 正規化座標（依 canvas 的 getBoundingClientRect）。
 * 指標拖出畫布時 clamp 到邊界（仍能畫到邊緣）；小數取 4 位（1280 寬下約 0.13 邏輯像素）。
 */
export function normalizePoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): Point {
  const norm = (v: number, size: number) => {
    if (!(size > 0) || !Number.isFinite(v)) return 0
    const r = Math.min(1, Math.max(0, v / size))
    return Math.round(r * 10000) / 10000
  }
  return { x: norm(clientX - rect.left, rect.width), y: norm(clientY - rect.top, rect.height) }
}

let strokeSeq = 0

/**
 * 新筆畫 id（≤ STROKE_ID_MAX 字元、本回合不重複）。
 * crypto.randomUUID() 只在 secure context（https / localhost）存在；區網 http://<IP>/ 連線時是 undefined，
 * 因此退回「時間 + 序號 + 亂數」。
 */
export function newStrokeId(): string {
  const c: Crypto | undefined = typeof crypto === 'undefined' ? undefined : crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  strokeSeq += 1
  const id = `${Date.now().toString(36)}-${strokeSeq.toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return id.slice(0, STROKE_ID_MAX)
}
