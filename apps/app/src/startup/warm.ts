// A device that holds a session for this address is going to open the shell and, in it, a place. Both are loaded now, as the first thing the page does, while the key check and the session check are still on
// their way (r40: the shell was asked for only after those answered, and the place only after the shell was drawn, so the page waited between its own steps). What each load starts is the same import the
// app makes later, so it is one load, not two. A page with no session, or one that was opened for a claim or a join, loads nothing it will not use.
import { readStored, spaceAddress } from "../shell/session/stored.ts";
import { isPlace, loadPlace, resolveLastPlace } from "./places.ts";
import { loadShellHost } from "./shell-load.ts";
import { webUiStateStore } from "./persisted.ts";

/** The place the address names (its first segment), else the last one opened, else Chats. */
export function placeToWarm(path: string, last: string | null | undefined): string {
  const seg = path.split("/")[1] ?? "";
  return isPlace(seg) ? seg : resolveLastPlace(last);
}

export interface WarmDeps {
  /** Whether this device holds a session for the address the page was opened at. */
  hasSession(): boolean;
  loadShell(): Promise<unknown>;
  loadPlace(id: string): Promise<unknown>;
  last(): string | null | undefined;
}
const real = (): WarmDeps => ({
  hasSession: () => {
    const address = spaceAddress();
    return address !== null && readStored(undefined, address) !== null;
  },
  loadShell: () => loadShellHost(),
  loadPlace: (id) => loadPlace(id),
  last: () => webUiStateStore().read().lastPlace,
});

/** Start loading the shell and the place this visit will open. Safe to call more than once; a failure is left for the real load to report. Returns whether it started. */
export function warmSignedIn(path: string, deps: WarmDeps = real()): boolean {
  try {
    // only the app's own addresses: a claim, a join or an OAuth page opens something else
    if (path !== "/" && !isPlace(path.split("/")[1] ?? "")) return false;
    if (!deps.hasSession()) return false;
    void deps.loadShell().catch(() => undefined);
    void deps.loadPlace(placeToWarm(path, deps.last())).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}
