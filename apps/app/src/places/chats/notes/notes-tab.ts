// The tab the Notes & artifacts page was last on: the person's own layout value on the Space (`chats.notes_tab`, state.layout.*), so it follows them to every device and the next person on a browser never inherits it.
// The sidebar's foot row opens the page on that tab. Notes and Artifacts stay two different things with their own lists and viewers; this only remembers which one.
// The value is read once when the sidebar opens (with the sidebar's own read) and held here for the press; the old browser-wide key is deleted, never moved.
export type NotesTab = "notes" | "artifacts";
export const NOTES_TAB_KEY = "chats.notes_tab";
const OLD_KEY = "vyre.notes_tab.v1";
type Call = (cap: string, input: Record<string, unknown>) => unknown;

let held: NotesTab | null = null;

/** The tab to open on: the last one this person used, Notes before they have used one (or while the read has not answered). */
export const lastNotesTab = (): NotesTab => held ?? "notes";

/** Forget what is held (a different person, a test). */
export const forgetNotesTab = (): void => {
  held = null;
};

/** Read the person's tab from their state. A person with no value opens on Notes, and so does a read that fails. */
export async function loadNotesTab(call: Call): Promise<NotesTab> {
  try {
    const out = (await call("state.layout.get", { keys: [NOTES_TAB_KEY] })) as {
      values?: { key: string; value: unknown }[];
    };
    const v = out.values?.find((x) => x.key === NOTES_TAB_KEY)?.value;
    held = v === "artifacts" ? "artifacts" : "notes";
  } catch {
    // a read that fails must not leave another person's tab behind: Notes until it answers
    held = null;
  }
  return lastNotesTab();
}

/** The page is on this tab now: hold it and, when asked, keep it in the person's state. */
export function rememberNotesTab(tab: NotesTab, call?: Call): void {
  const changed = held !== tab;
  held = tab;
  if (!call || !changed) return; // written only when it changed: a page opening on the tab already kept costs no write
  try {
    void Promise.resolve(call("state.layout.set", { key: NOTES_TAB_KEY, value: tab })).catch(() => undefined);
  } catch {
    /* the page still works */
  }
}

/** Earlier versions kept the tab in one browser-wide key. It cannot be attributed to a person, so it is deleted. */
export function retireOldNotesTabKey(): void {
  try {
    (globalThis as { localStorage?: { removeItem(k: string): void } }).localStorage?.removeItem(OLD_KEY);
  } catch {
    /* blocked storage */
  }
}
