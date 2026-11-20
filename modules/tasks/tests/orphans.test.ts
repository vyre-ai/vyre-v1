// Orphans close as a class (lane r42-alive): an ask whose source is gone is put away with one sentence, never deleted, and a second delivery of the same event changes nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, owner, newTask } from "../fixtures/seed.ts";
import { onChatGone, onGoalEnded, onParentFinished } from "../handlers/orphans.ts";

const me = { id: owner.id };
const svc = { id: "svc_host", kind: "service" as const };
const mk = async (
  h: Harness,
  over: Record<string, unknown> = {},
  who: Parameters<Harness["call"]>[2] = me,
): Promise<string> => (await h.call("tasks.create", newTask(over), who)).task.id as string;
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
  // a held act is made the way the Gate makes it: by the server
  const held = await mk(
    h,
    { kind: "approve", title: "Send the email", source: { kind: "gate", id: "act_1" }, assigned: owner },
    { id: "svc_system", kind: "service" },
  );
  const asked = await mk(h, { kind: "approve", title: "A plan", source: { kind: "chat", id: "thr_9" } });
  assert.deepEqual(await chat(h, "thread.closed", "thr_9"), [asked]);
  assert.equal((await get(h, held)).archived, undefined);
});

test("a goal that ended puts away the questions and holds it left open, not its work, and not another goal's", async () => {
  const h = harness();
  const ask = await mk(h, { kind: "answer", title: "Which budget?", source: { kind: "goal", id: "gol_1" } });
  const work = await mk(h, { title: "Write the report", source: { kind: "goal", id: "gol_1" } });
  const other = await mk(h, { kind: "answer", title: "Another goal", source: { kind: "goal", id: "gol_2" } });
  const ended = (): string[] =>
    onGoalEnded(h.ctxFor("tasks.archive", svc), {
      name: "goal.ended",
      payload: { goalId: "gol_1", outcome: "missed" },
    });
  assert.deepEqual(ended(), [ask]);
  assert.equal((await get(h, ask)).archived.why, "The goal it was part of ended (missed).");
  assert.equal((await get(h, work)).archived, undefined);
  assert.equal((await get(h, other)).archived, undefined);
  assert.deepEqual(ended(), [], "a second delivery changes nothing");
});

test("a request a goal's end put away says why on the task and in what the Space did, and one press puts it back for good: a redelivered event never puts it away again", async () => {
  const h = harness();
  const ask = await mk(h, { kind: "answer", title: "Which budget?", source: { kind: "goal", id: "gol_1" } });
  const ended = (): string[] =>
    onGoalEnded(h.ctxFor("tasks.archive", svc), {
      name: "goal.ended",
      payload: { goalId: "gol_1", outcome: "stopped" },
    });
  assert.deepEqual(ended(), [ask]);
  const news = (await h.call("tasks.changes", { since: 0 }, { id: alice.id })) as {
    items: { taskId: string; why: string }[];
  };
  assert.deepEqual(
    news.items.map((i) => [i.taskId, i.why]),
    [[ask, "The goal it was part of ended (stopped)."]],
  );
  await h.call("tasks.unarchive", { taskId: ask }, me);
  assert.deepEqual(ended(), [], "the same event again leaves it alone");
  assert.equal((await get(h, ask)).archived, undefined);
});
