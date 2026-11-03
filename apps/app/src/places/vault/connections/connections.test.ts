// Vault > Connections, the parts with no screen: the one list from three sources (MCP connections, plugin servers, built-in integrations) in Mine and Space, the words on each row, the Settings and
// Console summary, the links that open the page, and what Add does: keys into the Vault (a Mine folder or a Shared one), handles into env or a header (never the command), then a check.
import test from "node:test";
import assert from "node:assert/strict";
import { agoWords, assemble, dotColor, healthFromTest, healthWords, itemName, noteOf, shareWords, summaryWords } from "./model.ts";
import type { Account, Home } from "./model.ts";
import { addFromPlan, check, fileKeys } from "./actions.ts";
import { connectionsRoute, connectionsTarget } from "./links.ts";
import { parseAddress, parseConfig } from "../../../../../../lib/mcp-import.ts";
import { OFFICIAL, planEntry } from "../../../../../../lib/mcp-registry.ts";

const NOW = 1_793_700_000_000;
const row = (o: Partial<Home["mine"][number]>): Home["mine"][number] => ({
  key: "notion", kind: "mcp", name: "notion", title: "Notion", scope: "mine", connectionId: "mcs_1", share: [], transport: "http", address: "https://mcp.notion.com/mcp", source: "registry", enabled: true,
  health: "ok", usedBy: [], keys: [], needs: [], canManage: true, ...o,
});
const HOME: Home = {
  mine: [row({}), row({ key: "gh", name: "gh", title: "GitHub", connectionId: "mcs_2", health: "key_refused", usedBy: ["agt_a", "agt_b", "agt_c"], usedAt: NOW - 5 * 60_000 })],
  space: [row({ key: "docs", name: "docs", title: "Docs", scope: "space", connectionId: "mcs_3", share: ["grp_legal"], canManage: false }), row({ key: "deploy-tools/api", kind: "plugin", name: "api", title: "api", scope: "space", connectionId: undefined as never, pluginId: "plg_1", source: "plugin", sourceRef: "deploy-tools", health: "needs_setup", needs: ["API_KEY"] })],
  agents: [], policy: { spaceAdders: "managers", allowListOn: false, allowList: [] }, canAddSpace: true, admin: true,
};
const ACCOUNTS: Account[] = [
  { connectionId: "con_g", connector: "google", title: "", owner: { kind: "person", id: "usr_dana" }, state: "active", scopes: [], createdAt: 1, handles: ["#Google"], filled: [] },
  { connectionId: "con_s", connector: "slack", title: "Team Slack", owner: { kind: "space", id: "spc_x" }, state: "needs_reconnect", scopes: [], createdAt: 1, handles: [], filled: [] },
  { connectionId: "con_m", connector: "zoom", title: "Maya's Zoom", owner: { kind: "person", id: "usr_maya" }, state: "active", scopes: [], createdAt: 1, handles: [], filled: [] },
];

test("one list: MCP servers, plugin servers and built-in integrations, in Mine and Space, what needs a look first", () => {
  const a = assemble(HOME, ACCOUNTS, [{ key: "google", title: "Google Workspace" } as never, { key: "slack", title: "Slack" } as never], "usr_dana", (g) => (g === "grp_legal" ? "Legal" : g), (id) => ({ agt_a: "Scout", agt_b: "Ivy", agt_c: "Rex" })[id] ?? id);
  assert.deepEqual(a.mine.map((r) => [r.title, r.kind, r.health]), [["GitHub", "mcp", "key_refused"], ["Google Workspace", "app", "ok"], ["Notion", "mcp", "ok"]]);
  assert.ok(!a.mine.some((r) => r.title === "Maya's Zoom"), "someone else's own integration is not listed");
  assert.deepEqual(a.space.map((r) => [r.title, r.who, r.health]), [["api", "Everyone", "needs_setup"], ["Team Slack", "Everyone", "needs_signin"], ["Docs", "Legal", "ok"]]);
  assert.equal(a.space[0]!.what, "From plugin deploy-tools");
  const gh = a.mine[0]!;
  assert.equal(noteOf(gh, NOW, (id) => ({ agt_a: "Scout", agt_b: "Ivy" })[id] ?? id), "MCP server · You and your agents · Scout, Ivy and 1 more · Used 5 min ago");
  assert.deepEqual(summaryWords(a), { line: "6 connections, 3 need a look", needsYou: 3, total: 6 });
  assert.deepEqual(summaryWords(assemble(null, [], [], "usr_dana", String, String)), { line: "None yet", needsYou: 0, total: 0 });
});

