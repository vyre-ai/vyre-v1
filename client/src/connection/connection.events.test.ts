// Events and heartbeat (ARCH 5.9): batches apply in order and are acked after they apply, a replay is not applied twice, a failed batch restarts from the cursor, silence fails over. Runs against the in-memory live hub.
import test from "node:test";
import assert from "node:assert/strict";
import { BACKOFF_BASE_MS, HEARTBEAT_DEAD_MS, HEARTBEAT_MS, createConnection, endpoint, manualScheduler } from "./index.ts";
import type { EventBatch, Mode } from "./index.ts";
import { fakeServer, settle } from "./testing.ts";

const change = (seq: number, id = `r${seq}`) => ({ seq, entity: "contact", id, op: "upsert" as const, fields: { name: { v: `n${seq}`, hlc: "000000000001-0000-srv", actor: "usr_a" } } });
const ev = (seq: number, ids: number[] = [seq], hide: { entity: string; id: string; seq: number }[] = []) => ({ t: "ev", seq, items: ids.map((i) => change(i)), ...(hide.length ? { hide } : {}) });

function make(over: { apply?: (b: EventBatch) => void | Promise<void>; on?: Parameters<typeof createConnection>[0]["on"]; eps?: ReturnType<typeof endpoint>[] } = {}) {
  const srv = fakeServer();
  const sched = manualScheduler(1_000_000);
  const state = { cursor: 0, applied: [] as EventBatch[], sets: [] as number[] };
  const conn = createConnection({
    space: "sp1", endpoints: over.eps ?? [endpoint("direct", "wss://a"), endpoint("relay", "wss://b")], dial: srv.dial, scheduler: sched,
    hello: () => ({ deviceId: "dev1", deviceClass: "desktop", appVersion: "1.0.0", registryHash: "h1", epoch: 0, replica: { entities: {} } }),
    cursor: { get: () => state.cursor, set: (n) => { state.cursor = n; state.sets.push(n); } },
    apply: over.apply ?? ((b) => { state.applied.push(b); }),
    ...(over.on ? { on: over.on } : {}),
  });
  return { srv, sched, conn, state };
}
const acks = (srv: ReturnType<typeof fakeServer>): number[] => srv.got("ack").map((a) => (a as { seq: number }).seq);

test("hello carries the cursor the replica has applied", async () => {
  const { srv, conn, state } = make();
  state.cursor = 41;
  conn.start();
  await settle();
  assert.deepEqual(srv.sockets.flatMap((s) => s.hellos.map((h) => h.cursor)), [41, 41]);
  assert.equal(srv.sockets[0]!.hellos[0]!.deviceId, "dev1");
  conn.stop();
});

test("batches apply in order and are acked after they apply, never before", async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => { release = r; });
  const order: number[] = [];
  const { srv, conn, state } = make({ apply: async (b) => { await gate; order.push(b.seq); } });
  conn.start();
  await settle();
  srv.broadcast(ev(3, [1, 2, 3]));
  srv.broadcast(ev(5, [4, 5]));
  await settle();
  assert.deepEqual(acks(srv), [], "nothing is acked while the first batch is still applying");
  assert.equal(state.cursor, 0);
  release();
  await settle();
  assert.deepEqual(order, [3, 5]);
  assert.deepEqual(acks(srv), [3, 5]);
  assert.equal(state.cursor, 5);
  conn.stop();
});

test("hide rows reach the replica with their batch", async () => {
  const { srv, conn, state } = make();
  conn.start();
  await settle();
  srv.broadcast(ev(9, [], [{ entity: "contact", id: "gone", seq: 9 }]));
  await settle();
  assert.deepEqual(state.applied[0]!.hide, [{ entity: "contact", id: "gone", seq: 9 }]);
  assert.deepEqual(acks(srv), [9]);
  conn.stop();
});

test("a replayed batch is acked but not applied twice", async () => {
  const { srv, conn, state } = make();
  conn.start();
  await settle();
  srv.broadcast(ev(4, [1, 2, 3, 4]));
  await settle();
  srv.broadcast(ev(4, [1, 2, 3, 4]));
  srv.broadcast(ev(6, [4, 5, 6]));
  await settle();
  assert.deepEqual(state.applied.map((b) => b.items.map((c) => c.seq)), [[1, 2, 3, 4], [5, 6]], "the replay is dropped and the overlap trimmed");
  assert.deepEqual(acks(srv), [4, 4, 6]);
  assert.equal(state.cursor, 6);
  conn.stop();
});

