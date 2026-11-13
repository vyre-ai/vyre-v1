// A vault.use the person's rules hold for approval is said as itself (review 12 Nov, finding 9): the lookup answers "needs approval", not "no access", and no value is read.
import test from "node:test";
import assert from "node:assert/strict";
import { createEngineSessionHost } from "./engine-session.ts";
import type { Invoke } from "../invoke.ts";

test("a held vault.use is needs_approval, and nothing is read from the Vault", async () => {
  let asked = 0;
  const invoke: Invoke = async (cap) => {
    asked++;
    if (cap === "vault.use") return { status: "held", taskId: "tsk_1", traceId: "0".repeat(32) } as never;
    throw new Error(`unscripted ${cap}`);
  };
  const reads: string[] = [];
  const host = createEngineSessionHost({
    invoke,
    space: "spc_t",
    lockedWaitMs: 0,
    vault: {
      secret: async (h) => {
        reads.push(h);
        return "never-0123456789";
      },
      signRs256: async () => "",
    },
  });
  assert.deepEqual(
    await host.source.lookup("#Needs_Ok.key", { agentId: "agt_x", asker: "usr_dana", where: "computer" }),
    { kind: "denied", reason: "needs_approval" },
  );
  assert.deepEqual(reads, [], "no value read");
  assert.equal(asked, 1, "asked once, not retried");
});
