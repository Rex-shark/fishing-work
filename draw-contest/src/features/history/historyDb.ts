// 比賽歷史的存放（Epic 17；plan/contest-history.md 決策 2、3、5、9；spec/draw-contest/architecture.md §7）：
// 只存在使用者自己的瀏覽器（IndexedDB），不經 server、不同步；同一瀏覽器的所有分頁共用同一個資料庫、不分暱稱。
//   資料庫 fishing-work:draw-contest（版本 1）、object store history、主鍵 id（＝該回合 round.startedAt），沒有索引（最多 5 筆，讀出後在記憶體排序）。
// 本檔只有「存取」：HistoryDb 介面、原生 IndexedDB 的小 wrapper（不用任何套件）、記憶體假實作（測試注入用）、修剪到 HISTORY_MAX。
// 何時建檔與更新在 historyStore.ts。任何失敗都以 rejected promise 回給呼叫端（由 historyStore 接住、只 console.warn），本檔不吞錯也不印訊息。
import type { CommentMode, JudgeMode, ResultEntry } from '@fishing-work/shared/draw-contest'

/** 只留最近幾場（客戶端常數；需求 4） */
export const HISTORY_MAX = 5

export const HISTORY_DB_NAME = 'fishing-work:draw-contest'
export const HISTORY_DB_VERSION = 1
export const HISTORY_STORE = 'history'

/** 一筆＝一回合（決策 3） */
export interface HistoryRecord {
  /** 主鍵：該回合 drawing 開始的 epoch ms（RoundPublic.startedAt；server 重啟後 roundNo 會重複，這個不會） */
  id: number
  /** 首次建檔的時間（epoch ms）；之後更新不變。清單排序、修剪與顯示的「月/日 時:分」都用它 */
  savedAt: number
  roundNo: number
  topic: string
  judgeMode: JudgeMode | null
  commentMode: CommentMode | null
  /** 建檔當下自己的 playerId（檢視時用來標「你」） */
  me: string | null
  /** 揭曉結果（含 comment）；commentPending 一律存 false（沒等到的評語 comment 留 null） */
  results: ResultEntry[]
  /** playerId → 交卷的 PNG（image/png）；沒收到的不在裡面 */
  images: Record<string, Blob>
}

/**
 * 存取介面（IndexedDB 版與記憶體版共用）。四個方法都可能 reject（IndexedDB 不可用、被封鎖、配額滿），呼叫端要接住。
 * update 是「讀出 → 套用 → 寫回」的單一交易：同一筆的多次更新（陸續到的圖與評語、別的分頁）不會互相蓋掉
 */
export interface HistoryDb {
  /** 全部紀錄，依 savedAt 降冪（最新在前） */
  getAll(): Promise<HistoryRecord[]>
  /** 整筆寫入（同 id 覆蓋） */
  put(record: HistoryRecord): Promise<void>
  /**
   * 以 change 改寫 id 那一筆：傳入目前的內容（沒有為 undefined），回傳要寫入的整筆，或 null＝不寫。
   * change 必須是同步的純函式（IndexedDB 的交易不能等非同步工作）。回傳是否有寫入
   */
  update(id: number, change: (existing: HistoryRecord | undefined) => HistoryRecord | null): Promise<boolean>
  delete(id: number): Promise<void>
}

/** 依 savedAt 降冪（同時間以 id 降冪，順序固定）；不改原陣列 */
export function sortBySavedAtDesc(records: readonly HistoryRecord[]): HistoryRecord[] {
  return [...records].sort((a, b) => b.savedAt - a.savedAt || b.id - a.id)
}

/** 讀出來的東西至少要有的形狀（別的版本或被改壞的資料直接略過，不讓畫面壞掉） */
export function isHistoryRecord(value: unknown): value is HistoryRecord {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'number' &&
    typeof v.savedAt === 'number' &&
    typeof v.topic === 'string' &&
    Array.isArray(v.results) &&
    typeof v.images === 'object' &&
    v.images !== null
  )
}

/**
 * 修剪（決策 5）：超過 max 筆就刪 savedAt 最舊的，直到剩 max 筆；回傳被刪掉的 id。
 * 只用介面的 getAll／delete，兩種實作共用
 */
export async function trimHistory(db: HistoryDb, max: number = HISTORY_MAX): Promise<number[]> {
  const stale = (await db.getAll()).slice(Math.max(0, max)).map((r) => r.id)
  for (const id of stale) await db.delete(id)
  return stale
}

/** 記憶體假實作（測試注入；與 IndexedDB 版同一份介面與排序） */
export function createMemoryHistoryDb(initial: readonly HistoryRecord[] = []): HistoryDb {
  const rows = new Map<number, HistoryRecord>(initial.map((r) => [r.id, r]))
  return {
    getAll: () => Promise.resolve(sortBySavedAtDesc([...rows.values()])),
    put: (record) => {
      rows.set(record.id, record)
      return Promise.resolve()
    },
    update: (id, change) =>
      new Promise((resolve) => {
        const next = change(rows.get(id))
        if (next !== null) rows.set(next.id, next)
        resolve(next !== null)
      }),
    delete: (id) => {
      rows.delete(id)
      return Promise.resolve()
    },
  }
}

