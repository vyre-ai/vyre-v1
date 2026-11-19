// Where the agent last acted on a page, in the page's own pixels (the viewport), for the desk's cursor (lane r42-computer): the point it moved to, the box of the element it chose when it named one, and what
// it was doing. `seq` counts the actions, so a viewer draws each once. Never the text of a field and never a value: the label is the element's own visible name, cut to 60 characters.
export interface Pointer {
  seq: number;
  tool: string;
  x: number;
  y: number;
  box?: { x: number; y: number; w: number; h: number };
  label?: string;
  at: number;
}
interface Chosen {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

export function createPointerNote(now: () => number = Date.now): {
  /** The tool now running (set at the start of each browser tool). */
  during(tool: string): void;
  /** The element a tool chose, before it presses (its box in page pixels and its visible name). */
  chose(box: Chosen): void;
  /** The agent pressed or moved at this point: one more action. The chosen element's box rides along only when the point is its centre (within 2 px), so a coordinate click never borrows another element's box. */
  at(x: number, y: number): void;
  get(): Pointer | null;
} {
  let seen: Pointer | null = null;
  let seq = 0;
  let next: Chosen | null = null;
  let tool = "";
  return {
    during(t) {
      tool = t;
    },
    chose(box) {
      next = box;
    },
    at(x, y) {
      seq += 1;
      const near = next !== null && Math.abs(next.x + next.w / 2 - x) <= 2 && Math.abs(next.y + next.h / 2 - y) <= 2;
      seen = {
        seq,
        tool,
        x,
        y,
        at: now(),
        ...(near && next
          ? {
              box: { x: next.x, y: next.y, w: next.w, h: next.h },
              ...(next.label ? { label: next.label.slice(0, 60) } : {}),
            }
          : {}),
      };
      next = null;
    },
    get: () => seen,
  };
}
