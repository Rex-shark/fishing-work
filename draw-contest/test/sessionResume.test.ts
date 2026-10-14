// socket/client 的重連憑證與 resuming（plan/home-page.md 決策 4）：hasSavedSession、啟動時的 resuming、清掉憑證的路徑。
// 以假的 location／sessionStorage 載入模組（socket 為 autoConnect: false，不會真的連線）；socket.connect／timeout 以 spy 取代。
// 同一套載入方式順帶驗 Epic 15 的 contest:comment 有接到 store（未加入時忽略）、
// Epic 17 的 contest:gallery 有把原始 PNG 交給比賽歷史（features/history/historyStore；未加入時忽略）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SESSION_KEY = 'fishing-work:draw-contest:session'

function fakeSessionStorage(init: Record<string, string> = {}) {
  const map = new Map(Object.entries(init))
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    map,
  }
}

async function load(storage: ReturnType<typeof fakeSessionStorage> | 'throw') {
  vi.resetModules()
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost', hostname: 'localhost', port: '', href: 'http://localhost/draw-contest/' })
  if (storage === 'throw') {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    })
  } else {
    vi.stubGlobal('sessionStorage', storage)
  }
  const client = await import('../src/socket/client')
  const { useGameStore } = await import('../src/store/game')
  // 不要真的連線
  vi.spyOn(client.socket, 'connect').mockImplementation(() => client.socket)
  return { client, useGameStore }
}

const SAVED = { [SESSION_KEY]: JSON.stringify({ nickname: 'rex', token: 't-1' }) }

