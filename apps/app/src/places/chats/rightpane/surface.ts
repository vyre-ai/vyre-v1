// The one reconnecting model behind the browser view and the terminal screen (27 Nov 2026, rc.44; owner: "I can't open browser or terminal in Vyre in a stable way"). Before it, the live view opened once and a
// lost stream left a frozen picture under a bar that still said "Watching", and the terminal poll swallowed every error. Now both are a Surface: open it, and when the connection is lost (an image error, a
// socket close, a screen read that fails again and again) it opens again by itself with a back-off, says "Reconnecting" while it does, and after RECONNECT_GIVE_UP_MS says it could not reach the thing, with a
// Try again that starts over. An address that was handed out but never used is replaced before its ticket runs out. A refusal that will not change (no permission, not found) is shown at once and not retried.
// The model has no React in it and takes its clock as a dependency, so the tests run it with a fake one.

export type SurfaceState =
  | { kind: "idle" }
  | { kind: "opening" }
  | { kind: "ready" }
  | { kind: "reconnecting"; attempt: number; since: number }
  | { kind: "failed"; reason: string; retryable: boolean };

/** How long it keeps trying by itself before it says it could not reach the thing. */
export const RECONNECT_GIVE_UP_MS = 30_000;
/** A ticket that has not been used is replaced this long before it runs out. */
export const TICKET_SPARE_MS = 8_000;
const STEPS = [250, 500, 1000, 2000];

/** The wait before the next try, by how many have failed already: 250 ms growing to 2 s (the give-up at 30 s stays). */
export const backoffMs = (attempt: number): number => STEPS[Math.min(Math.max(0, attempt), STEPS.length - 1)]!;

/** Refusals that another try will not change. */
const FINAL = /^(permission\.|validation\.(not_found|bad_input)|auth\.)/;
export const isFinal = (e: unknown): boolean => {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" && FINAL.test(code);
};

export interface SurfaceDeps<T> {
  /** Ask for a new address (a ticket). Called again for every reconnect: an address is never reused. */
  open(): Promise<T>;
  /** An address is ready: connect to it. */
  onOpened(t: T): void;
  /** The state changed. */
  onState(s: SurfaceState): void;
  /** The clock: now in milliseconds, and a timer that returns its own cancel. */
  clock?: { now(): number; set(f: () => void, ms: number): () => void };
  /** When the address's ticket runs out (ms since the epoch of `clock.now`), if it does. */
  expiresAt?(t: T): number | undefined;
  /** The words for a failure that has no better ones. */
  reachWords?: string;
  /** How long it keeps trying by itself (default RECONNECT_GIVE_UP_MS). */
  giveUpMs?: number;
}

export interface Surface {
  /** Open it the first time. */
  start(): void;
  /** The connection was made (an image loaded, a socket opened, a screen came): the ticket is spent and the back-off starts over. */
  connected(): void;
  /** The connection was lost: open again by itself. */
  lost(why?: string): void;
  /** Try again from the start (the button; also the window coming back online or visible). */
  retry(): void;
  /** The window came back: a surface that gave up tries again, one that is fine stays as it is. */
  resume(): void;
  state(): SurfaceState;
  dispose(): void;
}

const realClock = {
  now: (): number => Date.now(),
  set: (f: () => void, ms: number): (() => void) => {
    const t = setTimeout(f, ms) as unknown as { unref?: () => void };
    t.unref?.();
    return () => clearTimeout(t as unknown as number);
  },
};

export function createSurface<T>(d: SurfaceDeps<T>): Surface {
  const clock = d.clock ?? realClock;
  let state: SurfaceState = { kind: "idle" };
  let gone = false;
  let attempt = 0;
  let since = 0;
  let cancelWait: (() => void) | null = null;
  let cancelStale: (() => void) | null = null;
  /** a counter that ends the answer of an open that was overtaken (a lost, a retry or a dispose came first) */
  let round = 0;
  const set = (s: SurfaceState): void => {
    if (gone) return;
    state = s;
    d.onState(s);
  };
  const clear = (): void => {
    cancelWait?.();
    cancelWait = null;
    cancelStale?.();
    cancelStale = null;
  };
  const words = d.reachWords ?? "Could not reach it.";
  const giveUp = d.giveUpMs ?? RECONNECT_GIVE_UP_MS;
  const open = (): void => {
    const mine = ++round;
    if (state.kind !== "reconnecting") set({ kind: "opening" });
    void d.open().then(
      (t) => {
        if (gone || mine !== round) return;
        set({ kind: "ready" });
        d.onOpened(t);
        const at = d.expiresAt?.(t);
        if (at !== undefined) {
          cancelStale?.();
          // nobody has connected with this ticket and it is about to run out: ask for another
          cancelStale = clock.set(
            () => {
              cancelStale = null;
              if (!gone && mine === round) open();
            },
            Math.max(0, at - clock.now() - TICKET_SPARE_MS),
          );
        }
      },
      (e: unknown) => {
        if (gone || mine !== round) return;
        if (isFinal(e)) {
          set({ kind: "failed", reason: e instanceof Error && e.message ? e.message : words, retryable: false });
          return;
        }
        again(e);
      },
    );
  };
  const again = (e?: unknown): void => {
    if (gone) return;
    clear();
    if (state.kind !== "reconnecting") {
      since = clock.now();
      set({ kind: "reconnecting", attempt, since });
    }
    if (clock.now() - since >= giveUp) {
      void e;
      set({ kind: "failed", reason: words, retryable: true });
      return;
    }
    const wait = backoffMs(attempt++);
    cancelWait = clock.set(() => {
      cancelWait = null;
      if (gone) return;
      if (clock.now() - since >= giveUp) {
        set({ kind: "failed", reason: words, retryable: true });
        return;
      }
      set({ kind: "reconnecting", attempt, since });
      open();
    }, wait);
  };
  return {
    start() {
      if (gone || state.kind !== "idle") return;
      attempt = 0;
      open();
    },
    connected() {
      if (gone) return;
      // a connection that works ends any waiting to open again
      clear();
      ++round;
      attempt = 0;
      if (state.kind !== "ready") set({ kind: "ready" });
    },
    lost() {
      if (gone || state.kind === "failed") return;
      ++round;
      again();
    },
    retry() {
      if (gone) return;
      clear();
      ++round;
      attempt = 0;
      state = { kind: "idle" };
      open();
    },
    resume() {
      if (gone) return;
      if (state.kind === "failed" && state.retryable) this.retry();
    },
    state: () => state,
    dispose() {
      gone = true;
      round++;
      clear();
    },
  };
}
