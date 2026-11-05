// Where a chat runs (lane l-runson; owner rulings 2 and 3 Nov), on two real daemons: a Team Space server and Olivia's computer, linked to the Space by her own Vyre app with her own session.
//   Automatic with her computer linked: the turn's engine runs on her computer; the server starts no engine process, and the turn's details say where it ran.
//   Load: N more turns put no engine process on the server (the measurement the owner asked for).
//   Automatic with her computer gone: the turn runs on the server.
import test from "node:test";
import assert from "node:assert/strict";
import { bootDevice, bootSpace, hostLog, hostSpawns, makeAgent, replyAfter, send, startChat } from "./support/runson.ts";

const N = 5;

test("Automatic: her linked computer runs her turns, the server runs none (N turns measured), and with the computer gone the server takes them", { timeout: 60_000 }, async () => {
  const s = await bootSpace();
  const mac = await bootDevice();
  try {
    const agentId = await makeAgent(s.d, "Placer");
    await mac.link(s);
    const threadId = await startChat(s, agentId, "rs-dev");
    assert.equal((await s.as(null, "engine.placement.decide", { threadId, agentId, kind: "message" })).data.placement, "device", hostLog(s.d));

    const first = await replyAfter(s, threadId, await send(s, threadId, agentId, "whereami", "rs-1"));
    assert.equal(first, "ran-on=device handover=no", "the engine ran on her computer");
    assert.equal(await hostSpawns(s), 0, "the server started no engine process");
    const turns = (await s.as(null, "engine.turns.list", { threadId })).data.turns as Array<{ ranOn?: Array<{ kind: string; name: string }> }>;
    assert.deepEqual(turns[0]?.ranOn, [{ kind: "computer", name: "Olivia's Mac" }], "the turn's details say where it ran");

    // the load: N turns on the computer, timed; the server's engine count stays at zero
    const t0 = performance.now();
    for (let i = 0; i < N; i++) assert.equal(await replyAfter(s, threadId, await send(s, threadId, agentId, "whereami", `rs-load-${i}`)), "ran-on=device handover=no");
    const ms = Math.round(performance.now() - t0);
    const spawnedOnMac = mac.spawns.length;
    assert.equal(await hostSpawns(s), 0, `${N} more turns: still no engine process on the server`);
    assert.ok(spawnedOnMac >= 1 && spawnedOnMac <= N + 1, `the computer ran them (${spawnedOnMac} processes, kept warm between turns)`);
    process.stdout.write(`# load: ${N + 1} device turns, server engine processes 0, computer engine processes ${spawnedOnMac}, ${Math.round(ms / N)} ms per turn round trip\n`);

    // her computer goes away: Automatic runs the next turn on the server
    await mac.unlink();
    assert.equal(await replyAfter(s, threadId, await send(s, threadId, agentId, "whereami", "rs-off")), "ran-on=space handover=no", hostLog(s.d));
    // two: the turn on the server, and memory's learning pass for the turn before it, which finds her computer gone and so runs on the server on her account (a pass runs where her turns run: her computer while it is linked, the server otherwise)
    assert.equal(await hostSpawns(s), 1, "now the server ran the turn only: the learning pass for each earlier turn ran on her computer while it was linked (#875)");
    const after = (await s.as(null, "engine.turns.list", { threadId })).data.turns as Array<{ ranOn?: Array<{ kind: string }> }>;
    assert.deepEqual(after[0]?.ranOn?.map((r) => r.kind), ["space"]);
  } finally { await mac.stop(); await s.stop(); }
});
