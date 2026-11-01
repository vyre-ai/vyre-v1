// A key an agent needs, asked for in a chat (rc.8): the ask lands in that chat as a card, the value goes to the Vault from the card and never into a message, a block or the log, the agent carries on in the
// same chat by itself, and the Needs you row closes with the card. Personal: the person is the manager of their own Vault. Only a fake model is used.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, connect, hostLog, makeAgent, ok, scriptedModel, seededDir, startChat, stop, waitFor, call } from "./support/eco-live.ts";

const SECRET = "fth_live_FAKEsecretVALUE0123456789abcdef"; // secret-scan: fake

test("an agent asks for a key in a chat: a card in that chat, the value to the Vault, the agent carries on", async () => {
  let asked = 0;
  const model = scriptedModel(async function* (input, run) {
    const ask = input.trigger?.body ?? "";
    if (/set up fathom/.test(ask)) {
      const r = yield* run("vault_request", { name: "Fathom", fields: ["api_key"], reason: "To read your meetings.", idempotencyKey: "ask-fathom" });
      asked++;
      yield { type: "text", text: r.ok ? "I asked for the Fathom key." : `FAILED ${JSON.stringify(r.content).slice(0, 200)}` };
    } else if (/Carry on/.test(ask)) {
      yield { type: "text", text: "Thanks, carrying on with Fathom." };
    }
  });
  const d = await boot(seededDir(), model, { vault: undefined });
  try {
    const folder = await connect(d);
    const agentId = await makeAgent(d, "Ops");
    const thread = await startChat(d, agentId, "ask1");
    await ok(d, "chat.post", { threadId: thread, body: "set up fathom", mentions: [{ kind: "agent", id: agentId }], idempotencyKey: "ask1-post" });
    // the card is in the chat, as a block the person sees
    const card = await waitFor(async () => {
      await d.hooks?.pump?.();
      const ms = (await ok(d, "chat.messages.list", { threadId: thread })).messages as Array<{ blocks: Array<{ type: string; data: { requestId?: string } }> }>;
      return ms.flatMap((m) => m.blocks).find((b) => b.type === "vault_request") ?? null;
    }, 40_000, () => hostLog(d));
    const requestId = card.data.requestId as string;
    assert.match(requestId, /^vrq_/);
    const open = (await ok(d, "tasks.list", { scope: "all", kinds: ["unblock"], states: ["todo", "doing"] })).tasks as Array<{ title: string; why?: string; workingNotes: Record<string, string> }>;
    const row = open.find((t) => t.title === "Fathom key needed");
    assert.ok(row, JSON.stringify(open.map((t) => t.title)));
    assert.equal(row!.workingNotes["thread"], thread);
    assert.ok(!/manager of the Vault/.test(row!.why ?? ""));

    // the person adds the key from the card
    const done = await call(d, "vault.requests.fulfil", { requestId, folderId: folder, fields: [{ key: "api_key", value: SECRET }] });
    assert.equal(done.status, 200, JSON.stringify(done.data));

    // the agent carries on in the same chat by itself
    const said = await waitFor(async () => {
      await d.hooks?.pump?.();
      const ms = (await ok(d, "chat.messages.list", { threadId: thread })).messages as Array<{ author?: { kind?: string }; body?: string }>;
      return ms.find((m) => m.author?.kind === "agent" && /carrying on/.test(m.body ?? "")) ?? null;
    }, 40_000, () => hostLog(d));
    assert.ok(said);
    // the Needs you row closed with the card
    const left = (await ok(d, "tasks.list", { scope: "all", kinds: ["unblock"], states: ["todo", "doing"] })).tasks as Array<{ title: string }>;
    assert.equal(left.filter((t) => t.title === "Fathom key needed").length, 0);
    // the secret is nowhere in the chat or the log
    const all = JSON.stringify((await ok(d, "chat.messages.list", { threadId: thread })).messages) + hostLog(d);
    assert.ok(!all.includes(SECRET), "the value never reached a message, a block or the log");
    assert.ok(asked >= 1);
  } catch (e) { console.error("FAILED:", e instanceof Error ? e.message.slice(0, 1500) : e); throw e; } finally { await stop(d); }
});
