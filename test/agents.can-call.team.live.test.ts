// "Agents in this Space can call X" (owner, 4 Nov), end to end on a booted daemon with only the model a stand-in. Olivia has two agents, Intake and Dex. Intake hands work to Dex: it goes through
// while Dex takes calls from agents (the default). Olivia turns it Off in Dex's Share sheet (access.agents_can_call.set): the same handoff is refused and no thread is made. A member who
// cannot manage Dex cannot turn it back On. Olivia turns it On and the handoff goes through again.
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

test("Team: an agent's handoff to another agent is refused while that agent has calls from agents Off, and goes through when On", async () => {
  const dexId = { v: "" };
  const results: string[] = [];
  const thread = { v: "" };
  const model = scriptedModel(async function* (input, run) {
    const ask = input.trigger?.body ?? "";
    if (/hand it to dex/.test(ask)) {
      const r = yield* run("handoff", { threadId: thread.v, toAgentId: dexId.v, note: "Please take this one.", idempotencyKey: `h-${results.length}` });
      results.push(r.ok ? "ok" : "refused");
      yield { type: "text", text: r.ok ? "Handed it to Dex." : "Dex does not take calls from agents." };
    }
  });
  const ownerToken = { v: "" };
  const d = await boot(seededDir(), model, {
    session: (headers: Record<string, string | undefined>) => {
      const t = String(headers["authorization"] ?? "").replace(/^Bearer /, "");
      const id = t === ownerToken.v ? "usr_olivia" : t;
      return WHO.includes(id) ? { space: CORE_SPACE, principal: { kind: "person" as const, id }, device: "can-call" } : null;
    },
  });
  ownerToken.v = d.token;
  const api = as(d);
  try {
    await connect(d);
    const keys = await api("usr_olivia", "vault.folders.create", { idempotencyKey: "cc-ai", name: "AI accounts", scope: "shared" });
    const acct = await api("usr_olivia", "providers.add", { idempotencyKey: "cc-acct", providerKey: "anthropic", connection: "api_key", apiKey: `${KEY}A`, name: "Team AI", scope: "shared", folderId: keys.data.folder.id });
    const make = async (name: string): Promise<string> => {
      const a = await api("usr_olivia", "agents.create", { name, role: "You help the team.", idempotencyKey: `cc-${name}` });
      const id = a.data.agent.agentId as string;
      assert.equal((await api("usr_olivia", "agents.update", { agentId: id, patch: { accountPolicy: "key", accountKey: acct.data.provider.handle }, idempotencyKey: `cc-u-${name}` })).status, 200);
      return id;
    };
    const intake = await make("Intake");
    dexId.v = await make("Dex");
    assert.equal((await api("usr_olivia", "access.agents_can_call.get", { agentId: dexId.v })).data.on, true, "On by default");
    const shares = await api("usr_olivia", "access.shares_of", { resource: { type: "agent", id: dexId.v } });
    assert.equal(shares.data.agentsCanCall, true);
    assert.ok(!shares.data.shares.some((s: { grant: { subject: { id: string } } }) => s.grant.subject.id === dexId.v), "Dex does not list itself");

    const ask = async (n: number): Promise<void> => {
      const th = await api("usr_olivia", "chat.start", { kind: "chat", agentIds: [intake], idempotencyKey: `cc-chat-${n}` });
      const threadId = th.data.thread.threadId as string;
      thread.v = threadId;
      await api("usr_olivia", "chat.post", { threadId, body: "hand it to dex", mentions: [{ kind: "agent", id: intake }], idempotencyKey: `cc-post-${n}` });
      await waitFor(async () => { await d.hooks?.pump?.(); return results.length >= n ? true : null; }, 60_000, () => hostLog(d));
    };
    const handoffs = async (): Promise<number> => ((await api("usr_olivia", "chat.list", {})).data.threads as Array<{ parentThreadId?: string }> | undefined)?.filter((t) => t.parentThreadId !== undefined).length ?? 0;

    await ask(1);
    assert.equal(results[0], "ok", "calls from agents are On by default");
    const made = await handoffs();

    assert.equal((await api("usr_olivia", "access.agents_can_call.set", { agentId: dexId.v, on: false, idempotencyKey: "cc-off" })).status, 200);
    await ask(2);
    assert.equal(results[1], "refused", "Off: the handoff is refused");
    assert.equal(await handoffs(), made, "and no thread was made");

    const denied = await api("usr_mia", "access.agents_can_call.set", { agentId: dexId.v, on: true, idempotencyKey: "cc-mia" });
    assert.notEqual(denied.status, 200, "a member who cannot manage Dex cannot turn it On");
    assert.equal((await api("usr_olivia", "access.agents_can_call.get", { agentId: dexId.v })).data.on, false);

    assert.equal((await api("usr_olivia", "access.agents_can_call.set", { agentId: dexId.v, on: true, idempotencyKey: "cc-on" })).status, 200);
    await ask(3);
    assert.equal(results[2], "ok", "On again: the handoff goes through");
  } catch (e) { console.error("FAILED:", e instanceof Error ? e.message.slice(0, 1500) : e); throw e; } finally { await stop(d); }
});
