import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CHAT_HISTORY,
  JOIN_MIN_INTERVAL_MS,
  MAX_PLAYERS,
  NICKNAME_INVALID_MESSAGE,
  NICKNAME_MAX,
  NICKNAME_TAKEN_MESSAGE,
  RECONNECT_GRACE_SECONDS,
  type ChatMessage,
  type JoinResult,
  type PlayerPublic,
} from '@fishing-work/shared';
import { GRACE_MS, JOIN_RATE_LIMITED_MESSAGE, ROUND_ERROR_MESSAGES, Room, type EmitEffect, type Effect } from '../src/games/draw-guess/room';
import { FakeClock } from './helpers/fakeClock';

// ─── 測試工具 ─────────────────────────────────────────────────────

let clock: FakeClock;
let asyncEffects: Effect[][];
let room: Room;

beforeEach(() => {
  clock = new FakeClock();
  asyncEffects = [];
  let n = 0;
  room = new Room({ clock, newId: () => `id${++n}`, onAsyncEffects: (e) => asyncEffects.push(e) });
});

afterEach(() => room.dispose());

function joinOk(socketId: string, nickname: string, token?: string): { data: JoinResult; effects: Effect[] } {
  const r = room.join(socketId, nickname, token);
  if (!r.ack.ok) throw new Error(`join 失敗：${r.ack.error}`);
  return { data: r.ack.data, effects: r.effects };
}

function emits(effects: Effect[]): EmitEffect[] {
  return effects.filter((e): e is EmitEffect => e.kind === 'emit');
}

function playersPayload(effects: Effect[]): PlayerPublic[] {
  const e = emits(effects).find((x) => x.event === 'players:update');
  if (!e || typeof e.payload === 'function') throw new Error('沒有 players:update');
  return e.payload as PlayerPublic[];
}

function chatPayload(effects: Effect[]): ChatMessage {
  const e = emits(effects).find((x) => x.event === 'chat:message');
  if (!e || typeof e.payload === 'function') throw new Error('沒有 chat:message');
  return e.payload as ChatMessage;
}

function nicknames(): string[] {
  return room.playerList().map((p) => p.nickname);
}

// ─── join：新玩家 ─────────────────────────────────────────────────

