// One motion set for the whole app (owner, 2 Nov 2026: calm, stable, nothing blinks). Hover 120 ms, fades 160 ms, panels 220 ms, one ease, no bounce. A tab or place change is one 140 ms crossfade. No looping
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

interface El { cloneNode(deep: boolean): El; querySelectorAll(q: string): ArrayLike<{ scrollTop: number; scrollLeft: number }>; setAttribute(k: string, v: string): void; removeAttribute(k: string): void; remove(): void; style: { opacity: string }; appendChild(n: El): unknown; addEventListener?(t: string, f: () => void, o?: unknown): void; scrollTop: number; scrollLeft: number; offsetParent?: unknown; getBoundingClientRect?(): { width: number } }
/** What the page keeps while the next view gets ready: a still copy of what was on screen, scroll positions kept, drawn over the live view. */
export interface Swap { fade(): void; drop(): void }

/** Puts a still copy of `el` over it. The live view changes under it; `fade` lets it go in one 140 ms fade, so there is never a blank frame and never a slide. Null when there is nothing to copy. */
export function holdView(el: unknown, host: unknown): Swap | null {
  const from = el as El | null, on = host as El | null;
  if (!from || !on || typeof from.cloneNode !== "function") return null;
  const copy = from.cloneNode(true);
  const a = from.querySelectorAll("*"), b = copy.querySelectorAll("*");
  for (let i = 0; i < a.length && i < b.length; i++) { const x = a[i]!, y = b[i]!; if (x.scrollTop !== 0 || x.scrollLeft !== 0) { y.scrollTop = x.scrollTop; y.scrollLeft = x.scrollLeft; } }
  copy.removeAttribute("data-testid");
  for (const n of Array.from(copy.querySelectorAll("[data-testid]") as unknown as ArrayLike<{ removeAttribute(k: string): void }>)) n.removeAttribute("data-testid");
  copy.setAttribute("data-swap", "1");
  copy.setAttribute("aria-hidden", "true");
  on.appendChild(copy);
  for (let i = 0; i < a.length && i < b.length; i++) { const x = a[i]!, y = b[i]!; if (x.scrollTop !== 0 || x.scrollLeft !== 0) { y.scrollTop = x.scrollTop; y.scrollLeft = x.scrollLeft; } }
  let gone = false;
  const drop = (): void => { if (!gone) { gone = true; copy.remove(); } };
  return {
    drop,
    fade: () => {
      if (gone) return;
      copy.style.opacity = "0";
      setTimeout(drop, MOTION.swap + 40);
    },
  };
}
