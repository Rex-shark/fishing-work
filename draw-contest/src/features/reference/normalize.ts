// 像不像比賽的參考圖正規化（Epic 20；plan/contest-mimic.md 決策 2；spec/draw-contest/architecture.md §5.1b、§7）：
// 出題者選檔或拖曳的圖片（png／jpeg／webp／gif 第一幀皆可）→ 解碼 → canvas 縮到長邊 ≤ REFERENCE_MAX_SIDE（不放大）
// → toBlob('image/jpeg', REFERENCE_JPEG_QUALITY) → ArrayBuffer，交給 round:setTopic 的 reference。
// server 沒有影像庫，只驗 JPEG magic（FF D8 FF）與 ≤ MAX_REFERENCE_BYTES；這裡先擋一次，免得送出才被退。
// 解碼（Image）與 canvas 都可注入：測試以假物件驗證縮放、不放大、非圖片、轉檔失敗與超大。
import { MAX_REFERENCE_BYTES } from '@fishing-work/shared/draw-contest'

/** 長邊上限（px；Clef 吃 1280 以內的圖速度與現況相同，決策 2） */
export const REFERENCE_MAX_SIDE = 1280
/** JPEG 品質（決策 2） */
export const REFERENCE_JPEG_QUALITY = 0.9
/**
 * JPEG 沒有透明度：透明的 PNG／GIF 先鋪一層白底再畫（不鋪的話透明處會變黑，黑線稿就整張看不見）。
 * 這是圖片像素，不是畫面樣式（畫面色彩一律用 token）
 */
export const REFERENCE_MATTE = '#FFFFFF'

/** 解碼後的圖片（HTMLImageElement 的最小介面） */
export interface DecodedImage {
  /** 原始寬高（px） */
  width: number
  height: number
  /** 交給 drawImage 的來源 */
  source: CanvasImageSource
  /** 用完釋放（object URL 等）；選填 */
  release?(): void
}

/** 用到的 Canvas 2D 成員 */
export type ReferenceContext = Pick<CanvasRenderingContext2D, 'fillStyle' | 'fillRect' | 'drawImage'>

/** 轉檔用的最小 canvas 介面（HTMLCanvasElement 可直接傳入） */
export interface ReferenceCanvas {
  width: number
  height: number
  getContext(contextId: '2d'): ReferenceContext | null
  toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: number): void
}

export interface NormalizeDeps {
  /** 解碼；失敗時 reject（不是圖片、檔壞掉） */
  decode(file: Blob): Promise<DecodedImage>
  createCanvas(): ReferenceCanvas
}

export type NormalizeErrorCode = 'NOT_IMAGE' | 'DECODE_FAILED' | 'ENCODE_FAILED' | 'TOO_LARGE'

export type NormalizeResult =
  | { ok: true; jpeg: ArrayBuffer; width: number; height: number }
  | { ok: false; error: NormalizeErrorCode; message: string }

/** 錯誤訊息（顯示在出題對話框；繁體中文） */
export const NORMALIZE_MESSAGES: Record<NormalizeErrorCode, string> = {
  NOT_IMAGE: '請選擇圖片檔（PNG、JPEG、WebP 或 GIF）',
  DECODE_FAILED: '無法讀取這張圖片，請換一張',
  ENCODE_FAILED: '圖片轉檔失敗，請換一張',
  TOO_LARGE: '圖片太大，請換一張',
}

const fail = (error: NormalizeErrorCode): NormalizeResult => ({ ok: false, error, message: NORMALIZE_MESSAGES[error] })

/**
 * 縮放後的尺寸：長邊 ≤ maxSide、等比、不放大；至少 1px。寬高不合法（0、負數、非有限數）回 null
 */
export function fitSize(width: number, height: number, maxSide: number = REFERENCE_MAX_SIDE): { width: number; height: number } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  const scale = Math.min(1, maxSide / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** 是不是圖片：有 MIME 型別時要是 image/*；沒有型別（部分拖曳來源）交給解碼判斷 */
export function looksLikeImage(file: Pick<Blob, 'type'>): boolean {
  return file.type === '' || file.type.startsWith('image/')
}

/** JPEG magic（FF D8 FF；server 以此驗證，architecture §5.1b） */
export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}

function toBlob(canvas: ReferenceCanvas): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', REFERENCE_JPEG_QUALITY)
    } catch {
      resolve(null)
    }
  })
}

/** 正規化一個圖檔；不會 reject（所有失敗都回 ok: false） */
export async function normalizeReference(file: Blob, deps: NormalizeDeps = browserDeps): Promise<NormalizeResult> {
  if (!looksLikeImage(file)) return fail('NOT_IMAGE')
  let image: DecodedImage
  try {
    image = await deps.decode(file)
  } catch {
    return fail(file.type === '' ? 'NOT_IMAGE' : 'DECODE_FAILED')
  }
  try {
    const size = fitSize(image.width, image.height)
    if (size === null) return fail('DECODE_FAILED')
    const canvas = deps.createCanvas()
    canvas.width = size.width
    canvas.height = size.height
    const ctx = canvas.getContext('2d')
    if (ctx === null) return fail('ENCODE_FAILED')
    ctx.fillStyle = REFERENCE_MATTE
    ctx.fillRect(0, 0, size.width, size.height)
    ctx.drawImage(image.source, 0, 0, size.width, size.height)
    const blob = await toBlob(canvas)
    if (blob === null) return fail('ENCODE_FAILED')
    const jpeg = await blob.arrayBuffer()
    if (!isJpeg(new Uint8Array(jpeg))) return fail('ENCODE_FAILED')
    if (jpeg.byteLength > MAX_REFERENCE_BYTES) return fail('TOO_LARGE')
    return { ok: true, jpeg, width: size.width, height: size.height }
  } catch {
    return fail('ENCODE_FAILED')
  } finally {
    image.release?.()
  }
}

/** 瀏覽器的解碼：<img> 載入 object URL（gif 畫的是第一幀）；用完 revoke */
function decodeWithImage(file: Blob): Promise<DecodedImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    const release = () => URL.revokeObjectURL(url)
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight, source: img, release })
    img.onerror = () => {
      release()
      reject(new Error('圖片解碼失敗'))
    }
    img.src = url
  })
}

/** 預設：瀏覽器的 Image 與 <canvas>（不掛進 DOM） */
export const browserDeps: NormalizeDeps = {
  decode: decodeWithImage,
  createCanvas: () => document.createElement('canvas'),
}
