import type { Clock, TimerHandle } from '../../src/games/draw-guess/room';

/** 假時鐘：now 可控、advance 依到期順序觸發計時器 */
export class FakeClock implements Clock {
  t = 1_700_000_000_000;
  private seq = 0;
  readonly timers = new Map<number, { at: number; fn: () => void }>();

  now(): number {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + ms, fn });
    return id;
  }
  clearTimeout(handle: TimerHandle): void {
    this.timers.delete(handle as number);
  }
  advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | undefined;
      for (const e of this.timers) if (e[1].at <= target && (!next || e[1].at < next[1].at)) next = e;
      if (!next) break;
      this.timers.delete(next[0]);
      this.t = next[1].at;
      next[1].fn();
    }
    this.t = target;
  }
}
