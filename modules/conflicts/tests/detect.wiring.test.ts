// The module entry (impl.ts): every capability of the manifest has a handler, the consumer reads conflict.opened, and the two sync.push dependencies work through the entry.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../../../generated/registry.ts";
import { consumers, handlers, onConflictOpened, openConflict, recordHistory, setPorts } from "../impl.ts";
import { collision, harness, seedRecord } from "../fixtures/harness.ts";
import type { CfCtx } from "../projections.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { HookEvent } from "../../../host/src/daemon/consumers.ts";

test("impl.ts has a handler for every capability of the conflicts manifest, and no others", () => {
  const caps = registry.capabilities.filter((c) => c.name.startsWith("conflicts.")).map((c) => c.name);
  assert.equal(caps.length, 11);
  assert.deepEqual(Object.keys(handlers).sort(), [...new Set(caps)].sort());
  for (const h of Object.values(handlers)) assert.equal(typeof h, "function");
});

test("the conflicts.route consumer reads conflict.opened and routes the parked conflict", async () => {
  setPorts(null);
  const c = consumers["conflicts.route"];
  assert.deepEqual(c.on, ["conflict.opened"]);
  const h = harness();
  seedRecord(h, "rec_acme", { note: "Call Bea" });
  const id = openConflict(h.ctx, collision({ field: "note", ours: "Call Bea", theirs: "Call Bea tomorrow", opId: "op_wire" }));
  recordHistory(h.ctx, { entity: "client_plan", id: "rec_acme", field: "note", value: "older", hlc: "000000000001-0001-dev1", actor: "usr_bea", seq: 1, reason: "lww_loser" });
  const ev = { payload: { conflictId: id } } as unknown as HookEvent;
  const out = (await c.run(h.ctx as unknown as Ctx, ev)) as { route: string };
  assert.equal(out.route, "assistant");
  assert.equal(h.records.get("rec_acme")?.["note"], "Call Bea tomorrow");
  assert.equal((await onConflictOpened(h.ctx as CfCtx, { conflictId: id })).route, "skipped");
});
