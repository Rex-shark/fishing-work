// 猜歌 Room：spec/song-guess/architecture.md §5（狀態機、搜尋、猜題、計分、揭曉、排名、離開、重連）
// 假時鐘＋注入的搜尋器與亂數，決定性地跑；搜尋結果經 promise 回報，所以 setArtist 一律 await。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ARTIST_INVALID_MESSAGE,
  CHAT_HISTORY,
  CHAT_MIN_INTERVAL_MS,
  CHOOSING_SECONDS,
  MAX_PLAYERS,
  NICKNAME_INVALID_MESSAGE,
  NICKNAME_TAKEN_MESSAGE,
  PREVIEW_CAP_MS,
  RECONNECT_GRACE_SECONDS,
  REVEAL_SECONDS,
  SONGS_PER_GAME,
  START_DELAY_MS,
  type ChatMessage,
  type PlayerPublic,
  type RoundPublic,
} from '@fishing-work/shared/song-guess';
import { CHAT_ERROR_MESSAGES } from '../src/games/song-guess/chat';
import { ItunesSearchError, type ItunesTrack, type SongSearcher } from '../src/games/song-guess/itunes';
import { ROUND_ERROR_MESSAGES, Room, type Effect, type EmitEffect, type RoomOptions } from '../src/games/song-guess/room';
import { FakeClock } from './helpers/fakeClock';
import { ManualSearch, flush, track } from './helpers/songGuess';

const GRACE_MS = RECONNECT_GRACE_SECONDS * 1000;
const CHOOSING_MS = CHOOSING_SECONDS * 1000;
const REVEAL_MS = REVEAL_SECONDS * 1000;
const CAP = PREVIEW_CAP_MS;

/**
 * 預設歌單：亂數恆為 0 時依序抽前 5 首。
 * 第 4 首全長 20 秒（durationMs 取全長）、第 5 首沒有全長（durationMs 取上限）；第 6 首不會被抽到。
 */
const TITLES = ['遇見', '如果可以 (電影"月老"主題曲)', "I'm gonna TOESA (feat. Kian84)", '天黑黑', '愛 (Live)', '第六首'];
const TRACKS: ItunesTrack[] = [
  track(1, TITLES[0] as string),
  track(2, TITLES[1] as string),
  track(3, TITLES[2] as string),
  track(4, TITLES[3] as string, { trackTimeMillis: 20_000 }),
  track(5, TITLES[4] as string, { trackTimeMillis: null }),
  track(6, TITLES[5] as string),
];
/** 各首的播放長度 */
const DURATIONS = [CAP, CAP, CAP, 20_000, CAP];
/** 各首猜得中的字串（歌名本身） */
const ANSWERS = ['遇見', '如果可以', 'im gonna toesa', '天黑黑', '愛'];

let clock: FakeClock;
let asyncEffects: Effect[][];
let searched: string[];
let room: Room;

/** 立即回固定歌單的搜尋器（記錄被搜尋的歌手名） */
const instantSearch: SongSearcher = (artist) => {
  searched.push(artist);
  return Promise.resolve(TRACKS);
};

function makeRoom(opts: Partial<RoomOptions> = {}): Room {
  let n = 0;
  return new Room({
    clock,
    newId: () => `id${++n}`,
    onAsyncEffects: (e) => asyncEffects.push(e),
    search: instantSearch,
    random: () => 0,
    ...opts,
  });
}

beforeEach(() => {
  clock = new FakeClock();
  asyncEffects = [];
  searched = [];
  room = makeRoom();
});

afterEach(() => room.dispose());

// 固定的 id：A = id1（socket s1）、B = id3（s2）、C = id5（s3）、D = id7（s4）
const A = 'id1';
const B = 'id3';
const C = 'id5';
const D = 'id7';
const NAMES = ['Alice', 'Bob', 'Carol', 'Dave'];

// ─── 測試工具 ─────────────────────────────────────────────────────

function joinOk(socketId: string, nickname: string, token?: string) {
  const r = room.join(socketId, nickname, token);
  if (!r.ack.ok) throw new Error(`join 失敗：${r.ack.error}`);
  return { data: r.ack.data, effects: r.effects };
}

function joinPlayers(n = 2): void {
  for (let i = 0; i < n; i++) joinOk(`s${i + 1}`, NAMES[i] as string);
}

function ok(outcome: { ack: { ok: boolean } }): void {
  expect(outcome.ack).toEqual({ ok: true, data: undefined });
}

function toChoosing(n = 2): void {
  joinPlayers(n);
  ok(room.volunteer('s1'));
}

/** n 人加入 → s1 出題 → 搜尋成功 → 第 1 首 playing（時鐘不前進） */
async function toPlaying(n = 2, artist = '孫燕姿') {
  toChoosing(n);
  const out = await room.setArtist('s1', artist);
  if (!out.ack.ok) throw new Error(`setArtist 失敗：${out.ack.error}`);
  return out;
}

/** 目前這首播到底 → reveal */
function finishSong(): void {
  const { song } = room.currentRound();
  if (song === null) throw new Error('沒有進行中的歌');
  clock.advance(song.endsAt - clock.now());
}

/** 把目前這首播完並等揭曉結束 → 下一首 playing 或 ended */
function nextSong(): void {
  finishSong();
  clock.advance(REVEAL_MS);
}

/** 間隔限制：同一人連續發言前先讓時鐘前進 */
function say(socketId: string, text: string) {
  clock.advance(CHAT_MIN_INTERVAL_MS);
  return room.chat(socketId, text);
}

function emits(effects: Effect[]): EmitEffect[] {
  return effects.filter((e): e is EmitEffect => e.kind === 'emit');
}

function eventsOf(effects: Effect[]): string[] {
  return emits(effects).map((e) => e.event);
}

function rounds(effects: Effect[]): RoundPublic[] {
  return emits(effects)
    .filter((e) => e.event === 'round:update')
    .map((e) => e.payload as RoundPublic);
}

function playersOf(effects: Effect[]): PlayerPublic[] {
  const list = emits(effects).filter((e) => e.event === 'players:update');
  return (list.at(-1)?.payload ?? []) as PlayerPublic[];
}

function chats(effects: Effect[]): ChatMessage[] {
  return emits(effects)
    .filter((e) => e.event === 'chat:message')
    .map((e) => e.payload as ChatMessage);
}

function player(id: string): PlayerPublic {
  const p = room.playerList().find((x) => x.id === id);
  if (p === undefined) throw new Error(`玩家不在房間：${id}`);
  return p;
}

function lastAsync(): Effect[] {
  return asyncEffects.at(-1) ?? [];
}

// ─── 加入與聊天（與另兩款相同的部分，抽驗） ────────────────────────

describe('加入', () => {
  it('新玩家：快照為 idle、gameNo 0、欄位齊全；serverNow 為當下時鐘', () => {
    const { data, effects } = joinOk('s1', ' Alice ');
    expect(data.token).toBe('id2');
    expect(data.snapshot.you).toBe(A);
    expect(data.snapshot.players).toEqual([
      { id: A, nickname: 'Alice', score: 0, gameScore: 0, isSetter: false, hasGuessed: false, connected: true, joinedAt: clock.now() },
    ]);
    expect(data.snapshot.round).toEqual({
      gameNo: 0,
      phase: 'idle',
      setterId: null,
      artist: null,
      artistDisplay: null,
      songCount: SONGS_PER_GAME,
      endsAt: null,
      song: null,
      reveal: null,
      results: null,
      lastArtist: null,
      serverNow: clock.now(),
      participantIds: [],
    });
    expect(data.snapshot.chat.map((m) => [m.kind, m.fromId, m.text])).toEqual([['system', null, 'Alice 加入']]);
    expect(eventsOf(effects)).toEqual(['players:update', 'chat:message']);
    expect(emits(effects)[1]?.to).toEqual({ except: A });
  });

  it('暱稱不合法、重複（全形＋大小寫）', () => {
    joinOk('s1', 'Alice');
    expect(room.join('s2', '   ').ack).toEqual({ ok: false, error: 'NICKNAME_INVALID', message: NICKNAME_INVALID_MESSAGE });
    expect(room.join('s2', 'x'.repeat(13)).ack).toMatchObject({ ok: false, error: 'NICKNAME_INVALID' });
    expect(room.join('s2', 'ＡＬＩＣＥ').ack).toEqual({ ok: false, error: 'NICKNAME_TAKEN', message: NICKNAME_TAKEN_MESSAGE });
  });

  it(`第 ${MAX_PLAYERS + 1} 人 → ROOM_FULL`, () => {
    for (let i = 0; i < MAX_PLAYERS; i++) joinOk(`s${i}`, `p${i}`);
    expect(room.join('sx', 'extra').ack).toEqual({ ok: false, error: 'ROOM_FULL', message: ROUND_ERROR_MESSAGES.ROOM_FULL });
  });

  it('同一 socket 重複 join → 冪等', () => {
    const first = joinOk('s1', 'Alice');
    const again = joinOk('s1', 'Other');
    expect(again.data.token).toBe(first.data.token);
    expect(again.effects).toEqual([]);
    expect(room.playerList()).toHaveLength(1);
  });
});

