// 遊戲說明的內容（複製自我畫你猜 features/help；DESIGN.md §16；spec/song-guess/overview.md v1 規則、design.md §1「說明」）：主題清單＋佔位符代入的純函式。
// 內文一份、所有偽裝共用；與偽裝相關的名稱用佔位符，由目前殼層的 ShellViews 提供：
//   {volunteer}＝出題按鈕的可見文字（ShellViews.volunteer.label）、{switch}＝切換偽裝的操作路徑（ShellViews.help.switchHint）。
// 本檔不得寫死任何殼層的名稱或路徑（shellBoundary 把關）。首數、秒數、人數、字數、分數一律由 shared 常數推導（改常數不必改說明）。
// 六個主題（design §1）：怎麼玩、出題、猜歌、計分、聲音與耳機、切換偽裝。
import {
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
import { START_PLAYBACK_LABEL } from '../player/playback'
import { VOLUME_DEFAULT, VOLUME_MAX, VOLUME_MIN } from '../player/volume'

/** 說明主題 id */
export type HelpTopicId = 'how-to-play' | 'be-setter' | 'guess' | 'scoring' | 'sound' | 'switch-theme'

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

/** 單首試聽最長秒數（PREVIEW_CAP_MS 為唯一來源） */
const PREVIEW_SECONDS = Math.round(PREVIEW_CAP_MS / 1000)

/** 主題清單（順序即清單順序） */
export const HELP_TOPICS: readonly HelpTopic[] = [
  {
    id: 'how-to-play',
    title: '怎麼玩',
    paragraphs: [
      `一個人出題、選一個題庫：指定一位歌手，或用今天的「${SOURCE_TITLE['tw-hot']}」「${SOURCE_TITLE['western-hot']}」排行榜，系統從裡面隨機抽 ${SONGS_PER_GAME} 首；大家同時聽每首約 ${PREVIEW_SECONDS} 秒的試聽，在聊天室打字猜歌名，越快猜對分數越高。`,
      `每首試聽播完就揭曉歌名、歌手、專輯封面與猜對的人，停 ${REVEAL_SECONDS} 秒自動播下一首；${SONGS_PER_GAME} 首都結束後顯示本局排名，一直停到有人再出題。`,
      `局進行中才加入的人會從目前進度接著聽，也可以猜、可以得分。斷線 ${RECONNECT_GRACE_SECONDS} 秒內回來（含重新整理）會自動接回原本的暱稱與分數，並從正確的位置接著播；同一個暱稱在別的分頁加入會接管，原分頁回到首頁。`,
    ],
  },
  {
    id: 'be-setter',
    title: '出題',
    paragraphs: [
      `房間至少 ${MIN_PLAYERS} 人在線、沒有進行中的局時，按「{volunteer}」，你就是這一局的出題者。`,
      `先在上方選題庫來源：歌手、${SOURCE_TITLE['tw-hot']}或${SOURCE_TITLE['western-hot']}（每次出題都從「歌手」開始），在 ${CHOOSING_SECONDS} 秒內送出；系統取到歌就立刻開始第 1 首。按 Esc 取消出題，逾時沒送出也會取消。`,
      `歌手：輸入歌手名稱（1–${ARTIST_MAX} 字）並按 Enter，系統會去搜尋這位歌手。「只抽熱門歌」預設勾選：搜尋結果本來就依 Apple 的熱門度排序，勾了只從最前面的 ${HOT_POOL} 首裡抽；取消勾選就從搜得到的全部歌裡抽，比較冷門的歌也會出現。勾不勾會記在你的瀏覽器，下次沿用。`,
      `這位歌手至少要有 ${SONGS_PER_GAME} 首有試聽的歌；找不到或搜尋失敗時會顯示原因，可以換一位或再試一次。`,
      `${SOURCE_TITLE['tw-hot']}、${SOURCE_TITLE['western-hot']}：不用輸入，直接從今天的 Apple Music 熱門排行榜（${SOURCE_TITLE['tw-hot']}是台灣榜、${SOURCE_TITLE['western-hot']}是美國榜）前 ${CHART_SIZE} 首隨機抽 ${SONGS_PER_GAME} 首，不分語言，台灣榜也會有韓文、英文歌；排行榜每天更新。取不到排行榜時會顯示原因，可以再試一次或換一個來源。`,
      '出題者只決定題庫，不知道會抽到哪幾首，所以也和大家一起猜。題庫名稱、第幾首與這首歌的歌手會全程顯示給所有人；用排行榜時每首的歌手可能不同，是猜歌的提示。',
    ],
  },
  {
    id: 'guess',
    title: '猜歌',
    paragraphs: [
      '歌在播的時候，在聊天室輸入歌名送出；和歌名一樣就算猜對。大小寫、全形半形、空白與標點都不影響，歌名後面的副標（括號裡的字、feat. 之後）可以不打，打完整歌名也算對。',
      '猜對時聊天室只會顯示「某某 猜對了」，不會公開你打的字；歌會繼續播到完，其他人可以繼續猜。猜對之後還是可以聊天，但訊息裡不能出現歌名。',
      '還沒猜對時，訊息裡如果夾著歌名但不是只有歌名，會被擋下來不送出：猜歌名請只輸入歌名本身。',
      `畫面上會提示歌名有幾個字：字數不含空白與標點，括號裡的副標不用打。聊天只能傳文字，最多 ${CHAT_MAX} 字。`,
    ],
  },
  {
    id: 'scoring',
    title: '計分',
    paragraphs: [
      `每首猜對得 ${SCORE_MIN}–${SCORE_MAX} 分：歌一開始就猜對是 ${SCORE_MAX} 分，越晚越少，試聽快結束才猜對是 ${SCORE_MIN} 分。可以很多人都猜對，各自依自己猜對的時間計分；沒猜對的那首 0 分。`,
      '出題者沒有額外加分，和大家一樣靠猜對得分。',
      `本局排名依這 ${SONGS_PER_GAME} 首的合計分數由高到低；同分時先達到這個分數的人在前。每首的得分也會累加到總分（顯示在玩家清單），伺服器重新啟動後歸零。`,
    ],
  },
  {
    id: 'sound',
    title: '聲音與耳機',
    paragraphs: [
      '這個遊戲會發出聲音，請戴耳機。歌是每個人的瀏覽器各自播放、同時開始，不會經過麥克風，旁邊的人聽不到你耳機裡的聲音。',
      `畫面上的音量滑桿是唯一的播放控制，範圍 ${VOLUME_MIN}–${VOLUME_MAX}，預設 ${VOLUME_DEFAULT}；調到 ${VOLUME_MIN} 就是靜音。設定只存在你自己的瀏覽器，下次進來會沿用。沒有暫停、重播或快轉，進度以伺服器的時間為準。`,
      `如果歌開始了卻沒有聲音，畫面中央可能出現「${START_PLAYBACK_LABEL}」的按鈕（瀏覽器不讓網頁自動出聲時會這樣），點一下就會從目前的進度接著播。`,
    ],
  },
  {
    id: 'switch-theme',
    title: '切換偽裝',
    paragraphs: [
      '{switch}，選一個想要的介面風格；下次進入時首頁會預選它。',
      '偽裝只影響你自己的畫面，其他人看到的是他們自己選的；聽到的歌與聊天內容大家都一樣。',
      '目前只有一種介面風格，之後有新的會出現在同一個地方。',
    ],
  },
]

/** 佔位符的代入值（由殼層提供） */
export interface HelpNames {
  /** 出題按鈕的可見文字 */
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
