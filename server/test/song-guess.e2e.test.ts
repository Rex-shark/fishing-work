// 猜歌 e2e：起真正的 server（隨機埠），以 socket.io-client 打 /song-guess（spec/song-guess/architecture.md §4／§5）
// 題庫連 user/mock/itunes.mjs（真的走 itunes.ts 的 fetch、解析、快取與 picker）；計時以 AppOptions.songDurations 與假 iTunes 的短 trackTimeMillis 縮短。
// 不打真 iTunes（§6）。
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import {
  SONG_GUESS_NAMESPACE,
  SONGS_PER_GAME,
  normalizeTitle,
  stripSubtitle,
  type Ack,
  type ChatMessage,
  type ClientToServerEvents,
  type JoinResult,
  type PlayerPublic,
  type RoundPublic,
  type ServerToClientEvents,
} from '@fishing-work/shared/song-guess';
import { DRAW_GUESS_NAMESPACE } from '@fishing-work/shared';
import { DRAW_CONTEST_NAMESPACE } from '@fishing-work/shared/draw-contest';
import { createApp, type App, type AppOptions } from '../src/app';
import { createItunesClient, search as itunesSearch } from '../src/games/song-guess/itunes';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const mockPath = new URL('../../user/mock/itunes.mjs', import.meta.url).href;
interface MockItunes {
  url: string;
  close(): Promise<void>;
  requests: { method: string; path: string; term?: string }[];
}
async function startMock(options: Record<string, unknown> = {}): Promise<MockItunes> {
  const mod = (await import(mockPath)) as { startMockItunes: (o?: Record<string, unknown>) => Promise<MockItunes> };
  return mod.startMockItunes(options);
}

/** 假 iTunes 每首的全長（＝播放長度）；起播緩衝與揭曉停留也縮短 */
const TRACK_MS = 700;
const START_DELAY = 60;
const REVEAL_MS = 200;

let app: App | null = null;
let mock: MockItunes | null = null;
const sockets: ClientSocket[] = [];
let base = '';
/** 假 iTunes 的 trackId → 歌名（測試當裁判用：由 previewUrl 查出答案） */
const titleById = new Map<string, string>();

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  for (const s of sockets.splice(0)) s.disconnect();
  await app?.close();
  app = null;
  await mock?.close();
  mock = null;
  titleById.clear();
});

/** 起假 iTunes 與 server（server 的搜尋器指向假 iTunes） */
async function start(options: AppOptions = {}, mockOptions: Record<string, unknown> = {}): Promise<void> {
  mock = await startMock({ trackMs: TRACK_MS, slowMs: 300, ...mockOptions });
  const client = createItunesClient({ url: mock.url, country: 'TW', timeoutMs: 2000, cacheMs: 600_000 });
  app = createApp({
    port: 0,
    host: '127.0.0.1',
    songSearch: client.search,
    songDurations: { startDelayMs: START_DELAY, revealMs: REVEAL_MS, previewCapMs: 30_000 },
    ...options,
  });
  const { port } = await app.listen();
  base = `http://127.0.0.1:${port}`;
}

/** 向假 iTunes 查某位歌手的歌單，記下 trackId → 歌名 */
async function learn(artist: string): Promise<void> {
  if (mock === null) throw new Error('假 iTunes 尚未啟動');
  for (const t of await itunesSearch(artist, { url: mock.url, country: 'TW', timeoutMs: 2000 })) titleById.set(String(t.trackId), t.trackName);
}

function answerOf(round: RoundPublic | undefined): string {
  const id = /\/preview\/(\d+)\.m4a$/.exec(round?.song?.previewUrl ?? '')?.[1];
  const title = id === undefined ? undefined : titleById.get(id);
  if (title === undefined) throw new Error(`查不到答案：${round?.song?.previewUrl}`);
  return title;
}

