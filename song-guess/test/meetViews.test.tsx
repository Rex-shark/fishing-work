// meet 殼層的呈現元件（DESIGN §15.2、§15.3；spec/song-guess/design.md §1、§2）：舞台（MeetStage）、音量（MeetVolume）、
// 參加者 tile、聊天 renderer、MeetShell 的插槽擺放與各階段的標籤／「分享音訊」按鈕。靜態渲染（沒有 DOM 環境）。
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { START_PLAYBACK_LABEL } from '../src/features/player/playback'
import { THEME_CATALOG } from '../src/shells/catalog'
import { MeetChatLine, MeetComposer } from '../src/shells/meet/MeetChat'
import { MeetResumeCard } from '../src/shells/meet/MeetDialog'
import { WAVE_BARS } from '../src/shells/meet/meetLayout'
import { MeetShell } from '../src/shells/meet/MeetShell'
import { MeetStage } from '../src/shells/meet/MeetStage'
import { MEET_VIEWS } from '../src/shells/meet/meetViews'
import { MeetVolume } from '../src/shells/meet/MeetVolume'
import { ParticipantTiles } from '../src/shells/meet/ParticipantTiles'
import type { ShellProps } from '../src/shells/types'
import type { ChatComposerProps, ChatLineData, PlayerRowData, StagePlayback } from '../src/shells/views'
import { player } from './fixtures'

const fs = (await import('node:fs' as string)) as { readFileSync(path: URL, encoding: 'utf8'): string }
const read = (f: string) => fs.readFileSync(new URL(f, import.meta.url), 'utf8')
const themeCss = read('../src/styles/theme.css')
const noop = () => {}

// ─── 舞台 ───────────────────────────────────────────────────────

