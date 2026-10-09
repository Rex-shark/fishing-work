import { describe, expect, it } from 'vitest'
import { BRUSH_DEFAULT, BRUSH_MAX, BRUSH_MIN, COLOR_PATTERN, PALETTE } from '@fishing-work/shared/draw-contest'
import {
  HUE_GRADIENT,
  HUE_KEYS,
  HUE_MAX,
  PALETTE_NAMES,
  PREVIEW_MAX_PX,
  PREVIEW_MIN_PX,
  SIZE_KEYS,
  SV_MAX,
  backgroundLabel,
  backgroundOp,
  colorButtonLabel,
  hexToHsv,
  hsvToHex,
  hueToHex,
  normalizeBrushSize,
  normalizeColor,
  previewDiameter,
  sliderKeyValue,
  svFromPointer,
  svKeyValue,
  svLabel,
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
  it('色碼＋色名，10 色皆有名稱', () => {
    expect(PALETTE_NAMES).toHaveLength(PALETTE.length)
    expect(swatchLabel(PALETTE[5], 5)).toBe('顏色 #FF8C00（橘）')
    expect(swatchLabel('#123456', 99)).toBe('顏色 #123456')
  })

  it('Epic 7：黑與膚色緊接白', () => {
    expect(swatchLabel(PALETTE[1], 1)).toBe('顏色 #000000（黑）')
    expect(swatchLabel(PALETTE[2], 2)).toBe('顏色 #FFECEA（膚色）')
    expect(PALETTE_NAMES).toEqual(['白', '黑', '膚色', '灰', '紅', '橘', '黃', '綠', '藍', '紫'])
  })
})

describe('背景色按鈕（Epic 7）', () => {
  it('工具提示：「把背景設為目前顏色 #XXXXXX」，色碼大寫', () => {
    expect(backgroundLabel('#ffecea')).toBe('把背景設為目前顏色 #FFECEA')
    expect(backgroundLabel(PALETTE[1])).toBe('把背景設為目前顏色 #000000')
  })

  it('送出的 op：background＋目前筆色（大寫；不合法退回預設色）', () => {
    expect(backgroundOp('#ff8c00')).toEqual({ type: 'background', color: '#FF8C00' })
    expect(backgroundOp('red')).toEqual({ type: 'background', color: PALETTE[0] })
    expect(COLOR_PATTERN.test(backgroundOp('#abcdef').color)).toBe(true)
  })
})

/** 兩個 #RRGGBB 各 channel 差的最大值（0..255） */
function maxChannelDiff(a: string, b: string): number {
  let d = 0
  for (const i of [1, 3, 5]) d = Math.max(d, Math.abs(Number.parseInt(a.slice(i, i + 2), 16) - Number.parseInt(b.slice(i, i + 2), 16)))
  return d
}

/** 浮點參考值（不取整）：CSS Color 4 hsvToRgb，回傳 0..255 的三個 channel */
function hsvReference(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return (v / 100 - (v / 100) * (s / 100) * Math.max(0, Math.min(k, 4 - k, 1))) * 255
  }
  return [f(5), f(3), f(1)]
}

describe('hsvToHex：HSV → 大寫 #RRGGBB（Epic 11 決策 3）', () => {
  it.each<[number, number, number, string]>([
    [0, 0, 100, '#FFFFFF'],
    [0, 0, 0, '#000000'],
    [200, 100, 0, '#000000'],
    [0, 100, 100, '#FF0000'],
    [120, 100, 100, '#00FF00'],
    [240, 100, 100, '#0000FF'],
    [60, 100, 100, '#FFFF00'],
    [300, 100, 50, '#800080'],
    [0, 0, 50, '#808080'],
  ])('(%i, %i, %i) → %s', (h, s, v, hex) => {
    expect(hsvToHex(h, s, v)).toBe(hex)
  })

  it('sat＝val＝100 時與 hueToHex（舊色相條的純色）每 channel 差 ≤ 1（.5 進位的浮點誤差，如 6° 的 25.5）', () => {
    for (let h = 0; h <= HUE_MAX; h++) expect(maxChannelDiff(hsvToHex(h, 100, 100), hueToHex(h))).toBeLessThanOrEqual(1)
  })

  it('邊界：色相繞回、sat／val 超出 clamp、非有限數視為 0', () => {
    expect(hsvToHex(360, 100, 100)).toBe('#FF0000')
    expect(hsvToHex(-120, 100, 100)).toBe(hsvToHex(240, 100, 100))
    expect(hsvToHex(30, 150, 120)).toBe(hsvToHex(30, 100, 100))
    expect(hsvToHex(30, -5, -1)).toBe('#000000')
    expect(hsvToHex(Number.NaN, 100, 100)).toBe('#FF0000')
    expect(hsvToHex(0, Number.NaN, 100)).toBe('#FFFFFF')
    expect(hsvToHex(0, 100, Number.NaN)).toBe('#000000')
  })

  it('整數 HSV 全格點：輸出符合 COLOR_PATTERN、與浮點參考值每個 channel 誤差 ≤ 1/255', () => {
    for (let h = 0; h <= HUE_MAX; h += 7) {
      for (let s = 0; s <= SV_MAX; s += 3) {
        for (let v = 0; v <= SV_MAX; v += 3) {
          const hex = hsvToHex(h, s, v)
          expect(COLOR_PATTERN.test(hex) && hex === hex.toUpperCase()).toBe(true)
          const ref = hsvReference(h, s, v)
          ;[1, 3, 5].forEach((i, n) => {
            expect(Math.abs(Number.parseInt(hex.slice(i, i + 2), 16) - ref[n])).toBeLessThanOrEqual(1)
          })
        }
      }
    }
  })
})

