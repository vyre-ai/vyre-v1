// POST /sync/v1/ticket: the session token for a one-time ticket to the live socket. A browser's WebSocket cannot carry a header and its address lands in console errors and logs, so the token never goes
// in the address (client/src/gateway/live-ticket.ts). A ticket opens one socket, within seconds, and only while the session behind it still holds: the token is identified again when it is spent. Tickets live
// in this process's memory, stored by their hash, and a restart simply makes the client ask again.
import crypto from "node:crypto";
import type http from "node:http";

export const LIVE_TICKET_TTL_MS = 30_000;
const MOST_WAITING = 1024;
const hash = (t: string): string => crypto.createHash("sha256").update(t).digest("base64url");

export interface LiveTickets {
  mint(token: string): string;
  /** The token behind a ticket, once. Null for anything else: unknown, spent or late. */
  spend(ticket: string): string | null;
}

export function createLiveTickets(o: { now: () => number; ttlMs?: number }): LiveTickets {
  const ttl = o.ttlMs ?? LIVE_TICKET_TTL_MS;
  const waiting = new Map<string, { token: string; until: number }>();
  return {
    mint(token) {
      const now = o.now();
      for (const [k, v] of waiting) if (v.until <= now) waiting.delete(k);
      while (waiting.size >= MOST_WAITING) waiting.delete(waiting.keys().next().value as string);   // the oldest goes first: the client whose ticket it was asks again
      const ticket = `lvt_${crypto.randomBytes(24).toString("base64url")}`;
      waiting.set(hash(ticket), { token, until: now + ttl });
      return ticket;
    },
    spend(ticket) {
      const key = hash(ticket), got = waiting.get(key);
      if (!got) return null;
      waiting.delete(key);
      return got.until > o.now() ? got.token : null;
    },
  };
}

const NO_STORE = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

export function createLiveTicketRoute(o: { tickets: LiveTickets; known(token: string): boolean; bearer(header: string | undefined): string | null }): { handle(req: http.IncomingMessage, res: http.ServerResponse): boolean } {
  return {
    handle(req, res) {
      if (req.method !== "POST" || (req.url ?? "").split("?")[0] !== "/sync/v1/ticket") return false;
      const token = o.bearer(req.headers.authorization);
      if (!token || !o.known(token)) {
        res.writeHead(401, NO_STORE);
        res.end(JSON.stringify({ error: { code: "auth.unauthenticated", message: "Authentication is required." } }));
        return true;
      }
      res.writeHead(200, NO_STORE);
      res.end(JSON.stringify({ data: { ticket: o.tickets.mint(token) } }));
      return true;
    },
  };
}
