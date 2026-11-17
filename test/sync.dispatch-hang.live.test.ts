// The field fault of 17 Nov (rc.26): one pull whose app never answered held the scheduler's tick for ever, so every other queued sync stayed queued with the server idle. A pass that hangs is ended at
// its deadline with a reason, the jobs behind it start by themselves, and the hung one is tried again and finishes. Nobody presses anything.
import test from "node:test";
import assert from "node:assert/strict";
import { call, hostLog, waitFor } from "./support/eco-live.ts";
import { rowsOf, spec, world } from "./support/sync-live.ts";

test("a pull that never gets an answer does not hold the queue: the other types are pulled by themselves, and the hung one is tried again", async () => {
  const w = await world(true, { hang: { path: "/api/people", times: 1, skip: 1 } }, { scheduleDeadlineMs: 4_000 });
  try {
    assert.equal(w.item.status, 200, JSON.stringify(w.item.data));
    const applied = await call(w.d, "sync_specs.apply", { spec: spec(), idempotencyKey: "apply-hang" });
    assert.equal(applied.status, 200, JSON.stringify(applied.data));
    // the three other types come in with nothing pressed and no manual call to connectors.sync_run
    await waitFor(
      async () => {
        for (const t of ["matter", "contact", "company"]) if ((await rowsOf(w.d, t)).length === 0) return null;
        return true;
      },
      45_000,
      () => hostLog(w.d),
    );
    // the hung pull was ended with the reason and tried again: the people arrive too
    await waitFor(
      async () => ((await rowsOf(w.d, "person")).length >= 2 ? true : null),
      50_000,
      () => hostLog(w.d),
    );
    assert.match(hostLog(w.d), /did not finish within/, "the log says why the pass was ended");
  } finally {
    await w.close();
  }
});
