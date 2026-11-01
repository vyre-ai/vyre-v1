// A key asked for in a chat, with two people (Team): Mia asks her agent to set up Fathom, the agent asks for the key in Mia's chat, the admin (Olivia) adds it from her own Needs you, and the agent carries on
// in Mia's chat by itself. Mia is not a manager, so she cannot decide it; the secret reaches no message or log. Real chats on a booted daemon; only the model is scripted.
import test from "node:test";
import assert from "node:assert/strict";
import { CORE_SPACE } from "../fixtures/seed/core/index.ts";
import { KEY, boot, connect, hostLog, scriptedModel, seededDir, stop, waitFor } from "./support/eco-live.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const SECRET = "fth_team_FAKEsecretVALUE0123456789abcdef"; // secret-scan: fake
const WHO = ["usr_olivia", "usr_adam", "usr_mia", "usr_noah"];

const as = (d: Daemon) => async (who: string, cap: string, input: unknown): Promise<{ status: number; data: any }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${who}` }, body: JSON.stringify(input) });
  const b = (await r.json()) as { data?: unknown };
  return { status: r.status, data: b.data ?? b };
};

test("Team: a member's agent asks for a key in her chat; the admin adds it; the agent carries on there", async () => {
  const model = scriptedModel(async function* (input, run) {
    const ask = input.trigger?.body ?? "";
    if (/set up fathom/.test(ask)) {
      const r = yield* run("vault_request", { name: "Fathom", fields: ["api_key"], reason: "To read your meetings.", idempotencyKey: "team-ask-fathom" });
      yield { type: "text", text: r.ok ? "I asked for the Fathom key." : `FAILED ${JSON.stringify(r.content).slice(0, 200)}` };
    } else if (/Carry on/.test(ask)) yield { type: "text", text: "Thanks, carrying on with Fathom." };
  });
  const ownerToken = { v: "" };
  const d = await boot(seededDir(), model, {
    vault: undefined,
    session: (headers: Record<string, string | undefined>) => {
      const t = String(headers["authorization"] ?? "").replace(/^Bearer /, "");
      const id = t === ownerToken.v ? "usr_olivia" : t;
      return WHO.includes(id) ? { space: CORE_SPACE, principal: { kind: "person" as const, id }, device: "ask-team" } : null;
    },
  });
  ownerToken.v = d.token;
  const api = as(d);
  const lastThread = { v: "" };
  try {
    await connect(d);
    const agent = await api("usr_olivia", "agents.create", { name: "Ops", role: "You help the team.", idempotencyKey: "ta-agent" });
    const agentId = agent.data.agent.agentId as string;
    const keys = await api("usr_olivia", "vault.folders.create", { idempotencyKey: "ta-ai", name: "AI accounts", scope: "shared" });
    const acct = await api("usr_olivia", "providers.add", { idempotencyKey: "ta-acct", providerKey: "anthropic", connection: "api_key", apiKey: `${KEY}A`, name: "Team AI", scope: "shared", folderId: keys.data.folder.id });
    assert.equal((await api("usr_olivia", "agents.update", { agentId, patch: { accountPolicy: "key", accountKey: acct.data.provider.handle }, idempotencyKey: "ta-upd" })).status, 200);
    const teamKeys = await api("usr_olivia", "vault.folders.create", { idempotencyKey: "ta-keys", name: "Team keys", scope: "shared" });

    // Mia asks her agent in her own chat
    const th = await api("usr_mia", "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "ta-chat" });
    assert.equal(th.status, 200, JSON.stringify(th.data));
    const threadId = th.data.thread.threadId as string;
    lastThread.v = threadId;
    await api("usr_mia", "chat.post", { threadId, body: "set up fathom", mentions: [{ kind: "agent", id: agentId }], idempotencyKey: "ta-post" });
    const card = await waitFor(async () => {
      await d.hooks?.pump?.();
      const ms = (await api("usr_mia", "chat.messages.list", { threadId })).data.messages as Array<{ blocks: Array<{ type: string; data: { requestId?: string } }> }>;
      return ms?.flatMap((m) => m.blocks).find((b) => b.type === "vault_request") ?? null;
    }, 60_000, () => hostLog(d));
    const requestId = card.data.requestId as string;

    // Mia cannot decide it; the admin can, and has it in her own Needs you with the chat linked
    assert.equal(((await api("usr_mia", "vault.requests.list", { mine: false })).data.requests ?? []).length, 0, "the asker never decides her own request");
    assert.ok(((await api("usr_olivia", "vault.requests.list", { mine: false })).data.requests as Array<{ id: string }>).some((r) => r.id === requestId));
    const mine = async (who: string) => ((await api(who, "tasks.list", { scope: "mine", kinds: ["unblock"], states: ["todo", "doing"] })).data.tasks as Array<{ title: string; workingNotes: Record<string, string> }>).filter((t) => t.title === "Fathom key needed");
    const row = (await mine("usr_olivia"))[0];
    assert.ok(row, "the admin has the row");
    assert.equal(row!.workingNotes["thread"], threadId);
    assert.equal((await mine("usr_mia")).length, 0);

    // the admin adds the key
    const done = await api("usr_olivia", "vault.requests.fulfil", { requestId, folderId: teamKeys.data.folder.id, fields: [{ key: "api_key", value: SECRET }] });
    assert.equal(done.status, 200, JSON.stringify(done.data));
    assert.equal((await mine("usr_olivia")).length, 0, "the row cleared");

    // the agent carries on in Mia's chat
    const said = await waitFor(async () => {
      await d.hooks?.pump?.();
      const ms = (await api("usr_mia", "chat.messages.list", { threadId })).data.messages as Array<{ author?: { kind?: string }; body?: string }>;
      return ms?.find((m) => m.author?.kind === "agent" && /carrying on/.test(m.body ?? "")) ?? null;
    }, 60_000, () => hostLog(d));
    assert.ok(said);
    const all = JSON.stringify((await api("usr_mia", "chat.messages.list", { threadId })).data) + hostLog(d);
    assert.ok(!all.includes(SECRET), "the value reached no message, block or log");
  } catch (e) { console.error("FAILED:", e instanceof Error ? e.message.slice(0, 1500) : e); throw e; } finally { await stop(d); }
});
