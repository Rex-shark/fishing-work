// 畫布底色推導（Epic 7 決策 3；architecture §6）：canvasBackground(ops) = 最後一個 background op 的色，否則 CANVAS_BACKGROUND
import { describe, expect, it } from 'vitest'
import { CANVAS_BACKGROUND, PALETTE } from '@fishing-work/shared/draw-contest'
import type { DrawOp } from '../src/features/canvas/ops'
import { canvasBackground } from '../src/features/canvas/canvasBackground'
import { compactOps } from '../src/features/canvas/render'

const begin = (strokeId: string): DrawOp => ({ type: 'begin', strokeId, tool: 'pen', color: PALETTE[1], size: 4, point: { x: 0, y: 0 } })
const end = (strokeId: string): DrawOp => ({ type: 'end', strokeId })
const bg = (color: string): DrawOp => ({ type: 'background', color })

describe('canvasBackground(ops)', () => {
  it('沒有 background op（新回合、只有筆跡）→ CANVAS_BACKGROUND', () => {
    expect(canvasBackground([])).toBe(CANVAS_BACKGROUND)
    expect(canvasBackground([begin('a'), end('a')])).toBe(CANVAS_BACKGROUND)
  })

  it('取最後一個 background 的色，與它在筆跡之前或之後無關', () => {
    expect(canvasBackground([bg('#FFECEA'), begin('a'), end('a')])).toBe('#FFECEA')
    expect(canvasBackground([begin('a'), end('a'), bg('#FFECEA')])).toBe('#FFECEA')
    expect(canvasBackground([bg('#FFECEA'), begin('a'), bg('#000000')])).toBe('#000000')
  })

  it('搭配正規化：clear 後背景仍在、undo 不影響', () => {
    expect(canvasBackground(compactOps([bg('#FFECEA'), begin('a'), end('a'), { type: 'clear' }]))).toBe('#FFECEA')
    expect(canvasBackground(compactOps([begin('a'), end('a'), bg('#FFECEA'), { type: 'undo', strokeId: 'a' }]))).toBe('#FFECEA')
  })
})
