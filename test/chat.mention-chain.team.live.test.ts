// An @mention hop runs for the person who asked, not the chat's starter (agent-visibility gap 1). Olivia starts a channel with agents X and Y. Mia asks X; X hands to Y with an @mention.
// Y's turn runs for Mia, never on Olivia's account: Olivia's Mine AI account does not exist for it, so it runs on the Space's shared Team AI key (l-vaultfix: Space AI accounts pay Team turns). Real chats on a
// booted daemon; only the model is a stand-in.
import test from "node:test";
import assert from "node:assert/strict";
import { CORE_SPACE } from "../fixtures/seed/core/index.ts";
import { KEY, boot, connect, hostLog, seededDir, stop, waitFor, listAll } from "./support/eco-live.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import type { DriverEvent, EngineSession, OpenSession, TurnInput } from "../agent/src/turn-engine/types.ts";

const WHO = ["usr_olivia", "usr_mia"];

const as = (d: Daemon) => async (who: string, cap: string, input: unknown): Promise<{ status: number; data: any }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${who}` }, body: JSON.stringify(input) });
  const b = (await r.json()) as { data?: unknown };
  return { status: r.status, data: b.data ?? b };
};

test("Team: Mia asks X in Olivia's channel, X @mentions Y; Y runs for Mia and cannot use Olivia's Mine account", async () => {
  const ids = { x: "", y: "" };
  const turns: Array<{ agent: string; asker: string; account: string }> = [];
  // X answers and hands to Y with an @mention; Y answers
  const model: OpenSession = async (spec) => {
    turns.push({ agent: spec.agent.id, asker: spec.asker, account: spec.account?.ref ?? "" });
    return {
      warm: true,
      async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
        if (input.agent.id === ids.x) { yield { type: "text", text: "Y, can you check this?" }; yield { type: "done", mentions: [{ kind: "agent", id: ids.y }] }; return; }
        yield { type: "text", text: `Checked, for ${input.asker}.` };
        yield { type: "done" };
      },
      sendToolResult() {}, inject() {}, async cancel() {}, async close() {},
    } as EngineSession;
  };
  const ownerToken = { v: "" };
  const d = await boot(seededDir(), model, {
    vault: undefined,
    session: (headers: Record<string, string | undefined>) => {
      const t = String(headers["authorization"] ?? "").replace(/^Bearer /, "");
      const id = t === ownerToken.v ? "usr_olivia" : t;
      return WHO.includes(id) ? { space: CORE_SPACE, principal: { kind: "person" as const, id }, device: "chain-team" } : null;
    },
  });
  ownerToken.v = d.token;
  const api = as(d);
  try {
    // Olivia's own Claude account, a Mine item that is hers alone. X runs on a team key of its own; Y has none, so Y runs on whichever account its asker has.
    await connect(d);
    ids.x = (await api("usr_olivia", "agents.create", { name: "Xavier", role: "You look things up.", idempotencyKey: "chain-x" })).data.agent.agentId as string;
    ids.y = (await api("usr_olivia", "agents.create", { name: "Yara", role: "You check things.", idempotencyKey: "chain-y" })).data.agent.agentId as string;
    const keys = await api("usr_olivia", "vault.folders.create", { idempotencyKey: "chain-ai", name: "AI accounts", scope: "shared" });
    const team = await api("usr_olivia", "providers.add", { idempotencyKey: "chain-team", providerKey: "anthropic", connection: "api_key", apiKey: `${KEY}T`, name: "Team AI", scope: "shared", folderId: keys.data.folder.id });
    assert.equal(team.status, 200, JSON.stringify(team.data));
    const teamRef = team.data.provider.handle as string;
    assert.equal((await api("usr_olivia", "agents.update", { agentId: ids.x, patch: { accountPolicy: "key", accountKey: teamRef }, idempotencyKey: "chain-x-key" })).status, 200);
    const ch = await api("usr_olivia", "channels.create", { name: "intake", visibility: "public", memberIds: ["usr_mia"], agentIds: [ids.x, ids.y], idempotencyKey: "chain-channel" });
    assert.equal(ch.status, 200, JSON.stringify(ch.data));
    const threadId = ch.data.channel.mainThreadId as string;

    const posted = await api("usr_mia", "chat.post", { threadId, body: "Xavier, please look up the Rivera file", mentions: [{ kind: "agent", id: ids.x }], idempotencyKey: "chain-post" });
    assert.equal(posted.status, 200, JSON.stringify(posted.data));
    type Msg = { author?: { id?: string }; body?: string; paidBy?: string; blocks?: Array<{ type: string; data?: { code?: string } }> };
    // Y answers one way or the other: a reply (it ran on someone's account) or a failure card (nobody it runs for has one)
    const yMsg = await waitFor(async () => {
      await d.hooks?.pump?.();
      const ms = (await listAll<Msg>(api, "usr_mia", threadId));
      return ms?.find((m) => m.author?.id === ids.y) ?? null;
    }, 20_000, () => hostLog(d));

    const x = turns.find((t) => t.agent === ids.x);
    assert.equal(x?.asker, "usr_mia");
    assert.equal(x?.account, teamRef);
    assert.ok(!turns.some((t) => t.asker === "usr_olivia"), `no turn ran for Olivia, who started the channel: ${JSON.stringify(turns)}`);
    // Y ran for Mia on the Space's shared Team AI key (Space AI accounts pay Team turns, l-vaultfix), never on Olivia's Mine account
    const y = turns.filter((t) => t.agent === ids.y);
    assert.ok(y.length > 0 && y.every((t) => t.asker === "usr_mia" && t.account === teamRef), `Y ran for Mia on the team key only: ${JSON.stringify(y)}`);
    assert.equal(yMsg.body, "Checked, for usr_mia.");
    assert.notEqual(yMsg.paidBy, "usr_olivia");
  } catch (e) { console.error("FAILED:", e instanceof Error ? e.message.slice(0, 1500) : e); throw e; } finally { await stop(d); }
});
