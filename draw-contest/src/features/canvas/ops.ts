// 本機畫布的筆跡模型（spec/draw-contest/architecture.md §7；plan/draw-contest-mvp.md 決策 3）。
// 繪圖比賽不中繼筆跡：筆跡只存在自己的瀏覽器記憶體（store.myCanvas），交卷時以 exportPng() 重繪成 PNG 送出。
// 形狀沿用我畫你猜的 DrawOp（同一套渲染純函式），但只在本機使用，不屬於 Socket 契約，因此定義在客戶端、不放 shared。

/** 0..1 正規化座標（相對於畫布寬高） */
export interface Point {
  x: number
  y: number
}

export type Tool = 'pen' | 'eraser'

/** 本機畫布操作；color 為大寫 #RRGGBB，size 為整數 BRUSH_MIN..BRUSH_MAX */
export type DrawOp =
  | { type: 'begin'; strokeId: string; tool: Tool; color: string; size: number; point: Point }
  | { type: 'move'; strokeId: string; points: Point[] }
  | { type: 'end'; strokeId: string }
  | { type: 'undo'; strokeId: string }
  /** 只清筆跡，不重設背景 */
  | { type: 'clear' }
  /** 換畫布底色（只影響自己的畫布與交卷的 PNG） */
  | { type: 'background'; color: string }

/** strokeId 最長字元數（本機用，沿用我畫你猜的上限） */
export const STROKE_ID_MAX = 64
