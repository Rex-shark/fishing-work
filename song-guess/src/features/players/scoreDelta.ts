// 本首得分（純顯示用；分數一律以 server 的 players:update 為準，這裡只做前後差）。
// server 不會單獨告訴本人「這首得幾分」（揭曉時才有 reveal.scores）；播放中自己猜對時的「+N」由本局得分（gameScore）的差值推得：
//   每首開始時記下自己的 gameScore 當基準，之後 gameScore − 基準 就是本首得分。
// 基準不明（中途加入或接管時已經猜對、漏收那一首的開始）時不顯示差值。
import type { PlayerPublic, RoundPublic, SongReveal } from '@fishing-work/shared/song-guess'

/** 某一首開始時自己的本局得分 */
export interface GainBase {
  /** 哪一首（songId：局號＋第幾首） */
  key: string
  /** 該首開始時自己的 gameScore */
  base: number
}

type RoundRef = Pick<RoundPublic, 'gameNo' | 'phase' | 'song'>
type ScorePlayer = Pick<PlayerPublic, 'id' | 'gameScore' | 'hasGuessed'>

/** 目前這一首的識別（playing 與它的 reveal 是同一首）；沒有歌時為 null */
export function songId(round: Pick<RoundPublic, 'gameNo' | 'song'>): string | null {
  return round.song === null ? null : `${round.gameNo}:${round.song.index}`
}

/**
 * 收到 round:update 時的基準：同一首沿用；換了一首（playing）就重新記。
 * 第 1 首的基準固定為 0（新局開始時 gameScore 歸零；players:update 可能比 round:update 晚到，不讀可能還是上一局的值）；
 * 第 2 首以後讀自己此刻的 gameScore（揭曉期間分數不會變，與事件先後無關）。
 * 沒有歌、直接收到別首的 reveal、自己已在猜對名單、找不到自己：基準不明（null）
 */
export function gainBaseOnRound(prev: GainBase | null, round: RoundRef, players: readonly ScorePlayer[], me: string | null): GainBase | null {
  const key = songId(round)
  if (key === null || round.song === null) return null
  if (prev !== null && prev.key === key) return prev
  if (round.phase !== 'playing' || me === null || round.song.correctIds.includes(me)) return null
  if (round.song.index === 1) return { key, base: 0 }
  const mine = players.find((p) => p.id === me)
  return mine === undefined ? null : { key, base: mine.gameScore }
}

/**
 * 快照（加入／重連接管）時的基準：同一個人回到同一首就沿用原本的（斷線重連不丟）；
 * 否則只有「播放中且自己還沒猜對」推得出來（此刻的 gameScore 就是基準）；已猜對的話分數已含本首所得，基準不明
 */
export function gainBaseFromSnapshot(
  prev: GainBase | null,
  samePlayer: boolean,
  round: RoundRef,
  players: readonly ScorePlayer[],
  me: string,
): GainBase | null {
  const key = songId(round)
  if (key === null || round.song === null) return null
  if (samePlayer && prev !== null && prev.key === key) return prev
  if (round.phase !== 'playing') return null
  const mine = players.find((p) => p.id === me)
  if (mine === undefined || mine.hasGuessed || round.song.correctIds.includes(me)) return null
  return { key, base: mine.gameScore }
}

/** 本首得分（> 0 才回傳）；基準不明、不是同一首或沒加分時回 null */
export function songGain(base: GainBase | null, round: Pick<RoundPublic, 'gameNo' | 'song'>, player: Pick<PlayerPublic, 'gameScore'> | undefined): number | null {
  if (base === null || player === undefined || songId(round) !== base.key) return null
  const gain = player.gameScore - base.base
  return gain > 0 ? gain : null
}

/** 揭曉資料裡某位玩家的本首得分；沒猜對（不在 scores）或沒有揭曉資料為 null */
export function revealScoreOf(reveal: Pick<SongReveal, 'scores'> | null, playerId: string | null): number | null {
  if (reveal === null || playerId === null) return null
  return reveal.scores.find((s) => s.playerId === playerId)?.score ?? null
}
