// Where a popover of the composer goes. It opens upward; with no room above (a composer high in a short pane) its first rows were cut off by the pane, so "Upload files" could not be pressed (F32).
// With room above it stays above; else with room below it opens below; else it takes the larger side and scrolls inside it. The room is measured from the composer, not from the popover's own position
// (which is shifted a few pixels for the first frames of its entrance animation).
export const POP_GAP = 16; // the margin between composer and popover plus a margin to the pane's edge

export interface PopRoom {
  /** the popover's own height */
  height: number;
  /** the composer's top and bottom edges */
  anchorTop: number;
  anchorBottom: number;
  /** the pane's visible top and bottom */
  paneTop: number;
  paneBottom: number;
}

export function popPlacement(r: PopRoom): { side: "above" | "below"; maxHeight?: number } {
  const above = r.anchorTop - r.paneTop - POP_GAP;
  const below = r.paneBottom - r.anchorBottom - POP_GAP;
  if (r.height <= above) return { side: "above" };
  if (r.height <= below) return { side: "below" };
  return above >= below
    ? { side: "above", maxHeight: Math.max(0, above) }
    : { side: "below", maxHeight: Math.max(0, below) };
}

interface Box {
  parentElement?: unknown;
  getBoundingClientRect(): { top: number; bottom: number };
}
const clips = (el: unknown): boolean => {
  const g = globalThis as { getComputedStyle?: (e: unknown) => { overflowY: string; overflow: string } };
  const cs = g.getComputedStyle?.(el);
  return !!cs && /hidden|auto|scroll|clip/.test(`${cs.overflowY} ${cs.overflow}`);
};

/** The visible top and bottom of the nearest ancestor that clips what is drawn outside it, or of the window when none does. */
export function clipBox(node: unknown): { top: number; bottom: number } {
  const g = globalThis as { innerHeight?: number };
  let el = (node as Box | null)?.parentElement as Box | null | undefined;
  while (el) {
    if (clips(el)) {
      const b = el.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom };
    }
    el = el.parentElement as Box | null | undefined;
  }
  return { top: 0, bottom: g.innerHeight ?? 0 };
}
