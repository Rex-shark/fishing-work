import { describe, expect, it } from 'vitest'
import { BRUSH_DEFAULT, BRUSH_MAX, BRUSH_MIN, COLOR_PATTERN, PALETTE } from '@fishing-work/shared'
import {
  HUE_GRADIENT,
  HUE_KEYS,
  HUE_MAX,
  PALETTE_NAMES,
  PREVIEW_MAX_PX,
  PREVIEW_MIN_PX,
  SIZE_KEYS,
  hueToHex,
  normalizeBrushSize,
  normalizeColor,
  previewDiameter,
  sliderKeyValue,
  swatchLabel,
  valueFromPointer,
  valueRatio,
} from '../src/features/canvas/brush'

describe('hueToHex：hsl(h, 100%, 50%) → 大寫 #RRGGBB', () => {
  it.each<[number, string]>([
    [0, '#FF0000'],
    [30, '#FF8000'],
    [60, '#FFFF00'],
    [120, '#00FF00'],
    [180, '#00FFFF'],
    [240, '#0000FF'],
    [300, '#FF00FF'],
    [359, '#FF0004'],
  ])('%i° → %s', (h, hex) => {
    expect(hueToHex(h)).toBe(hex)
  })

  it('360° 與 0° 同色；負角度與超過 360° 會繞回', () => {
    expect(hueToHex(360)).toBe('#FF0000')
    expect(hueToHex(-120)).toBe(hueToHex(240))
    expect(hueToHex(480)).toBe(hueToHex(120))
  })

  it('非有限數視為 0°', () => {
    expect(hueToHex(Number.NaN)).toBe('#FF0000')
    expect(hueToHex(Number.POSITIVE_INFINITY)).toBe('#FF0000')
  })

  it('0..359 每一度的輸出都符合 COLOR_PATTERN 且為大寫（server 會接受）', () => {
    for (let h = 0; h <= HUE_MAX; h++) {
      const hex = hueToHex(h)
      expect(COLOR_PATTERN.test(hex)).toBe(true)
      expect(hex).toBe(hex.toUpperCase())
    }
  })
})

