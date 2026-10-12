// 聊天節流與猜題判定：spec/song-guess/architecture.md §5「猜題」、§5.2「聊天」、§5.3「錯誤訊息」
// 文字驗證用 shared 的 validateChatText；MESSAGE_INVALID／RATE_LIMITED 文案與另兩款相同（§5.3「其餘同繪圖比賽」）。
import {
  CHAT_MAX,
  CHAT_MIN_INTERVAL_MS,
  SCORE_MAX,
  SCORE_MIN,
  containsSpoiler,
  isCorrect,
} from '@fishing-work/shared/song-guess';

export { validateChatText, type ChatTextCheck } from '@fishing-work/shared/song-guess';

/** chat:send 的繁中錯誤訊息（ack.message，客戶端直接顯示） */
export const CHAT_ERROR_MESSAGES = {
  MESSAGE_INVALID: `訊息需為 1～${CHAT_MAX} 個字，不可含換行等控制字元，也不能只有空白`,
  RATE_LIMITED: `發言太快了，請稍候再送（間隔至少 ${CHAT_MIN_INTERVAL_MS / 1000} 秒）`,
  /** 已猜對者：訊息含歌名（§5.3） */
  SPOILER_BLOCKED: '你已經猜對了，不要說出歌名',
  /** 未猜對者：訊息含歌名但不完全相同（例如歌名「遇見」打「是遇見嗎」）（§5.3） */
  SPOILER_BLOCKED_GUESS: '猜歌名請只輸入歌名本身',
} as const;

/** 距上一則被接受的訊息是否太近（< CHAT_MIN_INTERVAL_MS）；還沒發過言為 false */
export function isRateLimited(lastChatAt: number | null, now: number): boolean {
  return lastChatAt !== null && now - lastChatAt < CHAT_MIN_INTERVAL_MS;
}

/**
 * playing 時一則訊息的判定（§5「猜題」）：
 * - 'correct'：未猜對者猜對 → 得分，不廣播原文。
 * - 'spoilerGuessed'：已猜對者的訊息含歌名 → 擋下。
 * - 'spoilerGuess'：未猜對者的訊息含歌名但不完全相同 → 擋下（本遊戲可多人得分，原文廣播等於送分）。
 * - 'chat'：照常廣播。
 */
export type GuessVerdict = 'correct' | 'spoilerGuessed' | 'spoilerGuess' | 'chat';

export function judgeMessage(text: string, title: string, hasGuessed: boolean): GuessVerdict {
  if (hasGuessed) {
    // 猜對的字串必然含歌名（shared 測試有驗）；多判 isCorrect 是保險，已猜對者不論怎麼打都不能把答案送出去
    return containsSpoiler(text, title) || isCorrect(text, title) ? 'spoilerGuessed' : 'chat';
  }
  if (isCorrect(text, title)) return 'correct';
  return containsSpoiler(text, title) ? 'spoilerGuess' : 'chat';
}

/**
 * 猜對者得分：SCORE_MAX − floor((SCORE_MAX − SCORE_MIN) × 已用毫秒 / 播放毫秒)，範圍 SCORE_MIN..SCORE_MAX。
 * 已用時間夾在 0..durationMs：startedAt 之前（起播緩衝中）猜對視為 0 秒＝滿分；
 * 計時器延遲讓 now 超過 endsAt 時取最低分。
 */
export function guessScore(startedAt: number, now: number, durationMs: number): number {
  if (!(durationMs > 0)) return SCORE_MAX;
  const elapsed = Math.min(Math.max(now - startedAt, 0), durationMs);
  return SCORE_MAX - Math.floor(((SCORE_MAX - SCORE_MIN) * elapsed) / durationMs);
}
