// 每首揭曉卡（spec/song-guess/design.md §1「每首揭曉」；停留 REVEAL_SECONDS，由 server 計時）：
//   左側 120px 專輯封面（300px 版、圓角 8px；< 480px 縮成 80px）、右側歌名 20px --fg、歌手 14px --fg
//   （DESIGN §15.1：tile 內承載資訊的文字一律 --fg；--fg-muted 在 tile 上只有 4.0:1。歌名與歌手靠字級區分，不靠顏色）、
//   下方猜對者列（暱稱＋分數膠囊，依猜對順序）；沒人猜對顯示「沒有人猜對」。
// 封面與歌名只在這裡出現（播放中不顯示）。封面直接用 server 給的網址交給 <img>，客戶端不呼叫題庫 API。
// 色彩一律用 token class；不含任何偽裝字樣（放在哪個殼層都一樣）。
import type { SongReveal } from '@fishing-work/shared/song-guess'
import { MusicNoteIcon } from '../../layout/icons'
import { useGameStore } from '../../store/game'
import { NO_ONE_GUESSED, artworkAlt, artworkUrlAt, revealScoreRows, type RevealScoreRow } from './revealView'

/** 接 store：有揭曉資料才渲染（reveal 階段的本首） */
export function RevealCard() {
  const reveal = useGameStore((s) => s.round.reveal)
  const players = useGameStore((s) => s.players)
  const me = useGameStore((s) => s.me)
  if (reveal === null) return null
  return <RevealCardView reveal={reveal} rows={revealScoreRows(reveal, players, me)} />
}

export function RevealCardView({ reveal, rows }: { reveal: SongReveal; rows: readonly RevealScoreRow[] }) {
  const artwork = artworkUrlAt(reveal.artworkUrl)
  return (
    <article data-stage="reveal" data-song-index={reveal.index} aria-label={`第 ${reveal.index} 首揭曉`} className="flex max-h-full w-full max-w-[560px] flex-col gap-[16px] overflow-y-auto">
      <div className="flex items-center gap-[16px]">
        {artwork !== null ? (
          <img
            src={artwork}
            alt={artworkAlt(reveal)}
            width={120}
            height={120}
            referrerPolicy="no-referrer"
            className="size-[120px] shrink-0 rounded-[8px] bg-editor object-cover max-[479px]:size-[80px]"
          />
        ) : (
          // 佔位圖示是圖形、而且在自己的 --bg-editor 方塊上（--fg-muted 6.1:1），不是直接壓在 tile 上的文字
          <span
            role="img"
            aria-label="沒有專輯封面"
            className="flex size-[120px] shrink-0 items-center justify-center rounded-[8px] bg-editor text-fg-muted max-[479px]:size-[80px]"
          >
            <MusicNoteIcon size={40} />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
          <h3 data-reveal-title="" className="text-[20px] leading-[28px] font-normal break-words text-fg">
            {reveal.title}
          </h3>
          <p data-reveal-artist="" className="text-[14px] leading-[20px] break-words text-fg">
            {reveal.artist}
          </p>
        </div>
      </div>
      {rows.length === 0 ? (
        <p data-reveal-empty="" className="text-[14px] leading-[20px] text-fg">
          {NO_ONE_GUESSED}
        </p>
      ) : (
        <ol aria-label="猜對的人與得分" className="flex flex-wrap gap-[8px]">
          {rows.map((row) => (
            <li
              key={row.playerId}
              data-player={row.playerId}
              className="flex max-w-full items-center gap-[8px] rounded-full bg-editor/70 py-[4px] pr-[4px] pl-[12px] text-[14px] leading-[20px] text-fg"
            >
              <span className={`min-w-0 truncate ${row.isMe ? 'font-medium' : ''}`}>{row.nickname}</span>
              <span className="shrink-0 rounded-full bg-button-secondary px-[8px] text-[12px] leading-[20px] tabular-nums">+{row.score}</span>
            </li>
          ))}
        </ol>
      )}
    </article>
  )
}
