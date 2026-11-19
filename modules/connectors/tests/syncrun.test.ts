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
  const state: { fail?: string; noConn?: number; summary: string } = { summary: "Will create 4 records here." };
  const engine = {
    run: async (_c, b, o): Promise<RunReport> => {
      passes.push({ type: b.type, mode: o.mode });
      if (state.noConn) {
        state.noConn--;
        throw { error: { code: "validation.not_found", message: "There is no such connection." } };
      }
      if (state.fail) throw { error: { code: "provider.unavailable", message: state.fail } };
      return { summary: state.summary, pulled: 4, pushed: 0, skipped: 0, conflicts: 0, dryRun: o.mode === "dry_run" };
    },
  } as unknown as SyncEngine;
  w.k.deps.engine = engine;
  w.k.deps.missingWaitsMs = [0, 0, 0];
  const scheduled: { at: number | string; cap: string; input: any }[] = [];
  const ctx: ConnectorsCtx = {
    ...w.ctx,
    schedule: async (at, cap, input) => {
      scheduled.push({ at, cap, input });
      return `sch_${scheduled.length}`;
    },
  };
  await w.k.hs["sync_specs.apply"](ctx, { spec: ledgerSpec(), idempotencyKey: "r1" });
  return { ...w, ctx, passes, scheduled, state };
}
const finishes = (calls: { cap: string; input: any }[]) =>
  calls.filter((c) => c.cap === "runs.finish").map((c) => c.input);

test("sync_now schedules the pass; sync_run runs every type and finishes the Run", async () => {
  const w = await setup();
  assert.deepEqual(
    w.scheduled.filter((s) => s.cap === "connectors.sync_run").map((s) => s.input.runId),
    ["run_1", "run_2"],
    "apply started the first pull of both types",
  );
  const run = await w.k.hs["connectors.sync_run"](w.ctx, { runId: "run_2" });
  assert.equal(run.ok, true);
  assert.deepEqual(w.passes, [{ type: "person", mode: "incremental" }]);
  assert.deepEqual(
    finishes(w.calls).map((f) => [f.runId, f.status]),
    [["run_2", "succeeded"]],
  );
  assert.match(finishes(w.calls)[0].summary, /person: Will create 4 records here\./);
});

test("a failing app fails the Run, says why in the log, and the poll goes on", async () => {
  const w = await setup();
  w.state.fail = "The app answered 503.";
  const run = await w.k.hs["connectors.sync_run"](w.ctx, { runId: "run_2" });
  assert.equal(run.ok, false);
  assert.deepEqual(finishes(w.calls)[0], {
    runId: "run_2",
    status: "failed",
    error: { code: "provider.unavailable", message: "The app answered 503." },
  });
  const log = (await w.k.hs["sync_types.log"](w.ctx, { type: "person" })).entries;
  assert.equal(log[0]!.kind, "error");
  assert.match(log[0]!.summary, /sync of person failed: The app answered 503\./);
});

test("polling is one chain: a pass plans one poll, a poll plans the next, a pause ends it, a resume starts it", async () => {
  const w = await setup();
  await w.k.hs["connectors.sync_run"](w.ctx, { runId: "run_1" });
  await w.k.hs["connectors.sync_run"](w.ctx, { runId: "run_2" });
  const polls = () => w.scheduled.filter((s) => s.cap === "connectors.sync_poll");
  assert.deepEqual(
    polls().map((p) => p.input.type),
    ["org", "person"],
  );
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
  const r = await w.k.hs["connectors.sync_now"](w.ctx, {
    type: "person",
    mode: "dry_run",
    idempotencyKey: "d1",
  } as never);
  await w.k.hs["connectors.sync_run"](w.ctx, { runId: r.runId });
  assert.equal(w.scheduled.filter((s) => s.cap === "connectors.sync_poll").length, 0);
  assert.equal(w.scheduled.length, now + 1, "only the pass itself was scheduled");
});

test("a pass that cannot use the type's connection says why in plain words, not a bare 'no such connection'", async () => {
  const gone = await setup();
  gone.k.tx.run("DELETE FROM cn_connections");
  const a = await gone.k.hs["connectors.sync_run"](gone.ctx, { runId: "run_2" });
  assert.equal(a.ok, false);
  assert.match(a.summary, /connection for person was deleted: bind it to another connection first/);
  assert.deepEqual(gone.passes, [], "the engine was not asked");
  const log = (await gone.k.hs["sync_types.log"](gone.ctx, { type: "person" })).entries;
  assert.match(log[0]!.summary, /was deleted/);

  const foreign = await setup();
  foreign.k.tx.run("UPDATE cn_connections SET owner_kind = 'person', owner_id = 'usr_someone_else'");
  const b = await foreign.k.hs["connectors.sync_run"](foreign.ctx, { runId: "run_2" });
  assert.equal(b.ok, false);
  assert.match(b.summary, /belongs to someone else, so this pass could not use it/);
  assert.deepEqual(foreign.passes, []);
});

test("a pass told 'no such connection' for a connection that exists waits and asks again; it never ends as a missing connection", async () => {
  const brief = await setup();
  brief.state.noConn = 2;
  const ok = await brief.k.hs["connectors.sync_run"](brief.ctx, { runId: "run_2" });
  assert.equal(ok.ok, true, "the refusal was for a moment; the third ask went through");
  assert.equal(brief.passes.length, 3);
  const stuck = await setup();
  stuck.state.noConn = 99;
  const run = await stuck.k.hs["connectors.sync_run"](stuck.ctx, { runId: "run_2" });
  assert.equal(run.ok, false);
  assert.match(run.summary, /connection for person is there, but this pass could not use it just now/);
  assert.doesNotMatch(run.summary, /no such connection/i);
  assert.equal(stuck.passes.length, 4, "the first ask and three more");
  const poll = await stuck.k.hs["connectors.sync_poll"](stuck.ctx, { type: "person" });
  assert.equal(poll.ran, false);
  const log = (await stuck.k.hs["sync_types.log"](stuck.ctx, { type: "person" })).entries;
  assert.doesNotMatch(log[0]!.summary, /no such connection/i);
});

