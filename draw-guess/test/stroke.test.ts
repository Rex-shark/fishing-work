import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_POINTS_PER_MOVE, STROKE_ID_MAX } from '@fishing-work/shared'
import { chunkPoints, newStrokeId, normalizePoint } from '../src/features/canvas/stroke'

const rect = { left: 100, top: 50, width: 640, height: 360 }

describe('normalizePoint', () => {
  it('依 bounding rect 換算為 0..1', () => {
    expect(normalizePoint(100, 50, rect)).toEqual({ x: 0, y: 0 })
    expect(normalizePoint(420, 230, rect)).toEqual({ x: 0.5, y: 0.5 })
    expect(normalizePoint(740, 410, rect)).toEqual({ x: 1, y: 1 })
  })

  it('拖出畫布時 clamp 到邊界', () => {
    expect(normalizePoint(0, 1000, rect)).toEqual({ x: 0, y: 1 })
    expect(normalizePoint(9999, -9999, rect)).toEqual({ x: 1, y: 0 })
  })

  it('小數取 4 位', () => {
    expect(normalizePoint(100 + 640 / 3, 50, rect).x).toBe(0.3333)
  })

  it('尺寸為 0（尚未排版）時回 0，不產生 NaN', () => {
    expect(normalizePoint(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 })
  })
})

describe('chunkPoints', () => {
  const pts = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i / 1000, y: 0 }))

  it(`每則最多 MAX_POINTS_PER_MOVE（${MAX_POINTS_PER_MOVE}）點，順序不變`, () => {
    const chunks = chunkPoints(pts(150))
    expect(chunks.map((c) => c.length)).toEqual([64, 64, 22])
    expect(chunks.flat()).toEqual(pts(150))
  })

  it('剛好上限為一則；空陣列為零則', () => {
    expect(chunkPoints(pts(MAX_POINTS_PER_MOVE))).toHaveLength(1)
    expect(chunkPoints([])).toEqual([])
  })
})

describe('newStrokeId', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('有 crypto.randomUUID 時使用之；長度 ≤ STROKE_ID_MAX、不重複', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newStrokeId()))
    expect(ids.size).toBe(1000)
    for (const id of ids) expect(id.length).toBeLessThanOrEqual(STROKE_ID_MAX)
  })

  it('非 secure context（沒有 randomUUID，例如區網 http）時退回自產 id，仍不重複', () => {
    vi.stubGlobal('crypto', {})
    const ids = new Set(Array.from({ length: 1000 }, () => newStrokeId()))
    expect(ids.size).toBe(1000)
    for (const id of ids) {
      expect(id.length).toBeGreaterThan(0)
      expect(id.length).toBeLessThanOrEqual(STROKE_ID_MAX)
    }
  })
})