describe('join（新玩家）', () => {
  it('成功：回 token 與快照（you、players、round idle、ops、chat）', () => {
    const { data } = joinOk('s1', 'Alice');
    const { token, snapshot } = data;
    expect(token).toBe('id2');
    expect(snapshot.you).toBe('id1');
    expect(snapshot.players).toEqual([
      { id: 'id1', nickname: 'Alice', score: 0, isDrawer: false, hasGuessed: false, connected: true, joinedAt: clock.t },
    ]);
    expect(snapshot.round).toEqual({
      phase: 'idle',
      drawerId: null,
      topic: null,
      topicLength: null,
      startedAt: null,
      endsAt: null,
      correctIds: [],
      endReason: null,
    });
    expect(snapshot.ops).toEqual([]);
    expect(snapshot.chat.map((m) => m.text)).toEqual(['Alice 加入']);
  });

  it('token 不等於 player id，且不出現在公開的玩家資料中', () => {
    const { data } = joinOk('s1', 'Alice');
    expect(data.token).not.toBe(data.snapshot.you);
    expect(JSON.stringify(room.playerList())).not.toContain(data.token);
  });

  it('效果：players:update 給所有人；system 訊息給其他人（本人已在快照中）', () => {
    joinOk('s1', 'Alice');
    const { effects } = joinOk('s2', 'Bob');
    expect(effects).toHaveLength(2);
    const [pu, chat] = emits(effects);
    expect(pu.to).toBe('all');
    expect(pu.event).toBe('players:update');
    expect(playersPayload(effects).map((p) => p.nickname)).toEqual(['Alice', 'Bob']);
    expect(chat.to).toEqual({ except: 'id3' });
    expect(chat.event).toBe('chat:message');
  });

  it('system 訊息欄位：kind system、fromId / nickname 為 null、at = now', () => {
    clock.t += 1234;
    const { effects } = joinOk('s1', 'Alice');
    expect(chatPayload(effects)).toEqual({ id: expect.any(String), kind: 'system', fromId: null, nickname: null, text: 'Alice 加入', at: clock.t });
  });

  it('暱稱去頭尾空白後儲存', () => {
    joinOk('s1', '  Alice　');
    expect(nicknames()).toEqual(['Alice']);
  });

  it.each([
    ['空字串', ''],
    ['全空白', '   　 '],
    [`${NICKNAME_MAX + 1} 字`, 'a'.repeat(NICKNAME_MAX + 1)],
    ['中間含換行', 'Al\nice'],
    ['中間含 tab', 'Al\tice'],
    ['含 BEL 控制字元', 'Al\u0007ice'],
    [`${NICKNAME_MAX + 1} 個 emoji`, '👍'.repeat(NICKNAME_MAX + 1)],
    // Epic 21（§9.1；code review #2）：不可見字元
    ['夾零寬空白（冒充）', 'Al\u200Bice'],
    ['只有隱形填充 U+3164（空白暱稱）', '\u3164'],
    ['只有點字空白 U+2800', '\u2800'],
    ['只有 ZWJ', '\u200D'],
    ['含 VS15', 'Rex\uFE0E'],
  ])('不合法（%s）→ NICKNAME_INVALID，無效果、不建立玩家', (_label, nickname) => {
    const r = room.join('s1', nickname);
    expect(r.ack).toEqual({ ok: false, error: 'NICKNAME_INVALID', message: NICKNAME_INVALID_MESSAGE });
    expect(r.effects).toEqual([]);
    expect(room.playerList()).toEqual([]);
  });

  it(`剛好 ${NICKNAME_MAX} 字、${NICKNAME_MAX} 個 emoji 皆合法`, () => {
    joinOk('s1', '一'.repeat(NICKNAME_MAX));
    joinOk('s2', '👍'.repeat(NICKNAME_MAX));
    expect(room.playerList()).toHaveLength(2);
  });

  it.each([
    ['大小寫不同', 'alice'],
    ['全大寫', 'ALICE'],
    ['去頭尾空白後相同', '  Alice  '],
    ['全形英文', 'Ａｌｉｃｅ'],
  ])('重複（%s）→ NICKNAME_TAKEN', (_label, nickname) => {
    joinOk('s1', 'Alice');
    const r = room.join('s2', nickname);
    expect(r.ack).toEqual({ ok: false, error: 'NICKNAME_TAKEN', message: NICKNAME_TAKEN_MESSAGE });
    expect(r.effects).toEqual([]);
    expect(room.playerList()).toHaveLength(1);
  });

  it('玩家清單依 joinedAt 排序', () => {
    joinOk('s1', 'Alice');
    clock.t += 10;
    joinOk('s2', 'Bob');
    clock.t += 10;
    joinOk('s3', 'Carol');
    expect(nicknames()).toEqual(['Alice', 'Bob', 'Carol']);
    const at = room.playerList().map((p) => p.joinedAt);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it(`人數達 MAX_PLAYERS（${MAX_PLAYERS}，含寬限期中）→ ROOM_FULL；接管與重複 join 不受限；有人離開後可再加入`, () => {
    const tokens: string[] = [];
    for (let i = 0; i < MAX_PLAYERS; i++) tokens.push(joinOk(`s${i}`, `p${i}`).data.token);
    room.disconnect('s0'); // 寬限期中仍算人數
    const full = room.join('late', 'late');
    expect(full).toEqual({ ack: { ok: false, error: 'ROOM_FULL', message: ROUND_ERROR_MESSAGES.ROOM_FULL }, effects: [] });
    expect(room.playerList()).toHaveLength(MAX_PLAYERS);
    // 滿房時：寬限期中接管、已加入 socket 重複 join 都照常（重複 join 需距上次受理 ≥ JOIN_MIN_INTERVAL_MS，Epic 21）
    expect(room.join('s0b', 'x', tokens[0]).ack.ok).toBe(true);
    clock.advance(JOIN_MIN_INTERVAL_MS);
    expect(room.join('s1', 'x').ack.ok).toBe(true);
    // 帶著對不到的 token 也視為新玩家 → 仍受上限
    expect(room.join('late', 'late', 'bogus').ack).toMatchObject({ ok: false, error: 'ROOM_FULL' });
    room.leave(room.playerIdOf('s2') as string);
    expect(room.join('late', 'late').ack.ok).toBe(true);
  });

  it('不可見字元（Epic 21）：同暱稱加 VS16 → NICKNAME_TAKEN；emoji 暱稱 👨‍👩‍👧、❤️ 合法且原樣保存', () => {
    joinOk('s1', 'Rex');
    expect(room.join('s2', 'Rex\uFE0F').ack).toEqual({ ok: false, error: 'NICKNAME_TAKEN', message: NICKNAME_TAKEN_MESSAGE });
    expect(room.join('s2', 'R\u200Dex').ack).toMatchObject({ ok: false, error: 'NICKNAME_TAKEN' });
    joinOk('s2', '👨‍👩‍👧');
    joinOk('s3', '❤️');
    expect(nicknames()).toEqual(['Rex', '👨‍👩‍👧', '❤️']);
  });

  it('對不到的 token 視為新玩家（照暱稱規則）', () => {
    joinOk('s1', 'Alice');
    const r = room.join('s2', 'Bob', 'no-such-token');
    expect(r.ack.ok).toBe(true);
    expect(room.join('s3', 'alice', 'no-such-token').ack).toMatchObject({ ok: false, error: 'NICKNAME_TAKEN' });
  });
});

// ─── join：重複（冪等） ───────────────────────────────────────────

describe('join（同一 socket 重複）', () => {
  it('不論暱稱或 token，回同一 token 與目前快照，不改名、不廣播', () => {
    const first = joinOk('s1', 'Alice');
    joinOk('s2', 'Bob');
    clock.advance(JOIN_MIN_INTERVAL_MS);
    const again = joinOk('s1', 'Zed', 'whatever');
    expect(again.effects).toEqual([]);
    expect(again.data.token).toBe(first.data.token);
    expect(again.data.snapshot.you).toBe(first.data.snapshot.you);
    expect(again.data.snapshot.players.map((p) => p.nickname)).toEqual(['Alice', 'Bob']);
    expect(nicknames()).toEqual(['Alice', 'Bob']);
  });

  it('重複 join 時暱稱不合法也回成功（忽略 payload）', () => {
    joinOk('s1', 'Alice');
    clock.advance(JOIN_MIN_INTERVAL_MS);
    expect(room.join('s1', '').ack.ok).toBe(true);
  });

  it(`節流（Epic 21，§9.1）：距上次受理 < ${JOIN_MIN_INTERVAL_MS} ms → RATE_LIMITED；被拒不更新時間；滿 1 秒後再受理`, () => {
    joinOk('s1', 'Alice');
    clock.advance(JOIN_MIN_INTERVAL_MS - 1);
    const limited = room.join('s1', 'Alice');
    expect(limited).toEqual({ ack: { ok: false, error: 'RATE_LIMITED', message: JOIN_RATE_LIMITED_MESSAGE }, effects: [] });
    expect(JOIN_RATE_LIMITED_MESSAGE).toBe('操作太頻繁，請稍候再試');
    clock.advance(1); // 從首次加入起算剛好 1 秒（被拒的那次不重設）
    expect(room.join('s1', 'Alice').ack.ok).toBe(true);
    // 受理後重新計時
    expect(room.join('s1', 'Alice').ack).toMatchObject({ ok: false, error: 'RATE_LIMITED' });
  });

  it('節流只限已綁定的 socket：未綁定 socket 打錯暱稱可立刻重試；接管也從接管時起算', () => {
    joinOk('s1', 'Alice');
    expect(room.join('s2', '').ack).toMatchObject({ ok: false, error: 'NICKNAME_INVALID' });
    expect(room.join('s2', 'alice').ack).toMatchObject({ ok: false, error: 'NICKNAME_TAKEN' });
    expect(room.join('s2', 'Bob').ack.ok).toBe(true);
    const token = room.join('s3', 'Carol').ack;
    if (!token.ok) throw new Error('join 失敗');
    // 新 socket 帶 token 接管：不受節流（立刻）
    expect(room.join('s3b', 'x', token.data.token).ack.ok).toBe(true);
    // 接管後同一 socket 立刻重送 → RATE_LIMITED
    expect(room.join('s3b', 'x').ack).toMatchObject({ ok: false, error: 'RATE_LIMITED' });
  });
});

// ─── disconnect 與寬限期 ──────────────────────────────────────────

describe('disconnect 與寬限期', () => {
  it('connected=false，只廣播 players:update，不發 system 訊息（不入聊天緩衝）', () => {
    joinOk('s1', 'Alice');
    joinOk('s2', 'Bob');
    const effects = room.disconnect('s2');
    expect(effects).toHaveLength(1);
    expect(emits(effects)[0]).toMatchObject({ to: 'all', event: 'players:update' });
    expect(playersPayload(effects).find((p) => p.nickname === 'Bob')?.connected).toBe(false);
    expect(room.onlineCount()).toBe(1);
    expect(room.snapshot('id1').chat.map((m) => m.text)).toEqual(['Alice 加入', 'Bob 加入']);
  });

  it('未知 socket 斷線為 no-op', () => {
    joinOk('s1', 'Alice');
    expect(room.disconnect('nope')).toEqual([]);
    expect(room.playerList()[0].connected).toBe(true);
  });

  it('寬限期中暱稱仍被占用（含大小寫變化）', () => {
    joinOk('s1', 'Alice');
    room.disconnect('s1');
    clock.advance(GRACE_MS - 1);
    expect(room.join('s2', 'ALICE').ack).toMatchObject({ ok: false, error: 'NICKNAME_TAKEN' });
  });

  it(`寬限 ${RECONNECT_GRACE_SECONDS} 秒逾期 → leave：非同步效果 players:update（移除）＋「X 離開」`, () => {
    joinOk('s1', 'Alice');
    joinOk('s2', 'Bob');
    room.disconnect('s2');
    clock.advance(GRACE_MS - 1);
    expect(asyncEffects).toEqual([]);
    clock.advance(1);
    expect(asyncEffects).toHaveLength(1);
    const effects = asyncEffects[0];
    expect(playersPayload(effects).map((p) => p.nickname)).toEqual(['Alice']);
    expect(chatPayload(effects).text).toBe('Bob 離開');
    expect(nicknames()).toEqual(['Alice']);
  });

  it('寬限逾期後暱稱可再用，舊 token 失效（當新玩家、分數歸零、新 id）', () => {
    const old = joinOk('s1', 'Alice');
    room.disconnect('s1');
    clock.advance(GRACE_MS);
    const again = joinOk('s2', 'alice', old.data.token);
    expect(again.data.snapshot.you).not.toBe(old.data.snapshot.you);
    expect(again.data.token).not.toBe(old.data.token);
    expect(nicknames()).toEqual(['alice']);
    expect(room.playerList()[0].score).toBe(0);
  });

  it('寬限逾期時不會送給已離開的玩家；斷線中的玩家不在收件者中', () => {
    joinOk('s1', 'Alice');
    joinOk('s2', 'Bob');
    room.disconnect('s2');
    expect(room.recipients('all').map((r) => r.socketId)).toEqual(['s1']);
  });
});

// ─── join：接管 ───────────────────────────────────────────────────

describe('join（token 接管）', () => {
  it('寬限期內接管：同一 player id 與 token、connected=true、計時器取消、只廣播 players:update（不發 system 訊息）', () => {
    const old = joinOk('s1', 'Alice');
    joinOk('s2', 'Bob');
    room.disconnect('s1');
    expect(clock.timers.size).toBe(1);

    const back = joinOk('s3', 'ignored', old.data.token);
    expect(back.data.snapshot.you).toBe(old.data.snapshot.you);
    expect(back.data.token).toBe(old.data.token);
    expect(clock.timers.size).toBe(0);
    expect(room.playerList().find((p) => p.nickname === 'Alice')?.connected).toBe(true);
    expect(back.effects.some((e) => e.kind === 'disconnect')).toBe(false);
    expect(back.effects).toHaveLength(1);
    expect(emits(back.effects)[0]).toMatchObject({ to: 'all', event: 'players:update' });
    expect(playersPayload(back.effects).every((p) => p.connected)).toBe(true);
    expect(back.data.snapshot.chat.map((m) => m.text)).toEqual(['Alice 加入', 'Bob 加入']);

    clock.advance(GRACE_MS * 2);
    expect(asyncEffects).toEqual([]);
    expect(nicknames()).toEqual(['Alice', 'Bob']);
  });

  it('接管忽略 payload.nickname（不改名、不驗證）', () => {
    const old = joinOk('s1', 'Alice');
    room.disconnect('s1');
    joinOk('s2', '', old.data.token);
    expect(nicknames()).toEqual(['Alice']);
  });

  it('舊 socket 仍在時接管：踢掉舊 socket、不廣播；舊 socket 之後 disconnect 不影響玩家', () => {
    const old = joinOk('s1', 'Alice');
    const back = joinOk('s2', 'Alice', old.data.token);
    expect(back.effects).toEqual([{ kind: 'disconnect', socketId: 's1' }]);
    expect(back.data.snapshot.you).toBe(old.data.snapshot.you);
    expect(room.playerIdOf('s1')).toBeUndefined();
    expect(room.playerIdOf('s2')).toBe(old.data.snapshot.you);

    expect(room.disconnect('s1')).toEqual([]);
    expect(room.playerList()[0].connected).toBe(true);
    expect(clock.timers.size).toBe(0);
    clock.advance(GRACE_MS * 2);
    expect(nicknames()).toEqual(['Alice']);
    expect(room.recipients('all')).toEqual([{ playerId: old.data.snapshot.you, socketId: 's2' }]);
  });

  it('接管後新 socket 斷線仍會正常進入寬限期', () => {
    const old = joinOk('s1', 'Alice');
    joinOk('s2', 'x', old.data.token);
    room.disconnect('s1');
    expect(room.disconnect('s2').length).toBeGreaterThan(0);
    expect(room.playerList()[0].connected).toBe(false);
  });

  it('接管保留 joinedAt 與分數欄位（玩家狀態不重建）', () => {
    const old = joinOk('s1', 'Alice');
    const before = room.playerList()[0];
    room.disconnect('s1');
    clock.advance(5000);
    joinOk('s2', 'Alice', old.data.token);
    expect(room.playerList()[0]).toEqual({ ...before, connected: true });
  });
});

// ─── leave ───────────────────────────────────────────────────────

describe('leave', () => {
  it('移除玩家，廣播 players:update 與「X 離開」', () => {
    const a = joinOk('s1', 'Alice');
    joinOk('s2', 'Bob');
    const effects = room.leave(a.data.snapshot.you);
    expect(playersPayload(effects).map((p) => p.nickname)).toEqual(['Bob']);
    expect(chatPayload(effects).text).toBe('Alice 離開');
    expect(room.playerIdOf('s1')).toBeUndefined();
  });

  it('未知 id 為 no-op', () => {
    joinOk('s1', 'Alice');
    expect(room.leave('nope')).toEqual([]);
    expect(room.playerList()).toHaveLength(1);
  });

  it('leave 後暱稱可再用', () => {
    const a = joinOk('s1', 'Alice');
    room.leave(a.data.snapshot.you);
    expect(room.join('s2', 'ALICE').ack.ok).toBe(true);
  });
});

// ─── 收件者解析 ───────────────────────────────────────────────────

describe('recipients', () => {
  it('all / except / only 皆以 player id 指定，解析成 socket id', () => {
    const a = joinOk('s1', 'Alice').data.snapshot.you;
    const b = joinOk('s2', 'Bob').data.snapshot.you;
    expect(room.recipients('all').map((r) => r.socketId)).toEqual(['s1', 's2']);
    expect(room.recipients({ except: a })).toEqual([{ playerId: b, socketId: 's2' }]);
    expect(room.recipients({ only: a })).toEqual([{ playerId: a, socketId: 's1' }]);
  });

  it('only 指定斷線中玩家 → 無收件者', () => {
    const a = joinOk('s1', 'Alice').data.snapshot.you;
    room.disconnect('s1');
    expect(room.recipients({ only: a })).toEqual([]);
  });
});

// ─── 聊天歷史 ─────────────────────────────────────────────────────

describe('聊天環狀緩衝', () => {
  it(`最多保留 ${CHAT_HISTORY} 則，丟棄最舊的；id 不重複`, () => {
    const total = CHAT_HISTORY + 20;
    for (let i = 0; i < total / 2; i++) {
      const id = joinOk(`s${i}`, `p${i}`).data.snapshot.you;
      room.leave(id);
    }
    const viewer = joinOk('viewer', 'viewer').data.snapshot;
    expect(viewer.chat).toHaveLength(CHAT_HISTORY);
    expect(viewer.chat.at(-1)?.text).toBe('viewer 加入');
    // 共 121 則（p0 加入、p0 離開、…、p59 離開、viewer 加入），丟棄最舊 21 則 → 第一則為第 22 則「p10 離開」
    expect(viewer.chat[0].text).toBe('p10 離開');
    expect(new Set(viewer.chat.map((m) => m.id)).size).toBe(CHAT_HISTORY);
  });

  it('快照帶出先前的 system 訊息（中途加入者可見）；斷線不入緩衝', () => {
    joinOk('s1', 'Alice');
    const b = joinOk('s2', 'Bob').data.snapshot.you;
    joinOk('s3', 'Carol');
    room.disconnect('s3');
    room.leave(b);
    const d = joinOk('s4', 'Dave').data.snapshot;
    expect(d.chat.map((m) => m.text)).toEqual(['Alice 加入', 'Bob 加入', 'Carol 加入', 'Bob 離開', 'Dave 加入']);
  });
});

// ─── 其他 ─────────────────────────────────────────────────────────

describe('其他', () => {
  it('dispose 清掉所有寬限計時器', () => {
    joinOk('s1', 'Alice');
    joinOk('s2', 'Bob');
    room.disconnect('s1');
    room.disconnect('s2');
    expect(clock.timers.size).toBe(2);
    room.dispose();
    expect(clock.timers.size).toBe(0);
  });

  it('快照的陣列是複本，外部修改不影響 Room', () => {
    const s = joinOk('s1', 'Alice').data.snapshot;
    s.players.pop();
    s.chat.pop();
    const again = room.snapshot(s.you);
    expect(again.players).toHaveLength(1);
    expect(again.chat).toHaveLength(1);
  });
});
