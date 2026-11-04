// What every row menu shares: the keys shown in the hint column, the separator and `tidy` (an item left out leaves no empty group). The key logic that runs the item a key press names is ui/src/Menu/keys.ts.
import type { MenuEntry, MenuItem } from "../../../../../../ui/src/Menu/index.tsx";

export const KEY = { enter: "Enter", newTab: "⌘↵", rename: "F2", star: "S", unread: "U", archive: "E", remove: "⌘⌫", profile: "⌘I" } as const;

export const sep: MenuEntry = { separator: true };
/** Entries with each run of separators collapsed and none at the ends, so an item left out never leaves an empty group. */
export function tidy(list: readonly (MenuEntry | null | false | undefined)[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const e of list) {
    if (!e) continue;
    if ("separator" in e) { if (out.length > 0 && !("separator" in out[out.length - 1]!)) out.push(e); continue; }
    out.push(e);
  }
  while (out.length > 0 && "separator" in out[out.length - 1]!) out.pop();
  return out;
}
export const item = (label: string, onSelect: () => void, o: Partial<MenuItem> = {}): MenuItem => ({ label, onSelect, ...o });
export { keyLabel, shortcutFor } from "../../../../../../ui/src/Menu/keys.ts";
