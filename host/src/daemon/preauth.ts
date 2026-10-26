// Who an unauthenticated call is for rate limits and audit (gateway preAuth): not a person, an `actor` principal named by where the call came from (act_anon_<16 hex of the sha256 of the address>, act_pending_...). It is never a service: gate, tasks, runs, home, notifications and scheduler-api trust a service outright, and a signed-out caller must pass none of those checks, even through a nested call. The event log takes actor ids of the usr_, agt_, act_ and svc_ kinds. invoke skips authorize for these calls and rate-limits on
// `${principal.id}:${cap}`, so one shared id would make every signed-out caller on earth share a single bucket for sign_in; a per-source id gives each address its own. The address is the socket's
// (http.ts writes it into x-vyre-remote after copying the client's headers, so a client cannot set it); behind a reverse proxy on this machine (a loopback socket) the leftmost x-forwarded-for is the client.
import { sha256Hex } from "../../../kernel/src/log/hash.ts";
import type { SessionInfo } from "../gateway.ts";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** The address a pre-auth call came from, as best the host can tell. */
export function sourceOf(headers: Readonly<Record<string, string | undefined>>): string {
  const socket = headers["x-vyre-remote"] ?? "";
  // The last entry is the one the local proxy added; earlier entries are whatever the visitor sent.
  const forwarded = headers["x-forwarded-for"]?.split(",").at(-1)?.trim();
  return LOOPBACK.has(socket) && forwarded ? forwarded : socket || "unknown";
}

export function preAuthSession(space: string, caller: "anonymous" | "pending", headers: Readonly<Record<string, string | undefined>>): SessionInfo {
  return { space, principal: { kind: "actor", id: `act_${caller === "anonymous" ? "anon" : "pending"}_${sha256Hex(sourceOf(headers)).slice(0, 16)}` } };
}
