// An agent that asks a question, is answered, and asks a second one in the turn that answer starts must be woken by the second answer too (found on a real run of Sync to Records, where the agent
// went quiet after the person answered its second question). A booted daemon, a scripted model, and a person answering through chat.answer_block as the card does.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, call, connect, makeAgent, scriptedModel, seededDir, waitFor } from "./support/live.ts";
import type { RunTool } from "./support/live.ts";
import { makeUse } from "./support/bench.ts";

test("a second question asked in the turn an answer started is answered, and the agent goes on", async () => {
  const dir = seededDir();
  let turns = 0;
  const d = await boot(dir, scriptedModel(async function* (input: any, run: RunTool) {
    const use = makeUse(run, { calls: 0, log: [] });
    turns++;
    if (turns === 1) { yield* use("ask_question", { threadId: input.threadId, prompt: "First?", mode: "single", options: [{ key: "a", label: "Yes" }, { key: "b", label: "No" }] }); return; }
    if (turns === 2) { yield { type: "text", text: "Here is the preview." }; yield* use("ask_question", { threadId: input.threadId, prompt: "Second?", mode: "single", options: [{ key: "go", label: "Apply" }, { key: "no", label: "Stop" }] }); return; }
    yield { type: "text", text: "All applied." };
  }));
  try {
    await connect(d);
    const agentId = await makeAgent(d, "Asker");
    const started = await call(d, "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "tq-start" });
    const threadId = started.data.thread.threadId as string;
    await call(d, "threads.set_mode", { threadId, mode: "auto", idempotencyKey: "tq-auto" });
    await call(d, "chat.post", { threadId, body: "Go.", mentions: [{ kind: "agent", id: agentId }], idempotencyKey: "tq-post" });
    const open = async (): Promise<string | null> => {
      const msgs = (await call(d, "chat.messages.list", { threadId })).data.messages as { blocks?: { type: string; blockId?: string; id?: string; state?: string; data?: { answer?: unknown } }[] }[];
      for (const m of msgs) for (const b of m.blocks ?? []) if (b.type === "question" && b.state !== "done" && b.data?.answer === undefined) return b.blockId ?? b.id ?? null;
      return null;
    };
    // answer the moment the card exists, as a fast tap or a script does: the agent may not have parked yet
    const quick = async (ok: (id: string) => boolean): Promise<string> => { const end = Date.now() + 40_000; while (Date.now() < end) { const id = await open(); if (id !== null && ok(id)) return id; await new Promise((r) => setTimeout(r, 3)); } throw new Error(`no question (turns ${turns})`); };
    const first = await quick(() => true);
    await call(d, "chat.answer_block", { threadId, blockId: first, answer: { keys: ["a"] }, idempotencyKey: "tq-a1" });
    const second = await quick((id) => id !== first);
    await call(d, "chat.answer_block", { threadId, blockId: second, answer: { keys: ["go"] }, idempotencyKey: "tq-a2" });
    await waitFor(async () => {
      const msgs = (await call(d, "chat.messages.list", { threadId })).data.messages as { body?: string }[];
      return msgs.some((m) => m.body === "All applied.") ? true : null;
    }, 40_000, () => `turns ${turns}: the agent did not resume after the second answer`);
    assert.ok(turns >= 3);
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
