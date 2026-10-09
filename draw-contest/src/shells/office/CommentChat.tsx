// Office 殼層的聊天 renderer（ShellViews.chat；DESIGN.md §13.2「右註解窗格」）：Office 的註解卡片（複製自我畫你猜，只留 chat 與 system 兩種，沒有圖片）。
// 輸入框 placeholder 由殼層給（ppt「新增註解…」）。
//   chat：卡片（24px 圓形頭像＝暱稱首字、底色依暱稱雜湊取 6 色之一；暱稱粗體；時間 --fg-dim；內文）；自己的卡片底 --bg-active（同縮圖窗格）
//   system：灰字單行、無卡片
//   輸入列：功能提示小字（--fg-muted 12px）＋輸入框（placeholder 由殼層給）＋送出鈕（內容可送出時才是作用色；錯誤以 role="alert" 顯示在上方）
// 行為（捲動、錯誤計時、送出）都在 features/chat/ChatPanel；這裡只決定一則訊息與輸入列長什麼樣。
import { useId } from 'react'
import type { ChatComposerProps, ChatLineData, ChatLineProps } from '../views'
import { ErrorIcon } from '../../layout/icons'
import { tip } from '../../layout/tooltipPlacement'
import { avatarBgClass, avatarInitial } from '../avatar'
import { SendIcon } from './officeIcons'
import { COMMENT_SEND_LABEL } from './officeLayout'

const CARD = 'rounded-[2px] border border-border px-2 py-[6px]'

export function OfficeCommentLine({ line }: ChatLineProps) {
  switch (line.kind) {
    case 'system':
      return <SystemLine line={line} />
    case 'chat':
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

/** chat：頭像、暱稱、時間一列，內文在下 */
function CommentCard({ line }: { line: ChatLineData }) {
  return (
    <li data-kind={line.kind} className={`${CARD} ${line.isMine ? 'bg-active' : 'bg-card'}`}>
      <div className="flex items-center gap-2">
        <Avatar nickname={line.nickname} />
        <span className="min-w-0 flex-1 truncate font-bold text-sem-variable">{line.nickname ?? ''}</span>
        <Time line={line} />
      </div>
      <p className="mt-1 break-words whitespace-pre-wrap text-fg-editor">{line.text}</p>
    </li>
  )
}

/** system：灰字單行、無卡片 */
function SystemLine({ line }: { line: ChatLineData }) {
  return (
    <li data-kind="system" className="px-1 text-[12px] leading-[16px] break-words text-sem-comment">
      {line.text}
    </li>
  )
}

/**
 * 輸入列：功能提示小字＋輸入框＋送出鈕。placeholder 固定為殼層給的偽裝文字（ppt「新增註解…」），
 * 功能元件給的提示（input.placeholder，「聊天」）改顯示在輸入框上方一行（design §2 右註解窗格）。
 * 送出鈕不用原生 disabled（收不到指標事件、提示出不來），內容不可送出時只設 aria-disabled 並灰化；
 * 此時按下送出由 ChatPanel 忽略（空白不送）。
 */
export function OfficeCommentComposer({ onSubmit, input, error, canSend, placeholder }: ChatComposerProps & { placeholder: string }) {
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
          placeholder={placeholder}
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
