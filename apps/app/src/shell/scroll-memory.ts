// Back lands on the same scroll position (NAV-2026-11-14 rule 1). Before the view changes the shell notes how far each scrolled box under the page was scrolled, under the address on screen;
// when that address comes back (Back, Forward, a tab choice) the boxes are scrolled again as soon as they exist. A box is found by its test id, else by its place among the page's elements.
// The still copy of the old view (data-swap) is never read, and nothing is restored once the person has scrolled the page themselves.

export interface SavedScroll {
  id: string;
  index: number;
  top: number;
  left: number;
}

interface Box {
  scrollTop: number;
  scrollLeft: number;
  scrollHeight: number;
  clientHeight: number;
  getAttribute(k: string): string | null;
  closest?(q: string): unknown;
}
interface Root {
  querySelectorAll(q: string): ArrayLike<Box>;
}

const MAX_SAVED = 60;

/** Where every scrolled box under `root` is scrolled. Empty when nothing is scrolled. */
export function captureScroll(root: unknown): SavedScroll[] {
  const r = root as Root | null;
  if (!r || typeof r.querySelectorAll !== "function") return [];
  const all = r.querySelectorAll("*");
  const out: SavedScroll[] = [];
  for (let i = 0; i < all.length; i++) {
    const el = all[i]!;
    if (el.scrollTop === 0 && el.scrollLeft === 0) continue;
    if (el.closest?.("[data-swap]")) continue;
    out.push({ id: el.getAttribute("data-testid") ?? "", index: i, top: el.scrollTop, left: el.scrollLeft });
  }
  return out;
}

/** One try: scrolls every box it can find to where it was. Returns how many are still waiting for their box (not drawn yet, or not tall enough yet). */
export function applyScroll(root: unknown, saved: readonly SavedScroll[]): number {
  const r = root as Root | null;
  if (!r || typeof r.querySelectorAll !== "function") return saved.length;
  const all = r.querySelectorAll("*");
  let waiting = 0;
  for (const s of saved) {
    let el: Box | undefined;
    if (s.id !== "") {
      for (let i = 0; i < all.length; i++)
        if (all[i]!.getAttribute("data-testid") === s.id && !all[i]!.closest?.("[data-swap]")) {
          el = all[i];
          break;
        }
    } else el = all[s.index];
    if (!el || (s.top > 0 && el.scrollHeight - el.clientHeight < s.top)) {
      waiting += 1;
      continue;
    }
    el.scrollTop = s.top;
    el.scrollLeft = s.left;
  }
  return waiting;
}

/** The notes the shell keeps: one list per address, the newest kept. */
export function scrollMemory(): {
  note(key: string, saved: SavedScroll[]): void;
  get(key: string): SavedScroll[] | undefined;
} {
  const map = new Map<string, SavedScroll[]>();
  return {
    note(key, saved) {
      map.delete(key);
      if (saved.length > 0) map.set(key, saved);
      if (map.size > MAX_SAVED) map.delete(map.keys().next().value as string);
    },
    get: (key) => map.get(key),
  };
}
