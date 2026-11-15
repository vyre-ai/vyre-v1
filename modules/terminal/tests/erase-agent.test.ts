// F77: erasing an agent's computer while the daemon has not yet said what runtime the Space has does not skip it: the step fails so the job tries again, and works once the host is bound.
import test from "node:test";
import assert from "node:assert/strict";
import { hostCalls, setTerminalHost } from "../impl.ts";
import { harness, reset } from "../fixtures/harness.ts";

const erase = hostCalls["terminal.erase_agent"] as (ctx: unknown, i: unknown) => Promise<unknown>;

test("with the workspace manager not bound yet the step throws; once the host is bound (no runtime) it clears the rows", async () => {
  reset();
  const h = harness();
  await assert.rejects(erase(h.ctx, { agentId: "agt_desk", dry: false }), /not ready/);
  setTerminalHost(null);
  await erase(h.ctx, { agentId: "agt_desk", dry: false });
});
