// The keyboard of the new Chats sidebar's list (design 13 Nov, 2.6): which key is which action while the list has the keyboard. Pure; the list runs the action.
// The Menu key, Shift-F10 and the letters of a row's menu (P, U, M, E, F2, Cmd-Backspace, Cmd-I) are run by the row's own menu (ui/Menu/context.tsx) before this sees the key; what is left over is here. The keys the shell owns
// (Cmd-N, Option-Cmd-1..5, Cmd-Shift-backslash) are in shell/keyboard/map.ts, one table.
import type { LayoutEntry } from "./layout.ts";

export interface ListKey {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

export type ListAction =
  | { do: "move"; to: "up" | "down" | "home" | "end" }
  | { do: "enter" }
  | { do: "openTab" }
  | { do: "fold" }
  | { do: "unfold" }
  | { do: "toHead" }
  | { do: "escape" }
  | { do: "filter" }
  | { do: "copyLink" }
  /** Cmd-1 to Cmd-9: open the nth pinned row. */
  | { do: "pinned"; n: number }
  | { do: "unread"; dir: 1 | -1 }
  /** A letter typed on the list: the command bar opens with it. */
  | { do: "search"; text: string };

type At = Pick<LayoutEntry, "type"> & { folded?: boolean };

/**
 * What a key does on the list. `at` is the entry under the cursor (null when none). Left on a row goes to its head; Left on an open head folds it; Right on a folded head unfolds it; Enter on a head folds or
 * unfolds, on "N more" opens it in place, on an error row retries (the list decides by the entry's type).
 */
export function listKey(e: ListKey, at: At | null, mac: boolean): ListAction | null {
  const mod = mac ? e.metaKey === true : e.ctrlKey === true;
  const other = mac ? e.ctrlKey === true : e.metaKey === true;
  const k = e.key;
  if (e.altKey === true && !mod && e.shiftKey === true && (k === "ArrowDown" || k === "ArrowUp"))
    return { do: "unread", dir: k === "ArrowDown" ? 1 : -1 };
  if (mod && !other && !e.altKey) {
    const digit = /^Digit([1-9])$/.exec(e.code ?? "")?.[1] ?? (/^[1-9]$/.test(k) ? k : null);
    if (digit !== null && e.shiftKey !== true) return { do: "pinned", n: Number(digit) };
    if (k === "Enter") return { do: "openTab" };
    if (e.shiftKey === true && k.toLowerCase() === "c") return { do: "copyLink" };
    return null;
  }
  if (mod || other || e.altKey === true) return null;
  if (e.shiftKey === true && k !== "?") return k.length === 1 ? { do: "search", text: k } : null;
  switch (k) {
    case "ArrowDown":
      return { do: "move", to: "down" };
    case "ArrowUp":
      return { do: "move", to: "up" };
    case "Home":
      return { do: "move", to: "home" };
    case "End":
      return { do: "move", to: "end" };
    case "Enter":
      return { do: "enter" };
    case "Escape":
      return { do: "escape" };
    case "ArrowLeft":
      return at?.type === "head" && at.folded !== true ? { do: "fold" } : { do: "toHead" };
    case "ArrowRight":
      return at?.type === "head" && at.folded === true ? { do: "unfold" } : null;
    case " ":
      return at?.type === "head" ? (at.folded === true ? { do: "unfold" } : { do: "fold" }) : null;
    case "f":
    case "F":
      return { do: "filter" };
  }
  return k.length === 1 && /\S/.test(k) ? { do: "search", text: k } : null;
}

/** The entries the arrow keys land on, in order: every row, head, "N more" and the Tasks row; never a skeleton, an error or the empty line. */
export const LANDS_ON: readonly LayoutEntry["type"][] = ["tasks", "row", "head", "more", "less"];

/** The key after a move: Up and Down by one, Home and End to the ends, staying put at an end. `from` is the key under the cursor, or null when the cursor is not on the list yet. */
export function moveKey(
  keys: readonly string[],
  from: string | null,
  to: "up" | "down" | "home" | "end",
): string | null {
  if (keys.length === 0) return null;
  if (to === "home") return keys[0]!;
  if (to === "end") return keys[keys.length - 1]!;
  const at = from === null ? -1 : keys.indexOf(from);
  if (at < 0) return to === "down" ? keys[0]! : keys[keys.length - 1]!;
  return keys[Math.max(0, Math.min(keys.length - 1, at + (to === "down" ? 1 : -1)))]!;
}

/** The head a row belongs to: the nearest head above it in the entries ("Left on a row goes to its head"). Null for the Tasks row and the rows of Needs you, which have none. */
export function headOf(entries: readonly LayoutEntry[], key: string): string | null {
  const i = entries.findIndex((e) => e.key === key);
  for (let n = i - 1; n >= 0; n--) if (entries[n]!.type === "head") return entries[n]!.key;
  return null;
}
