// 聊天室圖片：檔案 → 送出前的縮圖與格式決定（plan/chat-image.md 決策 3；architecture §5「圖片訊息」、§7）。
// - PNG：長邊 ≤ IMAGE_MAX_EDGE 後先以 PNG 輸出（保留透明）；超過 MAX_IMAGE_BYTES 才填白底轉 JPEG 0.85
// - JPEG：縮圖後 JPEG 0.85（重編碼順便去掉 EXIF）
// - GIF／WebP：不重編碼（保留動畫），超限就拒
// 仍超過 MAX_IMAGE_BYTES 就拒。格式判定以檔頭 magic bytes 為準（與 server 相同的 sniffImageMime），不信任副檔名。
// 上半部是純函式（可單元測試）；prepareImage 用到 createImageBitmap 與 canvas，只在瀏覽器執行。
import { IMAGE_MAX_EDGE, MAX_IMAGE_BYTES, sniffImageMime, type ImageMime } from '@fishing-work/shared'

/** JPEG 輸出品質（決策 3） */
export const JPEG_QUALITY = 0.85

/** server 接受的寬高上限（architecture §5：寬高為 1..4096 的整數）；只影響不重編碼的 GIF／WebP */
export const IMAGE_MAX_DIMENSION = 4096

/**
 * 來源檔大小的本機防呆（不在規格內，僅客戶端）：避免把數十 MB 的原圖整個解碼卡住分頁。
 * PNG／JPEG 會先縮圖，所以來源可以遠大於 MAX_IMAGE_BYTES。
 */
export const SOURCE_MAX_BYTES = 32 * 1024 * 1024

/** 檔頭判定需要的位元組數（WebP 的 "WEBP" 在 offset 8..11） */
export const SNIFF_BYTES = 12

export type ImagePrepareErrorCode =
  | 'NOT_IMAGE'
  | 'SOURCE_TOO_LARGE'
  | 'DECODE_FAILED'
  | 'ANIMATED_TOO_LARGE'
  | 'DIMENSION_TOO_LARGE'
  | 'ENCODE_FAILED'
  | 'STILL_TOO_LARGE'

