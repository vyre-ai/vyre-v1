// Vault > Connections (owner rulings D28 and D29): the catalog from the official MCP registry (a recorded page, then offline from what was kept), adding from it, from a pasted address and
// from a Claude Code or Codex config, the health and use the engine records, Mine for its owner only, a Space connection for Everyone or groups, the Space's rules, and keys that never sit in a
// command line or an event.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handlers } from "../impl.ts";
import { setPluginsHost } from "../handlers/plugins.ts";
import { assertEventsConform, codeOf, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { OFFICIAL, planEntry, headerValue, allowedBy, packageOf } from "../../../lib/mcp-registry.ts";
import { parseAddress, parseConfig, secretInArgs } from "../../../lib/mcp-import.ts";

const RECORDED = JSON.parse(readFileSync(new URL("./fixtures/mcp-registry-notion.json", import.meta.url), "utf8")) as unknown;
const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
const HOST = { kind: "service" as const, id: "svc_host" };
const MAYA = "usr_maya";
let n = 0;
const WRITES = /^plugins\.(connection\.|connections\.policy_set)/;
const call = async (hn: Harness, cap: string, input: Record<string, unknown> = {}, ctx: Harness["ctx"] = hn.ctx): Promise<any> => {
  const withKey = WRITES.test(cap) && cap !== "plugins.connection.checked" ? { idempotencyKey: `k${++n}`, ...input } : input;
  assert.deepEqual(contractErrors(cap, "in", withKey), [], `${cap}: input`);
  const out = await h[cap]!(ctx, withKey);
  assert.deepEqual(contractErrors(cap, "out", out), [], `${cap}: output`);
  return out;
};
const fail = async (p: Promise<unknown>): Promise<string> => p.then(() => "none", (e: unknown) => codeOf(e));
const keys = (r: { servers: Array<{ key: string }> }) => r.servers.map((s) => s.key).sort();

function world(online: { up: boolean; asked: string[] } = { up: true, asked: [] }) {
  setPluginsHost({
    fetchTree: async () => { throw new Error("no trees here"); },
    fetchJson: async (url: string) => { online.asked.push(url); if (!online.up) throw new Error("offline"); return RECORDED; },
  });
  const hn = harness();
  hn.world.answer("identity.whoami", () => ({ groups: [] }));
  return hn;
}

test("the official registry: a recorded page reads into entries, each says how it signs in, and the page is kept for offline", async () => {
  const page = OFFICIAL.parse(RECORDED);
  const by = new Map(page.entries.map((e) => [e.name, e] as const));
  assert.equal(page.entries.length, 8);
  assert.equal(page.next, (RECORDED as { metadata: { nextCursor: string } }).metadata.nextCursor);
  assert.equal(by.get("com.notion/mcp")!.signIn, "oauth", "a remote that asks for no header signs in with OAuth");
  assert.equal(by.get("com.notion/mcp")!.remote!.transport, "http", "streamable HTTP is preferred over SSE");
  assert.equal(by.get("ai.smithery/smithery-notion")!.signIn, "key");
  const awkoy = by.get("io.github.awkoy/notion-mcp-server")!;
  assert.deepEqual([awkoy.package!.runner, awkoy.package!.registry, awkoy.signIn], ["npx", "npm", "key"], "npm is picked over a container");
  assert.deepEqual(awkoy.package!.env.map((e) => [e.name, e.secret]), [["NOTION_TOKEN", true], ["NOTION_PAGE_ID", false]]);
  assert.equal(by.get("com.mcparmory/notion")!.package!.runner, "uvx", "PyPI over a container");
  assert.match(OFFICIAL.searchUrl("notion"), /^https:\/\/registry\.modelcontextprotocol\.io\/v0\/servers\?.*search=notion/);
  assert.match(OFFICIAL.searchUrl("notion"), /version=latest/);

  const online = { up: true, asked: [] as string[] };
  const hn = world(online);
  const got = await call(hn, "plugins.registry.search", { q: "notion" });
  assert.equal(got.offline, false);
  assert.equal(got.entries.length, 8);
  assert.ok(got.entries.every((e: any) => e.allowed === true), "no allow-list: everything may be added");
  assert.equal(online.asked.length, 1);
  // the registry cannot be reached: the same search answers from what was kept, and says so
  online.up = false;
  const off = await call(hn, "plugins.registry.search", { q: "notion awkoy" });
  assert.equal(off.offline, true);
  assert.deepEqual(off.entries.map((e: any) => e.name), ["io.github.awkoy/notion-mcp-server"], "every word of the search must match");
  assert.equal((await call(hn, "plugins.registry.search", { q: "" })).entries.length, 8);
  assert.equal((await call(hn, "plugins.registry.search", { q: "jira" })).entries.length, 0);
});

test("adding from the catalog: a key server keeps a handle in its env, the OAuth one holds none, and the engine's check shows as health with its tools", async () => {
  const hn = world();
  const page = OFFICIAL.parse(RECORDED);
  const awkoy = planEntry(page.entries.find((e) => e.name === "io.github.awkoy/notion-mcp-server")!);
  assert.deepEqual([awkoy.command, awkoy.args], ["npx", ["-y", "notion-mcp-server@3.3.0"]]);
  assert.deepEqual(awkoy.asks.map((a) => [a.name, a.secret, a.into]), [["NOTION_TOKEN", true, "env"], ["NOTION_PAGE_ID", false, "env"]]);
  const added = await call(hn, "plugins.connection.add_mine", {
    name: awkoy.name, title: awkoy.title, command: awkoy.command, args: awkoy.args, env: { NOTION_TOKEN: "#Notion_key.NOTION_TOKEN", NOTION_PAGE_ID: "abc123" }, source: "registry", sourceRef: "io.github.awkoy/notion-mcp-server",
  });
  assert.equal(added.connection.scope, "mine");
  const oauth = planEntry(page.entries.find((e) => e.name === "com.notion/mcp")!);
  assert.deepEqual([oauth.url, oauth.oauth], ["https://mcp.notion.com/mcp", true]);
  const signIn = await call(hn, "plugins.connection.add_mine", { name: "notion-official", url: oauth.url, auth: "oauth", source: "registry", sourceRef: "com.notion/mcp" });
  const smith = planEntry(page.entries.find((e) => e.name === "ai.smithery/smithery-notion")!);
  assert.equal(headerValue(smith.asks[0]!.value, "#Smithery_key.value"), "Bearer #Smithery_key.value");

  // the engine's connection watcher records what it saw, as the host; nobody else may
  assert.equal(await fail(call(hn, "plugins.connection.checked", { connectionId: added.connection.connectionId, health: "ok", tools: 9 })), "permission.no_grant");
  await call(hn, "plugins.connection.checked", { connectionId: added.connection.connectionId, health: "ok", tools: 9 }, hn.as(HOST));
  await call(hn, "plugins.connection.checked", { connectionId: signIn.connection.connectionId, health: "needs_signin", note: "notion-official needs to be signed in first." }, hn.as(HOST));
  await call(hn, "plugins.connection.checked", { connectionId: added.connection.connectionId, usedBy: "agt_helper" }, hn.as(HOST));
  const home = await call(hn, "plugins.connections.home");
  const row = home.mine.find((r: any) => r.connectionId === added.connection.connectionId);
  assert.deepEqual([row.health, row.tools, row.usedBy, row.source, row.sourceRef, row.keys], ["ok", 9, ["agt_helper"], "registry", "io.github.awkoy/notion-mcp-server", ["#Notion_key.NOTION_TOKEN"]]);
  assert.ok(row.usedAt > 0);
  assert.equal(row.address, "npx -y notion-mcp-server@3.3.0", "the address shows the command with no key in it");
  const sign = home.mine.find((r: any) => r.connectionId === signIn.connection.connectionId);
  assert.deepEqual([sign.health, sign.auth], ["needs_signin", "oauth"]);
  assert.deepEqual(hn.named("plugin.connection_checked").map((e) => e.payload["health"]), ["ok", "needs_signin"], "health is an event only when it changes");
  assert.deepEqual(assertEventsConform(hn), []);
});

test("Mine is its owner's alone: in their turns and their agents' turns for them, never in another person's, and only they see or remove it", async () => {
  const hn = world();
  const a = (await call(hn, "agents.create", { name: "Helper", role: "Helps.", idempotencyKey: "ag-mine" })).agent.agentId as string;
  const mine = await call(hn, "plugins.connection.add_mine", { name: "notion", url: "https://mcp.notion.com/mcp", auth: "oauth" });
  await call(hn, "plugins.connection.add", { name: "crm", scope: "space", url: "https://crm.example.com/mcp", headers: { Authorization: "#Crm_Key.token" } });
  // Dana, and an agent turn Dana asked for
  assert.deepEqual(keys(await call(hn, "plugins.mcp.servers", { agentId: a })), ["crm", "notion"]);
  assert.deepEqual(keys(await call(hn, "plugins.mcp.servers", { agentId: a }, hn.as({ kind: "agent", id: a }, "usr_dana"))), ["crm", "notion"]);
  // Maya, on the same agent: the Space connection only
  const maya = hn.person(MAYA);
  assert.deepEqual(keys(await call(hn, "plugins.mcp.servers", { agentId: a }, maya)), ["crm"]);
  assert.deepEqual(keys(await call(hn, "plugins.mcp.servers", { agentId: a }, hn.as({ kind: "agent", id: a }, MAYA))), ["crm"]);
  assert.equal((await call(hn, "plugins.connections.home", {}, maya)).mine.length, 0);
  assert.ok(!(await call(hn, "plugins.connections.list", {}, maya)).connections.some((c: any) => c.name === "notion"));
  assert.equal(await fail(call(hn, "plugins.connection.update", { connectionId: mine.connection.connectionId, title: "Mine now" }, maya)), "validation.not_found");
  assert.equal((await call(hn, "plugins.connection.forget", { connectionId: mine.connection.connectionId }, maya)).removed, false);
  assert.equal((await call(hn, "plugins.connection.remove", { connectionId: mine.connection.connectionId }, maya)).removed, false);
  // two people may each have their own notion; Maya's does not reach Dana
  await call(hn, "plugins.connection.add_mine", { name: "notion", url: "https://mcp.notion.com/mcp", auth: "oauth" }, maya);
  assert.equal((await call(hn, "plugins.connections.home", {}, maya)).mine.length, 1);
  assert.equal((await call(hn, "plugins.connections.home")).mine.length, 1);
  // a Mine connection of the same name as a Space one wins for its owner, and the Space one still reaches everyone else
  await call(hn, "plugins.connection.add_mine", { name: "crm", url: "https://my-crm.example.com/mcp", headers: { Authorization: "Bearer #My_crm.token" } });
  const danaCrm = (await call(hn, "plugins.mcp.servers", { agentId: a })).servers.find((s: any) => s.key === "crm");
  assert.equal(danaCrm.url, "https://my-crm.example.com/mcp");
  assert.equal((await call(hn, "plugins.mcp.servers", { agentId: a }, maya)).servers.find((s: any) => s.key === "crm").url, "https://crm.example.com/mcp");
  assert.equal((await call(hn, "plugins.connection.forget", { connectionId: mine.connection.connectionId })).removed, true);
  // a skill registers the server it brings here too, marked with the skill (l-skills2)
  await call(hn, "plugins.connection.add", { name: "pdf-render", scope: "space", command: "uvx", args: ["pdf-render-mcp"], source: "skill", sourceRef: "pdf" });
  const fromSkill = (await call(hn, "plugins.connections.home")).space.find((r: any) => r.key === "pdf-render");
  assert.deepEqual([fromSkill.source, fromSkill.sourceRef, fromSkill.address], ["skill", "pdf", "uvx pdf-render-mcp"]);
  assert.deepEqual(assertEventsConform(hn), []);
});

test("a Space connection is for Everyone or the groups an admin picks; a member outside them neither sees nor runs it", async () => {
  const hn = world();
  const groups: Record<string, string[]> = { usr_dana: ["grp_legal"], [MAYA]: ["grp_sales"] };
  hn.world.answer("identity.whoami", () => ({ groups: groups[String(currentAsker)] ?? [] }));
  let currentAsker = "usr_dana";
  const as = (id: string) => { currentAsker = id; return hn.person(id); };
  const a = (await call(hn, "agents.create", { name: "Shared", role: "Shared.", idempotencyKey: "ag-share" })).agent.agentId as string;
  const c = await call(hn, "plugins.connection.add", { name: "docs", scope: "space", url: "https://docs.example.com/mcp", share: ["grp_legal"] });
  assert.deepEqual(c.connection.share, ["grp_legal"]);
  assert.deepEqual(keys(await call(hn, "plugins.mcp.servers", { agentId: a }, as("usr_dana"))), ["docs"]);
  assert.deepEqual(keys(await call(hn, "plugins.mcp.servers", { agentId: a }, as(MAYA))), []);
  // Maya does not manage agents: the home list leaves out what is not shared with her
  hn.allowOnly((action) => action.perm !== "agents.manage" && action.perm !== "policy.manage");
  assert.equal((await call(hn, "plugins.connections.home", {}, as(MAYA))).space.length, 0);
  assert.equal(await fail(call(hn, "plugins.connection.update", { connectionId: c.connection.connectionId, share: ["everyone"] }, as(MAYA))), "permission.role_lacks_permission");
  hn.allowOnly(() => true);
  await call(hn, "plugins.connection.update", { connectionId: c.connection.connectionId, share: ["everyone"] }, as("usr_dana"));
  assert.deepEqual(keys(await call(hn, "plugins.mcp.servers", { agentId: a }, as(MAYA))), ["docs"]);
  hn.allowOnly((action) => action.perm !== "agents.manage" && action.perm !== "policy.manage");
  const home = await call(hn, "plugins.connections.home", {}, as(MAYA));
  assert.deepEqual([home.space.length, home.space[0].canManage, home.canAddSpace, home.admin], [1, false, false, false]);
  assert.equal(await fail(call(hn, "plugins.connection.update", { connectionId: c.connection.connectionId, share: ["grp_x"] }, as("usr_dana"))), "permission.role_lacks_permission");
  hn.allowOnly(() => true);
  // a Mine connection is never shared
  const mine = await call(hn, "plugins.connection.add_mine", { name: "mine", url: "https://m.example.com/mcp" }, as("usr_dana"));
  assert.equal(await fail(call(hn, "plugins.connection.update", { connectionId: mine.connection.connectionId, share: ["everyone"] }, as("usr_dana"))), "validation.bad_input");
  assert.deepEqual(assertEventsConform(hn), []);
});

test("a fresh Space is open: no allow-list, Space connections by whoever manages agents, every catalog result addable by a member", async () => {
  const hn = world();
  assert.deepEqual((await call(hn, "plugins.connections.policy")).policy, { spaceAdders: "managers", allowListOn: false, allowList: [] });
  // a member (no admin, no agents.manage): still nothing locked
  hn.allowOnly((action) => action.perm !== "policy.manage" && action.perm !== "agents.manage");
  const found = await call(hn, "plugins.registry.search", { q: "notion" });
  assert.equal(found.entries.length, 8);
  assert.ok(found.entries.every((e: any) => e.allowed === true), "no lock until an admin turns the allow-list on");
  await call(hn, "plugins.connection.add_mine", { name: "anything", url: "https://random.example.com/mcp" });
  const home = await call(hn, "plugins.connections.home");
  assert.deepEqual([home.policy.allowListOn, home.policy.allowList], [false, []]);
});

test("the Space's rules: admins only for Space connections, and an allow-list for everyone else's additions", async () => {
  const hn = world();
  await call(hn, "plugins.connections.policy_set", { spaceAdders: "admins", allowListOn: true, allowList: ["mcp.notion.com", "@acme/approved-mcp", "com.notion/mcp"] });
  assert.deepEqual((await call(hn, "plugins.connections.policy")).policy, { spaceAdders: "admins", allowListOn: true, allowList: ["mcp.notion.com", "@acme/approved-mcp", "com.notion/mcp"] });
  // a developer manages agents but is not an admin
  hn.allowOnly((action) => action.perm !== "policy.manage");
  assert.equal(await fail(call(hn, "plugins.connection.add", { name: "crm", scope: "space", url: "https://crm.example.com/mcp" })), "permission.role_lacks_permission");
  assert.equal((await call(hn, "plugins.connections.home")).canAddSpace, false);
  // a member's own: only what the list names
  assert.equal(await fail(call(hn, "plugins.connection.add_mine", { name: "random", url: "https://random.example.com/mcp" })), "validation.precondition_failed");
  assert.equal(await fail(call(hn, "plugins.connection.add_mine", { name: "other", command: "npx", args: ["-y", "@acme/other-mcp"] })), "validation.precondition_failed");
  await call(hn, "plugins.connection.add_mine", { name: "notion", url: "https://mcp.notion.com/mcp", auth: "oauth" });
  await call(hn, "plugins.connection.add_mine", { name: "approved", command: "npx", args: ["-y", "@acme/approved-mcp@2.0.1"] });
  const search = await call(hn, "plugins.registry.search", { q: "notion" });
  assert.deepEqual(search.entries.filter((e: any) => e.allowed).map((e: any) => e.name), ["com.notion/mcp"], "the catalog marks what the list allows");
  // an admin is not held to the list
  hn.allowOnly(() => true);
  await call(hn, "plugins.connection.add", { name: "crm", scope: "space", url: "https://crm.example.com/mcp" });
  assert.equal((await call(hn, "plugins.connections.home")).canAddSpace, true);
  assert.equal(allowedBy(["notion.com"], { url: "https://mcp.notion.com/mcp" }), true, "a parent domain covers its subdomains");
  assert.equal(allowedBy([], { url: "https://mcp.notion.com/mcp" }), false);
  assert.equal(packageOf("uvx", ["mcparmory-notion==1.0.2"]), "mcparmory-notion");
  assert.equal(packageOf("docker", ["run", "-i", "--rm", "-e", "TOKEN", "ghcr.io/acme/mcp:1.0"]), "ghcr.io/acme/mcp");
  assert.deepEqual(assertEventsConform(hn), []);
});

test("keys never sit in a command line: a handle or a key in the arguments is refused, a pasted key moves to the Vault, and no event carries a value", async () => {
  const hn = world();
  for (const args of [["-y", "server", "--api-key", "#Key.value"], ["-y", "server", "--token=ghp_abcdefghijklmnopqrstuvwxyz0123456789"], ["-y", "server", "sk-live-abcdefghijklmnop1234567890"]]) { // secret-scan: fake
    assert.equal(await fail(call(hn, "plugins.connection.add_mine", { name: "leaky", command: "npx", args })), "validation.bad_input", args.join(" "));
  }
  assert.equal(await fail(call(hn, "plugins.connection.add_mine", { name: "leaky", command: "npx", args: ["-y", "server"], env: { NOTION_TOKEN: "ntn_abcdefghijklmnopqrstuvwxyz" } })), "validation.bad_input");
  assert.equal(await fail(call(hn, "plugins.connection.add_mine", { name: "leaky", url: "https://user:pw@x.example.com/mcp" })), "validation.bad_input");
  assert.equal(await fail(call(hn, "plugins.connection.add_mine", { name: "leaky", command: "npx -y server", args: [] })), "validation.bad_input");
  // a pasted line with the key in front: the key leaves the command for the Vault
  const pasted = parseAddress("GITHUB_PERSONAL_ACCESS_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789 npx -y @modelcontextprotocol/server-github")!; // secret-scan: fake
  assert.equal(pasted.length, 1);
  const d = pasted[0]!;
  assert.deepEqual([d.name, d.command, d.args, d.problem], ["github", "npx", ["-y", "@modelcontextprotocol/server-github"], undefined]);
  assert.deepEqual(d.secrets.map((x) => [x.key, x.into]), [["GITHUB_PERSONAL_ACCESS_TOKEN", "env"]]);
  assert.ok(!JSON.stringify([d.command, d.args, d.env]).includes("ghp_"));
  assert.match(parseAddress("npx -y some-server --api-key sk-abcdefghijklmnopqrstuvwx")![0]!.problem ?? "", /key is written into the command/);
  assert.equal(secretInArgs(["-y", "@acme/server@1.0.0", "--region", "eu"]), -1);
  const ok = await call(hn, "plugins.connection.add_mine", { name: d.name, command: d.command, args: d.args, env: { GITHUB_PERSONAL_ACCESS_TOKEN: "#Github.GITHUB_PERSONAL_ACCESS_TOKEN" }, source: "paste" });
  assert.equal(ok.connection.scope, "mine");
  const events = JSON.stringify(hn.emitted);
  assert.ok(!events.includes("ghp_") && !events.includes("sk-"), "no event carries a key");
  assert.deepEqual(assertEventsConform(hn), []);
});

test("pasting and importing: an address, claude mcp add, a .mcp.json, ~/.claude.json with projects, and Codex's config.toml", () => {
  const url = parseAddress("https://mcp.linear.app/mcp")![0]!;
  assert.deepEqual([url.name, url.url, url.transport], ["linear", "https://mcp.linear.app/mcp", "http"]);
  assert.equal(parseAddress("https://mcp.example.com/sse")![0]!.transport, "sse");
  const uvx = parseAddress("uvx mcp-server-fetch")![0]!;
  assert.deepEqual([uvx.name, uvx.command, uvx.args], ["fetch", "uvx", ["mcp-server-fetch"]]);
  const cc = parseAddress("claude mcp add sentry -e SENTRY_TOKEN=sntrys_abcdefghijklmnopqrstuvwxyz0123 -- npx -y @sentry/mcp-server")![0]!;
  assert.deepEqual([cc.name, cc.command, cc.args, cc.secrets.map((s) => s.key)], ["sentry", "npx", ["-y", "@sentry/mcp-server"], ["SENTRY_TOKEN"]]);
  assert.equal(parseAddress("hello there, not a server!"), null);

  const mcpJson = parseConfig(JSON.stringify({ mcpServers: {
    github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}" } },
    linear: { type: "http", url: "https://mcp.linear.app/mcp" },
    stripe: { type: "http", url: "https://mcp.stripe.com", headers: { Authorization: "Bearer rk_live_FAKE0123" } },
  } }));
  assert.equal(mcpJson.kind, "claude");
  assert.deepEqual(mcpJson.drafts.map((x) => x.name), ["github", "linear", "stripe"]);
  assert.deepEqual(mcpJson.drafts[0]!.needs, [{ key: "GITHUB_PERSONAL_ACCESS_TOKEN", into: "env", secret: true }]);
  assert.deepEqual(mcpJson.drafts[2]!.secrets.map((s) => [s.key, s.into, s.prefix]), [["Authorization", "header", "Bearer "]]);
  assert.deepEqual(mcpJson.drafts[2]!.headers, {}, "the key left the headers");

  const user = parseConfig(JSON.stringify({ numStartups: 3, mcpServers: { memory: { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] } }, projects: { "/Users/dana/app": { mcpServers: { postgres: { command: "npx", args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost/app"] }, memory: { command: "other" } } } } }));
  assert.equal(user.kind, "claude-user");
  assert.deepEqual(user.drafts.map((x) => [x.name, x.from]), [["memory", ".mcp.json"], ["postgres", "/Users/dana/app"]], "a name seen twice keeps the first");

  const codex = parseConfig(`
model = "gpt-5"
# servers
[mcp_servers.context7]
command = "npx"
args = ["-y", "@upstash/context7-mcp"]

[mcp_servers.figma]
url = "https://mcp.figma.com/mcp"
bearer_token_env_var = "FIGMA_OAUTH_TOKEN"

[mcp_servers.brave]
command = "npx"
args = [
  "-y",
  "@brave/brave-search-mcp-server",
]
env = { BRAVE_API_KEY = "BSAabcdefghijklmnopqrstuvwxyz0123456", REGION = "eu" }
`);
  assert.equal(codex.kind, "codex");
  assert.deepEqual(codex.drafts.map((x) => x.name), ["context7", "figma", "brave"]);
  assert.deepEqual(codex.drafts[1]!.needs, [{ key: "Authorization", into: "header", secret: true, prefix: "Bearer " }]);
  assert.deepEqual([codex.drafts[2]!.args, codex.drafts[2]!.env, codex.drafts[2]!.secrets.map((s) => s.key)], [["-y", "@brave/brave-search-mcp-server"], { REGION: "eu" }, ["BRAVE_API_KEY"]]);
  assert.equal(parseConfig("not json {").error, "No [mcp_servers] in that file.");
  assert.equal(parseConfig("{ bad").error, "That is not valid JSON.");
});
