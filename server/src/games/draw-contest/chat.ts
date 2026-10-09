// 聊天文字驗證與錯誤文案：spec/draw-contest/architecture.md §5.3
// 文字驗證用 shared 的 validateChatText；錯誤文案與我畫你猜相同（§5.4「其餘與我畫你猜同文案」）。
import { CHAT_MAX, CHAT_MIN_INTERVAL_MS } from '@fishing-work/shared/draw-contest';

export { validateChatText, type ChatTextCheck } from '@fishing-work/shared/draw-contest';

/** chat:send 的繁中錯誤訊息（ack.message，客戶端直接顯示） */
export const CHAT_ERROR_MESSAGES = {
  MESSAGE_INVALID: `訊息需為 1～${CHAT_MAX} 個字，不可含換行等控制字元，也不能只有空白`,
  RATE_LIMITED: `發言太快了，請稍候再送（間隔至少 ${CHAT_MIN_INTERVAL_MS / 1000} 秒）`,
} as const;
