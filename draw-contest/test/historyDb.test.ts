// 比賽歷史的存放（features/history/historyDb；Epic 17；plan/contest-history.md 決策 2、3、5、9）：
//   HistoryDb 介面的共同行為（記憶體假實作與 IndexedDB wrapper 跑同一組：put／getAll 依 savedAt 降冪／update 單一交易／delete／修剪到 5 筆）、
//   IndexedDB wrapper 自己的部分（資料庫名、版本、object store 與主鍵、沒有索引、連線重用、失敗不快取、各種失敗都以 reject 回報而不是丟出未處理的錯誤）。
// 測試環境的限制：Node 沒有 IndexedDB，也不引入套件；wrapper 以「假的 IDBFactory」注入（只實作 wrapper 用到的 API，事件以 microtask 觸發、
//   交易失敗會回復、讀寫都經 structuredClone，行為照 IndexedDB 規格的這幾條）。真瀏覽器的配額、隱私模式、Blob 落地要靠瀏覽器實測。
import { describe, expect, it } from 'vitest'
import type { ResultEntry } from '@fishing-work/shared/draw-contest'
import {
  HISTORY_DB_NAME,
  HISTORY_DB_VERSION,
  HISTORY_MAX,
  HISTORY_STORE,
  createIndexedDbHistory,
  createMemoryHistoryDb,
  isHistoryRecord,
  sortBySavedAtDesc,
  trimHistory,
  type HistoryDb,
  type HistoryRecord,
} from '../src/features/history/historyDb'

const result = (playerId: string, rank: number, patch: Partial<ResultEntry> = {}): ResultEntry => ({
  playerId,
  nickname: playerId,
  rank,
  score: 100 - rank,
  confidence: 0.5,
  judgedBy: 'ai',
  submitted: true,
  submittedAt: rank,
  comment: null,
  commentPending: false,
  ...patch,
})

const record = (id: number, patch: Partial<HistoryRecord> = {}): HistoryRecord => ({
  id,
  savedAt: id,
  roundNo: 1,
  topic: `題目${id}`,
  judgeMode: 'ai',
  commentMode: 'ai',
  me: 'a',
  results: [result('a', 1)],
  images: {},
  ...patch,
})

const png = (n = 8) => new Blob([new Uint8Array(n).fill(1)], { type: 'image/png' })

// ─── 假的 IndexedDB ────────────────────────────────────────────────

interface FakeRequest {
  result: unknown
  error: unknown
  onsuccess: (() => void) | null
  onerror: (() => void) | null
  onupgradeneeded: (() => void) | null
}

interface FakeDb {
  objectStoreNames: { contains(name: string): boolean }
  createObjectStore(name: string, options: unknown): void
  transaction(name: string, mode: string): unknown
  close(): void
  onversionchange: (() => void) | null
  onclose: (() => void) | null
}

