// The periodic driver for synced types (spec 2.10), on a fake clock: due types get a pass, types with a poll coming do not, a failing app is asked less and less often, a pass that is running is not
// started twice, and a paused type or a broken connection is left alone. Real connectors handlers; only the app (the engine) and the clock are fakes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { world } from "../fixtures/crm-world.ts";
import { NOW } from "../fixtures/kit.ts";
import { ledgerSpec } from "../fixtures/crm.ts";
import type { RunReport, SyncEngine } from "../handlers/sync.ts";
import type { ConnectorsCtx } from "../projections.ts";
import { dueSyncs, runCadence, RUN_STALE_MS } from "../handlers/cadence.ts";

const SOURCES_SQL = readFileSync(new URL("../../sources/migrations/0001_sources.sql", import.meta.url), "utf8");
const MIN = 60_000;

async function setup() {
  const w = world();
  w.k.tx.exec(SOURCES_SQL);
  const state: { fail?: string } = {};
  const passes: { type: string; at: number }[] = [];
  w.k.deps.engine = {
    run: async (_c, b, o): Promise<RunReport> => {
      passes.push({ type: b.type, at: w.k.clock.t });
      if (state.fail) throw { error: { code: "provider.unavailable", message: state.fail } };
      return { summary: "ok", pulled: 1, pushed: 0, skipped: 0, conflicts: 0, dryRun: o.mode === "dry_run" };
    },
  } as unknown as SyncEngine;
  const scheduled: { at: number | string; cap: string; input: any }[] = [];
  const ctx: ConnectorsCtx = { ...w.ctx, schedule: async (at, cap, input) => { scheduled.push({ at, cap, input }); return `sch_${scheduled.length}`; } };
  await w.k.hs["sync_specs.apply"](ctx, { spec: ledgerSpec(), idempotencyKey: "c1" });
  // the same pace for both types (120 s in use, 900 s idle, 3600 s dormant), so the arithmetic below does not depend on the spec's own choice for each
  for (const type of ["person", "org"]) await w.k.hs["sync_types.update"](ctx, { type, polling: { activeSec: 120, idleSec: 900, dormantSec: 3600 } });
  // the first pulls the apply asked for finish, which plans the first polls
  for (const r of w.k.tx.all<{ run_id: string }>("SELECT run_id FROM cn_sync_requests ORDER BY at, rowid")) await w.k.hs["connectors.sync_run"](ctx, { runId: r.run_id });
  const asked: any[] = [];
  const tick = async () => runCadence({ tx: w.k.tx, now: () => w.k.clock.t, call: async (cap, input) => { asked.push(input); return w.k.hs["connectors.sync_now"](ctx, input as never); } });
  const finish = async (runId: string) => w.k.hs["connectors.sync_run"](ctx, { runId });
  const connectionOf = (type: string): string => w.k.tx.get<{ connection_id: string }>("SELECT connection_id FROM cn_synced_types WHERE type = ?", type)!.connection_id;
  return { ...w, ctx, state, passes, scheduled, asked, tick, finish, connectionOf };
}
const dropChains = (w: Awaited<ReturnType<typeof setup>>): void => { w.k.tx.run("DELETE FROM cn_sync_poll"); };

test("a type whose poll is still coming is left alone; one whose poll was lost is started once it is due", async () => {
  const w = await setup();
  assert.equal(w.k.tx.all("SELECT * FROM cn_sync_poll").length, 2, "the first pulls planned a poll each");
  w.k.clock.t = NOW + 14 * MIN;
  assert.deepEqual(await w.tick(), [], "not due: the chain is alive and the interval has not passed");
  w.k.clock.t = NOW + 16 * MIN;
  assert.deepEqual(await w.tick(), [], "the poll is late by under its grace: the chain still counts as alive");
  w.k.clock.t = NOW + 21 * MIN;
  const started = await w.tick();
  assert.equal(started.length, 1, "the poll never came: one pass is started");
  assert.equal(w.asked[0].mode, "incremental");
  assert.match(w.asked[0].idempotencyKey, /^cadence:/);
  const stillDue = dueSyncs({ tx: w.k.tx, now: () => w.k.clock.t }).map((d) => d.type);
  assert.deepEqual(stillDue, [], "types on the same connection wait their turn: the connection has a pass on its way");
  // once that pass ends and plans its poll, the next tick starts the other type's pass
  const run = w.k.tx.get<{ run_id: string }>("SELECT run_id FROM cn_sync_requests ORDER BY at DESC, rowid DESC")!.run_id;
  await w.finish(run);
  assert.equal((await w.tick()).length, 1, "the other type goes on the next tick");
});

