/// <reference types="node" />
// 猜歌常數：spec/song-guess/architecture.md §4「常數」表
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as sg from '../src/song-guess/constants';
import * as entry from '../src/song-guess';

const SPEC = new URL('../../spec/song-guess/architecture.md', import.meta.url);
const HEADING = '### 常數（`shared/src/song-guess/constants.ts`）';

/**
 * 解析 spec 表的值欄：整數直接轉數字；以反引號包住的物件字面量（目前只有 SOURCE_TITLE，Epic 18）
 * 把單引號換成雙引號後以 JSON 解析（只支援字串鍵、字串值的扁平物件，值內不得含引號）
 */
function parseSpecValue(cell: string): unknown {
  if (/^\d+$/.test(cell)) return Number(cell);
  const obj = /^`(\{.*\})`$/.exec(cell);
  if (obj) return JSON.parse(obj[1]!.replace(/'/g, '"')) as unknown;
  throw new Error(`spec 常數表的值無法解析：${cell}`);
}

/** 讀 spec「常數」表：回傳 [名稱, 值] 依表列順序（值欄為整數或物件字面量） */
function readSpecTable(md: string): [string, unknown][] {
  const lines = md.split('\n');
  const from = lines.indexOf(HEADING);
  if (from < 0) throw new Error(`spec 找不到 ${HEADING}`);
  const rows: [string, unknown][] = [];
  for (const line of lines.slice(from + 1)) {
    if (line.startsWith('#')) break;
    const m = /^\| `([A-Z0-9_]+)` \| (.+?) \|/.exec(line);
    if (m) rows.push([m[1]!, parseSpecValue(m[2]!)]);
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

  it('題庫來源（Epic 18）：HOT_POOL 30、CHART_SIZE 100、SOURCE_TITLE 兩個榜單標題', () => {
    expect(sg.HOT_POOL).toBe(30);
    expect(sg.CHART_SIZE).toBe(100);
    expect(sg.SOURCE_TITLE).toEqual({ 'tw-hot': '台灣熱門', 'western-hot': '西洋熱門' });
    expect(Object.keys(sg.SOURCE_TITLE).sort()).toEqual(['tw-hot', 'western-hot']);
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
        'HOT_POOL', 'CHART_SIZE', 'SOURCE_TITLE',
      ].sort(),
    );
  });
});

describe('直接讀 spec「常數」表逐列對照', () => {
  const rows = readSpecTable(readFileSync(SPEC, 'utf8'));

  it('表有 18 列，名稱不重複', () => {
    expect(rows).toHaveLength(18);
    expect(new Set(rows.map(([name]) => name)).size).toBe(18);
  });

  it('物件值的列（SOURCE_TITLE）確實解析成物件，不是被略過', () => {
    expect(Object.fromEntries(rows)['SOURCE_TITLE']).toEqual({ 'tw-hot': '台灣熱門', 'western-hot': '西洋熱門' });
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
