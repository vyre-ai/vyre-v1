// Budget connection_count (ARCH 9): twenty screens open, the server sees exactly one socket per device. Runs against the in-memory live hub.
import test from "node:test";
import assert from "node:assert/strict";
import { IDLE_CLOSE_MS, connectionFor, createConnection, endpoint, forgetConnections, manualScheduler } from "./index.ts";
import type { Connection } from "./index.ts";
import { elapse, fakeServer, settle } from "./testing.ts";

function make(srv = fakeServer(), sched = manualScheduler(1_000_000)) {
  let cursor = 0;
  const conn = createConnection({
    space: "sp1", endpoints: [endpoint("direct", "wss://direct.example/live"), endpoint("relay", "wss://relay.example/live")], dial: srv.dial, scheduler: sched,
    hello: () => ({ deviceId: "dev1", deviceClass: "desktop", appVersion: "1.0.0", registryHash: "h1", epoch: 0, replica: { entities: {} } }),
    cursor: { get: () => cursor, set: (n) => { cursor = n; } },
    apply: () => undefined,
  });
  return { srv, sched, conn };
}

test("twenty screens share one socket: the server sees exactly 1", async () => {
  const { srv, conn } = make();
  const handles = Array.from({ length: 20 }, () => conn.acquire());
  await settle();
  assert.equal(conn.status(), "live");
  assert.equal(srv.open(), 1, "one open socket after the race");
  assert.equal(conn.stats().opened, 1);
  assert.equal(conn.stats().users, 20);
  assert.equal(srv.got("hello").length, 2, "the top two endpoints were raced, the loser was closed");
  for (const h of handles) h.release();
  conn.stop();
});

test("the connection stays while any screen holds it, and closes after the last is released and a rest", async () => {
  const { srv, sched, conn } = make();
  const hs = [conn.acquire(), conn.acquire(), conn.acquire()];
  await settle();
  hs[0]!.release(); hs[1]!.release();
  await elapse(sched, IDLE_CLOSE_MS * 2);
  assert.equal(srv.open(), 1, "one screen still holds it");
  hs[2]!.release();
  hs[2]!.release();
  await elapse(sched, IDLE_CLOSE_MS - 1);
  assert.equal(srv.open(), 1, "it rests first");
  await elapse(sched, 2);
  assert.equal(srv.open(), 0);
  assert.equal(conn.status(), "idle");
  const again = conn.acquire();
  await settle();
  assert.equal(srv.open(), 1, "a new screen opens it again");
  again.release();
  conn.stop();
});

test("a screen that comes back during the rest keeps the same socket", async () => {
  const { srv, sched, conn } = make();
  conn.acquire().release();
  await settle();
  await elapse(sched, IDLE_CLOSE_MS - 100);
  const back = conn.acquire();
  await elapse(sched, IDLE_CLOSE_MS * 3);
  assert.equal(srv.open(), 1);
  assert.equal(conn.stats().opened, 1);
  back.release();
  conn.stop();
});

test("one connection per Space: every caller of connectionFor gets the same one", async () => {
  forgetConnections();
  let made = 0;
  const { conn } = make();
  const factory = (): Connection => { made++; return conn; };
  const a = connectionFor("sp1", factory), b = connectionFor("sp1", factory), c = connectionFor("sp2", factory);
  assert.equal(a, b);
  assert.equal(made, 2, "one per Space id");
  assert.equal(c, conn);
  forgetConnections();
  assert.equal(conn.status(), "stopped");
});
