// P-L11_08: golden flow 7, first half: a person to an agent on a booted daemon. A todo until the PRs named in REPLY_GAPS land; it runs and prints its trail without failing the run.
import test from "node:test";
import assert from "node:assert/strict";
import { todoOf } from "./02-space.ts";
import { LIVE_FOR_REPLY, REPLY_GAPS, runAgentReply } from "./07-agent-reply.ts";

test("golden 7: a person talks to an agent and the reply streams back", { todo: todoOf(REPLY_GAPS) }, async () => {
  const { trail } = await runAgentReply(LIVE_FOR_REPLY);
  assert.deepEqual(trail.failures, [], `\n${trail.report()}`);
});
