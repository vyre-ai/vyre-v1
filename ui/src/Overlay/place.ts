// Where a popover or card sits so it is always fully inside the window (owner, 5 Nov: the All agents card opened from a low sidebar row ran off the bottom of a 1440x900 window).
// One rule for every card that hangs under a control: its left edge follows the control and is kept `pad` inside both sides; its top is the control's bottom and, when the card is taller than
// the room below, it moves up until its bottom edge is `pad` inside the window; a card taller than the window gets a maximum height so it scrolls inside instead of leaving it.
// Before the card has been measured (height 0) only the maximum height is known, so the first frame cannot spill either.

export interface FitInput {
  /** The control's left edge and bottom edge, in window coordinates. */
  x: number;
  y: number;
  width: number;
  /** The card's measured height; 0 before it is measured. */
  height: number;
  viewW: number;
  viewH: number;
  pad?: number;
}

export interface Fit { left: number; top: number; maxHeight: number }

export function fitInViewport({ x, y, width, height, viewW, viewH, pad = 8 }: FitInput): Fit {
  const left = viewW > 0 ? Math.max(pad, Math.min(x, viewW - width - pad)) : x;
  if (viewH <= 0) return { left, top: y, maxHeight: 420 };
  const maxHeight = Math.max(120, viewH - 2 * pad);
  const h = Math.min(height, maxHeight);
  const top = Math.max(pad, Math.min(y, viewH - h - pad));
  return { left, top, maxHeight };
}
