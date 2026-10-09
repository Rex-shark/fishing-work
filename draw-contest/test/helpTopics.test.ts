// 遊戲說明的內容（features/help；Phase 2 第二段正式文案）：六個主題、佔位符、秒數與數字一律由 shared 常數推導（不寫死）、
// 沒有我畫你猜專屬的玩法（猜題、畫師、傳圖）、ppt 的代入值。
import { describe, expect, it } from 'vitest'
import {
  CHAT_MAX,
  CHOOSING_SECONDS,
  DRAW_SECONDS,
  MIN_PLAYERS,
  RECONNECT_GRACE_SECONDS,
  SCORE_MAX,
  SUBMIT_GRACE_SECONDS,
  TOPIC_MAX,
} from '@fishing-work/shared/draw-contest'
import { formatDuration } from '../src/features/help/helpText'
import {
  HELP_BACK_LABEL,
  HELP_CLOSE_LABEL,
  HELP_LIST_TITLE,
  HELP_TOPICS,
  findHelpTopic,
  renderTopic,
} from '../src/features/help/helpTopics'
import { PPT_VIEWS } from '../src/shells/ppt/pptViews'

// .ts 原始碼（檢查文案裡沒有寫死的秒數）
const helpSource = Object.values(
  import.meta.glob<string>('../src/features/help/helpTopics.ts', { query: '?raw', import: 'default', eager: true }),
)[0] ?? ''

describe('主題資料', () => {
  it('六個主題（如何出題、作畫、交卷、評分、排名與總分、聊天與重連）：id 唯一、每個都有標題與至少一段', () => {
    expect(HELP_TOPICS.map((t) => t.id)).toEqual(['be-setter', 'draw', 'submit', 'scoring', 'ranking', 'chat-reconnect'])
    expect(HELP_TOPICS.map((t) => t.title)).toEqual(['如何出題', '作畫', '交卷', '評分', '排名與總分', '聊天與重連'])
    expect(new Set(HELP_TOPICS.map((t) => t.id)).size).toBe(HELP_TOPICS.length)
    for (const t of HELP_TOPICS) {
      expect(t.title.length, t.id).toBeGreaterThan(0)
      expect(t.paragraphs.length, t.id).toBeGreaterThanOrEqual(1)
      for (const p of t.paragraphs) expect(p.trim(), t.id).not.toBe('')
    }
    expect(findHelpTopic('nope')).toBeUndefined()
  })

  it('佔位符只有 {volunteer}、{switch}、{save}，分別出現在「如何出題」「聊天與重連」「交卷」', () => {
    const all = HELP_TOPICS.flatMap((t) => t.paragraphs).join('\n')
    expect([...new Set(all.match(/\{[^}]*\}/g))].sort()).toEqual(['{save}', '{switch}', '{volunteer}'])
    expect(findHelpTopic('be-setter')?.paragraphs.join('')).toContain('「{volunteer}」')
    expect(findHelpTopic('chat-reconnect')?.paragraphs.join('')).toContain('{switch}')
    expect(findHelpTopic('submit')?.paragraphs.join('')).toContain('「{save}」')
  })

  it('作畫時間由 DRAW_SECONDS 推導', () => {
    expect(findHelpTopic('draw')?.paragraphs.join('')).toContain(`時間 ${formatDuration(DRAW_SECONDS)}`)
    expect(formatDuration(120)).toBe('2 分鐘')
    expect(formatDuration(90)).toBe('1 分 30 秒')
    expect(formatDuration(45)).toBe('45 秒')
  })

  it('原始碼不寫死秒數、分鐘數（一律 ${常數} 或 formatDuration 推導）', () => {
    expect(helpSource.length).toBeGreaterThan(0)
    // 文案字串裡「數字＋秒」「數字＋分鐘」的寫法都不允許（「0 分」是分數，不是時間；分數數字由下一則檢查）
    expect(helpSource.match(/\d+\s*(?:秒|分鐘)/g)).toBeNull()
    // 正向對照：規則抓得到寫死的時間
    expect('時間 120 秒'.match(/\d+\s*(?:秒|分鐘)/g)).not.toBeNull()
    expect('時間 2 分鐘'.match(/\d+\s*(?:秒|分鐘)/g)).not.toBeNull()
  })

  it('文案裡的數字都來自 shared 常數（改常數說明跟著變）', () => {
    const allowed = new Set(
      [MIN_PLAYERS, CHOOSING_SECONDS, TOPIC_MAX, SUBMIT_GRACE_SECONDS, SCORE_MAX, CHAT_MAX, RECONNECT_GRACE_SECONDS, 0, 1].map(String),
    )
    const rendered = HELP_TOPICS.flatMap((t) => t.paragraphs.join('')).join('').replace(formatDuration(DRAW_SECONDS), '')
    for (const n of rendered.match(/\d+/g) ?? []) expect(allowed.has(n), n).toBe(true)
  })

  it('評分主題說明隨機評分（分數與畫得像不像無關、揭曉標示「隨機」）', () => {
    const text = findHelpTopic('scoring')?.paragraphs.join('') ?? ''
    expect(text).toContain('隨機評分')
    expect(text).toContain('「隨機」')
    expect(text).toContain(`0–${SCORE_MAX} 分`)
  })

  it('沒有我畫你猜專屬的玩法（猜題、畫師、傳圖片、放棄本回合）', () => {
    const all = HELP_TOPICS.flatMap((t) => [t.title, ...t.paragraphs]).join('\n')
    expect(all).not.toMatch(/猜|畫師|傳圖|圖片拖|放棄本回合/)
  })

  it('對話框文字：清單標題「說明」、第二步「返回」「關閉」（DESIGN §16）', () => {
    expect([HELP_LIST_TITLE, HELP_BACK_LABEL, HELP_CLOSE_LABEL]).toEqual(['說明', '返回', '關閉'])
  })
})

describe('renderTopic', () => {
  const names = { volunteer: PPT_VIEWS.volunteer.label, switch: PPT_VIEWS.help.switchHint, save: PPT_VIEWS.terms.save }

  it('每個主題的佔位符全部代入（輸出不含 {）、段數不變', () => {
    for (const t of HELP_TOPICS) {
      const out = renderTopic(t, names)
      expect(out, t.id).toHaveLength(t.paragraphs.length)
      for (const p of out) expect(p, t.id).not.toContain('{')
    }
  })

  it('ppt 代入值：「從目前投影片開始」、「檔案 → 切換偽裝」、「儲存」', () => {
    expect(renderTopic(findHelpTopic('be-setter')!, names)[0]).toContain('「從目前投影片開始」')
    expect(renderTopic(findHelpTopic('chat-reconnect')!, names).at(-1)).toBe('同一個暱稱在別的分頁加入會接管，原分頁回到首頁。想換介面風格：檔案 → 切換偽裝。')
    expect(renderTopic(findHelpTopic('submit')!, names)[0]).toBe('畫好按「完成」，在確認框按「儲存」就交卷；交卷後不能再修改。按「取消」可以回去繼續畫。')
  })

  it('同一段出現多次也全部代入；不修改原資料', () => {
    expect(renderTopic({ paragraphs: ['{switch}／{switch}', '{volunteer}{volunteer}', '{save}'] }, { volunteer: 'A', switch: 'B', save: 'C' })).toEqual([
      'B／B',
      'AA',
      'C',
    ])
    expect(findHelpTopic('be-setter')!.paragraphs[0]).toContain('{volunteer}')
  })
})
