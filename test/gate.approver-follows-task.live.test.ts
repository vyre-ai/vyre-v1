// The Gate is the one source of truth for who decides a hold (lane l-hooks-gitproxy), on a booted daemon: an agent's held call waits on Olivia; she delegates the approval to Noah; the hold follows the task
// (gate.approver_moved is on the log with who moved it, from whom and to whom); Olivia's own approval after that is refused, Noah's runs it; and an agent cannot move an approval at all.
import test from "node:test";
import assert from "node:assert/strict";
import { bootSpace, hostLog, makeAgent, MAC, NOAH, send, startChat } from "./support/runson.ts";
import { waitFor } from "./support/live.ts";

test("reassigning a held approval moves the hold's approver, audited; the old approver is refused, the new one decides, and the move is audited", { timeout: 90_000 }, async () => {
  const s = await bootSpace();
  try {
    const agentId = await makeAgent(s.d, "Careful");
    const threadId = await startChat(s, agentId, "rs-follow");
    assert.equal((await s.as(null, "threads.set_mode", { threadId, mode: "ask", idempotencyKey: "rs-follow-mode" })).status, 200);
    await send(s, threadId, agentId, `tool tasks_create ${JSON.stringify({ title: "Call the client", assigned: { kind: "person", id: "usr_olivia" }, idempotencyKey: "rs-follow-1" })}`, "rs-follow-send");
    const hold = await waitFor(async () => {
      await s.d.hooks?.pump?.();
      const h = (await s.as(null, "gate.holds.list", { states: ["held"] })).data.holds as Array<{ id: string; taskId: string; capName: string }> | undefined;
      return h?.find((x) => x.capName === "tasks.create") ?? null;
    }, 20_000, () => hostLog(s.d));

    const moved = await s.as(MAC, "tasks.assign", { taskId: hold.taskId, slot: "approver", to: { kind: "person", id: "usr_noah" } });
    assert.equal(moved.status, 200, JSON.stringify(moved.data));
    const event = await waitFor(async () => {
      await s.d.hooks?.pump?.();
      const ev = (await s.d.log!.read({ type: "gate.approver_moved", limit: 20 })).map((e) => JSON.parse(new TextDecoder().decode(e.payload)) as Record<string, any>).find((p) => p.holdId === hold.id);   // eslint-disable-line @typescript-eslint/no-explicit-any
      return ev ?? null;
    }, 15_000, () => hostLog(s.d));
    assert.deepEqual([event.to.id, event.how], ["usr_noah", "assigned"]);
    assert.ok(event.by, "who moved it is on the log");
    assert.equal(event.from.id, "usr_olivia", "from whom");

    // Olivia's own approval is refused now; Noah's runs it
    const old = await s.as(MAC, "tasks.act", { taskId: hold.taskId, action: "approve" });
    assert.notEqual(old.status, 200, "the previous approver can no longer release it");
    const now = await s.as(NOAH, "tasks.act", { taskId: hold.taskId, action: "approve" });
    assert.equal(now.status, 200, JSON.stringify(now.data));
  } finally { await s.stop(); }
});

test("a member who is not the approver cannot take a held approval by assigning it to themselves: the hold stays with its approver and the member's approval is refused", { timeout: 90_000 }, async () => {
  const s = await bootSpace();
  try {
    const agentId = await makeAgent(s.d, "Careful");
    const threadId = await startChat(s, agentId, "rs-self");
    assert.equal((await s.as(null, "threads.set_mode", { threadId, mode: "ask", idempotencyKey: "rs-self-mode" })).status, 200);
    await send(s, threadId, agentId, `tool tasks_create ${JSON.stringify({ title: "Call the client", assigned: { kind: "person", id: "usr_olivia" }, idempotencyKey: "rs-self-1" })}`, "rs-self-send");
    const hold = await waitFor(async () => {
      await s.d.hooks?.pump?.();
      const h = (await s.as(null, "gate.holds.list", { states: ["held"] })).data.holds as Array<{ id: string; taskId: string; capName: string }> | undefined;
      return h?.find((x) => x.capName === "tasks.create") ?? null;
    }, 20_000, () => hostLog(s.d));
    await s.as(NOAH, "tasks.assign", { taskId: hold.taskId, slot: "approver", to: { kind: "person", id: "usr_noah" } });   // refused or ignored, never followed
    await s.d.hooks?.pump?.();
    const moves = (await s.d.log!.read({ type: "gate.approver_moved", limit: 20 })).map((e) => JSON.parse(new TextDecoder().decode(e.payload)) as Record<string, any>).filter((p) => p.holdId === hold.id);   // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.deepEqual(moves, [], "a move by someone who cannot decide it is not followed");
    const mine = await s.as(NOAH, "tasks.act", { taskId: hold.taskId, action: "approve" });
    assert.notEqual(mine.status, 200, JSON.stringify(mine.data));
    const still = (await s.as(null, "gate.holds.list", { states: ["held"] })).data.holds as Array<{ id: string }>;
    assert.ok(still.some((x) => x.id === hold.id), "still held");
  } finally { await s.stop(); }
});
