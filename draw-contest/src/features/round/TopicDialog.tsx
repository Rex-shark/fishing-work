// 出題（spec/draw-contest/design.md §2 choosing：ppt「輸入標題」對話框）：對話框外觀與位置由殼層提供（ShellViews.Dialog）。
// Enter 送出（round:setTopic → 所有人進入作畫）、Esc＝放棄出題（round:cancel → idle）。
// 只在 phase = choosing 且自己是出題者時渲染；合法性以 server 為準，前端只顯示字數。
// 送出中（busy）交給殼層的 Dialog 呈現：輸入框不可編輯但焦點留在原處，送出失敗後可以直接再按 Enter／Esc（plan/notes.md 2026-10-12）。
import { useState } from 'react'
import { TOPIC_MAX, countChars } from '@fishing-work/shared/draw-contest'
import { useShellViews } from '../../shells/views'
import { cancelRound, setTopic } from '../../socket/client'
import { selectIsSetter, useGameStore } from '../../store/game'
import { formatClock, usePhaseRemainingSeconds } from './countdown'

export function TopicDialog() {
  const visible = useGameStore((s) => s.round.phase === 'choosing' && selectIsSetter(s))
  if (!visible) return null
  return <TopicForm />
}

/** 出題表單（不看顯示條件的部分；測試以假 Dialog 擷取 props） */
export function TopicForm() {
  const { Dialog } = useShellViews()
  const endsAt = useGameStore((s) => s.round.endsAt)
  const remaining = usePhaseRemainingSeconds('choosing', endsAt)
  const [topic, setTopicText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const length = countChars(topic.trim())

  async function handleSubmit() {
    if (busy) return
    setBusy(true)
    setError(null)
    const r = await setTopic(topic)
    // 成功時 round:update 會把 phase 轉成 drawing，本元件隨之卸載
    setBusy(false)
    if (!r.ok) setError(r.message)
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
          disabled: busy,
        },
        { id: 'cancel', label: '放棄出題', detail: 'Esc', onSelect: () => void handleCancel(), disabled: busy },
      ]}
      onEscape={() => void handleCancel()}
      error={error}
    />
  )
}
