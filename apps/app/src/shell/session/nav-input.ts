// Back and Forward from the hands (NAV-2026-11-14 rule 2): the keys, the mouse's back and forward buttons and a two-finger swipe all run `hub.back()` and `hub.forward()`, the same step
// the control in the title bar and the browser's own Back run. A browser does its own mouse buttons and swipe through its history, which history-bridge.ts turns into the same step, so the
// buttons and the swipe are handled here only where the window has no browser around it (the desktop app).
import { detectPlatform, inTerminal } from "../keyboard/useShellKeys.ts";
import { matchShortcut } from "../keyboard/map.ts";
import type { KeyLike, Platform } from "../keyboard/map.ts";
import type { ShellHub } from "../spaces/hub.ts";

/** How far (pixels of wheel travel) a swipe goes before it is a step, and how long it must be quiet before the next one counts. */
export const SWIPE_DISTANCE = 140;
export const SWIPE_QUIET_MS = 220;

/** Tells a swipe from a scroll: counts sideways travel, fires once per gesture. Feed it every wheel event; it says "back", "forward" or null. */
export function swipeTracker(): (e: { deltaX: number; deltaY: number; at: number }) => "back" | "forward" | null {
  let sum = 0;
  let last = -Infinity;
  let spent = false;
  return ({ deltaX, deltaY, at }) => {
    if (at - last > SWIPE_QUIET_MS) {
      sum = 0;
      spent = false;
    }
    last = at;
    // a mostly vertical move is a scroll; it ends the swipe
    if (Math.abs(deltaX) < Math.abs(deltaY) * 2) {
      sum = 0;
      return null;
    }
    if (spent) return null;
    sum += deltaX;
    if (sum <= -SWIPE_DISTANCE) {
      spent = true;
      return "back";
    }
    if (sum >= SWIPE_DISTANCE) {
      spent = true;
      return "forward";
    }
    return null;
  };
}

type Target = {
  closest?: (s: string) => unknown;
  scrollLeft?: number;
  scrollWidth?: number;
  clientWidth?: number;
  parentElement?: Target | null;
};

/** True when something under the pointer can scroll sideways in the direction of the swipe: that is a scroll, not a step. */
export function scrollsSideways(target: unknown, deltaX: number): boolean {
  let el = target as Target | null | undefined;
  while (el !== null && el !== undefined) {
    const { scrollLeft = 0, scrollWidth = 0, clientWidth = 0 } = el;
    if (scrollWidth > clientWidth + 1) {
      if (deltaX < 0 && scrollLeft > 0) return true;
      if (deltaX > 0 && scrollLeft + clientWidth < scrollWidth - 1) return true;
    }
    el = el.parentElement;
  }
  return false;
}

interface Doc {
  addEventListener(t: string, f: (e: never) => void, capture?: boolean): void;
  removeEventListener(t: string, f: (e: never) => void, capture?: boolean): void;
}

export interface NavInputOptions {
  platform?: Platform;
  /** The window has no browser around it: the mouse buttons and the swipe are ours. */
  desktop?: boolean;
  now?: () => number;
}

export function startNavInput(hub: ShellHub, doc: Doc, o: NavInputOptions = {}): () => void {
  const platform = o.platform ?? detectPlatform();
  const now = o.now ?? Date.now;
  const onKey = (e: KeyLike & { target?: unknown; preventDefault(): void }): void => {
    const m = matchShortcut(e, platform, { inTerminal: inTerminal(e.target) });
    if (m?.id !== "nav.back" && m?.id !== "nav.forward") return;
    // the key is Back even when nothing can go back: the browser's own Back must not also run
    e.preventDefault();
    if (m.id === "nav.back") hub.back();
    else hub.forward();
  };
  const onMouse = (e: { button: number; preventDefault(): void }): void => {
    if (e.button !== 3 && e.button !== 4) return;
    e.preventDefault();
    if (e.button === 3) hub.back();
    else hub.forward();
  };
  const swipe = swipeTracker();
  const onWheel = (e: { deltaX: number; deltaY: number; ctrlKey?: boolean; target?: unknown }): void => {
    if (e.ctrlKey === true) return;
    const dir = swipe({ deltaX: e.deltaX, deltaY: e.deltaY, at: now() });
    if (dir === null || scrollsSideways(e.target, e.deltaX)) return;
    if (dir === "back") hub.back();
    else hub.forward();
  };
  doc.addEventListener("keydown", onKey as (e: never) => void, true);
  if (o.desktop === true) {
    doc.addEventListener("mouseup", onMouse as (e: never) => void, true);
    doc.addEventListener("auxclick", onMouse as (e: never) => void, true);
    if (platform === "mac") doc.addEventListener("wheel", onWheel as (e: never) => void, { passive: true } as never);
  }
  return () => {
    doc.removeEventListener("keydown", onKey as (e: never) => void, true);
    doc.removeEventListener("mouseup", onMouse as (e: never) => void, true);
    doc.removeEventListener("auxclick", onMouse as (e: never) => void, true);
    doc.removeEventListener("wheel", onWheel as (e: never) => void);
  };
}
