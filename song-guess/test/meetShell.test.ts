// meet 殼層的純邏輯（shells/meet/meetLayout；spec/song-guess/design.md §1、§2；DESIGN §15）：
// 視窗標題、舞台標籤與文字、「分享音訊」按鈕的四種樣子、對話框文字與按鍵、控制列文字、響應式、選單與切換偽裝。
import { describe, expect, it, vi } from 'vitest'
import { MIN_PLAYERS } from '@fishing-work/shared/song-guess'
import { DIALOG_REFOCUS_SELECTORS } from '../src/shells/dialogFocus'
import {
  CHAT_PANEL_TITLE,
  LAST_GAME_LABEL,
  MEET_APP_TITLE,
  MEET_BREAKPOINTS,
  MEET_CHAT_PLACEHOLDER,
  MEET_CODE,
  MEET_DIALOG_BUTTONS,
  MEET_DIALOG_REFOCUS_SELECTORS,
  MEET_DIALOG_TITLE,
  MEET_RESUME_TEXT,
  MEET_SWITCH_HINT,
  MORE_MENU_DECOR,
  PANEL_OVERLAY_QUERY,
  SHARE_AUDIO_LABEL,
  STAGE_EMPTY_TEXT,
  THEME_CURRENT_NOTE,
  WAVE_BARS,
  chatSenderName,
  chooseMeetTheme,
  clockText,
  dialogKeyAction,
  meetDialogButtonLabel,
  meetDialogButtonText,
  meetDialogHeading,
  meetLayoutFor,
  meetThemeInitialIndex,
  meetThemeItems,
  meetWindowTitle,
  participantCount,
  preparingText,
  shareControlState,
  shareControlTip,
  songProgress,
  stageLabel,
  stageSongLine,
  stepEnabledIndex,
  stepMenuItem,
  tileName,
  volumeTip,
  waitingForPlayers,
} from '../src/shells/meet/meetLayout'
import type { ShellRoundState, ShellThemeSwitch } from '../src/shells/types'

function shellRound(over: Partial<ShellRoundState> = {}): ShellRoundState {
  return { phase: 'idle', isSetter: false, setterName: null, songIndex: null, songCount: 5, showLastResults: false, ...over }
}

describe('視窗標題（DESIGN §15.3）', () => {
  it('`Meet – kqw-mzdv-ptj`（en dash），各階段相同', () => {
    expect(MEET_CODE).toBe('kqw-mzdv-ptj')
    expect(MEET_APP_TITLE).toBe('Meet – kqw-mzdv-ptj')
    expect(meetWindowTitle()).toBe(MEET_APP_TITLE)
  })
})

describe('舞台標籤（design §1、§2）', () => {
  it('playing：「<出題者> 正在分享音訊」；出題者不在清單時用「出題者」', () => {
    expect(stageLabel(shellRound({ phase: 'playing', setterName: 'rex', songIndex: 2 }))).toBe('rex 正在分享音訊')
    expect(stageLabel(shellRound({ phase: 'playing', setterName: null, songIndex: 2 }))).toBe('出題者 正在分享音訊')
  })

  it('reveal：「第 2 / 5 首」', () => {
    expect(stageLabel(shellRound({ phase: 'reveal', setterName: 'rex', songIndex: 2 }))).toBe('第 2 / 5 首')
    expect(stageLabel(shellRound({ phase: 'reveal', songIndex: 5 }))).toBe('第 5 / 5 首')
    expect(songProgress(3, 5)).toBe('第 3 / 5 首')
  })

  it('idle 顯示上一局排名：「上一局」；idle 沒有結果、choosing、ended：沒有標籤', () => {
    expect(LAST_GAME_LABEL).toBe('上一局')
    expect(stageLabel(shellRound({ phase: 'idle', showLastResults: true }))).toBe('上一局')
    expect(stageLabel(shellRound({ phase: 'idle' }))).toBeNull()
    expect(stageLabel(shellRound({ phase: 'choosing', setterName: 'rex' }))).toBeNull()
    expect(stageLabel(shellRound({ phase: 'ended', setterName: 'rex' }))).toBeNull()
  })
})

