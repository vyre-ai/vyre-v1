// This computer runs the person's own chats in each Team Space they are signed in to here (lane l-runson; owner rulings 2 and 3 Nov). The desktop shell hands each Team Space session to its
// device daemon (src-tauri/src/chrome.rs link_chrome_space, which also hands it to Vyre for Chrome), and the daemon links to that Space (host/src/compute/device-link.ts), so a turn placed on
// "This computer" can run here. On app start and at each new sign-in every signed-in Team Space is linked; sign-out and lock take the link away. A browser has no shell: nothing happens there.
// A Personal Space, and a Team Space this computer hosts itself (a loopback address), are already here and are never linked.
import { isLoopbackUrl } from "../../../../../client/src/gateway/local-key.ts";
import type { StoredSession } from "./stored.ts";

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
const shellInvoke = (): Invoke | undefined => (globalThis as { __TAURI__?: { core?: { invoke?: Invoke } } }).__TAURI__?.core?.invoke;

/** The Team Spaces a computer links to: signed in, a Team Space, not on this computer. */
export const linkable = (s: Pick<StoredSession, "baseUrl" | "token" | "def">): boolean => s.def.kind === "team" && s.token !== "" && !isLoopbackUrl(s.baseUrl);

/** Link every signed-in Team Space to this computer. Returns how many were handed over; 0 in a browser. A shell that refuses one is skipped: the chat then runs elsewhere, as Automatic says. */
export async function linkComputer(sessions: readonly StoredSession[], invoke: Invoke | undefined = shellInvoke()): Promise<number> {
  if (!invoke) return 0;
  let n = 0;
  for (const s of sessions.filter(linkable)) {
    try { await invoke("link_chrome_space", { id: s.def.spaceId, name: s.def.name, address: s.baseUrl, token: s.token }); n++; } catch { /* the daemon is not up yet: it is given the list again when it starts (chrome.rs relink) */ }
  }
  return n;
}

/** Take this computer's link to a Team Space away (sign-out, lock). */
export async function unlinkComputer(s: Pick<StoredSession, "def">, invoke: Invoke | undefined = shellInvoke()): Promise<void> {
  if (!invoke || s.def.kind !== "team") return;
  try { await invoke("unlink_chrome_space", { id: s.def.spaceId }); } catch { /* nothing was linked */ }
}
