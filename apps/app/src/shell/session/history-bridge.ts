// The browser's history and the tab's history are the same history (NAV-2026-11-14 rule 2). The browser keeps three entries around the one on screen: a Back guard, the one
// we show, and a Forward guard. Pressing the browser's Back (or the mouse button, or a swipe in a browser) lands on the guard; the guard runs the tab's own Back and puts the
// person back on the middle entry. So the browser never walks away from what the tab remembers, and the address bar always names what is on screen.
// The guards are made on the first press or key, never at load: a browser skips entries a page made without one.
import type { ShellHub } from "../spaces/hub.ts";
import { hubUrl, readUrlIntoHub } from "./url.ts";

type Mark = "back" | "here" | "fwd";

/** The part of `window` the bridge uses (a test gives it a fake). */
export interface BridgeWindow {
  location: { pathname: string; search: string; hash: string };
  history: {
    state: unknown;
    pushState(state: unknown, title: string, url: string): void;
    replaceState(state: unknown, title: string, url: string): void;
    go(delta: number): void;
  };
  addEventListener(type: string, fn: (e: never) => void, capture?: boolean): void;
  removeEventListener(type: string, fn: (e: never) => void, capture?: boolean): void;
}

const markOf = (state: unknown): Mark | null => {
  if (state === null || typeof state !== "object") return null;
  const m = (state as { vyre?: unknown }).vyre;
  return m === "back" || m === "here" || m === "fwd" ? m : null;
};

/** Starts the bridge. Returns what stops it. */
export function startHistoryBridge(hub: ShellHub, win: BridgeWindow): () => void {
  /** True from landing on a guard until the middle entry is back on screen: events in between are ours. */
  let returning = false;
  let guarded = markOf(win.history.state) === "here";

  const here = (): string => `${win.location.pathname}${win.location.search}${win.location.hash}`;
  const read = (): void => readUrlIntoHub(hub, win.location);

  /** The address bar names what is on screen. */
  const show = (): void => {
    // between the guard and the middle entry the address belongs to the guard: the middle entry is written when it is back
    if (returning) return;
    const next = hubUrl(hub, win.location.search);
    if (next === null || next === here()) return;
    win.history.replaceState(guarded ? { vyre: "here" } : win.history.state, "", next);
  };

  const guard = (): void => {
    if (guarded) return;
    guarded = true;
    const url = hubUrl(hub, win.location.search) ?? here();
    returning = true;
    win.history.replaceState({ vyre: "back" }, "", url);
    win.history.pushState({ vyre: "here" }, "", url);
    win.history.pushState({ vyre: "fwd" }, "", url);
    win.history.go(-1);
  };

  const onPop = (e: { state: unknown }): void => {
    const mark = markOf(e.state);
    if (mark === "here") {
      // back on the middle entry after a guard: write the address of what is on screen now. Any other time an address that no longer matches was edited by hand: a link.
      if (returning) {
        returning = false;
        show();
      } else if (here() !== hubUrl(hub, win.location.search)) read();
      return;
    }
    if (mark === "back" || mark === "fwd") {
      returning = true;
      if (mark === "back") hub.back();
      else hub.forward();
      // the middle entry again, with the address of what is on screen now
      win.history.go(mark === "back" ? 1 : -1);
      return;
    }
    // an entry we did not make: a link
    read();
  };
  const onHash = (): void => {
    if (returning) return;
    read();
  };
  const onFirstPress = (): void => guard();

  read();
  win.addEventListener("popstate", onPop as (e: never) => void);
  win.addEventListener("hashchange", onHash);
  win.addEventListener("pointerdown", onFirstPress, true);
  win.addEventListener("keydown", onFirstPress, true);
  const off = hub.subscribe(show);
  show();
  return () => {
    off();
    win.removeEventListener("popstate", onPop as (e: never) => void);
    win.removeEventListener("hashchange", onHash);
    win.removeEventListener("pointerdown", onFirstPress, true);
    win.removeEventListener("keydown", onFirstPress, true);
  };
}
