// 揭曉畫廊（spec/draw-contest/design.md §3；features/reveal）：排序、名次記號、前三名、隨機標示、未儲存、載入中、自己高亮、網格版面、
// 評語行（Epic 15：縮圖下方、完整顯示不截斷；有文字／產生中「評審名稱：正在寫評語」／沒有就不渲染；只看卡片自己的欄位；放大檢視完整句、同樣在圖片下方），
// 以及 ppt 殼層的投影片區切換（SlideArea：投影片瀏覽／自己的畫布＋已儲存小字／空白投影片）與「完成」固定位置（Ribbon）。
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRef, type ReactNode } from 'react'
import { COMMENT_PERSONA_NAME, type ContestPhase, type ResultEntry } from '@fishing-work/shared/draw-contest'
import { RevealView, ZoomedCard } from '../src/features/reveal/Reveal'
import {
  COMMENT_PENDING_TEXT,
  isPodium,
  rankMark,
  revealCards,
  revealComment,
  revealImage,
  sortByRank,
} from '../src/features/reveal/revealView'
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
  comment: null,
  commentPending: false,
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

// ─── 評語行（Epic 15；design §3） ─────────────────────────────────────

/** 約 40 字的評語（design §3「約 40 字兩行」） */
const LONG = '就這也叫蘋果？這種沒靈魂的圓圈也想拿高分，真是笨蛋雜魚呢！下次記得把蒂頭也畫上去啦～'
// a 有評語、b 還在產生、c 交卷但沒有評語（失敗或關閉）、d 有評語（AI 評分）、e 未交卷
const commented: ResultEntry[] = [
  entry({ playerId: 'a', nickname: 'Alice', rank: 1, score: 87, comment: LONG }),
  entry({ playerId: 'b', nickname: 'Bob', rank: 2, score: 74, commentPending: true }),
  entry({ playerId: 'c', nickname: 'Carol', rank: 3, score: 61 }),
  entry({ playerId: 'd', nickname: 'Dave', rank: 4, score: 40, judgedBy: 'ai', comment: '<b>雜魚</b>～' }),
  entry({ playerId: 'e', nickname: 'Eve', rank: 5, score: 0, judgedBy: null, confidence: null, submitted: false, submittedAt: null }),
]

/** 某張卡片的評語行（<p data-reveal-comment=…>…</p>）；沒有回 null */
function commentLine(html: string): string | null {
  return /<p [^>]*data-reveal-comment="[^"]*"[^>]*>.*?<\/p>/.exec(html)?.[0] ?? null
}

describe('評語：純邏輯（revealComment、revealCards）', () => {
  it('評審名稱來自 shared 的唯一來源', () => {
    expect(COMMENT_PERSONA_NAME).toBe('メスガキ')
    // 產生中的文字不用省略號（2026-10-12 定案：「…」像被截斷）
    expect(COMMENT_PENDING_TEXT).toBe('正在寫評語')
    expect(COMMENT_PENDING_TEXT).not.toMatch(/…|\.\.\./)
  })

  it('revealComment：有文字／產生中／沒有（只看自己的 comment 與 commentPending）', () => {
    expect(revealComment({ comment: '雜魚～', commentPending: false })).toEqual({ kind: 'text', text: '雜魚～' })
    expect(revealComment({ comment: null, commentPending: true })).toEqual({ kind: 'pending' })
    expect(revealComment({ comment: null, commentPending: false })).toBeNull()
    // 文字已到就以文字為準（即使旗標還沒清）
    expect(revealComment({ comment: '雜魚～', commentPending: true })).toEqual({ kind: 'text', text: '雜魚～' })
  })

  it('revealCards：每張卡片各自的評語狀態；未交卷沒有評語', () => {
    const cards = revealCards(commented, gallery, 'b', PPT_TERMS_VIEW)
    expect(cards.map((c) => c.comment)).toEqual([
      { kind: 'text', text: LONG },
      { kind: 'pending' },
      null,
      { kind: 'text', text: '<b>雜魚</b>～' },
      null,
    ])
  })

  it('完整說明（label）有評語文字時帶上「評審名稱：評語」；產生中與沒有評語不加；摘要（工具提示）一律不含評語', () => {
    const cards = revealCards(commented, gallery, 'b', PPT_TERMS_VIEW)
    expect(cards[0]?.summary).toBe('第 1 名 Alice，87 分，隨機評分')
    expect(cards[0]?.label).toBe(`第 1 名 Alice，87 分，隨機評分，メスガキ：${LONG}`)
    expect(cards[1]?.label).toBe('第 2 名 Bob，74 分，隨機評分，你')
    expect(cards[1]?.summary).toBe(cards[1]?.label)
    expect(cards[2]?.label).toBe('第 3 名 Carol，61 分，隨機評分')
    expect(cards[4]?.label).toBe('第 5 名 Eve，未儲存')
  })

  it('不看 round.commentMode：revealCards 只收 results（回合中途失敗時，已產生的評語照常顯示）', () => {
    // 回合評語器已退成 off 的情境＝有的卡片有文字、其餘 null／false；輸出與 commentMode 無關（函式簽名裡沒有它）
    const partial = [
      entry({ playerId: 'a', nickname: 'Alice', rank: 1, comment: '雜魚～' }),
      entry({ playerId: 'b', nickname: 'Bob', rank: 2 }),
    ]
    expect(revealCards(partial, gallery, null, PPT_TERMS_VIEW).map((c) => c.comment)).toEqual([{ kind: 'text', text: '雜魚～' }, null])
  })

  it('既有資料（都沒有評語）：每張卡片 comment 為 null、label 與摘要相同', () => {
    for (const c of revealCards(results, gallery, 'b', PPT_TERMS_VIEW)) {
      expect(c.comment, c.playerId).toBeNull()
      expect(c.label, c.playerId).toBe(c.summary)
    }
  })
})

