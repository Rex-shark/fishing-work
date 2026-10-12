// meet 主題的聊天 renderer（ShellViews.chat；DESIGN.md §15.2「右側面板」、§15.3 聊天訊息格式；spec/song-guess/design.md §1「猜題」）：視訊會議的「通話中的訊息」。
//   chat：一行「暱稱（13px／500）  HH:mm（12px 次要色）」＋內文 14px 換行；自己送出的訊息名字顯示「你」
//   system：12px 次要色置中小字（加入、離開、出題、每首揭曉「第 n 首：《歌名》」、本局結束）
//   correct：--sem-type 綠字＋打勾（「X 猜對了」；顏色不是唯一載體 §9）
//   輸入列：功能提示小字（輸入列上方：「輸入歌名或聊天」）＋膠囊「傳送訊息給所有人」＋送出圖示（可送出時 --accent-panel，否則次要色）；錯誤 role="alert"
// 白色面板只用面板 token（--bg-panel、--fg-on-panel、--fg-on-panel-muted、--accent-panel）與 --bg-input、--sem-type、--sem-error，
// 不用深色區的 --fg／--fg-muted（白底上不可讀）。行為（捲動、錯誤計時、送出）都在 features/chat/ChatPanel。
import { useId } from 'react'
import { ErrorIcon } from '../../layout/icons'
import { tip } from '../../layout/tooltipPlacement'
import type { ChatComposerProps, ChatLineData, ChatLineProps } from '../views'
import { CheckCircleIcon, SendIcon } from './meetIcons'
import { MEET_CHAT_PLACEHOLDER, MEET_SEND_LABEL, chatSenderName } from './meetLayout'

export function MeetChatLine({ line, groupWithPrevious = false }: ChatLineProps) {
  switch (line.kind) {
    case 'system':
      return <SystemLine line={line} />
    case 'correct':
      return <CorrectLine line={line} />
    case 'chat':
      return <MessageLine line={line} grouped={groupWithPrevious} />
  }
}

function Time({ line }: { line: ChatLineData }) {
  return (
    <time dateTime={new Date(line.at).toISOString()} className="shrink-0 text-[12px] leading-[16px] text-fg-on-panel-muted tabular-nums">
      {line.time}
    </time>
  )
}

/**
 * chat：暱稱＋時間一行，內文在下。與前一則同人（grouped）時不再顯示「暱稱 HH:mm」行，
 * 內文緊接上一則（DESIGN §15.3「連續同人訊息只顯示一次名字」）；時間改放在 <time> 的 sr-only 文字，報讀器仍唸得到
 */
function MessageLine({ line, grouped }: { line: ChatLineData; grouped: boolean }) {
  return (
    <li data-kind={line.kind} data-grouped={grouped ? '' : undefined} className={`px-[16px] ${grouped ? '-mt-[4px] pb-[4px]' : 'py-[4px]'}`}>
      {grouped ? (
        <span className="sr-only">
          {chatSenderName(line.nickname, line.isMine)} {line.time}
        </span>
      ) : (
        <div className="flex items-baseline gap-[8px]">
          <span className="min-w-0 truncate text-[13px] leading-[18px] font-medium text-fg-on-panel">{chatSenderName(line.nickname, line.isMine)}</span>
          <Time line={line} />
        </div>
      )}
      <p className="mt-[2px] text-[14px] leading-[20px] break-words whitespace-pre-wrap text-fg-on-panel">{line.text}</p>
    </li>
  )
}

/** system：置中小字 */
function SystemLine({ line }: { line: ChatLineData }) {
  return (
    <li data-kind="system" className="px-[16px] py-[4px] text-center text-[12px] leading-[16px] break-words text-fg-on-panel-muted">
      {line.text}
    </li>
  )
}

/** correct：綠字＋打勾（文字由 server 給，例如「ben 猜對了」） */
function CorrectLine({ line }: { line: ChatLineData }) {
  return (
    <li data-kind="correct" className="flex items-center gap-[8px] px-[16px] py-[4px] text-[13px] leading-[18px] font-medium text-sem-type">
      <CheckCircleIcon size={16} />
      <span className="min-w-0 flex-1 break-words">{line.text}</span>
      <Time line={line} />
    </li>
  )
}

/**
 * 輸入列：功能提示小字＋膠囊輸入框＋送出圖示。placeholder 固定「傳送訊息給所有人」以維持偽裝，
 * 功能元件給的提示（input.placeholder，例如「輸入歌名或聊天」）改顯示在輸入列上方一行。
 * 送出鈕不用原生 disabled（收不到指標事件、提示出不來），內容不可送出時只設 aria-disabled 並改次要色；此時按下送出由 ChatPanel 忽略。
 */
export function MeetComposer({ onSubmit, input, error, canSend }: ChatComposerProps) {
  const hintId = useId()
  return (
    <form onSubmit={onSubmit} className="shrink-0 px-[12px] pt-[8px] pb-[12px]">
      {error !== null && (
        <p role="alert" className="mb-[4px] flex items-start gap-[4px] px-[4px] text-[12px] leading-[16px] break-words text-sem-error">
          <ErrorIcon size={14} className="mt-[1px]" />
          <span className="min-w-0">{error}</span>
        </p>
      )}
      <p id={hintId} className="mb-[4px] truncate px-[4px] text-[12px] leading-[16px] text-fg-on-panel-muted">
        {input.placeholder}
      </p>
      <div className="flex h-[40px] items-center rounded-[24px] bg-input pr-[4px] pl-[16px] outline-accent-panel focus-within:outline-2">
        <input
          {...input}
          aria-describedby={hintId}
          placeholder={MEET_CHAT_PLACEHOLDER}
          className="h-full min-w-0 flex-1 border-none bg-transparent text-[14px] text-fg-on-panel outline-none placeholder:text-fg-on-panel-muted"
        />
        <button
          type="submit"
          aria-label={MEET_SEND_LABEL}
          aria-disabled={!canSend}
          {...tip(MEET_SEND_LABEL, 'top')}
          className={`flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-full transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-accent-panel ${
            canSend ? 'cursor-pointer text-accent-panel hover:bg-panel' : 'cursor-default text-fg-on-panel-muted'
          }`}
        >
          <SendIcon size={18} />
        </button>
      </div>
    </form>
  )
}
