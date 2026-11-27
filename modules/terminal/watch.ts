// One watcher per terminal that has viewers (27 Nov 2026, rc.44; terminal.stream). It looks at the terminal's screen when the terminal prints something (the host's live frames are only the trigger) and tells every
// viewer the change as a numbered message: `screen` (the whole screen) or `diff` (screen-diff.ts) with the screen's size, cursor, history and hidden-prompt flag. A viewer that comes back with the number it last
// had gets what it missed from a short ring, or the whole screen when the ring does not reach. Nothing runs while nobody watches, and a screen nobody changed costs nothing: no polling.
import { diffLines } from "./screen-diff.ts";
import type { LineDiff } from "./screen-diff.ts";

export interface Screen {
  text: string;
  cols: number;
  rows: number;
  cursor: { x: number; y: number } | null;
  history: number;
  hidden: boolean;
}
export interface ScreenSource {
  /** The screen now, scrubbed. */
  capture(): Promise<Screen>;
  /** Tell `on` whenever the terminal prints; returns the function that stops it. */
  frames(on: () => void): () => void;
}
type Meta = Pick<Screen, "cols" | "rows" | "cursor" | "history" | "hidden">;
export type ScreenMsg =
  | ({ t: "screen"; rev: number; text: string } & Meta)
  | ({ t: "diff"; rev: number; base: number } & LineDiff & Meta)
  | { t: "ok"; rev: number };

export interface WatcherOptions {
  /** How long to wait after a print for more before looking (a program prints in bursts). Default 30 ms. */
  debounceMs?: number;
  /** How many numbered changes are kept for a viewer that was away. Default 32. */
  ring?: number;
  set?(f: () => void, ms: number): () => void;
}

const realSet = (f: () => void, ms: number): (() => void) => {
  const t = setTimeout(f, ms) as unknown as { unref?: () => void };
  t.unref?.();
  return () => clearTimeout(t as unknown as number);
};
const metaOf = (s: Screen): Meta => ({
  cols: s.cols,
  rows: s.rows,
  cursor: s.cursor,
  history: s.history,
  hidden: s.hidden,
});
const sameMeta = (a: Meta, b: Meta): boolean =>
  a.cols === b.cols &&
  a.rows === b.rows &&
  a.history === b.history &&
  a.hidden === b.hidden &&
  a.cursor?.x === b.cursor?.x &&
  a.cursor?.y === b.cursor?.y;

export interface Watcher {
  /** A viewer arrives, with the number it last had (none for a new one). It is sent what it needs at once, then every change. Returns how it leaves. */
  subscribe(send: (m: ScreenMsg) => void, since?: number): Promise<{ stop(): void; resync(): void }>;
  viewers(): number;
}

export function createWatcher(src: ScreenSource, o: WatcherOptions = {}): Watcher {
  const set = o.set ?? realSet;
  const debounce = o.debounceMs ?? 30;
  const keep = o.ring ?? 32;
  const subs = new Set<(m: ScreenMsg) => void>();
  let rev = 0;
  let lines: string[] | null = null;
  let meta: Meta | null = null;
  let ring: Array<{ rev: number; msg: ScreenMsg }> = [];
  let stopFrames: (() => void) | null = null;
  let timer: (() => void) | null = null;
  let looking = false;
  let again = false;
  let starting: Promise<void> | null = null;

  const whole = (): ScreenMsg => ({ t: "screen", rev, text: (lines ?? []).join("\n"), ...(meta as Meta) });
  const broadcast = (m: ScreenMsg): void => {
    for (const s of [...subs]) {
      try {
        s(m);
      } catch {
        /* a viewer that cannot be written to is dropped by its own socket */
      }
    }
  };
  const look = async (): Promise<void> => {
    if (looking) {
      again = true;
      return;
    }
    looking = true;
    try {
      const s = await src.capture();
      const next = s.text.split("\n");
      const m = metaOf(s);
      if (lines === null || meta === null) {
        lines = next;
        meta = m;
        return;
      }
      const d = diffLines(lines, next);
      const same = d !== null && d.top === 0 && d.drop === 0 && d.ins.length === 0;
      if (same && sameMeta(meta, m)) return;
      rev++;
      const msg: ScreenMsg =
        d === null ? { t: "screen", rev, text: s.text, ...m } : { t: "diff", rev, base: rev - 1, ...d, ...m };
      lines = next;
      meta = m;
      ring.push({ rev, msg });
      if (ring.length > keep) ring = ring.slice(-keep);
      broadcast(msg);
    } catch {
      /* the next print looks again */
    } finally {
      looking = false;
      if (again) {
        again = false;
        trigger();
      }
    }
  };
  const trigger = (): void => {
    if (timer !== null || subs.size === 0) return;
    timer = set(() => {
      timer = null;
      void look();
    }, debounce);
  };
  const begin = (): Promise<void> => {
    starting ??= (async () => {
      const s = await src.capture();
      lines = s.text.split("\n");
      meta = metaOf(s);
      stopFrames = src.frames(trigger);
    })().catch((e: unknown) => {
      starting = null;
      throw e;
    });
    return starting;
  };
  const end = (): void => {
    stopFrames?.();
    stopFrames = null;
    timer?.();
    timer = null;
    lines = null;
    meta = null;
    ring = [];
    starting = null;
    again = false;
  };

  return {
    async subscribe(send, since) {
      await begin();
      // what the viewer needs now: nothing (it is up to date), what it missed, or the whole screen
      if (since === rev) send({ t: "ok", rev });
      else if (since === undefined) send(whole());
      else {
        const from: number = since;
        const missed = ring.filter((r) => r.rev > from);
        const bridges = missed.length === rev - from && missed.every((r, i) => r.rev === from + 1 + i);
        if (bridges) for (const r of missed) send(r.msg);
        else send(whole());
      }
      subs.add(send);
      return {
        stop() {
          if (!subs.delete(send)) return;
          if (subs.size === 0) end();
        },
        resync() {
          send(whole());
        },
      };
    },
    viewers: () => subs.size,
  };
}
