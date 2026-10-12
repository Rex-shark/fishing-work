// 出題（spec/song-guess/overview.md 規則 3、design.md §1「出題」）：出題者輸入歌手名，server 搜尋後開始第 1 首。
// 對話框外觀、標題與按鈕文字由殼層提供（ShellViews.Dialog，purpose 'artist'）。Enter 送出、Esc＝取消出題。
// 只在 phase = choosing 且自己是出題者時渲染；搜尋結果以 server 為準（ack.message 直接顯示）；
//   歌手名的格式以 shared 的 validateArtist 預檢（與 server 相同），不合法時不送出、直接顯示同一句訊息。
// 搜尋中（busy）交給殼層的 Dialog 呈現：輸入框不可編輯（readOnly＋aria-busy，不是原生 disabled）但焦點留在原處，
//   找不到歌手或搜尋失敗後可以直接改字再按 Enter／Esc（plan/notes.md 2026-10-12）。
// 搜尋要等 iTunes（最久約 8 秒）：搜尋中仍可取消（server 會丟棄搜尋結果，architecture §5 choosing）。
import { useState } from 'react'
import { ARTIST_INVALID_MESSAGE, ARTIST_MAX, countChars, validateArtist } from '@fishing-work/shared/song-guess'
import { useShellViews } from '../../shells/views'
import { cancelRound, setArtist } from '../../socket/client'
import { selectIsSetter, useGameStore } from '../../store/game'
import { formatClock, useRoundRemainingSeconds } from './countdown'
import { ARTIST_CANCEL_LABEL, ARTIST_FIELD_LABEL, ARTIST_PLACEHOLDER, ARTIST_SEARCHING_LABEL, ARTIST_SUBMIT_LABEL } from './roundDisplay'

export function ArtistDialog() {
  const visible = useGameStore((s) => s.round.phase === 'choosing' && selectIsSetter(s))
  if (!visible) return null
  return <ArtistForm />
}

function ArtistForm() {
  const { Dialog } = useShellViews()
  const round = useGameStore((s) => s.round)
  const remaining = useRoundRemainingSeconds(round)
  const [artist, setArtistText] = useState('')
  const [searching, setSearching] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const length = countChars(artist.trim())

  async function handleSubmit() {
    if (searching || cancelling) return
    // 預檢（與 server 同一個函式、同一句文案）：空白、太長、含控制字元不必送出去等搜尋
    if (!validateArtist(artist).ok) {
      setError(ARTIST_INVALID_MESSAGE)
      return
    }
    setSearching(true)
    setError(null)
    const r = await setArtist(artist)
    // 成功：server 先回 ack、緊接著廣播第 1 首的 round:update，本元件隨之卸載；這中間維持「搜尋中」，不閃回可送出的樣子也不會重複送出
    if (r.ok) return
    setSearching(false)
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

  return (
    <Dialog
      purpose="artist"
      label="出題"
      busy={searching || cancelling}
      input={{
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
      }}
      items={[
        {
          id: 'submit',
          label: searching ? ARTIST_SEARCHING_LABEL : ARTIST_SUBMIT_LABEL,
          detail: (
            <span className={length > ARTIST_MAX ? 'text-sem-error' : undefined}>
              {length}/{ARTIST_MAX}
              {remaining !== null && ` · ${formatClock(remaining)}`}
            </span>
          ),
          onSelect: () => void handleSubmit(),
          disabled: searching || cancelling,
          pending: searching,
        },
        { id: 'cancel', label: ARTIST_CANCEL_LABEL, detail: 'Esc', onSelect: () => void handleCancel(), disabled: cancelling },
      ]}
      onEscape={() => void handleCancel()}
      error={error}
    />
  )
}
