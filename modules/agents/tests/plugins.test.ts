// agents: plugins and outside tools (CHAT-DESIGN ruling 6) against a marketplace folder in the repo (fixtures/plugins/test-marketplace) read through the real host seam: add a marketplace,
// browse, install into the Space or one agent, and see each part land where it belongs. Nothing here runs plugin code.
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { handlers } from "../impl.ts";
import { setPluginsHost } from "../handlers/plugins.ts";
import { forgetFolderSkills } from "../handlers/skills.ts";
import { createPluginsHost } from "../../../host/src/seams/plugins.ts";
import { assertEventsConform, codeOf, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const MARKET = fileURLToPath(new URL("../../../fixtures/plugins/test-marketplace", import.meta.url));
const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
let n = 0;
const WRITES = /^(skills\.(add|remove|set_enabled)|plugins\.(marketplace\.|allow\.set|install|uninstall|set_enabled|config\.set|agent_template\.use|connection\.))/;
const call = async (hn: Harness, cap: string, input: Record<string, unknown> = {}, ctx: Harness["ctx"] = hn.ctx): Promise<any> => {
  const withKey = WRITES.test(cap) ? { idempotencyKey: `k${++n}`, ...input } : input;
  assert.deepEqual(contractErrors(cap, "in", withKey), [], `${cap}: input`);
  const out = await h[cap]!(ctx, withKey);
  assert.deepEqual(contractErrors(cap, "out", out), [], `${cap}: output`);
  return out;
};
const fail = async (p: Promise<unknown>): Promise<string> => p.then(() => "none", (e: unknown) => codeOf(e));

/** A harness whose neighbours are the module's own skills handlers, and a plugins host that reads the folder. */
function world() {
  setPluginsHost(createPluginsHost());
  forgetFolderSkills();
  const hn = harness();
  for (const cap of ["skills.add", "skills.remove", "skills.set_enabled", "skills.list"]) hn.world.answer(cap, (i: any, o) => h[cap]!(hn.ctx, { ...i, ...(o?.idempotencyKey ? { idempotencyKey: o.idempotencyKey } : {}) }));
  return hn;
}
async function market(hn: Harness): Promise<string> {
  const added = await call(hn, "plugins.marketplace.add", { source: MARKET });
  return added.marketplace.marketplaceId as string;
}
const names = (r: { skills: Array<{ name: string }> }) => r.skills.map((s) => s.name);

test("adding a marketplace reads marketplace.json, puts it on the allowlist and lists what it offers", async () => {
  const hn = world();
  const added = await call(hn, "plugins.marketplace.add", { source: MARKET });
  assert.deepEqual([added.marketplace.name, added.marketplace.kind, added.marketplace.plugins, added.marketplace.allowed, added.marketplace.owner], ["vyre-test-market", "local", 2, true, "Vyre tests"]);
  assert.equal(await fail(call(hn, "plugins.marketplace.add", { source: MARKET })), "validation.duplicate");
  const b = await call(hn, "plugins.browse", {});
  assert.deepEqual(b.plugins.map((p: any) => [p.name, p.allowed, p.installed.length, p.source]), [["greeter", true, 0, "path"], ["notes", true, 0, "path"]]);
  assert.deepEqual((await call(hn, "plugins.browse", { q: "one skill" })).plugins.map((p: any) => p.name), ["notes"]);
  assert.deepEqual((await call(hn, "plugins.allow.list")).allowed.map((a: any) => [a.kind, a.marketplace]), [["marketplace", "vyre-test-market"]]);
  assert.deepEqual(assertEventsConform(hn), []);
  assert.equal(await fail(call(hn, "plugins.marketplace.add", { source: "not a source" })), "validation.bad_input");
  assert.equal(await fail(call(hn, "plugins.marketplace.add", { source: "/nonexistent/folder/here" })), "provider.unavailable");
});

test("install into the Space: the skill is a Vyre skill, the command a / command, the sub-agent a template, the MCP server and hook are described for the sandbox", async () => {
  const hn = world();
  const m = await market(hn);
  const r = await call(hn, "plugins.install", { marketplaceId: m, plugin: "greeter", scope: "space" });
  const p = r.plugin;
  assert.deepEqual(p.parts, { skills: ["greeting"], commands: ["hello"], agents: ["helper"], hooks: 1, mcpServers: ["echo"] });
  assert.deepEqual([p.scope, p.enabled, p.configured, p.version], ["space", true, true, "1.0.0"], "the secret option is optional, so the plugin counts as configured");
  assert.deepEqual(p.userConfig.map((u: any) => [u.key, u.sensitive]), [["echo_token", true]]);

  // skills
  const skills = (await call(hn, "skills.list", {})).skills.find((s: any) => s.name === "greeter:greeting");
  assert.deepEqual([skills.tier, skills.source], ["space", "plugin:greeter"]);
  assert.match((await call(hn, "skills.load", { name: "greeter:greeting" })).skill.body, /Never use the word/);

  // commands
  assert.deepEqual((await call(hn, "plugins.commands.list", {})).commands.map((c: any) => [c.name, c.argumentHint]), [["greeter:hello", "[name]"]]);
  const rendered = await call(hn, "plugins.command.render", { name: "greeter:hello", args: "Dana" });
  assert.equal(rendered.prompt, "Greet Dana warmly, in one sentence, following the greeting skill.\n");
  assert.equal(rendered.pluginId, p.pluginId);
  assert.equal(await fail(call(hn, "plugins.command.render", { name: "greeter:nope" })), "validation.not_found");

  // sub-agents
  assert.deepEqual((await call(hn, "plugins.agent_templates.list")).templates.map((t: any) => [t.plugin, t.name, t.tools]), [["greeter", "helper", ["Read", "Grep"]]]);

  // MCP servers: the secret is a handle once set, and the server waits until it is
  let servers = (await call(hn, "plugins.mcp.servers", {})).servers;
  assert.deepEqual(servers.map((s: any) => [s.key, s.from, s.transport, s.needs, s.command, s.args]), [["greeter/echo", "plugin", "stdio", ["echo_token"], "node", ["${CLAUDE_PLUGIN_ROOT}/server.mjs"]]]);
  assert.equal(await fail(call(hn, "plugins.config.set", { pluginId: p.pluginId, config: { echo_token: "plain-secret-value" } })), "validation.bad_input");
  assert.equal(await fail(call(hn, "plugins.config.set", { pluginId: p.pluginId, config: { nothing: "x" } })), "validation.bad_input");
  const cfg = await call(hn, "plugins.config.set", { pluginId: p.pluginId, config: { echo_token: "#Dana_Echo.token" } });
  assert.deepEqual([cfg.plugin.configured, cfg.plugin.config], [true, { echo_token: "#Dana_Echo.token" }]);
  servers = (await call(hn, "plugins.mcp.servers", {})).servers;
  assert.deepEqual([servers[0].needs, servers[0].env, servers[0].files], [[], { ECHO_TOKEN: "#Dana_Echo.token" }, p.pluginId]);
  assert.ok(!JSON.stringify(hn.rows("SELECT * FROM agents_plugins")).includes("plain-secret-value"));

  // hooks
  const hooks = (await call(hn, "plugins.hooks.list", {})).hooks;
  assert.deepEqual(hooks.map((x: any) => [x.plugin, x.event, x.matcher, x.command, x.timeoutSec]), [["greeter", "PostToolUse", "*", "node ${CLAUDE_PLUGIN_ROOT}/hooks/after-tool.mjs", 10]]);

  assert.deepEqual(hn.named("plugin.installed").map((e) => e.payload["name"]), ["greeter"]);
  assert.deepEqual(assertEventsConform(hn), []);
  assert.equal(await fail(call(hn, "plugins.install", { marketplaceId: m, plugin: "greeter", scope: "space" })), "validation.duplicate");
  assert.equal(await fail(call(hn, "plugins.install", { marketplaceId: m, plugin: "nope", scope: "space" })), "validation.not_found");
});

test("turning a plugin off hides its skill, command, server and hook; uninstalling removes the skill", async () => {
  const hn = world();
  const m = await market(hn);
  const { plugin } = await call(hn, "plugins.install", { marketplaceId: m, plugin: "greeter", scope: "space" });
  await call(hn, "plugins.set_enabled", { pluginId: plugin.pluginId, enabled: false });
  assert.ok(!names(await call(hn, "skills.list", {})).includes("greeter:greeting"));
  assert.deepEqual([(await call(hn, "plugins.commands.list", {})).commands.length, (await call(hn, "plugins.mcp.servers", {})).servers.length, (await call(hn, "plugins.hooks.list", {})).hooks.length], [0, 0, 0]);
  await call(hn, "plugins.set_enabled", { pluginId: plugin.pluginId, enabled: true });
  assert.ok(names(await call(hn, "skills.list", {})).includes("greeter:greeting"));
  assert.equal((await call(hn, "plugins.uninstall", { pluginId: plugin.pluginId })).removed, true);
  assert.ok(!names(await call(hn, "skills.list", {})).includes("greeter:greeting"));
  assert.equal((await call(hn, "plugins.list", {})).plugins.length, 0);
  assert.equal((await call(hn, "plugins.uninstall", { pluginId: plugin.pluginId })).removed, false);
});

test("the allowlist: a plugin that is not allowed cannot be installed; one plugin can be allowed on its own; removing the marketplace takes its allow with it", async () => {
  const hn = world();
  const m = await market(hn);
  await call(hn, "plugins.allow.set", { kind: "marketplace", marketplace: "vyre-test-market", allowed: false });
  assert.equal(await fail(call(hn, "plugins.install", { marketplaceId: m, plugin: "notes", scope: "space" })), "validation.precondition_failed");
  assert.equal((await call(hn, "plugins.browse", {})).plugins.every((p: any) => p.allowed === false), true);
  await call(hn, "plugins.allow.set", { kind: "plugin", marketplace: "vyre-test-market", plugin: "notes", allowed: true });
  const ok = await call(hn, "plugins.install", { marketplaceId: m, plugin: "notes", scope: "space" });
  assert.deepEqual(ok.plugin.parts.skills, ["notes"]);
  assert.equal(await fail(call(hn, "plugins.install", { marketplaceId: m, plugin: "greeter", scope: "space" })), "validation.precondition_failed");
  assert.equal(await fail(call(hn, "plugins.allow.set", { kind: "plugin", marketplace: "vyre-test-market", allowed: true })), "validation.bad_input");
  assert.equal((await call(hn, "plugins.marketplace.remove", { marketplaceId: m })).removed, true);
  assert.deepEqual((await call(hn, "plugins.allow.list")).allowed, []);
  assert.equal((await call(hn, "plugins.list", {})).plugins.length, 1, "what was installed stays");
});

test("a plugin put in one agent is that agent's alone, and the Space install needs the admin permission", async () => {
  const hn = world();
  const m = await market(hn);
  const a = (await call(hn, "agents.create", { name: "Greeter bot", role: "Greets.", idempotencyKey: "ag1" })).agent.agentId as string;
  const b = (await call(hn, "agents.create", { name: "Other bot", role: "Other.", idempotencyKey: "ag2" })).agent.agentId as string;
  assert.equal(await fail(call(hn, "plugins.install", { marketplaceId: m, plugin: "notes", scope: "agent" })), "validation.bad_input");
  const got = await call(hn, "plugins.install", { marketplaceId: m, plugin: "greeter", scope: "agent", agentId: a });
  assert.equal(got.plugin.agentId, a);
  assert.ok(names(await call(hn, "skills.list", { agentId: a })).includes("greeter:greeting"));
  assert.ok(!names(await call(hn, "skills.list", { agentId: b })).includes("greeter:greeting"));
  assert.ok(!names(await call(hn, "skills.list", {})).includes("greeter:greeting"));
  assert.equal((await call(hn, "plugins.commands.list", { agentId: a })).commands.length, 1);
  assert.equal((await call(hn, "plugins.commands.list", { agentId: b })).commands.length, 0);
  assert.equal((await call(hn, "plugins.mcp.servers", { agentId: a })).servers.length, 1);
  assert.equal((await call(hn, "plugins.mcp.servers", { agentId: b })).servers.length, 0);
  assert.deepEqual((await call(hn, "plugins.list", { agentId: b })).plugins, []);
  assert.equal((await call(hn, "plugins.list", { agentId: a })).plugins.length, 1);
  // the same plugin can also be in the Space; a member without the admin permission cannot do that
  hn.allowOnly((action) => action.perm !== "kits.install");
  assert.equal(await fail(call(hn, "plugins.install", { marketplaceId: m, plugin: "greeter", scope: "space" })), "permission.role_lacks_permission");
});

test("a sub-agent becomes an agent: the description is the role line and the prompt is in AGENT.md", async () => {
  const hn = world();
  const m = await market(hn);
  const { plugin } = await call(hn, "plugins.install", { marketplaceId: m, plugin: "greeter", scope: "space" });
  const made = await call(hn, "plugins.agent_template.use", { pluginId: plugin.pluginId, name: "helper", agentName: "Welcome desk" });
  const rec = hn.rows("SELECT * FROM agents_agent WHERE id = ?", made.agentId)[0]!;
  assert.equal(rec["name"], "Welcome desk");
  const md = hn.world.text(String(rec["agentMdFileId"]));
  assert.match(md, /Welcomes new people and answers where things are/);
  assert.match(md, /You welcome new people to the Space/);
  assert.match(md, /From the greeter plugin/);
  assert.equal(await fail(call(hn, "plugins.agent_template.use", { pluginId: plugin.pluginId, name: "ghost" })), "validation.not_found");
});

test("an MCP server by URL or by command: a credential must be a Vault handle, one of url and command, and it shows in the servers an agent connects to", async () => {
  const hn = world();
  const a = (await call(hn, "agents.create", { name: "Crm bot", role: "Crm.", idempotencyKey: "ag3" })).agent.agentId as string;
  assert.equal(await fail(call(hn, "plugins.connection.add", { name: "crm", scope: "space", url: "https://crm.example.com/mcp", headers: { Authorization: "Bearer sk-live-123" } })), "validation.bad_input");
  assert.equal(await fail(call(hn, "plugins.connection.add", { name: "crm", scope: "space" })), "validation.bad_input");
  assert.equal(await fail(call(hn, "plugins.connection.add", { name: "crm", scope: "space", url: "https://x.example.com", command: "node" })), "validation.bad_input");
  assert.equal(await fail(call(hn, "plugins.connection.add", { name: "crm", scope: "space", url: "ftp://x.example.com" })), "validation.bad_input");
  const added = await call(hn, "plugins.connection.add", { name: "crm", scope: "space", url: "https://crm.example.com/mcp", headers: { Authorization: "#Crm_Key.token" } });
  assert.deepEqual([added.connection.transport, added.connection.headers], ["http", { Authorization: "#Crm_Key.token" }]);
  const local = await call(hn, "plugins.connection.add", { name: "files", scope: "agent", agentId: a, command: "node", args: ["server.js"], env: { REGION: "eu" } });
  assert.equal(local.connection.transport, "stdio");
  assert.equal(await fail(call(hn, "plugins.connection.add", { name: "crm", scope: "space", url: "https://crm.example.com/mcp" })), "validation.duplicate");
  assert.deepEqual((await call(hn, "plugins.mcp.servers", {})).servers.map((s: any) => s.key), ["crm"]);
  assert.deepEqual((await call(hn, "plugins.mcp.servers", { agentId: a })).servers.map((s: any) => s.key).sort(), ["crm", "files"]);
  assert.equal((await call(hn, "plugins.connection.remove", { connectionId: added.connection.connectionId })).removed, true);
  assert.deepEqual((await call(hn, "plugins.mcp.servers", { agentId: a })).servers.map((s: any) => s.key), ["files"]);
  assert.deepEqual(assertEventsConform(hn), []);
});

test("a server that cannot fetch plugins says so, and a marketplace without marketplace.json is refused", async () => {
  const hn = harness();
  setPluginsHost(null);
  assert.equal(await fail(call(hn, "plugins.marketplace.add", { source: MARKET })), "provider.unavailable");
  setPluginsHost(createPluginsHost());
  assert.equal(await fail(call(hn, "plugins.marketplace.add", { source: `${MARKET}/plugins/greeter` })), "validation.bad_input");
});
