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

function deps(
  reply: (prompt: string) => string,
  calls: string[] = [],
  o: { readable?: boolean; ready?: boolean; reads?: string[] } = {},
): LookDeps & { calls: string[] } {
  return {
    calls,
    async ready() {
      return o.ready !== false;
    },
    async readable() {
      return o.readable !== false;
    },
    async ask(_s, prompt) {
      calls.push(prompt);
      return { text: reply(prompt), model: "stand-in-mini", tokensIn: 120, tokensOut: 40 };
    },
    async recent(thread) {
      o.reads?.push(thread);
      return thread === "thr_1" ? [{ id: "msg_1", at: Date.now() + 1, text: "Payment received, $171.56" }] : [];
    },
    async message(thread, id) {
      return thread === "thr_1" && id === "msg_1"
        ? { body: "Payment received, $171.56", at: Date.now() + 10 * DAY, by: "usr_sara" }
        : null;
    },
  };
}
const logOf = (
  h: Harness,
): { model: string; tasks: number; asked: number; done: number; rejected: number; tokens_in: number }[] =>
  h.db.all("SELECT model, tasks, asked, done, rejected, tokens_in FROM tasks_look_log") as never;
const ctxOf = (h: Harness) => {
  h.db.run("INSERT OR REPLACE INTO tasks_policy (policy_key, policy_value) VALUES ('tasks.assistant_look', 'true')");
  return h.ctxFor("tasks.clock", { id: "svc_host", kind: "service" });
};

