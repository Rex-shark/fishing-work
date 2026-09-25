// ppt 主題的呈現元件（Epic 3 Phase 3 A）：縮圖窗格玩家清單、PPT 對話框、「檔案」選單的切換偽裝（靜態渲染＋純邏輯）
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRef } from 'react'
import type { PlayerPublic } from '@fishing-work/shared'
import { THEME_CATALOG } from '../src/shells/catalog'
import { FileTab, PptThemeDialog } from '../src/shells/ppt/FileMenu'
import { PptDialog, PptResumeDialog } from '../src/shells/ppt/PptDialog'
import {
  PPT_DIALOG_TITLE,
  PPT_RESUME_TITLE,
  THEME_CURRENT_NOTE,
  THEME_UPCOMING_NOTE,
  choosePptTheme,
  pptThemeInitialIndex,
  pptThemeItems,
  stepThemeIndex,
} from '../src/shells/ppt/pptLayout'
import { SlidePlayers } from '../src/shells/ppt/SlidePlayers'
import type { ShellId, ShellThemeSwitch } from '../src/shells/types'
import type { DialogItem, PlayerRowData } from '../src/shells/views'

// ─── SlidePlayers ───────────────────────────────────────────────

function player(p: Partial<PlayerPublic> & Pick<PlayerPublic, 'id' | 'nickname'>): PlayerPublic {
  return { score: 0, isDrawer: false, hasGuessed: false, connected: true, joinedAt: 0, ...p }
}

const rows: PlayerRowData[] = [
  { player: player({ id: 'a', nickname: 'rex', score: 120, isDrawer: true }), isMe: true, gain: 40 },
  { player: player({ id: 'b', nickname: 'amy', score: 95, hasGuessed: true }), isMe: false, gain: 95 },
  { player: player({ id: 'c', nickname: 'ben', score: 7, connected: false }), isMe: false, gain: null },
]

/** 取某位玩家的 <li>…</li> */
function card(html: string, id: string): string {
  const start = html.indexOf(`data-player="${id}"`)
  expect(start).toBeGreaterThan(-1)
  const end = html.indexOf('</li>', start)
  return html.slice(start, end)
}

describe('SlidePlayers：左縮圖窗格的玩家清單（DESIGN §13.2）', () => {
  const html = renderToStaticMarkup(<SlidePlayers rows={rows} />)

  it('有序清單、每人一張編號縮圖卡（暱稱為標題、分數小字）', () => {
    expect(html).toMatch(/^<ol aria-label="玩家清單"/)
    expect(html.match(/<li /g)).toHaveLength(3)
    expect(card(html, 'a')).toContain('>1<')
    expect(card(html, 'b')).toContain('>2<')
    expect(card(html, 'c')).toContain('>3<')
    expect(card(html, 'b')).toMatch(/font-bold[^>]*>amy</)
    expect(card(html, 'b')).toContain('95 分')
    expect(html.match(/aspect-video/g)).toHaveLength(3)
  })

  it('畫師：橘色外框（outline-2 outline-accent）＋畫筆圖示；其他人 1px 邊', () => {
    expect(card(html, 'a')).toContain('outline-2 outline-accent')
    expect(card(html, 'a')).toContain('text-sem-function')
    expect(card(html, 'b')).toContain('outline-1 outline-border')
    expect(card(html, 'b')).not.toContain('outline-accent')
  })

  it('已猜對：右上綠勾；本回合得分 +N', () => {
    expect(card(html, 'b')).toMatch(/<svg[^>]*class="[^"]*text-sem-type/)
    expect(card(html, 'b')).toContain('+95')
    expect(card(html, 'c')).not.toMatch(/<svg[^>]*text-sem-type/)
  })

  it('斷線中淡化；自己的卡底 bg-active 並標「（你）」', () => {
    expect(card(html, 'c')).toMatch(/class="flex gap-1 opacity-50"/)
    expect(card(html, 'a')).toContain('bg-active')
    expect(card(html, 'a')).toContain('（你）')
    expect(card(html, 'b')).toContain('bg-slide')
    expect(card(html, 'b')).not.toContain('（你）')
  })

  it('完整狀態文字給輔助技術與工具提示（顏色不是唯一載體）', () => {
    expect(card(html, 'a')).toContain('rex：120 分，畫師，本回合 +40，你')
    expect(card(html, 'c')).toContain('ben：7 分，斷線中')
    expect(card(html, 'a')).toContain('class="sr-only"')
    expect(card(html, 'a')).toContain('data-tooltip="rex：120 分，畫師，本回合 +40，你"')
  })
})

