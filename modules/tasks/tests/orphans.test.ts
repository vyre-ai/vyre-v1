// Orphans close as a class (lane r42-alive): an ask whose source is gone is put away with one sentence, never deleted, and a second delivery of the same event changes nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, owner, newTask } from "../fixtures/seed.ts";
import { onChatGone, onParentFinished } from "../handlers/orphans.ts";

const me = { id: owner.id };
const svc = { id: "svc_host", kind: "service" as const };
const mk = async (h: Harness, over: Record<string, unknown> = {}): Promise<string> =>
  (await h.call("tasks.create", newTask(over), me)).task.id as string;
const get = async (
  h: Harness,
  id: string,
): Promise<any> => // eslint-disable-line @typescript-eslint/no-explicit-any
  (await h.call("tasks.get", { taskId: id }, me)).task;
const chat = (h: Harness, name: string, threadId: string): Promise<string[]> =>
  Promise.resolve(onChatGone(h.ctxFor("tasks.archive", svc), { name, payload: { threadId } }));

test("a chat that was closed or erased puts away the questions and plans it asked; work from that chat stays", async () => {
  const h = harness();
  const q = await mk(h, { kind: "answer", title: "Which date?", source: { kind: "chat", id: "thr_1" } });
  const plan = await mk(h, { kind: "approve", title: "Approve the plan", source: { kind: "chat", id: "thr_1" } });
  const work = await mk(h, { title: "Write the letter", source: { kind: "chat", id: "thr_1" } });
  const other = await mk(h, { kind: "answer", title: "Another chat", source: { kind: "chat", id: "thr_2" } });
  assert.deepEqual((await chat(h, "thread.closed", "thr_1")).sort(), [q, plan].sort());
  const a = await get(h, q);
  assert.equal(a.archived.code, "gone");
  assert.equal(a.archived.why, "The chat it was asked in was closed.");
  assert.equal(a.state, "todo", "it keeps its state");
  assert.equal((await get(h, work)).archived, undefined);
  assert.equal((await get(h, other)).archived, undefined);
  assert.deepEqual(await chat(h, "thread.erased", "thr_1"), [], "a second delivery, or a later event, changes nothing");
  assert.equal((await get(h, q)).archived.why, "The chat it was asked in was closed.", "the first reason stands");
  // it is reversible
  await h.call("tasks.unarchive", { taskId: q }, me);
  assert.equal((await get(h, q)).archived, undefined);
});

test("a finished parent puts away its Unblock, and an Unblock of a parent still open stays", async () => {
  const h = harness();
  const parent = await mk(h, { assigned: alice });
  const live = await mk(h, { assigned: alice });
  const un = await mk(h, { kind: "unblock", title: "Key needed", parentTaskId: parent });
  const stay = await mk(h, { kind: "unblock", title: "Access needed", parentTaskId: live });
  await h.call("tasks.transition", { taskId: parent, to: "canceled" }, { id: alice.id });
  const ev = h.allEvents.filter((e) => e.name === "task.transitioned" && (e.payload as any).taskId === parent); // eslint-disable-line @typescript-eslint/no-explicit-any
  const ran: string[][] = [];
  for (let i = 0; i < 2; i++)
    for (const e of ev) ran.push(onParentFinished(h.ctxFor("tasks.archive", svc), e as never));
  assert.deepEqual(ran, [[un], []], "put away once");
  assert.equal((await get(h, un)).archived.why, "The task it was blocking is finished.");
  assert.equal((await get(h, stay)).archived, undefined);
});

test("a held act is never put away by its chat closing: the Gate decides that", async () => {
  const h = harness();
  const held = await mk(h, { kind: "approve", title: "Send the email", source: { kind: "gate", id: "act_1" } });
  const asked = await mk(h, { kind: "approve", title: "A plan", source: { kind: "chat", id: "thr_9" } });
  assert.deepEqual(await chat(h, "thread.closed", "thr_9"), [asked]);
  assert.equal((await get(h, held)).archived, undefined);
});
