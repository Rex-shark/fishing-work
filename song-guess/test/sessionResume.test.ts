// socket/client 的重連憑證與 resuming（複製自我畫你猜的測試；憑證機制同另兩款）：hasSavedSession、啟動時的 resuming、清掉憑證的路徑。
// 以假的 location／sessionStorage 載入模組（socket 為 autoConnect: false，不會真的連線）；socket.connect／timeout 以 spy 取代。
// 同一套載入方式順帶驗 server 事件有接到 store（未加入時忽略）、出題動作的事件名稱與逾時。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SESSION_KEY = 'fishing-work:song-guess:session'

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
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost', hostname: 'localhost', port: '', href: 'http://localhost/song-guess/' })
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
      players: [{ id: 'p1', nickname: 'rex', score: 0, gameScore: 0, isSetter: false, hasGuessed: false, connected: true, joinedAt: 0 }],
      round: useGameStore.getState().round,
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

describe('server 事件接到 store（spec/song-guess/architecture.md §4 ServerToClientEvents）', () => {
  const player = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    nickname: id,
    score: 0,
    gameScore: 0,
    isSetter: false,
    hasGuessed: false,
    connected: true,
    joinedAt: 0,
    ...over,
  })

  it('已加入：round:update 更新 round 並以 serverNow 重估時鐘偏移', async () => {
    const { client, useGameStore } = await load(fakeSessionStorage())
    useGameStore.setState({ me: 'p1' })
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const round = { ...useGameStore.getState().round, gameNo: 1, phase: 'choosing' as const, setterId: 'p1', serverNow: 1_003_000 }
    fire(client.socket, 'round:update', round)
    expect(useGameStore.getState().round).toBe(round)
    expect(useGameStore.getState().clockOffset).toBe(3000)
  })

  it('已加入：players:update、chat:message 更新玩家與聊天（聊天以 id 去重）', async () => {
    const { client, useGameStore } = await load(fakeSessionStorage())
    useGameStore.setState({ me: 'p1' })
    fire(client.socket, 'players:update', [player('p1'), player('p2', { hasGuessed: true })])
    expect(useGameStore.getState().players.map((p) => p.id)).toEqual(['p1', 'p2'])
    const message = { id: 'm1', kind: 'correct' as const, fromId: 'p2', nickname: 'p2', text: 'p2 猜對了', at: 1 }
    fire(client.socket, 'chat:message', message)
    fire(client.socket, 'chat:message', message)
    expect(useGameStore.getState().chat).toEqual([message])
  })

  it('未加入（me 為 null）：三種事件都忽略', async () => {
    const { client, useGameStore } = await load(fakeSessionStorage())
    const before = useGameStore.getState()
    fire(client.socket, 'round:update', { ...before.round, gameNo: 9, serverNow: 5 })
    fire(client.socket, 'players:update', [player('p1')])
    fire(client.socket, 'chat:message', { id: 'm1', kind: 'chat', fromId: 'p1', nickname: 'p1', text: 'hi', at: 1 })
    expect(useGameStore.getState().round).toBe(before.round)
    expect(useGameStore.getState().players).toEqual([])
    expect(useGameStore.getState().chat).toEqual([])
  })

  it('每種事件只註冊一個處理', async () => {
    const { client } = await load(fakeSessionStorage())
    const listeners = (e: string) => (client.socket as unknown as { listeners(e: string): unknown[] }).listeners(e)
    for (const event of ['round:update', 'players:update', 'chat:message']) expect(listeners(event), event).toHaveLength(1)
  })
})

