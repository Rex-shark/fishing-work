// 聊天圖片縮圖（plan/chat-image.md 決策 8；DESIGN.md §5 聊天室訊息格式 image 列）：
// `bob: [圖片]` 那一行的下方，最大 240×160、object-fit: contain、1px --border、圓角 2px；
// 點一下切換成面板寬度，再點縮回（不做燈箱；按鈕名稱取自 img alt，狀態用 aria-pressed）。沒有圖時不渲染本元件，由同行的灰字佔位代替（載入中…／連線較慢，已略過／已清除／中途加入看不到，見 imageUrls）。
// 由殼層的聊天 renderer（ChatView.Line）放進訊息裡；maxWidth／maxHeight 讓各主題調整縮圖框（預設 240×160）。
import { useState } from 'react'
import type { ImageMeta } from '@fishing-work/shared'
import { THUMB_MAX_HEIGHT, THUMB_MAX_WIDTH, thumbSize } from './chatFormat'

export function ImageMessage({
  url,
  meta,
  nickname,
  maxWidth = THUMB_MAX_WIDTH,
  maxHeight = THUMB_MAX_HEIGHT,
}: {
  url: string
  meta: ImageMeta
  nickname: string | null
  maxWidth?: number
  maxHeight?: number
}) {
  const [expanded, setExpanded] = useState(false)
  const thumb = thumbSize(meta.width, meta.height, maxWidth, maxHeight)
  // 先依 meta 定好框：圖片解碼前後高度一致，聊天列表捲到底才準
  const style = expanded
    ? { width: '100%', height: 'auto', aspectRatio: `${meta.width} / ${meta.height}` }
    : { width: thumb.width, height: thumb.height }

  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      aria-pressed={expanded}
      className={`mt-1 mb-1 block cursor-pointer rounded-[2px] outline-border-focus focus-visible:outline-1 ${expanded ? 'w-full' : ''}`}
    >
      <img
        src={url}
        alt={nickname !== null ? `${nickname} 傳送的圖片` : '聊天圖片'}
        width={meta.width}
        height={meta.height}
        draggable={false}
        style={style}
        className="block rounded-[2px] border border-border object-contain"
      />
    </button>
  )
}
