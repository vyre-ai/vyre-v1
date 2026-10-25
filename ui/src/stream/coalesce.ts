// Streaming deltas arrive as fast as the provider sends them (100 a second and more). Rendering each one costs a React commit and a layout, so a stream would spend more than the 16.7 ms a
// frame allows. The coalescer collects deltas and hands them over once per animation frame, as one string: one append, one commit, one layout per frame whatever the delta rate (ARCH 9,
// "Streaming renders at 60 fps"). The scheduler is a parameter so a test can drive frames by hand and a native build can bring its own.

export interface FrameScheduler {
  request(callback: (time: number) => void): number;
  cancel(handle: number): void;
}

const hasFrames = typeof globalThis.requestAnimationFrame === "function" && typeof globalThis.cancelAnimationFrame === "function";

/** requestAnimationFrame where there is one (browsers, React Native); a 16 ms timer elsewhere (tests on the server, SSR). */
export const frameScheduler: FrameScheduler = hasFrames
  ? { request: (cb) => globalThis.requestAnimationFrame(cb), cancel: (h) => globalThis.cancelAnimationFrame(h) }
  : { request: (cb) => setTimeout(() => cb(Date.now()), 16) as unknown as number, cancel: (h) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>) };

export interface CoalescerStats {
  /** Deltas pushed. */
  deltas: number;
  /** Times the flush callback ran: at most one per frame. */
  flushes: number;
  /** Characters delivered. */
  chars: number;
  /** The most deltas delivered by one flush. */
  maxBatch: number;
}

export interface Coalescer {
  push(delta: string): void;
  /** Deliver what is waiting now (the end of a stream, a tab that must show the final text). */
  flush(): void;
  /** Drop what is waiting and any frame request. */
  cancel(): void;
  readonly waiting: boolean;
  readonly stats: Readonly<CoalescerStats>;
}

export function createCoalescer(onFlush: (text: string) => void, scheduler: FrameScheduler = frameScheduler): Coalescer {
  const parts: string[] = [];
  let handle: number | null = null;
  const stats: CoalescerStats = { deltas: 0, flushes: 0, chars: 0, maxBatch: 0 };

  function deliver(): void {
    if (parts.length === 0) return;
    const text = parts.join("");
    stats.flushes++;
    stats.chars += text.length;
    if (parts.length > stats.maxBatch) stats.maxBatch = parts.length;
    parts.length = 0;
    onFlush(text);
  }

  return {
    push(delta) {
      if (delta === "") return;
      stats.deltas++;
      parts.push(delta);
      if (handle === null) {
        handle = scheduler.request(() => {
          handle = null;
          deliver();
        });
      }
    },
    flush() {
      if (handle !== null) {
        scheduler.cancel(handle);
        handle = null;
      }
      deliver();
    },
    cancel() {
      if (handle !== null) {
        scheduler.cancel(handle);
        handle = null;
      }
      parts.length = 0;
    },
    get waiting() {
      return parts.length > 0;
    },
    stats,
  };
}
