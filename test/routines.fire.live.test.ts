// Scheduled routines fire (owner report, rc.16: a routine "Hi every minute" was on, its next run had come, and nothing ever ran). A booted daemon, its real scheduler and a scripted model:
// a routine set to post Hi every minute makes its agent post Hi in the routine's chat within about a minute, for the routine's owner and labelled as their routine, and its next run moves on.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, call, connect, hostLog, makeAgent, scriptedModel, seededDir, waitFor } from "./support/live.ts";

test("a routine set to post Hi every minute posts Hi in its chat within about a minute", async () => {
  const dir = seededDir();
  const notices: string[] = [];
  const d = await boot(dir, scriptedModel(async function* (input) {
    const notice = String((input as { notice?: string }).notice ?? "");
    if (notice !== "") notices.push(notice);
    yield { type: "text", text: /Hi every minute/.test(notice) ? "Hi" : "ok" };
  }));
  try {
    await connect(d);
    const agentId = await makeAgent(d, "Pinger");
    const saved = await call(d, "agents.routine.save", { agentId, title: "Hi every minute", cron: "* * * * *", prompt: "Post Hi.", idempotencyKey: "fire-1" });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const routine = saved.data.routine as { routineId: string; nextRunAt: number };
    const posted = await waitFor(async () => {
      await (d as unknown as { hooks?: { pump?: () => Promise<void> } }).hooks?.pump?.();
      const chats = (await call(d, "threads.list", { kind: ["chat"], limit: 50 })).data.threads as Array<{ threadId: string; title?: string }>;
      const chat = chats.find((t) => t.title === "Hi every minute");
      if (!chat) return null;
      const msgs = (await call(d, "chat.messages.list", { threadId: chat.threadId })).data.messages as Array<{ body: string; author: { kind: string; id: string }; via?: { routineOwner: string } }>;
      const hi = msgs.find((m) => m.author.kind === "agent" && m.author.id === agentId && m.body.trim() === "Hi");
      return hi ? { chat, hi, msgs } : null;
    }, 80_000, () => hostLog(d));
    assert.ok(posted.hi.via?.routineOwner?.startsWith("usr_"), "labelled as the owner's routine");
    assert.equal(posted.msgs.filter((m) => m.author.kind === "person").length, 0, "nothing was posted in the owner's name: the instructions were the agent's input");
    assert.match(notices.find((x) => /Hi every minute/.test(x)) ?? "", /Post Hi\./, "the agent was given the routine's instructions");
    const after = (await call(d, "agents.routines.list", { agentId })).data.routines[0] as { lastRunAt?: number; nextRunAt: number };
    assert.ok(after.lastRunAt !== undefined && after.nextRunAt > routine.nextRunAt, "it ran, and its next run moved on");
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
