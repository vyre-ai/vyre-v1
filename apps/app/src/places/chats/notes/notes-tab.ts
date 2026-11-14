// The tab the Notes & artifacts page was last on, kept on this device (one key): the sidebar's foot row opens it again on that tab. Notes and Artifacts stay two different things with their own lists and viewers; this only remembers which one.
export type NotesTab = "notes" | "artifacts";
const KEY = "vyre.notes_tab.v1";
interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}
const store = (): Store | null => {
  try {
    return (globalThis as unknown as { localStorage?: Store }).localStorage ?? null;
  } catch {
    return null;
  }
};
export function lastNotesTab(st: Store | null = store()): NotesTab {
  try {
    return st?.getItem(KEY) === "artifacts" ? "artifacts" : "notes";
  } catch {
    return "notes";
  }
}
export function rememberNotesTab(tab: NotesTab, st: Store | null = store()): void {
  try {
    st?.setItem(KEY, tab);
  } catch {
    /* no storage: the page still works */
  }
}
