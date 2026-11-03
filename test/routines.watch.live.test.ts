// A watcher acts (owner report, rc.16): a watcher on #intake answers a new message there once, in that thread, for the person who set it, with the message in its agent's input; its own answer
// and routine posts never set it off again; and its run is finished when the agent's turn ends, so the watcher's Last run says it was done. A booted daemon and a scripted model.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, call, connect, hostLog, makeAgent, scriptedModel, seededDir, waitFor } from "./support/live.ts";

test("a watcher on #intake answers a new message there once, and its run ends done", async () => {
  const dir = seededDir();
  const notices: string[] = [];
  const d = await boot(dir, scriptedModel(async function* (input) {
    const notice = String((input as { notice?: string }).notice ?? "");
    if (notice !== "") notices.push(notice);
    yield { type: "text", text: /car accident/.test(notice) ? "Thanks for writing in. What is the best phone number to reach you?" : "ok" };
  }));
  const pump = async (): Promise<void> => { await (d as unknown as { hooks?: { pump?: () => Promise<void> } }).hooks?.pump?.(); };
  try {
    await connect(d);
    const agentId = await makeAgent(d, "Greeter");
    const ch = (await call(d, "channels.create", { name: "intake", visibility: "public", idempotencyKey: "w-ch" })).data.channel as { channelId: string; mainThreadId: string };
    const saved = await call(d, "agents.routine.save", { agentId, title: "Greet new leads", kind: "watch", watch: { on: "message", channelId: ch.channelId }, prompt: "Greet them and ask for a phone number.", idempotencyKey: "w-1" });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const routineId = saved.data.routine.routineId as string;
    await call(d, "chat.post", { threadId: ch.mainThreadId, body: "Hi, I was in a car accident last week and need help.", idempotencyKey: "w-msg" });
    const msgs = async () => (await call(d, "chat.messages.list", { threadId: ch.mainThreadId })).data.messages as Array<{ body: string; author: { kind: string; id: string }; via?: { routineOwner: string } }>;
    const answer = await waitFor(async () => { await pump(); return (await msgs()).find((m) => m.author.id === agentId) ?? null; }, 30_000, () => hostLog(d));
    assert.match(answer.body, /best phone number/);
    assert.ok(answer.via?.routineOwner?.startsWith("usr_"), "labelled as the owner's watcher");
    assert.match(notices.find((x) => /Greet new leads/.test(x)) ?? "", /car accident last week/, "the new message was the agent's input");
    // the watcher's Last run: done once the turn ended
    const last = await waitFor(async () => { await pump(); const r = (await call(d, "agents.routines.list", { agentId })).data.routines.find((x: { routineId: string }) => x.routineId === routineId); return r?.lastRun?.status === "succeeded" ? r.lastRun : null; }, 15_000, () => hostLog(d));
    const run = (await call(d, "runs.get", { runId: last.runId })).data.run as { status: string; threadId?: string };
    assert.equal(run.status, "succeeded");
    // its own answer, a routine's post, did not set it off again
    for (let i = 0; i < 6; i++) { await pump(); await new Promise((r) => setTimeout(r, 250)); }
    const fromAgent = (await msgs()).filter((m) => m.author.id === agentId);
    assert.equal(fromAgent.length, 1, "answered once");
    assert.equal(notices.filter((x) => /Greet new leads/.test(x)).length, 1, "woken once");
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
