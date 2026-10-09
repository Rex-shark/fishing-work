// 排名與總分（純函式）：spec/draw-contest/architecture.md §5.2
// - 交卷者依 score 降冪、同分依 submittedAt 升冪；rank 從 1 起，同分不並列（先交卷者在前）。
// - 未交卷的參賽者接在後面：score 0、confidence null、judgedBy null、rank 接續；彼此依 participantIds 順序。
// - 每位參賽者 player.score += entry.score（由 room.ts 結算時累加）。
import type { JudgeMode, ResultEntry } from '@fishing-work/shared/draw-contest';

/** 已評分的交卷 */
export interface JudgedSubmission {
  submittedAt: number;
  score: number;
  confidence: number;
  judgedBy: JudgeMode;
}

/**
 * 計算本回合的 results（依 rank 升冪）。
 * participantIds：當下的參賽者（drawing 開始時的加入順序；離開者已移除）；
 * submissions：參賽者 id → 已評分的交卷（不在 participantIds 裡的會被忽略）；
 * nicknameOf：取暱稱。
 */
export function rankResults(
  participantIds: readonly string[],
  submissions: ReadonlyMap<string, JudgedSubmission>,
  nicknameOf: (playerId: string) => string,
): ResultEntry[] {
  const submitted: { playerId: string; order: number; s: JudgedSubmission }[] = [];
  const missing: string[] = [];
  participantIds.forEach((playerId, order) => {
    const s = submissions.get(playerId);
    if (s === undefined) missing.push(playerId);
    else submitted.push({ playerId, order, s });
  });
  // 同分同時間（理論上罕見）再依 participantIds 順序，確保結果確定
  submitted.sort((a, b) => b.s.score - a.s.score || a.s.submittedAt - b.s.submittedAt || a.order - b.order);

  const results: ResultEntry[] = submitted.map(({ playerId, s }, i) => ({
    playerId,
    nickname: nicknameOf(playerId),
    rank: i + 1,
    score: s.score,
    confidence: s.confidence,
    judgedBy: s.judgedBy,
    submitted: true,
    submittedAt: s.submittedAt,
  }));
  for (const playerId of missing) {
    results.push({
      playerId,
      nickname: nicknameOf(playerId),
      rank: results.length + 1,
      score: 0,
      confidence: null,
      judgedBy: null,
      submitted: false,
      submittedAt: null,
    });
  }
  return results;
}