// ─── PptDialog ─────────────────────────────────────────────────

const item = (id: string, label: string, extra: Partial<DialogItem> = {}): DialogItem => ({ id, label, onSelect: () => {}, ...extra })

describe('PptDialog：PPT 風格對話框（DESIGN §13.2「對話框」）', () => {
  it('輸入框：欄位標籤＋輸入框＋右側說明、主要按鈕「確定」為 submit（Enter 隱式送出）；沒有 footer（Epic 4：卡片列移到首頁）', () => {
    const html = renderToStaticMarkup(
      <PptDialog
        purpose="topic"
        label="出題"
        input={{ value: '蘋果', onChange: () => {}, placeholder: '輸入題目（1–20 字）後按 Enter', ariaLabel: '題目' }}
        items={[item('submit', '送出題目', { detail: '2/20' })]}
      />,
    )
    expect(html).toMatch(/^<form role="dialog" aria-label="出題"/)
    expect(html).toContain('輸入標題')
    expect(html).toMatch(/<label for="[^"]+"[^>]*>題目<\/label>/)
    expect(html).toContain('placeholder="輸入題目（1–20 字）後按 Enter"')
    expect(html).toContain('2/20')
    expect(html.match(/type="submit"/g)).toHaveLength(1)
    expect(html).toMatch(/type="submit" aria-label="確定：送出題目"[^>]*>確定<\/button>/)
    // 沒有 onEscape、只有一個選項：不顯示關閉鈕
    expect(html).not.toContain('aria-label="關閉"')
    expect(html).not.toContain('border-t border-border pt-3')
  })

  it('放棄確認：沒有輸入框時焦點在「確定」、第二個選項為「取消」、有提問文字與關閉鈕', () => {
    const html = renderToStaticMarkup(
      <PptDialog
        purpose="cancelRound"
        label="放棄本回合"
        title="放棄這一回合？題目會直接揭曉。"
        items={[item('confirm', '放棄本回合', { detail: 'Enter' }), item('keep', '繼續作畫', { detail: 'Esc' })]}
        onEscape={() => {}}
      />,
    )
    expect(html).toContain('捨棄變更？')
    expect(html).toContain('放棄這一回合？題目會直接揭曉。')
    expect(html).not.toContain('<input')
    expect(html).toMatch(/type="submit" autofocus="" aria-label="確定：放棄本回合"/)
    expect(html).toMatch(/type="button" aria-label="取消：繼續作畫"[^>]*>取消<\/button>/)
    expect(html).toContain('aria-label="關閉"')
    // 鍵盤提示（Enter／Esc）不顯示在 PPT 對話框
    expect(html).not.toContain('>Esc<')
  })

  it('出題：標題「輸入標題」；進行中選項只設 aria-disabled（不用原生 disabled）；錯誤以 role=alert 顯示', () => {
    const html = renderToStaticMarkup(
      <PptDialog
        purpose="topic"
        label="出題"
        input={{ value: '', onChange: () => {}, placeholder: '輸入題目（1–20 字）後按 Enter', ariaLabel: '題目', invalid: true }}
        items={[item('submit', '送出中…', { disabled: true }), item('cancel', '放棄本回合', { disabled: true })]}
        onEscape={() => {}}
        error="題目不可空白"
        note="提示"
      />,
    )
    expect(html).toContain('輸入標題')
    expect(html).toContain('aria-invalid="true"')
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(2)
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""/)
    expect(html).toMatch(/role="alert"[^>]*>題目不可空白</)
    expect(html).toContain('>提示<')
  })
})

// ─── 自動重連畫面（ShellProps screen 'resume'，Epic 4） ─────────────────────

describe('PptResumeDialog：自動重連畫面的對話框只放一行說明（Epic 4 決策 9）', () => {
  it('標題列「加入簡報」＋一行 notice（role=status）；沒有輸入框、按鈕、關閉鈕', () => {
    const html = renderToStaticMarkup(<PptResumeDialog notice="正在重新加入…" />)
    expect(PPT_RESUME_TITLE).toBe('加入簡報')
    expect(html).toMatch(/^<div role="dialog" aria-label="加入簡報"/)
    expect(html).toMatch(/role="status" aria-live="polite"[^>]*>正在重新加入…<\/p>/)
    expect(html).not.toContain('<input')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('<form')
  })

  it('對話框用途不再有 join（登入改在首頁）', () => {
    expect(Object.keys(PPT_DIALOG_TITLE).sort()).toEqual(['cancelRound', 'topic'])
  })
})