describe('聊天（非 playing）', () => {
  it('照常廣播；MESSAGE_INVALID、RATE_LIMITED、NOT_IN_ROOM', () => {
    joinPlayers(2);
    const out = room.chat('s1', '  大家好 ');
    ok(out);
    expect(chats(out.effects)).toEqual([{ id: 'm3', kind: 'chat', fromId: A, nickname: 'Alice', text: '大家好', at: clock.now() }]);
    expect(room.chat('s1', '太快了').ack).toEqual({ ok: false, error: 'RATE_LIMITED', message: CHAT_ERROR_MESSAGES.RATE_LIMITED });
    clock.advance(CHAT_MIN_INTERVAL_MS);
    ok(room.chat('s1', '可以了'));
    expect(room.chat('s2', '   ').ack).toEqual({ ok: false, error: 'MESSAGE_INVALID', message: CHAT_ERROR_MESSAGES.MESSAGE_INVALID });
    expect(room.chat('s2', 'x'.repeat(201)).ack).toMatchObject({ ok: false, error: 'MESSAGE_INVALID' });
    expect(room.chat('s2', '第一行\n第二行').ack).toMatchObject({ ok: false, error: 'MESSAGE_INVALID' });
    expect(room.chat('nobody', 'hi').ack).toEqual({ ok: false, error: 'NOT_IN_ROOM', message: ROUND_ERROR_MESSAGES.NOT_IN_ROOM });
  });

  it(`聊天緩衝最多 ${CHAT_HISTORY} 則`, () => {
    joinPlayers(1);
    for (let i = 0; i < CHAT_HISTORY + 20; i++) ok(say('s1', `訊息${i}`));
    const { chat } = room.snapshot(A);
    expect(chat).toHaveLength(CHAT_HISTORY);
    expect(chat.at(-1)?.text).toBe(`訊息${CHAT_HISTORY + 19}`);
  });

  it('idle／choosing／reveal／ended 時含歌名的訊息不擋（只有 playing 才判題）', async () => {
    await toPlaying();
    finishSong();
    expect(room.currentRound().phase).toBe('reveal');
    ok(say('s2', '原來是遇見'));
    expect(player(B).gameScore).toBe(0);
  });
});

// ─── 出題（volunteer）與 choosing ─────────────────────────────────

describe('round:volunteer', () => {
  it('idle、在線 ≥ 2 → choosing：setterId、endsAt、其餘為空', () => {
    joinPlayers(2);
    const out = room.volunteer('s1');
    ok(out);
    expect(eventsOf(out.effects)).toEqual(['round:update', 'players:update']);
    expect(rounds(out.effects)[0]).toEqual({
      gameNo: 0,
      phase: 'choosing',
      setterId: A,
      artist: null,
      artistDisplay: null,
      songCount: SONGS_PER_GAME,
      endsAt: clock.now() + CHOOSING_MS,
      song: null,
      reveal: null,
      results: null,
      lastArtist: null,
      serverNow: clock.now(),
      participantIds: [],
    });
    expect(playersOf(out.effects).map((p) => p.isSetter)).toEqual([true, false]);
  });

  it('未加入 → NOT_IN_ROOM；在線不足 → NOT_ENOUGH_PLAYERS（斷線中的不算在線）', () => {
    expect(room.volunteer('nobody').ack).toEqual({ ok: false, error: 'NOT_IN_ROOM', message: ROUND_ERROR_MESSAGES.NOT_IN_ROOM });
    joinPlayers(1);
    expect(room.volunteer('s1').ack).toEqual({ ok: false, error: 'NOT_ENOUGH_PLAYERS', message: '至少要 2 位在線玩家才能開始' });
    joinOk('s2', 'Bob');
    room.disconnect('s2');
    expect(room.volunteer('s1').ack).toMatchObject({ ok: false, error: 'NOT_ENOUGH_PLAYERS' });
  });

  it('choosing 時任何人（含出題者自己）再 volunteer → ROUND_BUSY', () => {
    toChoosing(2);
    expect(room.volunteer('s2').ack).toEqual({ ok: false, error: 'ROUND_BUSY', message: '目前已有回合進行中' });
    expect(room.volunteer('s1').ack).toMatchObject({ ok: false, error: 'ROUND_BUSY' });
  });

  it('階段不符優先於人數：playing 中只剩 1 人在線時 volunteer → ROUND_BUSY', async () => {
    await toPlaying();
    room.disconnect('s2');
    expect(room.volunteer('s1').ack).toMatchObject({ ok: false, error: 'ROUND_BUSY' });
  });
});

describe('choosing：取消、逾時、出題者離開', () => {
  it('出題者 cancel → idle；系統訊息', () => {
    toChoosing(2);
    const out = room.cancel('s1');
    ok(out);
    expect(eventsOf(out.effects)).toEqual(['round:update', 'players:update', 'chat:message']);
    expect(rounds(out.effects)[0]).toMatchObject({ phase: 'idle', setterId: null, endsAt: null, gameNo: 0 });
    expect(chats(out.effects)[0]).toMatchObject({ kind: 'system', text: 'Alice 取消出題' });
    expect(playersOf(out.effects).every((p) => !p.isSetter)).toBe(true);
    expect(clock.timers.size).toBe(0);
  });

  it(`${CHOOSING_SECONDS} 秒未成功出題 → idle`, () => {
    toChoosing(2);
    clock.advance(CHOOSING_MS - 1);
    expect(room.currentRound().phase).toBe('choosing');
    clock.advance(1);
    expect(room.currentRound()).toMatchObject({ phase: 'idle', setterId: null });
    expect(chats(lastAsync())[0]?.text).toBe('Alice 出題逾時');
  });

  it('出題者斷線寬限期滿 → idle；其他人離開不影響', () => {
    toChoosing(3);
    room.disconnect('s3');
    clock.advance(GRACE_MS);
    expect(room.currentRound()).toMatchObject({ phase: 'choosing', setterId: A });
    room.disconnect('s1');
    clock.advance(GRACE_MS);
    expect(room.currentRound()).toMatchObject({ phase: 'idle', setterId: null });
    expect(chats(lastAsync()).map((m) => m.text)).toEqual(['Alice 離開', '出題者 Alice 離開']);
  });

  it('出題者斷線後在寬限期內重連 → 仍是出題者、可以出題', async () => {
    joinOk('s1', 'Alice');
    joinOk('s2', 'Bob');
    ok(room.volunteer('s1'));
    room.disconnect('s1');
    clock.advance(GRACE_MS - 1);
    const back = joinOk('s9', 'ignored', 'id2');
    expect(back.data.snapshot.you).toBe(A);
    expect(back.data.snapshot.round).toMatchObject({ phase: 'choosing', setterId: A });
    expect((await room.setArtist('s9', '孫燕姿')).ack).toEqual({ ok: true, data: { artistDisplay: '孫燕姿' } });
  });
});

describe('階段不符的錯誤碼（§5）', () => {
  it('idle：setArtist／cancel → NOT_SETTER', async () => {
    joinPlayers(2);
    expect((await room.setArtist('s1', '孫燕姿')).ack).toEqual({ ok: false, error: 'NOT_SETTER', message: '只有本回合的出題者可以這麼做' });
    expect(room.cancel('s1').ack).toMatchObject({ ok: false, error: 'NOT_SETTER' });
    expect(searched).toEqual([]);
  });

  it('choosing：非出題者 setArtist／cancel → NOT_SETTER', async () => {
    toChoosing(2);
    expect((await room.setArtist('s2', '孫燕姿')).ack).toMatchObject({ ok: false, error: 'NOT_SETTER' });
    expect(room.cancel('s2').ack).toMatchObject({ ok: false, error: 'NOT_SETTER' });
    expect(searched).toEqual([]);
    expect(room.currentRound().phase).toBe('choosing');
  });

  it('playing／reveal：volunteer／setArtist／cancel 不論是誰 → ROUND_BUSY', async () => {
    await toPlaying(3);
    for (const phase of ['playing', 'reveal'] as const) {
      expect(room.currentRound().phase).toBe(phase);
      for (const s of ['s1', 's2', 's3']) {
        expect(room.volunteer(s).ack).toEqual({ ok: false, error: 'ROUND_BUSY', message: '目前已有回合進行中' });
        expect((await room.setArtist(s, '周杰倫')).ack).toMatchObject({ ok: false, error: 'ROUND_BUSY' });
        expect(room.cancel(s).ack).toMatchObject({ ok: false, error: 'ROUND_BUSY' });
      }
      finishSong();
    }
    expect(searched).toEqual(['孫燕姿']);
  });

  it('ended：setArtist／cancel → NOT_SETTER（上一局出題者也一樣）；volunteer 可用', async () => {
    await toPlaying();
    for (let i = 0; i < SONGS_PER_GAME; i++) nextSong();
    expect(room.currentRound().phase).toBe('ended');
    expect((await room.setArtist('s1', '周杰倫')).ack).toMatchObject({ ok: false, error: 'NOT_SETTER' });
    expect(room.cancel('s1').ack).toMatchObject({ ok: false, error: 'NOT_SETTER' });
    ok(room.volunteer('s2'));
  });

  it('未加入 → NOT_IN_ROOM', async () => {
    expect((await room.setArtist('nobody', '孫燕姿')).ack).toEqual({ ok: false, error: 'NOT_IN_ROOM', message: '請先加入房間' });
    expect(room.cancel('nobody').ack).toMatchObject({ ok: false, error: 'NOT_IN_ROOM' });
  });
});

