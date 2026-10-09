/// <reference types="node" />
// 契約逐字比對：shared/src/draw-contest/events.ts 必須與 spec/draw-contest/architecture.md §4 的 ts 程式碼區塊完全相同
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SPEC = new URL('../../spec/draw-contest/architecture.md', import.meta.url);
const EVENTS = new URL('../src/draw-contest/events.ts', import.meta.url);
const START = '// shared/src/draw-contest/events.ts';

/** 取 spec 中從 START 那行起、到其後第一個 ``` 行之前的內容 */
function extractSpecBlock(md: string): string {
  const lines = md.split('\n');
  const from = lines.indexOf(START);
  if (from < 0) throw new Error(`spec 找不到 ${START}`);
  const to = lines.indexOf('```', from);
  if (to < 0) throw new Error('spec 程式碼區塊沒有結尾');
  return lines.slice(from, to).join('\n');
}

const trimEnd = (s: string) => s.replace(/\n+$/, '');

describe('draw-contest events.ts 與 spec §4 逐字一致', () => {
  it('內容相等（僅忽略結尾換行）', () => {
    const spec = extractSpecBlock(readFileSync(SPEC, 'utf8'));
    const events = readFileSync(EVENTS, 'utf8');
    expect(spec.length).toBeGreaterThan(0);
    expect(trimEnd(events)).toBe(trimEnd(spec));
  });
});
