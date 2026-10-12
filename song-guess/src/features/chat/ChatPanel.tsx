// 聊天室（純文字，兼猜歌輸入；spec/song-guess/architecture.md §5「猜題」、§5.2）：訊息列表 + 輸入列。
// 放在殼層的 chat 插槽；本元件只負責聊天的行為（捲動跟隨、錯誤提示、送出），
// 每則訊息與輸入列長什麼樣由目前殼層的 ChatView 決定（shells/views：Line、Composer）。不傳圖（沒有拖放與貼上）。
// 猜對與否、防洩題都由 server 判定：猜對時廣播「X 猜對了」（不含原文），被擋下的訊息只回錯誤給本人。
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { sendChat } from '../../socket/client'
import { selectHasGuessed, useGameStore } from '../../store/game'
import { useChatView, type ChatComposerProps, type ChatView } from '../../shells/views'
import {
  CHAT_ERROR_MS,
  CHAT_INPUT_MAX_UNITS,
  chatErrorText,
  chatHint,
  chatLineData,
  groupsWithPrevious,
  isNearBottom,
  shouldSend,
} from './chatFormat'

type ChatError = { text: string; seq: number } | null

/** 輸入列上方的錯誤提示：停留 CHAT_ERROR_MS 後清除（DESIGN §7：不做淡出動畫） */
function useTransientError(): [ChatError, (text: string) => void, () => void] {
  const [error, setError] = useState<ChatError>(null)
  const seqRef = useRef(0)

  useEffect(() => {
    if (error === null) return
    const timer = setTimeout(() => setError((cur) => (cur?.seq === error.seq ? null : cur)), CHAT_ERROR_MS)
    return () => clearTimeout(timer)
  }, [error])

  const show = useCallback((text: string) => {
    seqRef.current += 1
    setError({ text, seq: seqRef.current })
  }, [])
  const clear = useCallback(() => setError(null), [])
  return [error, show, clear]
}

export function ChatPanel() {
  const chat = useGameStore((s) => s.chat)
  const meId = useGameStore((s) => s.me)
  const view = useChatView()
  const listRef = useRef<HTMLUListElement>(null)
  /** 是否跟隨最新訊息：使用者往上捲就停止，捲回底部附近（或自己送出訊息）再恢復 */
  const stickRef = useRef(true)
  const [error, showError, clearError] = useTransientError()

  // 新訊息進來且正在跟隨 → 捲到底（layout effect：在畫面繪製前完成，避免閃一下）
  useLayoutEffect(() => {
    const el = listRef.current
    if (el !== null && stickRef.current) el.scrollTop = el.scrollHeight
  }, [chat])

  function handleScroll() {
    const el = listRef.current
    if (el !== null) stickRef.current = isNearBottom(el.scrollTop, el.scrollHeight, el.clientHeight)
  }

  const followLatest = useCallback(() => {
    stickRef.current = true
    const el = listRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [])

  return (
    <div className={`flex h-full min-h-0 flex-col ${view.panelClassName}`}>
      <ul
        ref={listRef}
        onScroll={handleScroll}
        role="log"
        aria-label="聊天訊息"
        aria-live="polite"
        className={`min-h-0 flex-1 overflow-y-auto ${view.listClassName}`}
      >
        {chat.map((m, i) => (
          <view.Line key={m.id} line={chatLineData(m, meId)} groupWithPrevious={groupsWithPrevious(chat[i - 1], m)} />
        ))}
      </ul>
      <ChatInput Composer={view.Composer} onSend={followLatest} error={error} showError={showError} clearError={clearError} />
    </div>
  )
}

/**
 * 輸入列的行為：Enter 送出（form 的隱式送出：注音等輸入法選字的 Enter 不會觸發）；外觀由殼層的 Composer 決定。
 * 送出中不鎖輸入框；失敗時錯誤顯示在輸入列上方（幾秒後或下次輸入時清除），失敗的訊息不進列表，
 * 輸入框若還空著就把原文放回去方便修改。不做本地回顯：訊息以 server 廣播的 chat:message 為準。
 */
function ChatInput({
  Composer,
  onSend,
  error,
  showError,
  clearError,
}: {
  Composer: ChatView['Composer']
  onSend: () => void
  error: ChatError
  showError: (text: string) => void
  clearError: () => void
}) {
  const [text, setText] = useState('')
  const phase = useGameStore((s) => s.round.phase)
  const hasGuessed = useGameStore(selectHasGuessed)

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const value = text
    if (!shouldSend(value)) return
    setText('')
    clearError()
    onSend()
    void sendChat(value).then((r) => {
      if (r.ok) return
      showError(chatErrorText(r.error, r.message))
      setText((cur) => (cur === '' ? value : cur))
    })
  }

  const input: ChatComposerProps['input'] = {
    value: text,
    onChange: (e) => {
      setText(e.target.value)
      if (error !== null) clearError()
    },
    maxLength: CHAT_INPUT_MAX_UNITS,
    placeholder: chatHint(phase, hasGuessed),
    'aria-label': '聊天輸入',
    'aria-invalid': error !== null,
    autoComplete: 'off',
    enterKeyHint: 'send',
  }

  return <Composer onSubmit={handleSubmit} input={input} error={error?.text ?? null} canSend={shouldSend(text)} />
}