/** 觸發 socket 上已註冊的事件處理（socket.io-client 的 Emitter.listeners） */
function fire(socket: object, event: string, ...args: unknown[]) {
  const emitter = socket as { listeners(e: string): ((...a: unknown[]) => unknown)[] }
  for (const fn of emitter.listeners(event)) fn(...args)
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('hasSavedSession 與啟動時的 resuming', () => {
  it('沒有憑證：hasSavedSession() false、resuming false（首頁）', async () => {
    const { client, useGameStore } = await load(fakeSessionStorage())
    expect(client.hasSavedSession()).toBe(false)
    expect(useGameStore.getState().resuming).toBe(false)
  })

  it('有憑證：hasSavedSession() true、resuming true（直接進殼層的 resume 畫面）', async () => {
    const { client, useGameStore } = await load(fakeSessionStorage(SAVED))
    expect(client.hasSavedSession()).toBe(true)
    expect(useGameStore.getState().resuming).toBe(true)
    expect(client.rememberedNickname()).toBe('rex')
  })

  it.each([
    ['格式錯誤', '{oops'],
    ['缺 token', JSON.stringify({ nickname: 'rex' })],
    ['型別不符', JSON.stringify({ nickname: 1, token: 2 })],
  ])('憑證%s：視為沒有', async (_name, raw) => {
    const { client, useGameStore } = await load(fakeSessionStorage({ [SESSION_KEY]: raw }))
    expect(client.hasSavedSession()).toBe(false)
    expect(useGameStore.getState().resuming).toBe(false)
  })

  it('sessionStorage 不可用（丟例外）：視為沒有，不丟錯', async () => {
    const { client, useGameStore } = await load('throw')
    expect(client.hasSavedSession()).toBe(false)
    expect(useGameStore.getState().resuming).toBe(false)
  })
})

describe('resuming 的轉移', () => {
  it('被其他分頁接管（io server disconnect）：清憑證 → resuming false、回首頁顯示錯誤', async () => {
    const storage = fakeSessionStorage(SAVED)
    const { client, useGameStore } = await load(storage)
    useGameStore.setState({ me: 'p1' })
    fire(client.socket, 'disconnect', 'io server disconnect')
    expect(useGameStore.getState().resuming).toBe(false)
    expect(useGameStore.getState().me).toBeNull()
    expect(useGameStore.getState().joinError).toContain('其他分頁')
    expect(storage.map.has(SESSION_KEY)).toBe(false)
    expect(client.hasSavedSession()).toBe(false)
  })

  it('一般斷線（transport close）：保留憑證與 resuming', async () => {
    const { client, useGameStore } = await load(fakeSessionStorage(SAVED))
    fire(client.socket, 'disconnect', 'transport close')
    expect(useGameStore.getState().resuming).toBe(true)
    expect(client.hasSavedSession()).toBe(true)
  })

  it('自動重新加入失敗（憑證失效等）：清憑證 → resuming false、首頁顯示錯誤', async () => {
    const storage = fakeSessionStorage(SAVED)
    const { client, useGameStore } = await load(storage)
    Object.defineProperty(client.socket, 'connected', { value: true, configurable: true })
    vi.spyOn(client.socket, 'timeout').mockReturnValue({
      emit: (_event: string, _payload: unknown, ack: (err: Error | null, res: unknown) => void) =>
        ack(null, { ok: false, error: 'NICKNAME_TAKEN', message: '暱稱已被使用' }),
    } as never)
    fire(client.socket, 'connect')
    await vi.waitFor(() => expect(useGameStore.getState().resuming).toBe(false))
    expect(useGameStore.getState().joinError).toBe('自動重新加入失敗：暱稱已被使用')
    expect(storage.map.has(SESSION_KEY)).toBe(false)
  })

  it('自動重新加入途中斷線（DISCONNECTED）：維持 resuming（下次 connect 再試）', async () => {
    const { client, useGameStore } = await load(fakeSessionStorage(SAVED))
    // socket.connected 為 false → sendJoin 立即回 DISCONNECTED
    fire(client.socket, 'connect')
    await vi.waitFor(() => expect(useGameStore.getState().autoJoining).toBe(false))
    expect(useGameStore.getState().resuming).toBe(true)
    expect(client.hasSavedSession()).toBe(true)
  })

  it('自動重新加入成功：套用快照、resuming 不改動（已加入 → 遊戲畫面）', async () => {
    const { client, useGameStore } = await load(fakeSessionStorage(SAVED))
    Object.defineProperty(client.socket, 'connected', { value: true, configurable: true })
    const snapshot = {
      you: 'p1',
      players: [{ id: 'p1', nickname: 'rex', score: 0, isDrawer: false, hasGuessed: false, connected: true, joinedAt: 0 }],
      round: useGameStore.getState().round,
      ops: [],
      chat: [],
    }
    vi.spyOn(client.socket, 'timeout').mockReturnValue({
      emit: (_event: string, _payload: unknown, ack: (err: Error | null, res: unknown) => void) =>
        ack(null, { ok: true, data: { token: 't-2', snapshot } }),
    } as never)
    fire(client.socket, 'connect')
    await vi.waitFor(() => expect(useGameStore.getState().me).toBe('p1'))
    expect(useGameStore.getState().resuming).toBe(true)
  })
})

describe('contest:comment 接到 store（Epic 15；architecture §4）', () => {
  const entry = (playerId: string, commentPending: boolean) => ({
    playerId,
    nickname: playerId,
    rank: 1,
    score: 50,
    confidence: 0.5,
    judgedBy: 'ai' as const,
    submitted: true,
    submittedAt: 1,
    comment: null,
    commentPending,
  })

  it('已加入：把評語填進 round.results 該筆、commentPending 設 false', async () => {
    const { client, useGameStore } = await load(fakeSessionStorage())
    const round = { ...useGameStore.getState().round, roundNo: 2, phase: 'ended' as const, results: [entry('a', true), entry('b', true)] }
    useGameStore.setState({ me: 'p1', round })
    fire(client.socket, 'contest:comment', { roundNo: 2, playerId: 'b', comment: '雜魚～' })
    expect(useGameStore.getState().round.results?.map((r) => [r.playerId, r.comment, r.commentPending])).toEqual([
      ['a', null, true],
      ['b', '雜魚～', false],
    ])
    // 失敗（null）也收：不再 pending
    fire(client.socket, 'contest:comment', { roundNo: 2, playerId: 'a', comment: null })
    expect(useGameStore.getState().round.results?.[0]).toMatchObject({ comment: null, commentPending: false })
  })

  it('未加入（me 為 null）：忽略', async () => {
    const { client, useGameStore } = await load(fakeSessionStorage())
    const round = { ...useGameStore.getState().round, roundNo: 2, phase: 'ended' as const, results: [entry('a', true)] }
    useGameStore.setState({ me: null, round })
    fire(client.socket, 'contest:comment', { roundNo: 2, playerId: 'a', comment: '雜魚～' })
    expect(useGameStore.getState().round).toBe(round)
  })

  it('只註冊一個 contest:comment 處理', async () => {
    const { client } = await load(fakeSessionStorage())
    expect((client.socket as unknown as { listeners(e: string): unknown[] }).listeners('contest:comment')).toHaveLength(1)
  })
})

describe('contest:gallery 交給比賽歷史（Epic 17；plan/contest-history.md 決策 4）', () => {
  const entry = (playerId: string, rank: number) => ({
    playerId,
    nickname: playerId,
    rank,
    score: 90 - rank,
    confidence: 0.5,
    judgedBy: 'ai' as const,
    submitted: true,
    submittedAt: rank,
    comment: null,
    commentPending: false,
  })
  const png = () => new Uint8Array(8).fill(1).buffer

  /** 載入 client 後，以記憶體假 DB 啟動同一份模組實例的歷史 */
  async function loadWithHistory() {
    const loaded = await load(fakeSessionStorage())
    const history = await import('../src/features/history/historyStore')
    const { createMemoryHistoryDb } = await import('../src/features/history/historyDb')
    const db = createMemoryHistoryDb()
    const stop = history.startHistory({ db, now: () => 5000, warn: () => {} })
    return { ...loaded, history, db, stop }
  }

  it('已加入：round:update（ended）建檔，之後的 contest:gallery 把圖存進那一筆；store 的畫廊照舊', async () => {
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:test/1')
    const { client, useGameStore, history, db, stop } = await loadWithHistory()
    useGameStore.setState({ me: 'p1' })
    const round = { ...useGameStore.getState().round, roundNo: 2, phase: 'ended' as const, startedAt: 2000, lastTopic: '蘋果', results: [entry('a', 1), entry('p1', 2)] }
    fire(client.socket, 'round:update', round)
    fire(client.socket, 'contest:gallery', { roundNo: 2, playerId: 'a', png: png() })
    // 別的回合的圖：store 與歷史都不收
    fire(client.socket, 'contest:gallery', { roundNo: 1, playerId: 'p1', png: png() })
    await history.historySettled()
    const rows = await db.getAll()
    expect(rows.map((r) => [r.id, r.roundNo, r.topic, r.me, Object.keys(r.images)])).toEqual([[2000, 2, '蘋果', 'p1', ['a']]])
    expect(rows[0]?.images.a?.type).toBe('image/png')
    expect([...useGameStore.getState().gallery.keys()]).toEqual(['a'])
    stop()
  })

  it('未加入（me 為 null）：忽略，不建檔也不存圖', async () => {
    const { client, useGameStore, history, db, stop } = await loadWithHistory()
    const round = { ...useGameStore.getState().round, roundNo: 2, phase: 'ended' as const, startedAt: 2000, lastTopic: '蘋果', results: [entry('a', 1)] }
    fire(client.socket, 'round:update', round)
    fire(client.socket, 'contest:gallery', { roundNo: 2, playerId: 'a', png: png() })
    await history.historySettled()
    expect(await db.getAll()).toEqual([])
    expect(useGameStore.getState().gallery.size).toBe(0)
    stop()
  })

  it('只註冊一個 contest:gallery 處理', async () => {
    const { client } = await load(fakeSessionStorage())
    expect((client.socket as unknown as { listeners(e: string): unknown[] }).listeners('contest:gallery')).toHaveLength(1)
  })
})
