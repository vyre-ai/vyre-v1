// A plain yes to what the agent proposed counts as approval in Auto (lane l-chrome2a), on a booted daemon. The agent says it can message Noah and that it waits for a yes; Mia writes "yes" and then a message
// with no words; the agent's message goes out with no card. A yes to a proposal of something else (a push) opens nothing: the same message to Noah waits on a card. Real chats and Gate; the model is scripted.
import test from "node:test";
import assert from "node:assert/strict";
import { CORE_SPACE } from "../fixtures/seed/core/index.ts";
import { KEY, boot, connect, hostLog, scriptedModel, seededDir, stop, waitFor } from "./support/eco-live.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const WHO = ["usr_olivia", "usr_adam", "usr_mia", "usr_noah"];
type Msg = { author?: { kind?: string; id?: string }; kind?: string; body?: string; blocks?: Array<{ type: string; data?: Record<string, unknown> }> };

const as = (d: Daemon) => async (who: string, cap: string, input: unknown): Promise<{ status: number; data: any }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${who}` }, body: JSON.stringify(input) });
  const b = (await r.json()) as { data?: unknown };
  return { status: r.status, data: b.data ?? b };
};

test("Team: 'yes' to the proposal lets that act through with no card, even after a message with no words; a yes to something else opens nothing", async () => {
  let sends = 0;
  const model = scriptedModel(async function* (input, run) {
    const said = (input.trigger?.body ?? "").trim();
    if (said === "any news for Noah?") yield { type: "text", text: "I can message Noah that the figures are ready. It waits for your yes." };
    else if (said === "status?") yield { type: "text", text: "I will push the branch to main. It waits for your yes." };
    else if (said === "^") {
      const r = yield* run("message_person", { to: "usr_noah", body: `Figures note ${++sends}`, idempotencyKey: `py-${sends}` });
      yield { type: "text", text: r.ok ? `Sent ${sends}.` : `Failed ${sends}.` };
    }
  });
  const ownerToken = { v: "" };
  const d = await boot(seededDir(), model, {
    vault: undefined,
    session: (headers: Record<string, string | undefined>) => {
      const t = String(headers["authorization"] ?? "").replace(/^Bearer /, "");
      const id = t === ownerToken.v ? "usr_olivia" : t;
      return WHO.includes(id) ? { space: CORE_SPACE, principal: { kind: "person" as const, id }, device: "plain-yes" } : null;
    },
  });
  ownerToken.v = d.token;
  const api = as(d);
  const list = async (who: string, threadId: string): Promise<Msg[]> => { await d.hooks?.pump?.(); return ((await api(who, "chat.messages.list", { threadId })).data.messages as Msg[] | undefined) ?? []; };
  try {
    await connect(d);
    const agentId = (await api("usr_olivia", "agents.create", { name: "Ops", role: "You help the team.", idempotencyKey: "py-agent" })).data.agent.agentId as string;
    const keys = await api("usr_olivia", "vault.folders.create", { idempotencyKey: "py-ai", name: "AI accounts", scope: "shared" });
    const acct = await api("usr_olivia", "providers.add", { idempotencyKey: "py-acct", providerKey: "anthropic", connection: "api_key", apiKey: `${KEY}A`, name: "Team AI", scope: "shared", folderId: keys.data.folder.id });
    assert.equal((await api("usr_olivia", "agents.update", { agentId, patch: { accountPolicy: "key", accountKey: acct.data.provider.handle }, idempotencyKey: "py-upd" })).status, 200);
    const chat = (await api("usr_mia", "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "py-chat" })).data.thread.threadId as string;
    const dm = (await api("usr_mia", "chat.start", { kind: "chat", agentIds: [], personId: "usr_noah", idempotencyKey: "py-dm" })).data.thread.threadId as string;
    let k = 0;
    const say = (body: string) => api("usr_mia", "chat.post", { threadId: chat, body, mentions: [{ kind: "agent", id: agentId }], idempotencyKey: `py-${++k}` });
    const agentSaid = (re: RegExp) => waitFor(async () => (await list("usr_mia", chat)).find((m) => m.author?.kind === "agent" && re.test(m.body ?? "")) ?? null, 30_000, () => hostLog(d));
    const cards = async (): Promise<number> => (await list("usr_mia", chat)).flatMap((m) => m.blocks ?? []).filter((b) => b.type === "link_card" && b.data?.["icon"] === "approval").length;

    // 1. proposal, yes, then a message with no words: the message goes out, no card
    await say("any news for Noah?");
    await agentSaid(/It waits for your yes/);
    await say("yes");
    await say("^");
    await agentSaid(/^Sent 1\./);
    assert.ok((await list("usr_noah", dm)).some((m) => /Figures note 1/.test(m.body ?? "")), "Noah has it");
    assert.equal(await cards(), 0, "no card was shown");

    // 2. it was one yes for one act: the next message to Noah waits
    await say("^");
    await waitFor(async () => ((await cards()) === 1 ? true : null), 30_000, () => hostLog(d));
    assert.ok(!(await list("usr_noah", dm)).some((m) => /Figures note 2/.test(m.body ?? "")), "the second one needs its own yes");

    // 3. a yes to a proposal of something else (a push) opens nothing for a message to Noah
    await say("status?");
    await agentSaid(/push the branch to main/);
    await say("yes");
    await say("^");
    await waitFor(async () => ((await cards()) === 2 ? true : null), 30_000, () => hostLog(d));
    assert.ok(!(await list("usr_noah", dm)).some((m) => /Figures note 3/.test(m.body ?? "")), "held: a yes to a push is not a yes to a message");
  } catch (e) { console.error("FAILED:", e instanceof Error ? e.message.slice(0, 1500) : e); throw e; } finally { await stop(d); }
});
