// 每首揭曉卡與本局排名表的資料（純函式，可單元測試；spec/song-guess/design.md §1「每首揭曉」「本局排名」）。
// 元件（RevealCard、GameRanking）只負責排版；封面網址、猜對者列、排名列與標題都在這裡算。
import type { GameResultEntry, PlayerPublic, RoundPublic, SongReveal } from '@fishing-work/shared/song-guess'

/** 舞台此刻顯示什麼（design §2「舞台」欄） */
export type StageMode = 'empty' | 'results' | 'preparing' | 'playing' | 'reveal'

/**
 * idle：有上一局結果 → 排名表，否則空；choosing → 出題者準備中；playing → 播放中的視覺；
 * reveal → 揭曉卡；ended → 本局排名表。資料不齊（playing 沒有 song、reveal 沒有揭曉資料、結果是空的）時退回空畫面
 */
export function stageMode(round: Pick<RoundPublic, 'phase' | 'song' | 'reveal' | 'results'>): StageMode {
  const hasResults = round.results !== null && round.results.length > 0
  switch (round.phase) {
    case 'idle':
    case 'ended':
      return hasResults ? 'results' : 'empty'
    case 'choosing':
      return 'preparing'
    case 'playing':
      return round.song !== null ? 'playing' : 'empty'
    case 'reveal':
      return round.reveal !== null ? 'reveal' : 'empty'
  }
}

/** 舞台正在顯示「上一局」的排名（idle 且有結果；ended 顯示的是本局） */
export function showsLastResults(round: Pick<RoundPublic, 'phase' | 'song' | 'reveal' | 'results'>): boolean {
  return round.phase === 'idle' && stageMode(round) === 'results'
}

// ─── 每首揭曉卡 ──────────────────────────────────────────────────

/** 封面顯示邊長（px；Apple 給 100px 版，換成 300px 版讓 120px 的封面在高解析螢幕也清楚） */
export const ARTWORK_SIZE = 300

/**
 * Apple 專輯封面網址的 300px 版：把檔名裡的 `100x100`（如 `…/100x100bb.jpg`）換成 `300x300`（events.ts SongReveal.artworkUrl 的說明）。
 * 找不到這個樣式就原樣回傳；null 或空字串回 null（卡片改顯示佔位）
 */
export function artworkUrlAt(url: string | null, size: number = ARTWORK_SIZE): string | null {
  if (url === null || url.trim() === '') return null
  const at = url.lastIndexOf('100x100')
  return at === -1 ? url : `${url.slice(0, at)}${size}x${size}${url.slice(at + '100x100'.length)}`
}

/** 已離開房間的玩家在列表上的稱呼（揭曉資料只帶 playerId） */
export const LEFT_PLAYER_NAME = '（已離開）'
/** 沒有人猜對這一首 */
export const NO_ONE_GUESSED = '沒有人猜對'

export interface RevealScoreRow {
  playerId: string
  nickname: string
  score: number
  isMe: boolean
}

/** 本首猜對者列（依猜對順序＝reveal.scores 的順序）；暱稱由玩家清單對出來 */
export function revealScoreRows(
  reveal: Pick<SongReveal, 'scores'>,
  players: readonly Pick<PlayerPublic, 'id' | 'nickname'>[],
  me: string | null,
): RevealScoreRow[] {
  return reveal.scores.map(({ playerId, score }) => ({
    playerId,
    nickname: players.find((p) => p.id === playerId)?.nickname ?? LEFT_PLAYER_NAME,
    score,
    isMe: playerId === me,
  }))
}

/** 揭曉卡封面的替代文字：有專輯名用專輯名，否則用歌名 */
export function artworkAlt(reveal: Pick<SongReveal, 'title' | 'album'>): string {
  return `《${reveal.album ?? reveal.title}》專輯封面`
}

// ─── 本局排名表 ──────────────────────────────────────────────────

/** 排名表標題：「本局結果 · 孫燕姿」；沒有歌手名時只有「本局結果」 */
export function rankingTitle(artist: string | null): string {
  return artist !== null && artist !== '' ? `本局結果 · ${artist}` : '本局結果'
}

/** 前幾名加強調色（design §1：前三名） */
export const TOP_RANKS = 3

export interface RankingRow {
  playerId: string
  rank: number
  nickname: string
  gameScore: number
  correctCount: number
  isTop: boolean
  isMe: boolean
}

/** 排名表的列（依 rank 升冪；server 已排好，這裡再排一次保險） */
export function rankingRows(results: readonly GameResultEntry[], me: string | null): RankingRow[] {
  return [...results]
    .sort((a, b) => a.rank - b.rank)
    .map((r) => ({
      playerId: r.playerId,
      rank: r.rank,
      nickname: r.nickname,
      gameScore: r.gameScore,
      correctCount: r.correctCount,
      isTop: r.rank <= TOP_RANKS,
      isMe: r.playerId === me,
    }))
}
