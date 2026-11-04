// Two real daemons (a Team Space server and Olivia's computer, test/support/runson.ts): a chat with Sonnet picked and her computer linked runs on her computer, on her own sign-in, not on the Space's server;
// engine.my_ai says the real values for a turn on the computer and for one on the server; every turn's context carries the line about itself.
import test from "node:test";
import assert from "node:assert/strict";
import { bootDevice, bootSpace, hostLog, hostSpawns, makeAgent, replyAfter, send, startChat, MAC } from "./support/runson.ts";

interface MyAi { running?: { model?: string; paid?: string; account?: { name?: string; ref?: string } }; accounts: Array<{ ref: string; name: string; usable: boolean; models: string[]; limits: { state: string } }>; use: { today: { turns: number; input: number; cachedInput: number } } }

test("Sonnet picked, her computer linked: the turn runs on her computer; my_ai answers the real values on the computer and on the server", { timeout: 90_000 }, async () => {
  const s = await bootSpace();
  const mac = await bootDevice({ signedIn: "claude" });
  try {
    const agentId = await makeAgent(s.d, "Picker");
    await mac.link(s);
    const threadId = await startChat(s, agentId, "ma-1");
    const set = await s.as(MAC, "engine.set_model", { threadId, agentId, model: "claude-sonnet-5-5", idempotencyKey: "ma-1-model" });
    assert.equal(set.status, 200, JSON.stringify(set.data));
    assert.equal((await s.as(null, "engine.placement.decide", { threadId, agentId, kind: "message" })).data.placement, "device", hostLog(s.d));

    assert.equal(await replyAfter(s, threadId, await send(s, threadId, agentId, "whereami", "ma-t1")), "ran-on=device handover=no", hostLog(s.d));
    assert.equal(await hostSpawns(s), 0, "the server ran nothing");
    assert.ok(mac.spawns.length >= 1);
    const onDevice = (await s.as(MAC, "engine.my_ai", { threadId, agentId })).data as MyAi;
    assert.equal(onDevice.running?.model, "claude-sonnet-5-5", "the model that ran, as the turn recorded it");
    assert.ok(onDevice.accounts.length >= 1 && onDevice.accounts.every((a) => typeof a.usable === "boolean" && ["read", "not_readable"].includes(a.limits.state)), JSON.stringify(onDevice.accounts));
    assert.ok(onDevice.use.today.turns >= 1);

    await mac.unlink();
    assert.equal(await replyAfter(s, threadId, await send(s, threadId, agentId, "whereami", "ma-t2")), "ran-on=space handover=no", hostLog(s.d));
    const onServer = (await s.as(MAC, "engine.my_ai", { threadId, agentId })).data as MyAi;
    assert.equal(onServer.running?.model, "claude-sonnet-5-5");
    assert.ok(onServer.use.today.turns >= onDevice.use.today.turns + 1, "the server turn is in her use");
  } finally { await mac.stop(); await s.stop(); }
});

test("every turn's context carries the line about itself, with where it ran", { timeout: 60_000 }, async () => {
  const s = await bootSpace();
  const mac = await bootDevice({ signedIn: "claude" });
  try {
    const agentId = await makeAgent(s.d, "Liner");
    await mac.link(s);
    const threadId = await startChat(s, agentId, "ma-2");
    await s.as(MAC, "engine.set_model", { threadId, agentId, model: "claude-sonnet-5-5", idempotencyKey: "ma-2-model" });
    const raw = await replyAfter(s, threadId, await send(s, threadId, agentId, "rawecho", "ma-r1"));
    assert.match(raw, /This turn runs on Claude Sonnet 5\.5, paid by .+, on the asker's own computer\. What else the person may use and what is left on each is my_ai/, raw.slice(0, 400));
  } finally { await mac.stop(); await s.stop(); }
});
