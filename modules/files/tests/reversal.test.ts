// Files: undoing what an agent did teaches that agent (lib/reversal.ts). The rules of each undoing capability (restore a file or a folder, restore a version, move back, revert a change in a changeset,
// discard a proposal) run over a stand-in event log; the lesson says what was undone in plain words.
import test from "node:test";
import assert from "node:assert/strict";
import { withReversals } from "../../../lib/reversal.ts";
import { REVERSALS } from "../handlers/reversals.ts";

type Ev = { seq: number; id: string; type: string; actor: string; payload: Record<string, unknown>; subject: { type: string; id: string } };
const ev = (seq: number, type: string, actor: string, subject: { type: string; id: string }, payload: Record<string, unknown> = {}): Ev => ({ seq, id: `evt_${seq}`, type, actor, payload, subject });
function world(log: Ev[], rows: Record<string, unknown>[] = []) {
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  const ctx = {
    principal: { kind: "person", id: "usr_alice" }, calls,
    db: { all: (_sql: string, id: string) => rows.filter((r) => r["id"] === id) },
    async call(cap: string, input: unknown) {
      const i = input as Record<string, unknown>;
      calls.push({ cap, input: i });
      if (cap === "events.list") return { events: log.filter((e) => (i["types"] as string[]).includes(e.type) && e.subject.id === (i["subject"] as { id: string }).id) };
      return { kept: true };
    },
  };
  return ctx;
}
const lessons = (c: { calls: { cap: string; input: Record<string, unknown> }[] }) => c.calls.filter((x) => x.cap === "memory.corrections.record").map((x) => x.input);
const wrap = (cap: string, out: unknown = {}) => withReversals({ [cap]: async () => out }, { [cap]: (REVERSALS as Record<string, never>)[cap] })[cap]!;

test("bringing back a file or a folder an agent deleted", async () => {
  const file = world([ev(1, "file.deleted", "agt_bot", { type: "file", id: "fil_1" })]);
  await wrap("files.restore", { file: { name: "Q3 plan.pdf" } })(file, { fileId: "fil_1" });
  assert.deepEqual(lessons(file), [{ agentId: "agt_bot", how: "reverse", was: 'deleted the file "Q3 plan.pdf"', ref: "reverse:evt_1" }]);
  const folder = world([ev(1, "folder.deleted", "agt_bot", { type: "folder", id: "fld_1" })]);
  await wrap("files.folder.restore", { folder: { name: "Old leads" } })(folder, { folderId: "fld_1" });
  assert.equal(lessons(folder)[0]!["was"], 'deleted the folder "Old leads"');
});

test("putting back an earlier version of a file an agent wrote", async () => {
  const w = world([ev(1, "file.created", "usr_bob", { type: "file", id: "fil_1" }), ev(2, "file.version_added", "agt_bot", { type: "file", id: "fil_1" })]);
  await wrap("files.restore_version", { file: { name: "Brief.md" } })(w, { fileId: "fil_1", versionId: "ver_1" });
  assert.deepEqual(lessons(w).map((l) => [l["agentId"], l["was"]]), [["agt_bot", 'changed the file "Brief.md"']]);
  const own = world([ev(1, "file.version_added", "usr_alice", { type: "file", id: "fil_1" })]);
  await wrap("files.restore_version", { file: { name: "Brief.md" } })(own, { fileId: "fil_1", versionId: "ver_1" });
  assert.equal(lessons(own).length, 0, "putting back one's own change is not a correction");
});

test("moving back what an agent moved, and only that", async () => {
  const log = [ev(1, "file.moved", "agt_bot", { type: "file", id: "fil_1" }, { fromFolderId: "fld_a", toFolderId: "fld_b" })];
  const back = world(log);
  await wrap("files.move", { file: { name: "Lease.pdf" } })(back, { fileId: "fil_1", toFolderId: "fld_a" });
  assert.deepEqual(lessons(back).map((l) => l["was"]), ['moved the file "Lease.pdf"']);
  const elsewhere = world(log);
  await wrap("files.move", { file: { name: "Lease.pdf" } })(elsewhere, { fileId: "fil_1", toFolderId: "fld_c" });
  assert.equal(lessons(elsewhere).length, 0);
});

test("reverting a change in a changeset an agent proposed, and discarding its proposal", async () => {
  const rows = [{ id: "cs_1", author: "agt_bot", thread_id: "thr_1" }, { id: "cs_2", author: "act_outside", thread_id: null }];
  const revert = world([], rows);
  await wrap("changesets.revert_change", { fileCount: 1 })(revert, { changesetId: "cs_1", path: "notes/plan.md" });
  assert.deepEqual(lessons(revert), [{ agentId: "agt_bot", how: "reverse", was: 'changed "notes/plan.md" and proposed it for review', threadId: "thr_1", ref: "reverse:cs_1" }]);
  const discard = world([], rows);
  await wrap("changesets.discard", { discarded: true })(discard, { changesetId: "cs_1" });
  assert.deepEqual(lessons(discard).map((l) => [l["how"], l["ref"]]), [["refuse", "refuse:cs_1"]]);
  const outside = world([], rows);
  await wrap("changesets.revert_change", {})(outside, { changesetId: "cs_2", path: "a.md" });
  assert.equal(lessons(outside).length, 0, "an outside reviewer's change is not an agent's");
});
