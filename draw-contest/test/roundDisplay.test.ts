// 回合狀態的呈現（features/round/roundDisplay；spec/draw-contest/design.md §2）
import { describe, expect, it } from 'vitest'
import { MIN_PLAYERS, type ResultEntry, type RoundPublic } from '@fishing-work/shared/draw-contest'
import { PPT_TERMS_VIEW } from '../src/shells/ppt/pptViews'
import { initialRound } from '../src/store/game'
import {
  PHASE_LABEL,
  WARNING_SECONDS,
  canVolunteer,
  countConnected,
  isCountdownWarning,
  judgingProgress,
  lastRoundSummary,
  myResult,
  notesText,
  resultSummary,
  roundNotes,
  type NotesInput,
  submittedProgress,
  volunteerAriaLabel,
  winnerSummary,
} from '../src/features/round/roundDisplay'

const entry = (patch: Partial<ResultEntry>): ResultEntry => ({
  playerId: 'p1',
  nickname: 'Alice',
  rank: 1,
  score: 87,
  confidence: 0.6,
  judgedBy: 'ai',
  submitted: true,
  submittedAt: 1,
  comment: null,
  commentPending: false,
  ...patch,
})

describe('PHASE_LABEL', () => {
  it('五個階段', () => {
    expect(PHASE_LABEL).toEqual({ idle: '等待中', choosing: '出題中', drawing: '作畫中', judging: '評分中', ended: '揭曉' })
  })
})

describe('canVolunteer / countConnected：「我出題」顯示條件', () => {
  it('只算連線中的玩家', () => {
    expect(countConnected([{ connected: true }, { connected: false }, { connected: true }])).toBe(2)
    expect(countConnected([])).toBe(0)
  })

  it('idle 與 ended（視同 idle）且在線人數 ≥ MIN_PLAYERS 才顯示', () => {
    expect(canVolunteer('idle', MIN_PLAYERS)).toBe(true)
    expect(canVolunteer('ended', MIN_PLAYERS + 3)).toBe(true)
    expect(canVolunteer('idle', MIN_PLAYERS - 1)).toBe(false)
    expect(canVolunteer('ended', MIN_PLAYERS - 1)).toBe(false)
  })

  it('出題、作畫、評分中一律不顯示', () => {
    for (const phase of ['choosing', 'drawing', 'judging'] as const) expect(canVolunteer(phase, 10)).toBe(false)
  })

  it('無障礙名稱以可見文字開頭', () => {
    expect(volunteerAriaLabel('從目前投影片開始')).toBe('從目前投影片開始：我出題')
  })
})

