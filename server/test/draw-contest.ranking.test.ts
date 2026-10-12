// 排名：spec/draw-contest/architecture.md §5.2
import { describe, expect, it } from 'vitest';
import { rankResults, type JudgedSubmission } from '../src/games/draw-contest/ranking';

const nick = (id: string) => id.toUpperCase();
const sub = (score: number, submittedAt: number, confidence = 0.5, comment: string | null = null, commentPending = false): JudgedSubmission => ({
  score,
  submittedAt,
  confidence,
  judgedBy: 'random',
  comment,
  commentPending,
});

describe('§5.2 rankResults', () => {
  it('交卷者依 score 降冪、同分依 submittedAt 升冪；rank 從 1 起不並列', () => {
    const subs = new Map([
      ['a', sub(50, 300)],
      ['b', sub(80, 500)],
      ['c', sub(50, 100)],
    ]);
    expect(rankResults(['a', 'b', 'c'], subs, nick).map((r) => [r.playerId, r.rank, r.score])).toEqual([
      ['b', 1, 80],
      ['c', 2, 50],
      ['a', 3, 50],
    ]);
  });

  it('未交卷者接在後面：score 0、confidence／judgedBy／submittedAt null、submitted false；彼此依 participantIds 順序', () => {
    const subs = new Map([['c', sub(10, 1, 0.7)]]);
    const res = rankResults(['d', 'a', 'c', 'b'], subs, nick);
    expect(res).toEqual([
      { playerId: 'c', nickname: 'C', rank: 1, score: 10, confidence: 0.7, judgedBy: 'random', submitted: true, submittedAt: 1, comment: null, commentPending: false },
      { playerId: 'd', nickname: 'D', rank: 2, score: 0, confidence: null, judgedBy: null, submitted: false, submittedAt: null, comment: null, commentPending: false },
      { playerId: 'a', nickname: 'A', rank: 3, score: 0, confidence: null, judgedBy: null, submitted: false, submittedAt: null, comment: null, commentPending: false },
      { playerId: 'b', nickname: 'B', rank: 4, score: 0, confidence: null, judgedBy: null, submitted: false, submittedAt: null, comment: null, commentPending: false },
    ]);
  });

  it('評語（Epic 15）：交卷者的 comment／commentPending 原樣帶出；未交卷者一律 null／false', () => {
    const subs = new Map([
      ['a', sub(30, 1, 0.5, '就這？', false)],
      ['b', sub(60, 2, 0.5, null, true)],
      ['c', sub(10, 3, 0.5, null, false)],
    ]);
    expect(rankResults(['a', 'b', 'c', 'd'], subs, nick).map((r) => [r.playerId, r.comment, r.commentPending])).toEqual([
      ['b', null, true],
      ['a', '就這？', false],
      ['c', null, false],
      ['d', null, false],
    ]);
  });

  it('交卷者 score 0 仍排在未交卷者之前', () => {
    const res = rankResults(['a', 'b'], new Map([['b', sub(0, 5)]]), nick);
    expect(res.map((r) => [r.playerId, r.submitted])).toEqual([['b', true], ['a', false]]);
  });

  it('同分同時間依 participantIds 順序（確定性）；不在 participantIds 的交卷忽略；空參賽者 → []', () => {
    const subs = new Map([
      ['x', sub(99, 1)],
      ['b', sub(40, 7)],
      ['a', sub(40, 7)],
    ]);
    expect(rankResults(['b', 'a'], subs, nick).map((r) => r.playerId)).toEqual(['b', 'a']);
    expect(rankResults([], subs, nick)).toEqual([]);
  });
});
