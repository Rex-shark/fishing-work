// 像不像比賽的揭曉與歷史（Epic 20；plan/contest-mimic.md 決策 7、12；design §2、§3、§3.1）：
//   揭曉畫廊第一格是參考圖卡（標題「參考圖」、無名次分數評語、data-reveal-reference 不帶 data-reveal、「參考圖（放大）」／「參考圖（回到全部）」），
//   名次卡在後、results 不含它；備忘稿列 mimic 回合題目後加「（像不像）」（idle「上一回合：」、choosing、ended）；
//   歷史存檔含 reference（Blob | null；舊存檔沒有這一欄視為 null）、紀錄器先記著 drawing 就到的參考圖、建檔後才到的補進去；
//   回看時第一格同樣是參考圖卡（object URL 開啟時建、關閉時 revoke）。
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ResultEntry, RoomSnapshot, RoundPublic } from '@fishing-work/shared/draw-contest'
import { HISTORY_DB_NAME, createMemoryHistoryDb, withReference, type HistoryRecord } from '../src/features/history/historyDb'
import { historyCards } from '../src/features/history/historyDisplay'
import {
  closeHistory,
  createHistoryRecorder,
  historySettled,
  mergeRecord,
  openHistory,
  recordFromRound,
  recordReferenceImage,
  refreshHistory,
  startHistory,
  useHistoryStore,
} from '../src/features/history/historyStore'
import { RevealView, ZoomedReference } from '../src/features/reveal/Reveal'
import { REFERENCE_CARD_ATTR, referenceCard, revealCards } from '../src/features/reveal/revealView'
import { MIMIC_TOPIC_TAG, lastRoundSummary, notesText, resultSummary, roundNotes } from '../src/features/round/roundDisplay'
import { PPT_TERMS_VIEW } from '../src/shells/ppt/pptViews'
import { initialGameState, initialRound, useGameStore } from '../src/store/game'

const entry = (playerId: string, rank: number, patch: Partial<ResultEntry> = {}): ResultEntry => ({
  playerId,
  nickname: playerId.toUpperCase(),
  rank,
  score: 90 - rank * 10,
  confidence: 0.5,
  judgedBy: 'ai',
  submitted: true,
  submittedAt: rank,
  comment: null,
  commentPending: false,
  ...patch,
})
const results = [entry('a', 1), entry('b', 2)]
const gallery = new Map([
  ['a', 'blob:a'],
  ['b', 'blob:b'],
])
const round = (patch: Partial<RoundPublic>): RoundPublic => ({ ...initialRound, ...patch })
const jpegBytes = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer
const jpegBlob = () => new Blob([jpegBytes()], { type: 'image/jpeg' })

