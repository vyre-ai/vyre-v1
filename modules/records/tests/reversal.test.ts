// Records: bringing back a record an agent deleted, or putting a record back to an earlier version after an agent changed it, teaches that agent (lib/reversal.ts). A person's own change does not.
import test from "node:test";
import assert from "node:assert/strict";
import { withReversals } from "../../../lib/reversal.ts";
import { REVERSALS } from "../reversals.ts";

type Ev = { seq: number; id: string; type: string; actor: string; payload: Record<string, unknown>; subject: { type: string; id: string } };
const ev = (seq: number, type: string, actor: string, payload: Record<string, unknown> = {}): Ev => ({ seq, id: `evt_${seq}`, type, actor, payload, subject: { type: "record", id: "rec_1" } });
function world(log: Ev[]) {
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  return { principal: { kind: "person", id: "usr_alice" }, calls, async call(cap: string, input: unknown) { calls.push({ cap, input: input as Record<string, unknown> }); return cap === "events.list" ? { events: log.filter((e) => ((input as { types: string[] }).types).includes(e.type)) } : { kept: true }; } };
}
const lessons = (c: ReturnType<typeof world>) => c.calls.filter((x) => x.cap === "memory.corrections.record").map((x) => x.input);
const wrap = (cap: string) => withReversals({ [cap]: async () => ({}) }, { [cap]: (REVERSALS as Record<string, never>)[cap] })[cap]!;

test("restoring a record an agent deleted", async () => {
  const w = world([ev(1, "record.deleted", "agt_bot", { prev: {} })]);
  await wrap("records.restore")(w, { type: "contact", recordId: "rec_1" });
  assert.deepEqual(lessons(w), [{ agentId: "agt_bot", how: "reverse", was: "deleted a contact record", ref: "reverse:evt_1" }]);
  const own = world([ev(1, "record.deleted", "usr_bob")]);
  await wrap("records.restore")(own, { type: "contact", recordId: "rec_1" });
  assert.equal(lessons(own).length, 0);
});

test("putting a record back to an earlier version after an agent changed it names the fields it changed, not their values", async () => {
  const w = world([ev(1, "record.updated", "usr_bob", { fields: { status: "x" } }), ev(2, "record.updated", "agt_bot", { fields: { status: "active", email: "ian@example.com" } })]);
  await wrap("records.restore_version")(w, { type: "contact", recordId: "rec_1", versionId: "ver_1" });
  const l = lessons(w);
  assert.equal(l.length, 1);
  assert.equal(l[0]!["was"], "changed a contact record (status, email)");
  assert.ok(!JSON.stringify(l).includes("ian@example.com"), "a value of the record is never in the lesson");
  const own = world([ev(1, "record.updated", "agt_bot", { fields: { status: "x" } }), ev(2, "record.updated", "usr_alice", { fields: { status: "y" } })]);
  await wrap("records.restore_version")(own, { type: "contact", recordId: "rec_1", versionId: "ver_1" });
  assert.equal(lessons(own).length, 0, "the newest change was the person's own");
});
