// 偽裝主題註冊表與文件同步（複製自我畫你猜；spec/song-guess/architecture.md §7、design.md：v1 只註冊視訊會議）
import { describe, expect, it } from 'vitest'
import { pickScreen } from '../src/pickScreen'
import { DEFAULT_SHELL_ID, SHELLS, getShell, resolveShellId } from '../src/shells'
import {
  HOME_DOCUMENT,
  HOME_THEME_ID,
  applyDocumentTheme,
  applyThemeAttr,
  initialDocumentTheme,
  type ShellDocument,
} from '../src/shells/document'
import { meetShell } from '../src/shells/meet/definition'

const fs = (await import('node:fs' as string)) as { readFileSync(path: URL, encoding: 'utf8'): string }

describe('註冊表', () => {
  it('只註冊 meet（視訊會議），預設為 meet', () => {
    expect(SHELLS.map((s) => s.id)).toEqual(['meet'])
    expect(DEFAULT_SHELL_ID).toBe('meet')
  })

  it('每筆只有 { id, name, description, icon, Shell, titleFor, faviconHref }', () => {
    for (const s of SHELLS) {
      expect(Object.keys(s).sort()).toEqual(['Shell', 'description', 'faviconHref', 'icon', 'id', 'name', 'titleFor'])
      expect(s.name).not.toBe('')
      expect(typeof s.Shell).toBe('function')
      expect(typeof s.icon).toBe('function')
    }
  })

  it('description：一行且 ≤ 20 字', () => {
    expect(meetShell.description).toBe('深色視訊會議，像在開會分享音訊')
    for (const s of SHELLS) {
      expect([...s.description].length).toBeLessThanOrEqual(20)
      expect(s.description).not.toMatch(/\n/)
    }
  })
})

describe('resolveShellId / getShell：未知值回退 meet', () => {
  it('已註冊的 id 原樣回傳', () => {
    expect(resolveShellId('meet')).toBe('meet')
    expect(getShell('meet')).toBe(meetShell)
  })

  it.each([null, undefined, '', 'MEET', 'vscode', 'meet', 'excel', 'keynote', 42, {}])('%j → meet', (v) => {
    expect(resolveShellId(v)).toBe('meet')
    expect(getShell(v)).toBe(meetShell)
  })
})

describe('meet titleFor／favicon', () => {
  it('各階段都是 `Meet – kqw-mzdv-ptj`（分頁標題不洩漏有歌在播，沒有前綴）', () => {
    for (const phase of ['idle', 'choosing', 'playing', 'reveal', 'ended'] as const) expect(meetShell.titleFor({ phase })).toBe('Meet – kqw-mzdv-ptj')
  })

  it('favicon 為 public/favicon-meet.svg（依 Vite base）', () => {
    expect(meetShell.faviconHref).toBe(`${import.meta.env.BASE_URL}favicon-meet.svg`)
  })
})

/** 最小的假 document：記錄寫入次數 */
function fakeDocument(init: { title?: string; theme?: string | null; href?: string | null }) {
  const writes: string[] = []
  const attrs = new Map<string, string>()
  if (init.theme != null) attrs.set('data-theme', init.theme)
  const iconAttrs = new Map<string, string>()
  if (init.href != null) iconAttrs.set('href', init.href)
  let title = init.title ?? ''
  const doc: ShellDocument = {
    get title() {
      return title
    },
    set title(v: string) {
      writes.push(`title=${v}`)
      title = v
    },
    documentElement: {
      getAttribute: (n) => attrs.get(n) ?? null,
      setAttribute: (n, v) => {
        writes.push(`${n}=${v}`)
        attrs.set(n, v)
      },
    },
    querySelector: (sel) =>
      init.href === null || sel !== 'link[rel="icon"]'
        ? null
        : {
            getAttribute: (n) => iconAttrs.get(n) ?? null,
            setAttribute: (n, v) => {
              writes.push(`icon.${n}=${v}`)
              iconAttrs.set(n, v)
            },
          },
  }
  return { doc, writes, attrs, iconAttrs }
}

