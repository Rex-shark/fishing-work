// 回合狀態的呈現（純邏輯，可單元測試）：回合狀態列各階段的文字、歌名字數提示、「出題」顯示條件、報讀文字。
// 文字逐列依 spec/song-guess/design.md §2「各階段對照」；規則依 overview.md 與 architecture §5。
// 出題按鈕的叫法屬於偽裝（由殼層給，ShellViews.volunteer.label），這裡以參數 shareLabel 組句，不寫死。
import { MIN_PLAYERS, type GameResultEntry, type PlayerPublic, type RoundPublic, type SongPhase } from '@fishing-work/shared/song-guess'
import { formatClock } from './countdown'

/** 歌名字數提示：`＿ ＿ ＿`（每字一個全形底線，以半形空白分隔）；0 或非法值回空字串 */
export function titleBlanks(length: number | null): string {
  if (length === null || !Number.isInteger(length) || length <= 0) return ''
  return Array.from({ length }, () => '＿').join(' ')
}

/** 在線（connected）人數；selector 用，回傳數字避免 Zustand 無限重繪 */
export function countConnected(players: readonly Pick<PlayerPublic, 'connected'>[]): number {
  return players.filter((p) => p.connected).length
}

/** 「出題」只在沒有進行中的局（idle／ended）且在線人數 ≥ MIN_PLAYERS 時可按（server 同條件，architecture §5 idle） */
export function canVolunteer(phase: SongPhase, connectedCount: number): boolean {
  return (phase === 'idle' || phase === 'ended') && connectedCount >= MIN_PLAYERS
}

/** 「出題」按鈕的無障礙名稱：以可見文字開頭（WCAG 2.5.3 label in name），再說明動作；文字由殼層決定（ShellViews.volunteer） */
export function volunteerAriaLabel(label: string): string {
  return `${label}：出題`
}

/** 本局出題者的暱稱；沒有出題者（idle）或他已不在玩家清單為 null */
export function setterNameOf(round: Pick<RoundPublic, 'setterId'>, players: readonly Pick<PlayerPublic, 'id' | 'nickname'>[]): string | null {
  if (round.setterId === null) return null
  return players.find((p) => p.id === round.setterId)?.nickname ?? null
}

/** 顯示用的歌手名：iTunes 的正式名稱（第 1 首開始才有），沒有時為出題者輸入的 */
export function artistNameOf(round: Pick<RoundPublic, 'artist' | 'artistDisplay'>): string | null {
  return round.artistDisplay ?? round.artist
}

// ─── 出題對話框的文字（features/round/ArtistDialog；design §1「出題」） ───────────────

/** 歌手欄位的名稱與提示 */
export const ARTIST_FIELD_LABEL = '歌手'
export const ARTIST_PLACEHOLDER = '輸入歌手名稱（例如：孫燕姿）'
/** 選項文字（殼層可改用自己的按鈕文字；無障礙名稱會帶上這些動作說明） */
export const ARTIST_SUBMIT_LABEL = '搜尋並開始'
/** 搜尋中（等 server 向題庫搜尋）：送出選項的文字；殼層須照樣顯示（DialogItem.pending） */
export const ARTIST_SEARCHING_LABEL = '搜尋中…'
export const ARTIST_CANCEL_LABEL = '取消出題'

// ─── 回合狀態列 ──────────────────────────────────────────────────

/** 出題者不在玩家清單時句子裡的稱呼 */
export const SETTER_FALLBACK = '出題者'

/** 本局第一名（results 依 rank 升冪；保險起見自己找 rank 最小的）；沒有結果為 null */
export function winnerOf(results: readonly GameResultEntry[] | null): GameResultEntry | null {
  if (results === null || results.length === 0) return null
  return results.reduce((best, r) => (r.rank < best.rank ? r : best))
}

export interface CaptionInput {
  round: Pick<RoundPublic, 'phase' | 'song' | 'songCount' | 'results'>
  /** 自己是出題者 */
  isSetter: boolean
  /** 出題者暱稱（setterNameOf） */
  setterName: string | null
  /** 自己本首已猜對 */
  hasGuessed: boolean
  /** 自己本首得分（基準不明為 null） */
  gain: number | null
  /** 這個階段的剩餘秒數（countdown.roundRemainingSeconds；沒有倒數為 null） */
  remaining: number | null
  /** 出題按鈕的可見文字（殼層給） */
  shareLabel: string
}

