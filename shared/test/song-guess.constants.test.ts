/// <reference types="node" />
// 猜歌常數：spec/song-guess/architecture.md §4「常數」表
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as sg from '../src/song-guess/constants';
import * as entry from '../src/song-guess';

const SPEC = new URL('../../spec/song-guess/architecture.md', import.meta.url);
const HEADING = '### 常數（`shared/src/song-guess/constants.ts`）';

/** 讀 spec「常數」表：回傳 [名稱, 值] 依表列順序（值欄須為整數） */
function readSpecTable(md: string): [string, number][] {
  const lines = md.split('\n');
  const from = lines.indexOf(HEADING);
  if (from < 0) throw new Error(`spec 找不到 ${HEADING}`);
  const rows: [string, number][] = [];
  for (const line of lines.slice(from + 1)) {
    if (line.startsWith('#')) break;
    const m = /^\| `([A-Z0-9_]+)` \| (\d+) \|/.exec(line);
    if (m) rows.push([m[1]!, Number(m[2])]);
  }
  return rows;
}

describe('常數值與 spec 表一致', () => {
  it('一局、時間、播放長度', () => {
    expect(sg.SONGS_PER_GAME).toBe(5);
    expect(sg.CHOOSING_SECONDS).toBe(60);
    expect(sg.REVEAL_SECONDS).toBe(5);
    expect(sg.START_DELAY_MS).toBe(1500);
    expect(sg.PREVIEW_CAP_MS).toBe(30000);
  });

  it('人數、長度、聊天、重連', () => {
    expect(sg.ARTIST_MAX).toBe(30);
    expect(sg.MIN_PLAYERS).toBe(2);
    expect(sg.MAX_PLAYERS).toBe(50);
    expect(sg.NICKNAME_MAX).toBe(12);
    expect(sg.CHAT_MAX).toBe(200);
    expect(sg.CHAT_HISTORY).toBe(100);
    expect(sg.CHAT_MIN_INTERVAL_MS).toBe(300);
    expect(sg.RECONNECT_GRACE_SECONDS).toBe(15);
  });

  it('分數 50..100', () => {
    expect(sg.SCORE_MAX).toBe(100);
    expect(sg.SCORE_MIN).toBe(50);
    expect(sg.SCORE_MIN).toBeLessThan(sg.SCORE_MAX);
  });

  it('只匯出 spec §4 常數小節列的常數（不帶另兩款才有的 DRAW_SECONDS、TOPIC_MAX、CANVAS_*、PALETTE 等）', () => {
    expect(Object.keys(sg).sort()).toEqual(
      [
        'SONGS_PER_GAME', 'CHOOSING_SECONDS', 'REVEAL_SECONDS', 'START_DELAY_MS', 'PREVIEW_CAP_MS',
        'ARTIST_MAX', 'MIN_PLAYERS', 'MAX_PLAYERS', 'NICKNAME_MAX', 'CHAT_MAX', 'CHAT_HISTORY',
        'CHAT_MIN_INTERVAL_MS', 'RECONNECT_GRACE_SECONDS', 'SCORE_MAX', 'SCORE_MIN',
      ].sort(),
    );
  });
});

describe('直接讀 spec「常數」表逐列對照', () => {
  const rows = readSpecTable(readFileSync(SPEC, 'utf8'));

  it('表有 15 列，名稱不重複', () => {
    expect(rows).toHaveLength(15);
    expect(new Set(rows.map(([name]) => name)).size).toBe(15);
  });

  it('表列的每個常數都有匯出且值相同；匯出的常數也都在表裡', () => {
    expect({ ...sg }).toEqual(Object.fromEntries(rows));
  });
});

describe('從 song-guess 入口匯出', () => {
  it('入口帶全部常數（值相同）與 SONG_GUESS_NAMESPACE', () => {
    const all: Record<string, unknown> = { ...entry };
    for (const [name, value] of Object.entries(sg)) expect(all[name]).toBe(value);
    expect(entry.SONG_GUESS_NAMESPACE).toBe('/song-guess');
  });
});