// ─── setArtist：驗證與搜尋 ────────────────────────────────────────

describe('round:setArtist：驗證', () => {
  it('歌手名不合法 → ARTIST_INVALID（不搜尋）；仍在 choosing', async () => {
    toChoosing(2);
    for (const bad of ['', '   ', '　', 'x'.repeat(31), '孫\n燕姿', '孫\t燕姿']) {
      expect((await room.setArtist('s1', bad)).ack).toEqual({ ok: false, error: 'ARTIST_INVALID', message: ARTIST_INVALID_MESSAGE });
    }
    expect(ARTIST_INVALID_MESSAGE).toBe('歌手名稱需為 1～30 個字，不可含控制字元，也不能只有空白');
    expect(searched).toEqual([]);
    expect(room.currentRound().phase).toBe('choosing');
  });

  it('去頭尾空白後送去搜尋；30 個字合法', async () => {
    toChoosing(2);
    const long = '孫'.repeat(30);
    await room.setArtist('s1', `  ${long}　`);
    expect(searched).toEqual([long]);
  });
});

describe('round:setArtist：搜尋失敗與查無 → 仍在 choosing，可重試', () => {
  it('SEARCH_FAILED（搜尋器 reject）後再送成功', async () => {
    let fail = true;
    room = makeRoom({ search: () => (fail ? Promise.reject(new ItunesSearchError('HTTP 500')) : Promise.resolve(TRACKS)) });
    toChoosing(2);
    const endsAt = room.currentRound().endsAt;
    const out = await room.setArtist('s1', '孫燕姿');
    expect(out).toEqual({ ack: { ok: false, error: 'SEARCH_FAILED', message: '搜尋失敗，請再試一次' }, effects: [] });
    expect(room.currentRound()).toMatchObject({ phase: 'choosing', setterId: A, endsAt, gameNo: 0, artist: null });
    fail = false;
    expect((await room.setArtist('s1', '孫燕姿')).ack).toEqual({ ok: true, data: { artistDisplay: '孫燕姿' } });
  });

  it('搜尋器同步丟例外、或沒注入搜尋器 → SEARCH_FAILED', async () => {
    room = makeRoom({
      search: () => {
        throw new Error('boom');
      },
    });
    toChoosing(2);
    expect((await room.setArtist('s1', '孫燕姿')).ack).toMatchObject({ ok: false, error: 'SEARCH_FAILED' });
    room.dispose();
    room = makeRoom({ search: undefined });
    toChoosing(2);
    expect((await room.setArtist('s1', '孫燕姿')).ack).toMatchObject({ ok: false, error: 'SEARCH_FAILED' });
  });

  it('ARTIST_NOT_FOUND（查無、不足 5 首）後換一位成功', async () => {
    const byArtist: Record<string, ItunesTrack[]> = { 沒有這個人: [], 三首樂團: TRACKS.slice(0, 3), 孫燕姿: TRACKS };
    room = makeRoom({ search: (artist) => Promise.resolve(byArtist[artist] ?? []) });
    toChoosing(2);
    for (const artist of ['沒有這個人', '三首樂團']) {
      const out = await room.setArtist('s1', artist);
      expect(out).toEqual({
        ack: { ok: false, error: 'ARTIST_NOT_FOUND', message: '找不到這位歌手的歌（至少要 5 首有試聽的歌），換一位試試' },
        effects: [],
      });
      expect(room.currentRound()).toMatchObject({ phase: 'choosing', setterId: A, gameNo: 0, results: null });
    }
    expect((await room.setArtist('s1', '孫燕姿')).ack.ok).toBe(true);
    expect(room.currentRound()).toMatchObject({ phase: 'playing', gameNo: 1 });
  });

  it('失敗不延長出題期限：期限到照樣回 idle', async () => {
    room = makeRoom({ search: () => Promise.resolve([]) });
    toChoosing(2);
    clock.advance(CHOOSING_MS - 10);
    await room.setArtist('s1', '沒有這個人');
    clock.advance(10);
    expect(room.currentRound().phase).toBe('idle');
  });

  it('英文名退回最多次的 artistName：Jay Chou → artistDisplay 周杰倫，artist 保留輸入', async () => {
    const jay = TRACKS.map((t) => ({ ...t, artistName: '周杰倫' }));
    room = makeRoom({ search: () => Promise.resolve(jay) });
    toChoosing(2);
    const out = await room.setArtist('s1', ' Jay Chou ');
    expect(out.ack).toEqual({ ok: true, data: { artistDisplay: '周杰倫' } });
    expect(room.currentRound()).toMatchObject({ artist: 'Jay Chou', artistDisplay: '周杰倫' });
  });

  it('退回須過半：結果裡最多的歌手沒過半 → ARTIST_NOT_FOUND，仍在 choosing', async () => {
    // 輸入的歌手 2 首，另外兩個團各 5 首（最多的佔 5／12）
    const tracks = [
      track(1, '合唱一', { artistName: '客串歌手' }),
      track(2, '合唱二', { artistName: '客串歌手' }),
      ...[3, 4, 5, 6, 7].map((i) => track(i, `甲的歌${i}`, { artistName: '大團甲' })),
      ...[8, 9, 10, 11, 12].map((i) => track(i, `乙的歌${i}`, { artistName: '大團乙' })),
    ];
    room = makeRoom({ search: () => Promise.resolve(tracks) });
    toChoosing(2);
    expect((await room.setArtist('s1', '客串歌手')).ack).toMatchObject({ ok: false, error: 'ARTIST_NOT_FOUND' });
    expect(room.currentRound()).toMatchObject({ phase: 'choosing', gameNo: 0 });
    // 直接打過濾得到 5 首的歌手名仍可出題
    expect((await room.setArtist('s1', '大團乙')).ack).toEqual({ ok: true, data: { artistDisplay: '大團乙' } });
  });

  it('括號開頭的歌名不會被抽到：扣掉後不足 5 首 → ARTIST_NOT_FOUND', async () => {
    const tracks = [track(1, '(......醉鬼阿Q) [feat. 孫燕姿]'), ...[2, 3, 4, 5].map((i) => track(i, `歌${i}`))];
    room = makeRoom({ search: () => Promise.resolve(tracks) });
    toChoosing(2);
    expect((await room.setArtist('s1', '孫燕姿')).ack).toMatchObject({ ok: false, error: 'ARTIST_NOT_FOUND' });
  });

  it('lastArtist 是正式名（artistDisplay），不是出題者輸入值', async () => {
    const jay = TRACKS.map((t) => ({ ...t, artistName: '周杰倫' }));
    room = makeRoom({ search: () => Promise.resolve(jay) });
    toChoosing(2);
    await room.setArtist('s1', 'Jay Chou');
    expect(room.currentRound()).toMatchObject({ artist: 'Jay Chou', artistDisplay: '周杰倫', lastArtist: null });
    for (let i = 0; i < SONGS_PER_GAME; i++) nextSong();
    expect(room.currentRound()).toMatchObject({ phase: 'ended', artist: 'Jay Chou', artistDisplay: '周杰倫', lastArtist: '周杰倫' });
    // 下一局 choosing／idle 保留的也是正式名
    ok(room.volunteer('s2'));
    expect(room.currentRound()).toMatchObject({ phase: 'choosing', artist: null, lastArtist: '周杰倫' });
    ok(room.cancel('s2'));
    expect(room.currentRound()).toMatchObject({ phase: 'idle', lastArtist: '周杰倫' });
  });
});

