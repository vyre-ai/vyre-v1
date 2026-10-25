// Resolve, confirm, Undo and Redo (ARCH 5.5; spec 4.11): every choice has Undo, Redo restores, a later edit is never overwritten, and only the person whose edit was parked can choose.
import test from "node:test";
import assert from "node:assert/strict";
import { onConflictOpened, openConflict } from "../handlers/detect.ts";
import { handlers } from "../handlers/index.ts";
import { confirm, redo, resolve, undo } from "../handlers/resolve.ts";
import { setPorts } from "../projections.ts";
import { assertEventsConform, asPerson, codeOf, collision, contractErrors, harness, resetPorts, seedConflict, seedRecord } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

function setup(over: Parameters<typeof harness>[0] = {}): Harness {
  resetPorts();
  setPorts({ isProtected: (_e, f) => f === "status" });
  const h = harness(over);
  seedRecord(h, "rec_acme", { status: "Active", note: "Call Bea" });
  return h;
}

const park = (h: Harness, over: Parameters<typeof collision>[0] = {}): string => openConflict(h.ctx, collision({ field: "note", ours: "Call Bea", theirs: "Call Dana", ...over }));
const fieldOf = (h: Harness, f = "note"): unknown => h.records.get("rec_acme")?.[f];
const rejects = (p: Promise<unknown> | (() => unknown), code: string): Promise<void> =>
  assert.rejects(typeof p === "function" ? Promise.resolve().then(p) : p, (e: unknown) => { assert.equal(codeOf(e), code); return true; });

test("resolve applies the chosen value as the person, keeps what it replaced, and says so in one line", async () => {
  const h = setup();
  const id = park(h);
  const out = await resolve(h.ctx, { conflictId: id, choice: "theirs", summary: "Used my edit" });
  assert.equal(out.state, "resolved");
  assert.match(out.resolutionId, /^res_[a-z0-9]+$/);
  assert.deepEqual(contractErrors("conflicts.resolve", "out", out), []);
  assert.equal(fieldOf(h), "Call Dana");
  assert.deepEqual(h.calls("records.update")[0]?.input, { type: "client_plan", recordId: "rec_acme", patch: { note: "Call Dana" } });
  const kept = h.rows("SELECT value, reason FROM conflicts_history WHERE field = 'note' ORDER BY reason");
  assert.deepEqual(kept.map((r) => [r["value"], r["reason"]]), [[JSON.stringify("Call Bea"), "resolved"], [JSON.stringify("Call Bea"), "superseded"]]);
  const ev = h.named("conflict.resolved")[0]?.payload;
  assert.deepEqual([ev?.["choice"], ev?.["by"], ev?.["summary"]], ["theirs", "usr_dana", "Used my edit"]);
  assert.deepEqual(assertEventsConform(h), []);
});

test("choosing the current value writes nothing; merged and custom write the value given and need it", async () => {
  const h = setup();
  const a = park(h, { opId: "op_a" });
  await resolve(h.ctx, { conflictId: a, choice: "ours", summary: "Kept Bea's" });
  assert.equal(h.calls("records.update").length, 0);
  assert.equal(fieldOf(h), "Call Bea");

  const b = park(h, { opId: "op_b", ours: "Call Bea", theirs: "Call Dana" });
  await rejects(resolve(h.ctx, { conflictId: b, choice: "merged", summary: "m" }), "validation.bad_input");
  const m = await resolve(h.ctx, { conflictId: b, choice: "merged", value: "Call Bea and Dana", summary: "Kept both names" });
  assert.equal(m.state, "resolved");
  assert.equal(fieldOf(h), "Call Bea and Dana");

  const c = park(h, { opId: "op_c", ours: "Call Bea and Dana", theirs: "Call all" });
  await resolve(h.ctx, { conflictId: c, choice: "custom", value: "Call the team", summary: "Wrote my own" });
  assert.equal(fieldOf(h), "Call the team");
});

test("a settled conflict, an unknown one and someone else's are refused", async () => {
  const h = setup();
  const id = park(h);
  await resolve(h.ctx, { conflictId: id, choice: "theirs", summary: "x" });
  await rejects(resolve(h.ctx, { conflictId: id, choice: "ours", summary: "again" }), "validation.precondition_failed");
  await rejects(resolve(h.ctx, { conflictId: "cfl_nope", choice: "ours", summary: "x" }), "validation.not_found");
  const other = park(h, { opId: "op_other" });
  const bea = asPerson(h, { kind: "person", id: "usr_bea" });
  await rejects(resolve(bea.ctx, { conflictId: other, choice: "ours", summary: "x" }), "permission.not_found");
  await rejects(() => handlers["conflicts.get"](bea.ctx, { conflictId: other }), "permission.not_found");
});

