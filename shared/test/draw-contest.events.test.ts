/// <reference types="node" />
// 契約逐字比對：shared/src/draw-contest/events.ts 必須與 spec/draw-contest/architecture.md §4 的 ts 程式碼區塊完全相同
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type {
  Ack,
  ClientToServerEvents,
  CommentMode,
  CommentUpdate,
  ContestMode,
  ErrorCode,
  ReferenceImage,
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
      mode: 'topic',
      lastMode: 'topic',
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

// Epic 20「像不像比賽」新增的契約：型別由 tsc 把關，這裡只留最小的執行期斷言
describe('Epic 20 像不像比賽契約（型別層）', () => {
  const ended: RoundPublic = {
    roundNo: 2,
    phase: 'ended',
    setterId: 'p0',
    topic: '皮卡丘',
    mode: 'mimic',
    startedAt: 1_000,
    endsAt: null,
    participantIds: ['p1'],
    submittedCount: 1,
    judgedCount: 1,
    judgeMode: 'ai',
    commentMode: 'off',
    results: [],
    lastTopic: '皮卡丘',
    lastMode: 'mimic',
  };

  it('ContestMode 只有 topic／mimic', () => {
    const modes: ContestMode[] = ['topic', 'mimic'];
    expect(modes).toEqual(['topic', 'mimic']);
    // @ts-expect-error 沒有其他模式
    const bad: ContestMode = 'copy';
    expect(bad).toBe('copy');
  });

  it('RoundPublic 帶 mode 與 lastMode（ContestMode | null，皆必填）', () => {
    const choosing: RoundPublic = { ...ended, phase: 'choosing', topic: null, mode: null };
    const nextDrawing: RoundPublic = { ...ended, roundNo: 3, phase: 'drawing', mode: 'topic', results: null, lastTopic: null, lastMode: null };
    expect(ended.mode).toBe('mimic');
    expect(ended.lastMode).toBe('mimic');
    expect(choosing.mode).toBeNull();
    expect(choosing.lastMode).toBe('mimic');
    expect(nextDrawing.lastMode).toBeNull();
    const { mode: _m, lastMode: _l, ...missing } = ended;
    // @ts-expect-error mode、lastMode 為必填
    const noModes: RoundPublic = missing;
    expect(noModes.roundNo).toBe(2);
  });

  it("ReferenceImage 與 ServerToClientEvents['contest:reference']", () => {
    const image: ReferenceImage = { roundNo: 2, jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer };
    const received: ReferenceImage[] = [];
    const handler: ServerToClientEvents['contest:reference'] = (img) => {
      received.push(img);
    };
    handler(image);
    expect(received).toEqual([image]);
    expect(new Uint8Array(received[0].jpeg)[0]).toBe(0xff);
  });

  it("round:setTopic payload：reference 選填（ArrayBuffer）", () => {
    const sent: Parameters<ClientToServerEvents['round:setTopic']>[0][] = [];
    const emit: ClientToServerEvents['round:setTopic'] = (payload, ack) => {
      sent.push(payload);
      ack({ ok: true, data: undefined });
    };
    const acks: Ack[] = [];
    emit({ topic: '蘋果' }, (r) => acks.push(r));
    emit({ topic: '照著畫', reference: new ArrayBuffer(4) }, (r) => acks.push(r));
    expect(sent[0].reference).toBeUndefined();
    expect(sent[1].reference?.byteLength).toBe(4);
    expect(acks).toHaveLength(2);
  });

  it('ErrorCode 含 REFERENCE_INVALID', () => {
    const code: ErrorCode = 'REFERENCE_INVALID';
    const failed: Ack = { ok: false, error: code, message: '參考圖格式不正確或太大（請選圖片檔）' };
    expect(failed.ok).toBe(false);
    // @ts-expect-error 不存在的錯誤碼
    const bad: ErrorCode = 'IMAGE_INVALID';
    expect(bad).toBe('IMAGE_INVALID');
  });
});
