// 遊戲說明的內容（features/help；Phase 2 第二段正式文案）：六個主題、佔位符、秒數與數字一律由 shared 常數推導（不寫死）、
// 沒有我畫你猜專屬的玩法（猜題、畫師、傳圖）、ppt 的代入值、揭曉時的 AI 評語（Epic 15：評審名稱讀 shared 常數）。
import { describe, expect, it } from 'vitest'
import {
  CHAT_MAX,
  CHOOSING_SECONDS,
  COMMENT_PERSONA_NAME,
  DRAW_SECONDS,
  MIN_PLAYERS,
  RECONNECT_GRACE_SECONDS,
  SCORE_MAX,
  SUBMIT_GRACE_SECONDS,
  TOPIC_MAX,
} from '@fishing-work/shared/draw-contest'
import { formatDuration } from '../src/features/help/helpText'
import { HISTORY_MAX } from '../src/features/history/historyDb'
import { COMMENT_PENDING_TEXT } from '../src/features/reveal/revealView'
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

  it('佔位符只有 {volunteer}、{switch}、{save}、{recent}，分別出現在「如何出題」「聊天與重連」「交卷」「排名與總分」', () => {
    const all = HELP_TOPICS.flatMap((t) => t.paragraphs).join('\n')
    // Epic 17 起多一個 {recent}（回看最近幾場的路徑，只出現在「排名與總分」）
    expect([...new Set(all.match(/\{[^}]*\}/g))].sort()).toEqual(['{recent}', '{save}', '{switch}', '{volunteer}'])
    expect(HELP_TOPICS.filter((t) => t.paragraphs.join('').includes('{recent}')).map((t) => t.id)).toEqual(['ranking'])
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

  it('文案裡的數字都來自 shared 常數（改常數說明跟著變）；回看的場數來自客戶端常數 HISTORY_MAX（Epic 17）', () => {
    const allowed = new Set(
      [MIN_PLAYERS, CHOOSING_SECONDS, TOPIC_MAX, SUBMIT_GRACE_SECONDS, SCORE_MAX, CHAT_MAX, RECONNECT_GRACE_SECONDS, HISTORY_MAX, 0, 1].map(String),
    )
    const rendered = HELP_TOPICS.flatMap((t) => t.paragraphs.join('')).join('').replace(formatDuration(DRAW_SECONDS), '')
    for (const n of rendered.match(/\d+/g) ?? []) expect(allowed.has(n), n).toBe(true)
  })

  it('評分主題（Epic 15 Phase 2.5）：由 Clef 評分、評審寫評語；連不上 Ollama 時退回隨機評分；不再有 Epic 14 的舊文案', () => {
    const paragraphs = findHelpTopic('scoring')?.paragraphs ?? []
    expect(paragraphs).toHaveLength(3)
    expect(paragraphs[0]).toContain(`由 AI 模型 Clef 看圖給 0–${SCORE_MAX} 分`)
    expect(paragraphs[0]).toContain('「正在評分」')
    expect(paragraphs[1]).toContain(`評語由另一位評審「${COMMENT_PERSONA_NAME}」負責`)
    expect(paragraphs[1]).toContain('不影響分數與排名')
    expect(paragraphs[2]).toContain('連不上 Ollama')
    expect(paragraphs[2]).toContain('退回隨機評分')
    expect(paragraphs[2]).toContain('也不會有評語')
    const text = paragraphs.join('')
    expect(text).not.toMatch(/目前使用隨機評分|日後改用/)
  })

  it('評分主題說明隨機評分（分數與畫得像不像無關、揭曉標示「隨機」）', () => {
    const text = findHelpTopic('scoring')?.paragraphs.join('') ?? ''
    expect(text).toContain('隨機評分')
    expect(text).toContain('「隨機」')
    expect(text).toContain(`0–${SCORE_MAX} 分`)
  })

  it('「排名與總分」說明揭曉時的評語（Epic 15）：評審名稱、每張交卷的畫一句、產生中「正在寫評語」、關閉或失敗沒有、不影響分數與排名', () => {
    const paragraphs = findHelpTopic('ranking')?.paragraphs ?? []
    // 接在講揭曉的那一段之後
    expect(paragraphs[0]).toContain('全部評完就揭曉')
    const text = paragraphs[1] ?? ''
    expect(text).toContain(`評審「${COMMENT_PERSONA_NAME}」`)
    expect(text).toContain('揭曉時')
    expect(text).toContain('每張交卷的畫一句評語')
    expect(text).toContain('寫在畫的下面')
    // Phase 4：第一名是稱讚版，揭曉後才寫（那張先顯示產生中的文字、晚一點出現）
    expect(text).toContain('第一名會被稱讚')
    // 2026-10-13 Phase 5：稱讚版失敗時退回一般評語
    expect(text).toContain('稱讚寫不出來時改顯示一般評語')
    expect(text).toContain('第一名那句是揭曉後才寫的，會晚一點出現')
    // 產生中的文字與卡片同一個常數（2026-10-12 由「…」改為「正在寫評語」，說明跟著變）
    expect(COMMENT_PENDING_TEXT).toBe('正在寫評語')
    expect(text).toContain(`還沒寫好的先顯示「${COMMENT_PENDING_TEXT}」`)
    expect(text.indexOf(`「${COMMENT_PENDING_TEXT}」`)).toBeLessThan(text.indexOf('第一名那句'))
    expect(text).not.toContain('…')
    expect(text).toContain('不影響分數與排名')
    // 只有「評分」（誰寫評語）與這一段（揭曉時怎麼顯示）提到評審；其他主題沒有
    // 「第一名會被稱讚」只講一次（不在「評分」重複）
    expect(HELP_TOPICS.flatMap((t) => t.paragraphs).filter((p) => p.includes('稱讚'))).toEqual([text])
    const mentions = HELP_TOPICS.flatMap((t) => t.paragraphs.map((p) => [t.id, p] as const)).filter(([, p]) => p.includes(COMMENT_PERSONA_NAME))
    expect(mentions.map(([id]) => id)).toEqual(['scoring', 'ranking'])
  })

  it('「排名與總分」最後一段（Epic 17）：最近 HISTORY_MAX 場可以回看、只存在這台瀏覽器；路徑是佔位符、場數不寫死', () => {
    const paragraphs = findHelpTopic('ranking')?.paragraphs ?? []
    expect(paragraphs).toHaveLength(5)
    expect(paragraphs.at(-1)).toBe(`最近 ${HISTORY_MAX} 場可從「{recent}」回看，只存在這台瀏覽器。`)
    expect(HISTORY_MAX).toBe(5)
    expect(helpSource).toContain('最近 ${HISTORY_MAX} 場可從「{recent}」回看')
    // 入口的偽裝字樣不在說明的原始碼裡（由殼層的 help.recentHint 代入）
    expect(helpSource).not.toContain(PPT_VIEWS.help.recentHint)
    expect(helpSource).not.toMatch(/簡報|開啟最近/)
  })

  it('評審名稱不寫死：原始碼以 ${COMMENT_PERSONA_NAME} 組字（改常數說明跟著變）', () => {
    expect(COMMENT_PERSONA_NAME).toBe('メスガキ')
    expect(helpSource).not.toContain(COMMENT_PERSONA_NAME)
    expect(helpSource.match(/評審「\$\{COMMENT_PERSONA_NAME\}」/g)).toHaveLength(2)
    // 產生中的文字也不寫死（讀 reveal 的常數）
    expect(helpSource).toContain('先顯示「${COMMENT_PENDING_TEXT}」')
    expect(helpSource).not.toContain('正在寫評語')
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
  const names = {
    volunteer: PPT_VIEWS.volunteer.label,
    switch: PPT_VIEWS.help.switchHint,
    save: PPT_VIEWS.terms.save,
    recent: PPT_VIEWS.help.recentHint,
  }

  it('每個主題的佔位符全部代入（輸出不含 {）、段數不變', () => {
    for (const t of HELP_TOPICS) {
      const out = renderTopic(t, names)
      expect(out, t.id).toHaveLength(t.paragraphs.length)
      for (const p of out) expect(p, t.id).not.toContain('{')
    }
  })

  it('ppt 代入值：「從目前投影片開始」、「檔案 → 切換偽裝」、「儲存」、「檔案 › 開啟最近的簡報」', () => {
    expect(renderTopic(findHelpTopic('ranking')!, names).at(-1)).toBe('最近 5 場可從「檔案 › 開啟最近的簡報」回看，只存在這台瀏覽器。')
    expect(renderTopic(findHelpTopic('be-setter')!, names)[0]).toContain('「從目前投影片開始」')
    expect(renderTopic(findHelpTopic('chat-reconnect')!, names).at(-1)).toBe('同一個暱稱在別的分頁加入會接管，原分頁回到首頁。想換介面風格：檔案 → 切換偽裝。')
    expect(renderTopic(findHelpTopic('submit')!, names)[0]).toBe('畫好按「完成」，在確認框按「儲存」就交卷；交卷後不能再修改。按「取消」可以回去繼續畫。')
    // 評語那一段沒有佔位符，代入後原樣
    expect(renderTopic(findHelpTopic('ranking')!, names)[1]).toBe(
      '揭曉時評審「メスガキ」會給每張交卷的畫一句評語，寫在畫的下面，第一名會被稱讚；稱讚寫不出來時改顯示一般評語。還沒寫好的先顯示「正在寫評語」（第一名那句是揭曉後才寫的，會晚一點出現）；評語關閉或出問題時就沒有這一行，不影響分數與排名。',
    )
    expect(renderTopic(findHelpTopic('scoring')!, names)).toEqual([
      `每交一張就排隊評一張，由 AI 模型 Clef 看圖給 0–${SCORE_MAX} 分，畫得越像題目分數越高；畫面會顯示「正在評分」的進度。`,
      '評語由另一位評審「メスガキ」負責，每張交卷的畫一句；評語不影響分數與排名。',
      '連不上 Ollama（執行這兩個模型的服務）時，本回合剩下的畫會退回隨機評分，也不會有評語。隨機評分的分數由圖片本身決定、和畫得像不像無關，同一張圖永遠同分；揭曉時分數旁會標示「隨機」。',
    ])
  })

  it('同一段出現多次也全部代入；不修改原資料', () => {
    expect(
      renderTopic({ paragraphs: ['{switch}／{switch}', '{volunteer}{volunteer}', '{save}', '{recent}、{recent}'] }, { volunteer: 'A', switch: 'B', save: 'C', recent: 'D' }),
    ).toEqual(['B／B', 'AA', 'C', 'D、D'])
    expect(findHelpTopic('be-setter')!.paragraphs[0]).toContain('{volunteer}')
  })
})