describe('round:setArtist：搜尋進行中', () => {
  let manual: ManualSearch;
  beforeEach(() => {
    manual = new ManualSearch();
    room = makeRoom({ search: manual.search });
  });

  it('搜尋中再送 → SEARCH_BUSY（不重複搜尋）；搜尋回來後成功', async () => {
    toChoosing(2);
    const first = room.setArtist('s1', '孫燕姿');
    expect(await room.setArtist('s1', '周杰倫')).toEqual({ ack: { ok: false, error: 'SEARCH_BUSY', message: '搜尋中，請稍候' }, effects: [] });
    expect(await room.setArtist('s1', '孫燕姿')).toMatchObject({ ack: { ok: false, error: 'SEARCH_BUSY' } });
    expect(manual.calls).toHaveLength(1);
    // 搜尋中 round 沒有變化（仍是 choosing、artist 尚未公開）
    expect(room.currentRound()).toMatchObject({ phase: 'choosing', artist: null, artistDisplay: null });
    manual.calls[0]?.resolve(TRACKS);
    expect((await first).ack).toEqual({ ok: true, data: { artistDisplay: '孫燕姿' } });
    expect(room.currentRound().phase).toBe('playing');
  });

  it('搜尋中歌手名不合法 → ARTIST_INVALID（驗證在 SEARCH_BUSY 之前）', async () => {
    toChoosing(2);
    void room.setArtist('s1', '孫燕姿');
    expect((await room.setArtist('s1', '   ')).ack).toMatchObject({ ok: false, error: 'ARTIST_INVALID' });
  });

  it('搜尋失敗回來後可以再送（SEARCH_BUSY 解除）', async () => {
    toChoosing(2);
    const first = room.setArtist('s1', '孫燕姿');
    manual.calls[0]?.reject(new ItunesSearchError('逾時（8000 ms）'));
    expect((await first).ack).toMatchObject({ ok: false, error: 'SEARCH_FAILED' });
    const second = room.setArtist('s1', '孫燕姿');
    expect(manual.calls).toHaveLength(2);
    manual.calls[1]?.resolve(TRACKS);
    expect((await second).ack.ok).toBe(true);
  });

  it('搜尋中取消 → 立刻 idle；搜尋回來時結果丟棄、ack NOT_SETTER、不開局', async () => {
    toChoosing(2);
    const pending = room.setArtist('s1', '孫燕姿');
    ok(room.cancel('s1'));
    expect(room.currentRound().phase).toBe('idle');
    manual.calls[0]?.resolve(TRACKS);
    expect(await pending).toEqual({ ack: { ok: false, error: 'NOT_SETTER', message: '只有本回合的出題者可以這麼做' }, effects: [] });
    expect(room.currentRound()).toMatchObject({ phase: 'idle', gameNo: 0, artist: null });
    expect(clock.timers.size).toBe(0);
  });

  it('搜尋中出題期限到 → idle；搜尋回來（成功或失敗）都是 NOT_SETTER', async () => {
    toChoosing(2);
    const pending = room.setArtist('s1', '孫燕姿');
    clock.advance(CHOOSING_MS);
    expect(room.currentRound().phase).toBe('idle');
    manual.calls[0]?.resolve(TRACKS);
    expect((await pending).ack).toMatchObject({ ok: false, error: 'NOT_SETTER' });

    ok(room.volunteer('s1'));
    const again = room.setArtist('s1', '孫燕姿');
    clock.advance(CHOOSING_MS);
    manual.calls[1]?.reject(new Error('timeout'));
    expect((await again).ack).toMatchObject({ ok: false, error: 'NOT_SETTER' });
    expect(room.currentRound().phase).toBe('idle');
  });

  it('搜尋中出題者寬限期滿離開 → idle；搜尋回來 NOT_SETTER', async () => {
    toChoosing(3);
    const pending = room.setArtist('s1', '孫燕姿');
    room.disconnect('s1');
    clock.advance(GRACE_MS);
    expect(room.currentRound().phase).toBe('idle');
    manual.calls[0]?.resolve(TRACKS);
    expect((await pending).ack).toMatchObject({ ok: false, error: 'NOT_SETTER' });
    expect(room.currentRound()).toMatchObject({ phase: 'idle', gameNo: 0 });
  });

  it('取消後別人又開了新的 choosing：舊搜尋回來不會開局，也不影響新出題者', async () => {
    toChoosing(2);
    const stale = room.setArtist('s1', '孫燕姿');
    ok(room.cancel('s1'));
    ok(room.volunteer('s2'));
    // 新出題者不會因為舊搜尋還沒回來而 SEARCH_BUSY
    const fresh = room.setArtist('s2', '周杰倫');
    expect(manual.calls.map((c) => c.artist)).toEqual(['孫燕姿', '周杰倫']);
    manual.calls[0]?.resolve(TRACKS);
    expect((await stale).ack).toMatchObject({ ok: false, error: 'NOT_SETTER' });
    expect(room.currentRound()).toMatchObject({ phase: 'choosing', setterId: B, gameNo: 0 });
    // 舊搜尋回來沒有清掉新出題者的「搜尋中」
    expect((await room.setArtist('s2', '五月天')).ack).toMatchObject({ ok: false, error: 'SEARCH_BUSY' });
    manual.calls[1]?.resolve(TRACKS.map((t) => ({ ...t, artistName: '周杰倫' })));
    expect((await fresh).ack).toEqual({ ok: true, data: { artistDisplay: '周杰倫' } });
    expect(room.currentRound()).toMatchObject({ phase: 'playing', setterId: B, gameNo: 1 });
  });

  it('同一人取消後自己再出題：舊搜尋回來同樣丟棄', async () => {
    toChoosing(2);
    const stale = room.setArtist('s1', '孫燕姿');
    ok(room.cancel('s1'));
    ok(room.volunteer('s1'));
    manual.calls[0]?.resolve(TRACKS);
    expect((await stale).ack).toMatchObject({ ok: false, error: 'NOT_SETTER' });
    expect(room.currentRound()).toMatchObject({ phase: 'choosing', setterId: A, gameNo: 0 });
  });

  it('出題者斷線（寬限期內）搜尋成功 → 局照開；他不在參賽者裡', async () => {
    toChoosing(3);
    const pending = room.setArtist('s1', '孫燕姿');
    room.disconnect('s1');
    manual.calls[0]?.resolve(TRACKS);
    expect((await pending).ack.ok).toBe(true);
    expect(room.currentRound()).toMatchObject({ phase: 'playing', setterId: A, participantIds: [B, C] });
  });

  it('dispose 後搜尋才回來 → 丟棄', async () => {
    toChoosing(2);
    const pending = room.setArtist('s1', '孫燕姿');
    room.dispose();
    manual.calls[0]?.resolve(TRACKS);
    expect((await pending).ack).toMatchObject({ ok: false, error: 'NOT_SETTER' });
    await flush();
    expect(clock.timers.size).toBe(0);
  });
});

// ─── 一局 ─────────────────────────────────────────────────────────

describe('搜尋成功 → 第 1 首 playing', () => {
  it('ack { artistDisplay }；round 欄位；效果順序 round:update → players:update → 系統訊息', async () => {
    const out = await toPlaying(2, ' 孫燕姿 ');
    const now = clock.now();
    expect(out.ack).toEqual({ ok: true, data: { artistDisplay: '孫燕姿' } });
    expect(eventsOf(out.effects)).toEqual(['round:update', 'players:update', 'chat:message']);
    expect(rounds(out.effects)[0]).toEqual({
      gameNo: 1,
      phase: 'playing',
      setterId: A,
      artist: '孫燕姿',
      artistDisplay: '孫燕姿',
      songCount: 5,
      endsAt: now + START_DELAY_MS + CAP,
      song: {
        index: 1,
        previewUrl: 'https://audio.example/preview/1.m4a',
        startedAt: now + START_DELAY_MS,
        endsAt: now + START_DELAY_MS + CAP,
        durationMs: CAP,
        titleLength: 2,
        correctIds: [],
      },
      reveal: null,
      results: null,
      lastArtist: null,
      serverNow: now,
      participantIds: [A, B],
    });
    expect(START_DELAY_MS).toBe(1500);
    expect(chats(out.effects)[0]).toMatchObject({ kind: 'system', fromId: null, text: 'Alice 出題「孫燕姿」，共 5 首' });
    expect(playersOf(out.effects).map((p) => [p.isSetter, p.hasGuessed, p.gameScore])).toEqual([
      [true, false, 0],
      [false, false, 0],
    ]);
  });

  it('參賽者＝搜尋成功當下 connected 的玩家（依加入順序）；斷線中的不算', async () => {
    joinPlayers(4);
    room.disconnect('s3');
    ok(room.volunteer('s2'));
    const out = await room.setArtist('s2', '孫燕姿');
    expect(rounds(out.effects)[0]).toMatchObject({ setterId: B, participantIds: [A, B, D] });
  });

  it('答案不外洩：playing 的所有對外 payload 與快照都沒有歌名', async () => {
    const out = await toPlaying();
    const late = joinOk('s3', 'Carol');
    const dump = JSON.stringify([out, late.data.snapshot, room.currentRound(), room.playerList()]);
    for (const title of TITLES) expect(dump).not.toContain(title);
    expect(dump).not.toContain('遇見');
  });

  it('出題期限的計時器被試聽計時器取代（choosing 的 60 秒不會再觸發）', async () => {
    await toPlaying();
    expect(clock.timers.size).toBe(1);
    clock.advance(START_DELAY_MS + CAP - 1);
    expect(room.currentRound().phase).toBe('playing');
  });
});