describe('applyDocumentTheme：<html data-theme>、title、favicon 隨主題', () => {
  it('寫入主題、標題與 favicon', () => {
    const { doc, attrs, iconAttrs } = fakeDocument({ title: '', theme: null, href: '/x.svg' })
    applyDocumentTheme(doc, meetShell, { phase: 'playing' })
    expect(attrs.get('data-theme')).toBe('meet')
    expect(doc.title).toBe('Meet – kqw-mzdv-ptj')
    expect(iconAttrs.get('href')).toBe(meetShell.faviconHref)
  })

  it('值相同時不重寫（favicon 不重新下載）', () => {
    const { doc, writes } = fakeDocument({ title: 'Meet – kqw-mzdv-ptj', theme: 'meet', href: meetShell.faviconHref })
    applyDocumentTheme(doc, meetShell, { phase: 'idle' })
    expect(writes).toEqual([])
  })

  it('沒有 favicon link 時略過', () => {
    const { doc } = fakeDocument({ href: null })
    expect(() => applyDocumentTheme(doc, meetShell, { phase: 'idle' })).not.toThrow()
  })

  it('applyThemeAttr 只設定 data-theme', () => {
    const { doc, writes } = fakeDocument({ theme: 'home' })
    applyThemeAttr(doc, meetShell.id)
    expect(writes).toEqual(['data-theme=meet'])
    applyThemeAttr(doc, HOME_THEME_ID)
    expect(writes).toEqual(['data-theme=meet', 'data-theme=home'])
  })
})

describe('首頁的文件主題（Epic 4 決策 5）', () => {
  it('HOME_DOCUMENT：data-theme="home"、title「fishing-work」（任何階段）、favicon 預設 favicon.svg（依 Vite base）', () => {
    expect(HOME_THEME_ID).toBe('home')
    expect(HOME_DOCUMENT.id).toBe('home')
    for (const phase of ['idle', 'choosing', 'playing', 'reveal', 'ended'] as const) expect(HOME_DOCUMENT.titleFor({ phase })).toBe('fishing-work')
    expect(HOME_DOCUMENT.faviconHref).toBe(`${import.meta.env.BASE_URL}favicon.svg`)
  })

  it('套用首頁：從殼層（meet）換成 home、標題與 favicon 還原', () => {
    const { doc, attrs, iconAttrs } = fakeDocument({ title: 'Meet – kqw-mzdv-ptj', theme: 'meet', href: meetShell.faviconHref })
    applyDocumentTheme(doc, HOME_DOCUMENT, { phase: 'idle' })
    expect(attrs.get('data-theme')).toBe('home')
    expect(doc.title).toBe('fishing-work')
    expect(iconAttrs.get('href')).toBe(HOME_DOCUMENT.faviconHref)
  })

  it('首頁 → 進殼層（加入成功）：換成該主題的 data-theme／titleFor／faviconHref', () => {
    const { doc, attrs, iconAttrs } = fakeDocument({ title: 'fishing-work', theme: 'home', href: HOME_DOCUMENT.faviconHref })
    applyDocumentTheme(doc, meetShell, { phase: 'idle' })
    expect(attrs.get('data-theme')).toBe('meet')
    expect(doc.title).toBe('Meet – kqw-mzdv-ptj')
    expect(iconAttrs.get('href')).toBe(meetShell.faviconHref)
  })
})

describe('main.tsx 第一次繪製前的文件主題（initialDocumentTheme）', () => {
  it('沒有重連憑證 → 首頁（data-theme="home"）', () => {
    expect(initialDocumentTheme(false, meetShell)).toBe(HOME_DOCUMENT)
  })

  it('有重連憑證 → 所選殼層（遊戲中重新整理不閃首頁）', () => {
    expect(initialDocumentTheme(true, meetShell)).toBe(meetShell)
  })

  it('與 App 第一次渲染的畫面一致（pickScreen：未加入、resuming＝有憑證）', () => {
    for (const has of [false, true]) {
      const first = pickScreen({ joined: false, resuming: has })
      expect(initialDocumentTheme(has, meetShell)).toBe(first === 'home' ? HOME_DOCUMENT : meetShell)
    }
  })

  it('main.tsx 以 hasSavedSession() 與 uiStore.shellId 決定，並在 createRoot 之前套用', () => {
    const src = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8')
    expect(src).toContain('initialDocumentTheme(hasSavedSession(), getShell(useUiStore.getState().shellId))')
    expect(src.indexOf('applyDocumentTheme(')).toBeGreaterThan(-1)
    expect(src.indexOf('applyDocumentTheme(')).toBeLessThan(src.indexOf('createRoot('))
  })
})
