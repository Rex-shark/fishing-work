// meet 主題的舞台（ShellViews.Stage；spec/song-guess/design.md §1「播放中的試聽」、§2「舞台」欄）：主畫面 tile 裡「有人正在分享音訊」的樣子。
//   empty：置中一行「尚無人分享音訊」；preparing：其他人看到「<出題者> 正在準備分享音訊…」（自己是出題者時對話框疊在上面，這裡留白）；
//   playing：音訊波形（7 根 --accent 直條，純 CSS 動畫、不讀真實音訊；還沒起播或被擋時靜止；prefers-reduced-motion 時不動）
//     ＋下方 12px --fg 兩行（文字由功能元件給，Epic 18）：「孫燕姿（熱門） · 第 2 / 5 首」／「歌手：周杰倫」（第二行可省略）；沒有專輯封面、沒有歌名。
//     瀏覽器擋自動播放（playback 'blocked'）時，波形位置改放按鈕「點一下開始播放」（文字由功能元件給）。
// 每首揭曉卡與本局排名表是功能元件（features/reveal），不在這裡。tile 內承載資訊的文字一律 --fg（DESIGN §15.1）。
import type { CSSProperties } from 'react'
import type { StageViewProps } from '../views'
import { STAGE_EMPTY_TEXT, WAVE_BARS, preparingText } from './meetLayout'

export function MeetStage(props: StageViewProps) {
  switch (props.kind) {
    case 'empty':
      return (
        <p data-stage="empty" className="text-center text-[14px] leading-[20px] text-fg">
          {STAGE_EMPTY_TEXT}
        </p>
      )
    case 'preparing':
      // 出題者自己：對話框就在這個位置，不重複顯示文字
      if (props.isSetter) return <div data-stage="preparing" />
      return (
        <p data-stage="preparing" className="max-w-full truncate text-center text-[14px] leading-[20px] text-fg">
          {preparingText(props.setterName)}
        </p>
      )
    case 'playing':
      return (
        <div data-stage="playing" data-playback={props.playback} className="flex max-w-full flex-col items-center gap-[16px]">
          {props.playback === 'blocked' ? (
            <button
              type="button"
              onClick={props.onStart}
              className="h-[40px] cursor-pointer rounded-full bg-active px-[24px] text-[14px] font-medium text-fg-on-active transition-colors duration-100 hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
            >
              {props.startLabel}
            </button>
          ) : (
            <Waveform moving={props.playback === 'playing'} />
          )}
          <div className="flex max-w-full flex-col items-center gap-[2px]">
            <p className="max-w-full truncate text-[12px] leading-[16px] text-fg">{props.heading}</p>
            {props.artistLine !== null && <p className="max-w-full truncate text-[12px] leading-[16px] text-fg">{props.artistLine}</p>}
          </div>
        </div>
      )
  }
}

/** 波形：每根直條 8px 寬、最高 72px，各自的高度比例、週期與延遲由 CSS 變數給（theme.css 的 wave-bar） */
function Waveform({ moving }: { moving: boolean }) {
  return (
    <div aria-hidden="true" data-wave={moving ? 'moving' : 'still'} className="flex h-[72px] items-center gap-[6px] text-accent">
      {WAVE_BARS.map((bar, i) => (
        <span
          key={i}
          className={`h-full w-[8px] rounded-full bg-accent wave-bar ${moving ? '' : 'wave-bar-paused'}`}
          style={
            {
              '--wave-min': bar.min,
              '--wave-rest': bar.rest,
              '--wave-duration': `${bar.duration}ms`,
              '--wave-delay': `${bar.delay}ms`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}
