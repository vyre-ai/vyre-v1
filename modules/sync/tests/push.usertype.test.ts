// A record type of the Space's own can protect a field (P-GF_04): the push policy and the Restricted rule come from the type definition in the Space store, through pushDepsOf.
// Two devices edit one field from the same base: a field with merge "assistant" or protected opens a conflict, a plain field does not, and a sealed field opens one with plainChoice set so
// the conflicts module never sends it to an AI provider (modules/conflicts/tests/detect.test.ts covers what the conflicts side does with plainChoice).
import test from "node:test";
import assert from "node:assert/strict";
import { ensureHostTables, pushDepsOf } from "../handlers/host.ts";
import type { SyncHostSeam } from "../handlers/host.ts";
import { createPushHandlers } from "../handlers/push.ts";
import type { ConflictOpen } from "../../../sync/src/server/push/index.ts";
import { ctx, hl, NOW, patchOp, pushRig } from "./push.rig.test.ts";

function setup() {
  const r = pushRig();
  const db = r.s.deps.db;
  ensureHostTables(db);
  db.exec("CREATE TABLE IF NOT EXISTS rs_types (name TEXT PRIMARY KEY, def TEXT NOT NULL)");
  const def = { name: "g_deal", fields: [
    { name: "title", kind: "text" },
    { name: "stage", kind: "text", merge: "assistant" },
    { name: "owner", kind: "text", protected: true },
    { name: "taxId", kind: "sealed" },
  ] };
  db.run("INSERT INTO rs_types (name, def) VALUES (?, ?)", "g_deal", JSON.stringify(def));
  const opened: ConflictOpen[] = [];
  const seam = {
    invoke: r.deps.invoke,
    conflicts: { open: async (c: ConflictOpen) => { opened.push(c); return `cfl_${c.opId}_${c.field}`; }, history: async () => undefined },
  } as unknown as SyncHostSeam;
  const deps = pushDepsOf(r.s.deps, seam);
  const handlers = createPushHandlers({ ...r.deps, policy: deps.policy, restricted: deps.restricted, openConflict: deps.openConflict, history: deps.history });
  const push = (person: string, device: string, op: ReturnType<typeof patchOp>) => handlers["sync.push"](ctx(person, device), { deviceId: device, epoch: 0, ops: [op] });
  return { r, deps, opened, push };
}

test("a user type's merge, protected and sealed fields get the assistant policy; a plain field stays last-writer-wins", () => {
  const { deps } = setup();
  assert.equal(deps.policy("g_deal", "title"), "lww");
  assert.equal(deps.policy("g_deal", "stage"), "assistant");
  assert.equal(deps.policy("g_deal", "owner"), "assistant");
  assert.equal(deps.policy("g_deal", "taxId"), "assistant");
});

test("only a sealed field of a user type is Restricted", () => {
  const { deps } = setup();
  assert.equal(deps.restricted("g_deal", "taxId"), true);
  assert.equal(deps.restricted("g_deal", "owner"), false);
  assert.equal(deps.restricted("g_deal", "stage"), false);
  assert.equal(deps.restricted("g_deal", "title"), false);
});

for (const [field, conflicts, plainChoice] of [["title", false, false], ["stage", true, false], ["owner", true, false], ["taxId", true, true]] as const) {
  test(`two devices edit ${field} of a user type from the same base: ${conflicts ? `a conflict opens${plainChoice ? " as a plain choice" : ""}` : "last writer wins, no conflict"}`, async () => {
    const { r, opened, push } = setup();
    const s0 = r.seed("g_deal", "d1", { [field]: "first" });
    const a = await push("usr_ada", "dev_a", patchOp({ id: `a_${field}`, entity: "g_deal", row: "d1", fields: { [field]: "mine" }, base: { [field]: s0 }, hlc: hl(NOW - 2000, 0, "dev_a") }));
    assert.equal(a.applied.length, 1);
    assert.equal(a.conflicts.length, 0);
    const b = await push("usr_ada", "dev_b", patchOp({ id: `b_${field}`, entity: "g_deal", row: "d1", fields: { [field]: "theirs" }, base: { [field]: s0 }, hlc: hl(NOW - 1000, 0, "dev_b") }));
    assert.equal(b.conflicts.length, conflicts ? 1 : 0, JSON.stringify(b));
    assert.equal(opened.length, conflicts ? 1 : 0);
    if (conflicts) assert.equal(opened[0]!.plainChoice, plainChoice);
  });
}
