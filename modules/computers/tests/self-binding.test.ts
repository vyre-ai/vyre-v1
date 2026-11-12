// The id left out (review S2, 12 Nov): when an agent calls a tool without naming its computer, the gateway binds the call to the Space, so the question it would have asked on the computer
// (an admin's deny, an exception) is asked here instead, once the computer is known. Both spellings of the same call meet the same answer.
import test from "node:test";
import assert from "node:assert/strict";
import { codeOf } from "../fixtures/harness.ts";
import { tool, world } from "./tools.fixture.ts";

test("an admin's deny on the agent's computer refuses the call that leaves the id out, as it refuses the one that names it at the gateway", async () => {
  const w = await world();
  const agent = w.agent();
  // the screen tools have no Space browser path: leaving the id out means the agent's own computer
  assert.ok(await tool["computers.screen.screenshot"]!(agent.ctx, {}), "allowed before the deny");
  agent.deny(`computer:${w.id}`);
  await assert.rejects(tool["computers.screen.screenshot"]!(agent.ctx, {}), (e: unknown) => codeOf(e) === "permission.no_grant");
});
