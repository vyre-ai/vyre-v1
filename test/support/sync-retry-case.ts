// A first pull of thousands of records that is cut off in the middle (the app answers one page with a 500, or drops the connection) carries on by itself: the failed pass leaves a next poll, the saved place is kept,
// the Sync page says what happened, and every record ends up in, with nobody pressing anything.
import test from "node:test";
import assert from "node:assert/strict";
import { call, hostLog, waitFor } from "./eco-live.ts";
import { pump, rowsOf, spec, world } from "./sync-live.ts";
import type { AppOptions } from "./sync-live.ts";

const TOTAL = 2102; // 2 people and 2,100 more: the first group is 2,000 rows (20 pages of 100), the second the rest

export function retryCase(mode: "500" | "drop"): void {
  test(`a first pull cut off by ${mode === "500" ? "an app error" : "a dropped connection"} in its second group finishes by itself`, async () => {
    const options: AppOptions = { bulk: TOTAL - 2, failOnce: { at: 22, mode } };
    const w = await world(true, options);
    try {
      assert.equal(w.item.status, 200, JSON.stringify(w.item.data));
      const applied = await call(w.d, "sync_specs.apply", {
        spec: spec("people", 100),
        idempotencyKey: `apply-${mode}`,
      });
      assert.equal(applied.status, 200, JSON.stringify(applied.data));
      // the failure shows on the Sync page, and a next poll is already waiting (the pull is not left for somebody to press)
      const failed = await waitFor(
        async () => {
          await pump(w.d);
          const st = (await call(w.d, "sync_types.status", { type: "person" })).data;
          return st.failures?.length ? st : null;
        },
        115_000,
        () => hostLog(w.d),
      );
      assert.ok(failed.failures[0].summary.length > 0, "the page says what happened");
      assert.ok(
        typeof failed.nextPollAt === "number",
        `a next poll is scheduled: ${JSON.stringify(failed.nextPollAt)}`,
      );
      assert.ok(failed.catchingUp === true || failed.records < TOTAL, "it was cut off mid-pull");
      // and it carries on to the end with nothing pressed
      await waitFor(
        async () => {
          await pump(w.d);
          const st = (await call(w.d, "sync_types.status", { type: "person" })).data;
          return st.records >= TOTAL && !st.catchingUp ? st : null;
        },
        115_000,
        () => hostLog(w.d),
      );
      const done = (await call(w.d, "sync_types.status", { type: "person" })).data;
      assert.equal(done.records, TOTAL, "every record is in, none twice");
      assert.ok(typeof done.nextPollAt === "number", "the chain goes on after the pull");
      assert.deepEqual(done.failures, [], "the failure is cleared by the pass that succeeded");
      assert.ok(!JSON.stringify(await rowsOf(w.d, "person")).includes("123-45-6789"));
    } finally {
      await w.close();
    }
  });
}
