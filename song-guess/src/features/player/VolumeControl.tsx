// 音量（spec/song-guess/design.md §1「音量」、§3）：唯一的播放控制。值與存檔在 volume.ts（0～100、預設 15、localStorage），
// 外觀（圖示＋滑桿）由殼層提供（ShellViews.Volume）；AudioPlayer 訂閱同一個 store 套到 <audio>.volume。
import { useShellViews } from '../../shells/views'
import { VOLUME_MAX, VOLUME_MIN, useVolumeStore } from './volume'

export function VolumeControl() {
  const { Volume } = useShellViews()
  const volume = useVolumeStore((s) => s.volume)
  const setVolume = useVolumeStore((s) => s.setVolume)
  return <Volume value={volume} min={VOLUME_MIN} max={VOLUME_MAX} onChange={setVolume} label="音量" />
}
