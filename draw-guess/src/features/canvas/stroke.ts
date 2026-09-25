// 畫師輸入端的純函式：指標座標正規化、move 分批、strokeId（spec/architecture.md §6、§5「draw:op 驗證」）
import { MAX_POINTS_PER_MOVE, STROKE_ID_MAX, type Point } from '@fishing-work/shared'

/**
 * 螢幕座標 → 0..1 正規化座標（依 canvas 的 getBoundingClientRect）。
 * 指標拖出畫布時 clamp 到邊界（仍能畫到邊緣）；小數取 4 位減少傳輸量（1280 寬下約 0.13 邏輯像素）。
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

/** 把累積的點切成每則 ≤ MAX_POINTS_PER_MOVE 點（server 對超過的 move 整則丟棄） */
export function chunkPoints(points: readonly Point[], max: number = MAX_POINTS_PER_MOVE): Point[][] {
  const chunks: Point[][] = []
  for (let i = 0; i < points.length; i += max) chunks.push(points.slice(i, i + max))
  return chunks
}

let strokeSeq = 0

/**
 * 新筆畫 id（≤ STROKE_ID_MAX 字元、本回合不重複）。
 * spec 指定 crypto.randomUUID()，但它只在 secure context（https / localhost）存在；
 * 同事以區網 http://<IP>/ 連線時是 undefined，因此退回「時間 + 序號 + 亂數」。
 */
export function newStrokeId(): string {
  const c: Crypto | undefined = typeof crypto === 'undefined' ? undefined : crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  strokeSeq += 1
  const id = `${Date.now().toString(36)}-${strokeSeq.toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return id.slice(0, STROKE_ID_MAX)
}
