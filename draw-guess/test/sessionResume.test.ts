// socket/client 的重連憑證與 resuming（plan/home-page.md 決策 4）：hasSavedSession、啟動時的 resuming、清掉憑證的路徑。
// 以假的 location／sessionStorage 載入模組（socket 為 autoConnect: false，不會真的連線）；socket.connect／timeout 以 spy 取代。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SESSION_KEY = 'fishing-work:draw-guess:session'

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
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost', hostname: 'localhost', port: '', href: 'http://localhost/draw-guess/' })
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

const SNAPSHOT = (round: unknown) => ({
  you: 'p1',
  players: [{ id: 'p1', nickname: 'rex', score: 0, isDrawer: false, hasGuessed: false, connected: true, joinedAt: 0 }],
  round,
  ops: [],
  chat: [],
})

describe('自動重新加入沒收到 ack（Epic 21 決策 5；spec/architecture.md §9.1）', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  /** 讓 socket 看起來已連線，並以 handler 決定每次 player:join 的 ack；回傳送出次數 */
  function stubJoin(client: Awaited<ReturnType<typeof load>>['client'], handler: (n: number, ack: (err: Error | null, res: unknown) => void) => void) {
    Object.defineProperty(client.socket, 'connected', { value: true, configurable: true, writable: true })
    let n = 0
    vi.spyOn(client.socket, 'timeout').mockReturnValue({
      emit: (_event: string, _payload: unknown, ack: (err: Error | null, res: unknown) => void) => handler(++n, ack),
    } as never)
    return () => n
  }

  it('ack err 且此刻已斷線：保留憑證與 resuming，不排重試（等下次 connect）', async () => {
    const storage = fakeSessionStorage(SAVED)
    const { client, useGameStore } = await load(storage)
    vi.useFakeTimers()
    const sends = stubJoin(client, (_n, ack) => {
      Object.defineProperty(client.socket, 'connected', { value: false, configurable: true, writable: true })
      ack(new Error('socket has been disconnected'), undefined)
    })
    fire(client.socket, 'connect')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(sends()).toBe(1)
    expect(useGameStore.getState().resuming).toBe(true)
    expect(useGameStore.getState().joinError).toBeNull()
    expect(useGameStore.getState().autoJoining).toBe(false)
    expect(storage.map.has(SESSION_KEY)).toBe(true)
  })

  it('ack err 且仍連線：2 秒後重試，第 3 次重試仍失敗 → 回首頁顯示「自動重新加入失敗：連線逾時」，憑證仍在', async () => {
    const storage = fakeSessionStorage(SAVED)
    const { client, useGameStore } = await load(storage)
    vi.useFakeTimers()
    const sends = stubJoin(client, (_n, ack) => ack(new Error('operation has timed out'), undefined))
    fire(client.socket, 'connect')
    await vi.advanceTimersByTimeAsync(0)
    expect(sends()).toBe(1)
    await vi.advanceTimersByTimeAsync(1_999)
    expect(sends()).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(sends()).toBe(2)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(sends()).toBe(3)
    expect(useGameStore.getState().resuming).toBe(true)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(sends()).toBe(4)
    expect(useGameStore.getState().resuming).toBe(false)
    expect(useGameStore.getState().joinError).toBe('自動重新加入失敗：連線逾時')
    expect(storage.map.has(SESSION_KEY)).toBe(true)
    expect(client.hasSavedSession()).toBe(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sends()).toBe(4)
  })

  it('重試途中成功：停止重試、套用快照', async () => {
    const { client, useGameStore } = await load(fakeSessionStorage(SAVED))
    vi.useFakeTimers()
    const snapshot = { ...SNAPSHOT(useGameStore.getState().round) }
    const sends = stubJoin(client, (n, ack) =>
      n < 3 ? ack(new Error('operation has timed out'), undefined) : ack(null, { ok: true, data: { token: 't-2', snapshot } }),
    )
    fire(client.socket, 'connect')
    await vi.advanceTimersByTimeAsync(4_000)
    expect(sends()).toBe(3)
    expect(useGameStore.getState().me).toBe('p1')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sends()).toBe(3)
    expect(useGameStore.getState().joinError).toBeNull()
  })

  it('等待重試時斷線：取消重試，不送也不回首頁', async () => {
    const storage = fakeSessionStorage(SAVED)
    const { client, useGameStore } = await load(storage)
    vi.useFakeTimers()
    const sends = stubJoin(client, (_n, ack) => ack(new Error('operation has timed out'), undefined))
    fire(client.socket, 'connect')
    await vi.advanceTimersByTimeAsync(0)
    Object.defineProperty(client.socket, 'connected', { value: false, configurable: true, writable: true })
    fire(client.socket, 'disconnect', 'transport close')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sends()).toBe(1)
    expect(useGameStore.getState().resuming).toBe(true)
    expect(storage.map.has(SESSION_KEY)).toBe(true)
  })
})
