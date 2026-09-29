// 遊戲說明的內容（plan/help-topics.md 決策 1、5；DESIGN.md §16；architecture §7）：主題清單＋佔位符代入的純函式。
// 內文一份、所有偽裝共用；與偽裝相關的名稱用佔位符，由目前殼層的 ShellViews 提供：
//   {volunteer}＝自願當畫師按鈕的可見文字（ShellViews.volunteer.label）、{switch}＝切換偽裝的操作路徑（ShellViews.help.switchHint）。
// 本檔不得寫死任何殼層的名稱或路徑（shellBoundary 把關）；內文與 plan 決策 5 的表逐字相同（helpTopics 測試解析 plan 比對）。

/** 說明主題 id（決策 5） */
export type HelpTopicId = 'be-drawer' | 'guess' | 'switch-theme' | 'tools' | 'image' | 'reconnect'

export interface HelpTopic {
  id: HelpTopicId
  /** 清單上的名稱，也是第二步的標題 */
  title: string
  /** 段落（含佔位符 {volunteer}、{switch}） */
  paragraphs: readonly string[]
}

/** 第一步（主題清單）的標題 */
export const HELP_LIST_TITLE = '說明'
/** 第二步的選項 */
export const HELP_BACK_LABEL = '返回'
export const HELP_CLOSE_LABEL = '關閉'

/** 主題清單（順序即清單順序；內文逐字照 plan/help-topics.md 決策 5） */
export const HELP_TOPICS: readonly HelpTopic[] = [
  {
    id: 'be-drawer',
    title: '如何當畫師',
    paragraphs: [
      '房間至少 2 人在線時，畫面上會出現「{volunteer}」，按下去你就是本回合的畫師。',
      '接著在 60 秒內輸入題目（1–20 字）並按 Enter，就開始作畫，時間 90 秒。',
      '作畫中不能在聊天室說出答案，也不能傳圖片。',
    ],
  },
  {
    id: 'guess',
    title: '如何猜題與計分',
    paragraphs: [
      '畫師作畫時，其他人在聊天室輸入答案，命中題目就算猜對；聊天室只會顯示「某某 猜對了」，不會洩漏答案。',
      '猜對得 100 分，越晚猜對越少，最低 50 分；畫師每有一人猜對得 20 分。',
      '全員猜對或 90 秒到就揭曉題目，5 秒後回到等待。',
    ],
  },
  {
    id: 'switch-theme',
    title: '如何切換偽裝',
    paragraphs: [
      '{switch}，選一個想要的介面風格；下次進入時首頁會預選它。',
      '偽裝只影響你自己的畫面，其他人看到的是他們自己選的；畫布與聊天內容大家都一樣。',
    ],
  },
  {
    id: 'tools',
    title: '畫師工具與放棄',
    paragraphs: [
      '作畫時的工具列有：顏色（色塊與色相條）、粗細滑桿、橡皮擦、復原、清空畫布。',
      '「放棄本回合」會結束這回合並揭曉題目，其他人不得分。',
    ],
  },
  {
    id: 'image',
    title: '傳圖片',
    paragraphs: [
      '把圖片拖進聊天室，或在輸入框貼上，單張 10 MB 以內。',
      '圖片只即時顯示給當時在線的人，不保留；中途加入的人看不到。',
    ],
  },
  {
    id: 'reconnect',
    title: '斷線與重新整理',
    paragraphs: [
      '斷線 15 秒內回來（含重新整理）會自動接回原本的暱稱與分數；超過就視為離開，畫師離開則回合結束。',
      '同一個暱稱在別的分頁加入會接管，原分頁回到首頁。',
    ],
  },
]

/** 佔位符的代入值（由殼層提供） */
export interface HelpNames {
  /** 自願當畫師按鈕的可見文字 */
  volunteer: string
  /** 切換偽裝的操作路徑 */
  switch: string
}

/** 依 id 找主題；不存在回 undefined */
export function findHelpTopic(id: string): HelpTopic | undefined {
  return HELP_TOPICS.find((t) => t.id === id)
}

/** 代入佔位符，回傳要顯示的段落（每個佔位符都代入；其餘文字原樣） */
export function renderTopic(topic: Pick<HelpTopic, 'paragraphs'>, names: HelpNames): string[] {
  return topic.paragraphs.map((p) => p.replaceAll('{volunteer}', names.volunteer).replaceAll('{switch}', names.switch))
}
