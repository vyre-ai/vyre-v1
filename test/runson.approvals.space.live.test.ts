// Approvals wake a CLI agent whose turn ran on the Space's own server (lane l-runson; core-solid Wave 1, "Approvals wake Claude Code and Codex agents"): the same as on a person's computer.
import test from "node:test";
import assert from "node:assert/strict";
import { bootSpace, heldThenAnswered, hostLog, hostSpawns, lines, makeAgent, startChat } from "./support/runson.ts";

test("on the server: Approve runs the held call and wakes the agent with the answer; Decline does not run it and tells the agent", { timeout: 60_000 }, async () => {
  const s = await bootSpace();
  try {
    const agentId = await makeAgent(s.d, "Careful");
    const threadId = await startChat(s, agentId, "rs-aps");
    assert.equal((await s.as(null, "threads.set_mode", { threadId, mode: "ask", idempotencyKey: "rs-aps-mode" })).status, 200);
    const yes = await heldThenAnswered(s, threadId, agentId, "Call the client", "approve");
    assert.match(yes.held, /^tasks_create refused: .*"held":true/, yes.held);
    assert.match(yes.after, /Your held call tasks create was approved by .+ and ran/, yes.after);
    assert.match(yes.after, /Call the client/, "the act ran once approved: what it gave back names the task it made");
    assert.ok((await lines(s, threadId)).some((l) => /^Approved by /.test(l.text)), JSON.stringify(await lines(s, threadId)) + hostLog(s.d));
    assert.ok(await hostSpawns(s) >= 1, "it ran on the server");
    const no = await heldThenAnswered(s, threadId, agentId, "Delete everything", "reject");
    assert.match(no.after, /declined by .+: Not this one\. It did not run/, no.after);
  } finally { await s.stop(); }
});
