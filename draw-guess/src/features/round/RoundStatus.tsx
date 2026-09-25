// 回合資訊（DESIGN.md §5「狀態列」；取代 Phase 2–3 的 RoundBar），以狀態列式的一行項目呈現，擺放位置由殼層決定：
// VolunteerStatus =「▷ 我來畫」（idle 且在線人數足夠時；文字與圖示由殼層決定，ShellViews.volunteer，預設「▷ 我來畫」）；RoundStatus = 階段與倒數、畫師／題目提示、猜對進度、自己的得分。
// 文字一律白字：最後 10 秒以警示圖示提示（DESIGN §7，不閃爍、不變色）。
import { useEffect, useState } from 'react'
import { MIN_PLAYERS, type RoundPhase, type RoundPublic } from '@fishing-work/shared'
import { ErrorIcon, WarningIcon } from '../../layout/icons'
import { StatusButton, StatusItem } from '../../layout/StatusItem'
import { useVolunteerView } from '../../shells/views'
import { volunteer } from '../../socket/client'
import { selectHasGuessed, selectIsDrawer, selectMyGain, useGameStore } from '../../store/game'
import { formatClock, usePhaseRemainingSeconds } from './countdown'
import {
  END_REASON_LABEL,
  PHASE_LABEL,
  canVolunteer,
  countConnected,
  isCountdownWarning,
  topicBlanks,
  volunteerAriaLabel,
} from './roundDisplay'

/** 狀態列錯誤提示停留時間（與聊天室一致） */
const STATUS_ERROR_MS = 4000

// ─── 左：▷ 我來畫 ─────────────────────────────────────────────────

export function VolunteerStatus() {
  const phase = useGameStore((s) => s.round.phase)
  // selector 只回傳數字（踩雷紀錄 Phase 3：回傳新陣列會無限重繪）
  const online = useGameStore((s) => countConnected(s.players))
  if (!canVolunteer(phase, online)) return null
  return <VolunteerButton />
}

/** 「▷ 我來畫」：錯誤（回合已開始的競態等）以錯誤圖示＋文字顯示在旁邊（文字色沿用外層狀態列），4 秒或回合狀態改變後消失 */
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
      <StatusButton label={volunteerAriaLabel(label)} onClick={() => void handleClick()} disabled={busy}>
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

// ─── 中：階段、倒數、題目 ──────────────────────────────────────────

export function RoundStatus() {
  const round = useGameStore((s) => s.round)
  const isDrawer = useGameStore(selectIsDrawer)
  const drawerName = useGameStore((s) => s.players.find((p) => p.id === s.round.drawerId)?.nickname ?? null)
  // ended 時 endsAt 為 null（architecture §5 end），只有 choosing / drawing 有倒數；顯示值 clamp 到階段長度
  const remaining = usePhaseRemainingSeconds(round.phase, round.endsAt)
  const warning = isCountdownWarning(remaining)

  return (
    <div role="status" aria-live="polite" className="flex h-full min-w-0 items-center">
      <StatusItem className="shrink-0">
        <span>{PHASE_LABEL[round.phase]}</span>
        {remaining !== null && (
          <>
            {warning && <WarningIcon size={14} />}
            <span className="tabular-nums" aria-label={warning ? `剩 ${remaining} 秒` : undefined}>
              {formatClock(remaining)}
            </span>
          </>
        )}
      </StatusItem>
      <TopicHint round={round} isDrawer={isDrawer} drawerName={drawerName} />
      {round.phase === 'drawing' && <GuessProgress />}
      <MyResult phase={round.phase} isDrawer={isDrawer} />
    </div>
  )
}

function TopicHint({ round, isDrawer, drawerName }: { round: RoundPublic; isDrawer: boolean; drawerName: string | null }) {
  switch (round.phase) {
    case 'idle':
      return <IdleHint round={round} />
    case 'choosing':
      return <StatusItem truncate>{isDrawer ? '請輸入題目' : `${drawerName ?? '畫師'} 正在出題…`}</StatusItem>
    case 'drawing':
      if (isDrawer && round.topic !== null) {
        return <StatusItem truncate>題目：{round.topic}</StatusItem>
      }
      return (
        <>
          {drawerName !== null && (
            <StatusItem hideOnMobile truncate>
              畫師 {drawerName}
            </StatusItem>
          )}
          {round.topicLength !== null && (
            <StatusItem truncate>
              <span aria-label={`題目共 ${round.topicLength} 個字`}>
                {topicBlanks(round.topicLength)}（{round.topicLength} 字）
              </span>
            </StatusItem>
          )}
        </>
      )
    case 'ended':
      return (
        <StatusItem truncate>
          {round.topic !== null ? `題目是 ${round.topic}` : '未出題'}
          {round.endReason !== null && `（${END_REASON_LABEL[round.endReason]}）`}
        </StatusItem>
      )
  }
}

/** idle：人數不足時提示等待；否則顯示上一回合結束原因（endReason 保留到下次 volunteer） */
function IdleHint({ round }: { round: RoundPublic }) {
  const online = useGameStore((s) => countConnected(s.players))
  if (online < MIN_PLAYERS) {
    return (
      <StatusItem truncate>
        等待其他玩家加入（{online}/{MIN_PLAYERS}）
      </StatusItem>
    )
  }
  return round.endReason !== null ? (
    <StatusItem hideOnMobile truncate>
      上一回合：{END_REASON_LABEL[round.endReason]}
    </StatusItem>
  ) : null
}

/** 作畫中的猜對進度：已猜對 / 猜題者（含寬限期中的斷線者，與 server 的「全員猜對」一致） */
function GuessProgress() {
  const total = useGameStore((s) => s.players.filter((p) => p.id !== s.round.drawerId).length)
  const guessed = useGameStore((s) => s.players.filter((p) => p.id !== s.round.drawerId && p.hasGuessed).length)
  if (total === 0) return null
  return (
    <StatusItem hideOnMobile className="shrink-0 tabular-nums">
      已猜對 {guessed}/{total}
    </StatusItem>
  )
}

/**
 * 自己的回饋（DESIGN §5：本人另見「✓ 你猜對了 +N」）：作畫中猜對時顯示；揭曉時顯示本回合得分（畫師 +20×猜對人數）。
 * N 是 players:update 前後的分數差（分數以 server 為準）；基準不明（中途接管）時只顯示「✓ 你猜對了」。
 */
function MyResult({ phase, isDrawer }: { phase: RoundPhase; isDrawer: boolean }) {
  const hasGuessed = useGameStore(selectHasGuessed)
  const gain = useGameStore(selectMyGain)
  const suffix = gain !== null ? ` +${gain}` : ''
  if (phase === 'drawing' && !isDrawer && hasGuessed) {
    return <StatusItem className="shrink-0 font-bold">✓ 你猜對了{suffix}</StatusItem>
  }
  if (phase === 'ended' && gain !== null) {
    return <StatusItem className="shrink-0 font-bold">本回合 +{gain}</StatusItem>
  }
  return null
}
