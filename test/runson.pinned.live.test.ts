// A chat pinned to her computer (lane l-runson), on two real daemons. With the computer off the turn waits, says so and starts nothing (no Working); it runs there when the computer is back, or
// on the server when she presses "Run it on the server instead". When the computer drops mid-turn the turn waits for it and the same button moves it. A teammate's turn never runs on her computer.
import test from "node:test";
import assert from "node:assert/strict";
import { NOAH, bootDevice, bootSpace, hostLog, hostSpawns, lines, makeAgent, replyAfter, send, startChat, waitFor } from "./support/runson.ts";

test("pinned to her computer: off, the turn waits with the line and no turn starts; back, it runs there; the button runs one on the server; mid-turn it waits and the button moves it", { timeout: 60_000 }, async () => {
  const s = await bootSpace();
  const mac = await bootDevice({ slowMs: 2500 });
  try {
    const agentId = await makeAgent(s.d, "Pinned");
    await mac.link(s);
    const threadId = await startChat(s, agentId, "rs-pin");
    const pin = await s.as(null, "engine.placement.set", { threadId, target: "device", deviceId: "dev_olivia_mac" });
    assert.equal(pin.status, 200, JSON.stringify(pin.data));
    await mac.unlink();

    // off: it waits
    const b1 = await send(s, threadId, agentId, "whereami", "rs-pin-1");
    await waitFor(async () => ((await lines(s, threadId)).some((l) => l.state === "device_wait") ? true : null), 10_000, () => hostLog(s.d));
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(((await s.as(null, "engine.turns.list", { threadId })).data.turns as unknown[]).length, 0, "no turn started: nothing reads Working");
    assert.equal(await hostSpawns(s), 0, "it did not move to the server");
    // back: it runs there
    await mac.link(s);
    assert.equal(await replyAfter(s, threadId, b1), "ran-on=device handover=no");

    // off again: the button runs the waiting one on the server, once
    await mac.unlink();
    const b2 = await send(s, threadId, agentId, "whereami", "rs-pin-2");
    await new Promise((r) => setTimeout(r, 500));
    const once = await s.as(null, "engine.placement.set", { threadId, target: "space", once: true });
    assert.equal(once.status, 200, JSON.stringify(once.data));
    assert.equal(await replyAfter(s, threadId, b2), "ran-on=space handover=no", hostLog(s.d));
    assert.equal((await s.as(null, "engine.placement.options", { threadId, agentId })).data.effective.target, "device", "the chat's own choice stays");

    // mid-turn: it waits for the computer, and the button moves the same turn to the server
    await mac.link(s);
    const spawned = mac.spawns.length;
    const b3 = await send(s, threadId, agentId, "slowwhere", "rs-pin-3");
    await waitFor(async () => (mac.spawns.length > spawned ? true : null), 10_000);
    await new Promise((r) => setTimeout(r, 300));
    await mac.unlink();
    await waitFor(async () => ((await lines(s, threadId)).some((l) => l.text === "Your computer went to sleep. This chat waits for it.") ? true : null), 10_000, () => hostLog(s.d));
    assert.equal((await s.as(null, "engine.placement.set", { threadId, target: "space", once: true })).status, 200);
    assert.match(await replyAfter(s, threadId, b3), /ran-on=space handover=yes$/);
    const turns = (await s.as(null, "engine.turns.list", { threadId })).data.turns as Array<{ ranOn?: Array<{ kind: string }> }>;
    assert.deepEqual(turns[0]?.ranOn?.map((r) => r.kind), ["computer", "space"]);
  } finally { await mac.stop(); await s.stop(); }
});

test("a teammate's turn never runs on her computer: the Space refuses to start it there, and it is never placed there", { timeout: 30_000 }, async () => {
  const s = await bootSpace();
  const mac = await bootDevice();
  try {
    await mac.link(s);
    await assert.rejects(() => s.d.nodeRelay.spawnProc("device:dev_olivia_mac", { argv: ["claude"], env: {}, person: "usr_noah" }), (e) => (e as { code?: string }).code === "permission.no_grant");
    await assert.rejects(() => s.d.nodeRelay.spawnProc("device:dev_olivia_mac", { argv: ["claude"], env: {} }), (e) => (e as { code?: string }).code === "permission.no_grant", "a spawn that names nobody is refused too");
    const agentId = await makeAgent(s.d, "Shared");
    const noahThread = await startChat(s, agentId, "rs-noah", NOAH);
    const placed = await s.as(NOAH, "engine.placement.decide", { threadId: noahThread, agentId, kind: "message" });
    assert.equal(placed.status, 200, JSON.stringify(placed.data));
    assert.notEqual(placed.data.placement, "device", "Noah has no computer linked; Olivia's is not his");
    const pin = await s.as(NOAH, "engine.placement.set", { threadId: noahThread, target: "device", deviceId: "dev_olivia_mac" });
    assert.equal(pin.data.error?.code, "permission.no_grant", JSON.stringify(pin.data));
    assert.equal(mac.spawns.length, 0);
  } finally { await mac.stop(); await s.stop(); }
});
