// Install from a link (owner, 4 Nov 2026), with a fake GitHub: what each kind is detected as and the plan card's content, a refused install for a non-admin choosing the Space, third-party code kept in
// the sandbox, a Sites deploy with a route and auth, update diffs, and skills that agents own and share: grants to an agent, versions and Undo, and the asker's skills on that person's turn only.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { setPluginsHost } from "../handlers/plugins.ts";
import { forgetFolderSkills } from "../handlers/skills.ts";
import { registry } from "../../../generated/registry.ts";
import { DANA, LEO, MAYA, codeOf, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
let n = 0;
const KEYED = new Set(["install.apply", "skills.mine.add", "skills.share", "agents.create", "skills.add"]);
const call = async (hn: Harness, cap: string, input: Record<string, unknown>, ctx: Harness["ctx"] = hn.ctx): Promise<any> => {
  const withKey = KEYED.has(cap) ? { idempotencyKey: `k${++n}`, ...input } : input;
  assert.deepEqual(contractErrors(cap, "in", withKey), [], `${cap}: input`);
  const out = await h[cap]!(ctx, withKey);
  assert.deepEqual(contractErrors(cap, "out", out), [], `${cap}: output`);
  return out;
};
const fails = async (p: Promise<unknown>): Promise<string> => { try { await p; return "none"; } catch (e) { return codeOf(e); } };
const SKILL = (name: string, desc: string, body = "Do the thing.") => `---\nname: ${name}\ndescription: ${desc}\n---\n\n${body}\n`;

// ---- a fake GitHub: repositories as text trees, each with a commit that moves when a test pushes ----
type Tree = Record<string, string>;
const repos = new Map<string, { files: Tree; revision: string }>();
const reads: string[] = [];
repos.set("acme/pdf-skill", { revision: "aaaaaaa1111111111111111111111111111111aa", files: { "SKILL.md": SKILL("pdf-forms", "Fill PDF forms from a record."), "README.md": "# PDF skill\n\nFills PDF forms from a record, field by field.\n" } });
repos.set("acme/helper-plugin", { revision: "bbbbbbb2222222222222222222222222222222bb", files: {
  ".claude-plugin/plugin.json": JSON.stringify({ name: "helper-plugin", description: "Adds a /greet command and a greeting skill." }),
  "skills/greeting/SKILL.md": SKILL("greeting", "Greet people warmly."), "README.md": "# Helper plugin\n\nAdds a greeting skill.\n",
} });
repos.set("acme/codex-pack", { revision: "ccccccc3333333333333333333333333333333cc", files: { ".codex-plugin/plugin.json": JSON.stringify({ name: "codex-pack", description: "Codex skills." }), "skills/review/SKILL.md": SKILL("review", "Review a diff.") } });
repos.set("acme/crm-mcp", { revision: "ddddddd4444444444444444444444444444444dd", files: {
  "package.json": JSON.stringify({ name: "@acme/crm-mcp", description: "Read and update the CRM from an agent.", bin: { "crm-mcp": "./dist/index.js" }, dependencies: { "@modelcontextprotocol/sdk": "^1.0.0" } }),
  "README.md": "# CRM MCP server\n\nAn MCP server that reads and updates your CRM. Set CRM_API_KEY. It calls https://api.acme-crm.io and nothing else.\n",
  "dist/index.js": "console.log('server');\n",
} });
repos.set("acme/py-mcp", { revision: "eeeeeee5555555555555555555555555555555ee", files: { "pyproject.toml": '[project]\nname = "py-mcp"\ndescription = "A Python MCP server"\n[project.scripts]\npy-mcp = "py_mcp:main"\n', "README.md": "# py-mcp\n\nA FastMCP server for lookups.\n" } });
repos.set("acme/docker-mcp", { revision: "fffffff6666666666666666666666666666666ff", files: { "Dockerfile": 'FROM node:22\nENTRYPOINT ["node", "server.js"]\n', "README.md": "# docker-mcp\n\nAn MCP server in a container, over stdio.\n" } });
repos.set("acme/portfolio", { revision: "1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa11", files: { "Dockerfile": "FROM nginx\n", "index.html": "<h1>Hi</h1>", "package.json": JSON.stringify({ name: "portfolio", description: "A small site", scripts: { start: "serve" } }), "README.md": "# Portfolio\n\nMy portfolio site, built static.\n" } });
repos.set("acme/odd", { revision: "2222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb22", files: { "notes.txt": "nothing to install" } });
setPluginsHost({
  async fetchTree(src) {
    const m = /github\.com\/([^/]+\/[^/]+)/.exec(src.url ?? "");
    const r = m ? repos.get(m[1]!) : undefined;
    reads.push(src.url ?? "");
    if (!r) throw new Error("not found");
    return { files: { ...r.files }, revision: r.revision, skipped: [] };
  },
});

function world() {
  forgetFolderSkills();
  reads.length = 0;
  const hn = harness();
  const maya = hn.person(MAYA), leo = hn.person(LEO);
  const member = (): void => hn.allowOnly((a) => a.perm !== "agents.manage" && a.perm !== "kits.install" && a.perm !== "sites.deploy");
  const admin = (): void => hn.allowOnly(() => true);
  hn.world.answer("skills.add", (i: any) => ({ skill: { name: i.name } }));
  return { hn, maya, leo, member, admin };
}
const plan = async (hn: Harness, repo: string, ctx = hn.ctx) => (await call(hn, "install.from_link", { url: `https://github.com/${repo}` }, ctx)).plan;
const agentOf = async (hn: Harness, ctx: Harness["ctx"], name: string): Promise<string> => (await call(hn, "agents.create", { name, role: `${name}.` }, ctx)).agent.agentId as string;
const listed = async (hn: Harness, ctx: Harness["ctx"], agentId?: string): Promise<string[]> => (await call(hn, "skills.list", agentId ? { agentId } : {}, ctx)).skills.map((s: { name: string }) => s.name);

test("a link is read into a plan, pinned to a commit, and says what it is for each kind", async () => {
  const { hn } = world();
  const skill = await plan(hn, "acme/pdf-skill");
  assert.deepEqual([skill.kind, skill.name, skill.commit, skill.repo], ["skill", "pdf-forms", "aaaaaaa1111111111111111111111111111111aa", "acme/pdf-skill"]);
  assert.equal(skill.summary, "Fill PDF forms from a record.");
  assert.deepEqual(skill.who.map((w: { key: string; allowed: boolean }) => [w.key, w.allowed]), [["me", true], ["agent", true], ["space", true]]);
  assert.equal((await plan(hn, "acme/helper-plugin")).kind, "plugin");
  const plug = await plan(hn, "acme/helper-plugin");
  assert.deepEqual([plug.flavor, plug.skills], ["claude", ["greeting"]]);
  assert.deepEqual([(await plan(hn, "acme/codex-pack")).kind, (await plan(hn, "acme/codex-pack")).flavor], ["plugin", "codex"]);
  const mcp = await plan(hn, "acme/crm-mcp");
  assert.deepEqual([mcp.kind, mcp.name, mcp.runs], ["mcp_local", "crm-mcp", { command: "node", args: ["dist/index.js"] }]);
  assert.equal(mcp.summary, "An MCP server that reads and updates your CRM. Set CRM_API_KEY. It calls https://api.acme-crm.io and nothing else.");
  assert.deepEqual(mcp.needs, { domains: ["api.acme-crm.io"], vaultKeys: ["CRM_API_KEY"], files: ["A copy of the repository, in the sandbox"] });
  assert.deepEqual(mcp.runOn.map((r: { key: string }) => r.key), ["sandbox", "space"]);
  assert.deepEqual((await plan(hn, "acme/py-mcp")).runs, { command: "py-mcp", args: [] });
  assert.deepEqual((await plan(hn, "acme/docker-mcp")).runs, { command: "node", args: ["server.js"] });
  assert.equal((await plan(hn, "acme/portfolio")).kind, "site");
  const remote = (await call(hn, "install.from_link", { url: "https://mcp.acme.io/mcp" })).plan;
  assert.deepEqual([remote.kind, remote.needs.domains, remote.commit], ["mcp_remote", ["mcp.acme.io"], ""]);
  assert.equal(await fails(call(hn, "install.from_link", { url: "https://example.com/page" })), "validation.bad_input");
  assert.equal(await fails(call(hn, "install.from_link", { url: "https://github.com/acme/odd" })), "validation.bad_input", "it says it could not tell what it is");
  assert.equal(await fails(call(hn, "install.from_link", { url: "https://github.com/acme/missing" })), "provider.unavailable");
  assert.equal(await fails(call(hn, "install.from_link", { url: "not a link" })), "validation.bad_input");
});

test("every install goes through the Gate as a held card for an agent; the plan holds the exact commit and who gets it", () => {
  const apply = registry.capabilities.find((c) => c.name === "install.apply") as unknown as { gate?: { act: string } };
  assert.equal(apply.gate?.act, "install");
  const act = (registry as unknown as { gateActs?: Array<{ key: string; appliesTo: { actors: string[] }; approvers: { peopleOnly: boolean } }> }).gateActs?.find((a) => a.key === "install");
  if (act) assert.deepEqual([act.appliesTo.actors.includes("agent"), act.approvers.peopleOnly], [true, true]);
});

test("a non-admin cannot choose the whole Space; an admin can, and a skill then applies to everyone", async () => {
  const { hn, maya, member, admin } = world();
  member();
  const p = await plan(hn, "acme/pdf-skill", maya);
  assert.equal(p.who.find((w: { key: string }) => w.key === "space").allowed, false);
  assert.equal(await fails(call(hn, "install.apply", { planId: p.planId, for: "space" }, maya)), "permission.role_lacks_permission");
  assert.equal((await call(hn, "install.list", {}, maya)).installs.length, 0, "a refused install leaves nothing");
  admin();
  const q = await plan(hn, "acme/pdf-skill");
  assert.equal(q.who.find((w: { key: string }) => w.key === "space").allowed, true);
  await call(hn, "install.apply", { planId: q.planId, for: "space" });
  const page = await call(hn, "skills.page", {}, maya);
  assert.ok(page.space.some((s: { name: string }) => s.name === "pdf-forms"), "everyone in the Space has it");
  assert.equal(await fails(call(hn, "install.apply", { planId: q.planId, for: "me" })), "validation.precondition_failed", "a plan is used once");
});

test("a skill installs for the person, or into one agent as that agent's own skill, with its source pinned to the commit", async () => {
  const { hn } = world();
  const agent = await agentOf(hn, hn.ctx, "Intake");
  const p1 = await plan(hn, "acme/pdf-skill");
  const me = (await call(hn, "install.apply", { planId: p1.planId, for: "me" })).installed;
  assert.equal(typeof me.skillId, "string");
  const mine = (await call(hn, "skills.page", {})).mine.find((s: { name: string }) => s.name === "pdf-forms");
  assert.deepEqual([mine.source, mine.version], ["github:acme/pdf-skill@aaaaaaa1111111111111111111111111111111aa", "aaaaaaa"]);
  const p2 = await plan(hn, "acme/pdf-skill");
  const forAgent = (await call(hn, "install.apply", { planId: p2.planId, for: "agent", agentId: agent })).installed;
  assert.equal(forAgent.agentId, agent);
  assert.ok((await listed(hn, hn.as({ kind: "agent", id: agent }, DANA), agent)).includes("pdf-forms"), "the agent has it as its own");
  assert.equal(await fails(call(hn, "install.apply", { planId: (await plan(hn, "acme/pdf-skill")).planId, for: "agent" })), "validation.bad_input", "an agent must be named");
  const inst = (await call(hn, "install.list", {})).installs;
  assert.deepEqual(inst.map((i: { kind: string }) => i.kind), ["skill", "skill"]);
});

test("a plugin is registered with the plugin runtime for an agent; a local MCP server is stored with its files and a stdio command for the sandbox, never run here or on Sites unless asked", async () => {
  const { hn } = world();
  const agent = await agentOf(hn, hn.ctx, "Ops");
  const pl = await plan(hn, "acme/helper-plugin");
  const done = (await call(hn, "install.apply", { planId: pl.planId, for: "agent", agentId: agent })).installed;
  const list = await call(hn, "plugins.list", { agentId: agent });
  assert.ok(list.plugins.some((x: { name: string; scope: string }) => x.name === "helper-plugin" && x.scope === "agent"));
  assert.equal(typeof done.pluginId, "string");
  const m = await plan(hn, "acme/crm-mcp");
  hn.clear();
  const mdone = (await call(hn, "install.apply", { planId: m.planId, for: "agent", agentId: agent, runOn: "sandbox" })).installed;
  assert.equal(hn.world.calls.some((c) => c.cap.startsWith("sites.")), false, "nothing was deployed");
  const row = hn.rows("SELECT * FROM agents_plugins WHERE id = ?", mdone.pluginId)[0]!;
  const contents = JSON.parse(String(row["contents_json"]));
  assert.deepEqual(contents.mcpServers.map((s: { transport: string; command: string; args: string[] }) => [s.transport, s.command, s.args]), [["stdio", "node", ["dist/index.js"]]]);
  assert.ok(String(row["files_json"]).includes("dist/index.js"), "its files are kept for the sandbox to be given");
  assert.equal(await fails(call(hn, "install.apply", { planId: (await plan(hn, "acme/crm-mcp")).planId, for: "me" })), "validation.bad_input", "a sandbox belongs to an agent");
  // a remote MCP address is connected, not installed
  hn.world.answer("plugins.connection.add", (i: any) => ({ connection: { connectionId: "mcs_1", name: i.name } }));
  const remote = (await call(hn, "install.from_link", { url: "https://mcp.acme.io/mcp" })).plan;
  await call(hn, "install.apply", { planId: remote.planId, for: "agent", agentId: agent });
  const conn = hn.world.calls.find((c) => c.cap === "plugins.connection.add")!;
  assert.deepEqual([conn.input.url, conn.input.scope, conn.input.agentId], ["https://mcp.acme.io/mcp", "agent", agent]);
});

test("Run it on the Space deploys a local MCP server on Sites behind a route with its key from the Vault, then connects it to the agent", async () => {
  const { hn, admin, member } = world();
  admin();
  const agent = await agentOf(hn, hn.ctx, "Ops");
  const sites: Array<{ cap: string; input: any }> = [];
  hn.world.answer("sites.create", (i: any) => { sites.push({ cap: "sites.create", input: i }); return { site: { siteId: "sit_1", url: "https://mcp.example.test/p/crm-mcp" } }; });
  hn.world.answer("sites.env_set", (i: any) => { sites.push({ cap: "sites.env_set", input: i }); return { ok: true }; });
  hn.world.answer("sites.deploy", (i: any) => { sites.push({ cap: "sites.deploy", input: i }); return { deployment: { deploymentId: "dep_1", url: "https://mcp.example.test/p/crm-mcp" } }; });
  hn.world.answer("plugins.connection.add", (i: any) => { sites.push({ cap: "plugins.connection.add", input: i }); return { connection: { connectionId: "mcs_9" } }; });
  const p = await plan(hn, "acme/crm-mcp");
  assert.equal(await fails(call(hn, "install.apply", { planId: p.planId, for: "agent", agentId: agent, runOn: "space" })), "validation.bad_input", "the key that protects it is required");
  member();
  assert.equal(await fails(call(hn, "install.apply", { planId: p.planId, for: "agent", agentId: agent, runOn: "space", authHandle: "#Ops_mcp" })), "permission.role_lacks_permission", "deploying on Sites needs that permission");
  admin();
  const done = (await call(hn, "install.apply", { planId: p.planId, for: "agent", agentId: agent, runOn: "space", authHandle: "#Ops_mcp" })).installed;
  assert.deepEqual(sites.map((s) => s.cap), ["sites.create", "sites.env_set", "sites.deploy", "plugins.connection.add"]);
  assert.deepEqual([sites[0]!.input.repoUrl, sites[0]!.input.access], ["https://github.com/acme/crm-mcp", "space"]);
  assert.deepEqual(sites[1]!.input.entries, [{ name: "MCP_AUTH_TOKEN", vaultHandle: "#Ops_mcp" }]);
  assert.deepEqual([sites[3]!.input.url, sites[3]!.input.headers, sites[3]!.input.agentId], ["https://mcp.example.test/p/crm-mcp/mcp", { Authorization: "#Ops_mcp" }, agent]);
  assert.deepEqual([done.siteId, done.connectionId, done.runOn], ["sit_1", "mcs_9", "space"]);
  assert.equal(JSON.stringify(sites).includes("secret"), false, "only the Vault handle goes, never a value");
});

test("an update shows the diff and waits to be applied; nothing updates by itself", async () => {
  const { hn } = world();
  const p = await plan(hn, "acme/pdf-skill");
  const done = (await call(hn, "install.apply", { planId: p.planId, for: "me" })).installed;
  const installId = (await call(hn, "install.list", {})).installs[0].installId;
  assert.deepEqual(await call(hn, "install.check_update", { installId }), { changed: false });
  const r = repos.get("acme/pdf-skill")!;
  const before = { ...r, files: { ...r.files } };
  r.revision = "9999999zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz99";
  r.files = { ...r.files, "SKILL.md": SKILL("pdf-forms", "Fill PDF forms from a record.", "Do the thing.\nAlso flatten the form."), "scripts/flatten.py": "print('flatten')\n" };
  try {
    assert.match((await call(hn, "skills.page", {})).mine[0].source, /aaaaaaa/, "still on the old commit");
    const u = await call(hn, "install.check_update", { installId });
    assert.equal(u.changed, true);
    assert.deepEqual([u.plan.diff.from, u.plan.diff.to, u.plan.diff.added], ["aaaaaaa1111111111111111111111111111111aa", "9999999zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz99", ["scripts/flatten.py"]]);
    assert.deepEqual(u.plan.diff.changed.map((c: { path: string; plus: string[] }) => [c.path, c.plus]), [["SKILL.md", ["Also flatten the form."]]]);
    assert.equal((await call(hn, "skills.page", {})).mine[0].version, "aaaaaaa", "the diff alone changes nothing");
    await call(hn, "install.apply", { planId: u.plan.planId, for: "me" });
    const after = (await call(hn, "skills.page", {})).mine.find((s: { name: string }) => s.name === "pdf-forms");
    assert.equal(after.version, "9999999");
    assert.match((await call(hn, "skills.view", { skillId: done.skillId })).skill.text, /flatten the form/);
    assert.equal((await call(hn, "install.list", {})).installs.length, 1, "one install, now at the new commit");
    assert.equal((await call(hn, "install.list", {})).installs[0].commit, "9999999zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz99");
  } finally { repos.set("acme/pdf-skill", before); }
});

test("a plugin update replaces its files and version only once applied", async () => {
  const { hn } = world();
  const agent = await agentOf(hn, hn.ctx, "Ops");
  await call(hn, "install.apply", { planId: (await plan(hn, "acme/crm-mcp")).planId, for: "agent", agentId: agent, runOn: "sandbox" });
  const installId = (await call(hn, "install.list", {})).installs[0].installId;
  const r = repos.get("acme/crm-mcp")!;
  const before = { ...r, files: { ...r.files } };
  r.revision = "8888888yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy88";
  r.files = { ...r.files, "dist/index.js": "console.log('server v2');\n" };
  try {
    const u = await call(hn, "install.check_update", { installId });
    assert.deepEqual(u.plan.diff.changed.map((c: { path: string }) => c.path), ["dist/index.js"]);
    assert.equal(String(hn.rows("SELECT version FROM agents_plugins")[0]!["version"]), "ddddddd");
    await call(hn, "install.apply", { planId: u.plan.planId, for: "agent", agentId: agent });
    assert.equal(String(hn.rows("SELECT version FROM agents_plugins")[0]!["version"]), "8888888");
    assert.ok(String(hn.rows("SELECT files_json FROM agents_plugins")[0]!["files_json"]).includes("server v2"));
  } finally { repos.set("acme/crm-mcp", before); }
});

test("an agent writes its own skills, each save is a version, and Undo brings the one before back, and undoing again redoes it", async () => {
  const { hn } = world();
  const agent = await agentOf(hn, hn.ctx, "Intake");
  const self = hn.as({ kind: "agent", id: agent }, DANA);
  const a = (await call(hn, "skills.save", { text: SKILL("triage", "Sort new requests.", "v1") }, self)).skill;
  assert.deepEqual([a.owner, a.ownerKind, a.rev], [agent, "agent", 1]);
  const b = (await call(hn, "skills.save", { text: SKILL("triage", "Sort new requests.", "v2 with urgency"), summary: "added urgency" }, self)).skill;
  assert.deepEqual([b.skillId, b.rev], [a.skillId, 2], "the same name is a new version of the same skill");
  assert.ok((await listed(hn, self, agent)).includes("triage"));
  const hist = (await call(hn, "skills.history", { skillId: a.skillId }, self)).revisions;
  assert.deepEqual(hist.map((r: { rev: number; by: string; authorKind: string; summary: string }) => [r.rev, r.by, r.authorKind, r.summary]), [[2, DANA, "agent", "added urgency"], [1, DANA, "agent", "created"]]);
  await call(hn, "skills.undo", { skillId: a.skillId }, self);
  await call(hn, "skills.save", { text: SKILL("triage", "Sort new requests.", "v3"), skillId: a.skillId }, self);
  assert.equal((await call(hn, "skills.history", { skillId: a.skillId }, self)).revisions.length, 4, "an undo and a later save are versions too");
});

test("undo restores the previous text and a second undo redoes it", async () => {
  const { hn } = world();
  const agent = await agentOf(hn, hn.ctx, "Intake");
  const self = hn.as({ kind: "agent", id: agent }, DANA);
  const a = (await call(hn, "skills.save", { text: SKILL("triage", "Sort.", "first") }, self)).skill;
  await call(hn, "skills.save", { text: SKILL("triage", "Sort.", "second") }, self);
  const text = async () => (hn.rows("SELECT text FROM agents_skill_own WHERE id = ?", a.skillId)[0]!["text"] as string);
  assert.match(await text(), /second/);
  const u1 = await call(hn, "skills.undo", { skillId: a.skillId }, self);
  assert.equal(u1.undid, 2);
  assert.match(await text(), /first/);
  const u2 = await call(hn, "skills.undo", { skillId: a.skillId }, self);
  assert.equal(u2.undid, 3);
  assert.match(await text(), /second/);
  const fresh = await agentOf(hn, hn.ctx, "Other");
  const once = (await call(hn, "skills.save", { text: SKILL("solo", "One version.") }, hn.as({ kind: "agent", id: fresh }, DANA))).skill;
  assert.equal(await fails(call(hn, "skills.undo", { skillId: once.skillId }, hn.as({ kind: "agent", id: fresh }, DANA))), "validation.precondition_failed");
});

test("skills are shared with agents the way they are with people: use, edit or manage, and only a manager shares on", async () => {
  const { hn } = world();
  const owner = await agentOf(hn, hn.ctx, "Owner");
  const reader = await agentOf(hn, hn.ctx, "Reader");
  const editor = await agentOf(hn, hn.ctx, "Editor");
  const stranger = await agentOf(hn, hn.ctx, "Stranger");
  const as = (id: string) => hn.as({ kind: "agent", id }, DANA);
  const s = (await call(hn, "skills.save", { text: SKILL("billing-rules", "How we bill.", "net 30") }, as(owner))).skill;
  assert.ok(!(await listed(hn, as(reader), reader)).includes("billing-rules"), "not shared yet");
  await call(hn, "skills.grant", { skillId: s.skillId, agentId: reader, level: "use" }, as(owner));
  await call(hn, "skills.grant", { skillId: s.skillId, agentId: editor, level: "edit" }, as(owner));
  assert.ok((await listed(hn, as(reader), reader)).includes("billing-rules"), "use puts it in the agent's list");
  assert.ok(!(await listed(hn, as(stranger), stranger)).includes("billing-rules"));
  const g = await call(hn, "skills.grants", { skillId: s.skillId }, as(owner));
  assert.deepEqual(g.grants.map((x: { agentId: string; level: string }) => [x.agentId, x.level]).sort(), [[editor, "edit"], [reader, "use"]].sort());
  // use cannot change it; edit can; neither can share on; manage can
  assert.equal(await fails(call(hn, "skills.save", { skillId: s.skillId, text: SKILL("billing-rules", "How we bill.", "net 10") }, as(reader))), "permission.role_lacks_permission");
  const v2 = (await call(hn, "skills.save", { skillId: s.skillId, text: SKILL("billing-rules", "How we bill.", "net 45") }, as(editor))).skill;
  assert.equal(v2.rev, 2);
  assert.equal((await call(hn, "skills.history", { skillId: s.skillId }, as(reader))).revisions[0].by, DANA);
  assert.equal(await fails(call(hn, "skills.grant", { skillId: s.skillId, agentId: stranger, level: "use" }, as(editor))), "permission.role_lacks_permission");
  assert.equal(await fails(call(hn, "skills.history", { skillId: s.skillId }, as(stranger))), "validation.not_found", "no grant, no view");
  await call(hn, "skills.grant", { skillId: s.skillId, agentId: editor, level: "manage" }, as(owner));
  await call(hn, "skills.grant", { skillId: s.skillId, agentId: stranger, level: "use" }, as(editor));
  assert.ok((await listed(hn, as(stranger), stranger)).includes("billing-rules"));
  // taking it back removes it from the list
  await call(hn, "skills.grant", { skillId: s.skillId, agentId: reader, level: null }, as(owner));
  assert.ok(!(await listed(hn, as(reader), reader)).includes("billing-rules"));
  assert.equal(await fails(call(hn, "skills.grant", { skillId: s.skillId, agentId: owner, level: "use" }, as(owner))), "validation.bad_input", "the owner already has it");
  // the person who owns the agent manages its skills too
  await call(hn, "skills.grant", { skillId: s.skillId, agentId: reader, level: "use" });
  assert.ok((await listed(hn, as(reader), reader)).includes("billing-rules"));
  assert.equal(await fails(call(hn, "skills.save", { skillId: s.skillId, text: SKILL("billing-rules", "x") }, hn.person(MAYA))), "validation.not_found", "another person has no say");
});

test("a person can share one of their own skills with an agent, and write skills for an agent they own", async () => {
  const { hn, maya } = world();
  const agent = await agentOf(hn, hn.ctx, "Intake");
  const mine = (await call(hn, "skills.mine.add", { text: SKILL("deploy-checks", "Run checks.") })).skill;
  await call(hn, "skills.grant", { skillId: mine.skillId, agentId: agent, level: "use" });
  assert.ok((await listed(hn, hn.as({ kind: "agent", id: agent }, MAYA), agent)).includes("deploy-checks"), "the grant travels with the agent, on anyone's turn");
  const forAgent = (await call(hn, "skills.save", { text: SKILL("intake-flow", "How intake runs."), ownerAgentId: agent })).skill;
  assert.deepEqual([forAgent.owner, forAgent.ownerKind], [agent, "agent"]);
  assert.equal(await fails(call(hn, "skills.save", { text: SKILL("x", "y"), ownerAgentId: agent }, maya)), "permission.role_lacks_permission", "another person cannot write for it");
});

test("an agent uses the skills of the person it answers, on that person's turn only; the text of private skills does not reach another person's turn", async () => {
  const { hn, maya } = world();
  const shared = await agentOf(hn, hn.ctx, "Team helper");
  await call(hn, "skills.mine.add", { text: SKILL("dana-private", "Dana's private way of doing X.", "Dana's secret method.") });
  await call(hn, "skills.mine.add", { text: SKILL("maya-private", "Maya's way.", "Maya's method.") }, maya);
  const onDana = await call(hn, "skills.list", { agentId: shared }, hn.as({ kind: "agent", id: shared }, DANA));
  const onMaya = await call(hn, "skills.list", { agentId: shared }, hn.as({ kind: "agent", id: shared }, MAYA));
  assert.ok(onDana.skills.some((s: { name: string }) => s.name === "dana-private"));
  assert.ok(!onDana.skills.some((s: { name: string }) => s.name === "maya-private"));
  assert.ok(onMaya.skills.some((s: { name: string }) => s.name === "maya-private"));
  assert.ok(!onMaya.skills.some((s: { name: string }) => s.name === "dana-private"), "Dana's skill is not in the turn of someone else");
  assert.equal(await fails(call(hn, "skills.load", { name: "dana-private", agentId: shared } as never, hn.as({ kind: "agent", id: shared }, MAYA)).catch((e) => { throw e; })), "validation.not_found", "and cannot be loaded there");
  assert.equal(JSON.stringify(onMaya).includes("secret method"), false);
  assert.equal(await fails(call(hn, "skills.view", { name: "dana-private" }, maya)), "validation.not_found");
});

test("a plan is read again by its id, an install is taken back, the Space's installs are an admin's list, and agents' skills are listed for their owner", async () => {
  const { hn, maya, member, admin } = world();
  const agent = await agentOf(hn, hn.ctx, "Intake");
  const p = await plan(hn, "acme/pdf-skill");
  const got = await call(hn, "install.get", { planId: p.planId });
  assert.deepEqual([got.plan.planId, got.plan.commit, got.plan.state], [p.planId, p.commit, "planned"]);
  member();
  assert.equal(await fails(call(hn, "install.get", { planId: p.planId }, maya)), "validation.not_found", "another person has no say in it");
  admin();
  await call(hn, "install.apply", { planId: p.planId, for: "agent", agentId: agent });
  assert.equal((await call(hn, "install.get", { planId: p.planId })).plan.state, "installed");
  await call(hn, "skills.save", { text: SKILL("own", "Its own."), ownerAgentId: agent });
  const rows = (await call(hn, "skills.of_agents", {})).skills;
  assert.deepEqual(rows.map((r: { name: string; agentName: string }) => [r.name, r.agentName]).sort(), [["own", "Intake"], ["pdf-forms", "Intake"]]);
  assert.deepEqual((await call(hn, "skills.of_agents", {}, maya)).skills, [], "not another person's agents");
  member();
  await call(hn, "install.apply", { planId: (await plan(hn, "acme/pdf-skill", maya)).planId, for: "me" }, maya);
  assert.equal((await call(hn, "install.list", { all: true }, maya)).installs.length, 1, "a member sees only their own");
  admin();
  assert.equal((await call(hn, "install.list", { all: true })).installs.length, 2, "an admin sees the Space's");
  const mine = (await call(hn, "install.list", {})).installs[0];
  assert.deepEqual(await call(hn, "install.remove", { installId: mine.installId }), { removed: true });
  assert.ok(!(await listed(hn, hn.as({ kind: "agent", id: agent }, DANA), agent)).includes("pdf-forms"));
  assert.deepEqual(await call(hn, "install.remove", { installId: mine.installId }).catch((e) => codeOf(e)), "validation.not_found");
});
