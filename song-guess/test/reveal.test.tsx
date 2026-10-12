// 每首揭曉卡與本局排名表（features/reveal；spec/song-guess/design.md §1「每首揭曉」「本局排名」、§2「舞台」欄）：
// 舞台此刻顯示什麼、封面 300px 版、猜對者列、排名列與標題；元件的靜態渲染。
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { GameRankingView } from '../src/features/reveal/GameRanking'
import { RevealCardView } from '../src/features/reveal/RevealCard'
import {
  ARTWORK_SIZE,
  LEFT_PLAYER_NAME,
  NO_ONE_GUESSED,
  TOP_RANKS,
  artworkAlt,
  artworkUrlAt,
  rankingRows,
  rankingTitle,
  revealScoreRows,
  showsLastResults,
  stageMode,
} from '../src/features/reveal/revealView'
import { player, playingRound, result, reveal, round, song } from './fixtures'

const fs = (await import('node:fs' as string)) as { readFileSync(path: URL, encoding: 'utf8'): string }
const read = (f: string) => fs.readFileSync(new URL(f, import.meta.url), 'utf8')

describe('stageMode：舞台此刻顯示什麼（design §2）', () => {
  const results = [result('p1', 1, 300, 4)]

  it('idle：沒有結果 → empty；有上一局結果 → results', () => {
    expect(stageMode(round({ phase: 'idle' }))).toBe('empty')
    expect(stageMode(round({ phase: 'idle', results }))).toBe('results')
    expect(stageMode(round({ phase: 'idle', results: [] }))).toBe('empty')
  })

  it('choosing → preparing（即使還留著上一局結果）', () => {
    expect(stageMode(round({ phase: 'choosing', results }))).toBe('preparing')
  })

  it('playing → playing；reveal → reveal；ended → results', () => {
    expect(stageMode(playingRound())).toBe('playing')
    expect(stageMode(round({ phase: 'reveal', song: song(), reveal: reveal() }))).toBe('reveal')
    expect(stageMode(round({ phase: 'ended', reveal: reveal({ index: 5 }), results }))).toBe('results')
  })

  it('資料不齊時退回 empty（不丟例外）', () => {
    expect(stageMode(round({ phase: 'playing', song: null }))).toBe('empty')
    expect(stageMode(round({ phase: 'reveal', song: song(), reveal: null }))).toBe('empty')
    expect(stageMode(round({ phase: 'ended', results: null }))).toBe('empty')
  })

  it('showsLastResults：只有 idle 且有結果（ended 顯示的是本局）', () => {
    expect(showsLastResults(round({ phase: 'idle', results }))).toBe(true)
    expect(showsLastResults(round({ phase: 'ended', results }))).toBe(false)
    expect(showsLastResults(round({ phase: 'idle' }))).toBe(false)
    expect(showsLastResults(round({ phase: 'choosing', results }))).toBe(false)
  })
})

describe('封面網址：artworkUrl 的 300px 版', () => {
  it('把 100x100 換成 300x300（檔名在最後一段）', () => {
    expect(ARTWORK_SIZE).toBe(300)
    expect(artworkUrlAt('https://is1-ssl.mzstatic.com/image/thumb/Music/v4/aa/bb/cc/cover.jpg/100x100bb.jpg')).toBe(
      'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/aa/bb/cc/cover.jpg/300x300bb.jpg',
    )
  })

  it('路徑前段剛好也有 100x100 時只換最後一個', () => {
    expect(artworkUrlAt('https://x.example/100x100/cover/100x100bb.jpg')).toBe('https://x.example/100x100/cover/300x300bb.jpg')
  })

  it('沒有這個樣式 → 原樣；null、空字串 → null', () => {
    expect(artworkUrlAt('https://x.example/cover.png')).toBe('https://x.example/cover.png')
    expect(artworkUrlAt(null)).toBeNull()
    expect(artworkUrlAt('  ')).toBeNull()
  })

  it('可指定其他尺寸', () => {
    expect(artworkUrlAt('https://x.example/100x100bb.jpg', 600)).toBe('https://x.example/600x600bb.jpg')
  })
})

