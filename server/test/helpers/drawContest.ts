// 繪圖比賽測試用：組出「檔頭＋IHDR＋任意內容」的 PNG bytes（server 不解碼，只驗 magic 與 IHDR 寬高）
import { CANVAS_LOGICAL, type JudgeMode } from '@fishing-work/shared/draw-contest';
import type { Judge, JudgeInput, JudgeOutput } from '../../src/games/draw-contest/judge/types';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

/** 合法交卷 PNG（預設 1280×720）；seed 改變內容 bytes，讓 random 評分器給不同分數 */
export function makePng(seed = 0, width: number = CANVAS_LOGICAL.width, height: number = CANVAS_LOGICAL.height, extra = 32): Uint8Array {
  const ihdr = [...u32(13), 0x49, 0x48, 0x44, 0x52, ...u32(width), ...u32(height), 8, 6, 0, 0, 0, 0, 0, 0, 0];
  const body: number[] = [];
  for (let i = 0; i < extra; i++) body.push((seed * 31 + i * 7) & 0xff);
  return Uint8Array.from([...SIGNATURE, ...ihdr, ...body]);
}

/** 讓所有已排定的 microtask／promise 鏈跑完（評分佇列的結果經 promise 回報） */
export function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

// ─── 假評分器 ─────────────────────────────────────────────────────


export interface ManualCall {
  input: JudgeInput;
  signal: AbortSignal;
  resolve(out: JudgeOutput): void;
  reject(err: unknown): void;
}

/** 手動評分器：每次 score() 記一筆，由測試決定何時以什麼分數 resolve／reject；收到 abort 即 reject */
export class ManualJudge implements Judge {
  readonly calls: ManualCall[] = [];
  constructor(readonly mode: JudgeMode = 'ai') {}
  score(input: JudgeInput, signal: AbortSignal): Promise<JudgeOutput> {
    return new Promise((resolve, reject) => {
      this.calls.push({ input, signal, resolve, reject });
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  }
  /** resolve 第 i 次呼叫 */
  resolveCall(i: number, score: number, confidence = 0.5): void {
    const c = this.calls[i];
    if (!c) throw new Error(`沒有第 ${i} 次評分呼叫`);
    c.resolve({ score, confidence });
  }
}

/** 立即以函式決定分數的評分器（記錄呼叫） */
export class FnJudge implements Judge {
  readonly inputs: JudgeInput[] = [];
  constructor(
    private readonly fn: (input: JudgeInput) => JudgeOutput,
    readonly mode: JudgeMode = 'random',
  ) {}
  score(input: JudgeInput): Promise<JudgeOutput> {
    this.inputs.push(input);
    return Promise.resolve(this.fn(input));
  }
}
