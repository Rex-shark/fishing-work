/// <reference types="node" />
// 契約逐字比對：shared/src/song-guess/events.ts 必須與 spec/song-guess/architecture.md §4 的 ts 程式碼區塊完全相同
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SONG_GUESS_NAMESPACE } from '../src/song-guess/events';
import type {
  Ack,
  ChatKind,
  ClientToServerEvents,
  ErrorCode,
  GameResultEntry,
  JoinResult,
  PlayerPublic,
  RoomSnapshot,
  RoundPublic,
  ServerToClientEvents,
  SongPhase,
  SongPublic,
  SongReveal,
  SongSource,
  SongSourcePayload,
} from '../src/song-guess/events';

const SPEC = new URL('../../spec/song-guess/architecture.md', import.meta.url);
const EVENTS = new URL('../src/song-guess/events.ts', import.meta.url);
const SECTION = '## 4. Socket 事件契約';

/** 取 spec §4 標題之後第一個 ```ts 區塊的內容（不含圍欄行） */
function extractSpecBlock(md: string): string {
  const lines = md.split('\n');
  const section = lines.findIndex((l) => l.startsWith(SECTION));
  if (section < 0) throw new Error(`spec 找不到 ${SECTION}`);
  const open = lines.indexOf('```ts', section);
  if (open < 0) throw new Error('spec §4 找不到 ts 程式碼區塊');
  const close = lines.indexOf('```', open + 1);
  if (close < 0) throw new Error('spec 程式碼區塊沒有結尾');
  return lines.slice(open + 1, close).join('\n');
}

const trimEnd = (s: string) => s.replace(/\n+$/, '');

describe('song-guess events.ts 與 spec §4 逐字一致', () => {
  it('內容相等（僅忽略結尾換行）', () => {
    const spec = extractSpecBlock(readFileSync(SPEC, 'utf8'));
    const events = readFileSync(EVENTS, 'utf8');
    expect(spec.length).toBeGreaterThan(0);
    expect(trimEnd(events)).toBe(trimEnd(spec));
  });

  it('抽出的區塊確實是契約本體（首行為契約來源註解、末行為 ServerToClientEvents 結尾）', () => {
    const lines = trimEnd(extractSpecBlock(readFileSync(SPEC, 'utf8'))).split('\n');
    expect(lines[0]).toBe(
      '// 契約來源：spec/song-guess/architecture.md §4（逐字照抄，修改需經架構師海圖定案並先改 spec）',
    );
    expect(lines.at(-1)).toBe('}');
    expect(lines).toContain('export interface ServerToClientEvents {');
  });
});