describe('猜對者列', () => {
  const players = [player('p1', { nickname: 'rex' }), player('p2', { nickname: 'amy' })]

  it('依猜對順序（reveal.scores 的順序），暱稱由玩家清單對出來，標記自己', () => {
    const rv = reveal({ scores: [{ playerId: 'p2', score: 96 }, { playerId: 'p1', score: 73 }] })
    expect(revealScoreRows(rv, players, 'p1')).toEqual([
      { playerId: 'p2', nickname: 'amy', score: 96, isMe: false },
      { playerId: 'p1', nickname: 'rex', score: 73, isMe: true },
    ])
  })

  it('已離開房間的玩家顯示「（已離開）」；沒人猜對 → 空陣列', () => {
    expect(revealScoreRows(reveal({ scores: [{ playerId: 'gone', score: 60 }] }), players, 'p1')).toEqual([
      { playerId: 'gone', nickname: LEFT_PLAYER_NAME, score: 60, isMe: false },
    ])
    expect(revealScoreRows(reveal(), players, 'p1')).toEqual([])
  })
})

describe('RevealCardView（design §1：封面 120px、歌名 20px --fg、歌手 14px --fg、猜對者列）', () => {
  const rv = reveal({ index: 2, title: '如果可以 (電影"月老"主題曲)', artist: '韋禮安', album: '如果可以 - Single' })
  const rows = [
    { playerId: 'p2', nickname: 'amy', score: 96, isMe: false },
    { playerId: 'p1', nickname: 'rex', score: 73, isMe: true },
  ]
  const html = renderToStaticMarkup(<RevealCardView reveal={rv} rows={rows} />)

  it('封面用 300px 版、120px、圓角 8px、< 480px 縮成 80px；有替代文字', () => {
    expect(html).toContain('src="https://is1-ssl.mzstatic.com/image/thumb/Music/v4/aa/bb/cc/cover.jpg/300x300bb.jpg"')
    expect(html).toMatch(/<img[^>]*width="120" height="120"[^>]*class="size-\[120px\] shrink-0 rounded-\[8px\][^"]*max-\[479px\]:size-\[80px\]"/)
    expect(html).toContain('alt="《如果可以 - Single》專輯封面"')
    expect(artworkAlt({ title: '遇見', album: null })).toBe('《遇見》專輯封面')
  })

  it('歌名（含副標的原始歌名）20px --fg、歌手 14px --fg（不是 --fg-muted），文字可換行', () => {
    expect(html).toMatch(/<h3 data-reveal-title="" class="text-\[20px\][^"]*break-words text-fg">如果可以 \(電影&quot;月老&quot;主題曲\)<\/h3>/)
    expect(html).toMatch(/<p data-reveal-artist="" class="text-\[14px\][^"]*break-words text-fg">韋禮安<\/p>/)
  })

  it('DESIGN §15.1：舞台 tile 內承載資訊的文字一律 --fg——揭曉卡、排名表、舞台的文字都不用 --fg-muted／--fg-dim', () => {
    const TILE_FILES = [
      '../src/features/reveal/RevealCard.tsx',
      '../src/features/reveal/GameRanking.tsx',
      '../src/features/stage/Stage.tsx',
      '../src/shells/meet/MeetStage.tsx',
      '../src/features/round/RoundStatus.tsx',
    ]
    /** 去掉註解，只看程式碼裡的 class */
    const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    // 逐行找（字串或樣板字串的 class 都算）
    const muted = TILE_FILES.flatMap((f) =>
      code(f)
        .split('\n')
        .filter((line) => /\btext-fg-(?:muted|dim)\b/.test(line))
        .map((line) => `${f.split('/').pop()}: ${line.trim()}`),
    )
    // 唯一的例外：沒有封面時的佔位圖示（圖形，而且在自己的 --bg-editor 方塊上，不是壓在 tile 上的文字）
    expect(muted).toHaveLength(1)
    expect(muted[0]).toMatch(/^RevealCard\.tsx: className="[^"]*bg-editor text-fg-muted/)
    // 渲染結果：有封面時整張卡沒有任何 muted／dim 的字；猜對者列、「沒有人猜對」都是 --fg
    expect(html).not.toMatch(/text-fg-(?:muted|dim)/)
    expect(renderToStaticMarkup(<RevealCardView reveal={rv} rows={[]} />)).toMatch(/<p data-reveal-empty="" class="[^"]*text-fg">沒有人猜對<\/p>/)
    expect(html).toMatch(/<li data-player="p2" class="[^"]*bg-editor\/70[^"]*text-fg">/)
  })

  it('猜對者列：暱稱＋分數膠囊，依順序', () => {
    expect(html.indexOf('>amy<')).toBeLessThan(html.indexOf('>rex<'))
    expect(html).toContain('>+96</span>')
    expect(html).toContain('>+73</span>')
    expect(html.match(/<li /g)).toHaveLength(2)
    expect(html).not.toContain(NO_ONE_GUESSED)
  })

  it('沒人猜對 → 「沒有人猜對」', () => {
    const none = renderToStaticMarkup(<RevealCardView reveal={rv} rows={[]} />)
    expect(NO_ONE_GUESSED).toBe('沒有人猜對')
    expect(none).toContain('>沒有人猜對</p>')
    expect(none).not.toContain('<ol')
  })

  it('沒有封面 → 同尺寸的佔位（有文字說明），不渲染 <img>', () => {
    const noArt = renderToStaticMarkup(<RevealCardView reveal={reveal({ artworkUrl: null })} rows={[]} />)
    expect(noArt).not.toContain('<img')
    expect(noArt).toContain('aria-label="沒有專輯封面"')
    expect(noArt).toMatch(/size-\[120px\][^"]*max-\[479px\]:size-\[80px\]/)
  })

  it('觀察點：data-stage="reveal"、data-song-index', () => {
    expect(html).toContain('data-stage="reveal"')
    expect(html).toContain('data-song-index="2"')
  })

  it('不寫死色碼；不含偽裝字樣', () => {
    const src = read('../src/features/reveal/RevealCard.tsx') + read('../src/features/reveal/GameRanking.tsx')
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(src).not.toMatch(/分享音訊|通話|參加者/)
  })
})

describe('本局排名表（design §1：名次、暱稱、本局得分、猜對首數；前三名 --accent；標題「本局結果 · 孫燕姿」）', () => {
  const results = [result('p3', 3, 150, 2, 'bob'), result('p2', 1, 412, 5, 'amy'), result('p1', 2, 300, 4, 'rex'), result('p4', 4, 0, 0, 'kim')]

  it('rankingTitle', () => {
    expect(rankingTitle('孫燕姿')).toBe('本局結果 · 孫燕姿')
    expect(rankingTitle(null)).toBe('本局結果')
    expect(rankingTitle('')).toBe('本局結果')
  })

  it('rankingRows：依 rank 升冪；前三名 isTop；標記自己', () => {
    const rows = rankingRows(results, 'p1')
    expect(rows.map((r) => [r.rank, r.nickname, r.gameScore, r.correctCount, r.isTop, r.isMe])).toEqual([
      [1, 'amy', 412, 5, true, false],
      [2, 'rex', 300, 4, true, true],
      [3, 'bob', 150, 2, true, false],
      [4, 'kim', 0, 0, false, false],
    ])
    expect(TOP_RANKS).toBe(3)
  })

  it('GameRankingView：四欄表格、標題為 caption、前三名加 text-accent、第四名沒有', () => {
    const html = renderToStaticMarkup(<GameRankingView title={rankingTitle('孫燕姿')} rows={rankingRows(results, 'p1')} />)
    expect(html).toMatch(/<caption[^>]*>本局結果 · 孫燕姿<\/caption>/)
    expect([...html.matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/g)].map((m) => m[1])).toEqual(['名次', '暱稱', '本局得分', '猜對首數'])
    expect(html.match(/<tr[^>]*class="text-accent"/g)).toHaveLength(3)
    expect(html).toMatch(/<tr data-player="p4" data-rank="4">/)
    expect(html).toMatch(/data-player="p2" data-rank="1" class="text-accent"><td[^>]*>1<\/td><th scope="row"[^>]*>amy<\/th><td[^>]*>412<\/td><td[^>]*>5<\/td>/)
    expect(html).toContain('data-stage="results"')
  })

  it('表頭、非前三名的列都是 --fg（繼承表格的 text-fg），沒有 muted 的字', () => {
    const html = renderToStaticMarkup(<GameRankingView title="本局結果" rows={rankingRows(results, 'p1')} />)
    expect(html).toMatch(/<table class="[^"]*text-fg">/)
    expect(html).toMatch(/<caption class="[^"]*text-fg">/)
    expect(html).not.toMatch(/text-fg-(?:muted|dim)/)
    // 除了前三名的 text-accent 以外，列與儲存格沒有自己的文字色
    expect([...html.matchAll(/<(?:tr|td|th)[^>]*class="[^"]*\b(text-(?:fg[\w-]*|accent[\w-]*|sem-[\w-]+))\b/g)].map((m) => m[1]).filter((c) => c !== 'text-accent')).toEqual([])
  })

  it('自己那列粗體並有文字標記（顏色不是唯一載體）', () => {
    const html = renderToStaticMarkup(<GameRankingView title="本局結果" rows={rankingRows(results, 'p1')} />)
    expect(html).toMatch(/<th scope="row" class="[^"]*font-bold">rex<span class="sr-only">（你）<\/span><\/th>/)
  })
})
