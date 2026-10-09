// 揭曉畫廊（spec/draw-contest/design.md §3；features/reveal）：排序、名次記號、前三名、隨機標示、未儲存、載入中、自己高亮、網格版面，
// 以及 ppt 殼層的投影片區切換（SlideArea：投影片瀏覽／自己的畫布＋已儲存小字／空白投影片）與「完成」固定位置（Ribbon）。
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRef, type ReactNode } from 'react'
import type { ContestPhase, ResultEntry } from '@fishing-work/shared/draw-contest'
import { RevealView } from '../src/features/reveal/Reveal'
import { isPodium, rankMark, revealCards, revealImage, sortByRank } from '../src/features/reveal/revealView'
import { Ribbon, SlideArea } from '../src/shells/ppt/PptShell'
import { PPT_SAVED_CAPTION } from '../src/shells/ppt/pptLayout'
import { PPT_TERMS_VIEW } from '../src/shells/ppt/pptViews'
import type { ShellRoundState } from '../src/shells/types'
import { initialRound, selectShowReveal } from '../src/store/game'

const entry = (patch: Partial<ResultEntry> & Pick<ResultEntry, 'playerId' | 'nickname' | 'rank'>): ResultEntry => ({
  score: 50,
  confidence: 0.5,
  judgedBy: 'random',
  submitted: true,
  submittedAt: 1,
  ...patch,
})

// 故意亂序：排序以 rank 為準
const results: ResultEntry[] = [
  entry({ playerId: 'd', nickname: 'Dave', rank: 4, score: 40, judgedBy: 'ai' }),
  entry({ playerId: 'a', nickname: 'Alice', rank: 1, score: 87 }),
  entry({ playerId: 'e', nickname: 'Eve', rank: 5, score: 0, judgedBy: null, confidence: null, submitted: false, submittedAt: null }),
  entry({ playerId: 'b', nickname: 'Bob', rank: 2, score: 74 }),
  entry({ playerId: 'c', nickname: 'Carol', rank: 3, score: 61 }),
]
const gallery = new Map([
  ['a', 'blob:a'],
  ['b', 'blob:b'],
  ['d', 'blob:d'],
])