test("a write the person may not make is refused and leaves the conflict open", async () => {
  const h = setup({ readOnly: ["record:rec_acme"] });
  const id = park(h);
  await rejects(resolve(h.ctx, { conflictId: id, choice: "theirs", summary: "x" }), "permission.no_grant");
  const held = setup({ hold: ["record:rec_acme"] });
  const hid = park(held);
  await rejects(resolve(held.ctx, { conflictId: hid, choice: "theirs", summary: "x" }), "permission.on_hold");
  const locked = setup({ throws: { "records.update": Object.assign(new Error("locked"), { error: { code: "validation.field_locked" } }) } });
  const lid = park(locked);
  await assert.rejects(resolve(locked.ctx, { conflictId: lid, choice: "theirs", summary: "x" }), (e: unknown) => codeOf(e) === "validation.field_locked");
  for (const x of [h, held, locked]) {
    assert.equal(x.rows("SELECT state FROM conflicts_conflict")[0]?.["state"], "open");
    assert.equal(x.rows("SELECT * FROM conflicts_resolution").length, 0, "no resolution is recorded for a write that did not happen");
  }
});

test("Undo restores the loser as a normal op and Redo restores the choice", async () => {
  const h = setup();
  const id = park(h);
  const { resolutionId } = await resolve(h.ctx, { conflictId: id, choice: "theirs", summary: "Used my edit" });
  assert.equal(fieldOf(h), "Call Dana");

  const u = await undo(h.ctx, { resolutionId });
  assert.deepEqual(u, { state: "undone" });
  assert.deepEqual(contractErrors("conflicts.undo", "out", u), []);
  assert.equal(fieldOf(h), "Call Bea", "the replaced value is back");
  assert.deepEqual(h.calls("records.update").at(-1)?.input, { type: "client_plan", recordId: "rec_acme", patch: { note: "Call Bea" } });
  const afterUndo = (await handlers["conflicts.get"](h.ctx, { conflictId: id })) as { conflict: { state: string; resolution: { canUndo: boolean; canRedo: boolean } } };
  assert.deepEqual([afterUndo.conflict.state, afterUndo.conflict.resolution.canUndo, afterUndo.conflict.resolution.canRedo], ["undone", false, true]);
  await rejects(undo(h.ctx, { resolutionId }), "validation.precondition_failed");

  const r = await redo(h.ctx, { resolutionId });
  assert.deepEqual(r, { state: "resolved" });
  assert.deepEqual(contractErrors("conflicts.redo", "out", r), []);
  assert.equal(fieldOf(h), "Call Dana");
  await rejects(redo(h.ctx, { resolutionId }), "validation.precondition_failed");
  assert.deepEqual(h.named("conflict.undone").map((e) => e.payload["resolutionId"]), [resolutionId]);
  assert.deepEqual(h.named("conflict.redone").map((e) => e.payload["resolutionId"]), [resolutionId]);
  assert.deepEqual(assertEventsConform(h), []);
});

test("Undo and Redo never overwrite a later edit", async () => {
  const h = setup();
  const id = park(h);
  const { resolutionId } = await resolve(h.ctx, { conflictId: id, choice: "theirs", summary: "x" });
  h.records.get("rec_acme")!["note"] = "Edited by hand afterwards";
  await rejects(undo(h.ctx, { resolutionId }), "validation.precondition_failed");
  assert.equal(fieldOf(h), "Edited by hand afterwards");
  h.records.get("rec_acme")!["note"] = "Call Dana";
  await undo(h.ctx, { resolutionId });
  h.records.get("rec_acme")!["note"] = "Someone else changed it";
  await rejects(redo(h.ctx, { resolutionId }), "validation.precondition_failed");
});

test("after Undo the person can choose again; the older resolution can no longer be undone or redone", async () => {
  const h = setup();
  const id = park(h);
  const first = await resolve(h.ctx, { conflictId: id, choice: "theirs", summary: "mine" });
  await undo(h.ctx, { resolutionId: first.resolutionId });
  const second = await resolve(h.ctx, { conflictId: id, choice: "custom", value: "Call everyone", summary: "my own" });
  assert.equal(fieldOf(h), "Call everyone");
  await rejects(redo(h.ctx, { resolutionId: first.resolutionId }), "validation.precondition_failed");
  await rejects(undo(h.ctx, { resolutionId: first.resolutionId }), "validation.precondition_failed");
  await undo(h.ctx, { resolutionId: second.resolutionId });
  assert.equal(fieldOf(h), "Call Bea");
  await rejects(undo(h.ctx, { resolutionId: "res_missing" }), "validation.not_found");
  await rejects(undo(asPerson(h, { kind: "person", id: "usr_bea" }).ctx, { resolutionId: second.resolutionId }), "permission.not_found");
});

test("a resolution that changed nothing still has Undo and Redo, and they change nothing", async () => {
  const h = setup();
  const id = park(h);
  const { resolutionId } = await resolve(h.ctx, { conflictId: id, choice: "ours", summary: "kept" });
  await undo(h.ctx, { resolutionId });
  await redo(h.ctx, { resolutionId });
  assert.equal(h.calls("records.update").length, 0);
});

