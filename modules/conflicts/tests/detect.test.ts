// Detect and route (ARCH 5.5; spec 4.11): two meaningful edits raise a conflict and the loser is kept; same-meaning edits never reach the assistant; a Restricted field is a plain two-value choice
// that never reaches a provider; a protected field waits in Needs you; a retried push lands on the same conflict.
import test from "node:test";
import assert from "node:assert/strict";
import { assist, logBinary, onConflictOpened, openConflict, propose, recordHistory } from "../handlers/detect.ts";
import { handlers } from "../handlers/index.ts";
import { setPorts } from "../projections.ts";
import type { Proposal } from "../projections.ts";
import { assertEventsConform, asPerson, codeOf, collision, contractErrors, harness, resetPorts, seedRecord } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const PROTECTED = new Set(["status", "owner", "amount"]);

function setup(over: Parameters<typeof harness>[0] = {}, fields: Record<string, unknown> = { status: "Active", note: "Call Bea" }): Harness {
  resetPorts();
  setPorts({ isProtected: (_e, f) => PROTECTED.has(f) });
  const h = harness(over);
  seedRecord(h, "rec_acme", fields);
  return h;
}

async function open(h: Harness, over: Parameters<typeof collision>[0] = {}): Promise<string> {
  const id = openConflict(h.ctx, collision(over));
  await onConflictOpened(h.ctx, { conflictId: id });
  return id;
}

const stateOf = (h: Harness, id: string): string => String(h.rows("SELECT state FROM conflicts_conflict WHERE id = ?", id)[0]?.["state"]);

test("two meaningful edits raise a conflict: the assistant compares, a plain field resolves, and the loser stays in history", async () => {
  const h = setup();
  h.records.set("rec_acme", { status: "Active", note: "Call Bea" });
  const id = openConflict(h.ctx, collision({ field: "note", ours: "Call Bea", theirs: "Call Bea tomorrow at 3", base: 7, opId: "op_note" }));
  assert.equal(stateOf(h, id), "open", "parked, not yet looked at");
  const routed = await onConflictOpened(h.ctx, { conflictId: id });
  assert.equal(routed.route, "assistant");

  assert.equal(h.records.get("rec_acme")?.["note"], "Call Bea tomorrow at 3", "the person's longer edit won");
  assert.equal(stateOf(h, id), "resolved");
  assert.equal(h.calls("runs.start").length, 1);
  assert.equal(h.calls("runs.finish")[0]?.input["status"], "succeeded");
  assert.equal(h.calls("tasks.create").length, 0, "a plain field never reaches Needs you");

  const loser = h.rows("SELECT value, reason FROM conflicts_history WHERE entity = ? AND record_id = ? AND field = ?", "client_plan", "rec_acme", "note");
  assert.equal(loser.length >= 1, true);
  assert.equal(loser.some((r) => r["value"] === JSON.stringify("Call Bea") && r["reason"] === "resolved"), true, "the value it replaced is kept");

  const got = (await handlers["conflicts.get"](h.ctx, { conflictId: id })) as { conflict: Record<string, unknown> };
  assert.deepEqual(contractErrors("conflicts.get", "out", got), []);
  assert.equal((got.conflict["resolution"] as Record<string, unknown>)["canUndo"], true);
  assert.deepEqual(assertEventsConform(h), []);
  assert.deepEqual(h.named("conflict.proposed").map((e) => e.payload["protectedField"]), [false]);
  assert.equal(h.named("conflict.resolved").length, 1);
});

