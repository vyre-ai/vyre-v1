// Notes between a helper and the agent that started it, live (owner, 4 Nov 2026): a follow-up reaches a running helper; a helper's question is answered by the agent that started it without asking the person; a
// question only the person can answer becomes a card in Needs you; the person's steer is theirs; the helper chat keeps all three voices. Real chat, helper threads, engine and tools; only the model is scripted.
import test from "node:test";
import assert from "node:assert/strict";
import { claimedSpace, hostLog, scriptedModel, stop, waitFor } from "./support/eco-live.ts";

type Msg = { id: string; author: { kind: string; id: string }; body: string; blocks: Array<{ type: string; state?: string; data?: Record<string, unknown> }> };
type Note = { messageId: string; authorId: string; who: string; body: string; kind?: string; state?: string; seenAt?: number };

test("helper notes: follow-up down, question answered by the parent, a person-only question is a card, the steer is the person's, three voices in the history", async () => {
  let lead = ""; let chat = ""; let who = "";
  const threads: Record<string, string> = {};
  const model = scriptedModel(async function* (input, run) {
    if (input.agent.id !== lead) return;
    const body = input.trigger?.body ?? "";
    if (input.threadId === chat) {
      if (/start the helpers/.test(body)) {
        yield* run("tool_search", { query: "sub task helper" });
        yield* run("sub_task_model", { threadId: input.threadId, title: "Reader", instruction: "Reader job: read the page.", idempotencyKey: "n-1" });
        yield* run("sub_task_model", { threadId: input.threadId, title: "Chooser", instruction: "Chooser job: pick the plan.", idempotencyKey: "n-2" });
        yield* run("sub_task_model", { threadId: input.threadId, title: "Slow", instruction: "Slow job: wait about.", idempotencyKey: "n-3" });
        yield { type: "text", text: "Started three helpers." };
      } else if (/Reader" asks/.test(body)) {
        // the parent answers its helper with its next step; nobody is asked
        yield* run("helper_note", { threadId: threads["Reader"], kind: "followup", body: "Use the pricing page." });
        yield { type: "text", text: "Answered the reader." };
      }
      return;
    }
    if (/Reader job/.test(body)) {
      threads["Reader"] = input.threadId;
      yield* run("helper_note", { threadId: input.threadId, kind: "question", body: "Which page should I read?" });
      yield { type: "text", text: "Waiting for the page." };
    } else if (/Chooser job/.test(body)) {
      threads["Chooser"] = input.threadId;
      yield* run("helper_note", { threadId: input.threadId, kind: "question", needsPerson: true, body: "Which plan do you want?", options: [{ key: "a", label: "Basic" }, { key: "b", label: "Pro" }] });
      yield { type: "text", text: "Waiting for the plan." };
    } else if (/Slow job/.test(body)) {
      threads["Slow"] = input.threadId;
      await new Promise((r) => setTimeout(r, 9000));
      yield { type: "text", text: "Slow is done." };
    } else if (/filing date|colour/.test(body)) {
      // the person's own line, taken into the helper's next step: it answers them in its own chat
      yield { type: "text", text: "Noted. I will include it." };
    } else if (/pricing page/.test(body)) {
      yield { type: "text", text: "Read the pricing page." };
    }
  });
  const s = await claimedSpace(model);
  lead = s.assistant;
  who = (await s.api("identity.whoami", {})).principal.id as string;
  try {
    chat = (await s.api("chat.start", { kind: "chat", agentIds: [lead], title: "Notes", idempotencyKey: "hn-chat" })).thread.threadId as string;
    await s.api("chat.post", { threadId: chat, body: "start the helpers", mentions: [{ kind: "agent", id: lead }], idempotencyKey: "hn-ask" });

    // the reader's question was answered by the parent's next step: the reader got a follow-up and read the pricing page
    const notes = await waitFor(async () => {
      if (!threads["Reader"]) return null;
      const n = (await s.api("chat.helper.notes", { threadId: threads["Reader"] })).notes as Note[];
      return n.some((x) => x.who === "parent") && n.some((x) => x.who === "helper" && x.kind === "question" && x.state === "answered") ? n : null;
    }, 60_000, () => hostLog(s.d));
    const voices = notes.map((n) => n.who);
    assert.equal(voices[0], "brief", "the brief opens the history");
    assert.ok(voices.includes("parent") && voices.includes("helper"), "the parent and the helper both speak in the history");
    assert.equal(notes.find((n) => n.who === "parent")!.body, "Use the pricing page.");
    const seen = await waitFor(async () => ((await s.api("chat.helper.notes", { threadId: threads["Reader"] })).notes as Note[]).find((n) => n.who === "parent" && n.seenAt !== undefined) ?? null, 30_000, () => hostLog(s.d));
    assert.equal(typeof seen.seenAt, "number", "the follow-up is marked seen once the helper takes it");
    const readerSaid = await waitFor(async () => {
      const ms = (await s.api("chat.messages.list", { threadId: threads["Reader"] })).messages as Msg[];
      return ms.some((m) => m.author.kind === "agent" && /Read the pricing page/.test(m.body)) ? ms : null;
    }, 30_000, () => hostLog(s.d));
    assert.ok(readerSaid.length > 0, "the follow-up reached the helper and it acted on it");

    // the question only the person can answer is a card in the chat above, with a task for them, and the reader's question raised no card
    const parent = await waitFor(async () => {
      const ms = (await s.api("chat.messages.list", { threadId: chat })).messages as Msg[];
      return ms.some((m) => m.blocks.some((b) => b.type === "question" && b.data?.["helperThreadId"] === threads["Chooser"])) ? ms : null;
    }, 40_000, () => hostLog(s.d));
    const cards = parent.flatMap((m) => m.blocks.filter((b) => b.type === "question"));
    assert.equal(cards.length, 1, "one card, for the question only the person can answer");
    assert.match(String(cards[0]!.data?.["prompt"]), /Which plan/);
    assert.equal(typeof cards[0]!.data?.["taskId"], "string", "it is in Needs you");
    assert.ok(!cards.some((c) => /Which page/.test(String(c.data?.["prompt"]))), "the reader's question raised no card");

    // the person steers the slow helper: the note is theirs, not the parent's
    await waitFor(async () => (threads["Slow"] ? true : null), 30_000, () => hostLog(s.d));
    await s.api("chat.helper.steer", { threadId: threads["Slow"], body: "Also tell me the colour.", idempotencyKey: "hn-steer" });
    const slow = (await s.api("chat.helper.notes", { threadId: threads["Slow"] })).notes as Note[];
    const steer = slow.find((n) => n.body === "Also tell me the colour.")!;
    assert.equal(steer.who, "person");
    assert.equal(steer.authorId, who, "credited to the person");
    assert.ok(!slow.some((n) => n.who === "parent"), "the steer is not the parent's");
    // the helper takes the line into its next step and answers that person in its own chat, after their line
    const answered = await waitFor(async () => {
      const n = (await s.api("chat.helper.notes", { threadId: threads["Slow"] })).notes as Note[];
      const at = n.findIndex((x) => x.body === "Also tell me the colour.");
      return n.slice(at + 1).find((x) => x.who === "helper" && /Noted/.test(x.body)) ?? null;
    }, 40_000, () => hostLog(s.d));
    assert.ok(answered, "the helper answers the person in the helper chat");
    // and the chat above sees what the person told it
    const above = (await s.api("chat.messages.list", { threadId: chat })).messages as Msg[];
    assert.ok(above.some((m) => /^To "Slow": Also tell me the colour\.$/.test(m.body) && m.author.id === who), "the parent chat sees the person's line");
    // let the last helper end before the daemon goes down
    await waitFor(async () => (((await s.api("engine.helpers.status", { threadId: chat })).helpers as Array<{ state: string }>).every((h) => h.state !== "working") ? true : null), 40_000, () => hostLog(s.d));
  } catch (e) {
    const ms = (await s.api("chat.messages.list", { threadId: chat }).catch(() => ({ messages: [] }))).messages as Msg[];
    console.log("CHAT", JSON.stringify(ms.map((m) => [m.author.kind, m.body.slice(0, 160), m.blocks.map((b) => `${b.type}:${b.state ?? ""}`)])));
    for (const [k, v] of Object.entries(threads)) console.log("NOTES", k, JSON.stringify(((await s.api("chat.helper.notes", { threadId: v }).catch(() => ({ notes: [] }))).notes as Note[]).map((n) => [n.who, n.kind, n.state, n.body.slice(0, 60)])));
    throw e;
  } finally { await stop(s.d); }
});
