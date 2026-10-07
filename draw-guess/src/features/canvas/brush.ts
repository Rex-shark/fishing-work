// 畫具純函式（spec/architecture.md §6「粗細」「顏色」、DESIGN.md §6「滑桿」「色相條」「顏色面板」）：
// 色相 → #RRGGBB、HSV ↔ #RRGGBB（Epic 11 顏色面板）、滑桿與飽和度／明度方塊的指標位置／鍵盤 → 數值、
// 送出前的粗細與色碼正規化。不依賴 React，方便 Vitest 測試。
import { BRUSH_DEFAULT, BRUSH_MAX, BRUSH_MIN, COLOR_PATTERN, PALETTE, type DrawOp } from '@fishing-work/shared'

/** 色相條範圍（度）。360° 與 0° 同色，因此上限取 359 */
export const HUE_MIN = 0
export const HUE_MAX = 359

/** 鍵盤步進（DESIGN §6：粗細 ←/→ 每次 1、Shift 每次 8；色相 ←/→ 每次 5°） */
export const SIZE_KEYS: SliderKeyConfig = { min: BRUSH_MIN, max: BRUSH_MAX, step: 1, bigStep: 8 }
export const HUE_KEYS: SliderKeyConfig = { min: HUE_MIN, max: HUE_MAX, step: 5, bigStep: 30 }

/** 預設色塊的中文色名（與 PALETTE 索引對應），用於 aria-label 與工具提示 */
export const PALETTE_NAMES = ['白', '黑', '膚色', '灰', '紅', '橘', '黃', '綠', '藍', '紫'] as const

/**
 * 色相條背景：0..360° 每 60° 一個色標的彩虹漸層。
 * 這是資料視覺化（色相本身），不是主題色，因此不走 token（DESIGN §10 的規則針對介面色）
 */
export const HUE_GRADIENT = `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360]
  .map((h) => `hsl(${h}, 100%, 50%)`)
  .join(', ')})`

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** 任意角度正規化到 0 ≤ h < 360 */
function wrapHue(h: number): number {
  return ((h % 360) + 360) % 360
}

/**
 * hsl(h, 100%, 50%) → 大寫 `#RRGGBB`（spec §4 COLOR_PATTERN、§6「轉成 hsl 再轉 #RRGGBB 大寫」）。
 * 公式同 CSS Color 4 的 hslToRgb；非有限數視為 0°
 */
