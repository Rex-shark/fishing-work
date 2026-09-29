// meet 主題的呈現元件（Epic 5 Phase 1）：MeetChat（訊息格式、膠囊輸入列）、MeetDialog／MeetResumeCard、ParticipantTiles、MeetShell 版面（靜態渲染）
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PlayerPublic } from '@fishing-work/shared'
import { THEME_CATALOG } from '../src/shells/catalog'
import { MeetChatLine, MeetComposer } from '../src/shells/meet/MeetChat'
import { MeetDialog, MeetResumeCard } from '../src/shells/meet/MeetDialog'
import { MeetShell } from '../src/shells/meet/MeetShell'
import { ParticipantTiles } from '../src/shells/meet/ParticipantTiles'
import { avatarColorIndex } from '../src/shells/avatar'
import type { ShellProps } from '../src/shells/types'
import type { ChatInputProps, ChatLineData, DialogItem, PlayerRowData } from '../src/shells/views'

// ─── MeetChat ───────────────────────────────────────────────────

function line(p: Partial<ChatLineData> & Pick<ChatLineData, 'kind'>): ChatLineData {
  return { id: 'm1', fromId: 'b', nickname: 'amy', text: '是狗嗎', at: 0, time: '14:32', isMine: false, reveal: null, image: null, ...p }
}
const renderLine = (l: ChatLineData) => renderToStaticMarkup(<MeetChatLine line={l} />)