describe('hexToHsv：#RRGGBB → HSV（點色塊反推；決策 3）', () => {
  it('基本色', () => {
    expect(hexToHsv('#FF0000')).toEqual({ hue: 0, sat: 100, val: 100 })
    expect(hexToHsv('#00FF00')).toEqual({ hue: 120, sat: 100, val: 100 })
    expect(hexToHsv('#0000ff')).toEqual({ hue: 240, sat: 100, val: 100 })
    expect(hexToHsv('#FF00FF')).toEqual({ hue: 300, sat: 100, val: 100 })
  })

  it('灰階（白、黑、灰）保留傳入的色相；黑的飽和度為 0', () => {
    expect(hexToHsv('#FFFFFF', 210)).toEqual({ hue: 210, sat: 0, val: 100 })
    expect(hexToHsv('#000000', 33)).toEqual({ hue: 33, sat: 0, val: 0 })
    const gray = hexToHsv('#9E9E9E', 140)
    expect(gray.hue).toBe(140)
    expect(gray.sat).toBe(0)
    expect(gray.val).toBeCloseTo((158 / 255) * 100, 10)
    expect(hexToHsv('#808080').hue).toBe(0) // 未傳色相 → 0
  })

  it('不合法色碼回傳白（保留色相）', () => {
    expect(hexToHsv('red', 50)).toEqual({ hue: 50, sat: 0, val: 100 })
  })

  it('PALETTE 10 色反推再轉回逐字相同', () => {
    for (const color of PALETTE) {
      const { hue, sat, val } = hexToHsv(color, 77)
      expect(hsvToHex(hue, sat, val)).toBe(color)
    }
  })

  it('往返：#RRGGBB → HSV → #RRGGBB 逐字相同（每 channel 間隔 5 取樣，誤差 0 ≤ 1/255）', () => {
    const levels: number[] = []
    for (let x = 0; x <= 255; x += 5) levels.push(x)
    const hex2 = (n: number) => n.toString(16).padStart(2, '0').toUpperCase()
    for (const r of levels) {
      for (const g of levels) {
        for (const b of levels) {
          const hex = `#${hex2(r)}${hex2(g)}${hex2(b)}`
          const { hue, sat, val } = hexToHsv(hex)
          expect(maxChannelDiff(hsvToHex(hue, sat, val), hex)).toBe(0)
        }
      }
    }
  })

  it('往返：面板產生的顏色（整數 HSV）→ #RRGGBB → HSV → #RRGGBB 不變', () => {
    for (let h = 0; h <= HUE_MAX; h += 11) {
      for (let s = 0; s <= SV_MAX; s += 4) {
        for (let v = 0; v <= SV_MAX; v += 4) {
          const hex = hsvToHex(h, s, v)
          const back = hexToHsv(hex, h)
          expect(hsvToHex(back.hue, back.sat, back.val)).toBe(hex)
        }
      }
    }
  })

  it('反推的值在範圍內（hue 0..360、sat／val 0..100）', () => {
    for (const color of [...PALETTE, '#FF0001', '#010000', '#123456']) {
      const { hue, sat, val } = hexToHsv(color)
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
      expect(sat).toBeGreaterThanOrEqual(0)
      expect(sat).toBeLessThanOrEqual(100)
      expect(val).toBeGreaterThanOrEqual(0)
      expect(val).toBeLessThanOrEqual(100)
    }
  })
})

