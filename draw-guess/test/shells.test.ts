// 偽裝主題註冊表與文件同步（plan/camouflage-themes.md 決策 2–4；plan/home-page.md 決策 5、7；architecture §7）
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
import { vscodeShell } from '../src/shells/vscode/definition'

const fs = (await import('node:fs' as string)) as { readFileSync(path: URL, encoding: 'utf8'): string }

describe('註冊表', () => {
  it('註冊 vscode、ppt、meet、excel（Epic 3 Phase 3 ppt、Epic 5 meet、Epic 13 excel；順序即首頁卡片順序），預設為 vscode', () => {
    expect(SHELLS.map((s) => s.id)).toEqual(['vscode', 'ppt', 'meet', 'excel'])
    expect(DEFAULT_SHELL_ID).toBe('vscode')
  })

  it('每筆只有 { id, name, description, icon, Shell, titleFor, faviconHref }（畫布底色與預設筆色不屬於主題，決策 6）', () => {
    for (const s of SHELLS) {
      expect(Object.keys(s).sort()).toEqual(['Shell', 'description', 'faviconHref', 'icon', 'id', 'name', 'titleFor'])
      expect(s.name).not.toBe('')
      expect(typeof s.Shell).toBe('function')
      expect(typeof s.icon).toBe('function')
    }
    expect(vscodeShell).not.toHaveProperty('defaultColorIndex')
  })

  it('id 不重複', () => {
    expect(new Set(SHELLS.map((s) => s.id)).size).toBe(SHELLS.length)
  })

  it('description（首頁卡片描述，Epic 4 決策 7）：vscode、ppt 照規格原文，一行且 ≤ 20 字', () => {
    expect(vscodeShell.description).toBe('深色程式編輯器，像在改程式碼')
    expect(pptShell.description).toBe('白底簡報軟體，像在做投影片')
    for (const s of SHELLS) {
      expect(s.description).not.toBe('')
      expect([...s.description].length).toBeLessThanOrEqual(20)
      expect(s.description).not.toMatch(/\n/)
    }
  })
})

describe('resolveShellId / getShell：未知值回退 vscode', () => {
  it('已註冊的 id 原樣回傳', () => {
    expect(resolveShellId('vscode')).toBe('vscode')
    expect(getShell('vscode')).toBe(vscodeShell)
  })

  it.each([null, undefined, '', 'VSCODE', ' vscode', 'PPT', 'keynote', 'unknown', 42, {}])('%j → vscode', (v) => {
    expect(resolveShellId(v)).toBe('vscode')
    expect(getShell(v)).toBe(vscodeShell)
  })
})

describe('vscode titleFor：與 Epic 1 相同（DESIGN §5 視窗標題）', () => {
  it('非作畫階段為 `canvas.ts - fishing-work`', () => {
    for (const phase of ['idle', 'choosing', 'ended'] as const) {
      expect(vscodeShell.titleFor({ phase })).toBe('canvas.ts - fishing-work')
    }
  })

  it('作畫中前綴 `● `', () => {
    expect(vscodeShell.titleFor({ phase: 'drawing' })).toBe('● canvas.ts - fishing-work')
  })

  it('favicon 維持一般文件圖示（public/favicon.svg，依 Vite base）', () => {
    expect(vscodeShell.faviconHref).toMatch(/\/favicon\.svg$/)
    expect(vscodeShell.faviconHref.startsWith(import.meta.env.BASE_URL)).toBe(true)
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
    applyDocumentTheme(doc, vscodeShell, { phase: 'drawing' })
    expect(attrs.get('data-theme')).toBe('vscode')
    expect(doc.title).toBe('● canvas.ts - fishing-work')
    expect(iconAttrs.get('href')).toBe(vscodeShell.faviconHref)
  })

  it('值相同時不重寫（favicon 不重新下載）', () => {
    const { doc, writes } = fakeDocument({ title: 'canvas.ts - fishing-work', theme: 'vscode', href: vscodeShell.faviconHref })
    applyDocumentTheme(doc, vscodeShell, { phase: 'idle' })
    expect(writes).toEqual([])
  })

  it('沒有 favicon link 時略過', () => {
    const { doc } = fakeDocument({ href: null })
    expect(() => applyDocumentTheme(doc, vscodeShell, { phase: 'idle' })).not.toThrow()
  })

  it('applyThemeAttr 只設定 data-theme', () => {
    const { doc, writes } = fakeDocument({ theme: 'ppt' })
    applyThemeAttr(doc, vscodeShell.id)
    expect(writes).toEqual(['data-theme=vscode'])
    applyThemeAttr(doc, HOME_THEME_ID)
    expect(writes).toEqual(['data-theme=vscode', 'data-theme=home'])
  })
})

describe('首頁的文件主題（Epic 4 決策 5）', () => {
  it('HOME_DOCUMENT：data-theme="home"、title「fishing-work」（任何階段）、favicon 預設 favicon.svg（依 Vite base）', () => {
    expect(HOME_THEME_ID).toBe('home')
    expect(HOME_DOCUMENT.id).toBe('home')
    for (const phase of ['idle', 'choosing', 'drawing', 'ended'] as const) expect(HOME_DOCUMENT.titleFor({ phase })).toBe('fishing-work')
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

  it('首頁與 vscode 的 favicon 同一個檔案：只換 data-theme 與標題，不重寫 favicon', () => {
    const { doc, writes } = fakeDocument({ title: 'canvas.ts - fishing-work', theme: 'vscode', href: vscodeShell.faviconHref })
    applyDocumentTheme(doc, HOME_DOCUMENT, { phase: 'idle' })
    expect(writes).toEqual(['data-theme=home', 'title=fishing-work'])
  })
})

describe('main.tsx 第一次繪製前的文件主題（initialDocumentTheme）', () => {
  it('沒有重連憑證 → 首頁（data-theme="home"）', () => {
    expect(initialDocumentTheme(false, vscodeShell)).toBe(HOME_DOCUMENT)
    expect(initialDocumentTheme(false, pptShell).id).toBe('home')
  })

  it('有重連憑證 → 所選殼層（遊戲中重新整理不閃首頁）', () => {
    expect(initialDocumentTheme(true, pptShell)).toBe(pptShell)
    expect(initialDocumentTheme(true, vscodeShell).id).toBe('vscode')
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
