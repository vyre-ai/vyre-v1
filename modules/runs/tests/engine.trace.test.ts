// Golden flow 14, the Run part (spec 2.13, ARCH 4.9): a purge Run of 14 capability steps completes, and everything it did carries one trace id.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, TRACE } from "../fixtures/db.ts";
import { engine, newRun } from "../fixtures/seed.ts";
import { drive } from "../handlers/engine.ts";
import type { PlanStep } from "../handlers/engine.ts";
import { allSteps } from "../projections.ts";

const PURGE: { id: string; cap: string }[] = [
  { id: "revoke_grant", cap: "access.grants.revoke" }, { id: "bump_epoch", cap: "sync.bump_epoch" }, { id: "scope_changed", cap: "sync.rescope" },
  { id: "drop_records", cap: "sync.purge_rows" }, { id: "drop_files", cap: "sync.purge_files" }, { id: "drop_chats", cap: "sync.purge_threads" },
  { id: "drop_search", cap: "search.purge_index" }, { id: "drop_memory", cap: "memory.purge_cache" }, { id: "clear_outbox", cap: "sync.clear_outbox" },
  { id: "end_sessions", cap: "devices.end_sessions" }, { id: "wipe_keys", cap: "sync.wipe_keys" }, { id: "audit", cap: "audit.record" },
  { id: "verify_empty", cap: "sync.verify_empty" }, { id: "notify", cap: "notifications.notify" },
];

test("a purge Run of 14 capability steps completes with one trace id from the Run row to every step and event", async () => {
  const h = harness();
  const called: string[] = [];
  for (const p of PURGE) h.callee(p.cap, () => { called.push(p.cap); return { done: true }; });
  const id = (await h.call("runs.start", newRun({ kind: "runbook", name: "Purge revoked device" }), engine)).runId as string;
  const plan: PlanStep[] = PURGE.map((p) => ({ id: p.id, effects: "write" }));
  const caps = new Map(PURGE.map((p) => [p.id, p.cap] as const));
  const r = await h.engineRun(engine, (ctx) => drive(ctx, id, plan, async (s, c) => ({ output: await ctx.call!(caps.get(s.id)!, { key: c.key }) })));
  assert.deepEqual(r, { status: "succeeded" });
  assert.deepEqual(called, PURGE.map((p) => p.cap));

  const run = (await h.call("runs.get", { runId: id }, engine)).run;
  assert.equal(run.status, "succeeded");
  assert.equal(run.traceId, TRACE);
  const rows = allSteps(h.db, id);
  assert.equal(rows.length, 14);
  assert.ok(rows.every((s) => s.state === "succeeded" && s.attempt === 1));
  const spans = rows.map((s) => s.traceSpan);
  assert.ok(spans.every((s) => typeof s === "string" && /^[0-9a-f]{16}$/.test(s)), "each step has a span id");
  assert.equal(new Set(spans).size, 14, "and its own");
  assert.ok(h.allEvents.length >= 2);
  assert.ok(h.allEvents.every((e) => e.traceId === TRACE), "every event is on the one trace");
});
