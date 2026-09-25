import { describe, expect, it } from 'vitest';
import { ROUND_SECONDS } from '@fishing-work/shared';
import { DRAWER_POINTS_PER_CORRECT, drawerRoundScore, guesserScore } from '../src/games/draw-guess/scoring';

const ROUND_MS = ROUND_SECONDS * 1000;
const T0 = 1_700_000_000_000;

describe('畫師結算（spec §5 計分）', () => {
  it('每有一人猜對 +20', () => {
    expect(DRAWER_POINTS_PER_CORRECT).toBe(20);
    expect(drawerRoundScore(0)).toBe(0);
    expect(drawerRoundScore(1)).toBe(20);
    expect(drawerRoundScore(29)).toBe(580);
  });
  it('防呆：負數與小數', () => {
    expect(drawerRoundScore(-1)).toBe(0);
    expect(drawerRoundScore(2.9)).toBe(40);
  });
});

describe('猜對者分數（spec §5：100 − floor(50 × 已用 ms / (ROUND_SECONDS × 1000))，範圍 50..100）', () => {
  it('已用 0 秒 → 100', () => {
    expect(guesserScore(T0, T0)).toBe(100);
  });
  it(`已用 ${ROUND_SECONDS} 秒 → 50`, () => {
    expect(guesserScore(T0, T0 + ROUND_MS)).toBe(50);
  });
  it(`超過 ${ROUND_SECONDS} 秒（在途訊息）→ 50（clamp）`, () => {
    expect(guesserScore(T0, T0 + ROUND_MS + 1)).toBe(50);
    expect(guesserScore(T0, T0 + ROUND_MS * 10)).toBe(50);
  });
  it('負值（時鐘異常）→ 100（clamp）', () => {
    expect(guesserScore(T0, T0 - 1)).toBe(100);
    expect(guesserScore(T0, T0 - 60_000)).toBe(100);
  });
  it('中間值依公式向下取整', () => {
    expect(guesserScore(T0, T0 + 1)).toBe(100); // floor(50 × 1 / 90000) = 0
    expect(guesserScore(T0, T0 + 1800)).toBe(99); // floor(1) = 1
    expect(guesserScore(T0, T0 + 1799)).toBe(100);
    expect(guesserScore(T0, T0 + 45_000)).toBe(75);
    expect(guesserScore(T0, T0 + 30_000)).toBe(84); // floor(16.67) = 16
    expect(guesserScore(T0, T0 + ROUND_MS - 1)).toBe(51); // floor(49.999…) = 49
  });
  it('每一毫秒都在 50..100 且單調不增', () => {
    let prev = 100;
    for (let ms = 0; ms <= ROUND_MS; ms += 250) {
      const s = guesserScore(T0, T0 + ms);
      expect(s).toBeGreaterThanOrEqual(50);
      expect(s).toBeLessThanOrEqual(100);
      expect(s).toBeLessThanOrEqual(prev);
      prev = s;
    }
  });
  it('可傳入回合長度（Room 以自己的 roundMs 計算；預設 ROUND_SECONDS）', () => {
    expect(guesserScore(T0, T0 + 500, 1000)).toBe(75);
    expect(guesserScore(T0, T0 + 1000, 1000)).toBe(50);
    expect(guesserScore(T0, T0 + 45_000)).toBe(guesserScore(T0, T0 + 45_000, ROUND_MS));
  });
});
