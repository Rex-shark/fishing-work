// excel 主題的玩家清單呈現（ShellViews.PlayerList）：偽裝成工作表 A–C 欄的人員分數表（DESIGN.md §17.3；plan/excel-theme.md 決策 6）。
//   第 1 列表頭「名稱」「分數」「狀態」（粗體、底 --bg-sidebar、下緣 1px --border）；
//   每位玩家一列（第 2 列起）：名稱（自己加「（你）」且粗體；斷線 --fg-muted）、分數（右對齊、tabular-nums）、
//   狀態（畫師「✎ 繪圖中」--sem-function、已猜對「✓ +N」--sem-type、斷線「離線」--fg-muted、否則空白）；
//   畫師列整列底 --bg-active，畫師的名稱格加 2px --border-focus 作用中儲存格框（右下角填滿控點）。
// 儲存格對齊工作表的 20px／64px 格距（A 欄 128px），自己畫右、下 1px --grid-line（底色會蓋住殼層畫的格線）。
// 以 ARIA 表格語意（table／row／columnheader／cell）讓輔助技術逐格讀；每列另有完整狀態的工具提示（playerRowLabel）。
// 狀態欄文字可溢出到空白的 D 欄（Excel 的文字溢出）；列資料由功能元件 features/players/PlayerList 提供。
import { playerRowLabel } from '../../features/players/playerRow'
import { tip } from '../../layout/tooltipPlacement'
import type { PlayerListViewProps } from '../views'
import { SHEET_HEADERS, sheetNameText, sheetStatus, type SheetStatusTone } from './excelLayout'

const STATUS_TONE: Record<SheetStatusTone, string> = {
  drawer: 'text-sem-function',
  guessed: 'text-sem-type',
  offline: 'text-fg-muted',
}

/** 一格：高 20px（含下緣 1px）、右下 1px 格線；寬度依欄 */
const CELL = 'h-[20px] shrink-0 border-r border-b border-grid-line px-[4px] leading-[19px] whitespace-nowrap'
const COL_A = 'w-[128px]'
const COL_B = 'w-[64px]'
const COL_C = 'w-[64px]'

export function SheetPlayers({ rows }: PlayerListViewProps) {
  return (
    <div role="table" aria-label="玩家清單" aria-rowcount={rows.length + 1} className="flex w-[256px] flex-col text-[13px] text-fg">
      <div role="row" className="flex">
        {SHEET_HEADERS.map((header, i) => (
          <div
            key={header}
            role="columnheader"
            className={`${CELL} ${[COL_A, COL_B, COL_C][i] ?? ''} border-b-border bg-sidebar font-bold ${i === 1 ? 'text-right' : ''}`}
          >
            {header}
          </div>
        ))}
      </div>
      {rows.map(({ player: p, isMe, gain }) => {
        const label = playerRowLabel(p.nickname, p, isMe, gain)
        const status = sheetStatus(p, gain)
        return (
          <div key={p.id} role="row" data-player={p.id} {...tip(label, 'right')} className={`flex ${p.isDrawer ? 'bg-active' : ''}`}>
            <div role="cell" className={`${CELL} ${COL_A} relative ${p.connected ? '' : 'text-fg-muted'} ${isMe ? 'font-bold' : ''}`}>
              <span className="block truncate">{sheetNameText(p.nickname, isMe)}</span>
              {p.isDrawer && (
                <span aria-hidden="true" className="pointer-events-none absolute -top-px -right-px -bottom-px -left-px outline-2 -outline-offset-1 outline-border-focus">
                  {/* 填滿控點：作用中儲存格框右下角的小方塊 */}
                  <span className="absolute -right-[3px] -bottom-[3px] block h-[5px] w-[5px] border border-input bg-border-focus" />
                </span>
              )}
            </div>
            <div role="cell" className={`${CELL} ${COL_B} text-right tabular-nums`}>
              {p.score}
            </div>
            <div role="cell" className={`${CELL} ${COL_C} relative overflow-visible ${status !== null ? STATUS_TONE[status.tone] : ''}`}>
              {status?.text ?? ''}
            </div>
          </div>
        )
      })}
    </div>
  )
}
