// 音量（spec/song-guess/design.md §3）：滑桿 0～100、預設 15（Rex 2026-10-12：辦公室用預設要小），本機偏好存 localStorage `fishing-work:song-guess:volume`（不進 server）。
// 純函式＋一個小 store（Zustand）；<audio>.volume＝值 ÷ 100。
import { create } from 'zustand'

/** localStorage 鍵（與 shell、session 同一命名空間，不與另兩款撞鍵） */
export const VOLUME_STORAGE_KEY = 'fishing-work:song-guess:volume'
export const VOLUME_MIN = 0
export const VOLUME_MAX = 100
export const VOLUME_DEFAULT = 15

export type VolumeStorage = Pick<Storage, 'getItem' | 'setItem'>

/** 任意值 → 0..100 的整數；不是有限數字回預設 */
export function clampVolume(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN
  if (!Number.isFinite(n)) return VOLUME_DEFAULT
  return Math.min(VOLUME_MAX, Math.max(VOLUME_MIN, Math.round(n)))
}

/** 0..100 → <audio>.volume 的 0..1 */
export function toAudioVolume(value: number): number {
  return clampVolume(value) / VOLUME_MAX
}

/** 瀏覽器的 localStorage；取用本身可能丟例外（隱私模式、封鎖網站資料），非瀏覽器環境回 null */
function browserStorage(): VolumeStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** 讀取偏好的音量；沒有、不是數字或讀取失敗時回預設 15 */
export function loadVolume(storage: VolumeStorage | null = browserStorage()): number {
  if (storage === null) return VOLUME_DEFAULT
  try {
    const raw = storage.getItem(VOLUME_STORAGE_KEY)
    return raw === null ? VOLUME_DEFAULT : clampVolume(raw)
  } catch {
    return VOLUME_DEFAULT
  }
}

/** 寫入偏好的音量；寫入失敗（容量、封鎖）時忽略，本次仍以記憶體中的值運作 */
export function saveVolume(value: number, storage: VolumeStorage | null = browserStorage()): void {
  if (storage === null) return
  try {
    storage.setItem(VOLUME_STORAGE_KEY, String(clampVolume(value)))
  } catch {
    // 忽略：偏好只是方便，不影響遊戲
  }
}

interface VolumeState {
  /** 目前音量 0..100 */
  volume: number
  /** 設定音量並存回 localStorage（值會夾到 0..100 的整數；與目前相同時不寫入） */
  setVolume(value: number): void
}

export const useVolumeStore = create<VolumeState>()((set, get) => ({
  volume: loadVolume(),
  setVolume: (value) => {
    const volume = clampVolume(value)
    if (volume === get().volume) return
    saveVolume(volume)
    set({ volume })
  },
}))
