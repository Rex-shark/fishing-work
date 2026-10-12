// 時鐘偏移（spec/song-guess/architecture.md §5「時鐘」、plan 決策 7）：server 的 startedAt／endsAt 都是 server 時鐘，
// 本機時鐘可能差幾秒。每次 round:update／快照都帶 round.serverNow（送出當下的 server 時鐘），
// 以「serverNow − 收到當下的本機時間」估偏移；倒數與播放定位一律用校正後的時間（本機時間 + 偏移）。
// 估計值比真實偏移小一個網路延遲（區網 < 100 ms，可接受；不做 NTP 式校正）。純函式，可單元測試。

/** 偏移（毫秒）＝ server 時鐘 − 本機時鐘；任一值不是有限數字時回 0（不校正） */
export function estimateClockOffset(serverNow: number, localNow: number): number {
  if (!Number.isFinite(serverNow) || !Number.isFinite(localNow)) return 0
  return serverNow - localNow
}

/** 本機時間 → 校正後的 server 時間 */
export function toServerTime(localNow: number, offset: number): number {
  return localNow + (Number.isFinite(offset) ? offset : 0)
}
