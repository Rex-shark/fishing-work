// 比賽歷史的呈現（features/history/historyDisplay 與 HistoryView；Epic 17；spec/draw-contest/design.md §2「歷史檢視」列、§3.1）：
//   可開的時機（白名單）、建檔時間格式、清單列文字、回合狀態列文字（含隨機評分）、存檔 → 揭曉畫廊的卡片（標「你」、沒有產生中、沒存到圖的是空白）、
//   HistoryView／HistoryStatus 的靜態渲染（重用 RevealView）。
// 靜態渲染下 Zustand 只給初始狀態，所以 historyStore 以可變的假狀態代入（同 busyFocus.test.tsx 的做法）；store 本身在 historyStore.test.ts 驗。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import type { ContestPhase, ResultEntry } from '@fishing-work/shared/draw-contest'
import { HISTORY_MAX, type HistoryRecord } from '../src/features/history/historyDb'
import {
  canViewHistory,
  formatSavedAt,
  historyCards,
  historyMenuEntries,
  historyNotes,
  historyRowLabel,
} from '../src/features/history/historyDisplay'

const fake = vi.hoisted(() => ({
  state: { entries: [] as unknown[], open: null as { record: unknown; urls: ReadonlyMap<string, string> } | null },
}))
vi.mock('../src/features/history/historyStore', () => ({
  useHistoryStore: (selector: (s: typeof fake.state) => unknown) => selector(fake.state),
}))

const { HistoryStatus, HistoryView } = await import('../src/features/history/HistoryView')
const { PPT_TERMS_VIEW, PPT_VIEWS } = await import('../src/shells/ppt/pptViews')
const { ShellViewsContext } = await import('../src/shells/views')

const entry = (playerId: string, rank: number, patch: Partial<ResultEntry> = {}): ResultEntry => ({
  playerId,
  nickname: playerId,
  rank,
  score: 100 - rank,
  confidence: 0.5,
  judgedBy: 'ai',
  submitted: true,
  submittedAt: rank,
  comment: null,
  commentPending: false,
  ...patch,
})

/** 本機時區的 2026/10/12 14:03（測試不受執行環境時區影響） */
const SAVED_AT = new Date(2026, 9, 12, 14, 3, 30).getTime()

const record = (patch: Partial<HistoryRecord> = {}): HistoryRecord => ({
  id: 1000,
  savedAt: SAVED_AT,
  roundNo: 3,
  topic: '蘋果',
  judgeMode: 'ai',
  commentMode: 'ai',
  me: 'bob',
  results: [
    entry('alice', 1, { nickname: 'Alice', score: 87, comment: '還算可以啦' }),
    entry('bob', 2, { nickname: 'Bob', score: 74 }),
    entry('carol', 3, { nickname: 'Carol', score: 0, submitted: false, judgedBy: null, confidence: null, submittedAt: null }),
  ],
  images: {},
  ...patch,
})

beforeEach(() => {
  fake.state.entries = []
  fake.state.open = null
})

describe('canViewHistory：可以開啟（與繼續看）的白名單（plan 決策 7、7a）', () => {
  const can = (phase: ContestPhase, isSetter = false, joined = true) => canViewHistory({ joined, phase, isSetter })

  it('idle、ended、choosing（自己不是出題者）可以', () => {
    expect(can('idle')).toBe(true)
    expect(can('ended')).toBe(true)
    expect(can('choosing')).toBe(true)
    // ended 時上一回合的出題者仍是 isSetter（setterId 保留到下一次出題）：照樣可以
    expect(can('ended', true)).toBe(true)
    expect(can('idle', true)).toBe(true)
  })

  it('drawing、judging、自己正在出題不行；未加入不行', () => {
    expect(can('drawing')).toBe(false)
    expect(can('judging')).toBe(false)
    expect(can('choosing', true)).toBe(false)
    for (const phase of ['idle', 'choosing', 'drawing', 'judging', 'ended'] as const) expect(can(phase, false, false), phase).toBe(false)
  })
})

describe('formatSavedAt：月/日 時:分（本機時區）', () => {
  it('月、日不補零，時、分補零', () => {
    expect(formatSavedAt(SAVED_AT)).toBe('10/12 14:03')
    expect(formatSavedAt(new Date(2026, 0, 5, 9, 7).getTime())).toBe('1/5 09:07')
    expect(formatSavedAt(new Date(2026, 11, 31, 0, 0).getTime())).toBe('12/31 00:00')
    expect(formatSavedAt(new Date(2027, 1, 3, 23, 59, 59).getTime())).toBe('2/3 23:59')
  })
})