describe('完整一局 5 首（假時鐘）', () => {
  it('playing → reveal × 5 → ended：每首的欄位、時間、系統訊息', async () => {
    await toPlaying();
    // titleLength＝normalizeTitle 的字數：第 3 首 `I'm gonna TOESA (feat. Kian84)` → imgonnatoesa 12 個字（不含空白與撇號）
    const expectedLength = [2, 4, 12, 3, 1];
    for (let i = 0; i < SONGS_PER_GAME; i++) {
      // ── playing ──
      const enteredAt = clock.now();
      const playing = room.currentRound();
      expect(playing).toMatchObject({
        gameNo: 1,
        phase: 'playing',
        artist: '孫燕姿',
        artistDisplay: '孫燕姿',
        reveal: null,
        results: null,
        lastArtist: null,
        endsAt: enteredAt + START_DELAY_MS + (DURATIONS[i] as number),
        song: {
          index: i + 1,
          previewUrl: `https://audio.example/preview/${i + 1}.m4a`,
          startedAt: enteredAt + START_DELAY_MS,
          endsAt: enteredAt + START_DELAY_MS + (DURATIONS[i] as number),
          durationMs: DURATIONS[i],
          titleLength: expectedLength[i],
          correctIds: [],
        },
      });
      if (i > 0) expect(eventsOf(lastAsync())).toEqual(['round:update', 'players:update']);

      // 試聽結束前一毫秒還在 playing
      clock.advance(START_DELAY_MS + (DURATIONS[i] as number) - 1);
      expect(room.currentRound().phase).toBe('playing');
      clock.advance(1);

      // ── reveal ──
      const revealAt = clock.now();
      const reveal = room.currentRound();
      expect(reveal).toMatchObject({
        phase: 'reveal',
        endsAt: revealAt + REVEAL_MS,
        serverNow: revealAt,
        results: null,
        reveal: {
          index: i + 1,
          title: TITLES[i],
          artist: '孫燕姿',
          album: `專輯${i + 1}`,
          artworkUrl: `https://img.example/${i + 1}/100x100bb.jpg`,
          itunesUrl: `https://music.example/track/${i + 1}`,
          scores: [],
        },
      });
      // song 在 reveal 保留（客戶端可繼續顯示進度）
      expect(reveal.song).toMatchObject({ index: i + 1, durationMs: DURATIONS[i] });
      expect(eventsOf(lastAsync())).toEqual(['round:update', 'chat:message']);
      expect(chats(lastAsync())[0]).toMatchObject({ kind: 'system', text: `第 ${i + 1} 首：《${TITLES[i]}》` });

      // 第 5 首同樣停滿揭曉時間
      clock.advance(REVEAL_MS - 1);
      expect(room.currentRound().phase).toBe('reveal');
      clock.advance(1);
    }

    // ── ended ──
    const ended = room.currentRound();
    expect(ended).toMatchObject({
      gameNo: 1,
      phase: 'ended',
      setterId: A,
      artist: '孫燕姿',
      artistDisplay: '孫燕姿',
      endsAt: null,
      song: null,
      lastArtist: '孫燕姿',
      participantIds: [A, B],
      results: [
        { playerId: A, nickname: 'Alice', rank: 1, gameScore: 0, correctCount: 0 },
        { playerId: B, nickname: 'Bob', rank: 2, gameScore: 0, correctCount: 0 },
      ],
    });
    expect(ended.reveal).toMatchObject({ index: 5, title: TITLES[4] });
    expect(eventsOf(lastAsync())).toEqual(['round:update', 'players:update', 'chat:message']);
    expect(chats(lastAsync())[0]?.text).toBe('本局結束：沒有人猜對');
    // ended 沒有計時器；isSetter 仍為 true
    expect(clock.timers.size).toBe(0);
    expect(player(A).isSetter).toBe(true);
    // 一局總長＝5 ×（起播緩衝＋播放＋揭曉）
    const total = DURATIONS.reduce((sum, d) => sum + START_DELAY_MS + d + REVEAL_MS, 0);
    expect(clock.now() - 1_700_000_000_000).toBe(total);
  });

  it('每次 round:update 的 serverNow 都是送出當下的時鐘', async () => {
    const out = await toPlaying();
    expect(rounds(out.effects)[0]?.serverNow).toBe(clock.now());
    clock.advance(4321);
    const guess = room.chat('s2', '遇見');
    expect(rounds(guess.effects)[0]?.serverNow).toBe(clock.now());
    finishSong();
    expect(rounds(lastAsync())[0]?.serverNow).toBe(clock.now());
    clock.advance(777);
    expect(room.snapshot(A).round.serverNow).toBe(clock.now());
  });

  it('全員猜對也不提早結束；猜對後歌繼續播到 endsAt', async () => {
    await toPlaying();
    clock.advance(START_DELAY_MS + 1000);
    ok(room.chat('s1', '遇見'));
    ok(room.chat('s2', '遇見'));
    const { song, endsAt } = room.currentRound();
    expect(room.currentRound().phase).toBe('playing');
    expect(song?.correctIds).toEqual([A, B]);
    clock.advance((endsAt as number) - clock.now() - 1);
    expect(room.currentRound().phase).toBe('playing');
    clock.advance(1);
    expect(room.currentRound().phase).toBe('reveal');
  });

  it('局中在線人數掉到 1 人、0 人都照走不中止', async () => {
    await toPlaying(3);
    room.disconnect('s2');
    room.disconnect('s3');
    nextSong();
    expect(room.currentRound()).toMatchObject({ phase: 'playing', song: { index: 2 } });
    room.disconnect('s1');
    nextSong();
    expect(room.currentRound()).toMatchObject({ phase: 'playing', song: { index: 3 } });
  });

  it('所有人都離開（寬限期滿）後局仍走到 ended，results 為空', async () => {
    await toPlaying(2);
    room.disconnect('s1');
    room.disconnect('s2');
    clock.advance(GRACE_MS);
    expect(room.playerList()).toEqual([]);
    for (let i = 0; i < SONGS_PER_GAME; i++) nextSong();
    expect(room.currentRound()).toMatchObject({ phase: 'ended', results: [], participantIds: [] });
    expect(clock.timers.size).toBe(0);
  });
});

// ─── 猜題與計分 ───────────────────────────────────────────────────

describe('猜題：猜對', () => {
  it('效果順序：chat:message（correct，不含原文）→ players:update → round:update', async () => {
    await toPlaying();
    clock.advance(START_DELAY_MS);
    const out = room.chat('s2', ' 遇 見 ');
    ok(out);
    expect(eventsOf(out.effects)).toEqual(['chat:message', 'players:update', 'round:update']);
    expect(chats(out.effects)).toEqual([{ id: expect.any(String), kind: 'correct', fromId: B, nickname: 'Bob', text: 'Bob 猜對了', at: clock.now() }]);
    expect(JSON.stringify(out.effects)).not.toContain('遇見');
    expect(playersOf(out.effects).find((p) => p.id === B)).toMatchObject({ hasGuessed: true, score: 100, gameScore: 100 });
    expect(rounds(out.effects)[0]).toMatchObject({ phase: 'playing', song: { index: 1, correctIds: [B] } });
    // 聊天紀錄留的也是「猜對了」，不是原文
    expect(room.snapshot(A).chat.at(-1)).toMatchObject({ kind: 'correct', text: 'Bob 猜對了' });
  });

  it('計分：100 − floor(50 × 已用毫秒 / 播放毫秒)，從 startedAt 起算', async () => {
    joinPlayers(4);
    ok(room.volunteer('s1'));
    await room.setArtist('s1', '孫燕姿');
    clock.advance(START_DELAY_MS); // startedAt
    ok(room.chat('s1', '遇見')); // 0 秒
    clock.advance(599);
    ok(room.chat('s2', '遇見')); // 0.599 秒：floor(50×599/30000)=0
    clock.advance(1);
    ok(room.chat('s3', '遇見')); // 0.6 秒：floor(1)=1
    clock.advance(14_400);
    ok(room.chat('s4', '遇見')); // 15 秒：25
    expect(room.playerList().map((p) => p.gameScore)).toEqual([100, 100, 99, 75]);
  });

  it('計分邊界：最後一毫秒 51 分；剛好 endsAt（計時器尚未觸發）50 分', async () => {
    await toPlaying();
    clock.advance(START_DELAY_MS + CAP - 1);
    ok(room.chat('s1', '遇見'));
    expect(player(A).gameScore).toBe(51);
    // 讓時鐘走到 endsAt 但不觸發計時器（模擬計時器延遲）：直接改 now
    clock.t += 1;
    expect(room.currentRound().phase).toBe('playing');
    ok(room.chat('s2', '遇見'));
    expect(player(B).gameScore).toBe(50);
  });

  it('計時器嚴重延遲（now 超過 endsAt）仍夾在最低分 50', async () => {
    await toPlaying();
    clock.t += START_DELAY_MS + CAP + 5000;
    ok(room.chat('s2', '遇見'));
    expect(player(B).gameScore).toBe(50);
  });

  it('startedAt 之前（起播緩衝中）猜對 → 滿分', async () => {
    await toPlaying();
    expect(clock.now()).toBeLessThan(room.currentRound().song?.startedAt as number);
    ok(room.chat('s2', '遇見'));
    expect(player(B)).toMatchObject({ gameScore: 100, score: 100, hasGuessed: true });
    clock.advance(START_DELAY_MS - 1);
    ok(room.chat('s1', '遇見'));
    expect(player(A).gameScore).toBe(100);
  });

  it('播放長度不是 30 秒的歌：以該首的 durationMs 計分', async () => {
    await toPlaying();
    for (let i = 0; i < 3; i++) nextSong();
    expect(room.currentRound().song).toMatchObject({ index: 4, durationMs: 20_000 });
    clock.advance(START_DELAY_MS + 10_000);
    ok(room.chat('s2', '天黑黑'));
    expect(player(B).gameScore).toBe(75);
  });

  it('多人猜對：correctIds 與 reveal.scores 依猜對順序；出題者也可以猜、沒有額外加分', async () => {
    await toPlaying(3);
    clock.advance(START_DELAY_MS + 6000);
    ok(room.chat('s3', '遇見')); // 90
    clock.advance(6000);
    ok(room.chat('s1', '遇見')); // 出題者，80
    clock.advance(6000);
    ok(room.chat('s2', '遇見')); // 70
    expect(room.currentRound().song?.correctIds).toEqual([C, A, B]);
    expect(room.playerList().map((p) => [p.id, p.gameScore, p.score, p.hasGuessed])).toEqual([
      [A, 80, 80, true],
      [B, 70, 70, true],
      [C, 90, 90, true],
    ]);
    finishSong();
    expect(room.currentRound().reveal?.scores).toEqual([
      { playerId: C, score: 90 },
      { playerId: A, score: 80 },
      { playerId: B, score: 70 },
    ]);
    // 揭曉沒有額外加分；hasGuessed 在 reveal 保留
    expect(room.playerList().map((p) => [p.score, p.hasGuessed])).toEqual([
      [80, true],
      [70, true],
      [90, true],
    ]);
  });

  it('各種算對的打法：歌名本身、完整歌名、全形、大小寫、標點', async () => {
    joinPlayers(4);
    ok(room.volunteer('s1'));
    await room.setArtist('s1', '孫燕姿');
    nextSong(); // 第 2 首：如果可以 (電影"月老"主題曲)
    ok(room.chat('s1', '如果可以'));
    ok(room.chat('s2', '如果可以 (電影"月老"主題曲)'));
    ok(room.chat('s3', '如果可以（電影《月老》主題曲）'));
    nextSong(); // 第 3 首：I'm gonna TOESA (feat. Kian84)
    ok(say('s1', 'IM GONNA TOESA'));
    ok(say('s2', "I'm gonna TOESA (feat. Kian84)"));
    ok(say('s3', 'ｉ’ｍ　ｇｏｎｎａ　ｔｏｅｓａ'));
    ok(say('s4', "i'm gonna toesa feat. kian84"));
    expect(room.currentRound().song?.correctIds).toEqual([A, B, C, D]);
  });

  it('猜對的那則也更新間隔時間戳；被擋下的不更新', async () => {
    await toPlaying();
    expect(room.chat('s2', '是遇見嗎').ack).toMatchObject({ ok: false, error: 'SPOILER_BLOCKED' });
    ok(room.chat('s2', '遇見')); // 上一則被擋，不算發言 → 不會 RATE_LIMITED
    expect(room.chat('s2', '耶').ack).toMatchObject({ ok: false, error: 'RATE_LIMITED' });
  });

  it('猜錯照常廣播（可以聊天、討論）', async () => {
    await toPlaying();
    const out = room.chat('s2', '綠光？');
    ok(out);
    expect(chats(out.effects)[0]).toMatchObject({ kind: 'chat', fromId: B, text: '綠光？' });
    expect(eventsOf(out.effects)).toEqual(['chat:message']);
    expect(player(B)).toMatchObject({ hasGuessed: false, gameScore: 0 });
  });
});