describe('舞台文字（design §2「舞台」欄）', () => {
  it('idle（無結果）：「尚無人分享音訊」', () => {
    expect(STAGE_EMPTY_TEXT).toBe('尚無人分享音訊')
  })

  it('choosing（其他人）：「<出題者> 正在準備分享音訊…」', () => {
    expect(preparingText('rex')).toBe('rex 正在準備分享音訊…')
    expect(preparingText(null)).toBe('出題者 正在準備分享音訊…')
  })

  it('playing：「歌手：孫燕姿 · 第 2 / 5 首」；沒有歌手名時只有第幾首', () => {
    expect(stageSongLine('孫燕姿', 2, 5)).toBe('歌手：孫燕姿 · 第 2 / 5 首')
    expect(stageSongLine(null, 2, 5)).toBe('第 2 / 5 首')
  })

  it('波形 5～7 根直條，每根的參數不完全相同、延遲不為正（一開始就在動）', () => {
    expect(WAVE_BARS.length).toBeGreaterThanOrEqual(5)
    expect(WAVE_BARS.length).toBeLessThanOrEqual(7)
    expect(new Set(WAVE_BARS.map((b) => `${b.duration}:${b.delay}`)).size).toBe(WAVE_BARS.length)
    for (const b of WAVE_BARS) {
      expect(b.min).toBeGreaterThan(0)
      expect(b.min).toBeLessThan(1)
      expect(b.rest).toBeGreaterThan(0)
      expect(b.rest).toBeLessThanOrEqual(1)
      expect(b.delay).toBeLessThanOrEqual(0)
    }
  })
})

describe('「分享音訊」按鈕（design §2「控制列」欄）', () => {
  it('idle／ended：人數足夠可按（ready），不足為 waiting', () => {
    expect(shareControlState('idle', false, MIN_PLAYERS)).toBe('ready')
    expect(shareControlState('ended', true, MIN_PLAYERS + 1)).toBe('ready')
    expect(shareControlState('idle', false, MIN_PLAYERS - 1)).toBe('waiting')
    expect(shareControlState('ended', false, 1)).toBe('waiting')
  })

  it('choosing：自己是出題者 → 作用中（active）；其他人 → 不可按（busy）', () => {
    expect(shareControlState('choosing', true, 3)).toBe('active')
    expect(shareControlState('choosing', false, 3)).toBe('busy')
  })

  it('playing、reveal：不可按（出題者也一樣）', () => {
    for (const phase of ['playing', 'reveal'] as const) {
      expect(shareControlState(phase, false, 3)).toBe('busy')
      expect(shareControlState(phase, true, 3)).toBe('busy')
    }
  })

  it('人數不足的小字「等待其他玩家加入（n/2）」；不可按時的工具提示', () => {
    expect(waitingForPlayers(1)).toBe(`等待其他玩家加入（1/${MIN_PLAYERS}）`)
    expect(shareControlTip('waiting')).toBe('分享音訊（等待其他玩家加入）')
    expect(shareControlTip('busy')).toBe('分享音訊（這一局進行中）')
    expect(shareControlTip('active')).toBe('正在準備分享音訊')
  })

  it('音量的無障礙名稱帶數值；0 標示靜音', () => {
    expect(volumeTip('音量', 60)).toBe('音量 60')
    expect(volumeTip('音量', 0)).toBe('音量 0（靜音）')
  })
})

describe('對話框（design §1「出題」：對話框「分享音訊」、按鈕「取消／分享」、搜尋中「搜尋中…」）', () => {
  it('標題與按鈕文字', () => {
    expect(SHARE_AUDIO_LABEL).toBe('分享音訊')
    expect(MEET_DIALOG_TITLE.artist).toBe('分享音訊')
    expect(MEET_DIALOG_BUTTONS.artist).toEqual(['分享', '取消'])
    expect(meetDialogHeading('artist', undefined)).toBe('分享音訊')
    expect(meetDialogHeading('help', '計分')).toBe('計分')
    expect(meetDialogHeading('help', undefined)).toBe('說明')
  })

  it('按鈕可見文字：出題為「分享」「取消」；說明照選項原文', () => {
    expect(meetDialogButtonText('artist', 0, '搜尋並開始')).toBe('分享')
    expect(meetDialogButtonText('artist', 1, '取消出題')).toBe('取消')
    expect(meetDialogButtonText('help', 0, '返回')).toBe('返回')
  })

  it('搜尋中（pending）：主要按鈕顯示選項原文「搜尋中…」', () => {
    expect(meetDialogButtonText('artist', 0, '搜尋中…', true)).toBe('搜尋中…')
    expect(meetDialogButtonLabel('artist', 0, '搜尋中…', true)).toBe('搜尋中…')
  })

  it('無障礙名稱以可見文字開頭，再補動作', () => {
    expect(meetDialogButtonLabel('artist', 0, '搜尋並開始')).toBe('分享：搜尋並開始')
    expect(meetDialogButtonLabel('artist', 1, '取消出題')).toBe('取消：取消出題')
    expect(meetDialogButtonLabel('help', 1, '關閉')).toBe('關閉')
  })

  it('Esc＝取消（組字中不攔截）；Enter 走 form submit', () => {
    expect(dialogKeyAction('Escape', false)).toBe('cancel')
    expect(dialogKeyAction('Escape', true)).toBeNull()
    expect(dialogKeyAction('Enter', false)).toBeNull()
  })

  it('busy 結束後焦點的落點：輸入框 → 主要按鈕 → 其餘選項', () => {
    expect(MEET_DIALOG_REFOCUS_SELECTORS).toHaveLength(3)
    expect(MEET_DIALOG_REFOCUS_SELECTORS[0]).toBe(DIALOG_REFOCUS_SELECTORS[0])
    expect(MEET_DIALOG_REFOCUS_SELECTORS[1]).toContain('[type="submit"]')
    expect(MEET_DIALOG_REFOCUS_SELECTORS[2]).toBe(DIALOG_REFOCUS_SELECTORS[1])
  })

  it('自動重連的一行提示', () => {
    expect(MEET_RESUME_TEXT).toBe('正在重新加入通話…')
  })
})

