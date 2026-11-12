// Stop in a chat reaches the helpers that chat started (lead, 12 Nov, H1: what the person stopped stays stopped). Before, engine.stop and stop_all acted only on the chat itself, so a helper kept
// working, or kept waiting on its approval card with its task in Needs you, and a later Allow woke a helper the person had stopped.
//   parked   a helper waiting on a held link: Stop in the lead chat drops the hold, the task leaves Needs you, the helper reads stopped, a late Allow runs nothing, and the next message works
//   running  a helper in the middle of its work: Stop in the lead chat stops its turn too
//   alone    a helper stopped from its own row stops only itself: its sibling and the lead go on
// Real chat, helper threads, engine, Gate and tools on a booted daemon; only the model is scripted.
import test from "node:test";
import assert from "node:assert/strict";
import { claimedSpace, hostLog, scriptedModel, stop, waitFor } from "./support/eco-live.ts";

type Msg = { author: { kind: string; id: string }; body: string; blocks: Array<{ type: string; data?: Record<string, unknown> }> };
type Helper = { threadId: string; state: string; holdTaskId?: string; title: string };

test("Stop in the lead chat stops a helper waiting on its approval card: the hold is dropped, Needs you is clear, a late Allow runs nothing, the next message works", { timeout: 180_000 }, async () => {
  let lead = ""; let chat = "";
  const ran: string[] = [];
  const model = scriptedModel(async function* (input, run) {
    if (input.agent.id !== lead) return;
    if (input.threadId === chat) {
      if (/look up the rates/.test(input.trigger?.body ?? "")) {
        yield* run("tool_search", { query: "sub task helper" });
        yield* run("sub_task_model", { threadId: input.threadId, title: "Rates on the web", instruction: "Look up the current Harbor rates on the web.", idempotencyKey: "hs-1" });
        yield { type: "text", text: "I'll give you the answer as soon as the helper reports." };
        return;
      }
      yield { type: "text", text: "Still here." };
      return;
    }
    if (input.resumed) { ran.push("resumed"); yield { type: "text", text: "The rates are on the page." }; return; }
    if (!/Look up the current Harbor rates/.test(input.trigger?.body ?? "")) { yield { type: "text", text: "Reported above." }; return; }
    yield* run("tool_search", { query: "read link" });
    yield* run("read_link", { url: "https://www.other-rates.example/compare" });
    yield* run("read_link", { url: "https://www.harborquotes.example/rates" });   // held: a page was read
    yield { type: "text", text: "Done." };
  });
  const s = await claimedSpace(model);
  lead = s.assistant;
  try {
    chat = (await s.api("chat.start", { kind: "chat", agentIds: [lead], title: "Rates", idempotencyKey: "hs-chat" })).thread.threadId as string;
    await s.api("threads.set_mode", { threadId: chat, mode: "auto", idempotencyKey: "hs-auto" });
    await s.api("chat.post", { threadId: chat, body: "look up the rates with a helper", mentions: [{ kind: "agent", id: lead }], idempotencyKey: "hs-ask" });
    const helpers = async (): Promise<Helper[]> => (await s.api("engine.helpers.status", { threadId: chat })).helpers as Helper[];
    const held = await waitFor(async () => (await helpers()).find((h) => h.state === "needs_you" && h.holdTaskId) ?? null, 40_000, async () => `${JSON.stringify(await helpers())}\n${hostLog(s.d)}`);
    // the person presses Stop in the lead chat
    await s.api("engine.stop", { threadId: chat, idempotencyKey: "hs-stop" });

    const task = await waitFor(async () => {
      const t = (await s.api("tasks.get", { taskId: held.holdTaskId })).task as { state?: string };
      return !["open", "todo", "doing", "awaiting_approval"].includes(String(t.state)) ? t : null;
    }, 20_000, async () => `${JSON.stringify((await s.api("tasks.get", { taskId: held.holdTaskId })).task)}`);
    assert.notEqual(task.state, "done", `the approval leaves Needs you, closed, not approved: ${task.state}`);
    await waitFor(async () => ((await helpers()).find((h) => h.threadId === held.threadId)?.state === "stopped" ? true : null), 20_000, async () => JSON.stringify(await helpers()));
    // a press that comes after the Stop does nothing harmful: the held call is not made
    await s.api("tasks.act", { taskId: held.holdTaskId, action: "approve", idempotencyKey: "hs-late" }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 2_000));
    assert.deepEqual(ran, [], "the helper the person stopped is not woken by a late Allow");
    // the lead chat shows at most one stopped line for the whole thing
    const lines = ((await s.api("chat.messages.list", { threadId: chat })).messages as Msg[]).flatMap((m) => m.blocks.filter((b) => b.type === "turn_status" && b.data?.["state"] === "cancelled"));
    assert.ok(lines.length <= 1, `one stopped line at most, not one per helper: ${lines.length}`);
    // and the next message works
    await s.api("chat.post", { threadId: chat, body: "are you there?", mentions: [{ kind: "agent", id: lead }], idempotencyKey: "hs-next" });
    await waitFor(async () => (((await s.api("chat.messages.list", { threadId: chat })).messages as Msg[]).some((m) => m.author.kind === "agent" && /Still here/.test(m.body)) ? true : null), 20_000, () => hostLog(s.d));
  } finally { await stop(s.d); }
});

