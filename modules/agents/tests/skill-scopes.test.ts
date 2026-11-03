// Skills for a person and the skills they share (owner ruling 3 Nov; decisions D26 and D27): Mine, cards for shared skills, Space skills from Console for everyone, re-approval when an update
// can touch more, every install path, a bundled server's key through the Vault, the admin's scripts rule, and two skills with one name. The turn index reads skills.list as the asker, so
// "applies to their agents' turn index" is what skills.list answers for their agent.
import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { handlers } from "../impl.ts";
import { forgetFolderSkills } from "../handlers/skills.ts";
import { setPluginsHost } from "../handlers/plugins.ts";
import { DANA, LEO, MAYA, assertEventsConform, codeOf, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import manifest from "../../../manifests/agents.ts";
import { PERMISSIONS } from "../../../manifests/permissions.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
let n = 0;
const WRITES = new Set(["skills.add", "skills.remove", "skills.set_enabled", "skills.mine.add", "skills.mine.set", "skills.mine.remove", "skills.mine.update", "skills.share", "skills.shared.decide", "skills.space.install", "skills.space.update", "skills.space.adopt", "skills.space.setup", "skills.policy.set", "agents.create", "plugins.marketplace.add", "plugins.allow.set"]);
const call = async (hn: Harness, cap: string, input: Record<string, unknown>, ctx: Harness["ctx"] = hn.ctx): Promise<any> => {
  const withKey = WRITES.has(cap) ? { idempotencyKey: `k${++n}`, ...input } : input;
  assert.deepEqual(contractErrors(cap, "in", withKey), [], `${cap}: input`);
  const out = await h[cap]!(ctx, withKey);
  assert.deepEqual(contractErrors(cap, "out", out), [], `${cap}: output`);
  return out;
};
const fails = async (p: Promise<unknown>): Promise<string> => { try { await p; return "none"; } catch (e) { return codeOf(e); } };
const SKILL = (name: string, desc: string, body = "Do the thing.") => `---\nname: ${name}\ndescription: ${desc}\n---\n\n${body}\n`;
const names = (r: { skills: Array<{ name: string }> }): string[] => r.skills.map((s) => s.name);
const MCP = JSON.stringify({ mcpServers: { notion: { command: "npx", args: ["-y", "@notionhq/notion-mcp-server"], env: { NOTION_TOKEN: "${NOTION_TOKEN}" } } } });

function world() {
  forgetFolderSkills();
  const hn = harness();
  const maya = hn.person(MAYA), leo = hn.person(LEO);
  const member = (): void => hn.allowOnly((a) => a.perm !== "agents.manage" && a.perm !== "kits.install");
  const admin = (): void => hn.allowOnly(() => true);
  return { hn, maya, leo, member, admin };
}
async function agentOf(hn: Harness, ctx: Harness["ctx"], name: string): Promise<string> {
  return (await call(hn, "agents.create", { name, role: `${name}.` }, ctx)).agent.agentId as string;
}
const index = async (hn: Harness, ctx: Harness["ctx"], agentId?: string): Promise<string[]> => names(await call(hn, "skills.list", agentId ? { agentId } : {}, ctx));

test("a skill shared with one person is a card for them; Add puts it in their agents' index, Not now does not, and nobody else sees it", async () => {
  const { hn, maya, leo, member, admin } = world();
  const mayaAgent = await agentOf(hn, maya, "Maya intake");
  const leoAgent = await agentOf(hn, leo, "Leo notes");
  const mine = (await call(hn, "skills.mine.add", { text: SKILL("deploy-checks", "Run the checks before a deploy.") })).skill;
  assert.deepEqual([mine.name, mine.agents, mine.enabled, mine.sharedWith], ["deploy-checks", ["*"], true, []]);
  assert.ok((await index(hn, hn.ctx)).includes("deploy-checks"), "Mine is in the owner's own index");
  assert.ok(!(await index(hn, maya, mayaAgent)).includes("deploy-checks"), "and in nobody else's");

  await call(hn, "skills.share", { skillId: mine.skillId, to: [MAYA] });
  let page = await call(hn, "skills.page", {}, maya);
  assert.deepEqual(page.waiting.map((c: { name: string }) => c.name), ["deploy-checks"]);
  assert.equal(page.waiting[0].sharer, DANA);
  assert.deepEqual(page.waiting[0].perms, { scripts: [], mcpServers: [], network: [], vaultKeys: [] });
  assert.ok(!(await index(hn, maya, mayaAgent)).includes("deploy-checks"), "a card never runs before Add");
  assert.equal((await call(hn, "skills.page", {}, leo)).waiting.length, 0, "Leo was not given it");
  assert.match((await call(hn, "skills.view", { skillId: mine.skillId }, maya)).skill.text, /Do the thing/, "View works before Add");
  member();
  assert.equal(await fails(call(hn, "skills.view", { skillId: mine.skillId }, leo)), "validation.not_found", "a member it was not shared with cannot open it");
  admin();

  await call(hn, "skills.shared.decide", { skillId: mine.skillId, decision: "not_now" }, maya);
  page = await call(hn, "skills.page", {}, maya);
  assert.deepEqual([page.waiting.length, page.shared[0].state], [0, "not_now"]);
  assert.ok(!(await index(hn, maya, mayaAgent)).includes("deploy-checks"), "Not now does not apply it");

  await call(hn, "skills.shared.decide", { skillId: mine.skillId, decision: "add" }, maya);
  assert.ok((await index(hn, maya, mayaAgent)).includes("deploy-checks"), "Add applies it to her agent's turn index");
  assert.equal((await call(hn, "skills.load", { name: "deploy-checks", agentId: mayaAgent }, maya)).skill.tier, "shared");
  assert.ok(!(await index(hn, leo, leoAgent)).includes("deploy-checks"));

  // her own pick of agents: off for this agent, then back
  await call(hn, "skills.mine.set", { skillId: mine.skillId, agents: [] }, maya);
  assert.ok(!(await index(hn, maya, mayaAgent)).includes("deploy-checks"));
  await call(hn, "skills.mine.set", { skillId: mine.skillId, agents: [mayaAgent] }, maya);
  assert.ok((await index(hn, maya, mayaAgent)).includes("deploy-checks"));
  assert.deepEqual(hn.named("skill.share_decided").map((e) => e.payload["decision"]), ["not_now", "add"]);
  assert.deepEqual(assertEventsConform(hn), []);
});

test("shared with the whole Space: every member gets their own card and decides for themselves", async () => {
  const { hn, maya, leo } = world();
  const mayaAgent = await agentOf(hn, maya, "Maya intake");
  const leoAgent = await agentOf(hn, leo, "Leo notes");
  const s = (await call(hn, "skills.mine.add", { text: SKILL("triage", "Sort the intake.") })).skill;
  await call(hn, "skills.share", { skillId: s.skillId, space: true });
  for (const who of [maya, leo]) {
    const page = await call(hn, "skills.page", {}, who);
    assert.deepEqual(page.waiting.map((c: { name: string; toSpace: boolean }) => [c.name, c.toSpace]), [["triage", true]]);
  }
  assert.equal((await call(hn, "skills.page", {}, hn.ctx)).waiting.length, 0, "the sharer gets no card for their own");
  await call(hn, "skills.shared.decide", { skillId: s.skillId, decision: "add" }, maya);
  assert.ok((await index(hn, maya, mayaAgent)).includes("triage"));
  assert.ok(!(await index(hn, leo, leoAgent)).includes("triage"), "Leo has not added it");
  await call(hn, "skills.shared.decide", { skillId: s.skillId, decision: "add" }, leo);
  assert.ok((await index(hn, leo, leoAgent)).includes("triage"));
  // stopping the share takes it away from both
  await call(hn, "skills.share", { skillId: s.skillId, space: true, stop: true });
  assert.ok(!(await index(hn, maya, mayaAgent)).includes("triage"));
  assert.equal((await call(hn, "skills.page", {}, leo)).waiting.length, 0);
});

test("a skill set in Console applies to everyone and their agents with no card; a member sees it and cannot remove it", async () => {
  const { hn, maya, member, admin } = world();
  const mayaAgent = await agentOf(hn, maya, "Maya intake");
  const set = (await call(hn, "skills.space.install", { text: SKILL("house-style", "Write in the firm's house style."), source: "github:acme/skills@main/house-style", version: "1.2" })).skill;
  assert.deepEqual([set.name, set.version, set.origin], ["house-style", "1.2", "acme/skills"]);
  const page = await call(hn, "skills.page", {}, maya);
  assert.equal(page.waiting.length, 0, "no card");
  assert.deepEqual(page.space.map((s: { name: string }) => s.name), ["house-style"]);
  assert.ok((await index(hn, maya, mayaAgent)).includes("house-style"), "it is in her agent's index at once");

  member();
  // the host refuses skills.remove for a member (agents.manage); the page's own remove never takes a Space skill
  const def = manifest.capabilities.find((c) => c.name === "skills.remove")!;
  assert.equal((def as { permission?: string | null }).permission, "agents.manage");
  const role = PERMISSIONS.find((p) => p.key === "agents.manage")!;
  assert.equal(role.defaults["member"], false, "members do not hold agents.manage");
  assert.equal((await call(hn, "skills.mine.remove", { skillId: "sko_notaskill" }, maya)).removed, false);
  assert.equal((await call(hn, "skills.page", {}, maya)).admin, false);
  admin();
  assert.equal((await call(hn, "skills.page", {}, hn.ctx)).admin, true);
});

test("an update from the sharer that can touch more waits for the recipient to add it again; one that cannot applies at once", async () => {
  const { hn, maya } = world();
  const mayaAgent = await agentOf(hn, maya, "Maya intake");
  const s = (await call(hn, "skills.mine.add", { text: SKILL("report", "Write the weekly report.") })).skill;
  await call(hn, "skills.share", { skillId: s.skillId, to: [MAYA] });
  await call(hn, "skills.shared.decide", { skillId: s.skillId, decision: "add" }, maya);
  // the words change, nothing new to touch: still applied
  await call(hn, "skills.mine.add", { text: SKILL("report", "Write the weekly report, shorter."), replaces: s.skillId });
  assert.ok((await index(hn, maya, mayaAgent)).includes("report"));
  // now it ships a script and a server that wants a key
  await call(hn, "skills.mine.add", { text: SKILL("report", "Write the weekly report."), files: { "scripts/pull.py": "print(1)", ".mcp.json": MCP }, replaces: s.skillId });
  const page = await call(hn, "skills.page", {}, maya);
  assert.equal(page.waiting.length, 1);
  assert.ok(page.waiting[0].growth.some((g: string) => /new script: scripts\/pull\.py/.test(g)), page.waiting[0].growth.join("; "));
  assert.ok(page.waiting[0].growth.some((g: string) => /tool server: notion/.test(g)));
  assert.ok(page.waiting[0].growth.some((g: string) => /npx downloads/.test(g)));
  assert.ok(!(await index(hn, maya, mayaAgent)).includes("report"), "it stops applying until she adds it again");
  await call(hn, "skills.shared.decide", { skillId: s.skillId, decision: "add" }, maya);
  assert.ok((await index(hn, maya, mayaAgent)).includes("report"));
});

// ---- install paths ------------------------------------------------------------------------------------------------------------------------------------

/** A zip with one deflated entry per file (the reader does not check CRCs). */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = deflateRawSync(Buffer.from(text, "utf8")), nm = Buffer.from(name, "utf8");
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(8, 8); l.writeUInt32LE(data.length, 18); l.writeUInt32LE(Buffer.byteLength(text), 22); l.writeUInt16LE(nm.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(Buffer.byteLength(text), 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(off, 42);
    locals.push(l, nm, data); centrals.push(c, nm); off += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}

test("install paths: a GitHub repo folder, a raw SKILL.md link, a zip, a dropped folder, a marketplace, a Codex skill folder and a lone AGENTS.md", async () => {
  const { hn } = world();
  const repo: Record<string, string> = {
    "README.md": "skills", "skills/pdf/SKILL.md": SKILL("pdf", "Fill and read PDFs."), "skills/pdf/scripts/fill.py": "print('fill')", "skills/pdf/.mcp.json": MCP,
    "skills/xlsx/SKILL.md": SKILL("xlsx", "Spreadsheets."),
    ".claude-plugin/marketplace.json": JSON.stringify({ name: "acme-market", owner: { name: "Acme" }, plugins: [{ name: "docs-kit", source: "./plugins/docs-kit", description: "Docs" }] }),
    "plugins/docs-kit/.claude-plugin/plugin.json": JSON.stringify({ name: "docs-kit", version: "2.0.0" }), "plugins/docs-kit/skills/memo/SKILL.md": SKILL("memo", "Write a memo."),
  };
  const fetched: unknown[] = [];
  setPluginsHost({ async fetchTree(src) { fetched.push(src); return { files: repo, revision: "abc", skipped: ["skills/pdf/logo.png"] }; } });
  try {
    // a GitHub folder link: one skill, with its script and server, and a source that fetches exactly it again
    const gh = await call(hn, "skills.preview", { link: "https://github.com/acme/skills/tree/main/skills/pdf" });
    assert.deepEqual(gh.skills.map((s: { name: string }) => s.name), ["pdf"]);
    assert.equal(gh.source, "github:acme/skills@main/skills/pdf");
    assert.deepEqual(gh.skills[0].perms.scripts, ["scripts/fill.py"]);
    assert.deepEqual(gh.skills[0].perms.mcpServers.map((m: { name: string; keys: string[] }) => [m.name, m.keys]), [["notion", ["NOTION_TOKEN"]]]);
    assert.deepEqual(fetched[0], { kind: "git", url: "https://github.com/acme/skills", ref: "main" });
    // the whole repo: every skill in it, each with its own source
    const all = await call(hn, "skills.preview", { link: "acme/skills" });
    assert.deepEqual(all.skills.map((s: { name: string }) => s.name).sort(), ["memo", "pdf", "xlsx"]);
    assert.equal(all.skills.find((s: { name: string }) => s.name === "xlsx").source, "github:acme/skills/skills/xlsx");
    const added = (await call(hn, "skills.mine.add", { text: gh.skills[0].text, files: gh.skills[0].files, source: gh.source })).skill;
    assert.deepEqual([added.origin, added.needs], ["acme/skills", ["notion.NOTION_TOKEN"]]);
    // Update fetches the same folder again
    repo["skills/pdf/SKILL.md"] = SKILL("pdf", "Fill, read and merge PDFs.");
    const up = await call(hn, "skills.mine.update", { skillId: added.skillId });
    assert.deepEqual([up.changed, up.skill.description, up.growth], [true, "Fill, read and merge PDFs.", []]);

    // a marketplace the admin allowed: its plugin's skills come in as Mine
    const m = (await call(hn, "plugins.marketplace.add", { source: "acme/skills" })).marketplace;
    await call(hn, "plugins.allow.set", { kind: "marketplace", marketplace: m.name, allowed: true });
    const mk = await call(hn, "skills.preview", { marketplace: { marketplaceId: m.marketplaceId, plugin: "docs-kit" } });
    assert.deepEqual([mk.skills.map((s: { name: string }) => s.name), mk.source, mk.skills[0].version, mk.skills[0].kind], [["memo"], "marketplace:acme-market/docs-kit", "2.0.0", "plugin"]);
  } finally { setPluginsHost(null); }

  // a raw SKILL.md link is read through read_link
  hn.world.handlers["automations.read_link"] = (i: Record<string, unknown>) => ({ ok: true, kind: "text", text: String(i["url"]).endsWith("/SKILL.md") ? SKILL("summarise", "Summarise a thread.") : "" });
  const raw = await call(hn, "skills.preview", { link: "https://github.com/acme/skills/blob/main/summarise/SKILL.md" });
  assert.deepEqual([raw.skills[0].name, raw.source], ["summarise", "link:https://raw.githubusercontent.com/acme/skills/main/summarise/SKILL.md"]);

  // a zip from a GitHub download (one top folder), with a binary file left out
  const z = zip({ "skills-main/brief/SKILL.md": SKILL("brief", "Write a brief."), "skills-main/brief/references/tone.md": "Plain words." });
  const zp = await call(hn, "skills.preview", { zip: z.toString("base64") });
  assert.deepEqual([zp.skills[0].name, Object.keys(zp.skills[0].files), zp.source], ["brief", ["references/tone.md"], "zip"]);
  assert.equal(await fails(call(hn, "skills.preview", { zip: Buffer.from("not a zip").toString("base64") })), "validation.bad_input");

  // a dropped folder
  const fp = await call(hn, "skills.preview", { files: { "handover/SKILL.md": SKILL("handover", "Hand a matter over."), "handover/checklist.md": "1. 2." }, hint: "handover" });
  assert.deepEqual([fp.skills[0].name, Object.keys(fp.skills[0].files), fp.source], ["handover", ["checklist.md"], "folder"]);

  // Codex: a skills folder with its openai.yaml, and a project with only AGENTS.md
  const cx = await call(hn, "skills.preview", { files: { ".codex/skills/review/SKILL.md": SKILL("review", "Review a diff."), ".codex/skills/review/agents/openai.yaml": "interface:\n  display_name: Review\n" } });
  assert.deepEqual([cx.skills[0].name, cx.skills[0].kind], ["review", "codex"]);
  const ag = await call(hn, "skills.preview", { files: { "AGENTS.md": "# Billing service\n\nRun the tests before you push." }, hint: "billing-service" });
  assert.deepEqual([ag.skills[0].name, ag.skills[0].kind], ["billing-service", "codex"]);
  assert.match(ag.skills[0].text, /Run the tests before you push/);
  const none = await call(hn, "skills.preview", { files: { "notes.txt": "nothing" } });
  assert.deepEqual([none.skills.length, none.problems], [0, ["There is no SKILL.md or AGENTS.md in it."]]);
});

test("a bundled server's key goes through the Vault: the skill lists what it needs, a raw value is refused, a handle starts it, and the sandbox gets the skill's files", async () => {
  const { hn, maya } = world();
  const agent = await agentOf(hn, hn.ctx, "Notes");
  const s = (await call(hn, "skills.mine.add", { text: SKILL("notion-notes", "Keep notes in Notion."), files: { ".mcp.json": MCP, "server.js": "// runs" } })).skill;
  assert.deepEqual(s.needs, ["notion.NOTION_TOKEN"]);
  let servers = (await call(hn, "plugins.mcp.servers", { agentId: agent })).servers.filter((x: { key: string }) => x.key.startsWith("skill:"));
  assert.deepEqual(servers.map((x: { key: string; needs: string[] }) => [x.key, x.needs]), [[`skill:${s.skillId}/notion`, ["NOTION_TOKEN"]]], "not started until it has its key");
  assert.equal(await fails(call(hn, "skills.mine.set", { skillId: s.skillId, setup: { "notion.NOTION_TOKEN": "secret_abc123" } })), "validation.bad_input");
  const set = await call(hn, "skills.mine.set", { skillId: s.skillId, setup: { "notion.NOTION_TOKEN": "#notion_notes_NOTION_TOKEN.value" } });
  assert.deepEqual(set.needs, []);
  servers = (await call(hn, "plugins.mcp.servers", { agentId: agent })).servers.filter((x: { key: string }) => x.key.startsWith("skill:"));
  assert.deepEqual([servers[0].env.NOTION_TOKEN, servers[0].needs, servers[0].command, servers[0].pluginId], ["#notion_notes_NOTION_TOKEN.value", [], "npx", s.skillId]);
  const files = (await call(hn, "plugins.files", { pluginId: s.skillId })).files;
  assert.deepEqual(Object.keys(files).sort(), [".mcp.json", "SKILL.md", "server.js"]);
  assert.equal(await fails(call(hn, "plugins.files", { pluginId: s.skillId }, maya)), "validation.not_found", "someone it was not shared with gets nothing");
  assert.ok(!JSON.stringify(hn.rows("SELECT * FROM agents_skill_own")).includes("secret_abc123"), "no value is ever kept");
});

test("D26: the admin's rule keeps skills that run scripts to admins; it is off by default, and plain skills are never held", async () => {
  const { hn, maya, member, admin } = world();
  assert.equal((await call(hn, "skills.page", {})).policy.scriptsAdminOnly, false);
  member();
  await call(hn, "skills.mine.add", { text: SKILL("with-script", "Has a script."), files: { "run.sh": "echo hi" } }, maya);
  admin();
  await call(hn, "skills.policy.set", { scriptsAdminOnly: true });
  member();
  assert.equal(await fails(call(hn, "skills.mine.add", { text: SKILL("another-script", "Has a script."), files: { "go.py": "print(1)" } }, maya)), "permission.role_lacks_permission");
  assert.equal((await call(hn, "skills.mine.add", { text: SKILL("words-only", "Only words.") }, maya)).skill.name, "words-only");
  admin();
  const s = (await call(hn, "skills.mine.add", { text: SKILL("admin-script", "Has a script."), files: { "go.py": "print(1)" } })).skill;
  await call(hn, "skills.share", { skillId: s.skillId, to: [MAYA] });
  member();
  assert.equal(await fails(call(hn, "skills.shared.decide", { skillId: s.skillId, decision: "add" }, maya)), "permission.role_lacks_permission", "a member cannot add a shared one that runs scripts either");
  await call(hn, "skills.shared.decide", { skillId: s.skillId, decision: "not_now" }, maya);
  admin();
  assert.deepEqual(hn.named("skill.policy_changed").map((e) => e.payload["scriptsAdminOnly"]), [true]);
});

test("D27: two skills with one name are both kept; the later one is renamed with its source, in the page and in the agent's index, and loads by that name", async () => {
  const { hn, maya } = world();
  const agent = await agentOf(hn, maya, "Maya intake");
  await call(hn, "skills.space.install", { text: SKILL("pdf", "The Space's PDF skill.") });
  hn.advance(1000);
  const mine = (await call(hn, "skills.mine.add", { text: SKILL("pdf", "Acme's PDF skill."), source: "github:acme/skills/pdf" }, maya)).skill;
  assert.deepEqual([mine.name, mine.label], ["acme-skills:pdf", "pdf (from acme/skills)"]);
  const idx = await index(hn, maya, agent);
  assert.ok(idx.includes("pdf") && idx.includes("acme-skills:pdf"), idx.join(", "));
  assert.equal((await call(hn, "skills.load", { name: "acme-skills:pdf", agentId: agent }, maya)).skill.description, "Acme's PDF skill.");
  assert.equal((await call(hn, "skills.load", { name: "pdf", agentId: agent }, maya)).skill.description, "The Space's PDF skill.");
  const listed = (await call(hn, "skills.list", { agentId: agent }, maya)).skills.find((s: { name: string }) => s.name === "acme-skills:pdf");
  assert.deepEqual([listed.tier, listed.label], ["mine", "pdf (from acme/skills)"]);
  // the other way round: a Space skill set after hers is the newcomer for her
  hn.advance(1000);
  await call(hn, "skills.mine.add", { text: SKILL("memo", "Her memo skill.") }, maya);
  hn.advance(1000);
  await call(hn, "skills.space.install", { text: SKILL("memo", "The Space's memo skill.") });
  const page = await call(hn, "skills.page", {}, maya);
  assert.equal(page.space.find((s: { name: string }) => s.name === "memo").label, "memo (from this Space)");
  assert.equal(page.mine.find((s: { name: string }) => s.name === "memo").label, undefined);
  assert.ok((await index(hn, maya, agent)).includes("this-space:memo"));
  assert.deepEqual((await index(hn, hn.ctx)).filter((x) => x.endsWith("memo")), ["memo"], "for everyone else the Space's keeps its name");
  // a preview says the name it will take
  const pv = await call(hn, "skills.preview", { files: { "SKILL.md": SKILL("memo", "Another memo.") } }, maya);
  assert.equal(pv.skills[0].taken, "memo (from your skills)");
});

test("Console sees members' skills by name only, opens only shared ones, and makes a shared one Space-wide", async () => {
  const { hn, maya, member, admin } = world();
  const kept = (await call(hn, "skills.mine.add", { text: SKILL("private-notes", "Mine alone.", "SECRET BODY") }, maya)).skill;
  const shared = (await call(hn, "skills.mine.add", { text: SKILL("intake-form", "Fill the intake form.") }, maya)).skill;
  await call(hn, "skills.share", { skillId: shared.skillId, space: true }, maya);
  const rows = (await call(hn, "skills.members", {})).skills;
  assert.deepEqual(rows.map((r: { name: string; shared: boolean; skillId?: string }) => [r.name, r.shared, r.skillId !== undefined]), [["intake-form", true, true], ["private-notes", false, false]]);
  assert.ok(!JSON.stringify(rows).includes("SECRET BODY"));
  assert.equal(await fails(call(hn, "skills.view", { skillId: kept.skillId })), "validation.not_found", "an admin cannot open one that was not shared");
  assert.match((await call(hn, "skills.view", { skillId: shared.skillId })).skill.text, /Fill the intake form/);
  assert.equal(await fails(call(hn, "skills.space.adopt", { skillId: kept.skillId })), "validation.not_found");
  const adopted = (await call(hn, "skills.space.adopt", { skillId: shared.skillId })).skill;
  assert.deepEqual([adopted.name, adopted.from], ["intake-form", MAYA]);
  assert.ok((await index(hn, hn.person(LEO))).includes("intake-form"), "everyone has it with no card");
  member(); admin();
});
