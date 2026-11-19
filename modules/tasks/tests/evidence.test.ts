// Evidence first (lane r42-alive): the event that proves a task done closes it Done with the proof as its note; a second delivery, another name, a closed or archived task change nothing; done_when can be cleared.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, newTask } from "../fixtures/seed.ts";
import { onEvidence } from "../handlers/evidence.ts";

const me = { id: alice.id };
const svc = { id: "svc_host", kind: "service" as const };
const world = (): Harness => {
  const h = harness();
  h.callee("tasks.transition", (input) => h.call("tasks.transition", input, svc));
  return h;
};
const mk = async (h: Harness, title: string): Promise<string> =>
  (await h.call("tasks.create", newTask({ title }), me)).task.id as string;
const get = async (h: Harness, id: string): Promise<any> => (await h.call("tasks.get", { taskId: id }, me)).task; // eslint-disable-line @typescript-eslint/no-explicit-any
const deliver = (h: Harness, name: string, payload: Record<string, unknown>): Promise<string[]> =>
  onEvidence(h.ctxFor("tasks.transition", svc), { name, payload });

test("a Vault item with the named name closes the task Done with the proof, once; another name leaves it", async () => {
  const h = world();
  const id = await mk(h, "Put the hosting key in the Vault");
  const other = await mk(h, "Put the mail key in the Vault");
  await h.call("tasks.done_when", { taskId: id, kind: "vault_item", key: "Hosting Key" }, me);
  await h.call("tasks.done_when", { taskId: other, kind: "vault_item", key: "Mail key" }, me);
  assert.deepEqual((await get(h, id)).doneWhen, { kind: "vault_item", key: "hosting key" });
  assert.deepEqual(await deliver(h, "vault.item_created", { itemId: "vit_1", name: "hosting KEY" }), [id]);
  const t = await get(h, id);
  assert.equal(t.state, "done");
  assert.equal((await get(h, other)).state, "todo");
  const history = (await h.call("tasks.history", { taskId: id }, me)).entries as { note?: string }[];
  assert.ok(
    history.some((e) => e.note === "It is in the Vault: hosting KEY."),
    "the proof is the note",
  );
  assert.deepEqual(
    await deliver(h, "vault.item_created", { itemId: "vit_1", name: "hosting KEY" }),
    [],
    "a second delivery changes nothing",
  );
});

test("a message to a contact, a meeting that ended and a connection made each settle their task; an event with no name proves nothing", async () => {
  const h = world();
  const a = await mk(h, "Reply to the client");
  const b = await mk(h, "Hold the call");
  const c = await mk(h, "Connect the calendar");
  await h.call("tasks.done_when", { taskId: a, kind: "message_sent", key: "rec_client" }, me);
  await h.call("tasks.done_when", { taskId: b, kind: "meeting_ended", key: "rec_mtg" }, me);
  await h.call("tasks.done_when", { taskId: c, kind: "connection_on", key: "calendar" }, me);
  assert.deepEqual(await deliver(h, "message.sent", { messageId: "m1", channel: "email" }), []);
  assert.deepEqual(await deliver(h, "message.sent", { messageId: "m1", channel: "email", contactId: "rec_client" }), [
    a,
  ]);
  assert.deepEqual(await deliver(h, "meeting.ended", { meetingId: "rec_mtg", attendeeIds: [] }), [b]);
  assert.deepEqual(await deliver(h, "connection.created", { connectionId: "cn_1", connector: "calendar" }), [c]);
});

test("an archived or already closed task is left alone; done_when clears; a kind with no key is refused", async () => {
  const h = world();
  const archived = await mk(h, "Archived one");
  const closed = await mk(h, "Closed one");
  const cleared = await mk(h, "Cleared one");
  for (const id of [archived, closed, cleared])
    await h.call("tasks.done_when", { taskId: id, kind: "vault_item", key: "k" }, me);
  await h.call("tasks.archive", { taskId: archived }, me);
  await h.call("tasks.transition", { taskId: closed, to: "canceled" }, me);
  await h.call("tasks.done_when", { taskId: cleared }, me);
  assert.equal((await get(h, cleared)).doneWhen, undefined);
  assert.deepEqual(await deliver(h, "vault.item_created", { itemId: "v", name: "k" }), []);
  assert.equal((await get(h, archived)).state, "todo");
  assert.equal((await get(h, closed)).state, "canceled");
  await assert.rejects(h.call("tasks.done_when", { taskId: cleared, kind: "vault_item" }, me));
});