describe('清單列文字（design §3.1）', () => {
  it('「{題目} — {月/日 時:分} — 第一名 {暱稱}（{分}）」', () => {
    expect(historyRowLabel(record())).toBe('蘋果 — 10/12 14:03 — 第一名 Alice（87 分）')
  })

  it('第一名＝名次最前面的交卷者（不看陣列順序）；隨機評分不加註（只在回合狀態列加）', () => {
    const shuffled = record({ results: [entry('b', 2, { nickname: 'Bob' }), entry('a', 1, { nickname: 'Alice', score: 40, judgedBy: 'random' })] })
    expect(historyRowLabel(shuffled)).toBe('蘋果 — 10/12 14:03 — 第一名 Alice（40 分）')
  })

  it('沒有人交卷（存檔不會有，防呆）：「沒有人交卷」', () => {
    expect(historyRowLabel(record({ results: [entry('a', 1, { submitted: false })] }))).toBe('蘋果 — 10/12 14:03 — 沒有人交卷')
  })

  it(`historyMenuEntries：照傳入順序（最新在上）、最多 ${HISTORY_MAX} 列，每列 { id, label }`, () => {
    const records = Array.from({ length: 7 }, (_, i) => record({ id: 7000 - i * 1000, topic: `題目${7 - i}` }))
    const entries = historyMenuEntries(records)
    expect(entries).toHaveLength(HISTORY_MAX)
    expect(entries.map((e) => e.id)).toEqual([7000, 6000, 5000, 4000, 3000])
    expect(entries[0]).toEqual({ id: 7000, label: '題目7 — 10/12 14:03 — 第一名 Alice（87 分）' })
    expect(historyMenuEntries([])).toEqual([])
  })
})

describe('回合狀態列文字（design §2「歷史檢視」列）', () => {
  it('「最近的簡報：蘋果（10/12 14:03）（全形空白）第一名：X（87 分）」（叫法來自殼層的 terms.recent）', () => {
    expect(historyNotes(record(), PPT_TERMS_VIEW)).toBe('最近的簡報：蘋果（10/12 14:03）　第一名：Alice（87 分）')
    expect(historyNotes(record(), { recent: '歷史' })).toBe('歷史：蘋果（10/12 14:03）　第一名：Alice（87 分）')
  })

  it('存檔為隨機評分時加「（隨機評分）」', () => {
    const random = record({ judgeMode: 'random', results: [entry('alice', 1, { nickname: 'Alice', score: 55, judgedBy: 'random' })] })
    expect(historyNotes(random, PPT_TERMS_VIEW)).toBe('最近的簡報：蘋果（10/12 14:03）　第一名：Alice（55 分）（隨機評分）')
  })
})

describe('historyCards：存檔 → 揭曉畫廊的卡片', () => {
  const urls = new Map([['alice', 'blob:test/alice']])

  it('排序、名次、分數、前三名照揭曉畫廊；「你」看存檔的 me（不是現在的自己）', () => {
    const cards = historyCards(record(), urls, PPT_TERMS_VIEW)
    expect(cards.map((c) => [c.playerId, c.mark, c.scoreText, c.podium, c.isMe])).toEqual([
      ['alice', '①', '87 分', true, false],
      ['bob', '②', '74 分', true, true],
      ['carol', '③', '未儲存', false, false],
    ])
    expect(cards[1]?.summary).toBe('第 2 名 Bob，74 分，你')
    expect(historyCards(record({ me: null }), urls, PPT_TERMS_VIEW).some((c) => c.isMe)).toBe(false)
    expect(historyCards(record({ me: 'spectator' }), urls, PPT_TERMS_VIEW).some((c) => c.isMe)).toBe(false)
  })

  it('評語：有字就顯示，沒有就沒有那一行；存檔沒有「產生中」（就算資料裡 commentPending 是 true 也不顯示）', () => {
    const cards = historyCards(record(), urls, PPT_TERMS_VIEW)
    expect(cards.map((c) => c.comment)).toEqual([{ kind: 'text', text: '還算可以啦' }, null, null])
    const stale = record({ results: [entry('alice', 1, { commentPending: true }), entry('bob', 2, { comment: '雜魚～', commentPending: true })] })
    expect(historyCards(stale, urls, PPT_TERMS_VIEW).map((c) => c.comment)).toEqual([null, { kind: 'text', text: '雜魚～' }])
    for (const c of historyCards(stale, urls, PPT_TERMS_VIEW)) expect(c.comment?.kind).not.toBe('pending')
  })

  it('圖片：有 URL 就顯示；交卷了但沒存到圖的是空白（不顯示「載入中」）；未交卷空白', () => {
    const cards = historyCards(record(), urls, PPT_TERMS_VIEW)
    expect(cards.map((c) => c.image)).toEqual([{ kind: 'image', url: 'blob:test/alice' }, { kind: 'blank' }, { kind: 'blank' }])
    expect(historyCards(record(), new Map(), PPT_TERMS_VIEW).every((c) => c.image.kind === 'blank')).toBe(true)
  })

  it('不改存檔本身', () => {
    const source = record({ results: [entry('alice', 1, { commentPending: true })] })
    historyCards(source, urls, PPT_TERMS_VIEW)
    expect(source.results[0]?.commentPending).toBe(true)
  })
})

