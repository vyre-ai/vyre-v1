// The last places stay as they were left (r41). Going back to a place a person just came from used to make it again from nothing: its list, its open item, its scroll and what was typed
// were rebuilt and put back a frame or two later. Now the last KEPT_PLACES places of the open Space stay made. The one on screen is in the page; the others are held out of it, whole:
//   out of the page    each kept place is drawn into a box of its own (a portal), and the box is in the page only while the place is shown. A hidden place has nothing in the page: nothing
//                      to lay out or paint, and nothing a selector, a shortcut or a focus can find. Its list in the sidebar column and its panes at the sides are held in boxes the same way.
//   at rest            a hidden place runs no effects (React Activity): its live reads stop, its timers and key handlers are off. They start again when it is shown, and what changed
//                      meanwhile is read then, in place.
//   as it was          its state is untouched, and every scroll position is put back when it returns (a box out of the page loses them, so they are noted as the person scrolls).
// A Space switch forgets them all (the scope changes), as it always unmounted every place. With `keep` 1 nothing is kept and a place is made and unmade as before (the phone, a part drawn alone).
import { Activity, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { createPortal } from "react-dom";
import { View } from "react-native";
import { SheetHostProvider, useSheetHost } from "../../../../../ui/src/SidePane/host.tsx";
import { SidebarFrame } from "../sidebar/SidebarSlot.tsx";
import { RESTORE_EVENT } from "../tabs/view-memory.ts";

/** How many places of the open Space stay made, the one on screen among them. */
export const KEPT_PLACES = 5;

// What the rest of the shell may ask of the stack (the shell reads it in render and in a frame callback, so it is plain module state, written in a layout effect):
//   which places are made right now, and whether the place that has just come on screen was one of them (a return: it is revealed, not made).
const reg: { keys: readonly string[]; shown: string | null; revealed: boolean } = {
  keys: [],
  shown: null,
  revealed: false,
};
/** The place of this key (epoch:Space:place) is made and held out of the page: pressing it reveals it. */
export const isKeptPlace = (key: string): boolean => reg.keys.includes(key) && reg.shown !== key;
/** The place on screen came back from being kept: nothing is made for it, so no still copy of any page and no waiting frame stand in front of it. */
export const keptRevealed = (): boolean => reg.revealed;
/** For tests: forget what the stack told. */
export function resetKeptRegistryForTests(): void {
  reg.keys = [];
  reg.shown = null;
  reg.revealed = false;
}
/** Set on the page for a moment after a place was revealed from the kept ones: a probe (and a person debugging) can tell a return from a place made new. */
const REVEAL_ATTR = "data-kept-return";
let revealTimer: ReturnType<typeof setTimeout> | null = null;
function markReveal(on: boolean): void {
  const root = (
    globalThis as {
      document?: { documentElement?: { setAttribute(k: string, v: string): void; removeAttribute(k: string): void } };
    }
  ).document?.documentElement;
  if (!root) return;
  if (revealTimer !== null) clearTimeout(revealTimer);
  revealTimer = null;
  if (on) {
    root.setAttribute(REVEAL_ATTR, "1");
    revealTimer = setTimeout(() => root.removeAttribute(REVEAL_ATTR), 1500);
  } else root.removeAttribute(REVEAL_ATTR);
}
/** A scroll area this close to its end is following it (a chat's feed): it is put back at the end, wherever that is by then. */
const END_SLACK = 24;

interface Scrolled {
  top: number;
  left: number;
  atEnd: boolean;
}

/** A box that is in the page only while its place is shown. `display: contents` gives it no box of its own, so what is inside lies in the outlet exactly as it did when drawn there directly. */
export interface Box {
  el: HTMLElement;
  scroll: Map<Element, Scrolled>;
}

export function makeBox(): Box | null {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc || typeof doc.createElement !== "function") return null;
  const el = doc.createElement("div");
  el.style.display = "contents";
  const scroll = new Map<Element, Scrolled>();
  // scroll does not bubble, but it can be heard on the way down: every scroll area inside the box is noted as it moves
  el.addEventListener(
    "scroll",
    (e) => {
      const t = e.target as Element | null;
      if (!t || typeof (t as HTMLElement).scrollTop !== "number") return;
      const h = t as HTMLElement;
      if (h.scrollTop === 0 && h.scrollLeft === 0) scroll.delete(h);
      else
        scroll.set(h, {
          top: h.scrollTop,
          left: h.scrollLeft,
          atEnd: h.scrollHeight - h.scrollTop - h.clientHeight <= END_SLACK,
        });
    },
    true,
  );
  return { el, scroll };
}

/** Put every noted scroll area of a box back where it was. One that was following its end goes to the end; any other is told the move is the person's own first (tabs/view-memory.ts). */
export function restoreBox(box: Box): void {
  for (const [el, at] of box.scroll) {
    if (!box.el.contains(el)) {
      box.scroll.delete(el);
      continue;
    }
    const h = el as HTMLElement;
    try {
      if (at.atEnd) h.scrollTop = h.scrollHeight;
      else {
        if (typeof Event === "function") h.dispatchEvent(new Event(RESTORE_EVENT));
        h.scrollTop = at.top;
      }
      h.scrollLeft = at.left;
    } catch {
      /* a part that cannot scroll any more keeps where it is */
    }
  }
}

