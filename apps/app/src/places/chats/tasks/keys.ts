// Tasks, the keys on the Board and the Timeline: arrows move between cards and rows, Enter opens, Space or S changes status, Esc lets go. One card or row is the tab stop (a roving tabindex, the way
// the Notes grid does it), so Tab enters the board once and leaves it once. No React here.

export interface KeyLike { key: string; shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }
export type Dir = "up" | "down" | "left" | "right";
export type CardAct = { t: "move"; dir: Dir } | { t: "open" } | { t: "status" } | { t: "close" };

const ARROWS: Readonly<Record<string, Dir>> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

/** What a key does on a focused card or row. Anything with Cmd, Ctrl or Alt is left to the page. */
export function taskKey(e: KeyLike): CardAct | null {
  if (e.metaKey === true || e.ctrlKey === true || e.altKey === true) return null;
  const dir = ARROWS[e.key];
  if (dir) return { t: "move", dir };
  if (e.key === "Enter") return { t: "open" };
  if (e.key === " " || e.key === "Spacebar" || ((e.key === "s" || e.key === "S") && e.shiftKey !== true)) return { t: "status" };
  if (e.key === "Escape") return { t: "close" };
  return null;
}

/** Where an arrow lands on the board: up and down walk a column; left and right go to the next column that holds a card, at the same height or the last card there. Null at an edge. */
export function gridStep(cols: ReadonlyArray<readonly string[]>, at: string | null, dir: Dir): string | null {
  let c = -1, r = -1;
  if (at !== null) for (let i = 0; i < cols.length && c < 0; i++) { const j = cols[i]!.indexOf(at); if (j >= 0) { c = i; r = j; } }
  if (c < 0) return firstOf(cols);
  const col = cols[c]!;
  if (dir === "down") return col[r + 1] ?? null;
  if (dir === "up") return r > 0 ? col[r - 1] ?? null : null;
  const stepBy = dir === "right" ? 1 : -1;
  for (let i = c + stepBy; i >= 0 && i < cols.length; i += stepBy) { const other = cols[i]!; if (other.length > 0) return other[Math.min(r, other.length - 1)] ?? null; }
  return null;
}

/** Where an arrow lands in a plain list of rows: up and down only. */
export function rowStep(ids: readonly string[], at: string | null, dir: Dir): string | null {
  const i = at === null ? -1 : ids.indexOf(at);
  if (i < 0) return ids[0] ?? null;
  if (dir === "down") return ids[i + 1] ?? null;
  if (dir === "up") return i > 0 ? ids[i - 1] ?? null : null;
  return null;
}

export const firstOf = (cols: ReadonlyArray<readonly string[]>): string | null => { for (const c of cols) if (c.length > 0) return c[0]!; return null; };

/** The one card that takes Tab: the active one while it is still there, else the first. */
export function tabStop(cols: ReadonlyArray<readonly string[]>, active: string | null): string | null {
  if (active !== null && cols.some((c) => c.includes(active))) return active;
  return firstOf(cols);
}
