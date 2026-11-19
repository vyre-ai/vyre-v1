// The daily look (lane r42-alive): a stand-in model proposes; the Space only ever puts proposals on the card. "Done" needs a real, later, quoted message in the task's own chat. Nothing is archived or closed by the look,
// it runs once a day with at most 20 tasks in one call, and every run is logged with its tokens.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { DAY, alice, newTask } from "../fixtures/seed.ts";
import { LOOK_MAX, lookOnce, promptOf } from "../handlers/look.ts";
import type { LookDeps } from "../handlers/look.ts";

const me = { id: alice.id };
const mk = async (h: Harness, title: string, over: Record<string, unknown> = {}): Promise<string> =>
  (await h.call("tasks.create", newTask({ title, ...over }), me)).task.id as string;
const get = async (h: Harness, id: string): Promise<any> => (await h.call("tasks.get", { taskId: id }, me)).task; // eslint-disable-line @typescript-eslint/no-explicit-any
const card = async (h: Harness): Promise<{ items: { task: { id: string }; why: string }[]; total: number }> =>
  (await h.call("tasks.still_needed", {}, me)) as never;

function deps(reply: (prompt: string) => string, calls: string[] = []): LookDeps & { calls: string[] } {
  return {
    calls,
    async ask(_s, prompt) {
      calls.push(prompt);
      return { text: reply(prompt), model: "stand-in-mini", tokensIn: 120, tokensOut: 40 };
    },
    async recent(thread) {
      return thread === "thr_1" ? [{ id: "msg_1", at: Date.now() + 1, text: "Payment received, $171.56" }] : [];
    },
    async message(thread, id) {
      return thread === "thr_1" && id === "msg_1"
        ? { body: "Payment received, $171.56", at: Date.now() + 10 * DAY }
        : null;
    },
  };
}
const logOf = (
  h: Harness,
): { model: string; tasks: number; asked: number; done: number; rejected: number; tokens_in: number }[] =>
  h.db.all("SELECT model, tasks, asked, done, rejected, tokens_in FROM tasks_look_log") as never;
const ctxOf = (h: Harness) => h.ctxFor("tasks.clock", { id: "svc_host", kind: "service" });

test("ask goes on the card with a short why; done needs the real quoted message; nothing is archived or closed", async () => {
  const h = harness();
  const a = await mk(h, "Pay the hosting invoice", { source: { kind: "chat", id: "thr_1" } });
  const b = await mk(h, "Plan the offsite");
  const c = await mk(h, "Send the invoice", { source: { kind: "chat", id: "thr_1" } });
  h.advance(8 * DAY);
  const d = deps(() =>
    JSON.stringify([
      { id: a, say: "done", message: "msg_1", quote: "Payment received, $171.56" },
      { id: b, say: "ask", why: "Might be finished, nothing has moved for a week or more." },
      { id: c, say: "done", message: "msg_1", quote: "The invoice is sent and paid" },
    ]),
  );
  const r = await lookOnce(ctxOf(h), d);
  assert.deepEqual(r, { ran: true, asked: 1, done: 1, rejected: 1 });
  const items = (await card(h)).items;
  assert.deepEqual(items.map((i) => i.task.id).sort(), [a, b].sort());
  assert.ok(
    items.every((i) => i.why.length <= 50),
    "every why fits the card line",
  );
  assert.equal(items.find((i) => i.task.id === a)!.why, 'Looks done: "Payment received, $171.56"');
  for (const id of [a, b, c]) {
    const t = await get(h, id);
    assert.equal(t.state, "todo", "the look closes nothing");
    assert.equal(t.archived, undefined, "and archives nothing");
  }
  assert.deepEqual(
    logOf(h).map((l) => ({ ...l })),
    [{ model: "stand-in-mini", tasks: 3, asked: 1, done: 1, rejected: 1, tokens_in: 120 }],
  );
});

test("a quote that is not in the named message, a message that is not in the task's chat, or an unknown task is rejected, not trusted", async () => {
  const h = harness();
  const a = await mk(h, "Pay the hosting invoice", { source: { kind: "chat", id: "thr_1" } });
  const x = await mk(h, "Other chat", { source: { kind: "chat", id: "thr_2" } });
  h.advance(8 * DAY);
  const d = deps(() =>
    JSON.stringify([
      { id: a, say: "done", message: "msg_1", quote: "Everything is finished" },
      { id: x, say: "done", message: "msg_1", quote: "Payment received, $171.56" },
      { id: "tsk_invented", say: "ask", why: "invented" },
    ]),
  );
  const r = await lookOnce(ctxOf(h), d);
  assert.deepEqual([r.asked, r.done, r.rejected], [0, 0, 3]);
  assert.equal((await card(h)).total, 0);
});

test("once a day, at most 20 tasks in one call; the same task is not read again for two weeks; off means no call", async () => {
  const h = harness();
  for (let i = 0; i < 25; i++) await mk(h, `Task ${i}`);
  h.advance(8 * DAY);
  const calls: string[] = [];
  const d = deps(() => "[]", calls);
  assert.equal((await lookOnce(ctxOf(h), d)).ran, true);
  assert.equal(calls.length, 1, "one batched call");
  assert.equal(calls[0]!.split("\n").length, LOOK_MAX, "twenty tasks, a block each");
  assert.equal((await lookOnce(ctxOf(h), d)).ran, false, "not twice in a day");
  h.advance(DAY + 1);
  assert.equal((await lookOnce(ctxOf(h), d)).ran, true, "the next day takes the other five");
  assert.equal(calls[1]!.split("\n").length, 5);
  assert.deepEqual(
    logOf(h).map((l) => l.tasks),
    [20, 5],
  );
  const off = harness();
  await mk(off, "Quiet one");
  off.advance(8 * DAY);
  off.db.run("INSERT OR REPLACE INTO tasks_policy (policy_key, policy_value) VALUES ('tasks.assistant_look', 'false')");
  const offCalls: string[] = [];
  assert.equal(
    (
      await lookOnce(
        ctxOf(off),
        deps(() => "[]", offCalls),
      )
    ).ran,
    false,
  );
  assert.equal(offCalls.length, 0, "switched off: the model is never called");
});

test("no model answer means nothing is logged as a run and nothing changes; fresh, snoozed and asked tasks are not shown", async () => {
  const h = harness();
  await mk(h, "Fresh one");
  h.advance(8 * DAY);
  const stale = await mk(h, "Stale one");
  h.advance(8 * DAY);
  const none: LookDeps = { ask: async () => null, message: async () => null, recent: async () => [] };
  assert.equal((await lookOnce(ctxOf(h), none)).ran, false);
  assert.equal(logOf(h).length, 0);
  const prompts: string[] = [];
  await lookOnce(
    ctxOf(h),
    deps(() => "not json at all", prompts),
  );
  assert.match(prompts[0]!, new RegExp(stale));
  assert.equal((await card(h)).total, 0, "an answer that is not the asked shape proposes nothing");
  assert.match(
    promptOf([{ id: "tsk_1", kind: "work", title: "T", ageDays: 9, source: "manual", lines: [] }]),
    /tsk_1 \| work \| T \| untouched 9 days/,
  );
});
