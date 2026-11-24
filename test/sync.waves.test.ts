// The counts of a wave of passes (18 Nov 2026, the live firm: a burst of Vault reads and reads refused for the connection's own budget, 30% of the app's reads). Five types of one connection start
// together, then are all due at once: no read is refused for the connection's budget, and the Vault is read a few times, not once per request. The loop's speed is in test/sync.waves.perf.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { waves } from "./support/sync-waves.ts";

test("five types of one connection start together: no read is refused for the connection's budget and the Vault is read a few times", async () => {
  const r = await waves(100);
  process.stderr.write(`[waves-counts] ${JSON.stringify(r)}\n`);
  assert.equal(r.pull.refused + r.due.refused, 0, "no read was refused for the connection's own budget");
  assert.ok(r.pull.reads >= 10, "the pulls read");
  assert.ok(
    r.pull.fills < r.pull.reads && r.due.fills <= r.due.reads,
    `the Vault is read once per pass, never once per read (the pulls share reads, a due wave never has more fills than reads): ${r.pull.fills} fills for ${r.pull.reads} reads, ${r.due.fills} for ${r.due.reads}`,
  );
  assert.ok(
    r.pull.fills <= 20 && r.due.fills <= 4,
    `the Vault was read ${r.pull.fills} / ${r.due.fills} times for ${r.pull.reads} / ${r.due.reads} reads`,
  );
});
