// 回合狀態的呈現（純邏輯，可單元測試）：階段文字、「我出題」顯示條件、交卷與評分進度、揭曉摘要、回合狀態列各階段的文字（roundNotes）。
// 規則依 spec/draw-contest/overview.md 與 architecture §5；文案以 design.md §2 各階段對照表為準。狀態列色調屬殼層。
// 與偽裝有關的名詞（題目、交卷的叫法）由殼層的 ShellViews.terms 傳入（RoundTerms），本檔不寫死。
import { MIN_PLAYERS, type ContestPhase, type PlayerPublic, type ResultEntry, type RoundPublic } from '@fishing-work/shared/draw-contest'

export const PHASE_LABEL: Record<ContestPhase, string> = {
  idle: '等待中',
  choosing: '出題中',
  drawing: '作畫中',
  judging: '評分中',
  ended: '揭曉',
}

/** 倒數最後幾秒改警示（DESIGN §7：不閃爍） */
export const WARNING_SECONDS = 10

export function isCountdownWarning(remaining: number | null): boolean {
  return remaining !== null && remaining <= WARNING_SECONDS
}

/** 在線（connected）人數；selector 用，回傳數字避免 Zustand 無限重繪 */
export function countConnected(players: readonly Pick<PlayerPublic, 'connected'>[]): number {
  return players.filter((p) => p.connected).length
}

/** 「我出題」只在 idle／ended（視同 idle）且在線人數 ≥ MIN_PLAYERS 時顯示（server 同條件，architecture §5 round:volunteer） */
export function canVolunteer(phase: ContestPhase, connectedCount: number): boolean {
  return (phase === 'idle' || phase === 'ended') && connectedCount >= MIN_PLAYERS
}

/** 「我出題」按鈕的無障礙名稱：以可見文字開頭（WCAG 2.5.3 label in name），再說明動作；文字由殼層決定（ShellViews.volunteer） */
export function volunteerAriaLabel(label: string): string {
  return `${label}：我出題`
}

/** 與偽裝有關的名詞（ShellViews.terms 的子集）：ppt 題目＝「標題」、交卷＝「儲存」 */
export interface RoundTerms {
  topic: string
  save: string
}

/** 交卷進度「已儲存 n/m」（m＝本回合參賽者數；「儲存」為殼層的叫法） */
export function submittedProgress(round: Pick<RoundPublic, 'submittedCount' | 'participantIds'>, terms: Pick<RoundTerms, 'save'>): string {
  return `已${terms.save} ${round.submittedCount}/${round.participantIds.length}`
}

/** 評分進度「正在評分 n/m…」（m＝已交卷數）；隨機評分時加「（隨機評分）」 */
export function judgingProgress(round: Pick<RoundPublic, 'judgedCount' | 'submittedCount' | 'judgeMode'>): string {
  const suffix = round.judgeMode === 'random' ? '（隨機評分）' : ''
  return `正在評分 ${round.judgedCount}/${round.submittedCount}…${suffix}`
}

/** 揭曉摘要「第一名：X（87 分）」；沒有人交卷時「沒有人交卷」；隨機評分時加「（隨機評分）」 */
export function winnerSummary(results: readonly ResultEntry[]): string {
  const first = results.find((r) => r.submitted)
  if (first === undefined) return '沒有人交卷'
  const suffix = first.judgedBy === 'random' ? '（隨機評分）' : ''
  return `第一名：${first.nickname}（${first.score} 分）${suffix}`
}

/** 自己在揭曉結果中的那一筆；不在結果裡（旁觀者）為 undefined */
export function myResult(results: readonly ResultEntry[] | null, me: string | null): ResultEntry | undefined {
  if (results === null || me === null) return undefined
  return results.find((r) => r.playerId === me)
}

/** 題目與第一名之間的全形空白（U+3000；寫成跳脫避免原始碼出現不可見字元） */
const WIDE_GAP = '\u3000'

/**
 * 揭曉的結果摘要（ended 的回合狀態列；design §2，2026-10-12 起帶題目：揭曉當下要對照題目看畫）：
 * 「蘋果（全形空白）第一名：X（87 分）」（隨機評分加「（隨機評分）」；沒有人交卷「蘋果（全形空白）沒有人交卷」）。
 * 題目用 results 對應的 lastTopic（ended 時已有）；沒有題目（理論上不會）退回只有第一名的那一句
 */
