// 排名與總分（純函式）：spec/draw-contest/architecture.md §5.2
// - 交卷者依 score 降冪、同分依 submittedAt 升冪；rank 從 1 起，同分不並列（先交卷者在前）。
// - 未交卷的參賽者接在後面：score 0、confidence null、judgedBy null、rank 接續；彼此依 participantIds 順序。
// - 每位參賽者 player.score += entry.score（由 room.ts 結算時累加）。
// - 評語（Epic 15，§5「評語」）：交卷者照 room.ts 給的 comment／commentPending 原樣帶出；未交卷者 null／false。
import type { JudgeMode, ResultEntry } from '@fishing-work/shared/draw-contest';

/** 已評分的交卷 */
export interface JudgedSubmission {
  submittedAt: number;
  score: number;
  confidence: number;
  judgedBy: JudgeMode;
  /** 揭曉當下已產生的評語；關閉、失敗、跳過或尚未產生為 null */
  comment: string | null;
  /** true = 評語還在產生中（之後由 contest:comment 補上） */
  commentPending: boolean;
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
    comment: s.comment,
    commentPending: s.commentPending,
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
      comment: null,
      commentPending: false,
    });
  }
  return results;
}