describe('MeetChatLine：通話中的訊息格式（DESIGN §15.3）', () => {
  it('chat：一行「暱稱  HH:mm」＋內文；白底面板 token（名字 13px／500、時間 12px 次要色、內文 14px）', () => {
    const html = renderLine(line({ kind: 'chat' }))
    expect(html).toMatch(/^<li data-kind="chat"/)
    expect(html).toMatch(/text-\[13px\][^"]*font-medium text-fg-on-panel">amy</)
    expect(html).toMatch(/<time[^>]*text-\[12px\][^"]*text-fg-on-panel-muted[^>]*>14:32</)
    expect(html).toMatch(/text-\[14px\][^"]*text-fg-on-panel">是狗嗎</)
    expect(html).not.toContain('// ')
  })

  it('自己送出的訊息名字顯示「你」', () => {
    expect(renderLine(line({ kind: 'chat', isMine: true, nickname: 'rex' }))).toContain('>你<')
  })

  it('system：12px 次要色置中小字；揭曉的題目強調', () => {
    const plain = renderLine(line({ kind: 'system', fromId: null, nickname: null, text: 'amy 加入了' }))
    expect(plain).toMatch(/data-kind="system" class="[^"]*text-center text-\[12px\][^"]*text-fg-on-panel-muted">amy 加入了</)
    const reveal = renderLine(line({ kind: 'system', fromId: null, nickname: null, text: '題目是 狗（全員猜對）', reveal: { topic: '狗', reason: '全員猜對' } }))
    expect(reveal).toMatch(/題目是 <span class="font-medium text-fg-on-panel">狗<\/span>（全員猜對）/)
  })

  it('correct：--sem-type 綠字＋打勾圖示', () => {
    const html = renderLine(line({ kind: 'correct', text: 'amy 猜對了' }))
    expect(html).toMatch(/data-kind="correct" class="[^"]*text-sem-type/)
    expect(html).toContain('<svg')
    expect(html).toContain('amy 猜對了')
  })

  it('image：有圖時為縮圖卡（最大 240×160）；沒有圖時為次要色佔位', () => {
    const meta = { width: 800, height: 400, mime: 'image/png' as const, bytes: 1000 }
    const ready = renderLine(line({ kind: 'image', text: '', image: { meta, status: 'ready', url: 'blob:x', placeholder: null } }))
    expect(ready).toContain('src="blob:x"')
    expect(ready).toContain('width:240px')
    const loading = renderLine(line({ kind: 'image', text: '', image: { meta, status: 'pending', url: null, placeholder: '[圖片]（載入中…）' } }))
    expect(loading).toMatch(/text-fg-on-panel-muted">\[圖片\]（載入中…）</)
  })
})

const input: ChatInputProps = {
  value: '',
  onChange: () => {},
  onPaste: () => {},
  maxLength: 100,
  placeholder: '輸入答案或聊天',
  'aria-label': '聊天或猜題',
  'aria-invalid': false,
  autoComplete: 'off',
  enterKeyHint: 'send',
}

describe('MeetComposer：膠囊輸入列（DESIGN §15.2）', () => {
  it('form ＋ input；placeholder 固定「傳送訊息給所有人」，功能提示改在輸入列上方並以 aria-describedby 連結', () => {
    const html = renderToStaticMarkup(<MeetComposer onSubmit={() => {}} input={input} error={null} canSend={false} />)
    expect(html).toMatch(/^<form/)
    expect(html).toContain('placeholder="傳送訊息給所有人"')
    const hintId = /<p id="([^"]+)"[^>]*text-fg-on-panel-muted[^>]*>輸入答案或聊天<\/p>/.exec(html)?.[1]
    expect(hintId).toBeDefined()
    expect(html).toContain(`aria-describedby="${hintId}"`)
    expect(html).toMatch(/rounded-\[24px\] bg-input/)
    expect(html).toContain('h-[40px]')
  })

  it('送出圖示：不可送出時 aria-disabled＋次要色（不是原生 disabled）；可送出時 --accent-panel', () => {
    const off = renderToStaticMarkup(<MeetComposer onSubmit={() => {}} input={input} error={null} canSend={false} />)
    expect(off).toMatch(/type="submit" aria-label="傳送訊息" aria-disabled="true"[^>]*text-fg-on-panel-muted/)
    expect(off).not.toMatch(/\sdisabled=""/)
    const on = renderToStaticMarkup(<MeetComposer onSubmit={() => {}} input={input} error={null} canSend />)
    expect(on).toMatch(/aria-disabled="false"[^>]*text-accent-panel/)
  })

  it('錯誤：role="alert"、--sem-error（只在白底）', () => {
    const html = renderToStaticMarkup(<MeetComposer onSubmit={() => {}} input={input} error="不可洩題" canSend />)
    expect(html).toMatch(/role="alert" class="[^"]*text-sem-error/)
    expect(html).toContain('不可洩題')
  })
})

// ─── MeetDialog ─────────────────────────────────────────────────

const items = (labels: [string, string]): DialogItem[] => [
  { id: 'a', label: labels[0], onSelect: () => {} },
  { id: 'b', label: labels[1], onSelect: () => {} },
]

describe('MeetDialog：白卡片、藍字文字按鈕（DESIGN §15.2）', () => {
  it('出題：標題「輸入題目」、輸入框、按鈕「取消」「分享」（主要在最右、type=submit）', () => {
    const html = renderToStaticMarkup(
      <MeetDialog
        purpose="topic"
        label="出題"
        input={{ value: '', onChange: () => {}, placeholder: '輸入題目（1–20 字）後按 Enter', ariaLabel: '題目' }}
        items={items(['出題並開始作畫', '放棄本回合'])}
      />,
    )
    expect(html).toMatch(/^<form role="dialog" aria-label="出題"/)
    expect(html).toContain('rounded-[8px] bg-panel')
    expect(html).toMatch(/<h2[^>]*text-\[20px\][^>]*>輸入題目<\/h2>/)
    expect(html).toContain('placeholder="輸入題目（1–20 字）後按 Enter"')
    const cancelAt = html.indexOf('>取消<')
    const shareAt = html.indexOf('>分享<')
    expect(cancelAt).toBeGreaterThan(-1)
    expect(shareAt).toBeGreaterThan(cancelAt)
    expect(html).toMatch(/type="submit" aria-label="分享：出題並開始作畫"[^>]*text-accent-panel/)
    expect(html).toMatch(/type="button" aria-label="取消：放棄本回合"[^>]*text-accent-panel/)
    expect(html.match(/type="submit"/g)).toHaveLength(1)
  })

  it('放棄確認：「停止分享畫面？」、「繼續分享」「停止分享」（後者 --sem-error、預設焦點）', () => {
    const html = renderToStaticMarkup(
      <MeetDialog purpose="cancelRound" label="放棄本回合" title="放棄這一回合？題目會直接揭曉。" items={items(['放棄本回合', '繼續作畫'])} />,
    )
    expect(html).toContain('>停止分享畫面？</h2>')
    expect(html).toContain('放棄這一回合？題目會直接揭曉。')
    expect(html.indexOf('>繼續分享<')).toBeLessThan(html.indexOf('>停止分享<'))
    expect(html).toMatch(/type="submit" autofocus="" aria-label="停止分享：放棄本回合"[^>]*text-sem-error/)
  })

  it('不可按的選項：aria-disabled（不是原生 disabled）；錯誤 role="alert"', () => {
    const html = renderToStaticMarkup(
      <MeetDialog
        purpose="topic"
        label="出題"
        items={[{ id: 'a', label: '送出中…', onSelect: () => {}, disabled: true }, ...items(['x', '放棄本回合']).slice(1)]}
        error="題目不可空白"
      />,
    )
    expect(html).toContain('aria-disabled="true"')
    expect(html).not.toMatch(/\sdisabled=""/)
    expect(html).toMatch(/text-sem-error" role="alert">題目不可空白</)
  })

  it('自動重連卡片：一行「正在重新加入通話…」（role="status"），沒有按鈕', () => {
    const html = renderToStaticMarkup(<MeetResumeCard />)
    expect(html).toMatch(/role="status" aria-live="polite"[^>]*>正在重新加入通話…</)
    expect(html).not.toContain('<button')
  })
})

// ─── ParticipantTiles ───────────────────────────────────────────

function player(p: Partial<PlayerPublic> & Pick<PlayerPublic, 'id' | 'nickname'>): PlayerPublic {
  return { score: 0, isDrawer: false, hasGuessed: false, connected: true, joinedAt: 0, ...p }
}
const rows: PlayerRowData[] = [
  { player: player({ id: 'a', nickname: 'rex', score: 120, isDrawer: true }), isMe: true, gain: 40 },
  { player: player({ id: 'b', nickname: 'amy', score: 95, hasGuessed: true }), isMe: false, gain: 95 },
  { player: player({ id: 'c', nickname: 'ben', score: 7, connected: false }), isMe: false, gain: null },
]
function tile(html: string, id: string): string {
  const start = html.indexOf(`data-player="${id}"`)
  expect(start).toBeGreaterThan(-1)
  return html.slice(start, html.indexOf('</li>', start))
}

describe('ParticipantTiles：右側影片條的參加者 tile（DESIGN §15.2；決策 4）', () => {
  const html = renderToStaticMarkup(<ParticipantTiles rows={rows} />)

  it('清單「玩家清單」、每人一張 16:9 圓角 tile（底 --bg-tab-inactive）', () => {
    expect(html).toMatch(/^<ol aria-label="玩家清單"/)
    expect(html.match(/<li /g)).toHaveLength(3)
    expect(html.match(/aspect-video shrink-0 overflow-hidden rounded-\[8px\] bg-tab-inactive/g)).toHaveLength(3)
  })

  it('頭像圓：暱稱首字、依暱稱雜湊的 --avatar-n、--fg-on-avatar', () => {
    expect(tile(html, 'b')).toMatch(new RegExp(`h-\\[40px\\] w-\\[40px\\][^"]*text-fg-on-avatar[^"]*max-lg:h-\\[28px\\][^"]*bg-avatar-${avatarColorIndex('amy') + 1}">A<`))
  })

  it('左下暱稱（自己「（你）」、斷線「連線中斷」）、右下分數膠囊只顯示總分；tile 內文字一律 --fg', () => {
    expect(tile(html, 'a')).toContain('rex（你）')
    expect(tile(html, 'b')).toMatch(/>amy</)
    expect(tile(html, 'c')).toContain('連線中斷')
    expect(tile(html, 'a')).toContain('120 分')
    expect(html).toContain('text-[12px] leading-[16px] text-fg')
    expect(html).not.toMatch(/text-fg-muted|text-fg-dim/)
  })

  it('畫師：2px --border-focus 外框＋分享圖示；已猜對：舉手圖示 --accent；斷線：opacity .5', () => {
    expect(tile(html, 'a')).toContain('outline-2 -outline-offset-2 outline-border-focus')
    expect(tile(html, 'b')).not.toContain('outline-border-focus')
    expect(tile(html, 'b')).toMatch(/top-\[8px\] right-\[8px\][^"]*text-accent/)
    expect(tile(html, 'a')).not.toMatch(/top-\[8px\] right-\[8px\]/)
    expect(tile(html, 'c')).toContain('opacity-50')
  })

  it('決策 14：分數膠囊在所有寬度只顯示總分「N 分」；本回合 +N 只在工具提示與 sr-only（沒有依斷點隱藏的 +N）', () => {
    for (const [id, score, gain] of [['a', 120, 40], ['b', 95, 95]] as const) {
      const t = tile(html, id)
      const visible = t.slice(t.indexOf('aria-hidden="true"'))
      expect(visible, id).toMatch(new RegExp(`rounded-full bg-editor/70 px-\\[6px\\] tabular-nums"><span>${score} 分</span></span>`))
      expect(visible, id).not.toContain(`+${gain}`)
      expect(t, id).toContain(`data-tooltip="${id === 'a' ? 'rex' : 'amy'}：${score} 分`)
      expect(t, id).toMatch(new RegExp(`<span class="sr-only">[^<]*本回合 \\+${gain}`))
    }
    expect(html).not.toContain('max-lg:hidden">+')
    // 沒有本回合得分（gain null）時膠囊一樣只有總分
    expect(tile(html, 'c').slice(tile(html, 'c').indexOf('aria-hidden="true"'))).toContain('<span>7 分</span>')
  })

  it('完整狀態文字給輔助技術與工具提示（playerRowLabel）', () => {
    expect(tile(html, 'a')).toContain('data-tooltip="rex：120 分，畫師，本回合 +40，你"')
    expect(tile(html, 'a')).toContain('<span class="sr-only">rex：120 分，畫師，本回合 +40，你</span>')
  })
})

// ─── MeetShell 版面 ─────────────────────────────────────────────

const themes = { current: 'meet' as const, options: THEME_CATALOG, select: () => {} }
function gameProps(round: Partial<Extract<ShellProps, { screen: 'game' }>['round']> = {}, online = 2): ShellProps {
  return {
    screen: 'game',
    round: { phase: 'idle', isDrawer: false, canDraw: false, drawerName: null, ...round },
    counts: { online, total: online },
    themes,
    help: { open: () => {} },
    players: <i data-slot="players" />,
    canvas: <i data-slot="canvas" />,
    toolbar: <i data-slot="toolbar" />,
    chat: <i data-slot="chat" />,
    roundStatus: <i data-slot="roundStatus" />,
    volunteer: <i data-slot="volunteer" />,
    connection: <i data-slot="connection" />,
    dialogs: <i data-slot="dialogs" />,
  }
}

describe('MeetShell：插槽擺放（DESIGN §15.2）', () => {
  it('遊戲畫面：主畫面（canvas、字幕列 roundStatus、對話框）｜參加者（players）｜「通話中的訊息」面板（chat，投放區）｜控制列（connection、volunteer）', () => {
    const html = renderToStaticMarkup(<MeetShell {...gameProps()} />)
    for (const slot of ['players', 'canvas', 'chat', 'roundStatus', 'volunteer', 'connection', 'dialogs']) expect(html, slot).toContain(`data-slot="${slot}"`)
    expect(html).toMatch(/<section aria-label="通話中的訊息" data-chat-drop-zone="" class="relative [^"]*bg-panel[^>]*>[\s\S]*data-slot="chat"/)
    expect(html).toMatch(/<aside aria-label="參加者"[^>]*>[\s\S]*data-slot="players"/)
    expect(html).toMatch(/<footer aria-label="會議控制項"[^>]*h-\[80px\]/)
    expect(html).toContain('kqw-mzdv-ptj')
    expect(html).toContain('尚無人分享畫面')
  })

  it('浮動工具列只在畫師作畫中出現（canDraw）', () => {
    expect(renderToStaticMarkup(<MeetShell {...gameProps()} />)).not.toContain('data-slot="toolbar"')
    const drawing = renderToStaticMarkup(
      <MeetShell {...gameProps({ phase: 'drawing', isDrawer: true, canDraw: true, drawerName: 'rex' })} />,
    )
    expect(drawing).toMatch(/rounded-\[22px\] bg-tab-active[^"]*shadow-quickinput">[\s\S]*data-slot="toolbar"/)
    // 畫師自己作畫中：上方整列給工具列，不顯示分享標籤（其他人看得到）
    expect(drawing).not.toContain('正在分享畫面')
    const choosing = renderToStaticMarkup(<MeetShell {...gameProps({ phase: 'choosing', isDrawer: true, drawerName: 'rex' })} />)
    expect(choosing).toContain('rex 正在分享畫面')
    // 自己是畫師：主畫面 tile 外框
    expect(choosing).toContain('outline-2 -outline-offset-2 outline-border-focus')
    expect(drawing).toContain('rounded-[8px] bg-tab-active outline-2 -outline-offset-2 outline-border-focus')
  })

  it('猜題者：看到畫師的分享標籤，沒有工具列與外框', () => {
    const html = renderToStaticMarkup(<MeetShell {...gameProps({ phase: 'drawing', drawerName: 'amy' })} />)
    expect(html).toContain('amy 正在分享畫面')
    expect(html).not.toContain('data-slot="toolbar"')
    expect(html).not.toContain('outline-2 -outline-offset-2 outline-border-focus')
  })

  it('「分享畫面」：可開局時放 volunteer 插槽；人數不足時灰化＋「等待其他玩家加入（1/2）」；回合中灰化', () => {
    expect(renderToStaticMarkup(<MeetShell {...gameProps({}, 2)} />)).toContain('data-slot="volunteer"')
    const waiting = renderToStaticMarkup(<MeetShell {...gameProps({}, 1)} />)
    expect(waiting).not.toContain('data-slot="volunteer"')
    expect(waiting).toContain('等待其他玩家加入（1/2）')
    expect(waiting).toMatch(/aria-hidden="true" data-tooltip="分享畫面（等待其他玩家加入）"[^>]*opacity-50/)
    const inRound = renderToStaticMarkup(<MeetShell {...gameProps({ phase: 'drawing', drawerName: 'amy' }, 3)} />)
    expect(inRound).not.toContain('data-slot="volunteer"')
    expect(inRound).not.toContain('等待其他玩家加入')
  })

  it('右側「使用者」顯示在線人數；「訊息」按鈕為切換（aria-pressed，預設開）', () => {
    const html = renderToStaticMarkup(<MeetShell {...gameProps({}, 3)} />)
    expect(html).toContain('aria-label="使用者 3 人"')
    expect(html).toMatch(/aria-label="通話中的訊息" aria-pressed="true"/)
  })

  it('自動重連畫面：同一殼層、置中白卡片「正在重新加入通話…」＋connection，沒有輸入框', () => {
    const html = renderToStaticMarkup(<MeetShell screen="resume" notice="正在重新加入…" connection={<i data-slot="connection" />} />)
    expect(html).toContain('正在重新加入通話…')
    expect(html).toContain('data-slot="connection"')
    expect(html).toContain('data-chat-drop-zone=""')
    expect(html).not.toContain('<input')
    expect(html).not.toContain('等待其他玩家加入（')
  })
})
