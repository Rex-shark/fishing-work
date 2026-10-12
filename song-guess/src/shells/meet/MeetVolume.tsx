// meet 主題的音量控制（ShellViews.Volume；spec/song-guess/design.md §1「音量」）：控制列麥克風左側的 24px 喇叭圖示，
// 滑鼠移上去（或鍵盤聚焦、點一下圖示）時在圖示上方浮出 80px 的音量滑桿。值與存檔由功能元件給（features/player）。
//   浮在上方而不是往旁邊展開：控制列中央的按鈕是置中排列，往旁邊長會讓整排按鈕位移。
//   鍵盤：Tab 到圖示按鈕 → Enter／Space 釘住滑桿並把焦點移過去；滑桿本身也在 Tab 順序裡，←／→／↑／↓、Home／End 調整（原生 range）；Esc 收起。
//   觸控：沒有 hover，點圖示釘住／收起。
// 靜音（值 0）改用喇叭＋叉的圖示；圖示不是唯一訊息載體（按鈕的無障礙名稱帶數值）。圖示不掛工具提示：浮出的滑桿就在同一個位置。
import { useId, useRef, useState } from 'react'
import type { VolumeViewProps } from '../views'
import { VolumeIcon, VolumeMuteIcon } from './meetIcons'
import { volumeTip } from './meetLayout'

export function MeetVolume({ value, min, max, onChange, label }: VolumeViewProps) {
  /** 點圖示釘住（觸控與鍵盤）；滑鼠 hover、焦點在裡面時不論是否釘住都顯示（CSS group-hover／group-focus-within） */
  const [pinned, setPinned] = useState(false)
  const sliderRef = useRef<HTMLInputElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const sliderId = useId()
  const text = volumeTip(label, value)
  const Icon = value <= min ? VolumeMuteIcon : VolumeIcon

  return (
    <div
      data-volume=""
      className="group relative flex h-[40px] w-[32px] shrink-0 items-center justify-center"
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !pinned) return
        e.preventDefault()
        setPinned(false)
        buttonRef.current?.focus()
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={text}
        aria-expanded={pinned}
        aria-controls={sliderId}
        onClick={() => {
          const next = !pinned
          setPinned(next)
          if (next) sliderRef.current?.focus()
        }}
        className="flex h-[32px] w-[32px] cursor-pointer items-center justify-center rounded-full text-fg transition-colors duration-100 hover:bg-hover focus-visible:outline-2 focus-visible:outline-border-focus"
      >
        <Icon size={24} />
      </button>
      {/* 浮出的滑桿：外層多 8px 下內距，滑鼠從圖示移到滑桿途中不會離開 group（不閃一下消失） */}
      <div
        className={`absolute bottom-full left-1/2 z-20 -translate-x-1/2 pb-[8px] group-focus-within:block group-hover:block ${pinned ? 'block' : 'hidden'}`}
      >
        <div className="flex h-[32px] items-center rounded-full bg-quickinput px-[12px] shadow-quickinput">
          <input
            ref={sliderRef}
            id={sliderId}
            type="range"
            min={min}
            max={max}
            step={1}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            aria-label={label}
            aria-valuetext={String(value)}
            className="h-[16px] w-[80px] cursor-pointer accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          />
        </div>
      </div>
    </div>
  )
}
