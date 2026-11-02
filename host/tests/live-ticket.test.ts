// The ticket that opens the live socket: the session token never goes in a socket address, because an address lands in console errors and logs.
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { LIVE_TICKET_TTL_MS, createLiveTicketRoute, createLiveTickets } from "../src/routes/live-ticket.ts";

test("a ticket opens one socket, once, and only for a moment", () => {
  let now = 1_000;
  const t = createLiveTickets({ now: () => now });
  const one = t.mint("vst_token");
  assert.ok(one.startsWith("lvt_") && !one.includes("vst_token"));
  assert.equal(t.spend(one), "vst_token");
  assert.equal(t.spend(one), null, "a second use is refused");
  const late = t.mint("vst_token");
  now += LIVE_TICKET_TTL_MS;
  assert.equal(t.spend(late), null, "a late one is refused");
  assert.equal(t.spend("lvt_madeup"), null);
});

test("however many are asked for, the waiting ones stay bounded and the newest still works", () => {
  const t = createLiveTickets({ now: () => 1 });
  let last = "";
  for (let i = 0; i < 5_000; i++) last = t.mint(`tok${i}`);
  assert.equal(t.spend(last), "tok4999");
});

function press(route: ReturnType<typeof createLiveTicketRoute>, method: string, url: string, auth?: string): { handled: boolean; status: number; body: string; headers: Record<string, string> } {
  const out = { handled: false, status: 0, body: "", headers: {} as Record<string, string> };
  const req = Object.assign(new EventEmitter(), { method, url, headers: auth ? { authorization: auth } : {} });
  const res = { writeHead(s: number, h: Record<string, string>) { out.status = s; out.headers = h; }, end(b: string) { out.body = b; } };
  out.handled = route.handle(req as never, res as never);
  return out;
}

test("the route gives a ticket to a live session in a header, and nobody else", () => {
  const tickets = createLiveTickets({ now: () => 1 });
  const route = createLiveTicketRoute({ tickets, known: (t) => t === "good", bearer: (h) => h?.replace(/^Bearer /, "") ?? null });
  assert.equal(press(route, "GET", "/sync/v1/ticket", "Bearer good").handled, false, "only a POST: a link cannot make one");
  assert.equal(press(route, "POST", "/sync/v1/other", "Bearer good").handled, false);
  assert.equal(press(route, "POST", "/sync/v1/ticket").status, 401);
  assert.equal(press(route, "POST", "/sync/v1/ticket", "Bearer bad").status, 401);
  const ok = press(route, "POST", "/sync/v1/ticket?token=good", "Bearer good");
  assert.equal(ok.status, 200);
  assert.equal(ok.headers["cache-control"], "no-store");
  assert.equal(tickets.spend((JSON.parse(ok.body) as { data: { ticket: string } }).data.ticket), "good");
});
