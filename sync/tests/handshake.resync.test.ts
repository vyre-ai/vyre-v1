// P-L1_13 (ARCH 5.2): the device side of the handshake. update_required makes the device read-only with a banner; resync drops the replica and takes a snapshot, once however often it is asked, and
// goes live; a failed resync keeps the device usable and retryable; purge hands over to the purge client; the outbox is never touched by any of it.
import test from "node:test";
import assert from "node:assert/strict";
import type { HelloOk } from "../src/protocol.ts";
import { createModeMachine } from "../src/handshake/index.ts";
import type { ModeState, Resync } from "../src/handshake/index.ts";

const TRACE = "0123456789abcdef0123456789abcdef";
const ok = (mode: HelloOk["mode"], over: Partial<HelloOk> = {}): HelloOk => ({ serverVersion: "1.4.0", epoch: 3, serverHlc: "0000000000ff-0001-srv", mode, head: 50, entityVersions: {}, ...over });
const errCode = (e: unknown): string | undefined => (e as { error?: { code?: string } }).error?.code;

function resyncRig(failAt?: "drop" | "snapshot") {
  const log: string[] = [];
  const gate: { release: () => void } = { release: () => undefined };
  const wait = new Promise<void>((r) => { gate.release = r; });
  const resync: Resync = {
    async dropReplica() { log.push("drop"); await wait; if (failAt === "drop") throw new Error("disk full"); },
    async snapshot() { log.push("snapshot"); if (failAt === "snapshot") throw new Error("offline"); },
  };
  return { log, resync, gate };
}

test("live: writes are allowed, there is no banner", async () => {
  const m = createModeMachine({ appVersion: "1.4.0" });
  assert.equal(m.state().mode, "starting");
  const s = await m.apply(ok("live"));
  assert.deepEqual([s.mode, s.readOnly, s.banner], ["live", false, null]);
  assert.doesNotThrow(() => m.guardWrite(TRACE));
});

test("update_required: read-only with an Update banner, writes throw permission.update_required, an update lifts it", async () => {
  const seen: ModeState[] = [];
  const m = createModeMachine({ appVersion: "1.0.0", onChange: (s) => { seen.push(s); } });
  const s = await m.apply(ok("update_required"));
  assert.equal(s.readOnly, true);
  assert.equal(s.banner?.title, "Update required");
  assert.equal(s.banner?.action, "Update");
  assert.match(s.banner?.body ?? "", /read everything/);
  assert.throws(() => m.guardWrite(TRACE), (e) => errCode(e) === "permission.update_required");
  assert.equal(seen.at(-1)?.mode, "update_required");
  // The app was updated and reconnected.
  const again = createModeMachine({ appVersion: "1.4.0" });
  await again.apply(ok("live"));
  assert.doesNotThrow(() => again.guardWrite(TRACE));
  const lifted = await m.apply(ok("live"));
  assert.deepEqual([lifted.readOnly, lifted.banner], [false, null]);
  assert.doesNotThrow(() => m.guardWrite(TRACE));
});

test("resync drops the replica then takes the snapshot, in that order, once however often it is asked; then live", async () => {
  const r = resyncRig();
  const states: string[] = [];
  const m = createModeMachine({ appVersion: "1.4.0", resync: r.resync, onChange: (s) => { states.push(s.mode); } });
  const a = m.apply(ok("resync"));
  const b = m.apply(ok("resync"));
  assert.equal(m.state().mode, "resyncing");
  assert.equal(a, b, "a second hello during the resync joins the first");
  r.gate.release();
  const done = await a;
  assert.deepEqual(r.log, ["drop", "snapshot"]);
  assert.equal(done.mode, "live");
  assert.deepEqual(states, ["resyncing", "live"]);
  // A later drift resyncs again.
  const r2 = await m.apply(ok("resync"));
  assert.deepEqual(r.log, ["drop", "snapshot", "drop", "snapshot"]);
  assert.equal(r2.mode, "live");
});

test("a failed resync leaves the device in resync_failed with a Try again banner and its writes allowed; the next hello retries", async () => {
  for (const at of ["drop", "snapshot"] as const) {
    const r = resyncRig(at);
    r.gate.release();
    const m = createModeMachine({ appVersion: "1.4.0", resync: r.resync });
    const s = await m.apply(ok("resync"));
    assert.equal(s.mode, "resync_failed");
    assert.equal(s.banner?.action, "Try again");
    assert.equal(s.readOnly, false, "the outbox is untouched, the person can keep working");
    assert.deepEqual(r.log, at === "drop" ? ["drop"] : ["drop", "snapshot"]);
    const retry = await m.apply(ok("resync"));
    assert.equal(retry.mode, "resync_failed");
    assert.equal(r.log.filter((x) => x === "drop").length, 2, "a new hello tries again");
  }
});

test("resync with nothing to resync with is a failure the shell can show, never a silent skip", async () => {
  const m = createModeMachine({ appVersion: "1.4.0" });
  assert.equal((await m.apply(ok("resync"))).mode, "resync_failed");
});

test("purge hands over to the purge client with the epoch; a dropped connection returns to starting but never interrupts a resync or a purge", async () => {
  const purged: number[] = [];
  const r = resyncRig();
  const m = createModeMachine({ appVersion: "1.4.0", resync: r.resync, onPurge: (e) => { purged.push(e); } });
  await m.apply(ok("live"));
  m.disconnected();
  assert.equal(m.state().mode, "starting");
  const pending = m.apply(ok("resync"));
  m.disconnected();
  assert.equal(m.state().mode, "resyncing");
  r.gate.release();
  await pending;
  const p = await m.apply(ok("purge", { epoch: 9 }));
  assert.equal(p.mode, "purge");
  assert.deepEqual(purged, [9]);
  m.disconnected();
  assert.equal(m.state().mode, "purge");
});
