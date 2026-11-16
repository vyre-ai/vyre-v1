import type http from "node:http";
import { isLocal } from "./local-key.ts";

// The one answer to "which address do I send a person or a provider to?" for a route that builds an absolute address from a request (sign-in with GitHub, GitHub connect, company sign-in).
// It never comes from the request's Host or X-Forwarded-Host header: anyone who can send a request can write those, and a provider would then send the person and the sign-in code to a place they chose.
//   1. A request from this computer that names this computer (a loopback socket, a loopback Host, no proxy header) is answered with that loopback address. This is how a Personal Space on a person's own
//      computer, which has no public address, signs in; a request from another machine cannot take this branch.
//   2. Any other request is answered with the Space's own configured public address (daemon publicOrigin), or null when it has none yet.
// The caller refuses a null in one plain sentence.
export function ownOriginOf(req: http.IncomingMessage, configured: () => string | null): string | null {
  if (isLocal(req)) return `http://${String(req.headers["host"] ?? "").toLowerCase()}`;
  const c = configured();
  return c ? c.replace(/\/+$/, "") : null;
}

export const NO_ADDRESS = "This Space has no address of its own yet, so sign-in cannot start from here.";
