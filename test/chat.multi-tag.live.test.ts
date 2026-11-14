// A message that tags two agents (chat gap G51, 14 Nov 2026), on a booted daemon with a scripted model: within a second the round read names both agents, both working (ARCH 6.2 changed 14 Nov 2026:
// one turn per agent per chat, so agents asked together run together; this test used to expect one working and one waiting), each agent answers once, and no third turn starts (the lead does not
// answer the other agent's reply).
import test from "node:test";
import fs from "node:fs";
import assert from "node:assert/strict";
import { boot, call, connect, makeAgent, scriptedModel, seededDir, waitFor } from "./support/live.ts";

test("two tagged agents: both show within a second, each answers once, nobody else answers", async () => {
  const dir = seededDir();
  const turnsBy = new Map<string, number>();
  const d = await boot(
    dir,
    scriptedModel(async function* (input: any) {
      const who = String(input.agent?.id ?? "?");
      turnsBy.set(who, (turnsBy.get(who) ?? 0) + 1);
      yield { type: "text", text: "Looking" };
      await new Promise((r) => setTimeout(r, 1500));
      yield { type: "text", text: " into it." };
    }),
  );
  try {
    await connect(d);
    const dex = await makeAgent(d, "Dex");
    const nova = await makeAgent(d, "Nova");
    const started = await call(d, "chat.start", { kind: "chat", agentIds: [dex, nova], idempotencyKey: "mt-start" });
    const threadId = started.data.thread.threadId as string;
    await call(d, "threads.set_mode", { threadId, mode: "auto", idempotencyKey: "mt-auto" });
    const posted = await call(d, "chat.post", {
      threadId,
      body: "@Dex @Nova look at this",
      mentions: [
        { kind: "agent", id: dex },
        { kind: "agent", id: nova },
      ],
      idempotencyKey: "mt-post",
    });
    const messageId = posted.data.message.messageId as string;
    const t0 = Date.now();
    const seen = await waitFor(async () => {
      const r = (await call(d, "engine.round.get", { threadId, messageIds: [messageId] })).data.rounds[0]?.agents as
        | { agentId: string; state: string }[]
        | undefined;
      return r && r.length === 2 ? r : null;
    }, 10_000);
    assert.ok(Date.now() - t0 < 1000, `both showed within a second (${Date.now() - t0} ms)`);
    assert.deepEqual(seen.map((a) => a.state).sort(), ["working", "working"]);
    await waitFor(async () => {
      const msgs = (await call(d, "chat.messages.list", { threadId })).data.messages as { author: { id: string } }[];
      return [dex, nova].every((id) => msgs.some((m) => m.author.id === id)) ? true : null;
    }, 40_000);
    await new Promise((r) => setTimeout(r, 2500));
    const msgs = (await call(d, "chat.messages.list", { threadId })).data.messages as { author: { id: string } }[];
    for (const id of [dex, nova]) assert.equal(msgs.filter((m) => m.author.id === id).length, 1, `${id} replied once`);
    assert.equal(turnsBy.get(dex), 1);
    assert.equal(turnsBy.get(nova), 1);
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