describe('猜題：兩種 SPOILER_BLOCKED', () => {
  it('未猜對者：訊息含歌名但不完全相同 → 擋下「猜歌名請只輸入歌名本身」、不廣播、不得分', async () => {
    await toPlaying();
    for (const text of ['是遇見嗎', '遇見吧', '我猜（遇見）', '遇 見 ！！對吧']) {
      const out = say('s2', text);
      expect(out).toEqual({ ack: { ok: false, error: 'SPOILER_BLOCKED', message: '猜歌名請只輸入歌名本身' }, effects: [] });
    }
    expect(player(B)).toMatchObject({ hasGuessed: false, gameScore: 0 });
    expect(room.snapshot(A).chat.some((m) => m.text.includes('遇見'))).toBe(false);
    // 之後只打歌名仍可得分
    ok(say('s2', '遇見'));
    expect(player(B).hasGuessed).toBe(true);
  });

  it('已猜對者：之後的訊息含歌名 → 擋下「你已經猜對了，不要說出歌名」；不含歌名照常廣播；不能再得分', async () => {
    await toPlaying();
    clock.advance(START_DELAY_MS);
    ok(room.chat('s2', '遇見'));
    for (const text of ['遇見', '答案是遇見啦', '遇．見', '遇見 (Live)']) {
      const out = say('s2', text);
      expect(out).toEqual({ ack: { ok: false, error: 'SPOILER_BLOCKED', message: '你已經猜對了，不要說出歌名' }, effects: [] });
    }
    const fine = say('s2', '這首我會');
    ok(fine);
    expect(chats(fine.effects)[0]).toMatchObject({ kind: 'chat', text: '這首我會' });
    expect(player(B)).toMatchObject({ gameScore: 100, score: 100 });
    expect(room.currentRound().song?.correctIds).toEqual([B]);
  });

  it('出題者一樣受兩種規則限制（他也不知道答案）', async () => {
    await toPlaying();
    expect(room.chat('s1', '是遇見嗎').ack).toMatchObject({ ok: false, error: 'SPOILER_BLOCKED', message: '猜歌名請只輸入歌名本身' });
    ok(room.chat('s1', '遇見'));
    expect(say('s1', '遇見啦').ack).toMatchObject({ ok: false, error: 'SPOILER_BLOCKED', message: '你已經猜對了，不要說出歌名' });
  });

  it('下一首開始後 hasGuessed 清空：上一首的歌名可以說，這一首的不行', async () => {
    await toPlaying();
    ok(room.chat('s2', '遇見'));
    nextSong();
    expect(eventsOf(lastAsync())).toEqual(['round:update', 'players:update']);
    expect(playersOf(lastAsync()).every((p) => !p.hasGuessed)).toBe(true);
    ok(say('s2', '剛剛那首是遇見'));
    expect(say('s2', '這首是如果可以吧').ack).toMatchObject({ ok: false, error: 'SPOILER_BLOCKED', message: '猜歌名請只輸入歌名本身' });
    ok(say('s2', '如果可以'));
    expect(player(B)).toMatchObject({ hasGuessed: true });
  });

  it('副標裡的字不算洩題', async () => {
    await toPlaying();
    nextSong(); // 如果可以 (電影"月老"主題曲)
    ok(say('s2', '是月老的主題曲'));
  });
});

// ─── 排名、累計、生命週期 ─────────────────────────────────────────

describe('ended：本局排名與得分累計', () => {
  it('五首累計：gameScore、correctCount、同分先達到者在前、0 分者依參賽順序；系統訊息', async () => {
    await toPlaying(4);
    // 第 1 首：B 100
    ok(room.chat('s2', ANSWERS[0] as string));
    nextSong();
    // 第 2 首：C 100、D 15 秒 75
    ok(room.chat('s3', ANSWERS[1] as string));
    clock.advance(START_DELAY_MS + 15_000);
    ok(room.chat('s4', ANSWERS[1] as string));
    nextSong();
    // 第 3 首：D 15 秒 75（D 累計 150）
    clock.advance(START_DELAY_MS + 15_000);
    ok(room.chat('s4', ANSWERS[2] as string));
    nextSong();
    // 第 4 首（20 秒）：B 10 秒 75（B 累計 175）
    clock.advance(START_DELAY_MS + 10_000);
    ok(room.chat('s2', ANSWERS[3] as string));
    nextSong();
    // 第 5 首：C 15 秒 75（C 累計 175，比 B 晚達到）
    clock.advance(START_DELAY_MS + 15_000);
    ok(room.chat('s3', ANSWERS[4] as string));
    nextSong();

    const ended = room.currentRound();
    expect(ended.phase).toBe('ended');
    expect(ended.results).toEqual([
      { playerId: B, nickname: 'Bob', rank: 1, gameScore: 175, correctCount: 2 },
      { playerId: C, nickname: 'Carol', rank: 2, gameScore: 175, correctCount: 2 },
      { playerId: D, nickname: 'Dave', rank: 3, gameScore: 150, correctCount: 2 },
      { playerId: A, nickname: 'Alice', rank: 4, gameScore: 0, correctCount: 0 },
    ]);
    expect(ended.reveal).toMatchObject({ index: 5, scores: [{ playerId: C, score: 75 }] });
    expect(chats(lastAsync())[0]?.text).toBe('本局第一名：Bob（175 分）');
    expect(room.playerList().map((p) => [p.gameScore, p.score, p.hasGuessed])).toEqual([
      [0, 0, false],
      [175, 175, false],
      [175, 175, false],
      [150, 150, false],
    ]);
  });

  it('results／lastArtist 生命週期：ended 有值 → 下一局 choosing 與取消回 idle 都保留 → 搜尋成功進第 1 首才清', async () => {
    await toPlaying();
    ok(room.chat('s2', '遇見'));
    for (let i = 0; i < SONGS_PER_GAME; i++) nextSong();
    const results = room.currentRound().results;
    expect(results).toHaveLength(2);
    expect(room.currentRound()).toMatchObject({ phase: 'ended', lastArtist: '孫燕姿' });

    // 下一局 choosing：保留；reveal、artist、participantIds 清掉；上一局出題者的 isSetter 清掉
    ok(room.volunteer('s2'));
    expect(room.currentRound()).toMatchObject({
      phase: 'choosing',
      gameNo: 1,
      setterId: B,
      artist: null,
      artistDisplay: null,
      song: null,
      reveal: null,
      results,
      lastArtist: '孫燕姿',
      participantIds: [],
    });
    expect(room.playerList().map((p) => p.isSetter)).toEqual([false, true]);
    // gameScore 保留到下一局開始
    expect(player(B)).toMatchObject({ gameScore: 100, score: 100 });

    // 取消 → idle：仍保留
    ok(room.cancel('s2'));
    expect(room.currentRound()).toMatchObject({ phase: 'idle', setterId: null, results, lastArtist: '孫燕姿' });
    // 中途加入者的快照也看得到上一局排名
    expect(joinOk('s3', 'Carol').data.snapshot.round).toMatchObject({ phase: 'idle', results, lastArtist: '孫燕姿' });

    // 搜尋失敗：仍保留
    room.dispose();
  });

  it('下一局搜尋成功：gameNo 2、results／lastArtist 清空、全員 gameScore 歸零、總分保留', async () => {
    await toPlaying();
    ok(room.chat('s2', '遇見'));
    for (let i = 0; i < SONGS_PER_GAME; i++) nextSong();
    ok(room.volunteer('s2'));
    const out = await room.setArtist('s2', '孫燕姿');
    expect(rounds(out.effects)[0]).toMatchObject({
      gameNo: 2,
      phase: 'playing',
      setterId: B,
      results: null,
      lastArtist: null,
      reveal: null,
      song: { index: 1, correctIds: [] },
    });
    expect(playersOf(out.effects).map((p) => [p.gameScore, p.score, p.isSetter])).toEqual([
      [0, 0, false],
      [0, 100, true],
    ]);
    // 第二局再得分：總分累加
    ok(room.chat('s2', '遇見'));
    expect(player(B)).toMatchObject({ gameScore: 100, score: 200 });
  });

  it('下一局搜尋失敗或查無時 results 仍保留', async () => {
    let tracks: ItunesTrack[] | null = TRACKS;
    room = makeRoom({ search: () => (tracks === null ? Promise.reject(new Error('x')) : Promise.resolve(tracks)) });
    await toPlaying();
    for (let i = 0; i < SONGS_PER_GAME; i++) nextSong();
    const { results } = room.currentRound();
    ok(room.volunteer('s1'));
    tracks = null;
    expect((await room.setArtist('s1', '孫燕姿')).ack).toMatchObject({ error: 'SEARCH_FAILED' });
    expect(room.currentRound()).toMatchObject({ phase: 'choosing', results, lastArtist: '孫燕姿' });
    tracks = [];
    expect((await room.setArtist('s1', '孫燕姿')).ack).toMatchObject({ error: 'ARTIST_NOT_FOUND' });
    expect(room.currentRound()).toMatchObject({ phase: 'choosing', results, lastArtist: '孫燕姿', gameNo: 1 });
  });
});

