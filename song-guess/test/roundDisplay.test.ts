// 回合狀態列各階段的文字（features/round/roundDisplay；spec/song-guess/design.md §2「字幕列」欄逐列）、
// 歌名字數提示、「出題」顯示條件、報讀文字、出題對話框的文字。
import { describe, expect, it } from 'vitest'
import { MIN_PLAYERS, REVEAL_SECONDS, SONGS_PER_GAME } from '@fishing-work/shared/song-guess'
import {
  ARTIST_CANCEL_LABEL,
  ARTIST_FIELD_LABEL,
  ARTIST_PLACEHOLDER,
  ARTIST_SEARCHING_LABEL,
  ARTIST_SUBMIT_LABEL,
  artistNameOf,
  canVolunteer,
  captionText,
  countConnected,
  roundAnnouncement,
  roundCaption,
  setterNameOf,
  titleBlanks,
  volunteerAriaLabel,
  winnerOf,
  type CaptionInput,
} from '../src/features/round/roundDisplay'
import { player, playingRound, result, reveal, round, song } from './fixtures'

/** 殼層給的出題按鈕文字（測試用假名，證明句子是用參數組的、沒有寫死） */
const SHARE = '開始出題'

function input(over: Partial<CaptionInput>): CaptionInput {
  return { round: round(), isSetter: false, setterName: null, hasGuessed: false, gain: null, remaining: null, shareLabel: SHARE, ...over }
}

describe('回合狀態列文字（design §2 逐列）', () => {
  it('idle：按「<出題>」出題（需 2 人以上）——有沒有上一局結果都一樣', () => {
    expect(captionText(input({ round: round({ phase: 'idle' }) }))).toBe(`按「${SHARE}」出題（需 ${MIN_PLAYERS} 人以上）`)
    expect(captionText(input({ round: round({ phase: 'idle', results: [result('p1', 1, 300, 4)] }) }))).toBe(`按「${SHARE}」出題（需 2 人以上）`)
    expect(captionText(input({ round: round({ phase: 'idle' }), shareLabel: '分享音訊' }))).toBe('按「分享音訊」出題（需 2 人以上）')
  })

  it('choosing（自己是出題者）：正在出題 · 00:52', () => {
    expect(captionText(input({ round: round({ phase: 'choosing' }), isSetter: true, setterName: 'rex', remaining: 52 }))).toBe('正在出題 · 00:52')
  })

  it('choosing（其他人）：等待 <出題者> 出題 · 00:52；出題者不在清單時用「出題者」', () => {
    expect(captionText(input({ round: round({ phase: 'choosing' }), setterName: 'rex', remaining: 52 }))).toBe('等待 rex 出題 · 00:52')
    expect(captionText(input({ round: round({ phase: 'choosing' }), setterName: null, remaining: 52 }))).toBe('等待 出題者 出題 · 00:52')
  })

  it('playing：歌名 ＿ ＿ ＿（3 字） · 00:21', () => {
    const r = playingRound({}, { titleLength: 3 })
    expect(captionText(input({ round: r, remaining: 21 }))).toBe('歌名 ＿ ＿ ＿（3 字） · 00:21')
    // 拆成兩段：字數與倒數（tail）固定顯示，底線（head）太長時才截斷
    expect(roundCaption(input({ round: r, remaining: 21 }))).toEqual({ head: '歌名 ＿ ＿ ＿', tail: '（3 字） · 00:21' })
  })

  it('playing：字數照 server 給的 titleLength 顯示（不含空白與標點：`My story, your song` 是 15），客戶端不自己算', () => {
    const r = playingRound({}, { titleLength: 'Mystoryyoursong'.length })
    expect(roundCaption(input({ round: r, remaining: 21 })).tail).toBe('（15 字） · 00:21')
  })

  it('playing：長歌名照字數給底線，tail 仍有字數與倒數', () => {
    const r = playingRound({}, { titleLength: 15 })
    const c = roundCaption(input({ round: r, remaining: 30 }))
    expect(c.head.match(/＿/g)).toHaveLength(15)
    expect(c.tail).toBe('（15 字） · 00:30')
  })

  it('playing（自己已猜對）：你猜對了 +87 · 00:21；得分不明時不帶 +N', () => {
    const r = playingRound({}, { titleLength: 3, correctIds: ['p1'] })
    expect(captionText(input({ round: r, hasGuessed: true, gain: 87, remaining: 21 }))).toBe('你猜對了 +87 · 00:21')
    expect(captionText(input({ round: r, hasGuessed: true, gain: null, remaining: 21 }))).toBe('你猜對了 · 00:21')
  })

  it('playing：字數不合理（0）時只顯示「歌名」與倒數', () => {
    expect(captionText(input({ round: playingRound({}, { titleLength: 0 }), remaining: 5 }))).toBe('歌名 · 00:05')
  })

  it('reveal：下一首 00:04；最後一首：本局結束（不倒數）', () => {
    const r = round({ phase: 'reveal', song: song({ index: 2 }), reveal: reveal({ index: 2 }) })
    expect(captionText(input({ round: r, remaining: 4 }))).toBe('下一首 00:04')
    expect(captionText(input({ round: r, remaining: REVEAL_SECONDS }))).toBe('下一首 00:05')
    const last = round({ phase: 'reveal', song: song({ index: SONGS_PER_GAME }), reveal: reveal({ index: SONGS_PER_GAME }) })
    expect(captionText(input({ round: last, remaining: 4 }))).toBe('本局結束')
  })

  it('ended：本局第一名：X（n 分）；沒有結果時「本局結束」', () => {
    const r = round({ phase: 'ended', results: [result('p2', 1, 412, 5, 'amy'), result('p1', 2, 300, 4, 'rex')] })
    expect(captionText(input({ round: r }))).toBe('本局第一名：amy（412 分）')
    expect(captionText(input({ round: round({ phase: 'ended', results: [] }) }))).toBe('本局結束')
    expect(captionText(input({ round: round({ phase: 'ended', results: null }) }))).toBe('本局結束')
  })

  it('沒有倒數（remaining 為 null）時不帶時間', () => {
    expect(captionText(input({ round: round({ phase: 'choosing' }), isSetter: true }))).toBe('正在出題')
    expect(captionText(input({ round: playingRound({}, { titleLength: 2 }) }))).toBe('歌名 ＿ ＿（2 字）')
    expect(captionText(input({ round: round({ phase: 'reveal', song: song({ index: 1 }), reveal: reveal() }) }))).toBe('下一首')
  })
})

