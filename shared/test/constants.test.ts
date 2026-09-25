// 畫具常數（spec/architecture.md §4：BRUSH_MIN / BRUSH_MAX、PALETTE 預設色塊、COLOR_PATTERN、CANVAS_BACKGROUND）
import { describe, expect, it } from 'vitest';
import { BRUSH_DEFAULT, BRUSH_MAX, BRUSH_MIN, CANVAS_BACKGROUND, COLOR_PATTERN, PALETTE } from '../src/draw-guess/constants';

describe('粗細範圍', () => {
  it('1..64 的整數，預設 4 在範圍內', () => {
    expect(BRUSH_MIN).toBe(1);
    expect(BRUSH_MAX).toBe(64);
    expect(BRUSH_DEFAULT).toBe(4);
    for (const v of [BRUSH_MIN, BRUSH_MAX, BRUSH_DEFAULT]) expect(Number.isInteger(v)).toBe(true);
    expect(BRUSH_DEFAULT).toBeGreaterThanOrEqual(BRUSH_MIN);
    expect(BRUSH_DEFAULT).toBeLessThanOrEqual(BRUSH_MAX);
  });
});

describe('COLOR_PATTERN', () => {
  it.each(['#000000', '#FFFFFF', '#ff8c00', '#aBcDeF', '#123456'])('合法：%s', (c) => {
    expect(COLOR_PATTERN.test(c)).toBe(true);
  });

  it.each(['#fff', 'FFFFFF', '#FFFFFF80', '#GGGGGG', ' #FFFFFF', '#FFFFFF\n', 'red', ''])('不合法：%j', (c) => {
    expect(COLOR_PATTERN.test(c)).toBe(false);
  });

  it('PALETTE 8 色皆合法且為大寫 6 位', () => {
    expect(PALETTE).toHaveLength(8);
    for (const c of PALETTE) {
      expect(COLOR_PATTERN.test(c)).toBe(true);
      expect(c).toBe(c.toUpperCase());
    }
  });
});

describe('畫布統一（Epic 3 決策 6）', () => {
  it('CANVAS_BACKGROUND 為 #1E1E1E（所有主題一致）', () => {
    expect(CANVAS_BACKGROUND).toBe('#1E1E1E');
    expect(COLOR_PATTERN.test(CANVAS_BACKGROUND)).toBe(true);
  });

  it('PALETTE 預設色（索引 0）為白色，且與畫布底色不同', () => {
    expect(PALETTE[0]).toBe('#FFFFFF');
    expect(PALETTE).not.toContain(CANVAS_BACKGROUND);
  });
});
