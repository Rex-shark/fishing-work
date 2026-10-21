// 遊戲說明的內容（features/help/helpTopics；spec/song-guess/design.md §1「說明」）：六個主題、佔位符、數字由 shared 常數推導
import { describe, expect, it } from 'vitest'
import {
  ANIME_HOT_POOL,
  ANIME_TERMS,
  ARTIST_MAX,
  CHART_SIZE,
  CHAT_MAX,
  CHOOSING_SECONDS,
  HOT_POOL,
  MIN_PLAYERS,
  PREVIEW_CAP_MS,
  RECONNECT_GRACE_SECONDS,
  REVEAL_SECONDS,
  SCORE_MAX,
  SCORE_MIN,
  SONGS_PER_GAME,
  SOURCE_TITLE,
} from '@fishing-work/shared/song-guess'
import { HELP_BACK_LABEL, HELP_CLOSE_LABEL, HELP_LIST_TITLE, HELP_TOPICS, findHelpTopic, renderTopic } from '../src/features/help/helpTopics'
import { START_PLAYBACK_LABEL } from '../src/features/player/playback'
import { VOLUME_DEFAULT, VOLUME_MAX } from '../src/features/player/volume'

const fs = (await import('node:fs' as string)) as { readFileSync(path: URL, encoding: 'utf8'): string }
const source = fs.readFileSync(new URL('../src/features/help/helpTopics.ts', import.meta.url), 'utf8')

const names = { volunteer: '【出題鈕】', switch: '【切換路徑】' }
const text = (id: string) => renderTopic(findHelpTopic(id) ?? { paragraphs: [] }, names).join('\n')
const all = HELP_TOPICS.map((t) => renderTopic(t, names).join('\n')).join('\n')

describe('主題清單（design §1：怎麼玩、出題、猜歌、計分、聲音與耳機、切換偽裝）', () => {
  it('六個主題、順序與標題', () => {
    expect(HELP_TOPICS.map((t) => t.title)).toEqual(['怎麼玩', '出題', '猜歌', '計分', '聲音與耳機', '切換偽裝'])
    expect(HELP_TOPICS.map((t) => t.id)).toEqual(['how-to-play', 'be-setter', 'guess', 'scoring', 'sound', 'switch-theme'])
  })

  it('每個主題至少一段，段落不是空字串；id 不重複', () => {
    expect(new Set(HELP_TOPICS.map((t) => t.id)).size).toBe(HELP_TOPICS.length)
    for (const t of HELP_TOPICS) {
      expect(t.paragraphs.length, t.id).toBeGreaterThanOrEqual(1)
      for (const p of t.paragraphs) expect(p.trim(), t.id).not.toBe('')
    }
  })

  it('標題與選項文字', () => {
    expect([HELP_LIST_TITLE, HELP_BACK_LABEL, HELP_CLOSE_LABEL]).toEqual(['說明', '返回', '關閉'])
  })

  it('findHelpTopic：依 id 找，不存在回 undefined', () => {
    expect(findHelpTopic('scoring')?.title).toBe('計分')
    expect(findHelpTopic('nope')).toBeUndefined()
  })
})

describe('佔位符', () => {
  it('{volunteer}、{switch} 全部代入；代入後沒有殘留的大括號', () => {
    expect(text('be-setter')).toContain('按「【出題鈕】」')
    expect(text('switch-theme')).toMatch(/^【切換路徑】，/)
    expect(all).not.toMatch(/[{}]/)
  })

  it('只用這兩種佔位符', () => {
    const used = new Set(HELP_TOPICS.flatMap((t) => t.paragraphs.flatMap((p) => [...p.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))))
    expect([...used].sort()).toEqual(['switch', 'volunteer'])
  })
})

describe('數字一律由 shared 常數推導', () => {
  it('怎麼玩：一局首數、試聽秒數、揭曉停留、重連寬限', () => {
    const t = text('how-to-play')
    expect(t).toContain(`隨機抽 ${SONGS_PER_GAME} 首`)
    expect(t).toContain(`約 ${PREVIEW_CAP_MS / 1000} 秒`)
    expect(t).toContain(`停 ${REVEAL_SECONDS} 秒`)
    expect(t).toContain(`斷線 ${RECONNECT_GRACE_SECONDS} 秒內`)
  })

  it('出題：人數、期限、歌手名長度、至少幾首、熱門前幾首、榜單前幾首', () => {
    const t = text('be-setter')
    expect(t).toContain(`至少 ${MIN_PLAYERS} 人在線`)
    expect(t).toContain(`${CHOOSING_SECONDS} 秒內`)
    expect(t).toContain(`1–${ARTIST_MAX} 字`)
    expect(t).toContain(`至少要有 ${SONGS_PER_GAME} 首有試聽的歌`)
    expect(t).toContain(`最前面的 ${HOT_POOL} 首`)
    expect(t).toContain(`前 ${CHART_SIZE} 首隨機抽 ${SONGS_PER_GAME} 首`)
  })

  it('猜歌：聊天字數上限；計分：最低與最高分', () => {
    expect(text('guess')).toContain(`最多 ${CHAT_MAX} 字`)
    const t = text('scoring')
    expect(t).toContain(`${SCORE_MIN}–${SCORE_MAX} 分`)
    expect(t).toContain(`是 ${SCORE_MAX} 分`)
    expect(t).toContain(`是 ${SCORE_MIN} 分`)
  })

  it('聲音：音量範圍與預設、起播按鈕文字（與舞台同一個常數）', () => {
    const t = text('sound')
    expect(t).toContain(`0–${VOLUME_MAX}`)
    expect(t).toContain(`預設 ${VOLUME_DEFAULT}`)
    expect(t).toContain(`「${START_PLAYBACK_LABEL}」`)
    expect(t).toContain('耳機')
  })

  it('原始碼的內文不寫死這些數字（字串裡的阿拉伯數字只有範圍起點 1、第 1 首、0 分）', () => {
    const body = source.slice(source.indexOf('export const HELP_TOPICS'), source.indexOf('/** 佔位符的代入值'))
    const withoutTemplates = body.replace(/\$\{[^}]+\}/g, '')
    const digits = [...withoutTemplates.matchAll(/\d+/g)].map((m) => m[0])
    expect(digits.every((d) => d === '1' || d === '0')).toBe(true)
  })
})

