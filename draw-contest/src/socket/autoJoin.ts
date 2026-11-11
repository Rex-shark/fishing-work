// 連線（含重連）後以憑證自動重新加入的小狀態機（spec/architecture.md §9.1「客戶端自動重加入」；plan/hardening.md 決策 5）。
// 只有 server 明確回 ok: false 才放棄憑證；ack 沒回來（socket.io timeout 回呼的 err：逾時或途中斷線）一律保留憑證：
//   - 此刻已斷線 → 什麼都不做，等下一次 connect（onConnect）再自動加入；
//   - 仍連線（真逾時）→ AUTO_JOIN_RETRY_MS 後重試，最多 AUTO_JOIN_MAX_RETRIES 次；仍失敗 → onGiveUp（回首頁顯示錯誤、不清憑證）。
// 重試次數在每次 connect 與成功時歸零。時鐘（計時器）、連線狀態與送出都可注入，測試不靠真時間、不連線。
// 三款遊戲各自一份（不抽共用，plan/hardening.md 決策 5）。

/** 一次自動加入的結果：ok＝已套用快照；rejected＝server 明確回 ok: false；noAck＝沒收到 ack（逾時、途中斷線、送出時未連線） */
export type AutoJoinAttempt = { kind: 'ok' } | { kind: 'rejected'; message: string } | { kind: 'noAck' }

/** 仍連線卻沒等到 ack 時，隔多久重試 */
export const AUTO_JOIN_RETRY_MS = 2000
/** 仍連線卻沒等到 ack 時，最多重試幾次（不含第一次） */
export const AUTO_JOIN_MAX_RETRIES = 3
/** 重試用盡時首頁顯示的錯誤 */
export const AUTO_JOIN_TIMEOUT_MESSAGE = '自動重新加入失敗：連線逾時'

export interface AutoJoinDeps {
  /** 此刻是否連線中（socket.connected） */
  isConnected(): boolean
  /** 有憑證就送一次帶 token 的 player:join；沒有憑證回 null（不送） */
  attempt(): Promise<AutoJoinAttempt> | null
  /** 自動加入進行中（含等待重試）；首頁按鈕據此停用 */
  setBusy(busy: boolean): void
  /** server 明確拒絕（憑證失效、暱稱被占用等）：清憑證、回首頁顯示錯誤 */
  onRejected(message: string): void
  /** 重試用盡：回首頁顯示 AUTO_JOIN_TIMEOUT_MESSAGE，但不清憑證（重新整理可再試） */
  onGiveUp(): void
  setTimer(fn: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
}

export interface AutoJoiner {
  /** socket 'connect'：重新開始一輪（重試次數歸零） */
  onConnect(): void
  /** socket 'disconnect'：取消待重試的計時器、作廢在途的那一次（等下一次 connect） */
  onDisconnect(): void
}

export function createAutoJoiner(deps: AutoJoinDeps): AutoJoiner {
  let timer: unknown = null
  let retries = 0
  /** 每次 connect／disconnect 遞增；在途請求回來時世代不符就丟棄結果 */
  let generation = 0
  /** 在途請求所屬的世代（null＝沒有在途）：同一世代不重複送 */
  let inFlightGen: number | null = null

  function clearRetry(): void {
    if (timer !== null) deps.clearTimer(timer)
    timer = null
  }

  function settle(): void {
    clearRetry()
    deps.setBusy(false)
  }

  function run(): void {
    if (inFlightGen === generation) return
    if (!deps.isConnected()) {
      settle()
      return
    }
    const pending = deps.attempt()
    if (pending === null) {
      settle()
      return
    }
    const gen = generation
    inFlightGen = gen
    deps.setBusy(true)
    void pending.then((r) => {
      if (inFlightGen === gen) inFlightGen = null
      if (gen !== generation) return
      if (r.kind === 'ok') {
        retries = 0
        settle()
        return
      }
      if (r.kind === 'rejected') {
        settle()
        deps.onRejected(r.message)
        return
      }
      // 沒收到 ack：已斷線就等下一次 connect；仍連線（真逾時）才排重試
      if (!deps.isConnected()) {
        settle()
        return
      }
      if (retries >= AUTO_JOIN_MAX_RETRIES) {
        settle()
        deps.onGiveUp()
        return
      }
      retries += 1
      clearRetry()
      timer = deps.setTimer(() => {
        timer = null
        run()
      }, AUTO_JOIN_RETRY_MS)
    })
  }

  return {
    onConnect() {
      generation += 1
      retries = 0
      clearRetry()
      run()
    },
    onDisconnect() {
      generation += 1
      settle()
    },
  }
}
