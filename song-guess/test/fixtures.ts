// 測試共用的假資料（契約型別見 shared/src/song-guess/events.ts）
import type { GameResultEntry, PlayerPublic, RoundPublic, SongPublic, SongReveal } from '@fishing-work/shared/song-guess'

export function player(id: string, over: Partial<PlayerPublic> = {}): PlayerPublic {
  return { id, nickname: id, score: 0, gameScore: 0, isSetter: false, hasGuessed: false, connected: true, joinedAt: 0, ...over }
}

/** 第 index 首：startedAt 起播、長 durationMs */
export function song(over: Partial<SongPublic> = {}): SongPublic {
  const startedAt = over.startedAt ?? 100_000
  const durationMs = over.durationMs ?? 30_000
  return {
    index: 1,
    previewUrl: 'https://audio.example/preview-1.m4a',
    startedAt,
    durationMs,
    endsAt: startedAt + durationMs,
    titleLength: 3,
    correctIds: [],
    ...over,
  }
}

export function reveal(over: Partial<SongReveal> = {}): SongReveal {
  return {
    index: 1,
    title: '如果可以 (電影"月老"主題曲)',
    artist: '韋禮安',
    album: '如果可以 - Single',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/aa/bb/cc/cover.jpg/100x100bb.jpg',
    itunesUrl: 'https://music.apple.com/tw/album/1',
    scores: [],
    ...over,
  }
}

export function result(playerId: string, rank: number, gameScore: number, correctCount: number, nickname: string = playerId): GameResultEntry {
  return { playerId, nickname, rank, gameScore, correctCount }
}

export function round(over: Partial<RoundPublic> = {}): RoundPublic {
  return {
    gameNo: 1,
    phase: 'idle',
    setterId: null,
    artist: null,
    artistDisplay: null,
    songCount: 5,
    endsAt: null,
    song: null,
    reveal: null,
    results: null,
    lastArtist: null,
    serverNow: 0,
    participantIds: [],
    ...over,
  }
}

/** 第 index 首播放中的局 */
export function playingRound(over: Partial<RoundPublic> = {}, songOver: Partial<SongPublic> = {}): RoundPublic {
  const s = song(songOver)
  return round({ phase: 'playing', setterId: 'p1', artist: '孫燕姿', artistDisplay: '孫燕姿', song: s, endsAt: s.endsAt, participantIds: ['p1', 'p2'], ...over })
}
