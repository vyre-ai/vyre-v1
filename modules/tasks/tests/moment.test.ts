// Moments pass (lane r42-alive): a task that names the moment it stops mattering is put away one day after it, with the reason; a due date alone never does that; an agent that names none gets one;
// Put back after a moment passed is not undone a minute later; the clock says it once.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { DAY, alice, bot, newTask } from "../fixtures/seed.ts";

const me = { id: alice.id };
const svc = { id: "svc_host", kind: "service" as const };
const agent = { id: bot.id, kind: "agent" as const };
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
const tick = async (h: Harness): Promise<number> => (await h.call("tasks.clock", {}, svc)).passed as number;

test("a task is put away one day after its moment, once, with the reason; before that it stays", async () => {
  const h = harness();
  const at = h.now() + 2 * 3_600_000;
  const id = await mk(h, { title: "Join the Thursday call", relevantUntil: at });
  assert.equal((await get(h, id)).relevantUntil, at);
  h.advance(DAY);
  assert.equal(await tick(h), 0, "inside the grace the task stays");
  h.advance(2 * 3_600_000 + DAY);
  assert.equal(await tick(h), 1);
  const t = await get(h, id);
  assert.equal(t.archived.code, "passed");
  assert.match(t.archived.why, /^It was for \w{3} \d+ \w{3}\.$/);
  assert.equal(t.state, "todo", "it keeps its state");
  assert.equal(await tick(h), 0, "said once");
});

test("a due date alone never puts a task away: overdue work is still owed", async () => {
  const h = harness();
  const id = await mk(h, { title: "Send the letter", due: h.now() - 30 * DAY });
  h.advance(DAY);
  assert.equal(await tick(h), 0);
  assert.equal((await get(h, id)).archived, undefined);
});

const card = async (h: Harness): Promise<{ items: { task: { id: string }; why: string }[]; total: number }> =>
  (await h.call("tasks.still_needed", {}, me)) as never;

test("an agent that names no moment gets a guessed one (due plus a day, else 14 days); the guess never archives, it asks", async () => {
  const h = harness();
  const due = h.now() + 3 * DAY;
  const withDue = await mk(h, { title: "Reply to the client", due }, agent);
  const bare = await mk(h, { title: "Check the report" }, agent);
  const named = await mk(h, { title: "The agent named it", relevantUntil: h.now() + DAY }, agent);
  assert.equal((await get(h, withDue)).relevantUntil, due + DAY);
  assert.equal((await get(h, bare)).relevantUntil, h.now() + 14 * DAY);
  const person = await mk(h, { title: "Mine" });
  assert.equal((await get(h, person)).relevantUntil, undefined, "a person's task has none unless they name one");
  h.advance(2 * DAY + 1);
  assert.equal(await tick(h), 1, "the moment the agent named archives by itself");
  assert.equal((await get(h, named)).archived.code, "passed");
  h.advance(14 * DAY);
  assert.equal(await tick(h), 0, "a guess archives nothing");
  assert.equal((await get(h, withDue)).archived, undefined);
  assert.equal((await get(h, bare)).archived, undefined);
  const c = await card(h);
  assert.deepEqual(c.items.map((i) => i.task.id).sort(), [bare, withDue].sort(), "both are on the card, with why");
  assert.ok(c.items.every((i) => i.why !== ""));
  assert.equal(await tick(h), 0);
  assert.equal((await card(h)).total, 2, "asked once, not again");
});

test("nobody answers the card for a week: the task archives itself, with that reason, and Put back drops the guess", async () => {
  const h = harness();
  const id = await mk(h, { title: "Check the report" }, agent);
  h.advance(15 * DAY);
  await tick(h);
  assert.equal((await card(h)).total, 1);
  h.advance(6 * DAY);
  assert.equal(await tick(h), 0, "still inside the week");
  h.advance(2 * DAY);
  assert.equal(await tick(h), 1);
  const t = await get(h, id);
  assert.equal(t.archived.code, "quiet");
  assert.equal((await card(h)).total, 0);
  await h.call("tasks.unarchive", { taskId: id }, me);
  assert.equal((await get(h, id)).relevantUntil, undefined);
  h.advance(30 * DAY);
  assert.equal(await tick(h), 0, "put back means it still matters: not asked or archived again");
  assert.equal((await card(h)).total, 0);
});

test("Keep stops the question for 90 days; Archive puts the task away with the person's own words", async () => {
  const h = harness();
  const keep = await mk(h, { title: "Keep me" }, agent);
  const drop = await mk(h, { title: "Drop me" }, agent);
  h.advance(15 * DAY);
  await tick(h);
  const r = (await h.call("tasks.still_answer", { taskIds: [keep], answer: "keep" }, me)) as {
    kept: number;
    archived: number;
  };
  assert.deepEqual(r, { kept: 1, archived: 0 });
  const r2 = (await h.call("tasks.still_answer", { taskIds: [drop], answer: "archive" }, me)) as {
    kept: number;
    archived: number;
  };
  assert.deepEqual(r2, { kept: 0, archived: 1 });
  assert.equal((await get(h, drop)).archived.code, "asked");
  assert.equal((await card(h)).total, 0);
  h.advance(60 * DAY);
  assert.equal(await tick(h), 0, "kept: nothing is asked or archived");
  assert.equal((await get(h, keep)).archived, undefined);
  assert.equal((await card(h)).total, 0);
});

test("Put back after a moment passed clears the moment, so the task is not put away again", async () => {
  const h = harness();
  const id = await mk(h, { title: "Join the call", relevantUntil: h.now() + 1000 });
  h.advance(DAY + 2000);
  assert.equal(await tick(h), 1);
  await h.call("tasks.unarchive", { taskId: id }, me);
  const t = await get(h, id);
  assert.equal(t.archived, undefined);
  assert.equal(t.relevantUntil, undefined);
  h.advance(DAY);
  assert.equal(await tick(h), 0);
});

test("a closed task is left alone, and a task someone is waiting on is not put away by the clock", async () => {
  const h = harness();
  const done = await mk(h, { title: "Done already", relevantUntil: h.now() + 1000 });
  await h.call("tasks.transition", { taskId: done, to: "done" }, me);
  const waited = await mk(h, { title: "Waited on", relevantUntil: h.now() + 1000 });
  const waiter = await mk(h, { title: "Waits", dependsOn: [waited] });
  h.advance(DAY + 2000);
  assert.equal(await tick(h), 0);
  assert.equal((await get(h, waited)).archived, undefined);
  assert.equal((await get(h, waiter)).archived, undefined);
});