const MB = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`

/** 本地錯誤提示文字（顯示在聊天輸入列上方，4 秒消失） */
export function imageErrorText(code: ImagePrepareErrorCode): string {
  switch (code) {
    case 'NOT_IMAGE':
      return '只能傳送 PNG、JPEG、GIF 或 WebP 圖片'
    case 'SOURCE_TOO_LARGE':
      return `檔案太大（上限 ${MB(SOURCE_MAX_BYTES)}）`
    case 'DECODE_FAILED':
      return '無法讀取這張圖片'
    case 'ANIMATED_TOO_LARGE':
      return `GIF／WebP 不會壓縮，檔案需在 ${MB(MAX_IMAGE_BYTES)} 以內`
    case 'DIMENSION_TOO_LARGE':
      return `GIF／WebP 尺寸需在 ${IMAGE_MAX_DIMENSION}×${IMAGE_MAX_DIMENSION} 以內`
    case 'ENCODE_FAILED':
      return '圖片轉檔失敗'
    case 'STILL_TOO_LARGE':
      return `圖片壓縮後仍超過 ${MB(MAX_IMAGE_BYTES)}，請換一張較小的圖片`
  }
}

/** prepareImage 失敗時丟出；message 為繁中、可直接顯示 */
export class ImagePrepareError extends Error {
  readonly code: ImagePrepareErrorCode
  constructor(code: ImagePrepareErrorCode) {
    super(imageErrorText(code))
    this.name = 'ImagePrepareError'
    this.code = code
  }
}

/** 等比縮到長邊 ≤ maxEdge（不放大）；結果為 ≥ 1 的整數 */
export function fitWithin(width: number, height: number, maxEdge: number = IMAGE_MAX_EDGE): { width: number; height: number } {
  const long = Math.max(width, height)
  if (long <= maxEdge) return { width, height }
  const scale = maxEdge / long
  return {
    width: Math.max(1, Math.min(maxEdge, Math.round(width * scale))),
    height: Math.max(1, Math.min(maxEdge, Math.round(height * scale))),
  }
}

/** 第一次輸出格式：PNG → PNG（保留透明）、JPEG → JPEG、GIF／WebP → 原樣（不重編碼） */
export type EncodeFormat = 'image/png' | 'image/jpeg'
export function initialOutput(mime: ImageMime): EncodeFormat | 'original' {
  switch (mime) {
    case 'image/png':
      return 'image/png'
    case 'image/jpeg':
      return 'image/jpeg'
    case 'image/gif':
    case 'image/webp':
      return 'original'
  }
}

/**
 * 編碼完之後怎麼辦：
 * - 大小在 1..MAX_IMAGE_BYTES → 接受
 * - PNG 輸出超限 → 改填白底轉 JPEG（`fallback-jpeg`）
 * - JPEG 輸出或原樣檔超限 → 拒絕
 */
export type EncodeVerdict = 'accept' | 'fallback-jpeg' | 'reject'
export function afterEncode(format: EncodeFormat | 'original', bytes: number, max: number = MAX_IMAGE_BYTES): EncodeVerdict {
  if (bytes > 0 && bytes <= max) return 'accept'
  return format === 'image/png' && bytes > max ? 'fallback-jpeg' : 'reject'
}

/** 轉 JPEG 時要先填白底（canvas 透明轉 JPEG 會變黑；決策 3） */
export function needsWhiteBackground(format: EncodeFormat): boolean {
  return format === 'image/jpeg'
}

/** GIF／WebP 原樣送出時，寬高須是 server 接受的 1..IMAGE_MAX_DIMENSION 整數 */
export function dimensionsAcceptable(width: number, height: number): boolean {
  const ok = (n: number) => Number.isInteger(n) && n >= 1 && n <= IMAGE_MAX_DIMENSION
  return ok(width) && ok(height)
}

/** 拖放／貼上時的快速預檢：瀏覽器給的 type 若明確不是圖片就不用讀檔（空字串則交給 magic bytes 判斷） */
export function looksLikeImageFile(type: string): boolean {
  return type === '' || type.startsWith('image/')
}

// ─── 瀏覽器端（createImageBitmap + canvas）──────────────────────────

export interface PreparedImage {
  mime: ImageMime
  width: number
  height: number
  data: ArrayBuffer
}

async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file)
  } catch {
    throw new ImagePrepareError('DECODE_FAILED')
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, format: EncodeFormat): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob !== null ? resolve(blob) : reject(new ImagePrepareError('ENCODE_FAILED'))),
      format,
      format === 'image/jpeg' ? JPEG_QUALITY : undefined,
    )
  })
}

async function encode(bitmap: ImageBitmap, width: number, height: number, format: EncodeFormat): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new ImagePrepareError('ENCODE_FAILED')
  if (needsWhiteBackground(format)) {
    // 編碼用的底色（不是介面色）：截圖類多為白底，填白最自然（決策 3）
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, width, height)
  }
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, width, height)
  return canvasToBlob(canvas, format)
}

/**
 * 檔案 → 可送出的圖片（chat:image payload 去掉 id）。失敗丟 ImagePrepareError（message 為繁中）。
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!looksLikeImageFile(file.type)) throw new ImagePrepareError('NOT_IMAGE')
  const mime = sniffImageMime(new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer()))
  if (mime === null) throw new ImagePrepareError('NOT_IMAGE')

  if (initialOutput(mime) === 'original') {
    // GIF／WebP：不重編碼；先看大小再解碼取寬高（解碼只為了寬高，動畫取第一格即可）
    if (afterEncode('original', file.size) !== 'accept') throw new ImagePrepareError('ANIMATED_TOO_LARGE')
    const bitmap = await decode(file)
    const { width, height } = bitmap
    bitmap.close()
    if (!dimensionsAcceptable(width, height)) throw new ImagePrepareError('DIMENSION_TOO_LARGE')
    return { mime, width, height, data: await file.arrayBuffer() }
  }

  if (file.size > SOURCE_MAX_BYTES) throw new ImagePrepareError('SOURCE_TOO_LARGE')
  const bitmap = await decode(file)
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height)
    let format: EncodeFormat = initialOutput(mime) === 'image/png' ? 'image/png' : 'image/jpeg'
    let blob = await encode(bitmap, width, height, format)
    const verdict = afterEncode(format, blob.size)
    if (verdict === 'fallback-jpeg') {
      format = 'image/jpeg'
      blob = await encode(bitmap, width, height, format)
      if (afterEncode(format, blob.size) !== 'accept') throw new ImagePrepareError('STILL_TOO_LARGE')
    } else if (verdict === 'reject') {
      throw new ImagePrepareError('STILL_TOO_LARGE')
    }
    return { mime: format, width, height, data: await blob.arrayBuffer() }
  } finally {
    bitmap.close()
  }
}
