// The audience check at the answer-posting step (agent-visibility gap 6). Olivia asks an agent in a channel Mia is in about a deal open only to the people added to it (Olivia and the agent). The agent reads it as Olivia, which it may; but
// Mia may not open it, so the answer goes to Olivia privately, in her own chat with the agent, and the channel gets one line. Mia never sees the deal's words, posted or live.
// Real chats on a booted daemon; only the model is scripted.
import test from "node:test";
import assert from "node:assert/strict";
import { CORE_SPACE } from "../fixtures/seed/core/index.ts";
import { KEY, boot, connect, hostLog, scriptedModel, seededDir, stop, waitFor } from "./support/eco-live.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const WHO = ["usr_olivia", "usr_mia"];
const as = (d: Daemon) => async (who: string, cap: string, input: unknown): Promise<{ status: number; data: any }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${who}` }, body: JSON.stringify(input) });
  const b = (await r.json()) as { data?: unknown };
  return { status: r.status, data: b.data ?? b };
};
type Msg = { author?: { kind?: string; id?: string }; body?: string };

test("Team: an answer built on a deal Mia may not open goes to Olivia privately; the channel gets one line", async () => {
  const deal = { id: "" };
  const model = scriptedModel(async function* (input, run) {
    if (!/Cedar/.test(input.trigger?.body ?? "")) return;
    yield* run("tool_search", { query: "records get" });
    const r = yield* run("records_get", { type: "rt_deal", recordId: deal.id });
    const f = (r.content as { data?: { record?: { fields?: { name?: string; stage?: string } } }; record?: { fields?: { name?: string; stage?: string } } });
    const rec = f.data?.record ?? f.record;
    yield { type: "text", text: r.ok ? `${rec?.fields?.name} is at stage ${rec?.fields?.stage}, with a walk-away of 310k.` : `FAILED ${JSON.stringify(r.content).slice(0, 300)}` };
  });
  const ownerToken = { v: "" };
  const d = await boot(seededDir(), model, {
    vault: undefined,
    session: (headers: Record<string, string | undefined>) => {
      const t = String(headers["authorization"] ?? "").replace(/^Bearer /, "");
      const id = t === ownerToken.v ? "usr_olivia" : t;
      return WHO.includes(id) ? { space: CORE_SPACE, principal: { kind: "person" as const, id }, device: "answer-team" } : null;
    },
  });
  ownerToken.v = d.token;
  const api = as(d);
  try {
    await connect(d);
    const made = await api("usr_olivia", "schema.apply", { idempotencyKey: "aa-type", ops: [{ op: "type.create", type: "rt_deal", def: { title: "Deal", plural: "Deals", icon: "invoice", titleField: "name", fields: [{ key: "name", type: "text", title: "Name", required: true }, { key: "stage", type: "text", title: "Stage" }] } }] });
    assert.equal(made.status, 200, JSON.stringify(made.data));
    const rec = await api("usr_olivia", "records.create", { idempotencyKey: "aa-rec", type: "rt_deal", fields: { name: "Cedar upsell", stage: "negotiation" } });
    assert.equal(rec.status, 200, JSON.stringify(rec.data));
    deal.id = rec.data.record.id as string;
    const agentId = (await api("usr_olivia", "agents.create", { name: "Deals", role: "You know the deals.", idempotencyKey: "aa-agent" })).data.agent.agentId as string;
    // only people added may open the deal: Olivia and her agent are, Mia is not
    assert.equal((await api("usr_olivia", "access.audience_set", { idempotencyKey: "aa-added", resource: { type: "record", id: deal.id }, audience: "added" })).status, 200);
    for (const subject of [{ kind: "person", id: "usr_olivia" }, { kind: "agent", id: agentId }]) {
      const shared = await api("usr_olivia", "access.share", { idempotencyKey: `aa-share-${subject.id}`, resource: { type: "record", id: deal.id }, subject, level: "view" });
      assert.equal(shared.status, 200, JSON.stringify(shared.data));
    }
    assert.equal((await api("usr_olivia", "records.get", { type: "rt_deal", recordId: deal.id })).status, 200, "Olivia may open the deal");
    assert.notEqual((await api("usr_mia", "records.get", { type: "rt_deal", recordId: deal.id })).status, 200, "Mia may not");
    const keys = await api("usr_olivia", "vault.folders.create", { idempotencyKey: "aa-ai", name: "AI accounts", scope: "shared" });
    const acct = await api("usr_olivia", "providers.add", { idempotencyKey: "aa-acct", providerKey: "anthropic", connection: "api_key", apiKey: `${KEY}D`, name: "Team AI", scope: "shared", folderId: keys.data.folder.id });
    assert.equal((await api("usr_olivia", "agents.update", { agentId, patch: { accountPolicy: "key", accountKey: acct.data.provider.handle }, idempotencyKey: "aa-upd" })).status, 200);
    const ch = await api("usr_olivia", "channels.create", { name: "deals", visibility: "invite", memberIds: ["usr_mia"], agentIds: [agentId], idempotencyKey: "aa-channel" });
    assert.equal(ch.status, 200, JSON.stringify(ch.data));
    const threadId = ch.data.channel.mainThreadId as string;

    assert.equal((await api("usr_olivia", "chat.post", { threadId, body: "Deals, where is Cedar at?", mentions: [{ kind: "agent", id: agentId }], idempotencyKey: "aa-post" })).status, 200);
    const line = await waitFor(async () => {
      await d.hooks?.pump?.();
      const ms = (await api("usr_mia", "chat.messages.list", { threadId })).data.messages as Msg[];
      return ms?.find((m) => m.author?.id === agentId && (m.body ?? "") !== "") ?? null;
    }, 20_000, () => hostLog(d));
    assert.doesNotMatch(line.body ?? "", /negotiation|310k|FAILED/, `the channel line: ${line.body}`);
    assert.match(line.body ?? "", /privately/);
    // the whole answer is in Olivia's own chat with the agent, which Mia cannot open
    const recent = await waitFor(async () => {
      await d.hooks?.pump?.();
      const r = await api("usr_olivia", "threads.list", { kind: ["chat"] });
      const rows = (r.data.threads ?? []) as Array<{ threadId: string; title?: string }>;
      return rows.find((t) => t.title === "Private answers") ?? null;
    }, 10_000, () => hostLog(d));
    const mine = (await api("usr_olivia", "chat.messages.list", { threadId: recent.threadId })).data.messages as Msg[];
    assert.ok(mine.some((m) => /Cedar upsell is at stage negotiation/.test(m.body ?? "")), JSON.stringify(mine).slice(0, 500));
    assert.notEqual((await api("usr_mia", "chat.messages.list", { threadId: recent.threadId })).status, 200, "Mia cannot open Olivia's private answers");
    // and nothing of it in what Mia can read of the channel's transcript
    const miaT = JSON.stringify((await api("usr_mia", "chat.transcript.read", { threadId })).data);
    assert.doesNotMatch(miaT, /negotiation|310k/, miaT.slice(0, 2500));
  } catch (e) { console.error("FAILED:", e instanceof Error ? e.message.slice(0, 1500) : e); throw e; } finally { await stop(d); }
});
