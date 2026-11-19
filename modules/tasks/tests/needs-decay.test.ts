// Needs you is small and true (lane r42-alive): a late due date loses weight (half every 3 days after the 2nd), so work due two weeks ago is not the top row, and a row that is only a day late still is.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, owner, newTask } from "../fixtures/seed.ts";
import { needsScore } from "../projections.ts";

const DAY = 86_400_000;
const mk = async (h: Harness, over: Record<string, unknown>): Promise<string> =>
  (await h.call("tasks.create", newTask(over), { id: owner.id })).task.id as string;
const order = async (h: Harness): Promise<string[]> =>
  ((await h.call("tasks.needs_you", {}, { id: alice.id })).items as { task: { id: string } }[]).map((i) => i.task.id);

test("the freshness of a late row is whole for 2 days, then halves every 3 days", () => {
  const sod = Date.UTC(2026, 10, 19);
  assert.equal(needsScore("overdue", sod - DAY, sod), 1);
  assert.equal(needsScore("overdue", sod - 2 * DAY, sod), 1);
  assert.equal(needsScore("overdue", sod - 5 * DAY, sod), 0.5);
  assert.equal(needsScore("overdue", sod - 14 * DAY, sod), 0.5 ** 4);
  assert.equal(needsScore("ready", undefined, sod), 1);
  assert.equal(needsScore("due_today", sod, sod), 1);
});

test("work due two weeks ago ranks below a fresh request and below work one day late; the order never drops a row", async () => {
  const h = harness();
  const now = h.now();
  const old = await mk(h, { title: "Two weeks late", due: now - 14 * DAY });
  const fresh = await mk(h, { kind: "review", title: "Review the brief" });
  const late = await mk(h, { title: "One day late", due: now - DAY });
  const ids = await order(h);
  assert.deepEqual([...ids].sort(), [old, fresh, late].sort(), "every row is still there");
  assert.equal(ids.at(-1), old, "the stale one is last");
  assert.ok(ids.indexOf(late) < ids.indexOf(fresh), "a day late still comes first");
});