test("a pass for a person's connection that someone else runs says the connection belongs to someone else", async () => {
  const w = await setup();
  w.state.noConn = 99;
  w.k.tx.run("UPDATE cn_connections SET owner_kind = 'person', owner_id = 'usr_other'");
  const other = { ...w.ctx, actor: "usr_me" } as ConnectorsCtx;
  w.k.tx.run("DELETE FROM cn_sync_running"); // the first pulls the apply asked for are over: no other pass is on its way on this connection
  const poll = await w.k.hs["connectors.sync_poll"](other, { type: "person" });
  assert.equal(poll.ran, false);
  const log = (await w.k.hs["sync_types.log"]({ ...w.ctx, actor: "usr_other" } as ConnectorsCtx, { type: "person" }))
    .entries;
  assert.match(log[0]!.summary, /belongs to someone else/);
});

const asServer = (
  w: Awaited<ReturnType<typeof setup>>,
  jobs: { cap: string; input: unknown; as: string | undefined }[],
  refuse?: string,
) =>
  ({
    ...w.ctx,
    actor: "svc_host",
    trusted: true,
    schedule: async (_at: number | string, cap: string, input: unknown, opts?: { as?: string }) => {
      if (refuse) throw { error: { message: refuse } };
      jobs.push({ cap, input, as: opts?.as });
      return "sch_x";
    },
  }) as unknown as ConnectorsCtx;

test("a poll queued as the server before the update is handed to the person who set the sync up, and the server never runs the pass", async () => {
  const w = await setup();
  w.k.tx.run("UPDATE cn_sync_specs SET applied_by = 'usr_dana'");
  const jobs: { cap: string; input: unknown; as: string | undefined }[] = [];
  const before = w.passes.length;
  const out = await w.k.hs["connectors.sync_poll"](asServer(w, jobs), { type: "person" });
  assert.equal(out.ran, false);
  assert.deepEqual(jobs, [{ cap: "connectors.sync_poll", input: { type: "person" }, as: "usr_dana" }]);
  assert.equal(w.passes.length, before, "the engine was not asked");
});

test("a run queued as the server is handed over the same way; one nobody can run ends failed in plain words", async () => {
  const w = await setup();
  w.k.tx.run("UPDATE cn_sync_specs SET applied_by = 'usr_dana'");
  const jobs: { cap: string; input: unknown; as: string | undefined }[] = [];
  const before = w.passes.length;
  const ok = await w.k.hs["connectors.sync_run"](asServer(w, jobs), { runId: "run_2" });
  assert.equal(ok.ok, true);
  assert.deepEqual(jobs, [{ cap: "connectors.sync_run", input: { runId: "run_2" }, as: "usr_dana" }]);
  assert.equal(w.passes.length, before);
  const sorry = "Syncing is paused: Dana set this up and can no longer run it. An admin can take it over.";
  const none: { cap: string; input: unknown; as: string | undefined }[] = [];
  const stopped = await w.k.hs["connectors.sync_run"](asServer(w, none, sorry), { runId: "run_2" });
  assert.equal(stopped.ok, false);
  assert.equal(stopped.summary, sorry);
  assert.deepEqual(finishes(w.calls).at(-1), {
    runId: "run_2",
    status: "failed",
    error: { code: "provider.unavailable", message: sorry },
  });
  assert.equal(w.passes.length, before);
});

test("a poll the server cannot hand to anyone ends its chain and says why, instead of failing every few minutes", async () => {
  const w = await setup();
  w.k.tx.run("UPDATE cn_sync_specs SET applied_by = 'svc_host'");
  w.k.tx.run("UPDATE cn_synced_types SET created_by = NULL");
  const jobs: { cap: string; input: unknown; as: string | undefined }[] = [];
  const out = await w.k.hs["connectors.sync_poll"](asServer(w, jobs), { type: "person" });
  assert.equal(out.ran, false);
  assert.deepEqual(jobs, []);
  assert.equal(
    w.k.tx.all(
      "SELECT * FROM cn_sync_poll WHERE sync_type_id = (SELECT sync_type_id FROM cn_synced_types WHERE type = 'person')",
    ).length,
    0,
    "no poll is left waiting: the cadence plans the type again when someone can run it",
  );
  const log = (await w.k.hs["sync_types.log"](w.ctx, { type: "person" })).entries;
  assert.match(log[0]!.summary, /^Syncing is paused/);
});

test("a poll that finds another pass on its way on the same connection waits its turn and looks again in a few seconds", async () => {
  const w = await setup();
  const before = w.passes.length;
  const poll = await w.k.hs["connectors.sync_poll"](w.ctx, { type: "person" });
  assert.equal(poll.ran, false);
  assert.equal(w.passes.length, before, "no second pass on the connection");
  const next = w.k.tx.get<{ at: number }>(
    "SELECT at FROM cn_sync_poll WHERE sync_type_id = (SELECT sync_type_id FROM cn_synced_types WHERE type = 'person')",
  )!;
  assert.ok(next.at > w.k.clock.t && next.at - w.k.clock.t < 30_000, "the poll was planned again soon");
});
