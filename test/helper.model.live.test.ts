// Change model, live (owner, 4 Nov 2026): a running helper is stopped and starts again on the model the person picked, doing its brief from the start; only the person it works for can; the row says what it runs on.
import test from "node:test";
import assert from "node:assert/strict";
import { claimedSpace, hostLog, scriptedModel, stop, waitFor } from "./support/eco-live.ts";

test("change model: the helper restarts on the picked model with its brief again, and the model it runs on is on its row", async () => {
  let lead = ""; let chat = "";
  const briefs: string[] = [];
  let release!: () => void;
  const restartGate = new Promise<void>((resolve) => { release = resolve; });
  const model = scriptedModel(async function* (input, run) {
    if (input.agent.id !== lead) return;
    const body = input.trigger?.body ?? "";
    if (input.threadId === chat) {
      if (/start the helper/.test(body)) { yield* run("tool_search", { query: "sub task helper" }); yield* run("sub_task_model", { threadId: input.threadId, title: "Reader", instruction: "Reader job: read the page.", idempotencyKey: "cm-1" }); yield { type: "text", text: "Started." }; }
      return;
    }
    briefs.push(body);
    if (briefs.length === 1) { await new Promise((r) => setTimeout(r, 12_000)); yield { type: "text", text: "first run" }; }
    else yield { type: "text", text: "second run on the new model" };
  }, { gate: (input) => (/Starting again/.test(input.trigger?.body ?? "") ? restartGate : undefined) });
  const s = await claimedSpace(model);
  lead = s.assistant;
  try {
    chat = (await s.api("chat.start", { kind: "chat", agentIds: [lead], title: "Model", idempotencyKey: "cm-chat" })).thread.threadId as string;
    await s.api("chat.post", { threadId: chat, body: "start the helper", mentions: [{ kind: "agent", id: lead }], idempotencyKey: "cm-ask" });
    const h = await waitFor(async () => { const r = (await s.api("engine.helpers.status", { threadId: chat })).helpers as Array<{ threadId: string; state: string }>; return r[0]?.state === "working" ? r[0] : null; }, 40_000, () => hostLog(s.d));
    const cat = await s.api("engine.helper_models", { threadId: chat, agentId: lead });
    const accounts = cat.accounts as Array<{ ref: string; models: Array<{ model: string; available: boolean }> }>;
    const acct = accounts.find((a) => a.models.some((m) => m.available))!;
    const listed = async (): Promise<{ model?: string; pick?: { accountRef?: string; model?: string } }> => ((await s.api("chat.helpers.list", { threadId: chat })).helpers as Array<{ threadId: string; model?: string; pick?: { accountRef?: string; model?: string } }>).find((x) => x.threadId === h.threadId)!;
    const now = (await listed()).model;
    const pick = acct.models.find((m) => m.available && m.model !== now)?.model ?? acct.models.find((m) => m.available)!.model;
    await waitFor(async () => (briefs.length >= 1 ? true : null), 30_000, () => hostLog(s.d));   // the first turn is really running before it is stopped
    const out = await s.api("engine.helpers.change_model", { threadId: chat, helperId: h.threadId, account: acct.ref, model: pick });
    assert.equal(out.restarted, true);
    // the gap: the first turn was stopped and the replacement is held before it starts. What a person sees now is a helper that is working, never one that stopped
    await new Promise((r) => setTimeout(r, 2500));   // long enough for the stop to land and the replacement to reach its gate
    const during = ((await s.api("engine.helpers.status", { threadId: chat })).helpers as Array<{ threadId: string; state: string }>).find((x) => x.threadId === h.threadId)!;
    assert.equal(during.state, "working", "a restarting helper reads as working while its new turn is held");
    const rowDuringGap = ((await s.api("engine.crew.status", { threadId: chat })).members as Array<{ id: string; state: string }>).find((x) => x.id === h.threadId)!;
    assert.equal(rowDuringGap.state, "working", "the one read the strip and the pane use says the same");
    release();
    const after = await waitFor(async () => (((await s.api("chat.messages.list", { threadId: h.threadId })).messages as Array<{ body: string }>).some((m) => /second run on the new model/.test(m.body)) ? true : null), 40_000, () => hostLog(s.d));
    assert.ok(!((await s.api("chat.messages.list", { threadId: h.threadId })).messages as Array<{ body: string }>).some((m) => /^first run$/.test(m.body)), "the stopped turn said nothing more: Stop really stopped it");
    assert.ok(after);
    assert.match(briefs[1]!, /Starting again on .*Do the brief again from the start/);
    const row = await listed();
    assert.equal(row.model, out.model, "the row says what it runs on");
    assert.equal(row.pick?.accountRef, acct.ref);
    await waitFor(async () => (((await s.api("engine.helpers.status", { threadId: chat })).helpers as Array<{ state: string }>).every((x) => x.state !== "working") ? true : null), 40_000, () => hostLog(s.d));
  } finally { await stop(s.d); }
});