describe('MeetStage（design §2「舞台」欄）', () => {
  const playing = (playback: StagePlayback, artist: string | null = '孫燕姿') =>
    renderToStaticMarkup(<MeetStage kind="playing" artist={artist} index={2} total={5} playback={playback} startLabel={START_PLAYBACK_LABEL} onStart={noop} />)

  it('empty：「尚無人分享音訊」', () => {
    const html = renderToStaticMarkup(<MeetStage kind="empty" />)
    expect(html).toContain('data-stage="empty"')
    expect(html).toContain('>尚無人分享音訊</p>')
  })

  it('preparing：其他人看到「<出題者> 正在準備分享音訊…」；出題者自己留白（對話框疊在上面）', () => {
    const others = renderToStaticMarkup(<MeetStage kind="preparing" setterName="rex" isSetter={false} />)
    expect(others).toContain('>rex 正在準備分享音訊…</p>')
    const self = renderToStaticMarkup(<MeetStage kind="preparing" setterName="rex" isSetter />)
    expect(self).toBe('<div data-stage="preparing"></div>')
  })

  it('playing：波形（5～7 根 --accent 直條）＋下方 12px --fg「歌手：孫燕姿 · 第 2 / 5 首」', () => {
    const html = playing('playing')
    expect(html).toContain('data-stage="playing"')
    expect(html).toContain('data-playback="playing"')
    expect(html.match(/class="h-full w-\[8px\] rounded-full bg-accent wave-bar /g)).toHaveLength(WAVE_BARS.length)
    expect(html).toMatch(/<p class="[^"]*text-\[12px\][^"]*text-fg">歌手：孫燕姿 · 第 2 \/ 5 首<\/p>/)
    expect(html).toContain('data-wave="moving"')
  })

  it('playing：沒有專輯封面、沒有歌名（只有歌手與第幾首）', () => {
    const html = playing('playing')
    expect(html).not.toContain('<img')
    expect(html).not.toMatch(/歌名|《/)
  })

  it('波形是裝飾（aria-hidden）；還沒起播或已播完時靜止', () => {
    expect(playing('playing')).toMatch(/<div aria-hidden="true" data-wave="moving"/)
    for (const state of ['waiting', 'over', 'idle'] as const) {
      const html = playing(state)
      expect(html, state).toContain('data-wave="still"')
      expect(html.match(/wave-bar-paused/g), state).toHaveLength(WAVE_BARS.length)
    }
    expect(playing('playing')).not.toContain('wave-bar-paused')
  })

  it('自動播放被擋（blocked）：波形位置改放按鈕「點一下開始播放」，歌手那行照樣顯示', () => {
    const html = playing('blocked')
    expect(html).toMatch(/<button type="button" class="[^"]*bg-active[^"]*text-fg-on-active[^"]*">點一下開始播放<\/button>/)
    expect(html).not.toContain('wave-bar')
    expect(html).toContain('歌手：孫燕姿 · 第 2 / 5 首')
    expect(playing('playing')).not.toContain('<button')
  })

  it('沒有歌手名時只顯示第幾首', () => {
    expect(playing('playing', null)).toContain('>第 2 / 5 首</p>')
  })

  it('theme.css：wave-bar 是純 CSS 動畫（keyframes），prefers-reduced-motion 時不動；暫停用 animation-play-state', () => {
    expect(themeCss).toMatch(/@keyframes wave-bar \{/)
    expect(themeCss).toMatch(/@utility wave-bar \{[\s\S]*?animation: wave-bar [\s\S]*?@media \(prefers-reduced-motion: reduce\) \{\s*animation: none;/)
    expect(themeCss).toMatch(/@utility wave-bar-paused \{\s*animation-play-state: paused;/)
    // 不讀真實音訊：殼層與播放器都沒有用 Web Audio
    const sources = import.meta.glob<string>('../src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
    for (const [file, src] of Object.entries(sources)) expect(src, file).not.toMatch(/AudioContext|AnalyserNode|createAnalyser/)
  })
})

// ─── 音量 ───────────────────────────────────────────────────────

describe('MeetVolume（design §1「音量」：24px 喇叭圖示＋浮出的 80px 滑桿，鍵盤可操作）', () => {
  const render = (value: number) => renderToStaticMarkup(<MeetVolume value={value} min={0} max={100} onChange={noop} label="音量" />)
  const html = render(60)

  it('喇叭圖示按鈕 24px，無障礙名稱帶數值，控制滑桿（aria-controls／aria-expanded）', () => {
    expect(html).toMatch(/<button type="button" aria-label="音量 60" aria-expanded="false" aria-controls="[^"]+"/)
    expect(html).toMatch(/<svg width="24" height="24"/)
  })

  it('滑桿是原生 range（方向鍵、Home／End 可調）、0～100、寬 80px、有無障礙名稱', () => {
    expect(html).toMatch(/<input id="[^"]+" type="range" min="0" max="100" step="1" aria-label="音量" aria-valuetext="60"[^>]*class="[^"]*w-\[80px\][^"]*" value="60"\/>/)
    const id = /aria-controls="([^"]+)"/.exec(html)?.[1]
    expect(html).toContain(`<input id="${id}"`)
  })

  it('滑桿預設收起，hover 或焦點在裡面時浮出（group-hover／group-focus-within），浮在圖示上方不推擠控制列', () => {
    expect(html).toMatch(/class="absolute bottom-full left-1\/2 z-20 -translate-x-1\/2 pb-\[8px\] group-focus-within:block group-hover:block hidden"/)
    expect(html).toMatch(/<div data-volume="" class="group relative /)
  })

  it('音量 0：圖示換成靜音、名稱標示靜音', () => {
    const muted = render(0)
    expect(muted).toContain('aria-label="音量 0（靜音）"')
    expect(muted).not.toBe(html.replaceAll('60', '0'))
  })

  it('不用原生 disabled、不寫死色碼', () => {
    const src = read('../src/shells/meet/MeetVolume.tsx')
    expect(src).not.toMatch(/\sdisabled[=\s>]/)
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})

// ─── 參加者 tile ─────────────────────────────────────────────────

describe('ParticipantTiles（design §1「參加者 tile」）', () => {
  const rows: PlayerRowData[] = [
    { player: player('a', { nickname: 'rex', score: 207, gameScore: 87, isSetter: true, hasGuessed: true }), isMe: true, gain: 87 },
    { player: player('b', { nickname: 'amy', score: 95 }), isMe: false, gain: null },
    { player: player('c', { nickname: 'bob', score: 7, connected: false }), isMe: false, gain: null },
  ]
  const html = renderToStaticMarkup(<ParticipantTiles rows={rows} />)
  const tile = (id: string) => {
    const start = html.indexOf(`data-player="${id}"`)
    return html.slice(html.lastIndexOf('<li', start), html.indexOf('</li>', start))
  }

  it('每人一張 16:9 tile：頭像圓（暱稱首字）、左下暱稱（自己加「（你）」）、右下總分膠囊', () => {
    expect(html.match(/<li /g)).toHaveLength(3)
    expect(tile('a')).toContain('aspect-video')
    expect(tile('a')).toContain('>R</span>')
    expect(tile('a')).toContain('rex（你）')
    expect(tile('b')).toContain('>amy</span>')
    expect(tile('a')).toMatch(/rounded-full bg-editor\/70 px-\[6px\] tabular-nums"><span>207 分<\/span>/)
    expect(tile('b')).toContain('<span>95 分</span>')
  })

  it('膠囊顯示的是總分，不是本局得分；本首 +N 不上 tile（在工具提示與 sr-only）', () => {
    const visible = tile('a').slice(tile('a').indexOf('aria-hidden="true"'))
    expect(visible).not.toContain('87')
    expect(tile('a')).toContain('data-tooltip="rex：207 分，出題者，已猜對，本首 +87，你"')
    expect(tile('a')).toContain('<span class="sr-only">rex：207 分，出題者，已猜對，本首 +87，你</span>')
  })

  it('出題者：左上喇叭圖示＋2px --border-focus 外框；本首已猜對：右上舉手圖示 --accent；斷線：opacity .5＋「連線中斷」', () => {
    expect(tile('a')).toContain('outline-2 -outline-offset-2 outline-border-focus')
    expect(tile('a')).toMatch(/absolute top-\[8px\] left-\[8px\]/)
    expect(tile('a')).toMatch(/absolute top-\[8px\] right-\[8px\][^"]*text-accent/)
    expect(tile('a')).toContain('data-setter=""')
    expect(tile('a')).toContain('data-guessed=""')
    expect(tile('b')).not.toMatch(/outline-border-focus|top-\[8px\]|data-setter|data-guessed/)
    expect(tile('c')).toContain('opacity-50')
    expect(tile('c')).toContain('連線中斷')
  })
})

// ─── 聊天 ───────────────────────────────────────────────────────

describe('MeetChat（design §1「猜題」）', () => {
  const line = (p: Partial<ChatLineData> & Pick<ChatLineData, 'kind'>): ChatLineData => ({
    id: 'm1',
    fromId: 'b',
    nickname: 'amy',
    text: '是不是遇見',
    at: 0,
    time: '14:32',
    isMine: false,
    ...p,
  })
  const input: ChatComposerProps['input'] = {
    value: '',
    onChange: noop,
    maxLength: 400,
    placeholder: '輸入歌名或聊天',
    'aria-label': '聊天輸入',
    'aria-invalid': false,
    autoComplete: 'off',
    enterKeyHint: 'send',
  }

  it('chat：暱稱＋HH:mm 一行、內文在下；自己的訊息名字顯示「你」', () => {
    const html = renderToStaticMarkup(<MeetChatLine line={line({ kind: 'chat' })} />)
    expect(html).toMatch(/^<li data-kind="chat"/)
    expect(html).toContain('>amy</span>')
    expect(html).toContain('>14:32</time>')
    expect(html).toContain('>是不是遇見</p>')
    expect(renderToStaticMarkup(<MeetChatLine line={line({ kind: 'chat', isMine: true })} />)).toContain('>你</span>')
  })

  it('correct：「X 猜對了」綠字（--sem-type）加打勾圖示', () => {
    const html = renderToStaticMarkup(<MeetChatLine line={line({ kind: 'correct', text: 'amy 猜對了' })} />)
    expect(html).toMatch(/^<li data-kind="correct" class="[^"]*text-sem-type">/)
    expect(html).toContain('<svg')
    expect(html).toContain('>amy 猜對了</span>')
  })

  it('system：置中小字，原文照顯示（每首揭曉「第 n 首：《歌名》」）', () => {
    const html = renderToStaticMarkup(<MeetChatLine line={line({ kind: 'system', fromId: null, nickname: null, text: '第 2 首：《遇見》' })} />)
    expect(html).toMatch(/^<li data-kind="system" class="[^"]*text-center[^"]*text-fg-on-panel-muted">第 2 首：《遇見》<\/li>$/)
  })

  it('連續同人訊息只顯示一次名字（時間留給報讀器）', () => {
    const grouped = renderToStaticMarkup(<MeetChatLine line={line({ kind: 'chat', text: '還是天黑黑' })} groupWithPrevious />)
    expect(grouped).toContain('data-grouped=""')
    expect(grouped).toContain('<span class="sr-only">amy 14:32</span>')
    expect(grouped).not.toContain('<time')
  })

  it('輸入列：上方功能提示「輸入歌名或聊天」、膠囊 placeholder「傳送訊息給所有人」、送出鈕 aria-disabled（不用原生 disabled）', () => {
    const html = renderToStaticMarkup(<MeetComposer onSubmit={noop} input={input} error={null} canSend={false} />)
    expect(html).toMatch(/<p id="[^"]+" class="[^"]*text-fg-on-panel-muted">輸入歌名或聊天<\/p>/)
    expect(html).toContain('placeholder="傳送訊息給所有人"')
    expect(html).toContain('aria-label="傳送訊息" aria-disabled="true"')
    expect(html).not.toMatch(/\sdisabled=""/)
    expect(renderToStaticMarkup(<MeetComposer onSubmit={noop} input={input} error={null} canSend />)).toContain('aria-disabled="false"')
  })

  it('被擋下的訊息：錯誤顯示在輸入列上方（role="alert"）', () => {
    const html = renderToStaticMarkup(<MeetComposer onSubmit={noop} input={input} error="你已經猜對了，不要說出歌名" canSend />)
    expect(html).toMatch(/<p role="alert" class="[^"]*text-sem-error">/)
    expect(html).toContain('你已經猜對了，不要說出歌名')
  })

  it('MEET_VIEWS 提供全部欄位（沒有預設外觀）', () => {
    expect(Object.keys(MEET_VIEWS).sort()).toEqual(['Dialog', 'PlayerList', 'Stage', 'Volume', 'chat', 'help', 'status', 'volunteer'])
    expect(MEET_VIEWS.volunteer.label).toBe('分享音訊')
    expect(MEET_VIEWS.Stage).toBe(MeetStage)
    expect(MEET_VIEWS.Volume).toBe(MeetVolume)
  })
})

// ─── MeetShell 版面 ─────────────────────────────────────────────

type GameRound = Extract<ShellProps, { screen: 'game' }>['round']
const themes = { current: 'meet' as const, options: THEME_CATALOG, select: noop }
function gameProps(round: Partial<GameRound> = {}, online = 2): ShellProps {
  return {
    screen: 'game',
    round: { phase: 'idle', isSetter: false, setterName: null, songIndex: null, songCount: 5, showLastResults: false, ...round },
    counts: { online, total: online },
    themes,
    help: { open: noop },
    players: <i data-slot="players" />,
    stage: <i data-slot="stage" />,
    chat: <i data-slot="chat" />,
    roundStatus: <i data-slot="roundStatus" />,
    volunteer: <i data-slot="volunteer" />,
    volume: <i data-slot="volume" />,
    connection: <i data-slot="connection" />,
    dialogs: <i data-slot="dialogs" />,
  }
}
const shell = (round: Partial<GameRound> = {}, online = 2) => renderToStaticMarkup(<MeetShell {...gameProps(round, online)} />)

describe('MeetShell：插槽擺放（architecture §7：stage、roundStatus、volunteer、chat、players、volume）', () => {
  it('遊戲畫面：主畫面（stage、字幕列 roundStatus、對話框）｜參加者（players）｜「通話中的訊息」面板（chat）｜控制列（connection、volume、volunteer）', () => {
    const html = shell()
    for (const slot of ['players', 'stage', 'chat', 'roundStatus', 'volunteer', 'volume', 'connection', 'dialogs']) {
      expect(html.match(new RegExp(`data-slot="${slot}"`, 'g')), slot).toHaveLength(1)
    }
    expect(html).toMatch(/<section aria-label="通話中的訊息"[^>]*bg-panel[^>]*>[\s\S]*data-slot="chat"/)
    expect(html).toMatch(/<aside aria-label="參加者"[^>]*>[\s\S]*data-slot="players"/)
    expect(html).toMatch(/<footer aria-label="會議控制項"[^>]*h-\[80px\]/)
    expect(html).toMatch(/<div data-stage-area=""[^>]*><i data-slot="stage"><\/i><\/div>/)
    expect(html).toContain('kqw-mzdv-ptj')
  })

  it('音量在控制列中央、麥克風左側；「分享音訊」在字幕與舉手之間', () => {
    const html = shell()
    const footer = html.slice(html.indexOf('<footer'))
    expect(footer.indexOf('data-slot="volume"')).toBeLessThan(footer.indexOf('data-tooltip="開啟麥克風"'))
    expect(footer.indexOf('data-tooltip="開啟字幕"')).toBeLessThan(footer.indexOf('data-slot="volunteer"'))
    expect(footer.indexOf('data-slot="volunteer"')).toBeLessThan(footer.indexOf('data-tooltip="舉手"'))
  })

  it('字幕列：主畫面下方置中、底 --bg-tab-active 90%、14px', () => {
    expect(shell()).toMatch(/class="absolute bottom-\[12px\] left-1\/2 [^"]*rounded-\[8px\] bg-tab-active\/90[^"]*text-\[14px\][^"]*"><i data-slot="roundStatus">/)
  })

  it('舞台標籤：playing「<出題者> 正在分享音訊」（加喇叭圖示）、reveal「第 2 / 5 首」、idle 上一局結果「上一局」；其餘沒有標籤', () => {
    const playing = shell({ phase: 'playing', setterName: 'rex', songIndex: 2 })
    expect(playing).toMatch(/<span data-stage-label=""[^>]*><svg[\s\S]*?<\/svg><span class="truncate">rex 正在分享音訊<\/span><\/span>/)
    expect(shell({ phase: 'reveal', setterName: 'rex', songIndex: 2 })).toMatch(/<span data-stage-label=""[^>]*><span class="truncate">第 2 \/ 5 首<\/span>/)
    expect(shell({ phase: 'idle', showLastResults: true })).toContain('<span class="truncate">上一局</span>')
    for (const r of [{}, { phase: 'choosing', setterName: 'rex' }, { phase: 'ended', setterName: 'rex' }] as Partial<GameRound>[]) {
      expect(shell(r)).not.toContain('data-stage-label')
    }
  })

  it('「分享音訊」：idle／ended 人數足夠 → 放 volunteer 插槽', () => {
    expect(shell({}, 2)).toContain('data-share-control="ready"')
    expect(shell({}, 2)).toContain('data-slot="volunteer"')
    expect(shell({ phase: 'ended', isSetter: true, setterName: 'rex' }, 3)).toContain('data-slot="volunteer"')
  })

  it('「分享音訊」：人數不足 → opacity .5＋上方小字「等待其他玩家加入（1/2）」', () => {
    const html = shell({}, 1)
    expect(html).not.toContain('data-slot="volunteer"')
    expect(html).toContain('data-share-control="waiting"')
    expect(html).toContain('>等待其他玩家加入（1/2）</span>')
    expect(html).toMatch(/aria-hidden="true" data-tooltip="分享音訊（等待其他玩家加入）"[^>]*opacity-50/)
  })

  it('「分享音訊」：自己出題中 → 作用中（--accent，不灰化）；別人出題中、播放中、揭曉中 → 灰化不可按', () => {
    const active = shell({ phase: 'choosing', isSetter: true, setterName: 'rex' }, 3)
    expect(active).toContain('data-share-control="active"')
    expect(active).toMatch(/data-tooltip="正在準備分享音訊"[^>]*class="[^"]*bg-button-secondary text-accent"/)
    expect(active).not.toContain('data-slot="volunteer"')
    for (const r of [{ phase: 'choosing', setterName: 'amy' }, { phase: 'playing', setterName: 'amy', songIndex: 1 }, { phase: 'reveal', songIndex: 1 }] as Partial<GameRound>[]) {
      const html = shell(r, 3)
      expect(html, r.phase).toContain('data-share-control="busy"')
      expect(html, r.phase).toMatch(/data-tooltip="分享音訊（這一局進行中）"[^>]*opacity-50/)
      expect(html, r.phase).not.toContain('data-slot="volunteer"')
      expect(html, r.phase).not.toContain('等待其他玩家加入')
    }
  })

  it('右側「使用者」顯示在線人數；「訊息」按鈕為切換（aria-pressed，預設開）；「資訊」＝說明', () => {
    const html = shell({}, 3)
    expect(html).toContain('aria-label="使用者 3 人"')
    expect(html).toMatch(/aria-label="通話中的訊息" aria-pressed="true"/)
    expect(html).toContain('aria-label="說明"')
    expect(html).toContain('aria-label="更多選項" aria-haspopup="menu"')
  })

  it('響應式 class：< 1280px 影片條 160px、< 1024px 影片條移到下方、< 768px 面板改覆蓋層', () => {
    const html = shell()
    expect(html).toMatch(/<aside aria-label="參加者" class="w-\[200px\][^"]*max-xl:w-\[160px\][^"]*max-lg:w-auto/)
    expect(html).toContain('max-lg:flex-col')
    expect(html).toMatch(/<section aria-label="通話中的訊息"[^>]*max-md:absolute[^>]*max-md:z-30/)
  })

  it('自動重連畫面：同一殼層、置中白卡片「正在重新加入通話…」＋connection；沒有輸入框、音量與標籤', () => {
    const html = renderToStaticMarkup(<MeetShell screen="resume" notice="正在重新加入…" connection={<i data-slot="connection" />} />)
    expect(html).toContain('正在重新加入通話…')
    expect(html).toContain('data-slot="connection"')
    expect(html).not.toContain('<input')
    expect(html).not.toContain('data-stage-label')
    expect(html).not.toContain('等待其他玩家加入（')
    expect(renderToStaticMarkup(<MeetResumeCard />)).toContain('role="status"')
  })

  it('殼層沒有畫布、工具列、圖片投放等我畫你猜的殘留', () => {
    const src = read('../src/shells/meet/MeetShell.tsx')
    expect(src).not.toMatch(/canvas|toolbar|分享畫面|畫師|drop-zone/i)
  })
})