async function connect(ns = SONG_GUESS_NAMESPACE): Promise<ClientSocket> {
  const s: ClientSocket = io(`${base}${ns}`, { transports: ['websocket'], forceNew: true, reconnection: false });
  sockets.push(s);
  await new Promise<void>((resolve, reject) => {
    s.once('connect', () => resolve());
    s.once('connect_error', reject);
  });
  return s;
}

function request<T = void>(s: ClientSocket, event: string, ...payload: unknown[]): Promise<Ack<T>> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), 4000);
    (s.emit as unknown as (ev: string, ...a: unknown[]) => void)(event, ...payload, (r: Ack<T>) => {
      clearTimeout(t);
      resolve(r);
    });
  });
}

async function joinOk(s: ClientSocket, nickname: string, token?: string): Promise<JoinResult> {
  const r = await request<JoinResult>(s, 'player:join', token === undefined ? { nickname } : { nickname, token });
  if (!r.ok) throw new Error(`join 失敗：${r.error}`);
  return r.data;
}

function collect<T>(s: ClientSocket, event: string): T[] {
  const out: T[] = [];
  (s.on as unknown as (ev: string, fn: (p: T) => void) => void)(event, (p: T) => out.push(p));
  return out;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, ms = 4000, label = 'condition'): Promise<void> {
  const startedAt = Date.now();
  while (!cond()) {
    if (Date.now() - startedAt > ms) throw new Error(`waitFor timeout: ${label}`);
    await sleep(5);
  }
}

