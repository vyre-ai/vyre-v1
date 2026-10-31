// The pass behind sync_now: a scheduled sync_run asks the engine for each type and finishes the Run, a failing app fails the Run and shows in the log, and polling is one chain
// that a pause ends and a resume starts again.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { world } from "../fixtures/crm-world.ts";
import type { RunReport, SyncEngine } from "../handlers/sync.ts";
import type { ConnectorsCtx } from "../projections.ts";
import { ledgerSpec } from "../fixtures/crm.ts";

const SOURCES_SQL = readFileSync(new URL("../../sources/migrations/0001_sources.sql", import.meta.url), "utf8");

async function setup() {
  const w = world();
  w.k.tx.exec(SOURCES_SQL);
  const passes: { type: string; mode: string }[] = [];
  const state: { fail?: string; summary: string } = { summary: "Will create 4 records here." };
  const engine = {
    run: async (_c, b, o): Promise<RunReport> => {
      passes.push({ type: b.type, mode: o.mode });
      if (state.fail) throw { error: { code: "provider.unavailable", message: state.fail } };
      return { summary: state.summary, pulled: 4, pushed: 0, skipped: 0, conflicts: 0, dryRun: o.mode === "dry_run" };
    },
  } as unknown as SyncEngine;
  w.k.deps.engine = engine;
  const scheduled: { at: number | string; cap: string; input: any }[] = [];
  const ctx: ConnectorsCtx = { ...w.ctx, schedule: async (at, cap, input) => { scheduled.push({ at, cap, input }); return `sch_${scheduled.length}`; } };
  await w.k.hs["sync_specs.apply"](ctx, { spec: ledgerSpec(), idempotencyKey: "r1" });
  return { ...w, ctx, passes, scheduled, state };
}
const finishes = (calls: { cap: string; input: any }[]) => calls.filter((c) => c.cap === "runs.finish").map((c) => c.input);

test("sync_now schedules the pass; sync_run runs every type and finishes the Run", async () => {
  const w = await setup();
  assert.deepEqual(w.scheduled.filter((s) => s.cap === "connectors.sync_run").map((s) => s.input.runId), ["run_1", "run_2"], "apply started the first pull of both types");
  const run = await w.k.hs["connectors.sync_run"](w.ctx, { runId: "run_2" });
  assert.equal(run.ok, true);
  assert.deepEqual(w.passes, [{ type: "person", mode: "incremental" }]);
  assert.deepEqual(finishes(w.calls).map((f) => [f.runId, f.status]), [["run_2", "succeeded"]]);
  assert.match(finishes(w.calls)[0].summary, /person: Will create 4 records here\./);
});

test("a failing app fails the Run, says why in the log, and the poll goes on", async () => {
  const w = await setup();
  w.state.fail = "The app answered 503.";
  const run = await w.k.hs["connectors.sync_run"](w.ctx, { runId: "run_2" });
  assert.equal(run.ok, false);
  assert.deepEqual(finishes(w.calls)[0], { runId: "run_2", status: "failed", error: { code: "provider.unavailable", message: "The app answered 503." } });
  const log = (await w.k.hs["sync_types.log"](w.ctx, { type: "person" })).entries;
  assert.equal(log[0]!.kind, "error");
  assert.match(log[0]!.summary, /sync of person failed: The app answered 503\./);
});

test("polling is one chain: a pass plans one poll, a poll plans the next, a pause ends it, a resume starts it", async () => {
  const w = await setup();
  await w.k.hs["connectors.sync_run"](w.ctx, { runId: "run_1" });
  await w.k.hs["connectors.sync_run"](w.ctx, { runId: "run_2" });
  const polls = () => w.scheduled.filter((s) => s.cap === "connectors.sync_poll");
  assert.deepEqual(polls().map((p) => p.input.type), ["org", "person"]);
  // a second pass before the poll is due plans nothing more
  await w.k.hs["connectors.sync_run"](w.ctx, { runId: "run_2" });
  assert.equal(polls().length, 2);
  // the poll runs a pass and plans the next one at the idle interval
  const before = w.passes.length;
  const ran = await w.k.hs["connectors.sync_poll"](w.ctx, { type: "person" });
  assert.equal(ran.ran, true);
  assert.equal(w.passes.length, before + 1);
  assert.equal(polls().length, 3);
  assert.equal((polls()[2]!.at as number) - (polls()[1]!.at as number) >= 0, true);
  // pause: the poll in flight does nothing and plans nothing
  await w.k.hs["sync_types.pause"](w.ctx, { type: "person" });
  const quiet = await w.k.hs["connectors.sync_poll"](w.ctx, { type: "person" });
  assert.equal(quiet.ran, false);
  assert.equal(polls().length, 3);
  await w.k.hs["sync_types.resume"](w.ctx, { type: "person" });
  assert.equal(polls().length, 4);
  assert.equal((await w.k.hs["connectors.sync_poll"](w.ctx, { type: "nothing" })).ran, false);
});

test("a dry run reports and plans no poll", async () => {
  const w = await setup();
  const now = w.scheduled.length;
  const r = await w.k.hs["connectors.sync_now"](w.ctx, { type: "person", mode: "dry_run", idempotencyKey: "d1" } as never);
  await w.k.hs["connectors.sync_run"](w.ctx, { runId: r.runId });
  assert.equal(w.scheduled.filter((s) => s.cap === "connectors.sync_poll").length, 0);
  assert.equal(w.scheduled.length, now + 1, "only the pass itself was scheduled");
});
