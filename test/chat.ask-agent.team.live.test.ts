// Tag an agent onto an already-sent channel message (owner decision D4), end to end on a booted daemon with only the model a stand-in. Olivia's channel has the agent Intake, which listens until
// named. Olivia's message names nobody, so nobody answers. Mia asks Intake about it (the "Ask an Agent…" post the app builds): Intake answers, and the turn runs for Mia on the Space's shared
// Team account, never for Olivia. The same ask again is the same message and no second turn. Mia's own message edited to add @Intake saves without a turn of its own; the app's ask that follows
// makes one turn; a later edit that keeps the mention asks nobody, and the same ask posted again is still one turn.
import test from "node:test";
import assert from "node:assert/strict";
import { CORE_SPACE } from "../fixtures/seed/core/index.ts";
import { KEY, boot, connect, hostLog, seededDir, stop, waitFor } from "./support/eco-live.ts";
import { addedAgentMentions, askPost } from "../apps/app/src/places/chats/conversation/askagent.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import type { DriverEvent, EngineSession, OpenSession, TurnInput } from "../agent/src/turn-engine/types.ts";

const WHO = ["usr_olivia", "usr_mia"];

const as = (d: Daemon) => async (who: string, cap: string, input: unknown): Promise<{ status: number; data: any }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${who}` }, body: JSON.stringify(input) });
  const b = (await r.json()) as { data?: unknown };
  return { status: r.status, data: b.data ?? b };
};

test("Team: Mia asks an agent about a sent message, and about her own message after an edit adds the mention: one turn each, for Mia, on the Team account, never twice", async () => {
  const turns: Array<{ asker: string; account: string; text: string }> = [];
  const model: OpenSession = async (spec) => ({
    warm: true,
    async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
      // the engine also runs a background memory pass on the asker's account after a chat moves; only a turn started by an ask (its trigger is the ask message) is the agent answering
      if (!String(input.trigger?.id ?? "").startsWith("msg_ask")) { yield { type: "done" }; return; }
      turns.push({ asker: spec.asker, account: spec.account?.ref ?? "", text: input.trigger?.body ?? "" });
      yield { type: "text", text: `Checked for ${spec.asker}.` };
      yield { type: "done" };
    },
    sendToolResult() {}, inject() {}, async cancel() {}, async close() {},
  } as EngineSession);
  const ownerToken = { v: "" };
  const d = await boot(seededDir(), model, {
    vault: undefined,
    session: (headers: Record<string, string | undefined>) => {
      const t = String(headers["authorization"] ?? "").replace(/^Bearer /, "");
      const id = t === ownerToken.v ? "usr_olivia" : t;
      return WHO.includes(id) ? { space: CORE_SPACE, principal: { kind: "person" as const, id }, device: "ask-agent-team" } : null;
    },
  });
  ownerToken.v = d.token;
  const api = as(d);
  const pump = async (): Promise<void> => { await d.hooks?.pump?.(); };
  const settle = async (ms = 700): Promise<void> => { for (let i = 0; i < 4; i++) { await pump(); await new Promise((r) => setTimeout(r, ms / 4)); } };
  type Msg = { messageId: string; author?: { id?: string }; body?: string; replyTo?: string };
  const list = async (threadId: string): Promise<Msg[]> => (await api("usr_mia", "chat.messages.list", { threadId })).data.messages as Msg[];
  try {
    await connect(d);   // Olivia's own Claude account, hers alone
    const intake = (await api("usr_olivia", "agents.create", { name: "Intake", role: "You check things.", idempotencyKey: "ask-agent" })).data.agent.agentId as string;
    const keys = await api("usr_olivia", "vault.folders.create", { idempotencyKey: "ask-ai", name: "AI accounts", scope: "shared" });
    const team = await api("usr_olivia", "providers.add", { idempotencyKey: "ask-team", providerKey: "anthropic", connection: "api_key", apiKey: `${KEY}T`, name: "Team AI", scope: "shared", folderId: keys.data.folder.id });
    assert.equal(team.status, 200, JSON.stringify(team.data));
    const teamRef = team.data.provider.handle as string;
    const ch = await api("usr_olivia", "channels.create", { name: "intake", visibility: "public", memberIds: ["usr_mia"], agentIds: [intake], idempotencyKey: "ask-channel" });
    assert.equal(ch.status, 200, JSON.stringify(ch.data));
    const threadId = ch.data.channel.mainThreadId as string;
    const directory = [{ id: intake, name: "Intake", kind: "agent" as const }];

    // 1. Olivia's message names nobody: the agent keeps listening
    const sent = await api("usr_olivia", "chat.post", { threadId, body: "Can someone check the Rivera dates?", idempotencyKey: "ask-sent" });
    assert.equal(sent.status, 200, JSON.stringify(sent.data));
    await settle();
    assert.equal(turns.length, 0, "nobody named: no turn");

    // 2. Mia asks Intake about it: one reply of hers, threaded to that message, and one turn that runs for her on the Team account
    const askOlivia = askPost(threadId, sent.data.message.messageId, { id: intake, name: "Intake" }, "usr_mia", "ask-1");
    const asked = await api("usr_mia", "chat.post", askOlivia);
    assert.equal(asked.status, 200, JSON.stringify(asked.data));
    assert.equal(asked.data.message.replyTo, sent.data.message.messageId);
    await waitFor(async () => { await pump(); return turns.length >= 1 ? true : null; }, 20_000, () => hostLog(d));
    assert.deepEqual(turns.map((t) => [t.asker, t.account]), [["usr_mia", teamRef]], "the turn is Mia's, on the Team account, not Olivia's");
    await waitFor(async () => { await pump(); return (await list(threadId)).find((m) => m.author?.id === intake && m.body === "Checked for usr_mia.") ?? null; }, 20_000, () => hostLog(d));

    // 3. the same ask again (a second press) is the same message: no second turn
    const again = await api("usr_mia", "chat.post", { ...askOlivia, idempotencyKey: "ask-2" });
    assert.equal(again.data.message.messageId, asked.data.message.messageId);
    await settle();
    assert.equal(turns.length, 1);

    // 4. Mia's own message, then an edit that adds @Intake: the edit saves and by itself asks nobody
    const mine = await api("usr_mia", "chat.post", { threadId, body: "Please look at the intake form", idempotencyKey: "ask-mine" });
    const before = "Please look at the intake form", after = "@Intake please look at the intake form";
    await settle();
    assert.equal(turns.length, 1, "her unnamed message: still nobody");
    assert.equal((await api("usr_mia", "chat.edit", { threadId, messageId: mine.data.message.messageId, body: after })).status, 200);
    await settle();
    assert.equal(turns.length, 1, "the saved edit does not run a turn on its own; the app's ask does");

    // 5. the ask the app makes after that edit: one turn, hers
    const added = addedAgentMentions(before, after, directory, [intake]);
    assert.deepEqual(added, [intake]);
    for (const a of added) assert.equal((await api("usr_mia", "chat.post", askPost(threadId, mine.data.message.messageId, { id: a, name: "Intake" }, "usr_mia", "ask-3"))).status, 200);
    await waitFor(async () => { await pump(); return turns.length >= 2 ? true : null; }, 20_000, () => hostLog(d));
    assert.deepEqual(turns.map((t) => t.asker), ["usr_mia", "usr_mia"]);
    assert.ok(turns.every((t) => t.account === teamRef), `every turn ran on the Team account: ${JSON.stringify(turns)}`);

    // 6. a later edit that keeps @Intake adds no mention, so the app asks nobody; the same ask posted again is the same message
    const later = "@Intake please look at the intake form again";
    assert.deepEqual(addedAgentMentions(after, later, directory, [intake]), []);
    assert.equal((await api("usr_mia", "chat.edit", { threadId, messageId: mine.data.message.messageId, body: later })).status, 200);
    const dup = await api("usr_mia", "chat.post", askPost(threadId, mine.data.message.messageId, { id: intake, name: "Intake" }, "usr_mia", "ask-4"));
    assert.equal(dup.status, 200);
    await settle(1200);
    assert.equal(turns.length, 2, `two turns in all, one per message asked about: ${JSON.stringify(turns)}`);
    assert.ok(!turns.some((t) => t.asker === "usr_olivia"));
    const replies = (await list(threadId)).filter((m) => m.author?.id === intake && m.body === "Checked for usr_mia.");
    assert.equal(replies.length, 2, "the agent replied once to each message asked about, not again for the repeated asks or the later edit");
  } catch (e) { console.error("FAILED:", e instanceof Error ? e.message.slice(0, 1500) : e); throw e; } finally { await stop(d); }
});
