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

// review A2: the gateway notes a chrome call with no computer named as the agent's own Space browser; when the browser is not usable the call goes to the agent's computer, and the note follows it
test("a chrome call that falls back from an unusable Space browser to the agent's computer is noted and audited as that computer", async () => {
  const { noteRead, takeReads, takeFallback } = await import("../../../host/src/seams/answer-reads.ts");
  const w = await world();
  const agent = w.agent();
  const ctx = { ...agent.ctx, thread: "thr_fb", actingFor: "usr_maya", trace: { traceId: "trc_fallback" } };
  noteRead({ thread: "thr_fb", agent: ctx.principal.id, asker: "usr_maya", resource: { type: "browser_profile", id: ctx.principal.id } });
  await tool["computers.chrome.snapshot"]!(ctx, {});
  assert.deepEqual(takeReads("thr_fb", ctx.principal.id, "usr_maya"), [{ type: "computer", id: w.id }]);
  assert.equal(takeFallback("trc_fallback"), w.id, "the audit row of this call names the computer");
});