describe('純邏輯', () => {
  it('rankMark：1–3 為 ①②③，其餘數字', () => {
    expect([1, 2, 3, 4, 10].map(rankMark)).toEqual(['①', '②', '③', '4', '10'])
    expect(rankMark(0)).toBe('0')
  })

  it('sortByRank：依 rank 升冪、不改原陣列', () => {
    expect(sortByRank(results).map((r) => r.playerId)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(results[0]?.playerId).toBe('d')
  })

  it('isPodium：前三名且有交卷；未交卷排到第 3 也不高亮', () => {
    expect(isPodium({ rank: 1, submitted: true })).toBe(true)
    expect(isPodium({ rank: 3, submitted: true })).toBe(true)
    expect(isPodium({ rank: 4, submitted: true })).toBe(false)
    expect(isPodium({ rank: 3, submitted: false })).toBe(false)
  })

  it('revealImage：有圖／交卷了但圖還沒到（載入中）／未交卷（空白）', () => {
    expect(revealImage({ playerId: 'a', submitted: true }, gallery)).toEqual({ kind: 'image', url: 'blob:a' })
    expect(revealImage({ playerId: 'c', submitted: true }, gallery)).toEqual({ kind: 'loading' })
    expect(revealImage({ playerId: 'e', submitted: false }, gallery)).toEqual({ kind: 'blank' })
  })

  it('revealCards：名次記號、分數、隨機、未儲存（殼層叫法）、自己、完整說明', () => {
    const cards = revealCards(results, gallery, 'b', PPT_TERMS_VIEW)
    expect(cards.map((c) => [c.mark, c.nickname, c.scoreText, c.random, c.podium, c.isMe])).toEqual([
      ['①', 'Alice', '87 分', true, true, false],
      ['②', 'Bob', '74 分', true, true, true],
      ['③', 'Carol', '61 分', true, true, false],
      ['4', 'Dave', '40 分', false, false, false],
      ['5', 'Eve', '未儲存', false, false, false],
    ])
    expect(cards[1]?.label).toBe('第 2 名 Bob，74 分，隨機評分，你')
    expect(cards[4]?.label).toBe('第 5 名 Eve，未儲存')
    expect(revealCards(results, gallery, null, { save: '交卷' })[4]?.scoreText).toBe('未交卷')
  })

  it('selectShowReveal：idle／ended 且有結果；choosing（結果仍保留）與無結果不顯示', () => {
    const r = (phase: ContestPhase, res: ResultEntry[] | null) => ({
      round: { ...initialRound, phase, results: res },
    })
    expect(selectShowReveal(r('ended', results))).toBe(true)
    expect(selectShowReveal(r('idle', results))).toBe(true)
    expect(selectShowReveal(r('idle', null))).toBe(false)
    expect(selectShowReveal(r('choosing', results))).toBe(false)
    expect(selectShowReveal(r('drawing', null))).toBe(false)
  })
})

/** 取某位玩家的 <li>…</li> */
function card(html: string, id: string): string {
  const at = html.indexOf(`data-reveal="${id}"`)
  expect(at).toBeGreaterThan(-1)
  const start = html.lastIndexOf('<li', at)
  return html.slice(start, html.indexOf('</li>', at))
}

describe('RevealView（靜態渲染）', () => {
  const html = renderToStaticMarkup(<RevealView cards={revealCards(results, gallery, 'b', PPT_TERMS_VIEW)} label="投影片瀏覽" />)

  it('網格：auto-fill minmax(220px, 1fr)、間距 16px、< 768px 兩欄；無障礙名稱來自殼層', () => {
    expect(html).toContain('aria-label="投影片瀏覽"')
    expect(html).toContain('grid-cols-[repeat(auto-fill,minmax(220px,1fr))]')
    expect(html).toContain('gap-[16px]')
    expect(html).toContain('max-md:grid-cols-2')
  })

  it('依 rank 排序', () => {
    const order = [...html.matchAll(/data-reveal="([a-e])"/g)].map((m) => m[1])
    expect(order).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('前三名外框 2px --accent、名次 ①②③；其餘 1px --border、數字', () => {
    for (const id of ['a', 'b', 'c']) expect(card(html, id)).toContain('outline-2 outline-accent')
    for (const id of ['d', 'e']) {
      expect(card(html, id)).toContain('outline-1 outline-border')
      expect(card(html, id)).not.toContain('outline-accent')
    }
    expect(card(html, 'a')).toContain('>①</span>')
    expect(card(html, 'd')).toContain('>4</span>')
  })

  it('分數 tabular-nums；隨機評分加小字「隨機」，AI 評分不加', () => {
    expect(card(html, 'a')).toContain('<span class="shrink-0 tabular-nums">87 分</span>')
    expect(card(html, 'a')).toContain('>隨機</span>')
    expect(card(html, 'd')).not.toContain('>隨機</span>')
  })

  it('未交卷：「未儲存」＋空白投影片（沒有 img）', () => {
    const e = card(html, 'e')
    expect(e).toContain('>未儲存</span>')
    expect(e).not.toContain('<img')
  })

  it('圖片來自 gallery 的 object URL；收不到顯示灰底「載入中」', () => {
    expect(card(html, 'a')).toContain('<img src="blob:a" alt="Alice 的畫"')
    expect(card(html, 'c')).toContain('bg-hover')
    expect(card(html, 'c')).toContain('載入中')
  })

  it('自己那張卡底 --bg-active，其他人沒有', () => {
    expect(card(html, 'b')).toMatch(/^<li class="[^"]*bg-active/)
    expect(card(html, 'a')).not.toMatch(/^<li class="[^"]*bg-active/)
  })

  it('縮圖可鍵盤操作：每張是 <button>（Enter／Space 放大），有完整說明的無障礙名稱', () => {
    expect(html.match(/<button type="button" data-reveal=/g)).toHaveLength(5)
    expect(card(html, 'b')).toContain('aria-label="第 2 名 Bob，74 分，隨機評分，你（放大）"')
  })
})

// ─── ppt 殼層：投影片區與「完成」 ───────────────────────────────────────

const roundState = (patch: Partial<ShellRoundState>): ShellRoundState => ({
  phase: 'idle',
  isSetter: false,
  canDraw: false,
  showCanvas: false,
  submitted: false,
  showReveal: false,
  ...patch,
})
const slide = (r: ShellRoundState) =>
  renderToStaticMarkup(<SlideArea round={r} canvas={<canvas data-testid="mine" />} reveal={<div data-testid="reveal" />} />)

describe('SlideArea（design §2 投影片區）', () => {
  it('有結果（showReveal）→ 投影片瀏覽，優先於畫布', () => {
    expect(slide(roundState({ phase: 'ended', showReveal: true }))).toBe('<div data-testid="reveal"></div>')
  })

  it('作畫中未交卷 → 自己的畫布，沒有小字', () => {
    const html = slide(roundState({ phase: 'drawing', showCanvas: true, canDraw: true }))
    expect(html).toContain('data-testid="mine"')
    expect(html).not.toContain(PPT_SAVED_CAPTION)
  })

  it('作畫中已交卷 → 鎖定的畫布＋右下小字「已儲存，等待其他人…」', () => {
    const html = slide(roundState({ phase: 'drawing', showCanvas: true, submitted: true }))
    expect(PPT_SAVED_CAPTION).toBe('已儲存，等待其他人…')
    expect(html).toContain('data-testid="mine"')
    expect(html).toMatch(/class="absolute right-2 bottom-1[^"]*">已儲存，等待其他人…<\/span>/)
  })

  it('評分中：畫布鎖定但不加小字（design §2 judging）', () => {
    expect(slide(roundState({ phase: 'judging', showCanvas: true, submitted: true }))).not.toContain(PPT_SAVED_CAPTION)
  })

  it('旁觀、出題中、無結果 → 空白投影片', () => {
    for (const r of [roundState({ phase: 'drawing' }), roundState({ phase: 'choosing' }), roundState({ phase: 'idle' })]) {
      const html = slide(r)
      expect(html).toContain('按一下以新增標題')
      expect(html).not.toContain('data-testid')
    }
  })
})

/** 從 start 的 <div 起算，對應的 </div> 位置 */
function closingIndex(html: string, start: number): number {
  let depth = 0
  const re = /<div\b|<\/div>/g
  re.lastIndex = start
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    depth += m[0] === '</div>' ? -1 : 1
    if (depth === 0) return m.index
  }
  return -1
}

describe('「完成」固定在功能區右端（tabpanel 捲動區之外；design §4）', () => {
  const ribbon = (finish?: ReactNode) =>
    renderToStaticMarkup(<Ribbon fallback="繪圖" drawTools={<div data-testid="tools" />} finish={finish} fileRef={createRef()} />)

  it('有 finish：放在 tabpanel 之後（不在捲動區內），群組名稱「儲存」', () => {
    const html = ribbon(<button data-testid="finish">完成</button>)
    const panelStart = html.lastIndexOf('<div', html.indexOf('role="tabpanel"'))
    const tools = html.indexOf('data-testid="tools"')
    const finish = html.indexOf('data-testid="finish"')
    expect(tools).toBeGreaterThan(panelStart)
    expect(finish).toBeGreaterThan(closingIndex(html, panelStart))
    expect(html).toContain('>儲存</div>')
  })

  it('沒有 finish（不能作畫）：不渲染固定區', () => {
    expect(ribbon(null)).not.toContain('>儲存</div>')
  })
})
