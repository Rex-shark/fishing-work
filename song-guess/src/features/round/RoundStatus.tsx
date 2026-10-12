// 回合資訊，以一行文字呈現，擺放位置由殼層決定（spec/song-guess/design.md §2）：
// VolunteerStatus＝「出題」按鈕（idle／ended 且在線人數足夠時；文字與圖示由殼層決定，ShellViews.volunteer）；
// RoundStatus＝各階段的一行字（歌名字數提示、倒數、自己猜對的得分…；文字由 roundDisplay.roundCaption 產生）。
// 倒數每秒在變，不放進 live region；狀態變化（第 n 首開始、猜對、揭曉歌名）另以 sr-only 的 role="status" 朗讀（design §4）。
import { useEffect, useState } from 'react'
import type { RoundPublic } from '@fishing-work/shared/song-guess'
import { ErrorIcon } from '../../layout/icons'
import { StatusButton } from '../../layout/StatusItem'
import { useVolunteerView } from '../../shells/views'
import { volunteer } from '../../socket/client'
import { selectHasGuessed, selectIsSetter, selectMyGain, useGameStore } from '../../store/game'
import { useRoundRemainingSeconds } from './countdown'
import { canVolunteer, countConnected, roundAnnouncement, roundCaption, setterNameOf, volunteerAriaLabel } from './roundDisplay'

/** 錯誤提示停留時間（與聊天室一致） */
const STATUS_ERROR_MS = 4000

// ─── 出題 ─────────────────────────────────────────────────

export function VolunteerStatus() {
  const phase = useGameStore((s) => s.round.phase)
  // selector 只回傳數字（回傳新陣列會無限重繪）
  const online = useGameStore((s) => countConnected(s.players))
  if (!canVolunteer(phase, online)) return null
  return <VolunteerButton />
}

/**
 * 「出題」：錯誤（別人搶先出題的競態、人數不足等）以錯誤圖示＋文字顯示在旁邊（文字色沿用外層），4 秒或回合狀態改變後消失。
 * 送出中以 StatusButton 的 busy 呈現（aria-disabled＋aria-busy，不是原生 disabled）：失敗後焦點仍在按鈕上，可以直接再按一次
 */
function VolunteerButton() {
  const round = useGameStore((s) => s.round)
  const { label, icon: Icon } = useVolunteerView()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string; round: RoundPublic } | null>(null)

  useEffect(() => {
    if (error === null) return
    const timer = setTimeout(() => setError(null), STATUS_ERROR_MS)
    return () => clearTimeout(timer)
  }, [error])

  async function handleClick() {
    if (busy) return
    setBusy(true)
    setError(null)
    const r = await volunteer()
    setBusy(false)
    if (!r.ok) setError({ message: r.message, round })
  }

  return (
    <>
      <StatusButton label={volunteerAriaLabel(label)} onClick={() => void handleClick()} busy={busy}>
        {Icon !== undefined && <Icon size={14} />}
        <span>{busy ? '請稍候…' : label}</span>
      </StatusButton>
      {error !== null && error.round === round && (
        <span role="alert" className="flex h-full max-w-[280px] min-w-0 items-center gap-1 px-[5px]">
          <ErrorIcon size={14} />
          <span className="truncate">{error.message}</span>
        </span>
      )}
    </>
  )
}

// ─── 階段、倒數、歌名字數 ──────────────────────────────────────────

export function RoundStatus() {
  const round = useGameStore((s) => s.round)
  const isSetter = useGameStore(selectIsSetter)
  const setterName = useGameStore((s) => setterNameOf(s.round, s.players))
  const hasGuessed = useGameStore(selectHasGuessed)
  const gain = useGameStore(selectMyGain)
  const remaining = useRoundRemainingSeconds(round)
  const { label: shareLabel } = useVolunteerView()
  const { head, tail } = roundCaption({ round, isSetter, setterName, hasGuessed, gain, remaining, shareLabel })
  const guessed = round.phase === 'playing' && hasGuessed

  return (
    <div data-round-phase={round.phase} className="flex h-full min-w-0 items-center">
      {/* head 太長（歌名很多字）時截斷；tail（字數與倒數）固定顯示 */}
      <span className={`min-w-0 truncate ${guessed ? 'font-medium' : ''}`}>{head}</span>
      {tail !== '' && <span className="shrink-0 whitespace-pre tabular-nums">{tail}</span>}
      <span role="status" aria-live="polite" className="sr-only">
        {roundAnnouncement({ round, isSetter, setterName, hasGuessed, gain })}
      </span>
    </div>
  )
}