describe('titleBlanks：每字一個全形底線、半形空白分隔', () => {
  it('3 → ＿ ＿ ＿；1 → ＿', () => {
    expect(titleBlanks(3)).toBe('＿ ＿ ＿')
    expect(titleBlanks(1)).toBe('＿')
  })

  it('0、負數、小數、null → 空字串', () => {
    for (const bad of [0, -1, 2.5, null, Number.NaN]) expect(titleBlanks(bad)).toBe('')
  })
})

describe('出題條件與名稱', () => {
  it('canVolunteer：idle 或 ended 且在線 ≥ MIN_PLAYERS', () => {
    expect(canVolunteer('idle', MIN_PLAYERS)).toBe(true)
    expect(canVolunteer('ended', MIN_PLAYERS + 3)).toBe(true)
    expect(canVolunteer('idle', MIN_PLAYERS - 1)).toBe(false)
    for (const phase of ['choosing', 'playing', 'reveal'] as const) expect(canVolunteer(phase, 10)).toBe(false)
  })

  it('countConnected 只算在線', () => {
    expect(countConnected([player('a'), player('b', { connected: false }), player('c')])).toBe(2)
  })

  it('volunteerAriaLabel 以可見文字開頭（label in name）', () => {
    expect(volunteerAriaLabel(SHARE)).toBe(`${SHARE}：出題`)
  })

  it('setterNameOf：出題者的暱稱；idle 或已離開 → null', () => {
    const players = [player('p1', { nickname: 'rex' }), player('p2', { nickname: 'amy' })]
    expect(setterNameOf({ setterId: 'p2' }, players)).toBe('amy')
    expect(setterNameOf({ setterId: null }, players)).toBeNull()
    expect(setterNameOf({ setterId: 'gone' }, players)).toBeNull()
  })

  it('artistNameOf：正式名稱優先，沒有才用出題者輸入的', () => {
    expect(artistNameOf({ artist: 'jay chou', artistDisplay: '周杰倫' })).toBe('周杰倫')
    expect(artistNameOf({ artist: '孫燕姿', artistDisplay: null })).toBe('孫燕姿')
    expect(artistNameOf({ artist: null, artistDisplay: null })).toBeNull()
  })

  it('winnerOf：rank 最小的那筆（不依賴陣列順序）', () => {
    expect(winnerOf([result('b', 2, 100, 1), result('a', 1, 200, 2)])?.playerId).toBe('a')
    expect(winnerOf([])).toBeNull()
    expect(winnerOf(null)).toBeNull()
  })
})