export function hueToHex(hue: number): string {
  const h = Number.isFinite(hue) ? wrapHue(hue) : 0
  const s = 1
  const l = 0.5
  const a = s * Math.min(l, 1 - l)
  const channel = (n: number): string => {
    const k = (n + h / 30) % 12
    const f = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(f * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${channel(0)}${channel(8)}${channel(4)}`.toUpperCase()
}

/** 飽和度、明度範圍（%） */
export const SV_MIN = 0
export const SV_MAX = 100

/** HSV 三個值（hue 0..359°、sat／val 0..100%）；顏色面板的狀態（store brush 的 hue／sat／val） */
export interface Hsv {
  hue: number
  sat: number
  val: number
}

/**
 * HSV → 大寫 `#RRGGBB`（Epic 11 決策 3；spec §6「顏色」）。
 * hue 繞回 0..360、sat／val clamp 到 0..100；非有限數視為 0。允許小數（點色塊反推的值），輸出逐 channel 四捨五入
 */
export function hsvToHex(hue: number, sat: number, val: number): string {
  const h = Number.isFinite(hue) ? wrapHue(hue) : 0
  const s = (Number.isFinite(sat) ? clamp(sat, SV_MIN, SV_MAX) : 0) / 100
  const v = (Number.isFinite(val) ? clamp(val, SV_MIN, SV_MAX) : 0) / 100
  // CSS Color 4 的 hsvToRgb：f(n) = v − v·s·max(0, min(k, 4 − k, 1))，k = (n + h/60) mod 6
  const channel = (n: number): string => {
    const k = (n + h / 60) % 6
    const f = v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
    return Math.round(f * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${channel(5)}${channel(3)}${channel(1)}`.toUpperCase()
}

/**
 * `#RRGGBB`（大小寫皆可）→ HSV（點預設色塊時反推，把手擺到對應位置）。
 * 回傳**不取整**的精確值，保證 `hsvToHex(hexToHsv(c))` 逐字等於 `c`（大寫）：整數 HSV 只有約 367 萬種組合，
 * 像 #FFECEA、#F44747 這類色塊無法以整數 sat／val 精確表示（見 plan/color-picker.md 踩雷紀錄）。
 * 灰階（含黑、白：R = G = B）沒有色相，保留傳入的 `hue`（決策 3）；黑的飽和度為 0。不合法色碼回傳白（PALETTE[0]）
 */
export function hexToHsv(hex: string, hue = 0): Hsv {
  const c = COLOR_PATTERN.test(hex) ? hex : PALETTE[0]
  const r = Number.parseInt(c.slice(1, 3), 16) / 255
  const g = Number.parseInt(c.slice(3, 5), 16) / 255
  const b = Number.parseInt(c.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  const keep = Number.isFinite(hue) ? clamp(hue, HUE_MIN, HUE_MAX) : HUE_MIN
  let h: number
  if (d === 0) h = keep
  else if (max === r) h = 60 * (((g - b) / d + 6) % 6)
  else if (max === g) h = 60 * ((b - r) / d + 2)
  else h = 60 * ((r - g) / d + 4)
  return { hue: h, sat: max === 0 ? 0 : (d / max) * 100, val: max * 100 }
}

/**
 * 指標在飽和度／明度方塊上的位置 → 整數 { sat, val }（決策 2：x＝飽和度 0→100、y＝明度 100→0；
 * 拖出方塊 clamp 到邊緣）。方塊尚未排版（寬或高為 0）時該軸回 0／100 端點，不產生 NaN
 */
export function svFromPointer(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { sat: number; val: number } {
  const x = rect.width > 0 ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0
  const y = rect.height > 0 ? clamp((clientY - rect.top) / rect.height, 0, 1) : 0
  return { sat: Math.round(x * SV_MAX), val: Math.round((1 - y) * SV_MAX) }
}

/** 方塊鍵盤步進（決策 4：方向鍵 ±2；Shift＋方向鍵、PageUp／PageDown ±10） */
export const SV_STEP = 2
export const SV_BIG_STEP = 10

/**
 * 飽和度／明度方塊的鍵盤操作（決策 4）：←/→ 飽和度、↑/↓ 明度（各 ±2，Shift ±10）；
 * PageUp／PageDown 飽和度 ±10（方塊的 aria-valuenow 是飽和度，與 Home／End 同軸）；Home／End 飽和度 0／100。
 * 結果取整並 clamp 到 0..100；不處理的按鍵回 null（呼叫端不要 preventDefault）
 */
export function svKeyValue(key: string, shift: boolean, sat: number, val: number): { sat: number; val: number } | null {
  const step = shift ? SV_BIG_STEP : SV_STEP
  let s = sat
  let v = val
  switch (key) {
    case 'ArrowRight':
      s += step
      break
    case 'ArrowLeft':
      s -= step
      break
    case 'ArrowUp':
      v += step
      break
    case 'ArrowDown':
      v -= step
      break
    case 'PageUp':
      s += SV_BIG_STEP
      break
    case 'PageDown':
      s -= SV_BIG_STEP
      break
    case 'Home':
      s = SV_MIN
      break
    case 'End':
      s = SV_MAX
      break
    default:
      return null
  }
  return { sat: clamp(Math.round(s), SV_MIN, SV_MAX), val: clamp(Math.round(v), SV_MIN, SV_MAX) }
}

/** 方塊的 aria-valuetext 與工具提示：「飽和度 80%、明度 60%」（DESIGN §6；小數四捨五入顯示） */
export function svLabel(sat: number, val: number): string {
  return `飽和度 ${Math.round(sat)}%、明度 ${Math.round(val)}%`
}

/** 工具列「目前顏色」按鈕的工具提示與 aria-label：「選擇顏色（目前 #XXXXXX）」（決策 1；色碼大寫） */
export function colorButtonLabel(color: string): string {
  return `選擇顏色（目前 ${normalizeColor(color)}）`
}

/** 指標在軌道上的位置 → 範圍內的整數值（點擊與拖曳共用；軌道外 clamp 到兩端） */
export function valueFromPointer(clientX: number, trackLeft: number, trackWidth: number, min: number, max: number): number {
  if (!(trackWidth > 0)) return min
  const ratio = clamp((clientX - trackLeft) / trackWidth, 0, 1)
  return Math.round(min + ratio * (max - min))
}

/** 數值在範圍內的比例（0..1），用來擺放把手與已選段 */
export function valueRatio(value: number, min: number, max: number): number {
  return max > min ? clamp((value - min) / (max - min), 0, 1) : 0
}

export interface SliderKeyConfig {
  min: number
  max: number
  /** ←/→（與 ↑/↓）每次的步進 */
  step: number
  /** Shift＋方向鍵、PageUp／PageDown 的步進 */
  bigStep: number
}

/**
 * 滑桿鍵盤操作（WAI-ARIA slider 慣例）：→/↑ 加、←/↓ 減（Shift 用大步進）、PageUp／PageDown 大步進、Home／End 到兩端。
 * 不處理的按鍵回 null（呼叫端不要 preventDefault）
 */
export function sliderKeyValue(key: string, shift: boolean, value: number, cfg: SliderKeyConfig): number | null {
  const small = shift ? cfg.bigStep : cfg.step
  let next: number
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      next = value + small
      break
    case 'ArrowLeft':
    case 'ArrowDown':
      next = value - small
      break
    case 'PageUp':
      next = value + cfg.bigStep
      break
    case 'PageDown':
      next = value - cfg.bigStep
      break
    case 'Home':
      next = cfg.min
      break
    case 'End':
      next = cfg.max
      break
    default:
      return null
  }
  return clamp(Math.round(next), cfg.min, cfg.max)
}

/** 送出前的粗細：取整數並 clamp 到 BRUSH_MIN..BRUSH_MAX（server 對不合法值靜默丟棄，客戶端先擋） */
export function normalizeBrushSize(size: number): number {
  return Number.isFinite(size) ? clamp(Math.round(size), BRUSH_MIN, BRUSH_MAX) : BRUSH_DEFAULT
}

/** 送出前的色碼：合法則轉大寫 6 位；不合法退回預設色（PALETTE[0]） */
export function normalizeColor(color: string): string {
  return COLOR_PATTERN.test(color) ? color.toUpperCase() : PALETTE[0]
}

/**
 * 粗細預覽圓點直徑（px）：隨粗細線性變大，1 → 2px、64 → 16px。
 * 上限 16px 以免撐高工具列（實際筆跡另依畫布縮放比例呈現）
 */
export const PREVIEW_MIN_PX = 2
export const PREVIEW_MAX_PX = 16
export function previewDiameter(size: number): number {
  const ratio = valueRatio(normalizeBrushSize(size), BRUSH_MIN, BRUSH_MAX)
  return Math.round(PREVIEW_MIN_PX + ratio * (PREVIEW_MAX_PX - PREVIEW_MIN_PX))
}

/** 「背景色」按鈕的工具提示與 aria-label：「把背景設為目前顏色 #XXXXXX」（DESIGN §6，Epic 7；色碼大寫） */
export function backgroundLabel(color: string): string {
  return `把背景設為目前顏色 ${normalizeColor(color)}`
}

/** 「背景色」按鈕送出的 op：顏色＝目前筆色（大寫 #RRGGBB；橡皮擦模式也用目前筆色），Epic 7 決策 5 */
export function backgroundOp(color: string): Extract<DrawOp, { type: 'background' }> {
  return { type: 'background', color: normalizeColor(color) }
}

/** 預設色塊的工具提示與 aria-label：「顏色 <色碼>（<色名>）」（DESIGN §6 的例子只有色碼，再附中文色名） */
export function swatchLabel(color: string, index: number): string {
  const name = PALETTE_NAMES[index]
  return name === undefined ? `顏色 ${color}` : `顏色 ${color}（${name}）`
}
