// notifications.unseen_by_thread: the sidebar's mention badge. Always the caller's own unseen mentions; only mention kinds; only threads; seen and deleted rows do not count; bounded.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { NOW, alice, as, bob } from "../fixtures/seed.ts";
import { UNSEEN_THREADS_MAX } from "../handlers/rules.ts";

let n = 0;
function put(
  h: Harness,
  o: {
    person: string;
    kind?: string;
    thread?: string;
    type?: string;
    count?: number;
    at?: number;
    seen?: boolean;
    deleted?: boolean;
  },
): void {
  h.sqlite
    .prepare(
      "INSERT INTO notifications_items (id, person, kind, level, place, title, subject_type, subject_id, count, at, seen_at, deleted_at) VALUES (?, ?, ?, 'interrupt', 'chats', 'x', ?, ?, ?, ?, ?, ?)",
    )
    .run(
      `ntf_${++n}`,
      o.person,
      o.kind ?? "mention",
      o.type ?? "thread",
      o.thread ?? "thr_a",
      o.count ?? 1,
      o.at ?? NOW + n,
      o.seen ? NOW : null,
      o.deleted ? NOW : null,
    );
}
const ask = (h: Harness, who: typeof alice, threadIds?: string[]) =>
  h.call("notifications.unseen_by_thread", threadIds ? { threadIds } : {}, as(who)) as Promise<{
    counts: { threadId: string; mentions: number }[];
    capped: boolean;
  }>;

test("it counts my own unseen mentions per thread and never another person's", async () => {
  const h = harness();
  put(h, { person: alice.id, thread: "thr_a" });
  put(h, { person: alice.id, thread: "thr_a", count: 2 });
  put(h, { person: alice.id, thread: "thr_b", kind: "mention.thread" });
  put(h, { person: bob.id, thread: "thr_a" });
  put(h, { person: bob.id, thread: "thr_c" });
  const mine = await ask(h, alice);
  assert.deepEqual(mine.counts.map((c) => `${c.threadId}:${c.mentions}`).sort(), ["thr_a:3", "thr_b:1"]);
  assert.equal(mine.capped, false);
  assert.deepEqual((await ask(h, bob)).counts.map((c) => c.threadId).sort(), ["thr_a", "thr_c"]);
});

test("a seen or deleted row, another kind, or a subject that is not a thread counts for nothing", async () => {
  const h = harness();
  put(h, { person: alice.id, seen: true });
  put(h, { person: alice.id, deleted: true });
  put(h, { person: alice.id, kind: "dm" });
  put(h, { person: alice.id, type: "task", thread: "tsk_1" });
  assert.deepEqual((await ask(h, alice)).counts, []);
});

test("with threadIds it answers for those only; an empty list answers nothing", async () => {
  const h = harness();
  put(h, { person: alice.id, thread: "thr_a" });
  put(h, { person: alice.id, thread: "thr_b" });
  assert.deepEqual((await ask(h, alice, ["thr_b"])).counts, [{ threadId: "thr_b", mentions: 1 }]);
  assert.deepEqual((await ask(h, alice, [])).counts, []);
});

test("it is bounded: past the cap the newest threads are named and `capped` says there were more", async () => {
  const h = harness();
  for (let i = 0; i < UNSEEN_THREADS_MAX + 7; i++)
    put(h, { person: alice.id, thread: `thr_${String(i).padStart(4, "0")}`, at: NOW + i });
  const out = await ask(h, alice);
  assert.equal(out.counts.length, UNSEEN_THREADS_MAX);
  assert.equal(out.capped, true);
  assert.equal(out.counts[0]!.threadId, `thr_${String(UNSEEN_THREADS_MAX + 6).padStart(4, "0")}`, "newest first");
});

test("an agent acting for me asks for my mentions, not its own", async () => {
  const h = harness();
  put(h, { person: alice.id, thread: "thr_a" });
  const out = (await h.call(
    "notifications.unseen_by_thread",
    {},
    { id: "agt_bot", kind: "agent", actingFor: alice.id },
  )) as { counts: unknown[] };
  assert.equal(out.counts.length, 1);
});
