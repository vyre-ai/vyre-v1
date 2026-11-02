// A Job comes back (DESIGN-chat-system, Job): a helper the lead starts on itself runs, its answer is its own line in the chat that started it, and that line wakes the lead through the engine with no person's
// message anywhere, on a shared chat billing the person who started the Job. A booted daemon and a scripted model that does what the lead's tool call would do.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, call, connect, makeAgent, scriptedModel, seededDir, waitFor } from "./support/live.ts";
import type { RunTool } from "./support/live.ts";
import { makeUse } from "./support/bench.ts";

interface Seen { threadId: string; agent: string; body: string; author: string; asker: string }
type D = Parameters<typeof call>[0];
type Line = { body?: string; messageId: string; author: { kind: string; id: string }; blocks?: Array<{ type: string; data?: Record<string, unknown> }> };
const lines = async (d: D, threadId: string) => ((await call(d, "chat.messages.list", { threadId })).data.messages as Line[]);

test("a helper the lead starts on itself runs, and its answer is its own line and wakes the lead", async () => {
  const dir = seededDir();
  const seen: Seen[] = [];
  const d = await boot(dir, scriptedModel(async function* (input: any, run: RunTool) {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const use = makeUse(run, { calls: 0, log: [] });
    const body = String(input.trigger?.body ?? "");
    seen.push({ threadId: input.threadId, agent: input.agent.id, body, author: String(input.trigger?.author?.kind ?? ""), asker: String(input.asker ?? "") });
    if (/^look into the lease/.test(body)) {
      yield* use("sub_task_model", { threadId: input.threadId, title: "Read the lease", instruction: "Find the rent date.", model: "scripted", provider: "anthropic" });
      yield { type: "text", text: "Waiting on the helper." };
      return;
    }
    if (/^Find the rent date/.test(body)) { yield { type: "text", text: "The rent is due on the first." }; return; }
    if (/^Helper "Read the lease" found/.test(body)) { yield { type: "text", text: "It is due on the first." }; return; }
  }));
  try {
    await connect(d);
    const lead = await makeAgent(d, "Lead");
    const threadId = (await call(d, "chat.start", { kind: "chat", agentIds: [lead], idempotencyKey: "jw-start" })).data.thread.threadId as string;
    await call(d, "threads.set_mode", { threadId, mode: "auto", idempotencyKey: "jw-auto" });
    await call(d, "chat.post", { threadId, body: "look into the lease please", idempotencyKey: "jw-1" });

    const pump = () => d.hooks?.pump?.();
    // the brief ran in the helper thread, as the agent's own words
    const brief = await waitFor(async () => { await pump(); return seen.find((s) => /^Find the rent date/.test(s.body)) ?? null; });
    assert.notEqual(brief.threadId, threadId, "the helper has a thread of its own");
    assert.equal(brief.author, "agent", "a brief the agent gave itself stays the agent's");
    const first = (await lines(d, brief.threadId))[0]!;
    assert.deepEqual([first.author.kind, first.author.id], ["agent", lead]);

    // its answer is the helper's line in the chat, never a person's, and it names the thread
    const result = await waitFor(async () => { await pump(); return (await lines(d, threadId)).find((m) => /^Helper "Read the lease" found/.test(m.body ?? "")) ?? null; });
    assert.match(result.body!, /The rent is due on the first/);
    assert.deepEqual([result.author.kind, result.author.id], ["agent", lead], "the helper's own line");
    const block = result.blocks?.find((b) => b.type === "helper");
    assert.deepEqual([block?.data?.["threadId"], block?.data?.["status"]], [brief.threadId, "done"]);

    // the line woke the lead, which wrote it, as the agent's words
    const woke = await waitFor(async () => { await pump(); return seen.find((s) => s.threadId === threadId && /^Helper "Read the lease" found/.test(s.body)) ?? null; });
    assert.equal(woke.author, "agent", "a Job's words never reach the lead as a person's");
    await waitFor(async () => { await pump(); return (await lines(d, threadId)).find((m) => m.body === "It is due on the first.") ?? null; });

    // the lead's reply to that wake is an ordinary line: it wakes nothing, so there is no loop
    await new Promise((r) => setTimeout(r, 400));
    await pump();
    assert.equal(seen.filter((s) => s.threadId === threadId).length, 2, "the ask, then the wake");
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
