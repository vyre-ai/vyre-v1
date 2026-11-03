// Vault > Connections on a booted daemon (owner rulings D28 and D29): the catalog comes from the official MCP registry (a recorded page, through the plugins host seam), Olivia adds one server
// as hers with its key in her own Vault folder, the admin adds one for the whole Space, and the engine's check records each one's health and tools. A member's agent reaches the Space one and
// not Olivia's; Olivia's own call reaches both. A group share reaches the group's members only. The key never appears in the log, in an event, in the list or in a command line. Only fake MCP servers on this machine are reached.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createGuardedFetch } from "../lib/net-guard.ts";
import { CORE_SPACE } from "../fixtures/seed/core/index.ts";
import { OFFICIAL, planEntry, headerValue } from "../lib/mcp-registry.ts";
import { boot, connect, hostLog, scriptedModel, seededDir, stop } from "./support/eco-live.ts";

const RECORDED = readFileSync(new URL("../modules/agents/tests/fixtures/mcp-registry-notion.json", import.meta.url), "utf8");
const KEY = "smy_live_FAKEkeyFOR0connections0123456789"; // secret-scan: fake
const WHO = ["usr_olivia", "usr_noah", "usr_sana"];

function fakeMcp(name: string, needKey: string | null): Promise<{ port: number; close(): Promise<void>; calls: number }> {
  const box = { calls: 0 };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += String(c); });
    req.on("end", () => {
      if (needKey !== null && req.headers["authorization"] !== `Bearer ${needKey}`) { res.writeHead(401, { "content-type": "application/json" }); res.end('{"error":"bad key"}'); return; }
      const m = JSON.parse(body) as { id?: number; method: string };
      box.calls++;
      const reply = (result: unknown): void => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ jsonrpc: "2.0", id: m.id, result })); };
      if (m.method === "initialize") reply({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name, version: "1" } });
      else if (m.method === "tools/list") reply({ tools: [{ name: "search", description: "Search pages.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } }, { name: "fetch", description: "Read a page.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } }] });
      else { res.writeHead(202); res.end(); }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ port: (server.address() as { port: number }).port, get calls() { return box.calls; }, close: () => new Promise<void>((r) => server.close(() => r())) })));
}

