// 揭曉畫廊的純邏輯（spec/draw-contest/design.md §3；可單元測試）：排序、名次記號、前三名、卡片文字與狀態。
// 與偽裝有關的名詞（交卷的叫法，ppt「儲存」→「未儲存」）由殼層的 ShellViews.terms 傳入，本檔不寫死。
import type { ResultEntry } from '@fishing-work/shared/draw-contest'

/** 前幾名高亮（外框 2px --accent） */
export const PODIUM_SIZE = 3

/** 名次 1–3 用圈號（design §3「①②③」），其餘用數字 */
const CIRCLED = ['①', '②', '③'] as const

/** 名次記號：1→①、2→②、3→③、其餘為數字字串（0 以下或非整數原樣轉字串） */
export function rankMark(rank: number): string {
  return Number.isInteger(rank) && rank >= 1 && rank <= CIRCLED.length ? CIRCLED[rank - 1] : String(rank)
}

/** 依 rank 升冪排序（不改原陣列；results 本來就依 rank 排，保險起見再排一次，同 rank 保持原順序） */
export function sortByRank(results: readonly ResultEntry[]): ResultEntry[] {
  return [...results].sort((a, b) => a.rank - b.rank)
}

/** 前三名高亮：名次 ≤ 3 且有交卷（未交卷 0 分者即使排到第 3 也不高亮） */
export function isPodium(entry: Pick<ResultEntry, 'rank' | 'submitted'>): boolean {
  return entry.submitted && entry.rank >= 1 && entry.rank <= PODIUM_SIZE
}

/** 一張卡片的圖片狀態：有圖（object URL）／交卷了但圖還沒到（載入中）／未交卷（空白） */
export type RevealImage = { kind: 'image'; url: string } | { kind: 'loading' } | { kind: 'blank' }

export function revealImage(entry: Pick<ResultEntry, 'playerId' | 'submitted'>, gallery: ReadonlyMap<string, string>): RevealImage {
  if (!entry.submitted) return { kind: 'blank' }
  const url = gallery.get(entry.playerId)
  return url === undefined ? { kind: 'loading' } : { kind: 'image', url }
}

/** 一張卡片的顯示資料 */
export interface RevealCard {
  playerId: string
  /** 名次記號（①②③ 或數字） */
  mark: string
  nickname: string
  /** 分數文字「87 分」；未交卷為「未儲存」（殼層的叫法） */
  scoreText: string
  /** 隨機評分（分數後加小字「隨機」） */
  random: boolean
  podium: boolean
  isMe: boolean
  image: RevealImage
  /** 完整說明（無障礙名稱與工具提示）：「第 1 名 Alice，87 分，隨機評分，你」 */
  label: string
}

/** 揭曉畫廊的卡片清單（依 rank） */
export function revealCards(
  results: readonly ResultEntry[],
  gallery: ReadonlyMap<string, string>,
  me: string | null,
  terms: { save: string },
): RevealCard[] {
  return sortByRank(results).map((r) => {
    const random = r.submitted && r.judgedBy === 'random'
    const isMe = me !== null && r.playerId === me
    const scoreText = r.submitted ? `${r.score} 分` : `未${terms.save}`
    const tags = [scoreText]
    if (random) tags.push('隨機評分')
    if (isMe) tags.push('你')
    return {
      playerId: r.playerId,
      mark: rankMark(r.rank),
      nickname: r.nickname,
      scoreText,
      random,
      podium: isPodium(r),
      isMe,
      image: revealImage(r, gallery),
      label: `第 ${r.rank} 名 ${r.nickname}，${tags.join('，')}`,
    }
  })
}