describe('進度與揭曉摘要', () => {
  it('已儲存 n/m（m＝參賽者數）', () => {
    expect(submittedProgress({ submittedCount: 3, participantIds: ['a', 'b', 'c', 'd'] }, PPT_TERMS_VIEW)).toBe('已儲存 3/4')
    // 「儲存」是殼層的叫法
    expect(submittedProgress({ submittedCount: 1, participantIds: ['a', 'b'] }, { save: '交' })).toBe('已交 1/2')
  })

  it('正在評分 n/m…；隨機評分加註', () => {
    expect(judgingProgress({ judgedCount: 2, submittedCount: 5, judgeMode: 'ai' })).toBe('正在評分 2/5…')
    expect(judgingProgress({ judgedCount: 2, submittedCount: 5, judgeMode: 'random' })).toBe('正在評分 2/5…（隨機評分）')
  })

  it('第一名摘要；隨機評分加註；沒有人交卷', () => {
    expect(winnerSummary([entry({})])).toBe('第一名：Alice（87 分）')
    expect(winnerSummary([entry({ judgedBy: 'random' })])).toBe('第一名：Alice（87 分）（隨機評分）')
    expect(winnerSummary([entry({ submitted: false, score: 0, judgedBy: null })])).toBe('沒有人交卷')
    expect(winnerSummary([])).toBe('沒有人交卷')
  })

  it('myResult：找自己那筆；旁觀或沒有結果為 undefined', () => {
    const results = [entry({}), entry({ playerId: 'p2', rank: 2 })]
    expect(myResult(results, 'p2')?.rank).toBe(2)
    expect(myResult(results, 'p9')).toBeUndefined()
    expect(myResult(null, 'p1')).toBeUndefined()
    expect(myResult(results, null)).toBeUndefined()
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

describe('roundNotes：備忘稿列各階段文字（design §2 逐列）', () => {
  const round = (patch: Partial<RoundPublic>): RoundPublic => ({ ...initialRound, ...patch })
  const input = (patch: Partial<NotesInput> & { round: RoundPublic }): NotesInput => ({
    isSetter: false,
    isParticipant: true,
    setterName: 'Bob',
    remaining: null,
    ...patch,
  })
  const text = (i: NotesInput) => notesText(roundNotes(i, PPT_TERMS_VIEW))
  const results = [entry({}), entry({ playerId: 'p2', nickname: 'Bob', rank: 2, score: 40 })]
  const randomResults = [entry({ judgedBy: 'random' })]

  it('idle 無結果：「上一回合：—」', () => {
    expect(text(input({ round: round({ phase: 'idle' }) }))).toBe('上一回合：—')
  })

  it('idle 有結果：上一回合題目（lastTopic）放在第一名前面；隨機評分加註；沒有題目時退回 design 原文', () => {
    expect(text(input({ round: round({ phase: 'idle', results, lastTopic: '蘋果' }) }))).toBe('上一回合：蘋果　第一名：Alice（87 分）')
    expect(text(input({ round: round({ phase: 'idle', results: randomResults, lastTopic: '蘋果' }) }))).toBe(
      '上一回合：蘋果　第一名：Alice（87 分）（隨機評分）',
    )
    expect(lastRoundSummary({ results, lastTopic: null })).toBe('上一回合第一名：Alice（87 分）')
    expect(lastRoundSummary({ results: [], lastTopic: '貓' })).toBe('上一回合：貓　沒有人交卷')
  })

  it('choosing：出題者「正在輸入標題… 00:45」、其他人「X 正在輸入標題… 00:45」', () => {
    const r = round({ phase: 'choosing' })
    expect(text(input({ round: r, isSetter: true, remaining: 45 }))).toBe('正在輸入標題… 00:45')
    expect(text(input({ round: r, remaining: 45 }))).toBe('Bob 正在輸入標題… 00:45')
    expect(text(input({ round: r, setterName: null, remaining: 45 }))).toBe('出題者 正在輸入標題… 00:45')
  })

  it('choosing 且有上一回合結果：接在後面顯示上一回合（窄螢幕可省略）', () => {
    const segs = roundNotes(input({ round: round({ phase: 'choosing', results, lastTopic: '蘋果' }), remaining: 50 }), PPT_TERMS_VIEW)
    expect(notesText(segs)).toBe('Bob 正在輸入標題… 00:50  上一回合：蘋果　第一名：Alice（87 分）')
    expect(segs[1]?.optional).toBe(true)
  })

  it('drawing 參賽者：「作畫中 01:23  標題：蘋果  已儲存 3/8」', () => {
    const r = round({ phase: 'drawing', topic: '蘋果', submittedCount: 3, participantIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] })
    expect(text(input({ round: r, remaining: 83 }))).toBe('作畫中 01:23  標題：蘋果  已儲存 3/8')
  })

  it('drawing 旁觀者：題目那段改為「本回合旁觀：蘋果」', () => {
    const r = round({ phase: 'drawing', topic: '蘋果', submittedCount: 1, participantIds: ['a', 'b'] })
    expect(text(input({ round: r, isParticipant: false, remaining: 60 }))).toBe('作畫中 01:00  本回合旁觀：蘋果  已儲存 1/2')
  })

  it('drawing 最後 10 秒倒數為警示（--sem-warning）；11 秒以上不是', () => {
    const r = round({ phase: 'drawing', topic: '蘋果', participantIds: ['a'] })
    expect(roundNotes(input({ round: r, remaining: 10 }), PPT_TERMS_VIEW)[0]?.clock).toEqual({ text: '00:10', warning: true, seconds: 10 })
    expect(roundNotes(input({ round: r, remaining: 0 }), PPT_TERMS_VIEW)[0]?.clock?.warning).toBe(true)
    expect(roundNotes(input({ round: r, remaining: 11 }), PPT_TERMS_VIEW)[0]?.clock?.warning).toBe(false)
  })

  it('judging：「正在評分 5/8…」；退回隨機時加「（隨機評分）」', () => {
    expect(text(input({ round: round({ phase: 'judging', judgedCount: 5, submittedCount: 8, judgeMode: 'ai' }) }))).toBe('正在評分 5/8…')
    expect(text(input({ round: round({ phase: 'judging', judgedCount: 5, submittedCount: 8, judgeMode: 'random' }) }))).toBe(
      '正在評分 5/8…（隨機評分）',
    )
  })

  it('ended（2026-10-12 起帶題目）：「蘋果　第一名：X（87 分）」；隨機評分加註；沒有人交卷', () => {
    expect(text(input({ round: round({ phase: 'ended', results, lastTopic: '蘋果' }) }))).toBe('蘋果　第一名：Alice（87 分）')
    expect(text(input({ round: round({ phase: 'ended', results: randomResults, lastTopic: '蘋果' }) }))).toBe('蘋果　第一名：Alice（87 分）（隨機評分）')
    expect(text(input({ round: round({ phase: 'ended', results: [], lastTopic: '貓' }) }))).toBe('貓　沒有人交卷')
  })

  it('ended 沒有題目（lastTopic 為 null，理論上不會）：退回只有第一名的那一句（同改版前）', () => {
    expect(text(input({ round: round({ phase: 'ended', results }) }))).toBe('第一名：Alice（87 分）')
    expect(text(input({ round: round({ phase: 'ended', results: randomResults }) }))).toBe('第一名：Alice（87 分）（隨機評分）')
    expect(text(input({ round: round({ phase: 'ended', results: [] }) }))).toBe('沒有人交卷')
  })

  it('ended 與 idle（有結果）只差「上一回合：」前綴：分隔同為一個全形空白（U+3000），題目用 lastTopic 不是 topic', () => {
    for (const r of [results, randomResults, []]) {
      const ended = text(input({ round: round({ phase: 'ended', results: r, lastTopic: '蘋果' }) }))
      const idle = text(input({ round: round({ phase: 'idle', results: r, lastTopic: '蘋果' }) }))
      expect(idle).toBe(`上一回合：${ended}`)
      expect(ended.startsWith('蘋果\u3000')).toBe(true)
      expect(resultSummary({ results: r, lastTopic: '蘋果' })).toBe(ended)
    }
    // 契約上 ended 時 topic 仍是本回合題目、lastTopic 與 results 同進退；這裡故意給不同值，確認讀的是 lastTopic
    expect(text(input({ round: round({ phase: 'ended', results, topic: '香蕉', lastTopic: '蘋果' }) }))).toBe('蘋果　第一名：Alice（87 分）')
  })

  it('ended：只有一段、不是可省略段（窄螢幕也顯示）、沒有倒數；results 為 null（理論上不會）顯示「—」', () => {
    const segs = roundNotes(input({ round: round({ phase: 'ended', results, lastTopic: '蘋果' }) }), PPT_TERMS_VIEW)
    expect(segs).toEqual([{ text: '蘋果　第一名：Alice（87 分）' }])
    expect(text(input({ round: round({ phase: 'ended', results: null, lastTopic: null }) }))).toBe('—')
  })

  it('偽裝用語由殼層傳入（功能元件不寫死「標題」「儲存」）', () => {
    const terms = { topic: '題目', save: '交卷' }
    const r = round({ phase: 'drawing', topic: '貓', submittedCount: 0, participantIds: ['a'] })
    expect(notesText(roundNotes(input({ round: r, remaining: 5 }), terms))).toBe('作畫中 00:05  題目：貓  已交卷 0/1')
    expect(notesText(roundNotes(input({ round: round({ phase: 'choosing' }), isSetter: true, remaining: 3 }), terms))).toBe('正在輸入題目… 00:03')
  })
})