describe('評語行（RevealView 靜態渲染）', () => {
  const html = renderToStaticMarkup(<RevealView cards={revealCards(commented, gallery, 'b', PPT_TERMS_VIEW)} label="投影片瀏覽" />)

  it('有評語：評審名稱粗體 --fg 前綴＋冒號，評語斜體；整行 12px、--fg-muted；完整顯示不截斷（沒有 line-clamp）', () => {
    const line = commentLine(card(html, 'a'))
    expect(line).not.toBeNull()
    expect(line).toContain('data-reveal-comment="text"')
    expect(line).toContain('<span class="font-bold text-fg">メスガキ：</span>')
    expect(line).toContain(`<span class="italic">${LONG}</span>`)
    const cls = /class="([^"]*)"/.exec(line ?? '')?.[1]?.split(' ') ?? []
    for (const c of ['text-[12px]', 'text-fg-muted', 'leading-[18px]', 'break-words']) expect(cls, c).toContain(c)
    // 2026-10-12 定案：移除 line-clamp-2（截斷的「…」與產生中分不出來），也沒有其他截斷
    expect(cls.filter((c) => /line-clamp|truncate|overflow-hidden|text-ellipsis/.test(c))).toEqual([])
    // 在縮圖下方：間距在上（mt），不是原本標題列下方的 mb
    expect(cls).toContain('mt-1.5')
    expect(cls).not.toContain('mb-1')
  })

  it('評語行在縮圖下方（2026-10-12 定案）：標題列 → 縮圖 → 評語行，評語行是卡片最後一個元素', () => {
    for (const id of ['a', 'b', 'd']) {
      const c = card(html, id)
      const title = c.indexOf('tabular-nums')
      const thumb = c.indexOf('<button')
      const thumbEnd = c.indexOf('</button>')
      const comment = c.indexOf('data-reveal-comment')
      expect(title, id).toBeGreaterThan(-1)
      expect(thumb, id).toBeGreaterThan(title)
      expect(comment, id).toBeGreaterThan(thumbEnd)
      expect(c, id).toMatch(/<\/button><p [^>]*data-reveal-comment=[^>]*>.*<\/p>$/)
    }
  })

  it('同一列的縮圖上緣對齊：不論有沒有評語，標題列之後一律直接是縮圖按鈕', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e']) expect(card(html, id), id).toMatch(/<\/div><button type="button" data-reveal=/)
  })

  it('產生中：帶評審名稱前綴，評語的位置顯示「正在寫評語」（「メスガキ：正在寫評語」），沒有省略號', () => {
    const line = commentLine(card(html, 'b'))
    expect(line).toContain('data-reveal-comment="pending"')
    expect(line).toContain('<span class="font-bold text-fg">メスガキ：</span><span class="italic">正在寫評語</span>')
    expect(line).not.toContain('…')
    expect(line).not.toContain('line-clamp')
    expect(line).toContain('mt-1.5')
    expect(line).toContain('aria-hidden="true"')
  })

  it('沒有評語（交卷但 comment null 且不 pending、未交卷）：整行不渲染（卡片變矮，不留空行）', () => {
    for (const id of ['c', 'e']) {
      expect(card(html, id), id).not.toContain('data-reveal-comment')
      expect(card(html, id), id).not.toContain('メスガキ')
      expect(card(html, id), id).not.toContain('…')
      expect(card(html, id), id).not.toContain('正在寫評語')
      // 標題列之後直接是縮圖按鈕，縮圖之後沒有東西
      expect(card(html, id), id).toMatch(/<\/div><button type="button" data-reveal=/)
      expect(card(html, id), id).toMatch(/<\/button>$/)
    }
  })

  it('整個畫廊沒有截斷的評語：長評語（約 40 字）完整輸出，畫面上不出現省略號', () => {
    expect(html).not.toContain('line-clamp')
    expect(html).toContain(`<span class="italic">${LONG}</span>`)
    expect(html).not.toContain('…')
  })

  it('只有 a、b、d 三張有評語行', () => {
    expect(html.match(/data-reveal-comment="text"/g)).toHaveLength(2)
    expect(html.match(/data-reveal-comment="pending"/g)).toHaveLength(1)
  })

  it('評語是純文字：模型輸出的標記會被跳脫，不會變成 HTML', () => {
    expect(card(html, 'd')).toContain('&lt;b&gt;雜魚&lt;/b&gt;～')
    expect(card(html, 'd')).not.toContain('<b>')
  })

  it('評語行 aria-hidden（文字已在縮圖按鈕的無障礙名稱裡）；工具提示用摘要、不含評語', () => {
    expect(commentLine(card(html, 'a'))).toContain('aria-hidden="true"')
    expect(card(html, 'a')).toContain(`aria-label="第 1 名 Alice，87 分，隨機評分，メスガキ：${LONG}（放大）"`)
    expect(card(html, 'a')).toContain('data-tooltip="第 1 名 Alice，87 分，隨機評分"')
    expect(card(html, 'b')).toContain('aria-label="第 2 名 Bob，74 分，隨機評分，你（放大）"')
  })

  it('既有資料（都沒有評語）：整個畫廊沒有評語行', () => {
    const plain = renderToStaticMarkup(<RevealView cards={revealCards(results, gallery, 'b', PPT_TERMS_VIEW)} label="投影片瀏覽" />)
    expect(plain).not.toContain('data-reveal-comment')
    expect(plain).not.toContain('メスガキ')
  })
})

