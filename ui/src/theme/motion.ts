// One motion set for the whole app (owner, 2 Nov 2026: calm, stable, nothing blinks). Hover 120 ms, fades 160 ms, panels 220 ms, one ease, no bounce. A tab or place change holds the old view until the new
// one is drawn, then cuts to it in one frame (15 Nov 2026: the 140 ms crossfade showed both views at once). No looping
// animation except real live work, and prefers-reduced-motion turns all of it off. The rules go in through the sheet (injectCss) so the packaged app's style nonce does not drop them.
import { injectCss } from "./css.ts";

export const MOTION = { hover: 120, fade: 160, panel: 220, swap: 140, ease: "cubic-bezier(.2,.8,.2,1)" } as const;
/** Loading says nothing for this long; after it, one quiet sign. */
export const QUIET_MS = 300;

export const MOTION_CSS = [
  `:root{--motion-hover:${MOTION.hover}ms;--motion-fade:${MOTION.fade}ms;--motion-panel:${MOTION.panel}ms;--motion-ease:${MOTION.ease}}`,
  "html,body{background:var(--rail)}",
  `@keyframes vyre-in{from{opacity:0}to{opacity:1}}`,
  `[data-fade-in]{animation:vyre-in ${MOTION.fade}ms ${MOTION.ease}}`,
  `[data-quiet]{animation:vyre-in ${MOTION.fade}ms ${MOTION.ease}}`,
  `@keyframes vyre-panel{from{max-width:0;opacity:0}to{max-width:1200px;opacity:1}}`,
  `[data-panel-in]{animation:vyre-panel ${MOTION.panel}ms ${MOTION.ease}}`,
  `.vyre-row{transition:background-color ${MOTION.hover}ms ${MOTION.ease}}`,
  `[data-swap]{position:absolute;inset:0;z-index:40;pointer-events:none;overflow:hidden;transition:opacity ${MOTION.swap}ms ${MOTION.ease}}`,
  "@media (prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}",
].join("\n");

export function installMotion(doc: Parameters<typeof injectCss>[0]): void {
  injectCss(doc, "vyre-ui-motion", MOTION_CSS);
}

interface El {
  cloneNode(deep: boolean): El;
  querySelectorAll(q: string): ArrayLike<{ scrollTop: number; scrollLeft: number }>;
  setAttribute(k: string, v: string): void;
  removeAttribute(k: string): void;
  remove(): void;
  style: { opacity: string };
  appendChild(n: El): unknown;
  addEventListener?(t: string, f: () => void, o?: unknown): void;
  scrollTop: number;
  scrollLeft: number;
  offsetParent?: unknown;
  getBoundingClientRect?(): { width: number };
}
/** What the page keeps while the next view gets ready: a still copy of what was on screen, scroll positions kept, drawn over the live view. */
export interface Swap {
  fade(): void;
  drop(): void;
}

