// 自動重新加入的狀態機（socket/autoJoin；spec/architecture.md §9.1；plan/hardening.md 決策 5）：
// 注入假計時器、連線狀態與送出，不靠真時間、不連線。整合到 socket/client 的路徑另見 sessionResume.test.ts。
import { describe, expect, it } from 'vitest'
import {
  AUTO_JOIN_MAX_RETRIES,
  AUTO_JOIN_RETRY_MS,
  createAutoJoiner,
  type AutoJoinAttempt,
} from '../src/socket/autoJoin'

function harness() {
  let connected = true
  let now = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  let nextId = 0
  /** 每次送出回傳一個待決的 promise，由測試決定結果 */
  const pending: ((r: AutoJoinAttempt) => void)[] = []
  const log: string[] = []
  let hasSession = true
  const joiner = createAutoJoiner({
    isConnected: () => connected,
    attempt: () => {
      if (!hasSession) return null
      log.push('send')
      return new Promise<AutoJoinAttempt>((resolve) => pending.push(resolve))
    },
    setBusy: (b) => void log.push(`busy=${b}`),
    onRejected: (m) => void log.push(`rejected:${m}`),
    onGiveUp: () => void log.push('giveUp'),
    setTimer: (fn, ms) => {
      const id = ++nextId
      timers.set(id, { at: now + ms, fn })
      return id
    },
    clearTimer: (id) => void timers.delete(id as number),
  })
  const flush = () => new Promise<void>((r) => setTimeout(r, 0))
  return {
    joiner,
    log,
    timers,
    sends: () => log.filter((l) => l === 'send').length,
    setConnected: (v: boolean) => void (connected = v),
    dropSession: () => void (hasSession = false),
    /** 決定最早那一個在途送出的結果 */
    async resolve(r: AutoJoinAttempt) {
      const fn = pending.shift()
      if (!fn) throw new Error('沒有在途的送出')
      fn(r)
      await flush()
    },
    inFlight: () => pending.length,
    advance(ms: number) {
      now += ms
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id)
          t.fn()
        }
      }
    },
  }
}

const NO_ACK: AutoJoinAttempt = { kind: 'noAck' }

describe('createAutoJoiner：server 明確回應', () => {
  it('ok：不重試、busy 收回', async () => {
    const h = harness()
    h.joiner.onConnect()
    expect(h.log).toEqual(['send', 'busy=true'])
    await h.resolve({ kind: 'ok' })
    expect(h.log.at(-1)).toBe('busy=false')
    expect(h.timers.size).toBe(0)
  })

  it('rejected（ok: false）：呼叫 onRejected（清憑證）、不重試', async () => {
    const h = harness()
    h.joiner.onConnect()
    await h.resolve({ kind: 'rejected', message: '暱稱已被使用' })
    expect(h.log).toContain('rejected:暱稱已被使用')
    expect(h.log).not.toContain('giveUp')
    expect(h.timers.size).toBe(0)
    h.advance(10_000)
    expect(h.sends()).toBe(1)
  })
})

describe('createAutoJoiner：沒收到 ack', () => {
  it('此刻已斷線：不清憑證、不排重試，等下一次 connect 再送', async () => {
    const h = harness()
    h.joiner.onConnect()
    h.setConnected(false)
    await h.resolve(NO_ACK)
    expect(h.log.some((l) => l.startsWith('rejected') || l === 'giveUp')).toBe(false)
    expect(h.timers.size).toBe(0)
    expect(h.log.at(-1)).toBe('busy=false')
    h.setConnected(true)
    h.joiner.onConnect()
    expect(h.sends()).toBe(2)
  })

  it('仍連線（真逾時）：每 2 秒重試，第 3 次重試仍失敗 → onGiveUp（不呼叫 onRejected）', async () => {
    const h = harness()
    h.joiner.onConnect()
    for (let i = 1; i <= AUTO_JOIN_MAX_RETRIES; i++) {
      await h.resolve(NO_ACK)
      expect(h.timers.size).toBe(1)
      h.advance(AUTO_JOIN_RETRY_MS - 1)
      expect(h.sends()).toBe(i)
      h.advance(1)
      expect(h.sends()).toBe(i + 1)
    }
    await h.resolve(NO_ACK)
    expect(h.log).toContain('giveUp')
    expect(h.log.some((l) => l.startsWith('rejected'))).toBe(false)
    expect(h.timers.size).toBe(0)
    expect(h.log.at(-2)).toBe('busy=false')
    h.advance(60_000)
    expect(h.sends()).toBe(1 + AUTO_JOIN_MAX_RETRIES)
  })

  it('重試途中成功：停止重試', async () => {
    const h = harness()
    h.joiner.onConnect()
    await h.resolve(NO_ACK)
    h.advance(AUTO_JOIN_RETRY_MS)
    await h.resolve({ kind: 'ok' })
    expect(h.timers.size).toBe(0)
    h.advance(60_000)
    expect(h.sends()).toBe(2)
    expect(h.log).not.toContain('giveUp')
  })

  it('等待重試時斷線：計時器取消；重連後重試次數歸零', async () => {
    const h = harness()
    h.joiner.onConnect()
    await h.resolve(NO_ACK)
    h.advance(AUTO_JOIN_RETRY_MS)
    await h.resolve(NO_ACK) // 已用掉 1 次重試，第 2 次已排程
    expect(h.timers.size).toBe(1)
    h.setConnected(false)
    h.joiner.onDisconnect()
    expect(h.timers.size).toBe(0)
    h.advance(60_000)
    expect(h.sends()).toBe(2)
    h.setConnected(true)
    h.joiner.onConnect()
    // 新的一輪：仍可再重試 AUTO_JOIN_MAX_RETRIES 次
    for (let i = 0; i < AUTO_JOIN_MAX_RETRIES; i++) {
      await h.resolve(NO_ACK)
      h.advance(AUTO_JOIN_RETRY_MS)
    }
    expect(h.log).not.toContain('giveUp')
    await h.resolve(NO_ACK)
    expect(h.log).toContain('giveUp')
  })
})

describe('createAutoJoiner：不重複送出、不重複排程', () => {
  it('在途時再收到 connect（新連線）：舊結果作廢，只依新那一次', async () => {
    const h = harness()
    h.joiner.onConnect()
    h.joiner.onDisconnect()
    h.joiner.onConnect()
    expect(h.sends()).toBe(2)
    await h.resolve(NO_ACK) // 舊世代：忽略，不排程
    expect(h.timers.size).toBe(0)
    await h.resolve({ kind: 'rejected', message: 'x' })
    expect(h.log.filter((l) => l.startsWith('rejected'))).toEqual(['rejected:x'])
  })

  it('重試計時器到期時已有在途送出（同世代）：不再送第二個', async () => {
    const h = harness()
    h.joiner.onConnect()
    await h.resolve(NO_ACK)
    h.advance(AUTO_JOIN_RETRY_MS)
    expect(h.inFlight()).toBe(1)
    h.advance(AUTO_JOIN_RETRY_MS * 5)
    expect(h.sends()).toBe(2)
    expect(h.timers.size).toBe(0)
  })

  it('沒有憑證：不送、busy 收回', () => {
    const h = harness()
    h.dropSession()
    h.joiner.onConnect()
    expect(h.sends()).toBe(0)
    expect(h.log).toEqual(['busy=false'])
  })

  it('connect 時未連線（理論上不會）：不送', () => {
    const h = harness()
    h.setConnected(false)
    h.joiner.onConnect()
    expect(h.sends()).toBe(0)
  })
})