/** 假的 IDBFactory；knobs 用來製造失敗，log 記錄 wrapper 做了什麼 */
function fakeIndexedDb() {
  /** 已落地的資料（跨連線保留） */
  const stores = new Map<string, Map<number, unknown>>()
  let version = 0
  /** 上一個交易結束的時點（交易排隊用） */
  let tail: Promise<void> = Promise.resolve()
  const log = {
    opens: [] as [string, number][],
    created: [] as [string, unknown][],
    transactions: [] as string[],
    closed: 0,
    dbs: [] as FakeDb[],
  }
  const knobs = {
    /** 下一次 open 失敗 */
    failOpen: null as Error | null,
    /** 下一次 put 的請求失敗（例如配額滿）→ 交易中止 */
    failPut: null as Error | null,
    /** 下一次 db.transaction() 直接丟例外（連線已關閉） */
    throwOnTransaction: null as Error | null,
  }
  const request = (): FakeRequest => ({ result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null })

  function makeDb(): FakeDb {
    const db: FakeDb = {
      objectStoreNames: { contains: (name) => stores.has(name) },
      createObjectStore: (name, options) => {
        stores.set(name, new Map())
        log.created.push([name, options])
      },
      transaction(name, mode) {
        if (knobs.throwOnTransaction !== null) {
          const error = knobs.throwOnTransaction
          knobs.throwOnTransaction = null
          throw error
        }
        log.transactions.push(mode)
        // 同一個 store 的交易依建立順序一個接一個執行（IndexedDB 對重疊的 readwrite 交易的保證；這裡連 readonly 也排隊，較嚴格無妨）
        const turn = tail
        let release = () => {}
        tail = new Promise<void>((resolve) => (release = resolve))
        /** 交易內的工作副本：輪到時才複製，完成才換上去，中止就丟掉 */
        let working = new Map<number, unknown>()
        const started = turn.then(() => {
          working = new Map(stores.get(name))
        })
        let pending = 0
        let finished = false
        const finish = () => {
          finished = true
          release()
        }
        const tx = {
          error: null as unknown,
          oncomplete: null as (() => void) | null,
          onerror: null as ((event: { target: FakeRequest }) => void) | null,
          onabort: null as (() => void) | null,
          abort() {
            if (finished) throw new Error('InvalidStateError')
            finish()
            queueMicrotask(() => tx.onabort?.())
          },
          objectStore: () => store,
        }
        const settle = () =>
          void started.then(() =>
            queueMicrotask(() => {
              if (finished || pending > 0) return
              finish()
              stores.set(name, working)
              tx.oncomplete?.()
            }),
          )
        const run = (work: () => unknown): FakeRequest => {
          const req = request()
          pending++
          void started.then(() => {
            if (finished) return
            try {
              req.result = work()
            } catch (error) {
              // 請求失敗：error 事件冒到交易，交易接著中止
              req.error = error
              finish()
              tx.onerror?.({ target: req })
              tx.error = error
              tx.onabort?.()
              return
            }
            req.onsuccess?.()
            pending--
            settle()
          })
          return req
        }
        const store = {
          get: (id: number) => run(() => structuredClone(working.get(id))),
          getAll: () => run(() => structuredClone([...working.values()])),
          put: (value: { id: number }) =>
            run(() => {
              if (knobs.failPut !== null) {
                const error = knobs.failPut
                knobs.failPut = null
                throw error
              }
              working.set(value.id, structuredClone(value))
            }),
          delete: (id: number) => run(() => void working.delete(id)),
        }
        settle()
        return tx
      },
      close: () => void log.closed++,
      onversionchange: null,
      onclose: null,
    }
    log.dbs.push(db)
    return db
  }

  const factory = {
    open(name: string, wanted: number) {
      log.opens.push([name, wanted])
      const req = request()
      queueMicrotask(() => {
        if (knobs.failOpen !== null) {
          req.error = knobs.failOpen
          knobs.failOpen = null
          req.onerror?.()
          return
        }
        req.result = makeDb()
        if (version < wanted) {
          version = wanted
          req.onupgradeneeded?.()
        }
        req.onsuccess?.()
      })
      return req
    },
  }
  return { factory: factory as unknown as IDBFactory, stores, log, knobs }
}

// ─── 共同行為：兩種實作跑同一組 ─────────────────────────────────────────

const implementations: [string, () => HistoryDb][] = [
  ['記憶體假實作', () => createMemoryHistoryDb()],
  ['IndexedDB wrapper（假的 IDBFactory）', () => createIndexedDbHistory(() => fakeIndexedDb().factory)],
]

