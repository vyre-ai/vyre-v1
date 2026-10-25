// Who an unauthenticated call is for rate limits and audit (gateway preAuth): not a person, a service principal named by where the call came from. invoke skips authorize for these calls and rate-limits on
// `${principal.id}:${cap}`, so one shared id would make every signed-out caller on earth share a single bucket for sign_in; a per-source id gives each address its own. The address is the socket's
// (http.ts writes it into x-vyre-remote after copying the client's headers, so a client cannot set it); behind a reverse proxy on this machine (a loopback socket) the leftmost x-forwarded-for is the client.
import { sha256Hex } from "../../../kernel/src/log/hash.ts";
import type { SessionInfo } from "../gateway.ts";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** The address a pre-auth call came from, as best the host can tell. */
export function sourceOf(headers: Readonly<Record<string, string | undefined>>): string {
  const socket = headers["x-vyre-remote"] ?? "";
  const forwarded = headers["x-forwarded-for"]?.split(",")[0]?.trim();
  return LOOPBACK.has(socket) && forwarded ? forwarded : socket || "unknown";
}

export function preAuthSession(space: string, caller: "anonymous" | "pending", headers: Readonly<Record<string, string | undefined>>): SessionInfo {
  return { space, principal: { kind: "service", id: `${caller === "anonymous" ? "anon" : "pending"}:${sha256Hex(sourceOf(headers)).slice(0, 16)}` } };
}
