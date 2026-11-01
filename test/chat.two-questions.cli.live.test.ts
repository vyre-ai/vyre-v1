// An agent that asks, is answered, and asks again while its turn is still open, on the real engine and the real CLI driver around a persistent CLI process that finishes its sentence after it asks
// (found on a live run: the second answer's wake landed and nothing followed). The CLI is the fake claude of host/tests/fixtures/fake-cli-driver, which answers prompts one after another like the real one.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boot, call, connect, hostLog, makeAgent, seededDir, waitFor } from "./support/live.ts";

const FAKE_CLI = fileURLToPath(new URL("../host/tests/fixtures/fake-cli-driver/fake-cli.mjs", import.meta.url));
const cli = { command: { claude: [process.execPath, FAKE_CLI, "claude"] }, programRead: [path.dirname(FAKE_CLI)] };

test("a second question asked while the turn is still open is answered, and the agent goes on", { timeout: 100_000 }, async () => {
  const dir = seededDir();
  const d = await boot(dir, null, { engineCli: cli });
  try {
    await connect(d);
    const agentId = await makeAgent(d, "Asker");
    const threadId = (await call(d, "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "tqc-start" })).data.thread.threadId as string;
    await call(d, "threads.set_mode", { threadId, mode: "auto", idempotencyKey: "tqc-auto" });
    // The answers are what the person picks; the fake CLI reads an answer that starts with "askhold" as its next instruction, as a model reads an answer as its next step.
    const second = `askhold 1500 ${JSON.stringify({ threadId, prompt: "Second?", mode: "single", options: [{ key: "go", label: "Apply it" }, { key: "no", label: "Stop" }] })}`;
    const first = `askhold 1500 ${JSON.stringify({ threadId, prompt: "First?", mode: "single", options: [{ key: "a", label: second }, { key: "b", label: "No" }] })}`;
    await call(d, "chat.post", { threadId, body: first, mentions: [{ kind: "agent", id: agentId }], idempotencyKey: "tqc-post" });
    const open = async (): Promise<string | null> => {
      await d.hooks?.pump?.();
      const msgs = (await call(d, "chat.messages.list", { threadId })).data.messages as { blocks?: { type: string; blockId?: string; id?: string; state?: string; data?: { answer?: unknown } }[] }[];
      seen = JSON.stringify(msgs.map((m) => ({ k: (m as { author?: { kind?: string } }).author?.kind, body: (m as { body?: string }).body?.slice(0, 80), blocks: (m.blocks ?? []).map((b) => `${b.type}:${b.state}`) }))) + " LOG " + hostLog(d).slice(-600);
      for (const m of msgs) for (const b of m.blocks ?? []) if (b.type === "question" && b.state !== "done" && b.data?.answer === undefined) return b.blockId ?? b.id ?? null;
      return null;
    };
    const quick = async (ok: (id: string) => boolean): Promise<string> => waitFor(async () => { const id = await open(); return id !== null && ok(id) ? id : null; }, 40_000, () => `no open question; the thread holds ${JSON.stringify(shown())}`);
    let seen = "";
    const shown = (): string => seen;
    // answer the moment each card exists: the CLI is still inside its turn, finishing its sentence
    const q1 = await quick(() => true);
    await call(d, "chat.answer_block", { threadId, blockId: q1, answer: { keys: ["a"] }, idempotencyKey: "tqc-a1" });
    const q2 = await quick((id) => id !== q1);
    await call(d, "chat.answer_block", { threadId, blockId: q2, answer: { keys: ["go"] }, idempotencyKey: "tqc-a2" });
    // the agent must go on: a turn that ends the way the second answer reads, "Apply it", echoed by the fake CLI
    await waitFor(async () => {
      await d.hooks?.pump?.();
      const msgs = (await call(d, "chat.messages.list", { threadId })).data.messages as { author?: { kind?: string }; body?: string }[];
      return msgs.some((m) => m.author?.kind === "agent" && /Apply it/.test(m.body ?? "")) ? true : null;
    }, 40_000, () => `the agent did not go on after the second answer; ${hostLog(d)}`);
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
