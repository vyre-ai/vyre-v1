// A link that opens, is behind the server's head, and is closed at once without the cursor moving will be closed the same way next time (17 Nov 2026: a live message too big for the relay ended the stream, the
// device reconnected from the same cursor, and the loop ran for as long as the page was open). The manager waits longer each time, says "reconnecting" until a link holds, and goes back to normal when one moves.
import test from "node:test";
import assert from "node:assert/strict";
import { BACKOFF_BASE_MS, SETTLE_MS, createConnection, endpoint, manualScheduler } from "./index.ts";
import type { Status } from "./index.ts";
import { elapse, fakeServer, settle } from "./testing.ts";

function make() {
  const srv = fakeServer();
  srv.head = 500;
  const sched = manualScheduler(1_000_000);
  const state = { cursor: 0, statuses: [] as Status[] };
  const conn = createConnection({
    space: "sp1",
    endpoints: [endpoint("relay", "wss://relay")],
    dial: srv.dial,
    scheduler: sched,
    hello: () => ({
      deviceId: "dev1",
      deviceClass: "web",
      appVersion: "1",
      registryHash: "h1",
      epoch: 0,
      replica: { entities: {} },
    }),
    cursor: {
      get: () => state.cursor,
      set: (n) => {
        state.cursor = n;
      },
    },
    apply: () => undefined,
    on: { status: (s) => state.statuses.push(s) },
  });
  return { srv, sched, conn, state };
}

test("a link that is cut each time it opens, with the server ahead, is retried after longer and longer waits, and is not called live", async () => {
  const { srv, sched, conn, state } = make();
  conn.start();
  await settle();
  const dialsAt: number[] = [];
  for (let i = 0; i < 6; i++) {
    dialsAt.push(srv.sockets.length);
    const s = srv.sockets[srv.sockets.length - 1]!;
    s.link.server.close("too big");
    await settle();
    await elapse(sched, 100);
  }
  assert.ok(srv.sockets.length <= 4, `six cuts in a few hundred ms made ${srv.sockets.length} dials, not a spin`);
  assert.ok(
    !state.statuses.slice(2).includes("live"),
    `a link that keeps dying is never called live again: ${state.statuses}`,
  );
  // the waits grow: 500, 1000, 2000 ... until a link lasts
  const before = srv.sockets.length;
  await elapse(sched, BACKOFF_BASE_MS * 2 ** 5);
  assert.ok(srv.sockets.length > before, "it does try again");
  conn.stop();
});

test("a link that holds for the settle time is live again and the waits start over", async () => {
  const { srv, sched, conn, state } = make();
  conn.start();
  await settle();
  srv.sockets[0]!.link.server.close("too big");
  await settle();
  await elapse(sched, BACKOFF_BASE_MS * 2);
  assert.equal(srv.sockets.length, 2);
  assert.equal(conn.status(), "reconnecting", "not live until it has held");
  await elapse(sched, SETTLE_MS + 1);
  assert.equal(conn.status(), "live");
  srv.sockets[1]!.link.server.close("net");
  await settle();
  await elapse(sched, 50);
  assert.equal(srv.sockets.length, 3, "an ordinary cut after that redials at once");
  assert.ok(state.statuses.includes("live"));
  conn.stop();
});

test("a link that moved the cursor before it closed is an ordinary drop, redialed at once", async () => {
  const { srv, sched, conn, state } = make();
  conn.start();
  await settle();
  state.cursor = 40;
  srv.sockets[0]!.link.server.close("net");
  await settle();
  await elapse(sched, 50);
  assert.equal(srv.sockets.length, 2);
  conn.stop();
});
