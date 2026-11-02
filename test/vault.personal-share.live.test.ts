// A key asked for in a chat in a Personal Space (rc.14 bug): the card's "Add the key" answered "Needs a Team Space. vault.share works in a Team Space", because fulfilling grants the asking agent
// Use with vault.share, which the Personal matrix refused. In a Personal Space everything is the person's, so giving their own agent Use on their own item is allowed; sharing with anyone else still
// needs a Team Space, in plain words. Real chats on a booted daemon (--space-kind personal); only the model is scripted.
import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../host/src/daemon/config.ts";
import { boot, call, connect, hostLog, makeAgent, ok, scriptedModel, seededDir, startChat, stop, waitFor } from "./support/eco-live.ts";

const SECRET = "fth_personal_FAKEsecretVALUE0123456789abcdef"; // secret-scan: fake

test("Personal: a key request is fulfilled, the agent uses the key by its handle on its next turn, and sharing with another person is still refused in plain words", async () => {
  const fulfilled = { itemId: "" };
  const model = scriptedModel(async function* (input, run) {
    const ask = input.trigger?.body ?? "";
    if (/connect my fathom/.test(ask)) {
      const r = yield* run("vault_request", { name: "Fathom", fields: ["api_key"], reason: "To read your meetings.", idempotencyKey: "personal-ask-fathom" });
      yield { type: "text", text: r.ok ? "I asked for the Fathom key." : `FAILED ${JSON.stringify(r.content).slice(0, 200)}` };
    } else if (/Carry on/.test(ask)) {
      const found = yield* run("tool_search", { query: "vault item get" });
      if (!found.ok) { yield { type: "text", text: `FAILED search ${JSON.stringify(found.content).slice(0, 300)}` }; return; }
      const r = yield* run("vault_item_get", { itemId: fulfilled.itemId });
      yield { type: "text", text: r.ok ? `USED ${JSON.stringify(r.content)}` : `FAILED ${JSON.stringify(r.content).slice(0, 300)}` };
    }
  });
  const dir = seededDir();
  const d = await boot(dir, model, { vault: undefined, config: loadConfig(["--data-dir", dir, "--port", "0", "--space-kind", "personal"], {}, "1.2.3") });
  try {
    await connect(d);
    const keys = (await ok(d, "vault.folders.create", { name: "Keys", scope: "shared", idempotencyKey: "ps-keys" })).folder.id as string;
    const agentId = await makeAgent(d, "Ops");
    const thread = await startChat(d, agentId, "ps1");
    await ok(d, "chat.post", { threadId: thread, body: "I want to connect my fathom", mentions: [{ kind: "agent", id: agentId }], idempotencyKey: "ps1-post" });
    const card = await waitFor(async () => {
      await d.hooks?.pump?.();
      const ms = (await ok(d, "chat.messages.list", { threadId: thread })).messages as Array<{ blocks: Array<{ type: string; data: { requestId?: string } }> }>;
      return ms.flatMap((m) => m.blocks).find((b) => b.type === "vault_request") ?? null;
    }, 20_000, () => hostLog(d));
    const requestId = card.data.requestId as string;

    // "Add the key" on the card, into a Shared folder: the item is saved and the agent that asked gets Use
    const done = await call(d, "vault.requests.fulfil", { requestId, folderId: keys, fields: [{ key: "api_key", value: SECRET }] });
    assert.equal(done.status, 200, JSON.stringify(done.data));
    fulfilled.itemId = done.data.request.itemId as string;
    assert.match(fulfilled.itemId, /^vit_/);
    const holders = (await ok(d, "access.shares_of", { resource: { type: "vault_item", id: fulfilled.itemId } })).shares as Array<{ grant: { subject: { kind: string; id: string }; level: string } }>;
    assert.ok(holders.some((s) => s.grant.subject.kind === "agent" && s.grant.subject.id === agentId && s.grant.level === "use"), JSON.stringify(holders));

    // the agent carries on and reaches the item as itself, by its handle; the value is never in its hands
    const said = await waitFor(async () => {
      await d.hooks?.pump?.();
      const ms = (await ok(d, "chat.messages.list", { threadId: thread })).messages as Array<{ author?: { kind?: string }; body?: string }>;
      return ms.find((m) => m.author?.kind === "agent" && /^(USED|FAILED)/.test(m.body ?? "")) ?? null;
    }, 20_000, () => hostLog(d));
    assert.match(said.body ?? "", /^USED .*#Fathom/, said.body ?? "");
    const all = JSON.stringify((await ok(d, "chat.messages.list", { threadId: thread })).messages) + hostLog(d);
    assert.ok(!all.includes(SECRET), "the value never reached a message, a tool result or the log");

    // the agent page's Can use: the same grant, made by the person, for another item of theirs
    const other = (await ok(d, "vault.item.put", { folderId: keys, name: "Zoom", kind: "api_key", fields: [{ key: "api_key", value: "zm_FAKE0123456789", secret: true }], idempotencyKey: "ps-zoom" })).item.id as string; // secret-scan: fake
    assert.equal((await call(d, "vault.share", { resource: { type: "vault_item", id: other }, subject: { kind: "agent", id: agentId }, level: "use", idempotencyKey: "ps-canuse" })).status, 200);
    assert.equal((await call(d, "vault.unshare", { resource: { type: "vault_item", id: other }, subject: { kind: "agent", id: agentId } })).status, 200);

    // sharing with another person is still a Team Space thing, said in plain words
    const person = await call(d, "vault.share", { resource: { type: "vault_item", id: other }, subject: { kind: "person", id: "usr_mia" }, level: "use", idempotencyKey: "ps-person" });
    assert.equal(person.status, 403, JSON.stringify(person.data));
    const err = (person.data.error ?? person.data) as { code?: string; message?: string };
    assert.equal(err.code, "permission.needs_team");
    assert.equal(err.message, "Sharing with other people needs a Team Space. Create or join one to share this.");
    assert.ok(!/vault\.share/.test(JSON.stringify(err.message)));
  } catch (e) { console.error("FAILED:", e instanceof Error ? e.message.slice(0, 1500) : e); throw e; } finally { await stop(d); }
});
