// The keys a menu item shows in its hint column, and what pressing one does: the item whose hint it is. One place, so every row menu in the app has the same keys (team/v1/CONTEXT-MENUS.md rule 4).
import type { MenuEntry, MenuItem } from "./props.ts";

/** The label a key press has in the hint column: "S", "U", "F2", "⌘⌫" (Cmd or Ctrl with Backspace) and so on; null for a key that is not a row key. */
export function keyLabel(e: { key?: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean }): string | null {
  const k = e.key ?? "";
  const mod = e.metaKey === true || e.ctrlKey === true;
  if (e.altKey === true || e.shiftKey === true) return null;
  if (mod) return k === "Enter" ? "\u2318\u21b5" : k === "Backspace" ? "\u2318\u232b" : k.toLowerCase() === "i" ? "\u2318I" : null;
  if (k === "F2") return "F2";
  return k.length === 1 && /[a-z]/i.test(k) ? k.toUpperCase() : null;
}

/** What a key does on a row: the menu item whose hint is that key (never the Enter row, which opens). Null when the menu has none. */
export function shortcutFor(entries: readonly MenuEntry[], e: Parameters<typeof keyLabel>[0]): MenuItem | null {
  const label = keyLabel(e);
  if (label === null) return null;
  for (const x of entries) if (!("separator" in x) && !("head" in x) && x.hint === label && x.onSelect && x.disabled !== true) return x;
  return null;
}
