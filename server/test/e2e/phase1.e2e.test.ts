// Phase 1 協定測試（改寫自 user/protocol/draw-guess-phase1.mjs）：只依 spec §4/§5/§9 打 Socket
// 寬限期注入為 GRACE_MS（取代真實 15 秒，以免測試過慢）；其餘行為與正式環境相同。
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JOIN_MIN_INTERVAL_MS, type ChatMessage, type PlayerPublic } from '@fishing-work/shared';
import { collect, join, joinOk, once, rawEmit, silenceLogs, sleep, startServer, waitFor, type TestServer } from './helpers';

const GRACE_MS = 600;

let srv: TestServer;

beforeAll(() => silenceLogs());
beforeEach(async () => {
  srv = await startServer({ durations: { graceMs: GRACE_MS } });
});
afterEach(async () => {
  await srv.stop();
});

describe('e2e Phase 1：加入', () => {
  it('join 回 JoinResult{token, snapshot}；id 不是 socket.id；暱稱去頭尾空白；欄位齊全；快照含「加入」', async () => {
    const A = await srv.connect();
    const r = await join(A, { nickname: '  Alice ' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { token, snapshot } = r.data;
    expect(typeof token).toBe('string');
    expect(snapshot.you).not.toBe(A.id);
    const me = snapshot.players.find((p) => p.id === snapshot.you);
    expect(me).toMatchObject({ nickname: 'Alice', connected: true, score: 0, isDrawer: false, hasGuessed: false });
    expect(typeof me?.joinedAt).toBe('number');
    expect(snapshot.chat.some((m) => m.kind === 'system' && m.text.includes('Alice'))).toBe(true);
    expect(snapshot.round.phase).toBe('idle');
    expect(snapshot.ops).toEqual([]);
  });

  it('同 socket 重複 join 冪等（同 token、不改名、不重建）', async () => {
    const A = await srv.connect();
    const first = await joinOk(A, 'Alice');
    // 已綁定 socket 的重複 join 有 1 秒節流（Epic 21，§9.1）：太快 → RATE_LIMITED，等滿再送才冪等
    expect(await join(A, { nickname: 'Other' })).toMatchObject({ ok: false, error: 'RATE_LIMITED', message: '操作太頻繁，請稍候再試' });
    await sleep(JOIN_MIN_INTERVAL_MS + 50);
    const again = await join(A, { nickname: 'Other' });
    expect(again.ok && again.data.token === first.token).toBe(true);
    expect(again.ok && again.data.snapshot.players.map((p) => p.nickname)).toEqual(['Alice']);
  });

  it('暱稱規則：全形＋大小寫同名 → NICKNAME_TAKEN；控制字元／13 字／全空白 → NICKNAME_INVALID；emoji 以 code point 計', async () => {
    const A = await srv.connect();
    await joinOk(A, 'Alice');
    const B = await srv.connect();
    expect(await join(B, { nickname: 'ＡＬＩＣＥ' })).toMatchObject({ ok: false, error: 'NICKNAME_TAKEN' });
    expect(await join(B, { nickname: 'Bo\tb' })).toMatchObject({ ok: false, error: 'NICKNAME_INVALID' });
    expect(await join(B, { nickname: 'x'.repeat(13) })).toMatchObject({ ok: false, error: 'NICKNAME_INVALID' });
    expect(await join(B, { nickname: '   ' })).toMatchObject({ ok: false, error: 'NICKNAME_INVALID' });
    const aUpdates = collect<PlayerPublic[]>(A, 'players:update');
    const aChat = collect<ChatMessage>(A, 'chat:message');
    expect((await join(B, { nickname: '👨‍👩‍👧👨‍👩‍👧' })).ok).toBe(true); // 10 code points
    await waitFor(() => aUpdates.at(-1)?.length === 2, 3000, 'A 收到 2 人');
    await waitFor(() => aChat.length === 1);
    expect(aChat[0]).toMatchObject({ kind: 'system', fromId: null });
  });

  it('加入的 system 訊息不回送給本人（本人從快照看到）', async () => {
    const A = await srv.connect();
    const chat = collect<ChatMessage>(A, 'chat:message');
    await joinOk(A, 'Alice');
    await sleep(150);
    expect(chat).toEqual([]);
  });
});

describe('e2e Phase 1：接管與寬限期', () => {
  it('帶 token 接管：同 id、同 token、暱稱不變；舊 socket 被伺服器踢掉（io server disconnect）；不發 system 訊息', async () => {
    const A = await srv.connect();
    const a = await joinOk(A, 'Alice');
    const B = await srv.connect();
    const bChat = collect<ChatMessage>(B, 'chat:message');
    await joinOk(B, 'Bob');
    const A2 = await srv.connect();
    const kicked = once<[string]>(A, 'disconnect');
    const r = await joinOk(A2, 'IGNORED', a.token);
    expect(r.snapshot.you).toBe(a.snapshot.you);
    expect(r.token).toBe(a.token);
    expect(r.snapshot.players.find((p) => p.id === a.snapshot.you)?.nickname).toBe('Alice');
    const [reason] = await kicked;
    expect(reason).toBe('io server disconnect');
    await sleep(150);
    expect(r.snapshot.players).toHaveLength(2);
    expect(bChat).toEqual([]);
  });

  it('斷線 → connected=false（不發 system 訊息）；寬限期中暱稱仍占用；逾期後移除並發「X 離開」', async () => {
    const A = await srv.connect();
    await joinOk(A, 'Alice');
    const updates = collect<PlayerPublic[]>(A, 'players:update');
    const chat = collect<ChatMessage>(A, 'chat:message');
    const B = await srv.connect();
    const b = await joinOk(B, 'Bob');
    // A 自己加入的 players:update 也可能晚於 ack 才到，因此以「最新一則有 2 人」為準
    await waitFor(() => updates.at(-1)?.length === 2 && chat.length === 1, 3000, 'A 收到 Bob 加入');
    const base = updates.length;
    const t0 = Date.now();
    B.disconnect();
    await waitFor(() => updates.length > base);
    expect(updates[base].find((p) => p.id === b.snapshot.you)?.connected).toBe(false);
    const C = await srv.connect();
    expect(await join(C, { nickname: 'bob' })).toMatchObject({ ok: false, error: 'NICKNAME_TAKEN' });
    await waitFor(() => updates.slice(base).some((l) => !l.some((p) => p.id === b.snapshot.you)), GRACE_MS + 2000, 'B 被移除');
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(GRACE_MS - 50);
    expect(elapsed).toBeLessThan(GRACE_MS + 1000);
    await waitFor(() => chat.length >= 2);
    expect(chat.map((m) => m.text)).toEqual(['Bob 加入', 'Bob 離開']);
    // 逾期 token → 視為新玩家（新 id、新 token）
    const D = await srv.connect();
    const d = await joinOk(D, 'Bob', b.token);
    expect(d.token).not.toBe(b.token);
    expect(d.snapshot.you).not.toBe(b.snapshot.you);
  });

  it('寬限期內帶 token 接回：同 id、connected=true、人數不變、不發 system 訊息', async () => {
    const A = await srv.connect();
    await joinOk(A, 'Alice');
    const chat = collect<ChatMessage>(A, 'chat:message');
    const C = await srv.connect();
    const e = await joinOk(C, 'Eve');
    await waitFor(() => chat.length === 1, 3000, 'A 收到 Eve 加入');
    C.disconnect();
    await sleep(100);
    const C2 = await srv.connect();
    const back = await joinOk(C2, 'whatever', e.token);
    expect(back.snapshot.you).toBe(e.snapshot.you);
    expect(back.snapshot.players.find((p) => p.id === e.snapshot.you)?.connected).toBe(true);
    expect(back.snapshot.players).toHaveLength(2);
    await sleep(GRACE_MS + 200);
    expect(chat.map((m) => m.text)).toEqual(['Eve 加入']);
  });
});

describe('e2e Phase 1：防禦性限制', () => {
  it('payload null → 錯誤 ack；已加入 socket 送壞 payload → 冪等 ok；新 socket 暱稱非字串、token 過長 → NICKNAME_INVALID；不帶 ack 不崩潰', async () => {
    const A = await srv.connect();
    const a = await joinOk(A, 'Alice');
    const F = await srv.connect();
    expect((await join(F, null)).ok).toBe(false);
    await sleep(JOIN_MIN_INTERVAL_MS + 50); // 重複 join 節流（Epic 21）
    const again = await join(A, { nickname: 123, token: 'x'.repeat(100) });
    expect(again.ok && again.data.snapshot.you).toBe(a.snapshot.you);
    expect(await join(F, { nickname: 123, token: 'x'.repeat(100) })).toMatchObject({ ok: false, error: 'NICKNAME_INVALID' });
    rawEmit(A, 'player:join', { nickname: 'NoAck' });
    await sleep(100);
    expect(A.connected).toBe(true);
    expect((await join(F, { nickname: 'again' })).ok).toBe(true);
  });
});