describe('揭曉：第一格是參考圖卡（RevealView 靜態渲染）', () => {
  const cards = revealCards(results, gallery, 'b', PPT_TERMS_VIEW)
  const html = renderToStaticMarkup(<RevealView cards={cards} label="投影片瀏覽" reference={referenceCard('blob:ref')} />)
  const items = [...html.matchAll(/<li [^>]*>[\s\S]*?<\/li>/g)].map((m) => m[0])

  it('referenceCard：kind reference、標題「參考圖」；沒有 URL 時揭曉為「載入中」、歷史為空白', () => {
    expect(referenceCard('blob:ref')).toEqual({ kind: 'reference', title: '參考圖', image: { kind: 'image', url: 'blob:ref' }, label: '參考圖' })
    expect(referenceCard(null).image).toEqual({ kind: 'loading' })
    expect(referenceCard(null, 'blank').image).toEqual({ kind: 'blank' })
    expect(REFERENCE_CARD_ATTR).toBe('data-reveal-reference')
  })

  it('第一格是參考圖卡，之後依名次；名次卡數＝results 數（參考圖不在 results 裡）', () => {
    expect(items).toHaveLength(3)
    expect(items[0]).toContain('data-reveal-reference=""')
    expect(items[1]).toContain('data-reveal="a"')
    expect(items[2]).toContain('data-reveal="b"')
    expect(html.match(/data-reveal="/g)).toHaveLength(results.length)
  })

  it('參考圖卡：按鈕帶 data-reveal-reference 而不帶 data-reveal；aria-label「參考圖（放大）」；標題「參考圖」；沒有名次、分數、評語', () => {
    const card = items[0] ?? ''
    expect(card).not.toMatch(/data-reveal=/)
    expect(card).toMatch(/<button type="button" data-reveal-reference="" aria-label="參考圖（放大）"/)
    expect(card).toContain('>參考圖</span>')
    expect(card).not.toMatch(/①|分<|未儲存|data-reveal-comment/)
    expect(card).toMatch(/<img src="blob:ref" alt="參考圖"[^>]*object-contain/)
    // 16:9、--bg-editor 底、1px --border
    expect(card).toMatch(/class="[^"]*aspect-video[^"]*bg-editor[^"]*outline-1 outline-border/)
  })

  it('AI 遊玩技能的讀法：以「第 N 名」開頭的 button[data-reveal] 正好是名次卡', () => {
    const labels = [...html.matchAll(/<button [^>]*?(data-reveal(?:-reference)?)="[^"]*" aria-label="([^"]+)"/g)].map((m) => [m[1], m[2]])
    expect(labels).toEqual([
      ['data-reveal-reference', '參考圖（放大）'],
      ['data-reveal', '第 1 名 A，80 分（放大）'],
      ['data-reveal', '第 2 名 B，70 分，你（放大）'],
    ])
  })

  it('沒有 reference（topic 回合）：輸出與 Epic 20 前相同', () => {
    const plain = renderToStaticMarkup(<RevealView cards={cards} label="投影片瀏覽" />)
    expect(renderToStaticMarkup(<RevealView cards={cards} label="投影片瀏覽" reference={null} />)).toBe(plain)
    expect(plain).not.toContain('參考圖')
  })

  it('圖還沒到：參考圖卡灰底「載入中」', () => {
    const loading = renderToStaticMarkup(<RevealView cards={cards} label="投影片瀏覽" reference={referenceCard(null)} />)
    expect(loading).toMatch(/data-reveal-reference[\s\S]*?>載入中</)
  })

  it('放大檢視：「參考圖（回到全部）」、預設焦點、沒有評語行', () => {
    const zoom = renderToStaticMarkup(<ZoomedReference card={referenceCard('blob:ref')} onClose={() => {}} />)
    expect(zoom).toMatch(/<button type="button" autofocus="" data-reveal-reference="" aria-label="參考圖（回到全部）"/)
    expect(zoom).not.toContain('data-reveal-comment')
    expect(zoom).toContain('w-[min(100cqw,calc((100cqh-28px)*16/9))]')
  })

  it('Reveal 接 store：lastMode 為 mimic 才給參考圖卡、圖用 selectReferenceUrl（原始碼守門；靜態渲染讀不到 store 的目前狀態）', () => {
    const source = Object.values(import.meta.glob<string>('../src/features/reveal/Reveal.tsx', { query: '?raw', import: 'default', eager: true }))[0] ?? ''
    expect(source).toContain("const mimic = useGameStore((s) => s.round.lastMode === 'mimic')")
    expect(source).toContain('const referenceUrl = useGameStore(selectReferenceUrl)')
    expect(source).toContain('reference={mimic ? referenceCard(referenceUrl) : null}')
  })
})

describe('備忘稿列：像不像比賽題目後加「（像不像）」', () => {
  const terms = { topic: '標題', save: '儲存' }
  const base = { results, lastTopic: '皮卡丘' }

  it('ended、idle（上一回合）、choosing（上一回合摘要）都加；topic 回合與 null 不加', () => {
    expect(MIMIC_TOPIC_TAG).toBe('（像不像）')
    expect(resultSummary({ ...base, lastMode: 'mimic' })).toBe('皮卡丘（像不像）　第一名：A（80 分）')
    expect(resultSummary({ ...base, lastMode: 'topic' })).toBe('皮卡丘　第一名：A（80 分）')
    expect(resultSummary(base)).toBe('皮卡丘　第一名：A（80 分）')
    expect(lastRoundSummary({ ...base, lastMode: 'mimic' })).toBe('上一回合：皮卡丘（像不像）　第一名：A（80 分）')
    const notes = (r: Partial<RoundPublic>) =>
      notesText(roundNotes({ round: round({ ...base, ...r }), isSetter: false, isParticipant: false, setterName: 'X', remaining: null }, terms))
    expect(notes({ phase: 'ended', lastMode: 'mimic' })).toBe('皮卡丘（像不像）　第一名：A（80 分）')
    expect(notes({ phase: 'idle', lastMode: 'mimic' })).toBe('上一回合：皮卡丘（像不像）　第一名：A（80 分）')
    expect(notes({ phase: 'choosing', lastMode: 'mimic' })).toContain('上一回合：皮卡丘（像不像）　第一名')
    expect(notes({ phase: 'ended', lastMode: 'topic' })).toBe('皮卡丘　第一名：A（80 分）')
  })

  it('隨機評分與沒有人交卷照舊接在後面', () => {
    expect(resultSummary({ results: [entry('a', 1, { judgedBy: 'random' })], lastTopic: '貓', lastMode: 'mimic' })).toBe(
      '貓（像不像）　第一名：A（80 分）（隨機評分）',
    )
    expect(resultSummary({ results: [entry('a', 1, { submitted: false })], lastTopic: '貓', lastMode: 'mimic' })).toBe('貓（像不像）　沒有人交卷')
  })

  it('作畫中的列不變（「標題：皮卡丘」，沒有「（像不像）」）', () => {
    const segs = roundNotes(
      { round: round({ phase: 'drawing', topic: '皮卡丘', mode: 'mimic', participantIds: ['me'] }), isSetter: false, isParticipant: true, setterName: null, remaining: 90 },
      terms,
    )
    expect(notesText(segs)).toBe('作畫中 01:30  標題：皮卡丘  已儲存 0/1')
  })
})

// ─── 歷史 ──────────────────────────────────────────────────────────

const mimicEnded = (n: number, patch: Partial<RoundPublic> = {}): RoundPublic =>
  round({
    roundNo: n,
    phase: 'ended',
    setterId: 'a',
    mode: 'mimic',
    startedAt: n * 1000,
    participantIds: ['a', 'b'],
    submittedCount: 2,
    judgedCount: 2,
    judgeMode: 'ai',
    commentMode: 'ai',
    results,
    lastTopic: `題目${n}`,
    lastMode: 'mimic',
    ...patch,
  })

function recorderSetup(initial: HistoryRecord[] = []) {
  const db = createMemoryHistoryDb(initial)
  const recorder = createHistoryRecorder({ db, now: () => 5000, onSaved: () => {}, warn: () => {} })
  return { db, recorder }
}

describe('歷史存檔：reference 欄位與舊存檔相容', () => {
  it('recordFromRound 預設 reference null；mergeRecord：已有的參考圖不被 null 蓋掉，沒有才補上', () => {
    const blob = jpegBlob()
    const plain = recordFromRound(mimicEnded(1), 'b', 1000, 5000)
    expect(plain.reference).toBeNull()
    const withRef = recordFromRound(mimicEnded(1), 'b', 1000, 5000, blob)
    expect(withRef.reference).toBe(blob)
    expect(mergeRecord(withRef, plain).reference).toBe(blob)
    expect(mergeRecord(withRef, plain)).toBe(withRef)
    expect(mergeRecord(plain, withRef).reference).toBe(blob)
  })

  it('舊存檔（Epic 20 前，沒有 reference 欄位）讀出時視為 null；資料庫名稱與版本不變', async () => {
    const { reference: _drop, ...old } = recordFromRound(mimicEnded(1, { mode: 'topic', lastMode: 'topic' }), 'b', 1000, 5000)
    void _drop
    const legacy = old as unknown as HistoryRecord
    expect('reference' in legacy).toBe(false)
    expect(withReference(legacy).reference).toBeNull()
    const kept = recordFromRound(mimicEnded(2), 'b', 2000, 6000, jpegBlob())
    expect(withReference(kept)).toBe(kept)
    const db = createMemoryHistoryDb([legacy])
    expect((await db.getAll())[0]?.reference).toBeNull()
    let seen: HistoryRecord | undefined
    await db.update(1000, (existing) => {
      seen = existing
      return null
    })
    expect(seen?.reference).toBeNull()
    expect(HISTORY_DB_NAME).toBe('fishing-work:draw-contest')
  })

  it('紀錄器：drawing 就到的參考圖先記著，mimic 回合 ended 建檔時一起存', async () => {
    const t = recorderSetup()
    t.recorder.reference({ roundNo: 1, jpeg: jpegBytes() })
    t.recorder.round(mimicEnded(1), 'b')
    await t.recorder.settled()
    const [row] = await t.db.getAll()
    expect(row?.reference).toBeInstanceOf(Blob)
    expect(row?.reference?.type).toBe('image/jpeg')
    expect(row?.reference?.size).toBe(4)
  })

  it('紀錄器：建檔後才到的參考圖（中途加入的補送）補進那一筆；別的回合的不補', async () => {
    const t = recorderSetup()
    t.recorder.round(mimicEnded(2), 'b')
    await t.recorder.settled()
    expect((await t.db.getAll())[0]?.reference).toBeNull()
    t.recorder.reference({ roundNo: 1, jpeg: jpegBytes() })
    await t.recorder.settled()
    expect((await t.db.getAll())[0]?.reference).toBeNull()
    t.recorder.reference({ roundNo: 2, jpeg: jpegBytes() })
    await t.recorder.settled()
    expect((await t.db.getAll())[0]?.reference).toBeInstanceOf(Blob)
  })

  it('紀錄器：topic 回合不存參考圖（即使手上有同 roundNo 的舊圖，例如 server 重啟後 roundNo 重複）', async () => {
    const t = recorderSetup()
    t.recorder.reference({ roundNo: 1, jpeg: jpegBytes() })
    t.recorder.round(mimicEnded(1, { mode: 'topic', lastMode: 'topic' }), 'b')
    await t.recorder.settled()
    expect((await t.db.getAll())[0]?.reference).toBeNull()
  })

  it('socket 的 contest:reference 會交給歷史（原始碼守門）', () => {
    const source = Object.values(import.meta.glob<string>('../src/socket/client.ts', { query: '?raw', import: 'default', eager: true }))[0] ?? ''
    expect(source).toMatch(/socket\.on\('contest:reference', \(image\) => \{[\s\S]*?store\(\)\.setReference\(image\)\s*recordReferenceImage\(image\)/)
  })
})

describe('歷史回看：第一格參考圖卡、object URL 的建立與 revoke', () => {
  let created: MockInstance<typeof URL.createObjectURL>
  let revoked: MockInstance<typeof URL.revokeObjectURL>
  let stop: (() => void) | null = null
  const snapshot = (): RoomSnapshot => ({ you: 'b', players: [], round: initialRound, chat: [] })

  beforeEach(() => {
    useGameStore.setState({ ...initialGameState, gallery: new Map(), reference: null })
    useHistoryStore.setState({ entries: [], open: null })
    let seq = 0
    created = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test/${++seq}`)
    revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  })

  afterEach(() => {
    stop?.()
    stop = null
    vi.restoreAllMocks()
  })

  async function ready(records: HistoryRecord[]) {
    stop = startHistory({ db: createMemoryHistoryDb(records), now: () => 5000, warn: () => {} })
    useGameStore.getState().applySnapshot(snapshot())
    await historySettled()
    await refreshHistory()
    created.mockClear()
  }

  it('有參考圖的存檔：開啟時建參考圖 URL，關閉時連同畫一起 revoke', async () => {
    const record = { ...recordFromRound(mimicEnded(1), 'b', 1000, 1, jpegBlob()), images: { a: new Blob(['a'], { type: 'image/png' }) } }
    await ready([record])
    openHistory(1000)
    const open = useHistoryStore.getState().open
    expect(open?.urls.get('a')).toBe('blob:test/1')
    expect(open?.referenceUrl).toBe('blob:test/2')
    closeHistory()
    expect(revoked.mock.calls.map((c) => c[0]).sort()).toEqual(['blob:test/1', 'blob:test/2'])
  })

  it('一般回合與舊存檔：referenceUrl 為 null、不多建 URL', async () => {
    const { reference: _drop, ...legacy } = recordFromRound(mimicEnded(2, { mode: 'topic', lastMode: 'topic' }), 'b', 2000, 2)
    void _drop
    await ready([legacy as unknown as HistoryRecord])
    openHistory(2000)
    expect(useHistoryStore.getState().open?.referenceUrl).toBeNull()
    expect(created).not.toHaveBeenCalled()
  })

  it('HistoryView：存檔有 reference 時第一格是參考圖卡（沒建出 URL 時空白、不顯示「載入中」）', () => {
    const source = Object.values(import.meta.glob<string>('../src/features/history/HistoryView.tsx', { query: '?raw', import: 'default', eager: true }))[0] ?? ''
    expect(source).toContain("open.record.reference !== null ? referenceCard(open.referenceUrl, 'blank') : null")
    const record = recordFromRound(mimicEnded(1), 'b', 1000, 1, jpegBlob())
    const html = renderToStaticMarkup(
      <RevealView cards={historyCards(record, new Map(), PPT_TERMS_VIEW)} label="投影片瀏覽" reference={referenceCard(null, 'blank')} />,
    )
    expect(html.indexOf('data-reveal-reference')).toBeLessThan(html.indexOf('data-reveal="a"'))
    expect(html).not.toContain('載入中')
  })

  it('socket/client 呼叫 recordReferenceImage 的介面存在（store 以外的原始 bytes 交給歷史）', () => {
    expect(typeof recordReferenceImage).toBe('function')
  })
})
