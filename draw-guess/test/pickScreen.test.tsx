// App 三分支（plan/home-page.md 決策 4、9；architecture §7）：pickScreen 純函式、殼層的 resume 插槽（ShellProps screen 'resume'）
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { enterButtonLabel, homeConnectionLabel } from '../src/home/homeLabels'
import { pickScreen, type AppScreen } from '../src/pickScreen'
import type { ShellProps } from '../src/shells/types'
import { QuickInputNotice } from '../src/shells/vscode/QuickInput'

const fs = (await import('node:fs' as string)) as { readFileSync(path: URL, encoding: 'utf8'): string }
const read = (f: string) => fs.readFileSync(new URL(f, import.meta.url), 'utf8')

describe('pickScreen：已加入 → game；未加入且 resuming → resume；否則 → home', () => {
  it.each<[boolean, boolean, AppScreen]>([
    [true, false, 'game'],
    [true, true, 'game'],
    [false, true, 'resume'],
    [false, false, 'home'],
  ])('joined=%s resuming=%s → %s', (joined, resuming, expected) => {
    expect(pickScreen({ joined, resuming })).toBe(expected)
  })

  it('遊戲中重新整理的流程：有憑證（resume）→ 加入成功（game），中間不經過首頁', () => {
    const steps = [pickScreen({ joined: false, resuming: true }), pickScreen({ joined: true, resuming: true })]
    expect(steps).toEqual(['resume', 'game'])
  })

  it('自動重新加入失敗或被其他分頁接管：resuming 轉 false、me 清掉 → 首頁', () => {
    expect(pickScreen({ joined: false, resuming: false })).toBe('home')
  })

  it('App 以 pickScreen 分支：game／resume 渲染殼層（key 各自掛載），home 渲染 HomeScreen', () => {
    const app = read('../src/App.tsx')
    expect(app).toContain('pickScreen({ joined, resuming })')
    expect(app).toMatch(/<Shell\s+key="game"\s+screen="game"/)
    expect(app).toContain('<Shell key="resume" screen="resume" notice={RESUME_NOTICE} connection={<ConnectionStatus />} />')
    expect(app).toContain("const RESUME_NOTICE = '正在重新加入…'")
    expect(app).toContain('<HomeScreen />')
    expect(app).not.toMatch(/screen="login"|NicknameScreen/)
    // 文件層級依畫面同步：首頁為 HOME_DOCUMENT
    expect(app).toContain("applyDocumentTheme(document, screen === 'home' ? HOME_DOCUMENT : shell, { phase: titlePhase })")
  })
})

describe("ShellProps screen 'resume' 插槽：只有 notice 與 connection", () => {
  it('型別：resume 變體為 { screen, notice, connection }；login 變體已移除', () => {
    const resume: ShellProps = { screen: 'resume', notice: '正在重新加入…', connection: null }
    expect(resume.screen).toBe('resume')
    // @ts-expect-error 登入畫面已移到首頁（Epic 4 決策 9）
    const login: ShellProps = { screen: 'login', login: null, connection: null }
    expect(login).toBeDefined()
  })

  it('vscode：視窗頂部的快速輸入框只放一行註解式 notice（role=status），沒有輸入框與選項', () => {
    const html = renderToStaticMarkup(<QuickInputNotice notice="正在重新加入…" />)
    expect(html).toMatch(/^<div role="status" aria-live="polite"/)
    expect(html).toContain('absolute top-2 left-1/2 -translate-x-1/2')
    expect(html).toContain('bg-quickinput')
    expect(html).toContain('>// 正在重新加入…</p>')
    expect(html).not.toMatch(/<input|<form|role="listbox"|role="radiogroup"/)
  })

  it('兩個殼層的非遊戲分支都把 props.notice 交給各自的提示框，不再有 login 插槽與卡片列', () => {
    const vscode = read('../src/shells/vscode/VscodeShell.tsx')
    const ppt = read('../src/shells/ppt/PptShell.tsx')
    expect(vscode).toContain('overlay={<QuickInputNotice notice={props.notice} />}')
    expect(ppt).toContain('overlay={<PptResumeDialog notice={props.notice} />}')
    for (const src of [vscode, ppt]) expect(src).not.toMatch(/props\.login|ThemeCards|NicknameScreen/)
  })

  it('對話框不再有 join 用途與 footer（登入改在首頁）', () => {
    const views = read('../src/shells/views.ts')
    expect(views).toContain("export type DialogPurpose = 'topic' | 'cancelRound'")
    expect(views).not.toMatch(/footer\?:/)
  })
})

describe('首頁文字（home/homeLabels；DESIGN §14.3）', () => {
  it('連線狀態一行', () => {
    expect(homeConnectionLabel('connected')).toBe('已連線')
    expect(homeConnectionLabel('connecting')).toBe('正在連線到伺服器…')
    expect(homeConnectionLabel('disconnected')).toBe('連線中斷，重新連線中…')
  })

  it('「進入遊戲」按鈕：加入中顯示「加入中…」', () => {
    expect(enterButtonLabel(false)).toBe('進入遊戲')
    expect(enterButtonLabel(true)).toBe('加入中…')
  })
})
