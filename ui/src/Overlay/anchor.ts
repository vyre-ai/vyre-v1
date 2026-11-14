// Where a card goes by the thing it was asked from: below it, flipped above when there is no room below, kept inside the window with a margin. Pure, so it is tested without a browser;
// the cards that use it are drawn in the Overlay layer (position fixed against the window), so the rectangle they are given is the window's own.
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface Size {
  width: number;
  height: number;
}

export const ANCHOR_MARGIN = 8;
export const ANCHOR_GAP = 6;

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(n, Math.max(lo, hi)));

/** The card's top-left corner: under the trigger (left edges aligned), or above it when it would not fit below and fits above; always inside the window by `margin`. */
export function placeNear(
  trigger: Box,
  card: Size,
  win: Size,
  margin: number = ANCHOR_MARGIN,
  gap: number = ANCHOR_GAP,
): { left: number; top: number; above: boolean } {
  const left = clamp(trigger.left, margin, win.width - card.width - margin);
  const below = trigger.bottom + gap;
  const fitsBelow = below + card.height <= win.height - margin;
  const aboveTop = trigger.top - gap - card.height;
  if (fitsBelow) return { left, top: below, above: false };
  if (aboveTop >= margin) return { left, top: aboveTop, above: true };
  return { left, top: clamp(below, margin, win.height - card.height - margin), above: false };
}

/**
 * Where a card goes BESIDE the thing it belongs to (a submenu next to its row): touching the trigger's right edge (or `gap` away) with its top lined up with the trigger's top. With no room on the right it flips
 * to the trigger's left edge; it shifts up only as far as it must to stay inside the window by `margin`.
 */
export function placeBeside(
  trigger: Box,
  card: Size,
  win: Size,
  margin: number = ANCHOR_MARGIN,
  gap = 0,
): { left: number; top: number; side: "right" | "left" } {
  const right = trigger.right + gap;
  const fitsRight = right + card.width <= win.width - margin;
  const leftSide = trigger.left - gap - card.width;
  const side = fitsRight || leftSide < margin ? "right" : "left";
  const left = side === "right" ? clamp(right, margin, win.width - card.width - margin) : leftSide;
  return { left, top: clamp(trigger.top, margin, win.height - card.height - margin), side };
}
