// An app hub on a booted daemon (rc.9): a Composio connection made from its template against a fake hub MCP server over http. The key is a Vault handle in the header the template names; the
// connection says "composio"; the tools list with the badge; a read runs; a tool that does not say it only reads, and one that says it changes things, are held at the Gate for an agent. Only a
// fake server is reached: no hub key exists here.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createGuardedFetch } from "../lib/net-guard.ts";
import { boot, call, connect, makeAgent, ok, post, scriptedModel, seededDir, startChat, stop, waitFor } from "./support/eco-live.ts";

const HUB_KEY = "cmp_live_FAKEhubKEY0123456789abcdef"; // secret-scan: fake
const HUB_URL = "https://backend.composio.dev/v3/mcp/srv_123/mcp";

interface Seen { method: string; tool?: string; key: string | undefined; user: string | null }

function fakeHub(seen: Seen[]): Promise<{ port: number; close(): Promise<void> }> {
  const tools = [
    { name: "SLACK_LIST_CHANNELS", description: "List the channels of the workspace.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
    { name: "SLACK_SEND_MESSAGE", description: "Send a message to a channel.", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
    { name: "NOTION_UPDATE_PAGE", description: "Change a page.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: false } },
  ];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += String(c); });
    req.on("end", () => {
      const key = req.headers["x-api-key"] as string | undefined;
      if (key !== HUB_KEY) { res.writeHead(401, { "content-type": "application/json" }); res.end('{"error":"bad key"}'); return; }
      const m = JSON.parse(body) as { id?: number; method: string; params?: { name?: string; arguments?: { text?: string } } };
      seen.push({ method: m.method, ...(m.params?.name ? { tool: m.params.name } : {}), key, user: new URL(req.url ?? "/", "http://x").searchParams.get("user_id") });
      const reply = (result: unknown): void => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ jsonrpc: "2.0", id: m.id, result })); };
      if (m.method === "initialize") reply({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-composio", version: "1" } });
      else if (m.method === "tools/list") reply({ tools });
      else if (m.method === "tools/call") reply({ content: [{ type: "text", text: m.params?.name === "SLACK_LIST_CHANNELS" ? "general, random" : `ran ${m.params?.name} ${m.params?.arguments?.text ?? ""}`.trim() }] });
      else { res.writeHead(202); res.end(); }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ port: (server.address() as { port: number }).port, close: () => new Promise<void>((r) => server.close(() => r())) })));
}

