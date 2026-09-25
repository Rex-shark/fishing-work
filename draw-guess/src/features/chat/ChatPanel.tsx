// 聊天室（兼猜題輸入）：訊息列表 + 輸入列（DESIGN.md 各主題的聊天室章節；architecture §5「聊天訊息判定」）。
// 放在殼層的 chat 插槽；本元件只負責聊天的行為（捲動跟隨、錯誤提示、送出、貼上與拖放圖片），
// 每則訊息與輸入列長什麼樣由目前殼層的 ChatView 決定（shells/views：Line、Composer；未提供時為預設外觀）。
// Epic 2：殼層提供的聊天容器（最近的 [data-chat-drop-zone] 祖先；沒有時為本元件自己）為圖片投放區，輸入框也可貼上圖片。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { sendChat, sendImage } from '../../socket/client'
import { selectHasGuessed, selectIsDrawer, useGameStore } from '../../store/game'
import { useChatView, type ChatComposerProps, type ChatView } from '../../shells/views'
import {
  CHAT_ERROR_MS,
  CHAT_INPUT_MAX_UNITS,
  chatErrorText,
  chatLineData,
  chatPlaceholder,
  isNearBottom,
  shouldSend,
} from './chatFormat'
import { CHAT_DROP_ZONE_ATTR, dragHasFiles, imageBlockedReason, nextDragDepth } from './dropZone'
import { ImagePrepareError, imageErrorText, prepareImage } from './imageUpload'
import { displayStatus } from './imageUrls'

const IMAGE_BUSY = '上一張圖片還在傳送中'

type ChatError = { text: string; seq: number } | null

/** 輸入列上方的錯誤提示：停留 CHAT_ERROR_MS 後清除（DESIGN §7：不做淡出動畫）；文字與圖片共用 */
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
  const imageUrls = useGameStore((s) => s.imageUrls)
  const imageStatus = useGameStore((s) => s.imageStatus)
  const meId = useGameStore((s) => s.me)
  const view = useChatView()
  /** 本元件的根節點（callback ref 存成 state，才能在 render 時找出投放區並把覆蓋層 portal 進去） */
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  /** 投放區：殼層標記的聊天容器；殼層沒有標記時退回本元件自己（此時根節點加 relative 讓覆蓋層定位） */
  const zone = useMemo(() => (root === null ? null : (root.closest<HTMLElement>(`[${CHAT_DROP_ZONE_ATTR}]`) ?? root)), [root])
  const listRef = useRef<HTMLUListElement>(null)
  /** 是否跟隨最新訊息：使用者往上捲就停止，捲回底部附近（或自己送出訊息）再恢復 */
  const stickRef = useRef(true)
  /** 同時只傳一張：縮圖與上傳期間再丟圖直接提示 */
  const imageBusyRef = useRef(false)
  const [error, showError, clearError] = useTransientError()

  // 新訊息（或圖片 bytes）進來且正在跟隨 → 捲到底（layout effect：在畫面繪製前完成，避免閃一下）
  useLayoutEffect(() => {
    const el = listRef.current
    if (el !== null && stickRef.current) el.scrollTop = el.scrollHeight
  }, [chat, imageUrls, imageStatus])

  function handleScroll() {
    const el = listRef.current
    if (el !== null) stickRef.current = isNearBottom(el.scrollTop, el.scrollHeight, el.clientHeight)
  }

  const followLatest = useCallback(() => {
    stickRef.current = true
    const el = listRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [])

  /** 拖放或貼上的圖片：本機預檢 → 縮圖 → chat:image；錯誤一律顯示在輸入列上方 */
  const sendImageFile = useCallback(
    async (file: File) => {
      if (imageBusyRef.current) return showError(IMAGE_BUSY)
      const s = useGameStore.getState()
      const blocked = imageBlockedReason(s.round.phase, selectIsDrawer(s))
      if (blocked !== null) return showError(blocked)
      imageBusyRef.current = true
      clearError()
      try {
        const prepared = await prepareImage(file)
        followLatest()
        const r = await sendImage(prepared)
        if (!r.ok) showError(chatErrorText(r.error, r.message))
      } catch (e) {
        showError(e instanceof ImagePrepareError ? e.message : imageErrorText('DECODE_FAILED'))
      } finally {
        imageBusyRef.current = false
      }
    },
    [showError, clearError, followLatest],
  )

  const dragging = useImageDrop(zone, sendImageFile)
  const ownZone = zone !== null && zone === root

  return (
    <div ref={setRoot} className={`flex h-full min-h-0 flex-col ${view.panelClassName}${ownZone ? ' relative' : ''}`}>
      <ul
        ref={listRef}
        onScroll={handleScroll}
        role="log"
        aria-label="聊天訊息"
        aria-live="polite"
        className={`min-h-0 flex-1 overflow-y-auto ${view.listClassName}`}
      >
        {chat.map((m) => (
          <view.Line
            key={m.id}
            line={chatLineData(
              m,
              m.kind === 'image'
                ? { imageStatus: displayStatus(imageStatus.get(m.id), imageUrls.has(m.id)), imageUrl: imageUrls.get(m.id) ?? null, meId }
                : { meId },
            )}
          />
        ))}
      </ul>
      <ChatInput
        Composer={view.Composer}
        onSend={followLatest}
        onImage={(file) => void sendImageFile(file)}
        error={error}
        showError={showError}
        clearError={clearError}
      />
      {dragging &&
        zone !== null &&
        // 覆蓋層 portal 進投放區、蓋滿整個容器（容器須為定位元素）；不吃指標事件，拖放由投放區處理
        createPortal(
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-border-focus bg-selection/35 text-fg"
          >
            放開以傳送圖片
          </div>,
          zone,
        )}
    </div>
  )
}

