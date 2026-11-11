// The access.sync equivalence stream (fixtures/incremental.ts) on three more seeds; tests/sync.incremental.test.ts runs two, and the targeted cases. Split so each file stays well inside
// the fast runner's 30 s cap on a loaded box.
import test from "node:test";
import assert from "node:assert/strict";
import { stream } from "../fixtures/incremental.ts";

for (const seed of [42, 1905, 31337]) {
  test(`1 seed ${seed}: after every step the kept snapshot equals one built from the tables, and authorize answers the same`, async () => {
    const c = await stream(seed, 300);
    console.log(`seed ${seed}: in place ${c.inPlace}, rebuilt from the kept store ${c.rebuilt}, read from the tables ${c.hydrated}, restarts ${c.restarts}, handler calls ${c.handler}, plain SQL ${c.external}`);
    assert.ok(c.inPlace > 50, "the stream changed the kept snapshot in place");
    assert.ok(c.rebuilt > 20, "the stream built a new snapshot from the kept store");
    assert.ok(c.hydrated > c.restarts, "the stream read the tables again after other writers");
  });
}