test("a registry server as Mine, a Space one for everyone: health is recorded, a member's agent reaches only the Space one, and the key stays in the Vault", async () => {
  const smithery = await fakeMcp("smithery-notion", KEY);
  const pipe = await fakeMcp("insightful-notion", null);
  const guarded = createGuardedFetch({ own: true });
  const mcpFetch = (url: string, init: Parameters<typeof guarded>[1]) => guarded(
    url.replace("https://server.smithery.ai", `http://127.0.0.1:${smithery.port}`).replace("https://notion.insightfulmcp.com", `http://127.0.0.1:${pipe.port}`), init,
  );
  const registryAsked: string[] = [];
  const seamFetch = async (url: string) => {
    if (url.startsWith("https://registry.modelcontextprotocol.io/")) { registryAsked.push(url); return { status: 200, text: async () => RECORDED, arrayBuffer: async () => new TextEncoder().encode(RECORDED).buffer }; }
    return { status: 404, text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) };
  };
  const dir = seededDir();
  const ownerToken = { v: "" };
  const d = await boot(dir, scriptedModel(async function* () { yield { type: "text", text: "unused" }; }), {
    // the real Vault (eco-live's stand-in answers one fixed key for every handle)
    mcpFetch, vault: undefined, seams: { fetch: seamFetch },
    session: (headers: Record<string, string | undefined>) => {
      const t = String(headers["authorization"] ?? "").replace(/^Bearer /, "");
      const id = t === ownerToken.v ? "usr_olivia" : t;
      return WHO.includes(id) ? { space: CORE_SPACE, principal: { kind: "person" as const, id }, device: "conn-home" } : null;
    },
  });
  ownerToken.v = d.token;
  const api = async (who: string, cap: string, input: unknown): Promise<{ status: number; data: any }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${who}` }, body: JSON.stringify(input) });
    const b = (await r.json()) as { data?: unknown };
    return { status: r.status, data: b.data ?? b };
  };
  const ok = async (who: string, cap: string, input: unknown): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await api(who, cap, input);
    assert.equal(r.status, 200, `${cap}: ${r.status} ${JSON.stringify(r.data).slice(0, 600)}`);
    return r.data;
  };
  try {
    const mineFolder = await connect(d);
    const agentId = (await ok("usr_olivia", "agents.create", { name: "Notes", role: "You find notes.", idempotencyKey: "ch-agent" })).agent.agentId as string;

    // the catalog, through the host seam
    const found = await ok("usr_noah", "plugins.registry.search", { q: "notion" });
    assert.equal(found.offline, false);
    assert.equal(found.entries.length, OFFICIAL.parse(JSON.parse(RECORDED)).entries.length);
    assert.equal(registryAsked.length, 1);
    assert.match(registryAsked[0]!, /search=notion/);

    // Olivia adds Smithery's Notion as hers: the key goes into her own Vault folder, the connection keeps the handle in its header
    const smith = planEntry(found.entries.find((e: { name: string }) => e.name === "ai.smithery/smithery-notion"));
    await ok("usr_olivia", "vault.item.put", { idempotencyKey: "ch-key", folderId: mineFolder, name: "Smithery_notion", kind: "api_key", fields: [{ key: "value", value: KEY, secret: true }] });
    const header = headerValue(smith.asks[0]!.value, "#Smithery_notion.value");
    const mine = await ok("usr_olivia", "plugins.connection.add_mine", { idempotencyKey: "ch-mine", name: smith.name, title: smith.title, url: smith.url, headers: { Authorization: header }, source: "registry", sourceRef: "ai.smithery/smithery-notion" });
    // the admin adds a keyless one for the whole Space
    const pipeEntry = planEntry(found.entries.find((e: { name: string }) => e.name === "com.insightfulpipe/notion"));
    const space = await ok("usr_olivia", "plugins.connection.add", { idempotencyKey: "ch-space", name: pipeEntry.name, title: pipeEntry.title, scope: "space", url: pipeEntry.url, source: "registry", sourceRef: "com.insightfulpipe/notion" });

    // Olivia owns the Space: she may add for everyone and sets the rules; Noah is a member: neither
    const olHome0 = await ok("usr_olivia", "plugins.connections.home", {});
    assert.deepEqual([olHome0.admin, olHome0.canAddSpace, olHome0.space.find((r: { key: string }) => r.key === pipeEntry.name)?.canManage], [true, true, true]);
    const noahHome0 = await ok("usr_noah", "plugins.connections.home", {});
    assert.deepEqual([noahHome0.admin, noahHome0.canAddSpace], [false, false]);
    // Noah cannot add one for everyone, and her own one is hers alone
    assert.equal((await api("usr_noah", "plugins.connection.add", { idempotencyKey: "ch-noah-space", name: "noah-space", scope: "space", url: "https://notion.insightfulmcp.com/x" })).status, 403);
    await ok("usr_noah", "plugins.connection.add_mine", { idempotencyKey: "ch-noah-mine", name: "noah-notes", url: "https://notion.insightfulmcp.com/noah" });
    assert.ok(!(await ok("usr_olivia", "plugins.connections.home", {})).mine.some((r: { key: string }) => r.key === "noah-notes"), "Olivia never sees Noah's own");

    // Noah's agent: the Space server only (and Noah's own when Noah asks)
    const noahTools = await ok("usr_noah", "engine.mcp.tools", { agentId });
    assert.deepEqual(noahTools.servers.map((s: { key: string }) => s.key).sort(), ["noah-notes", pipeEntry.name].sort(), JSON.stringify(noahTools));
    assert.ok(noahTools.servers.every((s: { ok: boolean }) => s.ok));
    const noahHome = await ok("usr_noah", "plugins.connections.home", {});
    assert.deepEqual([noahHome.mine.map((r: { key: string }) => r.key), noahHome.space.map((r: { key: string }) => r.key)], [["noah-notes"], [pipeEntry.name]], "Noah never sees Olivia's own");
    // shared with a group: Noah is in the Lead team, Sana is not
    const leads = await ok("usr_olivia", "plugins.connection.add", { idempotencyKey: "ch-leads", name: "leads-notes", scope: "space", url: "https://notion.insightfulmcp.com/leads", share: ["grp_leads"] });
    assert.deepEqual(leads.connection.share, ["grp_leads"]);
    assert.ok((await ok("usr_noah", "engine.mcp.tools", { agentId })).servers.some((s: { key: string }) => s.key === "leads-notes"), "a member of the group reaches it");
    const sana = await ok("usr_sana", "engine.mcp.tools", { agentId });
    assert.ok(!sana.servers.some((s: { key: string }) => s.key === "leads-notes"), "someone outside the group does not");
    assert.ok(!(await ok("usr_sana", "plugins.connections.home", {})).space.some((r: { key: string }) => r.key === "leads-notes"));
    await ok("usr_olivia", "plugins.connection.forget", { idempotencyKey: "ch-leads-x", connectionId: leads.connection.connectionId });

    // Olivia: both, the key filled from her Vault at the last moment
    const olTools = await ok("usr_olivia", "engine.mcp.tools", { agentId });
    assert.deepEqual(olTools.servers.map((s: { key: string; ok: boolean }) => [s.key, s.ok]).sort(), [[pipeEntry.name, true], [smith.name, true]].sort(), JSON.stringify(olTools), "Olivia's turn never reaches Noah's own");
    assert.ok(smithery.calls > 0, "the server was reached with the key");

    // the engine's check is the health on the Vault page: green, with its tools
    const home = await ok("usr_olivia", "plugins.connections.home", {});
    const mineRow = home.mine.find((r: { connectionId: string }) => r.connectionId === mine.connection.connectionId);
    const spaceRow = home.space.find((r: { connectionId: string }) => r.connectionId === space.connection.connectionId);
    assert.deepEqual([mineRow.health, mineRow.tools, mineRow.source, mineRow.keys], ["ok", 2, "registry", ["#Smithery_notion.value"]], JSON.stringify(mineRow));
    assert.deepEqual([spaceRow.health, spaceRow.tools, spaceRow.share], ["ok", 2, ["everyone"]]);

    // a refused key reads as Key refused, in a sentence with no key in it
    await ok("usr_olivia", "vault.item.put", { idempotencyKey: "ch-key2", folderId: mineFolder, name: "Smithery_wrong", kind: "api_key", fields: [{ key: "value", value: "wrong-key-value-that-the-server-refuses", secret: true }] });
    const wrong = await ok("usr_olivia", "plugins.connection.add_mine", { idempotencyKey: "ch-wrong", name: "smithery-wrong", url: smith.url, headers: { Authorization: "Bearer #Smithery_wrong.value" } });
    await ok("usr_olivia", "engine.mcp.tools", { agentId, server: "smithery-wrong" });
    const after = (await ok("usr_olivia", "plugins.connections.home", {})).mine.find((r: { connectionId: string }) => r.connectionId === wrong.connection.connectionId);
    assert.equal(after.health, "key_refused", JSON.stringify(after));

    // the key is nowhere but the Vault: not in the list, the events, the log or a command line
    const everything = JSON.stringify([home, olTools, noahTools, await ok("usr_olivia", "plugins.connections.list", {})]);
    assert.ok(!everything.includes(KEY));
    d.sink.flush();
    const logs = JSON.stringify(new DatabaseSync(d.paths.logs, { readOnly: true }).prepare("SELECT msg, attrs FROM logs").all());
    assert.ok(!logs.includes(KEY), "no log line holds the key");
    const events = JSON.stringify(new DatabaseSync(`${dir}/events.db`, { readOnly: true }).prepare("SELECT * FROM events").all());
    assert.ok(!events.includes(KEY), "no event holds the key");
  } catch (e) { console.error("FAILED:", e instanceof Error ? e.message.slice(0, 1800) : e, hostLog(d)); throw e; } finally { await stop(d); await smithery.close(); await pipe.close(); }
});
