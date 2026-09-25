// 介面風格卡片（首頁 home/HomeThemeCards.tsx，Epic 4）的鍵盤純邏輯（檔名刻意取不同字根，避免 macOS 大小寫撞名）：
// radiogroup 語意（WAI-ARIA APG）：←／↑ 上一張、→／↓ 下一張（循環），Home／End 第一張／最後一張；
// 移動即選取；不可選（即將推出）的卡片略過。
// 首頁不用工具提示（DESIGN §14.4：描述直接寫在卡片上），原本的卡片工具提示文字已隨 layout/ThemeCards 退場。
// 本檔也被首頁使用：不得含偽裝字樣（test/shellBoundary.test.ts 把關）。

export interface CardOption {
  id: string
  available: boolean
}

export const UPCOMING_LABEL = '即將推出'

/** 從 from 往 delta 方向找下一張可選的卡片（循環）；沒有其他可選的回 from */
export function stepAvailable(options: readonly CardOption[], from: number, delta: 1 | -1): number {
  const n = options.length
  for (let k = 1; k < n; k++) {
    const i = (((from + delta * k) % n) + n) % n
    if (options[i]?.available) return i
  }
  return from
}

/** 按鍵 → 目標卡片索引；非導覽鍵回 null */
export function cardKeyTarget(options: readonly CardOption[], from: number, key: string): number | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return stepAvailable(options, from, 1)
    case 'ArrowLeft':
    case 'ArrowUp':
      return stepAvailable(options, from, -1)
    case 'Home': {
      const i = options.findIndex((o) => o.available)
      return i < 0 ? from : i
    }
    case 'End': {
      for (let i = options.length - 1; i >= 0; i--) if (options[i]?.available) return i
      return from
    }
    default:
      return null
  }
}

/** roving tabindex：唯一可 Tab 到的卡片＝目前選取的；選取值不在清單或不可選時為第一張可選的（都沒有則第一張） */
export function tabStopIndex(options: readonly CardOption[], value: string): number {
  const checked = options.findIndex((o) => o.id === value && o.available)
  if (checked >= 0) return checked
  return Math.max(0, options.findIndex((o) => o.available))
}
