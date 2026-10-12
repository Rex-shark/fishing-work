// 本局排名（純函式）：spec/song-guess/architecture.md §5.1
// - 對象：participantIds ∪ 本局有得分者（中途加入者有猜對才列入）。局中離開者已不在 stats 裡，不會出現。
// - 依 gameScore 降冪；同分者依「先達到該分數的時間」在前（每位玩家最後一次得分的時間）；
//   本局 0 分者彼此依 participantIds 順序；rank 從 1 起連號（同分不並列）。
// - correctCount＝本局猜對首數。
import type { GameResultEntry } from '@fishing-work/shared/song-guess';

/** 一位玩家的本局統計（room.ts 維護） */
export interface GameStat {
  gameScore: number;
  correctCount: number;
  /** 最後一次得分的時間（epoch ms）；本局沒得分為 null */
  lastScoreAt: number | null;
}

/**
 * 計算本局的 results（依 rank 升冪）。
 * participantIds：當下的參賽者（搜尋成功時的在線者，依加入順序；離開者已移除）；
 * stats：在房玩家 id → 本局統計（依加入順序插入；不在裡面的 participantId 視為 0 分）；
 * nicknameOf：取暱稱。
 */
export function rankGame(
  participantIds: readonly string[],
  stats: ReadonlyMap<string, GameStat>,
  nicknameOf: (playerId: string) => string,
): GameResultEntry[] {
  const rows: { playerId: string; order: number; stat: GameStat }[] = [];
  const seen = new Set<string>();
  for (const playerId of participantIds) {
    if (seen.has(playerId)) continue;
    seen.add(playerId);
    rows.push({ playerId, order: rows.length, stat: stats.get(playerId) ?? { gameScore: 0, correctCount: 0, lastScoreAt: null } });
  }
  // 非參賽者（中途加入）：有得分才列入，接在參賽者之後（只影響同分同時間的先後）
  for (const [playerId, stat] of stats) {
    if (seen.has(playerId) || stat.gameScore <= 0) continue;
    seen.add(playerId);
    rows.push({ playerId, order: rows.length, stat });
  }

  rows.sort((a, b) => {
    if (a.stat.gameScore !== b.stat.gameScore) return b.stat.gameScore - a.stat.gameScore;
    const atA = a.stat.lastScoreAt;
    const atB = b.stat.lastScoreAt;
    if (atA !== null && atB !== null && atA !== atB) return atA - atB;
    // 0 分者（沒有得分時間）彼此依 participantIds 順序；同分同時間也以此確保結果確定
    return a.order - b.order;
  });

  return rows.map(({ playerId, stat }, i) => ({
    playerId,
    nickname: nicknameOf(playerId),
    rank: i + 1,
    gameScore: stat.gameScore,
    correctCount: stat.correctCount,
  }));
}
