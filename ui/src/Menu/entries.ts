// Helpers every per-kind menu builder uses: the separator, `tidy` (an item left out leaves no empty group) and `item`.
import type { MenuEntry, MenuItem } from "./index.tsx";

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
