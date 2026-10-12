// meet 主題的玩家清單呈現（ShellViews.PlayerList）：偽裝成右側影片條的參加者 tile（DESIGN.md §15.2「右側影片條」；spec/song-guess/design.md §1「參加者 tile」）。
// 每人一張 16:9 tile（底 --bg-tab-inactive、圓角 8px）：置中 40px 頭像圓（暱稱首字、--avatar-n、--fg-on-avatar，Meet 關鏡頭時的樣子）、
//   左下暱稱（自己加「（你）」；斷線改「連線中斷」）、右下分數膠囊（只顯示總分「N 分」；本首 +N 只在工具提示與 sr-only）；
//   出題者：左上喇叭圖示＋2px --border-focus 外框；本首已猜對：右上舉手圖示 --accent；斷線：整張 opacity .5。
// tile 內承載資訊的文字一律 --fg（--fg-muted 在 tile 上只有 4.0:1，DESIGN §15.1）。
// 顏色不是唯一訊息載體（§9）：出題者有喇叭圖示、猜對有舉手圖示、自己與斷線有文字；完整狀態以 playerRowLabel 提供給輔助技術與工具提示。
// 列資料由功能元件 features/players/PlayerList 提供。
import { playerRowLabel } from '../../features/players/playerRow'
import { tip } from '../../layout/tooltipPlacement'
import { avatarBgClass, avatarInitial } from '../avatar'
import type { PlayerListViewProps } from '../views'
import { HandIcon, OfflineIcon, ShareAudioIcon } from './meetIcons'
import { tileName } from './meetLayout'

export function ParticipantTiles({ rows }: PlayerListViewProps) {
  return (
    // ≥ 1024px 為主畫面右側的直向影片條；< 1024px 改為主畫面下方的橫向列（tile 寬 120px，DESIGN §15.3）
    <ol aria-label="玩家清單" className="flex flex-col gap-[8px] max-lg:flex-row">
      {rows.map(({ player: p, isMe, gain }) => {
        const label = playerRowLabel(p.nickname, p, isMe, gain)
        return (
          <li
            key={p.id}
            data-player={p.id}
            data-setter={p.isSetter ? '' : undefined}
            data-guessed={p.hasGuessed ? '' : undefined}
            {...tip(label)}
            className={`relative aspect-video shrink-0 overflow-hidden rounded-[8px] bg-tab-inactive max-lg:w-[120px] ${
              p.isSetter ? 'outline-2 -outline-offset-2 outline-border-focus' : ''
            } ${p.connected ? '' : 'opacity-50'}`}
          >
            <span className="sr-only">{label}</span>
            <div aria-hidden="true" className="absolute inset-0 text-[12px] leading-[16px] text-fg">
              {/* 下方橫向列（< 1024px，tile 120×68）：頭像縮成 28px 並上移，不與左下暱稱重疊 */}
              <span className="absolute inset-0 flex items-center justify-center max-lg:pb-[18px]">
                <span
                  className={`flex h-[40px] w-[40px] items-center justify-center rounded-full text-[18px] leading-none font-medium text-fg-on-avatar max-lg:h-[28px] max-lg:w-[28px] max-lg:text-[14px] ${avatarBgClass(
                    p.nickname,
                  )}`}
                >
                  {avatarInitial(p.nickname)}
                </span>
              </span>
              {p.isSetter && (
                <span className="absolute top-[8px] left-[8px] flex h-[24px] w-[24px] items-center justify-center rounded-full bg-editor/70">
                  <ShareAudioIcon size={16} />
                </span>
              )}
              {p.hasGuessed && (
                <span className="absolute top-[8px] right-[8px] flex h-[24px] w-[24px] items-center justify-center rounded-full bg-editor/70 text-accent">
                  <HandIcon size={16} />
                </span>
              )}
              <span className="absolute right-[8px] bottom-[6px] left-[8px] flex items-center gap-[4px]">
                {!p.connected && <OfflineIcon size={12} />}
                <span className="min-w-0 flex-1 truncate font-medium">
                  {tileName(p.nickname, isMe, p.connected)}
                </span>
                {/* 分數膠囊只放總分（design §1）：本首 +N 在工具提示與 sr-only（playerRowLabel），揭曉卡與字幕列也有 */}
                <span className="flex shrink-0 items-center gap-[4px] rounded-full bg-editor/70 px-[6px] tabular-nums">
                  <span>{p.score} 分</span>
                </span>
              </span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
