// Approvals wake a CLI agent whose turn ran on her computer (lane l-runson), on two real daemons, with the Space on this machine's private network so the sandboxed engine on her computer reaches
// Vyre's tools only through its wall (the rule's `space`). The engine calls a change over MCP; Ask first holds it, the card is in the chat, nothing has happened. Approve: the act runs, the chat says
// "Approved by ...", and the agent's next turn starts on her computer with a note from Vyre saying so (not a message in her name). Decline: the act never runs and the agent is told why.
import test from "node:test";
import assert from "node:assert/strict";
import { bootDevice, bootSpace, heldThenAnswered, hostSpawns, lines, makeAgent, startChat } from "./support/runson.ts";

test("on her computer: a held call's card shows; Approve runs it and wakes the agent there with the answer; Decline does not run it and tells the agent", { timeout: 60_000 }, async () => {
  const s = await bootSpace({ lan: true });
  const mac = await bootDevice();
  try {
    const agentId = await makeAgent(s.d, "Careful");
    await mac.link(s);
    const threadId = await startChat(s, agentId, "rs-apd");
    assert.equal((await s.as(null, "threads.set_mode", { threadId, mode: "ask", idempotencyKey: "rs-apd-mode" })).status, 200);

    const yes = await heldThenAnswered(s, threadId, agentId, "Call the client", "approve");
    assert.match(yes.held, /^tasks_create refused: .*"held":true/, `the engine on her computer reached the Space's tools through its wall and was told the call waits: ${yes.held}`);
    assert.match(yes.after, /Your held call tasks create was approved by .+ and ran/, `the agent went on with the answer: ${yes.after}`);
    assert.match(yes.after, /Call the client/, "the act ran once approved: what it gave back names the task it made");
    assert.ok((await lines(s, threadId)).some((l) => /^Approved by /.test(l.text)), "the chat says who approved it");
    assert.ok(mac.spawns.length >= 1);
    assert.equal(await hostSpawns(s), 0, "all of it ran on her computer");

    const no = await heldThenAnswered(s, threadId, agentId, "Delete everything", "reject");
    assert.match(no.after, /Your held call tasks create was declined by .+: Not this one\. It did not run/, no.after);
    assert.ok((await lines(s, threadId)).some((l) => /^Declined by /.test(l.text)));
    const turns = (await s.as(null, "engine.turns.list", { threadId })).data.turns as Array<{ state: string }>;
    assert.ok(turns.every((t) => t.state !== "running"), "nothing is left Working");
    assert.equal(await hostSpawns(s), 0);
  } finally { await mac.stop(); await s.stop(); }
});
