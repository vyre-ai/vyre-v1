// A helper's held link denied, end to end (lead, 12 Nov, H5): the person presses Deny on the card; the helper reports that it could not open the link, the lead finishes with what it has and says
// what is missing, and nothing stays waiting. Real chat, helper threads, engine, Gate and tools on a booted daemon; only the model is scripted.
import test from "node:test";
import assert from "node:assert/strict";
import { claimedSpace, hostLog, scriptedModel, stop, waitFor } from "./support/eco-live.ts";

type Msg = { author: { kind: string; id: string }; body: string; blocks: Array<{ type: string; data?: Record<string, unknown> }> };

test("Deny on a helper's held link: the helper reports it could not open it, the lead finishes and says what is missing, nothing waits", async () => {
  let lead = ""; let chat = "";
  const leadSaw: string[] = [];
  const model = scriptedModel(async function* (input, run) {
    if (input.agent.id !== lead) return;
    if (input.threadId === chat) {
      const body = input.trigger?.body ?? "";
      if (/look up the rates/.test(body)) {
        yield* run("tool_search", { query: "sub task helper" });
        yield* run("sub_task_model", { threadId: input.threadId, title: "Rates on the web", instruction: "Look up the current Harbor rates on the web.", idempotencyKey: "hd-1" });
        yield { type: "text", text: "I'll give you the answer as soon as the helper reports." };
        return;
      }
      leadSaw.push(body.slice(0, 200));
      yield { type: "text", text: "Here is what I have. Missing: the current rates, because the rates page could not be opened." };
      return;
    }
    if (input.resumed) { yield { type: "text", text: input.resumed.approved ? "The rates are on the page." : "I could not open the rates page, so I have no rates to report." }; return; }
    if (!/Look up the current Harbor rates/.test(input.trigger?.body ?? "")) { yield { type: "text", text: "Reported above." }; return; }
    yield* run("tool_search", { query: "read link" });
    yield* run("read_link", { url: "https://www.other-rates.example/compare" });   // free: nothing outside read yet
    yield* run("read_link", { url: "https://www.harborquotes.example/rates" });     // held: a page was read
    yield { type: "text", text: "Done." };
  });
  const s = await claimedSpace(model);
  lead = s.assistant;
  try {
    chat = (await s.api("chat.start", { kind: "chat", agentIds: [lead], title: "Rates", idempotencyKey: "hd-chat" })).thread.threadId as string;
    await s.api("threads.set_mode", { threadId: chat, mode: "auto", idempotencyKey: "hd-auto" });
    await s.api("chat.post", { threadId: chat, body: "look up the rates with a helper", mentions: [{ kind: "agent", id: lead }], idempotencyKey: "hd-ask" });
    const held = await waitFor(async () => (((await s.api("engine.helpers.status", { threadId: chat })).helpers as Array<{ threadId: string; state: string; holdTaskId?: string }>).find((h) => h.state === "needs_you" && h.holdTaskId) ?? null), 40_000, () => hostLog(s.d));
    await s.api("tasks.act", { taskId: held.holdTaskId, action: "reject", note: "Not that site.", idempotencyKey: "hd-deny" });
    let seen = "";
    await waitFor(async () => {
      const hs = (await s.api("engine.helpers.status", { threadId: chat })).helpers as Array<{ state: string }>;
      const ms = (await s.api("chat.messages.list", { threadId: chat })).messages as Msg[];
      seen = `${JSON.stringify(hs)} ${JSON.stringify(ms.map((m) => [m.author.kind, m.body.slice(0, 80)]))}`;
      return hs.every((h) => h.state === "done") && ms.some((m) => m.author.kind === "agent" && /Missing: the current rates/.test(m.body)) ? true : null;
    }, 60_000, () => seen);
    const helperSaid = ((await s.api("chat.messages.list", { threadId: held.threadId })).messages as Msg[]).filter((m) => m.author.kind === "agent").map((m) => m.body).join("\n");
    assert.match(helperSaid, /could not open the rates page/, "the helper reported that it could not open the link");
    assert.ok(!(((await s.api("engine.helpers.status", { threadId: chat })).helpers as Array<{ state: string }>).some((h) => h.state === "needs_you" || h.state === "working")), "nothing stays waiting");
  } finally { await stop(s.d); }
});