describe('報讀文字（design §4：第 n 首開始、猜對、揭曉歌名；不含倒數）', () => {
  const base = { isSetter: false, setterName: 'rex', hasGuessed: false, gain: null }

  it('第 n 首開始', () => {
    expect(roundAnnouncement({ ...base, round: playingRound({}, { index: 2, titleLength: 4 }) })).toBe('第 2 首開始，歌名 4 個字')
  })

  it('自己猜對', () => {
    const r = playingRound({}, { index: 2, correctIds: ['p1'] })
    expect(roundAnnouncement({ ...base, round: r, hasGuessed: true, gain: 87 })).toBe('你猜對了，得 87 分')
    expect(roundAnnouncement({ ...base, round: r, hasGuessed: true })).toBe('你猜對了')
  })

  it('揭曉歌名、歌手與猜對人數', () => {
    const r = round({ phase: 'reveal', song: song({ index: 2 }), reveal: reveal({ index: 2, title: '遇見', artist: '孫燕姿', scores: [{ playerId: 'p1', score: 87 }] }) })
    expect(roundAnnouncement({ ...base, round: r })).toBe('第 2 首：《遇見》，孫燕姿，1 人猜對')
    const none = round({ phase: 'reveal', song: song({ index: 3 }), reveal: reveal({ index: 3, title: '天黑黑', artist: '孫燕姿' }) })
    expect(roundAnnouncement({ ...base, round: none })).toBe('第 3 首：《天黑黑》，孫燕姿，沒有人猜對')
  })

  it('出題中、本局結束、idle', () => {
    expect(roundAnnouncement({ ...base, round: round({ phase: 'choosing' }) })).toBe('rex 正在出題')
    expect(roundAnnouncement({ ...base, isSetter: true, round: round({ phase: 'choosing' }) })).toBe('請輸入歌手名稱')
    expect(roundAnnouncement({ ...base, round: round({ phase: 'ended', results: [result('p2', 1, 412, 5, 'amy')] }) })).toBe('本局結束，第一名：amy（412 分）')
    expect(roundAnnouncement({ ...base, round: round({ phase: 'idle' }) })).toBe('')
  })

  it('不含倒數（文字不隨時間變）', () => {
    for (const r of [playingRound(), round({ phase: 'choosing' }), round({ phase: 'reveal', song: song(), reveal: reveal() })]) {
      expect(roundAnnouncement({ ...base, round: r })).not.toMatch(/\d\d:\d\d/)
    }
  })
})

describe('出題對話框的文字（design §1「出題」）', () => {
  it('欄位「歌手」、placeholder「輸入歌手名稱（例如：孫燕姿）」、搜尋中「搜尋中…」', () => {
    expect(ARTIST_FIELD_LABEL).toBe('歌手')
    expect(ARTIST_PLACEHOLDER).toBe('輸入歌手名稱（例如：孫燕姿）')
    expect(ARTIST_SEARCHING_LABEL).toBe('搜尋中…')
    expect(ARTIST_SUBMIT_LABEL).not.toBe('')
    expect(ARTIST_CANCEL_LABEL).not.toBe('')
  })
})