describe('出題動作的請求（round:volunteer／round:setSource／round:cancel／chat:send）', () => {
  /** 以假的 socket.timeout 記錄逾時與送出的事件，並回指定的 ack */
  async function loadConnected(ack: [Error | null, unknown]) {
    const { client, useGameStore } = await load(fakeSessionStorage())
    Object.defineProperty(client.socket, 'connected', { value: true, configurable: true })
    const calls: { timeout: number; event: string; payload: unknown }[] = []
    vi.spyOn(client.socket, 'timeout').mockImplementation(((timeout: number) => ({
      emit: (event: string, ...rest: unknown[]) => {
        const done = rest[rest.length - 1] as (err: Error | null, res: unknown) => void
        calls.push({ timeout, event, payload: rest.length > 1 ? rest[0] : undefined })
        done(...ack)
      },
    })) as never)
    return { client, useGameStore, calls }
  }

  it('送題庫來源：事件 round:setSource、payload 四種照契約原樣送出；逾時放寬到 25 秒（榜單 RSS 最久 12 秒 ＋ lookup 8 秒；動漫熱門三次搜尋並行各 8 秒）', async () => {
    const { client, calls } = await loadConnected([null, { ok: true, data: { topic: '孫燕姿' } }])
    expect(client.SET_SOURCE_ACK_TIMEOUT_MS).toBe(25_000)
    expect(await client.setSource({ source: 'artist', artist: '孫燕姿', hot: true })).toEqual({ ok: true })
    expect(await client.setSource({ source: 'tw-hot' })).toEqual({ ok: true })
    expect(await client.setSource({ source: 'western-hot' })).toEqual({ ok: true })
    expect(await client.setSource({ source: 'anime-hot' })).toEqual({ ok: true })
    expect(calls).toEqual([
      { timeout: 25_000, event: 'round:setSource', payload: { source: 'artist', artist: '孫燕姿', hot: true } },
      { timeout: 25_000, event: 'round:setSource', payload: { source: 'tw-hot' } },
      { timeout: 25_000, event: 'round:setSource', payload: { source: 'western-hot' } },
      { timeout: 25_000, event: 'round:setSource', payload: { source: 'anime-hot' } },
    ])
  })

  it('送題庫來源失敗：錯誤碼與 server 的繁中訊息原樣帶回（含新碼 CHART_FAILED、SOURCE_INVALID）', async () => {
    for (const [error, message] of [
      ['ARTIST_NOT_FOUND', '找不到這位歌手的歌（至少要 5 首有試聽的歌），換一位試試'],
      ['CHART_FAILED', '取得題庫失敗，請再試一次'],
      ['SOURCE_INVALID', '題庫來源不正確，請重新選擇'],
    ] as const) {
      const { client } = await loadConnected([null, { ok: false, error, message }])
      expect(await client.setSource({ source: 'tw-hot' })).toEqual({ ok: false, error, message })
      const again = await loadConnected([null, { ok: false, error, message }])
      expect(await again.client.setSource({ source: 'anime-hot' })).toEqual({ ok: false, error, message })
    }
  })

  it('送題庫來源沒等到 ack（25 秒逾時）→ TIMEOUT', async () => {
    const { client, calls } = await loadConnected([new Error('timeout'), undefined])
    expect(await client.setSource({ source: 'western-hot' })).toMatchObject({ ok: false, error: 'TIMEOUT' })
    expect(calls).toEqual([{ timeout: 25_000, event: 'round:setSource', payload: { source: 'western-hot' } }])
  })

  it('其餘請求逾時 5 秒；沒等到 ack → TIMEOUT', async () => {
    const { client, calls } = await loadConnected([new Error('timeout'), undefined])
    expect(await client.volunteer()).toMatchObject({ ok: false, error: 'TIMEOUT' })
    expect(await client.cancelRound()).toMatchObject({ ok: false, error: 'TIMEOUT' })
    expect(await client.sendChat('如果可以')).toMatchObject({ ok: false, error: 'TIMEOUT' })
    expect(calls).toEqual([
      { timeout: 5000, event: 'round:volunteer', payload: undefined },
      { timeout: 5000, event: 'round:cancel', payload: undefined },
      { timeout: 5000, event: 'chat:send', payload: { text: '如果可以' } },
    ])
  })

  it('未連線：不送出，回 DISCONNECTED', async () => {
    const { client } = await load(fakeSessionStorage())
    const timeout = vi.spyOn(client.socket, 'timeout')
    for (const r of [await client.volunteer(), await client.setSource({ source: 'artist', artist: 'x', hot: true }), await client.cancelRound(), await client.sendChat('x')]) {
      expect(r).toMatchObject({ ok: false, error: 'DISCONNECTED' })
    }
    expect(timeout).not.toHaveBeenCalled()
  })

  it('namespace 為 /song-guess、path 固定 /socket.io、不自動連線', async () => {
    const { client } = await load(fakeSessionStorage())
    const socket = client.socket as unknown as { nsp: string; io: { opts: { path?: string; autoConnect?: boolean } } }
    expect(socket.nsp).toBe('/song-guess')
    expect(socket.io.opts.path).toBe('/socket.io')
    expect(socket.io.opts.autoConnect).toBe(false)
  })
})

const SNAPSHOT = (round: unknown) => ({
  you: 'p1',
  players: [{ id: 'p1', nickname: 'rex', score: 0, gameScore: 0, isSetter: false, hasGuessed: false, connected: true, joinedAt: 0 }],
  round,
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