describe.each(implementations)('HistoryDb 介面：%s', (_name, create) => {
  it('一開始是空的', async () => {
    expect(await create().getAll()).toEqual([])
  })

  it('put 後 getAll 讀得到整筆（含圖片 Blob）；同 id 再 put 是覆蓋', async () => {
    const db = create()
    await db.put(record(1000, { images: { a: png(8) } }))
    const [first] = await db.getAll()
    expect(first).toMatchObject({ id: 1000, savedAt: 1000, topic: '題目1000', me: 'a', roundNo: 1 })
    expect(first?.images.a).toBeInstanceOf(Blob)
    expect(first?.images.a?.type).toBe('image/png')
    expect(first?.images.a?.size).toBe(8)
    await db.put(record(1000, { topic: '改過' }))
    expect((await db.getAll()).map((r) => r.topic)).toEqual(['改過'])
  })

  it('getAll 依 savedAt 降冪（最新在前），不是寫入順序也不是 id 順序；同時間以 id 降冪', async () => {
    const db = create()
    await db.put(record(1, { savedAt: 50 }))
    await db.put(record(2, { savedAt: 90 }))
    await db.put(record(3, { savedAt: 10 }))
    await db.put(record(4, { savedAt: 90 }))
    expect((await db.getAll()).map((r) => r.id)).toEqual([4, 2, 1, 3])
  })

  it('update：把目前內容交給 change，回傳的整筆寫回，結果為 true；沒有那一筆時 change 收到 undefined', async () => {
    const db = create()
    const seen: (HistoryRecord | undefined)[] = []
    expect(
      await db.update(7, (existing) => {
        seen.push(existing)
        return record(7, { topic: '新建' })
      }),
    ).toBe(true)
    expect(
      await db.update(7, (existing) => {
        seen.push(existing)
        return existing === undefined ? null : { ...existing, topic: `${existing.topic}＋更新` }
      }),
    ).toBe(true)
    expect(seen[0]).toBeUndefined()
    expect(seen[1]?.topic).toBe('新建')
    expect((await db.getAll()).map((r) => r.topic)).toEqual(['新建＋更新'])
  })

  it('update：change 回 null 就不寫（結果為 false），原內容不變', async () => {
    const db = create()
    await db.put(record(7))
    expect(await db.update(7, () => null)).toBe(false)
    expect(await db.update(8, () => null)).toBe(false)
    expect((await db.getAll()).map((r) => [r.id, r.topic])).toEqual([[7, '題目7']])
  })

  it('同一筆連續 update（不等前一個完成）：每一個都看得到前一個的結果，不互相蓋掉', async () => {
    const db = create()
    await db.put(record(7))
    const add = (playerId: string) =>
      db.update(7, (existing) => (existing === undefined ? null : { ...existing, images: { ...existing.images, [playerId]: png() } }))
    await Promise.all([add('a'), add('b'), add('c')])
    expect(Object.keys((await db.getAll())[0]?.images ?? {}).sort()).toEqual(['a', 'b', 'c'])
  })

  it('delete：刪掉那一筆；刪不存在的 id 不出錯', async () => {
    const db = create()
    await db.put(record(1))
    await db.put(record(2))
    await db.delete(1)
    await db.delete(99)
    expect((await db.getAll()).map((r) => r.id)).toEqual([2])
  })

  it(`trimHistory：超過 ${HISTORY_MAX} 筆就刪 savedAt 最舊的，回傳被刪的 id；沒超過不動`, async () => {
    const db = create()
    expect(HISTORY_MAX).toBe(5)
    for (const id of [3, 1, 5, 2, 4]) await db.put(record(id))
    expect(await trimHistory(db)).toEqual([])
    expect(await db.getAll()).toHaveLength(5)
    await db.put(record(6))
    expect(await trimHistory(db)).toEqual([1])
    expect((await db.getAll()).map((r) => r.id)).toEqual([6, 5, 4, 3, 2])
    // savedAt 才是依據（不是 id）：id 最大但建檔最早的那筆先被刪；一次超過很多也修到剩 max
    await db.put(record(100, { savedAt: 0 }))
    await db.put(record(101, { savedAt: 1000 }))
    expect(await trimHistory(db)).toEqual([2, 100])
    expect((await db.getAll()).map((r) => r.id)).toEqual([101, 6, 5, 4, 3])
    expect(await trimHistory(db, 2)).toEqual([5, 4, 3])
  })
})

