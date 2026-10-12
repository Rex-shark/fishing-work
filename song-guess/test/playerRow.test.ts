// 玩家列的無障礙文字（features/players/playerRow）：顏色與圖示之外的文字載體
import { describe, expect, it } from 'vitest'
import { playerRowLabel } from '../src/features/players/playerRow'

const base = { score: 120, isSetter: false, hasGuessed: false, connected: true }

describe('playerRowLabel', () => {
  it('只有分數', () => {
    expect(playerRowLabel('amy', base, false, null)).toBe('amy：120 分')
  })

  it('出題者、已猜對、本首得分、斷線、自己：依序列出', () => {
    expect(playerRowLabel('amy', { ...base, isSetter: true }, false, null)).toBe('amy：120 分，出題者')
    expect(playerRowLabel('amy', { ...base, hasGuessed: true }, false, 87)).toBe('amy：120 分，已猜對，本首 +87')
    expect(playerRowLabel('amy', { ...base, connected: false }, false, null)).toBe('amy：120 分，斷線中')
    expect(playerRowLabel('amy', { score: 207, isSetter: true, hasGuessed: true, connected: false }, true, 87)).toBe(
      'amy：207 分，出題者，已猜對，本首 +87，斷線中，你',
    )
  })

  it('顯示的是總分（score），不是本局得分', () => {
    expect(playerRowLabel('amy', { ...base, score: 999 }, true, null)).toBe('amy：999 分，你')
  })
})
