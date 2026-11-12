// The person speaks and the next turn starts free (lead, 12 Nov): a page read in the chat marks it, so a composed link after that waits; the person's next message clears the mark before the turn
// takes its first call, so that turn's first composed link goes through and no approve task is made at all. Real daemon, Gate and tools; the model is scripted.
import test from "node:test";
import assert from "node:assert/strict";
import { claimedSpace, scriptedModel, stop, waitFor } from "./support/eco-live.ts";

test("after a page was read, the person's next message makes that turn's first composed link free: no approve task", async () => {
  let lead = ""; const results: string[] = [];
  const model = scriptedModel(async function* (input, run) {
    if (input.agent.id !== lead) return;
    yield* run("tool_search", { query: "read link" });
    const url = /second/.test(input.trigger?.body ?? "") ? "https://www.second-rates.example/" : "https://www.first-rates.example/";
    results.push(`${url} ${JSON.stringify(yield* run("read_link", { url })).slice(0, 100)}`);
    yield { type: "text", text: "Done." };
  });
  const s = await claimedSpace(model); lead = s.assistant;
  try {
    const chat = (await s.api("chat.start", { kind: "chat", agentIds: [lead], title: "P", idempotencyKey: "c-chat" })).thread.threadId as string;
    await s.api("threads.set_mode", { threadId: chat, mode: "auto", idempotencyKey: "c-auto" });
    const approvals = async () => ((await s.api("tasks.list", { kinds: ["approve"], scope: "mine" })).tasks ?? []) as Array<{ id: string; title?: string }>;
    await s.api("chat.post", { threadId: chat, body: "look up the first rates", mentions: [{ kind: "agent", id: lead }], idempotencyKey: "c-ask1" });
    await waitFor(async () => (results.length >= 1 ? true : null), 30_000, () => results.join(" | "));
    await new Promise((r) => setTimeout(r, 1500));   // the turn ends and its read marks the chat
    await s.api("chat.post", { threadId: chat, body: "now the second rates", mentions: [{ kind: "agent", id: lead }], idempotencyKey: "c-ask2" });
    await waitFor(async () => (results.length >= 2 ? true : null), 30_000, async () => `${results.join(" | ")} ${JSON.stringify(await approvals())}`);
    await new Promise((r) => setTimeout(r, 1500));
    assert.deepEqual(await approvals(), [], `no approve task: ${results.join(" | ")}`);
    assert.doesNotMatch(results[1]!, /held|needs_approval/);
  } finally { await stop(s.d); }
});

test("after an allowed link, the person's next message makes that turn's first composed link free: no new approve task", async () => {
  let lead = ""; const results: string[] = [];
  const model = scriptedModel(async function* (input, run) {
    if (input.agent.id !== lead) return;
    const body = input.trigger?.body ?? "";
    if (input.resumed) { results.push(`resumed@${Date.now()}`); yield { type: "text", text: "Done." }; return; }
    yield* run("tool_search", { query: "read link" });
    if (/first/.test(body)) {
      results.push(`A@${Date.now()} ${JSON.stringify(yield* run("read_link", { url: "https://www.first-rates.example/" })).slice(0, 60)}`);
      results.push(`B@${Date.now()} ${JSON.stringify(yield* run("read_link", { url: "https://www.other-rates.example/" })).slice(0, 60)}`);
    } else {
      results.push(`C@${Date.now()} turn=${input.turnId ?? ""} msg=${input.trigger?.id ?? ""} trigger=${JSON.stringify(body.slice(0, 40))} ${JSON.stringify(yield* run("read_link", { url: "https://www.third-rates.example/" })).slice(0, 60)}`);
    }
    yield { type: "text", text: "Done." };
  });
  const s = await claimedSpace(model); lead = s.assistant;
  try {
    const chat = (await s.api("chat.start", { kind: "chat", agentIds: [lead], title: "P", idempotencyKey: "d-chat" })).thread.threadId as string;
    await s.api("threads.set_mode", { threadId: chat, mode: "auto", idempotencyKey: "d-auto" });
    const approvals = async () => ((await s.api("tasks.list", { kinds: ["approve"], scope: "mine" })).tasks ?? []) as Array<{ id: string; title?: string; createdAt?: number }>;
    await s.api("chat.post", { threadId: chat, body: "look up the first rates", mentions: [{ kind: "agent", id: lead }], idempotencyKey: "d-ask1" });
    const t1 = await waitFor(async () => (await approvals())[0]?.id ?? null, 30_000, () => results.join(" | "));
    await s.api("tasks.act", { taskId: t1, action: "approve", idempotencyKey: "d-allow" });
    await waitFor(async () => (results.some((r) => r.startsWith("resumed")) ? true : null), 30_000, () => results.join(" | "));
    const before = (await approvals()).length;
    const postedAt = Date.now();
    await s.api("chat.post", { threadId: chat, body: "and one more", mentions: [{ kind: "agent", id: lead }], idempotencyKey: "d-ask2" });
    await waitFor(async () => (results.some((r) => r.startsWith("C@")) ? true : null), 30_000, async () => `${results.join(" | ")} ${JSON.stringify(await approvals())}`);
    await new Promise((r) => setTimeout(r, 1500));
    const after = await approvals();
    const turns = JSON.stringify(((await s.api("engine.turns.list", { threadId: chat })).turns ?? []));
    assert.equal(after.length, before, `no new approve task (posted @${postedAt}): ${results.join(" | ")} ${JSON.stringify(after.map((a) => [a.title, a.createdAt]))} TURNS ${turns}`);
  } finally { await stop(s.d); }
});