test("the words and the dot: steady colours, plain health, when it was used, who can use it", () => {
  assert.equal(dotColor("ok"), "var(--ok)");
  assert.equal(dotColor("needs_signin"), "var(--warn)");
  assert.equal(dotColor("not_answering"), "var(--danger)");
  assert.equal(dotColor("off"), "var(--ink-4)");
  assert.equal(healthWords("ok", 1), "Working, 1 tool");
  assert.equal(healthWords("ok", 12), "Working, 12 tools");
  assert.equal(healthWords("unknown"), "Not checked yet");
  assert.equal(agoWords(undefined, NOW), "Never used");
  assert.equal(agoWords(NOW - 2 * 3_600_000, NOW), "Used 2 h ago");
  assert.equal(shareWords(["everyone"], String), "Everyone");
  assert.equal(shareWords(["grp_a", "grp_b", "grp_c"], (g) => g.slice(4).toUpperCase()), "A, B and 1 more");
  assert.deepEqual(healthFromTest({ ok: false, error: "x did not answer: The server answered 401: nope", tools: [] }, false), { health: "key_refused", note: "x did not answer: The server answered 401: nope" });
  assert.equal(healthFromTest({ ok: false, error: "The server answered 401", tools: [] }, true).health, "needs_signin");
  assert.equal(healthFromTest(undefined, false).health, "unknown");
  assert.equal(itemName("notion-official", "key"), "Notion_official_key");
});

test("Settings, the Console and the sidebar open Vault > Connections, and the address comes back as the page", () => {
  assert.deepEqual(connectionsTarget(), { screen: "vault.layout", args: { connections: "true" } });
  assert.deepEqual(connectionsRoute(connectionsTarget().args), { surface: "connections" });
  assert.deepEqual(connectionsRoute(connectionsTarget(true).args), { surface: "connections", add: true });
  assert.equal(connectionsRoute({ advanced: "true" }), null);
});

/** A fake Space: the calls Add makes, recorded; folders and items in memory; the engine answers per server. */
function space(o: { folders?: Array<{ id: string; scope: string }>; tools?: Record<string, { ok: boolean; error?: string; tools: unknown[] }> } = {}) {
  const calls: Array<{ cap: string; input: any }> = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
  const folders = [...(o.folders ?? [])];
  const call = async (cap: string, input: any): Promise<unknown> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    calls.push({ cap, input });
    if (cap === "vault.folders.list") return { folders };
    if (cap === "vault.folders.create") { const f = { id: `vfd_${folders.length + 1}`, scope: input.scope }; folders.push(f); return { folder: f }; }
    if (cap === "vault.item.put") return { item: { handle: `#${input.name}` } };
    if (cap === "plugins.connection.add_mine" || cap === "plugins.connection.add") return { connection: { connectionId: "mcs_new", name: input.name } };
    if (cap === "plugins.connection.update") return { connectionId: input.connectionId };
    if (cap === "engine.mcp.tools") { const r = o.tools?.[input.server]; return { servers: r ? [{ key: input.server, ...r }] : [] }; }
    throw new Error(`unexpected ${cap}`);
  };
  return { call, calls, folders };
}