// ─── 「檔案」選單 → 切換偽裝 ──────────────────────────────────────

function switcher(current: ShellId, options = THEME_CATALOG) {
  const calls: ShellId[] = []
  const themes: ShellThemeSwitch = { current, options, select: (id) => void calls.push(id) }
  return { themes, calls }
}
/** 模擬尚有未上線主題的清單 */
const withUpcoming = THEME_CATALOG.map((o) => (o.id === 'ppt' ? { ...o, available: false } : o))

describe('pptThemeItems／choosePptTheme：與登入卡片同一份 catalog', () => {
  it('兩者上線：目前主題標「目前使用」', () => {
    expect(pptThemeItems(switcher('ppt').themes).map((i) => [i.id, i.note, i.disabled, i.current])).toEqual([
      ['vscode', undefined, false, false],
      ['ppt', THEME_CURRENT_NOTE, false, true],
    ])
    expect(pptThemeInitialIndex(switcher('ppt').themes)).toBe(1)
  })

  it('未上線主題：標「即將推出」、不可選', () => {
    const items = pptThemeItems(switcher('vscode', withUpcoming).themes)
    expect(items[1]).toMatchObject({ id: 'ppt', note: THEME_UPCOMING_NOTE, disabled: true })
  })

  it('選另一個已上線主題 → 呼叫 themes.select', () => {
    const { themes, calls } = switcher('ppt')
    expect(choosePptTheme(themes, 'vscode')).toBe(true)
    expect(calls).toEqual(['vscode'])
  })

  it('未上線 → 不呼叫；選目前主題 → 不呼叫（不重寫 localStorage）', () => {
    const upcoming = switcher('vscode', withUpcoming)
    expect(choosePptTheme(upcoming.themes, 'ppt')).toBe(false)
    expect(upcoming.calls).toEqual([])
    const same = switcher('ppt')
    expect(choosePptTheme(same.themes, 'ppt')).toBe(false)
    expect(same.calls).toEqual([])
  })

  it('↑↓ 略過不可選、循環；Home／End；其他鍵 null', () => {
    const items = [{ disabled: false }, { disabled: true }, { disabled: false }]
    expect(stepThemeIndex(items, 0, 'ArrowDown')).toBe(2)
    expect(stepThemeIndex(items, 2, 'ArrowDown')).toBe(0)
    expect(stepThemeIndex(items, 0, 'ArrowUp')).toBe(2)
    expect(stepThemeIndex(items, 2, 'Home')).toBe(0)
    expect(stepThemeIndex(items, 0, 'End')).toBe(2)
    expect(stepThemeIndex(items, 0, 'Enter')).toBeNull()
    expect(stepThemeIndex([{ disabled: true }], 0, 'ArrowDown')).toBeNull()
  })
})

describe('「檔案」分頁與切換偽裝對話框（靜態渲染）', () => {
  it('遊戲中：「檔案」為可操作按鈕（aria-haspopup=menu、關閉時 aria-expanded=false）', () => {
    const html = renderToStaticMarkup(<FileTab buttonRef={createRef()} onSwitchTheme={() => {}} />)
    expect(html).toMatch(/^<button type="button"/)
    expect(html).toContain('aria-label="檔案"')
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('cursor-pointer')
  })

  it('登入畫面（沒有 themes）：「檔案」為裝飾', () => {
    const html = renderToStaticMarkup(<FileTab buttonRef={createRef()} />)
    expect(html).toMatch(/^<span aria-hidden="true"/)
    expect(html).not.toContain('<button')
  })

  it('切換偽裝對話框：listbox 列出主題、目前主題選取並標「目前使用」、確定／取消', () => {
    const html = renderToStaticMarkup(<PptThemeDialog themes={switcher('ppt').themes} onClose={() => {}} />)
    expect(html).toMatch(/role="dialog" aria-label="切換偽裝"/)
    expect(html).toContain('role="listbox"')
    expect(html.match(/role="option"/g)).toHaveLength(2)
    expect(html).toMatch(/aria-selected="true"[^>]*>.*簡報.*目前使用/)
    expect(html).toContain('>確定<')
    expect(html).toContain('>取消<')
  })

  it('未上線主題：aria-disabled、即將推出、有提示', () => {
    const html = renderToStaticMarkup(<PptThemeDialog themes={switcher('vscode', withUpcoming).themes} onClose={() => {}} />)
    expect(html).toMatch(/aria-selected="false" aria-disabled="true"[^>]*>.*簡報.*即將推出/)
    expect(html).toContain('data-tooltip="「簡報」即將推出，暫不可選"')
  })
})
