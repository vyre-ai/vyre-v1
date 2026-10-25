// Output lines of a CLI process: newline separated JSON. A chunk can end in the middle of a line and in the middle of a multi-byte character; a line is yielded once it is whole.

/** Longest line kept. A CLI writes one tool result per line, so this is generous; a line past it is a broken process, not a result. */
export const MAX_LINE_BYTES = 8 * 1024 * 1024;

export async function* lines(src: AsyncIterable<Uint8Array | string>): AsyncGenerator<string> {
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of src) {
    buf += typeof chunk === "string" ? chunk : dec.decode(chunk, { stream: true });
    let at = buf.indexOf("\n");
    while (at >= 0) {
      const line = buf.slice(0, at).replace(/\r$/, "");
      buf = buf.slice(at + 1);
      if (line !== "") yield line;
      at = buf.indexOf("\n");
    }
    if (buf.length > MAX_LINE_BYTES) throw new RangeError("a line of CLI output is longer than the limit");
  }
  buf += dec.decode();
  if (buf.trim() !== "") yield buf.replace(/\r$/, "");
}

/** A small FIFO a producer pushes into and a consumer awaits, with a wait that gives up after a time or when the caller aborts. */
export interface Channel<T> {
  push(v: T): void;
  /** The next value; "idle" after `ms` with nothing; null when `signal` aborts. */
  next(ms: number, signal: AbortSignal): Promise<T | "idle" | null>;
  /** Values waiting. */
  readonly size: number;
}

export function channel<T>(): Channel<T> {
  const q: T[] = [];
  let wake: (() => void) | null = null;
  const poke = (): void => { const w = wake; wake = null; w?.(); };
  return {
    push(v) { q.push(v); poke(); },
    get size() { return q.length; },
    async next(ms, signal) {
      for (;;) {
        const v = q.shift();
        if (v !== undefined) return v;
        if (signal.aborted) return null;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const onAbort = (): void => poke();
        const timedOut = await new Promise<boolean>((resolve) => {
          timer = setTimeout(() => { wake = null; resolve(true); }, ms);
          wake = () => resolve(false);
          signal.addEventListener("abort", onAbort, { once: true });
        });
        if (timer !== undefined) clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        if (timedOut && q.length === 0 && !signal.aborted) return "idle";
      }
    },
  };
}
