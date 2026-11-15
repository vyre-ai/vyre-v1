// How the person asked for the press that is opening something (tabs/open-rule.ts decides what that means). Every place opens through ShellRuntime.open, and none of them reads the keyboard:
// this file watches the press itself, once, for the whole window. Cmd-press (Ctrl on Windows and Linux) and the middle button ask for a new tab beside this one that is shown; with Shift, one
// left behind. A menu's "Open in new tab" asks the same way through openIn(). The ask is taken by the next open and ends after a second, so a press that opens nothing never changes a later open.
import type { OpenHow } from "./open-rule.ts";

const ASK_MS = 1000;
let asked: { how: Exclude<OpenHow, "here">; at: number } | null = null;

/** Run `fn` (which opens something) as a new tab: "tab" shows it, "behind" leaves the person where they are. Row menus use this for "Open in new tab". */
export function openIn(how: Exclude<OpenHow, "here">, fn: () => void, now: () => number = Date.now): void {
  asked = { how, at: now() };
  try {
    fn();
  } finally {
    // an open that waits for the server (a read first) still finds the ask; one that opened nothing lets it lapse
  }
}

/** The ask the open in hand carries, once. "here" when there is none or it lapsed. */
export function takeOpenHow(now: () => number = Date.now): OpenHow {
  const a = asked;
  asked = null;
  return a !== null && now() - a.at <= ASK_MS ? a.how : "here";
}

/** For tests. */
export function forgetOpenHow(): void {
  asked = null;
}

interface PressLike {
  button?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  target?: unknown;
  preventDefault?(): void;
}
interface Doc {
  addEventListener(t: string, f: (e: never) => void, capture?: boolean): void;
  removeEventListener(t: string, f: (e: never) => void, capture?: boolean): void;
}

/** The ask a press carries: Cmd or Ctrl asks for a tab (with Shift, behind); the middle button the same; any other press asks for nothing. */
export function howOfPress(e: Pick<PressLike, "button" | "metaKey" | "ctrlKey" | "shiftKey">): OpenHow {
  const mod = e.metaKey === true || e.ctrlKey === true;
  if (!mod && e.button !== 1) return "here";
  return e.shiftKey === true ? "behind" : "tab";
}

const isLink = (t: unknown): boolean => {
  let el = t as { tagName?: string; parentElement?: unknown } | null;
  for (let i = 0; el !== null && el !== undefined && i < 12; i++) {
    if (el.tagName === "A" && (el as { href?: string }).href) return true;
    el = el.parentElement as typeof el;
  }
  return false;
};

/** Watch presses for the whole window. Returns the stop. */
export function startOpenHow(doc: Doc, now: () => number = Date.now): () => void {
  const onClick = (e: PressLike): void => {
    const how = howOfPress(e);
    asked = how === "here" ? null : { how, at: now() };
  };
  // the middle button fires no click: take its press, and press the same thing again as a click that asks for a tab (an address in the page keeps the browser's own middle-press)
  const onDown = (e: PressLike): void => {
    if (e.button === 1 && !isLink(e.target)) e.preventDefault?.();
  };
  const onAux = (e: PressLike): void => {
    if (e.button !== 1 || isLink(e.target)) return;
    e.preventDefault?.();
    asked = { how: e.shiftKey === true ? "behind" : "tab", at: now() };
    (e.target as { click?: () => void } | null)?.click?.();
  };
  doc.addEventListener("click", onClick as (e: never) => void, true);
  doc.addEventListener("mousedown", onDown as (e: never) => void, true);
  doc.addEventListener("auxclick", onAux as (e: never) => void, true);
  return () => {
    doc.removeEventListener("click", onClick as (e: never) => void, true);
    doc.removeEventListener("mousedown", onDown as (e: never) => void, true);
    doc.removeEventListener("auxclick", onAux as (e: never) => void, true);
  };
}
