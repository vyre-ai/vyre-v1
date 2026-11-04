// The busy rule (lane l-machines): Automatic skips a computer with little room and says why. Every rig reports a fixed calm load (test/support/runson.ts), so a test's linked computer is never busy
// by accident on a loaded CI runner; this test reports one as nearly full and checks the product rule still skips it.
import test from "node:test";
import assert from "node:assert/strict";
import { bootDevice, bootSpace, hostLog, loaded, makeAgent, replyAfter, send, startChat } from "./support/runson.ts";

test("Automatic skips a computer reported as nearly full and says so; a calm one takes the turn", { timeout: 60_000 }, async () => {
  const s = await bootSpace();
  const calmMac = await bootDevice();
  try {
    const agentId = await makeAgent(s.d, "Placer");
    await calmMac.link(s);
    const chat = await startChat(s, agentId, "busy-calm");
    assert.equal((await s.as(null, "engine.placement.decide", { threadId: chat, agentId, kind: "message" })).data.placement, "device", "a computer with room takes the turn");
    assert.equal(await replyAfter(s, chat, await send(s, chat, agentId, "whereami", "busy-1")), "ran-on=device handover=no", hostLog(s.d));
  } finally { await calmMac.stop(); await s.stop(); }

  const s2 = await bootSpace();
  const busyMac = await bootDevice({ reportMs: 300, machineReport: loaded });
  try {
    const agentId = await makeAgent(s2.d, "Placer");
    await busyMac.link(s2);
    const rooms = async (): Promise<Array<{ machineId: string; score: number; why: string }>> => ((await s2.as(null, "machines.rooms", { ids: ["device:dev_olivia_mac", "space"] })).data.rooms ?? []) as never;
    for (let i = 0; i < 40 && !(await rooms()).some((r) => r.machineId === "device:dev_olivia_mac" && r.score < 20); i++) await new Promise((r) => setTimeout(r, 250));
    const mine = (await rooms()).find((r) => r.machineId === "device:dev_olivia_mac");
    assert.ok(mine && mine.score < 20, `the loaded report leaves little room: ${JSON.stringify(await rooms())}`);
    const chat = await startChat(s2, agentId, "busy-full");
    const d = (await s2.as(null, "engine.placement.decide", { threadId: chat, agentId, kind: "message" })).data;
    assert.equal(d.reason, "space", JSON.stringify(d));
    assert.match(String(d.moved?.why ?? ""), /CPU at 9\d%|memory at 9\d%/, "the reason says what is full");
    assert.equal(await replyAfter(s2, chat, await send(s2, chat, agentId, "whereami", "busy-2")), "ran-on=space handover=no", hostLog(s2.d));
  } finally { await busyMac.stop(); await s2.stop(); }
});