// ─── 中途加入、離開、重連 ─────────────────────────────────────────

describe('中途加入', () => {
  it('快照帶進行中的那首（previewUrl、startedAt、serverNow）；不進 participantIds；可猜可得分；列入排名', async () => {
    await toPlaying();
    const startedAt = room.currentRound().song?.startedAt as number;
    clock.advance(START_DELAY_MS + 12_000);
    const late = joinOk('s3', 'Carol');
    const { round, players } = late.data.snapshot;
    expect(round).toMatchObject({
      phase: 'playing',
      artist: '孫燕姿',
      artistDisplay: '孫燕姿',
      serverNow: clock.now(),
      participantIds: [A, B],
      song: { index: 1, previewUrl: 'https://audio.example/preview/1.m4a', startedAt, durationMs: CAP },
    });
    // 客戶端以 serverNow − startedAt 定位：已播 12 秒
    expect(round.serverNow - (round.song?.startedAt as number)).toBe(12_000);
    expect(players.find((p) => p.id === C)).toMatchObject({ gameScore: 0, hasGuessed: false });
    // 加入不會改 participantIds，也不發 round:update
    expect(eventsOf(late.effects)).toEqual(['players:update', 'chat:message']);

    const out = room.chat('s3', '遇見');
    ok(out);
    expect(player(C)).toMatchObject({ gameScore: 80, score: 80, hasGuessed: true });
    expect(rounds(out.effects)[0]).toMatchObject({ participantIds: [A, B], song: { correctIds: [C] } });

    for (let i = 0; i < SONGS_PER_GAME; i++) nextSong();
    expect(room.currentRound()).toMatchObject({
      participantIds: [A, B],
      results: [
        { playerId: C, nickname: 'Carol', rank: 1, gameScore: 80, correctCount: 1 },
        { playerId: A, rank: 2, gameScore: 0 },
        { playerId: B, rank: 3, gameScore: 0 },
      ],
    });
  });

  it('中途加入但沒得分 → 不列入排名', async () => {
    await toPlaying();
    joinOk('s3', 'Carol');
    for (let i = 0; i < SONGS_PER_GAME; i++) nextSong();
    expect(room.currentRound().results?.map((r) => r.playerId)).toEqual([A, B]);
  });

  it('reveal 中加入：快照帶揭曉資料與 song；ended 中加入：帶 results 與最後一首', async () => {
    await toPlaying();
    finishSong();
    const inReveal = joinOk('s3', 'Carol').data.snapshot.round;
    expect(inReveal).toMatchObject({ phase: 'reveal', reveal: { index: 1, title: '遇見' }, song: { index: 1 } });
    clock.advance(REVEAL_MS);
    for (let i = 1; i < SONGS_PER_GAME; i++) nextSong();
    const inEnded = joinOk('s4', 'Dave').data.snapshot.round;
    expect(inEnded).toMatchObject({ phase: 'ended', song: null, reveal: { index: 5 }, lastArtist: '孫燕姿' });
    expect(inEnded.results?.map((r) => r.playerId)).toEqual([A, B]);
  });
});

describe('離開（寬限期滿）', () => {
  it('局中離開：從 participantIds 移除、即使已得分也不進本局排名；本首的 correctIds 一併移除', async () => {
    await toPlaying(3);
    clock.advance(START_DELAY_MS);
    ok(room.chat('s2', '遇見'));
    ok(room.chat('s3', '遇見'));
    room.disconnect('s2');
    // 寬限期內仍是參賽者、仍在 correctIds
    expect(room.currentRound()).toMatchObject({ participantIds: [A, B, C], song: { correctIds: [B, C] } });
    clock.advance(GRACE_MS);
    expect(eventsOf(lastAsync())).toEqual(['players:update', 'chat:message', 'round:update']);
    expect(rounds(lastAsync())[0]).toMatchObject({ phase: 'playing', participantIds: [A, C], song: { index: 1, correctIds: [C] } });
    expect(chats(lastAsync())[0]?.text).toBe('Bob 離開');
    finishSong();
    expect(room.currentRound().reveal?.scores).toEqual([{ playerId: C, score: 100 }]);
    clock.advance(REVEAL_MS);
    for (let i = 1; i < SONGS_PER_GAME; i++) nextSong();
    expect(room.currentRound().results).toEqual([
      { playerId: C, nickname: 'Carol', rank: 1, gameScore: 100, correctCount: 1 },
      { playerId: A, nickname: 'Alice', rank: 2, gameScore: 0, correctCount: 0 },
    ]);
  });

  it('reveal 中離開：reveal.scores 也移除', async () => {
    await toPlaying(3);
    ok(room.chat('s2', '遇見'));
    ok(room.chat('s3', '遇見'));
    finishSong();
    room.disconnect('s2');
    clock.advance(REVEAL_MS - 1);
    // 寬限期（15 秒）比揭曉（5 秒）長：先進下一首，之後才離開
    clock.advance(1);
    expect(room.currentRound().song).toMatchObject({ index: 2, correctIds: [] });
    room.dispose();

    // 縮短寬限期，讓離開落在 reveal 內
    room = makeRoom({ durations: { graceMs: 1000 } });
    await toPlaying(3);
    ok(room.chat('s2', '遇見'));
    ok(room.chat('s3', '遇見'));
    finishSong();
    room.disconnect('s2');
    clock.advance(1000);
    expect(room.currentRound()).toMatchObject({
      phase: 'reveal',
      participantIds: [A, C],
      song: { correctIds: [C] },
      reveal: { index: 1, scores: [{ playerId: C, score: 100 }] },
    });
  });

  it('出題者在 playing／reveal 離開不影響：局照走、setterId 不變', async () => {
    await toPlaying(3);
    room.disconnect('s1');
    clock.advance(GRACE_MS);
    expect(room.currentRound()).toMatchObject({ phase: 'playing', setterId: A, participantIds: [B, C] });
    for (let i = 0; i < SONGS_PER_GAME; i++) nextSong();
    expect(room.currentRound()).toMatchObject({ phase: 'ended', setterId: A });
    expect(room.currentRound().results?.map((r) => r.playerId)).toEqual([B, C]);
    ok(room.volunteer('s2'));
  });

  it('非參賽者（中途加入、沒猜對）離開：round 不變、不發 round:update', async () => {
    await toPlaying(2);
    joinOk('s3', 'Carol');
    room.disconnect('s3');
    clock.advance(GRACE_MS);
    expect(eventsOf(lastAsync())).toEqual(['players:update', 'chat:message']);
    expect(room.currentRound().participantIds).toEqual([A, B]);
  });

  it('中途加入者猜對後離開：correctIds 移除、不進排名', async () => {
    await toPlaying(2);
    joinOk('s3', 'Carol');
    ok(room.chat('s3', '遇見'));
    room.disconnect('s3');
    clock.advance(GRACE_MS);
    expect(room.currentRound().song?.correctIds).toEqual([]);
    for (let i = 0; i < SONGS_PER_GAME; i++) nextSong();
    expect(room.currentRound().results?.map((r) => r.playerId)).toEqual([A, B]);
  });

  it('ended 之後才離開：results 與 reveal 不變（只從 participantIds 移除）', async () => {
    await toPlaying(3);
    ok(room.chat('s2', '遇見'));
    for (let i = 0; i < 4; i++) nextSong();
    ok(room.chat('s2', '愛'));
    nextSong();
    const before = room.currentRound();
    expect(before.phase).toBe('ended');
    expect(before.results?.[0]).toMatchObject({ playerId: B, gameScore: 200, correctCount: 2 });
    room.disconnect('s2');
    clock.advance(GRACE_MS);
    const after = room.currentRound();
    expect(after.results).toEqual(before.results);
    expect(after.reveal).toEqual(before.reveal);
    expect(after.reveal?.scores).toEqual([{ playerId: B, score: 100 }]);
    expect(after.participantIds).toEqual([A, C]);
    expect(after.phase).toBe('ended');
    // 之後進到下一局的 idle／choosing 也還在
    ok(room.volunteer('s1'));
    expect(room.currentRound().results).toEqual(before.results);
  });

  it('離開後總分隨玩家物件消失；同暱稱重新加入從 0 開始', async () => {
    await toPlaying();
    ok(room.chat('s2', '遇見'));
    room.disconnect('s2');
    clock.advance(GRACE_MS);
    const again = joinOk('s5', 'Bob');
    expect(again.data.snapshot.players.find((p) => p.nickname === 'Bob')).toMatchObject({ score: 0, gameScore: 0 });
  });
});

