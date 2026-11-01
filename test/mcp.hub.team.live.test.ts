// An app hub in a Team Space (rc.9, By Space): an admin connects Composio with a Shared Vault key; two members each ask the same agent to use Slack. The hub is told a different person for each,
// so member A's agent reads A's Slack and never B's; a Space tool (Notion) runs on the Space's one sign-in; a revoked key reads as one plain sentence, not a stack. Only a fake hub is reached.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createGuardedFetch } from "../lib/net-guard.ts";
import { CORE_SPACE } from "../fixtures/seed/core/index.ts";
import { KEY, boot, connect, hostLog, scriptedModel, seededDir, stop, waitFor } from "./support/eco-live.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const HUB_KEY = "cmp_team_FAKEhubKEY0123456789abcdef"; // secret-scan: fake
const HUB_URL = "https://backend.composio.dev/v3/mcp/srv_team/mcp";
const WHO = ["usr_olivia", "usr_adam", "usr_mia", "usr_noah"];

interface Seen { tool?: string; user: string | null }

function fakeHub(seen: Seen[], state: { revoked: boolean }): Promise<{ port: number; close(): Promise<void> }> {
  const tools = [
    { name: "SLACK_LIST_CHANNELS", description: "List the channels of the signed-in person.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
    { name: "NOTION_LIST_PAGES", description: "List the Space's pages.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  ];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += String(c); });
    req.on("end", () => {
      const user = new URL(req.url ?? "/", "http://x").searchParams.get("user_id");
      if (state.revoked || req.headers["x-api-key"] !== HUB_KEY) { res.writeHead(401, { "content-type": "application/json" }); res.end('{"error":"bad key"}'); return; }
      const m = JSON.parse(body) as { id?: number; method: string; params?: { name?: string } };
      seen.push({ ...(m.params?.name ? { tool: m.params.name } : {}), user });
      const reply = (result: unknown): void => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ jsonrpc: "2.0", id: m.id, result })); };
      if (m.method === "initialize") reply({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-composio", version: "1" } });
      else if (m.method === "tools/list") reply({ tools });
      else if (m.method === "tools/call") reply({ content: [{ type: "text", text: `${m.params?.name} for ${user}` }] });
      else { res.writeHead(202); res.end(); }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ port: (server.address() as { port: number }).port, close: () => new Promise<void>((r) => server.close(() => r())) })));
}

