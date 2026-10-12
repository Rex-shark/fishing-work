/// <reference types="node" />
// 契約逐字比對：shared/src/draw-contest/events.ts 必須與 spec/draw-contest/architecture.md §4 的 ts 程式碼區塊完全相同
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type {
  CommentMode,
  CommentUpdate,
  ResultEntry,
  RoundPublic,
  ServerToClientEvents,
} from '../src/draw-contest/events';

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

// Epic 15「AI 評語」新增的契約：型別由 tsc（npm run typecheck）把關，這裡只留最小的執行期斷言
describe('Epic 15 評語契約（型別層）', () => {
  const base = {
    playerId: 'p1',
    nickname: '小明',
    rank: 1,
    score: 80,
    confidence: 0.9,
    judgedBy: 'ai',
    submitted: true,
    submittedAt: 1_000,
  } as const;

  it('CommentMode 只有 ai／off', () => {
    const modes: CommentMode[] = ['ai', 'off'];
    expect(modes).toEqual(['ai', 'off']);
    // @ts-expect-error 評語器沒有 random
    const bad: CommentMode = 'random';
    expect(bad).toBe('random');
  });

  it('ResultEntry 帶 comment（string | null）與 commentPending（必填）', () => {
    const pending: ResultEntry = { ...base, comment: null, commentPending: true };
    const done: ResultEntry = { ...base, comment: '線條很有精神嘛', commentPending: false };
    expect(pending.comment).toBeNull();
    expect(pending.commentPending).toBe(true);
    expect(done.comment).toBe('線條很有精神嘛');
    expect(done.commentPending).toBe(false);
    // @ts-expect-error comment、commentPending 為必填
    const missing: ResultEntry = { ...base };
    expect(missing.playerId).toBe('p1');
  });

  it('RoundPublic 帶 commentMode（CommentMode | null）', () => {
    const round: RoundPublic = {
      roundNo: 1,
      phase: 'ended',
      setterId: 'p0',
      topic: null,
      startedAt: null,
      endsAt: null,
      participantIds: ['p1'],
      submittedCount: 1,
      judgedCount: 1,
      judgeMode: 'ai',
      commentMode: 'ai',
      results: [{ ...base, comment: null, commentPending: true }],
      lastTopic: '貓',
    };
    const idle: RoundPublic = { ...round, phase: 'idle', commentMode: null };
    const off: RoundPublic = { ...round, commentMode: 'off' };
    expect(round.commentMode).toBe('ai');
    expect(idle.commentMode).toBeNull();
    expect(off.commentMode).toBe('off');
  });

  it("CommentUpdate 與 ServerToClientEvents['contest:comment']", () => {
    const ok: CommentUpdate = { roundNo: 1, playerId: 'p1', comment: '勉強及格啦' };
    const failed: CommentUpdate = { roundNo: 1, playerId: 'p1', comment: null };
    const received: CommentUpdate[] = [];
    const handler: ServerToClientEvents['contest:comment'] = (update) => {
      received.push(update);
    };
    handler(ok);
    handler(failed);
    expect(received).toEqual([ok, failed]);
  });
});
