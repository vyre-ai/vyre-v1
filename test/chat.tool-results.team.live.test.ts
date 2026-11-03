// Tool results stay with the person whose turn it was (agent-visibility gap 2). Olivia asks an agent on an API key in a public channel Mia is in; the agent calls a tool. Olivia's transcript of the
// channel holds what the tool returned; Mia's does not, by reading the transcript or searching it. Real chats on a booted daemon; only the model is scripted.
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

test("Team: in a public channel, Mia cannot read what Olivia's agent turn got back from its tools; Olivia can", async () => {
  const model = scriptedModel(async function* (input, run) {
    if (!/skills/.test(input.trigger?.body ?? "")) return;
    const r = yield* run("tool_search", { query: "skills list" });
    yield { type: "text", text: r.ok ? "I looked at the skills." : `FAILED ${JSON.stringify(r.content).slice(0, 200)}` };
  });
  const ownerToken = { v: "" };
  const d = await boot(seededDir(), model, {
    vault: undefined,
    session: (headers: Record<string, string | undefined>) => {
      const t = String(headers["authorization"] ?? "").replace(/^Bearer /, "");
      const id = t === ownerToken.v ? "usr_olivia" : t;
      return WHO.includes(id) ? { space: CORE_SPACE, principal: { kind: "person" as const, id }, device: "results-team" } : null;
    },
  });
  ownerToken.v = d.token;
  const api = as(d);
  try {
    await connect(d);
    const agentId = (await api("usr_olivia", "agents.create", { name: "Ops", role: "You help the team.", idempotencyKey: "tr-agent" })).data.agent.agentId as string;
    const keys = await api("usr_olivia", "vault.folders.create", { idempotencyKey: "tr-ai", name: "AI accounts", scope: "shared" });
    const acct = await api("usr_olivia", "providers.add", { idempotencyKey: "tr-acct", providerKey: "anthropic", connection: "api_key", apiKey: `${KEY}R`, name: "Team AI", scope: "shared", folderId: keys.data.folder.id });
    assert.equal((await api("usr_olivia", "agents.update", { agentId, patch: { accountPolicy: "key", accountKey: acct.data.provider.handle }, idempotencyKey: "tr-upd" })).status, 200);
    const ch = await api("usr_olivia", "channels.create", { name: "ops", visibility: "public", memberIds: ["usr_mia"], agentIds: [agentId], idempotencyKey: "tr-channel" });
    assert.equal(ch.status, 200, JSON.stringify(ch.data));
    const threadId = ch.data.channel.mainThreadId as string;
    assert.equal((await api("usr_olivia", "chat.post", { threadId, body: "Ops, which skills do you have?", mentions: [{ kind: "agent", id: agentId }], idempotencyKey: "tr-post" })).status, 200);
    await waitFor(async () => {
      await d.hooks?.pump?.();
      const ms = (await api("usr_olivia", "chat.messages.list", { threadId })).data.messages as Array<{ author?: { id?: string }; body?: string }>;
      (d as unknown as { _ms?: unknown })._ms = ms?.map((m) => [m.author?.id, String(m.body).slice(0, 200), JSON.stringify((m as { blocks?: unknown }).blocks ?? []).slice(0, 300)]);
      return ms?.find((m) => m.author?.id === agentId && /looked at the skills/.test(m.body ?? "")) ?? null;
    }, 20_000, () => hostLog(d) + JSON.stringify((d as unknown as { _ms?: unknown })._ms ?? ""));
    // the turn's rows are written after the reply: wait for Olivia's own view to hold the result
    const olivia = await waitFor(async () => {
      const md = (await api("usr_olivia", "chat.transcript.read", { threadId })).data.markdown as string;
      return /tool_result/.test(md) ? md : null;
    }, 10_000, () => hostLog(d));
    assert.match(olivia, /tool_search/);
    const mia = (await api("usr_mia", "chat.transcript.read", { threadId })).data.markdown as string;
    assert.match(mia, /looked at the skills/, "Mia reads the words of the turn");
    assert.match(mia, /tool_call, tool_search/, "and the one-line call");
    assert.doesNotMatch(mia, /tool_result/, "but not what the tool returned");
    const found = (await api("usr_mia", "chat.transcript.search", { q: "skill", threadId })).data.hits as Array<{ role: string }>;
    assert.ok(!found.some((h) => h.role === "tool"), JSON.stringify(found));
  } catch (e) { console.error("FAILED:", e instanceof Error ? e.message.slice(0, 1500) : e); throw e; } finally { await stop(d); }
});