test("the losing side of a choice is kept whichever side it came from", async () => {
  const h = setup({}, { status: "Active", note: "Call Bea tomorrow at 3" });
  const id = openConflict(h.ctx, collision({ field: "note", ours: "Call Bea tomorrow at 3", theirs: "Call Bea", opId: "op_keep" }));
  await onConflictOpened(h.ctx, { conflictId: id });
  assert.equal(h.records.get("rec_acme")?.["note"], "Call Bea tomorrow at 3", "the current value contains the other edit, so it stays");
  assert.equal(h.calls("records.update").length, 0, "keeping the current value writes nothing");
  const kept = h.rows("SELECT value, reason FROM conflicts_history WHERE field = ?", "note");
  assert.deepEqual(kept.map((r) => [r["value"], r["reason"]]), [[JSON.stringify("Call Bea"), "superseded"]]);
  assert.equal(stateOf(h, id), "resolved");
});

test("edits that mean the same thing are not a conflict: no assistant, no task, nothing written", async () => {
  const h = setup();
  const id = openConflict(h.ctx, collision({ field: "note", ours: "Call  Bea ", theirs: "Call Bea", opId: "op_same" }));
  assert.equal(stateOf(h, id), "resolved");
  const routed = await onConflictOpened(h.ctx, { conflictId: id });
  assert.equal(routed.route, "skipped");
  assert.equal(h.calls("runs.start").length, 0);
  assert.equal(h.calls("tasks.create").length, 0);
  assert.equal(h.calls("records.update").length, 0);
  assert.equal(h.records.get("rec_acme")?.["note"], "Call Bea");
  const res = h.rows("SELECT by_actor, applied FROM conflicts_resolution");
  assert.deepEqual(res.map((r) => [r["by_actor"], Number(r["applied"])]), [["system", 0]]);
  assert.deepEqual(assertEventsConform(h), []);
  // a real difference in spelling is still meaningful
  const other = openConflict(h.ctx, collision({ field: "note", ours: "Call Bea", theirs: "call bea", opId: "op_case" }));
  assert.equal(stateOf(h, other), "open");
});

test("a retried push lands on the same conflict (idempotent per op and field)", () => {
  const h = setup();
  const a = openConflict(h.ctx, collision());
  const b = openConflict(h.ctx, collision());
  const c = openConflict(h.ctx, collision({ field: "owner", opId: "op_1" }));
  assert.equal(a, b);
  assert.notEqual(a, c, "another field of the same op is its own conflict");
  assert.equal(h.rows("SELECT id FROM conflicts_conflict").length, 2);
});

test("a protected field gets a proposal and waits in Needs you: nothing is applied until the person confirms", async () => {
  const h = setup();
  const id = await open(h, { field: "status", ours: "Active", theirs: "Paused" });
  assert.equal(stateOf(h, id), "needs_you");
  assert.equal(h.records.get("rec_acme")?.["status"], "Active", "the value is not applied yet");
  const task = h.calls("tasks.create")[0]?.input;
  assert.equal(task?.["kind"], "answer");
  assert.deepEqual(task?.["assigned"], { kind: "person", id: "usr_dana" });
  assert.equal(JSON.stringify(task).includes("Paused"), false, "the task card carries ids, never the values");
  assert.deepEqual(h.named("conflict.confirmation_needed").map((e) => e.payload["plainChoice"]), [false]);
  assert.deepEqual(h.named("conflict.proposed").map((e) => e.payload["protectedField"]), [true]);
  assert.equal(h.named("conflict.resolved").length, 0);

  const got = (await handlers["conflicts.get"](h.ctx, { conflictId: id })) as { conflict: Record<string, unknown> };
  assert.equal(got.conflict["state"], "needs_you");
  assert.equal(got.conflict["protectedField"], true);
  assert.ok(got.conflict["proposal"]);
  assert.ok(got.conflict["taskId"]);
  assert.deepEqual(contractErrors("conflicts.get", "out", got), []);
  assert.deepEqual(assertEventsConform(h), []);
});

