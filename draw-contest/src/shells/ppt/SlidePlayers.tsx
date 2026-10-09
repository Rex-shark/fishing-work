// ppt 主題的玩家清單呈現（ShellViews.PlayerList）：偽裝成左側投影片縮圖窗格（DESIGN.md §13.2「左縮圖窗格」；spec/draw-contest/design.md §2）。
// 每人一張編號縮圖卡（16:9、白底 1px --border）：暱稱為投影片標題（粗體）、總分在右下小字；
//   出題者：卡片外框 2px --accent ＋ 編號旁畫筆圖示；已交卷：右上綠勾；旁觀（比賽進行中、非參賽者）：opacity .5＋「旁觀」；
//   斷線中：淡化（opacity .5）；自己：卡底 --bg-active ＋「（你）」。
// 顏色不是唯一訊息載體（§9）：出題者有畫筆圖示、交卷有勾、自己與旁觀有文字；完整狀態以 playerRowLabel 提供給輔助技術與工具提示。
// 列資料由功能元件 features/players/PlayerList 提供。
import { isSpectating, playerRowLabel } from '../../features/players/playerRow'
import { tip } from '../../layout/tooltipPlacement'
import type { PlayerListViewProps } from '../views'
import { CheckIcon, PenIcon } from '../office/officeIcons'

export function SlidePlayers({ rows }: PlayerListViewProps) {
  return (
    <ol aria-label="玩家清單" className="flex flex-col gap-3 py-3 pr-3 pl-1">
      {rows.map(({ player: p, isMe, contestActive }, i) => {
        const spectating = isSpectating(p, contestActive)
        const label = playerRowLabel(p.nickname, p, isMe, contestActive)
        return (
          <li
            key={p.id}
            data-player={p.id}
            {...tip(label, 'right')}
            className={`flex gap-1 ${p.connected && !spectating ? '' : 'opacity-50'}`}
          >
            <span className="sr-only">{label}</span>
            <span aria-hidden="true" className="flex w-5 shrink-0 flex-col items-end gap-1 pt-[2px] text-[11px] leading-[14px] text-fg-muted tabular-nums">
              <span>{i + 1}</span>
              {p.isSetter && <PenIcon size={12} className="text-sem-function" />}
            </span>
            <div
              aria-hidden="true"
              className={`relative aspect-video min-w-0 flex-1 rounded-[1px] ${isMe ? 'bg-active' : 'bg-slide'} ${
                p.isSetter ? 'outline-2 outline-accent' : 'outline-1 outline-border'
              }`}
            >
              <span className={`absolute top-2 left-2 truncate text-[12px] leading-[16px] font-bold text-fg ${p.submitted ? 'right-6' : 'right-2'}`}>
                {p.nickname}
              </span>
              {(isMe || spectating) && (
                <span className="absolute top-[26px] left-2 text-[11px] leading-[14px] text-fg-muted">
                  {isMe ? '（你）' : ''}
                  {spectating ? '旁觀' : ''}
                </span>
              )}
              {p.submitted && <CheckIcon size={14} className="absolute top-2 right-2 text-sem-type" />}
              <span className="absolute right-2 bottom-1 flex items-center gap-1 text-[11px] leading-[14px] tabular-nums">
                <span className="text-sem-number">{p.score} 分</span>
              </span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
