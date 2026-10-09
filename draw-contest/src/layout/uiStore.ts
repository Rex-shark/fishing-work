// 介面狀態（與遊戲狀態分開，不經 server）：
// - shellId：偽裝主題（每位玩家自己的本機偏好，存 localStorage 鍵 fishing-work:draw-contest:shell，不進 server；與我畫你猜分開）。
//   <html data-theme>、document.title、favicon 由 App 依畫面與 shellId 同步（shells/document.ts；首頁為 home）。首頁卡片只寫入 shellId、首頁外觀不隨之改變。
//   只在「使用者真的換成另一個已註冊主題」時寫入：啟動讀到未註冊值回退預設（ppt）顯示但不覆寫存檔；
//   不監聽 storage 事件——每個分頁以自己的 state 為準，別的分頁切換互不影響（DESIGN §13.4「分頁之間不同步」）。
// - nicknameDraft：首頁輸入到一半的暱稱（Epic 4 起登入在首頁 home/HomeScreen；加入成功即清除，之後改用上次的暱稱）。
//   Epic 3 時是為了換主題重新掛載殼層而設；首頁選卡片不會重新掛載，沿用同一份狀態。
// - helpTopic：遊戲說明對話框（Epic 6 決策 3）：null＝關閉、'list'＝主題清單（第一步）、主題 id＝該主題內文（第二步）。
//   殼層的說明入口經 App 注入的 ShellProps.help.open 開啟（殼層不 import 本檔）；對話框為 dialogs 插槽裡的 features/help/HelpDialog。
import { create } from 'zustand'
import type { HelpTopicId } from '../features/help/helpTopics'
import { DEFAULT_SHELL_ID, isRegisteredShellId, resolveShellId, type ShellId } from '../shells'

/** localStorage 鍵（決策 3） */
export const SHELL_STORAGE_KEY = 'fishing-work:draw-contest:shell'

export type ShellStorage = Pick<Storage, 'getItem' | 'setItem'>

/** 瀏覽器的 localStorage；取用本身可能丟例外（隱私模式、封鎖網站資料），非瀏覽器環境回 null */
function browserStorage(): ShellStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** 讀取偏好的主題；沒有、未知值（含尚未註冊的主題）或讀取失敗時回預設 ppt */
export function loadShellId(storage: ShellStorage | null = browserStorage()): ShellId {
  if (storage === null) return DEFAULT_SHELL_ID
  try {
    return resolveShellId(storage.getItem(SHELL_STORAGE_KEY))
  } catch {
    return DEFAULT_SHELL_ID
  }
}

/** 寫入偏好的主題；寫入失敗（容量、封鎖）時忽略，本次仍以記憶體中的值運作 */
export function saveShellId(id: ShellId, storage: ShellStorage | null = browserStorage()): void {
  if (storage === null) return
  try {
    storage.setItem(SHELL_STORAGE_KEY, id)
  } catch {
    // 忽略：偏好只是方便，不影響遊戲
  }
}

interface UiState {
  /** 目前的偽裝主題 */
  shellId: ShellId
  /** 切換主題並存回 localStorage；未註冊的 id 或與目前相同時不動作（不改狀態、不寫入） */
  setShellId(id: string): void
  /** 首頁的暱稱草稿；null＝尚未輸入（用上次的暱稱） */
  nicknameDraft: string | null
  setNicknameDraft(value: string | null): void
  /** 遊戲說明：null＝關閉、'list'＝主題清單、主題 id＝該主題內文 */
  helpTopic: 'list' | HelpTopicId | null
  setHelpTopic(topic: 'list' | HelpTopicId | null): void
}

export const useUiStore = create<UiState>()((set, get) => ({
  shellId: loadShellId(),
  setShellId: (id) => {
    if (!isRegisteredShellId(id) || id === get().shellId) return
    saveShellId(id)
    set({ shellId: id })
  },
  nicknameDraft: null,
  setNicknameDraft: (nicknameDraft) => set({ nicknameDraft }),
  helpTopic: null,
  setHelpTopic: (helpTopic) => set({ helpTopic }),
}))
