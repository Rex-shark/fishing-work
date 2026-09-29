// meet 主題（Epic 5 Phase 1）：註冊、titleFor／favicon、catalog、App 注入的畫師暱稱（shellRound.drawerNameOf）、版面純邏輯、殼層分界
import { describe, expect, it } from 'vitest'
import { SHELLS, getShell, isRegisteredShellId, resolveShellId } from '../src/shells'
import { THEME_CATALOG } from '../src/shells/catalog'
import { applyDocumentTheme, type ShellDocument } from '../src/shells/document'
import { meetShell } from '../src/shells/meet/definition'
import {
  MEET_APP_TITLE,
  MEET_CODE,
  MEET_DIALOG_BUTTONS,
  MEET_DIALOG_TITLE,
  MEET_RESUME_TEXT,
  chatSenderName,
  clockText,
  dialogKeyAction,
  isDestructiveButton,
  meetDialogButtonLabel,
  meetDialogButtonText,
  meetWindowTitle,
  participantCount,
  presenterLabel,
  tileName,
  waitingForPlayers,
} from '../src/shells/meet/meetLayout'
import { MEET_CHAT_VIEW, MEET_STATUS_VIEW, MEET_TOOLBAR_VIEW, MEET_VIEWS, MEET_VOLUNTEER_VIEW } from '../src/shells/meet/meetViews'
import { MeetDialog } from '../src/shells/meet/MeetDialog'
import { ParticipantTiles } from '../src/shells/meet/ParticipantTiles'
import { ShareScreenIcon } from '../src/shells/meet/meetIcons'
import { VideoCallIcon } from '../src/shells/themeIcons'
import { drawerNameOf } from '../src/shellRound'

