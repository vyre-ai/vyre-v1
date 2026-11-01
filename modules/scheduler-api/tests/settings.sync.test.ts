// The Space's scheduler.* settings reach the scheduler: the settings module announces a change and the module keeps the copy it reads. Nothing else ever wrote scheduler_api_policy.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { consumers } from "../impl.ts";
import { readPolicy } from "../projections.ts";

const MINUTE = 60_000;
const announce = (h: ReturnType<typeof harness>, key: string, after: unknown): Promise<unknown> => consumers["scheduler.settings_sync"].run({ db: h.db } as never, { payload: { key, scope: "space", after } });

test("changing a scheduler setting changes the policy a pass reads", async () => {
  const h = harness();
  assert.deepEqual(await announce(h, "scheduler.missed_window_minutes", 5), ["scheduler.missed_window_minutes"]);
  assert.equal(readPolicy(h.db).missedWindowMs, 5 * MINUTE);
  assert.deepEqual(await announce(h, "tasks.review_loop_limit", 3), []);
});
