// 回合資訊（狀態列式的一行項目，擺放位置由殼層決定）：
// VolunteerStatus =「我出題」（idle／ended 且在線人數足夠時；文字與圖示由殼層決定，ShellViews.volunteer）；
// RoundStatus = 回合狀態列：各階段的文字由 roundDisplay.roundNotes 產生（spec/draw-contest/design.md §2 對照表逐列），
// 題目與交卷的叫法來自殼層（ShellViews.terms）。最後 10 秒倒數改 --sem-warning＋警示圖示（DESIGN §7，不閃爍）。
import { useEffect, useRef, useState } from 'react'
import type { RoundPublic } from '@fishing-work/shared/draw-contest'
import { ErrorIcon, WarningIcon } from '../../layout/icons'
import { StatusButton, StatusItem } from '../../layout/StatusItem'
import { useTermsView, useVolunteerView } from '../../shells/views'
import { volunteer } from '../../socket/client'
import { selectIsParticipant, selectIsSetter, useGameStore } from '../../store/game'
import { usePhaseRemainingSeconds } from './countdown'
import { canVolunteer, countConnected, roundNotes, volunteerAriaLabel, type NotesSegment } from './roundDisplay'

/** 狀態列錯誤提示停留時間（與聊天室一致） */
const STATUS_ERROR_MS = 4000

// ─── 我出題 ───────────────────────────────────────────────────────

export function VolunteerStatus() {
  const phase = useGameStore((s) => s.round.phase)
  // selector 只回傳數字（回傳新陣列會無限重繪）
  const online = useGameStore((s) => countConnected(s.players))
  if (!canVolunteer(phase, online)) return null
  return <VolunteerButton />
}

/**
 * 「我出題」：錯誤（回合已開始的競態、人數不足等）以錯誤圖示＋文字顯示在旁邊，4 秒或回合狀態改變後消失。
 * 送出中按鈕不是原生 disabled（StatusButton 的 busy：焦點留在按鈕上，失敗後可以直接再按），所以重複送出在這裡擋
 */
export function VolunteerButton() {
  const round = useGameStore((s) => s.round)
  const { label, icon: Icon } = useVolunteerView()
  const [busy, setBusy] = useState(false)
  /** 送出中（等 ack）：用 ref 擋，連按兩下時第二下還看不到 busy 這個狀態的更新 */
  const inFlight = useRef(false)
  const [error, setError] = useState<{ message: string; round: RoundPublic } | null>(null)

  useEffect(() => {
    if (error === null) return
    const timer = setTimeout(() => setError(null), STATUS_ERROR_MS)
    return () => clearTimeout(timer)
  }, [error])

  async function handleClick() {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    const r = await volunteer()
    inFlight.current = false
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

// ─── 回合狀態列：階段、倒數、題目、進度、上一回合 ─────────────────────────

export function RoundStatus() {
  const round = useGameStore((s) => s.round)
  const isSetter = useGameStore(selectIsSetter)
  const isParticipant = useGameStore(selectIsParticipant)
  const setterName = useGameStore((s) => s.players.find((p) => p.id === s.round.setterId)?.nickname ?? null)
  const terms = useTermsView()
  // choosing／drawing 才有倒數；顯示值 clamp 到階段長度
  const remaining = usePhaseRemainingSeconds(round.phase, round.endsAt)
  const segments = roundNotes({ round, isSetter, isParticipant, setterName, remaining }, terms)

  return (
    <div role="status" aria-live="polite" className="flex h-full min-w-0 items-center">
      {segments.map((seg, i) => (
        <NotesItem key={i} segment={seg} last={i === segments.length - 1} />
      ))}
    </div>
  )
}

/**
 * 回合狀態列的一段。倒數接在文字後（tabular-nums）；最後 10 秒倒數改 --sem-warning 並加警示圖示（design §2；DESIGN §7 不閃爍）。
 * 最後一段可截斷（…），其餘不縮；optional 段在窄螢幕隱藏
 */
function NotesItem({ segment, last }: { segment: NotesSegment; last: boolean }) {
  const { text, clock, optional } = segment
  const truncate = last && clock === undefined
  return (
    <StatusItem hideOnMobile={optional} truncate={truncate} className={truncate ? undefined : 'shrink-0'}>
      {clock === undefined ? (
        text
      ) : (
        <>
          <span>{text}</span>
          <span
            className={`flex items-center gap-1 tabular-nums ${clock.warning ? 'text-sem-warning' : ''}`}
            aria-label={clock.warning ? `剩 ${clock.seconds} 秒` : undefined}
          >
            {clock.warning && <WarningIcon size={14} />}
            {clock.text}
          </span>
        </>
      )}
    </StatusItem>
  )
}
