// Who may pause, go on with, or ask a subagent to stop (r42-runtime): the server, on behalf of someone runs.node.control or a limit has already checked; never a person or an agent at the gateway, whoever they are.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/harness.ts";
import { pause, resumePaused, subagentStop } from "../handlers/control.ts";
import type { EngineCtx } from "../projections.ts";

const code = (e: unknown): string | undefined => (e as { error?: { code?: string } } | null)?.error?.code;
const as = (kind: "person" | "agent", id: string, depth = 0): EngineCtx =>
  ({ ...harness().ctx, principal: { kind, id }, depth }) as unknown as EngineCtx;
const T = `thr_${"a".repeat(32)}`;

test("a person at the gateway, a member who is not the owner and an agent of another job are all refused on each of the three", async () => {
  for (const who of [as("person", "usr_owner"), as("person", "usr_member"), as("agent", `agt_${"b".repeat(32)}`)]) {
    assert.equal(
      code(await pause(who, { threadId: T }).catch((e) => e)),
      "permission.no_grant",
      `pause as ${who.principal.id}`,
    );
    assert.equal(
      code(await resumePaused(who, { threadId: T }).catch((e) => e)),
      "permission.no_grant",
      `resume as ${who.principal.id}`,
    );
    assert.equal(
      code(await subagentStop(who, { threadId: T, runId: `run_${"c".repeat(28)}` }).catch((e) => e)),
      "permission.no_grant",
      `stop as ${who.principal.id}`,
    );
  }
});
