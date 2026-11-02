// A bare Decline from Home or the sidebar decides the request at its source (AUDIT-modes-needsyou, worst problem 5). Two people can decide: one presses Decline on their own copy; the request is declined, the other's
// copy closes, the person who asked is told, an agent that asked in a chat is told in that chat, and the count falls for both. A booted daemon, real people with their own tokens, a scripted model.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, call, connect, makeAgent, scriptedModel, seededDir, waitFor } from "./support/live.ts";
import type { RunTool } from "./support/live.ts";
import { makeUse } from "./support/bench.ts";
import { as, join } from "./support/people.ts";
import type { Caller } from "./support/people.ts";


test("a bare Decline settles the source, for everyone it was addressed to", async () => {
  const dir = seededDir();
  const heard: string[] = [];
  const d = await boot(dir, scriptedModel(async function* (input: any, run: RunTool) {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const use = makeUse(run, { calls: 0, log: [] });
    const last = String(input.trigger?.body ?? "");
    heard.push(last);
    if (last === "need the key") { yield* use("vault_request", { name: "Fathom_key", reason: "To read the meetings.", idempotencyKey: "nd-key" }); return; }
    yield { type: "text", text: `Heard: ${last}` };
  }));
  try {
    await connect(d);
    const O = as(d, d.token!);
    const bea = await join(d, O, "Admin", "bea", "Bea Baker");
    const cal = await join(d, O, "Member", "cal", "Cal Cruz");
    const B = as(d, bea.token), C = as(d, cal.token);
    const space = (await O("spaces.get")).data.space.id as string;
    const mine = async (who: Caller) => (await who("tasks.needs_you")).data.items as { task: { id: string; title: string; blocks: { type: string }[] } }[];

    // Cal asks: both admins hold a copy
    assert.equal((await C("access.request", { resource: { type: "space", id: space }, level: "view", note: "Please" })).status, 200);
    const oCopy = (await mine(O)).find((i) => i.task.blocks.some((b) => b.type === "access_request"))!;
    const bCopy = (await mine(B)).find((i) => i.task.blocks.some((b) => b.type === "access_request"))!;
    assert.ok(oCopy && bCopy, "each decider has a copy");
    assert.notEqual(oCopy.task.id, bCopy.task.id);

    // Bea presses Decline on her row, the way Home and the sidebar do: no note, her task's own action
    const declined = await B("tasks.act", { taskId: bCopy.task.id, action: "cannot" });
    assert.equal(declined.status, 200, JSON.stringify(declined.data));
    assert.equal(declined.data.task.state, "canceled");
    const req = (await C("access.requests.list", { mine: true })).data.requests[0];
    assert.equal(req.state, "declined", "the request itself is declined");

    // the other copy closes behind it, and nothing waits on anyone
    await waitFor(async () => { await d.hooks?.pump?.(); return (await mine(O)).length === 0 ? true : null; });
    assert.equal((await O("tasks.count_needs_you")).data.count, 0);
    assert.equal((await B("tasks.count_needs_you")).data.count, 0);
    // a press on the other copy, behind the truth, hears it was decided
    assert.match(JSON.stringify((await O("tasks.act", { taskId: oCopy.task.id, action: "cannot" })).data), /Already decided/);
    // the notification stops counting for the people it went to
    const unseen = await waitFor(async () => { await d.hooks?.pump?.(); const n = ((await O("notifications.list", { unseenOnly: true })).data.notifications as { subject?: { id?: string } }[]).filter((x) => x.subject?.id === oCopy.task.id); return n.length === 0 ? n : null; });
    assert.equal(unseen.length, 0);
    // Cal hears the answer
    await waitFor(async () => { await d.hooks?.pump?.(); return ((await C("notifications.list")).data.notifications as { kind: string }[]).some((n) => n.kind === "access.decided") ? true : null; });

    // an agent asked for a key in a chat: a manager's bare Decline reaches the agent there
    const agentId = await makeAgent(d, "Keeper");
    const threadId = (await call(d, "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "nd-start" })).data.thread.threadId as string;
    await call(d, "threads.set_mode", { threadId, mode: "auto", idempotencyKey: "nd-auto" });
    await call(d, "chat.post", { threadId, body: "need the key", idempotencyKey: "nd-post" });
    const key = await waitFor(async () => { await d.hooks?.pump?.(); return (await mine(O)).find((i) => i.task.blocks.some((b) => b.type === "vault_request")) ?? null; }, 15_000, () => JSON.stringify(heard));
    assert.equal((await O("tasks.act", { taskId: key.task.id, action: "cannot", note: "Not this one" })).status, 200);
    await waitFor(async () => { await d.hooks?.pump?.(); return heard.some((w) => /I did not add the Fathom key: Not this one/.test(w)) ? true : null; }, 40_000, () => JSON.stringify(heard));
    assert.equal((await O("tasks.count_needs_you")).data.count, 0);
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
