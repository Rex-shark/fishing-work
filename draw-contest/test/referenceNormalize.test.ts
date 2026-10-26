// 像不像比賽的參考圖正規化（Epic 20；plan/contest-mimic.md 決策 2；features/reference/normalize）：
// 以假 Image（decode）與假 canvas 驗證：長邊縮到 ≤ 1280、不放大、白底、JPEG 0.9、非圖片、解碼失敗、轉檔失敗、超過 MAX_REFERENCE_BYTES。
import { describe, expect, it, vi } from 'vitest'
import { MAX_REFERENCE_BYTES } from '@fishing-work/shared/draw-contest'
import {
  NORMALIZE_MESSAGES,
  REFERENCE_JPEG_QUALITY,
  REFERENCE_MATTE,
  REFERENCE_MAX_SIDE,
  fitSize,
  isJpeg,
  looksLikeImage,
  normalizeReference,
  type DecodedImage,
  type NormalizeDeps,
  type ReferenceCanvas,
  type ReferenceContext,
} from '../src/features/reference/normalize'

const JPEG_MAGIC = [0xff, 0xd8, 0xff, 0xe0]
const jpegBlob = (size = 64) => {
  const bytes = new Uint8Array(size)
  bytes.set(JPEG_MAGIC)
  return new Blob([bytes], { type: 'image/jpeg' })
}

interface FakeCanvas extends ReferenceCanvas {
  ctx: ReferenceContext & { calls: unknown[][] }
  toBlobArgs: unknown[]
}

/** 假 canvas：記下 2D 呼叫與 toBlob 的參數，toBlob 回 out（預設一張小 JPEG） */
function fakeCanvas(out: Blob | null = jpegBlob(), withContext = true): FakeCanvas {
  const calls: unknown[][] = []
  const ctx = {
    calls,
    fillStyle: '' as CanvasRenderingContext2D['fillStyle'],
    fillRect: (...args: unknown[]) => void calls.push(['fillRect', ctx.fillStyle, ...args]),
    drawImage: (...args: unknown[]) => void calls.push(['drawImage', ...args]),
  } as unknown as FakeCanvas['ctx']
  const canvas: FakeCanvas = {
    width: 300,
    height: 150,
    ctx,
    toBlobArgs: [],
    getContext: () => (withContext ? ctx : null),
    toBlob(callback, type, quality) {
      canvas.toBlobArgs = [type, quality]
      callback(out)
    },
  }
  return canvas
}

const SOURCE = { fake: 'image' } as unknown as CanvasImageSource

function deps(width: number, height: number, canvas = fakeCanvas()) {
  const release = vi.fn()
  const decode = vi.fn((): Promise<DecodedImage> => Promise.resolve({ width, height, source: SOURCE, release }))
  const d: NormalizeDeps = { decode, createCanvas: () => canvas }
  return { deps: d, decode, release, canvas }
}

const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })

describe('fitSize：長邊 ≤ 1280、等比、不放大', () => {
  it('橫圖、直圖縮到長邊 1280；剛好 1280 與較小的不動', () => {
    expect(REFERENCE_MAX_SIDE).toBe(1280)
    expect(fitSize(2560, 1440)).toEqual({ width: 1280, height: 720 })
    expect(fitSize(1000, 3000)).toEqual({ width: 427, height: 1280 })
    expect(fitSize(1280, 1280)).toEqual({ width: 1280, height: 1280 })
    expect(fitSize(800, 600)).toEqual({ width: 800, height: 600 })
    expect(fitSize(4000, 1)).toEqual({ width: 1280, height: 1 })
  })

  it('不合法的寬高回 null', () => {
    for (const [w, h] of [[0, 10], [10, 0], [-1, 5], [Number.NaN, 5], [Number.POSITIVE_INFINITY, 5]]) expect(fitSize(w!, h!)).toBeNull()
  })
})

describe('looksLikeImage／isJpeg', () => {
  it('image/* 與沒有型別（交給解碼）算圖片；其餘不是', () => {
    expect(looksLikeImage({ type: 'image/png' })).toBe(true)
    expect(looksLikeImage({ type: 'image/webp' })).toBe(true)
    expect(looksLikeImage({ type: '' })).toBe(true)
    expect(looksLikeImage({ type: 'text/plain' })).toBe(false)
    expect(looksLikeImage({ type: 'application/pdf' })).toBe(false)
  })

  it('JPEG magic FF D8 FF', () => {
    expect(isJpeg(new Uint8Array(JPEG_MAGIC))).toBe(true)
    expect(isJpeg(new Uint8Array([0x89, 0x50, 0x4e]))).toBe(false)
    expect(isJpeg(new Uint8Array([0xff, 0xd8]))).toBe(false)
  })
})

