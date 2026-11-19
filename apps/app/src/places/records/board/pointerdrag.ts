// One drag for mouse, touch and pen: pointer events. A mouse or pen lifts the card after it has moved a few pixels; a finger lifts it after a short hold (so a swipe still scrolls). The lifted
// card is a tilted copy that follows the pointer, the lane under it is found by its `data-lane`, and letting go drops it. Escape puts it down. The board's own hooks do the rest (the
// move machine decides what a drop means), so this file knows nothing about cards or stages.

export interface PointerStart {
  pointerType: string;
  pointerId: number;
  clientX: number;
  clientY: number;
  button?: number;
}

export interface DragHooks {
  lift(): void;
  /** The lane key under the pointer, or null over nothing. Called only when it changes. */
  over(lane: string | null): void;
  drop(): void;
  /** The pointer is up or the drag was cancelled: whatever was lifted is put down. */
  end(): void;
  cancel(): void;
}

interface El {
  cloneNode(deep: boolean): unknown;
  getBoundingClientRect(): { width: number; height: number };
}
export interface Win {
  addEventListener(type: string, fn: (e: never) => void, opts?: unknown): void;
  removeEventListener(type: string, fn: (e: never) => void, opts?: unknown): void;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
  document: {
    body: { appendChild(n: unknown): void };
    elementFromPoint(x: number, y: number): { closest(sel: string): { dataset: { lane?: string } } | null } | null;
  };
}

export const MOUSE_SLOP = 5;
export const TOUCH_SLOP = 8;
export const HOLD_MS = 250;

interface Ev {
  pointerId?: number;
  clientX?: number;
  clientY?: number;
  key?: string;
  preventDefault?: () => void;
}

/** Starts watching one pointer that went down on a card. Returns a function that abandons the watch. */
export function beginPointerDrag(
  start: PointerStart,
  card: El,
  hooks: DragHooks,
  win: Win = globalThis as unknown as Win,
): () => void {
  const touch = start.pointerType === "touch";
  let active = false;
  let done = false;
  let lane: string | null = null;
  let timer: number | null = null;
  let ghost: { style: Record<string, string>; remove?: () => void } | null = null;
  const w = card.getBoundingClientRect().width;
  const place = (x: number, y: number): void => {
    if (ghost) {
      ghost.style["left"] = `${x - w / 2}px`;
      ghost.style["top"] = `${y - 22}px`;
    }
  };
  const block = (e: Ev): void => e.preventDefault?.();
  const laneAt = (x: number, y: number): string | null => {
    const hit = win.document.elementFromPoint(x, y)?.closest("[data-lane]");
    return hit && typeof hit.dataset.lane === "string" ? hit.dataset.lane : null;
  };
  const activate = (): void => {
    if (active || done) return;
    active = true;
    hooks.lift();
    const g = card.cloneNode(true) as { style: Record<string, string>; remove?: () => void };
    Object.assign(g.style, {
      position: "fixed",
      zIndex: "50",
      width: `${w}px`,
      pointerEvents: "none",
      transform: "rotate(2.2deg) scale(1.03)",
      boxShadow: "var(--sh-pop)",
      borderRadius: "12px",
    });
    win.document.body.appendChild(g);
    ghost = g;
    place(start.clientX, start.clientY);
    // a finger that has lifted a card must not also scroll the board
    win.addEventListener("touchmove", block as never, { passive: false });
  };
  const stop = (): void => {
    done = true;
    if (timer !== null) win.clearTimeout(timer);
    win.removeEventListener("pointermove", move as never);
    win.removeEventListener("pointerup", up as never);
    win.removeEventListener("pointercancel", cancel as never);
    win.removeEventListener("keydown", key as never);
    win.removeEventListener("touchmove", block as never);
    ghost?.remove?.();
    ghost = null;
  };
  const move = (e: Ev): void => {
    if (e.pointerId !== start.pointerId || done) return;
    const x = e.clientX ?? 0;
    const y = e.clientY ?? 0;
    const dist = Math.abs(x - start.clientX) + Math.abs(y - start.clientY);
    if (!active) {
      // a finger that moves before the hold is a swipe: the card stays
      if (touch) {
        if (dist > TOUCH_SLOP) stop();
        return;
      }
      if (dist < MOUSE_SLOP) return;
      activate();
    }
    place(x, y);
    const l = laneAt(x, y);
    if (l !== lane) {
      lane = l;
      hooks.over(l);
    }
  };
  const up = (e: Ev): void => {
    if (e.pointerId !== start.pointerId || done) return;
    const was = active;
    stop();
    if (!was) return;
    // the press that ended a drag is not a click on the card
    const swallow = (c: Ev): void => {
      c.preventDefault?.();
      (c as { stopPropagation?: () => void }).stopPropagation?.();
      win.removeEventListener("click", swallow as never, true);
    };
    win.addEventListener("click", swallow as never, true);
    win.setTimeout(() => win.removeEventListener("click", swallow as never, true), 0);
    hooks.over(lane);
    hooks.drop();
    hooks.end();
  };
  const cancel = (): void => {
    const was = active;
    stop();
    if (was) {
      hooks.cancel();
      hooks.end();
    }
  };
  const key = (e: Ev): void => {
    if (e.key === "Escape") cancel();
  };
  win.addEventListener("pointermove", move as never);
  win.addEventListener("pointerup", up as never);
  win.addEventListener("pointercancel", cancel as never);
  win.addEventListener("keydown", key as never);
  if (touch) timer = win.setTimeout(activate, HOLD_MS);
  return cancel;
}