describe('參加者 tile、控制列、面板文字', () => {
  it('tile 左下：暱稱（自己加「（你）」）；斷線為「連線中斷」', () => {
    expect(tileName('amy', false, true)).toBe('amy')
    expect(tileName('amy', true, true)).toBe('amy（你）')
    expect(tileName('amy', true, false)).toBe('連線中斷')
  })

  it('時間 HH:mm、使用者人數（沒有玩家時為 1）', () => {
    expect(clockText(new Date(2026, 9, 12, 9, 5))).toBe('09:05')
    expect(participantCount(0)).toBe(1)
    expect(participantCount(7)).toBe(7)
  })

  it('面板標題、輸入膠囊 placeholder、自己的訊息顯示「你」', () => {
    expect(CHAT_PANEL_TITLE).toBe('通話中的訊息')
    expect(MEET_CHAT_PLACEHOLDER).toBe('傳送訊息給所有人')
    expect(chatSenderName('amy', false)).toBe('amy')
    expect(chatSenderName('amy', true)).toBe('你')
    expect(chatSenderName(null, false)).toBe('')
  })

  it('說明內文的切換偽裝路徑', () => {
    expect(MEET_SWITCH_HINT).toBe('更多 ⋮ → 切換偽裝')
  })
})

describe('響應式（DESIGN §15.3；design §4：沒有工具列收合斷點）', () => {
  it('斷點 1280／1024／768', () => {
    expect(MEET_BREAKPOINTS).toEqual({ stripNarrow: 1280, stripBelow: 1024, panelOverlay: 768 })
    expect(PANEL_OVERLAY_QUERY).toBe('(max-width: 767.98px)')
  })

  it('meetLayoutFor', () => {
    expect(meetLayoutFor(1440)).toEqual({ strip: 'side', tileWidth: 184, panelOverlay: false })
    expect(meetLayoutFor(1279)).toEqual({ strip: 'side', tileWidth: 144, panelOverlay: false })
    expect(meetLayoutFor(1023)).toEqual({ strip: 'below', tileWidth: 120, panelOverlay: false })
    expect(meetLayoutFor(767)).toEqual({ strip: 'below', tileWidth: 120, panelOverlay: true })
  })
})

describe('「更多 ⋮」選單與切換偽裝', () => {
  const Icon = () => null
  const themes = (current: 'meet', select = vi.fn()): ShellThemeSwitch => ({
    current,
    options: [{ id: 'meet', name: '視訊會議', description: 'd', icon: Icon, available: true }],
    select,
  })

  it('選單鍵盤：↑↓ 循環、Home／End', () => {
    expect(stepMenuItem(2, -1, 'ArrowDown')).toBe(0)
    expect(stepMenuItem(2, 1, 'ArrowDown')).toBe(0)
    expect(stepMenuItem(2, 0, 'ArrowUp')).toBe(1)
    expect(stepMenuItem(2, 0, 'End')).toBe(1)
    expect(stepMenuItem(0, 0, 'ArrowDown')).toBeNull()
    expect(stepMenuItem(2, 0, 'a')).toBeNull()
    expect(MORE_MENU_DECOR.length).toBeGreaterThan(0)
  })

  it('清單只有一張「視訊會議」，標「目前使用」；一開始選取它', () => {
    expect(meetThemeItems(themes('meet'))).toEqual([{ id: 'meet', name: '視訊會議', note: THEME_CURRENT_NOTE, disabled: false, current: true }])
    expect(meetThemeInitialIndex(themes('meet'))).toBe(0)
    expect(stepEnabledIndex([{ disabled: false }], 0, 'ArrowDown')).toBe(0)
  })

  it('與目前相同不呼叫 select（不重寫 localStorage）', () => {
    const select = vi.fn()
    expect(chooseMeetTheme(themes('meet', select), 'meet')).toBe(false)
    expect(select).not.toHaveBeenCalled()
  })
})
