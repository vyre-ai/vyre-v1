// A press is answered in the frame it lands in (r41). What a press changes is often heavy: a whole place, a conversation, a table. Made in the same pass as the press, the person sees nothing move until
// all of it is made. So a press has two parts. The answer (the row or the rail button lit as chosen) is drawn at once. The page it leads to is made after that frame, as a transition, while the
// page that was there stays on screen (and dims if the new one is slow: ui/theme/motion.ts). This file keeps the three small facts the two parts share:
//   which row was pressed and is not drawn as selected yet (an "armed" row is lit as if selected, and the row that was selected gives way to it)
//   whether a page is still being made (the shell holds its still copy of the old page until then: apps/app/src/shell/spaces/Shell.tsx)
//   when that page has been drawn (a probe component that changes state inside the same transition and so commits with it)
// Without the probe mounted (a part drawn on its own, a test) a press runs exactly as it always did.
import {
  createContext,
  createElement,
  startTransition,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactElement, ReactNode } from "react";

let armed: string | null = null;
/** transitions begun by a press whose page has not been drawn yet */
let making = 0;
/** parts of the app (the shell's deferred stage) that say a page is still being made */
let holds = 0;
let bump: (() => void) | null = null;
let safety: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
/** A press whose page never arrives (it threw, or it opened nothing) lets go of its lit row after this. */
export const ARMED_MAX_MS = 3000;

function tell(): void {
  for (const l of [...listeners]) l();
}

function mark(): void {
  const root = (
    globalThis as {
      document?: { documentElement?: { setAttribute(k: string, v: string): void; removeAttribute(k: string): void } };
    }
  ).document?.documentElement;
  if (!root) return;
  if (making > 0 || holds > 0) root.setAttribute("data-nav-busy", "1");
  else root.removeAttribute("data-nav-busy");
}

function settle(force = false): void {
  if (!force && (making > 0 || holds > 0)) return;
  if (force) making = 0;
  if (safety !== null) {
    clearTimeout(safety);
    safety = null;
  }
  const was = armed;
  armed = null;
  mark();
  if (was !== null) tell();
}

const nextFrame = (fn: () => void): void => {
  const raf = (globalThis as { requestAnimationFrame?: (f: () => void) => number }).requestAnimationFrame;
  if (raf) raf(fn);
  else setTimeout(fn, 0);
};

/**
 * Run `fn` once the frame now being made has been painted: the frame callback is the last thing before a paint, so a task queued from it runs after that paint. A page that is not being drawn
 * (a hidden window) gets no frame, so a short timer does the same. Returns how to call it off.
 */
export function afterPaint(fn: () => void): () => void {
  let done = false;
  const run = (): void => {
    if (done) return;
    done = true;
    clearTimeout(late);
    fn();
  };
  const g = globalThis as {
    requestAnimationFrame?: (f: () => void) => number;
    cancelAnimationFrame?: (n: number) => void;
  };
  const frame = g.requestAnimationFrame ? g.requestAnimationFrame(() => setTimeout(run, 0)) : null;
  const late = setTimeout(run, 120);
  return () => {
    done = true;
    clearTimeout(late);
    if (frame !== null) g.cancelAnimationFrame?.(frame);
  };
}

const NavRowsContext = createContext(false);

/**
 * The rows inside are ways to somewhere (a place's sidebar, a list of files or records): pressing one lights it at once and makes its page after that frame. Rows outside (a menu, a picker, a
 * toggle) are pressed as they always were. `on={false}` turns it back off for what is drawn inside a list but is not part of it (a menu opened from a row).
 */
export function NavRows({ on = true, children }: { on?: boolean; children?: ReactNode }): ReactElement {
  return createElement(NavRowsContext.Provider, { value: on }, children);
}
export function useNavRows(): boolean {
  return useContext(NavRowsContext);
}

/** True while a page a press asked for is still being made. */
export function navBusy(): boolean {
  return making > 0 || holds > 0;
}

/** The row lit as chosen by a press whose page is not drawn yet, or null. */
export function armedRow(): string | null {
  return armed;
}

/**
 * Run what a press does as a transition: every state change inside `run` is made after the frame that answers the press. `armId` names the row to light as chosen until its page is drawn.
 * Where the probe is not mounted, `run` is called as it is.
 */
export function pressTransition(run: () => void, armId?: string): void {
  if (bump === null) {
    run();
    return;
  }
  making += 1;
  if (armId !== undefined && armId !== armed) {
    armed = armId;
    tell();
  }
  mark();
  if (safety !== null) clearTimeout(safety);
  safety = setTimeout(() => {
    safety = null;
    settle(true);
  }, ARMED_MAX_MS);
  // The lit row is painted first; what the press does starts after that paint. Started in the press itself, React made the page in the tasks that followed and the browser painted the lit row
  // only with the finished page (measured: the press was painted after 64 ms with the page, 20 ms without).
  afterPaint(() => {
    try {
      startTransition(() => {
        run();
        bump?.();
      });
    } catch (e) {
      settle(true);
      throw e;
    }
  });
}

/** The event of a press, still usable after the press has been handled: the browser clears `currentTarget` when the handlers return, and a handler that runs after the paint may still ask where it was pressed. */
export function keepEvent(e: unknown): unknown {
  if (e === null || typeof e !== "object") return e;
  const at = (e as { currentTarget?: unknown }).currentTarget;
  return Object.create(e as object, { currentTarget: { value: at, enumerable: true } }) as unknown;
}

/** A part of the app is still making the page a press asked for (the shell's deferred stage). Returns how to say it is drawn. */
export function holdNav(): () => void {
  holds += 1;
  mark();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    holds = Math.max(0, holds - 1);
    // the frame after: a transition that ends in the same pass has said so by then
    nextFrame(() => settle());
  };
}

/** Mounted once, high in the app. It changes state inside each press's transition, so its effect runs when that transition has been drawn. */
export function PressProbe(): null {
  const [n, setN] = useState(0);
  useEffect(() => {
    const mine = (): void => setN((x) => x + 1);
    bump = mine;
    return () => {
      if (bump === mine) bump = null;
      settle(true);
    };
  }, []);
  useEffect(() => {
    if (n === 0) return;
    making = 0;
    // the shell says it is still making the page in an effect of its own: ask one frame later, when it has
    nextFrame(() => settle());
  }, [n]);
  return null;
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/**
 * How a selectable row is lit while a pressed row waits for its page: 1 the row that was pressed (lit as selected), -1 the row that is selected but gives way to the pressed one, 0 as its
 * own `selected` says.
 */
export function useArmed(id: string | undefined, selected: boolean): 0 | 1 | -1 {
  return useSyncExternalStore(
    subscribe,
    () => (armed === null || id === undefined ? 0 : armed === id ? 1 : selected ? -1 : 0),
    () => 0,
  );
}

/** For tests: forget everything. */
export function resetPressForTests(): void {
  armed = null;
  making = 0;
  holds = 0;
  bump = null;
  if (safety !== null) clearTimeout(safety);
  safety = null;
  listeners.clear();
}
