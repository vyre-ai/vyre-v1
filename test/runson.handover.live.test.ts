// Her computer goes away in the middle of a turn (lane l-runson), on two real daemons. Under Automatic the chat says so in one line and the same turn goes on on the server from where it stopped:
// one turn, one reply, one engine process on each side, nothing run twice. Stop on a turn running on her computer stops the engine there.
import test from "node:test";
import assert from "node:assert/strict";
import { bootDevice, bootSpace, hostLog, hostSpawns, lines, makeAgent, messages, replyAfter, send, startChat, waitFor } from "./support/runson.ts";

test("Automatic: the computer drops mid-turn, the chat says so, and the same turn goes on on the server exactly once", { timeout: 60_000 }, async () => {
  const s = await bootSpace();
  const mac = await bootDevice({ slowMs: 3000 });
  try {
    const agentId = await makeAgent(s.d, "Mover");
    await mac.link(s);
    const threadId = await startChat(s, agentId, "rs-ho");
    const before = await send(s, threadId, agentId, "slowwhere", "rs-ho-1");
    await waitFor(async () => (mac.spawns.length === 1 ? true : null), 10_000, () => hostLog(s.d));
    await new Promise((r) => setTimeout(r, 400));   // the first words are out; the engine is mid-turn
    await mac.unlink();   // the computer sleeps

    const reply = await replyAfter(s, threadId, before, 25_000);
    assert.match(reply, /ran-on=space handover=yes$/, `it went on on the server, told where it stopped: ${reply}`);
    const said = await lines(s, threadId);
    assert.ok(said.some((l) => l.state === "note" && l.text === "Your computer went to sleep; continuing on the Core server"), JSON.stringify(said));

    // exactly once: one turn for the message, one agent reply, one engine process on each side
    const turns = (await s.as(null, "engine.turns.list", { threadId })).data.turns as Array<{ state: string; ranOn?: Array<{ kind: string }> }>;
    assert.equal(turns.length, 1, JSON.stringify(turns));
    assert.equal(turns[0]?.state, "completed");
    assert.deepEqual(turns[0]?.ranOn?.map((r) => r.kind), ["computer", "space"], "the turn's details: her computer, then the server");
    const replies = (await messages(s, threadId)).slice(before).filter((m) => m.author?.kind === "agent" && (m.body ?? "") !== "");
    assert.equal(replies.length, 1, "one reply");
    assert.equal(mac.spawns.length, 1, "one engine process on her computer");
    // two on the server: the finished half of the turn, and memory's learning pass for it (her computer is gone by then, so the pass runs where her turns now run)
    assert.equal(await hostSpawns(s), 2, "the turn and its learning pass on the server");
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal((await s.as(null, "engine.turns.list", { threadId })).data.turns.length, 1, "and nothing ran again afterwards");
  } finally { await mac.stop(); await s.stop(); }
});

test("Stop on a turn running on her computer stops the engine there and ends the turn", { timeout: 60_000 }, async () => {
  const s = await bootSpace();
  const mac = await bootDevice({ slowMs: 20_000 });
  try {
    const agentId = await makeAgent(s.d, "Stopper");
    await mac.link(s);
    const threadId = await startChat(s, agentId, "rs-stop");
    await send(s, threadId, agentId, "slowwhere", "rs-stop-1");
    await waitFor(async () => (mac.spawns.length === 1 ? true : null), 10_000, () => hostLog(s.d));
    await new Promise((r) => setTimeout(r, 300));
    const stopped = await s.as(null, "engine.stop", { threadId, agentId });
    assert.equal(stopped.status, 200, JSON.stringify(stopped.data));
    const exit = await Promise.race([mac.spawns[0]!.proc.exited, new Promise((r) => setTimeout(() => r("still running"), 8000))]);
    assert.notEqual(exit, "still running", "the engine on her computer was stopped");
    await waitFor(async () => {
      const t = (await s.as(null, "engine.turns.list", { threadId })).data.turns as Array<{ state: string }>;
      return t[0]?.state === "cancelled" ? true : null;
    }, 10_000, () => hostLog(s.d));
    assert.equal(await hostSpawns(s), 0, "nothing was moved to the server");
  } finally { await mac.stop(); await s.stop(); }
});