/**
 * A box of this frame: in the page (inside the node `where` names) while the frame is shown, out of it otherwise. `where` is asked when the frame is drawn, so it may name a node that
 * exists only once the frame has been drawn; `dep` says when to ask again. Null where there is no page to draw in.
 */
export function useBox(where: () => unknown, dep: unknown, active: boolean): Box | null {
  const [box] = useState(makeBox);
  useLayoutEffect(() => {
    const into = where() as { appendChild?(n: unknown): unknown } | null | undefined;
    if (!box || !active || !into || typeof into.appendChild !== "function") return undefined;
    into.appendChild(box.el);
    restoreBox(box);
    return () => {
      box.el.remove();
    };
  }, [box, dep, active]); // eslint-disable-line react-hooks/exhaustive-deps -- `where` reads a node; `dep` says when it changed
  return box;
}

function Frame({ active, node }: { active: boolean; node: ReactNode }): ReactElement | null {
  // what the place drew when it was last on screen: a hidden place keeps exactly that
  const last = useRef(node);
  if (active) last.current = node;
  // an unseen mark in the stage: the frame's box goes beside it, in the node the stage gives its place
  const anchor = useRef<{ parentElement?: unknown } | null>(null);
  const host = useSheetHost();
  const main = useBox(() => anchor.current?.parentElement ?? null, null, active);
  const left = useBox(() => host?.left ?? null, host?.left, active);
  const right = useBox(() => host?.right ?? null, host?.right, active);
  // a pane or a list of this place lands in this frame's own box inside the shell's outlet, once that outlet exists
  const sheets = useMemo(
    () =>
      host === null
        ? null
        : { ...host, left: host.left ? (left?.el ?? null) : null, right: host.right ? (right?.el ?? null) : null },
    [host, left, right],
  );
  // Where there is no real page (a part drawn on its own, a test with a stand-in document) the place is drawn where it stands, as it always was.
  const real = main !== null && (main.el as { nodeType?: number }).nodeType === 1;
  const inner = (
    <SidebarFrame active={active}>
      <Activity mode={active ? "visible" : "hidden"}>{last.current}</Activity>
    </SidebarFrame>
  );
  return (
    <>
      <View ref={anchor as never} style={HIDDEN} />
      {real
        ? createPortal(sheets === null ? inner : <SheetHostProvider value={sheets}>{inner}</SheetHostProvider>, main.el)
        : inner}
    </>
  );
}
const HIDDEN = { display: "none" } as const;

/** A hidden place is not drawn again while it stays hidden: it keeps what it last drew. */
const KeptFrame = memo(Frame, (a, b) => !a.active && !b.active);

/**
 * The places kept for one Space. `current` is the key of the one to show (null: none is on screen, a skeleton or a new tab is), `node` what it draws. `scope` names the Space and its sign-in:
 * when it changes every kept place is unmade.
 */
export function PlaceStack({
  scope,
  current,
  node,
  keep = KEPT_PLACES,
}: {
  scope: string;
  current: string | null;
  node: ReactNode;
  keep?: number;
}): ReactElement {
  const [held, setHeld] = useState<{ scope: string; keys: readonly string[] }>({
    scope,
    keys: current === null ? [] : [current],
  });
  // when each was last shown: the one shown longest ago is the first to go
  const shownAt = useRef(new Map<string, number>());
  const tick = useRef(0);
  let keys = held.scope === scope ? held.keys : [];
  if (current !== null && !keys.includes(current)) keys = [...keys, current];
  if (keys.length > keep) {
    const oldest = keys
      .filter((k) => k !== current)
      .sort((a, b) => (shownAt.current.get(a) ?? 0) - (shownAt.current.get(b) ?? 0))
      .slice(0, keys.length - keep);
    keys = keys.filter((k) => !oldest.includes(k));
  }
  const now = keys;
  // a place that was held before this pass and is the one to show now is revealed, not made
  // (the very first pass holds its own place from the start: that one was made, not kept)
  const first = useRef(true);
  const returned = !first.current && current !== null && held.scope === scope && held.keys.includes(current);
  useLayoutEffect(() => {
    first.current = false;
    reg.keys = now;
    if (current !== reg.shown) {
      reg.shown = current;
      reg.revealed = current !== null && returned;
      markReveal(reg.revealed);
    }
  });
  useEffect(
    () => () => {
      resetKeptRegistryForTests();
      markReveal(false);
    },
    [],
  );
  useEffect(() => {
    if (current !== null) shownAt.current.set(current, ++tick.current);
    if (held.scope !== scope || held.keys.length !== now.length || held.keys.some((k, i) => k !== now[i])) {
      for (const k of [...shownAt.current.keys()]) if (!now.includes(k)) shownAt.current.delete(k);
      setHeld({ scope, keys: now });
    }
  });
  return (
    <>
      {/* ui-rows-lint: not a list (the places kept made, one of them shown) */}
      {now.map((k) => (
        <KeptFrame key={k} active={k === current} node={k === current ? node : null} />
      ))}
    </>
  );
}
