// /oauth/callback: the page an app sends a person back to after they approve (or decline) a connection. It finishes the sign-in as the signed-in person who started it: the server refuses anyone else before it
// touches the state. The pure parts live here: reading the address, scrubbing it, and turning every outcome into words.
import { CapError } from "../shell/session/caps.ts";
import type { CapCall } from "../shell/session/caps.ts";

/** Where Back goes: the Connections page of the Console. */
export const BACK_TO_CONNECTIONS = "/console#screen=console.integrations&page=connections";

export interface CallbackParams { state: string | null; code: string | null; error: string | null }

/** What the app put in the address. Values are bounded: a state or code longer than any real one is not read. */
export function readCallback(search: string): CallbackParams {
  const q = new URLSearchParams(search);
  const take = (k: string, max: number): string | null => { const v = q.get(k); return v !== null && v.length > 0 && v.length <= max ? v : null; };
  return { state: take("state", 200), code: take("code", 4096), error: take("error", 100) };
}

export type Outcome =
  | { kind: "connected"; connectionId: string }
  | { kind: "declined" }
  | { kind: "failed"; message: string; cause: string; next: string; code?: string; traceId?: string; retryable: boolean };

const failed = (message: string, cause: string, next: string, extra: { code?: string; traceId?: string; retryable?: boolean } = {}): Outcome => ({ kind: "failed", message, cause, next, retryable: extra.retryable === true, ...(extra.code ? { code: extra.code } : {}), ...(extra.traceId ? { traceId: extra.traceId } : {}) });
const START_AGAIN = "Open Connections and connect the account again.";

/** Every way finishing a sign-in can end, in words a person can act on. The server's own message is used where it says something the person needs (a locked vault, the app's refusal). */
export function describeFailure(e: unknown): Outcome {
  if (e instanceof CapError) {
    const x = { code: e.code, traceId: e.traceId };
    if (e.details?.["reason"] === "declined") return { kind: "declined" };
    if (e.code === "auth.invalid_code") return failed("This sign-in link has expired or was already used", "A sign-in link works once and only for ten minutes.", START_AGAIN, x);
    if (e.code === "permission.no_grant") return failed("This sign-in was started by someone else", "Only the person who started a connection can finish it. You are signed in as a different person.", "Ask them to open the link, or start the connection yourself from Connections.", x);
    if (e.code === "auth.unauthenticated") return failed("Your vault is locked", e.message, "Unlock it, then connect the account again.", x);
    if (e.code === "validation.not_found") return failed("The connection was removed while you signed in", e.message, START_AGAIN, x);
    if (e.code.startsWith("provider.")) return failed("The app did not complete the sign-in", e.message, START_AGAIN, x);
    return failed("Couldn’t finish connecting this account", e.message, START_AGAIN, x);
  }
  return failed("Couldn’t reach the Space", "The connection to the Space dropped, so it is not known whether the sign-in finished.", "Try again; if it says the link was already used, check Connections.", { retryable: true });
}

/** Dropbox keeps its own sign-in (the state starts dbs_) and a remote outside-tool server keeps its own (mcs_, finished in the engine); everything else is the connectors module. */
const finishing = (state: string): string => (state.startsWith("dbs_") ? "dropbox.connect.complete" : state.startsWith("mcs_") ? "engine.mcp.oauth_complete" : "connections.complete_auth");

/** Finish the sign-in with what the address carried. */
export async function completeCallback(call: CapCall, p: CallbackParams): Promise<Outcome> {
  if (p.state === null) return failed("There is no sign-in to finish", "This address has no sign-in state. It only works when an app sends you back to it.", START_AGAIN);
  if (p.error === null && p.code === null) return failed("The app did not send a sign-in code", "It returned to Vyre without a code or an error.", START_AGAIN);
  try {
    const out = (await call(finishing(p.state), p.error !== null ? { state: p.state, error: p.error } : { state: p.state, code: p.code })) as { connectionId: string };
    return { kind: "connected", connectionId: out.connectionId };
  } catch (e) { return describeFailure(e); }
}