const fs = (await import('node:fs' as string)) as {
  readFileSync(path: URL, encoding: 'utf8'): string
  existsSync(path: URL): boolean
}
const meetSources = import.meta.glob<string>('../src/shells/meet/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })
const appSource = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

describe('註冊表：meet', () => {
  it('SHELLS 順序 vscode、ppt、meet；meet 可解析', () => {
    expect(SHELLS.map((s) => s.id)).toEqual(['vscode', 'ppt', 'meet'])
    expect(isRegisteredShellId('meet')).toBe(true)
    expect(resolveShellId('meet')).toBe('meet')
    expect(getShell('meet')).toBe(meetShell)
    // 大小寫不同、未註冊的名稱仍回退 vscode
    expect(resolveShellId('MEET')).toBe('vscode')
    expect(resolveShellId('keynote')).toBe('vscode')
  })

  it('定義只有 { id, name, description, icon, Shell, titleFor, faviconHref }；名稱「視訊會議」、描述照規格、綠色攝影機圖示', () => {
    expect(Object.keys(meetShell).sort()).toEqual(['Shell', 'description', 'faviconHref', 'icon', 'id', 'name', 'titleFor'])
    expect(meetShell.name).toBe('視訊會議')
    expect(meetShell.description).toBe('深色視訊會議，像在開會分享畫面')
    expect([...meetShell.description].length).toBeLessThanOrEqual(20)
    expect(meetShell.icon).toBe(VideoCallIcon)
    expect(typeof meetShell.Shell).toBe('function')
  })

  it('catalog：第三張卡片「視訊會議」可選，名稱、描述、圖示取自註冊表', () => {
    expect(THEME_CATALOG).toHaveLength(3)
    const meet = THEME_CATALOG[2]
    expect(meet).toMatchObject({ id: 'meet', name: '視訊會議', description: '深色視訊會議，像在開會分享畫面', available: true })
    expect(meet?.icon).toBe(VideoCallIcon)
  })
})

describe('titleFor 與 favicon（DESIGN §15.3；plan 決策 7）', () => {
  it('非作畫階段：`Meet – kqw-mzdv-ptj`（破折號為 en dash U+2013）', () => {
    for (const phase of ['idle', 'choosing', 'ended'] as const) expect(meetShell.titleFor({ phase })).toBe('Meet – kqw-mzdv-ptj')
    expect(MEET_APP_TITLE).toBe('Meet – kqw-mzdv-ptj')
    expect(MEET_CODE).toBe('kqw-mzdv-ptj')
  })

  it('作畫中前綴「● 」（與 vscode／ppt 一致）', () => {
    expect(meetShell.titleFor({ phase: 'drawing' })).toBe('● Meet – kqw-mzdv-ptj')
    expect(meetWindowTitle('drawing')).toBe('● Meet – kqw-mzdv-ptj')
  })

  it('favicon：public/favicon-meet.svg（依 Vite base），檔案存在、自繪攝影機（無商標字樣）', () => {
    expect(meetShell.faviconHref).toBe(`${import.meta.env.BASE_URL}favicon-meet.svg`)
    const url = new URL('../public/favicon-meet.svg', import.meta.url)
    expect(fs.existsSync(url)).toBe(true)
    const svg = fs.readFileSync(url, 'utf8')
    expect(svg).toMatch(/^<svg /)
    expect(svg).not.toMatch(/google|meet/i)
  })

  it('applyDocumentTheme：data-theme=meet、標題、favicon', () => {
    const attrs = new Map<string, string>()
    const icon = new Map<string, string>()
    const doc: ShellDocument = {
      title: '',
      documentElement: { getAttribute: (n) => attrs.get(n) ?? null, setAttribute: (n, v) => void attrs.set(n, v) },
      querySelector: () => ({ getAttribute: (n) => icon.get(n) ?? null, setAttribute: (n, v) => void icon.set(n, v) }),
    }
    applyDocumentTheme(doc, meetShell, { phase: 'drawing' })
    expect(attrs.get('data-theme')).toBe('meet')
    expect(doc.title).toBe('● Meet – kqw-mzdv-ptj')
    expect(icon.get('href')).toBe(meetShell.faviconHref)
  })
})

describe('畫師暱稱（ShellRoundState.drawerName；決策 12）：App 由 players 依 round.drawerId 推導', () => {
  const players = [
    { id: 'a', nickname: 'rex' },
    { id: 'b', nickname: 'amy' },
  ]

  it('idle → null（即使 drawerId 殘留）', () => {
    expect(drawerNameOf({ phase: 'idle', drawerId: null }, players)).toBeNull()
    expect(drawerNameOf({ phase: 'idle', drawerId: 'a' }, players)).toBeNull()
  })

  it.each(['choosing', 'drawing', 'ended'] as const)('%s → 畫師暱稱（ended 仍有值，揭曉時標籤照舊）', (phase) => {
    expect(drawerNameOf({ phase, drawerId: 'b' }, players)).toBe('amy')
  })

  it('畫師不在 players（已離開）或 drawerId 為 null → null', () => {
    expect(drawerNameOf({ phase: 'drawing', drawerId: 'zzz' }, players)).toBeNull()
    expect(drawerNameOf({ phase: 'ended', drawerId: null }, players)).toBeNull()
  })

  it('App 把 drawerName 放進 round（不另開頂層欄位）', () => {
    expect(appSource).toContain('round={{ phase, isDrawer, canDraw, drawerName }}')
    expect(appSource).toContain('drawerNameOf(s.round, s.players)')
  })
})

describe('meet 版面純邏輯（meetLayout）', () => {
  it('主畫面標籤：「<畫師> 正在分享畫面」／「尚無人分享畫面」', () => {
    expect(presenterLabel('rex')).toBe('rex 正在分享畫面')
    expect(presenterLabel(null)).toBe('尚無人分享畫面')
    expect(presenterLabel('')).toBe('尚無人分享畫面')
  })

  it('tile 左下文字：自己加「（你）」、斷線為「連線中斷」', () => {
    expect(tileName('amy', false, true)).toBe('amy')
    expect(tileName('rex', true, true)).toBe('rex（你）')
    expect(tileName('ben', false, false)).toBe('連線中斷')
    expect(tileName('rex', true, false)).toBe('連線中斷')
  })

  it('訊息名字：自己送出的為「你」', () => {
    expect(chatSenderName('amy', false)).toBe('amy')
    expect(chatSenderName('rex', true)).toBe('你')
    expect(chatSenderName(null, false)).toBe('')
  })

  it('人數不足的說明與 vscode／ppt 同用詞；使用者人數至少 1（自己）', () => {
    expect(waitingForPlayers(1)).toBe('等待其他玩家加入（1/2）')
    expect(participantCount(0)).toBe(1)
    expect(participantCount(3)).toBe(3)
  })

  it('時間 HH:mm（本機時間、補零）', () => {
    expect(clockText(new Date(2026, 8, 25, 9, 5))).toBe('09:05')
    expect(clockText(new Date(2026, 8, 25, 23, 59))).toBe('23:59')
  })

  it('對話框：標題、按鈕文字（第一個＝主要）、無障礙名稱以可見文字開頭、「停止分享」為破壞性', () => {
    expect(MEET_DIALOG_TITLE).toEqual({ topic: '輸入題目', cancelRound: '停止分享畫面？' })
    expect(MEET_DIALOG_BUTTONS).toEqual({ topic: ['分享', '取消'], cancelRound: ['停止分享', '繼續分享'] })
    expect(meetDialogButtonText('topic', 0, '出題並開始作畫')).toBe('分享')
    expect(meetDialogButtonText('topic', 1, '放棄本回合')).toBe('取消')
    expect(meetDialogButtonText('topic', 2, '其他')).toBe('其他')
    expect(meetDialogButtonLabel('cancelRound', 0, '放棄本回合')).toBe('停止分享：放棄本回合')
    expect(meetDialogButtonLabel('cancelRound', 1, '繼續作畫')).toBe('繼續分享：繼續作畫')
    expect(meetDialogButtonLabel('topic', 2, '其他')).toBe('其他')
    expect(isDestructiveButton('cancelRound', 0)).toBe(true)
    expect(isDestructiveButton('cancelRound', 1)).toBe(false)
    expect(isDestructiveButton('topic', 0)).toBe(false)
    expect(MEET_RESUME_TEXT).toBe('正在重新加入通話…')
  })

  it('Esc＝取消；輸入法組字中不攔截；Enter 交給 form 原生 submit', () => {
    expect(dialogKeyAction('Escape', false)).toBe('cancel')
    expect(dialogKeyAction('Escape', true)).toBeNull()
    expect(dialogKeyAction('Enter', false)).toBeNull()
  })
})

describe('meet 的 ShellViews', () => {
  it('Dialog＝MeetDialog、PlayerList＝ParticipantTiles、chat／toolbar／status／volunteer 皆提供', () => {
    expect(MEET_VIEWS.Dialog).toBe(MeetDialog)
    expect(MEET_VIEWS.PlayerList).toBe(ParticipantTiles)
    expect(MEET_VIEWS.chat).toBe(MEET_CHAT_VIEW)
    expect(MEET_VIEWS.toolbar).toBe(MEET_TOOLBAR_VIEW)
    expect(MEET_VIEWS.status).toBe(MEET_STATUS_VIEW)
    expect(MEET_VIEWS.volunteer).toBe(MEET_VOLUNTEER_VIEW)
  })

  it('工具列收合斷點 1280px（決策 13(4)；vscode 1120、ppt 640）；「分享畫面」＋分享圖示', () => {
    expect(MEET_TOOLBAR_VIEW).toEqual({ compactBelowPx: 1280 })
    expect(MEET_VOLUNTEER_VIEW).toEqual({ label: '分享畫面', icon: ShareScreenIcon })
  })

  it('聊天面板底 --bg-panel；控制列按鈕為圓形、深色底、focus --border-focus', () => {
    expect(MEET_CHAT_VIEW.panelClassName).toContain('bg-panel')
    expect(MEET_CHAT_VIEW.panelClassName).toContain('text-fg-on-panel')
    expect(MEET_STATUS_VIEW.buttonClassName).toContain('rounded-full')
    expect(MEET_STATUS_VIEW.buttonClassName).toContain('bg-button-secondary')
    expect(MEET_STATUS_VIEW.buttonClassName).toContain('focus-visible:outline-border-focus')
  })
})

describe('meet 殼層分界', () => {
  it('掃描到 meet 殼層原始碼', () => {
    const files = Object.keys(meetSources)
    expect(files.length).toBeGreaterThanOrEqual(8)
    for (const name of ['definition.ts', 'MeetShell.tsx', 'MeetDialog.tsx', 'MeetChat.tsx', 'ParticipantTiles.tsx', 'meetViews.ts', 'meetIcons.tsx', 'meetLayout.ts']) {
      expect(files.some((f) => f.endsWith(`/meet/${name}`)), name).toBe(true)
    }
  })

  it('不 import uiStore／catalog／store/game／ThemeCards／首頁／其他殼層（主題資料經 ShellProps.themes、人數經 counts、畫師經 round.drawerName）', () => {
    for (const [file, src] of Object.entries(meetSources)) {
      const imports = [...src.matchAll(/(?:from|import) '([^']+)'/g)].map((m) => m[1] ?? '')
      expect(
        imports.filter((p) => /uiStore$|\/catalog$|(?:^|\/)store\/game$|ThemeCards$|\/home\/|\/shells\/(?:vscode|ppt)\/|^\.\.\/(?:vscode|ppt)\//.test(p)),
        file,
      ).toEqual([])
    }
  })

  it('不含色碼（DESIGN §10：一律用 token class）', () => {
    for (const [file, src] of Object.entries(meetSources)) expect(src.match(/#[0-9a-fA-F]{3,8}\b/g), file).toBeNull()
  })

  it('右側面板（聊天容器）帶投放區屬性 data-chat-drop-zone 且為定位元素', () => {
    const shell = Object.entries(meetSources).find(([f]) => f.endsWith('/MeetShell.tsx'))?.[1] ?? ''
    expect(shell).toMatch(/data-chat-drop-zone=""[\s\S]{0,400}?className=\{`relative /)
  })

  it('不用 Google 圖示字型與商標字樣（Material Icons、Google Meet）', () => {
    for (const [file, src] of Object.entries(meetSources)) expect(src, file).not.toMatch(/material-icons|material-symbols|Google Meet|googleapis/i)
  })

  it('參加者 tile 內不用 --fg-muted（tile 上只有 4.0:1；DESIGN §15.1）', () => {
    const tiles = Object.entries(meetSources).find(([f]) => f.endsWith('/ParticipantTiles.tsx'))?.[1] ?? ''
    expect(tiles).not.toMatch(/text-fg-muted|text-fg-dim/)
  })

  it('白色面板（MeetChat、MeetDialog）不用深色區的文字色（--fg／--fg-muted／--fg-editor）', () => {
    for (const name of ['MeetChat.tsx', 'MeetDialog.tsx']) {
      const src = Object.entries(meetSources).find(([f]) => f.endsWith(`/meet/${name}`))?.[1] ?? ''
      expect(src, name).not.toMatch(/\btext-fg(?:-muted|-editor|-dim)?\b(?!-)/)
    }
  })
})