test("ask goes on the card with a short why; done needs the real quoted message; nothing is archived or closed", async () => {
  const h = harness();
  const a = await mk(h, "Pay the hosting invoice", { source: { kind: "chat", id: "thr_1" } });
  const b = await mk(h, "Plan the offsite");
  const c = await mk(h, "Send the invoice", { source: { kind: "chat", id: "thr_1" } });
  h.advance(8 * DAY);
  const d = deps(() =>
    JSON.stringify([
      { id: a, say: "done", message: "msg_1", quote: "Payment received, $171.56" },
      { id: b, say: "ask" },
      { id: c, say: "done", message: "msg_1", quote: "The invoice is sent and paid" },
    ]),
  );
  h.callee("threads.get", () => ({ thread: { kind: "chat", members: [{ kind: "person", id: alice.id }] } }));
  const r = await lookOnce(ctxOf(h), d);
  assert.deepEqual(r, { ran: true, asked: 1, done: 1, rejected: 1 });
  const items = (await card(h)).items;
  assert.deepEqual(items.map((i) => i.task.id).sort(), [a, b].sort());
  assert.ok(
    items.every((i) => i.why.length <= 50),
    "every why fits the card line",
  );
  const looked = items.find((i) => i.task.id === a) as { lookDone?: { quote?: string; by?: string } } | undefined;
  assert.deepEqual(
    { quote: looked?.lookDone?.quote, by: looked?.lookDone?.by },
    { quote: "Payment received, $171.56", by: "usr_sara" },
  );
  assert.equal((items.find((i) => i.task.id === b) as { lookDone?: unknown }).lookDone, undefined);
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
  const offCalls: string[] = [];
  assert.equal(
    (
      await lookOnce(
        off.ctxFor("tasks.clock", { id: "svc_host", kind: "service" }),
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
  const none: LookDeps = {
    ready: async () => true,
    readable: async () => true,
    ask: async () => null,
    message: async () => null,
    recent: async () => [],
  };
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

test("Done on a looks-done row closes the task through the ordinary move; the card forgets it", async () => {
  const h = harness();
  h.callee("tasks.transition", (input) => h.call("tasks.transition", input, me));
  const a = await mk(h, "Pay the hosting invoice", { source: { kind: "chat", id: "thr_1" } });
  h.advance(8 * DAY);
  await lookOnce(
    ctxOf(h),
    deps(() => JSON.stringify([{ id: a, say: "done", message: "msg_1", quote: "Payment received, $171.56" }])),
  );
  assert.equal((await card(h)).total, 1);
  const r = (await h.call("tasks.still_answer", { taskIds: [a], answer: "done" }, me)) as { done: number };
  assert.equal(r.done, 1);
  assert.equal((await get(h, a)).state, "done");
  assert.equal((await card(h)).total, 0);
});

test("privacy: a chat everyone on the task cannot read is never read or quoted; no account costs no chat read; a model's own words never become a looks-done row; the quote must be after the task last moved", async () => {
  const h = harness();
  const a = await mk(h, "Pay the hosting invoice", { source: { kind: "chat", id: "thr_1" } });
  h.advance(8 * DAY);
  const reads: string[] = [];
  const closed = deps(
    () => JSON.stringify([{ id: a, say: "done", message: "msg_1", quote: "Payment received, $171.56" }]),
    [],
    {
      readable: false,
      reads,
    },
  );
  const r = await lookOnce(ctxOf(h), closed);
  assert.deepEqual([r.done, r.rejected], [0, 1], "a private chat proves nothing");
  assert.deepEqual(reads, [], "and none of its lines was read");
  assert.equal(((await card(h)).items as { lookDone?: unknown }[]).length, 0);
  // no account: no chat read at all, and nothing logged
  const h2 = harness();
  await mk(h2, "Pay", { source: { kind: "chat", id: "thr_1" } });
  h2.advance(8 * DAY);
  const reads2: string[] = [];
  assert.equal(
    (
      await lookOnce(
        ctxOf(h2),
        deps(() => "[]", [], { ready: false, reads: reads2 }),
      )
    ).ran,
    false,
  );
  assert.deepEqual(reads2, []);
  // a model that writes "Looks done: ..." as its ask text gets a plain line, never the Done row
  const h3 = harness();
  const b = await mk(h3, "Plan the offsite");
  h3.advance(8 * DAY);
  await lookOnce(
    ctxOf(h3),
    deps(() => JSON.stringify([{ id: b, say: "ask", why: "A private line from the chat: the merger is off" }])),
  );
  const it = (await card(h3)).items[0] as { why: string; lookDone?: unknown };
  assert.equal(it.why, "Might be finished.", "the reason is the app's own fixed sentence, never the model's words");
  assert.equal(it.lookDone, undefined, "no lookDone: the app draws no Done row");
  // the message is older than the task's last move
  const h4 = harness();
  const c = await mk(h4, "Pay the hosting invoice", { source: { kind: "chat", id: "thr_1" } });
  h4.advance(8 * DAY);
  const old = deps(() =>
    JSON.stringify([{ id: c, say: "done", message: "msg_1", quote: "Payment received, $171.56" }]),
  );
  old.message = async () => ({ body: "Payment received, $171.56", at: 1, by: "usr_sara" });
  const r4 = await lookOnce(ctxOf(h4), old);
  assert.equal(r4.done, 0);
});

test("someone who cannot move the task cannot answer done on it", async () => {
  const h = harness();
  h.callee("tasks.transition", (input) => h.call("tasks.transition", input, me));
  const a = await mk(h, "Pay the hosting invoice", { source: { kind: "chat", id: "thr_1" } });
  h.advance(8 * DAY);
  await lookOnce(
    ctxOf(h),
    deps(() => JSON.stringify([{ id: a, say: "done", message: "msg_1", quote: "Payment received, $171.56" }])),
  );
  const stranger = { id: "usr_cara" };
  h.callee("tasks.transition", (input) => h.call("tasks.transition", input, stranger));
  const r = (await h.call("tasks.still_answer", { taskIds: [a], answer: "done" }, stranger)) as { done: number };
  assert.equal(r.done, 0);
  assert.equal((await get(h, a)).state, "todo", "it was not closed");
  assert.equal((await card(h)).total, 1, "and it is still on the card for the people on the task");
});

test("the quote reaches only a reader who can read that chat right now; anyone else on the card sees that it looks done and where to look", async () => {
  const h = harness();
  const a = await mk(h, "Pay the hosting invoice", {
    source: { kind: "chat", id: "thr_1" },
    reviewer: { kind: "person", id: "usr_cara" },
  });
  h.advance(8 * DAY);
  await lookOnce(
    ctxOf(h),
    deps(() => JSON.stringify([{ id: a, say: "done", message: "msg_1", quote: "Payment received, $171.56" }])),
  );
  let members = [alice.id, "usr_cara"];
  h.callee("threads.get", () => ({ thread: { kind: "chat", members: members.map((id) => ({ kind: "person", id })) } }));
  const seen = async (who: string) =>
    (
      (await h.call("tasks.still_needed", {}, { id: who })) as {
        items: { lookDone?: { threadId: string; quote?: string; by?: string } }[];
      }
    ).items[0]!.lookDone;
  assert.equal((await seen(alice.id))?.quote, "Payment received, $171.56", "a member of the chat reads the quote");
  members = [alice.id]; // the reviewer is not in the chat
  const cara = await seen("usr_cara");
  assert.deepEqual(cara, { threadId: "thr_1" }, "another person on the task sees only that it looks done and where");
  assert.equal((await seen(alice.id))?.quote, "Payment received, $171.56");
  h.callee("threads.get", () => {
    throw new Error("not found");
  });
  assert.deepEqual(
    await seen(alice.id),
    { threadId: "thr_1" },
    "a chat that no longer opens for the reader shows no quote",
  );
});