describe('normalizeReference', () => {
  it('大圖：canvas 縮到 1280×720，先鋪白底再畫圖，toBlob 為 image/jpeg、品質 0.9；回 JPEG bytes；用完 release', async () => {
    const t = deps(2560, 1440)
    const r = await normalizeReference(png, t.deps)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect([r.width, r.height]).toEqual([1280, 720])
    expect([t.canvas.width, t.canvas.height]).toEqual([1280, 720])
    expect(t.canvas.ctx.calls).toEqual([
      ['fillRect', REFERENCE_MATTE, 0, 0, 1280, 720],
      ['drawImage', SOURCE, 0, 0, 1280, 720],
    ])
    expect(t.canvas.toBlobArgs).toEqual(['image/jpeg', REFERENCE_JPEG_QUALITY])
    expect(REFERENCE_JPEG_QUALITY).toBe(0.9)
    expect(isJpeg(new Uint8Array(r.jpeg))).toBe(true)
    expect(r.jpeg.byteLength).toBe(64)
    expect(t.decode).toHaveBeenCalledWith(png)
    expect(t.release).toHaveBeenCalledTimes(1)
  })

  it('小圖不放大（800×600 照原尺寸）', async () => {
    const t = deps(800, 600)
    const r = await normalizeReference(png, t.deps)
    expect(r.ok && [r.width, r.height]).toEqual([800, 600])
    expect(t.canvas.ctx.calls[1]).toEqual(['drawImage', SOURCE, 0, 0, 800, 600])
  })

  it('不是圖片（有型別但不是 image/*）：不解碼，回 NOT_IMAGE', async () => {
    const t = deps(100, 100)
    const r = await normalizeReference(new Blob(['hello'], { type: 'text/plain' }), t.deps)
    expect(r).toEqual({ ok: false, error: 'NOT_IMAGE', message: NORMALIZE_MESSAGES.NOT_IMAGE })
    expect(t.decode).not.toHaveBeenCalled()
  })

  it('解碼失敗：圖片型別 → DECODE_FAILED；沒有型別 → NOT_IMAGE（多半根本不是圖）', async () => {
    const d: NormalizeDeps = { decode: () => Promise.reject(new Error('bad')), createCanvas: () => fakeCanvas() }
    expect(await normalizeReference(png, d)).toMatchObject({ ok: false, error: 'DECODE_FAILED' })
    expect(await normalizeReference(new Blob(['x']), d)).toMatchObject({ ok: false, error: 'NOT_IMAGE' })
  })

  it('寬高為 0（壞檔）→ DECODE_FAILED，仍 release', async () => {
    const t = deps(0, 0)
    expect(await normalizeReference(png, t.deps)).toMatchObject({ ok: false, error: 'DECODE_FAILED' })
    expect(t.release).toHaveBeenCalledTimes(1)
  })

  it('轉檔失敗：拿不到 2D context、toBlob 回 null、輸出不是 JPEG（瀏覽器不支援時會退回 PNG）→ ENCODE_FAILED', async () => {
    expect(await normalizeReference(png, deps(10, 10, fakeCanvas(jpegBlob(), false)).deps)).toMatchObject({ ok: false, error: 'ENCODE_FAILED' })
    expect(await normalizeReference(png, deps(10, 10, fakeCanvas(null)).deps)).toMatchObject({ ok: false, error: 'ENCODE_FAILED' })
    expect(await normalizeReference(png, deps(10, 10, fakeCanvas(png)).deps)).toMatchObject({ ok: false, error: 'ENCODE_FAILED' })
  })

  it('輸出超過 MAX_REFERENCE_BYTES → TOO_LARGE；剛好上限可以', async () => {
    const over = await normalizeReference(png, deps(1280, 720, fakeCanvas(jpegBlob(MAX_REFERENCE_BYTES + 1))).deps)
    expect(over).toEqual({ ok: false, error: 'TOO_LARGE', message: NORMALIZE_MESSAGES.TOO_LARGE })
    const exact = await normalizeReference(png, deps(1280, 720, fakeCanvas(jpegBlob(MAX_REFERENCE_BYTES))).deps)
    expect(exact.ok).toBe(true)
  })

  it('錯誤訊息是繁體中文、可直接顯示', () => {
    expect(Object.values(NORMALIZE_MESSAGES).every((m) => m.length > 0 && !/[a-z]{4,}/.test(m.replace(/PNG|JPEG|WebP|GIF/g, '')))).toBe(true)
  })
})