describe('HUE_GRADIENT', () => {
  it('0..360 每 60° 一個色標、不含 # 色碼', () => {
    expect(HUE_GRADIENT).toBe(
      'linear-gradient(to right, hsl(0, 100%, 50%), hsl(60, 100%, 50%), hsl(120, 100%, 50%), hsl(180, 100%, 50%), hsl(240, 100%, 50%), hsl(300, 100%, 50%), hsl(360, 100%, 50%))',
    )
    expect(HUE_GRADIENT).not.toMatch(/#/)
  })
})

describe('valueFromPointer：軌道位置 → 整數值', () => {
  it('兩端與中點', () => {
    expect(valueFromPointer(100, 100, 80, BRUSH_MIN, BRUSH_MAX)).toBe(1)
    expect(valueFromPointer(180, 100, 80, BRUSH_MIN, BRUSH_MAX)).toBe(64)
    expect(valueFromPointer(140, 100, 80, BRUSH_MIN, BRUSH_MAX)).toBe(33) // 1 + 0.5 × 63 = 32.5 → 33
  })

  it('拖出軌道外 clamp 到兩端', () => {
    expect(valueFromPointer(0, 100, 80, BRUSH_MIN, BRUSH_MAX)).toBe(BRUSH_MIN)
    expect(valueFromPointer(9999, 100, 80, BRUSH_MIN, BRUSH_MAX)).toBe(BRUSH_MAX)
  })

  it('色相條 96px：最右端為 359°（不回到 0°）', () => {
    expect(valueFromPointer(96, 0, 96, 0, HUE_MAX)).toBe(HUE_MAX)
    expect(valueFromPointer(32, 0, 96, 0, HUE_MAX)).toBe(120) // 359 / 3 = 119.67 → 120
  })

  it('寬度為 0（尚未排版）回傳下限，不產生 NaN', () => {
    expect(valueFromPointer(50, 0, 0, BRUSH_MIN, BRUSH_MAX)).toBe(BRUSH_MIN)
  })
})

describe('valueRatio', () => {
  it('範圍內比例、超出 clamp', () => {
    expect(valueRatio(1, 1, 64)).toBe(0)
    expect(valueRatio(64, 1, 64)).toBe(1)
    expect(valueRatio(100, 1, 64)).toBe(1)
    expect(valueRatio(5, 5, 5)).toBe(0)
  })
})

describe('sliderKeyValue：鍵盤操作', () => {
  it('粗細：←/→ 每次 1、Shift 每次 8（DESIGN §6）；↑/↓ 同 →/←', () => {
    expect(sliderKeyValue('ArrowRight', false, 4, SIZE_KEYS)).toBe(5)
    expect(sliderKeyValue('ArrowLeft', false, 4, SIZE_KEYS)).toBe(3)
    expect(sliderKeyValue('ArrowUp', false, 4, SIZE_KEYS)).toBe(5)
    expect(sliderKeyValue('ArrowDown', false, 4, SIZE_KEYS)).toBe(3)
    expect(sliderKeyValue('ArrowRight', true, 4, SIZE_KEYS)).toBe(12)
    expect(sliderKeyValue('ArrowLeft', true, 12, SIZE_KEYS)).toBe(4)
  })

  it('PageUp／PageDown 大步進、Home／End 到兩端', () => {
    expect(sliderKeyValue('PageUp', false, 4, SIZE_KEYS)).toBe(12)
    expect(sliderKeyValue('PageDown', false, 12, SIZE_KEYS)).toBe(4)
    expect(sliderKeyValue('Home', false, 30, SIZE_KEYS)).toBe(BRUSH_MIN)
    expect(sliderKeyValue('End', false, 30, SIZE_KEYS)).toBe(BRUSH_MAX)
  })

  it('不超出範圍', () => {
    expect(sliderKeyValue('ArrowLeft', false, BRUSH_MIN, SIZE_KEYS)).toBe(BRUSH_MIN)
    expect(sliderKeyValue('ArrowRight', true, 60, SIZE_KEYS)).toBe(BRUSH_MAX)
    expect(sliderKeyValue('PageDown', false, 3, SIZE_KEYS)).toBe(BRUSH_MIN)
  })

  it('色相：←/→ 每次 5°，上限 359°', () => {
    expect(sliderKeyValue('ArrowRight', false, 0, HUE_KEYS)).toBe(5)
    expect(sliderKeyValue('ArrowLeft', false, 0, HUE_KEYS)).toBe(0)
    expect(sliderKeyValue('ArrowRight', false, 357, HUE_KEYS)).toBe(HUE_MAX)
    expect(sliderKeyValue('End', false, 0, HUE_KEYS)).toBe(HUE_MAX)
  })

  it('其他按鍵回 null（不攔截 Tab、Enter 等）', () => {
    expect(sliderKeyValue('Tab', false, 4, SIZE_KEYS)).toBeNull()
    expect(sliderKeyValue('Enter', false, 4, SIZE_KEYS)).toBeNull()
    expect(sliderKeyValue('a', false, 4, SIZE_KEYS)).toBeNull()
  })
})

describe('送出前正規化', () => {
  it('粗細取整數並 clamp；非有限數退回預設', () => {
    expect(normalizeBrushSize(4)).toBe(4)
    expect(normalizeBrushSize(12.4)).toBe(12)
    expect(normalizeBrushSize(0)).toBe(BRUSH_MIN)
    expect(normalizeBrushSize(65)).toBe(BRUSH_MAX)
    expect(normalizeBrushSize(Number.NaN)).toBe(BRUSH_DEFAULT)
  })

  it('色碼轉大寫；不合法退回 PALETTE[0]', () => {
    expect(normalizeColor('#ff8c00')).toBe('#FF8C00')
    expect(normalizeColor('#FF8C00')).toBe('#FF8C00')
    expect(normalizeColor('#fff')).toBe(PALETTE[0])
    expect(normalizeColor('red')).toBe(PALETTE[0])
  })
})

describe('previewDiameter：預覽圓點直徑有上限', () => {
  it(`1 → ${PREVIEW_MIN_PX}px、64 → ${PREVIEW_MAX_PX}px，隨粗細單調遞增`, () => {
    expect(previewDiameter(BRUSH_MIN)).toBe(PREVIEW_MIN_PX)
    expect(previewDiameter(BRUSH_MAX)).toBe(PREVIEW_MAX_PX)
    let prev = 0
    for (let s = BRUSH_MIN; s <= BRUSH_MAX; s++) {
      const d = previewDiameter(s)
      expect(d).toBeGreaterThanOrEqual(prev)
      expect(d).toBeLessThanOrEqual(PREVIEW_MAX_PX)
      prev = d
    }
  })
})

describe('swatchLabel：色塊提示', () => {
  it('色碼＋色名，8 色皆有名稱', () => {
    expect(PALETTE_NAMES).toHaveLength(PALETTE.length)
    expect(swatchLabel(PALETTE[3], 3)).toBe('顏色 #FF8C00（橘）')
    expect(swatchLabel('#123456', 99)).toBe('顏色 #123456')
  })
})