test("a Composio connection from its template: the key is a Vault handle, tools carry the badge, a read runs, changes wait at the Gate", async () => {
  const seen: Seen[] = [];
  const hub = await fakeHub(seen);
  const guarded = createGuardedFetch({ own: true });
  const mcpFetch = (url: string, init: Parameters<typeof guarded>[1]) => guarded(url.replace("https://backend.composio.dev", `http://127.0.0.1:${hub.port}`), init);
  const model = scriptedModel(async function* (input, run) {
    const ask = input.trigger?.body ?? "";
    if (/list channels/.test(ask)) { const r = yield* run("mcp__composio__SLACK_LIST_CHANNELS", {}); yield { type: "text", text: `READ ${r.ok ? JSON.stringify(r.content) : "FAILED"}` }; }
    else if (/send hello/.test(ask)) { const r = yield* run("mcp__composio__SLACK_SEND_MESSAGE", { text: "hello" }); yield { type: "text", text: `SENT ${r.ok ? "ok" : "failed"}` }; }
    else if (/update page/.test(ask)) { const r = yield* run("mcp__composio__NOTION_UPDATE_PAGE", {}); yield { type: "text", text: `UPDATED ${r.ok ? "ok" : "failed"}` }; }
  });
  const dir = seededDir();
  const d = await boot(dir, model, { mcpFetch, vault: undefined });
  try {
    const folder = await connect(d);
    const agentId = await makeAgent(d, "Ops");
    await ok(d, "vault.item.put", { idempotencyKey: "hub-key", folderId: folder, name: "Olivia_Composio", kind: "api_key", fields: [{ key: "api_key", value: HUB_KEY, secret: true }] });

    // the template's rules: the hub's own address, and the key as a Vault handle in the header it names
    const wrongUrl = await call(d, "plugins.connection.add", { idempotencyKey: "h0", name: "composio", scope: "space", url: "https://example.com/mcp", headers: { "x-api-key": "#Olivia_Composio.api_key" }, hub: "composio" });
    assert.equal(wrongUrl.status, 422);
    assert.match(JSON.stringify(wrongUrl.data), /Composio's own address/);
    const pasted = await call(d, "plugins.connection.add", { idempotencyKey: "h1", name: "composio", scope: "space", url: HUB_URL, headers: { "x-api-key": HUB_KEY }, hub: "composio" });
    assert.equal(pasted.status, 422, "a pasted key is refused: it must be a Vault handle");
    assert.ok(!JSON.stringify(pasted.data).includes(HUB_KEY));
    const made = (await ok(d, "plugins.connection.add", { idempotencyKey: "h2", name: "composio", scope: "space", url: HUB_URL, headers: { "x-api-key": "#Olivia_Composio.api_key" }, hub: "composio" })).connection;
    assert.equal(made.hub, "composio");
    assert.deepEqual((await ok(d, "plugins.connections.list", {})).connections.map((c: { hub?: string }) => c.hub), ["composio"]);

    // the tools list says where it runs; a tool that does not say it only reads counts as a change
    const server = (await ok(d, "engine.mcp.tools", { agentId })).servers.find((s: { key: string }) => s.key === "composio");
    assert.equal(server.hub, "composio");
    assert.equal(server.ok, true, JSON.stringify(server));
    assert.deepEqual(server.tools.map((t: { name: string; readOnly: boolean }) => [t.name, t.readOnly]), [["SLACK_LIST_CHANNELS", true], ["SLACK_SEND_MESSAGE", false], ["NOTION_UPDATE_PAGE", false]]);
    assert.ok(seen.every((s) => s.key === HUB_KEY), "the hub got the key the Vault holds");

    // a read runs without the Gate, and the key is not in what comes back
    const thread = await startChat(d, agentId, "hub1");
    const read = await post(d, thread, agentId, "list channels", "hub1a");
    assert.match(read, /^READ /);
    assert.match(read, /general, random/);
    assert.ok(!read.includes(HUB_KEY));

    // the hub is told whose sign-in this is: the Space for a Space tool, a hashed person for an app that acts as someone, never the person's own id
    const slackCall = seen.find((s) => s.tool === "SLACK_LIST_CHANNELS");
    assert.match(slackCall?.user ?? "", /^p_[0-9a-f]{32}$/);
    assert.ok(!JSON.stringify(seen).includes("usr_"), "no Vyre id reaches the hub");
    assert.ok(seen.filter((s) => s.method === "tools/list").every((s) => s.user === "space"));

    // a change is held for the agent; nothing reaches the hub until the person approves it
    for (const [ask, name, key] of [["send hello", "SLACK_SEND_MESSAGE", "hub1b"], ["update page", "NOTION_UPDATE_PAGE", "hub1c"]] as const) {
      const before = seen.filter((s) => s.tool === name).length;
      await ok(d, "chat.post", { threadId: thread, body: ask, mentions: [{ kind: "agent", id: agentId }], idempotencyKey: `${key}-post` });
      const hold = await waitFor(async () => {
        await d.hooks?.pump?.();
        const h = (await ok(d, "gate.holds.list", { states: ["held"] })).holds as Array<{ taskId: string; capName: string }>;
        return h.find((x) => x.capName === "engine.mcp.call") ?? null;
      }, 30_000);
      assert.equal(seen.filter((s) => s.tool === name).length, before, `${name} did not reach the hub while held`);
      const done = await call(d, "tasks.act", { taskId: hold.taskId, action: "approve" });
      assert.equal(done.status, 200, JSON.stringify(done.data));
      await waitFor(async () => { await d.hooks?.pump?.(); return seen.filter((s) => s.tool === name).length > before ? true : null; }, 30_000);
      const ran = seen.filter((s) => s.tool === name).at(-1);
      assert.equal(ran?.user === "space", name.startsWith("NOTION"), `${name} ran as ${ran?.user}`);
    }
  } catch (e) { console.error("FAILED:", e instanceof Error ? e.message.slice(0, 1500) : e); throw e; } finally { await stop(d); await hub.close(); }
});