describe('純函式', () => {
  it('sortBySavedAtDesc 不改原陣列', () => {
    const list = [record(1), record(3), record(2)]
    expect(sortBySavedAtDesc(list).map((r) => r.id)).toEqual([3, 2, 1])
    expect(list.map((r) => r.id)).toEqual([1, 3, 2])
  })

  it('isHistoryRecord：形狀不對的（別的版本、被改壞）不算', () => {
    expect(isHistoryRecord(record(1))).toBe(true)
    for (const bad of [null, undefined, 1, 'x', {}, { ...record(1), id: '1' }, { ...record(1), results: null }, { ...record(1), images: null }, { ...record(1), savedAt: undefined }]) {
      expect(isHistoryRecord(bad), JSON.stringify(bad)).toBe(false)
    }
  })
})

// ─── IndexedDB wrapper 自己的部分 ───────────────────────────────────────

describe('createIndexedDbHistory：資料庫、連線', () => {
  it('建立時不碰 IndexedDB；第一次操作才開：資料庫 fishing-work:draw-contest 版本 1、object store history 主鍵 id、沒有索引', async () => {
    const idb = fakeIndexedDb()
    let asked = 0
    const db = createIndexedDbHistory(() => {
      asked++
      return idb.factory
    })
    expect(asked).toBe(0)
    expect(idb.log.opens).toEqual([])
    await db.getAll()
    expect([HISTORY_DB_NAME, HISTORY_DB_VERSION, HISTORY_STORE]).toEqual(['fishing-work:draw-contest', 1, 'history'])
    expect(idb.log.opens).toEqual([['fishing-work:draw-contest', 1]])
    expect(idb.log.created).toEqual([['history', { keyPath: 'id' }]])
  })

  it('連線開好後重複使用；已經有 object store（之前開過）就不再建', async () => {
    const idb = fakeIndexedDb()
    const db = createIndexedDbHistory(() => idb.factory)
    await db.put(record(1))
    await db.getAll()
    await db.delete(1)
    expect(idb.log.opens).toHaveLength(1)
    // 另一個分頁（另一個 wrapper）開同一個資料庫：不必升版、讀得到同一份資料
    await db.put(record(2))
    const other = createIndexedDbHistory(() => idb.factory)
    expect((await other.getAll()).map((r) => r.id)).toEqual([2])
    expect(idb.log.created).toHaveLength(1)
  })

  it('讀取用 readonly 交易，寫入（put／update／delete）用 readwrite；update 的讀與寫在同一個交易', async () => {
    const idb = fakeIndexedDb()
    const db = createIndexedDbHistory(() => idb.factory)
    await db.put(record(1))
    await db.update(1, (existing) => existing ?? null)
    await db.getAll()
    await db.delete(1)
    expect(idb.log.transactions).toEqual(['readwrite', 'readwrite', 'readonly', 'readwrite'])
  })

  it('getAll 略過形狀不對的資料（不讓畫面壞掉）；update 遇到形狀不對的那一筆當作沒有', async () => {
    const idb = fakeIndexedDb()
    const db = createIndexedDbHistory(() => idb.factory)
    await db.put(record(1))
    idb.stores.get('history')?.set(2, { id: 2, oops: true })
    expect((await db.getAll()).map((r) => r.id)).toEqual([1])
    const seen: unknown[] = []
    await db.update(2, (existing) => {
      seen.push(existing)
      return null
    })
    expect(seen).toEqual([undefined])
  })

  it('別的分頁要升版（versionchange）：關掉自己的連線，下次操作重開', async () => {
    const idb = fakeIndexedDb()
    const db = createIndexedDbHistory(() => idb.factory)
    await db.put(record(1))
    idb.log.dbs[0]?.onversionchange?.()
    expect(idb.log.closed).toBe(1)
    expect((await db.getAll()).map((r) => r.id)).toEqual([1])
    expect(idb.log.opens).toHaveLength(2)
  })

  it('連線被瀏覽器關掉（close 事件，例如清除網站資料）：下次操作重開', async () => {
    const idb = fakeIndexedDb()
    const db = createIndexedDbHistory(() => idb.factory)
    await db.getAll()
    idb.log.dbs[0]?.onclose?.()
    await db.getAll()
    expect(idb.log.opens).toHaveLength(2)
  })
})