test("a batch that will not apply is not acked: the connection restarts from the cursor after a backoff", async () => {
  let fail = true;
  const { srv, sched, conn, state } = make({ apply: (b) => { if (fail) throw new Error("disk full"); state.applied.push(b); } });
  state.cursor = 2;
  conn.start();
  await settle();
  const first = srv.sockets.filter((s) => s.link.isOpen())[0]!;
  srv.broadcast(ev(5, [3, 4, 5]));
  await settle();
  assert.deepEqual(acks(srv), []);
  assert.equal(state.cursor, 2, "the cursor did not move");
  assert.equal(first.link.isOpen(), false, "that link was dropped");
  assert.equal(conn.status(), "reconnecting");
  fail = false;
  sched.advance(BACKOFF_BASE_MS); await settle();
  assert.equal(conn.status(), "live");
  const hellos = srv.sockets.flatMap((s) => s.hellos.map((h) => h.cursor));
  assert.equal(hellos.at(-1), 2, "the new hello resumes from the cursor");
  srv.broadcast(ev(5, [3, 4, 5]));
  await settle();
  assert.equal(state.cursor, 5);
  conn.stop();
});

test("pull_hint, other frames, purge and a read-only answer reach the callbacks", async () => {
  const seen: { hints: number[]; frames: unknown[]; purges: number[]; modes: Mode[] } = { hints: [], frames: [], purges: [], modes: [] };
  const { srv, conn } = make({ on: { pullHint: (s) => seen.hints.push(s), frame: (f) => seen.frames.push(f), purge: (e) => seen.purges.push(e), mode: (m) => seen.modes.push(m) } });
  conn.start();
  await settle();
  srv.broadcast({ t: "pull_hint", seq: 77 });
  srv.broadcast({ t: "presence", data: { who: "usr_b" } });
  srv.broadcast({ t: "ydoc.update", doc: "not_1", data: "AAA" });
  await settle();
  assert.deepEqual(seen.hints, [77]);
  assert.equal(seen.frames.length, 2);
  srv.broadcast({ t: "purge", epoch: 3 });
  await settle();
  assert.deepEqual(seen.purges, [3]);
  assert.equal(conn.status(), "stopped");
  assert.equal(srv.open(), 0);

  const ro = make({ on: { mode: (m) => seen.modes.push(m) } });
  ro.srv.mode = "update_required";
  ro.conn.start();
  await settle();
  assert.equal(ro.conn.status(), "read_only");
  assert.deepEqual(seen.modes, ["update_required"]);
  ro.conn.stop();
});

test("heartbeat: a hb with the cursor goes out every 15 s while the server answers", async () => {
  const { srv, sched, conn, state } = make();
  state.cursor = 12;
  conn.start();
  await settle();
  for (let i = 0; i < 4; i++) { sched.advance(HEARTBEAT_MS); await settle(); }
  const hb = srv.got("hb") as { seq: number }[];
  assert.equal(hb.length, 4);
  assert.ok(hb.every((h) => h.seq === 12));
  assert.equal(conn.status(), "live");
  assert.equal(conn.stats().failovers, 0, "answered heartbeats keep the endpoint");
  conn.stop();
});

test("silence for 40 s marks the endpoint down and fails over to the other, resuming from the cursor", async () => {
  const { srv, sched, conn, state } = make();
  conn.start();
  await settle();
  srv.broadcast(ev(3, [1, 2, 3]));
  await settle();
  const first = conn.endpoint()!.url;
  const other = first === "wss://a" ? "wss://b" : "wss://a";
  srv.blackhole(first);
  for (let t = 0; t < HEARTBEAT_DEAD_MS + HEARTBEAT_MS; t += HEARTBEAT_MS) { sched.advance(HEARTBEAT_MS); await settle(); }
  assert.equal(conn.status(), "live");
  assert.equal(conn.endpoint()?.url, other);
  assert.equal(conn.stats().failovers, 1);
  assert.equal(conn.endpoints().find((e) => e.url === first)!.health, "down");
  const resumed = srv.sockets.filter((s) => s.url === other).flatMap((s) => s.hellos.map((h) => h.cursor));
  assert.equal(resumed.at(-1), 3, "hello on the new endpoint carries the applied cursor");
  assert.equal(state.cursor, 3);
  conn.stop();
});