export function resultSummary(round: { results: readonly ResultEntry[]; lastTopic: string | null }): string {
  const winner = winnerSummary(round.results)
  return round.lastTopic !== null ? `${round.lastTopic}${WIDE_GAP}${winner}` : winner
}

/**
 * 上一回合摘要（idle 與 choosing 的回合狀態列；results 與 lastTopic 保留到下一回合 drawing 開始）：
 * 沒有結果「上一回合：—」；有題目＝「上一回合：」＋揭曉的結果摘要（resultSummary，與 ended 那一列只差這個前綴）；
 * 沒有題目（理論上不會）退回 design 原文「上一回合第一名：X（87 分）」
 */
export function lastRoundSummary(round: Pick<RoundPublic, 'results' | 'lastTopic'>): string {
  if (round.results === null) return '上一回合：—'
  const { results, lastTopic } = round
  return lastTopic !== null ? `上一回合：${resultSummary({ results, lastTopic })}` : `上一回合${winnerSummary(results)}`
}

/** 回合狀態列的一段：文字＋（選填）倒數；optional＝窄螢幕（< 768px）可省略 */
export interface NotesSegment {
  text: string
  /** 緊接在文字後的倒數 mm:ss */
  clock?: { text: string; warning: boolean; seconds: number }
  optional?: boolean
}

export interface NotesInput {
  round: Pick<RoundPublic, 'phase' | 'topic' | 'submittedCount' | 'participantIds' | 'judgedCount' | 'judgeMode' | 'results' | 'lastTopic'>
  isSetter: boolean
  isParticipant: boolean
  /** 出題者暱稱（找不到為 null） */
  setterName: string | null
  /** 倒數剩餘秒數（choosing／drawing；其餘 null） */
  remaining: number | null
}

/** mm:ss（與 countdown.formatClock 相同；這裡不 import hook 檔，保持純邏輯） */
function clock(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return { text: `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`, warning: isCountdownWarning(seconds), seconds }
}

/**
 * 回合狀態列各階段的文字（design §2）：
 * - idle：「上一回合：—」／「上一回合：蘋果（全形空白）第一名：X（87 分）（隨機評分）」
 * - choosing：出題者「正在輸入標題… 00:45」、其他人「X 正在輸入標題… 00:45」；有上一回合結果時接在後面（窄螢幕省略）
 * - drawing：「作畫中 01:23」「標題：蘋果」「已儲存 3/8」；旁觀者把題目那段換成「本回合旁觀：蘋果」；最後 10 秒倒數為警示
 * - judging：「正在評分 5/8…」（隨機評分加「（隨機評分）」）
 * - ended：「蘋果（全形空白）第一名：X（87 分）」（與 idle 有結果那一列相同，只少「上一回合：」前綴；隨機評分加註；沒有人交卷時「蘋果（全形空白）沒有人交卷」）
 */
export function roundNotes(input: NotesInput, terms: RoundTerms): NotesSegment[] {
  const { round, isSetter, isParticipant, setterName, remaining } = input
  const timer = remaining !== null ? { clock: clock(remaining) } : {}
  switch (round.phase) {
    case 'idle':
      return [{ text: lastRoundSummary(round) }]
    case 'choosing': {
      const who = isSetter ? '' : `${setterName ?? '出題者'} `
      const segments: NotesSegment[] = [{ text: `${who}正在輸入${terms.topic}…`, ...timer }]
      if (round.results !== null) segments.push({ text: lastRoundSummary(round), optional: true })
      return segments
    }
    case 'drawing': {
      const topic = round.topic ?? '—'
      return [
        { text: PHASE_LABEL.drawing, ...timer },
        { text: isParticipant ? `${terms.topic}：${topic}` : `本回合旁觀：${topic}` },
        { text: submittedProgress(round, terms) },
      ]
    }
    case 'judging':
      return [{ text: judgingProgress(round) }]
    case 'ended':
      return [{ text: round.results !== null ? resultSummary({ results: round.results, lastTopic: round.lastTopic }) : '—' }]
  }
}

/** 回合狀態列的純文字（測試與無障礙用）：段落以兩個空白相接、倒數接在文字後一個空白 */
export function notesText(segments: readonly NotesSegment[]): string {
  return segments.map((s) => (s.clock !== undefined ? `${s.text} ${s.clock.text}` : s.text)).join('  ')
}