/** 回合狀態列的一行字，拆成兩段：head 太長時可以截斷，tail（字數與倒數）一定要看得到 */
export interface Caption {
  head: string
  tail: string
}

/** 「 · 00:21」；沒有倒數時為空字串 */
function clockTail(remaining: number | null): string {
  return remaining === null ? '' : ` · ${formatClock(remaining)}`
}

/**
 * 回合狀態列各階段的文字（design §2「各階段對照」的第三欄，逐列）：
 *   idle        按「<出題>」出題（需 2 人以上）
 *   choosing    自己：正在出題 · 00:52；其他人：等待 <出題者> 出題 · 00:52
 *   playing     歌名 ＿ ＿ ＿（3 字） · 00:21；自己已猜對：你猜對了 +87 · 00:21
 *   reveal      下一首 00:04；最後一首：本局結束
 *   ended       本局第一名：X（n 分）
 */
export function roundCaption(input: CaptionInput): Caption {
  const { round, isSetter, setterName, hasGuessed, gain, remaining, shareLabel } = input
  switch (round.phase) {
    case 'idle':
      return { head: `按「${shareLabel}」出題（需 ${MIN_PLAYERS} 人以上）`, tail: '' }
    case 'choosing':
      return { head: isSetter ? '正在出題' : `等待 ${setterName ?? SETTER_FALLBACK} 出題`, tail: clockTail(remaining) }
    case 'playing': {
      if (hasGuessed) return { head: gain !== null ? `你猜對了 +${gain}` : '你猜對了', tail: clockTail(remaining) }
      const length = round.song?.titleLength ?? null
      const blanks = titleBlanks(length)
      if (blanks === '') return { head: '歌名', tail: clockTail(remaining) }
      return { head: `歌名 ${blanks}`, tail: `（${length} 字）${clockTail(remaining)}` }
    }
    case 'reveal': {
      const last = round.song !== null && round.song.index >= round.songCount
      if (last) return { head: '本局結束', tail: '' }
      return { head: '下一首', tail: remaining === null ? '' : ` ${formatClock(remaining)}` }
    }
    case 'ended': {
      const winner = winnerOf(round.results)
      return { head: winner === null ? '本局結束' : `本局第一名：${winner.nickname}（${winner.gameScore} 分）`, tail: '' }
    }
  }
}

/** 整行文字（head ＋ tail） */
export function captionText(input: CaptionInput): string {
  const { head, tail } = roundCaption(input)
  return head + tail
}

export interface AnnouncementInput {
  round: Pick<RoundPublic, 'phase' | 'song' | 'songCount' | 'reveal' | 'results'>
  isSetter: boolean
  setterName: string | null
  hasGuessed: boolean
  gain: number | null
}

/**
 * 給輔助技術朗讀的狀態變化（design §4：第 n 首開始、猜對、揭曉歌名）；不含倒數（每秒變動的文字不放進 live region）。
 * 文字改變時才會被朗讀一次；idle 為空字串
 */
export function roundAnnouncement(input: AnnouncementInput): string {
  const { round, isSetter, setterName, hasGuessed, gain } = input
  switch (round.phase) {
    case 'idle':
      return ''
    case 'choosing':
      return isSetter ? '請輸入歌手名稱' : `${setterName ?? SETTER_FALLBACK} 正在出題`
    case 'playing': {
      if (round.song === null) return ''
      if (hasGuessed) return gain !== null ? `你猜對了，得 ${gain} 分` : '你猜對了'
      return `第 ${round.song.index} 首開始，歌名 ${round.song.titleLength} 個字`
    }
    case 'reveal': {
      if (round.reveal === null) return ''
      const { index, title, artist, scores } = round.reveal
      return `第 ${index} 首：《${title}》，${artist}，${scores.length === 0 ? '沒有人猜對' : `${scores.length} 人猜對`}`
    }
    case 'ended': {
      const winner = winnerOf(round.results)
      return winner === null ? '本局結束' : `本局結束，第一名：${winner.nickname}（${winner.gameScore} 分）`
    }
  }
}