describe('題庫來源（Epic 18；overview 規則 3、design §1「出題（選題庫）」）', () => {
  it('怎麼玩：四種題庫（歌手、台灣熱門、西洋熱門、動漫熱門）', () => {
    const t = text('how-to-play')
    expect(t).toContain('指定一位歌手')
    expect(t).toContain('「台灣熱門」「西洋熱門」排行榜')
    // Epic 19：動漫熱門一句（三關鍵字、排除原聲帶與翻唱、熱門前 60）
    expect(t).toContain('或「動漫熱門」（以 anime、アニメ、動漫 三個關鍵字搜到的動漫歌曲，不含原聲帶與翻唱，熱門前 60 首）')
    expect(t).toContain(`熱門前 ${ANIME_HOT_POOL} 首`)
  })

  it('出題：三種來源、每次從「歌手」開始；熱門＝Apple 依熱門度排序的搜尋結果前段、預設勾、記在瀏覽器；取消勾選從全部抽', () => {
    const t = text('be-setter')
    expect(t).toContain('歌手、台灣熱門、西洋熱門或動漫熱門')
    expect(t).toContain('每次出題都從「歌手」開始')
    expect(t).toContain('「只抽熱門歌」預設勾選')
    expect(t).toContain('依 Apple 的熱門度排序')
    expect(t).toContain('取消勾選就從搜得到的全部歌裡抽')
    expect(t).toContain('記在你的瀏覽器')
  })

  it('出題：榜單＝當日 Apple Music 台灣榜／美國榜、不分語言；取不到可重試或換來源；榜單模式每首顯示該首歌手', () => {
    const t = text('be-setter')
    expect(t).toContain('今天的 Apple Music 熱門排行榜')
    expect(t).toContain('台灣熱門是台灣榜、西洋熱門是美國榜')
    expect(t).toContain('不分語言')
    expect(t).toContain('再試一次或換一個來源')
    expect(t).toContain('用排行榜或動漫熱門時每首的歌手可能不同')
    // 舊的說法（歌手名全程顯示、只決定歌手）不再出現
    expect(t).not.toContain('歌手名稱會全程顯示')
    expect(t).not.toContain('只決定歌手')
  })

  it('出題：動漫熱門（Epic 19）＝三個關鍵字搜尋、排除原聲帶與翻唱、熱門前 60 首隨機抽 5；數字與關鍵字由 shared 常數推導', () => {
    const t = text('be-setter')
    expect(t).toContain(
      '動漫熱門：不用輸入，系統用 anime、アニメ、動漫 三個關鍵字搜尋 Apple Music 的動漫歌曲，排除原聲帶、純音樂與翻唱，依熱門度取前 60 首再隨機抽 5 首；取不到時會顯示原因，可以再試一次或換一個來源。',
    )
    expect(t).toContain(`${ANIME_TERMS.join('、')} 三個關鍵字`)
    expect(t).toContain(`${SOURCE_TITLE['anime-hot']}：不用輸入`)
    expect(t).toContain(`前 ${ANIME_HOT_POOL} 首再隨機抽 ${SONGS_PER_GAME} 首`)
    // 內文不寫死關鍵字（ANIME_TERMS 為唯一來源）
    const body = source.slice(source.indexOf('export const HELP_TOPICS'), source.indexOf('/** 佔位符的代入值'))
    expect(body.replace(/\$\{[^}]+\}/g, '')).not.toContain(ANIME_TERMS.join('、'))
  })
})

describe('規則重點（spec/song-guess/overview.md v1 規則）', () => {
  it('出題者也猜、沒有額外加分', () => {
    expect(text('be-setter')).toContain('也和大家一起猜')
    expect(text('scoring')).toContain('出題者沒有額外加分')
  })

  it('歌名字數提示的算法：不含空白與標點、括號裡的副標不用打（architecture §4 titleLength）', () => {
    const t = text('guess')
    expect(t).toContain('字數不含空白與標點，括號裡的副標不用打')
    // 沒有相反的說法
    expect(all).not.toMatch(/字數(?:包含|含)(?:空白|標點)/)
  })

  it('猜對後歌繼續播、不公開原文、不能再說出歌名；中途加入者可猜', () => {
    const t = text('guess')
    expect(t).toContain('猜對了')
    expect(t).toContain('歌會繼續播到完')
    expect(t).toContain('不能出現歌名')
    expect(text('how-to-play')).toContain('也可以猜、可以得分')
  })
})