test("a Restricted field is a plain two-value choice and never reaches a provider", async () => {
  const h = setup();
  let asked = 0;
  setPorts({ assistant: async () => { asked += 1; return { choice: "ours", summary: "should not be asked" }; } });
  const id = openConflict(h.ctx, collision({ field: "taxId", ours: "11-111", theirs: "22-222", plainChoice: true, opId: "op_tax" }));
  assert.equal(stateOf(h, id), "needs_you");
  const routed = await onConflictOpened(h.ctx, { conflictId: id });
  assert.equal(routed.route, "plain");
  assert.equal(asked, 0);
  assert.equal(h.calls("runs.start").length, 0);
  assert.equal(h.calls("tasks.create").length, 1);
  assert.deepEqual(h.named("conflict.confirmation_needed").map((e) => e.payload["plainChoice"]), [true]);

  await assert.rejects(assist(h.ctx, { conflictId: id }), (e: unknown) => codeOf(e) === "permission.provider_label");
  await assert.rejects(propose(h.ctx, { conflictId: id, choice: "ours", summary: "x" }), (e: unknown) => codeOf(e) === "permission.provider_label");
  assert.equal(asked, 0);
  // a replayed event does not make a second task
  assert.equal((await onConflictOpened(h.ctx, { conflictId: id })).route, "skipped");
  assert.equal(h.calls("tasks.create").length, 1);
});

test("a replayed conflict.opened routes once", async () => {
  const h = setup();
  const id = openConflict(h.ctx, collision({ field: "note", ours: "a", theirs: "a b", opId: "op_replay" }));
  assert.equal((await onConflictOpened(h.ctx, { conflictId: id })).route, "assistant");
  assert.equal((await onConflictOpened(h.ctx, { conflictId: id })).route, "skipped");
  assert.equal(h.calls("runs.start").length, 1);
});

test("an assistant that cannot be asked leaves the decision with the person instead of dropping it", async () => {
  const h = setup();
  setPorts({ assistant: async () => { throw new Error("no key for this model"); } });
  const id = await open(h, { field: "note", ours: "a", theirs: "b", opId: "op_fail" });
  assert.equal(stateOf(h, id), "needs_you");
  assert.equal(h.calls("runs.finish")[0]?.input["status"], "failed");
  assert.equal(h.calls("tasks.create").length, 1);
  assert.equal(h.logs.length >= 1, true);
  assert.equal(h.records.get("rec_acme")?.["note"], "Call Bea", "nothing was written");
});

test("assistant resolutions cover only fields the person can edit: a read-only caller gets the proposal in Needs you", async () => {
  const h = setup({ readOnly: ["record:rec_acme"] });
  const id = await open(h, { field: "note", ours: "Call Bea", theirs: "Call Bea tomorrow", opId: "op_ro" });
  assert.equal(stateOf(h, id), "needs_you");
  assert.equal(h.calls("records.update").length, 0);
  assert.equal(h.named("conflict.resolved").length, 0);
});

test("assist and propose belong to the person whose edit was parked", async () => {
  const h = setup();
  const id = openConflict(h.ctx, collision({ field: "note", ours: "a", theirs: "b", opId: "op_owner" }));
  const bea = asPerson(h, { kind: "person", id: "usr_bea" });
  await assert.rejects(assist(bea.ctx, { conflictId: id }), (e: unknown) => codeOf(e) === "permission.not_found");
  await assert.rejects(propose(bea.ctx, { conflictId: id, choice: "ours", summary: "x" }), (e: unknown) => codeOf(e) === "permission.not_found");
  await assert.rejects(assist(h.ctx, { conflictId: "cfl_missing" }), (e: unknown) => codeOf(e) === "validation.not_found");
  const run = await assist(h.ctx, { conflictId: id });
  assert.match(run.runId, /^run_/);
  assert.deepEqual(contractErrors("conflicts.assist", "out", run), []);
  await assert.rejects(assist(h.ctx, { conflictId: id }), (e: unknown) => codeOf(e) === "validation.precondition_failed", "a settled conflict is not asked again");
});

