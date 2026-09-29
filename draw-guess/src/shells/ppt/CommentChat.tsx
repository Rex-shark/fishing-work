// ppt 主題的聊天 renderer（ShellViews.chat；DESIGN.md §13.2「右註解窗格」）：PowerPoint 的註解卡片。
//   chat／image：卡片（24px 圓形頭像＝暱稱首字、底色依暱稱雜湊取 6 色之一；暱稱粗體；時間 --fg-dim；內文）；自己的卡片底 --bg-active（同縮圖窗格）
//   image：卡片內縮圖（最寬 200px）；沒有圖時為灰字佔位（載入中…／連線較慢，已略過／已清除／中途加入看不到）
//   system：灰字單行、無卡片（沒有 `// ` 前綴）；揭曉訊息的題目以 --sem-string 粗體強調
//   correct：卡片左側綠勾（顏色不是唯一載體 §9）
//   輸入列：功能提示小字（--fg-muted 12px）＋「新增註解…」輸入框＋送出鈕（內容可送出時才是作用色；錯誤以 role="alert" 顯示在上方）
// 行為（捲動、錯誤計時、送出、貼上、拖放）都在 features/chat/ChatPanel；這裡只決定一則訊息與輸入列長什麼樣。
import { useId } from 'react'
import type { ChatComposerProps, ChatLineData, ChatLineProps } from '../views'
import { IMAGE_LABEL } from '../../features/chat/chatFormat'
import { ImageMessage } from '../../features/chat/ImageMessage'
import { ErrorIcon } from '../../layout/icons'
import { tip } from '../../layout/tooltipPlacement'
import { avatarBgClass, avatarInitial } from '../avatar'
import { COMMENT_PLACEHOLDER, COMMENT_SEND_LABEL } from './commentFormat'
import { CheckIcon, SendIcon } from './pptIcons'

/** 卡片內縮圖上限（DESIGN §13.2「圖片卡片內縮圖 200px」；高度沿用 §5 的 160） */
const COMMENT_THUMB_MAX_WIDTH = 200
const COMMENT_THUMB_MAX_HEIGHT = 160

const CARD = 'rounded-[2px] border border-border px-2 py-[6px]'

export function CommentLine({ line }: ChatLineProps) {
  switch (line.kind) {
    case 'system':
      return <SystemLine line={line} />
    case 'correct':
      return <CorrectCard line={line} />
    case 'chat':
    case 'image':
      return <CommentCard line={line} />
  }
}

/** 圓形頭像：暱稱首字（白字 --fg-on-avatar，六種底色對比皆 ≥ 5.9:1） */
function Avatar({ nickname }: { nickname: string | null }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] leading-none font-bold text-fg-on-avatar ${
        avatarBgClass(nickname)
      }`}
    >
      {avatarInitial(nickname)}
    </span>
  )
}

function Time({ line }: { line: ChatLineData }) {
  return (
    <time dateTime={new Date(line.at).toISOString()} className="shrink-0 text-[11px] leading-[16px] text-fg-dim tabular-nums">
      {line.time}
    </time>
  )
}

/** chat／image：頭像、暱稱、時間一列，內文（或縮圖、佔位）在下 */
function CommentCard({ line }: { line: ChatLineData }) {
  return (
    <li data-kind={line.kind} className={`${CARD} ${line.isMine ? 'bg-active' : 'bg-card'}`}>
      <div className="flex items-center gap-2">
        <Avatar nickname={line.nickname} />
        <span className="min-w-0 flex-1 truncate font-bold text-sem-variable">{line.nickname ?? ''}</span>
        <Time line={line} />
      </div>
      {line.kind === 'image' ? <ImageBody line={line} /> : <p className="mt-1 break-words whitespace-pre-wrap text-fg-editor">{line.text}</p>}
    </li>
  )
}

/** 卡片內縮圖；窗格變窄（220／180px）時以 max-width 收進卡片，高度改 auto 依 width／height 屬性的比例縮（不留白邊） */
function ImageBody({ line }: { line: ChatLineData }) {
  const image = line.image
  if (image === null || image.url === null) {
    return <p className="mt-1 break-words text-fg-muted">{image?.placeholder ?? IMAGE_LABEL}</p>
  }
  return (
    <div className="[&_button]:max-w-full [&_img]:h-auto! [&_img]:max-w-full">
      <ImageMessage
        url={image.url}
        meta={image.meta}
        nickname={line.nickname}
        maxWidth={COMMENT_THUMB_MAX_WIDTH}
        maxHeight={COMMENT_THUMB_MAX_HEIGHT}
      />
    </div>
  )
}

/** system：灰字單行、無卡片；揭曉訊息的題目強調 */
function SystemLine({ line }: { line: ChatLineData }) {
  return (
    <li data-kind="system" className="px-1 text-[12px] leading-[16px] break-words text-sem-comment">
      {line.reveal !== null ? (
        <>
          題目是 <span className="font-bold text-sem-string">{line.reveal.topic}</span>（{line.reveal.reason}）
        </>
      ) : (
        line.text
      )}
    </li>
  )
}

/** correct：綠勾卡片（文字由 server 給，例如「ben 猜對了」） */
function CorrectCard({ line }: { line: ChatLineData }) {
  return (
    <li data-kind="correct" className={`${CARD} flex items-start gap-2 bg-card`}>
      <CheckIcon size={16} className="mt-[1px] text-sem-type" />
      <span className="min-w-0 flex-1 font-bold break-words text-sem-type">{line.text}</span>
      <Time line={line} />
    </li>
  )
}

/**
 * 輸入列：功能提示小字＋「新增註解…」輸入框＋送出鈕。placeholder 固定「新增註解…」以維持偽裝，
 * 功能元件依角色給的提示（input.placeholder，例如「輸入答案或聊天」）改顯示在輸入框上方一行（DESIGN §13.3）。
 * 送出鈕不用原生 disabled（收不到指標事件、提示出不來），內容不可送出時只設 aria-disabled 並灰化；
 * 此時按下送出由 ChatPanel 忽略（空白不送）。
 */
export function CommentComposer({ onSubmit, input, error, canSend }: ChatComposerProps) {
  const hintId = useId()
  return (
    <form onSubmit={onSubmit} className="shrink-0 border-t border-border p-2">
      {error !== null && (
        <p role="alert" className="mb-1 flex items-start gap-1 text-[12px] leading-[16px] break-words text-sem-error">
          <ErrorIcon size={14} className="mt-[1px]" />
          <span className="min-w-0">{error}</span>
        </p>
      )}
      <p id={hintId} className="mb-1 truncate text-[12px] leading-[16px] text-fg-muted">
        {input.placeholder}
      </p>
      <div className="flex h-[28px] items-center rounded-[2px] border border-border bg-input transition-colors duration-100 focus-within:border-border-focus">
        <input
          {...input}
          aria-describedby={hintId}
          placeholder={COMMENT_PLACEHOLDER}
          className="h-full min-w-0 flex-1 border-none bg-transparent px-2 text-fg-editor outline-none placeholder:text-fg-muted"
        />
        <button
          type="submit"
          aria-label={COMMENT_SEND_LABEL}
          aria-disabled={!canSend}
          {...tip(COMMENT_SEND_LABEL, 'top')}
          className={`mr-[2px] flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[2px] transition-colors duration-100 focus-visible:outline-1 focus-visible:outline-border-focus ${
            canSend ? 'cursor-pointer text-accent hover:bg-hover' : 'cursor-default text-fg-muted opacity-60'
          }`}
        >
          <SendIcon />
        </button>
      </div>
    </form>
  )
}