/**
 * 把投放區（殼層的聊天容器，含其標題列等裝飾）變成圖片投放區，原生事件掛在該元素上：
 * - 只處理含檔案的拖曳；dragenter／dragleave 以深度計數，子元素間移動不閃爍
 * - drop 只取第一個檔案；一律 preventDefault，避免瀏覽器直接開啟檔案而離開遊戲
 * - 視窗其他地方放開檔案也擋下（dropEffect none），同樣避免整頁被換掉
 */
function useImageDrop(zone: HTMLElement | null, onFile: (file: File) => void): boolean {
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (zone === null) return
    let depth = 0
    const update = (next: number) => {
      depth = next
      setDragging(depth > 0)
    }

    const onEnter = (e: DragEvent) => {
      if (!dragHasFiles(e.dataTransfer?.types)) return
      e.preventDefault()
      update(nextDragDepth(depth, 'enter'))
    }
    const onOver = (e: DragEvent) => {
      if (!dragHasFiles(e.dataTransfer?.types)) return
      e.preventDefault()
      if (e.dataTransfer !== null) e.dataTransfer.dropEffect = 'copy'
    }
    const onLeave = (e: DragEvent) => {
      if (!dragHasFiles(e.dataTransfer?.types)) return
      update(nextDragDepth(depth, 'leave'))
    }
    const onDrop = (e: DragEvent) => {
      if (!dragHasFiles(e.dataTransfer?.types)) return
      e.preventDefault()
      update(nextDragDepth(depth, 'drop'))
      const file = e.dataTransfer?.files[0]
      if (file !== undefined) onFile(file)
    }
    // 投放區以外：不讓瀏覽器開啟檔案；拖曳結束（含按 Esc 取消）時覆蓋層一定收起
    const onWindowOver = (e: DragEvent) => {
      if (e.defaultPrevented || !dragHasFiles(e.dataTransfer?.types)) return
      e.preventDefault()
      if (e.dataTransfer !== null) e.dataTransfer.dropEffect = 'none'
    }
    const onWindowDrop = (e: DragEvent) => {
      if (!e.defaultPrevented && dragHasFiles(e.dataTransfer?.types)) e.preventDefault()
      update(nextDragDepth(depth, 'drop'))
    }
    const onWindowEnd = () => update(nextDragDepth(depth, 'end'))

    zone.addEventListener('dragenter', onEnter)
    zone.addEventListener('dragover', onOver)
    zone.addEventListener('dragleave', onLeave)
    zone.addEventListener('drop', onDrop)
    window.addEventListener('dragover', onWindowOver)
    window.addEventListener('drop', onWindowDrop)
    window.addEventListener('dragend', onWindowEnd)
    return () => {
      zone.removeEventListener('dragenter', onEnter)
      zone.removeEventListener('dragover', onOver)
      zone.removeEventListener('dragleave', onLeave)
      zone.removeEventListener('drop', onDrop)
      window.removeEventListener('dragover', onWindowOver)
      window.removeEventListener('drop', onWindowDrop)
      window.removeEventListener('dragend', onWindowEnd)
    }
  }, [zone, onFile])

  return dragging
}

/**
 * 輸入列的行為：Enter 送出（form 的隱式送出：注音等輸入法選字的 Enter 不會觸發）；外觀由殼層的 Composer 決定。
 * 送出中不鎖輸入框；失敗時錯誤顯示在輸入列上方（幾秒後或下次輸入時清除），被擋的訊息不進列表，
 * 輸入框若還空著就把原文放回去方便修改。貼上含圖片檔時改走傳圖流程。
 */
function ChatInput({
  Composer,
  onSend,
  onImage,
  error,
  showError,
  clearError,
}: {
  Composer: ChatView['Composer']
  onSend: () => void
  onImage: (file: File) => void
  error: ChatError
  showError: (text: string) => void
  clearError: () => void
}) {
  const phase = useGameStore((s) => s.round.phase)
  const isDrawer = useGameStore(selectIsDrawer)
  const hasGuessed = useGameStore(selectHasGuessed)
  const [text, setText] = useState('')

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
    onPaste: (e) => {
      const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith('image/'))
      if (file === undefined) return
      e.preventDefault()
      onImage(file)
    },
    maxLength: CHAT_INPUT_MAX_UNITS,
    placeholder: chatPlaceholder(phase, isDrawer, hasGuessed),
    'aria-label': '聊天輸入',
    'aria-invalid': error !== null,
    autoComplete: 'off',
    enterKeyHint: 'send',
  }

  return <Composer onSubmit={handleSubmit} input={input} error={error?.text ?? null} canSend={shouldSend(text)} />
}
