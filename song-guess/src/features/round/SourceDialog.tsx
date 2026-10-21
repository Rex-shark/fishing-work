// 出題（spec/song-guess/overview.md 規則 3、design.md §1「出題（選題庫）」；plan/song-guess-sources.md 決策 9）：
//   出題者先選題庫來源（歌手／台灣熱門／西洋熱門／動漫熱門（Epic 19），每次開都從「歌手」開始、不記住），server 取歌後開始第 1 首。
//   歌手：欄位＋「只抽熱門歌」（預設勾；features/round/hotPreference 記住上次）；現成題庫（兩個榜單與動漫熱門）：沒有欄位，一行說明。
// 對話框外觀、標題與按鈕文字由殼層提供（ShellViews.Dialog，purpose 'source'）。Enter 送出、Esc＝取消出題。
// 只在 phase = choosing 且自己是出題者時渲染；取歌結果以 server 為準（ack.message 直接顯示，含 CHART_FAILED、SOURCE_INVALID）；
//   歌手名的格式以 shared 的 validateArtist 預檢（與 server 相同），不合法時不送出、直接顯示同一句訊息。
// 送出中（busy）交給殼層的 Dialog 呈現：輸入框不可編輯（readOnly＋aria-busy，不是原生 disabled）、四選一與勾選不可切換（aria-disabled），
//   焦點留在原處——失敗後歌手模式可以直接改字再按 Enter，現成題庫焦點留在送出按鈕（plan/notes.md 2026-10-12）；原本的內容都保留。
// 取歌要等 iTunes（歌手最久約 8 秒；榜單兩段各 8 秒；動漫熱門三次搜尋並行、各 8 秒）：送出中仍可取消（server 會丟棄結果，architecture §5 choosing）。
import { useState } from 'react'
import { ARTIST_INVALID_MESSAGE, ARTIST_MAX, countChars, validateArtist, type SongSource } from '@fishing-work/shared/song-guess'
import { useShellViews } from '../../shells/views'
import { cancelRound, setSource } from '../../socket/client'
import { selectIsSetter, useGameStore } from '../../store/game'
import { formatClock, useRoundRemainingSeconds } from './countdown'
import { loadHot, saveHot } from './hotPreference'
import {
  ARTIST_CANCEL_LABEL,
  ARTIST_FIELD_LABEL,
  ARTIST_PLACEHOLDER,
  DEFAULT_SOURCE,
  HOT_TOGGLE_LABEL,
  PRESET_NOTES,
  SOURCE_GROUP_LABEL,
  SOURCE_OPTIONS,
  isPresetSource,
  sourcePayload,
  submitLabel,
} from './roundDisplay'

export function SourceDialog() {
  const visible = useGameStore((s) => s.round.phase === 'choosing' && selectIsSetter(s))
  if (!visible) return null
  return <SourceForm />
}

function SourceForm() {
  const { Dialog } = useShellViews()
  const round = useGameStore((s) => s.round)
  const remaining = useRoundRemainingSeconds(round)
  const [source, setSourceChoice] = useState<SongSource>(DEFAULT_SOURCE)
  // 使用者切換過來源：之後切回「歌手」時欄位不搶焦點（焦點留在四選一，方向鍵才能繼續切）
  const [switched, setSwitched] = useState(false)
  const [artist, setArtistText] = useState('')
  const [hot, setHot] = useState(() => loadHot())
  const [submitting, setSubmitting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const length = countChars(artist.trim())
  const preset = isPresetSource(source)
  const clock = remaining !== null ? formatClock(remaining) : null

  async function handleSubmit() {
    if (submitting || cancelling) return
    // 預檢（與 server 同一個函式、同一句文案）：空白、太長、含控制字元不必送出去等搜尋
    if (source === 'artist' && !validateArtist(artist).ok) {
      setError(ARTIST_INVALID_MESSAGE)
      return
    }
    setSubmitting(true)
    setError(null)
    const r = await setSource(sourcePayload(source, artist, hot))
    // 成功：server 先回 ack、緊接著廣播第 1 首的 round:update，本元件隨之卸載；這中間維持「送出中」，不閃回可送出的樣子也不會重複送出
    if (r.ok) return
    setSubmitting(false)
    setError(r.message)
  }

  async function handleCancel() {
    if (cancelling) return
    setCancelling(true)
    setError(null)
    const r = await cancelRound()
    setCancelling(false)
    if (!r.ok) setError(r.message)
  }

  function handleSourceChange(id: string) {
    const next = SOURCE_OPTIONS.find((o) => o.id === id)?.id
    if (next === undefined || next === source || submitting) return
    setSourceChoice(next)
    setSwitched(true)
    if (error !== null) setError(null)
  }

  function handleHotChange(checked: boolean) {
    if (submitting) return
    setHot(checked)
    saveHot(checked)
  }

  return (
    <Dialog
      purpose="source"
      label="出題"
      busy={submitting || cancelling}
      choices={{ label: SOURCE_GROUP_LABEL, options: SOURCE_OPTIONS, value: source, onChange: handleSourceChange, locked: submitting }}
      input={
        preset
          ? undefined
          : {
              value: artist,
              onChange: (v) => {
                setArtistText(v)
                if (error !== null) setError(null)
              },
              placeholder: ARTIST_PLACEHOLDER,
              ariaLabel: ARTIST_FIELD_LABEL,
              // maxLength 以 UTF-16 計（emoji 算 2），放寬 4 倍，長度以 server 為準
              maxLength: ARTIST_MAX * 4,
              invalid: error !== null,
              enterKeyHint: 'search',
              autoFocus: !switched,
            }
      }
      toggle={preset ? undefined : { label: HOT_TOGGLE_LABEL, checked: hot, onChange: handleHotChange, locked: submitting }}
      description={preset ? PRESET_NOTES[source] : undefined}
      items={[
        {
          id: 'submit',
          label: submitLabel(source, submitting),
          detail: preset ? (
            (clock ?? undefined)
          ) : (
            <span className={length > ARTIST_MAX ? 'text-sem-error' : undefined}>
              {length}/{ARTIST_MAX}
              {clock !== null && ` · ${clock}`}
            </span>
          ),
          onSelect: () => void handleSubmit(),
          disabled: submitting || cancelling,
          pending: submitting,
        },
        { id: 'cancel', label: ARTIST_CANCEL_LABEL, detail: 'Esc', onSelect: () => void handleCancel(), disabled: cancelling },
      ]}
      onEscape={() => void handleCancel()}
      error={error}
    />
  )
}