test("adding from the registry: the key goes into my own Vault folder and the connection holds its handle in a header, then it is checked", async () => {
  const fx = space({ folders: [{ id: "vfd_shared", scope: "shared" }, { id: "vfd_mine", scope: "mine" }], tools: { "smithery-notion": { ok: true, tools: [1, 2, 3] } } });
  const page = OFFICIAL.parse({ servers: [{ server: { name: "ai.smithery/smithery-notion", version: "1.0.0", remotes: [{ type: "streamable-http", url: "https://server.smithery.ai/@smithery/notion/mcp", headers: [{ name: "Authorization", value: "Bearer {smithery_api_key}", isSecret: true, isRequired: true }] }] } }] });
  const plan = planEntry(page.entries[0]!);
  const draft = { name: plan.name, url: plan.url!, transport: "http" as const, args: [], env: {}, headers: {}, secrets: [], needs: [{ key: "Authorization", into: "header" as const, secret: true, prefix: "Bearer " }] };
  const added = await addFromPlan(fx.call, { scope: "mine", name: plan.name, title: plan.title, draft, typed: { Authorization: "smy_live_FAKE0123456789abcdef" }, oauth: false, source: "registry", sourceRef: "ai.smithery/smithery-notion" }, "agt_assistant");
  assert.deepEqual([added.health, added.tools], ["ok", 3]);
  const put = fx.calls.find((c) => c.cap === "vault.item.put")!;
  assert.equal(put.input.folderId, "vfd_mine", "a Mine connection's key goes into the person's own folder");
  assert.deepEqual(put.input.fields, [{ key: "Authorization", value: "smy_live_FAKE0123456789abcdef", secret: true }]);
  const add = fx.calls.find((c) => c.cap === "plugins.connection.add_mine")!;
  assert.deepEqual(add.input.headers, { Authorization: "Bearer #Smithery_notion_key.Authorization" });
  assert.equal(add.input.source, "registry");
  assert.ok(!JSON.stringify(add.input).includes("smy_live"), "the connection never holds the key");
  assert.deepEqual(fx.calls.find((c) => c.cap === "engine.mcp.tools")!.input, { agentId: "agt_assistant", server: "smithery-notion" });
});

test("a pasted command: the key in front of it goes into a Shared folder for a Space connection, the command keeps no key", async () => {
  const fx = space({ folders: [{ id: "vfd_mine", scope: "mine" }], tools: { github: { ok: true, tools: [1] } } });
  const d = parseAddress("GITHUB_PERSONAL_ACCESS_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789 npx -y @modelcontextprotocol/server-github")![0]!; // secret-scan: fake
  await addFromPlan(fx.call, { scope: "space", name: d.name, draft: d, typed: {}, oauth: false, source: "paste", share: ["everyone"] }, "agt_assistant");
  const created = fx.calls.find((c) => c.cap === "vault.folders.create")!;
  assert.deepEqual([created.input.scope, created.input.name], ["shared", "Connections"], "the Space had no Shared folder, so one is made");
  const add = fx.calls.find((c) => c.cap === "plugins.connection.add")!;
  assert.deepEqual([add.input.scope, add.input.command, add.input.args, add.input.env], ["space", "npx", ["-y", "@modelcontextprotocol/server-github"], { GITHUB_PERSONAL_ACCESS_TOKEN: "#Github_key.GITHUB_PERSONAL_ACCESS_TOKEN" }]);
  assert.ok(!JSON.stringify(add.input).includes("ghp_"));
});

test("an imported remote with no key that answers 401 becomes a sign-in; a config's ${VAR} is asked for", async () => {
  const fx = space({ tools: { linear: { ok: false, error: "linear did not answer: The server answered 401: {}", tools: [] } } });
  const cfg = parseConfig(JSON.stringify({ mcpServers: { linear: { type: "http", url: "https://mcp.linear.app/mcp" }, github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" } } } }));
  const linear = await addFromPlan(fx.call, { scope: "mine", name: "linear", draft: cfg.drafts[0]!, typed: {}, oauth: false, source: "import", sourceRef: ".mcp.json" }, "agt_assistant");
  assert.equal(linear.health, "needs_signin");
  assert.deepEqual(fx.calls.find((c) => c.cap === "plugins.connection.update")!.input.auth, "oauth");
  const gh = cfg.drafts[1]!;
  assert.deepEqual(gh.needs, [{ key: "GITHUB_TOKEN", into: "env", secret: true }]);
  await addFromPlan(fx.call, { scope: "mine", name: "github", draft: gh, typed: { GITHUB_TOKEN: "ghp_typedVALUE0123456789abcdefghijklmn" }, oauth: false, source: "import" }, "agt_assistant");
  const add = fx.calls.filter((c) => c.cap === "plugins.connection.add_mine").pop()!;
  assert.deepEqual(add.input.env, { GITHUB_TOKEN: "#Github_key.GITHUB_TOKEN" });
  assert.equal((await check(fx.call, { key: "nothing", oauth: false }, undefined)).health, "unknown", "no assistant, no check");
  assert.deepEqual(await fileKeys(fx.call, "mine", "x", []), {}, "no keys, no Vault item");
});