describe('svFromPointer：方塊指標位置 → { sat, val }（決策 2）', () => {
  const rect = { left: 100, top: 50, width: 216, height: 132 }
  it('四角與中心：x＝飽和度 0→100、y＝明度 100→0', () => {
    expect(svFromPointer(100, 50, rect)).toEqual({ sat: 0, val: 100 })
    expect(svFromPointer(316, 50, rect)).toEqual({ sat: 100, val: 100 })
    expect(svFromPointer(100, 182, rect)).toEqual({ sat: 0, val: 0 })
    expect(svFromPointer(316, 182, rect)).toEqual({ sat: 100, val: 0 })
    expect(svFromPointer(208, 116, rect)).toEqual({ sat: 50, val: 50 })
  })

  it('拖出方塊 clamp 到邊緣', () => {
    expect(svFromPointer(-500, -500, rect)).toEqual({ sat: 0, val: 100 })
    expect(svFromPointer(9999, 9999, rect)).toEqual({ sat: 100, val: 0 })
  })

  it('取整數', () => {
    const { sat, val } = svFromPointer(100 + 216 * 0.333, 50 + 132 * 0.777, rect)
    expect(Number.isInteger(sat) && Number.isInteger(val)).toBe(true)
    expect({ sat, val }).toEqual({ sat: 33, val: 22 })
  })

  it('尚未排版（寬高 0）不產生 NaN', () => {
    expect(svFromPointer(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ sat: 0, val: 100 })
  })
})

describe('svKeyValue：方塊鍵盤（決策 4）', () => {
  it('←/→ 飽和度 ±2、↑/↓ 明度 ±2', () => {
    expect(svKeyValue('ArrowRight', false, 50, 50)).toEqual({ sat: 52, val: 50 })
    expect(svKeyValue('ArrowLeft', false, 50, 50)).toEqual({ sat: 48, val: 50 })
    expect(svKeyValue('ArrowUp', false, 50, 50)).toEqual({ sat: 50, val: 52 })
    expect(svKeyValue('ArrowDown', false, 50, 50)).toEqual({ sat: 50, val: 48 })
  })

  it('Shift＋方向鍵 ±10；PageUp／PageDown 飽和度 ±10', () => {
    expect(svKeyValue('ArrowRight', true, 50, 50)).toEqual({ sat: 60, val: 50 })
    expect(svKeyValue('ArrowDown', true, 50, 50)).toEqual({ sat: 50, val: 40 })
    expect(svKeyValue('PageUp', false, 50, 50)).toEqual({ sat: 60, val: 50 })
    expect(svKeyValue('PageDown', false, 50, 50)).toEqual({ sat: 40, val: 50 })
  })

  it('Home／End 飽和度 0／100，明度不變', () => {
    expect(svKeyValue('Home', false, 50, 30)).toEqual({ sat: 0, val: 30 })
    expect(svKeyValue('End', false, 50, 30)).toEqual({ sat: 100, val: 30 })
  })

  it('clamp 到 0..100；小數（色塊反推）取整', () => {
    expect(svKeyValue('ArrowRight', true, 95, 99)).toEqual({ sat: 100, val: 99 })
    expect(svKeyValue('ArrowDown', false, 0, 1)).toEqual({ sat: 0, val: 0 })
    expect(svKeyValue('ArrowRight', false, 8.235, 100)).toEqual({ sat: 10, val: 100 })
  })

  it('其他按鍵回 null', () => {
    expect(svKeyValue('Tab', false, 50, 50)).toBeNull()
    expect(svKeyValue('Enter', false, 50, 50)).toBeNull()
  })
})

describe('顏色面板文字（DESIGN §6 工具提示例子）', () => {
  it('方塊：「飽和度 80%、明度 60%」，小數四捨五入', () => {
    expect(svLabel(80, 60)).toBe('飽和度 80%、明度 60%')
    expect(svLabel(8.235, 95.69)).toBe('飽和度 8%、明度 96%')
  })

  it('目前顏色按鈕：「選擇顏色（目前 #XXXXXX）」，色碼大寫', () => {
    expect(colorButtonLabel('#00ff51')).toBe('選擇顏色（目前 #00FF51）')
    expect(colorButtonLabel(PALETTE[0])).toBe('選擇顏色（目前 #FFFFFF）')
  })
})