describe('e2e /song-guess', () => {
  it('一局 5 首：出題 → 逐首播放、猜對計分、防洩題、揭曉 → ended 排名；中途加入與重連', async () => {
    await start();
    await learn('孫燕姿');
    const A = await connect();
    const B = await connect();
    const a = await joinOk(A, 'Alice');
    const b = await joinOk(B, 'Bob');
    const idA = a.snapshot.you;
    const idB = b.snapshot.you;
    const roundsA = collect<RoundPublic>(A, 'round:update');
    const roundsB = collect<RoundPublic>(B, 'round:update');
    const playersB = collect<PlayerPublic[]>(B, 'players:update');
    const chatA = collect<ChatMessage>(A, 'chat:message');
    const last = () => roundsB.at(-1);

    expect(await request(A, 'round:volunteer')).toEqual({ ok: true, data: undefined });
    await waitFor(() => last()?.phase === 'choosing', 4000, 'choosing');
    expect(await request(B, 'round:setArtist', { artist: '孫燕姿' })).toMatchObject({ ok: false, error: 'NOT_SETTER' });

    // 先 ack 再廣播：出題者收到 ack 時還沒收到 playing 的 round:update
    let playingSeenAtAck: boolean | null = null;
    const setAck = await new Promise<Ack<{ artistDisplay: string }>>((resolve) => {
      (A.emit as unknown as (ev: string, ...a: unknown[]) => void)('round:setArtist', { artist: ' 孫燕姿 ' }, (r: Ack<{ artistDisplay: string }>) => {
        playingSeenAtAck = roundsA.some((r2) => r2.phase === 'playing');
        resolve(r);
      });
    });
    expect(setAck).toEqual({ ok: true, data: { artistDisplay: '孫燕姿' } });
    expect(playingSeenAtAck).toBe(false);
    await waitFor(() => last()?.phase === 'playing', 4000, 'playing 1');

    const first = last() as RoundPublic;
    expect(first).toMatchObject({
      gameNo: 1,
      setterId: idA,
      artist: '孫燕姿',
      artistDisplay: '孫燕姿',
      songCount: SONGS_PER_GAME,
      participantIds: [idA, idB],
      results: null,
      reveal: null,
      song: { index: 1, durationMs: TRACK_MS, correctIds: [] },
    });
    expect(first.song?.previewUrl).toMatch(new RegExp(`^${mock?.url}/preview/\\d+\\.m4a$`));
    expect(first.song?.endsAt).toBe((first.song?.startedAt ?? 0) + TRACK_MS);
    expect(first.endsAt).toBe(first.song?.endsAt);
    expect(Math.abs(first.serverNow - Date.now())).toBeLessThan(1000);
    // serverNow 與算 startedAt 的 now 是真實時鐘下的兩個時間戳，契約沒保證是同一次取樣（分開取在機器忙時會差 1 ms）：
    // 不做嚴格相等，只驗方向（serverNow 不早於那個 now，差值只會少）與範圍。假時鐘的 room 測試才驗剛好相等。
    const lead = (first.song?.startedAt ?? 0) - first.serverNow;
    expect(lead).toBeLessThanOrEqual(START_DELAY);
    expect(lead).toBeGreaterThanOrEqual(START_DELAY - 50);

    const seenTitles: string[] = [];
    let expectedB = 0;
    let lateToken = '';
    for (let i = 1; i <= SONGS_PER_GAME; i++) {
      await waitFor(() => last()?.phase === 'playing' && last()?.song?.index === i, 4000, `playing ${i}`);
      const title = answerOf(last());
      seenTitles.push(title);
      expect(last()?.song?.titleLength).toBe([...normalizeTitle(title)].length);

      // 未猜對者含歌名但不完全相同 → 擋下
      expect(await request(A, 'chat:send', { text: `是${title}嗎` })).toEqual({
        ok: false,
        error: 'SPOILER_BLOCKED',
        message: '猜歌名請只輸入歌名本身',
      });
      // B 猜對（奇數首打歌名本身，偶數首打完整歌名）
      const guess = i % 2 === 1 ? stripSubtitle(title) : title;
      expect(await request(B, 'chat:send', { text: guess })).toEqual({ ok: true, data: undefined });
      await waitFor(() => last()?.song?.index === i && (last()?.song?.correctIds.length ?? 0) === 1, 4000, `correct ${i}`);
      expect(last()?.song?.correctIds).toEqual([idB]);
      expect(last()?.phase).toBe('playing');
      if (i === 1) {
        // 已猜對者再說歌名 → 擋下（等過發言間隔再送；這首還有約 0.4 秒才播完）
        await sleep(310);
        expect(await request(B, 'chat:send', { text: `${title}啦` })).toEqual({
          ok: false,
          error: 'SPOILER_BLOCKED',
          message: '你已經猜對了，不要說出歌名',
        });
      }

      if (i === 2) {
        // 中途加入：快照帶進行中的那首、不在 participantIds
        const C = await connect();
        const c = await joinOk(C, 'Carol');
        lateToken = c.token;
        expect(c.snapshot.round).toMatchObject({ phase: 'playing', participantIds: [idA, idB], song: { index: 2, correctIds: [idB] } });
        expect(c.snapshot.players.find((p) => p.id === idB)).toMatchObject({ hasGuessed: true });
        expect(c.snapshot.round.song?.previewUrl).toBe(last()?.song?.previewUrl);
        // 重連：同一身分
        C.disconnect();
        const C2 = await connect();
        const again = await joinOk(C2, 'ignored', lateToken);
        expect(again.snapshot.you).toBe(c.snapshot.you);
      }

      await waitFor(() => last()?.phase === 'reveal' && last()?.reveal?.index === i, 4000, `reveal ${i}`);
      const reveal = last() as RoundPublic;
      expect(reveal.reveal).toMatchObject({ index: i, title, artist: expect.stringContaining('孫燕姿') });
      expect(reveal.reveal?.scores).toHaveLength(1);
      const score = reveal.reveal?.scores[0]?.score ?? 0;
      expect(reveal.reveal?.scores[0]?.playerId).toBe(idB);
      expect(score).toBeGreaterThanOrEqual(50);
      expect(score).toBeLessThanOrEqual(100);
      expectedB += score;
      expect(reveal.song?.index).toBe(i);
    }

    await waitFor(() => last()?.phase === 'ended', 4000, 'ended');
    const ended = last() as RoundPublic;
    expect(new Set(seenTitles.map((t) => stripSubtitle(t))).size).toBe(SONGS_PER_GAME);
    expect(ended).toMatchObject({
      phase: 'ended',
      song: null,
      endsAt: null,
      lastArtist: '孫燕姿',
      reveal: { index: SONGS_PER_GAME },
      results: [
        { playerId: idB, nickname: 'Bob', rank: 1, gameScore: expectedB, correctCount: SONGS_PER_GAME },
        { playerId: idA, nickname: 'Alice', rank: 2, gameScore: 0, correctCount: 0 },
      ],
    });
    await waitFor(() => playersB.at(-1)?.find((p) => p.id === idB)?.hasGuessed === false, 4000, 'players after ended');
    expect(playersB.at(-1)?.find((p) => p.id === idB)).toMatchObject({ score: expectedB, gameScore: expectedB });
    // 系統訊息：每首揭曉與本局結束；整場沒有任何一則聊天洩漏未揭曉的歌名（猜對只廣播「猜對了」）
    await waitFor(() => chatA.some((m) => m.text.startsWith('本局第一名')), 4000, 'ended message');
    const texts = chatA.map((m) => m.text);
    for (let i = 1; i <= SONGS_PER_GAME; i++) expect(texts).toContain(`第 ${i} 首：《${seenTitles[i - 1]}》`);
    expect(texts).toContain(`本局第一名：Bob（${expectedB} 分）`);
    expect(chatA.filter((m) => m.kind === 'correct').map((m) => m.text)).toEqual(Array.from({ length: SONGS_PER_GAME }, () => 'Bob 猜對了'));
    expect(chatA.filter((m) => m.kind === 'chat')).toEqual([]);
    // 同一歌手整局只打了一次假 iTunes（server 端；learn() 另算一次）
    expect(mock?.requests.filter((r) => r.path === '/search' && r.term === '孫燕姿')).toHaveLength(2);
  }, 30_000);

  it('搜尋失敗、不足 5 首、查無 → 仍在 choosing 可重試；英文名退回；快取讓同一歌手不重打', async () => {
    await start();
    const A = await connect();
    const B = await connect();
    await joinOk(A, 'Alice');
    await joinOk(B, 'Bob');
    const roundsB = collect<RoundPublic>(B, 'round:update');
    await request(A, 'round:volunteer');
    await waitFor(() => roundsB.at(-1)?.phase === 'choosing');

    expect(await request(A, 'round:setArtist', { artist: '壞掉樂團' })).toEqual({ ok: false, error: 'SEARCH_FAILED', message: '搜尋失敗，請再試一次' });
    const notFound = { ok: false, error: 'ARTIST_NOT_FOUND', message: '找不到這位歌手的歌（至少要 5 首有試聽的歌），換一位試試' };
    expect(await request(A, 'round:setArtist', { artist: '三首樂團' })).toEqual(notFound);
    expect(await request(A, 'round:setArtist', { artist: '沒有這個人' })).toEqual(notFound);
    expect(await request(A, 'round:setArtist', { artist: '沒有這個人' })).toEqual(notFound);
    // 退回須過半：本人只有 2 首、結果被兩個團瓜分（最多 5／12）→ 不退回、不會出別人的歌
    expect(await request(A, 'round:setArtist', { artist: '客串歌手' })).toEqual(notFound);
    expect(mock?.requests.filter((r) => r.term === '沒有這個人')).toHaveLength(1);
    expect(roundsB.at(-1)?.phase).toBe('choosing');
    for (const bad of [{ artist: '   ' }, { artist: 123 }, {}, null, 'x']) {
      expect(await request(A, 'round:setArtist', bad)).toMatchObject({ ok: false, error: 'ARTIST_INVALID' });
    }
    expect(await request(A, 'round:setArtist')).toMatchObject({ ok: false, error: 'ARTIST_INVALID' });

    expect(await request(A, 'round:setArtist', { artist: 'Jay Chou' })).toEqual({ ok: true, data: { artistDisplay: '周杰倫' } });
    await waitFor(() => roundsB.at(-1)?.phase === 'playing');
    expect(roundsB.at(-1)).toMatchObject({ gameNo: 1, artist: 'Jay Chou', artistDisplay: '周杰倫', song: { index: 1 } });
    expect(await request(A, 'round:setArtist', { artist: '孫燕姿' })).toMatchObject({ ok: false, error: 'ROUND_BUSY' });
    expect(await request(B, 'round:volunteer')).toMatchObject({ ok: false, error: 'ROUND_BUSY' });
    expect(await request(A, 'round:cancel')).toMatchObject({ ok: false, error: 'ROUND_BUSY' });
  });

  it('搜尋進行中：再送 SEARCH_BUSY；取消後搜尋回來 ack NOT_SETTER、不開局', async () => {
    await start();
    const A = await connect();
    const B = await connect();
    await joinOk(A, 'Alice');
    await joinOk(B, 'Bob');
    const roundsB = collect<RoundPublic>(B, 'round:update');
    await request(A, 'round:volunteer');

    const slow = request<{ artistDisplay: string }>(A, 'round:setArtist', { artist: '慢慢來樂團' });
    await sleep(50);
    expect(await request(A, 'round:setArtist', { artist: '孫燕姿' })).toEqual({ ok: false, error: 'SEARCH_BUSY', message: '搜尋中，請稍候' });
    expect(await request(A, 'round:cancel')).toEqual({ ok: true, data: undefined });
    await waitFor(() => roundsB.at(-1)?.phase === 'idle');
    expect(await slow).toMatchObject({ ok: false, error: 'NOT_SETTER' });
    await sleep(100);
    expect(roundsB.at(-1)).toMatchObject({ phase: 'idle', gameNo: 0 });
    expect(app?.songGuessRoom.currentRound().phase).toBe('idle');

    // 之後正常出題不受影響（慢慢來樂團已在快取，這次立刻成功）
    await request(B, 'round:volunteer');
    expect(await request(B, 'round:setArtist', { artist: '慢慢來樂團' })).toEqual({ ok: true, data: { artistDisplay: '慢慢來樂團' } });
    expect(mock?.requests.filter((r) => r.term === '慢慢來樂團')).toHaveLength(1);
  });

  it('縮時：出題期限到 → idle；出題者寬限期滿離開 → idle；局中離開者不進排名', async () => {
    await start({ songDurations: { startDelayMs: 20, revealMs: 60, previewCapMs: 120, choosingMs: 250, graceMs: 150 } });
    await learn('孫燕姿');
    const A = await connect();
    const B = await connect();
    const C = await connect();
    await joinOk(A, 'Alice');
    const b = await joinOk(B, 'Bob');
    const c = await joinOk(C, 'Carol');
    const roundsC = collect<RoundPublic>(C, 'round:update');
    const chatC = collect<ChatMessage>(C, 'chat:message');

    await request(A, 'round:volunteer');
    await waitFor(() => roundsC.at(-1)?.phase === 'idle', 4000, 'choosing timeout');
    // 系統訊息排在 round:update、players:update 之後送達，另外等（不同封包，可能晚一個 tick）
    await waitFor(() => chatC.at(-1)?.text === 'Alice 出題逾時', 4000, 'timeout message');

    await request(A, 'round:volunteer');
    A.disconnect();
    await waitFor(() => chatC.some((m) => m.text === '出題者 Alice 離開'), 4000, 'setter left');
    expect(roundsC.at(-1)).toMatchObject({ phase: 'idle', setterId: null });

    // B 出題；B 猜對第 1 首後離開 → 不進排名；previewCapMs 120 < 假 iTunes 的全長 → durationMs 取上限
    await request(B, 'round:volunteer');
    expect(await request(B, 'round:setArtist', { artist: '孫燕姿' })).toMatchObject({ ok: true });
    await waitFor(() => roundsC.at(-1)?.phase === 'playing');
    expect(roundsC.at(-1)?.song?.durationMs).toBe(120);
    expect(await request(B, 'chat:send', { text: answerOf(roundsC.at(-1)) })).toMatchObject({ ok: true });
    B.disconnect();
    await waitFor(() => roundsC.at(-1)?.phase === 'ended', 6000, 'ended');
    expect(roundsC.at(-1)).toMatchObject({
      setterId: b.snapshot.you,
      participantIds: [c.snapshot.you],
      results: [{ playerId: c.snapshot.you, nickname: 'Carol', rank: 1, gameScore: 0, correctCount: 0 }],
    });
  });

  it('沒注入搜尋器時讀環境變數：測試環境的 ITUNES_URL 連不上 → SEARCH_FAILED（不會打到真 iTunes）', async () => {
    expect(process.env.ITUNES_URL).toBe('http://127.0.0.1:1');
    app = createApp({ port: 0, host: '127.0.0.1' });
    const { port } = await app.listen();
    base = `http://127.0.0.1:${port}`;
    const A = await connect();
    const B = await connect();
    await joinOk(A, 'Alice');
    await joinOk(B, 'Bob');
    await request(A, 'round:volunteer');
    expect(await request(A, 'round:setArtist', { artist: '孫燕姿' })).toEqual({ ok: false, error: 'SEARCH_FAILED', message: '搜尋失敗，請再試一次' });
    expect(app.songGuessRoom.currentRound().phase).toBe('choosing');
  });

  it('不信任客戶端：payload 形狀不對、沒帶 ack 都不會讓 server 出錯', async () => {
    await start();
    const A = await connect();
    const raw = (ev: string, ...a: unknown[]): void => void (A.emit as unknown as (ev: string, ...a: unknown[]) => void).call(A, ev, ...a);
    raw('player:join', { nickname: 'NoAck' });
    raw('round:setArtist', { artist: '孫燕姿' });
    raw('chat:send');
    expect(await request(A, 'player:join', 'x')).toMatchObject({ ok: false, error: 'NICKNAME_INVALID' });
    expect(await request(A, 'player:join', { nickname: 5 })).toMatchObject({ ok: false, error: 'NICKNAME_INVALID' });
    expect(await request(A, 'chat:send', { text: 'hi' })).toMatchObject({ ok: false, error: 'NOT_IN_ROOM' });
    await joinOk(A, 'Alice');
    expect(await request(A, 'chat:send', { text: 5 })).toMatchObject({ ok: false, error: 'MESSAGE_INVALID' });
    expect(await request(A, 'chat:send')).toMatchObject({ ok: false, error: 'MESSAGE_INVALID' });
    raw('round:volunteer');
    raw('round:cancel', 1, 2, 3);
    expect(await request(A, 'chat:send', { text: '還活著' })).toEqual({ ok: true, data: undefined });
    expect(app?.songGuessRoom.playerList()).toHaveLength(1);
  });

  it('與 /draw-guess、/draw-contest 並存：三個 namespace 各自獨立（同名暱稱互不衝突）', async () => {
    await start();
    const g = await connect(DRAW_GUESS_NAMESPACE);
    const c = await connect(DRAW_CONTEST_NAMESPACE);
    const s = await connect(SONG_GUESS_NAMESPACE);
    const rg = await request<{ snapshot: { round: { phase: string } } }>(g, 'player:join', { nickname: 'Alice' });
    const rc = await request<{ snapshot: { round: { phase: string } } }>(c, 'player:join', { nickname: 'Alice' });
    const rs = await request<JoinResult>(s, 'player:join', { nickname: 'Alice' });
    expect(rg.ok && rc.ok && rs.ok).toBe(true);
    expect(app?.drawGuessRoom.playerList()).toHaveLength(1);
    expect(app?.drawContestRoom.playerList()).toHaveLength(1);
    expect(app?.songGuessRoom.playerList()).toHaveLength(1);
    // 猜歌的事件不會跑到另兩款
    expect(await request(s, 'round:volunteer')).toMatchObject({ ok: false, error: 'NOT_ENOUGH_PLAYERS' });
    expect(app?.drawContestRoom.currentRound().phase).toBe('idle');
  });
});
