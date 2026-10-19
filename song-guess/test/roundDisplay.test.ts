// 回合狀態列各階段的文字（features/round/roundDisplay；spec/song-guess/design.md §2「字幕列」欄逐列）、
// 歌名字數提示、「出題」顯示條件、報讀文字、出題對話框的文字。
import { describe, expect, it } from 'vitest'
import { CHART_SIZE, MIN_PLAYERS, REVEAL_SECONDS, SONGS_PER_GAME, SOURCE_TITLE } from '@fishing-work/shared/song-guess'
import {
  ARTIST_CANCEL_LABEL,
  ARTIST_FIELD_LABEL,
  ARTIST_PLACEHOLDER,
  ARTIST_SEARCHING_LABEL,
  ARTIST_SUBMIT_LABEL,
  CHART_LOADING_LABEL,
  CHART_NOTES,
  CHART_SUBMIT_LABEL,
  DEFAULT_SOURCE,
  NOBODY_SCORED_TEXT,
  HOT_SUFFIX,
  HOT_TOGGLE_LABEL,
  SOURCE_GROUP_LABEL,
  SOURCE_OPTIONS,
  canVolunteer,
  captionText,
  countConnected,
  isChartSource,
  playingStageLines,
  rankingTopicOf,
  roundAnnouncement,
  roundCaption,
  setterNameOf,
  songProgressText,
  sourcePayload,
  submitLabel,
  titleBlanks,
  topicLabel,
  topicOf,
  volunteerAriaLabel,
  winnerOf,
  type CaptionInput,
} from '../src/features/round/roundDisplay'
import { chartRound, player, playingRound, result, reveal, round, song } from './fixtures'

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
    // 第一名只要有分（最低單首 50 分）就照舊顯示
    expect(captionText(input({ round: round({ phase: 'ended', results: [result('p1', 1, 50, 1, 'rex'), result('p2', 2, 0, 0, 'amy')] }) }))).toBe('本局第一名：rex（50 分）')
    expect(captionText(input({ round: round({ phase: 'ended', results: [] }) }))).toBe('本局結束')
    expect(captionText(input({ round: round({ phase: 'ended', results: null }) }))).toBe('本局結束')
  })

  it('ended：第一名 0 分（沒有人猜對）→「本局結束：沒有人猜對」（與聊天系統訊息一致，不顯示「第一名：X（0 分）」）', () => {
    const r = round({ phase: 'ended', results: [result('p1', 1, 0, 0, 'rex'), result('p2', 2, 0, 0, 'amy')] })
    expect(captionText(input({ round: r }))).toBe('本局結束：沒有人猜對')
    expect(roundCaption(input({ round: r }))).toEqual({ head: '本局結束：沒有人猜對', tail: '' })
    expect(NOBODY_SCORED_TEXT).toBe('本局結束：沒有人猜對')
    expect(captionText(input({ round: round({ phase: 'ended', results: [result('p1', 1, 0, 0, 'rex')] }) }))).not.toContain('0 分')
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

  it('topicOf：題庫標題（正式名或榜單名）優先，沒有才用出題者輸入的歌手名', () => {
    expect(topicOf({ artist: 'jay chou', topic: '周杰倫' })).toBe('周杰倫')
    expect(topicOf({ artist: null, topic: '台灣熱門' })).toBe('台灣熱門')
    expect(topicOf({ artist: '孫燕姿', topic: null })).toBe('孫燕姿')
    expect(topicOf({ artist: null, topic: null })).toBeNull()
  })

  it('rankingTopicOf：lastTopic 優先（與 results 同生命週期），沒有才退回本局的題庫標題', () => {
    expect(rankingTopicOf({ lastTopic: '西洋熱門', topic: null, artist: null })).toBe('西洋熱門')
    expect(rankingTopicOf({ lastTopic: '周杰倫', topic: '台灣熱門', artist: null })).toBe('周杰倫')
    expect(rankingTopicOf({ lastTopic: null, topic: '周杰倫', artist: 'jay chou' })).toBe('周杰倫')
    expect(rankingTopicOf({ lastTopic: null, topic: null, artist: null })).toBeNull()
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
    expect(roundAnnouncement({ ...base, isSetter: true, round: round({ phase: 'choosing' }) })).toBe('請選擇題庫來源')
    expect(roundAnnouncement({ ...base, round: round({ phase: 'ended', results: [result('p2', 1, 412, 5, 'amy')] }) })).toBe('本局結束，第一名：amy（412 分）')
    expect(roundAnnouncement({ ...base, round: round({ phase: 'ended', results: [result('p2', 1, 0, 0, 'amy')] }) })).toBe('本局結束：沒有人猜對')
    expect(roundAnnouncement({ ...base, round: round({ phase: 'ended', results: null }) })).toBe('本局結束')
    expect(roundAnnouncement({ ...base, round: round({ phase: 'idle' }) })).toBe('')
  })

  it('不含倒數（文字不隨時間變）', () => {
    for (const r of [playingRound(), round({ phase: 'choosing' }), round({ phase: 'reveal', song: song(), reveal: reveal() })]) {
      expect(roundAnnouncement({ ...base, round: r })).not.toMatch(/\d\d:\d\d/)
    }
  })
})

