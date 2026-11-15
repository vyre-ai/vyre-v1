// Which tab a thing's side pane opens on, in one place for a goal, a task, a project and a record (owner, 13 Nov 2026: "Details first, Activity another tab"). A pane opens on Details; the tab a person chose last in
// it is kept for that thing (and only that thing), so coming back to a goal they left on Activity finds it on Activity. A thing never opened has no choice kept and opens on Details.

/** The tab a pane opens on when nothing was chosen. */
export const FIRST_TAB = "details";

const KEPT = new Map<string, string>();
const PREFIX = "vyre-ui:pane-tab:";

interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
function storage(): Store | null {
  try {
    return (globalThis as { localStorage?: Store }).localStorage ?? null;
  } catch {
    return null;
  }
}

/** The tab kept for this thing, or none. */
export function keptTab(paneKey: string, thingId: string): string | undefined {
  const id = `${paneKey}:${thingId}`;
  const mem = KEPT.get(id);
  if (mem !== undefined) return mem;
  try {
    return storage()?.getItem(PREFIX + id) ?? undefined;
  } catch {
    return undefined;
  }
}

export function keepTab(paneKey: string, thingId: string, tab: string): void {
  const id = `${paneKey}:${thingId}`;
  KEPT.set(id, tab);
  try {
    storage()?.setItem(PREFIX + id, tab);
  } catch {
    /* memory keeps it */
  }
}

/** Forgets every kept choice (a test starts clean). */
export function forgetTabs(): void {
  KEPT.clear();
}

/** The tab a pane opens on for this thing: the one kept if it is still one of `keys`, else Details when the pane has it, else its first. */
export function openingTab(paneKey: string, thingId: string, keys: readonly string[]): string {
  const kept = keptTab(paneKey, thingId);
  if (kept !== undefined && keys.includes(kept)) return kept;
  return keys.includes(FIRST_TAB) ? FIRST_TAB : (keys[0] ?? FIRST_TAB);
}
