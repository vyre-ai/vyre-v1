// Is an address a Space server answering at its own name, or a name the relay answers? Asked of the address, not guessed from its name: a server on <name>.vyre.run with its own
// DNS record and TLS is as direct as one on its own domain. In the client layer because apps never fetch (boundary B4).
//
// What a relay name cannot answer: the relay's Worker (relay/worker/phone.js onHost) forwards only /p, /a/<id>/k/<key> and the MCP door to the box behind a name. /healthz and /v1/* get the
// phone shell page (HTML), "asleep" (503) or 405, and never with the CORS header a desktop app needs to read them. So a JSON /healthz naming a Space id with the space role, or a JSON
// identity.sign_in_options, can only come from a Space server at that address. (A page already on a relay name is different: its service worker carries every request to the box, so the
// app checks for that worker before it asks; see apps/app/src/shell/session/entry.ts.)
import { createCapCaller, type RouteRow } from "./index.ts";

export interface ProbeOptions {
  /** Injectable for tests; defaults to the platform fetch. */
  fetch?: typeof fetch;
  /** How long each of the two asks may take. */
  timeoutMs?: number;
  /** The route table for the second ask; defaults to generated/routes.ts. */
  routes?: () => Promise<readonly RouteRow[]>;
}

export const PROBE_TIMEOUT_MS = 2500;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The daemon's /healthz (host/src/daemon/http.ts): `{ ok, version, roles, space, ... }`. A Space server lists the space role and names its spc_ id. */
export function spaceHealth(body: unknown): boolean {
  return isObj(body) && Array.isArray(body["roles"]) && body["roles"].includes("space") && typeof body["space"] === "string" && /^spc_[A-Za-z0-9_-]{1,128}$/.test(body["space"]);
}

/** identity.sign_in_options' answer: what a Space's sign-in page offers. */
function signInOptions(data: unknown): boolean {
  return isObj(data) && typeof data["name"] === "string" && typeof data["password"] === "boolean" && typeof data["github"] === "boolean";
}

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(ctl.signal),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { ctl.abort(); reject(new Error("timed out")); }, ms); }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

/**
 * True only when the address answers as a Space server itself. False for anything else: a relay name, nothing there, a timeout, an answer of the wrong shape. The caller decides what false
 * means (for a vyre.run name: the relay's).
 * First /healthz; then, for a server from before /healthz carried the desktop app's CORS header (rc.14), the anonymous sign-in options, which have always carried it.
 */
export async function probeDirectSpace(address: string, o: ProbeOptions = {}): Promise<boolean> {
  let base: string;
  try { const u = new URL(address); if (u.protocol !== "https:" && u.protocol !== "http:") return false; base = u.origin; } catch { return false; }
  const doFetch = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const ms = o.timeoutMs ?? PROBE_TIMEOUT_MS;
  try {
    const healthy = await withTimeout(ms, async (signal) => {
      const res = await doFetch(`${base}/healthz`, { method: "GET", headers: { accept: "application/json" }, cache: "no-store", redirect: "error", signal });
      if (res.status !== 200 || !/^application\/json\b/i.test(res.headers.get("content-type") ?? "")) return false;
      return spaceHealth(await res.json());
    });
    if (healthy) return true;
  } catch { /* unreadable (CORS on an older server), offline or slow: ask the second way */ }
  try {
    const call = createCapCaller({ baseUrl: base, token: () => null, fetch: doFetch, ...(o.routes ? { routes: o.routes } : {}) });
    return await withTimeout(ms, async (signal) => signInOptions(await call("identity.sign_in_options", {}, { signal })));
  } catch { return false; }
}