describe('重連（token 接管）', () => {
  it('playing 中重連：id 不變、仍是參賽者、已猜對狀態與分數保留；快照可定位播放位置', async () => {
    await toPlaying();
    clock.advance(START_DELAY_MS + 3000);
    ok(room.chat('s2', '遇見'));
    room.disconnect('s2');
    expect(player(B).connected).toBe(false);
    clock.advance(5000);
    const back = joinOk('s9', 'whatever', 'id4');
    expect(back.data.snapshot.you).toBe(B);
    expect(back.data.token).toBe('id4');
    expect(eventsOf(back.effects)).toEqual(['players:update']);
    const { round, players } = back.data.snapshot;
    expect(round).toMatchObject({ phase: 'playing', participantIds: [A, B], serverNow: clock.now(), song: { index: 1, correctIds: [B] } });
    expect(round.serverNow - (round.song?.startedAt as number)).toBe(8000);
    expect(players.find((p) => p.id === B)).toMatchObject({ connected: true, hasGuessed: true, gameScore: 95, score: 95 });
    // 重連後仍不能洩題
    expect(say('s9', '遇見').ack).toMatchObject({ ok: false, error: 'SPOILER_BLOCKED', message: '你已經猜對了，不要說出歌名' });
    // 寬限計時已取消
    clock.advance(GRACE_MS);
    expect(room.playerList().map((p) => p.id)).toEqual([A, B]);
  });

  it('舊連線還在時接管：踢掉舊 socket，舊 socket 的 disconnect 被忽略', async () => {
    await toPlaying();
    const out = joinOk('s9', 'x', 'id4');
    expect(out.effects).toEqual([{ kind: 'disconnect', socketId: 's2' }]);
    expect(room.disconnect('s2')).toEqual([]);
    expect(player(B).connected).toBe(true);
    ok(room.chat('s9', '遇見'));
  });

  it('ended 後重連：快照帶 results、lastArtist、最後一首的揭曉', async () => {
    await toPlaying();
    for (let i = 0; i < SONGS_PER_GAME; i++) nextSong();
    room.disconnect('s1');
    const back = joinOk('s9', 'x', 'id2');
    expect(back.data.snapshot.round).toMatchObject({ phase: 'ended', lastArtist: '孫燕姿', reveal: { index: 5 }, song: null });
    expect(back.data.snapshot.round.results).toHaveLength(2);
  });

  it('token 已失效（寬限期滿）→ 當新玩家加入', async () => {
    joinPlayers(2);
    room.disconnect('s2');
    clock.advance(GRACE_MS);
    const again = joinOk('s9', 'Bob', 'id4');
    expect(again.data.snapshot.you).not.toBe(B);
  });
});

// ─── 其他 ─────────────────────────────────────────────────────────

describe('計時長度與定格', () => {
  it('durations 可覆寫；值為 undefined 的欄位用預設（不會變成 NaN）', async () => {
    room = makeRoom({ durations: { startDelayMs: 100, previewCapMs: 2000, revealMs: 300, choosingMs: undefined } });
    toChoosing(2);
    expect(room.currentRound().endsAt).toBe(clock.now() + CHOOSING_MS);
    await room.setArtist('s1', '孫燕姿');
    const now = clock.now();
    expect(room.currentRound().song).toMatchObject({ startedAt: now + 100, durationMs: 2000, endsAt: now + 2100 });
    clock.advance(2100);
    expect(room.currentRound()).toMatchObject({ phase: 'reveal', endsAt: clock.now() + 300 });
    clock.advance(300);
    expect(room.currentRound().song).toMatchObject({ index: 2, durationMs: 2000 });
  });

  it('全長短於上限 → durationMs 取全長；沒有全長或不是正數 → 取上限', async () => {
    const tracks = [
      track(1, '短歌', { trackTimeMillis: 12_345 }),
      track(2, '沒長度', { trackTimeMillis: null }),
      track(3, '零長度', { trackTimeMillis: 0 }),
      track(4, '長歌', { trackTimeMillis: 300_000 }),
      track(5, '剛好', { trackTimeMillis: CAP }),
    ];
    room = makeRoom({ search: () => Promise.resolve(tracks) });
    toChoosing(2);
    await room.setArtist('s1', '孫燕姿');
    const seen: number[] = [];
    for (let i = 0; i < SONGS_PER_GAME; i++) {
      seen.push(room.currentRound().song?.durationMs as number);
      nextSong();
    }
    expect(seen).toEqual([12_345, CAP, CAP, CAP, CAP]);
  });

  it('同一次轉移只取一次時鐘：serverNow 與算 endsAt／startedAt 的 now 是同一個值（每讀一次就走 1 ms 的時鐘也不會差）', async () => {
    // 真實時鐘下連讀兩次可能跨過毫秒；若 payload 的 serverNow 另外再取一次，客戶端就會看到 endsAt − serverNow 少 1 ms
    class TickingClock extends FakeClock {
      override now(): number {
        return this.t++;
      }
    }
    clock = new TickingClock();
    room = makeRoom();
    joinPlayers(2);
    const vol = room.volunteer('s1');
    const choosing = rounds(vol.effects)[0] as RoundPublic;
    expect((choosing.endsAt as number) - choosing.serverNow).toBe(CHOOSING_MS);

    const set = await room.setArtist('s1', '孫燕姿');
    const playing = rounds(set.effects)[0] as RoundPublic;
    expect((playing.song?.startedAt as number) - playing.serverNow).toBe(START_DELAY_MS);
    expect((playing.endsAt as number) - playing.serverNow).toBe(START_DELAY_MS + CAP);

    // 猜對：correct 訊息的 at、round 的 serverNow 與計分用的 now 相同 → 以 at 代入計分式可驗算出同一個分數
    clock.t += START_DELAY_MS + 7777;
    const guess = room.chat('s2', '遇見');
    const msg = chats(guess.effects)[0] as ChatMessage;
    const after = rounds(guess.effects)[0] as RoundPublic;
    expect(after.serverNow).toBe(msg.at);
    const elapsed = msg.at - (after.song?.startedAt as number);
    expect(playersOf(guess.effects).find((p) => p.id === B)?.gameScore).toBe(100 - Math.floor((50 * elapsed) / CAP));

    // 揭曉：endsAt − serverNow 剛好是揭曉停留；系統訊息的 at 也是同一刻
    // （這個時鐘每讀一次就走 1 ms，計時器的到期時刻會比 endsAt 晚幾毫秒，所以多走一點）
    clock.advance((playing.endsAt as number) - clock.t + 100);
    const reveal = rounds(lastAsync())[0] as RoundPublic;
    expect(reveal.phase).toBe('reveal');
    expect((reveal.endsAt as number) - reveal.serverNow).toBe(REVEAL_MS);
    expect(chats(lastAsync())[0]?.at).toBe(reveal.serverNow);

    // 下一首（由計時器觸發）同樣只取一次
    clock.advance((reveal.endsAt as number) - clock.t + 100);
    const next = rounds(lastAsync())[0] as RoundPublic;
    expect(next.song?.index).toBe(2);
    expect((next.song?.startedAt as number) - next.serverNow).toBe(START_DELAY_MS);
  });

  it('已送出的 payload 是定格的複本：之後的狀態改變不影響', async () => {
    const out = await toPlaying();
    const sent = rounds(out.effects)[0] as RoundPublic;
    ok(room.chat('s2', '遇見'));
    expect(sent.song?.correctIds).toEqual([]);
    const snap = room.currentRound();
    snap.participantIds.push('x');
    snap.song?.correctIds.push('y');
    expect(room.currentRound()).toMatchObject({ participantIds: [A, B], song: { correctIds: [B] } });
  });

  it('recipients：只送給連線中的玩家', async () => {
    joinPlayers(3);
    room.disconnect('s2');
    expect(room.recipients('all').map((r) => r.playerId)).toEqual([A, C]);
    expect(room.recipients({ except: A }).map((r) => r.playerId)).toEqual([C]);
    expect(room.recipients({ only: B })).toEqual([]);
  });
});
