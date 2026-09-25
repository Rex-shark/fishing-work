// vscode 主題的聊天 renderer（ShellViews.chat；DESIGN.md §5「聊天室訊息格式」、輸入列）：底部 TERMINAL 面板裡的終端機輸出。
// 行為（捲動、錯誤計時、送出、貼上、拖放）都在 features/chat/ChatPanel；這裡只決定一則訊息與輸入列長什麼樣。
import type { ChatComposerProps, ChatLineProps } from '../views'
import { ImageMessage } from '../../features/chat/ImageMessage'
import { ERROR_PREFIX, TERMINAL_PROMPT, terminalLineParts, terminalTimestamp, type ChatTone } from './terminalFormat'

const TONE_CLASS: Record<ChatTone, string> = {
  name: 'text-sem-variable',
  text: 'text-fg-editor',
  comment: 'text-sem-comment',
  string: 'text-sem-string',
  correct: 'text-sem-type',
  muted: 'text-fg-muted',
}

/** 一行：`[HH:mm] ` ＋ 顯示片段；圖片訊息的縮圖畫在下一行 */
export function TerminalChatLine({ line }: ChatLineProps) {
  const url = line.image?.url ?? null
  return (
    <li className="break-words whitespace-pre-wrap">
      <span className="text-fg-dim">{terminalTimestamp(line.time)}</span>
      {terminalLineParts(line).map((part, i) => (
        <span key={i} className={TONE_CLASS[part.tone]}>
          {part.text}
        </span>
      ))}
      {url !== null && line.image !== null && <ImageMessage url={url} meta={line.image.meta} nickname={line.nickname} />}
    </li>
  )
}

/** 輸入列：`❯` 提示符 + 透明底、無邊框的輸入框；錯誤以 `✗ ` 開頭顯示在上方 */
export function TerminalComposer({ onSubmit, input, error }: ChatComposerProps) {
  return (
    <form onSubmit={onSubmit} className="shrink-0 px-3 pb-1">
      {error !== null && (
        <p className="truncate text-sem-error" role="alert">
          {ERROR_PREFIX}
          {error}
        </p>
      )}
      <label className="flex h-[22px] items-center gap-2 rounded-[2px] outline-border-focus focus-within:outline-1">
        <span aria-hidden="true" className="text-sem-type">
          {TERMINAL_PROMPT}
        </span>
        <input
          {...input}
          className="h-full min-w-0 flex-1 border-none bg-transparent text-fg-editor outline-none placeholder:text-fg-muted"
        />
      </label>
    </form>
  )
}
