// 繪圖比賽常數：spec/draw-contest/architecture.md §4「常數」表
import { describe, expect, it } from 'vitest';
import * as dc from '../src/draw-contest/constants';
import * as entry from '../src/draw-contest';
import * as dg from '../src/draw-guess/constants';

describe('常數值與 spec 表一致', () => {
  it('時間、人數、長度', () => {
    expect(dc.DRAW_SECONDS).toBe(120);
    expect(dc.CHOOSING_SECONDS).toBe(60);
    expect(dc.SUBMIT_GRACE_SECONDS).toBe(5);
    expect(dc.MIN_PLAYERS).toBe(2);
    expect(dc.MAX_PLAYERS).toBe(50);
    expect(dc.NICKNAME_MAX).toBe(12);
    expect(dc.TOPIC_MAX).toBe(20);
    expect(dc.CHAT_MAX).toBe(200);
    expect(dc.CHAT_HISTORY).toBe(100);
    expect(dc.CHAT_MIN_INTERVAL_MS).toBe(300);
    expect(dc.RECONNECT_GRACE_SECONDS).toBe(15);
  });

  it('畫布、交卷、分數', () => {
    expect(dc.CANVAS_LOGICAL).toEqual({ width: 1280, height: 720 });
    expect(dc.CANVAS_BACKGROUND).toBe('#1E1E1E');
    expect(dc.MAX_SUBMISSION_BYTES).toBe(2_097_152);
    expect(dc.MAX_SUBMISSION_BYTES).toBe(2 * 1024 * 1024);
    expect(dc.SCORE_MAX).toBe(100);
  });

  it('參考圖上限（Epic 20）：MAX_REFERENCE_BYTES 2 MiB，且從 draw-contest 入口匯出', () => {
    expect(dc.MAX_REFERENCE_BYTES).toBe(2_097_152);
    expect(dc.MAX_REFERENCE_BYTES).toBe(2 * 1024 * 1024);
    expect(entry.MAX_REFERENCE_BYTES).toBe(dc.MAX_REFERENCE_BYTES);
  });

  it('評審名稱（Epic 15）：COMMENT_PERSONA_NAME 為唯一來源，且從 draw-contest 入口匯出', () => {
    expect(dc.COMMENT_PERSONA_NAME).toBe('ミオ'); // 2026-10-21 由 メスガキ 改（只影響客戶端顯示）
    expect(entry.COMMENT_PERSONA_NAME).toBe(dc.COMMENT_PERSONA_NAME);
  });

  it('筆刷 1／64／4', () => {
    expect(dc.BRUSH_MIN).toBe(1);
    expect(dc.BRUSH_MAX).toBe(64);
    expect(dc.BRUSH_DEFAULT).toBe(4);
  });

  it('只匯出 spec §4 常數小節列的常數（不帶 draw-guess 才有的 IMAGE_*、ENDED_SECONDS、MAX_OPS_* 等）', () => {
    expect(Object.keys(dc).sort()).toEqual(
      [
        'DRAW_SECONDS', 'CHOOSING_SECONDS', 'SUBMIT_GRACE_SECONDS', 'MIN_PLAYERS', 'MAX_PLAYERS',
        'NICKNAME_MAX', 'TOPIC_MAX', 'CHAT_MAX', 'CHAT_HISTORY', 'CHAT_MIN_INTERVAL_MS',
        'RECONNECT_GRACE_SECONDS', 'CANVAS_LOGICAL', 'CANVAS_BACKGROUND', 'MAX_SUBMISSION_BYTES',
        'SCORE_MAX', 'BRUSH_MIN', 'BRUSH_MAX', 'BRUSH_DEFAULT', 'PALETTE', 'COLOR_PATTERN',
        'COMMENT_PERSONA_NAME', 'MAX_REFERENCE_BYTES',
      ].sort(),
    );
  });
});

describe('畫具與我畫你猜相同', () => {
  it('PALETTE 逐項相等', () => {
    expect([...dc.PALETTE]).toEqual([...dg.PALETTE]);
  });

  it('COLOR_PATTERN 相同', () => {
    expect(dc.COLOR_PATTERN.source).toBe(dg.COLOR_PATTERN.source);
    expect(dc.COLOR_PATTERN.flags).toBe(dg.COLOR_PATTERN.flags);
  });

  it('BRUSH_*、CANVAS_LOGICAL、CANVAS_BACKGROUND 相同', () => {
    expect(dc.BRUSH_MIN).toBe(dg.BRUSH_MIN);
    expect(dc.BRUSH_MAX).toBe(dg.BRUSH_MAX);
    expect(dc.BRUSH_DEFAULT).toBe(dg.BRUSH_DEFAULT);
    expect(dc.CANVAS_LOGICAL).toEqual(dg.CANVAS_LOGICAL);
    expect(dc.CANVAS_BACKGROUND).toBe(dg.CANVAS_BACKGROUND);
  });

  it('PALETTE 每個色碼都符合 COLOR_PATTERN', () => {
    for (const c of dc.PALETTE) expect(dc.COLOR_PATTERN.test(c)).toBe(true);
  });
});
