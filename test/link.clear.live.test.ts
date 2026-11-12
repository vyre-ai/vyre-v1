// In an ordinary chat an agent may open any link (lead's ruling for rc.26, 12 Nov, on the owner's rule of 2 Nov): a link it puts together goes through before and after it has read a page, so
// look-ups in a row leave no card. And one approval resumes the one held call once: the person's next message makes one turn (an approved parked turn was woken a second time, which started a
// turn of its own on the person's newest message). Real daemon, Gate and tools; the model is scripted.
import test from "node:test";
import assert from "node:assert/strict";
import { claimedSpace, scriptedModel, stop, waitFor } from "./support/eco-live.ts";

test("links the agent puts together go through in an Auto chat, after it has read a page too: three look-ups, no approve task", async () => {
  let lead = ""; const results: string[] = [];
  const model = scriptedModel(async function* (input, run) {
    if (input.agent.id !== lead) return;
    yield* run("tool_search", { query: "read link" });
    const n = results.length;
    results.push(JSON.stringify(yield* run("read_link", { url: `https://www.rates-${n}.example/` })).slice(0, 100));
    results.push(JSON.stringify(yield* run("read_link", { url: `https://www.other-${n}.example/compare` })).slice(0, 100));   // a new host, after a page was read
    yield { type: "text", text: "Done." };
  });
  const s = await claimedSpace(model); lead = s.assistant;
  try {
    const chat = (await s.api("chat.start", { kind: "chat", agentIds: [lead], title: "P", idempotencyKey: "c-chat" })).thread.threadId as string;
    await s.api("threads.set_mode", { threadId: chat, mode: "auto", idempotencyKey: "c-auto" });
    const approvals = async () => ((await s.api("tasks.list", { kinds: ["approve"], scope: "mine" })).tasks ?? []) as Array<{ id: string; title?: string }>;
    for (const [i, body] of ["look up the first rates", "now the second", "and a third"].entries()) {
      await s.api("chat.post", { threadId: chat, body, mentions: [{ kind: "agent", id: lead }], idempotencyKey: `c-ask${i}` });
      await waitFor(async () => (results.length >= (i + 1) * 2 ? true : null), 30_000, async () => `${results.join(" | ")} ${JSON.stringify(await approvals())}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
    assert.deepEqual(await approvals(), [], `no approve task: ${results.join(" | ")}`);
    assert.ok(results.every((r) => !/held|needs_approval/.test(r)), results.join(" | "));
  } finally { await stop(s.d); }
});

test("after an allowed change, the person's next message makes one turn, not two", async () => {
  let lead = ""; const results: string[] = [];
  const model = scriptedModel(async function* (input, run) {
    if (input.agent.id !== lead) return;
    if (input.resumed) { results.push(`resumed:${input.resumed.approved}`); yield { type: "text", text: "Done." }; return; }
    results.push(`turn:${(input.trigger?.body ?? "").slice(0, 20)}`);
    if (/note/.test(input.trigger?.body ?? "")) {
      yield* run("tool_search", { query: "notes create" });
      yield* run("notes_create", { title: "Rates", body: "From the web", idempotencyKey: "d-note" });
    }
    yield { type: "text", text: "Done." };
  });
  const s = await claimedSpace(model); lead = s.assistant;
  try {
    const chat = (await s.api("chat.start", { kind: "chat", agentIds: [lead], title: "P", idempotencyKey: "d-chat" })).thread.threadId as string;
    await s.api("threads.set_mode", { threadId: chat, mode: "ask", idempotencyKey: "d-ask-mode" });
    const approvals = async () => ((await s.api("tasks.list", { kinds: ["approve"], scope: "mine" })).tasks ?? []) as Array<{ id: string }>;
    await s.api("chat.post", { threadId: chat, body: "write a note", mentions: [{ kind: "agent", id: lead }], idempotencyKey: "d-ask1" });
    const t1 = await waitFor(async () => (await approvals())[0]?.id ?? null, 30_000, () => results.join(" | "));
    await s.api("tasks.act", { taskId: t1, action: "approve", idempotencyKey: "d-allow" });
    await waitFor(async () => (results.includes("resumed:true") ? true : null), 30_000, () => results.join(" | "));
    await s.api("chat.post", { threadId: chat, body: "and one more thing", mentions: [{ kind: "agent", id: lead }], idempotencyKey: "d-ask2" });
    await waitFor(async () => (results.some((r) => r.startsWith("turn:and one")) ? true : null), 30_000, () => results.join(" | "));
    await new Promise((r) => setTimeout(r, 2000));
    assert.equal(results.filter((r) => r.startsWith("turn:")).length, 2, `one turn per message, no extra wake: ${results.join(" | ")}`);
    assert.equal((await approvals()).length, 1, "and no second card");
  } finally { await stop(s.d); }
});
