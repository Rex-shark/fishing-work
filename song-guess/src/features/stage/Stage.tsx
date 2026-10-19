// 舞台（ShellProps.stage 插槽；spec/song-guess/design.md §2「舞台」欄）：依階段顯示
//   沒有局也沒有結果 → 殼層的空畫面；choosing → 殼層的「出題者準備中」；playing → 殼層的播放視覺＋兩行字（題庫標題與第 n / N 首、本首歌手；不顯示歌名與封面）；
//   reveal → 每首揭曉卡；ended、idle 有上一局結果 → 本局排名表（features/reveal）。
// 播放視覺長什麼樣、空畫面寫什麼字由殼層決定（ShellViews.Stage）；本檔只給資料：播放器狀態與手動起播。
import { useShellViews } from '../../shells/views'
import { selectIsSetter, useGameStore } from '../../store/game'
import { startPlayback, useAudioStore } from '../player/audioState'
import { START_PLAYBACK_LABEL } from '../player/playback'
import { GameRanking } from '../reveal/GameRanking'
import { RevealCard } from '../reveal/RevealCard'
import { stageMode } from '../reveal/revealView'
import { playingStageLines, setterNameOf } from '../round/roundDisplay'

export function Stage() {
  const mode = useGameStore((s) => stageMode(s.round))
  switch (mode) {
    case 'results':
      return <GameRanking />
    case 'reveal':
      return <RevealCard />
    case 'playing':
      return <PlayingStage />
    case 'preparing':
      return <PreparingStage />
    case 'empty':
      return <EmptyStage />
  }
}

function EmptyStage() {
  const { Stage: View } = useShellViews()
  return <View kind="empty" />
}

function PreparingStage() {
  const { Stage: View } = useShellViews()
  const isSetter = useGameStore(selectIsSetter)
  const setterName = useGameStore((s) => setterNameOf(s.round, s.players))
  return <View kind="preparing" setterName={setterName} isSetter={isSetter} />
}

function PlayingStage() {
  const { Stage: View } = useShellViews()
  // 兩個字串分開選（回傳物件的 selector 每次都是新參考，會讓 Zustand 無限重繪）
  const heading = useGameStore((s) => playingStageLines(s.round).heading)
  const artistLine = useGameStore((s) => playingStageLines(s.round).artistLine)
  const playback = useAudioStore((s) => s.state)
  return <View kind="playing" heading={heading} artistLine={artistLine} playback={playback} startLabel={START_PLAYBACK_LABEL} onStart={startPlayback} />
}
