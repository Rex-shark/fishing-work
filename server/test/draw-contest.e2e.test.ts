// 繪圖比賽 e2e：起真正的 server（隨機埠），以 socket.io-client 打 /draw-contest（spec/draw-contest/architecture.md §4／§5）
// 計時以 AppOptions.contestDurations 縮短；評分器注入（無延遲 random）。
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import {
  DRAW_CONTEST_NAMESPACE,
  type Ack,
  type ClientToServerEvents,
  type GalleryImage,
  type JoinResult,
  type RoundPublic,
  type ServerToClientEvents,
} from '@fishing-work/shared/draw-contest';
import { DRAW_GUESS_NAMESPACE } from '@fishing-work/shared';
import { createApp, type App, type AppOptions } from '../src/app';
import { createRandomJudge, randomScore } from '../src/games/draw-contest/judge/random';
import { makePng } from './helpers/drawContest';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let app: App | null = null;
const sockets: ClientSocket[] = [];
let base = '';

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  for (const s of sockets.splice(0)) s.disconnect();
  await app?.close();
  app = null;
});

async function start(options: AppOptions = {}): Promise<void> {
  const random = createRandomJudge({ delayMs: 0 });
  app = createApp({ port: 0, host: '127.0.0.1', judge: { judge: random, fallback: random, timeoutMs: 1000 }, ...options });
  const { port } = await app.listen();
  base = `http://127.0.0.1:${port}`;
}

async function connect(ns = DRAW_CONTEST_NAMESPACE): Promise<ClientSocket> {
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
    const t = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), 3000);
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
async function waitFor(cond: () => boolean, ms = 3000, label = 'condition'): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`waitFor timeout: ${label}`);
    await sleep(10);
  }
}

