// Endpoint choice (ARCH 5.9): rank, race the top two, stick to the winner, rest a failed endpoint, back off when none answer.
import test from "node:test";
import assert from "node:assert/strict";
import { BACKOFF_BASE_MS, ENDPOINT_COOLDOWN_MS, HELLO_TIMEOUT_MS, createConnection, endpoint, manualScheduler, rank, usable } from "./index.ts";
import type { Endpoint } from "./index.ts";
import { elapse, fakeServer, settle } from "./testing.ts";

const urls = (l: Endpoint[]): string[] => l.map((e) => e.url);

test("rank: usable before resting, then the one that worked last, then the faster, then direct before tunnel before relay", () => {
  const now = 1000;
  const list = [
    endpoint("relay", "r"),
    endpoint("tunnel", "t"),
    endpoint("direct", "d"),
    endpoint("direct", "d-down", { health: "down", downUntil: now + 50 }),
    endpoint("direct", "d-rested", { health: "down", downUntil: now - 1 }),
    endpoint("relay", "r-fast", { rttMs: 10 }),
    endpoint("relay", "r-recent", { lastOk: 900, rttMs: 500 }),
  ];
  assert.deepEqual(urls(rank(list, now)), ["r-recent", "r-fast", "d", "d-rested", "t", "r", "d-down"]);
  assert.ok(usable(list[4]!, now));
  assert.ok(!usable(list[3]!, now));
});

function make(eps: Endpoint[], over: Partial<Parameters<typeof createConnection>[0]> = {}) {
  const srv = fakeServer();
  const sched = manualScheduler(1_000_000);
  let cursor = 0;
  const conn = createConnection({
    space: "sp1", endpoints: eps, dial: srv.dial, scheduler: sched,
    hello: () => ({ deviceId: "dev1", deviceClass: "desktop", appVersion: "1.0.0", registryHash: "h1", epoch: 0, replica: { entities: {} } }),
    cursor: { get: () => cursor, set: (n) => { cursor = n; } }, apply: () => undefined, ...over,
  });
  return { srv, sched, conn };
}

test("the race goes to the endpoint that answers first, and the other is closed", async () => {
  const { srv, conn } = make([endpoint("direct", "wss://a"), endpoint("relay", "wss://b")]);
  srv.slow("wss://a");
  conn.start();
  await settle();
  assert.equal(conn.endpoint()?.url, "wss://b", "the relay answered first");
  assert.equal(srv.openAt("wss://a"), 0, "the slow loser was closed");
  assert.equal(srv.open(), 1);
  srv.slow("wss://a", false);
  await settle();
  assert.equal(srv.openAt("wss://a"), 0);
  conn.stop();
});

test("only the top two are raced; a third is not dialled while they work", async () => {
  const { srv, conn } = make([endpoint("direct", "wss://a"), endpoint("tunnel", "wss://t"), endpoint("relay", "wss://r")]);
  conn.start();
  await settle();
  assert.equal(conn.stats().dials, 2);
  assert.equal(srv.openAt("wss://r"), 0);
  conn.stop();
});

test("a refused endpoint is marked down and rests; the other carries the connection", async () => {
  const { srv, conn } = make([endpoint("direct", "wss://a"), endpoint("relay", "wss://b")]);
  srv.refuse("wss://a");
  conn.start();
  await settle();
  assert.equal(conn.status(), "live");
  assert.equal(conn.endpoint()?.url, "wss://b");
  const a = conn.endpoints().find((e) => e.url === "wss://a")!;
  assert.equal(a.health, "down");
  assert.equal(conn.endpoints().find((e) => e.url === "wss://b")!.health, "healthy");
  assert.ok(a.downUntil !== undefined);
  conn.stop();
});

test("when no endpoint answers the manager backs off 500 ms, 1 s, 2 s and connects as soon as one does", async () => {
  const { srv, sched, conn } = make([endpoint("direct", "wss://a")]);
  srv.refuse("wss://a");
  conn.start();
  await settle();
  assert.equal(conn.stats().dials, 1);
  sched.advance(BACKOFF_BASE_MS - 1); await settle();
  assert.equal(conn.stats().dials, 1);
  sched.advance(1); await settle();
  assert.equal(conn.stats().dials, 2);
  sched.advance(BACKOFF_BASE_MS * 2 - 1); await settle();
  assert.equal(conn.stats().dials, 2);
  sched.advance(1); await settle();
  assert.equal(conn.stats().dials, 3);
  srv.refuse("wss://a", false);
  sched.advance(BACKOFF_BASE_MS * 4); await settle();
  assert.equal(conn.status(), "live");
  assert.equal(srv.open(), 1);
  conn.stop();
});

test("an endpoint that does not say hello in time is given up on", async () => {
  const { srv, sched, conn } = make([endpoint("direct", "wss://a"), endpoint("relay", "wss://b")]);
  srv.slow("wss://a"); srv.slow("wss://b");
  conn.start();
  await settle();
  assert.equal(conn.status(), "connecting");
  sched.advance(HELLO_TIMEOUT_MS + 1); await settle();
  assert.equal(srv.open(), 0, "both were closed");
  assert.ok(conn.endpoints().every((e) => e.health === "down"));
  conn.stop();
});

test("a rested endpoint is tried again after its cooldown", async () => {
  const { srv, sched, conn } = make([endpoint("direct", "wss://a"), endpoint("relay", "wss://b")]);
  srv.refuse("wss://a");
  conn.start();
  await settle();
  srv.refuse("wss://a", false);
  srv.sockets.find((s) => s.url === "wss://b")!.link.cut("server restart");
  await settle();
  // a is still resting, so the manager goes back to b.
  assert.equal(conn.endpoint()?.url, "wss://b");
  await elapse(sched, ENDPOINT_COOLDOWN_MS + 1);
  srv.sockets.filter((s) => s.link.isOpen()).forEach((s) => s.link.cut("again"));
  await settle();
  assert.ok(["wss://a", "wss://b"].includes(conn.endpoint()?.url ?? ""));
  assert.equal(conn.status(), "live");
  conn.stop();
});
