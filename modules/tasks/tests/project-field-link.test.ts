// A task made with fields.project is linked to that project record, as tasks.links.add links it (Meier Mac mini, 19 Nov: eight tasks sat outside their project because the value was only stored).
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { owner, newTask } from "../fixtures/seed.ts";

const me = { id: owner.id };

test("tasks.create with fields.project links the task to the project record, the same as tasks.links.add", async () => {
  const h = harness();
  const a = (await h.call("tasks.create", newTask({ fields: { project: "rec_proj" } }), me)).task;
  assert.equal(a.recordId, "rec_proj", "linked on create");
  const b = (await h.call("tasks.create", newTask({}), me)).task;
  const linked = (await h.call("tasks.links.add", { taskId: b.id, recordId: "rec_proj" }, me)).task;
  assert.equal(linked.recordId, a.recordId, "the same link either way");
  const listed = await h.call("tasks.list", { scope: "record", recordId: "rec_proj" }, me);
  assert.deepEqual(listed.tasks.map((t: { id: string }) => t.id).sort(), [a.id, b.id].sort());
  assert.equal(a.fields.project, "rec_proj", "the field keeps its value");
});

test("fields.project beside the same recordId is fine; a different recordId is refused, not silently dropped", async () => {
  const h = harness();
  const ok = (await h.call("tasks.create", newTask({ recordId: "rec_p", fields: { project: "rec_p" } }), me)).task;
  assert.equal(ok.recordId, "rec_p");
  await assert.rejects(
    h.call("tasks.create", newTask({ recordId: "rec_x", fields: { project: "rec_p" } }), me),
    /one record/,
  );
});

test("tasks.update that sets fields.project moves the link too", async () => {
  const h = harness();
  const t = (await h.call("tasks.create", newTask({}), me)).task;
  const u = (await h.call("tasks.update", { taskId: t.id, fields: { project: "rec_proj2" } }, me)).task;
  assert.equal(u.recordId, "rec_proj2");
  assert.ok(h.allEvents.some((e) => e.name === "task.updated" && JSON.stringify(e.payload).includes("recordId")));
});
