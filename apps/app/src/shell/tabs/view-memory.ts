// Back puts the page where it was (NAV-2026-11-14 rules 1, 5 and 7): going Back or Forward in a tab, and coming back to a tab, restores the scroll position of the page and of the place's list.
// One memory for the whole window, keyed by the tab and the address it shows, so no place keeps its own: the body's scrollers are remembered per tab and address; the sidebar's per tab (the list is the
// place's, not the item's). A scroller left at its end is remembered as "the end", so a chat that was following the latest message still follows it. Restoring waits for the content to be tall
// enough and gives up when the person scrolls, so it never fights a hand. Held for this session only.
const MAX_ADDRESSES = 200;
const END_SLACK = 24;
/** How long a returning view may take to fill before it is left alone. */
export const RESTORE_MS = 1500;

/** What was in view: the first thing at the top edge (by its test id) and how far from the edge it sat, so history that arrived above it since does not move the page. */
export interface Anchor {
  id: string;
  off: number;
}

export interface Where1 {
  /** Pixels from the top; -1 is "at the end". */
  y: number;
  anchor?: Anchor;
}

export interface Remembered {
  [slot: string]: Where1;
}

export interface ScrollerLike {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  getAttribute(name: string): string | null;
  closest(sel: string): unknown;
  getBoundingClientRect?(): { top: number; bottom: number };
  querySelectorAll?(
    sel: string,
  ): ArrayLike<{ getAttribute(n: string): string | null; getBoundingClientRect(): { top: number; bottom: number } }>;
  querySelector?(sel: string): { getBoundingClientRect(): { top: number; bottom: number } } | null;
}

/** The first thing with an id whose bottom edge is below the scroller's top edge: what the person is looking at first. */
function anchorOf(el: Partial<ScrollerLike>): Anchor | undefined {
  if (el.getBoundingClientRect === undefined || el.querySelectorAll === undefined) return undefined;
  const top = el.getBoundingClientRect().top;
  const all = el.querySelectorAll("[data-testid]");
  for (let i = 0; i < all.length && i < 4000; i++) {
    const c = all[i]!;
    const r = c.getBoundingClientRect();
    const id = c.getAttribute("data-testid");
    if (id !== null && id !== "" && r.bottom > top + 2) return { id, off: Math.round(r.top - top) };
  }
  return undefined;
}

const memory = new Map<string, Remembered>();

export function rememberScroll(
  key: string,
  slot: string,
  el: Pick<ScrollerLike, "scrollTop" | "scrollHeight" | "clientHeight"> & Partial<ScrollerLike>,
): void {
  const here = memory.get(key) ?? {};
  const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight <= END_SLACK;
  // a list that does not scroll at all has nothing to remember
  if (el.scrollHeight - el.clientHeight <= 1) delete here[slot];
  else if (atEnd) here[slot] = { y: -1 };
  else {
    const anchor = anchorOf(el);
    here[slot] = { y: Math.round(el.scrollTop), ...(anchor !== undefined ? { anchor } : {}) };
  }
  memory.delete(key);
  memory.set(key, here);
  while (memory.size > MAX_ADDRESSES) memory.delete(memory.keys().next().value as string);
}

export function recalled(key: string): Remembered | undefined {
  return memory.get(key);
}

export function forgetScrolls(): void {
  memory.clear();
}

/** The address a scroller belongs to: the body's per tab and item, the sidebar's per tab. */
export const bodyKey = (tab: string, hash: string): string => `${tab}|${hash}`;
export const sideKey = (tab: string): string => `${tab}|side`;

interface Doc {
  addEventListener(t: string, f: (e: never) => void, capture?: boolean): void;
  removeEventListener(t: string, f: (e: never) => void, capture?: boolean): void;
  querySelectorAll(sel: string): ArrayLike<ScrollerLike>;
}
interface Where {
  tab: string;
  hash: string;
}

/**
 * Watch the window. `where()` says which tab and address are showing; `subscribe` tells when that changes. A change restores what was remembered for the address that arrived; scrolling
 * records what the person sees (but not before they have touched the page: the first frames of a view that is filling in are the view's own doing, not theirs).
 */
