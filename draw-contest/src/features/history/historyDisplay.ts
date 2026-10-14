// 比賽歷史的呈現（Epic 17；純邏輯，可單元測試；spec/draw-contest/design.md §2「歷史檢視」列、§3.1）：
// 何時可以開、清單列文字、回合狀態列文字、存檔 → 揭曉畫廊的卡片（重用 reveal/revealView）。
// 與偽裝有關的名詞（入口與檢視的叫法、交卷的叫法）由殼層的 ShellViews.terms 傳入，本檔不寫死。
import type { ContestPhase, ResultEntry } from '@fishing-work/shared/draw-contest'
import { revealCards, type RevealCard } from '../reveal/revealView'
import { winnerSummary } from '../round/roundDisplay'
import { HISTORY_MAX, type HistoryRecord } from './historyDb'

/**
 * 可以開啟（與繼續看）歷史的時機（plan 決策 7、7a 的白名單）：已加入，且 idle／ended，或 choosing 而自己不是出題者。
 * drawing、judging、自己正在出題都不行：這時開著的也要關掉（historyStore 的自動關閉用同一個判斷）
 */
export function canViewHistory(view: { joined: boolean; phase: ContestPhase; isSetter: boolean }): boolean {
  if (!view.joined) return false
  return view.phase === 'idle' || view.phase === 'ended' || (view.phase === 'choosing' && !view.isSetter)
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** 建檔時間「月/日 時:分」（本機時區；月、日不補零，時、分補零，例如 10/12 14:03、1/5 09:07） */
export function formatSavedAt(savedAt: number): string {
  const d = new Date(savedAt)
  return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** 第一名：results 裡名次最前面的交卷者（存檔一定至少一人交卷；找不到為 undefined） */
function winner(results: readonly ResultEntry[]): ResultEntry | undefined {
  return [...results].sort((a, b) => a.rank - b.rank).find((r) => r.submitted)
}

/** 清單的一列（殼層照 label 顯示，點選時以 id 開啟） */
export interface HistoryMenuEntry {
  id: number
  label: string
}

/** 清單列文字（design §3.1）：「蘋果 — 10/12 14:03 — 第一名 Alice（87 分）」 */
export function historyRowLabel(record: Pick<HistoryRecord, 'topic' | 'savedAt' | 'results'>): string {
  const first = winner(record.results)
  const who = first !== undefined ? `第一名 ${first.nickname}（${first.score} 分）` : '沒有人交卷'
  return `${record.topic} — ${formatSavedAt(record.savedAt)} — ${who}`
}

/** 清單資料：最新在上、最多 HISTORY_MAX 列（records 已依 savedAt 降冪） */
export function historyMenuEntries(records: readonly HistoryRecord[]): HistoryMenuEntry[] {
  return records.slice(0, HISTORY_MAX).map((r) => ({ id: r.id, label: historyRowLabel(r) }))
}

/** 題目與第一名之間的全形空白（U+3000；與 roundDisplay 的結果摘要相同） */
const WIDE_GAP = '　'

/**
 * 檢視時的回合狀態列文字（design §2「歷史檢視」列）：
 * 「<歷史的叫法>：蘋果（10/12 14:03）（全形空白）第一名：X（87 分）」；存檔為隨機評分時加「（隨機評分）」（winnerSummary）
 */
export function historyNotes(record: Pick<HistoryRecord, 'topic' | 'savedAt' | 'results'>, terms: { recent: string }): string {
  return `${terms.recent}：${record.topic}（${formatSavedAt(record.savedAt)}）${WIDE_GAP}${winnerSummary(record.results)}`
}

/**
 * 存檔 → 揭曉畫廊的卡片（design §3.1）：排序、名次、分數、評語都照 §3；「你」看存檔的 me。
 * 存檔沒有「產生中」的評語（commentPending 一律當 false：沒等到的評語就是沒有那一行）；
 * 交卷了但沒存到圖的卡片是空白，不顯示「載入中」（那張圖不會再來）
 */
export function historyCards(
  record: Pick<HistoryRecord, 'results' | 'me'>,
  urls: ReadonlyMap<string, string>,
  terms: { save: string },
): RevealCard[] {
  const results = record.results.map((r) => (r.commentPending ? { ...r, commentPending: false } : r))
  return revealCards(results, urls, record.me, terms).map((card) => (card.image.kind === 'loading' ? { ...card, image: { kind: 'blank' } } : card))
}
