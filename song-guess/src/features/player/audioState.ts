// 播放器對外的狀態（給舞台與測試觀察）與「手動起播」的入口。
// <audio> 只有一個（features/player/AudioPlayer，掛在 App）；舞台在另一棵子樹，所以狀態放小 store、起播動作放模組層的註冊點。
import { create } from 'zustand'
import type { AudioState } from './playback'

interface AudioStore {
  /** idle：沒有歌；waiting：已載入、等 startedAt 或等資料；playing：播放中；blocked：需要使用者點一下（自動播放被擋或載入失敗）；over：這首已播完，等揭曉 */
  state: AudioState
  setState(state: AudioState): void
}

export const useAudioStore = create<AudioStore>()((set, get) => ({
  state: 'idle',
  setState: (state) => {
    if (state !== get().state) set({ state })
  },
}))

/** 目前掛載的播放器提供的起播函式（必須在使用者手勢的同步呼叫裡執行 play()，瀏覽器才放行） */
let starter: (() => void) | null = null

/** AudioPlayer 掛載／換歌時登記，卸載時傳 null */
export function registerStarter(fn: (() => void) | null): void {
  starter = fn
}

/** 使用者點「開始播放」：定位到目前進度並播放；沒有播放器或沒有歌時不動作 */
export function startPlayback(): void {
  starter?.()
}
