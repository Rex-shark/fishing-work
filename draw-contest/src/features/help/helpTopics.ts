// 遊戲說明的內容（複製自我畫你猜 features/help；DESIGN.md §16；spec/draw-contest/overview.md v1 規則）：主題清單＋佔位符代入的純函式。
// 內文一份、所有偽裝共用；與偽裝相關的名稱用佔位符，由目前殼層的 ShellViews 提供：
//   {volunteer}＝「我出題」按鈕的可見文字（ShellViews.volunteer.label）、{switch}＝切換偽裝的操作路徑（ShellViews.help.switchHint）、
//   {save}＝交卷確認框的主要按鈕（交卷的叫法，ShellViews.terms.save）。
// 本檔不得寫死任何殼層的名稱或路徑（shellBoundary 把關）。秒數、人數、字數一律由 shared 常數推導（DRAW_SECONDS 為作畫時間唯一來源）。
// 六個主題（Phase 2 第二段正式文案）：如何出題、作畫、交卷、評分（含隨機評分）、排名與總分、聊天與重連。
import {
  CHAT_MAX,
  CHOOSING_SECONDS,
  MIN_PLAYERS,
  RECONNECT_GRACE_SECONDS,
  SCORE_MAX,
  SUBMIT_GRACE_SECONDS,
  TOPIC_MAX,
} from '@fishing-work/shared/draw-contest'
import { formatDuration } from './helpText'

/** 說明主題 id */
export type HelpTopicId = 'be-setter' | 'draw' | 'submit' | 'scoring' | 'ranking' | 'chat-reconnect'

export interface HelpTopic {
  id: HelpTopicId
  /** 清單上的名稱，也是第二步的標題 */
  title: string
  /** 段落（含佔位符 {volunteer}、{switch}、{save}） */
  paragraphs: readonly string[]
}

/** 第一步（主題清單）的標題 */
export const HELP_LIST_TITLE = '說明'
/** 第二步的選項 */
export const HELP_BACK_LABEL = '返回'
export const HELP_CLOSE_LABEL = '關閉'

/** 主題清單（順序即清單順序） */
export const HELP_TOPICS: readonly HelpTopic[] = [
  {
    id: 'be-setter',
    title: '如何出題',
    paragraphs: [
      `房間至少 ${MIN_PLAYERS} 人在線、沒有回合進行中時，按「{volunteer}」，你就是本回合的出題者。`,
      `在 ${CHOOSING_SECONDS} 秒內輸入題目（1–${TOPIC_MAX} 字）並按 Enter，比賽立刻開始；按 Esc 放棄出題，逾時沒送出也會取消。`,
      '題目會公開給所有人，出題者也一起畫。',
    ],
  },
  {
    id: 'draw',
    title: '作畫',
    paragraphs: [
      `題目送出時在線的每個人（包含出題者）都是參賽者，各自在自己的畫布上畫，時間 ${formatDuration()}；別人看不到你正在畫什麼。`,
      '工具有顏色（色塊，或點最左邊的目前顏色打開顏色面板）、粗細、背景色、橡皮擦、復原與清空畫布；背景色只改你自己的畫布。',
      '回合進行中才加入的人本回合旁觀，下一回合就能參加。',
    ],
  },
  {
    id: 'submit',
    title: '交卷',
    paragraphs: [
      '畫好按「完成」，在確認框按「{save}」就交卷；交卷後不能再修改。按「取消」可以回去繼續畫。',
      '時間到還沒交卷的人，會自動交出目前的畫（空白也算），不會再問。所有參賽者都交卷就提前結束作畫。',
      `時間到後還有 ${SUBMIT_GRACE_SECONDS} 秒讓自動交卷送達；逾時沒交到的人算 0 分。`,
    ],
  },
  {
    id: 'scoring',
    title: '評分',
    paragraphs: [
      `每交一張就排隊評一張，評分器給 0–${SCORE_MAX} 分，畫面會顯示「正在評分」的進度。`,
      '目前使用隨機評分：分數由圖片本身決定、和畫得像不像無關，同一張圖永遠同分；揭曉時分數旁會標示「隨機」。',
      '日後改用 AI 評分；AI 出問題時本回合剩下的畫會退回隨機評分，畫面一樣會標示。',
    ],
  },
  {
    id: 'ranking',
    title: '排名與總分',
    paragraphs: [
      '全部評完就揭曉：每個人的畫依本回合分數由高到低排列，前三名加框；同分時先交卷的在前，未交卷的排最後、0 分。',
      '本回合分數會累加到總分（顯示在玩家清單）；伺服器重新啟動後歸零。',
      '揭曉畫面會一直停著，直到有人按「{volunteer}」開始下一回合；點一張畫可以放大，再點一次或按 Esc 回到全部。',
    ],
  },
  {
    id: 'chat-reconnect',
    title: '聊天與重連',
    paragraphs: [
      `聊天只能傳文字（最多 ${CHAT_MAX} 字）；題目本來就公開，可以自由討論。`,
      `斷線 ${RECONNECT_GRACE_SECONDS} 秒內回來會自動接回原本的暱稱與分數；超過就視為離開。`,
      '斷線重連不會丟掉正在畫的畫，但重新整理頁面會（還沒交卷的畫只在你的瀏覽器裡）；重連後畫布是空的，仍可繼續畫與交卷。',
      '同一個暱稱在別的分頁加入會接管，原分頁回到首頁。想換介面風格：{switch}。',
    ],
  },
]

/** 佔位符的代入值（由殼層提供） */
export interface HelpNames {
  /** 「我出題」按鈕的可見文字 */
  volunteer: string
  /** 切換偽裝的操作路徑 */
  switch: string
  /** 交卷確認框的主要按鈕（交卷的叫法） */
  save: string
}

/** 依 id 找主題；不存在回 undefined */
export function findHelpTopic(id: string): HelpTopic | undefined {
  return HELP_TOPICS.find((t) => t.id === id)
}

/** 代入佔位符，回傳要顯示的段落（每個佔位符都代入；其餘文字原樣） */
export function renderTopic(topic: Pick<HelpTopic, 'paragraphs'>, names: HelpNames): string[] {
  return topic.paragraphs.map((p) =>
    p.replaceAll('{volunteer}', names.volunteer).replaceAll('{switch}', names.switch).replaceAll('{save}', names.save),
  )
}
