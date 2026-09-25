import { describe, expect, it } from 'vitest'
import { playerRowLabel } from '../src/features/players/playerRow'

import { playerFileName } from '../src/shells/vscode/ideLayout'

const base = { nickname: 'amy', score: 120, isDrawer: false, hasGuessed: false, connected: true }
/** vscode 主題的顯示名稱（EXPLORER 檔名） */
const file = playerFileName(base.nickname)

describe('playerRowLabel：玩家列的無障礙名稱（vscode 主題以檔名顯示）', () => {
  it('一般玩家：檔名與分數', () => {
    expect(playerRowLabel(file, base, false, null)).toBe('amy.ts：120 分')
  })

  it('依序附上畫師、已猜對、本回合得分、斷線中、你', () => {
    expect(playerRowLabel(file, { ...base, isDrawer: true }, true, null)).toBe('amy.ts：120 分，畫師，你')
    expect(playerRowLabel(file, { ...base, hasGuessed: true, connected: false }, false, 87)).toBe(
      'amy.ts：120 分，已猜對，本回合 +87，斷線中',
    )
  })

  it('顯示名稱由殼層決定，功能層不加任何偽裝格式', () => {
    expect(playerRowLabel('amy', base, false, null)).toBe('amy：120 分')
  })
})