/** Puts a still copy of `el` over it. The live view changes under it; `fade` lets it go in one 140 ms fade, so there is never a blank frame and never a slide. Null when there is nothing to copy. */
export function holdView(el: unknown, host: unknown): Swap | null {
  const from = el as El | null,
    on = host as El | null;
  if (!from || !on || typeof from.cloneNode !== "function") return null;
  // A copy still fading from the last swap goes now: the new copy would otherwise contain it, and each quick Back or Forward would copy every copy before it (the cost doubled with each step
  // until the page stopped answering). What the old copy was covering is on screen under it already, so removing it only finishes the reveal.
  for (const old of Array.from(on.querySelectorAll("[data-swap]") as unknown as ArrayLike<{ remove(): void }>))
    old.remove();
  const copy = from.cloneNode(true);
  const a = from.querySelectorAll("*"),
    b = copy.querySelectorAll("*");
  for (let i = 0; i < a.length && i < b.length; i++) {
    const x = a[i]!,
      y = b[i]!;
    if (x.scrollTop !== 0 || x.scrollLeft !== 0) {
      y.scrollTop = x.scrollTop;
      y.scrollLeft = x.scrollLeft;
    }
  }
  copy.removeAttribute("data-testid");
  for (const n of Array.from(
    copy.querySelectorAll("[data-testid]") as unknown as ArrayLike<{ removeAttribute(k: string): void }>,
  ))
    n.removeAttribute("data-testid");
  copy.setAttribute("data-swap", "1");
  copy.setAttribute("aria-hidden", "true");
  on.appendChild(copy);
  for (let i = 0; i < a.length && i < b.length; i++) {
    const x = a[i]!,
      y = b[i]!;
    if (x.scrollTop !== 0 || x.scrollLeft !== 0) {
      y.scrollTop = x.scrollTop;
      y.scrollLeft = x.scrollLeft;
    }
  }
  let gone = false;
  const drop = (): void => {
    if (!gone) {
      gone = true;
      copy.remove();
    }
  };
  return {
    drop,
    // The copy leaves in one frame, not in a fade. A fade draws the old view and the new one on top of each other for its whole length, and when the two are laid out
    // differently (a place with another sidebar, another tab selected) the person sees both at once: two tab strips, two bodies (owner, 15 Nov 2026: "like blinking when you
    // switch the tabs"; measured in team/v1/TABS-2026-11-15.md). The new view is already drawn under the copy, so letting go at once is a clean cut between two finished views.
    fade: () => {
      if (gone) return;
      drop();
    },
  };
}

/** A still copy of a view as it looked, kept off the page: what a tab showed when it was left, to show again at once when the tab is chosen (showKept). */
export interface Kept {
  node: unknown;
  /** where each scrolled part stood: its place among the copy's parts, then top and left */
  scroll: readonly (readonly [number, number, number])[];
}

/** Copies `el` as it looks now. Null when there is nothing to copy, or when a still copy lies over it (a copy is never made of a copy). */
export function keepView(el: unknown): Kept | null {
  const from = el as (El & { querySelector?(q: string): unknown }) | null;
  if (!from || typeof from.cloneNode !== "function") return null;
  if (from.querySelector?.("[data-swap]")) return null;
  const copy = from.cloneNode(true);
  const a = from.querySelectorAll("*");
  const scroll: [number, number, number][] = [];
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    if (x.scrollTop !== 0 || x.scrollLeft !== 0) scroll.push([i, x.scrollTop, x.scrollLeft]);
  }
  copy.removeAttribute("data-testid");
  for (const n of Array.from(
    copy.querySelectorAll("[data-testid]") as unknown as ArrayLike<{ removeAttribute(k: string): void }>,
  ))
    n.removeAttribute("data-testid");
  copy.setAttribute("data-swap", "1");
  copy.setAttribute("aria-hidden", "true");
  return { node: copy, scroll };
}

/**
 * Puts a kept copy over `host` (its own view, as it was when it was left). The live view is made under it and `fade` lets the copy go in one frame, as holdView
 * does. `background` is painted behind the copy so the live view never shows through it.
 */
export function showKept(kept: Kept, host: unknown, background?: string): Swap | null {
  const on = host as El | null;
  const copy = kept.node as (El & { style: { opacity: string; backgroundColor?: string } }) | null;
  if (!on || !copy || typeof on.appendChild !== "function") return null;
  for (const old of Array.from(on.querySelectorAll("[data-swap]") as unknown as ArrayLike<{ remove(): void }>))
    old.remove();
  if (background !== undefined && background !== "") copy.style.backgroundColor = background;
  on.appendChild(copy);
  const b = copy.querySelectorAll("*");
  for (const [i, top, left] of kept.scroll) {
    const y = b[i];
    if (y) {
      y.scrollTop = top;
      y.scrollLeft = left;
    }
  }
  let gone = false;
  const drop = (): void => {
    if (!gone) {
      gone = true;
      copy.remove();
    }
  };
  return { drop, fade: drop };
}
