/**
 * 数据延迟缓冲：让实时数据（GSI 是「现在」）与有延迟的播出画面对齐。
 * 单队列 + 单定时器，严格先进先出——即使中途把延迟调小，新帧也不会跑到旧帧前面。
 */
export class DelayQueue {
  private queue: Array<{ at: number; fn: () => void }> = [];
  private timer?: NodeJS.Timeout;

  constructor(private getDelayMs: () => number) {}

  push(fn: () => void): void {
    const now = Date.now();
    const delay = Math.max(0, this.getDelayMs());
    if (delay === 0 && this.queue.length === 0) {
      fn();
      return;
    }
    const tail = this.queue.at(-1)?.at ?? 0;
    this.queue.push({ at: Math.max(now + delay, tail), fn });
    this.schedule();
  }

  /** 丢弃所有排队中的帧（换图/重置时使用） */
  clear(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.queue = [];
  }

  get pending(): number {
    return this.queue.length;
  }

  private schedule(): void {
    if (this.timer || this.queue.length === 0) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const now = Date.now();
      while (this.queue.length && this.queue[0].at <= now) {
        const { fn } = this.queue.shift()!;
        try {
          fn();
        } catch (err) {
          console.error("[delay-queue] frame handler failed", err);
        }
      }
      this.schedule();
    }, Math.max(0, this.queue[0].at - Date.now()));
  }
}
