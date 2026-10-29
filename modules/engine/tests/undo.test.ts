// What an agent turn changed and how it goes back (modules/engine/handlers/undo.ts): the inverse of each event, the earliest values win when a record changes twice, a record created in the turn just goes to
// Trash, and an act that left the Space is listed as one that cannot be undone and is never run.
import test from "node:test";
import assert from "node:assert/strict";
import { OUTWARD, mustBeAsker, stepsOf } from "../handlers/undo.ts";
import { codeOf } from "../fixtures/harness.ts";

const ev = (type: string, payload: Record<string, unknown>, at = 1) => ({ type, at, payload });
const run = async (events: ReturnType<typeof ev>[]) => {
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const ctx = { call: async (cap: string, input: Record<string, unknown>) => { calls.push({ cap, input }); return cap === "files.versions" ? { versions: [{ versionId: "ver_1", n: 1 }, { versionId: "ver_2", n: 2 }] } : {}; } } as never;
  const steps = stepsOf(events);
  for (const s of steps) if (s.change.undoable) await s.run(ctx);
  return { steps, calls };
};

test("a record changed twice goes back to its first values, and a field that was empty goes back to empty", async () => {
  const { steps, calls } = await run([
    ev("record.updated", { recordId: "rec_1", type: "contact", fields: { phone: "2" }, prev: { phone: "1" } }),
    ev("record.updated", { recordId: "rec_1", type: "contact", fields: { phone: "3", title: "T" }, prev: { phone: "2" } }, 2),
  ]);
  assert.deepEqual(steps.map((s) => s.change), [{ label: "Changed phone, title on a contact", undoable: true }]);
  assert.deepEqual(calls, [{ cap: "records.update", input: { type: "contact", recordId: "rec_1", patch: { phone: "1", title: null } } }]);
});

test("a record created in the turn goes to Trash and its later edits are not undone one by one; a deleted one comes back", async () => {
  const { calls } = await run([
    ev("record.created", { recordId: "rec_n", type: "company", fields: {} }),
    ev("record.updated", { recordId: "rec_n", type: "company", fields: { name: "A" }, prev: {} }, 2),
    ev("record.deleted", { recordId: "rec_d", type: "contact", prev: {} }, 3),
  ]);
  assert.deepEqual(calls.map((c) => c.cap).sort(), ["records.delete", "records.restore"]);
});

test("a file edited goes back to the version before the turn's first, and a file created goes to Trash", async () => {
  const { calls } = await run([
    ev("file.version_added", { fileId: "fil_e", versionId: "ver_2", n: 2 }),
    ev("file.version_added", { fileId: "fil_e", versionId: "ver_3", n: 3 }, 2),
    ev("file.created", { fileId: "fil_c" }, 3),
    ev("file.version_added", { fileId: "fil_c", versionId: "ver_x", n: 1 }, 4),
  ]);
  assert.deepEqual(calls, [{ cap: "files.delete", input: { fileId: "fil_c" } }, { cap: "files.versions", input: { fileId: "fil_e" } }, { cap: "files.restore_version", input: { fileId: "fil_e", versionId: "ver_1" } }]);
});

test("an act that left the Space is listed once as one that cannot be undone, and nothing is run for it", async () => {
  const { steps, calls } = await run([ev("message.sent", {}), ev("message.sent", {}, 2), ev("site.promoted", {}, 3)]);
  assert.deepEqual(steps.map((s) => s.change), [{ label: `${OUTWARD["message.sent"]}. This can't be undone`, undoable: false }, { label: `${OUTWARD["site.promoted"]}. This can't be undone`, undoable: false }]);
  assert.deepEqual(calls, []);
});

test("a turn that changed nothing has nothing to undo", () => {
  assert.deepEqual(stepsOf([ev("memory.fact_proposed", {}), ev("chat.read", {})]), []);
});

test("something changed after the turn is left alone and says so; the rest still goes back", async () => {
  const events = [
    ev("record.updated", { recordId: "rec_1", type: "contact", fields: { phone: "2" }, prev: { phone: "1" } }),
    ev("record.updated", { recordId: "rec_2", type: "contact", fields: { phone: "9" }, prev: { phone: "8" } }, 2),
    ev("file.version_added", { fileId: "fil_e", versionId: "ver_2", n: 2 }, 3),
  ];
  const calls: string[] = [];
  const steps = stepsOf(events, new Set(["record:rec_1", "file:fil_e"]));
  for (const s of steps) if (s.change.undoable) await s.run({ call: async (cap: string) => { calls.push(cap); return {}; } } as never);
  assert.deepEqual(steps.map((s) => s.change), [
    { label: "Changed phone on a contact (changed since, left alone)", undoable: false },
    { label: "Changed phone on a contact", undoable: true },
    { label: "Edited a file (changed since, left alone)", undoable: false },
  ]);
  assert.deepEqual(calls, ["records.update"], "only the untouched record is put back");
});

test("only the person whose turn it was can undo it", () => {
  const ctx = (id: string) => ({ trace: { traceId: "t" }, principal: { kind: "person" as const, id } });
  assert.doesNotThrow(() => mustBeAsker(ctx("usr_maya"), "usr_maya", "trn_1"));
  assert.throws(() => mustBeAsker(ctx("usr_ian"), "usr_maya", "trn_1"), (e) => codeOf(e) === "permission.no_grant");
});
