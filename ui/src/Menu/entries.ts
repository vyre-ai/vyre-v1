// Helpers every per-kind menu builder uses: the separator, `tidy` (an item left out leaves no empty group) and `item`.
import type { MenuEntry, MenuItem } from "./index.tsx";
import { isHead, isItem, isSeparator } from "./props.ts";

export const sep: MenuEntry = { separator: true };
/** Entries with each run of separators collapsed and none at the ends, so an item left out never leaves an empty group. */
export function tidy(list: readonly (MenuEntry | null | false | undefined)[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const e of list) {
    if (!e) continue;
    if ("separator" in e) {
      if (out.length > 0 && !("separator" in out[out.length - 1]!)) out.push(e);
      continue;
    }
    out.push(e);
  }
  while (out.length > 0 && "separator" in out[out.length - 1]!) out.pop();
  return out;
}
export const item = (label: string, onSelect: () => void, o: Partial<MenuItem> = {}): MenuItem => ({
  label,
  onSelect,
  ...o,
});

/** A menu that asks before something destructive: it opens with a head that asks a question ("Delete Ember? Its chats stay.") and has a `danger` item. */
export function isAsk(entries: readonly MenuEntry[]): boolean {
  // a short menu with no groups: a menu with separators (rows in groups) is an ordinary menu even if its head asks something
  if (entries.length > 6 || entries.some((e) => isSeparator(e))) return false;
  const first = entries[0];
  return (
    first !== undefined &&
    isHead(first) &&
    first.head.includes("?") &&
    entries.some((e) => isItem(e) && e.danger === true)
  );
}

/** The rule for such a menu (owner, 19 Nov 2026): the destructive item is never first under the pointer, and the safe item is the one that opens lit. The safe items come first, the danger items last (stable otherwise); any other menu is returned as it is. */
export function askOrder(entries: readonly MenuEntry[]): readonly MenuEntry[] {
  if (!isAsk(entries)) return entries;
  const head = entries[0]!;
  const rest = entries.slice(1);
  const safe = rest.filter((e) => !(isItem(e) && e.danger === true));
  const risky = rest.filter((e) => isItem(e) && e.danger === true);
  return [head, ...safe, ...risky];
}

/** Which row an ask menu opens lit: its first enabled safe item; -1 for a menu that is not an ask. */
export function askLit(entries: readonly MenuEntry[]): number {
  if (!isAsk(entries)) return -1;
  return entries.findIndex((e) => isItem(e) && e.danger !== true && e.disabled !== true);
}
