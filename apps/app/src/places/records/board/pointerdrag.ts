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

let current: (() => void) | null = null;

/** Something that scrolls: the board across its lanes, or a lane down its cards. */
export interface Scroller {
  scrollLeft: number;
  scrollTop: number;
  getBoundingClientRect(): { left: number; right: number; top: number; bottom: number };
}
export interface Scrollers {
  /** The board's own horizontal scroller. */
  across(): Scroller | null;
  /** The scroller of the lane under the pointer. */
  down(x: number, y: number): Scroller | null;
}
export const EDGE = 64;
export const MAX_STEP = 22;
const TICK_MS = 16;

/** How far to scroll this tick: nothing away from the edge, growing the nearer the pointer is to it (and past it). Negative is towards the start. */
export function edgeStep(pos: number, lo: number, hi: number): number {
  if (pos < lo + EDGE) return -Math.min(MAX_STEP, Math.ceil((MAX_STEP * (lo + EDGE - pos)) / EDGE));
  if (pos > hi - EDGE) return Math.min(MAX_STEP, Math.ceil((MAX_STEP * (pos - (hi - EDGE))) / EDGE));
  return 0;
}

export const MOUSE_SLOP = 5;
export const TOUCH_SLOP = 8;
export const HOLD_MS = 250;

interface Ev {
  buttons?: number;
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
  scrollers?: Scrollers,
): () => void {
  // one drag at a time: a second finger, or a pen beside a mouse, does not start another
  if (current) return () => undefined;
  const touch = start.pointerType === "touch";
  let active = false;
  let done = false;
  let lane: string | null = null;
  let timer: number | null = null;
  let tick: number | null = null;
  let lx = start.clientX;
  let ly = start.clientY;
  let ghost: { style: Record<string, string>; remove?: () => void } | null = null;
  const w = card.getBoundingClientRect().width;
  const place = (x: number, y: number): void => {
    if (ghost) {
      ghost.style["left"] = `${x - w / 2}px`;
      ghost.style["top"] = `${y - 22}px`;
    }
  };
  // registered when the finger goes down (a listener added in the middle of a gesture cannot stop the pan): it only blocks once the card is lifted, so a swipe before the hold still scrolls
  const block = (e: Ev): void => {
    if (active) e.preventDefault?.();
  };
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
  };
  // while a card is held near an edge the board scrolls on its own, faster the nearer the edge
  const scrollTick = (): void => {
    tick = null;
    if (!active || done || !scrollers) return;
    let moved = false;
    const a = scrollers.across();
    if (a) {
      const r = a.getBoundingClientRect();
      const d = edgeStep(lx, r.left, r.right);
      if (d !== 0) {
        a.scrollLeft += d;
        moved = true;
      }
    }
    const v = scrollers.down(lx, ly);
    if (v) {
      const r = v.getBoundingClientRect();
      const d = edgeStep(ly, r.top, r.bottom);
      if (d !== 0) {
        v.scrollTop += d;
        moved = true;
      }
    }
    // what is under the pointer changed with the scroll
    if (moved) {
      const l = laneAt(lx, ly);
      if (l !== lane) {
        lane = l;
        hooks.over(l);
      }
    }
    tick = win.setTimeout(scrollTick, TICK_MS);
  };
  const stop = (): void => {
    done = true;
    if (tick !== null) win.clearTimeout(tick);
    current = null;
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
    // the button was let go outside the window and the browser never said so
    if (!touch && e.buttons === 0) return cancel();
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
    lx = x;
    ly = y;
    if (tick === null && scrollers) tick = win.setTimeout(scrollTick, TICK_MS);
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
  if (touch) {
    win.addEventListener("touchmove", block as never, { passive: false });
    timer = win.setTimeout(activate, HOLD_MS);
  }
  current = cancel;
  return cancel;
}
