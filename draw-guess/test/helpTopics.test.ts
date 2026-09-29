// 遊戲說明的內容（Epic 6 決策 1、5、6）：主題資料逐字等於 plan 決策 5 的表、renderTopic 代入佔位符、三殼層的 switchHint。
import { describe, expect, it } from 'vitest'
import {
  HELP_BACK_LABEL,
  HELP_CLOSE_LABEL,
  HELP_LIST_TITLE,
  HELP_TOPICS,
  findHelpTopic,
  renderTopic,
} from '../src/features/help/helpTopics'
import { MEET_VIEWS } from '../src/shells/meet/meetViews'
import { PPT_VIEWS } from '../src/shells/ppt/pptViews'
import { DEFAULT_HELP_VIEW, resolveHelpView, resolveVolunteerView, type ShellViews } from '../src/shells/views'
import { VSCODE_HELP_VIEW } from '../src/shells/vscode/viewDefaults'

// plan 原文（app 的 tsconfig 不含 Node 型別，動態 import 後自行標型別；同 homeTheme.test）
const fs = (await import('node:fs' as string)) as { readFileSync(path: URL, encoding: 'utf8'): string }
const plan = fs.readFileSync(new URL('../../plan/help-topics.md', import.meta.url), 'utf8')

/** 解析 plan 決策 5 的表：| `id` | 標題 | 段落／段落 | */
const planRows = [...plan.matchAll(/^\| `([a-z-]+)` \| ([^|]+) \| ([^|]+) \|$/gm)].map((m) => ({
  id: m[1] ?? '',
  title: (m[2] ?? '').trim(),
  paragraphs: (m[3] ?? '').trim().split('／'),
}))

describe('主題資料（決策 5）', () => {
  it('與 plan/help-topics.md 決策 5 的表逐字相同（id、標題、段落、順序）', () => {
    expect(planRows).toHaveLength(6)
    expect(HELP_TOPICS.map((t) => ({ id: t.id, title: t.title, paragraphs: [...t.paragraphs] }))).toEqual(planRows)
  })

  it('六個主題：id 唯一、每個都有標題與至少一段', () => {
    expect(HELP_TOPICS.map((t) => t.id)).toEqual(['be-drawer', 'guess', 'switch-theme', 'tools', 'image', 'reconnect'])
    expect(new Set(HELP_TOPICS.map((t) => t.id)).size).toBe(HELP_TOPICS.length)
    for (const t of HELP_TOPICS) {
      expect(t.title.length, t.id).toBeGreaterThan(0)
      expect(t.paragraphs.length, t.id).toBeGreaterThanOrEqual(1)
      for (const p of t.paragraphs) expect(p.trim(), t.id).not.toBe('')
    }
  })

  it('需求指定的兩個主題：如何切換偽裝、如何當畫師', () => {
    expect(findHelpTopic('switch-theme')?.title).toBe('如何切換偽裝')
    expect(findHelpTopic('be-drawer')?.title).toBe('如何當畫師')
    expect(findHelpTopic('nope')).toBeUndefined()
  })

  it('佔位符只有 {volunteer} 與 {switch}，且分別出現在「如何當畫師」「如何切換偽裝」', () => {
    const all = HELP_TOPICS.flatMap((t) => t.paragraphs).join('\n')
    expect([...new Set(all.match(/\{[^}]*\}/g))].sort()).toEqual(['{switch}', '{volunteer}'])
    expect(findHelpTopic('be-drawer')?.paragraphs.join('')).toContain('「{volunteer}」')
    expect(findHelpTopic('switch-theme')?.paragraphs[0]).toBe('{switch}，選一個想要的介面風格；下次進入時首頁會預選它。')
  })

  it('對話框文字：清單標題「說明」、第二步「返回」「關閉」（DESIGN §16）', () => {
    expect([HELP_LIST_TITLE, HELP_BACK_LABEL, HELP_CLOSE_LABEL]).toEqual(['說明', '返回', '關閉'])
  })
})

describe('renderTopic（決策 1）', () => {
  const names = { volunteer: '我來畫', switch: '左下角齒輪 → 切換偽裝' }

  it('每個主題的佔位符全部代入（輸出不含 {）、段數不變、其餘文字原樣', () => {
    for (const t of HELP_TOPICS) {
      const out = renderTopic(t, names)
      expect(out, t.id).toHaveLength(t.paragraphs.length)
      for (const p of out) expect(p, t.id).not.toContain('{')
    }
    expect(renderTopic(HELP_TOPICS[1]!, names)).toEqual([...HELP_TOPICS[1]!.paragraphs])
  })

  it('代入值：「如何當畫師」第一段、「如何切換偽裝」第一段', () => {
    expect(renderTopic(findHelpTopic('be-drawer')!, names)[0]).toBe('房間至少 2 人在線時，畫面上會出現「我來畫」，按下去你就是本回合的畫師。')
    expect(renderTopic(findHelpTopic('switch-theme')!, names)[0]).toBe('左下角齒輪 → 切換偽裝，選一個想要的介面風格；下次進入時首頁會預選它。')
  })

  it('同一段出現多次也全部代入；不修改原資料', () => {
    expect(renderTopic({ paragraphs: ['{switch}／{switch}', '{volunteer}{volunteer}'] }, { volunteer: 'A', switch: 'B' })).toEqual(['B／B', 'AA'])
    expect(findHelpTopic('be-drawer')!.paragraphs[0]).toContain('{volunteer}')
  })
})

describe('ShellViews.help（決策 6）：三殼層的切換偽裝路徑', () => {
  const vscode: ShellViews = { Dialog: () => null, PlayerList: () => null }

  it('vscode（預設）「左下角齒輪 → 切換偽裝」、ppt「檔案 → 切換偽裝」、meet「更多 ⋮ → 切換偽裝」', () => {
    expect(VSCODE_HELP_VIEW).toEqual({ switchHint: '左下角齒輪 → 切換偽裝' })
    expect(DEFAULT_HELP_VIEW).toBe(VSCODE_HELP_VIEW)
    expect(resolveHelpView(null)).toBe(VSCODE_HELP_VIEW)
    expect(resolveHelpView(vscode)).toBe(VSCODE_HELP_VIEW)
    expect(resolveHelpView(PPT_VIEWS).switchHint).toBe('檔案 → 切換偽裝')
    expect(resolveHelpView(MEET_VIEWS).switchHint).toBe('更多 ⋮ → 切換偽裝')
  })

  it('代入後三殼層的「如何當畫師」「如何切換偽裝」各不相同（我來畫／從目前投影片開始／分享畫面）', () => {
    const render = (v: ShellViews | null, id: string) =>
      renderTopic(findHelpTopic(id)!, { volunteer: resolveVolunteerView(v).label, switch: resolveHelpView(v).switchHint })[0]
    const drawer = [null, PPT_VIEWS, MEET_VIEWS].map((v) => render(v, 'be-drawer'))
    expect(drawer[0]).toContain('「我來畫」')
    expect(drawer[1]).toContain('「從目前投影片開始」')
    expect(drawer[2]).toContain('「分享畫面」')
    const sw = [null, PPT_VIEWS, MEET_VIEWS].map((v) => render(v, 'switch-theme'))
    expect(new Set(sw).size).toBe(3)
    expect(sw[1]).toBe('檔案 → 切換偽裝，選一個想要的介面風格；下次進入時首頁會預選它。')
  })
})