/** 取得瀏覽器的 IndexedDB；取用本身可能丟例外（封鎖網站資料的瀏覽器），非瀏覽器環境為 undefined */
function browserIndexedDb(): IDBFactory | undefined {
  return (globalThis as { indexedDB?: IDBFactory }).indexedDB
}

/**
 * 原生 IndexedDB 的 wrapper。連線在第一次操作時才開（模組載入不碰 IndexedDB），開好後重複使用；
 * 開啟失敗不快取（下次操作重試），連線被關閉或別的分頁要升版時放掉、下次重開。
 * getFactory 可注入（測試以假的 IDBFactory 代入）；回 undefined 或丟例外都視為不可用 → 每個操作 reject
 */
export function createIndexedDbHistory(getFactory: () => IDBFactory | undefined = browserIndexedDb): HistoryDb {
  let opening: Promise<IDBDatabase> | null = null
  /** 目前快取的連線（交易開不起來時用來判斷要不要放掉快取） */
  let opened: IDBDatabase | null = null

  function open(): Promise<IDBDatabase> {
    if (opening !== null) return opening
    const attempt = new Promise<IDBDatabase>((resolve, reject) => {
      const factory = getFactory()
      if (factory === undefined || factory === null) {
        reject(new Error('IndexedDB 不可用'))
        return
      }
      const request = factory.open(HISTORY_DB_NAME, HISTORY_DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(HISTORY_STORE)) db.createObjectStore(HISTORY_STORE, { keyPath: 'id' })
      }
      request.onsuccess = () => {
        const db = request.result
        const forget = () => {
          if (opening === attempt) opening = null
          if (opened === db) opened = null
        }
        // 別的分頁要升版或刪庫時讓路；連線被瀏覽器關掉（清除網站資料）也一樣，下次操作重開
        db.onversionchange = () => {
          db.close()
          forget()
        }
        db.onclose = forget
        opened = db
        resolve(db)
      }
      request.onerror = () => reject(request.error ?? new Error('IndexedDB 開啟失敗'))
    })
    opening = attempt
    attempt.catch(() => {
      if (opening === attempt) opening = null
    })
    return attempt
  }

  /**
   * 開一個交易執行 work，交易完成才 resolve（寫入真的落地）；work 以 done 交出結果。
   * 請求失敗、交易中止（配額滿）、work 丟例外（fail：中止交易並以該例外 reject）都 reject
   */
  function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore, done: (value: T) => void, fail: (error: unknown) => void) => void): Promise<T> {
    return open().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          let tx: IDBTransaction
          try {
            tx = db.transaction(HISTORY_STORE, mode)
          } catch (error) {
            // 連線已失效（正在關閉）：放掉快取，下次操作重開
            if (opened === db) {
              opened = null
              opening = null
            }
            reject(error)
            return
          }
          let value: T | undefined
          let failure: unknown = null
          tx.oncomplete = () => resolve(value as T)
          // 請求失敗（例如配額滿）會先冒到這裡、交易接著中止；原因記下來給 onabort 用
          tx.onerror = (event) => {
            failure ??= (event.target as IDBRequest | null)?.error ?? null
          }
          tx.onabort = () => reject(failure ?? tx.error ?? new Error('IndexedDB 交易中止'))
          const fail = (error: unknown) => {
            failure = error
            try {
              tx.abort()
            } catch {
              // 交易已結束：以 failure reject
              reject(error)
            }
          }
          try {
            work(tx.objectStore(HISTORY_STORE), (v) => void (value = v), fail)
          } catch (error) {
            fail(error)
          }
        }),
    )
  }

  return {
    getAll: () =>
      run<HistoryRecord[]>('readonly', (store, done) => {
        const request = store.getAll()
        request.onsuccess = () => done(sortBySavedAtDesc((request.result as unknown[]).filter(isHistoryRecord)))
      }),

    put: (record) =>
      run<void>('readwrite', (store, done) => {
        store.put(record)
        done()
      }),

    update: (id, change) =>
      run<boolean>('readwrite', (store, done, fail) => {
        const request = store.get(id)
        // 在請求的回呼裡丟例外會變成未處理的錯誤，所以自己接住再中止交易
        request.onsuccess = () => {
          try {
            const existing: unknown = request.result
            const next = change(isHistoryRecord(existing) ? existing : undefined)
            if (next !== null) store.put(next)
            done(next !== null)
          } catch (error) {
            fail(error)
          }
        }
      }),

    delete: (id) =>
      run<void>('readwrite', (store, done) => {
        store.delete(id)
        done()
      }),
  }
}