describe('第一名稱讚版（Phase 4；architecture §5）：揭曉當下第一名是產生中，稍後補上稱讚句', () => {
  const others = [
    entry({ playerId: 'b', nickname: 'Bob', rank: 2, score: 74, comment: '雜魚～' }),
    entry({ playerId: 'c', nickname: 'Carol', rank: 3, score: 61, comment: '就這？' }),
  ]
  const render = (first: ResultEntry) =>
    renderToStaticMarkup(<RevealView cards={revealCards([first, ...others], gallery, null, PPT_TERMS_VIEW)} label="投影片瀏覽" />)

  it('揭曉當下：第一名（前三名外框照舊）顯示「メスガキ：正在寫評語」，其他人已有評語', () => {
    const html = render(entry({ playerId: 'a', nickname: 'Alice', rank: 1, score: 87, commentPending: true }))
    const a = card(html, 'a')
    expect(a).toContain('outline-2 outline-accent')
    expect(commentLine(a)).toContain('<span class="font-bold text-fg">メスガキ：</span><span class="italic">正在寫評語</span>')
    expect(a).toContain('aria-label="第 1 名 Alice，87 分，隨機評分（放大）"')
    expect(commentLine(card(html, 'b'))).toContain('<span class="italic">雜魚～</span>')
    expect(commentLine(card(html, 'c'))).toContain('<span class="italic">就這？</span>')
  })

  it('contest:comment 補上後：同一個位置換成稱讚句，無障礙名稱也帶上；其他卡片不變', () => {
    const before = render(entry({ playerId: 'a', nickname: 'Alice', rank: 1, score: 87, commentPending: true }))
    const after = render(entry({ playerId: 'a', nickname: 'Alice', rank: 1, score: 87, comment: '哼，勉強算你厲害啦～' }))
    const a = card(after, 'a')
    expect(commentLine(a)).toContain('<span class="font-bold text-fg">メスガキ：</span><span class="italic">哼，勉強算你厲害啦～</span>')
    expect(commentLine(a)).toContain('data-reveal-comment="text"')
    expect(a).toContain('aria-label="第 1 名 Alice，87 分，隨機評分，メスガキ：哼，勉強算你厲害啦～（放大）"')
    for (const id of ['b', 'c']) expect(card(after, id), id).toBe(card(before, id))
  })
})

