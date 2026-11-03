// Notes, the keys: what a key does on a selected card, on the page, and over a layer (the opened note, the share sheet, a sheet). Arrows move by where the cards sit on screen, not by
// their order, because the grid is columns of different heights. No React here.

export interface KeyLike { key: string; shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }

export type CardAct =
  | { t: "move"; dir: Dir }
  | { t: "open" } | { t: "pin" } | { t: "labels" } | { t: "share" } | { t: "ask" } | { t: "task" } | { t: "record" } | { t: "delete" } | { t: "menu" };
export type Dir = "left" | "right" | "up" | "down";

const ARROWS: Readonly<Record<string, Dir>> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
const LETTERS: Readonly<Record<string, CardAct>> = { p: { t: "pin" }, l: { t: "labels" }, s: { t: "share" }, a: { t: "ask" }, t: { t: "task" }, r: { t: "record" } };

/** A key on a selected card: arrows move, Enter or Space opens, P L S A T R act, Delete or Backspace deletes, Shift F10 opens the note menu (ui/Menu's trigger also takes the menu key). */
export function cardKey(e: KeyLike): CardAct | null {
  const dir = ARROWS[e.key];
  if (dir && !e.metaKey && !e.ctrlKey && !e.altKey) return { t: "move", dir };
  if (e.key === "F10" && e.shiftKey) return { t: "menu" };
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  if (e.key === "Enter" || e.key === " ") return { t: "open" };
  if (e.key === "Delete" || e.key === "Backspace") return { t: "delete" };
  return e.key.length === 1 && !e.shiftKey ? LETTERS[e.key.toLowerCase()] ?? null : null;
}

export type PageAct = { t: "search" } | { t: "take" } | { t: "undo" };

/** A key on the page with no layer up and nothing being typed: / searches, C takes a note, Cmd-Z undoes a delete. */
export function pageKey(e: KeyLike, typing: boolean, canUndo: boolean): PageAct | null {
  const mod = e.metaKey === true || e.ctrlKey === true;
  if (mod && e.key.toLowerCase() === "z" && !e.shiftKey && !typing && canUndo) return { t: "undo" };
  if (typing || mod || e.altKey) return null;
  if (e.key === "/") return { t: "search" };
  if (e.key === "c" || e.key === "C") return e.shiftKey ? null : { t: "take" };
  return null;
}

/** What is open over the grid, top first. Esc closes the top one. */
export type Layer = "sheet" | "share" | "note" | "ask" | "take" | "bar";

/** Esc closes the top layer; Cmd-Enter makes the task or record in a sheet, or closes the opened note, or saves the bar. */
export function layerKey(e: KeyLike, top: Layer | null): "close" | "make" | null {
  if (top === null) return null;
  if (e.key === "Escape") return "close";
  if (e.key === "Enter" && (e.metaKey === true || e.ctrlKey === true)) return top === "sheet" ? "make" : top === "note" || top === "take" ? "close" : null;
  return null;
}

/** The top layer of what is open, in the order Esc peels them. */
export function topLayer(o: { sheet: boolean; share: boolean; note: boolean; take: boolean; ask: boolean; bar: boolean }, inAsk: boolean, inTake: boolean): Layer | null {
  if (o.sheet) return "sheet";
  if (o.share) return "share";
  if (o.note) return "note";
  if (o.take && inTake) return "take";
  if (o.ask && inAsk) return "ask";
  if (o.bar) return "bar";
  return null;
}

export interface Box { id: string; left: number; top: number; width: number; height: number }

/**
 * The card an arrow lands on, by geometry. Left and right take the nearest card whose centre is to that side, preferring the same height; up and down take the nearest card wholly above
 * or below, preferring the same column. Null at an edge.
 */
export function nearest(from: Box, all: readonly Box[], dir: Dir): string | null {
  const cx = from.left + from.width / 2, cy = from.top + from.height / 2;
  let best: string | null = null, bestD = Infinity;
  for (const b of all) {
    if (b.id === from.id) continue;
    const dx = b.left + b.width / 2 - cx, dy = b.top + b.height / 2 - cy;
    let ok = false, d = 0;
    if (dir === "right") { ok = dx > 20; d = dx + Math.abs(dy) * 2; }
    else if (dir === "left") { ok = dx < -20; d = -dx + Math.abs(dy) * 2; }
    else if (dir === "down") { ok = b.top >= from.top + from.height - 4; d = b.top - (from.top + from.height) + Math.abs(dx) * 3; }
    else { ok = b.top + b.height <= from.top + 4; d = from.top - (b.top + b.height) + Math.abs(dx) * 3; }
    if (ok && d < bestD) { bestD = d; best = b.id; }
  }
  return best;
}