export function startViewMemory(
  doc: Doc,
  where: () => Where,
  subscribe: (l: () => void) => () => void,
  o: { raf?: (f: () => void) => number; caf?: (id: number) => void; now?: () => number } = {},
): () => void {
  const raf =
    o.raf ?? ((f) => (globalThis as { requestAnimationFrame: (f: () => void) => number }).requestAnimationFrame(f));
  const caf =
    o.caf ?? ((id) => (globalThis as { cancelAnimationFrame: (id: number) => void }).cancelAnimationFrame(id));
  const now = o.now ?? Date.now;
  let current = { tab: "", hash: "" };
  let touched = false;
  let frame = 0;
  let stopRestore = (): void => undefined;

  const slotOf = (el: ScrollerLike): { region: "body" | "side"; slot: string } | null => {
    const region =
      el.closest('[data-testid="place-sidebar"]') !== null
        ? "side"
        : el.closest('[data-testid="place-body"]') !== null
          ? "body"
          : null;
    if (region === null) return null;
    const id = el.getAttribute("data-testid") ?? "scroll";
    const all = [...Array.from(doc.querySelectorAll(`[data-testid="${id}"]`))].filter((x) => slotRegion(x) === region);
    return { region, slot: `${id}#${Math.max(0, all.indexOf(el))}` };
  };
  const slotRegion = (el: ScrollerLike): "body" | "side" | null =>
    el.closest('[data-testid="place-sidebar"]') !== null
      ? "side"
      : el.closest('[data-testid="place-body"]') !== null
        ? "body"
        : null;

  const onScroll = (e: { target?: unknown }): void => {
    if (!touched) return;
    const el = e.target as ScrollerLike | null;
    if (el === null || el === undefined || typeof el.scrollTop !== "number" || el.closest === undefined) return;
    const at = slotOf(el);
    if (at === null) return;
    rememberScroll(at.region === "side" ? sideKey(current.tab) : bodyKey(current.tab, current.hash), at.slot, el);
  };
  const onTouch = (): void => {
    touched = true;
    stopRestore();
  };

  const restore = (): void => {
    stopRestore();
    const wanted: [string, Remembered][] = [];
    const b = recalled(bodyKey(current.tab, current.hash));
    const s = recalled(sideKey(current.tab));
    if (b !== undefined) wanted.push(["body", b]);
    if (s !== undefined) wanted.push(["side", s]);
    if (wanted.every(([, r]) => Object.values(r).every((w) => w.y === 0))) {
      touched = true;
      return;
    }
    const t0 = now();
    const until = t0 + RESTORE_MS;
    const held = new Map<string, { el: ScrollerLike; n: number }>();
    let live = true;
    const step = (): void => {
      if (!live) return;
      let open = false;
      for (const [region, r] of wanted) {
        for (const [slot, w] of Object.entries(r)) {
          if (w.y === 0) continue;
          const [id, nth] = slot.split("#") as [string, string];
          const els = Array.from(doc.querySelectorAll(`[data-testid="${id}"]`)).filter((x) => slotRegion(x) === region);
          const el = els[Number(nth)];
          if (el === undefined) {
            open = true;
            continue;
          }
          // what was at the top edge is put back at the same distance from it; a view that has not drawn that thing yet is held to the pixels it had, once it is tall enough
          // left at its end: it goes back to its end (a chat following the latest message, a list scrolled to the bottom)
          if (w.y < 0) {
            const to = el.scrollHeight - el.clientHeight;
            if (to > 1 && Math.abs(el.scrollTop - to) > 1) el.scrollTop = to;
            const h0 = held.get(slot);
            const n0 = h0 !== undefined && h0.el === el ? h0.n + 1 : 1;
            held.set(slot, { el, n: n0 });
            if (n0 < 30 || to <= 1) open = true;
            continue;
          }
          const mark =
            w.anchor !== undefined && el.querySelector !== undefined && el.getBoundingClientRect !== undefined
              ? el.querySelector(`[data-testid="${w.anchor.id.replace(/"/g, '\\"')}"]`)
              : null;
          let ok = false;
          if (mark !== null && mark !== undefined && el.getBoundingClientRect !== undefined) {
            const drift = mark.getBoundingClientRect().top - el.getBoundingClientRect().top - (w.anchor?.off ?? 0);
            if (Math.abs(drift) > 1) el.scrollTop = el.scrollTop + drift;
            ok = true;
          } else if ((w.anchor === undefined || now() - t0 > 600) && el.scrollHeight - el.clientHeight >= w.y - 1) {
            if (Math.abs(el.scrollTop - w.y) > 1) el.scrollTop = w.y;
            ok = true;
          }
          if (ok) {
            // the same scroller held where it was for half a second: the view is settled (an old view that is still drawn while the new one fills is a different scroller, and does not count)
            const h = held.get(slot);
            const n = h !== undefined && h.el === el ? h.n + 1 : 1;
            held.set(slot, { el, n });
            if (n < 30) open = true;
          } else open = true;
        }
      }
      if (open && now() < until) frame = raf(step);
      else touched = true;
    };
    frame = raf(step);
    stopRestore = () => {
      live = false;
      caf(frame);
    };
  };

  const changed = (): void => {
    const w = where();
    if (w.tab === current.tab && w.hash === current.hash) return;
    current = w;
    touched = false;
    restore();
  };
  current = where();
  touched = false;
  restore();
  const off = subscribe(changed);
  doc.addEventListener("scroll", onScroll as (e: never) => void, true);
  for (const t of ["wheel", "pointerdown", "touchstart", "keydown"])
    doc.addEventListener(t, onTouch as (e: never) => void, true);
  return () => {
    off();
    stopRestore();
    doc.removeEventListener("scroll", onScroll as (e: never) => void, true);
    for (const t of ["wheel", "pointerdown", "touchstart", "keydown"])
      doc.removeEventListener(t, onTouch as (e: never) => void, true);
  };
}