describe('放大檢視（ZoomedCard 靜態渲染）', () => {
  const cards = revealCards(commented, gallery, 'b', PPT_TERMS_VIEW)
  const zoom = (id: string) => renderToStaticMarkup(<ZoomedCard card={cards.find((c) => c.playerId === id)!} onClose={() => {}} />)

  it('有評語：圖片下方顯示完整句（不 clamp），順序為 標題列 → 圖片 → 評語行（design §3：2026-10-12 定案與網格卡片一致）', () => {
    const html = zoom('a')
    const line = commentLine(html)
    // 與網格卡片相同：間距在上（mt 6px），不是原本標題列下方的 mb
    expect(line).toContain('mt-1.5')
    expect(line).not.toContain('mb-1')
    expect(line).toContain('<span class="font-bold text-fg">メスガキ：</span>')
    expect(line).toContain(`<span class="italic">${LONG}</span>`)
    expect(line).not.toContain('line-clamp')
    expect(html).not.toContain('line-clamp')
    expect(html.indexOf('>87 分</span>')).toBeLessThan(html.indexOf('<button'))
    expect(html.indexOf('</button>')).toBeGreaterThan(-1)
    expect(html.indexOf('</button>')).toBeLessThan(html.indexOf('data-reveal-comment'))
    // 評語行緊接在圖片按鈕之後（同一塊），是放大檢視的最後一個元素
    expect(html).toMatch(/<\/button><p [^>]*data-reveal-comment="text"[^>]*>.*<\/p><\/div><\/div>$/)
    expect(html.match(/data-reveal-comment/g)).toHaveLength(1)
    expect(html).toContain(`aria-label="第 1 名 Alice，87 分，隨機評分，メスガキ：${LONG}（回到全部）"`)
  })

  it('標題列之後一律直接是圖片（不論有沒有評語），標題列那一塊不含評語行', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      expect(zoom(id), id).toMatch(/<\/div><\/div><div class="w-\[[^"]*\]"><button type="button"/)
      expect(zoom(id).slice(0, zoom(id).indexOf('<button')), id).not.toContain('data-reveal-comment')
    }
  })

  it('有評語行時多留高度給文字（標題列、圖片、評語行同寬）；沒有評語維持原本的 28px', () => {
    // 圖片與評語行包在同一個設了寬度的區塊裡（圖片 w-full），所以寬度 class 出現兩次：標題列一塊、圖片＋評語一塊
    const withComment = zoom('a')
    expect(withComment.match(/w-\[min\(100cqw,calc\(\(100cqh-70px\)\*16\/9\)\)\]/g)).toHaveLength(2)
    expect(withComment).not.toContain('100cqh-28px')
    expect(withComment).not.toContain('100cqh-68px')
    expect(withComment).toMatch(/<div class="w-\[min\(100cqw,calc\(\(100cqh-70px\)\*16\/9\)\)\]"><button type="button"[^>]* class="block aspect-video w-full /)
    const without = zoom('c')
    expect(without.match(/w-\[min\(100cqw,calc\(\(100cqh-28px\)\*16\/9\)\)\]/g)).toHaveLength(2)
    expect(without).not.toContain('100cqh-68px')
    expect(without).not.toContain('100cqh-70px')
    expect(without).toMatch(/<div class="w-\[min\(100cqw,calc\(\(100cqh-28px\)\*16\/9\)\)\]"><button type="button"[^>]* class="block aspect-video w-full /)
  })

  it('產生中：顯示「メスガキ：正在寫評語」（帶前綴，與網格卡片同一個常數）；沒有評語（含未交卷）：不渲染該行', () => {
    expect(commentLine(zoom('b'))).toContain('<span class="font-bold text-fg">メスガキ：</span><span class="italic">正在寫評語</span>')
    expect(commentLine(zoom('b'))).not.toContain('…')
    expect(commentLine(zoom('b'))).not.toContain('line-clamp')
    // 產生中也在圖片下方
    expect(zoom('b')).toMatch(/<\/button><p [^>]*data-reveal-comment="pending"[^>]*>.*<\/p><\/div><\/div>$/)
    expect(zoom('b')).toContain('aria-label="第 2 名 Bob，74 分，隨機評分，你（回到全部）"')
    expect(zoom('c')).not.toContain('data-reveal-comment')
    expect(zoom('e')).not.toContain('data-reveal-comment')
    // 沒有評語：圖片之後沒有東西
    for (const id of ['c', 'e']) expect(zoom(id), id).toMatch(/<\/button><\/div><\/div>$/)
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