describe('e2e /draw-contest', () => {
  it('一回合：出題 → 兩人交卷 → judging → ended；排名、總分、畫廊（二進位）；中途加入者 ack 後補收畫廊', async () => {
    await start();
    const A = await connect();
    const B = await connect();
    const a = await joinOk(A, 'Alice');
    const b = await joinOk(B, 'Bob');
    const roundsA = collect<RoundPublic>(A, 'round:update');
    const galleryB = collect<GalleryImage>(B, 'contest:gallery');

    expect(await request(A, 'round:volunteer')).toEqual({ ok: true, data: undefined });
    expect(await request(B, 'round:setTopic', { topic: '蘋果' })).toMatchObject({ ok: false, error: 'NOT_SETTER' });
    expect(await request(A, 'round:setTopic', { topic: ' 蘋果 ' })).toEqual({ ok: true, data: undefined });
    await waitFor(() => roundsA.at(-1)?.phase === 'drawing', 3000, 'drawing');
    expect(roundsA.at(-1)).toMatchObject({ roundNo: 1, topic: '蘋果', participantIds: [a.snapshot.you, b.snapshot.you] });

    const pngA = makePng(1);
    const pngB = makePng(2);
    expect(await request(A, 'contest:submit', { png: pngA.buffer })).toEqual({ ok: true, data: { bytes: pngA.byteLength } });
    expect(await request(A, 'contest:submit', { png: pngA })).toMatchObject({ ok: false, error: 'ALREADY_SUBMITTED' });
    expect(await request(B, 'contest:submit', { png: 'x' })).toMatchObject({ ok: false, error: 'SUBMISSION_INVALID' });
    expect(await request(B, 'contest:submit', { png: pngB })).toMatchObject({ ok: true });

    await waitFor(() => roundsA.at(-1)?.phase === 'ended', 3000, 'ended');
    const phases = roundsA.map((r) => r.phase);
    expect(phases).toContain('judging');
    const ended = roundsA.at(-1) as RoundPublic;
    const sA = randomScore(pngA, '蘋果').score;
    const sB = randomScore(pngB, '蘋果').score;
    expect(ended.results?.map((r) => r.playerId).sort()).toEqual([a.snapshot.you, b.snapshot.you].sort());
    expect(ended.results?.find((r) => r.playerId === a.snapshot.you)?.score).toBe(sA);
    expect(ended.results?.find((r) => r.playerId === b.snapshot.you)?.score).toBe(sB);
    expect(ended.judgeMode).toBe('random');
    // 評語（Epic 15）：測試預設 COMMENT=off（vitest.config.ts）→ commentMode off、沒有評語也沒有 pending
    expect(ended.commentMode).toBe('off');
    expect(ended.results?.map((r) => [r.comment, r.commentPending])).toEqual([[null, false], [null, false]]);

    await waitFor(() => galleryB.length === 2, 3000, 'gallery');
    const imgA = galleryB.find((g) => g.playerId === a.snapshot.you) as GalleryImage;
    expect(imgA.roundNo).toBe(1);
    expect([...new Uint8Array(imgA.png)]).toEqual([...pngA]);

    // 中途加入：ack 之後補收畫廊
    const C = await connect();
    const galleryC = collect<GalleryImage>(C, 'contest:gallery');
    const c = await joinOk(C, 'Carol');
    expect(c.snapshot.round.phase).toBe('ended');
    expect(c.snapshot.players.find((p) => p.id === a.snapshot.you)?.score).toBe(sA);
    await waitFor(() => galleryC.length === 2, 3000, 'late gallery');
    expect(galleryC.map((g) => g.roundNo)).toEqual([1, 1]);
  });

  it('縮時：作畫期限到 → judging，寬限內補交成功、寬限後 NOT_DRAWING；未交卷者 0 分', async () => {
    await start({ contestDurations: { drawMs: 300, submitGraceMs: 300 } });
    const A = await connect();
    const B = await connect();
    await joinOk(A, 'Alice');
    const b = await joinOk(B, 'Bob');
    const roundsB = collect<RoundPublic>(B, 'round:update');
    await request(A, 'round:volunteer');
    await request(A, 'round:setTopic', { topic: '貓' });
    await waitFor(() => roundsB.at(-1)?.phase === 'judging', 3000, 'judging');
    expect(roundsB.at(-1)?.endsAt).toBeNull();
    expect(await request(A, 'contest:submit', { png: makePng() })).toMatchObject({ ok: true });
    await waitFor(() => roundsB.at(-1)?.phase === 'ended', 3000, 'ended');
    expect(await request(B, 'contest:submit', { png: makePng() })).toMatchObject({ ok: false, error: 'NOT_DRAWING' });
    const res = roundsB.at(-1)?.results ?? [];
    expect(res.at(-1)).toMatchObject({ playerId: b.snapshot.you, score: 0, submitted: false });
  });

  it('重連：token 接管 id 不變；參賽者寬限期滿離開 → participantIds 變空 → ended、results = []', async () => {
    await start({ contestDurations: { graceMs: 200 } });
    const A = await connect();
    const B = await connect();
    const W = await connect();
    const a = await joinOk(A, 'Alice');
    await joinOk(B, 'Bob');
    await request(A, 'round:volunteer');
    await request(A, 'round:setTopic', { topic: '狗' });
    await joinOk(W, 'Watcher');
    const roundsW = collect<RoundPublic>(W, 'round:update');

    A.disconnect();
    const A2 = await connect();
    const again = await joinOk(A2, 'ignored', a.token);
    expect(again.snapshot.you).toBe(a.snapshot.you);
    expect(again.snapshot.round.participantIds).toContain(a.snapshot.you);
    expect(await request(W, 'contest:submit', { png: makePng() })).toMatchObject({ ok: false, error: 'NOT_PARTICIPANT' });

    A2.disconnect();
    B.disconnect();
    await waitFor(() => roundsW.at(-1)?.phase === 'ended', 3000, 'ended');
    expect(roundsW.at(-1)).toMatchObject({ participantIds: [], results: [] });
  });

  it('與 /draw-guess 並存：兩個 namespace 各自獨立（同名暱稱互不衝突）', async () => {
    await start();
    const g = await connect(DRAW_GUESS_NAMESPACE);
    const c = await connect(DRAW_CONTEST_NAMESPACE);
    const rg = await request<{ snapshot: { round: { phase: string } } }>(g, 'player:join', { nickname: 'Alice' });
    const rc = await request<JoinResult>(c, 'player:join', { nickname: 'Alice' });
    expect(rg.ok && rc.ok).toBe(true);
    expect(app?.drawGuessRoom.playerList()).toHaveLength(1);
    expect(app?.drawContestRoom.playerList()).toHaveLength(1);
  });
});
