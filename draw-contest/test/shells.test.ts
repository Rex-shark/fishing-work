// 偽裝主題註冊表與文件同步（複製自我畫你猜；spec/draw-contest/architecture.md §7、design.md §1：MVP 只註冊簡報）
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
import { pptShell } from '../src/shells/ppt/definition'

const fs = (await import('node:fs' as string)) as { readFileSync(path: URL, encoding: 'utf8'): string }

describe('註冊表', () => {
  it('只註冊 ppt（簡報），預設為 ppt', () => {
    expect(SHELLS.map((s) => s.id)).toEqual(['ppt'])
    expect(DEFAULT_SHELL_ID).toBe('ppt')
  })

  it('每筆只有 { id, name, description, icon, Shell, titleFor, faviconHref }（畫布底色與預設筆色不屬於主題）', () => {
    for (const s of SHELLS) {
      expect(Object.keys(s).sort()).toEqual(['Shell', 'description', 'faviconHref', 'icon', 'id', 'name', 'titleFor'])
      expect(s.name).not.toBe('')
      expect(typeof s.Shell).toBe('function')
      expect(typeof s.icon).toBe('function')
    }
  })

  it('description：一行且 ≤ 20 字', () => {
    expect(pptShell.description).toBe('白底簡報軟體，像在做投影片')
    for (const s of SHELLS) {
      expect([...s.description].length).toBeLessThanOrEqual(20)
      expect(s.description).not.toMatch(/\n/)
    }
  })
})

describe('resolveShellId / getShell：未知值回退 ppt', () => {
  it('已註冊的 id 原樣回傳', () => {
    expect(resolveShellId('ppt')).toBe('ppt')
    expect(getShell('ppt')).toBe(pptShell)
  })

  it.each([null, undefined, '', 'PPT', 'vscode', 'meet', 'excel', 'keynote', 42, {}])('%j → ppt', (v) => {
    expect(resolveShellId(v)).toBe('ppt')
    expect(getShell(v)).toBe(pptShell)
  })
})

describe('ppt titleFor／favicon', () => {
  it('非作畫階段為 `簡報1 - PowerPoint`；作畫中前綴 `● `', () => {
    for (const phase of ['idle', 'choosing', 'judging', 'ended'] as const) expect(pptShell.titleFor({ phase })).toBe('簡報1 - PowerPoint')
    expect(pptShell.titleFor({ phase: 'drawing' })).toBe('● 簡報1 - PowerPoint')
  })

  it('favicon 為 public/favicon-ppt.svg（依 Vite base）', () => {
    expect(pptShell.faviconHref).toBe(`${import.meta.env.BASE_URL}favicon-ppt.svg`)
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
    applyDocumentTheme(doc, pptShell, { phase: 'drawing' })
    expect(attrs.get('data-theme')).toBe('ppt')
    expect(doc.title).toBe('● 簡報1 - PowerPoint')
    expect(iconAttrs.get('href')).toBe(pptShell.faviconHref)
  })

  it('值相同時不重寫（favicon 不重新下載）', () => {
    const { doc, writes } = fakeDocument({ title: '簡報1 - PowerPoint', theme: 'ppt', href: pptShell.faviconHref })
    applyDocumentTheme(doc, pptShell, { phase: 'idle' })
    expect(writes).toEqual([])
  })

  it('沒有 favicon link 時略過', () => {
    const { doc } = fakeDocument({ href: null })
    expect(() => applyDocumentTheme(doc, pptShell, { phase: 'idle' })).not.toThrow()
  })

  it('applyThemeAttr 只設定 data-theme', () => {
    const { doc, writes } = fakeDocument({ theme: 'home' })
    applyThemeAttr(doc, pptShell.id)
    expect(writes).toEqual(['data-theme=ppt'])
    applyThemeAttr(doc, HOME_THEME_ID)
    expect(writes).toEqual(['data-theme=ppt', 'data-theme=home'])
  })
})

describe('首頁的文件主題（Epic 4 決策 5）', () => {
  it('HOME_DOCUMENT：data-theme="home"、title「fishing-work」（任何階段）、favicon 預設 favicon.svg（依 Vite base）', () => {
    expect(HOME_THEME_ID).toBe('home')
    expect(HOME_DOCUMENT.id).toBe('home')
    for (const phase of ['idle', 'choosing', 'drawing', 'judging', 'ended'] as const) expect(HOME_DOCUMENT.titleFor({ phase })).toBe('fishing-work')
    expect(HOME_DOCUMENT.faviconHref).toBe(`${import.meta.env.BASE_URL}favicon.svg`)
  })

  it('套用首頁：從殼層（ppt）換成 home、標題與 favicon 還原', () => {
    const { doc, attrs, iconAttrs } = fakeDocument({ title: '簡報1 - PowerPoint', theme: 'ppt', href: pptShell.faviconHref })
    applyDocumentTheme(doc, HOME_DOCUMENT, { phase: 'idle' })
    expect(attrs.get('data-theme')).toBe('home')
    expect(doc.title).toBe('fishing-work')
    expect(iconAttrs.get('href')).toBe(HOME_DOCUMENT.faviconHref)
  })

  it('首頁 → 進殼層（加入成功）：換成該主題的 data-theme／titleFor／faviconHref', () => {
    const { doc, attrs, iconAttrs } = fakeDocument({ title: 'fishing-work', theme: 'home', href: HOME_DOCUMENT.faviconHref })
    applyDocumentTheme(doc, pptShell, { phase: 'idle' })
    expect(attrs.get('data-theme')).toBe('ppt')
    expect(doc.title).toBe('簡報1 - PowerPoint')
    expect(iconAttrs.get('href')).toBe(pptShell.faviconHref)
  })
})

describe('main.tsx 第一次繪製前的文件主題（initialDocumentTheme）', () => {
  it('沒有重連憑證 → 首頁（data-theme="home"）', () => {
    expect(initialDocumentTheme(false, pptShell)).toBe(HOME_DOCUMENT)
  })

  it('有重連憑證 → 所選殼層（遊戲中重新整理不閃首頁）', () => {
    expect(initialDocumentTheme(true, pptShell)).toBe(pptShell)
  })

  it('與 App 第一次渲染的畫面一致（pickScreen：未加入、resuming＝有憑證）', () => {
    for (const has of [false, true]) {
      const first = pickScreen({ joined: false, resuming: has })
      expect(initialDocumentTheme(has, pptShell)).toBe(first === 'home' ? HOME_DOCUMENT : pptShell)
    }
  })

  it('main.tsx 以 hasSavedSession() 與 uiStore.shellId 決定，並在 createRoot 之前套用', () => {
    const src = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8')
    expect(src).toContain('initialDocumentTheme(hasSavedSession(), getShell(useUiStore.getState().shellId))')
    expect(src.indexOf('applyDocumentTheme(')).toBeGreaterThan(-1)
    expect(src.indexOf('applyDocumentTheme(')).toBeLessThan(src.indexOf('createRoot('))
  })
})