test("propose stores a proposal; merged and custom need the value", async () => {
  const h = setup();
  const id = openConflict(h.ctx, collision({ field: "note", ours: "x", theirs: "y", opId: "op_prop" }));
  await assert.rejects(propose(h.ctx, { conflictId: id, choice: "merged", summary: "m" }), (e: unknown) => codeOf(e) === "validation.bad_input");
  const out = await propose(h.ctx, { conflictId: id, choice: "merged", value: "x and y", summary: "Kept both" });
  assert.equal(out.state, "resolved");
  assert.equal(h.records.get("rec_acme")?.["note"], "x and y");
  assert.deepEqual(contractErrors("conflicts.propose", "out", out), []);
});

test("an agent proposes for the person and signs as itself", async () => {
  const h = setup();
  const id = openConflict(h.ctx, collision({ field: "note", ours: "x", theirs: "y", opId: "op_agent" }));
  const agent = asPerson(h, { kind: "agent", id: "agt_assistant" }, {});
  agent.ctx.actingFor = "usr_dana";
  await propose(agent.ctx, { conflictId: id, choice: "theirs", summary: "Used the newer edit" });
  assert.equal(h.rows("SELECT by_actor FROM conflicts_resolution")[0]?.["by_actor"], "agt_assistant");
});

test("history keeps what lost a merge, once per (entity, record, field, hlc, actor)", async () => {
  const h = setup();
  const entry = { entity: "client_plan", id: "rec_acme", field: "note", value: "older text", hlc: "000000000001-0001-dev1", actor: "usr_bea", seq: 4, reason: "lww_loser" as const };
  recordHistory(h.ctx, entry);
  recordHistory(h.ctx, entry);
  assert.equal(h.rows("SELECT * FROM conflicts_history").length, 1);
  const out = (await handlers["conflicts.field_history"](h.ctx, { entity: "client_plan", recordId: "rec_acme", field: "note" })) as { entries: Array<Record<string, unknown>> };
  assert.equal(out.entries.length, 1);
  assert.equal(out.entries[0]?.["value"], "older text");
  assert.equal(out.entries[0]?.["reason"], "lww_loser");
  assert.deepEqual(contractErrors("conflicts.field_history", "out", out), []);
  const blind = harness({ raw: h.raw, deny: ["record:rec_acme"] });
  await assert.rejects(Promise.resolve().then(() => handlers["conflicts.field_history"](blind.ctx, { entity: "client_plan", recordId: "rec_acme", field: "note" })), (e: unknown) => codeOf(e) === "permission.no_grant");
});

test("a binary file collision keeps the newest save and logs a Conflicts row, once", () => {
  const h = setup();
  const input = { fileId: "fil_deck", currentVersionId: "ver_new", otherVersionId: "ver_old", label: "Deck, Ada's copy" };
  const a = logBinary(h.ctx, input);
  const b = logBinary(h.ctx, input);
  assert.equal(a.conflictId, b.conflictId);
  assert.deepEqual(contractErrors("conflicts.log_binary", "out", a), []);
  assert.deepEqual(h.named("conflict.binary_logged").map((e) => e.payload["versionId"]), ["ver_old"]);
  const row = h.rows("SELECT state, entity FROM conflicts_conflict")[0];
  assert.deepEqual([row?.["state"], row?.["entity"]], ["resolved", "file"]);
  assert.deepEqual(assertEventsConform(h), []);
  const ro = harness({ raw: h.raw, readOnly: ["file:fil_deck"] });
  assert.throws(() => logBinary(ro.ctx, { ...input, otherVersionId: "ver_x" }), (e: unknown) => codeOf(e) === "permission.no_grant");
});

test("the default proposer keeps the longer text and otherwise takes the newer edit", async () => {
  resetPorts();
  const { heuristicProposal } = await import("../projections.ts");
  const p = (a: unknown, b: unknown): Proposal => heuristicProposal(a, b);
  assert.equal(p("a b", "a").choice, "ours");
  assert.equal(p("a", "a b").choice, "theirs");
  assert.equal(p(3, 4).choice, "theirs");
  assert.equal(p(" x ", "x").choice, "ours");
});
