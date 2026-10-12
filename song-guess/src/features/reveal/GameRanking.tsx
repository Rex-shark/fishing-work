// 本局排名表（spec/song-guess/design.md §1「本局排名」）：名次、暱稱、本局得分、猜對首數；前三名 --accent；
// 標題「本局結果 · <歌手>」。ended 顯示本局；idle 有上一局結果時同樣顯示（results／lastArtist 保留到下一局第 1 首開始）。
// 停到有人出題為止，沒有計時。色彩一律用 token class；不含任何偽裝字樣。
import { useGameStore } from '../../store/game'
import { rankingRows, rankingTitle, type RankingRow } from './revealView'

/** 接 store：有結果才渲染 */
export function GameRanking() {
  const results = useGameStore((s) => s.round.results)
  // lastArtist＝results 對應的歌手正式名（＝該局的 artistDisplay），與 results 同生命週期（events.ts）；沒帶到時退回本局的歌手名
  const artist = useGameStore((s) => s.round.lastArtist ?? s.round.artistDisplay ?? s.round.artist)
  const me = useGameStore((s) => s.me)
  if (results === null || results.length === 0) return null
  return <GameRankingView title={rankingTitle(artist)} rows={rankingRows(results, me)} />
}

export function GameRankingView({ title, rows }: { title: string; rows: readonly RankingRow[] }) {
  return (
    <div data-stage="results" className="flex max-h-full w-full max-w-[560px] flex-col">
      <div className="min-h-0 overflow-y-auto">
        <table className="w-full border-collapse text-left text-[14px] leading-[20px] text-fg">
          <caption className="pb-[12px] text-left text-[16px] leading-[24px] font-medium text-fg">{title}</caption>
          <thead>
            <tr className="border-b border-border text-[12px] leading-[16px]">
              <th scope="col" className="w-[56px] py-[6px] pr-[8px] font-normal">
                名次
              </th>
              <th scope="col" className="py-[6px] pr-[8px] font-normal">
                暱稱
              </th>
              <th scope="col" className="w-[88px] py-[6px] pr-[8px] text-right font-normal">
                本局得分
              </th>
              <th scope="col" className="w-[88px] py-[6px] text-right font-normal">
                猜對首數
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.playerId} data-player={row.playerId} data-rank={row.rank} className={row.isTop ? 'text-accent' : undefined}>
                <td className="py-[6px] pr-[8px] tabular-nums">{row.rank}</td>
                <th scope="row" className={`max-w-0 truncate py-[6px] pr-[8px] ${row.isMe ? 'font-bold' : 'font-normal'}`}>
                  {row.nickname}
                  {row.isMe && <span className="sr-only">（你）</span>}
                </th>
                <td className="py-[6px] pr-[8px] text-right tabular-nums">{row.gameScore}</td>
                <td className="py-[6px] text-right tabular-nums">{row.correctCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