const as = (d: Daemon) => async (who: string, cap: string, input: unknown): Promise<{ status: number; data: any }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${who}` }, body: JSON.stringify(input) });
  const b = (await r.json()) as { data?: unknown };
  return { status: r.status, data: b.data ?? b };
};

test("Team: the admin connects with a Shared key; each member's agent runs on that member's own sign-in", async () => {
  const seen: Seen[] = [];
  const state = { revoked: false };
  const hub = await fakeHub(seen, state);
  const guarded = createGuardedFetch({ own: true });
  const mcpFetch = (url: string, init: Parameters<typeof guarded>[1]) => guarded(url.replace("https://backend.composio.dev", `http://127.0.0.1:${hub.port}`), init);
  const model = scriptedModel(async function* (input, run) {
    const ask = input.trigger?.body ?? "";
    const tool = /pages/.test(ask) ? "mcp__composio__NOTION_LIST_PAGES" : "mcp__composio__SLACK_LIST_CHANNELS";
    const r = yield* run(tool, {});
    yield { type: "text", text: r.ok ? `GOT ${JSON.stringify(r.content)}` : `FAILED ${JSON.stringify(r.content ?? r)}` };
  });
  const dir = seededDir();
  const ownerToken = { v: "" };
  const d = await boot(dir, model, {
    mcpFetch, vault: undefined,
    session: (headers: Record<string, string | undefined>) => {
      const t = String(headers["authorization"] ?? "").replace(/^Bearer /, "");
      const id = t === ownerToken.v ? "usr_olivia" : t;
      return WHO.includes(id) ? { space: CORE_SPACE, principal: { kind: "person" as const, id }, device: "hub-team" } : null;
    },
  });
  ownerToken.v = d.token;
  const api = as(d);
  try {
    // connect() unlocks the Vault and sets up the model account as the owner (the daemon's own token)
    await connect(d);
    const agentRes = await api("usr_olivia", "agents.create", { name: "Ops", role: "You help the team.", idempotencyKey: "team-agent" });
    assert.equal(agentRes.status, 200, JSON.stringify(agentRes.data));
    const agentId = agentRes.data.agent.agentId as string;
    // the agent runs on a Shared AI account, so members need no account of their own here
    const keys = await api("usr_olivia", "vault.folders.create", { idempotencyKey: "team-ai-folder", name: "AI accounts", scope: "shared" });
    const acct = await api("usr_olivia", "providers.add", { idempotencyKey: "team-ai", providerKey: "anthropic", connection: "api_key", apiKey: `${KEY}T`, name: "Team AI", scope: "shared", folderId: keys.data.folder.id });
    assert.equal(acct.status, 200, JSON.stringify(acct.data));
    const upd = await api("usr_olivia", "agents.update", { agentId, patch: { accountPolicy: "key", accountKey: acct.data.provider.handle }, idempotencyKey: "team-agent-key" });
    assert.equal(upd.status, 200, JSON.stringify(upd.data));

    // the admin: a Shared folder holds the key, the connection holds only its handle
    const folder = await api("usr_olivia", "vault.folders.create", { idempotencyKey: "team-folder", name: "Team keys", scope: "shared" });
    assert.equal(folder.status, 200, JSON.stringify(folder.data));
    const put = await api("usr_olivia", "vault.item.put", { idempotencyKey: "team-key", folderId: folder.data.folder.id, name: "Composio_key", kind: "api_key", fields: [{ key: "api_key", value: HUB_KEY, secret: true }] });
    assert.equal(put.status, 200, JSON.stringify(put.data));
    const made = await api("usr_olivia", "plugins.connection.add", { idempotencyKey: "team-conn", name: "composio", scope: "space", url: HUB_URL, headers: { "x-api-key": "#Composio_key.api_key" }, hub: "composio" });
    assert.equal(made.status, 200, JSON.stringify(made.data));

    // a member reads the tool list on the Space's own identity
    const list = await api("usr_mia", "engine.mcp.tools", { agentId });
    const server = list.data.servers?.find((s: { key: string }) => s.key === "composio");
    assert.equal(server?.ok, true, JSON.stringify(list.data));

    // Mia and Noah each ask the one agent for their Slack; the hub is told two different people
    const asks: Record<string, string> = {};
    for (const who of ["usr_mia", "usr_noah"]) {
      const th = await api(who, "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: `team-${who}-s` });
      assert.equal(th.status, 200, JSON.stringify(th.data));
      const threadId = th.data.thread.threadId as string;
      await api(who, "chat.post", { threadId, body: "list channels", mentions: [{ kind: "agent", id: agentId }], idempotencyKey: `team-${who}-p` });
      asks[who] = await waitFor(async () => {
        await d.hooks?.pump?.();
        const ms = (await api(who, "chat.messages.list", { threadId })).data.messages as Array<{ author?: { kind?: string }; body?: string }> | undefined;
        return ms?.find((m) => m.author?.kind === "agent" && (m.body ?? "") !== "")?.body ?? null;
      }, 25_000, () => hostLog(d)).catch(async (e) => { console.error("MSGS", JSON.stringify((await api(who, "chat.messages.list", { threadId })).data).slice(0, 1500)); throw e; });
    }
    const slack = seen.filter((s) => s.tool === "SLACK_LIST_CHANNELS");
    assert.equal(slack.length, 2, JSON.stringify(seen));
    assert.notEqual(slack[0]!.user, slack[1]!.user, "two people, two sign-ins");
    assert.match(asks["usr_mia"]!, new RegExp(slack[0]!.user!));
    assert.match(asks["usr_noah"]!, new RegExp(slack[1]!.user!));
    assert.ok(!asks["usr_mia"]!.includes(slack[1]!.user!), "A's agent never saw B's sign-in");
    assert.ok(!JSON.stringify(seen).includes("usr_"), "no Vyre id reaches the hub");
    for (const a of Object.values(asks)) assert.ok(!a.includes(HUB_KEY));

    // a Space tool runs on the Space's one sign-in, whoever asks
    const ask = async (who: string, body: string, key: string): Promise<string> => {
      const th = (await api(who, "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: `${key}-s` })).data.thread.threadId as string;
      await api(who, "chat.post", { threadId: th, body, mentions: [{ kind: "agent", id: agentId }], idempotencyKey: `${key}-p` });
      return waitFor(async () => {
        await d.hooks?.pump?.();
        const ms = (await api(who, "chat.messages.list", { threadId: th })).data.messages as Array<{ author?: { kind?: string }; body?: string }> | undefined;
        return ms?.find((m) => m.author?.kind === "agent" && (m.body ?? "") !== "")?.body ?? null;
      }, 25_000, () => hostLog(d));
    };
    assert.match(await ask("usr_mia", "list pages", "team-pg-a"), /NOTION_LIST_PAGES for space/);
    assert.match(await ask("usr_noah", "list pages", "team-pg-b"), /NOTION_LIST_PAGES for space/);

    // a revoked key reads as one plain sentence: no key, no stack
    state.revoked = true;
    const dead = await ask("usr_mia", "list channels", "team-dead");
    assert.match(dead, /^FAILED/);
    assert.ok(!dead.includes(HUB_KEY));
    assert.ok(!/\n\s+at /.test(dead), "no stack");

    // the admins get one item, however many calls fail; it closes when a call works again
    await ask("usr_noah", "list channels", "team-dead2");
    const mine = async () => ((await api("usr_olivia", "tasks.list", { scope: "all", kinds: ["unblock"], states: ["todo", "doing"] })).data.tasks as Array<{ title: string; summary?: string; assigned: { kind: string; id: string }; workingNotes: Record<string, string>; createdBy: string }>).filter((t) => /Composio key/.test(t.title));
    const items = await mine();
    assert.equal(items.length, 1, JSON.stringify(items));
    assert.equal(items[0]!.title, "Replace the Composio key");
    assert.deepEqual(items[0]!.assigned, { kind: "role", id: "admin" });
    assert.ok(!JSON.stringify(items).includes(HUB_KEY));
    assert.equal(items[0]!.createdBy, "svc_host", "made by the host, not by the member whose call failed");
    assert.deepEqual([items[0]!.workingNotes["origin"], items[0]!.workingNotes["fix"], items[0]!.workingNotes["hub"]], ["Composio", "replace_key", "composio"]);
    state.revoked = false;
    assert.match(await ask("usr_noah", "list channels", "team-back"), /^GOT/);
    assert.equal((await mine()).length, 0, "the item closed when another member's call worked: the host closes it, not the person whose call failed");
  } catch (e) { console.error("FAILED:", e instanceof Error ? e.message.slice(0, 1800) : e); throw e; } finally { await stop(d); await hub.close(); }
});
