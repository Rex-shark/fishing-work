import { describe, expect, it } from 'vitest'
import { MIN_PLAYERS } from '@fishing-work/shared'
import {
  END_REASON_LABEL,
  PHASE_LABEL,
  WARNING_SECONDS,
  canVolunteer,
  countConnected,
  isCountdownWarning,
  topicBlanks,
} from '../src/features/round/roundDisplay'
import { isDrawerStatusBar } from '../src/shells/vscode/ideLayout'

describe('PHASE_LABEL / END_REASON_LABEL：狀態列文字（DESIGN §5）', () => {
  it('四個階段', () => {
    expect(PHASE_LABEL).toEqual({ idle: '等待中', choosing: '出題中', drawing: '作畫中', ended: '揭曉' })
  })

  it('結束原因（取消與逾時統一為「回合取消」）', () => {
    expect(END_REASON_LABEL).toEqual({ allGuessed: '全員猜對', timeout: '時間到', drawerLeft: '畫師離開', cancelled: '回合取消' })
  })
})

describe('topicBlanks：題目字數提示', () => {
  it('每字一個全形底線，以空白分隔', () => {
    expect(topicBlanks(1)).toBe('＿')
    expect(topicBlanks(3)).toBe('＿ ＿ ＿')
  })

  it('null、0、負數、非整數回空字串', () => {
    expect(topicBlanks(null)).toBe('')
    expect(topicBlanks(0)).toBe('')
    expect(topicBlanks(-2)).toBe('')
    expect(topicBlanks(1.5)).toBe('')
  })
})

describe('canVolunteer / countConnected：「▷ 我來畫」顯示條件', () => {
  it('只算連線中的玩家', () => {
    expect(countConnected([{ connected: true }, { connected: false }, { connected: true }])).toBe(2)
    expect(countConnected([])).toBe(0)
  })

  it('idle 且在線人數 ≥ MIN_PLAYERS 才顯示', () => {
    expect(canVolunteer('idle', MIN_PLAYERS)).toBe(true)
    expect(canVolunteer('idle', MIN_PLAYERS + 3)).toBe(true)
    expect(canVolunteer('idle', MIN_PLAYERS - 1)).toBe(false)
  })

  it('其他階段一律不顯示', () => {
    for (const phase of ['choosing', 'drawing', 'ended'] as const) expect(canVolunteer(phase, 10)).toBe(false)
  })
})

describe('isCountdownWarning：最後 10 秒警示', () => {
  it('≤ 10 秒為警示，null 不警示', () => {
    expect(isCountdownWarning(WARNING_SECONDS)).toBe(true)
    expect(isCountdownWarning(0)).toBe(true)
    expect(isCountdownWarning(WARNING_SECONDS + 1)).toBe(false)
    expect(isCountdownWarning(null)).toBe(false)
  })
})

describe('isDrawerStatusBar：自己是畫師時狀態列改橘', () => {
  it('畫師在出題、作畫中為橘', () => {
    expect(isDrawerStatusBar(true, 'choosing')).toBe(true)
    expect(isDrawerStatusBar(true, 'drawing')).toBe(true)
  })

  it('揭曉、idle 或不是畫師時為一般藍色', () => {
    expect(isDrawerStatusBar(true, 'ended')).toBe(false)
    expect(isDrawerStatusBar(true, 'idle')).toBe(false)
    expect(isDrawerStatusBar(false, 'drawing')).toBe(false)
  })
})
