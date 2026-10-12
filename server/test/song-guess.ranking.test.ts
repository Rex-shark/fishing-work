// 猜歌本局排名：spec/song-guess/architecture.md §5.1
import { describe, expect, it } from 'vitest';
import { rankGame, type GameStat } from '../src/games/song-guess/ranking';

const nick = (id: string) => `N-${id}`;
const stat = (gameScore: number, correctCount: number, lastScoreAt: number | null): GameStat => ({ gameScore, correctCount, lastScoreAt });

describe('rankGame', () => {
  it('依 gameScore 降冪；rank 從 1 起連號；帶暱稱與 correctCount', () => {
    const stats = new Map([
      ['a', stat(150, 2, 2000)],
      ['b', stat(320, 4, 5000)],
      ['c', stat(90, 1, 1000)],
    ]);
    expect(rankGame(['a', 'b', 'c'], stats, nick)).toEqual([
      { playerId: 'b', nickname: 'N-b', rank: 1, gameScore: 320, correctCount: 4 },
      { playerId: 'a', nickname: 'N-a', rank: 2, gameScore: 150, correctCount: 2 },
      { playerId: 'c', nickname: 'N-c', rank: 3, gameScore: 90, correctCount: 1 },
    ]);
  });

  it('同分：先達到該分數者（最後一次得分時間較早）在前；rank 不並列', () => {
    const stats = new Map([
      ['a', stat(200, 2, 9000)],
      ['b', stat(200, 3, 4000)],
      ['c', stat(200, 2, 6000)],
    ]);
    const results = rankGame(['a', 'b', 'c'], stats, nick);
    expect(results.map((r) => r.playerId)).toEqual(['b', 'c', 'a']);
    expect(results.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('同分同時間：依 participantIds 順序（結果確定）', () => {
    const stats = new Map([
      ['a', stat(100, 1, 5000)],
      ['b', stat(100, 1, 5000)],
    ]);
    expect(rankGame(['b', 'a'], stats, nick).map((r) => r.playerId)).toEqual(['b', 'a']);
  });

  it('本局 0 分者彼此依 participantIds 順序，排在有得分者之後', () => {
    const stats = new Map([
      ['a', stat(0, 0, null)],
      ['b', stat(0, 0, null)],
      ['c', stat(50, 1, 3000)],
      ['d', stat(0, 0, null)],
    ]);
    expect(rankGame(['d', 'a', 'c', 'b'], stats, nick)).toEqual([
      { playerId: 'c', nickname: 'N-c', rank: 1, gameScore: 50, correctCount: 1 },
      { playerId: 'd', nickname: 'N-d', rank: 2, gameScore: 0, correctCount: 0 },
      { playerId: 'a', nickname: 'N-a', rank: 3, gameScore: 0, correctCount: 0 },
      { playerId: 'b', nickname: 'N-b', rank: 4, gameScore: 0, correctCount: 0 },
    ]);
  });

  it('對象＝參賽者 ∪ 本局有得分者：中途加入者有得分才列入，沒得分不列入', () => {
    const stats = new Map([
      ['a', stat(60, 1, 2000)],
      ['b', stat(0, 0, null)],
      ['late1', stat(180, 2, 8000)],
      ['late2', stat(0, 0, null)],
    ]);
    const results = rankGame(['a', 'b'], stats, nick);
    expect(results.map((r) => [r.playerId, r.rank, r.gameScore])).toEqual([
      ['late1', 1, 180],
      ['a', 2, 60],
      ['b', 3, 0],
    ]);
  });

  it('中途加入者與參賽者同分同時間：參賽者在前', () => {
    const stats = new Map([
      ['late', stat(100, 1, 5000)],
      ['a', stat(100, 1, 5000)],
    ]);
    expect(rankGame(['a'], stats, nick).map((r) => r.playerId)).toEqual(['a', 'late']);
  });

  it('不在 stats 裡的參賽者（不該發生）視為 0 分；stats 裡沒有的人不會憑空出現', () => {
    const results = rankGame(['a', 'ghost'], new Map([['a', stat(70, 1, 1000)]]), nick);
    expect(results).toEqual([
      { playerId: 'a', nickname: 'N-a', rank: 1, gameScore: 70, correctCount: 1 },
      { playerId: 'ghost', nickname: 'N-ghost', rank: 2, gameScore: 0, correctCount: 0 },
    ]);
  });

  it('沒有參賽者也沒人得分 → 空陣列', () => {
    expect(rankGame([], new Map([['x', stat(0, 0, null)]]), nick)).toEqual([]);
    expect(rankGame([], new Map(), nick)).toEqual([]);
  });

  it('participantIds 重複的 id 只列一次', () => {
    expect(rankGame(['a', 'a'], new Map([['a', stat(0, 0, null)]]), nick)).toHaveLength(1);
  });
});
