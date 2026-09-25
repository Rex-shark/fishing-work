// 計分（純函式）：spec/architecture.md §5「計分」
import { ROUND_SECONDS } from '@fishing-work/shared';

/** 每有一人猜對，畫師得分 */
export const DRAWER_POINTS_PER_CORRECT = 20;
/** 猜對者最高分（0 秒猜對） */
export const GUESSER_MAX_POINTS = 100;
/** 猜對者最低分（時間用完才猜對） */
export const GUESSER_MIN_POINTS = 50;

/** 畫師：回合結束時 +20 × 猜對人數 */
export function drawerRoundScore(correctCount: number): number {
  return DRAWER_POINTS_PER_CORRECT * Math.max(0, Math.floor(correctCount));
}

/**
 * 猜對者：100 − floor(50 × (now − startedAt) / (ROUND_SECONDS × 1000))，範圍 50..100。
 * 已用時間 clamp 在 0..roundMs：時鐘異常（負值）→ 100；超時才送到（在途訊息）→ 50。
 * roundMs 預設為 ROUND_SECONDS × 1000；Room 傳入自己的回合長度（正式環境相同，e2e 可縮短）。
 */
export function guesserScore(startedAt: number, now: number, roundMs: number = ROUND_SECONDS * 1000): number {
  if (!(roundMs > 0)) return GUESSER_MAX_POINTS;
  const elapsed = Math.min(Math.max(now - startedAt, 0), roundMs);
  const span = GUESSER_MAX_POINTS - GUESSER_MIN_POINTS;
  return GUESSER_MAX_POINTS - Math.floor((span * elapsed) / roundMs);
}
