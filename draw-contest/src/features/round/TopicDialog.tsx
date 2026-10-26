// 出題（spec/draw-contest/design.md §2 choosing：ppt「輸入標題」對話框）：對話框外觀與位置由殼層提供（ShellViews.Dialog）。
// Enter 送出（round:setTopic → 所有人進入作畫）、Esc＝放棄出題（round:cancel → idle）。
// 只在 phase = choosing 且自己是出題者時渲染；合法性以 server 為準，前端只顯示字數。
// 送出中（busy）交給殼層的 Dialog 呈現：輸入框不可編輯但焦點留在原處，送出失敗後可以直接再按 Enter／Esc（plan/notes.md 2026-10-12）。
// 參考圖（Epic 20 像不像比賽；plan/contest-mimic.md 決策 2、8）：題目框下方的「參考圖（選填）」區（features/reference/ReferencePicker，
//   放在殼層對話框的 attachment）。選檔或拖曳 → normalizeReference 轉成 JPEG（長邊 ≤ 1280、品質 0.9）→ 縮圖預覽；
//   不是圖片或轉檔失敗 → 顯示錯誤、不採用那個檔（之前選好的參考圖保留）；轉檔中不送出。送題時帶 reference（有選才帶）；
//   server 回 REFERENCE_INVALID 時錯誤歸參考圖（題目框不標紅）。錯誤都顯示在對話框的錯誤位置（role="alert"）。
import { useEffect, useState, useSyncExternalStore } from 'react'
import { TOPIC_MAX, countChars } from '@fishing-work/shared/draw-contest'
import { createReferenceChoice, type ReferenceChoice } from '../reference/referenceChoice'
import { ReferencePicker } from '../reference/ReferencePicker'
import { useShellViews } from '../../shells/views'
import { cancelRound, setTopic } from '../../socket/client'
import { selectIsSetter, useGameStore } from '../../store/game'
import { formatClock, usePhaseRemainingSeconds } from './countdown'

export function TopicDialog() {
  const visible = useGameStore((s) => s.round.phase === 'choosing' && selectIsSetter(s))
  if (!visible) return null
  return <TopicForm />
}

/**
 * 出題表單（不看顯示條件的部分；測試以假 Dialog 擷取 props）。
 * choice：參考圖的狀態（測試注入預先選好圖的；省略時每次掛載各建一個，卸載時 release）
 */
export function TopicForm({ choice: injected }: { choice?: ReferenceChoice } = {}) {
  const { Dialog } = useShellViews()
  const endsAt = useGameStore((s) => s.round.endsAt)
  const remaining = usePhaseRemainingSeconds('choosing', endsAt)
  const [topic, setTopicText] = useState('')
  const [busy, setBusy] = useState(false)
  /** 題目（與取消）的錯誤：題目框標紅。參考圖的錯誤在 choice（題目框不標紅） */
  const [error, setError] = useState<string | null>(null)
  const [choice] = useState(() => injected ?? createReferenceChoice())
  const { reference, preparing, error: referenceError } = useSyncExternalStore(choice.subscribe, choice.getState, choice.getState)
  const length = countChars(topic.trim())

  // 卸載（送出成功轉 drawing、取消、逾時）時釋放預覽的 object URL
  useEffect(() => () => choice.release(), [choice])

  async function handleSubmit() {
    if (busy || preparing) return
    setBusy(true)
    setError(null)
    choice.setError(null)
    const r = await setTopic(topic, reference?.jpeg)
    // 成功時 round:update 會把 phase 轉成 drawing，本元件隨之卸載
    setBusy(false)
    if (r.ok) return
    if (r.error === 'REFERENCE_INVALID') choice.setError(r.message)
    else setError(r.message)
  }

  async function handleCancel() {
    if (busy) return
    setBusy(true)
    setError(null)
    const r = await cancelRound()
    setBusy(false)
    if (!r.ok) setError(r.message)
  }

  return (
    <Dialog
      purpose="topic"
      label="出題"
      busy={busy}
      input={{
        value: topic,
        onChange: (v) => {
          setTopicText(v)
          if (error !== null) setError(null)
        },
        placeholder: `輸入題目（1–${TOPIC_MAX} 字）後按 Enter`,
        ariaLabel: '題目',
        // maxLength 以 UTF-16 計（emoji 算 2），放寬 4 倍，長度以 server 為準（踩雷紀錄 Phase 3）
        maxLength: TOPIC_MAX * 4,
        invalid: error !== null,
        enterKeyHint: 'go',
      }}
      items={[
        {
          id: 'submit',
          label: busy ? '送出中…' : '出題並開始比賽',
          detail: (
            <span className={length > TOPIC_MAX ? 'text-sem-error' : undefined}>
              {length}/{TOPIC_MAX}
              {remaining !== null && ` · ${formatClock(remaining)}`}
            </span>
          ),
          onSelect: () => void handleSubmit(),
          disabled: busy || preparing,
        },
        { id: 'cancel', label: '放棄出題', detail: 'Esc', onSelect: () => void handleCancel(), disabled: busy },
      ]}
      onEscape={() => void handleCancel()}
      attachment={
        <ReferencePicker
          preview={reference?.url ?? null}
          busy={busy}
          preparing={preparing}
          onFile={(file) => {
            if (!busy) void choice.choose(file)
          }}
          onRemove={() => {
            if (!busy) choice.remove()
          }}
        />
      }
      error={error ?? referenceError}
    />
  )
}

