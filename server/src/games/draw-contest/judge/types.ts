// 評分器介面：spec/draw-contest/architecture.md §6（逐字）
import type { JudgeMode } from '@fishing-work/shared/draw-contest';

export interface JudgeInput { png: Buffer; topic: string; reference?: Buffer }   // Epic 20：mimic 回合帶參考圖 JPEG
export interface JudgeOutput { score: number; confidence: number }   // 0..SCORE_MAX 整數；0..1
export interface Judge {
  readonly mode: JudgeMode;
  score(input: JudgeInput, signal: AbortSignal): Promise<JudgeOutput>;
}
