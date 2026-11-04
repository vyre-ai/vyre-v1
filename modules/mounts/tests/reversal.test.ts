// Mounts: putting back an earlier revision of a mounted file an agent changed teaches that agent (lib/reversal.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { withReversals } from "../../../lib/reversal.ts";
import { REVERSALS } from "../handlers/reversals.ts";

test("restoring a revision after an agent changed the file", async () => {
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  const ctx = {
    principal: { kind: "person", id: "usr_alice" },
    async call(cap: string, input: unknown) { calls.push({ cap, input: input as Record<string, unknown> }); return cap === "events.list" ? { events: [{ seq: 1, id: "evt_1", type: "file.version_added", actor: "agt_bot", payload: {}, subject: { type: "file", id: "fil_1" } }] } : {}; },
  };
  await withReversals({ "mounts.restore": async () => ({ restored: true }) }, REVERSALS)["mounts.restore"](ctx, { fileId: "fil_1", revisionId: "rev_1" });
  assert.deepEqual(calls.filter((c) => c.cap === "memory.corrections.record").map((c) => c.input), [{ agentId: "agt_bot", how: "reverse", was: "changed a file in a connected folder", ref: "reverse:evt_1" }]);
});