test("confirm applies the assistant's proposal on a protected field and closes the Needs you task", async () => {
  const h = setup();
  const id = openConflict(h.ctx, collision({ field: "status", ours: "Active", theirs: "Paused" }));
  await rejects(confirm(h.ctx, { conflictId: id }), "validation.precondition_failed");
  await onConflictOpened(h.ctx, { conflictId: id });
  assert.equal(fieldOf(h, "status"), "Active");
  const out = await confirm(h.ctx, { conflictId: id });
  assert.equal(out.state, "resolved");
  assert.deepEqual(contractErrors("conflicts.confirm", "out", out), []);
  assert.equal(fieldOf(h, "status"), "Paused");
  assert.equal(h.named("conflict.resolved")[0]?.payload["by"], "usr_dana", "a person confirms, so the person signs");
  const closed = h.calls("tasks.transition")[0]?.input;
  assert.deepEqual([closed?.["taskId"], closed?.["to"]], ["tsk_conflict1", "done"]);
  await rejects(confirm(h.ctx, { conflictId: id }), "validation.precondition_failed");
});

test("a task that cannot be closed does not undo the resolution", async () => {
  const h = setup({ throws: { "tasks.transition": new Error("already done") } });
  const id = openConflict(h.ctx, collision({ field: "status", ours: "Active", theirs: "Paused" }));
  await onConflictOpened(h.ctx, { conflictId: id });
  const out = await confirm(h.ctx, { conflictId: id });
  assert.equal(out.state, "resolved");
  assert.equal(fieldOf(h, "status"), "Paused");
  assert.equal(h.logs.includes("conflict task not closed"), true);
});

test("a Restricted conflict takes one of the two values as they are", async () => {
  const h = setup();
  const id = openConflict(h.ctx, collision({ field: "taxId", ours: "11-111", theirs: "22-222", plainChoice: true, opId: "op_tax" }));
  seedRecord(h, "rec_acme", { taxId: "11-111" });
  await rejects(resolve(h.ctx, { conflictId: id, choice: "merged", value: "33-333", summary: "x" }), "validation.bad_input");
  await resolve(h.ctx, { conflictId: id, choice: "theirs", summary: "Used my number" });
  assert.equal(fieldOf(h, "taxId"), "22-222");
});

test("list, get and counts show a person only their own conflicts", async () => {
  const h = setup();
  const a = seedConflict(h, { state: "open", openedAt: 1_760_000_000_000 });
  const b = seedConflict(h, { state: "needs_you", openedAt: 1_760_000_001_000 });
  const c = seedConflict(h, { state: "resolved", openedAt: 1_760_000_002_000 });
  seedConflict(h, { person: "usr_bea", state: "open" });

  const all = (await handlers["conflicts.list"](h.ctx, {})) as { conflicts: Array<{ conflictId: string }>; total?: number };
  assert.deepEqual(all.conflicts.map((x) => x.conflictId), [c, b, a], "newest first");
  assert.equal(all.total, 3);
  assert.deepEqual(contractErrors("conflicts.list", "out", all), []);
  const needs = (await handlers["conflicts.list"](h.ctx, { state: ["needs_you"] })) as { conflicts: Array<{ conflictId: string }> };
  assert.deepEqual(needs.conflicts.map((x) => x.conflictId), [b]);
  const since = (await handlers["conflicts.list"](h.ctx, { since: 1_760_000_001_500 })) as { conflicts: Array<{ conflictId: string }> };
  assert.deepEqual(since.conflicts.map((x) => x.conflictId), [c]);
  const page = (await handlers["conflicts.list"](h.ctx, { limit: 2 })) as { conflicts: unknown[]; next?: string };
  assert.equal(page.conflicts.length, 2);
  assert.equal(page.next, "2");
  const rest = (await handlers["conflicts.list"](h.ctx, { limit: 2, cursor: page.next })) as { conflicts: unknown[]; next?: string };
  assert.deepEqual([rest.conflicts.length, rest.next], [1, undefined]);

  const n = await handlers["conflicts.counts"](h.ctx);
  assert.deepEqual(n, { open: 1, needsYou: 1, resolved: 1 });
  assert.deepEqual(contractErrors("conflicts.counts", "out", n), []);
  const bea = asPerson(h, { kind: "person", id: "usr_bea" });
  assert.deepEqual(await handlers["conflicts.counts"](bea.ctx), { open: 1, needsYou: 0, resolved: 0 });
});

test("an agent that resolves for the person signs as itself", async () => {
  const h = setup();
  const id = park(h);
  const agent = asPerson(h, { kind: "agent", id: "agt_assistant" });
  agent.ctx.actingFor = "usr_dana";
  await resolve(agent.ctx, { conflictId: id, choice: "theirs", summary: "Used the newer edit" });
  assert.equal(h.named("conflict.resolved")[0]?.payload["by"], "agt_assistant");
});
