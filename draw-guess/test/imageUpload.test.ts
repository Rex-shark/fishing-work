import { describe, expect, it } from 'vitest'
import { IMAGE_MAX_EDGE, MAX_IMAGE_BYTES } from '@fishing-work/shared'
import {
  IMAGE_MAX_DIMENSION,
  ImagePrepareError,
  afterEncode,
  dimensionsAcceptable,
  fitWithin,
  imageErrorText,
  initialOutput,
  looksLikeImageFile,
  needsWhiteBackground,
  type ImagePrepareErrorCode,
} from '../src/features/chat/imageUpload'

describe('fitWithin：長邊 ≤ IMAGE_MAX_EDGE 等比縮圖', () => {
  it('3000×2000 → 1280×853', () => {
    expect(fitWithin(3000, 2000)).toEqual({ width: IMAGE_MAX_EDGE, height: 853 })
  })

  it('直式 2000×3000 → 853×1280', () => {
    expect(fitWithin(2000, 3000)).toEqual({ width: 853, height: IMAGE_MAX_EDGE })
  })

  it('剛好等於上限或更小：不放大、原樣', () => {
    expect(fitWithin(1280, 720)).toEqual({ width: 1280, height: 720 })
    expect(fitWithin(1, 1)).toEqual({ width: 1, height: 1 })
    expect(fitWithin(300, 200)).toEqual({ width: 300, height: 200 })
  })

  it('極端長寬比：短邊至少 1', () => {
    expect(fitWithin(100000, 10)).toEqual({ width: IMAGE_MAX_EDGE, height: 1 })
  })

  it('結果一律為整數且長邊不超過上限', () => {
    for (const [w, h] of [
      [1281, 1281],
      [4000, 3001],
      [2561, 7],
    ] as const) {
      const r = fitWithin(w, h)
      expect(Number.isInteger(r.width) && Number.isInteger(r.height)).toBe(true)
      expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(IMAGE_MAX_EDGE)
    }
  })
})

describe('輸出格式（決策 3）：PNG 先 PNG、超限才白底 JPEG；JPEG → JPEG；GIF／WebP 原樣', () => {
  it('PNG 小於上限 → 以 PNG 輸出（保留透明，不填白）', () => {
    expect(initialOutput('image/png')).toBe('image/png')
    expect(afterEncode('image/png', MAX_IMAGE_BYTES)).toBe('accept')
    expect(needsWhiteBackground('image/png')).toBe(false)
  })

  it('PNG 超限 → 改填白底轉 JPEG；JPEG 在上限內就接受', () => {
    expect(afterEncode('image/png', MAX_IMAGE_BYTES + 1)).toBe('fallback-jpeg')
    expect(needsWhiteBackground('image/jpeg')).toBe(true)
    expect(afterEncode('image/jpeg', 500_000)).toBe('accept')
  })

  it('PNG 轉 JPEG 後仍超限 → 拒絕', () => {
    expect(afterEncode('image/jpeg', MAX_IMAGE_BYTES + 1)).toBe('reject')
  })

  it('JPEG 來源 → JPEG（超限直接拒，不再退路）', () => {
    expect(initialOutput('image/jpeg')).toBe('image/jpeg')
    expect(afterEncode('image/jpeg', 1)).toBe('accept')
    expect(afterEncode('image/jpeg', MAX_IMAGE_BYTES + 1)).toBe('reject')
  })

  it('GIF／WebP → 原樣（不重編碼），超限就拒', () => {
    expect(initialOutput('image/gif')).toBe('original')
    expect(initialOutput('image/webp')).toBe('original')
    expect(afterEncode('original', MAX_IMAGE_BYTES)).toBe('accept')
    expect(afterEncode('original', MAX_IMAGE_BYTES + 1)).toBe('reject')
  })

  it('大小 0（編碼失敗或空檔）一律拒絕，PNG 也不走 JPEG 退路', () => {
    expect(afterEncode('image/png', 0)).toBe('reject')
    expect(afterEncode('image/jpeg', 0)).toBe('reject')
    expect(afterEncode('original', 0)).toBe('reject')
  })
})

describe('dimensionsAcceptable：GIF／WebP 原樣送出時寬高須為 1..4096 整數（architecture §5）', () => {
  it.each([
    [1, 1, true],
    [IMAGE_MAX_DIMENSION, IMAGE_MAX_DIMENSION, true],
    [IMAGE_MAX_DIMENSION + 1, 10, false],
    [10, 0, false],
    [10.5, 10, false],
  ])('%s×%s → %s', (w, h, expected) => {
    expect(dimensionsAcceptable(w, h)).toBe(expected)
  })
})

describe('looksLikeImageFile：拖放預檢', () => {
  it.each([
    ['image/png', true],
    ['image/svg+xml', true], // 交給 magic bytes 擋
    ['', true], // 瀏覽器不認得副檔名時為空字串，交給 magic bytes
    ['text/plain', false],
    ['application/pdf', false],
  ])('%j → %s', (type, expected) => {
    expect(looksLikeImageFile(type)).toBe(expected)
  })
})

describe('imageErrorText／ImagePrepareError：繁中錯誤訊息', () => {
  const codes: ImagePrepareErrorCode[] = [
    'NOT_IMAGE',
    'SOURCE_TOO_LARGE',
    'DECODE_FAILED',
    'ANIMATED_TOO_LARGE',
    'DIMENSION_TOO_LARGE',
    'ENCODE_FAILED',
    'STILL_TOO_LARGE',
  ]

  it('每個錯誤碼都有非空訊息', () => {
    for (const code of codes) expect(imageErrorText(code).length).toBeGreaterThan(0)
  })

  it('非圖片、超限的文字（上限由 MAX_IMAGE_BYTES 產生，不寫死）', () => {
    const limit = `${MAX_IMAGE_BYTES / 1024 / 1024} MB`
    expect(imageErrorText('NOT_IMAGE')).toBe('只能傳送 PNG、JPEG、GIF 或 WebP 圖片')
    expect(imageErrorText('ANIMATED_TOO_LARGE')).toBe(`GIF／WebP 不會壓縮，檔案需在 ${limit} 以內`)
    expect(imageErrorText('STILL_TOO_LARGE')).toBe(`圖片壓縮後仍超過 ${limit}，請換一張較小的圖片`)
  })

  it('ImagePrepareError 帶 code，message 即顯示文字', () => {
    const e = new ImagePrepareError('NOT_IMAGE')
    expect(e).toBeInstanceOf(Error)
    expect(e.code).toBe('NOT_IMAGE')
    expect(e.message).toBe(imageErrorText('NOT_IMAGE'))
  })
})
