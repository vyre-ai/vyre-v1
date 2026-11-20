// Evidence first (lane r42-alive): the event that proves a task done closes it Done with the proof as its note; a second delivery, another name, a closed or archived task change nothing; done_when can be cleared.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, reasonOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, newTask } from "../fixtures/seed.ts";
import { onEvidence } from "../handlers/evidence.ts";

const me = { id: alice.id };
const svc = { id: "svc_host", kind: "service" as const };
const world = (): Harness => {
  const h = harness();
  h.callee("tasks.transition", (input) => h.call("tasks.transition", input, svc));
  h.callee("meetings.get", () => ({}));
  return h;
};
const mk = async (h: Harness, title: string): Promise<string> =>
  (await h.call("tasks.create", newTask({ title }), me)).task.id as string;
const get = async (h: Harness, id: string): Promise<any> => (await h.call("tasks.get", { taskId: id }, me)).task; // eslint-disable-line @typescript-eslint/no-explicit-any
const deliver = (
  h: Harness,
  name: string,
  payload: Record<string, unknown>,
  actor: string | null = alice.id,
): Promise<string[]> => onEvidence(h.ctxFor("tasks.transition", svc), { name, payload, ...(actor ? { actor } : {}) });

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

test("evidence never settles a held act or an Approve task, and done_when on one is refused at set time", async () => {
  const h = world();
  const approve = await mk(h, "Approve the send");
  await h.call("tasks.create", newTask({ kind: "approve", title: "Approve" }), me).then(async (r) => {
    await assert.rejects(h.call("tasks.done_when", { taskId: r.task.id, kind: "vault_item", key: "k" }, me), (e) => {
      assert.equal((e as { reason?: string }).reason ?? reasonOf(e), "held_act");
      return true;
    });
  });
  // a held act is made the way the Gate makes it: by the server
  const held = (
    await h.call("tasks.create", newTask({ title: "Held", source: { kind: "gate", id: "act_1" } }), {
      id: "svc_system",
      kind: "service",
    })
  ).task.id as string;
  await assert.rejects(h.call("tasks.done_when", { taskId: held, kind: "vault_item", key: "k" }, me));
  // even a proof that was somehow stored does not close it
  h.db.run("INSERT INTO tasks_proof (task_id, kind, key) VALUES (?, 'vault_item', 'k')", held);
  h.db.run("INSERT INTO tasks_proof (task_id, kind, key) VALUES (?, 'vault_item', 'k')", approve + "x");
  assert.deepEqual(await deliver(h, "vault.item_created", { itemId: "v", name: "k" }), []);
  assert.equal((await get(h, held)).state, "todo");
  void approve;
});

test("only the doing of someone on the task closes it: another person's Vault item proves nothing, and the proof is not an oracle", async () => {
  const h = world();
  const id = await mk(h, "Put the key in the Vault");
  await h.call("tasks.done_when", { taskId: id, kind: "vault_item", key: "secret name" }, me);
  assert.deepEqual(await deliver(h, "vault.item_created", { itemId: "v", name: "secret name" }, "usr_stranger"), []);
  assert.deepEqual(await deliver(h, "vault.item_created", { itemId: "v", name: "secret name" }, null), []);
  assert.equal((await get(h, id)).state, "todo", "a stranger's item did not close it");
  assert.deepEqual(await deliver(h, "vault.item_created", { itemId: "v", name: "secret name" }, alice.id), [id]);
});

test("a meeting the setter cannot open is refused at set time; one refusal while closing does not stop the others", async () => {
  const h = world();
  h.callee("meetings.get", () => {
    throw new Error("not found");
  });
  const m = await mk(h, "Hold the call");
  await assert.rejects(h.call("tasks.done_when", { taskId: m, kind: "meeting_ended", key: "rec_hidden" }, me));
  const h2 = world();
  const a = await mk(h2, "First");
  const b = await mk(h2, "Second");
  for (const id of [a, b]) await h2.call("tasks.done_when", { taskId: id, kind: "vault_item", key: "k" }, me);
  await h2.call("tasks.transition", { taskId: a, to: "in_review" }, me).catch(() => undefined);
  h2.callee("tasks.transition", (input) => {
    if ((input as { taskId: string }).taskId === a) throw new Error("refused");
    return h2.call("tasks.transition", input, svc);
  });
  const closed = await deliver(h2, "vault.item_created", { itemId: "v", name: "k" });
  assert.deepEqual(closed, [b]);
});