test("a pass that is running on a connection is never started twice; a pass that died stops blocking after a while", async () => {
  const w = await setup();
  dropChains(w);
  w.k.clock.t = NOW + 20 * MIN;
  const first = await w.tick();
  assert.equal(first.length, 1);
  const passesBefore = w.asked.length;
  w.k.clock.t += 5 * MIN;
  assert.deepEqual(await w.tick(), [], "the pass has not ended: nothing else starts on its connection");
  assert.equal(w.asked.length, passesBefore);
  // it ends: the mark clears
  const run = w.k.tx.get<{ run_id: string }>("SELECT run_id FROM cn_sync_requests ORDER BY at DESC, rowid DESC")!.run_id;
  await w.finish(run);
  assert.equal(w.k.tx.all("SELECT * FROM cn_sync_running").length, 0, "the finished pass cleared its mark");
  // a pass that never ends (its job was lost): after the stale time the connection is free again
  dropChains(w);
  w.k.clock.t += 20 * MIN;
  const again = await w.tick();
  assert.equal(again.length, 1);
  w.k.clock.t += RUN_STALE_MS - MIN;
  assert.deepEqual(await w.tick(), [], "still inside the stale time");
  w.k.clock.t += 2 * MIN;
  assert.equal((await w.tick()).length, 1, "the dead pass no longer blocks");
});

test("a failing app is asked less and less often, up to once an hour, and a success starts it again at the normal pace", async () => {
  const w = await setup();
  dropChains(w);
  w.state.fail = "The app answered 503.";
  // only the person type: the other is paused so the connection's turn is not shared
  await w.k.hs["sync_types.pause"](w.ctx, { type: "org" });
  w.k.clock.t = NOW + 20 * MIN;
  const gaps: number[] = [];
  let last = w.k.clock.t;
  for (let i = 0; i < 5; i++) {
    const started = await w.tick();
    assert.equal(started.length, 1, `attempt ${i + 1} starts`);
    const run = w.k.tx.get<{ run_id: string }>("SELECT run_id FROM cn_sync_requests ORDER BY at DESC, rowid DESC")!.run_id;
    const out = await w.finish(run);
    assert.equal(out.ok, false);
    const next = w.k.tx.get<{ next_at: number }>("SELECT next_at FROM cn_sync_guard WHERE sync_type_id = (SELECT sync_type_id FROM cn_synced_types WHERE type = 'person')")!.next_at;
    gaps.push((next - w.k.clock.t) / MIN);
    // one minute before it may try again nothing starts; at the time it does
    w.k.clock.t = next - MIN;
    assert.deepEqual(await w.tick(), [], "waiting out the backoff");
    w.k.clock.t = next;
    last = next;
  }
  assert.deepEqual(gaps, [15, 30, 60, 60, 60], "15 minutes, doubling, never past an hour");
  // the app is back: the pass works, the count clears and the chain is planned again
  w.state.fail = undefined;
  const started = await w.tick();
  assert.equal(started.length, 1);
  await w.finish(w.k.tx.get<{ run_id: string }>("SELECT run_id FROM cn_sync_requests ORDER BY at DESC, rowid DESC")!.run_id);
  assert.equal(w.k.tx.get<{ failures: number }>("SELECT failures FROM cn_sync_guard WHERE sync_type_id = (SELECT sync_type_id FROM cn_synced_types WHERE type = 'person')")!.failures, 0);
  assert.ok(w.k.tx.get("SELECT 1 AS x FROM cn_sync_poll WHERE sync_type_id = (SELECT sync_type_id FROM cn_synced_types WHERE type = 'person')"), "the poll chain is back");
  assert.ok(last > 0);
});

test("a failing poll in the chain waits out the same backoff", async () => {
  const w = await setup();
  w.state.fail = "The app answered 503.";
  w.k.clock.t = NOW + 16 * MIN;
  const before = w.passes.length;
  await w.k.hs["connectors.sync_poll"](w.ctx, { type: "person" });
  assert.equal(w.passes.length, before + 1);
  const poll = w.k.tx.get<{ at: number }>("SELECT at FROM cn_sync_poll WHERE sync_type_id = (SELECT sync_type_id FROM cn_synced_types WHERE type = 'person')")!.at;
  assert.equal(poll - w.k.clock.t, 15 * MIN, "first failure: the next poll is one idle interval away");
  w.k.clock.t = poll;
  await w.k.hs["connectors.sync_poll"](w.ctx, { type: "person" });
  const next = w.k.tx.get<{ at: number }>("SELECT at FROM cn_sync_poll WHERE sync_type_id = (SELECT sync_type_id FROM cn_synced_types WHERE type = 'person')")!.at;
  assert.equal(next - w.k.clock.t, 30 * MIN, "second failure in a row: twice as long");
});

test("nothing starts for a paused type or a paused, pending or broken connection", async () => {
  const w = await setup();
  dropChains(w);
  w.k.clock.t = NOW + 30 * MIN;
  await w.k.hs["sync_types.pause"](w.ctx, { type: "person" });
  await w.k.hs["sync_types.pause"](w.ctx, { type: "org" });
  dropChains(w);
  assert.deepEqual(await w.tick(), [], "both types paused");
  await w.k.hs["sync_types.resume"](w.ctx, { type: "person" });
  await w.k.hs["sync_types.resume"](w.ctx, { type: "org" });
  dropChains(w);
  for (const state of ["paused", "pending", "needs_reconnect"]) {
    w.k.tx.run("UPDATE cn_connections SET state = ? WHERE connection_id = ?", state, w.connectionOf("person"));
    assert.deepEqual(await w.tick(), [], `connection ${state}`);
  }
  w.k.tx.run("DELETE FROM cn_connections WHERE connection_id = ?", w.connectionOf("person"));
  assert.deepEqual(await w.tick(), [], "connection gone");
  assert.equal(w.asked.length, 0);
});