/** Two helpers that work until they are let go (each one's model waits), under one lead chat. */
async function twoWorkingHelpers(key: string) {
  let lead = ""; let chat = "";
  const gates = new Map<string, () => void>();
  const ended: string[] = [];
  const model = scriptedModel(async function* (input, run) {
    if (input.agent.id !== lead) return;
    if (input.threadId === chat) {
      if (/use two helpers/.test(input.trigger?.body ?? "")) {
        yield* run("tool_search", { query: "sub task helper" });
        yield* run("sub_task_model", { threadId: input.threadId, title: "First part", instruction: "Do the first part.", idempotencyKey: `${key}-1` });
        yield* run("sub_task_model", { threadId: input.threadId, title: "Second part", instruction: "Do the second part.", idempotencyKey: `${key}-2` });
        yield { type: "text", text: "Two helpers are on it." };
        return;
      }
      yield { type: "text", text: "Still here." };
      return;
    }
    const which = /first part/i.test(input.trigger?.body ?? "") ? "first" : /second part/i.test(input.trigger?.body ?? "") ? "second" : "";
    if (which === "") { yield { type: "text", text: "Reported above." }; return; }
    yield { type: "text", text: `Working on the ${which} part.` };
    await new Promise<void>((r) => gates.set(which, r));
    ended.push(which);
    yield { type: "text", text: ` The ${which} part is done.` };
  });
  const s = await claimedSpace(model);
  lead = s.assistant;
  chat = (await s.api("chat.start", { kind: "chat", agentIds: [lead], title: "Parts", idempotencyKey: `${key}-chat` })).thread.threadId as string;
  await s.api("threads.set_mode", { threadId: chat, mode: "auto", idempotencyKey: `${key}-auto` });
  await s.api("chat.post", { threadId: chat, body: "use two helpers", mentions: [{ kind: "agent", id: lead }], idempotencyKey: `${key}-ask` });
  const helpers = async (): Promise<Helper[]> => (await s.api("engine.helpers.status", { threadId: chat })).helpers as Helper[];
  await waitFor(async () => (gates.size === 2 ? true : null), 40_000, async () => `${JSON.stringify(await helpers())}\n${hostLog(s.d)}`);
  return { s, chat, helpers, gates, ended, lead };
}

test("Stop in the lead chat stops its helpers that are working; Stop on one helper's own row stops only that helper", { timeout: 180_000 }, async () => {
  const w = await twoWorkingHelpers("hs2");
  try {
    const [a, b] = await w.helpers();
    // one helper stopped from its own row: its sibling and the lead go on
    await w.s.api("engine.stop", { threadId: a!.threadId, idempotencyKey: "hs2-one" });
    await waitFor(async () => ((await w.helpers()).find((h) => h.threadId === a!.threadId)?.state === "stopped" ? true : null), 20_000, async () => JSON.stringify(await w.helpers()));
    assert.equal((await w.helpers()).find((h) => h.threadId === b!.threadId)?.state, "working", "the sibling goes on");
    // Stop in the lead chat: the other one stops too
    await w.s.api("engine.stop", { threadId: w.chat, idempotencyKey: "hs2-all" });
    await waitFor(async () => ((await w.helpers()).every((h) => h.state === "stopped") ? true : null), 20_000, async () => JSON.stringify(await w.helpers()));
    for (const g of w.gates.values()) g();
    await new Promise((r) => setTimeout(r, 1_500));
    const msgs = (await w.s.api("chat.messages.list", { threadId: w.chat })).messages as Msg[];
    assert.ok(msgs.flatMap((m) => m.blocks.filter((x) => x.type === "turn_status" && x.data?.["state"] === "cancelled")).length <= 1, "one stopped line at most in the lead chat");
    await w.s.api("chat.post", { threadId: w.chat, body: "are you there?", mentions: [{ kind: "agent", id: w.lead }], idempotencyKey: "hs2-next" });
    await waitFor(async () => (((await w.s.api("chat.messages.list", { threadId: w.chat })).messages as Msg[]).some((m) => m.author.kind === "agent" && /Still here/.test(m.body)) ? true : null), 20_000, () => hostLog(w.s.d));
  } finally { for (const g of w.gates.values()) g(); await stop(w.s.d); }
});

test("Stop all in the lead chat stops every helper too", { timeout: 180_000 }, async () => {
  const w = await twoWorkingHelpers("hs3");
  try {
    await w.s.api("engine.stop_all", { threadId: w.chat, idempotencyKey: "hs3-all" });
    await waitFor(async () => ((await w.helpers()).every((h) => h.state === "stopped") ? true : null), 20_000, async () => JSON.stringify(await w.helpers()));
  } finally { for (const g of w.gates.values()) g(); await stop(w.s.d); }
});