describe('createIndexedDbHistory：不可用與失敗（決策 9：一律以 reject 回報，由 historyStore 接住）', () => {
  const each = (db: HistoryDb): [string, () => Promise<unknown>][] => [
    ['getAll', () => db.getAll()],
    ['put', () => db.put(record(1))],
    ['update', () => db.update(1, () => record(1))],
    ['delete', () => db.delete(1)],
  ]

  it('沒有 indexedDB（undefined）：四個方法都 reject，不丟同步例外', async () => {
    for (const [name, call] of each(createIndexedDbHistory(() => undefined))) {
      await expect(call(), name).rejects.toThrow('IndexedDB 不可用')
    }
  })

  it('取用 indexedDB 本身丟例外（被封鎖的瀏覽器）：四個方法都 reject', async () => {
    const blocked = createIndexedDbHistory(() => {
      throw new Error('SecurityError')
    })
    for (const [name, call] of each(blocked)) await expect(call(), name).rejects.toThrow('SecurityError')
  })

  it('預設讀全域的 indexedDB：測試環境（Node）沒有 → reject', async () => {
    expect((globalThis as { indexedDB?: unknown }).indexedDB).toBeUndefined()
    await expect(createIndexedDbHistory().getAll()).rejects.toThrow('IndexedDB 不可用')
  })

  it('open 失敗（隱私模式）：reject；失敗不快取，下一次操作重試', async () => {
    const idb = fakeIndexedDb()
    const db = createIndexedDbHistory(() => idb.factory)
    idb.knobs.failOpen = new Error('open blocked')
    await expect(db.getAll()).rejects.toThrow('open blocked')
    expect(await db.getAll()).toEqual([])
    expect(idb.log.opens).toHaveLength(2)
  })

  it('open 失敗時同時排著的操作全部 reject（共用同一次開啟）', async () => {
    const idb = fakeIndexedDb()
    const db = createIndexedDbHistory(() => idb.factory)
    idb.knobs.failOpen = new Error('open blocked')
    const results = await Promise.allSettled([db.getAll(), db.put(record(1)), db.delete(1)])
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected', 'rejected'])
    expect(idb.log.opens).toHaveLength(1)
  })

  it('寫入失敗（配額滿：put 的請求失敗、交易中止）：reject 並帶原因；資料沒被改；之後的操作照常', async () => {
    const idb = fakeIndexedDb()
    const db = createIndexedDbHistory(() => idb.factory)
    await db.put(record(1))
    idb.knobs.failPut = new Error('QuotaExceededError')
    await expect(db.put(record(2))).rejects.toThrow('QuotaExceededError')
    idb.knobs.failPut = new Error('QuotaExceededError')
    await expect(db.update(1, (existing) => (existing === undefined ? null : { ...existing, topic: '改' }))).rejects.toThrow('QuotaExceededError')
    expect((await db.getAll()).map((r) => [r.id, r.topic])).toEqual([[1, '題目1']])
    await db.put(record(3))
    expect(await db.getAll()).toHaveLength(2)
  })

  it('update 的 change 丟例外：中止交易、以該例外 reject（不會變成請求回呼裡的未處理錯誤）；資料沒被改', async () => {
    const idb = fakeIndexedDb()
    const db = createIndexedDbHistory(() => idb.factory)
    await db.put(record(1))
    await expect(
      db.update(1, () => {
        throw new Error('merge bug')
      }),
    ).rejects.toThrow('merge bug')
    expect((await db.getAll()).map((r) => r.topic)).toEqual(['題目1'])
  })

  it('交易開不起來（連線已失效）：reject，放掉連線，下一次操作重開', async () => {
    const idb = fakeIndexedDb()
    const db = createIndexedDbHistory(() => idb.factory)
    await db.put(record(1))
    idb.knobs.throwOnTransaction = new Error('InvalidStateError')
    await expect(db.getAll()).rejects.toThrow('InvalidStateError')
    expect((await db.getAll()).map((r) => r.id)).toEqual([1])
    expect(idb.log.opens).toHaveLength(2)
  })
})