// ─── 元件（靜態渲染） ─────────────────────────────────────────────────

const withViews = (node: ReactNode) => renderToStaticMarkup(<ShellViewsContext.Provider value={PPT_VIEWS}>{node}</ShellViewsContext.Provider>)

describe('HistoryView：以揭曉畫廊顯示開著的那一筆（design §3.1）', () => {
  it('沒有開著的歷史：不渲染', () => {
    expect(withViews(<HistoryView />)).toBe('')
  })

  it('網格照名次排列，一人一張；無障礙名稱用殼層的畫廊叫法；自己當時那張底色標示', () => {
    fake.state.open = { record: record(), urls: new Map([['alice', 'blob:test/alice']]) }
    const html = withViews(<HistoryView />)
    expect(html).toMatch(/<ol aria-label="投影片瀏覽"/)
    expect([...html.matchAll(/data-reveal="([^"]+)"/g)].map((m) => m[1])).toEqual(['alice', 'bob', 'carol'])
    const items = html.match(/<li class="[^"]*">/g) ?? []
    expect(items.map((li) => li.includes('bg-active'))).toEqual([false, true, false])
    expect(html).toContain('aria-label="第 2 名 Bob，74 分，你（放大）"')
  })

  it('圖片用存檔的 object URL；沒存到圖的不是「載入中」；評語只在有字時顯示、沒有「正在寫評語」', () => {
    fake.state.open = {
      record: record({ results: [entry('alice', 1, { nickname: 'Alice', comment: '還算可以啦' }), entry('bob', 2, { nickname: 'Bob', commentPending: true })] }),
      urls: new Map([['alice', 'blob:test/alice']]),
    }
    const html = withViews(<HistoryView />)
    expect(html.match(/<img /g)).toHaveLength(1)
    expect(html).toContain('<img src="blob:test/alice" alt="Alice 的畫"')
    expect(html).not.toContain('載入中')
    expect(html.match(/data-reveal-comment="text"/g)).toHaveLength(1)
    expect(html).toContain('<span class="italic">還算可以啦</span>')
    expect(html).not.toContain('data-reveal-comment="pending"')
    expect(html).not.toContain('正在寫評語')
  })

  it('沒有另外加標籤或按鈕（關閉的按鈕在殼層的狀態列）', () => {
    fake.state.open = { record: record(), urls: new Map() }
    const html = withViews(<HistoryView />)
    expect(html.match(/<button /g)).toHaveLength(3)
    expect(html).not.toMatch(/關閉|最近/)
  })
})

describe('HistoryStatus：檢視時的回合狀態列', () => {
  it('沒有開著的歷史：不渲染', () => {
    expect(withViews(<HistoryStatus />)).toBe('')
  })

  it('一行摘要（role=status）、過長截斷；文字＝historyNotes', () => {
    fake.state.open = { record: record(), urls: new Map() }
    const html = withViews(<HistoryStatus />)
    expect(html).toMatch(/^<div role="status" aria-live="polite"/)
    expect(html).toContain('<span class="min-w-0 truncate">最近的簡報：蘋果（10/12 14:03）　第一名：Alice（87 分）</span>')
  })
})
