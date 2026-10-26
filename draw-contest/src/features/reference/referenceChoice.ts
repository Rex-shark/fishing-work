// 出題對話框裡「選好的參考圖」的狀態（Epic 20；plan/contest-mimic.md 決策 2、8）：小型 external store，TopicForm 以 useSyncExternalStore 訂閱。
// 抽出來是為了不靠 DOM 就能測（本專案的 Vitest 沒有 DOM 環境）：選檔 → 正規化成 JPEG → 預覽的 object URL；
// 換一張、移除、對話框卸載都 revoke 舊的 URL；不是圖片或轉檔失敗只顯示錯誤，之前選好的那張保留（那個檔不採用、不送出）。
// 轉檔中又移除或卸載：轉完的結果丟掉（不建 URL）。
import { NORMALIZE_MESSAGES, normalizeReference, type NormalizeResult } from './normalize'

/** 選好的參考圖：要送出的 JPEG bytes 與預覽用的 object URL */
export interface ChosenReference {
  jpeg: ArrayBuffer
  url: string
}

export interface ReferenceChoiceState {
  reference: ChosenReference | null
  /** 轉檔中（不可送出） */
  preparing: boolean
  /** 參考圖的錯誤（不是圖片、轉檔失敗、server 回 REFERENCE_INVALID）；null＝沒有 */
  error: string | null
}

export interface ReferenceChoiceDeps {
  normalize(file: Blob): Promise<NormalizeResult>
  createUrl(blob: Blob): string
  revokeUrl(url: string): void
}

export interface ReferenceChoice {
  getState(): ReferenceChoiceState
  subscribe(listener: () => void): () => void
  /** 選了一個檔（選檔或拖曳）：轉檔中再選會被忽略 */
  choose(file: Blob): Promise<void>
  /** 移除選好的參考圖（並清掉錯誤） */
  remove(): void
  /** 設定或清除參考圖的錯誤（送出時清除、server 回 REFERENCE_INVALID 時設定） */
  setError(message: string | null): void
  /** 對話框卸載：revoke 預覽 URL、丟掉選好的與轉檔中的結果（之後仍可使用；React StrictMode 會先卸載再掛載一次） */
  release(): void
}

const browserChoiceDeps: ReferenceChoiceDeps = {
  normalize: (file) => normalizeReference(file),
  createUrl: (blob) => URL.createObjectURL(blob),
  revokeUrl: (url) => URL.revokeObjectURL(url),
}

export const INITIAL_REFERENCE_CHOICE: ReferenceChoiceState = { reference: null, preparing: false, error: null }

export function createReferenceChoice(deps: ReferenceChoiceDeps = browserChoiceDeps): ReferenceChoice {
  let state: ReferenceChoiceState = INITIAL_REFERENCE_CHOICE
  const listeners = new Set<() => void>()
  /** 每次選檔、移除、卸載都遞增：轉完時序號不同就丟掉結果 */
  let seq = 0

  function set(patch: Partial<ReferenceChoiceState>): void {
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }

  function revokeCurrent(): void {
    if (state.reference !== null) deps.revokeUrl(state.reference.url)
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    async choose(file) {
      if (state.preparing) return
      const mine = ++seq
      set({ preparing: true, error: null })
      let result: NormalizeResult
      try {
        result = await deps.normalize(file)
      } catch {
        result = { ok: false, error: 'ENCODE_FAILED', message: NORMALIZE_MESSAGES.ENCODE_FAILED }
      }
      if (mine !== seq) return
      if (!result.ok) {
        set({ preparing: false, error: result.message })
        return
      }
      revokeCurrent()
      const url = deps.createUrl(new Blob([result.jpeg], { type: 'image/jpeg' }))
      set({ preparing: false, error: null, reference: { jpeg: result.jpeg, url } })
    },

    remove() {
      seq++
      revokeCurrent()
      set({ reference: null, preparing: false, error: null })
    },

    setError(message) {
      if (state.error !== message) set({ error: message })
    },

    release() {
      seq++
      revokeCurrent()
      state = INITIAL_REFERENCE_CHOICE
      for (const listener of listeners) listener()
    },
  }
}