describe('播放中舞台的兩行字（design §1「播放中的試聽」；plan 決策 10）', () => {
  it('歌手模式、熱門：第一行「孫燕姿（熱門） · 第 2 / 5 首」；本首歌手與題庫標題相同 → 省略第二行', () => {
    const r = playingRound({ artistHot: true }, { index: 2, artist: '孫燕姿' })
    expect(playingStageLines(r)).toEqual({ heading: '孫燕姿（熱門） · 第 2 / 5 首', artistLine: null })
    expect(HOT_SUFFIX).toBe('（熱門）')
  })

  it('歌手模式、不限熱門：沒有「（熱門）」', () => {
    expect(playingStageLines(playingRound({ artistHot: false }, { index: 3 }))).toEqual({ heading: '孫燕姿 · 第 3 / 5 首', artistLine: null })
  })

  it('歌手模式、本首歌手與題庫標題不同（合唱、別名）：顯示第二行「歌手：…」', () => {
    const r = playingRound({ artist: 'jay chou', topic: '周杰倫', artistHot: true }, { index: 1, artist: '周杰倫 & 費玉清' })
    expect(playingStageLines(r)).toEqual({ heading: '周杰倫（熱門） · 第 1 / 5 首', artistLine: '歌手：周杰倫 & 費玉清' })
  })

  it('榜單模式：第一行「台灣熱門 · 第 2 / 5 首」（不加熱門字樣）；第二行一律顯示該首歌手', () => {
    const tw = chartRound('tw-hot', SOURCE_TITLE['tw-hot'], {}, { index: 2, artist: '告五人' })
    expect(playingStageLines(tw)).toEqual({ heading: '台灣熱門 · 第 2 / 5 首', artistLine: '歌手：告五人' })
    const us = chartRound('western-hot', SOURCE_TITLE['western-hot'], {}, { index: 5, artist: 'Taylor Swift' })
    expect(playingStageLines(us)).toEqual({ heading: '西洋熱門 · 第 5 / 5 首', artistLine: '歌手：Taylor Swift' })
    // 即使歌手名剛好等於題庫標題也照樣顯示（只有歌手模式才省略）
    expect(playingStageLines(chartRound('tw-hot', '台灣熱門', {}, { artist: '台灣熱門' })).artistLine).toBe('歌手：台灣熱門')
    // 榜單模式 artistHot 永遠 false；萬一帶 true 也不加熱門字樣
    expect(topicLabel({ source: 'tw-hot', topic: '台灣熱門', artist: null, artistHot: true })).toBe('台灣熱門')
  })

  it('沒有題庫標題時第一行只有第幾首；本首沒有歌手名時沒有第二行', () => {
    const r = playingRound({ source: 'artist', artist: null, topic: null }, { index: 4, artist: '' })
    expect(playingStageLines(r)).toEqual({ heading: '第 4 / 5 首', artistLine: null })
    expect(songProgressText(2, SONGS_PER_GAME)).toBe('第 2 / 5 首')
  })

  it('topic 還沒到時退回出題者輸入的歌手名（不會整行空白）', () => {
    expect(topicLabel({ source: 'artist', topic: null, artist: '孫燕姿', artistHot: true })).toBe('孫燕姿（熱門）')
    expect(topicLabel({ source: null, topic: null, artist: null, artistHot: false })).toBeNull()
  })
})

describe('出題對話框的來源與 payload（design §1「出題（選題庫）」；architecture §4 SongSourcePayload）', () => {
  it('三選一：歌手／台灣熱門／西洋熱門（榜單文字用 SOURCE_TITLE），預設歌手', () => {
    expect(SOURCE_OPTIONS.map((o) => [o.id, o.label])).toEqual([
      ['artist', '歌手'],
      ['tw-hot', '台灣熱門'],
      ['western-hot', '西洋熱門'],
    ])
    expect(SOURCE_OPTIONS[1]?.label).toBe(SOURCE_TITLE['tw-hot'])
    expect(DEFAULT_SOURCE).toBe('artist')
    expect(SOURCE_GROUP_LABEL).toBe('題庫來源')
    expect(isChartSource('artist')).toBe(false)
    expect(isChartSource('tw-hot')).toBe(true)
    expect(isChartSource('western-hot')).toBe(true)
  })

  it('榜單模式的說明（數字由 CHART_SIZE、SONGS_PER_GAME 推導）', () => {
    expect(CHART_NOTES['tw-hot']).toBe('從今天的 Apple Music 台灣熱門 100 首隨機抽 5 首')
    expect(CHART_NOTES['western-hot']).toBe('從今天的 Apple Music 美國熱門 100 首隨機抽 5 首')
    expect(CHART_NOTES['tw-hot']).toContain(`${CHART_SIZE} 首隨機抽 ${SONGS_PER_GAME} 首`)
  })

  it('送出的 payload 三種：歌手帶 artist 與 hot、榜單只有 source', () => {
    expect(sourcePayload('artist', '孫燕姿', true)).toEqual({ source: 'artist', artist: '孫燕姿', hot: true })
    expect(sourcePayload('artist', ' Jay Chou ', false)).toEqual({ source: 'artist', artist: ' Jay Chou ', hot: false })
    // 榜單模式即使欄位裡還留著字，也不送 artist／hot
    expect(sourcePayload('tw-hot', '孫燕姿', true)).toEqual({ source: 'tw-hot' })
    expect(sourcePayload('western-hot', '', false)).toEqual({ source: 'western-hot' })
  })

  it('送出選項的文字：歌手「搜尋並開始」→ 送出中「搜尋中…」；榜單「抽歌並開始」→ 送出中「取得排行榜…」', () => {
    expect(submitLabel('artist', false)).toBe(ARTIST_SUBMIT_LABEL)
    expect(submitLabel('artist', true)).toBe('搜尋中…')
    expect(submitLabel('tw-hot', false)).toBe(CHART_SUBMIT_LABEL)
    expect(submitLabel('western-hot', true)).toBe('取得排行榜…')
    expect(CHART_LOADING_LABEL).toBe('取得排行榜…')
    expect(HOT_TOGGLE_LABEL).toBe('只抽熱門歌')
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
