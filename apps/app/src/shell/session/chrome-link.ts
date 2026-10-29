// Hands the desktop shell the person's own session for a Team Space they are signed in to, so Vyre for Chrome on this computer can fill from that Space as that person (host/src/daemon/chrome-link.ts).
// The shell passes it to the app's daemons over loopback; it is kept in their memory only and given again at every start. A Space this computer hosts itself needs none, and neither does a browser.
import type { StoredSession } from "./stored.ts";

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

/** Does this session go to the shell? Only a Team Space on a server, reached over its own https address. */
export function linksToChrome(s: StoredSession): boolean {
  if (s.def.kind === "personal" || !s.token) return false;
  try { return new URL(s.baseUrl).protocol === "https:"; } catch { return false; }
}

/** Link on sign-in, unlink on sign-out or when the session changes. Returns the unlink. Errors are the shell's to log: the app works without Chrome. */
export function linkChromeSpace(invoke: Invoke | undefined, s: StoredSession): () => void {
  if (!invoke || !linksToChrome(s)) return () => undefined;
  const id = s.def.spaceId;
  void invoke("link_chrome_space", { id, name: s.def.name, address: s.baseUrl, token: s.token }).catch(() => undefined);
  return () => { void invoke("unlink_chrome_space", { id }).catch(() => undefined); };
}