// 型別由 tsc（npm run typecheck）把關，這裡只留最小的執行期斷言
describe('song-guess 契約（型別層）', () => {
  const song: SongPublic = {
    index: 1,
    previewUrl: 'https://audio-ssl.itunes.apple.com/preview/1.m4a',
    artist: '韋禮安',
    startedAt: 1_000,
    endsAt: 31_000,
    durationMs: 30_000,
    titleLength: 4,
    correctIds: ['p1'],
  };
  const reveal: SongReveal = {
    index: 1,
    title: '如果可以 (電影"月老"主題曲)',
    artist: '韋禮安',
    album: null,
    artworkUrl: null,
    itunesUrl: null,
    scores: [{ playerId: 'p1', score: 80 }],
  };
  const result: GameResultEntry = { playerId: 'p1', nickname: '小明', rank: 1, gameScore: 80, correctCount: 1 };
  const idle: RoundPublic = {
    gameNo: 0,
    phase: 'idle',
    setterId: null,
    source: null,
    artist: null,
    artistHot: false,
    topic: null,
    songCount: 5,
    endsAt: null,
    song: null,
    reveal: null,
    results: null,
    lastTopic: null,
    lastSource: null,
    serverNow: 1_000,
    participantIds: [],
  };

  it("namespace 為 '/song-guess'", () => {
    expect(SONG_GUESS_NAMESPACE).toBe('/song-guess');
  });

  it('SongPhase 只有 idle／choosing／playing／reveal／ended', () => {
    const phases: SongPhase[] = ['idle', 'choosing', 'playing', 'reveal', 'ended'];
    expect(phases).toHaveLength(5);
    // @ts-expect-error 猜歌沒有 drawing（繪圖比賽的階段）
    const bad: SongPhase = 'drawing';
    expect(bad).toBe('drawing');
  });

  it('ChatKind 只有 chat／system／correct', () => {
    const kinds: ChatKind[] = ['chat', 'system', 'correct'];
    expect(kinds).toHaveLength(3);
    // @ts-expect-error 猜歌聊天室沒有 image
    const bad: ChatKind = 'image';
    expect(bad).toBe('image');
  });

  it('ErrorCode 含猜歌專屬的七個碼（Epic 18 加 SOURCE_INVALID、CHART_FAILED），不含繪圖比賽的 TOPIC_INVALID', () => {
    const codes: ErrorCode[] = [
      'NICKNAME_INVALID', 'NICKNAME_TAKEN', 'NOT_IN_ROOM', 'ROOM_FULL',
      'ROUND_BUSY', 'NOT_SETTER', 'NOT_ENOUGH_PLAYERS', 'ARTIST_INVALID',
      'ARTIST_NOT_FOUND', 'SEARCH_FAILED', 'SEARCH_BUSY', 'SOURCE_INVALID', 'CHART_FAILED',
      'MESSAGE_INVALID', 'SPOILER_BLOCKED', 'RATE_LIMITED',
    ];
    expect(new Set(codes).size).toBe(16);
    // @ts-expect-error 題目是繪圖比賽的概念
    const bad: ErrorCode = 'TOPIC_INVALID';
    expect(bad).toBe('TOPIC_INVALID');
  });

  it('SongSource 只有 artist／tw-hot／western-hot；SongSourcePayload 依 source 區分欄位（Epic 18）', () => {
    const sources: SongSource[] = ['artist', 'tw-hot', 'western-hot'];
    expect(sources).toHaveLength(3);
    // @ts-expect-error 英國榜不在本 Epic
    const bad: SongSource = 'uk-hot';
    expect(bad).toBe('uk-hot');

    const payloads: SongSourcePayload[] = [
      { source: 'artist', artist: '周杰倫', hot: true },
      { source: 'tw-hot' },
      { source: 'western-hot' },
    ];
    expect(payloads.map((p) => p.source)).toEqual(sources);
    // @ts-expect-error 歌手模式的 hot 為必填
    const noHot: SongSourcePayload = { source: 'artist', artist: '周杰倫' };
    expect(noHot.source).toBe('artist');
    // @ts-expect-error 榜單模式不帶歌手名
    const chartWithArtist: SongSourcePayload = { source: 'tw-hot', artist: '周杰倫' };
    expect(chartWithArtist.source).toBe('tw-hot');
  });

  it('PlayerPublic 帶 gameScore、isSetter、hasGuessed（皆必填）', () => {
    const player: PlayerPublic = {
      id: 'p1',
      nickname: '小明',
      score: 180,
      gameScore: 80,
      isSetter: false,
      hasGuessed: true,
      connected: true,
      joinedAt: 1_000,
    };
    expect(player.gameScore).toBe(80);
    // @ts-expect-error gameScore、isSetter、hasGuessed 為必填
    const missing: PlayerPublic = { id: 'p1', nickname: '小明', score: 0, connected: true, joinedAt: 1_000 };
    expect(missing.id).toBe('p1');
  });

  it('SongPublic 帶本首歌手（Epic 18）但不帶答案欄位；SongReveal 的 album／artworkUrl／itunesUrl 可為 null', () => {
    expect(Object.keys(song).sort()).toEqual(
      ['index', 'previewUrl', 'artist', 'startedAt', 'endsAt', 'durationMs', 'titleLength', 'correctIds'].sort(),
    );
    // @ts-expect-error 播放中的一首不得帶歌名
    const leaked: SongPublic = { ...song, title: '如果可以' };
    expect(leaked.index).toBe(1);
    expect(reveal.album).toBeNull();
    const full: SongReveal = {
      ...reveal,
      album: '月老 電影原聲帶',
      artworkUrl: 'https://example.invalid/100x100bb.jpg',
      itunesUrl: 'https://music.apple.com/tw/album/1',
    };
    expect(full.album).toBe('月老 電影原聲帶');
  });

  it('RoundPublic：idle 全空、playing 帶 song、reveal 帶 song＋reveal、ended 帶 results', () => {
    const playing: RoundPublic = {
      ...idle,
      gameNo: 1,
      phase: 'playing',
      setterId: 'p0',
      source: 'artist',
      artist: '韋禮安',
      artistHot: true,
      topic: '韋禮安',
      endsAt: song.endsAt,
      song,
      participantIds: ['p0', 'p1'],
    };
    const revealing: RoundPublic = { ...playing, phase: 'reveal', endsAt: 36_000, reveal };
    const ended: RoundPublic = {
      ...revealing,
      phase: 'ended',
      endsAt: null,
      song: null,
      results: [result],
      lastTopic: '韋禮安',
      lastSource: 'artist',
    };
    const chart: RoundPublic = {
      ...playing,
      source: 'tw-hot',
      artist: null,
      artistHot: false,
      topic: '台灣熱門',
      song: { ...song, artist: 'BLACKPINK' },
    };
    expect(idle.song).toBeNull();
    expect(playing.song?.correctIds).toEqual(['p1']);
    expect(revealing.reveal?.scores).toEqual([{ playerId: 'p1', score: 80 }]);
    expect(ended.results).toEqual([result]);
    expect(chart.song?.artist).toBe('BLACKPINK');
    expect(chart.artist).toBeNull();
    // @ts-expect-error serverNow、participantIds 等為必填
    const missing: RoundPublic = { gameNo: 0, phase: 'idle' };
    expect(missing.phase).toBe('idle');
  });

  it('Ack：成功帶 data、失敗帶 error＋message', () => {
    const snapshot: RoomSnapshot = { you: 'p1', players: [], round: idle, chat: [] };
    const joined: Ack<JoinResult> = { ok: true, data: { token: 't', snapshot } };
    const failed: Ack<JoinResult> = { ok: false, error: 'ROOM_FULL', message: '房間已滿' };
    expect(joined.ok && joined.data.snapshot.you).toBe('p1');
    expect(!failed.ok && failed.error).toBe('ROOM_FULL');
  });

  it("ClientToServerEvents：'round:setSource' 的 ack 帶 topic；事件名共五個（Epic 18 由 setArtist 改名）", () => {
    const acks: Ack<{ topic: string }>[] = [];
    const setSource: ClientToServerEvents['round:setSource'] = (payload, ack) => {
      ack({ ok: true, data: { topic: payload.source === 'artist' ? payload.artist : '台灣熱門' } });
      ack({ ok: false, error: 'CHART_FAILED', message: '取得排行榜失敗，請再試一次' });
    };
    setSource({ source: 'artist', artist: '孫燕姿', hot: true }, (r) => acks.push(r));
    setSource({ source: 'tw-hot' }, (r) => acks.push(r));
    expect(acks).toEqual([
      { ok: true, data: { topic: '孫燕姿' } },
      { ok: false, error: 'CHART_FAILED', message: '取得排行榜失敗，請再試一次' },
      { ok: true, data: { topic: '台灣熱門' } },
      { ok: false, error: 'CHART_FAILED', message: '取得排行榜失敗，請再試一次' },
    ]);

    const names: Record<keyof ClientToServerEvents, true> = {
      'player:join': true,
      'round:volunteer': true,
      'round:setSource': true,
      'round:cancel': true,
      'chat:send': true,
    };
    expect(Object.keys(names)).toHaveLength(5);
  });

  it('ServerToClientEvents 只有 players:update／round:update／chat:message', () => {
    const names: Record<keyof ServerToClientEvents, true> = {
      'players:update': true,
      'round:update': true,
      'chat:message': true,
    };
    expect(Object.keys(names)).toHaveLength(3);
    const rounds: RoundPublic[] = [];
    const onRound: ServerToClientEvents['round:update'] = (round) => {
      rounds.push(round);
    };
    onRound(idle);
    expect(rounds).toEqual([idle]);
  });
});