test("an agent states what proves a task done when it creates it, in one call; a held act or an Approve task refuses it", async () => {
  const h = world();
  const id = (
    await h.call("tasks.create", newTask({ title: "Put the key in the Vault", doneWhen: "vault_item:Hosting Key" }), me)
  ).task.id as string;
  assert.deepEqual((await get(h, id)).doneWhen, { kind: "vault_item", key: "hosting key" });
  assert.deepEqual(await deliver(h, "vault.item_created", { itemId: "v", name: "hosting key" }), [id]);
  await assert.rejects(
    h.call("tasks.create", newTask({ kind: "approve", title: "Approve", doneWhen: "vault_item:k" }), me),
  );
  await assert.rejects(
    h.call(
      "tasks.create",
      newTask({ title: "Held", source: { kind: "gate", id: "act_9" }, doneWhen: "vault_item:k" }),
      { id: "svc_system", kind: "service" },
    ),
  );
});

test("tasks.archive with back puts a task back, the same as tasks.unarchive", async () => {
  const h = world();
  const id = await mk(h, "Archive then back");
  await h.call("tasks.archive", { taskId: id, why: "later" }, me);
  assert.ok((await get(h, id)).archived);
  await h.call("tasks.archive", { taskId: id, back: true }, me);
  assert.equal((await get(h, id)).archived, undefined);
});

test("tasks.update sets, changes and clears what proves a task done, with the same refusals as at creation", async () => {
  const h = world();
  const id = await mk(h, "Put the key in the Vault");
  await h.call("tasks.update", { taskId: id, doneWhen: "vault_item:Hosting Key" }, me);
  assert.deepEqual((await get(h, id)).doneWhen, { kind: "vault_item", key: "hosting key" });
  await h.call("tasks.update", { taskId: id, doneWhen: "message_sent:rec_client" }, me);
  assert.deepEqual((await get(h, id)).doneWhen, { kind: "message_sent", key: "rec_client" });
  assert.deepEqual(
    await deliver(h, "vault.item_created", { itemId: "v", name: "hosting key" }),
    [],
    "the old proof no longer counts",
  );
  await h.call("tasks.update", { taskId: id, doneWhen: "" }, me);
  assert.equal((await get(h, id)).doneWhen, undefined, "empty clears it");
  assert.deepEqual(await deliver(h, "message.sent", { messageId: "m", channel: "email", contactId: "rec_client" }), []);
  await h.call("tasks.update", { taskId: id, doneWhen: "vault_item:k2" }, me);
  assert.deepEqual(await deliver(h, "vault.item_created", { itemId: "v", name: "k2" }), [id]);
  // the refusals
  const approve = (await h.call("tasks.create", newTask({ kind: "approve", title: "Approve" }), me)).task.id as string;
  await assert.rejects(h.call("tasks.update", { taskId: approve, doneWhen: "vault_item:k" }, me));
  const other = await mk(h, "Another");
  await assert.rejects(h.call("tasks.update", { taskId: other, doneWhen: "nonsense:k" }, me));
  await assert.rejects(
    h.call("tasks.update", { taskId: other, doneWhen: "vault_item:k" }, { id: "usr_cara" }),
    "someone not on the task cannot",
  );
});

test("tasks.update takes doneWhen only from someone who may let the task go, not from someone who can merely edit it; create treats an empty doneWhen as no proof; the key and why have a length limit", async () => {
  const h = harness({ authorize: (who, _a, r) => who.id === "usr_granted" && r.type === "task" });
  h.callee("meetings.get", () => ({}));
  const id = (await h.call("tasks.create", newTask({ title: "Put the key in the Vault" }), me)).task.id as string;
  const granted = { id: "usr_granted" };
  // someone with edit on the task may change its title ...
  await h.call("tasks.update", { taskId: id, title: "Put the hosting key in the Vault" }, granted);
  // ... but not say what proves it done
  await assert.rejects(h.call("tasks.update", { taskId: id, doneWhen: "vault_item:k" }, granted), (e) => {
    assert.equal(reasonOf(e), "wrong_actor");
    return true;
  });
  assert.equal((await h.call("tasks.get", { taskId: id }, me)).task.doneWhen, undefined);
  // an empty doneWhen at creation is no proof, the same as on update
  const none = (await h.call("tasks.create", newTask({ title: "No proof", doneWhen: "" }), me)).task.id as string;
  assert.equal((await h.call("tasks.get", { taskId: none }, me)).task.doneWhen, undefined);
  // lengths
  await assert.rejects(h.call("tasks.update", { taskId: id, doneWhen: `vault_item:${"x".repeat(250)}` }, me));
  await assert.rejects(h.call("tasks.archive", { taskId: id, why: "y".repeat(301) }, me));
});
